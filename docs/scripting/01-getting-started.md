# Getting started with scripts

A script is a Go program compiled to WebAssembly that runs inside the deterministic simulation; this page takes you from nothing to a spinning cube and lists the project layout, the script hooks and every `burrow script` command.

## What a script is

* One Go package (`scripts/<name>/`) = one `.wasm` module = one behaviour. Attach it to any number of nodes with the `script` component; each node has its own `props` and `state`.
* It is called by the engine, never the other way round: the host calls `OnStart`, `OnTick`, `OnEvent` and `OnDestroy` inside a fixed tick (20 per second). A script has no loop of its own, no window, no files, no network, no clock.
* Guest memory is reset before every call, so a script keeps nothing in globals. It remembers things in components: [Props and State](03-state-and-props.md).
* The Go SDK is `burrow-engine/sdk/burrowsdk`. Any other language that targets the ABI works too ([script/ABI.md](../../script/ABI.md)); this documentation covers Go.

## Quickstart (5 minutes)

Requirements: Go with the `wasip1` port ([Go version](#go-version-and-the-sdk)), and `burrow` on your path.

```sh
burrow new mygame --template empty     # or open any project folder
cd mygame
burrow script new spin                 # scripts/spin/main.go (+ go.mod when the project has none)
burrow script build                    # scripts/*/ -> assets/scripts/*.wasm
burrow script check                    # re-verify the modules
```

`scripts/spin/main.go` is a complete script that turns its node around the Y axis:

```go
package main

import "burrow-engine/sdk/burrowsdk"

// props is the designer configuration: JSON from the script component, read-only.
type props struct {
	Speed float32 `json:"speed"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			p, _ := burrowsdk.Props[props]()
			t, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			t.Rot[1] += p.Speed * float32(dt)
			burrowsdk.SetTransform(self, t)
		},
	})
}

func main() {}
```

Attach it, then run:

1. Editor: select a node (for example **Edit > Create > Cube**), **Add component**, pick `script`, set `module` to `assets/scripts/spin.wasm` and `props` to `{"speed": 90}`.
2. Press **Ctrl+Shift+P** (Play). The node turns at 90 degrees per second. **Esc** stops and restores the scene exactly.
3. Outside the editor: `burrow run` (rebuilds stale scripts, then plays) or `burrow test` (headless, prints the `StateHash`).
4. Edit the code, run `burrow script build` again: the editor re-registers a changed `.wasm` within about a second and bound scripts keep their State.

The editor never compiles Go: build with `burrow script build` (or let `burrow run`, `burrow test` and `burrow build` do it).

## The script component

Attach the same data from a scene file (`.voxscn`) instead of the inspector:

```json
"script": { "module": "assets/scripts/spin.wasm", "props": { "speed": 90 } }
```

| field | type | meaning |
|---|---|---|
| `module` | string | Required. A name registered on the runtime, an asset GUID, or a project-relative path of the `.wasm`. Resolved in that order. A game registers every `.wasm` under the project's asset folders and the `scripts` list of `vox.project` by project-relative path (at most 256 modules). |
| `entry` | string | Optional. Selects a `RegisterNamed` script inside the module. Empty = the `Register` script. |
| `props` | JSON object | Optional designer configuration, at most 16 KiB. Read-only for the script. |
| `state`, `hash`, `cfg`, `started`, `disabled`, `faults`, `inbox`, `subs`, `timers`, `reads` | | Managed by the engine. Do not write them in scenes. `hash` pins the module by content on first run. |

Full schema: [components reference](../reference/components.md#script). An unresolved `module` is not an error: the node is retried every frame and its script never runs (see [debugging](10-debugging-and-testing.md#faq)).

## The `burrowsdk.Script` struct

```go nocheck
type Script struct {
	OnStart   func(self Entity)
	OnTick    func(self Entity, dt float64)
	OnEvent   func(self Entity, ev Event)
	OnDestroy func(self Entity)
}
type Event struct {
	From    Entity // sender (the script's own entity for timers)
	Kind    int32
	Payload []byte
}
```

A nil hook is skipped. Every hook runs inside the node's transaction ([execution model](02-execution-model.md)).

| hook | called | notes |
|---|---|---|
| `OnStart(self)` | once, in the first transaction of the node after the script is bound | Runs again if that transaction faulted (the `started` flag is saved only on success). Not re-run after hot reload or restore. |
| `OnTick(self, dt)` | every fixed tick | `dt` is `1 / rate`, `0.05` (50 ms) at the default 20 Hz (`runtime.tick_rate` can raise it). Use `Tick()` for time. |
| `OnEvent(self, ev)` | once per event emitted on an earlier tick, in emission order | Events come from `Emit`, `Publish` and timers. A matching `OnMessage` or `OnTimer` handler consumes its event first, so `OnEvent` does not see it. Keep your own kinds below `0x40000000`: `0x40000000..0x7fffffff` is reserved for bus topics and timers. |
| `OnDestroy(self)` | when a script's `Despawn` of the node (or of an ancestor) commits | Not called for editor deletion or scene unload. Runs as its own transaction; effects commit with it. Its own `Despawn` calls do not cascade. |

Registration rules:

* Register from `init()` (or package-level variable initialisers). `init()` runs once; the host snapshots memory right after it, so what `init()` set up is restored before every call. Anything registered later, inside a hook, is lost at the next reset.
* `Register(s)` sets the default script; calling it twice keeps the last. `RegisterNamed(name, s)` adds scripts selected per node with the component's `entry`. If a module has named scripts and `entry` is empty, the default runs; if `entry` names something unknown, no hook runs (silently).
* `OnMessage(topic, fn)` and `OnTimer(id, fn)` are also registered from `init()` (see the [API reference](../reference/script-api.md#bus)).
* Do not call host functions from `init()`: they return `ERR_UNAVAILABLE` (`Rand()` would return a garbage value). Pure Go set-up is fine.
* The SDK exports all four entry points whatever hooks you set, so `burrow script check` always lists `on_destroy on_event on_start on_tick`.

This script uses every hook:

```go
package main

import "burrow-engine/sdk/burrowsdk"

const kindPing int32 = 1

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			burrowsdk.Logf("started at tick %d", burrowsdk.Tick())
		},
		OnTick: func(self burrowsdk.Entity, dt float64) {
			if burrowsdk.Tick()%20 == 0 {
				_ = burrowsdk.Emit(0, kindPing, []byte("hi")) // target 0 = every script, delivered next tick
			}
		},
		OnEvent: func(self burrowsdk.Entity, ev burrowsdk.Event) {
			if ev.Kind == kindPing {
				burrowsdk.Logf("ping from %#x: %s", uint64(ev.From), ev.Payload)
			}
		},
		OnDestroy: func(self burrowsdk.Entity) {
			burrowsdk.Log(burrowsdk.LevelInfo, "bye")
		},
	})
}

func main() {}
```

## Project layout

```text
mygame/
  vox.project                 manifest (optional "scripts": ["assets/scripts/spin.wasm"])
  go.mod  go.sum              require burrow-engine, replace burrow-engine => checkout or kit sdk
  scripts/
    spin/main.go              one package per module (more .go files allowed)
    shared/...                helper packages are fine, they compile into every module that imports them
  assets/scripts/spin.wasm    build output: commit it or ignore it, but it must exist to play
  scenes/main.voxscn          nodes with the script component
```

`burrow script build` treats each directory `scripts/<name>/` that holds a `.go` file as one script and writes `assets/scripts/<name>.wasm`. A module is about 4 MiB (the Go runtime), about 1 MiB inside a `.voxpak`. That cost is per module: prefer **one module with several named entry points** (`RegisterNamed`, `Script.Entry`) to many small ones. For release, `burrow build --native` links the scripts into the game executable instead ([Native scripts](15-native.md)).

## Go toolchain and script templates

You do not have to install Go. When `burrow script build` (or the editor's build button, `burrow run`, `burrow build`) finds no `go` of at least Go 1.27.2 (the version in Burrow's `go.mod`), it downloads the official release for your OS and CPU into `<user cache>/burrow/go/go1.27.2` (about 70 MB, once, with a progress message). The archive comes from `https://go.dev/dl/` over HTTPS, its SHA-256 is checked against the release list before anything is unpacked, and the unpacking refuses absolute paths, `..`, links that leave the folder and oversized archives. Only one process downloads at a time.

| Variable | Effect |
| --- | --- |
| `BURROW_GO` | Use this `go` binary (or GOROOT folder) and never download. |
| `BURROW_OFFLINE=1` | Never download: build fails with a clear message when no suitable Go is installed. |
| `BURROW_CACHE_DIR` | Move the cache (default: the OS user cache directory + `burrow`). |

`burrow doctor` shows which Go the scripts compile with, or that one will be downloaded.

Ready-made behaviours: `burrow script templates` lists them, `burrow script new <name> --template <t>` starts a script from one. Each is a complete script with its Props documented in the header.

| Template | Does |
| --- | --- |
| `rotate` | turns the node around an axis |
| `bob` | floats up and down |
| `door` | opens and closes on the `door.open`, `door.close`, `door.toggle` bus events (AnimPlay when the node has an `anim.player`, else slides) |
| `pickup` | collected when a tagged node (the player) comes close: publishes `pickup.collected`, disappears |
| `platform` | moves between its start and a second point |
| `zone` | publishes `zone.enter` / `zone.exit` for tagged nodes inside a box |
| `spawner` | spawns a prefab on a timer |
| `follow` | walks toward the nearest tagged node and faces it |
| `state` | on/off state for a prefab: switches the model variant (`render.voxmodel.variant`), the particles (`enabled`) and the sounds (`muted`) under the node on the `state.on`, `state.off`, `state.toggle` bus events; prop `on` sets the start state, `group` limits which messages reach it (see [Linked prefabs](../prefabs.md#a-campfire-with-on-and-off)) |

In the editor, the Script panel has a "New script from a template" button (sparkle icon): choose a template, type a name, and the editor writes `scripts/<name>/main.go`, attaches a script component with sensible Props to the selected node (one undoable step), opens the file and builds it in the background. The zap button rebuilds all scripts; changed modules hot-reload.

## Go version and the SDK

* The guest needs `GOOS=wasip1` and `//go:wasmexport`: **Go 1.24 or newer** (Burrow fetches Go 1.27.2 itself when needed, see above). TinyGo and cgo are not used (`CGO_ENABLED=0`). Recent toolchains (Go 1.26, 1.27) need no special flags: their wasm output stays under the engine's structural caps.
* The engine caps module structure before compiling it (its own `gas.Limits` check, not a wazero limit): block depth 512, 100k functions, 3M instructions. A Go compiler that inlines deep enough to exceed the block-depth cap makes the load fail with `blocks nested deeper than 512`; `burrow script build` / `burrowscript build` then retry automatically with `-gcflags=all=-l` (inlining disabled), and the error message names that flag. Build by hand with `-gcflags=all=-l` if you compile yourself (see below).
* The SDK is the package `burrow-engine/sdk/burrowsdk`. The module `burrow-engine` is not published; `go.mod` must point at it:

  ```text
  require burrow-engine v0.0.0
  replace burrow-engine => /path/to/burrow-checkout-or-sdk-folder
  ```

* Where the `replace` target comes from, in order: `--burrow-root`, `$BURROW_SDK` (a kit SDK folder), `$BURROW_ROOT` or the checkout `burrow` was built from, the `sdk/` folder next to the executable (Windows creator kit). The kit's `sdk/` holds only `sdk/burrowsdk` and declares `go 1.24`.
* `burrow script new` writes the `go` line of the SDK module it points at (a checkout's current version, `go 1.24` for the creator kit), so install that Go or let `GOTOOLCHAIN` fetch it. A `go.mod` written by an older `burrow` declared `go 1.24` and made the first build fail with `updates to go.mod needed`: run `go mod tidy` once in the project.
* Inside the Burrow repository no `go.mod` is needed.

## Build by hand

`burrow script build` is `go build` with fixed flags. If you build yourself, keep them: the module bytes (and so the pinned hash) then do not depend on where the engine or your project lives.

```sh
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -buildmode=c-shared -trimpath \
  -ldflags="-s -w -X=runtime.modinfo= -buildid=" -o assets/scripts/spin.wasm ./scripts/spin
burrow script check assets/scripts/spin.wasm
```

`-buildmode=c-shared` makes a reactor module (exports `_initialize`, no `_start`); a plain `go build` produces a command module the engine rejects. Drop `-s -w` for a debug build with function names in fault traces.

If the engine refuses the module with `blocks nested deeper than 512` (deep inlining), add `-gcflags=all=-l`:

```sh
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -buildmode=c-shared -trimpath -gcflags=all=-l \
  -ldflags="-s -w -X=runtime.modinfo= -buildid=" -o assets/scripts/spin.wasm ./scripts/spin
```

The module gets bigger and slightly slower; `burrow script build` and `burrowscript build` apply this flag automatically when needed.

## Commands

`burrow script <build|new|check>`; `dir` defaults to the current folder. Every subcommand accepts `--json` (machine-readable result on stdout; `{"ok":false,"error":...}` on failure). Exit codes: 0 ok, 1 failure, 2 usage error.

| command | does |
|---|---|
| `burrow script new <name> [dir] [--template <t>]` | Writes `dir/scripts/<name>/main.go` (the skeleton above, or the template). `burrow script templates` lists them. `name`: lowercase letters, digits, `-`, `_`. Refuses to overwrite. Writes `dir/go.mod` only when absent; with no SDK found it warns and prints the lines to add. |
| `burrow script build [dir]` | Compiles every `dir/scripts/<name>/` to `dir/assets/scripts/<name>.wasm` (stripped), then loads each module through the engine's checker. Skips a module whose `.wasm` is newer than every file in its folder and than `go.mod`/`go.sum`. Fails with `no scripts found` when there is none. If the checker rejects a module for block depth (`blocks nested deeper than 512`), it is rebuilt once with `-gcflags=all=-l` before failing. |
| `burrow script check [dir\|file.wasm]` | Verifies ABI version, imports, exports, size and structure of one file, or of every `.wasm` found anywhere under `dir` (default `.`). Prints `OK path (bytes, entries)` or `FAIL path: reason`; exit 1 if any fails or none exists. |

| flag | subcommand | default | meaning |
|---|---|---|---|
| `--force` | build | off | Rebuild even when up to date. Needed after changing a shared package outside `scripts/<name>/`. |
| `--burrow-root path` | new | see above | Burrow checkout for the `replace` line. `--vox-root` is an alias. |
| `--json` | all | off | JSON output. build: `{"ok","scripts":[{name,source,wasm,bytes,hash,up_to_date}]}`; check: `{"ok","modules":[{file,ok,error,size,hash,entries}]}`. |

Related: `burrow run [dir]` and `burrow test [dir]` rebuild stale scripts first (`burrow run --no-scripts` skips it); `burrow build` packs the modules into the game. The standalone tool `burrowscript` does the same per package:

| `burrowscript` | flags |
|---|---|
| `build <pkg-dir>` | `-o out.wasm` (default `<dir>.wasm`), `-debug` keeps symbols and DWARF (bigger module, function names in fault traces) |
| `new <dir>` | `-burrow /path` (alias `-vox`) |
| `check <file.wasm>` | `-max-bytes N` (default 8 MiB), `-strict-wasi` rejects every WASI import beyond the startup set; prints imports, memory pages and gas-check counts |

## See also

* [Execution model](02-execution-model.md): transactions, order, time, randomness, determinism rules.
* [State and props](03-state-and-props.md): how a script remembers things.
* [Errors and limits](09-errors-and-limits.md) and [debugging and testing](10-debugging-and-testing.md).
* Next: [entities and scene](04-entities-and-scene.md), [world](05-world.md), [input, events and time](06-input-events-time.md), [effects](07-effects.md), [multiplayer](08-multiplayer.md), [cookbook](11-cookbook.md), [embedding and the ABI](12-embedding-and-abi.md), [the Go SDK in depth](13-go-sdk.md).
* [Script API reference](../reference/script-api.md): every host function, SDK function, type and constant (generated); [the Go SDK in depth](13-go-sdk.md) maps the package file by file.
* [Tutorial 4: a scripted entity](../tutorials/04-scripted-entity.md), [script/ABI.md](../../script/ABI.md).
