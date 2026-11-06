# Rigid-body physics (physics3d)

`physics3d` is the engine's deterministic rigid-body layer: boxes, spheres, capsules and **voxel bodies** (small voxel grids that move,
rotate, collide and break apart). It is a plugin, off unless you add it, and is meant for destruction games, vehicles and physics puzzles.
The older [`physics`](character.md) package (AABB bodies, character controller, triggers) is unchanged and independent; use
`physics3d` when you need rotation, stacking, joints or destruction.

```text
a.AddPlugin(&engine.ScenePlugin{})
a.AddPlugin(&physics3d.PhysicsPlugin3D{})     // project setting: runtime.plugins.physics3d = true
```

Try it: `go run ./examples/physics3d_playground -shot playground.png` (stack of ten boxes, a destructible voxel tower, a hinged door,
a rope bridge; it runs twice, compares the `StateHash`, verifies the journal replay, and writes PNG captures).

## Model

Everything is ECS state, so `StateHash`, `Snapshot`/`Restore`, undo, journal replay and failed-tick rollback are the engine's own.

| component | role |
|---|---|
| `physics3d.rigidbody` | kind (`static`/`kinematic`/`dynamic`), mass, material, layers, damping, CCD flag, and the state: `pos` (centre of mass), `rot` (quaternion), `vel`, `ang_vel`, sleeping, derived inverse mass/inertia |
| `physics3d.collider` | `box` (half extents), `sphere` (radius), `capsule` (radius, half height along local Y) |
| `physics3d.voxelbody` | voxel grid (`sx,sy,sz`, block id per cell, 0 = empty), density scale, `cell` (edge of one cell in world units, 0 = 1 block), derived centre of mass |
| `physics3d.joint` | `fixed`, `hinge` (limits, motor), `ball`, `distance` (rope or rod); on its own node, referencing two bodies (`b` = 0 is the world) |

All four are described in the scene schema (ranges, tooltips), so the inspector edits them. A body also writes its `scene.Transform`
(position, Euler degrees) every tick it moves, for the scene tree and the render. Render voxel bodies from `physics3d.voxelbody` + `rigidbody`
(see Rendering), not from the Euler angles.

Create bodies with journaled commands: `SpawnBody`, `SpawnVoxelBody`, `SetJoint` (return `[]sim.Command` of scene commands) and
`ApplyImpulse`, `RemoveVoxels`, `Explode`, `Detach`, `CarveBody` (custom commands: `physics3d_apply_impulse`, `physics3d_remove_voxels`,
`physics3d_explode`, `physics3d_detach`, `physics3d_carve_body`). For a voxel body, `Pos` of a new body is the world position of the grid
corner; the first step moves it to the centre of mass. Mass comes from the collider volume or, for voxel bodies, the sum of cell densities
(`Config.Densities` by block name, default 1 per cell); `Mass > 0` overrides it (a split clears the override and uses density).

## Determinism

* One FixedUpdate system pair (`physics3d.split`, `physics3d.step`), no goroutines, no Go map iteration, ascending entity order, explicit sorts.
* Math is **float64** with a fixed operation order; the state is hashed and snapshotted as exact float64 bits.
* **Platform stance.** Same seed and inputs give bit-identical results on the arm64 and amd64 builds, verified on macOS (Windows and Linux are checked by the CI workflow, which has not run yet) (tested: twin engines, mid-simulation
  snapshot, journal replay, failed-tick rollback, fuzzed impulses, and the templates hashed by the arm64 and the amd64
  builds at 200 and 2000 ticks). Every float product is explicitly rounded (`float64(a*b) + c`) so the Go compiler cannot fuse it into a
  multiply-add (it does on arm64 and with `GOAMD64=v3`, not on default amd64), and the trigonometry comes from `mathx/detmath`, not from
  package `math`. Guards: `internal/detguard` (no fused instruction in the arm64 and amd64-v3 assembly, no unrounded product, no banned
  `math` call). See [Determinism](determinism.md). Fixed-point was rejected: quaternions, inertia tensors and the sequential-impulse solver
  need a wide dynamic range, and IEEE 754 float64 with explicit rounding is already exact and portable.
* Pending impulses, contact warm-start impulses (`State.Warm`), touching pairs (for events) are state, so a restored snapshot continues exactly.
* Worlds that do not add the plugin hash exactly as before. With the plugin and no bodies the extra state is empty.

## Simulation

Per tick: broadphase (sweep and prune on swept AABBs, layers/masks, joints exclude their pair), narrowphase once per tick with a speculative
margin derived from the speeds (speculative contacts that cannot be reached this tick are dropped, manifolds are reduced to 4 points per convex
pair), contacts sorted bottom-up, then `Substeps` of: gravity and damping, buoyancy, warm start, soft contact + joint iterations, integrate,
`RelaxIterations` (1) relax pass. **Quality follows the work budget**: `SolverBudget` (200000 contact solves per tick) is spent as substeps x
iterations: a few contacts get up to `MaxSubsteps` (24) substeps and doubled `Iterations` (4), which makes stacks of 20+ boxes stable at the
defaults; thousands of contacts get down to 4 substeps. Contacts are soft constraints (`ContactHertz` 80, `ContactDamping` 3) with a speculative
term, Coulomb friction (geometric mean of the materials, 2 tangents), restitution applied after the substeps for impacts faster than
`BounceThreshold`. Over `MaxContacts` the lowest contacts are kept (upper layers fall onto them instead of through the floor).

`runtime.physics_substeps` (`vox.project`, 1..32, 0 = default) sets `Substeps` of both physics engines for a game, so contacts and
character movement can be finer without raising `runtime.tick_rate`.

* **Shapes.** Capsules decompose into spheres, voxel bodies and terrain into unit boxes (only exposed cells). Contacts into a solid neighbour
  cell are dropped, so flat terrain and flat voxel bodies produce no edge ghost contacts. Non-cubic blocks collide as cubes.
* **Terrain.** Bodies collide with solid voxels when `mask` has `LayerTerrain` (bit 31). A fast body (more than half its radius per substep, or
  `ccd`) also ray-casts its centre against the terrain every substep, so bullets do not tunnel.
* **Water.** In liquid blocks (coarse levels and fine water, read with `voxel.LiquidTable.Sample`; the fluid state is never written) a body gets
  Archimedes lift `Water.Density x submerged fraction x volume x g`, drag toward the current (`Water.Drag`, `Water.FlowPush`) and angular drag.
  Bodies near a liquid are re-sampled every substep, others cost nothing. A box of density 0.4 floats with 40% submerged; a dense one sinks.
* **Characters.** With `physics.PhysicsPlugin` added before `PhysicsPlugin3D`, the system `physics3d.character` (after `physics.character` and
  `physics3d.step`) lets `physics.CharacterController` characters stand on and be carried by moving bodies (platform velocity plus rotation at the
  feet), be held up by platforms and stopped by solid bodies, and push dynamic bodies up to `CharacterConfig.MaxPush` mass (30) toward the walking
  direction at `PushSpeed`.
* **Sleeping.** A body sleeps when its island (contacts and joints) is quiet for `SleepTicks` (30). A sleeper wakes on a pending impulse, on
  contact with a body faster than `WakeSpeed`, when a jointed partner wakes, and when the terrain around it changes (signature check every
  4 ticks), so removing a block under a sleeping crate drops it.
* **Events** (frame domain, `engine.Read`): `ContactBegin`, `ContactEnd` (body pairs), `TriggerEnter`, `TriggerExit` (bodies with
  `trigger` set). Exits first, then enters, in ascending entity order. Body-terrain contacts have no events.
* **Joints.** Sequential impulses with Baumgarte-style position error; hinge angle limits (`min`/`max`, degrees) and motor (`motor_speed`, degrees per second; the `angle` state is in radians); distance joints are
  one-sided ropes when `min < max`; `break_force` (a force: constraint impulse per second, independent of the substep count) removes a joint above it; a joint whose body was deleted is removed. Joint-connected bodies do not collide unless `collide`.
* **Queries** (the `FixedScene` used by scripts and the character system shares the end state of the previous step: no per-call copies; components written by other systems in between are seen after the next step) (`Scene`: `FrameScene`, `FixedScene`, `EngineScene`): `Raycast` (box, sphere, capsule, voxel-body cell walk, terrain),
  `Overlap`, `ShapeCast` (sphere, box, capsule; conservative advancement + bisection to ~1e-3 blocks). Scripts: `physics3d_raycast`,
  `physics3d_apply_impulse`, `physics3d_body_get`, `physics3d_remove_voxel`, `physics3d_water_at` ([script/ABI.md](../script/ABI.md), `burrowsdk.Physics3D*`).


### Buoyancy

A body in liquid (coarse levels or fine water, read-only) is cut into displacement cells: a sub-grid of about `Water.Spacing` (0.5) blocks for a box, sphere or capsule, the cells of a voxel body plus its **sealed cavities** (empty cells the outside cannot reach through faces), merged into clusters above `Water.MaxPoints` (96) cells. Every second substep each cell reads the liquid surface under its centre and gets a submerged fraction; the body receives the lift `rho * V_sub * g` at the **centre of buoyancy** (not at the centre of mass), so it rights itself, trims by its load and can capsize, and a sealed hollow hull floats on its whole inside. Drag and angular drag scale with the displaced fraction, and the body is pulled toward the current. A body that cannot reach liquid during the tick (its swept box is dry) skips the sampling, and one fully under water takes the whole displaced volume without reading the surface.

**Open hulls.** In a voxel body the +Y axis is up. An empty cell that has to climb to get out (a boat's inside) is a *pocket*: it displaces like a solid cell while the air holds it, i.e. while its rim (the highest cell of its lowest way out) is above the water and above the cell. When the rim goes under water the pockets fill (`Water.FloodRate`, 2 per second, state `RigidBody.Flood`) and stop displacing, which is exactly the buoyancy of a hull full of water: an overloaded or swamped boat sinks, and it empties again (`Water.FloodDrain`, 0.5 per second) once the rim is dry. Tilted past its rim, a pocket spills at once. `RigidBody.Displace` (default 1) still multiplies the displaced volume. **Sleeping:** a body asleep on water wakes when the immersion of its box changes by 1/32 (the water rises, drains or moves).

**Swell.** `Water.Swell` (`Amp` blocks, `Length`, `Speed`, `Dir`; off at `Amp` 0; in a project `runtime.plugins.swell: {"amp": 0.4, "length": 12}`) lifts and lowers the water with three travelling waves, a pure function of position and tick (package `swell`, `detmath`): deterministic, and the same for the solver, the scripts and the renderer. The renderer draws the very same waves (`shaders/swell.glsl`, checked against the Go table by a test): the smooth water surface (`water2.vert`, the HDR levels and the linear look) moves its top vertices and the upper edge of its sides by the swell, the normals take its slope, and the eye under the surface follows it, so a floating body sits where the water is drawn. Bodies bob on it and replays stay exact (`go run ./examples/swell_demo -shot out.png` floats a hull, a boat, a log and a rock on a swelling lake and writes captures). Scripts read the water with `physics3d_water_at` (`burrowsdk.Physics3DWaterAt`: surface height with swell, depth of the point, flow); the buoyancy knobs of a body are its components (`displace`, `gravity_scale`, `flood`).

Limits: the fraction of a cell uses the vertical extent of its box (exact for a flat surface); air pockets open downward (a diving bell) are not modelled, and a flooded hull does not move its centre of mass; the classic cube water (`-shaders off`) does not draw the swell (its greedy quads would crack), only the smooth surface does; the foot effects of waterfalls do not follow it; the surface is displaced at the block corners, so keep `Length` at 6 blocks or more.

## Destruction

* **Splitting.** `RemoveVoxels` (or an explosion) marks a voxel body dirty; the next tick flood-fills it (6-connectivity) and the largest island
  stays on the entity while each other island becomes a new root node `frag_<entity>_<tick>_<k>` with the correct centre of mass, inherited
  linear and angular velocity and its own inertia. Voxels are conserved exactly (fuzz-tested). Empty bodies are despawned.
  Budget: `SplitBudget` (16384 grid cells flood-filled per tick, oldest first; the rest waits), and no split is made while it would exceed
  `MaxBodies`.
* **World chunks.** `Detach{Seeds}` (and `Explode{Detach: true}` on the crater rim) runs a bounded structural support check on the solid terrain:
  a flood fill over solid voxels, at most `SupportBudget` (4096) voxels per piece, at most 16x that per command. A piece that touches
  `y <= Bedrock` (default 0) or outgrows the budget counts as ground; a smaller piece is floating and becomes a `VoxelBody` (grid at most 64
  per axis, 32768 cells; larger pieces stay in the world; at most 64 pieces per command). `CarveBody` cuts a chosen box out of the world.
* **Explosions.** `Explode{Center, Radius<=48, Impulse, Destroy, Detach}` removes voxels (terrain and voxel-body cells) inside the radius and
  pushes every dynamic body within 2 radii with a linear falloff.

## Caps (DoS) and measured cost

| cap | default | what happens beyond it |
|---|---|---|
| `MaxBodies` | 2048 | extra bodies (highest entity ids) are not simulated; `Stats.Dropped` |
| `MaxJoints` | 2048 | extra joints ignored |
| `MaxPairs` | 8192 | extra broadphase pairs dropped |
| `MaxContacts` | 8192 | per tick; the lowest contacts are kept |
| `SolverBudget` | 200000 | substeps shrink above it (min 4) |
| `MaxPrimTests` | 600000 | primitive pairs (and a quarter of the grid cells walked) per tick; the rest of the pairs is skipped |
| terrain scan | 32768 cells | an oversized body only collides with terrain within 32 cells of its center per long axis |
| `ApplyImpulse` / `Explode` | 1e12 per component | refused above; the step also clamps speeds and sanitises non-finite state, so a bad input never wedges the tick |
| `Detach` | 16 bodies per command, `MaxBodies` | pieces that do not fit stay in the world |
| `MaxPrimsPerPair`, `MaxTerrainCells` | 128, 1024 | prims/cells examined per pair / per body |
| `MaxPairContacts` | 48 | per pair, reduced by farthest-point sampling |
| voxel body | 64 per axis, 32768 cells | `Validate` rejects |
| `SplitBudget`, `SupportBudget` | 16384, 4096 | see Destruction |

`physics3d.Res(app).LastStats()` reports bodies, awake, pairs, contacts, substeps, cap hits and splits of the last tick.

Measured on an Apple M2 Max (`BURROW_PERF=1 go test ./physics3d -run PerfNumbers -v`, `-bench Dense`; the machine was shared with other jobs, so
numbers vary). Cost is the narrowphase (once per tick) plus `contacts x (Iterations + Relax) x substeps` soft-contact solves (about 100 ns each):

| scene (dense piles dropped as 20x20 columns) | per tick |
|---|---|
| stack of 10 boxes | under 0.5 ms |
| 500 boxes, impact ticks (3.6k contacts) | average about 6 ms, worst about 16 ms; asleep afterwards (about 1 ms) |
| 1000 boxes, impact (6.3k contacts) | average about 20 ms, worst about 23 ms; asleep afterwards (about 2 ms) |
| 2048 boxes (the cap), impact (cap of 8192 contacts) | average about 25 ms, worst about 29 ms |
| voxel body 32x16x32 (16384 cells) resting on terrain | 5-8 ms |
| splitting a 32x32x32 grid (32768 cells) into 8 islands | 5 ms for the flood fill (two ticks at the default budget) |

A tick is 50 ms (20 Hz). Piles of up to about 1000 boxes fall asleep; 2048 boxes in 5 layers exceed the contact cap, so the lower layers are
solved and the pile keeps shifting (it stays awake and costs about 25-30 ms per tick) instead of sleeping.

## Rendering

`mesh.BuildDynVoxel` meshes a grid once (same vertices, culling and AO as chunks) and `mesh.DynModel` gives the object matrix. For the
Vulkan renderer, `physics3d/p3render.Plugin` (add it after `engine.RenderPlugin`) blends the previous and current tick state with
`App.TickAlpha()` (smooth motion at any frame rate), bakes the transform into the mesh (positions in sixteenths of a block, face index = the
world axis nearest the rotated normal) and calls `Renderer.UploadDynVoxel`: the body is drawn by the **terrain pipelines** (opaque pass and
sun shadow cascade), so it is lit, fogged, shadowed and shadow-casting like world blocks, with the flat block colours. Primitive colliders are
drawn as scaled cubes (spheres and capsules by their bounding box). `go run ./examples/physics3d_playground -gpu -shot out.png`.
The bodies also write motion vectors (`Renderer.RegisterVelocityPass`, shader `vel_dynvox.vert`: previous pose = current pose moved by the rigid delta of the last two
uploads), so TAA/FSR 2 do not ghost behind them (`-aa taa` capture sequence of the explosion in the playground). GPU keys carry the entity generation, removals run before uploads, and
each body has its own culling cube (bounding radius), so 64-cell grids and large boxes are not culled at the screen edge. Not done: textured block faces and normal-mapped lighting on rotated bodies, and a true instanced pipeline (the per-frame bake costs one upload per moving
body; `PackDynVoxMesh`/`PackDynVoxInstances` hold the data layer for it).

## Limits and untested areas

* Soft contacts sag under load (a stack of 10 unit boxes settles about 0.1 blocks lower in total); stacks of 14, 20 and 30 boxes hold at the defaults
  (tested for 14 and 20 with random 0.01-block offsets).
* Voxel body collision uses surface cells only: a body fully inside another overlap is not resolved; very large overlapping grids are limited by
  `MaxPrimsPerPair`.
* Terrain contacts are cubes only; a body pushed deep inside terrain (more than a few cells) is not pulled back out.
