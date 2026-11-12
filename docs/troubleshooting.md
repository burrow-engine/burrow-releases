# Troubleshooting

Start with `burrow doctor`: it checks the requirements and prints the fix for each failure.

## SIP strips DYLD_* variables

macOS System Integrity Protection removes `DYLD_*` variables when a command is started through `/bin/sh` or another protected binary
(make recipes, `sh -c`, scripts with `#!/bin/sh`). Symptoms: the variable is set in your shell but a program started by `make` or a shell script does not see it
("Library not loaded" or no Vulkan device). Fixes:

* Use `burrow run` / `burrow edit`: they start children with an explicit environment (`os/exec`).
* In a Makefile recipe pass it on the command line: `env DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib go run ./cmd/burrowedit`.
* Run `eval "$(burrow shell-env)"` in an interactive shell for manual commands.
* Do not pipe a GPU run into another program and trust the exit code: `cmd | tee log` hides failures (use a temp file and capture `$?`; `make lint` checks Makefiles for this).

## MoltenVK / "no Vulkan device"

* `brew install molten-vk` and check `/opt/homebrew/etc/vulkan/icd.d/MoltenVK_icd.json` exists. `burrow shell-env` prints `VK_ICD_FILENAMES`.
* The binaries do not link MoltenVK: they open the Vulkan loader at run time (inside the `.app` first, then next to the program, then Homebrew) and the
  loader finds MoltenVK through its driver manifest. `BURROW_VULKAN_DIR`, `BURROW_VULKAN_LIB` and `VK_ICD_FILENAMES` override the lookup; see
  [Platforms](platforms.md). `burrow build --app` bundles the loader, MoltenVK and the manifest.
* Needs a Metal device: `burrow doctor` reports it. Virtual machines without Metal cannot run the windowed engine; use the headless tools.
* Run `go run ./cmd/vkprobe` to see what the Vulkan instance reports.

## Validation layers

`brew install vulkan-validationlayers vulkan-loader`; set `VK_LAYER_PATH=/opt/homebrew/opt/vulkan-validationlayers/share/vulkan/explicit_layer.d` (done by
`burrow shell-env`, `burrow run --validate`, `burrowplay -validate`). The layer needs the loader, which is not linked by default builds. `make render-test`,
`make ui-test` and `make edit-test` fail when the log contains `VUID` or `Validation Error`.

## cgo

The windowed engine needs cgo (GLFW, Cocoa, MoltenVK) and the Xcode command line tools (`xcode-select --install`). With `CGO_ENABLED=0` the module still
builds: `WindowPlugin`, `RenderPlugin` and `burrowedit` (windowed) report "needs cgo", while `burrowplay -headless`, `burrow test`, `burrowd` and
`burrowedit -headless` work. Cross-compiling windowed builds is not supported.

## Scripts

* `the Go toolchain cannot build GOOS=wasip1`: install Go 1.24 or newer from go.dev (Homebrew's `go` has the port).
* `blocks nested deeper than 512` (the module is refused at load): the Go compiler inlined too deep for the engine's structural cap (its own `gas.Limits` check, run before wazero compiles — not a wazero limit). Rebuild with inlining disabled:
  `GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -buildmode=c-shared -trimpath -gcflags=all=-l -ldflags="-s -w -X=runtime.modinfo= -buildid=" -o out.wasm ./scripts/<name>`.
  `burrow script build` and `burrowscript build` retry with `-gcflags=all=-l` automatically and the error names the flag.
* `no required module provides package burrow-engine/sdk/burrowsdk`: the project's `go.mod` must contain `require burrow-engine v0.0.0` and
  `replace burrow-engine => /path/to/burrow` (the Vulkan bindings are a package of that module, no second `replace`; an old `replace github.com/goki/vulkan` line can be deleted). `burrow new` writes this when it can find the checkout
  (`--burrow-root` or `BURROW_ROOT`); then run `go mod tidy`.
* Faults: a script that traps, exceeds gas or panics is rolled back and disabled after 3 faults. `burrow test` fails on faults and prints the count.
* The game window's input map only sees the controller's keys (see [scripting.md](scripting.md)).

## Library loading and the working directory (security hardening)

* dyld resolves a **bare** `dlopen("libvulkan.1.dylib")` against the current working directory first, so a hostile dylib of that name in a project
  directory would run inside the engine. Two defences: `third_party_vulkan/vk_default_loader.c` opens the Vulkan loader by **absolute** path only on
  macOS (`/opt/homebrew/lib`, `/usr/local/lib`), and `window.Init` and `cmd/vkprobe` `chdir("/")` while GLFW initialises, because GLFW itself dlopens
  the bare name (the old directory is restored afterwards). If the window fails with "Vulkan loader not found", install `vulkan-loader` (see `burrow doctor`)
  instead of copying a dylib next to your game: a `libvulkan*.dylib` in the project directory is deliberately ignored.
* Any new program that calls `glfw.Init` itself must do the same `chdir("/")` dance; use `window.Init`.

## Builds and games

* `./game` says the archive hash mismatches: the file was modified or truncated; rebuild.
* `burrow build --target ...` is refused except for the native target.
* A `.app` that does not start when double-clicked: run `Contents/MacOS/<name>` from a terminal to see the error. A missing Vulkan loader or driver is reported in a dialog with what to install.
* Gatekeeper blocks downloaded games: apps are ad-hoc signed, not notarised, so a copy with the quarantine flag is rejected. Run `xattr -dr com.apple.quarantine <app>` on it (see "Signing and distribution" in getting-started.md).

## Determinism surprises

`burrow test` reports `StateHash differs` when a script or system reads something outside the simulation. Check for `time`, `math/rand`, map iteration and goroutines in FixedUpdate code;
see [concepts.md](concepts.md). `burrowplay -replay` names the first journal entry that fails.
