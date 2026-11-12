# Tutorial 9: export for Windows

`burrow build` packs a project into a single-file game for the machine it runs on. Windows builds are cross-compiled from macOS or Linux with a mingw toolchain and are **untested on real Windows hardware** at the time of writing: read the checklist at the end.

## Steps

1. Check that the project passes its own tests:

   ```sh
   burrow test
   ```

2. Pack the game archive. This `.voxpak` holds `vox.project`, the asset directories, the scene, the input map, the world overlay and the scripts, with a SHA-256 for every file:

   ```sh
   burrow build --pak mygame.voxpak
   ```

   Keep sound packs out of the project folder: the build refuses to pack one ([tutorial 8](08-audio-packs.md)).

3. Install the cross toolchain once (`brew install mingw-w64`) and build the Windows runner and editor from the Burrow checkout:

   ```sh
   make dist-windows
   ```

   This writes `dist/Burrow-Sandbox-windows-x64.zip` with `Burrow.exe` (the sandbox game), the licences and a short README. `make dist-engine-windows` writes `dist/Burrow-Engine-windows-x64.zip`, the creator kit (`BurrowEditor.exe`, `burrow.exe`, `burrowplay.exe`, script SDK, docs, templates); `make dist-all` builds both. With the kit, `burrow build` produces a standalone game from any folder.

4. Put your `mygame.voxpak` next to the executable and start the runner with it: `Burrow.exe mygame.voxpak`. A runner given no argument uses the archive appended to its own executable, else the current folder.

5. Check the licence notes. A game that bundles the default block textures prints their licence warning at build time; use `--no-default-textures` to leave them out (blocks then render flat) or choose your own `runtime.texture_pack`.

## Checklist for players

* Windows 10 or 11, 64 bit, and a graphics driver with Vulkan 1.1.
* The executables are not signed: SmartScreen may warn; choose *More info* then *Run anyway*.
* Keep the whole folder together; do not run from inside the zip preview.

## What to know

* `burrow build --target` only accepts the native target today: cross-compiling the game runner needs the target's C toolchain, which is what `make dist-windows` sets up.
* Everything about a build is recorded in `<out>.build.json`.

See [the CLI reference](../reference/cli.md#burrow-build) for every flag, and [security.md](../security.md) for the trust model of packed games.
