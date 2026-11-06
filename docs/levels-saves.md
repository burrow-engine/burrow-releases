# Levels and saves

Two building blocks for games that are not sandboxes, both off by default (`runtime.plugins.levels: true` / `saves: true` enable them): **fixed levels** (hand-built voxel regions with spawn points, trigger zones and
settings, switched by a journaled command) and a **generic save system** (slots holding a sim snapshot, the level id and the game's own
key/value data). Both are deterministic: a level switch replays from the journal, a restored save has the exact StateHash it was saved with.
Packages: `level` (format, codec, library; no engine dependency), `level/levelplug` (engine plugin), `save` (format, slot store),
`save/saveplug` (engine plugin). Example: `examples/level_demo`, `make levels-test`.

## Quick start

`vox.project`:

```json
{ "runtime": {
    "plugins": { "levels": true, "saves": true },
    "levels":  { "dir": "levels", "initial": "hall", "actors": ["/player"] },
    "saves":   { "game": "my_game", "version": 1, "autosave_seconds": 60, "autosave_slots": 2 } } }
```

Both plugins add simulation state, so they are off unless asked for (existing projects keep their hashes). In Go:

```go nocheck
a.AddPlugin(&engine.ScenePlugin{})
a.AddPlugin(&engine.VoxelWorldPlugin{Generator: gen})
a.AddPlugin(&levelplug.Plugin{Dir: "levels", Read: readProjectFile, Actors: []string{"/player"}, Initial: "hall"})
a.AddPlugin(&saveplug.Plugin{Dir: saveDir, Game: "my_game", GameVersion: 1})
```

## The `.level` file

A level is one file, `levels/<id>.level` (id: letters, digits, `_ . -`, at most 64 bytes; also the file stem). Layout: `BLVL`, format version
(u16, newer is rejected), the deflated body, then the SHA-256 of everything before it. The body is the metadata JSON plus the stored chunks
(`voxel.Chunk` run-length blobs, positions relative to the region's minimum chunk). Blocks are stored **by name** through a per-level palette,
so a level loads into any registry that has those blocks and fails with the name of a missing one.

| part | content |
|---|---|
| region | `size` in chunks (1..64 per axis, at most 4096 chunks), default `origin` chunk, stored chunks (empty chunks are not stored) |
| `mix` | `replace` (default): the whole box is the level, generated terrain inside it is carved away. `keep`: only stored chunks replace terrain, so the level can be a fixed building in a generated world |
| `spawns` | `{name, pos, yaw, tags}`, level-local blocks (relative to the region's minimum corner) |
| `zones` | `{name, kind: zone|trigger, min, max, target, target_spawn, props}`; `min` inclusive, `max` exclusive. A `trigger` switches to `target` when an actor stands in it |
| `nodes`, `prefabs` | scene nodes (and prefab instances; the prefab documents are embedded, so a load reads no other file) spawned under the node `/level` |
| `settings` | `sky`, `weather`, `weather_intensity`, `fog`, `gravity`, `kill_y`, `bounds` |

Procedural worldgen stays the base layer: a level is an overlay on top of it (`mix` decides how), unloading restores the generated terrain.
Hostile input: file at most 64 MiB, body at most 192 MiB after inflating (a decompression bomb is cut at the limit), metadata at most 1 MiB,
unknown JSON fields, bad names, non-finite or huge coordinates, chunks outside the box, bad palette ids and trailing bytes are all rejected
(`level.ErrCorrupt`); ids and paths never contain separators or `..` and symbolic links are refused. `Level.Hash()` (SHA-256 of the canonical
body) is the content identity.

## Loading and switching

`level_load` is a journaled `sim.Command` carrying `{id, hash, origin?, spawn?, teleport?}`. `Apply` unloads the current level (its region
goes back to the generated terrain, `/level` is despawned), places the new region, spawns its nodes, moves the `teleport` nodes to the spawn
point and records the new `levelplug.State` (id, hash, origin, size, spawn, loads). The state is a tracked fixed resource: rolled back with a
failed tick, in StateHash, snapshotted. The **hash is pinned in the journal**: replaying against an edited level fails with a clear error
instead of diverging. `Apply` is atomic (the engine rolls everything back on error) and bounded (at most 4096 chunk writes). Same level, same
seed: same StateHash after the load, whatever the thread timing.

Everything slow happens outside the tick. `level.Library` reads and decodes files on worker goroutines (`Prefetch`); a switch request waits
in `Manager` until the level is ready and only then queues the command, so no frame blocks on disk or inflate (`Manager.Pending`).

```go nocheck
m := engine.Res[*levelplug.Manager](app)
m.Request(levelplug.Request{ID: "garden", Spawn: "from_hall"}) // async, from frame code
m.Switch(levelplug.Request{ID: "garden"})                      // sync, between frames (tools, tests)
m.Current()                                                    // *level.Level of the loaded level
```

Requests from the simulation never mutate the sim: a fixed system or script sends `levelplug.Request` with `engine.SendFixed`, the manager
turns it into the command, so a replay (which has the command in its journal) is identical and the script saw a deterministic result.

**Transition hooks**: `Plugin.OnTransition(from, to)` runs before a switch is queued (return an error to veto); `Plugin.OnLoaded(m, level,
state)` runs on the frame after any load, unload or snapshot restore (apply sky, weather, fog, gravity there); the same moment is the
`levelplug.Loaded` event.

**Zones and the kill plane**: with `Plugin.Actors` set, a fixed system (`levels.zones`, at most 16 actors x 256 zones per tick) sends a switch
request when an actor stands in a trigger, and returns an actor below `kill_y` or outside `bounds` to the default spawn (a plain teleport). Actors should be
root-level nodes (the position is the local translation plus ancestors' translations; rotation of ancestors is ignored).

## Saves

A slot file (`<slot>.sav`, slot `[a-z0-9][a-z0-9_-]{0,47}`) holds metadata (game id, game data version, level id, tick, StateHash, seed,
label, wall-clock stamp for display only), the key/value data and `sim.Engine.Snapshot()`. Layout: `BSAV`, format version, deflated body,
SHA-256 trailer. Limits: file 128 MiB, inflated body 512 MiB, 1024 keys, key 128 bytes, value 64 KiB, key/value total 1 MiB.

* **Atomic**: written to a temporary file in the same folder, fsynced, renamed over the slot (mode 0600). A crash leaves the old save or the
  new one.
* **Rejected cleanly**: bad magic, newer format, checksum mismatch, truncation, bombs, lying section lengths, invalid metadata, another
  game's id, a slot name that does not match the file, a save from a newer game version. A rejected load changes nothing.
* **Same state**: `Manager.Load` restores the snapshot (atomic `Restore`), compares the StateHash with the saved one and restores the previous
  state if they differ (a changed engine configuration).
* **Versions and migration**: `Plugin.GameVersion` is the version of your own data; a save with an older version goes through
  `Plugin.Migrate(from, *save.Data)` (rewrite keys, the level id, ...). The file *format* has its own version.
* **Game data**: `saveplug.KV` is part of the simulation state (a tracked fixed resource): fixed systems use `saveplug.FixedKV(c)`, scripts
  `save_set` / `save_get`, hosts the journaled commands `save_kv_set` / `save_kv_delete`. Since it lives in the sim it is hashed, rolled back
  and restored with the snapshot, never out of sync with the world.
* **Autosave**: `Autosave{EveryTicks, Slot, Slots}` snapshots on the main goroutine every N simulation ticks (never the wall clock) and
  compresses and writes on a worker; a write in flight skips the tick instead of queueing. `Slots` > 1 rotates `autosave-1..N`.
* **Requests** from scripts and fixed systems (`saveplug.Request`) are served at the start of the next frame, between ticks; `saveplug.Result`
  reports the outcome.

```go nocheck
sm := engine.Res[*saveplug.Manager](app)
sm.Save("slot1", "before the boss")
sm.Load("slot1")
metas, bad, _ := sm.List() // bad lists unreadable slots with their errors
```

## Scripts and SDK

Host functions (module `vox`, see `script/ABI.md`): `level_load`, `level_current`, `level_spawn_count`, `level_spawn`, `level_zone_at`,
`level_settings`, `save_set`, `save_get`, `save_del`, `save_slot` (save, load, delete). Requests return 0 whatever the host does later, so
scripts stay deterministic; without the plugins they return unavailable. Go SDK (`sdk/burrowsdk/level.go`): `LevelLoad`, `LevelCurrent`,
`LevelSpawnCount`, `LevelSpawnAt`, `LevelZoneAt`, `LevelSettings`, `SaveSet`, `SaveGet`, `SaveDelete`, `SaveSlot`, `LoadSlot`, `DeleteSlot`.
To switch *scenes* (menu -> game) without a `.level` binary, use `scene_load` / `burrowsdk.SceneLoad("scenes/game.voxscn")` instead: it
instantiates a `.voxscn` project file under the root at commit, pinned by content hash so replays load the same document (see `script/ABI.md`).

## Editor and agents

Tools > Levels is a full-screen tool: a tool rail (Select V, Spawn point S, Zone Z, Door D; Esc drops a half-drawn zone; every change of the
draft is one undo step), the levels of `levels/` as cards (click to select,
double-click to open), and the world in the centre (top view by default) with the zones drawn as coloured boxes with their names and the spawn
points as pins. The Spawn tool puts a spawn point where you click the ground; Zone and Door take two ground corners. Level settings holds the name,
the region (grown to chunk boundaries on save) and the optional node root such as `/level`, the zone list, and the selected zone: a door's target
level and `target_spawn`, the spawn point of that level the actors arrive at when they travel through it (chosen from the target level's spawn
points; empty = its default spawn). **Play from here** saves the level if it changed and runs the game in its own window starting in this level at
its first spawn (`burrowplay -level <id> [-spawn <name>]`). Mark spawn at the focus, mark zone from the region, save region as level and clear
the draft are still there. MCP tool `editor_level` (`state`, `list`, `info`, `save`, `open`, `spawn_add`, `zone_add`,
`remove`, `settings`, `clear`). Open places the region into the document as a journaled `editor_open_level` edit (pinned by hash) and spawns
the nodes under `/level`; saving converts the draft's world coordinates to level-local ones. The editor does not install the runtime level
plugin (it would add state to every document), so scripts calling `level_load` in the editor's Play mode get "unavailable"; run the project
with `burrowplay` for the real switch.

## Limits

* One level is loaded at a time; the region of the next level replaces the previous one (stacking several is not modelled).
* Player edits inside a level region are lost on unload (the region is reset to the generated terrain).
* `gravity`, `sky`, `weather` and `fog` are data (queries, `OnLoaded`, `Loaded` event); only `kill_y` and `bounds` are enforced by the plugin.
* Levels are `.level` files; the folder form is not implemented. Prefabs are embedded in the level, so a prefab edited later does not update
  existing levels until they are saved again.
* The library keeps at most 64 decoded levels within a 256 MiB estimated budget (plus registered ones); levels the sim loaded are pinned by
  content hash (the last 4), so zones, scripts and `Manager.Current` never read a file inside a tick. A level file edited while the game runs
  must be invalidated (`Library.Invalidate`); a journal made before the edit then fails its hash check on replay. A failed decode is
  reported once (`Manager.LastError`) and the request dropped.
* Loading a save whose level file has changed since is refused and rolled back (`Manager.EnsureCurrent`); a restore also drops switches
  queued before it. With several ticks per frame a `save_slot` request from a script is served after all of them, so the saved tick can be
  later than the requesting tick.
* The editor's `editor_open_level` is journaled but not undoable; saving a level that was opened in the document replaces the journal by a
  checkpoint so the hash pin cannot break replay.
* Saves restore into an equally configured engine (same plugins, blocks, world generator and seed): the snapshot checks it and refuses
  otherwise. A save does not contain assets.

## Worlds

A world is a save slot plus two files next to `<slot>.sav` in the save folder: `<slot>.world.json` (name, mode, seed, generator, created and last played times) and `<slot>.png`, a 256x144 thumbnail written by windowed runs each time the world is saved (captured without the game UI overlay, so the UI never blinks) (needs `runtime.plugins.saves`). The game UI "worlds" list, `world:play`, `world:create`, `world:delete` and the script calls `WorldPlay` / `WorldCreate` use them. Creating a world applies its seed (0 = random) and generator (`flat`, `biomes`, `heightmap`, `empty` = all air; others keep the project's) and writes the sidecar; playing it rebuilds the game with the stored seed and restores the save if one exists. `mode` is free text kept for the game. The world a game starts on is a **start parameter like the seed**: it is held in simulation state (`app.world`, hashed, immutable), so scripts can branch gameplay on the mode with `ReadWorldInfo()` (`world_info`: slot, name, mode, seed, generator; `UNAVAILABLE` when the game is not on a known world) and the game UI sees it as the values `world_name` and `world_mode`. Because it is hashed, a replay must be started on the same world (same mode and seed) or its hash diverges, and a save only restores into a game started on the same world (a save of another world is refused). Games not started on a world have no such state and keep their hashes. Deleting a world removes the three files. Settings of the settings menu (applied live: volumes, fov through the controller, fullscreen, locale, and render distance through `VoxelWorld.SetRadius`; the far plane and fog end follow it live unless the project sets an explicit `Far`. All are read again at the next start) are kept in `settings.json` in the user config directory.

### Switching scenes at runtime

Every scene is a world of its own (`scenes/x.voxscn` + `scenes/x.voxworld`: seed, generator, voxel edits). A script can move the game to another scene with `burrowsdk.SceneSwitch("scenes/x.voxscn")` (see [scripting: entities and scene](scripting/04-entities-and-scene.md)): the roots are despawned, the base terrain is rebuilt for the target's seed and generator, its edits are loaded (or cleared) and the document is instantiated, as one journaled `game_scene_switch` command that carries the document and the world file. Save slots are scene aware: a save made in another scene than the start one records it in the slot's sidecar (`scene`, `scene_seed` in `<slot>.world.json`), and loading the slot starts the game in that scene and its world (the slot's own seed and generator stay for its start scene).
