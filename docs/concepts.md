# Concepts

## Two domains

```
 frame domain (variable dt)                 simulation domain (fixed 20 Hz, deterministic)
 OS input, window, render, UI, editor,      sim.Engine: ECS world, voxel chunks, block registry,
 agents, chunk streaming workers            seeded RNG, journal, snapshots, undo
        | Commands (queue)  --------------->  Do(cmd): journaled, hashed, replayable
        | read-only View    <---------------  StateHash, blocks, components
```

* The **simulation** is everything that defines the game state: components, voxels, scripts, physics. It advances in fixed
  ticks of 50 ms (`FixedUpdate` systems). `StateHash` summarises it.
* The **frame domain** reads the simulation through a read-only `View` and changes it only by queueing `Commands`
  (set a block, spawn a node, set a component). Commands are applied between ticks and recorded in the **journal**.
* Input is frame-domain data. To affect the game it must become a journaled command or component: the controller
  turns clicks into `SetBlock` commands; `script.Plugin` turns changed input actions into a `script_set_input` command that scripts read.

## Determinism rules

Inside the simulation (FixedUpdate systems, commands, scripts):

* no wall clock, no global `math/rand` (use `Sim.Rand()` / the script `rand_u64`), no map-iteration order, no goroutines, no I/O;
* all state lives in registered components and voxels (components must be hashable); anything else is a derived cache;
* register the same components, commands and systems on every engine: they are part of the replay configuration;
* scripts run only in `FixedUpdate`, with no clock, files or network, deterministic gas metering and a reset memory image
  for every call (see [scripting.md](scripting.md)).

The engine enforces most of this (frame code cannot reach sim state; a failing tick rolls back completely). The result:
same seed + same journal + same systems = same `StateHash`, for any `GOMAXPROCS`. Across machines it holds on macOS Apple silicon and Intel (tested). Windows and Linux are checked by the CI workflow against a golden hash, which has not run yet. The simulation uses integer math or explicitly rounded floats with a deterministic math library; rendering is not covered. See [Determinism](determinism.md).

## Journal and replay

Every applied command is appended to the journal (`tick`, `kind`, JSON `data`). `app.VerifyReplay()` rebuilds a fresh
engine from `app.ReplayConfig()`, re-applies the journal and requires the same hash. This is how undo history, editor
sessions, agent sessions and `burrow test` prove they are exact.

```sh
burrowplay -headless -ticks 200 -journal j.json -hash mygame     # tick=200 StateHash=ab12...
burrowplay -replay j.json -expect ab12... mygame                 # exit 0 only if the replay matches
```

The journal also carries the world identity (seed + generator parameters), so replaying it against a different world is an
error instead of a silent divergence.

## Terrain: base + overlay

The world is a **pure base terrain**, a function `(seed, generator, chunk position) -> chunk` that is never stored,
plus a sparse **overlay** of edited chunks. Reads see the overlay, then the base, then air. Writes copy a chunk into the
overlay. The base lives in an evictable cache and is not state; the overlay is what is hashed, snapshotted, journaled and saved.

* Streaming (`VoxelWorldPlugin`) only warms the cache and meshes chunks for the GPU, so the load radius cannot change a hash.
* A `.voxworld` file is the overlay plus the base identity: `"VXWORLD"`, header (seed, generator hash, block names), zlib chunks, SHA-256.
  Loading one onto a different seed or generator is refused. Each scene has its own (`scenes/x.voxscn` uses `scenes/x.voxworld`, written by the editor's Save); `runtime.world` in `vox.project` is the older project-wide file.
* The generator comes from `runtime.generator`: `heightmap` (fBm hills, optional caves, trees) or `flat`.

## Scenes and components

A scene (`.voxscn`, JSON) is a forest of nodes. Each node has an id, a name, an optional parent and components:

```json
{ "id": 2, "name": "spinner", "parent": 1,
  "components": {
    "transform": { "pos": [8, 11, 8], "rot": [0, 0, 0], "scale": [1, 1, 1] },
    "render.mesh": { "mesh": "cube", "cast_shadow": true },
    "script": { "module": "assets/scripts/spin.wasm", "props": { "speed": 90 } } } }
```

Components are described by a **schema** (name, fields, types, ranges, tooltips), which drives validation, the editor inspector
and scripts. Built-ins: `transform`, `script`, `physics.body`, `physics.velocity`, `physics.character`, `render.camera`, `render.dirlight`,
`render.pointlight`, `render.mesh`, `render.sprite`, `render.voxmodel`, `render.material`. Register your own with
`burrow.RegisterComponent` (simulation state) and `burrow.RegisterSceneComponent` (schema entry). Prefabs are scene documents
instantiated with overrides.

Node tree changes are scene commands (`scene_spawn`, `scene_set_component`, ...), so they are journaled like voxel edits.

## Plugins and stages

A game is an `App` plus plugins. Systems run in stages: `Startup`, then per frame `PreUpdate`, `FixedUpdate` (N ticks), `Update`,
`PostUpdate`, `Render`, then `Shutdown`. Ordering inside a stage uses `Before` / `After` names. The built-in plugins are
`ScenePlugin`, `WindowPlugin`, `VoxelWorldPlugin`, `ControllerPlugin`, `RenderPlugin`, `RenderWorldPlugin`, `SoftRenderPlugin`,
`DebugPlugin`, `physics.PhysicsPlugin`, `input.InputPlugin`, `assets.Plugin` and `script.Plugin`; `burrowplay` assembles them from `vox.project`.
The complete rules are in [ARCHITECTURE.md](../ARCHITECTURE.md).

A complete headless game with one FixedUpdate system, run twice, shows the guarantee:

```go
package main

import (
	"fmt"
	"os"

	"burrow-engine"
)

func build() *burrow.App {
	app := burrow.NewApp(burrow.Options{Seed: 42, StrictCommands: true})
	app.AddFixedSystem("tower", func(c *burrow.FixedContext) error {
		if c.Tick < 8 {
			c.Commands.SetBlock(burrow.IVec3{X: 0, Y: int32(c.Tick), Z: 0}, "stone")
		}
		return nil
	})
	return app
}

func main() {
	a, b := build(), build()
	for _, app := range []*burrow.App{a, b} {
		if err := app.RunHeadless(20); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	if a.StateHash() != b.StateHash() {
		fmt.Fprintln(os.Stderr, "not deterministic")
		os.Exit(1)
	}
	if err := burrow.VerifyReplay(a); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("tick=%d StateHash=%016x\n", a.Tick(), a.StateHash())
}
```
