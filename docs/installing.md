# Installing Burrow

One download per system. You get the **Burrow Hub**; the Hub installs and updates the engine versions (editor, `burrow` command line, documentation, templates) side by side and opens
your projects. Pick the file for your system on the [download page](https://burrow-engine.github.io/burrow-releases/download/).

| system | file | what it is |
|---|---|---|
| Windows 10/11 x64 | `BurrowSetup-<version>-x64.exe` | installer: Hub and the whole engine, works offline (recommended) |
| | `BurrowHubSetup-<version>-x64.exe` | small installer: the Hub only; it downloads the engine after you agree |
| Windows 11 ARM64 | `BurrowSetup-<version>-arm64.exe`, `BurrowHubSetup-<version>-arm64.exe` | same as x64 |
| macOS (Apple Silicon and Intel) | `Burrow-<version>-macos-universal.dmg` | disk image with `Burrow.app` (or `-arm64.dmg` / `-x86_64.dmg`, one CPU each, smaller) |
| Linux x86_64 | `Burrow-<version>-linux-x86_64.AppImage` | one file, no install |
| | `Burrow-<version>-linux-x86_64.tar.gz` | `install.sh`: user install, menu entry, no root |
| | `burrow_<version>_amd64.deb` | system install (Debian, Ubuntu) |
| Linux ARM64 | the same three files with `aarch64` / `arm64` | |

**The builds are not signed yet.** Windows and macOS show a warning the first time; that is expected and the steps below get past it. Check the SHA-256 of the file against the download page
before you run it (`burrowrelease verify` and the Hub's own signature check cover the Hub's updates, see [Hub](hub.md)).

**Status, honestly.** The Windows x64 build and the macOS Apple Silicon build have been run by the maintainers. The Windows ARM64, macOS Intel, Linux and `.deb`/AppImage packages are built by
the same scripts but have **not been tried on real hardware yet**; treat them as preview until testers confirm them, and please [report what happens](troubleshooting.md).

## Windows

1. Run `BurrowSetup-<version>-x64.exe`. Windows SmartScreen says "Windows protected your PC": click **More info**, then **Run anyway**.
2. The installer asks for nothing special: it installs for **you only** in `%LOCALAPPDATA%\Programs\Burrow` and needs no administrator rights. "Install for all users" (Program Files) asks for administrator
   approval. Tick or untick the Start menu and desktop shortcuts, then Finish. Burrow Hub starts.
3. Silent install: `BurrowSetup-<version>-x64.exe /S` (add `/allusers` for all users, `/D=C:\Tools\Burrow` as the last argument for another folder).

Uninstall: Settings > Apps > Burrow, or `Uninstall Burrow` in the Start menu. Your projects are never touched. The Hub's settings, project list and downloaded engines
(`%APPDATA%\Burrow`, `%LOCALAPPDATA%\Burrow`) are kept unless you tick the box on the uninstaller page (silent: `Uninstall.exe /S /PURGE`).

There is no file association: a Burrow project is the file `vox.project`, and Windows associates extensions, not names. Open projects from the Hub.

## macOS

1. Open the `.dmg` and drag **Burrow.app** onto **Applications**.
2. The first launch is blocked ("Burrow can't be opened because Apple cannot check it for malicious software"). Open **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next
   to the Burrow message. On macOS 14 and older you can instead right click the app, choose **Open**, then **Open**. From Terminal: `xattr -dr com.apple.quarantine /Applications/Burrow.app`.
3. Nothing else to install: the Vulkan runtime (MoltenVK and the Vulkan loader, Apache-2.0) is inside the app. Needs macOS 11 or newer.

The app is ad-hoc signed (its files are sealed as a set) but not notarized by Apple. **Updates**: the Hub updates the engine versions itself, and itself too: with automatic checks on, a new Hub is downloaded in the background, replaces the one in `Burrow.app` the next time you start it and the app is signed again with the system's `codesign`. If the app folder is not writable or `codesign` is missing, the Updates tab says so: download the new disk image and replace `Burrow.app`. Uninstall: drag `Burrow.app` to the Trash; delete `~/Library/Application Support/Burrow` to remove settings and engines.

## Linux

You need a Vulkan driver (`libvulkan.so.1` and the driver for your graphics card). The app tells you what to install when it is missing:
Debian/Ubuntu `sudo apt install libvulkan1 mesa-vulkan-drivers`, Fedora `sudo dnf install vulkan-loader mesa-vulkan-drivers`, Arch `sudo pacman -S vulkan-icd-loader vulkan-radeon` (or `vulkan-intel`, `nvidia-utils`).

**AppImage**: `chmod +x Burrow-<version>-linux-x86_64.AppImage && ./Burrow-<version>-linux-x86_64.AppImage`. It needs FUSE 2 (`sudo apt install libfuse2` on Ubuntu 22.04+). Without FUSE, run
`./Burrow-...AppImage --appimage-extract-and-run`. An AppImage updates the engine versions but not itself: download the new file to update the Hub.

**tar.gz**: `tar xzf Burrow-<version>-linux-x86_64.tar.gz && cd burrow-<version>-linux-x86_64 && ./install.sh`. It installs in `~/.local/share/burrow/app`, adds "Burrow Hub" and "Burrow Editor" to the application menu and
the commands `burrow-hub` and `burrow` in `~/.local/bin` (add that folder to your `PATH` if needed). This install can update the Hub itself. Uninstall: `~/.local/share/burrow/app/uninstall.sh` (`--purge` also deletes settings and engines).

**.deb**: `sudo apt install ./burrow_<version>_amd64.deb` installs in `/opt/burrow` with `burrow-hub` and `burrow` in `/usr/bin`. Update the Hub with the package; the Hub updates engine versions. Remove: `sudo apt remove burrow`.

## After installing

Start **Burrow Hub**. The first run offers to use the engine that came with it (or to download the newest one). Then either press **Play the Sandbox** to try the Sandbox game (the Hub installs it for you), or create a project from a template ([Getting started](getting-started.md)).
Settings and downloaded engines live in `%APPDATA%\Burrow` and `%LOCALAPPDATA%\Burrow` (Windows), `~/Library/Application Support/Burrow` (macOS), `~/.config/burrow` and `~/.local/share/burrow` (Linux).

## Advanced: portable archives

You do not need these to use Burrow. The Hub itself uses the per-platform archives (`Burrow-Engine-<os>-<arch>` and `Burrow-Hub-<os>-<arch>`, `.zip` on Windows, `.tar.gz` elsewhere) to install engine versions and updates, and you can unpack one by hand
for a portable folder where nothing is installed (for example `Burrow-Engine-windows-x64.zip`). The Sandbox and the templates are installed from the Hub, not from a separate download.
