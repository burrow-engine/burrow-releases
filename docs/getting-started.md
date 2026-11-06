# Getting started

New here? The [tutorials](tutorials/01-first-project.md) walk through a first project in the editor; this page covers installation and the command line. Inside the editor, press F1 for the same pages.

## 1. Install

You need macOS on Apple silicon, Go 1.24+ (the repository targets Go 1.27), and Homebrew packages:

```sh
brew install go molten-vk vulkan-loader glfw shaderc vulkan-validationlayers
git clone <this repository> burrow && cd burrow
go install ./cmd/burrow ./cmd/burrowplay ./cmd/burrowedit        # puts the tools in $(go env GOPATH)/bin
burrow doctor
```

`burrow doctor` checks Go, the Homebrew formulae, the MoltenVK ICD file, a Metal device, the `GOOS=wasip1`
toolchain (needed to compile scripts), the Burrow binaries and whether the default (restricted-licence) block texture pack is embedded in this build, and prints the exact fix for every problem.
Only Go, MoltenVK and Metal are required; the rest is optional (`shaderc` only if you rebuild shaders,
validation layers only for GPU debugging).

Keep `burrow`, `burrowplay` and `burrowedit` in the same directory: `burrow` looks next to itself first, then on `PATH`,
then builds them from a trusted Burrow source checkout: `--burrow-root`, `$BURROW_ROOT`, or the checkout `burrow` itself was built from
(not available in `-trimpath` builds: set `BURROW_ROOT`). **The working directory and the project are never searched**, so opening
somebody else's project cannot make `burrow` build and run its code as "burrow". Tools are built with `-trimpath` into a private (0700) cache keyed by the
checkout path, a hash of its sources and `go.sum`, the platform and the build tags; a cached binary that is not yours or is group/world-writable is refused.
Set `BURROW_ROOT=/path/to/burrow` if you moved the checkout. Without any checkout (the Windows creator kit), script projects `replace burrow-engine` with the kit's minimal `sdk/` module (found next to `burrow.exe`, or `$BURROW_SDK`): it holds only `sdk/burrowsdk`. See [security.md](security.md) for the trust model.

You never need to export the MoltenVK variables for `burrow` commands: `burrow run` and `burrow edit` pass
`DYLD_FALLBACK_LIBRARY_PATH` and `VK_ICD_FILENAMES` (and `VK_LAYER_PATH` with `--validate`) to the child
explicitly. For manual `go run` / `go test` use `eval "$(burrow shell-env)"`.

## 2. Create a game

```sh
burrow new mygame --template sandbox     # sandbox | empty | builder | models | scripted | multiplayer
cd mygame
```

| template | what you get |
|---|---|
| `sandbox` | streamed hills with trees, first-person controller, HUD (the `voxel_sandbox` example as a project) |
| `empty` | a flat world and an empty scene: your starting point |
| `builder` | flat world + one Go script: keys 1-4 stamp a tower, wall, pyramid or house |
| `models` | flat world + an `.obj` mesh with a textured material, a `.vox` model and a billboard sprite, all resolved through the asset registry (also from a packed game) |
| `scripted` | flat world + three scripts: a spinning cube, a voxel painter, a wandering AI |
| `multiplayer` | flat world + first-person controller + a base `avatars` script that moves one avatar per connected player from the server registry (`net_player_info`); overload it for your game (see [multiplayer scripting](scripting/08-multiplayer.md)) |

A project directory:

```
vox.project          manifest (JSON): name, asset directories, default scene, input map, runtime section
scenes/main.voxscn   the default scene (node tree + components)
input.json           input actions and bindings
assets/              textures, models, worlds, compiled scripts (assets/scripts/*.wasm)
scripts/<name>/      Go source of scripts (scripted and builder templates), with go.mod at the root
worlds/              optional .voxworld edit overlays
```

### The `vox.project` runtime section

Everything is optional; defaults in brackets.

```json
{
  "schema": 1,
  "name": "mygame",
  "engine": "0.2.1",
  "asset_dirs": ["assets", "scenes"],
  "default_scene": "scenes/main.voxscn",
  "input_map": "input.json",
  "scripts": ["assets/scripts/spin.wasm"],
  "runtime": {
    "title": "My Game",            // window title [project name]
    "width": 1280, "height": 720,  // window size [1280x720]
    "radius": 8,                   // terrain load radius in chunk columns [8]
    "mode": "fly",                 // "fly" or "walk" [fly]
    "start": [0, 40, 0],           // player start (feet) [above the terrain at 0,0]
    "yaw": 0, "pitch": 0,          // start orientation in degrees
    "seed": 1,                     // world seed [the .voxworld's seed, else 1]
    "world": "worlds/a.voxworld",  // edit overlay loaded at start
    "tick_rate": 20,               // fixed; only 20 is accepted
    "weather": false, "seasons": false, // deterministic weather simulation, see docs/weather.md [off]
    "vsync": true,
    "generator": { "kind": "heightmap", "base": 24, "amp": 20, "scale": 64, "octaves": 4,
                   "sea_level": 20, "caves": false, "trees": true },
    // or { "kind": "flat", "surface_y": 8, "depth": 8 }
    "plugins": { "physics": true, "scripts": true, "input": true, "controller": true, "render": true }
  }
}
```

(The JSON above has comments for illustration; real files must not.) Unknown fields are rejected with a
spelling hint. `plugins.render: false` runs the project without a window. Only `render`, `input`, `controller`, `character` and `fine_water` are on by default; every plugin that adds simulation state (physics, nav, net, scripts, levels, saves, audio, ...) is off until you set it to `true`, and `scripts` is required as soon as `vox.project` lists scripts (the defaults table is in [reference/project-config.md](reference/project-config.md#runtimeplugins)). `burrow new` templates enable exactly what they use. Settings come from, in order of priority: command-line flags, `BURROW_*` environment variables, `vox.project`, then the defaults of the engine; a scene's `scene.settings` (`controller`, `hud`) only applies while that scene runs.

## 3. Play, edit, test, ship

```sh
burrow run                       # = burrowplay . (builds stale scripts first)
burrow run -- -shot out.png -frames 60     # flags after -- go to burrowplay: render a PNG and exit
burrow edit                      # = burrowedit -project .  (Play button runs the game inside the editor)
burrow test                      # headless check, exits 1 on any problem
burrow build -o mygame           # single-file game
```

### burrowplay (the game runner)

```
burrowplay [flags] [project-dir | game.voxpak]      # no argument: the pak appended to the executable, else "."
  -headless -ticks N -hash       no window or GPU; print "tick=N StateHash=<hex>"
  -shot out.png -frames N        render N frames in a hidden window, save a PNG (needs the GPU); the game keeps running
                                 while it settles, add -freeze for a reproducible shot (no ticks, sky/water frozen)
  -ticks N (with a window)       warm start: run N REAL fixed ticks first (journaled Step commands, so -journal/-replay
                                 reproduce the same StateHash as -headless -ticks N), then show/shoot that state
  -journal j.json                write the session journal on exit
  -replay j.json -expect <hex>   replay a journal with the project's configuration; exit 1 on mismatch
  -json                          machine-readable results
  -scene scenes/x.voxscn         start on this scene of the project instead of its default_scene
  -level id [-spawn name]        start in this level of levels/ (at this spawn point) instead of levels.initial
  -seed N -radius N -w N -h N -novsync -validate -nocapture -check
```

Headless runs are deterministic: the same project, seed and tick count print the same hash on every run
and every `GOMAXPROCS`, and on macOS Apple silicon and Intel (Windows and Linux are checked by CI, which has not run yet); `burrow test` verifies exactly that (runs with GOMAXPROCS = default, 1 and 8) and also
replays the journal. In a window, one fixed tick passes every 50 ms of wall time; the window and renderer are frame-domain
and never affect the `StateHash`.

### Editing files from the shell

No hand-written JSON, no quoting fights (also on Windows):

```sh
burrow config get runtime.plugins.controller        # read vox.project by dotted path
burrow config set runtime.plugins.controller false  # JSON value, else a string; validated, atomic, formatting kept
burrow config set runtime.camera.rigs[1].fov 70     # array element by index (a.b[2] or a.b.2); a.b[] appends; rm removes
burrow config rm runtime.camera.rigs[1]
burrow scene get scenes/main.voxscn                 # nodes with their ids, paths and components
burrow scene set-component scenes/main.voxscn /Sun render.pointlight intensity=3 range=20
burrow scene rm-component scenes/main.voxscn /Sun render.pointlight
burrow docs search icon names                       # ranked file:line hits in the embedded docs
burrow ui icons                                     # builtin game UI icon names
burrow icon from logo.png -out icon.png             # square 1024 app icon (pad or -mode crop, -crop x,y,w,h)
```

Every write is checked with the project and scene loaders first; a refused edit leaves the file untouched.

### burrow test

`burrow test [dir] [--ticks 200] [--runs 3] [--json]` loads the project, builds stale scripts, runs the ticks several times
under different `GOMAXPROCS`, requires identical hashes, no failed commands, no script faults and an exact journal replay,
and, with `--go-tests` only, runs `go test ./...` of the project when it has its own tests (**that compiles and runs the project's
Go code natively and unsandboxed**: use it only on projects you trust). Typical CI use:

```sh
burrow test --json | jq -e .ok
```

### burrow build

```sh
burrow build -o mygame            # copy of burrowplay + game archive + trailer
./mygame                       # runs anywhere on the same OS/arch, no Go, no project folder
./mygame -headless -ticks 200 -hash
burrow build -o mygame --app      # mygame.app (INSTEAD of the plain executable) + mygame.build.json
burrow build --pak game.voxpak    # only the archive (burrowplay game.voxpak runs it)
```

The archive (`.voxpak`) holds `vox.project`, every file under `asset_dirs` (compiled scripts included), the default scene, input map and world
overlay. Paths are sorted, each file is stored or zlib-compressed with its SHA-256, and the whole archive is hashed:
building twice gives identical bytes, and `./mygame` verifies the hash before unpacking it into a private (0700, random-named) temp
directory that is removed on exit (also on SIGINT/SIGTERM). The build result is recorded next to the output as `<out>.build.json`
(with `--app`: `mygame.app` and `mygame.build.json`). Hash and replay a scripted or builder game with
`./mygame -headless -ticks 200 -hash -journal j.json` and `./mygame -replay j.json -expect <hash>`.

Limits: `--target` accepts only the native target (`darwin-arm64`): burrowplay needs cgo (GLFW, Cocoa) and MoltenVK, so
cross-compiling needs the target SDK. `--app` bundles `libvulkan.1.dylib` and `libMoltenVK.dylib` from Homebrew (with a driver manifest, `install_name_tool` sets their ids); the game archive ships once, as `Contents/Resources/game.voxpak` (the executable loads it from its bundle), and the whole
bundle is ad-hoc signed once, so `codesign --verify --deep --strict mygame.app` passes; the app is not notarised. If bundling is not possible the app
still runs on Macs that have Homebrew `molten-vk` installed, and macOS prints the missing library path.

Signing and distribution (checked on macOS 15+): the game and the `.app` carry an ad-hoc signature, which is enough to run on the Mac
that built them (the `.app` passes `codesign --verify --deep --strict`; the plain executable has the archive appended after the Mach-O,
which strict validation reports, so for strict validation, Gatekeeper and notarisation distribute the `.app`). A copy
that is downloaded, AirDropped or unzipped gets the `com.apple.quarantine` flag and Gatekeeper rejects it (`spctl --assess` says
"rejected"; double-click shows "cannot be opened because the developer cannot be verified"). The recipient can clear the flag with
`xattr -dr com.apple.quarantine mygame.app`. To distribute without that step, sign with a Developer ID certificate and notarise
(`codesign --force --deep --options runtime -s "Developer ID Application: NAME" mygame.app`, zip it, `xcrun notarytool submit mygame.zip --wait`,
`xcrun stapler staple mygame.app`); Burrow does not do this for you. The default block textures are restricted-licence: see [texture-packs.md](texture-packs.md) before you distribute.

## 4. Scripts

```sh
burrow script new spin               # scripts/spin/main.go (+ go.mod if missing)
burrow script build                  # scripts/*/ -> assets/scripts/*.wasm
burrow script check                  # ABI check of every module
```

Attach a script to a node with the `script` component: `{"module": "assets/scripts/spin.wasm", "props": {"speed": 90}}`.
See [scripting.md](scripting.md).

## 5. Next

[concepts.md](concepts.md) explains the two domains and the determinism rules; [editor.md](editor.md) the editor;
[troubleshooting.md](troubleshooting.md) the usual macOS problems.

## Naming and compatibility

The engine was called "vox" before it became Burrow. The product, the Go module and the programs are renamed; the file formats
and the wire-level identifiers are not, so existing projects, worlds, packs, scripts and agent integrations keep working.

Renamed:

* Go module `vox` -> `burrow-engine` (import `"burrow-engine"`, package name `burrow`; `burrow-engine/sdk/burrowsdk` for scripts).
* Programs: `vox` -> `burrow`, `voxedit` -> `burrowedit`, `voxd` -> `burrowd`, `voxctl` -> `burrowctl`, `voxplay` -> `burrowplay`,
  `voxasset` -> `burrowasset`, `voxscript` -> `burrowscript`, `voxshot` -> `burrowshot`, `voxgen` -> `burrowgen`, `voxlive` -> `burrowlive`,
  `voxshader` -> `burrowshader`, `voxpacktool` -> `burrowpacktool` (`vkprobe` and `lookmeasure` are unchanged).
* The `--vox-root` flag of `burrow new` / `burrow script new` is now `--burrow-root` (the old spelling still works), and `burrowctl` keeps its
  session in `.burrow/` by default (pass `-dir .vox` to continue an old session).
* Environment variables are `BURROW_*` (`BURROW_ROOT`, `BURROW_GPU`, `BURROW_LIVE`, ...). The old `VOX_*` names are still read as a
  fallback when the `BURROW_*` one is not set (an explicitly empty `BURROW_X` wins). All reads go through `internal/envx`.

Kept on purpose:

* File names and formats: `vox.project`, `.voxscn`, `.voxworld`, `.voxpak` (trailer `VOXGAME1`), `.vmeta`, and the MagicaVoxel `.vox` format.
* MCP tool names (`vox_*`, `editor_*`) and the agent/JSON-RPC schemas.
* The WASM ABI: its version, the `vox` host import module and the export names, so compiled scripts keep loading.
* The `voxel_*` host functions, shader names and the word "voxel" everywhere.

