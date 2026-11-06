# Navigation and AI

Package `nav` (graph, pathfinding, steering, plugin) and `nav/ai` (behaviour trees, state machines, utility scoring,
perception geometry). Genre neutral: a profile describes the body, the voxels describe the world.

It is off by default in `vox.project` (`runtime.plugins.nav: true` enables it: its components and request queue are hashed
state), or add `&nav.Plugin{}` after `ScenePlugin`, the voxel world and
`PhysicsPlugin`. Behaviour definitions load from `<name>.bt.json` (or `ai/<name>.bt.json`) in the project.
Try it: `go run ./examples/nav_demo -shot out.png` (CPU renderer, no window).

## Design

* **Graph.** A node is the voxel holding an agent's feet (for width 2, the lowest corner of its 2x2 footprint). Per
  profile (`Height` 1-8, `Width` 1-2, `StepHeight`, `JumpHeight` <= 4, `DropHeight` <= 31 (a region reads at most one chunk below a node), `CanSwim`, `CanClimb`, `CanFly`, `NoDiagonal`)
  a node is *ground* (solid floor, body clear), *water* (feet in liquid, or floating on it), *climb* (ladder, vine and
  rope blocks, `World.Climbable`) or *air* (flyers: any clear cell). Moves: 4/8 neighbours with step up, jump up, drop
  down (fall column clear), unit moves through water and ladders, 26 neighbours without corner cutting for flyers.
  Costs are tenths of a block: 10 / 14, +4 per stepped block, +14 per jumped block, +2 per dropped block, 15 swimming,
  20 climbing. The heuristic is admissible, so flat A* is optimal (tests compare it with BFS and Dijkstra).
* **Micro-voxels.** A cell holding a brick (docs/blocks.md "Micro-voxels") is neither solid nor air: its solid micro voxels (registry `Solid`) are reduced to a mask of sixteenths of the cell height inside the agent's footprint band (the whole cell, or the centred `2 * RadiusM` band for a one-cell wide agent with `RadiusM`, so a doorway carved 8/16 wide passes a 0.5 m wide agent and not a 1 m one). An agent stands at the lowest feet offset `f` (0..15 sixteenths) with a solid layer right under its feet (the cell below for `f` = 0) and its body, `Height` cells tall, free above them: on a micro slab or half-step it stands at `f` = 8, under a lintel only if it fits. Moves compare floors in sixteenths: a rise up to the step height (`StepHeight`, or `StepM` in sixteenths of a voxel after `Scaled`) is a step (cost +4 per voxel, rounded up per micro step), up to the jump height a jump, a micro step down is a walk, a longer fall a drop. `TestWalkerCrossesMicroStepsAndEndsOnTheSlab` drives a nav agent that is a `physics.character` over a micro quarter step and a micro slab and checks it ends at the slab height; the character reads the world through `sim.Chunks` (`voxel.Access`), which exposes the bricks, the shape registry and the fine water like the map itself. A world without bricks classifies and costs exactly as before (navmesh results unchanged). String pulling only joins nodes with the same feet offset. The follower aims at the micro floor: the waypoint height is the node's cell plus its feet offset (`feetY`), so the arrival test, the final approach, the jump decision (a rise above the controller's step height) and the kinematic height all use the sixteenths, and an agent steps up micro steps smoothly and stands on a micro slab. **Water in bricks:** a brick cell counts as liquid for the swim, avoid and surface-float rules when any of its micro voxels holds a liquid block (`liquidAt`; the layer does not matter, the body of an agent in the cell is wet), so a swimmer treats it as water and a walker cannot stand in it. **Fine water:** when the source carries the fluid automaton's fine bricks (`voxel.FineReader`: a `ChunkMap` with `SetFine`, or `voxel.Access`), a cell whose fine brick holds a mean depth of at least `World.FineWaterDepth` (a fraction of the cell, default 0.5, negative disables) is liquid too. It is live state read on each `liquidAt` query, not cached with the chunk, so cached region paths are not invalidated when the water moves.
* **Derived, never state.** `World` classifies each chunk into solid/liquid/climbable bit planes (12 KB per chunk) and
  validates it against `voxel.Chunk.Version` (changes on every write, undo restore and decode; new, additive
  accessor) on first use per request. A stale answer is impossible, with or without an observer, after undo and after
  snapshot restore. The `voxel.Observer` feed (`World.Attach`, chained behind an existing observer such as fluid's)
  only queues changed chunks: `World.Update(budget)` rebuilds at most `budget` of them per call in ascending chunk order.
  Tests prove incremental update == fresh rebuild (classification and regions) and that undo is noticed. The caches are bounded (`MaxCachedChunks` 2048, `MaxCachedRegions` 1024, least recently touched dropped at the start of the next request: wall time only, charges are unchanged). `Detach` is chain-aware (an observer installed after ours stays in the chain); install fluid before `Attach`, since fluid refuses a map that already has an observer.
* **Hierarchy.** For goals farther than 48 blocks, each chunk is split per profile into regions (components of the
  mutual moves inside the chunk) with *portals* (moves leaving the chunk). An abstract A* over regions gives a corridor,
  then every chunk segment is refined by a small A* confined to that chunk (HPA*). The abstract search, the refinement and a fallback flat A* share one unit budget (an unreachable goal in a big loaded world costs the budget, not hundreds of region builds), and every portal move is re-checked before it is used. Any failure falls back to flat A*.
  On a 200x200 field with pillars and walls the corridor search expanded 746 nodes against 2275 for flat A* at 5 %
  longer paths.
* **Smoothing.** String pulling: look-ahead 24 nodes, a straight sweep of the body (corner cells included) must be
  free; ground profiles only smooth within one level, flyers and swimmers in 3D.
* **Flying and swimming.** Flyers use 3D flat A* (no hierarchy: long flights are partial paths that re-plan). Swimmers
  switch between walking and swimming nodes; a swimming `physics.character` gets the swim intent (`Move.Y`).
* **Dynamic obstacles.** `nav.obstacle` entities block a box each tick (not cached, not in the hierarchy). Moving or
  removing one changes the answer on the next request; agents revalidate the next four waypoints every
  `ValidateEvery` ticks and re-plan when a node vanished.
* **Crowds.** `Steer` is RVO-lite: 28 candidate velocities (7 headings at 3 speeds + stand still) scored by deviation and
  time to collision against up to `Neighbours` nearest agents (spatial hash, fixed order, pure function), plus a
  personal-space push. Neighbour velocities are the previous tick's, so entity order never matters.
* **Following.** Agents with a `physics.character` get `Move`/`Jump` intent (jump when the next waypoint is above the
  step height, swim up/down in water); others are moved by the plugin (flyers, simple creatures). Stuck for 3 s: re-plan.

## Determinism and budgets

Paths are computed inside the fixed tick by the system `nav` (before `physics.character`) from a FIFO queue
(`Queue`, a hashed fixed resource: entity + goal sequence). Requests run to completion, never across ticks, so there is
no half-done search to snapshot. The cost of a request is counted in *units* (one unit is about one node expansion;
first touch of a chunk = 4, of a region = 100, per request) and charged whether or not the data was cached, so which
tick a path completes in never depends on the cache. `engine.VerifyCacheNeutrality` passes with the plugin.

| cap | default | meaning |
| --- | --- | --- |
| `TickUnits` | 4000 | units spent on requests per tick (one request may overshoot by its last step, <= ~1000) |
| `ReqUnits` | 2500 | cap of one request; beyond it the best partial path is returned |
| `MaxPerTick` | 48 | requests started per tick |
| `MaxQueue` | 4096 | queued requests; agents beyond stay pending and retry the next tick |
| `ValidatePerTick`, `ValidateEvery` | 256, 8 | path revalidations |
| `ScanPerTick`, `ThinkPerTick` | 96, 256 | perception scans and brain thinks per tick: the agents whose next time is oldest go first, so nobody starves |
| `ScanChunks` | 32 | chunks re-verified per tick by the prewarm |
| `Neighbours` | 6 | crowd neighbours per agent |

Per agent and tick the plugin always does O(1) work (follow, steer, write back changed components only). Measured on
this machine: 10k agents with every request queued: worst tick 7 ms; 3000 walking agents with crowd avoidance: mean tick
3.5 ms (see `nav/scale_slow_test.go`, `go test -tags slow ./nav`). A far request (170 blocks) costs ~1800 units, about
1.4 ms warm and 20 ms the first time the chunks are seen.
Agents under a parent node use their world position (`WorldAffine`); nav writes back the local position. Limits: coordinates within +-1048575; a stored path holds at most 512 waypoints (longer ones are partial and re-planned);
unloaded space counts as air (no floor, so not walkable, but flyers may enter it).

## Components

| component | purpose |
| --- | --- |
| `nav.agent` | `profile`, `speed`, `radius`, goal (`goal`, `has_goal`, `slack`), `feet` and `face` (agents without `physics.character`: the node's origin is its feet, where a `.vox` model has its base, instead of its body center; the node turns toward where it walks, yaw 0 facing -Z); state: `state`, `path`, `idx`, `partial`, ... |
| `nav.obstacle` | `half`: box blocked around the node position |
| `nav.target` | makes an entity perceivable: `tag`, `height`, `noise`, `hidden` |
| `ai.perception` | `sight`, `fov`, `hear`, `eye`, `targets` (tag filter), `memory`, `interval`; state: `seen` |
| `ai.brain` | `asset` (`wolf` loads `wolf.bt.json`), `interval`; state: blackboard, node memory |

Commands (journaled, in the agent session `act` list and `engine.RegisterCommand`): `nav_set_goal {path, goal, slack}`,
`nav_stop {path}`. `nav.SpawnAgent(name, pos, agent, extra...)` returns the commands that create an agent node.
`nav.Res(app).Stats()` reports the last tick (agents, requests, units, queue, scans, thinks, builds).

```go nocheck
a.AddPlugin(&nav.Plugin{Config: nav.Config{
	Profiles: []nav.Profile{nav.Walker, nav.Flyer, {Name: "tank", Height: 3, Width: 2, StepHeight: 1, JumpHeight: 1, DropHeight: 2}},
	Assets:   func(name string) ([]byte, error) { return os.ReadFile("ai/" + name + ".bt.json") },
}})
cmds := nav.SpawnAgent("wolf", mathx.Vec3{X: 4.5, Y: 1.9, Z: 4.5}, nav.NewAgent("walker"),
	nav.Comp{Name: physics.CompCharacter, Value: physics.NewCharacter()},
	nav.Comp{Name: nav.CompBrain, Value: nav.NewBrain("wolf")})
```

Without the physics plugin agents are moved by `nav` itself, so a headless game needs nothing else. With it, give the
character `StepHeight >= profile.StepHeight + 0.05`.

## Voxel size

Everything an author writes is in metres; the graph is built in voxels. At the default one metre voxel the two are the same, so existing
profiles and components read unchanged. In a world of `n` voxels per metre (0.5 m, 0.25 m, 0.125 m voxels: `n` = 2, 4, 8) the plugin converts
at `Build` (`Profile.Scaled(n)`): the whole-number fields (`Height`, `Width`, `StepHeight`, `JumpHeight`, `DropHeight`) multiply by `n`, and the
optional fractional fields `HeightM`, `RadiusM`, `StepM`, `JumpM`, `DropM` (JSON `height_m`, `radius_m`, `step_m`, `jump_m`, `drop_m`) win over
them. Rounding keeps the body honest: height and footprint (`2 * RadiusM` in cells) round up, so a 1.8 m agent never fits a gap lower than itself;
step, jump and drop round down, so it never claims a ledge or fall beyond its ability; drop is capped at 31 voxels. Body limits scale with `n`
(height 8 m, width 2 m, jump 4 m). A 1.8 m / 0.4 m agent (`HeightM 1.8, RadiusM 0.4`) is 2x1 voxels at scale 1 and 8x4 at scale 4, and passes the
same 2 m doors in either. Build graphs by hand with `NewWorldAt(n, profile.Scaled(n))`.

`nav.agent` `speed`, `radius` and `slack`, `ai.perception` `sight`, `hear` and `eye`, `nav.target` `height`, and the behaviour tree arguments
(`wander radius`, `chase stop`, `flee dist`, `dist_lt`/`dist_gt`) are metres; sensed distances (`seen[].dist`, `target_dist`) are reported in metres.
Path costs are tenths of a voxel of walking and the ratios between move kinds are per voxel, so paths have the same shape at every size;
`nav.CostMetres(cost, n)` converts a result cost to metres. `goal` and `path` stay voxel cells.

## Behaviour trees and state machines (`nav/ai`)

A definition is JSON (`.bt.json`) or Go (`ai.Def`). Node types: `sequence`, `selector` (both resume the running child;
`"reactive": true` re-evaluates from the first child every think and resets the child it pre-empts), `parallel`
(`policy` `all` or `any`), `inverter`, `succeeder`, `failer`, `repeat {n}`, `retry {n}`, `cooldown {seconds}`,
`timeout {seconds}`, `wait {seconds}`, `condition {name,args}`, `action {name,args}`, `utility` (each child has a
`score` naming a registered scorer; the best child runs until it finishes). Limits: 512 nodes, depth 32, 1 MiB.

```json
{"type":"bt","name":"wolf","root":{"type":"selector","reactive":true,"children":[
  {"type":"sequence","children":[{"type":"condition","name":"has_target"},{"type":"action","name":"chase","args":{"stop":1.6}}]},
  {"type":"sequence","children":[{"type":"action","name":"wander","args":{"radius":9}},{"type":"wait","seconds":1}]}]}}
```

`{"type":"fsm","fsm":{"initial":"graze","states":[{"name":"graze","on_tick":[{"name":"stop"}],"transitions":[{"to":"alert",
"if":[{"name":"can_see"}]}]}, ...]}}` is a state machine: `on_enter` and `on_tick` calls run, then the first transition
whose conditions (`not` negates) all succeed and that is at least `after` seconds old fires. `examples/nav_demo/ai/` has
a tree and a machine for each creature.

Built-in conditions: `has_target`, `can_see`, `heard`, `arrived`, `path_failed`, `moving`, `in_water`, `bb_true {key}`,
`bb_lt`/`bb_gt {key,v}`, `dist_lt`/`dist_gt {v,key}`, `chance {p}`. Actions: `wander {radius}`, `move_to {key,slack}`,
`look_home`, `chase {key,stop}`, `flee {key,dist}`, `stop`, `set {key,value}`, `idle`. Scorers: `const`, `random`,
`target_near`, `target_far`. Register your own with `nav.Config.AI` (`ai.NewRegistry().Func(name, f).Scorer(...)`); a
function gets an `*ai.Ctx` (blackboard, tick, `Rand`, `Local` scratch) and `nav.ViewOf(ctx)` for the agent.

Everything an agent remembers is in `ai.brain`: the blackboard (sorted, at most 64 keys; numbers, vectors, entities and short strings) and `mem`, so snapshots, undo
and replay cover an agent in the middle of an action. `ctx.Rand` is a pure function of agent, tick and salt. The
blackboard keys `target`, `target_pos`, `target_dist`, `can_see`, `heard`, `arrived`, `failed`, `moving`, `self_pos` and
`home` are refreshed before every think. A bad asset name or definition leaves the brain inert (a failed read is retried after 60 ticks, a failed compile after 600; the tick never fails). The brain stores the content hash of its asset (`ai.brain.hash`): a changed asset restarts the brain, and an asset that differs between a live run and its replay shows as a `StateHash` difference. `Config.Assets` must be a pure function of the name during a run. State machines are capped at 256 calls/transitions and 8 conditions per transition; forged `mem` values never crash a tick. `.bt.json` files are project files and asset database assets (importer `behaviour`, validated at load); the plugin compiles them on first use through `Config.Assets`.

**Perception.** `ai.perception` scans every `interval` ticks (at most `ScanPerTick` per tick): targets within
`max(sight, hear)` from a spatial hash, nearest first, at most 12 checked. Sight: inside the cone (`fov`, facing follows
movement), within `sight`, and a `voxel.Raycast` from the eye to the target's `height` is not blocked. Hearing: distance
<= `hear * noise` (through walls). Seen targets are remembered `memory` ticks, nearest first, at most 8.

**Utility scoring.** `ai.Option{Considerations: [...]}` with `ai.Curve` response curves (linear, quadratic, sqrt,
inverse, logistic, step) scored with a compensation factor; `ai.Best` picks the first maximum.

## Scripts

Additive host calls (module `vox`, see script/ABI.md) and `sdk/burrowsdk/nav.go`: `NavSetGoal`, `NavStop`,
`NavSetGoalPos` (world position), `NavGetState`, `NavPath`, `NavSetBB`, `NavGetBB` (numbers), `NavPutBB`, `NavReadBB`, `NavDelBB` (typed values: number, vector, entity, string), `NavSensed`. They edit the nav components like `entity_set_component`
(applied at the end of the invocation, journaled).

## Debug overlay and tools

`engine.DebugLines` (`engine/debuglines.go`) is a frame-domain list of world lines in named layers (`Layer("nav")`; a user only ever
clears its own layer). `nav.Res(app).SetDebug(nav.DebugOptions{Paths: true, Graph: true, Center: c, Radius: 12})` makes the
plugin fill its layer every frame: paths (green, white waypoints, red goal box), the walkable graph (yellow ground, blue
water, magenta ladder, cyan air), obstacles (orange). The CPU renderer and `-shot` captures draw the lines with
`engine.OverlayLines`; the Vulkan renderer draws them live (`render/vulkan/lines.go`, shaders `dbgline.*`, up to 4096
lines per frame, depth tested) in the game window and in the editor viewport (`make nav-demo-gpu` writes a GPU frame).

The editor and the editor MCP server have it too: the *Project settings* dialog has a `nav` checkbox (`runtime.plugins.nav`; `burrowedit -nav`),
and the tool `editor_nav` {action state|path|goal|stop|debug} queries a path over the current world, sends a `nav.agent` node
to a goal (journaled `nav_set_goal`), stops it and toggles the overlay.

## Tests

`go test ./nav/...`: mazes against BFS and Dijkstra, incremental update against a fresh rebuild, undo and stale caches,
hierarchy validity and cost, step/jump/drop/headroom, swim/climb/fly, obstacles, steering, behaviour tree semantics,
JSON loading, twin runs, snapshot mid path, journal replay, cache neutrality, perception, path floods (600 agents fast,
10k with `-tags slow`), fuzzing (`go test ./nav -fuzz FuzzFindPath`, `./nav/ai -fuzz FuzzLoad`).
