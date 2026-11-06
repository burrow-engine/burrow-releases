# Errors and limits

Every error code a host call can return, every limit with its default and what happens when a script exceeds it, and how faults, rollback and disabling work.

## Two kinds of failure

| | Error value | Fault |
|---|---|---|
| What | A host call refused the request and returned a code | The call stopped: trap, panic, gas, memory |
| Script sees | `*burrowsdk.Error` (or `ok == false`) and keeps running | Nothing: the call ends |
| Effects of the transaction | kept | all dropped |
| Counted against the script | no | yes, 3 faults disable it |

Bad input, missing things and exhausted budgets are error values, never traps.

## Error values

Host calls return a negated code; the SDK turns it into `*burrowsdk.Error{Op, Code}`. `Op` is the host function (`voxel_set`), `Code` is the positive number. `Error()` reads `burrow voxel_set: invalid argument (1)`.

| Code | Constant (`abi.Err...`) | Meaning | Typical causes |
|---|---|---|---|
| 1 | `ErrInvalid` | bad value | NaN or Inf, coordinate beyond +-16,777,216, unknown block id, empty or over-long name, invalid tag or topic, negative slack, bad log level, field path too long |
| 2 | `ErrMemory` | pointer or length outside guest memory, or one argument over 64 KiB | a value or payload larger than 64 KiB |
| 3 | `ErrNotFound` | no such entity, component, block name, action, field, timer, file | stale entity id, missing component, unknown block name, missing key |
| 4 | `ErrTooSmall` | output buffer too small | handled for you: the SDK retries up to 3 times with the size from `last_required`; seen only when a result keeps growing |
| 5 | `ErrBudget` | a per-transaction or per-tick budget is exhausted | too many host calls, voxel edits, spawns, events, asset reads, bytes, or 4,096 buffered operations |
| 6 | `ErrDenied` | not allowed for scripts | writing or removing `script` and `script.input`; removing `transform`, `scene.name`, `scene.parent`, `scene.children`; `ReadAsset` of a hidden path, `..`, an absolute path or a disallowed extension |
| 7 | `ErrUnavailable` | the subsystem is not installed, or the call was made outside a tick | no physics, `physics3d`, levels, saves, net or game UI plugin; any world call from `init()`; the editor's Play mode for levels and saves |
| 8 | `ErrRejected` | schema or JSON validation failed | invalid component JSON, a field value the schema refuses, a spawn that clashes with a sibling name, too many tags, a pinned data file that changed |
| 9 | `ErrLimit` | a size cap was hit | State over 64 KiB, event payload over 1 KiB, 33rd subscription, 65th timer, data file over 256 KiB, 65th data pin |

`ErrRejected` carries no reason for the script; test the same JSON in the editor inspector to see the message. Test a code:

```go
package main

import (
	"errors"

	"burrow-engine/sdk/burrowsdk"
	"burrow-engine/sdk/burrowsdk/abi"
)

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			err := burrowsdk.SetVoxel(0, 0, 0, burrowsdk.BlockID(9999))
			var e *burrowsdk.Error
			switch {
			case err == nil:
			case burrowsdk.IsNotFound(err):
				burrowsdk.Log(burrowsdk.LevelWarn, "not found")
			case errors.As(err, &e) && e.Code == abi.ErrBudget:
				// out of budget this tick: try again on the next one
			default:
				burrowsdk.Logf("set voxel: %v", err)
			}
		},
	})
}

func main() {}
```

Functions without an error result swallow failures by design: `Exists` and `Has` report `false`, `Action` reports `ok == false`, `PropsRaw` and `StateRaw` return empty bytes, `Log` returns nothing, `Rand` returns an undefined value from `init()`.

## Limits

Defaults of `script.Config{}`. A project raises or lowers them with `runtime.script_limits` in `vox.project` (gas per call, guest memory, `max_faults`, `per_script` and `per_tick` budgets: [blocks](../blocks.md#scaling)); `burrow run`, `burrowplay`, the editor and `burrow test` all build their host from it. An embedding program tunes them in Go ([tuning](#tuning-the-limits-on-the-host-side)).

### Execution

| Limit | Default | Scope | When exceeded |
|---|---|---|---|
| Gas | 50,000,000 | each guest call (`OnStart`, every event, `OnTick`, `OnDestroy`) | fault `gas exhausted (deterministic instruction budget)` at the same instruction on every machine. About 10-20 ms of pure arithmetic on an M2 Max; real scripts with host calls last longer. Module `init()` gets 4 times as much. |
| Host-call gas | per function (base + units, e.g. `scene_find_tag` 16 + 1 per node scanned, `field_set` 64 + 1 per 64 bytes, `asset_read` 200 + 1 per 64 bytes) | drawn from the same gas | same fault; shown as `HostGas` in the profile |
| Guest memory | 512 pages = 32 MiB | per instance | growth refused; a Go guest aborts: fault. A Go guest starts near 180 pages because the SDK pre-grows an 8 MiB heap. |
| Wall-clock watchdog | off | per guest call | off by default; when on, a trip disables the script at once and is journaled (not deterministic) |
| `MaxFaults` | 3 | per node since its module last changed | node disabled |

### Budgets

A host call that would exceed a budget returns `ErrBudget` (5) and counts in `Stats.BudgetDenied`; nothing traps. A refused call still counts as a call; its bytes, spawns, edits and events are refunded. One transaction = all hooks of one node in one tick.

| Budget | Per transaction | Per tick (all scripts) |
|---|---|---|
| Host calls | 1,000 | 200,000 |
| Bytes copied between host and guest | 1 MiB | 64 MiB |
| Spawns | 32 | 1,024 |
| Voxel edits | 4,096 | 262,144 |
| Events (`Emit`, `Publish`, plus bus deliveries) | 64 | 4,096 |

* Every call except `tick`, `entity_self`, `event_from`, `last_required`, `entry_get`, `props_get`, `state_get`, `state_set` and `abi_version` costs one host call, `Log`, `Rand` and `Voxel` included. Once 1,000 are used the rest fail with `ErrBudget`, even `Log`. With the default, a transaction can place at most about 1,000 blocks (each `SetVoxel` is also a call) although the edit budget says 4,096.
* The per-tick budgets are shared by all scripts in entity order: early nodes can use up what later nodes need.
* Also per transaction: 4,096 buffered operations (`Set`, `Remove`, `SetTransform`, `Despawn`, `Emit`, `Spawn`) before `ErrBudget`; 16 `ReadAsset` reads; 64 data pins; 64 `Log` lines (the rest are dropped without an error).
* A bus delivery beyond the per-tick event budget and an event for a full inbox are dropped, with a non-fatal fault in the console, not an error to the sender.

### Sizes and counts

| Limit | Value | When exceeded |
|---|---|---|
| Module file | 8 MiB (a Go module is about 4 MiB) | load refused: `module is N bytes, limit is 8388608` |
| Loaded module versions | 256 (pinned ones never evicted) | load refused with a hint to `Unpin` |
| Module structure | block depth 512, 100,000 functions, 3,000,000 instructions in total, 512 KiB per function, 1,048,576 table entries | load refused before compilation. The caps are the engine's own `gas.Limits` checks (run before wazero compiles anything), not wazero limits. A block-depth refusal names the workaround: rebuild with `-gcflags=all=-l` (inlining off); `burrow script build` and `burrowscript build` retry that way automatically |
| `State` | 64 KiB (65,536 bytes) | `ErrLimit`; old state kept |
| `Props` | 16 KiB (16,384 bytes) | component refused when set or loaded |
| One host call argument | 64 KiB | `ErrMemory` |
| Component name | 128 bytes | `ErrInvalid` |
| `Log` message | 1 KiB, cut | cut, no error |
| Event payload | 1 KiB | `ErrLimit` |
| Inbox | 64 pending events | the new event is dropped (non-fatal fault) |
| Bus topic | `[A-Za-z0-9_.:/-]{1,64}`, 32 subscriptions | `ErrInvalid`, `ErrLimit` |
| Timers | 64 per script, id >= 0, delay and period up to 2^30 ticks | `ErrLimit`, `ErrInvalid` |
| Tags | 16 per node, `[A-Za-z0-9_.:/-]{1,32}` | `ErrRejected` |
| Query results | 4,096 entities per call; a search stops after 100,000 nodes scanned | `truncated` flag |
| Field path | 256 bytes, 16 segments | `ErrInvalid` |
| World coordinates | -16,777,216 to 16,777,216 per axis | `ErrInvalid` |
| `ReadAsset` | 256 KiB per file, extensions `.json .txt .csv .tsv .md .toml .yaml .yml .dat` | `ErrLimit`, `ErrDenied` |
| Save data | key `[A-Za-z0-9_.:/-]{1,128}`, value 64 KiB, 1,024 keys, 1 MiB total | `ErrInvalid`, `ErrMemory`; total: non-fatal fault at commit |
| `PhysicsOverlap` buffer | 4,096 bodies | `ErrInvalid` |

Smaller caps (animation, navigation, audio, camera and UI JSON) are listed per function in [script/ABI.md](../../script/ABI.md) and the [API reference](../reference/script-api.md).

### What the sandbox forbids

Checked when a module loads (`burrow script check` shows the reason):

* Imports other than the `vox` host module and the WASI preview1 startup stubs (`env`, `gojs`: built with `GOOS=js` by mistake). The WASI stubs for files and sockets exist but always fail; with `StrictWASI` they are rejected.
* `_start` (a command build; use `-buildmode=c-shared`), a missing `vox_abi_version` (the module does not import the SDK), an ABI version other than 1, no `memory` export, no `on_*` export, `on_event` without `vox_alloc`.
* Table or segment mutation (`table.set/grow/fill/copy/init`, `data.drop`, `elem.drop`), SIMD, threads, tail calls.
* A `vox.*` function or signature this engine does not know (a script built with a newer SDK).

## Faults

In a natively linked game (`burrow build --native`, [Native scripts](15-native.md)) there is no gas and no memory cap: an infinite loop or runaway allocation is not a fault but a hang. The debug watchdog (`BURROW_NATIVE_DEBUG=1`) turns a stuck call that still makes host calls into a `watchdog` fault. Everything else on this page (budgets, transactions, faults, `MaxFaults`) is identical.

A fault is a trap, a Go panic (including a failed type assertion, a nil dereference, an index out of range), `os.Exit`, gas exhaustion, running out of memory, or a host-side panic.

What happens, in order:

1. The transaction's buffered effects are dropped. Nothing of it reached the world. State, inbox events, due timers and the `started` flag stay as they were, so the same events and timers arrive again next tick.
2. `Log` lines written before the fault are still delivered.
3. A `script.ScriptFault{Entity, Module, Tick, Reason, Trace, Fatal, Disabled}` event is sent; the editor console and the `script.Console` ring buffer (512 rows) show it; `Stats.Faults` and the node's `faults` counter rise.
4. At `MaxFaults` (3) the node is `disabled`: it no longer runs. Its other components stay.
5. The node is re-enabled, with its counter cleared, when its module changes: a rebuild whose bytes differ, hot reload in the editor, or restoring a snapshot (Stop in the editor). Rebuilding to identical bytes does nothing.

Faults of a node never affect other nodes or the engine. An effect that fails at commit time (a spawn whose name clashes with a sibling, a despawn of an entity already gone, a full inbox) is a non-fatal fault: shown in the console, effects before it stay applied, no counter change, the node keeps running.

Failures that are not script faults and stop the whole tick (the engine rolls the tick back and reports an error naming the cause):

* a node bound to a module hash the runtime does not have (a replay or a restored save without the module bytes);
* a node bound under a different `script.Config` fingerprint than the runtime's;
* a data file read by `ReadAsset` whose content differs from the recorded one.

### Reading a fault

Editor console line (also `ConsoleEntry.Msg` and `.Trace`):

```text
[script /bad tick 3] wasm error: unreachable; guest stderr: hello from println
panic: runtime error: index out of range [8] with length 0

goroutine 1 [running]:
main.init.0.func1(0x100000001, 0x3fa999999999999a)
	t1/scripts/idx/main.go:9 +0x6
burrow-engine/sdk/burrowsdk.dispatchTick(...)
 (script disabled)
in on_tick
	.$1333(i32) i32
	.$697(i32) i32
```

| Part | Meaning |
|---|---|
| `[script <path> tick <n>]` | node and tick of the fault |
| `gas exhausted (deterministic instruction budget)` | the loop or the work is too long: [profile it](10-debugging-and-testing.md#profiling), reduce work per tick, spread it over ticks |
| `wasm error: unreachable; guest stderr: ...` | a Go panic or `os.Exit`: the panic message, goroutine and `file:line` come from the guest's captured stderr (first 700 characters in the reason, 4,096 captured). Also contains what `fmt.Println` printed in that call |
| `wasm error: out of bounds memory access`, `integer divide by zero`, `indirect call type mismatch` | trap from the module itself |
| `host panic: ...` | an engine bug while serving a call: report it |
| `wall-clock watchdog fired` | only when the host enabled the watchdog |
| `event has a payload but the module does not export vox_alloc` | the module was not built with the SDK |
| `(script disabled)` | this was the third fault |
| `in on_tick` + `$N` frames | the wasm stack, up to 2,048 bytes. Frames are function indexes (`$1333`) in a stripped build; function names need a debug build (`burrowscript build -debug`). There are no wasm line numbers because gas instrumentation rewrites the module, but a Go panic prints its own `file:line` |

`burrow test` and `burrowplay -headless -json` report the count (`script_faults`, `script_invocations`) and `burrow test` exits 1 when it is not zero. `PauseOnFault` ([host side](#tuning-the-limits-on-the-host-side)) is not used by the editor or the game.

## Tuning the limits on the host side

The limits above are fields of `script.Config`, set when a Go program creates the runtime. The editor, `burrowplay` and `burrow` build theirs from the defaults and the project's `runtime.script_limits`; to change anything else, embed the engine and pass your own runtime to `script.Plugin`:

```go nocheck
rt, err := script.NewRuntime(script.Config{
	GasPerInvocation: 200_000_000,
	MemoryPages:      1024,                  // 64 MiB
	MaxFaults:        5,
	PerScript:        script.Budget{Calls: 10_000, VoxelEdits: 8192},
	PerTick:          script.Budget{Calls: 1_000_000},
})
app.AddPlugins(&script.Plugin{Runtime: rt, PauseOnFault: true})
```

| `script.Config` field | Default | Effect |
|---|---|---|
| `GasPerInvocation` | 50,000,000 | gas per guest call |
| `MemoryPages` | 512 | 64 KiB pages per instance |
| `MaxModuleBytes` | 8 MiB | module size |
| `MaxModules` | 256 | loaded module versions |
| `MaxFaults` | 3 | faults before a node is disabled |
| `PerScript`, `PerTick` (`script.Budget`: `Calls`, `Bytes`, `Spawns`, `VoxelEdits`, `Events`; zero = default) | tables above | host-call budgets |
| `StrictWASI` | false | reject every WASI import beyond the startup set |
| `Watchdog` | 0 (off) | wall-clock limit per call; not deterministic, costs about 10 us per call |
| `Limits` (`gas.Limits`) | see Sizes | module structure caps |
| `LoadTimeout` | 120 s | validation plus compilation of one module |
| `PoolSize` | 8 | idle instances kept per module |
| `NoWriteTracking`, `Interpreter` | false | reset strategy and engine; same results |

Rules:

* Gas, memory, budgets, `MaxFaults`, `StrictWASI` and `MaxModuleBytes` are part of the configuration fingerprint stored in each node (`cfg`). A replay or restore under another configuration fails the tick instead of diverging, so record and replay with the same `Config`.
* `Plugin.PauseOnFault` pauses the simulation (reason `script.fault`) on a fatal fault; resume with `SetPausedBy("script.fault", false)`.
* Raising a limit raises the worst-case cost of every tick; the per-tick budgets exist to keep one script from starving the frame.
* The standalone checker accepts `-max-bytes` and `-strict-wasi` only for the check; they do not change what the game accepts.

## See also

* [Execution model](02-execution-model.md): transactions and what a fault drops.
* [State and props](03-state-and-props.md): size limits in practice.
* [Debugging and testing](10-debugging-and-testing.md): logs, profiling, FAQ.
* [script/ABI.md](../../script/ABI.md): gas cost model, structural caps, WASI stubs.
* [Embedding and the ABI](12-embedding-and-abi.md): `script.Config`, the plugin, the host side.
* [Script API reference](../reference/script-api.md), [security](../security.md).
