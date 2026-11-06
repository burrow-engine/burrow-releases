# Entities and scene

How a script reaches nodes of the scene: entity handles, components, transforms, spawning, searching and tags.

Every function here is a host call: it costs one call of the budget ([limits](09-errors-and-limits.md)) and returns an `*burrowsdk.Error` on failure, never a trap. The generated signature list is [reference/script-api.md](../reference/script-api.md); this page gives the semantics. Error codes: `1 INVALID`, `2 MEMORY`, `3 NOT_FOUND`, `4 TOO_SMALL` (handled by the SDK), `5 BUDGET`, `6 DENIED`, `7 UNAVAILABLE`, `8 REJECTED`, `9 LIMIT`. `burrowsdk.IsNotFound(err)` tests code 3.

## Entities

An `Entity` is a `uint64` handle to a scene node. The low 32 bits are the slot, the high 32 bits a generation, so a handle to a despawned node never matches a later node that reuses the slot. `0` means "no entity" (root parent, "everything" as an event target, "whole scene" as a search root).

| function | what it does | errors |
|---|---|---|
| `Self()` | the node that carries this script | none |
| `Exists(e)` | `true` for a live node, a handle returned by `Spawn` in this call, and not for a node despawned in this call | none (`false` on any failure) |

Rules:

* A handle is only meaningful inside the run that obtained it. Keeping an `Entity` in `State` between ticks is fine for ordinary nodes (it is a plain number), but check `Exists` before use: the node may be gone.
* A call on a dead or unknown handle fails with `NOT_FOUND`. `0` is never alive.
* `Spawn` returns a **pending handle**, valid only until the end of the call that created it. Never store it. See [Spawn and Despawn](#spawn-and-despawn).
* Node names are unique among siblings only, so a name does not identify a node globally; use a handle, a path or a tag.

## Components

Components are addressed by their schema name (`"transform"`, `"physics.body"`, `"tags"`, ...). The list with every field, range and default is [reference/components.md](../reference/components.md). `Registry("components")` lists the names a running game knows ([world](05-world.md#project-data-and-registries)).

| function | what it does | errors |
|---|---|---|
| `GetRaw(e, name)` | canonical JSON of the component | `NOT_FOUND` (dead entity, unknown name, component absent) |
| `Get[T](e, name)` | `GetRaw` + `json.Unmarshal` into `T` | as `GetRaw`; a decoding failure is a plain `error` |
| `SetRaw(e, name, json)` | attach or replace the whole component | `REJECTED`, `DENIED`, `NOT_FOUND`, `INVALID` |
| `Set[T](e, name, v)` | `json.Marshal` + `SetRaw` | as `SetRaw`; a marshal failure is a plain `error` |
| `Has(e, name)` | `true` when attached | none (`false` on any failure) |
| `Remove(e, name)` | detach the component | `DENIED`, `NOT_FOUND` |

Behaviour:

* **Immediate checks, deferred effect.** `SetRaw` validates the JSON against the schema at once and returns `REJECTED` on failure; the write itself is queued and applied when the script call commits. A fault drops it. `Remove` is queued the same way. The failure text of a rejection is shown in the console.
* **Reads see your own writes.** After `Set`, `Get` and `Has` in the same call return the new value, and after `Remove`, `Has` is `false` and `Get` is `NOT_FOUND`. Other scripts see the change from the next script run (the commit happens before the next script of the tick starts).
* **Set replaces the whole component.** Fields you leave out take the zero value of their type (only `transform` fills identity defaults: scale 1). For a partial change use [field access](#field-access).
* **Strict validation.** Unknown fields, a wrong JSON type, an out-of-range value and the component's own consistency rules (for example `physics.body` needs non-zero `half` for a dynamic body) all give `REJECTED`. The value must be a single JSON object.
* **Canonical output.** `GetRaw` returns the schema's own field order, with every field present.
* **Absent is not an error for `Remove`.** Removing a component the node does not have succeeds and does nothing.
* **Sizes.** A component name is 1..128 bytes (`INVALID` otherwise); one argument is at most 64 KiB (`MEMORY`). Bytes moved count against the per-call byte budget.

Components a script cannot write (in `SpawnOpts.Components` the same three names are refused with `REJECTED`):

| component | `Set` and field writes | `Remove` | `Get` / `Has` |
|---|---|---|---|
| `script` | `DENIED` (use `SaveState`) | `DENIED` | allowed |
| `script.input` | `DENIED` | `DENIED` | allowed |
| `transform` | allowed (see [Transforms](#transforms)) | `DENIED` | allowed |
| `scene.name`, `scene.parent`, `scene.children` | `REJECTED` (structural, not writable) | `DENIED` | `Get` returns the value, `Has` is `false` |

Names, parents and children cannot be changed after creation: there is no rename or reparent call. Spawn under the right parent and despawn to remove.

A component that exists in the schema only when a plugin is on (`physics3d.*`, `nav.*`, `ai.*`, `anim.player`, ...) is `NOT_FOUND` on `Get` and `REJECTED` on `Set` when the project does not enable that plugin.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type body struct {
	Kind string `json:"kind"`
	Half struct{ X, Y, Z float32 } `json:"half"`
	Mass float32 `json:"mass"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			if !burrowsdk.Has(self, "physics.body") {
				return
			}
			b, err := burrowsdk.Get[body](self, "physics.body")
			if err != nil {
				burrowsdk.Logf("get: %v", err)
				return
			}
			b.Mass *= 2
			if err := burrowsdk.Set(self, "physics.body", b); err != nil {
				burrowsdk.Logf("set: %v", err) // REJECTED: schema refused the value
			}
		},
	})
}

func main() {}
```

## Field access

Field calls read or write one value by path. A read costs a few microseconds against about a millisecond for a whole-component JSON round trip in Go-in-wasm, and a write sends only the change. Writes follow the same rules as `Set`: the whole resulting component is validated (`REJECTED` if invalid), queued, applied at commit, dropped on a fault. Reads see this call's writes. `script` and `graph_script` are `DENIED` for writes and readable.

| function | what it does | errors |
|---|---|---|
| `FieldRaw(e, comp, path)` | JSON text of the value | `NOT_FOUND`, `INVALID` (bad path) |
| `GetFloat` / `GetInt` / `GetBool` | number (bool as 0/1); `GetInt` truncates | as above, `INVALID` for a non-number |
| `GetString` | string value | as above, `INVALID` for a non-string |
| `GetFloats(e, comp, paths...)` | several numbers in one call, in order; `NaN` for a missing or non-numeric path | `INVALID`, `LIMIT` (more than 32 paths) |
| `GetFields(e, comp, paths...)` | several raw JSON values; `nil` for a missing path | `INVALID`, `LIMIT` (more than 32 paths) |
| `SetFieldRaw(e, comp, path, json)` | set one value from JSON text | `NOT_FOUND`, `REJECTED`, `DENIED`, `INVALID` |
| `SetFloat` / `SetInt` / `SetBool` / `SetString` | typed setters; `SetFloat` writes an integer when the value is integral | as above; `INVALID` for NaN or Inf |
| `Patch(e, comp, json)` | RFC 7386 merge patch of the component | `NOT_FOUND`, `REJECTED` (not a JSON object, or invalid result), `DENIED` |

Path syntax: dot separated keys with optional `[n]` indexes, `pos[1]`, `bodies[2].mass`, at most 256 bytes and 16 segments. An empty segment, a negative or non-numeric index is `INVALID`. Intermediate keys and indexes must exist, otherwise `NOT_FOUND`; the last key of a write may be new (the schema then accepts or rejects it). The component must be present on the node (`NOT_FOUND`); field writes never attach a component.

Merge patch: objects merge recursively, `null` deletes a key, anything else (including arrays) replaces the value.

Vector fields have two JSON shapes, and the path must match the shape:

| shape | where | path example |
|---|---|---|
| array `[x,y,z]` | `transform`, `camera_rig` (`offset`, `bounds`, ...) | `pos[1]` |
| object `{"X":..,"Y":..,"Z":..}` | fields typed `vec3` in `physics.body`, `physics.character`, `physics.velocity`, `nav.*`, `ai.perception` | `half.Y` |

Check with `GetRaw` when unsure. The typed vec3 accessors (see below) use the right form for each field; with `GetFloat` / `SetFloat` you choose the path yourself.

**Typed accessors.** `components_gen.go` holds one getter and one setter per scalar field of every built-in component, generated from the schema (`make sdk-gen`): `AiBrainInterval(e)`, `SetAiBrainInterval(e, v)`, `CameraRigFov(e)`, ... plus a `Comp<Name>` constant per component (`CompNavAgent`). Types: `string`, `int64`, `float64`, `bool`, `[3]float64` for vec3. They are thin wrappers over the calls above and obey the same errors. The full list is in [reference/script-api.md](../reference/script-api.md#components_gen). The vec3 accessors of object-shaped fields (`PhysicsBodyHalf`, `NavAgentVel`, ...) read the `.X`, `.Y`, `.Z` paths and write an object. Before this was fixed (0.2.2 and earlier) they used array paths and failed: reads gave NaN and writes were `REJECTED`.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			// one value, not the whole body
			m, err := burrowsdk.GetFloat(self, "physics.body", "mass")
			if err != nil {
				return
			}
			_ = burrowsdk.SetFloat(self, "physics.body", "mass", m+0.01)
			_ = burrowsdk.SetFloat(self, "physics.body", "half.Y", 0.5)       // object-shaped vec3
			_ = burrowsdk.Patch(self, "physics.body", []byte(`{"trigger":true}`))
			xs, _ := burrowsdk.GetFloats(self, "transform", "pos[0]", "pos[1]", "pos[2]")
			_ = xs
		},
	})
}

func main() {}
```

## Transforms

| function | what it does | errors |
|---|---|---|
| `GetTransform(e)` | local `Transform{Pos, Rot, Scale}` | `NOT_FOUND` |
| `SetTransform(e, t)` | replace the local transform (queued, applied at commit) | `NOT_FOUND`, `INVALID` (any NaN or Inf), `BUDGET` |

`Transform` holds three `[3]float32`:

| field | unit | meaning |
|---|---|---|
| `Pos` | blocks (1 voxel = 1 block) | position relative to the parent |
| `Rot` | degrees, `[pitch, yaw, roll]` = rotation about X, Y, Z | Euler angles |
| `Scale` | factor, 1 = unscaled | per axis |

* **Rotation order.** The matrix is `R = Ry(yaw) * Rx(pitch) * Rz(roll)` and the local matrix `T(Pos) * R * S(Scale)`: roll is applied first, then pitch, then yaw.
* **Local only.** The SDK has no world transform. A child's `Pos` is relative to its parent and rotates and scales with it. To get world coordinates, walk `Parent` and compose the transforms yourself, or keep such nodes at the root. Physics and voxel APIs use world coordinates.
* **Replace, not merge.** `SetTransform` writes all nine floats. A `Scale` of exactly `{0, 0, 0}`, which a literal `Transform{Pos: p}` holds, is written as `{1, 1, 1}` (older SDKs wrote scale 0 and made the node invisible). Any other scale, even one with a single `0` axis, is written as given. To hide a node use its render component.
* **Same data as the component.** `Get(e, "transform")` / `Set(e, "transform", ...)` and the field paths `pos[0]`, `rot[1]`, `scale[2]` read and write the same value, with the same read-your-writes view. The component JSON form is `{"pos":[x,y,z],"rot":[p,y,r],"scale":[x,y,z]}`; omitted fields default to `0, 0, 1`.
* **Bodies overwrite it.** A rigid body (`physics3d`) and a `physics.character` write the node's transform every tick they move, so a script that also sets it fights the simulation. Move bodies with velocity, intent or impulse ([world](05-world.md#physics-components-and-bodies)).
* **Pending handles.** On a node spawned in this call, `GetTransform` returns the identity until you call `SetTransform` on it; the `Transform` option passed to `Spawn` is applied at commit and is not visible to reads.

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
			t.Rot[1] += 90 * float32(dt) // 90 degrees per second of yaw
			t.Pos[1] += 0.5 * float32(dt)
			_ = burrowsdk.SetTransform(self, t)
		},
	})
}

func main() {}
```

## Spawn and Despawn

| function | what it does | errors |
|---|---|---|
| `Spawn(prefab, opts)` | queue a new node, return a pending handle | `NOT_FOUND` (unknown prefab or parent), `REJECTED`, `BUDGET` |
| `Despawn(e)` | queue removal of `e` and its whole subtree | `NOT_FOUND`, `BUDGET` |
| `SceneLoad(path)` | queue a `.voxscn` project file, instantiated under the root at commit | `DENIED` (unsafe path or not `.voxscn`), `NOT_FOUND` (unknown file), `REJECTED` (invalid document), `LIMIT` (> 8 MiB), `BUDGET` |

`SpawnOpts` (all optional, zero value = default):

| field | default | meaning |
|---|---|---|
| `Name` | `<prefab or "node">_<tick>_<your entity>_<n>` | node name; 1..128 bytes, valid UTF-8 in NFC form, no `/`, not `.` or `..`, no control characters |
| `Parent` | `0` = scene root | a live node or a pending handle from this call |
| `Transform` | identity (`pos 0, rot 0, scale 1`) | local transform; a non-nil value replaces all nine floats, so set `Scale` |
| `Components` | none | `name -> JSON`, validated like `Set`; `script` and `script.input` are refused |

Behaviour:

* **The node appears at commit**, after the call finishes without a fault. Until then no search sees it; scripts that run later in the same tick do see it.
* **The handle is call-local.** It lets you `Set`, `Remove`, `SetTransform`, `Despawn` or use the node as `Parent` of another `Spawn` or as an `Emit` target within the same call. Reads (`Get`, `Has`, `GetTransform`) of a pending node see only writes made through the handle in this call, not the options given to `Spawn`. The real entity is not returned: find it later by name, path or tag (give it a unique `Name` or a tag via `Components: {"tags": {"tags":["x"]}}`).
* **Validation split.** The call checks name syntax, the component JSON and the parent now. A sibling name clash, a parent that is gone, or a tree deeper than 4096 is only found at commit: it is reported as a non-fatal fault in the console, the node is not created, and later queued operations on its handle fail the same way. The rest of the call's queued effects still apply (commit is not rolled back by such failures). Use unique names (the default name is unique per script, tick and call).
* **Prefabs.** `prefab` names a scene document saved as `<name>.prefab` or `prefabs/<name>.prefab` in the project (so `Spawn("crate", ...)` loads `prefabs/crate.prefab`). The name may use letters, digits, `_ - . /` and no `..`; anything else, or a missing file, is `NOT_FOUND`. A prefab is read once and cached. The standard runners (`burrow run`, `burrowplay`, exported games, the editor Play mode) all load them; an embedding program can also fill `script.Plugin.Prefabs` or `PrefabSource` ([embedding](12-embedding-and-abi.md)). Before 0.2.2 the standard runners had no prefabs and only `""` (a bare node) worked. The prefab root takes `Name` and `Transform`; its child nodes keep the prefab's names.
* **Prefabs.** A spawned prefab keeps its root's scale: the spawn transform places it and its scale multiplies the root's. Without a `Name`, the node is named after the prefab file (`wolf_<tick>_<entity>_<n>` for `assets/prefabs/wolf.prefab`). A prefab counts as one spawn whatever its size, so an articulated model of many nodes is spawned as a prefab.
* **Limits.** 32 spawns per script call and 1024 per tick (`BUDGET`); at most 4096 queued operations per call (`BUDGET`).

**`SceneLoad(path)`** loads a whole scene document at once — the same journaled `scene_load` start-up command a `default_scene` uses, so a menu can hand over to the game (`burrowsdk.SceneLoad("scenes/game.voxscn")`). The path follows the `ReadAsset` rules (project relative, no `..`/absolute/backslash/hidden segment) and must end in `.voxscn`. The file is read **pinned by content hash** like `asset_read` — a replay loads the same document — and validated against the scene schema at call time, so a broken file is an error and nothing is committed. It instantiates under the **root** at commit (later scripts of the same tick see the nodes); its bytes, spawned nodes and one event count against the transaction budgets, and the gas is 200 + 1 per 64 bytes read.

**`SceneSwitch(path)`** replaces the whole running scene by another scene of the project, **world included**: every root is despawned, the base terrain is rebuilt from the target scene's world file (the `.voxworld` next to the scene: its seed, generator and voxel edits; the project's terrain when the scene has none), and the document is instantiated. The path rules, the pinned read and the schema validation are `SceneLoad`'s (an unsafe, missing, non-`.voxscn` or invalid path is an error and nothing happens). The scripts of the running scene get `on_destroy` when the request is accepted (like a despawn). The switch is one journaled command applied right after the tick (it carries the document and the world file, so a replay never reads the project); later scripts of the same tick still see the old scene, only the first request of a tick is served, and a second call in one invocation fails with a budget error. The player is put back at `runtime.start` (or above the terrain at the origin). Limits: the generators the game can rebuild are `heightmap`, `flat`, `biomes` and `empty`, and a scene keeps the project's generator when its world file records a "custom" one (it can then only have its own seed); a world file made with another generator or seed than the one the scene runs is refused (logged, nothing changes). A save made after a switch reloads into that scene (see [levels and saves](../levels-saves.md)). The camera history is cut (`FrameState.CameraCut`), so temporal anti-aliasing does not smear the old world into the new one.

`Despawn` removes the node and all descendants at commit. If the node or any descendant carries a script with an `OnDestroy` handler, that handler runs first (in the same commit, before removal, in tree order) and its own effects are committed; despawns requested from inside an `OnDestroy` do not run further `OnDestroy` hooks. Nodes removed by the engine, the editor or a level switch do not call `OnDestroy`. Despawning a handle spawned in the same call cancels the spawn. After `Despawn(e)`, `Exists(e)` is `false` and every search in the same call skips `e` and its subtree.

```go
package main

import (
	"encoding/json"
	"fmt"

	"burrow-engine/sdk/burrowsdk"
)

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			if burrowsdk.Tick()%20 != 0 {
				return
			}
			at, _ := burrowsdk.GetTransform(self)
			t := burrowsdk.Transform{Pos: at.Pos, Scale: [3]float32{1, 1, 1}}
			h, err := burrowsdk.Spawn("", burrowsdk.SpawnOpts{
				Name:      fmt.Sprintf("marker_%d", burrowsdk.Tick()),
				Transform: &t,
				Components: map[string]json.RawMessage{
					"tags": json.RawMessage(`{"tags":["marker"]}`),
				},
			})
			if err != nil {
				burrowsdk.Logf("spawn: %v", err)
				return
			}
			_ = burrowsdk.SetTransform(h, t) // the handle works within this call
			if old, ok := oldest(); ok {
				_ = burrowsdk.Despawn(old)
			}
		},
	})
}

func oldest() (burrowsdk.Entity, bool) {
	list, _, err := burrowsdk.FindTag("marker", 0)
	if err != nil || len(list) < 8 {
		return 0, false
	}
	return list[0], true
}

func main() {}
```

## Finding things

Queries read the **committed scene**: what earlier scripts of this tick left, minus nodes this call has despawned. Nodes spawned by this very call, and tags or components you set in this call, are not visible to them. Results are deterministic: children in child order; searches depth-first in child order from the roots in ascending entity-index order.

| function | what it does | errors |
|---|---|---|
| `FindByName(name)` | first node with that name, depth-first from the roots | `NOT_FOUND`, `INVALID` (empty or over 1024 bytes) |
| `FindByPath(path)` | node at a slash path such as `world/tower/top`; a leading `/` is ignored | `NOT_FOUND`, `INVALID` |
| `ScenePath(e)` | slash path of `e` (a root is just its name) | `NOT_FOUND` |
| `Parent(e)` | parent of a committed node, `0` for a root | `NOT_FOUND` (dead or pending handle) |
| `Children(e)` | children in child order, at most 4096 | `NOT_FOUND` |
| `FindWith(component, root)` | nodes under `root` carrying the component | `NOT_FOUND` (unknown component or dead root), `INVALID` (empty or over 128 bytes) |
| `FindTag(tag, root)` | nodes under `root` carrying the tag | `INVALID` (bad tag syntax), `NOT_FOUND` (dead root) |

`root = 0` searches the whole scene; a non-zero root is included in the search and its subtree walked. `FindWith("transform", 0)` returns every node.

**Bounds and truncation.**

* `MaxQueryResults = 4096`. `FindWith` and `FindTag` return `truncated = true` when more than 4096 nodes match, or when the scan hit its cap of 100,000 nodes before finishing; the matches found so far (at most 4096, in search order) are returned. `Children` also stops at 4096 but does not report truncation.
* A search stops after **100,000 nodes scanned** and returns what it found so far; this limit is not reported in `truncated`. Scenes that large need narrower roots.
* `FindByName` and `FindByPath` do not see nodes spawned in this call and skip nodes despawned in it.

**Cost.** Every query is charged deterministic gas on top of its call:

| call | gas |
|---|---|
| `Parent` | 4 |
| `Children` | 8 + 1 per child |
| `ScenePath` | 8 + 1 per 8 bytes of path |
| `FindWith`, `FindTag` | 16 + 1 per node scanned |

The SDK starts with room for 64 results and retries with 256, 1024, then 4096 when more matched, so a search with many results scans up to four times. Run a search once, keep the result in `State` or a local, and avoid scanning the whole scene every tick.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			coins, truncated, err := burrowsdk.FindTag("coin", 0)
			if err != nil {
				burrowsdk.Logf("find: %v", err)
				return
			}
			kids, _ := burrowsdk.Children(self)
			path, _ := burrowsdk.ScenePath(self)
			parent, _ := burrowsdk.Parent(self)
			burrowsdk.Logf("%s (parent %d): %d children, %d coins, truncated %v", path, parent, len(kids), len(coins), truncated)
			if door, err := burrowsdk.FindByPath("world/door"); err == nil {
				_ = burrowsdk.AddTag(door, "interactive")
			}
		},
	})
}

func main() {}
```

## Tags

Tags label nodes so scripts find groups without knowing names. They live in the scene component `tags`, which is an ordinary component: saved with the scene, editable in the inspector, hashed.

| function | what it does | errors |
|---|---|---|
| `TagsOf(e)` | sorted tags of `e`; `nil` when the component is absent or on any error | none |
| `HasTag(e, tag)` | whether `e` carries the tag | none |
| `AddTag(e, tag)` | add a tag (no-op if present) | `REJECTED` (invalid tag or more than 16), `NOT_FOUND` |
| `RemoveTag(e, tag)` | remove a tag (no-op if absent) | `NOT_FOUND` |

* A tag is `[A-Za-z0-9_.:/-]{1,32}` (letters, digits and `_ . : / -`), at most **16 per node**. The stored list is sorted and unique.
* `AddTag` and `RemoveTag` read and rewrite the whole `tags` component, so they follow `Set`: validated now, applied at commit, readable by `TagsOf` in the same call, and visible to `FindTag` only after the commit.
* `FindTag` with an invalid tag string fails with `INVALID`; `AddTag` with one fails with `REJECTED`.
* Tags can also be set in `SpawnOpts.Components` and in the scene file (`"tags": {"tags": ["coin"]}`).

## See also

* [Execution model](02-execution-model.md): transactions, commit order, faults.
* [State and props](03-state-and-props.md): what to keep between ticks.
* [Errors and limits](09-errors-and-limits.md): error codes, budgets, gas.
* [World](05-world.md): voxels, physics queries, navigation, levels.
* [Input, events and time](06-input-events-time.md): events to entities, timers.
* [reference/script-api.md](../reference/script-api.md) and [reference/components.md](../reference/components.md): generated lists.
