# State and props

Guest memory is wiped before every call, so a script keeps data in components: `Props` for read-only designer settings, `State` for its own memory, and other components or the save data for everything shared.

## Where to keep what

| Need | Use | Writable by the script | Size limit | Saved with the game, snapshotted, hashed |
|---|---|---|---|---|
| Designer settings (speed, block name, radius) | `Props` | no | 16 KiB | yes |
| The script's own memory between calls | `State` | yes, own node only | 64 KiB | yes |
| Data other scripts or the editor should see | an existing component (`Get`/`Set`, field setters, `tags`) | yes (except protected ones) | schema | yes |
| Game-wide values (score, flags, unlocked items) | `SaveSet` / `SaveGet` (plugin `runtime.plugins.saves`) | yes | 1024 keys, 64 KiB per value, 1 MiB total | yes |
| Timers and subscriptions | `After`, `Every`, `OnMessage` (stored in the `script` component) | through the API | 64 timers, 32 topics | yes |
| Static game tables (items, recipes) | project data files read with `ReadAsset` | no | 256 KiB per file | pinned by content hash |
| Cache that can be recomputed | nothing: recompute it, or keep it in State | | | |

Globals, closures and heap values live for one call only. Even `OnStart` and `OnTick` of the same tick do not share them; they share State, because `SaveState` is visible to later calls of the same transaction.

> With the opt-in `keep_memory` ([execution model](02-execution-model.md#persistent-memory-keep_memory)) Go globals persist between ticks in single-player games, but are lost on fault, hot reload and save load: keep what must survive in `State`.

## Props

`Props` is the `props` field of the `script` component: one JSON object per node, edited in the inspector or in the scene file.

```json
"script": { "module": "assets/scripts/painter.wasm", "props": { "block": "wood", "every": 3, "len": 18 } }
```

| Rule | Detail |
|---|---|
| Limit | 16,384 bytes of JSON after canonicalisation. A larger value is refused when the component is set or the scene loads: `script props are 17008 bytes, limit 16384`. |
| Shape | Any JSON value is accepted by the component, but `Props[T]` decodes into your type, so use an object. `null` or absent means "no props". |
| Canonical form | Keys are sorted and whitespace removed; numbers keep their written text (`90` stays `90`, `1e2` stays `1e2`). Equal settings hash equally. |
| Read | `Props[T]()` decodes into `T`; empty props give the zero `T` and a nil error; a shape mismatch returns the JSON error and a partly filled value. `PropsRaw()` returns the bytes. `props_get` does not use up the call budget. |
| Write | Never. A script that sets the `script` component gets `ERR_DENIED` (6), as for `script.input`. |
| Change | Edit in the inspector or the scene file. Edits made during Play are discarded by Stop, like every other change. |

Use pointer-free structs with JSON tags and give every field a sane zero value, because a missing key leaves the field at zero:

```go
package main

import "burrow-engine/sdk/burrowsdk"

type props struct {
	Block string  `json:"block"`
	Every int     `json:"every"`
	Speed float32 `json:"speed"`
}

func (p props) withDefaults() props {
	if p.Every <= 0 {
		p.Every = 3
	}
	if p.Speed == 0 {
		p.Speed = 1
	}
	return p
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			p, err := burrowsdk.Props[props]()
			if err != nil {
				burrowsdk.Logf("bad props: %v", err)
				return
			}
			p = p.withDefaults()
			if burrowsdk.Tick()%uint64(p.Every) == 0 {
				burrowsdk.Logf("block %q speed %v", p.Block, p.Speed)
			}
		},
	})
}

func main() {}
```

Decoding costs: `Props[T]` runs `encoding/json` inside the guest on every call that asks. The `spin` script (decode one field, read and write the transform) uses about 480,000 gas per tick, roughly 1% of the default 50,000,000; heavier JSON costs more, and [script/ABI.md](../../script/ABI.md) measures about 1.4 ms of wall time per JSON-using call on an Apple M2 Max. If the props are large, decode them once in `OnStart` and keep what you need in State (props edited later are then ignored), or parse with `PropsRaw()` yourself.

## State

`State` is an opaque byte string (`state` in the component, base64 in scene files). The SDK stores JSON by default; a binary codec is also available.

| API | Does |
|---|---|
| `LoadState[T]()` | Decodes the JSON state into `T`. Empty state (first call) returns the zero `T` and a nil error. |
| `SaveState(v)` | `json.Marshal(v)` then `SetStateRaw`. Pass a pointer when you `defer` it (see below). A marshal error (NaN, unsupported type) is returned and the state is left unchanged. |
| `StateRaw()` / `SetStateRaw(b)` | The bytes. `SetStateRaw` fails with `ERR_LIMIT` (9, `burrow state_set: limit exceeded (9)`) above 65,536 bytes; the old state stays. |
| `Writer` / `Reader` | Compact little-endian codec, no reflection (below). |

Semantics:

* A write is visible at once to `LoadState`/`StateRaw` in later hooks of the same transaction, and persisted at commit. If the transaction faults, the old state stays and the `OnStart`/events are retried next tick.
* Persisted only when the bytes changed. The raw bytes are hashed into `StateHash`, so a byte difference is a determinism difference.
* It is snapshotted, restored by undo and Stop, written into save games and rolled back with the tick, with no work from the script.
* Hot reload keeps it. The new module sees the old bytes ([migration](#changing-the-state-format)).
* `state_get` and `state_set` are free calls (they do not use the host-call budget) but their bytes count against the 1 MiB per transaction copy budget.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Version int  `json:"v"`
	WasDown bool `json:"was_down"`
	Presses int  `json:"presses"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, err := burrowsdk.LoadState[state]()
			if err != nil {
				st = state{} // unreadable state: start over
			}
			st.Version = 1
			defer burrowsdk.SaveState(&st) // pointer: saves the value as it is when OnTick returns

			x, _, ok := burrowsdk.Action("jump")
			down := ok && x > 0.5
			if down && !st.WasDown { // derive edges from your own State
				st.Presses++
				burrowsdk.Logf("jump pressed %d times", st.Presses)
			}
			st.WasDown = down
		},
	})
}

func main() {}
```

`defer burrowsdk.SaveState(st)` with a value saves the copy taken when `defer` ran, before your changes. Use `&st`, or call `SaveState` explicitly at each exit.

### JSON rules and gotchas

| Topic | Rule |
|---|---|
| Types that work | Structs (exported fields only), maps with string or integer keys (written in sorted key order, so the bytes are deterministic), slices, arrays, strings, bools, all integer and float types, pointers, `json.RawMessage`, `burrowsdk.Entity`, `burrowsdk.Tween`, `burrowsdk.Cooldown`. |
| Types that fail | `chan`, `func`, `complex`, cyclic pointers: `SaveState` returns the error. `time.Time` marshals but is meaningless here. |
| Field tags | `json:"name"` sets the key; `omitempty` drops zero values; `json:"-"` skips a field. Unexported fields are silently not saved. |
| Missing and unknown keys | A missing key leaves the field at its zero value; an unknown key is ignored. This makes adding fields safe. Renaming or retyping a field loses data or returns a decode error. |
| Floats | `float32` and `float64` round-trip exactly. NaN and Inf cannot be encoded (`json: unsupported value`): the save fails and the old state stays. Clamp or `CanonF32` values that may be NaN. |
| Integers | `int` is 64-bit in the guest. Typed integer fields keep all 64 bits. Through `any` or `map[string]any` numbers decode as `float64` and lose precision above 2^53 (entity ids are 64-bit): use typed fields. |
| `[]byte` | Encoded as base64 (33% larger). |
| Maps | `range` order is unspecified: copy the keys to a slice and sort before you act on them. (Marshalling sorts keys for you.) |
| Cost | Marshal plus unmarshal of a small struct is millions of gas. A full 64 KiB state costs much more. Keep State small, or use `Writer`/`Reader`. |
| Size | JSON is verbose. Check `len(burrowsdk.StateRaw())` while developing; 64 KiB is a hard limit. |

### Binary state

`Writer` and `Reader` skip reflection and JSON, so they avoid the roughly 1.4 ms a JSON decode costs inside the guest, and allocate one buffer. Supported: `U8`, `Bool`, `U32`, `I32`, `U64`, `F32` (NaN canonicalised), `String` (u32 length prefix). There is no `F64`; store `math.Float64bits` with `U64`. `Reader` returns zeros and sets `Err` on short input, so an empty first-call state decodes to all zeros.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			r := burrowsdk.NewReader(burrowsdk.StateRaw())
			count := r.U32()
			lastTick := r.U64()
			first := r.Err // true on the very first call: nothing was stored yet
			count++

			var w burrowsdk.Writer
			w.U32(count).U64(burrowsdk.Tick())
			if err := burrowsdk.SetStateRaw(w.Bytes()); err != nil {
				burrowsdk.Logf("save: %v", err)
			}
			if !first && count%100 == 0 {
				burrowsdk.Logf("100 more ticks, last was %d", lastTick)
			}
		},
	})
}

func main() {}
```

Do not mix codecs on the same node: `LoadState` on binary bytes returns a JSON error.

### Changing the state format

The module can change while State stays (hot reload, a new game version loading old saves). The new code must read the old bytes.

1. Add a version field first (`Version int` in JSON; a leading `U8` in binary), starting at 1.
2. Only add fields (they decode as zero in old data) and handle old versions explicitly:

   ```go nocheck
   st, err := burrowsdk.LoadState[state]()
   if err != nil {
       st = state{}            // unreadable: reset
   }
   switch st.Version {
   case 0, 1:                  // 0 = first run or written before versioning
       st.Name = "default"     // field added in version 2
       st.Version = 2
   }
   ```

3. Binary: append new fields at the end and read them after the old ones; an old, shorter blob sets `Err` and yields zeros for the new fields.
4. To drop State altogether, `SetStateRaw(nil)`.

Hot reload clears the fault counter and the `disabled` flag but does not reset State or `started`, so `OnStart` does not run again after a rebuild.

## Other components as storage

* `Get[T]`, `Set[T]`, `GetRaw`, `SetRaw`, `Has`, `Remove` and the field accessors (`GetFloat`, `SetString`, `Patch`, ...) work on any node and any registered component; `Registry("components")` lists them. Writes are validated against the component schema and applied at commit.
* There is no free-form "data" component: you cannot invent component names. Store private data in State, shared data in an existing component that fits (`tags` for labels, `physics.velocity`, `nav.target`, ...), or in the save data.
* Protected components that a script can read but never write, remove or spawn with: `script`, `script.input` (`ERR_DENIED`). Also protected against removal: `transform`, `scene.name`, `scene.parent`, `scene.children`.
* Another node's State is not reachable: it lives in its `script` component. Exchange data with `Emit` (to one node or all) or `Publish` on a topic instead.
* Save data (`SaveSet(key, val string)`, `SaveGet`, `SaveDelete`) is global to the game, shared by all scripts, hashed and rolled back with the world. Keys match `[A-Za-z0-9_.:/-]{1,128}` (`ERR_INVALID` otherwise); a value over 64 KiB is `ERR_MEMORY` (the per-argument cap); it is `ERR_UNAVAILABLE` without `runtime.plugins.saves` and in the editor's Play mode. Writes are visible to your own `SaveGet` at once and to others after commit. Encode structured values as JSON strings.

## Module pinning

A node records the content hash of the module it runs in `hash` (`sha256:<hex>`), part of `StateHash`.

* The first time a node is seen without a `hash`, the engine resolves `module` and queues a journaled bind command that stores the hash and a fingerprint of the runtime configuration. Do not write `hash` by hand in scenes.
* A replay re-executes every script with the module whose hash the journal names. The runtime keeps module versions by content (at most 256; versions the journal needs are pinned and never evicted).
* When a `.wasm` file changes under the editor, a journaled `script_module_changed` command re-pins every node with that `module` to the new hash on a tick boundary, re-enables them and clears their fault count. A file that fails to load keeps the old module.
* Restoring a snapshot or a save into a runtime that does not have the module named by a node's hash fails the next tick with an error naming the hash. Rebuilding a script therefore changes the game's identity: version your saves (`Plugin.GameVersion` and `Migrate` in [levels and saves](../levels-saves.md)) and keep State changes backward compatible.
* A game build registers the modules at start and has no hot reload, so a running game never changes a node's module.
* `Script.Cfg` fingerprints gas, memory, budgets, `MaxFaults`, WASI strictness and module size cap; a replay under another configuration fails instead of diverging ([host tuning](09-errors-and-limits.md#tuning-the-limits-on-the-host-side)).

## See also

* [Execution model](02-execution-model.md): reset, transactions, what survives a fault.
* [Errors and limits](09-errors-and-limits.md): `ERR_LIMIT`, budgets, byte counts.
* [Debugging and testing](10-debugging-and-testing.md#faq): "my global variable resets", "Props decode is slow".
* [Entities and scene](04-entities-and-scene.md): component access, field accessors, tags. [Cookbook](11-cookbook.md): state patterns.
* [Components reference: script](../reference/components.md#script), [script API: codec and data](../reference/script-api.md#codec).
