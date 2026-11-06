# Water physics

Water flows, pushes and carries. Three layers, each deterministic and cheap when nothing moves:

| layer | package | domain | what it does |
|---|---|---|---|
| flow | `fluid` | simulation (20 Hz) | cellular automaton on the voxel grid: sources, levels, fall, spread, drain, lava |
| interaction | `physics`, `app` | simulation / frame | immersion, Archimedes' push, drag, currents, swimming, climbing out |
| data for rendering | `voxel`, `mesh` | read only | surface height of a water cell, smooth corner heights, flow direction |

Rendering itself (refraction, foam, caustics, underwater fog) is a separate stage and is not part of this page; it reads the
data listed in [For the renderer](#for-the-renderer).

This page describes the **coarse** automaton (blocks `water`, `water_1..7`), kept for `runtime.plugins.fine_water: false`. The
**fine water** (the default of the `fluid` plugin, `fluid.Config.Fine`) replaces it with a
conserved volume in sub-cell bricks where water moves: see [water-fine.md](water-fine.md).

## Data model: levels are blocks

The water of the world **is voxels**. There is no side table of "water levels":

| block | meaning |
|---|---|
| `water` | source: a full cell, never changes by itself (the worldgen sea is made of sources) |
| `water_7` ... `water_1` | flowing water, height `level/8` of the cell (7 = highest) |

`fluid.Install` (called by `fluid.Plugin`) registers `water_1` .. `water_7` after the terrain blocks (`voxel.Block.Liquid` = level;
a block of `Fluid` kind water without `Liquid` is level 8; the name never matters: a custom block with `"fluid": "water"` flows). Ids are appended, so existing ids, worlds and `.voxworld` files stay valid (a file that
lists fewer blocks than the registry loads).

Why blocks and not metadata or a sidecar:

* **Overlay and `StateHash`.** Flowing water is written like any edit: it lives in the sparse overlay, in `Chunk.Hash`, in
  snapshots, `.voxworld`, undo and the editor's `DocHash`, with no new storage and no new serialization. A sidecar would need its
  own hash, snapshot, undo and world-file story, and could disagree with the voxels.
* **Pure base.** The sea stays a field of sources in the base terrain. It never moves by itself; only cells next to an edit (the
  overlay) are ever evaluated. Digging next to the sea clones the base chunk into the overlay like any edit.
* **Rendering and tools** see ordinary blocks: the mesher merges per block id, palettes and the `place` tool work unchanged.
* **Cost**: 8 ids instead of a per-voxel byte. A chunk with water has a palette of at most 9 water entries.

The only extra state is the **work list** (`fluid.State`, a `sim.Extra` named `fluid`): the cells that may be unstable plus the
wake-ups not merged yet. It is *derived* from the voxels (a cell that is not in it is stable; `TestWorkListIsDerivable` rebuilds
it by sweeping the overlay and reaches the same settled world), so:

* it is serialized in `Snapshot` (a restore taken in the middle of a flow resumes exactly), rolled back with a failed tick,
* it is **not** in `StateHash`: "place a source then undo" leaves the same hash as before, and a world without moving water has
  the same hash with or without the plugin. Only a non-default `fluid.Config` and the count of shed cells are hashed.

## Rules (one automaton step)

A step runs every `Interval` ticks (default 5: water advances 4 cells per second). Each candidate cell is evaluated against the
unchanged world (two phases, so order cannot matter), then the changes are applied in canonical order.

* Solid cells, bounds and sources never change. A free cell is air, flowing water, a **fragile** block, or lava.
* **Fall.** Water directly above makes the cell falling water (`water_7`).
* **Spread.** Otherwise the cell takes the highest `spread` of its four side neighbours: a source spreads 7, a falling cell 7, a
  flowing cell of level `k` spreads `k-1`. A flowing or falling cell only spreads sideways when it rests on a solid block
  (otherwise it falls); a source always does. Range from a source: 7 cells.
* **Infinite sources.** A free cell with two side neighbours that are sources, over a solid or source block, becomes a source
  (`Config.NoInfiniteSources` turns this off).
* **Drain.** Unfed flowing water becomes air; a puddle recedes one cell per step from its edge.
* **Fragile blocks.** `voxel.Block.Fragile` (non-solid: plants, torches) are replaced by flowing water. No default block is
  fragile. Other non-solid blocks (a pane, a sign) block the flow like walls.
* **Lava.** A block of `Fluid` kind lava reached by water becomes the block named by `Config.CoolSource` (default `obsidian`), flowing lava
  `CoolFlow` (`cobblestone`), water met by lava `CoolWater` (`stone`); a name that is not a registered solid block means no conversion and
  lava simply blocks water. Without `Config.Lava` lava does not flow itself (see "Flowing lava").
* **Bounds.** `Config.Min/Max` (default `x,z` +-2^20, `y` -128..512) delimit the world the automaton may touch. Outside is the
  void: never written and not solid, so a stream at the edge falls out of the world.
* **Streaming and the void.** The simulation world is total (pure base terrain plus overlay): there is no "unloaded chunk" in the
  sim, and streaming never changes results, so water flows into terrain that is not meshed yet exactly as into meshed terrain.
  What is bounded is the **work** (below) and the **box** (above).

## Waking: no dedicated command needed

A `voxel.Observer` on the chunk map reports every effective voxel write and every `SetChunk`. A written voxel wakes 15 cells (the
cell and the cells whose result depends on it). So placing or removing a source, breaking a dam, `undo`, scripts, `fill_box`
and the automaton's own writes all start the flow. `fluid_wake {min,max}` queues a scan of the chunks of a box (use it for a
world saved mid-flow; world loads already queue their chunks).

Writes may arrive in any order (a command looping over a Go map): nothing depends on it. Below 8192 queued writes the cells are a
multiset consumed sorted; at the first write past it the queue becomes the sorted set of the chunks of **all** the writes (later
writes add their chunk), so the outcome is the union of the chunks whatever the arrival order. A chunk scan covers a chunk that
holds water or touches (6 neighbours, base terrain included) a chunk that does. More than 4096 distinct queued chunks start a
**sweep** of the overlay chunks (128 examined per step); the cell wake-ups are kept, and a chunk the cursor has not reached is
covered by the sweep itself. `SetChunk` (world load, agent history) queues a chunk only if it, its predecessor or a neighbour holds
water.

## Cost and denial of service

Per step, `Config` bounds the work:

| cap | default | meaning |
|---|---|---|
| `MaxUpdates` | 2048 | cells changed; an ocean breach or a dam failure spreads over many steps |
| `MaxActive` | 262144 | unstable cells waiting for `MaxUpdates` room (3 MiB); beyond it the highest cells are shed and counted (`Dropped`, hashed) |
| `ChunkScans` | 2 | whole-chunk scans per step (32768 evaluations each) |

Every step evaluates all candidates (the work list plus 15 cells per queued write, at most 15 x 8192 in a burst; the threshold was 65536 before the fine-water stage, when one burst of scattered writes could cost a 257 ms step, now 30 ms at worst), so stale wake-ups cost time but never a budget and the future depends only on the voxels. Lower cells are served first, so a falling stream is not starved by its sides. Idle cost is a branch (12.9 us per tick including
`Step` overhead). Measured on an M2 Max (`go test ./fluid -bench . -run X`, `TestOceanCostBounded`):

* sea of 66k source cells with its east wall removed: 82 steps, 28520 cells changed, at most 1132 per step, work list peak 95k cells
  (1.1 MiB), 0.12 ms per tick on average, worst tick 12 ms (the first merge of 65k wake-ups);
* a one-column breach in a 29x5x59 reservoir with `MaxUpdates` 64: never more than 64 changes per step.

Memory growth is bounded by the caps, the 8192-entry wake queue, the 4096-entry chunk queue and the world box. A flood can
still create overlay chunks as far as water can legitimately reach (range 7 from a source, unbounded only through infinite
sources filling a basin that is open to a source).

## Determinism contract

Same seed, same journal, same config: same `StateHash`. Everything in `fluid` is integer arithmetic over sorted slices; no map
iteration, no float, no goroutine. Tests (`go test ./fluid ./physics ./editor/core`): two runs, journal replay, snapshot/restore in
the middle of a flow (and into the same engine, which re-attaches the observer), rollback of a failed tick, write-order
independence, queue overflow, dam break and ocean bounds, 6 fuzz seeds, derivability of the work list,
`engine.VerifyCacheNeutrality` with water and bodies.

## Interaction (physics)

`physics.PhysicsPlugin` reads liquids from the registry (`voxel.LiquidTable`); a world without liquid blocks pays nothing and
`physics.Config.Water.Off` ignores them. Tuning: `physics.WaterConfig`.

* **Immersion** (`LiquidTable.Sample`): the exact volume of the box under the liquid surfaces it overlaps, a fraction 0..1, plus
  the volume-weighted current. `Query.Immersion(entity)` and `Query.WaterAt(box)` expose it to frame and fixed code.
* **Dynamic bodies**: Archimedes' push `Density * submergedVolume / mass` against the scaled gravity (a body floats when its
  density `Mass / (8 hx hy hz)` is below `WaterConfig.Density`, default 1), and drag toward the current speed
  (`FlowSpeed` * flow direction, default 1.6 m/s). Semi-implicit drag: a floating body settles instead of ringing
  (`TestBodyFloatsAndSettles`: bobbing under 5 mm).
* **Characters** (`physics.MoveCharacterWater`, used by `physics.character`): gravity is reduced by `CharBuoyancy` (an idle swimmer
  floats with the head just out), vertical speed is damped, the walking intent is scaled to `SwimFactor` and pushed by the
  current. From 30% immersion the character swims: `Jump` or `Move.Y > 0` swims up, `Move.Y < 0` dives; jumping from a pool floor
  is a swim up. With the head out of the water, pushing against a ledge up to one block above the surface climbs onto it.
* **State and API.** `CharacterController.Submerged` (fraction) and `HeadUnder` are written each tick (hashed only when non-zero, so
  dry scenes keep their hashes); `InWater()` and `HeadUnderWater()` read them. `app.Controller` (the sandbox walker) has the same
  model with `InWater()` / `HeadUnderWater()` and `FrameState.InWater` / `HeadUnder` for the HUD and an underwater view.
* **Input.** No new action: the default `jump` action swims up and the crouch / `fly_down` key dives (`KeyDown` in the sandbox).
* **Scripts.** `fluid_amount`, `fluid_pour` and `fluid_drain` (module `vox`, ABI 1: additive imports) expose the same volume a
  pump needs: `fluid.UnitsPerBlock` = 64 units per full cell (`FluidFull` in the SDK), a source counts 64, a coarse flowing level 8,
  and a fine pour adds sub-cell units (rounded down to the script's unit). They return `UNAVAILABLE` without the automaton and
  `INVALID` outside the world or for 0 or more than 64 units. They act **at once**, like the `physics3d` calls: the returned amount
  is exact, a later fault of the same call does not undo the water, and `fluid_amount` sees the result; the water then flows by the
  rules above. A fine pour is entered in the `Ledger` (`Created`) and a fine drain in `Displaced`, so the conservation invariant
  still holds. A script also reads names (`water`, `water_1`..`water_7`) with `voxel_get` + `block_id_by_name`, a character's
  `physics.character` component with `entity_get_component` (`submerged`, `head_under`), and swims by setting the intent (`move`,
  `jump`) like walking. Machine examples (a pump and a tank): [blocks](blocks.md#water).

## Editor and agents

* The editor installs the fluid plugin by default (`core.Config.NoFluids` removes it). Placing water is the normal `place` /
  `box` tool with block `water`: one undo step, journaled, replayable; undo removes the source and the flow recedes when the
  simulation ticks.
* **Edit mode never lets water move**: the simulation only ticks in Play (and `editor_step`, which is refused in edit mode).
  `Stop` restores the snapshot taken at Play, flowing water included, bit for bit.
* `editor_water {pos}` (read only): block, `level` (0 none, 1..7 flowing, 8 source), `height`, `falling`, `flow` (unit vector) and the
  automaton state (`idle`, `active_cells`, `pending_wakeups`, `dropped`).
* burrowd sessions (`vox_act` / `vox_step`) have the automaton too: `set_block` / `fill_box` with `water`, then step. `fluid_wake` is a
  normal command kind. `vox.project` `runtime.plugins.fluid` (default off) controls `burrowplay`.

## For the renderer

Read-only, pure functions of the voxels and the registry (no state):

```text
mesh.NewLiquidTable(reg)                       -> table (rebuild after registering blocks)
mesh.LiquidHeight(t, r, p)        float32      surface height inside the cell, 0..1 (1 when water is above)
mesh.LiquidCornerHeights(t, r, p) [4]float32   top corners (-x-z, +x-z, +x+z, -x+z), smooth across cells
mesh.LiquidFlow(t, r, p)          mathx.Vec3   unit push direction (Y < 0 when falling), for ripples and foam
```

Block names `water_1`..`water_7` alias the `water` texture and tint in `assets/blocktex`; `Vertex.Block` of a quad tells the level.
The mesher itself is unchanged (a flowing cell still meshes as a full unit cube; sloping its top face is the renderer's job).

## Limits

* No pathfinding toward holes (Minecraft spreads toward the nearest drop); no waterlogged blocks; no evaporation by weather or
  rain inflow (the weather module exposes `RainSupply` and `Phase`, nothing consumes them yet); lava flows only with `Config.Lava` (see "Flowing lava").
* Water is a stepped automaton at 4 cells/s: no momentum, no pressure, no waves; levels are 1/8 cell.
* A flowing cell takes the full cell for collision purposes except its surface height; characters are pushed by the average
  flow, not per-face.
* Past the caps the oldest-cell guarantee is lost: shed cells (`Dropped` > 0) freeze until a neighbour changes or `fluid_wake`.
* The rolling back of a caller-owned `voxel` undo recording (`BeginUndo` outside the engine) restores chunks without telling the
  automaton; engine commands, the editor and `Restore` are covered.
* **Compatibility.** The plugin appends `water_1`..`water_7` to the registry and adds an extra state, so a snapshot saved before it (a
  `burrowctl` `state.snap`, an editor Play snapshot kept on disk) no longer restores into an engine that has it; `Restore` says so
  ("a snapshot saved before an optional module such as the water flow ... cannot be restored") and the fix is to save a new one.
  `.voxworld` files and journals of the plain world still load (the registry prefix is accepted). A journal in which a character
  enters water replays to another hash than before this stage (it now swims); dry journals are unchanged.

## Voxel size (coarse water)

The coarse automaton works in units of 1/`Scale` level (`fluid.Blocks.Scale` = the world's `Subdiv` at install time):
flowing water loses one unit per cell, so it spreads the same 7 m at every voxel size, and the step runs `Scale` passes
(one cell of front each) per `Interval`, so the front keeps its metres per second. Each level 1..7 (the visual height,
`Block.Liquid`) has `Scale` phase blocks: `water_L` is the full phase, `water_L_p` (p = 1..Scale-1) the thinner ones, so
the blocks of a finer world are the 28/56 flowing blocks of `Subdiv` 4/8. Scale 1 registers and behaves exactly as before
(a world that never leaves one metre voxels never registers a phase block). The fine water has its own section in
[water-fine.md](water-fine.md#voxel-size).

**The scale follows the voxel size at runtime.** `Install` registers the classic `water`, `water_1..7`; the phase blocks
(`water_L_p`, p = 1..7, for every level, one canonical order) are appended after every other block when the world needs a
finer scale: by the plugin's late setup stage (a world that starts at 0.25 m), by `sim.Engine.ChangeSubdiv` through
`Engine.OnSubdiv` (a scene switch: `game.SceneSwitch.Apply` runs it, so the growth is journaled with the command and a
replay reproduces it) and, for a bare `Install`, at the first tick. Ids are append-only and never renumbered; the phases
of a finer scale stay registered after switching back and read as their full level (`water_L`). The registry gets the
phases of every scale at once, so it does not depend on the history (an editor that switched 1 m -> 0.25 m, a game that
started at 0.25 m and a replay list the same blocks, which a `.voxworld` palette needs). `State.rescale` also repairs a
snapshot restore or a rolled-back command at the next tick and fluid command. The registry is locked
(`sim.Engine.RegistryLock`, the mesh workers' lock) while it grows on a live app.

## Flowing lava (`Config.Lava`)

Opt-in: `fluid.Config{Lava: true}` registers `lava` (source) and `lava_1..lava_3` right after the water blocks (an existing
non-solid `lava` block of `Fluid` kind lava is reused). With it off nothing is registered and every hash is unchanged; the `Config` hash gains the
lava fields only when on. Not available with `Fine` (Install refuses it); the lava blocks are not `Liquid` blocks (no buoyancy,
no flow height in meshes, which see a plain non-solid block). Emission and heat are set on the blocks (15 for the source).
There is no block damage hook in the engine, so lava does not hurt by itself; scripts read the block name.

* **Speed.** Lava rules run every `LavaInterval` ticks (default `3*Interval` = 15: a third of the speed of water). A multiple of
  `Interval`. Unstable lava cells wait in the work list between lava steps.
* **Reach.** A source spreads 3 cells (`lava_3`, `lava_2`, `lava_1`), falling lava is `lava_3` and spreads again where it lands.
  No infinite sources. Unfed flowing lava drains to air. Fragile blocks are replaced. The reach is in voxels (not scaled by `Subdiv`).
* **Water onto lava.** Source -> `Config.CoolSource`; flowing -> `Config.CoolFlow`; not a registered solid block: lava blocks the water.
* **Lava onto water** (source or flowing, also falling onto it): the water cell becomes `Config.CoolWater`; not registered: the water stays
  and the lava does not enter. The defaults are obsidian, cobblestone and stone (`blockset.DefaultLavaCooling`); the names are hashed with the Config.
* Integers only; two runs, replays and snapshots give the same `StateHash` (`lava_test.go`).
