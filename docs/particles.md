# Particles

Burrow's particle system is **frame domain**: it never reads or writes simulation state, so it can never change a `StateHash`. The
simulation only *requests* effects (`particles.Event`, deterministic per tick) and the optional `particle_emitter` scene component is
ordinary scene data. Packages: `particles` (parameters, assets, library, simulation; no engine dependency), `particles/partplug` (the engine
plugin) and, for drawing, `render` (`ParticleBatch`), `render/vulkan` (GPU) and `render/soft` (CPU).

## Quick start

It is off by default (`"runtime": { "plugins": { "particles": true } }` enables it). This installs the system and registers the `particle_emitter`
component (registering a component changes `StateHash`; a default scene that already uses the component registers it too, and
`particles: false` with such a scene is a build error). In code:

```go nocheck
a := engine.New(engine.Options{Seed: 1})
a.AddPlugin(&engine.ScenePlugin{})
a.AddPlugin(&partplug.Plugin{Component: true})
// a deterministic gameplay system asks for effects; the frame domain shows them
a.AddFixedSystem("fx", func(c *engine.FixedContext) error {
	if c.Tick%20 != 0 {
		return nil
	}
	return partplug.Burst(c, "builtin:sparks", mathx.Vec3{X: 3, Y: 20, Z: -4}, 0)
})
// a continuous effect is a node with a component
c.Commands.Spawn("", "campfire", &t)
c.Commands.AddComponent("/campfire", particles.CompName, particles.Emitter{Asset: "builtin:fire", Enabled: true})
```

`examples/particles_demo` shows the six presets on a flat stage plus simulation-driven bursts: `go run ./examples/particles_demo`, or
`make particles-test` for the captures (classic pipeline, HDR pipeline, the CPU twin, a stress run) with the validation layer on.

## The emitter component

`particle_emitter` (all fields appear in the inspector): `asset` (`builtin:<name>` or a `.particles.json` path; empty = use the inline fields),
`enabled`, `seed`, `scale` (size, spawn volume and speed multiplier), then the inline effect (the same fields as the asset):

| group | fields |
|---|---|
| emission | `rate` (per second), `burst`, `burst_interval`, `duration` (0 = forever), `max` (live cap of this emitter) |
| shape and motion | `shape` (`point`, `sphere`, `box`, `disc`), `extent`, `direction`, `cone` (half angle, 180 = every direction), `speed` [min,max], `lifetime` [min,max], `gravity`, `accel` (wind), `drag`, `spin` |
| over life | `size` [min,max], `size_over_life` (4 stops), `color` (4 RGBA stops, RGB above 1 glows) |
| look | `texture` (empty = soft disc, `builtin:puff|spark|flame|square|ring`, `block:<name>`, or a `.png` path), `cols`, `rows`, `frames`, `animate`, `blend` (`alpha`, `additive`), `soft` (fade distance against the depth buffer), `stretch` (velocity stretch), `uv_scale` (debris sub-rectangle), `lit` (sun shadow and ambient light on the GPU; default on for alpha, off for additive), `depth_collide` (`off`, `bounce`, `kill`: GPU collision with the previous frame's depth buffer) |
| distortion | `distortion` (strength 0..8, default 0 = off) and `distortion_only`: the particles also bend the image behind them (heat haze from smoke, fire or exhaust; see [rendering.md](rendering.md) "Air distortion"); with `distortion_only` they draw no colour. Shader level medium and up on the GPU renderer; the CPU renderer ignores `distortion` and skips distortion-only emitters |
| space | `space`: `world` (particles stay where they were born) or `local` (they follow the node as a whole) |
| collision | `collide`, `bounce`, `friction`, `kill` |
| inheritance | `inherit_velocity` (0..1): fraction of the node's velocity (measured between frames, teleports ignored) added to world-space particles at birth |
| forces | `forces`, up to 4 of `{kind, pos, axis, strength, radius, scale}` in the emitter frame: `vortex` (swirl around `axis` through `pos`), `attract` / `repel` (toward / away from `pos`), `turbulence` (smooth noise, `scale` = noise cell size in blocks, changes slowly with time). `strength` is an acceleration (blocks/s^2, -100..100), `radius` the reach with linear falloff (0 = unlimited) |
| sub-emitters | `sub`, up to 4 of `{event, asset, count, inherit_velocity, chance}`: at a particle's `spawn`, `collide` (impacts faster than 0.5 blocks/s) or `death` (end of life, or `kill` impact) another effect (`builtin:<name>` or `.particles.json`) is spawned there as a one-shot burst of `count` particles (0 = the effect's `burst`, or 8), inheriting `inherit_velocity` of the parent particle's velocity, with probability `chance` (0 = 1) |
| trail | `trail` `{length, width, color_over_trail, min_dist, texture}`: a ribbon behind each particle; `length` seconds of history 0..2 (0 = off), `width` [head, tail], `color_over_trail` 2 RGBA stops, `min_dist` between points, `texture` like `texture`. Drawn by the renderers (`render.ParticleTrail`) |
| mesh | `mesh` `{model, scale, align}`: a voxel model (`cube` or a `.vox` path) per particle instead of a billboard; `align` is `velocity`, `random` or `none` (`render.ParticleMesh`) |
| light | `light` `{color, radius, intensity, max}`: the particles emit point lights (colour zero = the particle's own, `max` lights per emitter, `render.ParticleLight`) |

Toggling `enabled` (a journaled component change) starts or stops emission identically in every replay; turning it off lets live particles finish.
Gravity and wind are world accelerations; for `local` emitters they go through the inverse of the node's full transform, so a non-uniform scale
(or a shear) still makes particles fall straight down in the world. Zero-valued extras (`forces`, `sub`, `trail`, `mesh`, `light`, `inherit_velocity`)
are omitted from the JSON, so older assets and emitter hashes are unchanged. Lists and groups appear in the inspector as JSON objects.

In the editor, the emitters of nodes hidden by the Outliner's eye or a hidden layer stop emitting in the viewport (`partplug.Plugin.Skip`, set by the editor; nil in the game); particles already in flight run out.

## `.particles.json`

A document is the inline fields plus `version` (1) and an optional `name`; omitted fields take defaults. `particles.Decode` rejects unknown fields,
trailing data, documents over 64 KiB, non-finite or out-of-range numbers and newer versions, then sanitizes. Hot reload: the library re-reads
four loaded files every 15 frames and compares content hashes; a changed file replaces the effect for every emitter using it, a broken save keeps
the last good version and the error shows up in `editor_particles state` (`errors`). Start from a preset:

```
editor_particles {action:"get", asset:"builtin:smoke"}   # sanitized params
editor_particles {action:"save", path:"fx/chimney.particles.json", asset:"builtin:smoke", params:{"rate":30}}
```

## Built-in presets

`builtin:smoke` (rising puffs, soft, alpha), `sparks` (additive, velocity stretched, bouncing), `dust` (a burst of soft puffs, drag), `splash`
(water droplets, gravity), `fire` (additive flipbook flames), `soul_fire` (the cyan twin of the fire), `debris` (block-break chips with voxel collision; a break event names the block and
its texture, `block:<name>`, replaces the sprite, each chip showing a random quarter of a face). Sprites are generated procedurally
(`particles.BuiltinTextureNames`): no third-party material. Every preset and sprite is also a read-only engine asset (package `builtinassets`): the
effects ship as embedded `.particles.json` files, so "Copy to project" in the editor's Engine folder gives an editable variant, and
`partplug.Plugin.Overrides` (`{"builtin:debris": "assets/particles/debris.particles.json"}`) makes a project file replace the builtin everywhere it is named
(block break debris included). See [Builtin assets](builtin-assets.md).

## Fire on the burning blocks

`partplug.Plugin.BlockFX` keeps an effect alive on top of every loaded block of a type (torch fire): `map[block name]partplug.BlockFX`
(`{"torch": {Asset: "builtin:fire", Scale: 0.45}}`). Every state variant of the name counts (`torch` covers `torch[wall=true,facing=east]`);
the flame sits on the shape (0.65 above the cell for a floor torch, 0.82 for a wall one; `Height` overrides). The emitters follow the loaded chunks
around the camera within `blockFXRadius` chunks (a chunk is rescanned only when its content version changed; scanning one without a watched block
costs a palette lookup per watched name), at most `BlockFXMax` alive, nearest the camera first, and the fire dies with the block or the chunk. Frame
domain, never hashed: the StateHash and replays are unchanged.

## Events from the simulation and scripts

`partplug.Emit(fixedCtx, particles.Event)` sends the event with `engine.SendFixed`: one ordered list per tick, byte identical across replays,
dropped on rollback and while a replay verifies. Kinds: `EvBurst` (one-shot effect at a position; the effect lives on its own), `EvEmit` (extra
particles from the emitter component of an entity), `EvStop` (clear an emitter, or everything with entity 0). Helpers: `partplug.Burst(c, entity, asset, offset, count)`,
`partplug.BlockBreak(c, entity, "stone", offset)`. **Effects come from an entity:** a burst from the simulation names the entity that emits it (`particles.Event.Entity`, the
position is that entity's world position plus `X, Y, Z` as an offset); a burst without one is refused (`particles.Event.ValidateSim`, `particles.ErrNoEmitter`) and the
frame domain drops it. Only host code (the editor, tests) may queue an absolute burst (`Particles.Queue` with entity 0). The debris of the blocks the player breaks is
emitted by the player entity, at the block. Scripts (module `vox`, ABI additive, see `script/ABI.md`): `particle_burst`, `particle_emit`, `particle_stop`;
Go SDK in `sdk/burrowsdk/particles.go`:

```go nocheck
burrowsdk.ParticleBurstOn(self, "builtin:sparks", burrowsdk.ParticleOpts{Offset: &[3]float32{4, 20, -3}, Count: 24})
burrowsdk.ParticleBlockBreakOn(self, "stone", 4.5, 20.5, -2.5)
```

## Determinism

* The frame domain owns everything visual. Replays look the same because the *requests* are the same: seeds are `splitmix(emitter id, spawn
  index)` for emitters and `splitmix(tick, index of the event in the tick)` for events. There is no `math/rand`, no wall clock in the random streams.
* A particle is a closed-form trajectory `p = p0 + v0 f1 + a f2` (`f1 = (1 - e^-kt)/k`, `f2 = (t - f1)/k`, series for small `kt` because the
  naive form cancels in float32): no integration state, so the position at time `t` is independent of the frame rate and identical on the GPU and
  the CPU (`render.ParticleBatch.Eval` and `particle_update.comp` are twins). Spawning and collision advance in fixed 1/60 s substeps (at most 15
  per frame, delta clamped to 0.25 s), so 30 and 60 fps runs spawn the same sequence; a collision rebases the trajectory segment.
* Force fields break the closed form, so they are integrated in the CPU substep: each substep the acceleration of the fields at the particle is added to
  its constant acceleration and the segment is rebased at that substep (the shader and `Eval` just see more segments; no GPU change, twin parity kept).
  Turbulence is a hash lattice noise of (emitter seed, cell, time), no state. Collision is the same: the segment of a substep is walked voxel by voxel
  (DDA) and only an impact rebases it.
* Sub-emitter seeds are `splitmix(parent emitter seed, particle spawn index, event, impact count, index in the list)`; the effect lives in a one-shot pool
  of the next substep. Depth is bounded (emitter, then two generations; a third is ignored), and `Config.MaxSubPerFrame` (256) plus the one-shot cap bound the rest.
* `Particles.Queue` (the editor, `editor_particles burst`) plays an effect from host code; it is never journaled.

## Rendering

**GPU** (`render/vulkan/particles.go`). Per frame the CPU copies the live records (80 bytes: position, spawn time, velocity, life, acceleration,
drag, size, rotation, spin, emitter/frame/variant, segment start) and the emitter table (176 bytes each) into the frame slot's buffers; a compute
pass (`particle_update.comp`) evaluates every record at the batch time into one billboard instance (current and previous position, size, colour
over life, atlas uv, rotation). In the main pass, after the glass and the rain, the pass is split once (like the water scene copy): the depth
buffer becomes linear view depth in an R32F image (`particle_depth.frag`), then every emitter draws its range of instances with an instanced quad
(`particle.vert` / `particle.frag`): soft fade `clamp((sceneZ - z) / soft)`, alpha (`src_alpha, 1 - src_alpha`) or additive (`src_alpha, one`)
blending, depth test without depth write. It works in the classic pipeline (`-shaders off`, display colours through `toLinear`) and in the HDR levels
(exact sRGB decode, so RGB above 1 feeds bloom).

*Order across emitters*: every colour particle of every emitter (alpha and additive together) is sorted far to near by view depth, so overlapping
emitters interleave correctly. The sort runs on the CPU (`render.ParticleOrder`, a radix sort of at most 32768 keys: the record positions are at
hand and the sprites are separate textures with no bindless array, so a GPU sort would still need one draw per run); `particle_sort.comp` then
copies the instances into that order and the list is cut into runs of one emitter, one draw each (at most 1024 runs; with more interleaving than
that the frame falls back to one draw per emitter, emitters in batch order, particles far to near inside each). Particles of equal depth keep
emitter and spawn order.

*Lighting and fog* (emitter `lit`, default on for `alpha` blending and off for `additive`): at the particle centre `particle.frag` multiplies the
colour by the ambient light and the sun (`sunShadow`, the same shadow map and filter as the terrain) in the classic pipeline, by the sky/ground
ambient and the sun radiance in the HDR levels. One lookup per fragment, so a dense lit emitter costs more than an unlit one. Block light is not
applied (it lives in the chunk meshes only). In the voxel passes the fog (classic) or the aerial perspective (HDR levels) applies to every
particle: alpha particles take the haze colour, additive ones lose strength. The CPU renderer draws particles unlit and unfogged.

*Depth collision* (emitter `depth_collide`: `off`, `bounce`, `kill`): `particle_collide.comp` tests every instance against the **previous frame's**
linear depth image and camera. A particle that lies behind the surface seen at its pixel (up to 4 blocks behind it) is killed, or mirrored back out
of the surface along the normal rebuilt from the depth neighbours (`bounce` is the restitution: 0 sticks to the surface, 1 is a perfect mirror).
It is stateless (the trajectory is closed form and keeps no velocity), so it only sees surfaces the camera saw last frame: nothing behind the
camera or behind other geometry, nothing on the first frame or right after a resize, and a bounce is the mirror image of the free path, not an
impulse. The voxel collision of `collide` is unchanged and exact; use `depth_collide` for what voxels do not know (meshes, characters, dynamic bodies).

*Scene-only path*: `RenderToTarget` and the swapchain frame without a voxel world draw the batch too (after the transparent meshes and sprites,
before the canvas), lit by the scene sun and shadow map, without fog. A frame with no meshes or sprites (the editor's UI frame) draws none. The
editor viewport (hybrid target) always drew it; the model and animation viewports no longer show the world's particles.

*Motion vectors*: blended particles are not written to the temporal anti-aliasing velocity target (they would overwrite the background velocity of
the pixel). They are drawn after the scene copy, which makes the temporal passes treat them as reactive (history is not trusted there); the
previous position only drives the velocity stretch of sparks.

**CPU** (`render/soft/particles.go`). `render.Options.Particles` splats the same batch over the image after the markers: far to near, depth
tested against the ray distance, same soft fade, alpha or additive, bounded by a pixel budget. It serves headless runs, `examples/particles_demo -cpu`,
and the editor preview (`soft.PreviewParticles`). The two paths agree visually (see `make particles-test`); the CPU does not stretch sparks.

## Budgets and robustness

| budget | default | hard cap |
|---|---|---|
| live particles, all emitters (`Config.MaxGlobal`) | 16384 | 32768 (`render.MaxParticleRecords`) |
| live particles per emitter (`max`) | 1024 | 16384 |
| emitters drawn per frame (`MaxEmitters`, nearest kept) | 128 | 256 (`render.MaxParticleEmitters`) |
| spawns per frame | 4096 | 65536 |
| live one-shot effects | 128 | 1024 |
| collision voxel lookups per frame (every voxel a segment crosses, and a re-test of resting particles every 8 substeps) | 40000 | 1048576 |
| sub-emitter effects per frame (`Config.MaxSubPerFrame`, they count as one-shot effects too) | 256 | 4096 |
| host events per frame / queue | 256 / 256 | |
| sprite textures resident on the GPU | 48 (LRU, at most 4 uploads per frame) | |

Spawns beyond a budget are dropped and counted (`dropped` in `editor_particles state`), never queued. Every number of a component, asset, event
or script call is clamped or rejected (`Params.Sanitized` / `Validate`, `Event.Validate`); NaN and infinities become defaults, non-finite records
evaluate as dead particles on both renderers, textures are limited to 1024 px and 4 MiB, asset files to 64 KiB, texture and effect names to 256
bytes without `..`. A failing GPU setup disables only the particle pass (`Renderer.ParticleStats().Error`).

Measured (M2 Max, MoltenVK, 1280x720, `examples/particles_demo`, vsync-bound 8.3 ms frames):

| scene | main pass GPU | CPU simulation |
|---|---|---|
| 6 presets, about 180 particles | +0.2 to +0.4 ms (classic and HDR, near the timer noise) | below 0.01 ms |
| 4 emitters of soft smoke, 20 000 to 26 000 live | +0.4 to +0.9 ms (large overdraw) | 0.2 ms (`BenchmarkStep20k`, 32 768 live) |
| 10 000 live colliding chips | not run on the GPU | 0.39 ms (`BenchmarkStepCollide5k`) |

## Editor and agents

* Tools > Particle editor (a docked full-screen panel: **Particles** with **Particles settings**; a double-click on a `.particles.json` in the Content browser opens it there; `burrowedit -tool particles -project <dir> -asset <file>` still gives a separate window): the library of presets and project effects on the
  left (presets open as an unsaved copy), an animated CPU preview on a plain backdrop in the middle (Space plays or pauses, R restarts, a time slider scrubs, a loop
  length and a camera distance in the ... menu), and every parameter on the right in Emitter / Appearance / Advanced tabs, as flat sections of label-and-field rows (units in the fields, min and max side by side, x y z with axis colours): appearance (sprite, blend, space, flipbook), emission, shape and motion, size
  over life (a curve with four draggable points) and colour over life (a gradient with four stops), collision. A slider drag is one undo step; invalid values
  are refused. File > Save as writes the `.particles.json`, and every emitter that uses it reloads. Double-click a `.particles.json` in the Content browser to open it.
* The inspector shows the `particle_emitter` fields; drop a `.particles.json` on `asset`.
* MCP tool `editor_particles` (`state`, `list`, `get`, `validate`, `save`, `burst`, `stop`, `preview`): `preview {asset | params, seconds, width, height}`
  simulates one effect alone and returns a CPU render as an image block, so an agent can check an effect without a window; `validate` reports why
  params are rejected; `save` writes a `.particles.json` and hot reloads it.

## Trails

`trail` ({`length`, `width` [head, tail], `color_over_trail` [head, tail RGBA], `min_dist`, `texture`}) drags a camera-facing ribbon behind every particle of the
emitter. No history is stored: the trajectory is closed form, so the ribbon is `p(t - k*dt)` for `k*dt` over `length` seconds (up to 24 samples). Samples
older than the current trajectory segment (a collision or force rebase, `ParticleRecord.Seg`) clamp to the segment start, so the ribbon ends at the last bounce
instead of crossing the wall. Points closer than `min_dist` are merged. The ribbon colour is the particle colour times the `color_over_trail` ramp (head to tail);
u runs along the ribbon (head 0), v across; without a texture the ribbon is solid with soft edges. It blends (or adds) like the emitter and is depth tested.

Emitters with `forces` (and collisions) rebase the segment every substep, so the closed form only reaches back one substep: the Vulkan renderer then keeps a `render.TrailHistory` (head position per frame, keyed by a hash of the particle's immutable fields, at most 24 samples per trailing particle) and `TrailPoints` reads older samples from it; the ribbon ends at the oldest recorded sample. The CPU renderer has no history (previews show the short ribbon). `partplug` loads the `.vox` of mesh emitters into `ParticleBatch.Meshes` itself (`particles/partplug/meshes.go`).

GPU (`render/vulkan/particle_trails.go`, `particle_trail.vert/.frag`): the CPU samples the ribbons (`render.ParticleBatch.TrailPoints`) into a storage buffer and the
vertex shader expands one quad per segment. CPU (`render/soft/particle_fx.go`): the same points, rasterised. Cost: up to `render.MaxTrailPoints` (24576) points
per frame, about 17 `Eval`-like samples per particle; one draw per trail emitter. The ribbon is not soft-faded against the depth buffer and gets no motion vector.

## Mesh particles

`mesh` ({`model` `"cube"` or a `.vox` path, `scale`, `align` `velocity` | `random` | `none`}) draws every particle as a lit mesh instead of a billboard (the
emitter then draws no sprite). The mesh is normalised to a unit cube, so the `size` curve gives its edge in blocks. `velocity` points the model's +Z along the velocity
(and spins it by the particle rotation), `random` gives each particle a fixed random orientation that tumbles with the rotation, `none` keeps the world axes and spins
about the vertical. The renderer finds the geometry in `ParticleBatch.Meshes[model]` (build it with `rworld.ParticleMeshFromAssets`); a missing entry draws the cube.

GPU (`particle_meshes.go`, `particle_mesh.vert/.frag`): de-indexed vertices of all distinct meshes in one storage buffer (re-copied only when the set changes), one 80 byte instance
per particle, one instanced draw per emitter, opaque with depth write. Lit by ambient, the sun, the terrain shadow map and the particle lights; the HDR levels use the
atmosphere light and aerial perspective. Limits: `render.MaxParticleMeshes` (8192) instances per frame, 16384 vertices per mesh, 65536 across meshes; the tint alpha
is a cutout (below 0.5 discards), there is no blending, no velocity vector and the meshes cast no shadow. CPU renderer: flat-shaded triangles with a fixed sun direction and
its own z buffer.

## Particle lights

`light` ({`color`, `radius`, `intensity`, `max`}) makes the particles point lights. Terrain had no dynamic point light path (only block light; scene meshes use
`Frame.Points`), so the scene UBO now carries `render.MaxParticleLights` (16) lights after the swell block (`sceneUBOSize` 1536). Each frame
`ParticleBatch.Lights` takes at most `max` particles per light emitter (the nearest to the camera), then the 16 nearest of all; radiance is `color * intensity *
particle alpha`. `particleLights()` in `shaders/plights.glsl` adds a smooth quadratic falloff to `radius` with wrapped diffuse to the voxel shading (`voxel_body.glsl`: terrain,
glass), scene meshes (`mesh.frag`, `mesh_hdr.frag`) and mesh particles. Cost: one `Eval` per particle of light emitters on the CPU; on the GPU a loop that stops at the
first unused slot, so nothing is paid without lights. The light is not shadowed, does not propagate through blocks, ignores the sky occlusion, and lights popping in or out
at the 16 light limit follow the camera. The CPU renderer and the scene-only path (`RenderToTarget`) apply no particle lights.

GPU checks: `BURROW_GPU=1 BURROW_GPU_ONLY=trail go test ./render/vulkan -run TestGPUChecks -v` (trail, mesh and light shots in `vk_pfx_*.png`).

## Limits

* Voxel collision runs on the CPU only (a few lookups per particle and substep; `collide` is not free). It is continuous (no tunnelling through thin walls),
  but a particle stops sliding after three impacts in one substep, and a `local` emitter moving through a wall is not tested (only the motion of the
  particles relative to the node, at the node's current pose). Resting particles are re-tested against their support voxel every 8 substeps (cost and
  a 0.13 s delay), and a block placed on top of a resting particle does not move it.
* Blended particles are sorted by their centre, not per pixel: large particles that intersect each other, or a big quad around a small one, can still
  swap. More than 1024 order changes between emitters in one frame fall back to one draw per emitter. The sort is by view depth of the batch
  time, so a particle crossing another within one frame can pop.
* Lit particles use the sun shadow map and the ambient light only (no block light, no point lights, no occlusion by the terrain's sky light), the
  same value over the whole quad. The CPU renderer and the editor's effect preview draw them unlit. The scene-only path has no fog and skips frames
  with an orthographic camera or a viewport rectangle.
* `depth_collide` sees the visible surfaces of the previous frame only (see Rendering), tests one point per particle, and does not run in the CPU renderer.
* Force fields and impacts rebase the closed-form segment every substep, so a trail (history before the segment start) of a particle in a force field is
  at most one substep long; sub-emitter effects are CPU one-shot pools (no GPU path) and nest two levels deep.
* MoltenVK: dynamic indexing of a `vec4` component in the compute shader crashed pipeline creation, so the curves are written with explicit branches.
