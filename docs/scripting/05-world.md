# World

How a script reads and edits voxels, casts rays, queries and drives physics bodies, steers navigation agents, talks to levels and saves, and reads project data.

Signatures are in [reference/script-api.md](../reference/script-api.md); this page gives units, limits, timing and edge cases. Error codes: `1 INVALID`, `2 MEMORY`, `3 NOT_FOUND`, `4 TOO_SMALL` (handled by the SDK), `5 BUDGET`, `6 DENIED`, `7 UNAVAILABLE`, `8 REJECTED`, `9 LIMIT` ([errors and limits](09-errors-and-limits.md)).

## Coordinates and units

* One voxel is one block, one unit of length. Voxel cells are integers `(x, y, z)`; the cell `(x, y, z)` covers the float range `[x, x+1)` on each axis, so `floor` maps a position to its cell. `+Y` is up.
* World coordinates, shared by voxels, rays, physics and navigation. Only `Transform.Pos` of a child node is relative to its parent ([entities](04-entities-and-scene.md#transforms)).
* Voxel cells must satisfy `|x|, |y|, |z| <= 16,777,216` (2^24), otherwise `INVALID`. Chunks are 32 blocks wide.
* **Space that is not loaded or not generated reads as air (id 0).** There is no error for it. A write there creates the chunk in the world's edit overlay.
* Rays and boxes take `float32`; non-finite values are `INVALID`.

## Voxels

| function | what it does | errors |
|---|---|---|
| `Voxel(x, y, z)` | block id at the cell, including this call's earlier writes | `INVALID` (out of range) |
| `SetVoxel(x, y, z, id)` | write a block id | `INVALID` (out of range or unregistered id), `BUDGET` |
| `BlockByName(name)` | id of a registered block; `"air"` and `""` give 0 | `NOT_FOUND` |
| `LightAt(x, y, z)` | light of the cell | `INVALID` |
| `Raycast(origin, dir, max)` | first solid voxel along a ray | `INVALID` |

`BlockID` is an `int32` (`0` = air); ids are defined by the project's block registry ([below](#block-registry)).

**When a write is visible.** `SetVoxel` is validated at once and buffered; the chunk changes when the script call commits (and not at all if it faults). Until then `Voxel` and `Raycast` of the same call see it; `LightAt`, `PhysicsRaycast` and the other physics queries do not. After the commit, scripts that run later in the same tick see it, then the physics step, then meshing and rendering. Writing the block already there still costs one edit of the budget.

**Budget.** 4096 voxel edits per script call and 262,144 per tick; the next one returns `BUDGET` and nothing is written for it. `Physics3DRemoveVoxel` counts as one edit too.

**Light.** `Light{R, G, B, Sky}` holds block light per colour channel and skylight, each `0..15`. `Block()` is the brightest block channel; `Level(skyDim)` is `max(Block(), Sky - skyDim)`, with `skyDim` 0 at noon up to 15 at night (the "mobs spawn in the dark" rule). `LightAt` is deterministic and a function of the committed blocks only, so it ignores writes made in this call. Details: [lighting](../lighting.md).

**Voxel raycast.** `Raycast(origin, dir, max)` returns a `Hit{X, Y, Z, NX, NY, NZ, Dist, Block}` and `ok`.

| input | rule |
|---|---|
| `dir` | any non-zero vector; it is normalised, so `Dist` is in blocks along the ray |
| `max` | must be `> 0`; clamped to 4096 |
| hits | blocks whose registry entry is solid; air, water and non-solid plants are passed through |
| origin inside a solid voxel | hit on that voxel with `Dist = 0` and a zero normal |
| `NX, NY, NZ` | normal of the entered face (points back toward the origin), one component is `+-1` |
| miss | `ok = false`, no error |

It reads the world as this call sees it (earlier `SetVoxel` included) and respects block shapes when the project uses shaped blocks.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			t, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			stone, err := burrowsdk.BlockByName("stone")
			if err != nil {
				return // not in this registry
			}
			// look straight down and fill the cell above the first solid block
			hit, ok, err := burrowsdk.Raycast(t.Pos, [3]float32{0, -1, 0}, 32)
			if err != nil || !ok {
				return
			}
			x, y, z := int(hit.X+hit.NX), int(hit.Y+hit.NY), int(hit.Z+hit.NZ)
			if id, _ := burrowsdk.Voxel(x, y, z); id == 0 {
				_ = burrowsdk.SetVoxel(x, y, z, stone)
			}
		},
	})
}

func main() {}
```

## Block registry

The registry is the list of block types of the running project: the shaped set (`runtime.blocks: "shapes"`, the only supported value; `"classic"` and `"extended"` are deprecated and resolve to it), plus plugin blocks such as water levels. Ids follow registration order and differ between those sets, so **always resolve blocks by name** (`BlockByName`), never hard-code ids. See [blocks](../blocks.md) and [block shapes](../block-shapes.md); a shaped block keeps its bare item name for the default state (`oak_stairs`) and `name[prop=value,...]` for the others.

| function | what it does | errors |
|---|---|---|
| `BlockCount()` | number of registered blocks, air included (ids are `0..count-1`); returns the negative error code instead when the host is unavailable | none |
| `BlockName(id)` | name of a block id | `NOT_FOUND` |
| `BlockInfo(id)` | `BlockProps` of a block id | `NOT_FOUND` |
| `Registry("blocks")` | all block names, index = id | `INVALID` (unknown kind) |

`BlockProps`: `ID`, `Name`, `Solid` (blocks movement and rays), `Opaque` (stops light, hides faces), `Color` (RGB 0..255), `Emit` (light level 0..15; 0 also for blocks that emit by well-known name, such as torches), `Liquid` (0 not a liquid, 1..7 flowing level, 8 source), `Fragile` (flowing liquid destroys it), `LightLoss` (extra light levels lost per RGB channel), `Shape` (0 = cube, otherwise a shape model id).

## Item registry

The project's items come from `runtime.items` (package `itemset`; [items](../items.md)). The engine has no built-in item list and no inventory: the registry gives scripts identity, ids and stack limits, and the mod keeps counts in block data, `Script.State` or the save store. Ids are `1..ItemCount()`, item 0 is the empty stack, and a project without the file has none. Resolve items by name, never hard-code ids.

| function | what it does | errors |
|---|---|---|
| `ItemCount()` | number of registered items | none |
| `ItemName(id)` | registry name of an item id | `NOT_FOUND` |
| `ItemIDByName(name)` | id of an item name (case and the `burrow:` prefix are ignored) | `NOT_FOUND` |
| `ItemInfo(id)` | `ItemProps{ID, Name, Display, MaxStack, Block}` | `NOT_FOUND` |

A stack is 6 bytes, little endian: `u16` item id then `u32` count. `burrowsdk.ItemStack` has `Encode`, `DecodeItemStack`, `Split(n)` and `Merge(src, maxStack)`; the engine counterparts are in `itemset`. `ItemProps.Block` is the registry name the item stands for or places, and is only reported: the engine never places or drops it.

## Physics queries

Two independent physics plugins exist, and the functions are separate:

| plugin | project setting | script functions | when absent |
|---|---|---|---|
| `physics` (AABB bodies, characters, triggers: [character](../character.md)) | `runtime.plugins.physics` | `PhysicsRaycast`, `PhysicsOverlap` | `UNAVAILABLE` |
| `physics3d` (rigid bodies, voxel bodies, joints: [physics](../physics.md)) | `runtime.plugins.physics3d` (off by default) | `Physics3DRaycast`, `Physics3DOverlap`, `Physics3DApplyImpulse`, `Physics3DBody`, `Physics3DRemoveVoxel` | `UNAVAILABLE` |

Layers: a body has a `layer` bitmask and a `mask` of the layers it collides with. A query `mask` selects which layers it sees. `LayerDefault` is bit 0 (`1`), terrain (voxels) is bit 31 (`0x80000000`), all bits is `0xFFFFFFFF`. Terrain is only tested when the mask has bit 31.

| | `PhysicsRaycast` / `PhysicsOverlap` | `Physics3DRaycast` / `Physics3DOverlap` |
|---|---|---|
| mask `0` | sees nothing | sees every layer |
| triggers | ignored by the ray, included by the overlap | ignored by the ray, included by the overlap |
| body state read | committed state of this tick, before this tick's physics step | same, shapes as of the end of the previous step |
| this call's voxel writes | not seen | not seen |

Both read the simulation as it stands when your script runs (scripts run before the physics step of the same tick).

**Rays.** `origin` and `dir` as for `Raycast` (`dir` non-zero, `max > 0`, finite), else `INVALID`.

* `PhysicsRaycast(origin, dir, max, mask) (PhysicsHit, ok, err)`: `PhysicsHit{Entity, Voxel, Point, Normal, Dist}`. `Entity == 0` means terrain, and `Voxel` is then the cell; for a body, `Voxel` is zero. On equal distance terrain wins, then the lower entity id. The terrain part looks at most 4096 blocks.
* `Physics3DRaycast(...) (RayHit3D, ok, err)`: `RayHit3D{Entity, Terrain, Cell, Point, Normal, Dist}`. `Terrain` is true for a voxel hit (`Entity == 0`); `Cell` is the terrain voxel, or the grid cell of a voxel body.

**Overlaps.** `PhysicsOverlap(min, maxp, mask, max)` and `Physics3DOverlap(...)` test the axis-aligned box `[min, maxp]` and return `bodies []Entity` (ascending entity id, at most `max`), `terrain bool` (a solid voxel overlaps, only when the mask has bit 31) and `total` (all bodies found, may exceed `max`).

* `min <= maxp` on every axis and finite, else `INVALID`. `max <= 0` is treated as 1; `max > 4096` is `INVALID`.
* `PhysicsOverlap` needs a strict overlap (touching faces do not count). `Physics3DOverlap` inflates a flat axis by 0.001 and rejects a box wider than 2048 on any axis (`INVALID`).

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			t, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			const bit31 = uint32(1) << 31
			hit, ok, err := burrowsdk.PhysicsRaycast(t.Pos, [3]float32{0, -1, 0}, 2, bit31|1)
			if err != nil {
				return // UNAVAILABLE: the physics plugin is off
			}
			grounded := ok
			bodies, terrain, total, _ := burrowsdk.PhysicsOverlap(
				[3]float32{t.Pos[0] - 1, t.Pos[1] - 1, t.Pos[2] - 1},
				[3]float32{t.Pos[0] + 1, t.Pos[1] + 1, t.Pos[2] + 1}, bit31|1, 16)
			burrowsdk.Logf("grounded %v on %d, %d bodies near (listed %d), terrain %v", grounded, hit.Entity, total, len(bodies), terrain)
		},
	})
}

func main() {}
```

## Physics components and bodies

Physics bodies are ordinary components, so scripts configure them with `Get`/`Set`, field access and the typed accessors ([entities](04-entities-and-scene.md#components)): `physics.body`, `physics.velocity`, `physics.character` (set its `move` and `jump` intent fields before the physics step), `physics3d.rigidbody`, `physics3d.collider`, `physics3d.voxelbody`, `physics3d.joint`. Fields, ranges and defaults: [reference/components.md](../reference/components.md). Writes follow the usual rule: validated now, applied at commit.

`physics3d` adds direct calls:

| function | what it does | errors |
|---|---|---|
| `Physics3DApplyImpulse(e, impulse)` | adds a momentum impulse (mass x blocks per second) to a dynamic body, applied at the next physics step, wakes it | `UNAVAILABLE`, `NOT_FOUND` (not a dynamic body), `INVALID` (non-finite) |
| `Physics3DBody(e)` | `Body3D` state: `Pos` (centre of mass, world), `Rot` (quaternion x, y, z, w), `Vel` (blocks per second), `AngVel` (radians per second, world frame), `Sleeping`, `Dynamic`, `Kinematic`, `InvMass` | `UNAVAILABLE`, `NOT_FOUND` (no rigid body) |
| `Physics3DRemoveVoxel(e, x, y, z)` | clears one cell of a voxel body (grid coordinates inside the body, not world cells); returns whether the cell held a voxel; disconnected islands split off at the next step | `UNAVAILABLE`, `NOT_FOUND` (no voxel body), `BUDGET` |

These three act on the physics state **immediately**, not through the buffered effect list: a later fault of the same call does not undo them. `Body3D` values are `float32` views of the `float64` simulation. A body writes its node transform every tick it moves, so drive bodies with impulses, velocity or intent and not with `SetTransform`.

## Navigation and AI

Needs `runtime.plugins.nav` and a node with the matching component; otherwise every call is `NOT_FOUND` (the component does not exist). All calls edit the nav components like `Set`: validated now, applied at commit, reads see this call's writes. Concepts and budgets: [navigation and AI](../navigation-ai.md).

| function | needs | what it does | errors |
|---|---|---|---|
| `NavSetGoal(e, goal, slack)` | `nav.agent` | send the agent to the feet voxel `goal` (`NavNode{X, Y, Z}`); `slack` blocks away counts as arrived (0 = the node) | `INVALID` (slack negative or NaN, coordinate beyond +-1,048,575), `NOT_FOUND` |
| `NavStop(e)` | `nav.agent` | clear goal and path, state becomes idle | `NOT_FOUND` |
| `NavGetState(e)` | `nav.agent` | `NavIdle` 0, `NavPending` 1, `NavQueued` 2, `NavMoving` 3, `NavArrived` 4, `NavFailed` 5 | `NOT_FOUND` |
| `NavPath(e)` | `nav.agent` | waypoints still to visit (`[]NavNode`, at most 128) | `NOT_FOUND` |
| `NavSetBB(e, key, v)` | `ai.brain` | number on the behaviour tree blackboard | `INVALID` (NaN or Inf, key over 128 bytes), `LIMIT` (key over 32 bytes or 64 keys already), `NOT_FOUND` |
| `NavGetBB(e, key)` | `ai.brain` | read a blackboard number | `NOT_FOUND` (unset key too) |
| `NavPutBB(e, key, v)` | `ai.brain` | typed blackboard value `BBValue` (`BBNum`, `BBVec`, `BBEnt`, `BBStr` up to 64 bytes) | `INVALID` (bad kind, NaN or Inf), `LIMIT`, `NOT_FOUND` |
| `NavReadBB(e, key)` | `ai.brain` | read a typed blackboard value | `NOT_FOUND` (unset key too) |
| `NavDelBB(e, key)` | `ai.brain` | remove a blackboard key | `NOT_FOUND` |
| `NavSetGoalPos(e, pos, slack)` | `nav.agent` | like `NavSetGoal` with a world position (`NavVec3`, floored to its voxel) | as `NavSetGoal` |
| `NavSensed(e)` | `ai.perception` | nearest remembered target, `0` for none | `NOT_FOUND` |

Timing: `NavSetGoal` does not compute a path in the call. The state goes `Pending` (goal set), `Queued` (request in the deterministic queue), then `Moving` or `Failed` a few ticks later within the plugin's per-tick budget; a `Failed` agent retries after a delay. Calling `NavSetGoal` again within 2 blocks of the current goal while the agent is pending, queued or moving only updates `slack` and keeps the path. Poll `NavGetState` for `NavArrived`.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, err := burrowsdk.NavGetState(self)
			if err != nil {
				return // no nav.agent
			}
			switch st {
			case burrowsdk.NavIdle, burrowsdk.NavArrived, burrowsdk.NavFailed:
				if target, _ := burrowsdk.NavSensed(self); target != 0 {
					if p, err := burrowsdk.GetTransform(target); err == nil {
						_ = burrowsdk.NavSetGoal(self, burrowsdk.NavNode{X: int32(p.Pos[0]), Y: int32(p.Pos[1]), Z: int32(p.Pos[2])}, 1.5)
						_ = burrowsdk.NavSetBB(self, "alert", 1)
					}
				}
			}
		},
	})
}

func main() {}
```

## Levels and saves

Needs the level plugin (`runtime.plugins.levels`) and the save plugin (`runtime.plugins.saves`); without them the calls are `UNAVAILABLE` (the editor's Play mode has no level plugin). Concepts and file formats: [levels and saves](../levels-saves.md).

**Requests.** `LevelLoad`, `SaveSlot`, `LoadSlot` and `DeleteSlot` only queue a request, served by the host between frames (a level switch becomes a journaled command). They return success whatever the host does later, so a script behaves the same live and in a replay; a missing level or slot is not reported to the script. The cost is one event of the budget (`BUDGET`).

| function | what it does | errors |
|---|---|---|
| `LevelLoad(id, spawn)` | switch to level `id` at spawn point `spawn` (`""` = default); id and spawn match `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}` | `INVALID`, `UNAVAILABLE`, `BUDGET` |
| `SaveSlot(slot, label)` | save the game to a slot, served at the start of the next frame, between ticks (with several ticks per frame the snapshot is taken after all of them) | `INVALID`, `UNAVAILABLE` |
| `LoadSlot(slot)` | restore a slot at the same point | `INVALID`, `UNAVAILABLE` |
| `DeleteSlot(slot)` | delete a slot | `INVALID`, `UNAVAILABLE` |

A slot name is `[a-z0-9][a-z0-9_-]{0,47}`; a label is at most 128 bytes.

**Queries of the loaded level** (read-only, no budget beyond the call):

| function | what it does | errors |
|---|---|---|
| `LevelCurrent()` | id of the loaded level, `""` when none | `UNAVAILABLE` |
| `LevelSpawnCount()` | number of spawn points | `NOT_FOUND` (no level loaded), `UNAVAILABLE` |
| `LevelSpawnAt(i)` | `LevelSpawn{Name, Pos, Yaw, Tags}`; `Pos` in **world** blocks | `NOT_FOUND` (bad index or no level) |
| `LevelZoneAt(x, y, z)` | first zone (in file order) containing the **world** point; `ok = false` when none | `NOT_FOUND` (no level) |
| `LevelSettings()` | JSON of the level settings | `NOT_FOUND` (no level) |

`LevelZone{Name, Kind, Min, Max, Target, TargetSpawn, Props}`: `Kind` is `"zone"` or `"trigger"`; `Min` (inclusive) and `Max` (exclusive) are **level-local** blocks, relative to the level's minimum corner, while the query point is in world blocks. A `trigger` zone switches level by itself when an actor stands in it; scripts only read zones. `LevelSettings` keys (each present only when set): `sky`, `weather`, `weather_intensity`, `fog` (`density`, `color`), `gravity`, `kill_y` (level-local Y), `bounds` (`min`, `max`, level-local). The engine itself enforces `kill_y` and `bounds`; the rest is data for your game.

**Dynamic zones.** `ZoneSet(name, min, max, props)` creates or replaces a zone at run time and `ZoneDel(name)` removes it (no error when absent); both apply at commit and return `INVALID` or `UNAVAILABLE` (no level plugin). `min` and `max` are **world** blocks (unlike the level-local zones of the file). Dynamic zones are simulation state: rolled back, hashed and saved with the game, and **cleared on a level switch**. `LevelZoneAt` checks the zones of the loaded level first (file order), then the zones made by scripts.

```go nocheck
burrowsdk.ZoneSet("arena", [3]float32{0, 10, 0}, [3]float32{8, 14, 8}, map[string]string{"team": "red"})
z, ok, _ := burrowsdk.LevelZoneAt(2, 11, 2) // ok, z.Name == "arena"
```

**Game data (save keys).** `SaveSet`, `SaveGet`, `SaveDelete` read and write a key/value store that is part of the simulation state: it is hashed, rolled back and saved with the game.

| function | what it does | errors |
|---|---|---|
| `SaveSet(key, val)` | store a string, applied at commit | `INVALID`, `UNAVAILABLE`, `BUDGET` |
| `SaveGet(key)` | `(val, ok, err)`; `ok = false` when the key is not set; sees this call's own writes | `UNAVAILABLE` |
| `SaveDelete(key)` | remove a key | `INVALID`, `UNAVAILABLE`, `BUDGET` |

Key `[A-Za-z0-9_.:/-]{1,128}`, value at most 64 KiB (bytes, so store JSON or text), at most 1024 keys and 1 MiB of keys and values together. Going over the totals is not an error at the call: the write fails at commit and shows as a non-fatal fault in the console.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			p, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			zone, ok, err := burrowsdk.LevelZoneAt(p.Pos[0], p.Pos[1], p.Pos[2])
			if err != nil || !ok || zone.Name != "checkpoint" {
				return
			}
			if _, seen, _ := burrowsdk.SaveGet("checkpoint.reached"); !seen {
				_ = burrowsdk.SaveSet("checkpoint.reached", "1")
				_ = burrowsdk.SaveSlot("auto", "checkpoint")
			}
		},
	})
}

func main() {}
```

## Block data and block events

With `runtime.plugins.blocks` a script can attach data to a cell that holds a block (the block entity of a machine) and receive the changes of the world. Full guide, scaling figures and an example furnace: [blocks](../blocks.md#block-logic). The block calls are binary where they are hot (a few instructions per cell), because decoding JSON in a guest costs tens of thousands of instructions per cell.

| function | what it does | errors |
|---|---|---|
| `BlockData(x, y, z)` | data of the cell, `ok = false` when it has none; sees this call's writes | `UNAVAILABLE` (plugin off) |
| `SetBlockData(x, y, z, data)` / `SetBlockDataJSON` | store up to 16 KiB; the cell must hold a block (a pending `SetVoxel` counts) | `INVALID` (air), `LIMIT`, `BUDGET`, `UNAVAILABLE` |
| `DeleteBlockData(x, y, z)` | remove it | `BUDGET`, `UNAVAILABLE` |
| `BlockDataIn(min, max, limit)` | cells with data in a box, sorted by x, y, z (committed state) | `INVALID`, `UNAVAILABLE` |
| `BlockDataMany(cells)` | the data of up to 4,096 cells in one host call (binary) | `INVALID`, `LIMIT`, `UNAVAILABLE` |
| `BlockDataApply(ops)` | up to 4,096 set or delete operations in one host call (binary), each counted as a voxel edit | `INVALID`, `LIMIT`, `BUDGET` |
| `BlockSchedule(x, y, z, delay, every)` / `BlockUnschedule` | make a cell a ticking machine delivered to `OnBlockTick` when due | `INVALID` (air), `BUDGET`, `UNAVAILABLE` |
| `BlockFlood(x, y, z, through, ends, max)` | the cable, pipe or belt network connected to a cell, walked natively (up to 60,000 cells) | `INVALID`, `UNAVAILABLE` |
| `OnBlockChange`, `OnBlockSet(name)`, `OnBlockBreak(name)`, `OnBlockUse(name)`, `OnBlockTick(name)`, `OnBlockRandomTick(name)` | handlers for the block events, delivered in batches; random ticks need `"random_tick": true` on the block and `runtime.random_tick_rate` (default 24 per chunk), see [blocks](../blocks.md) | |
| `OnContact(fn)` | contacts and trigger overlaps of the script's own physics3d rigid body, both sides of the pair (`Contact{Kind, Other, Point, Normal}`, kinds `ContactBegin`, `ContactEnd`, `TriggerEnter`, `TriggerExit`); handled the tick after the physics step, in step order, counted in the per-tick event budget. The `physics.character` controller does not produce them | |
| `FluidAmount`, `FluidPour`, `FluidDrain` | read, add and remove water of a cell, in units of `FluidFull` (64) per full cell; they act at once | `INVALID`, `REJECTED` (outside the world), `BUDGET`, `UNAVAILABLE` |

On a micro-voxel brick the events name the micro voxel: `BlockEvent.MicroN` (the brick resolution, 0 for a whole-cell event), `Micro` (`[x, y, z]`) and `MicroBlock`. A use event reports the micro voxel's block in `Block`/`ID` (so `OnBlockUse("mymod:lamp")` fires for a lamp chiselled into a brick) and a micro change goes through `OnBlockBreak(old)` / `OnBlockSet(new)` with the micro blocks (see docs/blocks.md "Micro block events").

The data is bound to the block of the cell: another block there deletes it, and the `OnBlockBreak` / `OnBlockChange` event carries what was lost. Writes follow the same commit rules as `SetVoxel` (at commit, in order, dropped by a fault); a block write budget of 4096 edits per call counts data writes too.

## Project data and registries

`ReadAsset(path)` returns the bytes of a project data file; `ReadAssetJSON` (generic over the target type `T`, same path rules) decodes JSON into `T` (a decoding failure is a plain `error`). Items, recipes and balance tables belong here: the engine has no item registry.

Rules:

* `path` is project-relative with `/` separators, at most 512 bytes: no `..`, no absolute path, no backslash, no segment starting with `.`, not `vox.project`. A violation is `DENIED`.
* Extension one of `.json .txt .csv .tsv .md .toml .yaml .yml .dat`, else `DENIED`.
* The file must be known to the project's asset database (`NOT_FOUND` otherwise, also when the host has no database) and at most 256 KiB (`LIMIT`).
* At most 16 files are read from disk per script call (`BUDGET`). Gas: 200 + 1 per 64 bytes.
* **Frozen and pinned.** Data files are not simulation state, so replays stay exact like this: the first content a session sees for a path is frozen, and every script remembers the hash of each file it read (up to 64 files, `LIMIT` after that; part of its hashed state). Re-reading a file you already read is served from that frozen copy and does not use one of the 16 disk reads. Editing a data file while the game runs does not change what scripts see; restoring or replaying against a different file fails the tick with an error that names the file.
* Read in `OnStart` and keep what you need in `State`, since a Go script parses JSON slowly.

| function | what it does | errors |
|---|---|---|
| `Registry("components")` | scene schema component names | `UNAVAILABLE` |
| `Registry("assets")` | readable data files (extension rule above), sorted, at most 4096, frozen per session | `NOT_FOUND` (no database) |
| `Registry("blocks")` | block names, index = id | see [block registry](#block-registry) |

```go
package main

import "burrow-engine/sdk/burrowsdk"

type item struct {
	Name   string  `json:"name"`
	Weight float64 `json:"weight"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			items, err := burrowsdk.ReadAssetJSON[map[string]item]("data/items.json")
			if err != nil {
				burrowsdk.Logf("items: %v", err)
				return
			}
			if id, err := burrowsdk.BlockByName("stone"); err == nil {
				info, _ := burrowsdk.BlockInfo(id)
				burrowsdk.Logf("%d items, stone is block %d (solid %v)", len(items), id, info.Solid)
			}
			files, _ := burrowsdk.Registry("assets")
			burrowsdk.Logf("%d readable data files", len(files))
		},
	})
}

func main() {}
```

## See also

* [Entities and scene](04-entities-and-scene.md): components and transforms that bodies and agents use.
* [Input, events and time](06-input-events-time.md): timers and events for AI and level logic.
* [Execution model](02-execution-model.md): commit order and what a fault drops.
* [Errors and limits](09-errors-and-limits.md): budgets and error codes.
* [Effects](07-effects.md): audio, particles and cameras that react to world events.
* [physics](../physics.md), [character](../character.md), [navigation and AI](../navigation-ai.md), [levels and saves](../levels-saves.md), [blocks](../blocks.md), [lighting](../lighting.md).
