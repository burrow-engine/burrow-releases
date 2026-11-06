# Debugging and testing

How to see what a script does (logs, faults, profile), how to check it (`burrow script check`, `burrow test`, replay, your own headless test), and the problems people hit most, each with cause and fix.

## Logging

```go nocheck
burrowsdk.Log(burrowsdk.LevelWarn, "low ammo")
burrowsdk.Logf("tick %d: %d enemies", burrowsdk.Tick(), n)   // LevelInfo
```

| Level | Constant | Shown in the editor console as |
|---|---|---|
| 0 | `LevelDebug` | info |
| 1 | `LevelInfo` (`Logf`) | info |
| 2 | `LevelWarn` | warning |
| 3 | `LevelError` | error |

* A line is cut at 1 KiB, invalid UTF-8 becomes `?`, a level outside 0..3 is ignored, and only the first 64 lines of a transaction are kept. `Log` is a host call: it counts against the call budget and is refused (silently) once the budget is used up ([limits](09-errors-and-limits.md#budgets)).
* Lines are delivered even when the transaction later faults; the effects are not.
* Log in moderation (`if burrowsdk.Tick()%20 == 0`): every line costs a host call, and the ring buffer keeps only the last 512 entries.

Where the output goes:

| Host | Output |
|---|---|
| Editor | Console panel, `[script <node path> tick <n>] message`, with the level filter. Faults appear as errors with the wasm stack under the message. |
| `burrow run`, `burrowplay`, exported game | **Nowhere.** Entries go to the in-memory `script.Console` ring and nothing prints it. Debug in the editor, or in a headless host that reads the ring (below). `burrowplay -headless -json` and `burrow test` only report counts (`script_invocations`, `script_faults`). |
| Your own Go host | The `*script.Console` resource of the app (`engine.Res`), `Entries()` oldest first; or the `script.ScriptLog` and `script.ScriptFault` events. |

`fmt.Println` and `println` write to stdout/stderr, which the sandbox captures only to enrich a fault message (first 4 KiB); on a successful call the text is discarded. Use `Logf`.

## Reading a fault

Faults appear in the console with the reason and a stack. The [errors page](09-errors-and-limits.md#reading-a-fault) explains each part. In short: a Go panic shows its message and `file:line` in `guest stderr`; `gas exhausted` means too much work in one call; `(script disabled)` means three faults. For function names in the wasm stack, build the module with `burrowscript build -debug -o assets/scripts/x.wasm scripts/x` (bigger file, different hash).

To stop on the tick of a fault, run in your own host with `script.Plugin{PauseOnFault: true}`: the simulation pauses with reason `script.fault` and the node can be inspected. The editor and the game do not set it.

## The debugger

A script is an all-or-nothing transaction: its call cannot be frozen half way, so the debugger stops the simulation at the **end of
the tick** in which a script asked for it. The stop gives you the script's `State` and `Props`, the host functions it called (at
most 64, in order), the label and variables it passed, and the world as it is at the tick boundary. Then you continue, or step one
tick at a time. The debugger only observes: `StateHash`, journal and replay are the same with it on or off.

**In the editor** it is on while the scene plays. A stop switches the editor to Pause, writes `[debugger] stopped: ...` in the
console, and **Pause** resumes, **Step** runs one tick (the batch of a step ends early at a stop). The MCP tool `editor_script_debug`
does the same from an agent: `state`, `breakpoint_add`, `breakpoint_remove`, `breakpoints_clear`, `resume`, `step`.

**In your script**, a breakpoint written in code:

```go nocheck
if burrowsdk.Debugging() { // true only with the debugger on; Break alone costs one host call when it is off
	_ = burrowsdk.Break("low ammo", map[string]any{"ammo": st.Ammo, "target": target})
}
_ = burrowsdk.BreakIf(st.Hp < 0, "negative hp", st) // a conditional breakpoint
```

**From the host**, without touching the script: breakpoints match every script run that fits all the fields you set.

| field | stops when |
|---|---|
| `module` | the script's module path contains this text |
| `entity` | the node has this entity id |
| `from_tick` | the tick is at or after this one |
| `on_fault` | the script faults (the stop carries the fault text and the host calls made before it) |
| `once` | (modifier) the breakpoint removes itself after the first stop |

A breakpoint stops **before** the call: the snapshot is the `State` the script is about to receive (`before: true`). A `Break` call
snapshots **after** the call, with the `State` it just saved.

```go nocheck
d := rt.Debug() // *script.Runtime
d.SetEnabled(true)
id, _ := d.AddBreakpoint(script.Breakpoint{Module: "enemy", FromTick: 200, Once: true})
// the engine App pauses itself (reason "script_debugger") at the end of the tick; read d.Last() / d.Hits(), then:
d.Step(1) // run one tick and stop again
d.Resume()
```

A game that runs on `engine.App` pauses the App for you; a host that drives ticks itself (the editor) calls `SetManaged(true)` and
reads `TakePending()` after each tick. Limits: 64 breakpoints, 32 stops kept, `Break` variables 4096 bytes, label 256 bytes, one
stop per script transaction. `Break` and `Debugging` exist in module `vox` as `debug_break` and `debug_enabled` ([ABI](../../script/ABI.md)).

What it does not do: no stepping through source lines or inspecting local variables of a running call (wasm without debug info and
the all-or-nothing transaction rule that keeps scripts deterministic). Put the variables you want to see in `Break`.

## Profiling

Cost is measured in gas, which is deterministic (the same on every machine and in a replay), plus wall time as a hint.

| Source | What you get |
|---|---|
| `Runtime.Profile()` | One row per script node, most expensive first: `Entity`, `Module`, `Entry`, `Ticks` (transactions), `GasTotal`, `GasMax`, `GasLast`, `HostGas` (the part charged by host calls: queries, field access), `LastTick`, `WallNanos`, `Faults`. `ResetProfile()` clears it. |
| `Runtime.Stats()` | Cumulative counters: `Invocations`, `Faults`, `GasFaults`, `HostCalls`, `BudgetDenied`, `GasUsed`, `Spawns`, `VoxelEdits`, `Instantiations`, `Resets`, `ResetBytes`, `ModulesLoaded`, `Evicted`. |
| `burrowplay -headless -ticks N -json` | `report.script_invocations`, `report.script_faults`. |
| Editor Profiler panel | Frame, render, GPU and simulation times; **no per-script rows**. For a script profile, use a host that calls `Profile()` (the program below). |

Reading the numbers: compare `GasMax` with the 50,000,000 limit; a high `HostGas` share means queries and field access dominate (see [scene queries](../reference/script-api.md#scene) charges: per node scanned); a `GasMax` far above `GasTotal/Ticks` means rare expensive ticks (spread the work). Typical cost: about 1.5 us per call for a trivial script without JSON, much more with `encoding/json` ([script/ABI.md](../../script/ABI.md) performance table).

## Checking a module

`burrow script check [dir|file.wasm]` runs the same loader the game uses, without running any code of the script beyond `init()`. Failing reasons and fixes:

| Message contains | Cause | Fix |
|---|---|---|
| `module is N bytes, limit is 8388608` | module over 8 MiB | build stripped (the default), drop heavy imports (`net/http`, big parsers) |
| `exports _start (command build)` | built without `-buildmode=c-shared` | use `burrow script build`, or the flags in [getting started](01-getting-started.md#build-by-hand) |
| `does not export vox_abi_version` | the package does not import `burrowsdk` | import it and call `burrowsdk.Register` |
| `forbidden import env...` / `gojs...` | built with `GOOS=js` | `GOOS=wasip1 GOARCH=wasm` |
| `imports unknown host function vox.X` | built against a newer SDK than the engine | rebuild with the SDK of this engine |
| `guest ABI version N, host speaks 1` | SDK of another ABI | same |
| `forbidden import wasi_snapshot_preview1...` | `StrictWASI` check | drop the package that uses files or sockets |
| `initialisation failed` | `init()` does heavy work or panics | move work into hooks; `init()` gets 4x the gas |
| `malformed or unsupported module` | truncated file, SIMD, tail calls, table mutation, structure over the caps | rebuild; check Go version |

`burrow script build` prints the same check after compiling. `--json` gives `entries`, `size` and `hash` per module.

## `burrow test`

Headless health check of a project; run it in CI.

```sh
burrow test                       # 200 ticks, 3 runs
burrow test --ticks 2000 --runs 5 --json
burrow test --go-tests            # also `go test ./...` in the project (unsandboxed)
burrow test --parity              # also link the scripts natively and require the same StateHash as wasm
```

`--parity` links the project's scripts into a headless runner (the same linking as `burrow build --native`), runs it for the same ticks, once more with `BURROW_NATIVE_DEBUG=1` (faults any script that keeps state in package-level variables), and fails unless the `StateHash` equals the wasm one. See [Native scripts](15-native.md).

It (1) loads the project, default scene, world overlay and input map; (2) builds stale scripts and checks every module listed in `vox.project` `scripts`; (3) runs `--ticks` ticks `--runs` times (defaults 200 and 3; at most 1,000,000 and 20) under `GOMAXPROCS` default, 1 and 8, requiring the same `StateHash` each time; (4) fails on failed commands and any script fault, and replays the journal and compares; (5) with `--go-tests` runs the project's own Go tests. Output: `PASS name ticks=200 StateHash=... (3 runs identical, replay verified)` or `FAIL` and the problems, exit 1.

Limits of the check: no device input (scripts reading `Action` see nothing unless the project queues input), only the default scene, and a scene node whose `module` ends in `.wasm` is checked for existence. A different hash between runs means something outside the simulation leaked in: map iteration order, `math/rand`, `time`, goroutines, or a float-to-int conversion of NaN ([rules](02-execution-model.md#what-is-deterministic)).

### Replay and journal

A run is a journal of commands; replay re-executes it and must reach the same hash.

```sh
burrow run -- -headless -ticks 400 -hash -journal run.json      # prints tick=400 StateHash=...
burrow run -- -replay run.json -expect <hash>                   # fails unless the hash matches
burrow run -- -headless -ticks 400 -hash-every 20                # hash every 20 ticks: diff two machines to find the first bad tick
```

`StateHash` covers every script component (State, props, hash, inbox, timers), so a script that is not deterministic, or a module that changed, shows up as a different hash. Replay needs the exact modules (they are named by content hash) and the same `script.Config`; the engine fails the tick with an error naming the hash otherwise.

## A headless test of a script

Create the runtime, register the module, spawn a node, run ticks, and assert on hash, replay, faults and cost. This program runs `assets/scripts/spin.wasm` twice and compares:

```go
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"burrow-engine/engine"
	"burrow-engine/scene"
	"burrow-engine/script"
)

// play runs the module on one node for the given number of ticks.
func play(wasm []byte, ticks int) (*engine.App, *script.Runtime, error) {
	rt, err := script.NewRuntime(script.Config{})
	if err != nil {
		return nil, nil, err
	}
	if _, err := rt.Register("spin", wasm); err != nil { // scenes may now say "module": "spin"
		return nil, nil, err
	}
	app := engine.New(engine.Options{Seed: 1, Blocks: engine.DefaultBlocks(), StrictCommands: true})
	app.AddPlugin(&engine.ScenePlugin{})
	app.AddPlugin(&script.Plugin{Runtime: rt})
	if err := app.Build(); err != nil {
		return nil, nil, err
	}
	if err := app.Do(scene.SpawnNode{Name: "cube"}); err != nil {
		return nil, nil, err
	}
	data := json.RawMessage(`{"module":"spin","props":{"speed":90}}`)
	if err := app.Do(scene.SetComponent{Path: "cube", Name: script.CompScript, Data: data}); err != nil {
		return nil, nil, err
	}
	return app, rt, app.RunHeadless(ticks)
}

func main() {
	wasm, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	a1, rt, err := play(wasm, 100)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer rt.Close()
	a2, rt2, err := play(wasm, 100)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer rt2.Close()

	problems := 0
	if a1.StateHash() != a2.StateHash() {
		fmt.Println("FAIL: two runs differ")
		problems++
	}
	for _, p := range rt.Profile() { // most expensive script first (read before the replay runs the scripts again)
		fmt.Printf("entity %#x: %d ticks, gas total %d max %d (host %d)\n", p.Entity, p.Ticks, p.GasTotal, p.GasMax, p.HostGas)
	}
	if st := rt.Stats(); st.Faults > 0 {
		fmt.Println("FAIL: script faults:", st.Faults)
		for _, e := range engine.Res[*script.Console](a1).Entries() {
			fmt.Printf("  tick %d fault=%v %s\n", e.Tick, e.Fault, e.Msg)
		}
		problems++
	}
	if err := a1.VerifyReplay(); err != nil { // re-executes the journal and compares the hash
		fmt.Println("FAIL: replay:", err)
		problems++
	}
	fmt.Printf("tick=%d StateHash=%016x\n", a1.Tick(), a1.StateHash())
	if problems > 0 {
		os.Exit(1)
	}
}
```

Notes:

* It needs a Burrow checkout (`replace burrow-engine => checkout`); the Windows kit's `sdk/` module holds only `burrowsdk`, so host-side tests are not possible there. Save it as `scripttest/main.go` in your project and run `go run ./scripttest assets/scripts/spin.wasm`, or put the body in a `_test.go` file and let `burrow test --go-tests` run it.
* To assert behaviour, read components back after the run: `engine.Res` and the scene API give you the node (see `script/harness_test.go` and `examples/scripting_demo/main.go` for complete examples, including voxel setup with `sim.FillBox`).
* Pure logic of a script (math, parsing, state transitions) can be tested natively with `go test`: move it into plain functions. On a native build every host call returns `ERR_UNAVAILABLE`, so code that calls the SDK needs the harness above.
* Scenarios with input: `app.Do(script.ScriptSetInput{Names: []string{"jump"}, X: []int32{1000}, Y: []int32{0}})` makes `Action("jump")` return 1.0 from the next tick (values in thousandths, names sorted).

## FAQ

| Problem | Cause | Fix |
|---|---|---|
| My global variable resets every tick | Guest memory is restored before every call, even between `OnStart` and `OnTick` of one tick | Keep it in State or a component ([state](03-state-and-props.md)); registrations go in `init()` |
| My `State` seems to save the old value | `defer burrowsdk.SaveState(st)` copies `st` when `defer` runs | `defer burrowsdk.SaveState(&st)` or save explicitly |
| `LoadState` returns an error after I rebuilt | The struct changed incompatibly (retyped or renamed field), or the codec changed | Version the state and migrate ([state](03-state-and-props.md#changing-the-state-format)); on error, start from a zero value |
| Props decode is slow | `Props[T]` runs `encoding/json` in the guest on every call | Decode once in `OnStart` into State, shrink the props, or parse `PropsRaw()` by hand |
| My voxel edit is not visible | Edits apply at commit, not at the call; `LightAt` and physics queries read the committed world; or `SetVoxel` returned an error you ignored (bad block id, coordinate range, `ErrBudget`) | Check the error. `Voxel` and `Raycast` do see your own pending edits; other scripts see them after commit |
| Only about 1,000 blocks get placed per tick | Each `SetVoxel` is a host call and the call budget is 1,000 per transaction | Spread the work over ticks, or raise `PerScript.Calls` in your own host ([tuning](09-errors-and-limits.md#tuning-the-limits-on-the-host-side)) |
| `Log` stops printing in the middle of a hook | The host-call budget is used up; `Log` is refused when it is | Reduce calls; log less |
| Script disabled / "script disabled" in the console | Three faults since its module last changed | Fix the cause, rebuild (the bytes must change) or press Stop in the editor; see [faults](09-errors-and-limits.md#faults) |
| `gas exhausted` | More than 50,000,000 instructions in one call: an unbounded loop, a large scan, or JSON on big data | Profile, bound the loop, scan once and cache the result in State, spread work over ticks |
| Nothing happens, no error | `module` does not resolve (typo, `.wasm` not built, GUID of a deleted asset), the script plugin is off (`runtime.plugins.scripts: false`), or no hook does anything | The editor shows the module on the component; run `burrow script build`; check `runtime.plugins`; add a `Logf` in `OnStart` |
| Works in the editor but not in the game | The game has no hot reload and registers modules at start: the `.wasm` must exist in the project (`burrow run` rebuilds it, a copied folder may not have it). Also: the editor lacks the level and save plugins, but the game needs `runtime.plugins.levels` / `saves` for them; in the game window only the controller's keys reach the input map (W A S D, E, Q, Shift, Space, F, Z, F2, Esc, 1-9, mouse buttons per the previous documentation, not re-verified here) | Run `burrow test` and `burrow run` before shipping; bind scripts to keys the window reports; enable the plugins in `vox.project` |
| Works in the game but not in the editor | Level and save calls return `ERR_UNAVAILABLE` in Play; input only reaches scripts while the pointer is over the viewport | Test those paths with `burrow run`; hover the viewport |
| `Action` returns `ok == false` | The action is not in the input map, no input snapshot exists yet (headless), or the key is not reported | Add the action to `input.json`; see the headless note above |
| `OnStart` did not run again after a rebuild | `started` is part of the node's state and survives hot reload | Do set-up in a way that tolerates old State, or reset State on a version change |
| An event I emitted arrives one tick late | Events and bus messages are delivered on a later tick, never in the emitting tick | Plan for the delay; for same-tick coordination use a shared component |
| `FindByName` does not find the node I just spawned | Spawned nodes exist after commit; queries read the committed scene | Keep the `Entity` returned by `Spawn` and use it in the same call |
| `ERR_UNAVAILABLE` from a physics, level or net call | The plugin is not installed in this host | Enable it in `vox.project` `runtime.plugins`; remember the editor does not install levels or saves |
| Two runs give different `StateHash` | Map iteration order, `math/rand`, `time`, goroutines, NaN, or floats converted to ints unclamped | See the [rules](02-execution-model.md#what-is-deterministic); bisect with `-hash-every` |
| `fmt.Println` prints nothing | stdout and stderr are discarded on success | `Logf` |
| `updates to go.mod needed` on the first build | the project's `go.mod` was written by an older `burrow` with a `go` line below the SDK's | `go mod tidy` once |
| `no required module provides package burrow-engine/sdk/burrowsdk` | `go.mod` lacks the `require` / `replace` pair or the replace path is wrong | See [getting started](01-getting-started.md#go-version-and-the-sdk) |
| `the Go toolchain cannot build GOOS=wasip1` | Go older than 1.24 or a build without the wasip1 port | Install a current Go from go.dev |
| Replay fails with `needs module sha256:...` | The runtime lacks the module bytes the journal names, or a rebuilt module replaced them | Keep the `.wasm` files used for a recording next to the journal |

## See also

* [Execution model](02-execution-model.md): why memory resets and how effects commit.
* [Errors and limits](09-errors-and-limits.md): every code, limit and fault reason.
* [Getting started](01-getting-started.md): commands and project layout.
* [Embedding and the ABI](12-embedding-and-abi.md): hosting scripts in your own program. [Cookbook](11-cookbook.md).
* [Determinism](../determinism.md), [troubleshooting](../troubleshooting.md), [CLI reference](../reference/cli.md#burrow-test).
