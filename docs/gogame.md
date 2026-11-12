# Go game (package gogame)

A project's game logic can be a plain Go `main` package that imports `burrow-engine/gogame`. The project folder still
holds the scenes, prefabs, input map and assets (`vox.project`); only the logic moves from WebAssembly scripts to your
own Go code, with full access to the engine.

## Go game or WASM scripts?

| | Go game (`gogame`) | WASM scripts (`script`) |
|---|---|---|
| Trust | trusted, native code | sandboxed, gas-metered |
| Delivery | one Go binary next to the project | `.wasm` modules inside the project / pak |
| Engine access | everything (`Ctx.App()`, any Go package) | host functions only, JSON features |
| State | package variables persist | memory reset on every call; state lives in components |
| Editor | `burrow edit` shows scenes, but the logic is not hot reloaded | hot reload, debugger, script panel |
| Mods / untrusted content | no | yes |

Pick the Go game for your own game with an AI agent or a Go programmer at the keyboard. Pick WASM scripts for mods,
user-made content and anything that must run in the editor with hot reload.

## Quick start

```
burrow new mygame --template gogame
cd mygame
go run .                  # window
go run . -headless 100    # 100 ticks, one JSON line {"ok":true,"ticks":100,"hash":"...","error":""}
```

`vox.project` keeps `"scripts": []`. No scripting plugin is needed: the journaled input snapshot behind `Ctx.Action` comes from
`input/inputsnap` (older projects that still enable `plugins.scripts` keep working; the script plugin then produces the same snapshot). Flags of `gogame.Main`: `-dir`, `-scene`, `-headless N`, `-saves`.

```go nocheck
func main() {
    gogame.Main(gogame.Game{
        OnStart: func(c *gogame.Ctx) error { return nil },
        OnTick:  func(c *gogame.Ctx) { if c.ActionPressed("stamp") { c.SetVoxel(1, 9, 1, "wood") } },
        OnFrame: func(f *gogame.Frame) {},
        UI:      func(ui *imui.UI) { ui.Label("hello") },
    })
}
```

`examples/gogame_demo` scaffolds the template and runs it. `gogame.RunHeadless(game, gogame.Options{Headless: n})`
returns the `Result` (with `StateHash` and the finished `App`) for tests.

## Determinism

`OnStart` and `OnTick` run inside the fixed step (20 Hz) after the engine's own fixed systems. Their changes are part of
the simulation state, so a run replays to the same StateHash when your code is deterministic: use `Ctx.Rand` (never
`math/rand` globals), no wall clock, no map-order dependence, no reads of data outside the simulation. Package variables
persist but are not saved or rolled back. `OnFrame` and `UI` are per rendered frame and cosmetic. A failing call
(unknown block, bad component JSON) is returned as the tick's error and stops the run.

## Ctx reference

Writes take effect at once inside the tick.

| Method | Meaning |
|---|---|
| `App() *engine.App`, `Fixed() *engine.FixedContext` | escape hatches to the engine |
| `Tick() uint64`, `Dt() float32` | tick index, tick length (1/20 s) |
| `Rand() *rand.Rand` | deterministic random source |
| `Log(format, args...)` | line on stderr tagged with the tick |
| `Action(name) bool`, `ActionPressed(name) bool` | button held / went down this tick (input map action) |
| `Axis(name) float32`, `Axis2(name) (x, y)` | axis value (sticks, composites, mouse delta, wheel) |
| `Find(name) (Entity, bool)`, `FindByTag(tag) []Entity`, `Player()` | node lookup (name, or slash path with "/") |
| `Pos/SetPos`, `Transform/SetTransform` | local transform of a node |
| `Spawn(prefabPath, pos) (Entity, error)`, `Despawn(e)` | prefab instances |
| `Get(e, component, &out) bool`, `Set(e, component, v) error` | component JSON access |
| `Voxel(x,y,z) string`, `SetVoxel(x,y,z, block) error` | blocks by name ("air" clears) |
| `SetVoxels([]VoxelEdit{X,Y,Z,Block}) error`, `FillVoxels(lo, hi [3]int, block) error` | batches: up to 65536 edits, or a box of up to 1 048 576 cells; all or nothing (an unknown block writes nothing) |
| `Raycast(origin, dir, maxDist) (Hit, bool)` | solid-voxel ray |
| `LoadScene(path) error` | instantiate a `.voxscn` additively |
| `UISet(key, v)`, `UIShow(screen)`, `UIHide(screen)`, `UIEvents()` | bridge to the declarative game UI (needs `plugins.gameui`) |
| `UIClicked(name) bool`, `UIValue(name) (float64, bool)`, `UIEmitted() []UIEvent` | signals the imui code sent with `ui.Emit` since the previous tick (journaled) |
| `BlockInfo(name)`, `VoxelInfo(x,y,z)`, `BlockNames()` | block properties (solid, opaque, liquid, emit, colour) by name or by cell |
| `Light(x,y,z) Light{R,G,B,Sky}` | light of a cell, 0..15 per channel; derived data, never in the StateHash |
| `ParticleBurst(emitter, asset, ParticleOpts)`, `ParticleBlockBreak(emitter, block, offset)` | one-shot effects from a node (frame domain) |
| `Frame.PlaySound(emitter, sound, SoundOpts)` | the client-side twin of `PlaySound`: a network client plays a sound the server asked for (frame domain, never journaled) |
| `Frame.Context()` → `engine.RenderSettings.MoonPhases`, `MoonPhase` | the moon's phase in the sky (render only, frame domain; not replicated: every machine computes it from its clock). `MoonPhase` is the lunar age as a fraction of the cycle (0 new, 0.5 full); with an 8 day cycle whose day 4 is full: `rs.MoonPhases, rs.MoonPhase = true, float32(day%8)/8 + timeOfDay/8`. The moonlight follows `scene.MoonLight(age)` (docs/rendering.md) |
| `Frame.SetMusicContext(ctx)` | a network client takes the music context its server decides (`audio.music` is not replicated); `""` = automatic |
| `CameraShake(amount)`, `CameraCut()`, `CameraSwitch(rig, blend)` | camera requests (frame domain) |
| `UISetItems(key, []UIItem)` | rows of a declarative UI list or grid |
| `SaveSet/SaveGet/SaveDelete(key)`, `SaveSlot(SlotSave\|SlotLoad\|SlotDelete, slot, label)` | the save store (needs `plugins.saves`); slots are served at the start of the next tick |
| `SpawnPrefab(path, SpawnOpts{Name, Parent, Transform, Components})` | a prefab with a root name, a parent, a placement (scale multiplies the prefab root's) and extra components; `Spawn(path, pos)` keeps the root's rotation and scale |
| `Tolerate(func())` | run calls whose failure must not end the run (a missing prefab, a node already gone); they still return their error |
| `SpawnNode(SpawnOpts{Name, Parent, Transform, Components})` | a bare node (no prefab) with components; an empty name gets a free generated one |
| `Patch(e, component, patch)`, `RemoveComponent(e, component)` | merge patch (RFC 7386) into a component, remove a component |
| `PlaySound(emitter, sound, SoundOpts) (SoundHandle, error)`, `StopSound(h, fade)`, `SetSound(h, volume, pitch)`, `SetBusVolume(bus, v)`, `StopAllSounds(bus)`, `SetListener(node)` | sounds come from a node placed in the scene; handles are derived from emitter, tick and order, so replays make the same ones; silent without the audio plugin |
| `RaycastBodies(origin, dir, max, mask)`, `OverlapBox(lo, hi, mask)`, `ApplyImpulse(node, impulse)` | rigid bodies and terrain (needs `plugins.physics3d`). A body must have a layer bit (`rigidbody.layer`) that the query mask includes, or it is invisible to queries; mask 0 = every layer |
| `LoadLevel(id, spawn)`, `CurrentLevel()`, `LevelSpawns()`, `LevelZoneAt(x, y, z)`, `LevelSettings()` | hand-built levels (needs `plugins.levels`). `LoadLevel` is a request: the file is read in the background and applied by a journaled command when ready, so the level changes a few frames later, not in the same tick. Positions are in world blocks |
| `BlockData(x,y,z)`, `SetBlockData`, `DeleteBlockData`, `ScheduleBlock(x,y,z, delay, every)`, `UnscheduleBlock`, `DueBlocks()` | a string bound to a cell (fuel of a furnace, content of a chest) and cells delivered on a schedule (needs `plugins.blocks`). The data belongs to the block the cell holds when written and is hashed and saved with the world; `DueBlocks` returns the cells due this tick, once, in due-tick then position order. Block change/break/use events are not delivered to Go games yet |
| `PlayAnim(node, clip, AnimOpts{Mode, Queue, Fade})`, `StopAnim`, `SetAnimSpeed`, `SetAnimParam`, `TriggerAnim`, `AnimTime` | the node's `anim.player` (simulation state, journaled). `Queue` waits behind a playing clip; `Fade > 0` crossfades and keeps the queue, `Fade == 0` cuts and clears it. An unknown clip name plays nothing |
| `NavGoal(node, x, y, z, slack)`, `NavStop`, `NavState`, `NavPath`, `SetBlackboard`, `Blackboard`, `DeleteBlackboard`, `NavSensed` | navigation and AI of a node (`nav.agent`, `ai.brain`, `ai.perception`; plugin `nav`). A goal is a journaled component write; the path is computed inside later ticks from a queue with a budget, so the node starts moving a few ticks after `NavGoal`. The blackboard holds numbers here (the typed values of the WebAssembly call are not exposed). A flying creature is a node with `nav.agent` `{"profile":"flyer","face":true}` and no `physics.character` (no gravity; idle, it hovers in place); `NavGoal` takes a cell in the air, and the blackboard number `fly_alt` (metres above the ground) is the cruising height the built-in `wander`, `flee` and `hover` actions keep (docs/navigation-ai.md) |
| `Weather(x, y, z)`, `WeatherFront`, `SetWeather` | the weather of a place (`weather.Local`: kind, rain or snow and intensity, temperature, `Lightning`...), the global front, a journaled `weather_set`. A project climate installed with `weather.SetClimate` on every machine gives the places their temperature and humidity; when it also implements `weather.LocalWeather` (`WeatherOverride(seed, x, y, z, clock) (kind, intensity, ok)`), `Weather` and the rendering at the camera take the place's own weather from it (a rite's disk of rain under a clear front, a clearing in a storm; docs/weather.md). Neither the state nor its hash depend on it: feed it from replicated game state |
| `Parent(node)`, `ScenePath(node)`, `FindWith(component, root)` | scene tree reads; `FindWith` scans depth first (root 0 = whole scene, at most 65,536 nodes) and fails the run for an unknown component |
| `Field(node, component, path)`, `FieldNum`, `SetField(node, component, path, v)` | one field of a component by path (`pos[0]`, `bodies[2].mass`); writes send the whole component back through the schema, so it is validated like `Set` |
| `BlockEvents()` | block events since the last call (a cell changed, or a player used a block); the first call turns collection on, so call it in the first tick. Needs `plugins.blocks`; fluids do not produce events |
| `FloodBlocks(x,y,z, through, ends, max)` | the network of conductor cells connected to a start cell (cables, pipes), breadth first in a fixed order; needs no plugin |
| `SetLevelZone(name, min, max, props)`, `DeleteLevelZone(name)` | zones made by the game in world blocks (simulation state, cleared by a level load); `LevelZoneAt` finds them after the level's own |
| `ParticleEmit(node, count)`, `ParticleStop(node)` | extra particles from a node's emitter; stop one emitter (0 = clear all) |
| `FluidAmount`, `FluidPour`, `FluidDrain` (`FluidUnitsPerBlock` = 64) | water volume of a cell (needs `plugins.fluid`); the water then flows by the automaton's rules |
| `SetBlackboardValue`, `BlackboardValue` (`BBNum`, `BBVec`, `BBNode`, `BBStr`) | typed blackboard values |
| `SwitchScene(path)` | replace the whole running scene (nodes and voxel world) by another `.voxscn` of the project; served at the end of the tick, one per tick |
| `WorldInfo() (WorldInfo, bool)` | slot, name, free-text mode, seed, generator of the world the game was started on |
| `Light.Level(skyDim)` | the one brightness a rule such as "mobs spawn in the dark" reads |
| `Tags(e)`, `HasTag`, `AddTag`, `RemoveTag`, `Children(e)`, `Has(e, component)` | scene tree helpers |
| `State(key, &v)`, `SetState(key, v)`, `StateOf[T](c, key)`, `StateBytes/SetStateBytes/DeleteState` | the game state, see below |

`Frame` (OnFrame): `Dt`, `Frame`, `Tick`, `Alpha` (0..1 between ticks), `Find(name)`, `VisualSet/VisualAdd(node, target, v)` (render-only overlay, targets of `visual.bind`; write it every frame), `Key(name)`, `FreeCursor()`, `Quit()`, `Context()`. While the immediate-mode UI
holds the mouse, mouse-button actions read as false in `Ctx.Action` (the flag is journaled, so replays agree).

## Game state

Package variables are not saved or rolled back, so a game keeps its rules (inventory, timers, quests, health, hunger) in
`Ctx.State`: named values stored in one simulation component. They are hashed, snapshotted, saved, rolled back and replayed
with the world, with no node and no script. Values are JSON (`SetState`/`State`/`StateOf`) or raw bytes
(`SetStateBytes`/`StateBytes`, for a binary format of your own). Limits: 256 keys, 1 MiB per key, 4 MiB in all; unchanged writes cost
nothing. Use structs, not maps, in JSON you hash. The engine gives the state no meaning: health, death and respawn are
rules of the game, written in `OnTick`.

Multiplayer note: the whole state is one component value, and a server sends a component value only when its JSON is at most
64 KiB (`wire.MaxCompData`; bytes are base64, so about 48 KiB of blobs). A game whose state is larger works the same in
solo and on the authoritative side, but its state is not mirrored to remote clients; keep what a client must read small.

```go nocheck
type Vitals struct{ HP, Food int }

OnTick: func(c *gogame.Ctx) {
    v := gogame.StateOf[Vitals](c, "vitals")
    if c.ActionPressed("eat") { v.Food++ }
    _ = c.SetState("vitals", v)
}
```

## Network games

A Go game can run as a **dedicated server** and be played from the game's own window. There is no listen server: nobody hosts from a window.

```sh
./game -init-server ./srv        # writes srv/server.json and the TLS certificate (Game.Dir is the project)
./game -serve ./srv              # prints "join link: burrow://host:7777?fp=...&key=..."
./game -connect "burrow://..." -name ana
```

`Game.NetScene` is the scene the server runs and the clients follow. The server alone runs `OnTick`; a client runs only frame systems (`OnFrame`, `UI`) on the replicated copy, and a dedicated server runs neither. So:

* Loop over `c.Players()` in `OnTick` (one player, id 0, when the game is played alone), read a player's input with `c.ActionOf(p, name)` (in a session an action is a button bit: `move` gives the axes, the scroll wheel reaches the server in one direction only; at most 30 bit actions), and keep per-player data in `c.SetPlayerBytes(p.ID, key, b)`.
* Per-player data is replicated to its owner only (component `gogame.pdata`, tag `owner:<id>`, at most 64 KiB of JSON per player in all) and saved with the world. A client reads its own with `Frame.PlayerBytes(key)`.
* What a player must see (HUD values, lists, screens) is written by `OnTick` into the player's data and played by `OnFrame` with `Frame.UISet`, `UISetItems`, `UIShow`, `UIHide`, `CameraShake`, `CameraCut`, `ParticleBurst`, `PlaySound`, `SetMusicContext`.
* `UIEvents()` events carry `Player`: the server stamps the sender on every `gameui_event`.
* The world seed pins the handshake: the client's `-seed` (default the project's) must match the server's.

## Terrain: `Game.Generator`

`runtime.generator` in `vox.project` picks one of the engine terrains (`biomes`, `heightmap`, `flat`, `empty`). To add features of
your own (ores that are not in the engine, ruins, a village) or to replace the terrain, set `Game.Generator`: a function that
receives the generator the project describes and returns the one the world uses.

```go nocheck
gogame.Main(gogame.Game{
    Generator: func(base worldgen.Generator) worldgen.Generator {
        return &worldgen.Decorated{
            Base: base,
            ID:   "mygame-ores/v1", // bump it when Decorate changes what it generates
            Decorate: func(ctx worldgen.DecorateCtx, c *voxel.Chunk) {
                tin, ok := ctx.Reg.ID("tin_ore") // resolve names here, on the first chunk, not earlier
                if !ok { return }
                // write only voxels of this chunk, from a hash of (ctx.Seed, ctx.Pos)
                c.Set(5, 12, 5, tin)
            },
        }
    },
    // ...
})
```

`worldgen.Decorated` keeps what the base terrain offers (chunk layers, registry binding, far-terrain sampling, the biome tint)
and adds `DecorateCtx.Surface(x, z)`, the base terrain height in a column, for placing something on the ground from every chunk it
overlaps. Rules: the generator is a pure function of `(seed, chunk position)`, safe for concurrent use, with no clock, global state
or other random source; a feature wider than a chunk is computed by each chunk it overlaps, from a position hash, and each writes
only its own voxels. `ID` (and `ChangesSilhouette`, true for a feature that changes the ground seen from afar) are part of the
world identity: change the ID whenever the decoration changes, because a saved world would otherwise mix two versions.
A generator of your own works too: implement `Generate(seed, chunkPos) *voxel.Chunk`, `WorldID() string` and, to receive the
registry, `WithRegistry(*voxel.Registry) worldgen.Generator`. `base` is nil when the project has no `runtime.generator` section.

## imui reference (`burrow-engine/gameui/imui`)

Immediate-mode UI drawn on a `render/canvas.Canvas`: call widgets every frame, get their result back at once. `gogame`
runs it for you after the declarative game UI; for other hosts call `Begin` and `End` yourself.

| API | Meaning |
|---|---|
| `New(theme *gameui.Theme) *UI` | nil theme = "dark" |
| `Begin(cv, in Input, w, h)`, `End()` | frame bracket; `Input{MouseX, MouseY, Down, Pressed, Released, Text, Backspace, Enter, Escape}` |
| `Window(title, fn)` | centered, dimmed backdrop, sized to content (a first-frame measure pass runs the body once, idle) |
| `Panel(id, rect, fn)` | fixed screen rectangle; captures the mouse |
| `Row(fn)`, `Column(fn)`, `Spacer(px)` | layout; the default flow is a column |
| `Label(text)`, `Image(path, w, h)`, `ProgressBar(frac)` | display (`UI.LoadImage` resolves image paths; gogame wires the project files) |
| `Button(label) bool`, `ButtonID(id, label) bool` | true on click (press and release on it) |
| `Checkbox(label, *bool) bool`, `Slider(label, *float32, min, max) bool`, `TextInput(id, *string) bool` | true when the value changed |
| `Captures() bool`, `Open() bool` | mouse over the UI / a Window is shown (gogame frees the cursor then) |
| `Emit(name, value)` | send a signal to `OnTick` (journaled, next tick): the only way UI code should change the game |

Widget identity is the label (or id) plus its place in the container; use `ButtonID` when labels repeat or change.
