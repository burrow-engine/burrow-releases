# Lighting: block light and skylight

Burrow lights the voxel world with a propagated, coloured light field: **block light** (red, green and blue channels, 4 bits each) from emitters such as torches, lava and
glowstone, and **skylight** (4 bits) from the open sky. It is derived data: a pure function of the blocks and the registry, never part of `StateHash`, a snapshot or a journal.

## What was there before

`voxel.Block.Emit` and the default emitters by name (`voxel/light.go`) existed, and the mesher flood-filled a 64^3 window around every chunk to give each vertex a coloured light
(`mesh.Opts.BlockLight`). There was no skylight (caves were lit by the hemispheric ambient, so a cave at night looked like the night outside), no attenuation by block, no
persistent field (every edit re-meshed the 26 neighbours and recomputed the window), no query API, no soft renderer light and only 3 blue bits. Ambient occlusion existed
(per-vertex AO in the mesh, SSAO or ray traced AO in the post stack) and is unchanged.

## The rules

* A light level is 0..15 per channel. Entering a non-opaque block costs one level per channel plus the block's filter; opaque blocks stop light (an opaque emitter lights its
  neighbours).
* Block light: `Block.Emit` (0..15) and a colour. Known names (`torch`, `soul_torch`, `redstone_torch`, `lava`, `glowstone`, `sea_lantern`, `lantern`, the froglights, ...) have a
  default level and colour (`voxel.Block.Emission`, state suffixes such as `torch[wall=true]` are ignored). `Block.EmitColor` overrides the colour. The colour is mixed 30% toward
  white so every channel holds levels for most of the range (a saturated colour would burn its weak channels close to the source and leave only a thin tail). A warm light still
  turns redder with distance because every channel loses the same number of levels.
* Skylight: 15 at the top of the topmost chunk layer, **straight down it loses nothing**, sideways one level per block. A roof therefore makes a dark room whose edges are lit.
* Filters (`Block.LightLoss` = extra levels per channel; default by name, `Block.LightFilter`): leaves 1/1/1, water 2/1/1 (red goes first), non-opaque ice 1/1/0, stained glass
  keeps its own colour and absorbs the others (a red pane passes red). Shaped blocks do not block light (a slab does not shade).
* Chunk borders are transparent to the algorithm; cells next to unloaded chunks are lit as if the unloaded space were solid until it loads.

## `voxel.LightField`

Per chunk, 16 bits per cell (r | g<<4 | b<<8 | sky<<12), uniform chunks (open sky) store one value. Updates are incremental breadth-first searches per channel:

* **Add**: an emitter or a freed cell queues its neighbours; a cell brighter than a neighbour minus the cost raises it.
* **Remove**: removing a block or an emitter queues the old value; neighbours that could only have been lit through it are cleared and the brighter neighbours around the hole are
  queued again to refill it (the classic two queue algorithm, also for skylight columns).
* Edits are detected by diffing a chunk against the classes it was lit with (`Chunk.Version`), so undo, redo, restore, fluid and script edits all work without a hook.
* Chunk load / unload: a loaded chunk pulls from its loaded neighbours and pushes into them; an unloaded chunk removes the light that flowed out of it.

The result is the fixpoint of max-propagation: independent of load order, edit order and budget slices (tests compare random edit sequences with a from scratch flood fill, cell by
cell). `Step(budget)` does at most `budget` cell visits and keeps its queues; removals always run before additions. A torch placed and removed in a 85x27x85 cave costs about 0.6 ms
(`BenchmarkLightCaveUpdate`) and `TestLightUpdateBudgetBigCave` bounds the visits.

## Where it runs (frame domain, off the main thread)

The streamer (`engine/lightrun.go`) owns one `LightField` on its own goroutine, fed by columns loading and unloading and by chunk touches (`markDirty`, plus a sweep of a few columns per
frame for edits that bypass the controller). It reads blocks through the world read lock (`ChunkMap.View`). The main thread only sends commands and applies results, so propagation costs
the main thread nothing (frame time p99 with light on equals light off, see Measurements).

Mesh workers copy a padded light snapshot of their chunk (`LightField.Snapshot`, under a read lock held for at most one 8192 visit slice) and the mesher reads it
(`mesh.Opts.Light`, per-vertex smooth light = the mean of the four open cells around each corner, exactly as before, now with the sky channel). Meshes are not delayed: a chunk
meshed while the field is still settling uses a **provisional estimate computed by the mesher** (`mesh/lightest.go`, `Opts.EstimateLight`): the field's own rules run on the padded
chunk (skylight falls down every column, from the sky or through the layers above the chunk read from the world, attenuated by leaves and water, nothing under a solid block, then spreads
sideways; emitters inside the window flood). Each mesh records a hash of the light it read (`Result.LightHash`, solid cells zeroed, like `LightField.Snapshot`); when the field settles the runner
re-meshes **only** the chunks whose hash differs (sources beyond the one-cell border), so a good estimate costs nothing and a change on a chunk border reaches only the neighbours that read
it. Reports are flushed when the field is idle or every 4 s of continuous work; loads are sent nearest first.

## Simulation queries

`ChunkMap.LightAt(reg, p)` (also on `voxel.Access`, `sim`-side code, nav and scripts) is the **deterministic** query: a separate sim-side field that lights the 3x3 columns around the
queried cell synchronously, re-reads edited chunks and returns the exact value of the infinite world (light cannot travel 32 blocks, so a neighbourhood is enough). It depends on the
blocks only: not on streaming radius, camera, frame rate or call order. It is never hashed.

```text
Light{R,G,B,Sky}  .Block() = max(R,G,B)   .Level(skyDim) = max(Block, Sky - skyDim)   skyDim 0 at noon .. 15 at night
```

* Scripts: host import `light_at(x,y,z) -> packed r|g<<4|b<<8|sky<<12` (ABI.md), Go SDK `burrowsdk.LightAt(x,y,z) (Light, error)`. It sees the committed blocks, not the writes
  buffered by the running call.
* Nav / AI: behaviour tree condition `dark{max=7, sky_dim}` (`nav.Builtins`) and `nav.View.LightAt`; `ai.Dark(light, skyDim, max)` is the pure rule. "Mobs spawn in darkness":
  `dark` on the cell a spawner picks, with `sky_dim` taken from the (deterministic) day clock.
* MCP: `vox_light {pos, sky_dim}` (burrowd) and `editor_light {pos, sky_dim, view}`.

Layers: skylight enters through the top of the highest generated chunk layer (`engine` sets it from the generator, default 0..1). Chunks outside the layer range (edits far above the
terrain) are not lit; blocks there neither shade nor emit.

## Rendering

The vertex stays 16 bytes. Position uses bits 0..9 of x, y, z (0..512 in sixteenths), so the high bits of x carry the skylight and those of y the blue light (red and green stay above the AO
bits of the vertex word). Dynamic voxel bodies keep raw positions (`pc.b.x = 2`). An unlit vertex (`mesh.Vertex.Lit` false) reads as open sky.

Shaders (`voxel_body.glsl`, `water.glsl`, `water_hdr.frag`, all shader levels including `off`, and `-look classic`):

* ambient is multiplied by `skyOcc(sky)` (1 in the open, `0.012 + 0.988 * sky^1.7` below), direct sun by `skyVis(sky)`: caves are dark by day and at night
  (the existing sky/sun/moon cycle already scales the ambient, so "skylight scaled by time of day" is the ambient times the skylight);
* block light adds `blockRadiance = 2.4 * light^2.2` (HDR levels, per channel) or `0.95 * light^1.7` (display space looks) times the albedo and AO;
* the environment reflection is scaled by the sky occlusion.

Smooth lighting and AO: the corner light is the mean of the open cells (an occluded corner averages fewer, brighter-or-darker cells), the AO factor multiplies ambient and block light
in the shader. Quads merge only when their four corner lights are equal.

The soft renderer has the same terms (`render/soft/light.go`, `render.Options.Light`; the engine passes an on-demand `voxel.DemandLight`), so headless renders and the parity tests match:
`make view-test` parity 5.3 / 4.9 / 8.0, shadows off 4.1, classic 6.5 (thresholds 7.0 / 6.6 / 8.8 / 5.4 / 8.0).

**Ray tracing.** Emitters already bounce light through the GI ray (`RTBlockInfo.Emit`, now with the emission colour instead of the block colour). The traced passes scale the ambient share
of the lit pixel, and the baked block light is added by the raster shader, so GI keeps working; the tracer does not trace the block light field itself (documented limit: no
traced shadows from torches, no GI from block light onto other surfaces beyond the emitter bounce).

## Environment components: time, sun, sky, weather, fog, post

The look of a scene's sky and air is made of ordinary components on ordinary nodes. New projects and templates put one `Environment` node in their first
scene (`builtin:environment.prefab`, `scene.DefaultEnvironmentPrefab`: `env.time` starting at 0.35, `env.sun`, `env.sky`). Fog and post can also sit on zone nodes.

| component | what it sets | domain |
|---|---|---|
| `env.time` | the day clock: `start` (day fraction, 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset), `day_length` in seconds (0 = 1200), `frozen`. The time of day is a pure function of the simulation tick (`EnvTime.Fraction`), so it replays identically. | **hashed** (sim) |
| `env.weather` | a held front: `kind` (clear, cloudy, fog, light_rain, heavy_rain, storm, snow), `intensity`, wind (`wind_dir`, `wind_speed`, `wind_auto`), `frozen`. The clock and the front reach the weather module as journaled `weather_set` commands ([weather.md](weather.md#environment-components-and-the-weather)). | **hashed** (sim) |
| `env.sun` | `intensity` (sunlight multiplier, 0 = 1), `color` (tint multiplier, 0,0,0 = the clock's), `fixed` + `azimuth` / `elevation` (degrees; 0 azimuth = +X, 90 = +Z) instead of the clock's direction, `no_shadows`. | frame |
| `env.sky` | `zenith` and `horizon` colours (0,0,0 = from the clock), `stars` (`auto` or `off`), `clouds` (`auto` follows the weather, `on` uses `cloud_cover`, `off` clears the sky). | frame |
| `env.fog` | `color` (0,0,0 = the sky horizon) and `density` 0..1, in a volume. | frame |
| `env.post` | `exposure` (EV), `bloom` (strength multiplier `1 + bloom`, -1 = none), `saturation`, `contrast`, `fill_light`, `distortion` (air distortion multiplier `1 + distortion`), in a volume. | frame |

**What is hashed.** Only `env.time` and `env.weather` are simulation state (they drive the clock and the weather, so they are in the `StateHash` and the
journal like any component). `env.sun`, `env.sky`, `env.fog` and `env.post` are renderer-only: never hashed, never journaled, never read by a `FixedUpdate`
system. Adding them to a scene changes no hash. The blended result lives in the frame-domain `engine.EnvState` resource.

**Volumes and blending.** `env.fog` and `env.post` carry a volume: `shape` `global` (everywhere), `box` (half extents `size` in the node's space, follows its
transform) or `sphere` (radius `size.x`). Inside the volume the weight is 1 (times `weight`), and it fades to 0 over `blend` blocks outside, measured from the
active camera. Volumes blend in `priority` order, higher last so it wins, ties by node order: fog density and the post offsets interpolate toward each volume
by its weight (`scene.BlendFog`, `scene.BlendPost`; a zero fog colour keeps the colour below). `env.time`, `env.sun`, `env.sky` and `env.weather` are global: the first node
in tree order that carries one wins. `scene.ResolveEnv(nodes, cam, tick)` does all of it; `internal/game` calls it every frame for the game camera
and the editor for the editor camera.

**What the renderer does with each field.**

| field | Vulkan (HDR levels) | Vulkan (level off, classic) | soft |
|---|---|---|---|
| `env.time` | sun, atmosphere, ambient | sun, sky gradient | sky time |
| `env.sun.intensity` | `Look.SunGain` | `Look.SunGain` | `Look.SunGain` |
| `env.sun.color` | tints the sun light, its transmittance and the disc | tints the sun light | tints the sun light |
| `env.sun.fixed` | direction override; the atmosphere uses a clock whose sun has the same elevation | same | same |
| `env.sun.no_shadows` | shadow map off | same | shadows off |
| `env.sky.zenith` / `horizon` | recolours the procedural sky and what reflects it (`atmo.glsl`, weights in the w of `horizon` / `zenith`) | replaces the sky gradient ends | same |
| `env.sky.stars` off | no stars | (no stars) | (no stars) |
| `env.sky.clouds` | cloud cover | none | none |
| `env.fog` | density folds into the weather fog (`WeatherFX.Fog`); colour replaces the distance fade colour | density as in HDR; one colour for fog and sky horizon | colour replaces the horizon |
| `env.post.exposure` / `saturation` / `contrast` | the colour pipeline, exposure pinned | same | same |
| `env.post.bloom` | bloom strength x `1 + bloom` (levels with bloom) | no bloom | no bloom |
| `env.post.distortion` | air distortion strength | same | none |

Scene frames drawn through `rworld` (the hybrid mesh pass, character and model previews) take the same fields from `rworld.ApplyEnv`: a clock without a
`DirectionalLight` node drives the sun, a `DirectionalLight` keeps its direction and colour but takes the gain, tint and shadow switch, `env.sky` and `env.fog`
replace the sky and aerial perspective colours.

**The editor** resolves the same components for the editor camera each frame (`editor/core/env.go`, pushed to the renderer by `editor/gpu` through
`engine.EnvApplier`): the viewport shows the time of day, the sun, the sky, the fog volumes around the camera and the post grade of the open scene exactly like
the game, and a change shows on the next frame (the scene is re-read every few frames). Nothing of it is an undo step.

### Old `scene.settings` fields

`time_of_day`, `exposure`, `fill_light` and `music` no longer exist in `scene.settings` (a scene that still has them is rejected). `burrow migrate` turns them into an `Environment` node (`env.time` frozen at that time, `env.sun`, `env.sky`, `env.post`) and a `Music` node (`audio.music`); the scene looks and sounds the same.

## Scene settings: controller and hud

A node of the scene (a root or a direct child of a root) can carry the `scene.settings` component; the running scene applies it (start scene, and again
after a scene change, checked a few times a second by `internal/game/scene_settings.go`). All fields are optional, absent means "project default":

```json nocheck
"scene.settings": {"controller": false, "hud": false}
```

| field | effect |
|---|---|
| `controller` | `false` suspends the first-person controller and the player avatar for this scene only (no movement, hotbar, break/place; the app paces the ticks itself). `true` or absent leaves the project setting. The scene also frees the mouse cursor (menu mode, clicks go to the UI) while it runs and takes it back when the next scene turns the controller on; a game UI modal keeps managing the pointer itself. With `runtime.plugins.controller: false`, any scene that says `true` makes the project install the controller plugin anyway (found by scanning the scene and prefab files for `scene.settings` with `"controller": true`); it stays suspended in every scene that does not say `true`. A project with no such scene is unchanged (nothing is installed, `StateHash` identical). |
| `hud` | `false` hides crosshair, hotbar and text overlay, `true` forces them. |

Settings precedence: command-line flag, then `BURROW_*` environment variable, then `vox.project`, then the engine default. `scene.settings` is not a fourth source of the same values: it only switches the controller and the HUD while its scene runs (the project value applies again in the next scene). Everything except `controller` is frame domain (the `engine.SceneRuntime` resource): never hashed, never journaled. The component is registered in the
default schema and not hashed, so adding it to a scene does not change the `StateHash`.

### Scene-stored voxel edits (`world.edits`)

```json nocheck
"world.edits": {"boxes": [{"min": [10,64,10], "max": [14,70,14], "block": ""}, {"min": [12,64,12], "max": [12,64,12], "block": "campfire"}]}
```

Boxes are applied in order, once, when the scene is first seen as the running one, as ordinary journaled `fill_box` commands (so they are part of the
`StateHash`, replay and undo like any edit). `block` empty or `air` clears. Corners may be in either order. Limits: 64 boxes, 1,048,576 cells per box,
4,194,304 in total, coordinates within +-1,048,576; violations are rejected when the scene is decoded. An unknown block name skips that box with a warning.

## Blocks

| name | level | colour |
|---|---|---|
| torch, lantern, glowstone, jack_o_lantern, redstone_lamp, sea_lantern, shroomlight, froglights, campfire, fire, beacon, lava | 14-15 | warm yellow / orange, cyan sea lantern, pearlescent froglight pink |
| soul_torch, soul_lantern | 10 | cyan |
| redstone_torch | 7 | red |
| magma, end_rod, crying_obsidian, amethyst, candle | 3-14 | see `voxel/light.go` |

The extended block set has no lava block. A project (or the `lavalake` demo) registers one: `voxel.Block{Name: "lava", Solid: true, Opaque: true, Emit: 15}`.

## Debug view, switches

* `BURROW_LIGHT=off` or `RenderSettings.NoLight` turn the light off (meshes carry no light, shaders read open sky).
* Light debug view (frame domain): `RenderSettings.LightView` / `RenderPlugin.SetLightView` / editor View menu "Light view" / `editor_light {view}`: `block` (colour of the block light),
  `sky` (skylight), `level` (brightness heat map). The soft renderer has it too (`render.Options.LightView`).
* Demos: `examples/voxel_sandbox -demo lightcave|lightcolors|lavalake -shapes -tick 18000` (night; `-tick 6000` for day).

## Measurements (M2 Max; the machine was shared, load average about 11, so absolute numbers are indicative)

* Mesh memory: the GPU vertex stays 16 bytes. Default heightmap terrain radius 3: 176 280 -> 190 356 opaque vertices (+8.0%) (`TestLightMeshGrowth`, limit 25%).
* 1440p, radius 8, `-gen v2`, medium: GPU 5.82 ms with and without light, 1.064 M vs 1.045 M triangles in view (+1.8%).
* Frame time while flying and sprinting (`-novsync`, 1280x720, p99 of 1380 frames): 9.7 and 12.3 ms with light, 13.0 and 13.3 ms without; walking 11.7 / 12.2 vs 11.3 / 11.8.
  Uploads while flying 73.8 MiB with light vs 37.0 MiB without (2.0x; 3.9x with the open-sky provisional light, 5-6x before the hash filter). Initial load at radius 16 (2 layers): settled after 2.35 s
  vs 1.24 s without light (was 11.9 s); `TestLightStreamingUploadsStayLow` keeps the upload ratio under 1.8x (1.4x measured).
* Light field cost (`BenchmarkLightCaveUpdate`): place plus remove a torch in a big cave 0.58 ms; the initial light of a chunk is a column fill plus seeds from the cells that can still
  brighten a neighbour (uniform open-sky chunks cost nothing in memory).

## Limits

* Shaped blocks do not partially block light; skylight does not model partial occlusion by slabs and stairs.
* Light is not shadowed by entities, and scene meshes / dynamic voxel bodies do not emit or receive propagated light (bodies read open sky).
* A class table holds 255 distinct (opaque, filter, emission) behaviours; beyond that further ones read as air. `Registry.Update` of a light property needs `LightField.Reset`.
* Cells at the edge of the streamed area are lit as if the unloaded space were solid (block light) or open (the provisional estimate in meshes).

## Voxel size

Light is measured in metres, not voxels. The field keeps each channel in units of 1/`Scale` level (`LightConfig.Scale` =
the world's voxels per metre: 1, 2, 4 or 8): an emitter holds `level * Scale` units, every cell step costs one unit
(plus the block's filter), and sky enters at `15 * Scale`. Queries, snapshots, `light_at` and the renderer still read the
levels 0..15 (units floored to whole levels), so a torch lights the same radius in metres at every voxel size. At scale 1
a unit is a level and the field is byte-identical to before. The cost is memory: a materialised chunk of light holds four
8-bit channels (128 KiB per 32^3 chunk, was 64 KiB), and the on-demand sampler loads `ceil(15 * Scale / 32)` chunks around
the cell (1 up to scale 2, 2 at scale 4, 4 at scale 8).
