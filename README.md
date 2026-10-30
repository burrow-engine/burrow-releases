<p align="center"><a href="https://burrow-engine.github.io/burrow-releases/"><img src="https://burrow-engine.github.io/burrow-releases/brand/banner-1280x320.png" alt="Burrow: a cyan mascot peeking out of a voxel burrow" width="100%"></a></p>

# Burrow releases

Signed downloads of **Burrow**, a deterministic voxel game engine in Go with a native editor, WebAssembly and visual scripting, and an agent-friendly API.
This repository only holds the release files and the website: the zips are the assets of each GitHub Release, and the website is published with GitHub Pages.

* Website, documentation, news and downloads: https://burrow-engine.github.io/burrow-releases/
* Download page (sizes and SHA-256 sums): https://burrow-engine.github.io/burrow-releases/download/index.html
* Burrow Hub (the launcher that installs and updates engine versions): included in the creator kit zip, see the download page.
* Licence: free to use, MIT licensed. Third-party licences and credits: https://burrow-engine.github.io/burrow-releases/licences/index.html

**Status: early version.** Engine 0.1.0, public API v0. macOS on Apple silicon is the platform used for development; the Windows builds are cross-compiled and untested on real Windows hardware.

## Verify a download

1. Compare the SHA-256 sum with the one on the download page or in `manifest.json`:
   `certutil -hashfile <file> SHA256` (Windows) or `shasum -a 256 <file>` (macOS, Linux).
2. `manifest.json` (served at https://burrow-engine.github.io/burrow-releases/manifest.json) is signed with an Ed25519 release key; the Hub verifies it before it downloads anything.
* Release public key (Ed25519, hex): `a40ed848428215b79f3b7d5c0d7b4eebb1ffbc40b5219b5d870bf9c52ff8cfc7`
* Key id (`key_id` in the manifest, first 8 hex digits of the SHA-256 of the key): `bf2b7e42`

3. Check a manifest by hand with the `burrowrelease` tool:

```sh
burrowrelease verify -manifest manifest.json -pub burrow-release.pub
```

Privacy: the Hub contacts https://burrow-engine.github.io/burrow-releases/manifest.json only after you agree, and sends nothing but its version and your operating system.

---

*Burrow est un moteur de jeu voxel déterministe en Go. Ce dépôt ne contient que les fichiers des versions publiées (zips signés) et le site web : https://burrow-engine.github.io/burrow-releases/fr/index.html. Version préliminaire ; les versions Windows n'ont pas été testées sur du matériel réel.*
