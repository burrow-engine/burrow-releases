# Security and trust model

Burrow runs code and reads files that come from several places. This page says which of them are trusted, what is sandboxed and what is not.

## Trust boundaries

| Input | Trusted? | What runs, and how |
| --- | --- | --- |
| The Burrow source checkout (`--burrow-root`, `$BURROW_ROOT`, the tree `burrow` was built from) | yes | `burrow` builds `burrowplay`, `burrowedit` and `burrowasset` from it with `go build -trimpath` and runs them. Only these three sources name a root; **the working directory and its parents are never used**. |
| A project directory (`vox.project`, scenes, assets) | data only | Parsed with strict validation (size caps, unknown and duplicate JSON keys rejected, finite numbers, bounded ranges, printable title). A symlinked `vox.project` is refused. |
| Project **scripts** compiled by Burrow (`scripts/*/main.go` to `assets/scripts/*.wasm`) | build time: **trusted**, run time: sandboxed | `burrow new`, `run`, `test`, `build` and `burrow script build` call the Go toolchain (`go mod tidy`, `go build`) on the project's Go source. That executes whatever the project's `go.mod` and sources cause the toolchain to do (module downloads, `replace` directives, cgo is off for wasm). The resulting `.wasm` runs in the wazero sandbox with fuel, memory and call limits and no host access beyond the Burrow API. |
| A project's own Go tests (`go test ./...`) | **trusted, unsandboxed** | Only run by `burrow test --go-tests`. Never run by default. They compile and execute natively with your user's permissions. |
| A `.voxpak` or a packed game | untrusted data | Parsed defensively: caps on counts, sizes and decompression ratio (50:1 per file above 1 MiB, 256 MiB total by default, `pak.MaxRatio` / `pak.MaxTotalSize`), strict path rules (no `..`, drive letters, control, bidi or other Unicode format characters), per-file SHA-256, extraction without following symlinks into a private 0700 temp directory that is removed on exit and on SIGINT/SIGTERM. Packed games contain compiled wasm, which stays sandboxed. |
| Texture packs and imported assets | untrusted data | Decoded with size limits; see [texture-packs.md](texture-packs.md) for licensing. |
| AI agents (`burrow agent`, `burrowd`, the editor MCP server) | untrusted callers | File operations are confined to the project directory and explicitly allowed directories (`--allow`) with fd-based, race-resistant checks. An agent can still change the project's files and scripts, so treat what it writes the way you treat any code you did not write before you build or test it. |

## What to do

* Open projects you did not write the way you open any source repository: read `go.mod` (look for `replace` and `toolchain` lines) and `scripts/` before running `burrow run`, `burrow test` or `burrow build` on them. Prefer a throwaway user account or VM for code you do not trust.
* Do not pass `--go-tests` to `burrow test` for projects you do not trust.
* `burrow shell-env` single-quotes its values, so `eval "$(burrow shell-env)"` is safe whatever the Homebrew prefix path contains. Treat `BURROW_ROOT`, `BURROW_BIN_DIR` and `BURROW_BREW_PREFIX` as trusted configuration: they decide which binaries `burrow` starts.
* Tool cache: `~/Library/Caches/burrow/bin/<key>/` (or `$BURROW_CACHE_DIR`) is created 0700. Burrow refuses cache directories or binaries that are owned by someone else, are symlinks, or are group/world-writable, and rebuilds instead.
* Built games and tool binaries are compiled with `-trimpath`, so they do not contain your home directory or checkout path. Script (wasm) builds use `-trimpath` too.

## Signing

The plain executable and the `.app` produced by `burrow build` are ad-hoc signed: they run on the Mac that built them. The `.app` ships the archive once (`Contents/Resources/game.voxpak`) and is signed as one bundle, so `codesign --verify --deep --strict` passes. For distribution (Gatekeeper, quarantine) you need your own Developer ID signature and notarisation; see "Signing and distribution" in [getting-started.md](getting-started.md). The plain executable keeps the archive appended after the Mach-O, which strict validation reports; use the `.app` when you need strict validation.

## Reporting

Report suspected vulnerabilities privately to the maintainers rather than in a public issue.
