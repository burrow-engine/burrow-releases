# Changelog history

The detailed, stage-by-stage history of the engine up to version 0.1.0, kept for reference. The short release notes are in the [changelog](../CHANGELOG.md).
Details of some stages (the development texture pack, scratch measurements) describe private development builds only: released builds ship Pixel Perfection CE as their texture pack.

## Development history up to 0.1.0

### Fine water: tall falls and opposing flows (docs/water-fine.md)

* Tall falls (`fluid.FineRules = 3`): a stream covers 256 cells (was 64) and falls with a terminal speed of 30 blocks/s, so a 150-block fall is one stream that lands after 5.5 s instead of three streams restarting from rest in bricks hanging in mid-air (a splash ring and a thin filet in the sky every 64 blocks). The curtain grows with the front of the water (`voxel.FineStream.FrontGap`/`TailGap`) instead of appearing whole at the first tick, has no splash before the water arrives, keeps its streaks moving down the whole fall (the fall attribute saturated 64 blocks down), and is meshed in the chunk layers above the terrain that hold no edited block (the curtain had a gap in each). `-demo tower -demo-n H` in the sandbox.
* Opposing flows: the water push on bodies (`voxel.LiquidTable.Flow`) grows with the head difference up to full strength at one level (coarse water is unchanged): a fine film no longer pushes at full speed, and where two flows meet the push no longer flips between full speed one way and the other. Tests for channels fed from both ends, springs facing each other, crossings, loops, a spring against a coarse lake or lava (settling, no oscillation, symmetry, conservation). `-demo opposing` in the sandbox.

### Fine water under overload (water-fine.md, "Overload")

* Many water sources no longer freeze the fine water. At `FineMaxBricks` a refused spill kept its brick dirty, which kept its whole sheet from folding: the pool never emptied, the water stopped half spread with straight cut edges and dry ground between sources, and the world was never idle (100 sources on a plane: 2048 bricks, 1248 of them dirty, forever). The demands were also served from the lowest cell every step: of 300 sources, some never got any water.
* Rules version 2 (`fluid.FineRules = 2`; journals recorded under version 1 fail their first hash check, older snapshots restore): demands are served from a hashed spawn cursor in rotation; on a step where the cap refuses water, the calm water behind the waiting fronts folds into coarse cells (overload fold), and when nothing can fold that way, whole components of calm water and waiting fronts fold with the lateral tests waived (forced fold, every 20 steps, at most 1/8 of the cap). Exact conservation at every tick; the scenes settle to the same coarse water as with an unlimited pool.
* A fold no longer ranks a full brick as a residue (its share did not fit, the cached volume drifted from the fills and a later rollback lost the difference; `TestFineFoldResidueFits`).
* `FineMaxBricks` defaults to 4096 (was 2048). Overload signal: `Stats.FineOverload`, `FineCapRefused`, `FineCapSources`, `FineCapSteps`, `FineOverFolds`, `FineOverFolded`, `State.Overloaded`/`OverloadNote`; `fluid.Plugin` logs entering and leaving an overload (`Log`, `Quiet`) and shows the note in the HUD with `OverloadHUD` (on in the sandbox).
* Water meshing of large sheets is 4.6x faster (dense brick index, dense memo of the surface candidates and corner normals, same output): an overloaded chunk took up to 140 ms per build, so the drawn water lagged the simulation by seconds; the lateral pass caches the cell under each brick.
* `examples/voxel_sandbox -demo sources -demo-n N -demo-layout plane|terrace|bowl|cliff|cave`: the stress scene. Tests: `fluid/fine_overload_test.go` (settling, fairness, determinism and snapshots, bounded cost with 500 sources, mesh/simulation agreement), `BenchmarkFineWaterSheet`.

### Website, Hub wiring and release pipeline (releasing.md)

* `cmd/burrowsite` + `internal/site` (`make site`): a dependency-free, reproducible static site generator for GitHub Pages. Landing page, download page (reads the signed `manifest.json`, "coming soon" without), the allow-listed docs with sidebar and full-text search, templates and screenshot gallery, changelog and Atom feed, licences and credits, about and brand downloads, `404.html`, `robots.txt`, `sitemap.xml`, `.nojekyll`, optional `CNAME`; English at `/`, French at `/fr/` (docs in English only). Inter bundled, dark and light themes, strict CSP, no external request; screenshots resized and recompressed (38 MiB to about 6 MiB). The build fails on a leak (local paths, private URLs, secrets), a broken link or anchor, an external resource, an unclassified docs page or a size overrun.
* Hub: `DefaultSiteURL` (`-X burrow-engine/hub.DefaultSiteURL`, `HUB_SITE_URL` in the dist scripts) derives the manifest, docs, news and download addresses; the Home buttons open the website through a same-origin-only opener; the website is editable in developer mode only. Signed, plain-text, size-capped `news` in the manifest (`burrowrelease manifest -news-file`, `-tag-prefix v`); the consent screen names the fetched file and host.
* `release/burrow-release.pub` is the committed release public key (the dist scripts default to it); `scripts/publish-release.sh` (`make publish-release`) prints the plan by default, builds and signs with `--build-only`, and publishes to the public releases repository only with `--execute` and a typed confirmation.

### Vulkan bindings merged into the engine module

* `third_party_vulkan` is now a package of the `burrow-engine` module (import path `burrow-engine/third_party_vulkan`, package name `vulkan`) instead of a separate module `github.com/goki/vulkan` wired by `replace`. `third_party_vulkan/go.mod`, the `replace`/`require` in the root `go.mod`, and the `replace github.com/goki/vulkan` lines written by `burrow new`, `burrow script new`, `burrowscript new` and the project templates are gone (a project needs only `replace burrow-engine => <checkout>`).
* Cgo-dependent hand-written files carry `//go:build cgo`, so `CGO_ENABLED=0 go build ./...` still passes (the package keeps only `doc.go` and `version.go`). `make lint` excludes the package from `go vet` (generated code; one `unsafe.Pointer` finding in `util.go`) and `gofmt`. THIRD_PARTY_NOTICES, `third_party_vulkan/README.md` and `REGEN_NOTES.md` describe the new layout and the modifications.

### Visual identity (branding.md)

* `go run ./scripts/genbrand` (`make brand`) regenerates everything from `assets/brand/` (replaces `scripts/genico`): icon PNGs 16..1024, `.ico`, `.icns`, Linux hicolor PNGs for the game, editor (pencil badge) and hub (grid badge) variants, the README / social / download / Hub banners and the splash image.
* Window icons per tool (`window.Config.Icon`, `engine.WindowPlugin.Icon`), the Windows resources of `BurrowEditor.exe` and `BurrowHub.exe` use their own `.ico`; `vox.project` `icon` (a PNG in the project) sets the game window icon, `burrow new` writes a placeholder `icon.png`.
* UI theme derived from the logo: navy surfaces in four elevations, brand cyan accent, grass green success, dirt-brown warm neutrals, amber warning, red error; larger corner radii, rounded dock tabs; WCAG contrast test; user `theme.json` (user config dir and project, hot reloaded); `gameui` default themes aligned.
* Startup splash (editor, Hub; never with `-shot`/`-frames`/`-headless`), Help > About with credits and a third-party notices page, window titles `Burrow Editor — <project>` / `Burrow Hub`, `burrow --version` and `burrow about` with an ANSI wordmark on terminals.

### Burrow Hub audit fixes (hub.md)

* Release Hubs always carry the key and manifest URL: one `dw_build_hub` step for both dist scripts, fails without `HUB_PUBKEY` / https `HUB_MANIFEST_URL` (`HUB_DEV=1` for development). Compiled key set with `key_id` rotation; config/env keys only in developer mode.
* Manifest freshness: required `generated`, last-seen time in `state.json`, signed `expires` with a stale warning; canonical versions, `YYYY-MM-DD` dates, https asset URLs.
* Project restore: own lenient validator, symlinks refuse the upgrade with a clear message, unique temp folder, the replaced state is kept until confirmed; old backups pruned (keep N, Settings).
* Crash safe Hub self-update (journal, `.new`/`.old`, `ResolveHubExe`), state bound to the executable, single-instance lock, wall-clock confirm; OS file locks for installs and downloads, `.part` named by sha256, previous engine kept until the replace succeeded.
* Windows names: device names, trailing dots/spaces, `filepath.IsLocal`, `\\?\` paths; project names follow `vox.project` rules; failed project creation removes its folder; `BURROW_SDK` always decided; the upgrade plan never runs the engine; delete refuses personal folders and uses the trash; config snapshots for background jobs.

### Burrow Hub (hub.md)

* New native launcher `cmd/burrowhub` (+ `hub/ui`, drawn with the engine UI over Vulkan): project list (recent, pin, search, import, duplicate, remove, delete with double confirmation),
  templates gallery, side-by-side engine versions, per-project engine pin, upgrade with release notes, backup zip, `burrow migrate` hook and revert, first-run wizard, Home with Learn links.
* Package `hub` (no UI, no cgo): Ed25519-signed manifest with channels and per-OS assets, HTTPS-only client (proxy env, redirect limits, Range resume, size caps, sha256 before unpack),
  zip-slip / symlink / decompression-bomb safe unzip, atomic engine install with rollback, Hub self-update with swap and automatic rollback, opt-in update check, no telemetry.
  No update source or key is compiled in: the Hub reports "no update source configured" and works offline.
* `cmd/burrowrelease` (`keygen`, `manifest`, `verify`) builds and signs `manifest.json` from `dist/` zips; the private key is only read from a file you pass (never inside a checkout).
* `vox.project` `engine` accepts pre-release versions (`0.4.0-beta.1`). The creator kit gains `BurrowHub.exe` and `engine.json`; `make hub-test`, `make hub-run`, `make dist-hub-windows`.

### Stabilisation pass
* `third_party_vulkan`: the C copies made for slice arguments (`vkCreateGraphicsPipelines`, barriers, submits, ...) were freed by a finalizer attached to a dead result variable, i.e. at the next GC, possibly during the call. The finalizer now sits on the allocation map and every wrapper keeps it alive until it returns (`tools/fixalloc.pl`, run by `make regen`). Closes the MoltenVK start-up SIGSEGV race.
* Sound: `Pack.Warm` decodes the step, block break and other block events first (first variant of every event before the other variants, 96 files); an alphabetical 64 file cap used to leave every `step.*` event cold, so the first footsteps were dropped.
* Windows log files are named `Burrow.log` and `BurrowEditor.log`; the Windows README describes sounds, diagnostics variables and the F1 help; the FSR and SMAA licences ship in `licences\`.
* `burrowd` exposes 20 tools (test updated).

### Windows creator kit (scripts/dist-engine-windows.sh)

* `make dist-engine-windows` writes `Burrow-Engine-windows-x64.zip` (BurrowEditor, burrow, burrowplay, burrowscript, burrowasset, burrowctl, burrowd, docs, templates, script SDK module `sdk/`, licences, bilingual GETTING-STARTED); `make dist-windows` now writes `Burrow-Sandbox-windows-x64.zip`; `make dist-all` builds both. Shared helpers: `scripts/lib-dist-windows.sh`.
* Go scripts without a checkout: `burrow new`, `burrow script new` and `burrowscript new` write `replace burrow-engine => <sdk folder>` (`$BURROW_SDK`, else `sdk/` next to the executable); `burrow` also finds `BurrowEditor` and the kit's `docs/`. New package `internal/sdkroot`.

### Target selection indicator (rendering.md)

* The targeted block is outlined by a thin anti-aliased near-black line that follows its real selection shape (slabs, stairs, fences, walls, doors,
  torches, cross plants, cactus) instead of a yellow-filled full cube; depth-biased in world space, same look at every shader level and in the editor viewport.
* Optional faint ghost of the occluded edges and a +10 % lift of the face under the crosshair; `RenderSettings.Selection`, `Renderer.SetSelectionStyle`.
* New: `voxel.SelectionBoxes`, `app.FrameState.TargetBoxes`, `render.SelectionStyle` / `SelectionSegments` / `SelectionFace`, shaders `sel.*` and `selface.*`
  (replace `hl.*` and `hlfill.*`).

### Visual scripting (visual-scripting.md)

* Package `vscript`: `.bgraph` (versioned JSON; event graphs, state machines, macros, comments, groups), typed pins with automatic converters, compiler to
  compact bytecode, deterministic VM (instruction budgets per graph and per tick, no wall clock, no map order, state in the hash, snapshot/restore/replay),
  node catalog generated from a host function registry (`vscript.Registry`), edit API, PNG renderer, four example graphs (`docs/examples/*.bgraph`).
* `vscript/vsplug` (opt-in `runtime.plugins.graphs`, `burrowedit -graphs`): `graph_script` component (exposed variables, inbox), journaled
  `graph_bind` / `graph_changed` / `graph_message`, content addressed program library with instant hot reload that keeps compatible variables, trigger /
  collision / block / UI / level events derived inside the sim, `Call Go` bridge interface, editor debugger (executed nodes, pin values, breakpoints).
  `vsplug.Parity()` compares its functions with `script/api`.
* Editor: Graph panel (pan/zoom canvas, palette, typed connections, reroutes, copy/paste, minimap, undo/redo, errors on nodes, live debugging);
  `editor_graph` MCP tool (node_types, ops batches, validate, render PNG, attach, debug); `editor/graphed` editing model; `core.Hooks.BeforeStep`.
* Not done: Export to Go, a `Call Go` bridge in `script`, nodes for most raw ABI functions, rebuilding a shipped template with graphs (the door and a coin
  rule set are proven as tests).

### Scripting completeness

* Scene queries: `scene_parent`, `scene_children`, `scene_path`, `scene_find_with`, `scene_find_tag`; the `tags` scene component (at most 16 per
  node). Results are bounded (4096) and charged gas per node scanned. SDK `Parent`, `Children`, `ScenePath`, `FindWith`, `FindTag`, `TagsOf`, `HasTag`, `AddTag`, `RemoveTag`.
* Field access: `field_get`, `field_get_num`, `field_get_many`, `field_get_nums`, `field_set`, `field_set_num`, `component_patch` (RFC 7386 merge
  patch). Paths such as `pos[0]` and `bodies[2].mass`. Partial writes are schema-validated and queued like `entity_set_component`, so replays are exact.
  Typed accessors for the built-in components are generated by `make sdk-gen` (`cmd/sdkgen`, `sdk/burrowsdk/components_gen.go`); `make sdk-check` and a
  test fail when they are stale.
* Data: `asset_read` (project data files, <= 256 KiB, 16 reads per transaction; SDK `ReadAsset`, `ReadAssetJSON`; `Plugin.ReadAsset` hook), `block_count`,
  `block_name`, `block_info`, `registry_list` (`blocks`, `components`, `assets`). The engine has no item registry: items are data tables read with `ReadAsset`.
* Message bus: `bus_subscribe`, `bus_unsubscribe`, `bus_subs`, `bus_publish`. Delivered on a later tick in ascending entity order, to `on_event`
  with kind `BusKind(topic)`. SDK `OnMessage`, `Publish`, `Subscribe`, `Unsubscribe`; subscriptions re-established automatically after hot reload.
* Timers: `timer_start`, `timer_cancel`, `timer_remaining` (simulation time, <= 64 per script). SDK `OnTimer`, `After`, `Every`, `CancelTimer`, `TimerRemaining`.
* Tween and easing (`EaseKind`, `Tween`, `NewTween`, `Cooldown`): plain data, evaluated at the current tick.
* Frame look: `camera_rig.frame_look` (degrees per mouse pixel) lets the view turn at frame rate; the sim still gets the look once per tick. The value must
  equal the script's sensitivity. `camplug` feeds it.
* Dev experience: `ScriptFault.Trace` and `ConsoleEntry.Trace` (guest stack, names with `burrowscript build -debug`), shown in the editor console;
  `Runtime.Profile()` (gas, host gas, wall time per script entity); `Plugin.PauseOnFault` pauses the sim (`script.fault`).
* Host function registry: package `script/api` (`api.All`, `Lookup`, `Names`; `Func{Name, Params, Results, Doc, Category, Gas, Free}`), built from the
  ABI and `script/ABI.md`, for tools and the visual scripting VM.
* Not bridged: engine trigger and collision events (frame-domain only); use `physics_overlap` diffing, `gameui_poll` and `level_current` polling.
* Migration: the `Script` component gained `subs` and `timers`; a script that uses neither hashes as before. New scene component `tags`. Rig field
  `frame_look` (default 0). New host functions are ABI additions only; existing names and signatures are unchanged.

### Built-in documentation (documentation.md)

* Help > Documentation (F1): a Markdown viewer in the editor (headings, lists, tables, code blocks with Copy, quotes, images, internal and external
  links) over the docs embedded in the binary, with a page tree, ranked full-text search with highlighting, back/forward history and remembered scroll.
  F1 over a panel opens its page, each panel header has a "?" button, the Inspector shows component and field descriptions as tooltips; Shift+F1 is now the
  shortcut cheat sheet.
* `docs/README.md` index, nine tutorials (`docs/tutorials/`), and the reference generated from the code by `make docs-gen` (components, script API,
  MCP tools, CLI flags, project file, input actions, blocks, render options), checked by `go test ./docs` so it cannot go stale.
* MCP tools `editor_docs_search` and `editor_docs_read`. Stale statements fixed (README "not done" list, ABI module name `vox`, architecture map).

### Genre templates (templates.md)

* `burrow new -template platformer|physics_puzzle|topdown_strategy|survival`: four playable projects (levels, UI, one WebAssembly game script each) with runnable
  examples `examples/tpl_*` and a scripted pilot (`-auto`: goals, replay, twin StateHash; `-shot`: GPU captures); harness `internal/tplkit`, assets by
  `go run ./templates/mkassets`, `make templates-test`.
* Engine: relative input (mouse delta, scroll) summed between ticks for scripts; `App.SetPaused`, gameui `pause_sim` and the `game:quit` action;
  `physics3d_overlap` script call; `mouse_pos` binding and `runtime.cursor: "free"`; `runtime.hud`; voxel bodies drawn in project games; `App.SceneReader`.
* Migration: projects with `"plugins": {"controller": false}` no longer draw the sandbox overlay (crosshair, hotbar, frame statistics) by default; set
  `"runtime": {"hud": true}` to get it back. The `game:quit` widget action only works where the host sets `uiplug.Plugin.AllowQuit` (the project runner does,
  for the project's own `.ui.json` files). `App.SetPausedBy(reason, on)` keeps several pausers apart; the first-person controller also stops while paused;
  the controller's double-tap timing uses real (unclamped) frame time and a zeroed `SprintFOV` lets the sprint FOV relax.

### Water: evaporation of stagnant films, shallow water at noon (water-fine.md)

* Fine water: thin, isolated films (no column deeper than 1/8 block, no coarse water, lava or void beside them, not feeding
  a stream, a component of at most `FineEvapBudget` bricks) that stay unchanged for 25 s evaporate little by little (3% of
  a threshold film per second at noon and 15 C; x1.5 in sun and heat, x0.25 under a roof or underground, slower in the
  cold, stopped by rain or snow in the open, read from the `weather` extra when installed). Lakes, rivers, seas, springs
  and the films touching them never lose water. Every unit goes to `Ledger.Evaporated`: the conservation law stays exact.
  New `fluid.Config` fields `FineEvapPeriod` (-1 turns it off), `FineEvapBudget`, `FineEvapDepth`, `FineEvapDwell`,
  `FineEvapRate`, `FineEvapEps`; `Stats.FineEvapVisited`. The dwell of each film and the pass cursor are simulation state
  (hashed, snapshotted, replayed). On by default with `Config.Fine`: fine scenes that leave films now end without them
  (and a thin puddle the evaporation will take stays in bricks instead of folding into level-1 coarse cells; any other
  thin component folds as before), so their later hashes differ. A fine `Config` hashes the new rules version
  `fluid.FineRules` (1): a journal recorded before fails its first hash check at replay, a snapshot from newer rules is
  refused, an older save restores. The coarse automaton is unchanged (its unfed level-1 cells already drain). An inert
  `weather` module (installed by every game, off unless enabled) does not drive the rate; a slow rate keeps an integer
  remainder instead of rounding to zero.
* Fine water mesh: the depth of a top vertex is taken at its corner (continuous across sub-columns) instead of per column,
  so the depth-driven shading has no stair-stepped squares and a drying film fades without steps.
* `water_hdr.frag`: large white blotches on shallow water at noon. The caustics gain is `1 + 1.2 c / (1 + 0.4 c)` (it was
  `1 + 1.4 c`, up to x6: a bright bottom clipped and bloom smeared it), the shore and current foam need about 0.3 block of water, the
  foam rings of a fall's foot fade out over shallow water; NaN guards: `pow(x, 2.0)` of a negative `x` in the rings (NaN
  on NVIDIA, spread by bloom) is a product, the caustic bases are clamped, the normals normalise with a fallback
  (`water2.vert`: the spray fade base too). SPIR-V rebuilt; `docs/img/shaders-waterfall.png` and `shaders-filet.png`
  recaptured.

### Modelling and texturing tools (modeling.md)

* New package `model`: the `.bmodel` voxel model asset (versioned JSON, palette with emissive / gloss / alpha, named parts with pivots that feed the animation
  skeleton, attachment points, RLE + gzip voxel grid <= 256^3, SHA-256, the op list that built it). A deterministic op language (JSON list or text DSL): primitives
  (box, sphere, ellipsoid, cylinder, cone, torus, capsule) with add / sub / and / paint modes, mirror, array, repeat, rotate, scale, hollow, erode, smooth, noise
  displacement, paint rules (gradient, speckle), extrude, parts and attachments. Integer / fixed-point only: same ops give byte-identical files on every platform.
  MagicaVoxel `.vox` import and export (parts and pivots as scene-graph nodes), stats (colours, symmetry, floating pieces), software montage renderer, 16^3 block shape boxes.
  `.bmodel` loads as a `.vox` value (`render.voxmodel`, character models, `anim.SkeletonFromVox`). Script sugar `burrowsdk.SpawnModel`.
* New package `texedit`: layered pixel-art textures, ops (fill, gradient, periodic noise, dither, bricks / planks / cobble / ore / grass edge patterns, ASCII art, outline, shade,
  hue, seamless, quantize, palette lock, layers), 3 x 3 tiling, mip and block-in-world previews. Saves PNGs into the project `textures/block/` override layer
  (`blocktex.SetOverrideDir`), hot reloaded in the running game; the bundled packs are never modified.
* MCP tools `editor_model` and `editor_texture` (declarative ops, images and stats as feedback, one undo step per call, hostile-input limits), and the View > Model editor...
  and Texture editor... panels (orbit viewport, brushes, mirror symmetry, palette, parts and onion view; pixel canvas, tools, layers, previews) on the editor's undo history.

### Coloured block light and skylight (lighting.md)

* New `voxel.LightField`: a persistent light field per chunk, block light in 3 colour channels (4 bits each) plus skylight, flood filled through non-opaque and shaped blocks with
  per-block attenuation (`Block.LightLoss`; leaves, water that absorbs red first, stained glass that keeps its own colour), incremental add and remove breadth-first searches across
  chunk borders, chunk load / unload, bounded `Step(budget)`. Settles to the same field in any order (tests: random edits vs a from scratch fill, cross-chunk, load order, drop and reload).
  `Block.EmitColor` (additive JSON `emit_color`), `Block.LightLoss` (`light_loss`), more default emitters (froglights, redstone and soul torches, end rod, ...), `torch[state]` names resolve.
* Deterministic query for the simulation: `ChunkMap.LightAt(reg, p)` / `voxel.Light` (`Level(skyDim)`), script host import `light_at` and `burrowsdk.LightAt`, nav condition `dark{max,sky_dim}`
  and `View.LightAt`, MCP `vox_light` and `editor_light`. Derived data: no `StateHash` change.
* Streaming: the field runs on its own goroutine (`engine/lightrun.go`), meshes take padded snapshots (`mesh.Opts.Light`), chunks are meshed at once with provisional light and re-meshed only
  when the hash of the light they read changed (border changes reach only the neighbours that read them). Frame time p99 unchanged.
* Rendering: per-vertex smooth block light + skylight (vertex stays 16 bytes: light bits moved into the high bits of the x / y positions), all shader levels and `-look classic`: ambient x skylight
  occlusion, direct sun needs sky, block light 2.4 * l^2.6; caves are dark by day and by night. Soft renderer parity (`render.Options.Light`, `voxel.DemandLight`). RT: emitters bounce with their colour.
* Light debug view (`block`, `sky`, `level`): `RenderSettings.LightView`, editor View menu, `editor_light`. Demos `-demo lightcave|lightcolors|lavalake`. `BURROW_LIGHT=off` disables the light.
* Shaders rebuilt; the vertex position high bits must be masked by any shader reading voxel vertices (`chunkPos()` in `common.glsl`).

### Sound packs

* New package `audio/soundpack` and a user sound pack loader: the game plays your own `.ogg` / `.wav` files from a folder, selected by `-sounds <dir>`
  (`voxel_sandbox`, `burrowplay`), `BURROW_SOUNDS`, `runtime.audio.pack` or `~/.burrow/sounds`. `sounds.json` maps events (`step.<material>`,
  `block.break|place|hit.<material>`, `player.*`, `water.*`, `ambient.*`, `fluid.*`, `ui.click`, `music.*`) to weighted variants with volume, pitch range,
  `stream` and attenuation; without it a conventional `step/ dig/ random/ ambient/ music/` layout is autodetected (`audio/soundpack/autodetect_table.go`).
  Hot reload, hostile-input limits, symlinks and path traversal refused, LRU clip cache, streamed music with a random-gap scheduler.
  New `runtime.audio` section (`pack`, `fallback`, `synth`, `music_*`). Footsteps are timed by distance and silent in fly mode; block break / place / hit
  sounds follow the player's edits. Burrow ships no sound files, the user owns the rights of their files, and a pack is never exported:
  `burrow build` and `scripts/dist-windows.sh` refuse to pack one (audio.md, "Sound packs").
* Default sound pack: the game binaries now embed `assets/sounds/default/` (102 CC0 sound effects from Kenney Impact / RPG / Interface Sounds and six calm music
  tracks by Juhani Junkala, re-encoded; ~6 MB, +5.7 MB on `burrowplay`; `-tags nosounds` removes it), registered by a blank import in `burrowplay` and
  `voxel_sandbox` (the editor does not link it). It is the base layer under a user pack, per event. `-sounds off` disables every pack. Water, rain, wind, thunder and
  lava stay silent (no CC0 source yet). New `runtime.audio.default_pack` lets a project ship a pack it owns through `burrow build`. Credits in
  THIRD_PARTY_NOTICES.md and `assets/sounds/default/CREDITS.md`; the Windows dist copies the licences.
* The builtin synthesized sounds are now OFF by default (silence for any event without a pack file; `fallback` defaults to `"none"`). Opt in with
  `runtime.audio.synth: true`, `"fallback": "synth"`, `-synth-sounds` (`voxel_sandbox`, `burrowplay`); they play at half volume. The sandbox, editor
  and templates are therefore silent until a pack is supplied.

### Player movement (creative-mode feel)

* `app.Controller` (used by `examples/voxel_sandbox` and the `burrowplay` sandbox through `engine`): double-tap Space (within `Config.DoubleTap`, 0.3 s) toggles flight
  (the F key still does); descending onto the ground exits flight. Flight ignores pitch, Space/E rise and Shift/Q descend, 10.89 blocks/s (x2 sprinting) with
  momentum (0.18 s to full speed, 0.4 s glide to a stop, vertical alike). Walking 4.317 blocks/s, sprint x1.3 (hold Ctrl or double-tap forward; ends when forward is
  released or against a wall), jump 1.25 blocks (`JumpHeight`), snappy ground acceleration, reduced air control, sprint jumps keep their momentum. Shift on the ground
  sneaks: x0.3 and never walks off a block edge. The FOV widens by 10% (smoothly, frame domain only; camera rig FOVs still win) while sprinting or fast flying.
  New `Config` fields `FlySprintMul SneakMul JumpHeight FlyVertSpeed FlyAccelTime FlyStopTime GroundAccel AirControl DoubleTap SprintFOV FOVTime`; defaults of
  `WalkSpeed` (4.3 -> 4.317), `FlySpeed` (10 -> 10.89) and `SprintMul` (1.8 -> 1.3) change, so recorded sessions and hashes involving movement differ.
* Input: new logical key `app.KeySneak` (script name `sneak`) and action `sneak`. Default bindings move: `sprint` is now Ctrl (was Shift, plus L3 on a pad), `sneak` is
  Shift. Projects with their own `input.json` keep their bindings; add a `sneak` action to get sneaking. `testdata/edit_persist.json` gained glide-settling frames.

### Rendering performance

* A render scale below 100% without `-upscale` now selects FSR 1 at the medium and high shader levels (always faster than native; 5.7 ms against 7.5 ms at 75% on an idle
  M2 Max at 2560x1440) and keeps FSR 2 at ultra or with `-upscale fsr2`. FSR 2 at 75% (6.6 ms) barely beat native. `docs/anti-aliasing.md` has the table.

### Worldgen

* Generator v2 places much more tall grass and flowers (plains, meadows, forests, jungle, savanna, swamp, mountains), clumped by a patch noise into dense
  tufts and sparse gaps instead of a uniform sprinkle. Worlds built from the same seed change their ground plants.
* Generator v2 plants (tall grass, flowers, mushrooms, dead bush, cactus) always use their shaped model and real texture, with or without the shaped block set
  (`-shapes`, `runtime.blocks "shapes"`): they are now walk-through (not solid, no collision, no ray-tracing occlusion) and fragile, instead of flat-coloured
  solid cut-out cubes. Block ids do not move; the cactus stays solid. `blockset/blocks.json` regenerated.
* `voxel.Chunk` bumps its content version once per observation instead of once per block write, removing a global atomic hot spot (about 40% of the CPU time of
  terrain streaming on many cores).

### Cameras and game UI

* New package `camera` (+ `camera/camplug`): frame-domain camera rigs. First person, third-person orbit with voxel pull-in, top-down, isometric (orthographic),
  2.5D side-scroller (locked axis), free fly and fixed/cinematic rigs; follow smoothing (frame-rate independent), dead zone, look-ahead, bounds, seeded
  trauma shake and blended transitions; cuts (zero blend, projection change, teleport) reset TAA / FSR 2 / ray tracing history through
  `FrameState.CameraCut` and `Renderer.ResetHistory`. The `camera_rig` scene component and `runtime.camera` rigs are opt-in (`runtime.plugins.camera`): the plugin
  never writes simulation state. Orthographic projection (`scene.Camera.Ortho`, `app.FrameState.Ortho`, hybrid scene camera) in `render/soft` and `render/vulkan`.
  Script functions `camera_cmd` + SDK `CameraSwitch`, `CameraShake`, `CameraCut`; editor: View > Cameras, inspector, `editor_camera` gains `action`
  (`rigs`, `validate`, `switch`, `shake`, `cut`, `preview`; no action keeps the old behaviour). See docs/cameras.md.
* New package `gameui` (+ `gameui/uiplug`): a game UI toolkit distinct from the editor's. Data-driven `.ui.json` screens with hot reload; label, image/icon
  (Lucide + game icons, atlases), button, bar, panel, list, grid (inventory slots), text input, dialog; anchors, stack/grid layout, safe area, DPI scaling,
  themes, localisation tables, keyboard / gamepad / mouse focus navigation, world-space nameplates and damage numbers. Drawn through the existing canvas on
  Vulkan and on the CPU (golden PNG tests in `gameui/testdata`). Events marked `sim` become journaled `gameui_event` commands (an inbox component), values and
  screens are driven by frame-domain requests (`engine.SendFixed`), so replays work. Opt-in `runtime.plugins.gameui` / `runtime.gameui`. Script functions
  `gameui_cmd` / `gameui_poll` + SDK `UISet*`, `UIShow`, `UIEvents`, ...; editor: View > Game UI, MCP tool `editor_gameui`. See docs/game-ui.md.
* `engine.RenderExtent` (renderer size for 2D overlays), `engine.UIPointer` + `Window.SetMenuMode` (menu mode: free cursor, clicks to the UI),
  `app.Controller.SetLook`. Example `examples/camera_ui_demo`, `make camui-test`.

### Levels and saves

* New packages `level` (+ `level/levelplug`) and `save` (+ `save/saveplug`): fixed levels and a generic save system. A `.level` asset bundles a
  hand-built chunk region (compressed, block palette by name, bounded to 4096 chunks), spawn points, trigger zones, scene nodes with embedded
  prefabs and per-level settings; it mixes with procedural worlds (`mix` replace or keep). `level_load` / `level_unload` are journaled commands
  pinned by content hash (replays across a switch, same StateHash for the same level and seed); decoding streams on worker goroutines; the manager
  has transition hooks, door triggers, a kill plane and bounds. Saves hold snapshot + level id + the game key/value store (part of the sim state),
  versioned with a migration hook, SHA-256 checked, size bounded, written atomically, with autosave on tick intervals; a restore reproduces the saved
  StateHash or is rolled back. Opt-in `runtime.plugins.levels` / `saves` (they add sim state): existing projects keep their hashes.
* Script functions `level_load`, `level_current`, `level_spawn_count`, `level_spawn`, `level_zone_at`, `level_settings`, `save_set`, `save_get`,
  `save_del`, `save_slot` and the matching SDK calls. Editor: View > Levels, MCP tool `editor_level`, journaled `editor_open_level`.
  `engine.FixedResIn` reaches a fixed resource from a custom command. Example `examples/level_demo`, `make levels-test`. See docs/levels-saves.md.

### Particles

* New package `particles` (+ `particles/partplug`): generic, frame-domain particle system. The `particle_emitter` scene component (rate, burst,
  duration, shape, cone/velocity, gravity, drag, size and colour over life, atlas frames, alpha or additive blending, soft particles, voxel
  collision, world or local space) and data-driven `.particles.json` assets with hot reload (a broken save keeps the last good version). Six
  built-in presets: smoke, sparks, dust, splash, fire and block-break debris (the broken block's texture). Particles are closed-form
  trajectories (`render.ParticleRecord`), so the result does not depend on the frame rate; every random choice is seeded from emitter id +
  spawn index (events: tick + index in the tick). Simulation events (`partplug.Emit` / `Burst` / `BlockBreak`, scripts) go through
  `engine.SendFixed` like audio, so replays look the same and the StateHash is never touched. Budgets: per emitter, global (16 384, hard cap
  32 768), spawns per frame, one-shot effects, collision lookups per frame; hostile assets, NaN and infinities are rejected or sanitized.
* Render: GPU path in `render/vulkan/particles.go` (compute update into instanced billboards, linear-depth soft particles, additive and alpha
  blending, velocity stretch; shaders `particle_update.comp`, `particle.vert`, `particle.frag`, `particle_depth.frag`) in the classic and HDR
  pipelines; CPU twin in `render/soft` (`render.Options.Particles`) for headless runs and the editor preview.
* Opt-in `runtime.plugins.particles` (or a scene that uses the component): worlds without it keep their hashes. Script host functions
  `particle_burst` / `particle_emit` / `particle_stop` + SDK `ParticleBurst`, `ParticleBlockBreak`, ...; editor: View > Particles panel, the
  inspector shows the component fields (short numeric arrays now edit as inline number fields, embedded structs are inlined in the schema),
  MCP tool `editor_particles`. Example `examples/particles_demo`, `make particles-test`. See docs/particles.md.

### Ray tracing

* Render: software voxel ray tracing in compute shaders (works on MoltenVK): sun shadows (soft cone jitter), AO, 1-bounce diffuse GI and reflections (water, glossy blocks), traced at
  half resolution against a GPU acceleration structure (per-chunk occupancy bitmask + 8^3 brick level, updated incrementally on chunk edits), temporal denoise with history reset / camera
  cuts and an a-trous filter, composited into the HDR chain before AA and upscaling. `-rt off|shadows|full` (or `sun,ao,gi,reflections`, env `BURROW_RT`, `RenderSettings.RT`);
  presets: off on low and medium, shadows + AO on high, everything on ultra. Optional `VK_KHR_ray_query` backend behind `vulkan.RTBackend` is a capability-checked stub that falls back to
  the software tracer. See docs/ray-tracing.md.

### Audio, navigation, anti-aliasing and upscaling

* New package `audio` (+ `audio/audioplug`, `audio/audioamb`): frame-domain software mixer with buses, voices (priority, stealing), 3D positional
  sound, streaming music with crossfade, WAV and OGG Vorbis decoders, procedural placeholder sounds, null and pure-Go oto backends; the sim only
  emits deterministic `SoundEvent`s, so audio never changes a StateHash. Editor: View > Audio panel. See docs/audio.md.
* New package `nav` (+ `nav/ai`): grid/voxel navigation (A*, hierarchical search, crowds, agent brains and behaviours), opt-in plugin
  (checkbox in the editor), debug overlay through the Vulkan line pipeline, example `examples/nav_demo`.
* Render: anti-aliasing `off|fxaa|smaa|taa` and upscaling `off|fsr1|fsr2` (AMD FidelityFX FSR 2, MIT, `third_party/fsr2`), `-aa`, `-upscale`,
  `-render-scale`, editor AA menu and the `aa` argument of `editor_viewport_screenshot`. See docs/anti-aliasing.md.
* Animation: `anim_lib` journal commands now embed the clips of the library version they pin (compact `.anim` JSON, at most `anim.MaxEmbedBytes`,
  content hash verified) and snapshots carry the pinned version, so a saved journal or snapshot replays in a fresh process with an empty library.
* Tests: timing budgets scale under `-race` (`internal/testscale`; `agent.ScreenshotBudget` is 6x in race builds only, the release value stays
  10 s); the editor golden no longer depends on the package's source listing (fixed `testdata/golden_assets` fixture). `make clean`, `make
  clean-stray` and `.gitignore` cover stray `go build ./cmd/x` binaries in the repository root.

### Rigid-body physics (physics3d)

* New package `physics3d`: deterministic rigid bodies (box, sphere, capsule, voxel bodies), soft sequential-impulse solver with friction, restitution,
  warm starting, sleeping islands, substepping and terrain CCD, joints (fixed, hinge with limits and motor, ball, rope/rod), contact and trigger events,
  raycast/overlap/shape-cast queries, voxel-body island splitting, structural detaching of world chunks, explosions, caps with measured cost.
  Opt-in plugin `PhysicsPlugin3D` (`runtime.plugins.physics3d`): worlds without it keep their hashes. Components `physics3d.rigidbody/collider/voxelbody/joint`,
  commands `physics3d_*`, scripts `physics3d_*` host functions and `burrowsdk.Physics3D*`, `mesh.BuildDynVoxel` / `mesh.DynModel`, example
  `examples/physics3d_playground`. Same-platform determinism only (float64). See docs/physics.md.

### Animation system

* New package `anim` (+ `anim/animplay` plugin): keyframe tracks on any scene-schema property (float, vec3, quat, colour, bool, int) with step,
  linear, smooth, cubic (Hermite) and bezier interpolation, clips with events, `Player` (play, queue, speed, loop, ping-pong), crossfade, masked and
  additive layers, a state machine, tweens, voxel skeletons of rigid parts imported from the MagicaVoxel scene graph (`importers.VoxFile.Graph`),
  two-bone and look-at IK, `.anim` assets (JSON, versioned, hot reload). Sim domain (`anim.player` component, integer tick time, hashed, journaled
  commands `anim_*`) for gameplay animation, frame domain (`Animator`) for visuals; engines that do not call `anim.Register` keep their hashes.
  `character` gets an adapter (`Clip.ToAnim`, `Pose.ApplyBag`). Editor: Animation panel (dope sheet, curves, preview, record, undoable),
  tools `editor_anim` and `editor_anim_edit`; scripts: host functions `anim_*` and `burrowsdk.Anim*`; example `examples/anim_demo`.
  See docs/animation.md.

### Renamed to Burrow

* The project is now **Burrow**: Go module `burrow-engine` (root package `burrow`), programs `burrow`, `burrowedit`, `burrowd`, `burrowctl`,
  `burrowplay`, `burrowasset`, `burrowscript`, `burrowshot`, `burrowgen`, `burrowlive`, `burrowshader`, `burrowpacktool`, guest SDK
  `sdk/burrowsdk`; docs, help text, `burrow doctor`, window titles and templates updated. Logos in `assets/brand/`; the macOS `.app` made by
  `burrow build --app` now carries the Burrow icon (`AppIcon.icns`, produced with `sips`/`iconutil`), windows get the icon through GLFW, and
  `assets/brand/burrow.ico` (16 to 256 px, `go run ./scripts/genico`) is ready for the Windows build.
* Compatibility kept: file extensions and formats (`vox.project`, `.voxscn`, `.voxworld`, `.voxpak`/`VOXGAME1`, `.vmeta`, `.vox`), MCP tool
  names (`vox_*`, `editor_*`) and the WASM ABI (version and the `vox` host import module). Environment variables are `BURROW_*` with the
  old `VOX_*` read as a fallback (`internal/envx`). `--vox-root` / `-vox` remain accepted aliases. See docs/getting-started.md, "Naming and
  compatibility".
* Tests: the fast suite (`make test-fast`) is back under 3 minutes: heavy fluid, editor/core, scenarios, script and agent tests run reduced
  sizes (fewer seeds, trials and ticks) or in parallel; the full versions run under the `slow` tag (`make test-slow` now also covers `./fluid`
  and `./scenarios`).

### Fine water: falling streams and cascades

* Simulation: water in free fall under a lip (at least `FineStreamMinFall`, default 2, free cells) is a stream per lip
  brick (integer debit per sub-column, delay `ceil(5 sqrt(h))` steps) instead of a brick per block crossed; exact ledger
  (`Ledger.Transit`, counted in `Held`), hashed, captured, snapshotted, re-formed when the fall changes; capped by
  `FineMaxStreams` (default 1024, -1 off). Fine-water states without falling water keep their hash; Fine off is unchanged.
* Rendering (HDR levels): curtains built from the streams (free-fall bend at the lip, joined across lips, tapered edges,
  opacity / aeration / streak speed from the debit and the fall, refraction of the cliff), spray, boils, mist and foam
  rings at the foot (GPU-animated, bounded). Moving fine water re-meshes only the water of its chunks on the workers
  (`Mesher.BuildWater`, `UploadChunkWaterOnly`, double-buffered), far chunks draw bricks as the coarse surface
  (`Opts.FineLOD`), chunk reads of the water passes go through a 27-chunk cache.
* `voxel_sandbox`: `-demo rill|sheet|breach`, `-settle-min`, perf lines for the mesh workers and the fluid system.

### Shader levels, stage S3: water, weather, atmosphere (render only)

* Water: smooth surface for coarse water (`mesh.Opts.LiquidSurface`, sloped corners, no inner faces, terraces become ramps)
  and the fine water bricks in one 24-byte vertex layout; scene copy between the opaque and transparent halves of the HDR
  pass; wind / current wave normals, Fresnel, SSR (medium+) with sky / cloud / glint fallback, refraction with depth
  absorption, caustics (high+), shore / current / spill foam, under-water fog and Snell's window.
* Weather (`render.WeatherFX`, `weather.RenderFX`, filled by the weather plugin): instanced rain / snow streaks occluded by a
  precipitation height map, lightning fill light and bolt, weather cloud cover and clock, fog, wet surfaces and puddles, wind
  sway of leaves and cross plants, cloud drift, `SkyLightFactor`.
* Atmosphere: sun shafts (high+), light DoF + camera motion blur (ultra); no TAA (justified in docs/rendering.md).
* `render.ShaderQuality` gains `Refraction`, `SSRSteps`, `WaveOctaves`, `Caustics`, `Precip`, `Wet`, `Sway`, `GodRaySamples`,
  `DoF`, `MotionBlur`. Overcast skies march fewer cloud steps. Budget at 1440p / radius 12 in a storm: ultra 8.9 ms GPU.
* `examples/voxel_sandbox`: `-weather`, `-wind`, `-fluid`, `-demo waterfall`. Editor viewport draws the same effects.
* Diagnosis: the river "blue blocks" / dark bands are one-block water terraces of the v2 generator (rendering.md).
* `-shaders off` and `-look classic` unchanged (parity runs).

### Fine water, stage W3: adaptive sub-cell bricks (opt-in `fluid.Config.Fine`)

* Water that moves lives in `N x N x N` sub-cell bricks (N = 2, 4 or 8, default 4; 32 units per sub-cell) and folds back into
  `water_1..7` / new `water_full` blocks when calm; `water` stays an infinite source with a constant head. Integer rules: falls,
  lateral equalisation with a film threshold, communicating vessels through full cells (pressure), seams with coarse cells
  with a one-level tolerance, lava, fragile blocks, void. Exact volume ledger (`State.Ledger`).
* Deterministic by construction: the dirty bits of the bricks and the pending chunk scans are hashed, wake-ups are
  synchronous for bricks, stale coarse wake-ups cost no budget; snapshot/restore, rollback, chunk-mode undo (burrowd) and
  replay after a world load are exact. Caps: `FineMaxBricks` (2048), `FineSpawn` (128 per step), `FinePressure`, and the
  wake-up queue overflows to chunk scans at 8192 writes.
* Off by default: existing projects, worlds, journals and hashes are unchanged. On for `burrow new` (sandbox template,
  `runtime.plugins.fine_water`), the editor without a project (`burrowedit -no-fine-water` to opt out) and burrowd sessions with
  `fine_water: true`.
* Commands `fluid_pour`, `fluid_cell`, `fluid_refine`; editor tools `editor_water` (fine fields), `editor_water_pour`,
  `editor_water_wake` (refine is one undo step). `.voxworld` stores the bricks.
* Audit fixes: burrowd `session_hash` now includes the hash bytes of active extra states (fine water, weather; neutral extras
  add nothing, so plain sessions keep their hashes); `fluid_refine` is charged 64 cells per inspected cell against
  `MaxActCells`; the fine ledger is no longer hashed (an editor undo returns the exact StateHash); unevaluated fine
  candidates no longer count in the hashed `Dropped`; the wake-up queue of both modes overflows to chunk scans at 8192
  writes instead of 65536 (worst coarse burst step 257 ms -> 30 ms; goldens unchanged).
* Physics: `voxel.LiquidTable` reads the sub-cells (immersion, `Submerged`, new `LocalHeight`, flow). Rendering data:
  `mesh.BuildFineWater` / `mesh.Opts.FineWater`, a crack-free smooth surface with normals, current, depth and foam
  (`mesh.FineVertex`), for the renderer stage S3. Docs: [docs/water-fine.md](water-fine.md).

### Shaped blocks, stage B2: slabs, stairs, doors, fences, plants (opt-in `runtime.blocks: "shapes"`)

* Opt-in level `runtime.blocks: "shapes"` (= `extended` plus shapes), `engine.VoxelWorldPlugin{ShapedBlocks: true}`, `blockset.RegisterShapes(reg)`. Classic and extended projects keep
  ids, worlds, journals and hashes; `burrow new` stays on `extended`; the burrowedit scratch session uses `shapes`.
* About 1109 new block ids for about 254 items (slabs, stairs, walls, fences, fence gates, doors, trapdoors, pressure plates, buttons, carpets, snow layers, glass panes,
  iron bars, torches, ladders, vines, cross plants, tall plants, cactus, lily pad), appended after the extended set. Each stored state is its own id (`oak_stairs`,
  `oak_stairs[facing=east,half=top]`); neighbour-derived state (stair corners, fence and pane connections) is computed at meshing and collision time, never stored.
* Package `shape` (models: boxes in sixteenths, quads); `blockset/shapes.json` generated by `go run ./scripts/genshapes`. `voxel.Block.Shape`;
  `voxel.MoveAABB/Overlaps/Raycast` are shape-aware when the registry has shaped blocks (`ChunkMap.SetShapeRegistry`); `voxel.Hit.Point` is the exact hit point.
* Mesher: chunks with shaped blocks produce `mesh.Mesh.Fine` meshes (sixteenths; shader push constant `pc.b.x=1` scales by 1/16); other chunks unchanged. The soft renderer
  ray-traces shape quads. Under this level generator v2 flowers, mushrooms, tall grass and dead bush become cross plants, and cactus a real cactus (ids unchanged).
* Editor: placement orients shaped blocks from the face, point or camera (`blockset.Place`); `Editor.Interact` toggles doors, trapdoors and gates (`blockset.Toggle`).
  Gallery: `go run ./examples/voxel_sandbox -gallery-shapes -textures pixelperfection ...` -> `docs/img/blocks-shapes-gallery.png`.
* Under `runtime.blocks: "shapes"` the generator-v2 plants become walk-through and the cactus non-opaque: an existing v2 world keeps its StateHash but its collision changes when moving from `extended` to `shapes`.
  The registry fingerprint (`voxel.Registry.Fingerprint`, never hashed) is stored in the first journal entry (`registry_id`) and checked by replay and snapshot restore; a mismatch is a clear error.
* Two-block plants lose their upper half when water destroys the lower one (`shapes.support` system: period of 32 ticks with a per-chunk phase, so at most 1.6 s of latency; overlay chunks and the y=0 layer of the chunk above are examined; 13.9 ms per tick in a synthetic worst case of 3750 overlay chunks).
* Docs: [docs/block-shapes.md](block-shapes.md), [docs/blocks.md](blocks.md).

### Extended block set, phase 1: all full cubes (B1)

* New package `blockset` + `blockset/blocks.json` (generated by `scripts/genblocks` from `mcnames.json` and attribute rules): 338 full-cube Minecraft blocks (stones, ores, woods, 16-colour wool,
  concrete, concrete powder, terracotta, glazed terracotta and stained glass, Nether/End, lights, technical blocks) appended after the existing ids. Opt-in: `runtime.blocks: "extended"`,
  `VoxelWorldPlugin.ExtendedBlocks`, `core.Config.ExtendedBlocks` (new `App.OnSimSetupLate`); projects without the field keep their registry, ids and hashes. `blockset/testdata/ids.golden` freezes the ids.
* Per-block metadata (display name, category, search aliases, hardness, material); `editor_blocks` returns it. Docs: [docs/blocks.md](blocks.md), `docs/img/blocks-gallery.png`.
* Textures: Pixel Perfection is the default of new projects and of a scratch `burrowedit` session (a development-only pack stays selectable in private builds); tintable Pixel Perfection textures are normalised to
  the level `TintGain` expects; 75 1.17+ blocks are flat placeholders; layer budget `blocktex.MaxLayers` with flat fallback; `burrow assets textures` lists the extended coverage.
* Tools: `voxel_sandbox -gallery-wall` (wall of every block), `scripts/blocksheet` (contact sheets per category).

### Terrain tools and a new voxel cursor (T1)

* New tools: Raise / Lower (column sculpting with strength, hardness fall-off, shapes cube / sphere / cylinder / cone / disc), Flatten (level plane shown), Smooth, Ramp, Surface paint,
  Replace, Extrude face (push / pull) and Scatter (trees, bushes, rocks, plants; deterministic seed). Keys B N G U P Y K X O, all rebindable. Sizes up to 64, surface-only mode,
  radial symmetry, grid / chunk snapping, pointer reach, brush presets and recent blocks saved in the preferences, a *Tool* panel (also a popup from the context bar).
* Cursor: outlined voxel and face with its normal, exact preview of the edit (green added, red removed, block colour recoloured) with counts and dimensions, refusal messages with the numbers.
  Strokes interpolate between pointer positions (no holes), are one undo step, and sculpt strokes follow the plane of the first click (no runaway digging); raising is bounded per stroke.
  Wheel = size, Alt+wheel = strength, Shift inverts, Ctrl+click picks, wheel while dragging a box = height.
* Fixed: mirrored Paint wrote blocks into air; flood fill and brushes were previewed every frame (the preview is now cached); brush size slider stopped at 16 (now 64).
* Agents: `editor_tool_apply` takes the new tools and settings plus `dry_run`; `editor_selection_op` has `replace`; `editor_state` reports the brush. Backward compatible.

### World generation v2: biomes (G1)

* New generator `worldgen.Biomes` ("gen v2", `runtime.generator.kind: "biomes"`): 17 biomes (deep ocean, ocean, beach, plains, flower meadow, forest, birch woods, taiga, tundra,
  desert, savanna, jungle, swamp, mountains, snow peaks, river, lake) from noise fields (continentalness, erosion, latitude-banded temperature, humidity) with horizontal domain warp;
  mountains with ridged crests and rare cliffs, rivers that cross the land and reach the sea, lakes, caves with controlled entrances, ores, bedrock/deepslate, per-biome surface rules
  (slope exposes stone), trees (oak, large oak, birch, spruce, acacia, jungle, swamp, bushes), plants and snow/ice only in the cold. Sea level, horizontal scale, relief, caves and trees are settings.
* v1 (`Heightmap`, `Flat`) is untouched: projects, `.voxworld`, `.voxscn` and scenarios without a generator stay on it, and `StateHash`, journals and goldens do not change. v2 is the default
  of the `sandbox` template and an option everywhere else: World settings dialog ("biomes (v2)"), `burrowd`/`burrowctl` generator `biomes`, sandbox `-gen v2`.
* 16 new blocks registered after the defaults only when v2 is installed (`worldgen.RegisterBiomeBlocks`); development-pack textures where they exist, flat colours otherwise (cactus, flowers, mud, ...).
* Biome tint (`Biomes.TintAt`, 5x5 blend, grass/foliage/water) used by the mesher and the soft renderer for v2 worlds; `blocktex` and `ClimateAt` are unchanged.
* The streamer covers the generator's chunk layers (v2: 4 layers) and follows a live world regeneration. API: `worldgen.BiomeAt`, `Biomes.BiomeGrid` (minimap), editor tools `editor_biomes`
  and `editor_biome_at`. See docs/worldgen.md.

### Block textures, stage B0: Pixel Perfection CE import (textures only)

* Imported the block textures of **Pixel Perfection Community Edition** (XSSheep and contributors, CC-BY-SA-4.0, commit `28e38ca`) byte for byte into
  `assets/textures/pixelperfection/` (922 PNG + 67 `.mcmeta`, 322 KiB; LICENSE, NOTICE.md and a SHA-256 `manifest.json` next to them). Albedo only, 16x16
  (animations are vertical strips, cropped to frame 0 at load time), Minecraft Java 1.16.2 coverage. Separate from the development-only pack (`restricted: false`, `share_alike: true`).
* `-textures pixelperfection` / `runtime.texture_pack: "pixelperfection"` ; the development pack stayed the default until the block registry was wired (B1).
  `-tags nopp` compiles the pack out (`--no-default-textures` now builds with `novnr,nopp`). `blocktex.SetPack/Pack/PackEmbedded/Licenses()`; `burrow build` prints the
  attribution + ShareAlike notice and records `textures.licenses` in `<out>.build.json`.
* `assets/blocktex/mcnames.json` (generated by `scripts/gen-mcnames.py`): 454 canonical block names with their texture files and faces, 242 derived shapes
  (slab, stairs, wall, fence, ...), tint kinds, 221 auxiliary files and 146 newer vanilla blocks with a suggested flat colour. `blocktex.LoadMCNames()`.
* `burrow assets textures [--list] [--json]`, `burrow doctor` check, docs/texture-packs.md, docs/img/texture-pack-pixelperfection.png.

### Characters (stage P1): rig, skins, `.vox` characters, animation, views, editor panel

* New package `character`: a generic hierarchical rig (named parts with pivots; head, torso, arms, legs plus arbitrary static parts), a box humanoid textured
  by a standard 64x64 skin (inner + alpha-masked overlay layers, 4 px or 3 px "slim" arms, nearest sampling reference, 4x nearest enlargement for the
  bilinear renderers) with an original code-drawn default skin (golden PNG), and voxel characters imported from `.vox` files split into named parts
  (`head`, `arm_r.glove`, `tail@torso`, `pivot.head` conventions) with the bundled `voxel_hero` sample.
* Deterministic procedural animation (frame domain): state machine idle/walk/run/jump/fall/crouch/swim/fly with blending, distance-driven gait, head look
  with clamp, damped body yaw, keyframed clips (attack, place, wave, hurt, cheer, nod) that scripts and agents trigger through the `anim` field of the new
  `character` component or the `charplay.Trigger` event. Time comes from `dt` only; nothing touches `StateHash` or the journal (tested).
* Rendering through the existing mesh path (new `engine.AddRenderInputHook`, 4 lines in `render.extract`; no shader, no `render/vulkan` change), soft and Vulkan, parts cast
  shadows. First person (arm + held block, gait bob, attack swing), third person back/front with a voxel-raycast camera collision, F5 / PageUp / PageDown / Ctrl+wheel / C
  as input actions in the default map. Held block = textured cube with the 3D-icon biome tint (`blockicon.FaceImage`), generic placeholder for non-blocks.
* Scene and editor: `character` component (model, skin, scale, held, anim, speed, hidden) in `.voxscn` with schema, tooltips and validation, editable by the editor agent
  with the generic component tools; View > Panels > Character (model, skin import, orbitable CPU preview, animation list, walk-speed slider, view setting).
* Hash contract: the avatar and animations never change `StateHash`. Registering the `character` component does (every registered component is hashed), so games register it
  only with `runtime.plugins.character: true` or when the default scene uses it; the editor always registers it. `app.FrameState.InWater/HeadUnder` drive the swim state.
* F5 no longer toggles block textures while the avatar plugin is on (`engine.KeyReservations`). Makefile: `make character-test` (Vulkan vs soft parity of the avatar).
* Limits: first-person arm is depth tested against terrain, no IK, 64x64 skins only, crouch is visual. docs/character.md.

### Water physics, stage W1: flow, buoyancy, swimming

* New package `fluid`: a deterministic cellular automaton for water on the voxel grid. Levels are blocks (`water` = source, `water_1`..`water_7` flowing,
  registered after the terrain blocks, so ids and old `.voxworld` files stay valid), so flowing water lives in the sparse overlay, in `StateHash`, snapshots,
  undo and the editor document without new storage. Fall, spread (range 7), infinite sources, drain, fragile blocks, lava to obsidian/stone, bounds.
* Bounded and canonical: a work list sorted by (y, z, x) behind a `voxel.Observer` change feed (every write, undo and world load wakes the cells around it),
  `MaxUpdates`/`MaxActive`/`ChunkScans` caps per step (all candidates are evaluated, so stale wake-ups never consume a budget), a queue overflow becomes the sorted set of the chunks written, then a sweep; write order never matters. The work list is derived data: in
  snapshots (restore mid-flow resumes exactly) but not in `StateHash`, so "place then undo" and the hashes of worlds without moving water are unchanged.
  Measured: idle 13 us/tick, a 66k-cell sea breach 0.12 ms/tick average, 12 ms worst, work list peak 95k cells.
* Physics: `voxel.LiquidTable` (exact box immersion, surface height, corner heights, flow), Archimedes' push and drag toward the current for dynamic bodies,
  `physics.MoveCharacterWater` (buoyancy, swim up/dive with `Jump`/`Move.Y`, currents, climbing out), `CharacterController.Submerged/HeadUnder`
  (hashed only when non-zero), `Query.Immersion/WaterAt`, `physics.WaterConfig`; the sandbox `app.Controller` swims too (`FrameState.InWater/HeadUnder`).
* Additive API: `voxel.Block.Liquid/Fragile`, `voxel.Observer`, `Chunk.Contains`, `mesh.LiquidHeight/LiquidCornerHeights/LiquidFlow` (for the renderer),
  `fluid_wake` command, `editor_water` tool, `core.Config.NoFluids/Fluids`, `runtime.plugins.fluid`, `blocktex` aliases `water_N` -> `water`.
* Editor: water placed with the normal tools, flows only while the simulation ticks (Play); Stop restores exactly. docs/water-physics.md.
* Compatibility: snapshots persisted before this stage (burrowctl `state.snap`) do not restore into an engine with the plugin (extra count and registry differ; `Restore` explains it), and journals in which a character enters water change hash (it swims now); dry journals and `.voxworld` files are unaffected.
* Limits: no pathfinding toward holes, no lava flow, no rain inflow yet, ABI v1 unchanged (scripts swim through the intent fields).

### Weather simulation foundation (stage W2)

* New package `weather`: deterministic fronts (clear, cloudy, fog, light/heavy rain, storm, snow) from a seeded transition table with realistic durations,
  smoothed intensities (no jump), slowly turning wind, lightning and delayed thunder, a day clock (`scene.NewSky(State.Clock)`) and an optional seasonal
  temperature cycle. Integer state keyed by splitmix64 of (world seed, counter): same seed, same weather on every platform.
* Spatial sampler `State.At(pos)`: local type, rain/snow phase (snow only at or below 0 C), temperature (climate noise + altitude + season + day), humidity,
  wind; `ExposureAt` shelter test (column scan), `SkyLightFactor`, rain/snow supply and fire-extinguish hooks (no fire or water system consumes them yet).
* Journaled commands `weather_set` / `weather_restore`; `editor_weather` MCP tool, View > Weather panel (one undo step per change or slider drag), `vox_act` in burrowd.
  `engine`-side `weather.Plugin` (frame resource `*weather.State`, `LightningEvent`, `ThunderEvent`); `runtime.weather` / `runtime.seasons` in `vox.project`
  (on in the `sandbox` template, off elsewhere).
* Hash contract: an inert (disabled) weather module adds nothing to `StateHash`, so existing goldens and journals are unchanged; `sim.Engine.Extra(name)` added and
  `StateHash` skips extras whose `HashBytes` is nil. Docs: docs/weather.md (includes what the shader stage S3 should consume). No rendering change.
* Limits: no biomes (climate noise + altitude), no sand storm, no snow cover/ice (water stage), the renderer does not read the state yet.

### Shader levels, stage S2: hybrid frames and the editor, block light, AO, soft shadows, look tuning

* The HDR pipeline (atmosphere, auto exposure, bloom, tone map) now runs in hybrid frames (burrowplay, games with scene components), in `RenderHybridToTarget` (the burrowedit
  viewport and screenshots; `burrowedit -shaders ...` works) with per-target post resources, and offscreen frames have GPU timestamps (Profiler lists the post passes).
  New `shaders/mesh_hdr.frag`; the scene canvas is drawn after the tone mapping. `-shaders off` / `-look classic` are unchanged (golden parity).
* Coloured block light, render only: `voxel.Block.Emit` (additive, JSON `emit` omitted when 0) and default emitters by name; `mesh.Opts.BlockLight`, `Vertex.Light`,
  flood fill across chunk borders with smooth per-vertex light, packed above the AO bits (vertex stays 16 bytes; vertex shaders now mask the AO bits).
* Screen-space ambient occlusion (`medium`+), rotated-disk sun shadow filter with slope-scaled bias, scene UBO 512 -> 768 bytes.
* Fixes: sunsets/sunrises (warm sky, golden light), dim dawn ground, violet water at dusk, black night/water, burnt moon disc, white foam dots, over-bleached sand.
* Known limits: no emitter blocks in the stock editor registry, SSR/god rays/GI are later stages. Details in docs/rendering.md.

### Shader levels, stage S1: HDR foundation, atmosphere, exposure and bloom

* New `-shaders off|low|medium|high|ultra` (voxel_sandbox, burrowplay, burrowedit; env `BURROW_SHADERS`; default `medium`) and `-clouds auto|clear|scattered|broken|overcast|0..1`
  (env `BURROW_CLOUDS`). `render.ShaderQuality` holds the presets. `off` (and `-look classic`) is the previous renderer unchanged and stays the soft renderer's reference.
* HDR frame buffer (RGBA16F, B10G11R11 fallback for the main target) plus an internal render graph (`render/vulkan/rgraph.go`, `post.go`): bloom prefilter and
  mip chain with a soft threshold and Karis weights, eye adaptation (centre-weighted mean log luminance, 1x1 ping-pong history), bloom upsample, and a composite
  with auto exposure, ACES with highlight roll-off, saturation/contrast, soft grade, vignette and dither. Every post pass has a GPU timestamp
  (`Stats.GPU.Post`, printed by `-frames` as `perf: post ms ...`).
* Procedural atmosphere (`shaders/atmo.glsl`, CPU twin `scene/atmo.go`): Rayleigh/Mie single scattering with sun transmittance (orange/red low sun, blue hour,
  afterglow), sun disc and halo, moon disc, stars, drifting clouds (flat layer on `low`, ray-marched slab with self shadowing on `medium`+), aerial perspective
  on terrain and water, overcast dims the sun. The moon is the directional light at night (weak shadows); shadows fade out toward the horizon instead of popping.
* Known limits: HDR applies to frames without scene components (hybrid voxel+scene frames and offscreen targets keep the off pipeline); no propagated block light
  yet (emissive texels lean warm and bloom). The make parity targets (`view-test`) pin `-shaders off`.

### Water and foliage look (natural and vivid looks only; classic is unchanged)

* Water (`shaders/water.glsl`): the flat registry blue is leaned to a blue-green and made translucent with a light-turquoise shallow band that deepens with the
  liquid column (absorption: red first, then green), richer colour, stronger Fresnel sky reflection, a 1.8x ripple normal with light variation on wave slopes
  (faded with distance), and thin drifting foam streaks on one-block-deep water instead of the dot lattice. The alpha is capped at 0.88 so deep water is never an
  opaque flat blue.
* Foliage (`shaders/voxel_body.glsl`, soft twin in `render/soft/tex.go`): leaves are found from the top mip alpha of the tinted layer (< 1 = cut-out texture). They
  get lifted dark texels (no near-black speckle), a deterministic per-block hue variation (yellow-green to blue-green, render only), softer AO, an ambient floor,
  light leaking through the canopy (softer sun shadow, wrap term) and no specular/env reflection (leaves were picking up bright sky reflections). Alpha test
  coverage is kept across mips (alpha scaled by the mip level) so distant leaves do not thin out.
* Found while debugging: a second `hash3` call inside the leaf block made MoltenVK write garbage and blue speckles on the `-shaders off` natural look; the per-block
  variation reuses the existing `tone` hash instead.
* Known limits: no depth-buffer based shore detection or refraction (the water depth is the mesher's column depth), no real interior leaf lighting
  (no propagated light), classic look and `-shaders off -look classic` goldens keep the old water and leaves.

### Isometric block icons

* New `assets/blockicon`: deterministic CPU renderer of 3D isometric block icons (3 textured faces, lighting 1.0 / 0.8 / 0.6, 3x3 supersampling, biome-plains tint, alpha respected), cached per (block, size), flat shaded fallback for untextured blocks and `novnr`. Used by the editor Blocks palette, block chip and the game hotbar (24 px). `ui.UI.DrawImage` added.

### Editor UI redesign (stage U2)

* burrowedit moves to the U1 design system: menu bar with icons and shortcuts, context bar that adapts to the active tool (brush, shape, hollow,
  mirror, block chip, region actions, gizmo space / snap) plus transport and a preferences gear, a left tool bar with rich tooltips, a viewport
  with overlay widgets (view and shading menu, clickable axis gizmo, slice chip, PLAYING badge, stats), Hierarchy over Inspector on the right,
  an Assets / Console / Profiler / Blocks dock below, and a segmented status bar with the play tint.
* Docking: panel headers with grip and kebab menu, minimum sizes, remembered splitter ratios, layout presets (Default, Voxel editing, Scripting /
  Debug, Minimal), View > Panels, full-screen viewport (Space), maximize panel (Ctrl+Space). `layout.json` is versioned; old, unknown or corrupt
  files fall back to the default and are backed up as `layout.v1.json.bak`.
* Hierarchy with search, per-type icons, eye / lock toggles and empty states; Inspector rebuilt on `PropertyGrid`: collapsible component sections
  with icons, copy / paste values, searchable *Add component*, script fault banner, and a schema inspector (`ui.InspectEx`) that renders ranges,
  units, vec3 axis fields, colour fields and asset reference fields with drop targets.
* New Profiler panel (frame / CPU / GPU / sim times, sparkline, counts, memory); Blocks palette with favourites and recents, also as a popup.
* Command palette with icons, category chips and recent commands; F1 cheat sheet; file browser with breadcrumbs, favourites, new folder and a
  confinement banner; toasts instead of console-only messages; preferences as a form (theme, UI scale, density, font size, reduce motion, accent).
* Performance: `canvas.Atlas` packs icons, rounded-corner and ring textures, glyph atlases and a white block into one page so the Vulkan overlay
  batches them (about 370 -> 135 batches for the full editor); adaptive corner segments cut rounded-rect vertices; the Recorder reuses vertex
  slices; `canvasMaxVert` 90000 -> 262144 with `Stats.CanvasVerts/Batches/Dropped`; cached `Editor.Scene()` handle, shortcut strings and asset list.
  The full editor (300 nodes, 100 assets) records about 14.6k vertices and costs 0.3-0.6 ms of CPU per frame at 1600x900 and 2560x1440.
* `ui`: `MenuItemEx`, `ImageWithOverlay`, `Region`, `ClickRect`, `WrapText`, `ApplyAccent`, `Theme.SetReduceMotion`, `Dock` hooks (icons, header
  actions, minimum sizes), `Collapse` starts in its target state, console with monospace font and severity icons.

### Lighting look-dev (stage L1)

* New default `-look natural`: linear HDR lighting (exact sRGB decode, HDR sun > 1, hemispheric sky/ground ambient, small side-face cue), exposure, ACES tone mapping, one sRGB encode, saturation 0.86 and contrast 1.04, calmer tint gain (1.12 vs 1.65), olive (not yellow) hot-biome tint, deeper blue zenith / bluer horizon, warm azimuth-local sunrise/sunset glow, fog from 0.45 of the far plane, calmer specular (rough floor 0.3, env x0.4). `-look vivid` is a richer variant; `-look classic` is the previous behaviour bit for bit. F7 cycles looks. Flags `-exposure`, `-saturation`, `-contrast`, `-tonemap none|aces|filmic`.
* `render.Look`, `scene.Sky.HDR`/`ColorsNatural`, `RenderSettings.Look...`, `vulkan.Options.Look`/`Renderer.SetLook`, `window.LookPressed`. Separate shader variants `voxel_lin.frag`/`glass_lin.frag` (a runtime look branch in the textured shader made MoltenVK output per-texel garbage on leaves). Soft renderer has the same pipeline.
* `internal/lookdev` + `cmd/lookmeasure`: luminance/contrast/saturation/clipping/haze measurements of a PNG.
* Vulkan-vs-soft parity (view-test) with the natural default: 5.55 / 5.21 / 7.03, shadows off 4.30 (thresholds 7.0 / 6.6 / 8.8 / 5.4); classic keeps 6.42 / 6.27 / 8.60.

### Audit 17 fixes (lot D2)

* HIGH sim: the journal world tag is captured BEFORE the first command is applied, so a first `RegenOp`/`LoadWorldAdopt` no longer breaks every replay (43/500 seeds failed; the twin test now runs 500 seeds x 60 ops incl. RegenOp, all pass).
* DoS: `.burrow-cache` thumbnails are checked with `png.DecodeConfig` (exactly 64x64) and a 256 KiB cap before decoding (a 248 KB 16000x16000 PNG is rejected with < 4 MiB allocated); same header check in blocktex and the debug PNG loader; `FuzzThumbPNG`.
* `VerifyCacheNeutrality` also replays the journal and compares it with the live hash and checks that two cache factory calls share no pointer/slice/map/chan (shared state smuggled through caches is now reported).
* `engine.SharedState` (optional interface of an AddFixedCache value) declares pointers shared between cache instances by design (read-only registries, compiled script modules); the alias check skips them, the replay-vs-live hash compare still catches result-affecting mutation. Implemented by `physics.work` and `script.runState`.
* Emission mips: the A=255 "none" marker is decoded before averaging (glowstone no longer fades with distance).
* `go mod tidy` clean (x/sys direct); GO-2026-6809 needs go >= 1.27.3 installed locally (a `toolchain` line was tried and rejected: the downloaded toolchain is hardened-runtime signed and strips DYLD_*, breaking every `go run` GPU recipe), `*.bak/*.orig/*.rej` ignored, stray `.bak` removed.
* Vulkan: texture layer cap is `min(2048, maxImageArrayLayers)` with a clear error.
* Input: typed text drops C0/C1 controls, format (bidi/zero-width) and separator runes; `World1`/`World2` and `RightSuper` are distinct keys (`LeftSuper` parses as `Super`); `ReadConfined` refuses hard-linked files (`ErrHardlink`).
* New: `VoxelWorld.SetRadius` / `Editor.SetLoadRadius` change the load radius live (editor World Settings "Apply radius"); blended translucent glass/ice pass (GPU + soft); models template pyramid UVs undistorted; hue-preserving tint clamp; full texture-pack licence text in `assets/textures/NOTICE.md`; Go fonts in THIRD_PARTY_NOTICES; docs/rendering.md describes the real `-ticks`/`-freeze` behaviour.

### Security fixes (audit 16, toolchain)

* HIGH `burrow` no longer treats the working directory (or its parents) as a Burrow checkout: `voxRoot` resolves `--burrow-root`, `$BURROW_ROOT`, then the build-time root
  (linker `-X main.buildRoot` or the absolute compile path; ignored under `-trimpath`), each validated (`module burrow-engine`, layout, marker). A hostile project
  carrying its own `module burrow-engine` + `cmd/burrowplay` can no longer be built and executed by `burrow run/build/test/edit`. The tool cache is keyed by root path, source
  hash, `go.sum`, GOOS/GOARCH, tags and Go version, created 0700, and unsafe (foreign, symlinked, group/world-writable) cache entries are refused.
* HIGH `burrowplay -replay` works for scripted and builder projects, from a directory, a `.voxpak` and a packed game (script modules are registered before replay).
* `burrowplay` re-executes for the MoltenVK environment before extracting a packed game, and cleans its temp directory on SIGINT/SIGTERM/SIGHUP: no `burrowgame-*` leftovers.
* `burrow test` runs the project's Go tests only with `--go-tests` (replaces `--no-go-test`); new docs/security.md describes the trust boundaries.
* `-trimpath` for tool builds (cache burrowplay, `--no-default-textures`); built games carry no home or checkout paths.
* `.app` bundles ship the archive once (`Resources/game.voxpak`) and are signed once: `codesign --verify --deep --strict` passes. `Source.OpenSelf` loads the bundle archive.
* Build manifest: errors propagate, the parent directory is created, `<out>.build.json` also with `--app`; `--app` usage text corrected.
* `burrow new`: no-follow directory creation and `O_EXCL|O_NOFOLLOW` writes (symlinked subdirectories refused), non-empty targets need `--force`, go.mod roots with spaces are quoted.
* `scripts/dist.sh` accepts an absolute `DIST`; CONTRIBUTING lists five templates and `models` joins the e2e tests.
* `burrow shell-env` / `gpuenv.Exports` single-quote values (eval-safe, spaces work).
* `vox.project`: finite and bounded start/yaw/pitch/scale, printable title, duplicate JSON keys rejected, atomic save with a random exclusive temp name.
  `pak.Attach` uses a random exclusive temp file; pak paths reject bidi/format/separator characters; decompression ratio capped at 50:1 per file (files over 1 MiB)
  and 256 MiB total by default (`pak.MaxRatio`, `pak.RatioMinSize`, `pak.MaxTotalSize`); the Builder stores over-ratio files raw.

### Editor (lot B)

* Asset thumbnails (png/vox/obj/voxscn, deterministic, disk cache in `.burrow-cache/thumbs`, bounded background workers); drag assets into the viewport
  (.vox stamp with ghost, R/Esc, .obj MeshInstance, .png Sprite, .voxscn/.prefab instance); hot reload of textures/meshes/scripts/scenes with prompt.
* World settings (regenerate base with new seed/params, keep or discard edits, undoable, journaled `editor_world_regen`), adopt-seed on world load,
  `vox.project` settings dialog with inline validation.
* Inspector multi-edit, world-transform reparent (`scene.Affine.Inverse/Decompose`, `WorldAffine`), sibling reorder (drag, Alt+Up/Down), undo of delete
  restores boundary EntityRefs (`scene.RefsInto`, `scene_set_ref`), node lock + eye icons, slice view (`Editor.SetSlice`), F1 shortcut help,
  keybindings checked/exported as `input.Map`, safe recent lists, import progress/cancel, windowed screenshots at the requested size.
* Security: fd-based race-resistant agent file IO (`WriteConfined`/`ReadConfined`), file dialog confined to the project with a confirmed "browse outside".
* `core.Config.Schema`, `Editor.Resolver` (procedural assets layered over the project's `dbassets`).

### LOT A (rendering)

* Soft: honours `-shadows=false` (`render.Options.NoShadows`), alpha-tested leaf/glass shadows, slice clip, `NormalStrength`/`SpecBoost`,
  `TintFn`. view-test thresholds 8.0 / 7.9 / 10.8 and shadows-off 13.2 -> 7.1 (measured 6.42 / 6.27 / 8.60 / 5.63). Goldens regenerated.
* Vulkan: GPU timestamp queries (`Stats().GPU`, `perf: gpu` line), `SetSlice`, `SetPBRStrength`; shaders `common.glsl` Scene UBO gains `slice`
  and `fx` vec4, `water.frag` depth colour/foam/ripples, `shadowcut` slice clip. Default `-texfilter` is now `linear`.
* `pbr.DefaultNormalStrength` 2.2 / `DefaultSpecBoost` 2.0, `pbr.DecodeNormalK`; flags `-normal-strength -spec-boost -biome-tint -slice-y`.
* `worldgen.ClimateAt`, `blocktex.BiomeColor`, `mesh.Opts.Biome`, `mesh.Vertex.Shift/Depth`, `mesh.MaxWaterDepth`.
* `engine.RenderSettings` resource, `RenderPlugin.SetSliceMaxY`, `VoxelWorld.SetSlice`, `VoxelWorldPlugin.NoBiomeTint`.
* Glass textured (imported `glass_n/_s` via `glass!`, synthesised albedo); `packtool` supports maps-only names.
* Not done: texture animation (no water texture in the development pack, no lava/fire blocks in the engine), translucent tinted glass, window F6 key.

### BREAKING (pre-1.0): deprecated aliases removed, `AddFixedResource` is strict, `-shot` runs the game

* burrowd / `agent` JSON: the old hash key is gone; only `session_hash` remains (a session hash, not `sim.Engine.StateHash`). Removed Go fields:
  `StateHash` of `agent.Info`, `ActResult`, `HistoryResult`, `SnapshotInfo`, `Observation` (use `SessionHash`). burrowctl output follows.
* Editor `editor_state` / `editor_step`: the old hash key is gone; use `engine_hash` (raw `Engine.StateHash`) or `doc_hash` (canonical document hash).
  Go: `editor/agent.State.StateHash` removed (use `EngineHash`). Nothing in the repository reads the old key any more.
* `engine.AddFixedResource` now REJECTS (Build error naming the type) any type that is not plain data (exported fields only) or `FixedState`:
  it can no longer silently register an unhashed "derived cache". Result-neutral caches use the new `engine.AddFixedCache` (not hashed, not
  rolled back, not snapshotted; same `FixedRes` accessor). `physics` (`*work`) and `script` (`*runState`) migrated.
  New: `engine.Options.ClearCachesEachTick` (debug) and `engine.VerifyCacheNeutrality(mk, ticks)`: runs once normally and once with every cache cleared
  before each tick and errors at the first StateHash difference (tests for physics, script and the engine). Root `burrow` package re-exports `AddFixedCache`.
* `burrowplay -shot` no longer freezes the simulation: the idle frames the debug driver feeds carry `Dt = FixedDt` (`engine.DebugPlugin.IdleDt`),
  and a shot always runs at least one real tick (scene transforms exist in the first frame). `-freeze` (new on burrowplay) restores the frozen,
  reproducible shot. `-ticks N` with a window runs N REAL journaled ticks before the window starts (no snapshot restore), so
  `burrowplay -shot ... -freeze -ticks 200 -journal j.json` then `burrowplay -replay j.json -expect <hash>` reproduces the printed StateHash, equal to
  `-headless -ticks 200`.

### Added (game runtime, window, input)

* Asset registry for games: `.obj`, `.vox`, `.png`, material JSON and shader SPIR-V referenced from scenes (`render.mesh`, `render.voxmodel`,
  `render.sprite`, `render.material` texture/shader) resolve in burrowplay windowed, headless and from a `.voxpak` through `engine.LayeredAssets`
  (builtin meshes + PNGs first, then `rworld/dbassets` over the `assets.DB`; contract `engine.AssetResolver` = `rworld.Assets`).
  New template `models` (`burrow new g --template models`: .obj + textured material, .vox model, billboard sprite).
* Window input: the window now reports PHYSICAL keys (letters, digits, F1-F25, arrows, punctuation, Tab/Enter/Esc/Space, Shift/Ctrl/Alt/Super, navigation block,
  keypad), 8 mouse buttons (`Mouse4`..`Mouse8` bit flags, `button4`.. in input.json), scroll, typed text (`Frame.Text`, GLFW char callback)
  and the first connected gamepad (GLFW joystick API polled per frame, hotplug, standard gamepad mapping or positional fallback) as a raw
  `input.Frame`. `input.Map` is the single source of bindings: the controller's `app.Input` is now derived from the Map (`core.AppInput`), so rebinding
  (or the project's `input.json`) also rebinds the first-person controller. `engine.WindowPlugin.Map`, `window.Window.SetMap/Frame/GamepadName`,
  `engine.RawInput` resource, `Window.PBRPressed` (F6) and `InjectKey("f6")`. New default gamepad bindings: L3 sprint, Y toggle fly, RB break, LB place (plus the existing stick move/look and A jump).
* Package layout: the engine-free core of `input` moved to `input/core` (`input` re-exports every name as an alias, so imports are unchanged);
  this breaks the old `input -> engine -> window` cycle. Deleted: `window.MapKey`, `window.ChordKey`, the duplicate key table and `window/keys_test.go`
  (replaced by `window/input_test.go`; pure parts are tested without a GPU). `window` has a CGO_ENABLED=0 stub (`window.Available`).
* `burrow doctor` reports whether the default (restricted-licence) texture pack is embedded (`vnr-textures` check); `burrow new` templates mention the texture licence
  in their README; `burrow build --app` help and docs describe ad-hoc signing, quarantine/Gatekeeper and notarisation. `scripts/check-getting-started.sh`
  runs the commands of docs/getting-started.md literally in a temp dir (`GPU=1` adds shots and the `.app`).

### T3 (texture visual fixes)

* Dark grass/leaves fixed: grass_block_top / oak_leaves are gray (~0.57), a plain multiply by the plains tint darkened
  them to ~57 % and AO darkened foliage further. Tinted albedo is now `min(1, texel * tint * TintGain)` (`blocktex.TintGain`
  = 1.65, twin `TINT_GAIN` in voxel.frag, baked overlay and thumbnails too), all in sRGB space; AO on tinted faces is
  softened (`0.75 + 0.25*ao/3`). Soft renderer updated (goldens regenerated); view-test soft-diff tolerance of the shadows-off
  view raised 10.1 -> 13.2 (measured 10.53).
* Shadow pass alpha-tests cut-out (leaf) faces: new `shadowcut.vert/frag` pipeline for the leaf index range, opaque terrain
  keeps the depth-only path. `BURROW_CUTSHADOW=0` restores full-block leaf shadows. soft still has no leaf shadows.
* Hotbar draws the block's albedo thumbnail (flat swatch for water/glass/untextured or with F5 off); target highlight fill is
  a light-yellow 0.14 alpha on front faces only (was white 0.18 on both faces, ~0.33 overlap).
* `BURROW_TEXDEBUG=albedo|tint|ao|normal|spec|light` shader debug views; `-keys f5` debug flag presses window keys after settle;
  editor selftest shoots the Blocks panel (`ed_05g_blocks_panel.png`).
* Tests that create unix sockets use a short dir under /tmp (editor/agent, cmd/burrowd) so `make check-clean` passes with a long TMPDIR.

### Added

* `editor_journal_export`, `editor_verify_replay` (editor MCP); `vox_replay {action:"verify"}` (burrowd); `agent.Session.VerifyReplay`,
  `core.Editor.ReplayHashes`, `engine.App.SimVersion`.
* `burrow doctor` warns when the Go toolchain is older than 1.27.3 (GO-2026-6809).
* `make build` (binaries into `./bin`), `make check-clean`, `make test-slow` now covers the heavy script tests.
* `examples/voxel_sandbox` debug flags: `-cam -tick -nohud -freeze -soft -montage -maxdiff -resizetest -script -imgdiff -shadows -wire`.
* LICENSE (MIT, placeholder holder), THIRD_PARTY_NOTICES.md, .gitignore.

### Fixed

* `Editor.DocHash` returned a stale cached value after `App.RestoreSnapshot` or any App-level sim mutation.
* `go test ./script -count>1` failed because the shared Runtime's Stats are cumulative.

### Removed

* `cmd/voxview` (replaced by `examples/voxel_sandbox`; `make view-test` now runs against it).

### Unreleased (default textures)

* Added `assets/textures` (development-only block subset, never distributed, see NOTICE.md), `assets/blocktex` (block->face mapping, layer sets with mips, `novnr` tag), `cmd/burrowpacktool` + `scripts/import-vnr.sh`, `runtime.texture_pack` (`default`|`none`).
* Textured terrain (stage T2): `mesh.Opts.Layers` (`LayerProvider`), `Vertex.Layer/UV/Tinted` (additive; flat meshes unchanged), `render/vulkan` block texture arrays
  (albedo sRGB, normal/spec UNORM, CPU mips, `-texfilter nearest|linear`), LabPBR shading in `shaders/voxel.frag` (the voxel vertex grows from 12 to 16 bytes),
  `assets/blocktex/pbr` + `render/soft` textured raycaster (`render.Options.Textures`), `engine.BlockTextures`, `Textures` options on `VoxelWorldPlugin`, `RenderPlugin`,
  `RenderWorldPlugin`, `SoftRenderPlugin`; flags `-textures default|none` (sandbox, burrowplay, burrowedit), `-pbr`, `-texfilter`, `-gallery`, F5 toggle; `runtime.texture_pack`
  now consumed by burrowplay. Editor Blocks panel swatches and ghost colours use albedo thumbnails. `burrow build` prints the licence warning, writes `<out>.build.json` and
  accepts `--no-default-textures` (novnr burrowplay). `make view-test` thresholds raised to 5.8 / 6.0 / 9.0 / 10.1 (measured 4.62 / 4.77 / 7.18 / 8.07 + 25 %).
* Soft renderer golden hashes (flat) are unchanged; new textured keys `terrain_tex`, `terrain_tex_nopbr`.
