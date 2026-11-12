# Native scripts

The Unity model: scripts run as **WebAssembly in the editor and for mods** (hot reload, isolation, gas), and the **shipped game compiles the project's Go scripts into its own executable**, like IL2CPP. One game file, no `.wasm` in the archive, no wasm interpreter or JIT at run time.

|  | WebAssembly (editor, mods) | Native (`burrow build --native`) |
| --- | --- | --- |
| Where | sandboxed wazero instance | linked into the game executable |
| Hot reload | yes | no (rebuild) |
| Gas (deterministic instruction budget) | yes, a loop is a fault | **none**; debug watchdog only |
| Memory | linear memory, reset to the post-`init()` image before every call | the Go heap; **package-level variables persist** |
| Sandbox | no files, network or clock | **none**: the script is trusted code |
| Host calls, budgets, transactions, journal, order, `Script.Hash` | identical | identical |
| `StateHash` of a correct script | identical | identical |

## Use

```sh
burrow build my-game -o my-game --native    # compile a player with the scripts linked in (needs the Burrow checkout, BURROW_ROOT, and Go)
burrow test  my-game --parity               # same project, wasm run vs native run: the StateHash must be equal
```

`--wasm` (the default) keeps shipping WebAssembly with the prebuilt player. `BURROW_BUILD_NATIVE=1` makes `--native` the default of `burrow build` on your machine. Native is the recommended release build; it is not the default because it needs the source checkout and a C toolchain to recompile the player, which a plain `burrow build` does not.

How it links: every `scripts/<name>/` package (`package main`) is copied into the Burrow module as `internal/nativemods/<name>` with its package clause renamed, between two generated files whose `init()` functions bracket the package's own (`burrowsdk.NativeBegin` / `NativeEnd`). Everything the package registers (`Register`, `RegisterNamed`, `OnMessage`, `OnTimer`, `OnBlockChange`, ...) belongs to that module, so any number of modules coexist in one binary. The copies exist only as a `go build -overlay`; your project and the checkout are never written to. Each module keeps the identity of its wasm build (`sha256:` of the `.wasm`, which `burrow build --native` builds first), so scenes, journals, saves and `Script.Hash` do not care which runtime ran them.

Scenes must refer to modules by project path (`"module": "assets/scripts/game.wasm"`), as the templates do; the path is the name a native module is registered under.

## One module per project

Prefer **one script package with many named entry points** (`RegisterNamed`, selected per node by `Script.Entry`) to one package per behaviour. Every wasm module is its own ~4.4 MB Go runtime image that the editor compiles, instantiates and pools, and every native module is another copy of the SDK registration. The platformer template already works this way (`game`: `player`, `coin`, `mover`). Split into several modules only for code that different people ship separately.

## The rule: state lives in State and components

A wasm call starts from a fresh memory image, so a package-level variable always reads its initial value. A native call does not: the variable keeps what the last call wrote, and the two runtimes would diverge (and replays, rollback and snapshots break). Therefore:

* never write a package-level variable from a hook (`var count int; count++`), including maps and slices you append to;
* read-only tables built at package initialisation are fine (`var table = [...]int{...}`);
* anything a script remembers goes in `SaveState`, a component, or the save store.

Detection: with `BURROW_NATIVE_DEBUG=1` (or `script.Config.NativeGuard`) the runtime hashes every package-level variable of every native module right after init and after every call, and **faults the script** ("script changed package-level variable ...") when one differs. `burrow test --parity` runs the project once like that. The guard is structural (it follows pointers, maps and slices; functions and channels count only as nil/non-nil), costs a few microseconds per call and is off in release builds. It cannot see state hidden in closures or in other packages' variables.

## No gas: the debug watchdog

A native loop cannot be metered. In debug runs (`BURROW_NATIVE_DEBUG=1`, or `Config.Watchdog`) a **per-call wall-clock watchdog** is armed: the call is aborted (a `watchdog` fault, the script is disabled, like in wasm) at its next host call after the limit (default 5 s). A loop that makes no host call cannot be interrupted; after 10 x the limit the debug process prints every goroutine stack and exits, so the loop is found instead of freezing the game. Test the heavy paths of a script as wasm (`burrow test`): gas faults there are deterministic, the watchdog is not.

## Writing scripts that stay equal

* Register from `init()` (not from package-variable initialisers) so the generated brackets see it.
* Imports: the standard library, `burrow-engine/...` and **your own project's packages** (`scripts/shared`, ... are copied along, once, and their variables are watched by the guard too). Third-party modules are rejected by the native build (vendor the code into the project). Register only from the script package, never from a helper package.
* **float32 arithmetic**: Go on arm64 may fuse `a*b + c` into one rounding (FMA); wasm never does. Write `float32(a*b) + c` where the last bit matters, or keep sim maths in integers/fixed point. The parity test catches a difference on the machine it runs on, not across CPU architectures: peers of a networked game must run the same build kind.
* Do not rely on `fmt.Print*`/`os.Std*` (wasm captures it as the script log; native writes to the real stdout; use `burrowsdk.Log`).
* A panic is a fault, as a trap is in wasm. A fatal Go runtime error (stack overflow, out of memory) ends the process: there is no instance to throw away.

## Limits

* No hot reload, no per-module memory cap, no gas, no sandbox: use native only for scripts you trust (your own project), never for mods.
* Hashes match because the wasm module is built too; a `--native` build needs the wasm toolchain as well.
* Linux, macOS and Windows hosts only (the player is compiled for the host).
* `on_frame` cosmetic scripts run natively too, with the same frame-domain restrictions.

## See also

[Execution model](02-execution-model.md) | [Errors and limits](09-errors-and-limits.md) | [Debugging and testing](10-debugging-and-testing.md) | [Embedding and ABI](12-embedding-and-abi.md)
