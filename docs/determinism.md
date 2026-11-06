# Determinism

Burrow's central promise: **the same project, the same seed and the same inputs give the same `StateHash`**. Same project, seed and inputs give the same StateHash, on macOS Apple silicon and Intel (tested). Windows and Linux are checked by the CI workflow against a golden hash, which has not run yet. The simulation uses integer math or explicitly rounded floats with a deterministic math library; rendering is not covered.

The design target is every desktop system and 64-bit CPU (Windows, Linux, macOS; amd64, arm64); what is verified today is stated above and in [Platforms](platforms.md). Replays, journals
multiplayer and golden tests depend on it. This page says what the promise covers, how it is kept and tested, and the rules
that contributors and script authors follow so it stays true.

## What is covered

The **simulation domain**: everything that runs inside a fixed tick (20 ticks per second) or writes state that `StateHash`
covers. That is the voxel world and world generation, water, weather, the block rules, 2D (`physics`) and 3D (`physics3d`)
physics, navigation and AI, animation players, scene components, levels and saves, the input mapping that turns devices into
journaled commands, WebAssembly scripts, and the engine and app layers that drive them.

It holds bit for bit, not "close enough": the hash covers the exact bits of every integer and float in the state.

How the simulation gets there:

* **Integer and fixed-point first.** Voxel coordinates, block ids, water levels, timers and counters are integers.
  Randomness comes from seeded integer hashes (splitmix64), never from `math/rand` without a seed or from the clock.
* **Fixed order.** No goroutines inside a tick, no iteration over Go maps where order matters, ascending entity order,
  explicit sorts with total keys.
* **Floats only with explicit rounding.** IEEE 754 addition, subtraction, multiplication, division and square root are
  correctly rounded on every CPU, so float math is portable as long as each operation is rounded on its own. Go allows the
  compiler to fuse `x*y + z` into one fused multiply-add instruction (FMA) with a single rounding; it does so on arm64
  (and ppc64, s390x, riscv64, and amd64 built with `GOAMD64=v3`) but not on default amd64, so the same source gives different
  bits on two machines. The Go specification forbids fusion across an explicit conversion, so simulation code writes
  `float64(a*b) + c` (or `float32(a*b)` for float32 operands): every product, and every division by a constant (the compiler
  turns `x/2` into `x*0.5`), is rounded before it meets an addition.
* **Deterministic math library.** `math.Sin`, `Cos`, `Tan`, `Atan2`, `Exp`, `Log`, `Pow`, `Hypot` and friends are not
  bit-identical across architectures: some have assembly versions on one CPU only, and the pure Go ones are compiled with
  fused multiply-adds on arm64. Simulation code calls `burrow-engine/mathx/detmath` instead: the standard library's own
  algorithms, ported with every product rounded and no assembly. Results are within 2 ulp of package `math` (Acos within
  4e-16 absolute, Pow within 1e-15 relative), and on amd64 the trigonometric functions are bit-identical to package `math`.
  `math.Sqrt`, `Floor`, `Ceil`, `Trunc`, `Round`, `Abs`, `Min`, `Max`, `Mod`, `Frexp` and `Ldexp` are exact everywhere and stay.

## Simulation rate

The simulation runs at **20 ticks per second** by default. A project can choose 30, 40 or 60 with `runtime.tick_rate` in
`vox.project`; the rate is a property of each engine (`sim.Config.TickRate`, `engine.Options.TickRate`, built from the
project by `internal/simplan` for the game, the dedicated server and the editor alike) and cannot change afterwards. There is no
process-wide rate and no environment variable in a shipped game.

* **A rate is part of a recording.** A journal written at a rate other than 20 carries `tick_rate` on its first entry and
  `ReplayWith` refuses a different rate with an explicit error. A journal without the field is a 20 Hz journal. Snapshots and
  `StateHash` of a world are only comparable at the same rate.
* **Everything per tick follows it:** the `Dt` and `TickRate` of the system context (`sim.Context`, `engine.FixedContext`,
  `App.FixedDt()`), the wall-clock tick of a network session (`netbase.TickInterval(rate)`), the lobby countdown, the thunder delay, the day length of `env.time` and the movement of replicated players. A
  duration in seconds keeps its meaning; a count of ticks does not (a timer of 20 ticks is one second at 20 Hz and a third of a
  second at 60 Hz). Scripts should use `AfterSeconds`, `EverySeconds`, `Wait(sec)` of a `Seq` and `TickDt()`.
* **Cost is linear:** 60 Hz is three times the simulation work per second of 20 Hz, so the per-tick budget drops from 50 ms to
  16.7 ms. Dense rigid-body scenes are the first to exceed it. `runtime.physics_substeps` refines physics inside a tick without
  raising the rate of scripts and gameplay, and frame-domain visuals (`OnFrame`, `visual.*`) smooth what is drawn at any rate.
* **Authored durations are seconds.** Behavior-tree `wait`/`cooldown`/`timeout` `seconds` and state machine `after`,
  `runtime.saves.autosave_seconds`, `environment.json` `day_length` and the `weather_set`
  `day_length` are seconds, converted to ticks once at load with the engine rate: `mathx.SecondsToTicks` rounds half up to the
  nearest tick and never gives a positive duration less than one tick (0.5 s is 10 ticks at 20 Hz, 30 at 60 Hz). The weather
  smoothing rates, front durations, wind period and lightning gap are defined at 20 Hz and rescaled the same way (rates to the
  nearest tick, at least 1: a ramp may differ by about 2 % at 60 Hz); fine-water evaporation is per second of simulated time.
  Fields named in ticks (`interval`, `memory`, `sleep_ticks`) are still ticks.
* **The network handshake pins the rate:** `sim.tick_rate` is one of the pinned rules, so a client at another rate is refused.
* **Tests:** `BURROW_TICK_RATE=60 go test -tags ratematrix ./...` runs the suite at another rate (the tag is the only way the
  variable is read; it moves the default of engines that do not choose a rate). A test tied to 20 Hz constants declares it
  with `ratetest.Only20(t)` (package `internal/ratetest`); the others are written in durations.

## What is not covered

The **frame domain**: rendering, the camera rigs, particles, the in-game UI layout, audio, the character avatar animator,
the editor and the Hub. They read the simulation but never write it, so their float math can differ between machines
without changing a hash. Two machines show the same world; the pixels may differ by a rounding.

Outside the promise as well:

* NaN bit patterns. A NaN produced on arm64 and on amd64 can carry different payload bits. The simulation keeps state finite
  (physics clamps and drops non-finite values); a game that lets a NaN into hashed state can diverge.
* Converting a NaN or an out-of-range float to an integer (`int(x)`) gives different values on amd64 and arm64. Clamp first.
* Different engine versions. A new version may change the simulation on purpose (the changelog says so); replays are
  checked with the engine that recorded them.

## How it is tested

* **Portability golden.** `scripts/portability-hash.sh` (`make portability`) creates the eight templates, runs each
  headless for 200 ticks and compares the `StateHash` with `scripts/portability-golden.txt`. Every CI job runs it, so each
  operating system and CPU of the matrix is compared with the same golden. On an Apple silicon Mac it runs both the arm64
  build and the amd64 build under Rosetta 2.
* **Fused multiply-add guard.** `internal/detguard` compiles the simulation packages for linux/arm64 and for linux/amd64
  with `GOAMD64=v3`, reads the assembly listing and fails on any fused multiply-add instruction (`FMADDD`, `FMSUBD`,
  `FNMADDD`, `FNMSUBD`, `VFMADD231SD`, ...) whose source line is in a simulation package, inlined code included.
* **Source guard.** The same package type-checks the simulation packages and fails on a float product that is not
  explicitly rounded and on a call to an architecture dependent function of package `math`.
* **Math library tests.** `mathx/detmath` is tested for accuracy against package `math` and against a table of result bits
  recorded on arm64 and verified on amd64.
* **Finding a divergence.** `burrowplay -headless -ticks N -hash-every 1 <project>` prints the hash after every tick: run
  it on two machines and diff the output to find the first tick that differs.

## Rules for contributors

In a simulation package (the list is `SimPackages` in `internal/detguard`):

1. Round every float product before it is added or subtracted, and before it is stored, returned or passed on (after
   inlining, a product stored in a variable can still be fused with an addition elsewhere): `float64(a*b) + c`,
   `V3{float64(v.X * s), ...}`. A product that only feeds another product, a division, a comparison or a conversion needs
   nothing. Write `x = float64(x * s)` instead of `x *= s`.
2. Do the same for a division by a constant: `float64(x / 2)`.
3. Use `detmath.Sin`, `detmath.Atan2`, `detmath.Pow`, ... instead of the `math` functions.
4. Never iterate a map where the order reaches the state; sort with a total key.
5. A line that is provably safe can opt out with a reason: `//burrow:fma-ok exact: both factors are small integers`. Use it
   rarely; the reason is reviewed.
6. A new package that runs in the tick goes into `SimPackages`.

`go test ./internal/detguard` checks rules 1 to 3 in a few seconds.

## Rules for script authors

* WebAssembly scripts are deterministic: the WebAssembly specification forbids fused multiply-add and the runtime follows it.
  Avoid NaN in values you keep, and clamp before converting floats to integers.
* Go scripts that the engine compiles to WebAssembly get the same guarantee. A Go program that embeds the engine and adds its
  own simulation systems follows the contributor rules above for those systems.
* Never read the wall clock, the machine or unseeded randomness from simulation code: use the tick and the seeded
  `burrowsdk.Rand` family.

## Script module bytes must not depend on the build machine

The script RNG is seeded from the content hash of the wasm module, so the module bytes are part of the determinism contract. `script/guestbuild` therefore builds with `-trimpath`, `-X=runtime.modinfo=` and `-buildid=`: the linker build id otherwise hashes the checkout path of a `replace`d engine, and two machines building the same project got different modules and different StateHashes. `make portability` builds the templates on each host to catch this.
