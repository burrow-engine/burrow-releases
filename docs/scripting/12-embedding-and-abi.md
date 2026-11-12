# Embedding and the ABI

The host side of scripting: running the runtime in your own program, and the plain-words contract for writing guests in a language other than Go. Everything the `burrowplay` game window does for you is described here so it can be done by hand.

## The pieces

| piece | package | role |
|---|---|---|
| `script.Runtime` | `burrow-engine/script` | compiles, meters and runs modules; content-addressed module store; safe for concurrent use. One per `App`, shared with replays |
| `script.Plugin` | same | installs the `script` / `script.input` / `tags` components, the journaled commands, the fixed system `script.run` and the frame systems that bind, reload and journal input |
| `script.Config` | same | limits and budgets of a runtime (zero value is usable) |
| host function registry | `burrow-engine/script/api` | every `vox` function once (name, params, doc, category, gas); read by tools |

## Config

`script.NewRuntime(script.Config{})`. Every field, with its default. Zero means default.

| field | default | meaning |
|---|---|---|
| `Interpreter` | false | wazero interpreter instead of the compiler (about 30 us per script call instead of 1.5-11; for platforms without a compiler backend). Same results |
| `MemoryPages` | 512 | 64 KiB pages per instance (32 MiB). A Go guest's post-init image is about 100-200 pages |
| `MaxModuleBytes` | 8 MiB | largest `.wasm` accepted |
| `MaxModules` | 256 | distinct module versions kept loaded; the oldest version that is neither pinned nor registered by name is evicted (`Stats.Evicted`) |
| `GasPerInvocation` | 50,000,000 | deterministic instruction budget per guest entry call; exhaustion is a fault |
| `Watchdog` | 0 (off) | wall-clock limit per call. Not deterministic: a trip journals `script_disable`, and the tick in which it fired may not replay identically. Costs about 10 us per call. Gas is the real bound |
| `MaxFaults` | 3 | faults before a script is disabled until its module changes |
| `PerScript`, `PerTick` | below | `Budget` per transaction and per tick across all scripts |
| `StrictWASI` | false | reject modules importing any WASI function beyond the startup set |
| `NoWriteTracking` | false | skip store instrumentation; resets compare all memory (slower resets, faster guest code). Same results |
| `Limits` | 512 nesting, 100k functions, 8M instructions, 2 MiB per function | structural caps checked before compilation (`gas.Limits`) |
| `LoadTimeout` | 120 s | validation plus compilation of one module; longer is rejected and remembered as bad |
| `PoolSize` | 8 | idle instances kept per module |

`Budget` fields, per transaction / per tick: `Calls` 1,000 / 200,000; `Bytes` 1 MiB / 64 MiB; `Spawns` 32 / 1,024; `VoxelEdits` 4,096 / 262,144; `Events` 64 / 4,096 (events cover `Emit`, `Publish` and every [effect request](07-effects.md)). What each limit means for authors: [errors and limits](09-errors-and-limits.md).

**Result-affecting fields.** `GasPerInvocation`, `MemoryPages`, `MaxFaults`, both budgets, `StrictWASI` and `MaxModuleBytes` are folded into `Runtime.Fingerprint()`. Each script remembers it when bound; restoring or replaying under a different fingerprint fails instead of diverging. Keep these identical between a recording and its replay.

## Modules

| call | does |
|---|---|
| `rt.Load(wasm) (*Module, error)` | validate, instrument and compile; idempotent per content hash; failed loads are cached by hash |
| `rt.Register(name, wasm) (hash, error)` | `Load` plus a name: a `script` component with `"module": "name"` binds to it |
| `rt.Hashes()` | hashes of all loaded versions: with the journal, the replay identity of the module set |
| `rt.Pin(hash)` / `rt.Unpin(hashes...)` | protect a version from eviction; the plugin pins every version it journals. `Unpin` versions older than your latest snapshot. When everything is pinned and `MaxModules` is reached, `Load` fails with an `Unpin` hint |
| `rt.Loader()` | the `assets.Loader` for `.wasm` files (register it in `assets.Options.Loaders`): path and GUID modules, hot reload |
| `script.Inspect(wasm, cfg)` | load in a throw-away runtime and report entries, imports, gas sites, memory (what `check` prints) |

**Resolution** of `script.module`: first names registered on the runtime, then the asset database (GUID or project path). The engine writes the content hash into the component (`script_bind`, journaled), so replays use the bytes the journal names. Replaying a state whose module the runtime lacks fails the tick with an error naming the hash; it never skips. A changed `.wasm` asset recompiles and is applied at the next tick boundary (`script_module_changed`, journaled), clearing the fault count; a broken new file keeps the old module. Hot reload is off in multiplayer ([multiplayer](08-multiplayer.md)).

## Plugin

```go nocheck
&script.Plugin{Runtime: rt, Prefabs: prefabs, ReadAsset: read, PauseOnFault: true}
```

| field | default | meaning |
|---|---|---|
| `Runtime` | nil: a new runtime from `Config`, closed on cleanup | share one runtime across an app and its replays |
| `Config` | zero | used only when `Runtime` is nil |
| `Prefabs` | none | prefabs `Spawn(name, ...)` can instantiate |
| `PrefabSource` | none | `func(name string) ([]byte, error)` that serves `.prefab` bytes for a name `Prefabs` lacks (the game and the editor use the project's `<name>.prefab` and `prefabs/<name>.prefab`); results are cached |
| `ReadAsset` | the `*assets.DB` resource, if present | serves `ReadAsset` (project data files) |
| `PauseOnFault` | false | pause the simulation (`SetPausedBy("script.fault")`) when a script faults, so you can inspect it. Frame domain, replays unaffected |

**Order.** The plugin fails to build (`script: needs the scene; add &engine.ScenePlugin{} before script.Plugin`) unless `ScenePlugin` came first. Add `input`, `physics` and `physics3d` plugins before it: when `physics` is present `script.run` is ordered before `physics.character`, and when `input` is present the input snapshot system runs after `input.poll`. `netsim.Plugin` (multiplayer registry), nav, levels, saves, assets, audio, particles, camera and gameui plugins may come in any order: the plugin looks up levels, saves and the asset database after every plugin has built. The standard `game` assembly adds scene, net, window, assets, voxel world, fluid, input, physics, physics3d, nav, weather, then scripts, then render, audio, particles, camera, gameui, levels, saves.

**Prefabs.** `Prefabs` is a `map[string]*scene.Prefab`; build entries with `scene.LoadPrefab(voxscnBytes, schema)`, or set `PrefabSource` to load them on demand. A prefab is the only way for a script to spawn a node that carries a `script` component: `Spawn` with a `script` component in `SpawnOpts.Components` is `DENIED` (`script`, `script.input` and `graph_script` are protected). The `burrowplay` / `burrow run` game assembly and the editor set `PrefabSource` to the project's `<name>.prefab` and `prefabs/<name>.prefab` files.

## Example: run headless and read the hash

Two runs of the same program give the same `StateHash`, and a journal replay gives it again. `Seed` and `StrictCommands` (a failed command is an error, not a log line) are what tests usually want.

```go
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"burrow-engine/engine"
	"burrow-engine/mathx"
	"burrow-engine/scene"
	"burrow-engine/script"
)

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func main() {
	rt, err := script.NewRuntime(script.Config{})
	check(err)
	defer rt.Close()
	wasm, err := os.ReadFile("assets/scripts/spin.wasm")
	check(err)
	hash, err := rt.Register("spin", wasm) // scenes may now say "module": "spin"
	check(err)

	app := engine.New(engine.Options{Seed: 1, StrictCommands: true})
	app.AddPlugin(&engine.ScenePlugin{})
	app.AddPlugin(&script.Plugin{Runtime: rt})
	check(app.Build())

	tr := scene.IdentityTransform()
	tr.Pos = mathx.Vec3{X: 4, Y: 3, Z: 4}
	check(app.Do(scene.SpawnNode{Name: "spinner", Transform: &tr}))
	comp := fmt.Sprintf(`{"module":"spin","hash":%q,"props":{"speed":90}}`, hash)
	check(app.Do(scene.SetComponent{Path: "spinner", Name: script.CompScript, Data: json.RawMessage(comp)}))

	check(app.RunHeadless(100))
	fmt.Printf("tick=%d StateHash=%016x faults=%d\n", app.Tick(), app.StateHash(), rt.Stats().Faults)
	check(app.VerifyReplay())
}
```

Putting the hash in the component pins the module for the journal. Without `hash` the plugin binds the module at the next frame with a journaled `script_bind`, which also works. Complete demo with seven scripts, built on the fly and run twice: `go run ./examples/scripting_demo`.

Reading results: `rt.Stats()` (invocations, faults, gas, budget denials, evictions), `rt.Profile()` per script entity ([debugging](10-debugging-and-testing.md)), the `*script.Console` resource (log lines and faults with guest stack), `ScriptFault` events.

## Writing a guest in another language

The raw contract is [script/ABI.md](../../script/ABI.md) (version 1, normative; the host-function table in it is what [Script API](../reference/script-api.md) is generated from). In plain words:

**Module shape.**

* A WebAssembly 2.0 core module (bulk memory, sign extension, multi-value and so on; **no SIMD, threads or tail calls**). It must be valid on its own.
* Imports: only module `vox` (the host functions; the name predates the engine rename and is part of the ABI) and a few WASI stubs. Any other import module (`env`, `gojs`, ...) is refused at load with a hint.
* Exports: `memory` (required); `vox_abi_version: () -> i32` returning `1` (required); at least one of the entry points below; `vox_alloc` if you export `on_event`; `_initialize: ()` optional (run once at load). `_start` (a command build) is refused.
* No hidden state: a module that mutates tables or drops segments (`table.set/grow/fill/copy/init`, `data.drop`, `elem.drop`) is rejected.

| entry export | signature | called |
|---|---|---|
| `on_start` | `(entity i64)` | first tick of the script |
| `on_tick` | `(entity i64, dt_millis i32)` | every tick, `dt_millis` is always 50 |
| `on_event` | `(entity i64, kind i32, payload_ptr i32, len i32)` | each pending event (`emit_event`, bus messages, fired timers) before `on_tick`; sender from `event_from()` |
| `on_destroy` | `(entity i64)` | the entity is despawned by a script |
| `vox_alloc` | `(size i32) -> i32` | the host writes an event payload at the returned address |

**Memory.** Before every call the instance memory and mutable globals equal the image taken after `_initialize`. Nothing you store survives; persist through `state_set` (64 KiB, replaces `Script.State` at commit) and components. A module whose memory grew during a call is discarded afterwards, so reserve what you need before the image is taken (the Go SDK pre-grows 8 MiB).

**Calls.** Pointers and lengths are `i32`; strings are UTF-8, not NUL-terminated; one argument is at most 64 KiB, component names at most 128 bytes. A function returns `>= 0` on success and `-code` on failure, never a trap for bad input. `i64`-returning functions return a negative error too. Output buffers are `(out_ptr, cap)`: the result is the length written, or `-4` and `last_required()` tells the size needed. Entity handles are `i64`; 0 is none.

| code | name | meaning |
|---|---|---|
| 1 | `INVALID` | bad value (NaN, out of range, unknown block id, empty name) |
| 2 | `MEMORY` | pointer or length outside guest memory, or over the argument cap |
| 3 | `NOT_FOUND` | entity, component, block or action does not exist |
| 4 | `TOO_SMALL` | output buffer too small, see `last_required` |
| 5 | `BUDGET` | call, byte, spawn, edit or event budget exhausted |
| 6 | `DENIED` | not allowed for scripts (the `script` component, hidden asset paths) |
| 7 | `UNAVAILABLE` | subsystem not installed, or called outside a tick (during `_initialize`) |
| 8 | `REJECTED` | JSON or schema validation failed |
| 9 | `LIMIT` | a size cap hit (state, props, payload, inbox, timers) |

**Determinism for non-Go guests.** The WASI clock is `tick*50ms`; `random_get` is a fixed stream seeded by the module hash; use `rand_u64` for gameplay randomness. Floats are IEEE and deterministic except NaN payload bits: host floats are canonicalised (any NaN becomes `0x7fc00000`) and non-finite values are refused by `transform_set`, `raycast` and others. Never store raw NaN bits in state.

**ABI versioning.** `vox_abi_version()` must equal the host's `script.ABIVersion` (1), otherwise the load fails (`guest ABI version N, host speaks 1`). Within a version the ABI is additive: functions are added, never changed. A module that imports a function this engine does not have fails to load ("built against a newer SDK") and a signature mismatch fails with both signatures shown. A module built against an older SDK keeps working.

## Checking a module

```sh
burrow script check [dir|file.wasm]     # one file, or every module under dir/assets
burrowscript check [-max-bytes N] [-strict-wasi] file.wasm
```

`check` loads the module in a throw-away runtime with the same validation as the game. Output on success (exit 0): `OK`, the ABI version, size and content hash, entry points present, the `vox` imports used, the WASI stub count, metering (gas checks and tracked stores), a warning for imports unknown to this engine, and memory pages (the reset image size). On failure it prints `FAIL <file>: <reason and hint>` and exits 1 (2 for a usage error). `-max-bytes` overrides the size cap and `-strict-wasi` also rejects the inert WASI imports. `burrow script build` runs the same check on every module it compiles; `burrowscript build [-o out.wasm] [-debug] dir` is the underlying compile (`GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared`, Go 1.24+; `-debug` keeps function names for fault traces).

## Packing

`burrow build --pak game.voxpak` (or a packed executable or app) stores `vox.project`, every file under `asset_dirs` (compiled `.wasm` included), the default scene, input map and world overlay. Files are stored or zlib-compressed with a SHA-256 each, paths are sorted and the whole archive is hashed, so building twice gives identical bytes. Stale script sources are rebuilt first (`--no-scripts` on `burrow run` skips it). A Go module is about 4 MiB and about 1 MiB in the pak. The pak is untrusted data on load (size, ratio and path caps, no symlinks, a private 0700 extraction directory); the modules inside stay sandboxed. Modules are pinned by content hash, so a pak replays exactly what was recorded.

## Sandbox facts

* No files, sockets, threads, clocks or real randomness. The only imports are `vox` and inert WASI stubs: `args_*` and `environ_*` (empty), `clock_time_get` (tick based), `random_get` (fixed stream), `fd_write` on 1 and 2 (captured into fault text), `poll_oneoff` (returns at once), `sched_yield`, `proc_exit` (a fault). Go programs also link the rest of preview1 through `os` and `fmt`; those functions exist but always fail (`EBADF` / `ENOSYS`; no preopened directories). `StrictWASI` rejects even those.
* Gas is injected into the module before compilation, so a runaway loop traps at the same instruction on every machine. Memory, module size, call, byte, spawn, edit and event budgets are all enforced by the host ([errors and limits](09-errors-and-limits.md)).
* A fault (trap, gas, panic, `proc_exit`, memory) drops the transaction's buffered effects, raises a `ScriptFault` event, and after `MaxFaults` disables the script until its module changes. The engine never crashes because of a script.
* **Native build.** The same SDK also runs in-process: outside `GOOS=wasip1`, `sdk/burrowsdk/abi` forwards every call to the host installed with `abi.SetHost` (`script.Runtime` does this for natively linked modules, see [Native scripts](15-native.md)); without a host each call returns `ErrUnavailable`. `abi_stub.go` is generated from `abi_wasip1.go` (`go run gen_native.go` in that directory); a test keeps them in sync.
* Scripts are trusted at **build** time (the Go toolchain runs on your project's source) and sandboxed at **run** time: see [security](../security.md).

## See also

* [Execution model](02-execution-model.md), [errors and limits](09-errors-and-limits.md), [debugging and testing](10-debugging-and-testing.md).
* [Multiplayer](08-multiplayer.md): what changes with `runtime.plugins.net`.
* [ABI.md](../../script/ABI.md), [Script API](../reference/script-api.md), [CLI reference](../reference/cli.md).
* [Security](../security.md), [Determinism](../determinism.md), [Getting started](../getting-started.md): building a `.voxpak`.
