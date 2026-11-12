# Platforms

Burrow v1 targets the desktop: Windows, macOS and Linux, on x64 and ARM64, all through Vulkan (MoltenVK on macOS). Web and mobile are out of scope for now. This page states what is verified and what is not, because "it builds" and "it runs" are different claims.

## Support matrix

Status words: **tested** = run by a developer on that machine; **CI** = built and checked on a native GitHub Actions runner (the workflows are in the repository); **cross-compiled** = the binary was produced from another machine and never run; **untested** = not built yet.

| OS | CPU | Renderer | Windowed engine | Headless tools (`burrow`, `burrowplay -headless`, `burrowd`) |
|---|---|---|---|---|
| macOS 11+ | arm64 (Apple silicon) | Vulkan on Metal (MoltenVK) | tested (developer machine); CI on pushes to `main` | tested; CI |
| macOS 11+ | x64 (Intel) | MoltenVK | cross-compiled from arm64; never run; optional CI runner | cross-compiled; the simulation hash matches arm64 under Rosetta |
| Windows 10 1809+ / 11 | x64 | Vulkan 1.3 driver | cross-compiled with mingw from macOS; never run on real hardware; CI on pull requests | cross-compiled; CI |
| Windows 11 | arm64 | Vulkan 1.3 driver | untested: no toolchain here; optional CI runner | cross-compiled (Go only) |
| Linux (glibc, X11 or XWayland) | x64 | Vulkan 1.3 driver (Mesa, NVIDIA) | never compiled before this work; CI native build plus a software-Vulkan (lavapipe) smoke | cross-compiled; CI |
| Linux (glibc, X11 or XWayland) | arm64 | Vulkan 1.3 driver | untested; optional CI runner | cross-compiled; optional CI |

Honest reading: today only macOS arm64 has ever shown a frame. The CI configuration exists so that the other five rows get a real answer; until its first green run, treat them as untested.

Not supported: 32-bit systems, FreeBSD and other Unix systems, Android, iOS, the web, native Wayland (Wayland desktops run Burrow through XWayland).

## Requirements

All platforms: a GPU and driver exposing Vulkan 1.2 or newer with the 1.3 features `dynamicRendering` and `synchronization2` (the engine asks for 1.3, falls back to 1.2 with those features, and refuses a device without them). Rough guide, not a tested list: a GPU from roughly 2015 or later with a current driver (NVIDIA Maxwell and newer, AMD GCN and newer, Intel Skylake and newer), every Apple silicon Mac. If `vulkaninfo --summary` shows a Vulkan 1.3 device, Burrow should start.

| OS | What to install | Notes |
|---|---|---|
| Windows | The graphics driver (NVIDIA, AMD, Intel) from the vendor, which provides `vulkan-1.dll`. | The loader is opened from `System32` only. Remote desktop and virtual machines without a GPU driver have no Vulkan. |
| macOS | Nothing for a packaged app: the Vulkan loader and MoltenVK are inside the `.app` (`Contents/Frameworks`, driver manifest in `Contents/Resources/vulkan/icd.d`). | A development build uses Homebrew (`brew install molten-vk vulkan-loader`). Needs a Metal-capable GPU; virtual machines without Metal cannot run the windowed engine. |
| Linux | `libvulkan1` plus a driver: `mesa-vulkan-drivers` (AMD, Intel, and the lavapipe software renderer), or the NVIDIA proprietary driver. An X11 or XWayland session. | Fedora: `vulkan-loader mesa-vulkan-drivers`. Arch: `vulkan-icd-loader` plus `vulkan-radeon`, `vulkan-intel` or `nvidia-utils`. Check with `vulkaninfo --summary`. Sound uses PulseAudio or PipeWire (through its PulseAudio server) first, then ALSA (`libasound.so.2`); without either the game runs silent. |

Building from source on Linux needs the GLFW development packages: `libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev libxxf86vm-dev libgl1-mesa-dev pkg-config` (Debian and Ubuntu names) and a C compiler. On Windows x64 use MinGW-w64 gcc (MSYS2); on Windows arm64 use clang from MSYS2 CLANGARM64. On macOS, Xcode command line tools.

## How the Vulkan loader is found

The lookup runs before the loader starts (`internal/vkenv`, used by `window.Init`).

macOS, first match wins for the loader (`libvulkan.1.dylib`) and the MoltenVK driver manifest (`MoltenVK_icd.json`):

1. `BURROW_VULKAN_LIB` (absolute path of the loader file) and an already set `VK_ICD_FILENAMES` or `VK_DRIVER_FILES` (never overridden).
2. `BURROW_VULKAN_DIR` (a folder laid out like one of the places below).
3. The app bundle: `Contents/Frameworks`, `Contents/Resources/vulkan`.
4. Next to the executable, and `lib/` beside it.
5. System: `/opt/homebrew/lib`, `/usr/local/lib`, `~/VulkanSDK/macOS/lib`.

When a driver manifest is found the engine exports `VK_ICD_FILENAMES` and `VK_DRIVER_FILES` for the process; when only `libMoltenVK.dylib` is found it writes a manifest into a private temporary folder. Executables do not link MoltenVK: nothing in a shipped binary points at `/opt/homebrew`. The loader is opened by absolute path only (a bare name would let dyld search the working directory).

Linux: the system loader `libvulkan.so.1` (no bundled copy). `BURROW_VULKAN_LIB` can point at another loader. Windows: `System32\vulkan-1.dll` only, overrides are ignored on purpose (DLL search-order hijacking).

When no driver is found the editor, the Hub and `burrowplay` print the install hint to stderr and, on Windows and macOS, show a message box. On Windows the same text lands in the log file. `burrow doctor` runs the same checks ahead of time (loader, driver, display server, platform).

## Environment variables

| Variable | Effect |
|---|---|
| `BURROW_VULKAN_LIB` | Absolute path of the Vulkan loader to open first (macOS, Linux). |
| `BURROW_VULKAN_DIR` | macOS: folder holding `libvulkan.1.dylib` and the MoltenVK manifest or library. |
| `VK_ICD_FILENAMES`, `VK_DRIVER_FILES` | Standard Vulkan variables; honoured and never overridden. On Linux, point at `lvp_icd.json` to force the software renderer. |
| `BURROW_NO_DIALOG=1` | Never show a message box (used by CI and tests). |
| `BURROW_BREW_PREFIX` | macOS development: Homebrew prefix when it is not `/opt/homebrew` or `/usr/local`. |
| `BURROW_SOUNDS`, `BURROW_SDK`, `BURROW_ROOT`, `BURROW_CACHE_DIR`, `BURROW_HUB_HOME` | See [Audio](audio.md), [Getting started](getting-started.md) and [Security](security.md). |

## Where things live

| What | Windows | macOS | Linux |
|---|---|---|---|
| Hub settings, projects, engine versions (`BURROW_HUB_HOME` overrides) | `%AppData%\Burrow` (settings), `%LocalAppData%\Burrow` (engines) | `~/Library/Application Support/Burrow` | `~/.config/burrow` (settings), `~/.local/share/burrow` (engines), XDG variables honoured |
| Editor layout, appearance, autosave | `%AppData%\burrow-editor` (from `os.UserConfigDir`) | `~/Library/Application Support/burrow-editor` | `$XDG_CONFIG_HOME/burrow-editor` or `~/.config/burrow-editor` |
| Tool cache | `$BURROW_CACHE_DIR`, else the user cache folder | `~/Library/Caches/burrow` | `$XDG_CACHE_HOME/burrow` or `~/.cache/burrow` |
| Your sound packs | `%USERPROFILE%\.burrow\sounds` | `~/.burrow/sounds` | `~/.burrow/sounds` |
| Log | `Burrow.log`, `BurrowEditor.log` next to the program (else `%TEMP%`), only when there is no console | the terminal (no log file is written) | the terminal (no log file is written) |
| Project cache and thumbnails | `<project>/.burrow-cache` | same | same |

Linux file systems are case sensitive: asset names in a project must match their case exactly (`Stone.png` is not `stone.png`). Windows and macOS usually are not, so a project can work there and fail on Linux: keep names consistent.

## Display scaling (HiDPI)

The Hub, the editor and runtime windows follow the display scale of the system, so the interface has a normal physical
size on a 4K monitor.

- **Automatic (default).** The window asks the system for its content scale (Windows display scaling per monitor, `Xft.dpi`
  on X11, the output scale on Wayland, the Retina factor on macOS), rounds it to the nearest step (100, 125, 150, 175, 200,
  250 or 300 percent) and lays out and rasterises text, icons and borders at that size, so glyphs stay sharp. Moving a window
  to a monitor with another scale re-lays it out at once.
- **Setting.** Hub: Settings, Display, UI scale (`ui_scale` in `hub.json`). Editor: Preferences, UI scale. A fixed value is
  a percentage of the platform's logical size: 100 is normal on a 1x display and on macOS (where the Retina factor is added
  on top), 150 is one and a half times larger than that.
- **Shortcuts.** Ctrl and plus, Ctrl and minus, Ctrl and 0 (Cmd on macOS) in the Hub and the editor: larger, smaller, back
  to automatic. The choice is saved.
- **Environment.** `BURROW_UI_SCALE` (`auto`, `150`, `150%` or `1.5`) overrides the setting. On Linux, when the window system
  reports no scaling at all, `GDK_SCALE` and `QT_SCALE_FACTOR` are used as a hint. The scale never goes so high that the
  window holds less than 800 by 480 logical pixels.
- **Window size.** A window without a requested size covers about 70 percent of the work area of the primary monitor (at least
  960 by 600 logical pixels), centred. Position and size are remembered per window in `<user config dir>/burrow/window/` and
  restored only when the window is still on a connected monitor.
- **Windows.** Every executable embeds an application manifest that declares per-monitor DPI awareness v2, long path support and
  the requested execution level `asInvoker` (no administrator rights), together with a version resource (company, product,
  description, version, copyright). Without the DPI declaration Windows would stretch the window as a bitmap. The sources are in
  `assets/winres/`.
- **Game HUD.** `gameui` scales with the window height (reference 720 px), so it grows with the resolution; its `Scale` option
  multiplies that.

## Determinism across platforms

`StateHash` is meant to be the same on every OS and CPU; verified today on macOS Apple silicon and Intel (Rosetta), while Windows and Linux are checked by the CI workflow against the golden hash, which has not run yet. The simulation (voxel world, water, the standard game rules, 2D and 3D physics, navigation, animation, weather, scripts) uses integer math where it can, and its float math rounds every product explicitly and takes its trigonometry, exponentials and logarithms from a deterministic library instead of the platform's. `scripts/portability-hash.sh` runs the eight templates for 200 ticks and compares the hashes with the committed golden (`scripts/portability-golden.txt`); every CI job runs it. On one Mac the arm64 and the amd64 (Rosetta) binaries give identical hashes for all eight templates at 200 and 2000 ticks; the other operating systems are verified by CI once it has run. Rendering and other frame-domain code is not covered and does not need to be. Details, guards and rules for contributors: [Determinism](determinism.md).

## Known limits

* Graphics: the windowed engine has been run on one GPU family (Apple M2 Max through MoltenVK). Other drivers (NVIDIA, AMD, Intel, Mesa) may expose driver bugs or missing features the renderer has not met.
* Windows binaries are not code signed and Microsoft SmartScreen warns on first run; macOS apps are ad-hoc signed and not notarised, so Gatekeeper asks for confirmation.
* Clipboard: macOS uses the system clipboard through `pbcopy`/`pbpaste`; Windows and Linux use GLFW's clipboard (new in this version, untested on those systems).
* Audio on Linux needs PulseAudio, PipeWire-Pulse or ALSA at run time.
* Wayland sessions run through XWayland (X11 build of GLFW).
* Software rendering (lavapipe, WARP) works for smoke tests but is far too slow to play.
