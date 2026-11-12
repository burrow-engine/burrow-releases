# Ray tracing

Render-only (frame domain): nothing here touches the simulation or `StateHash`. It applies to the HDR shader levels of the Vulkan renderer; `-shaders off`, `-look classic`,
the soft CPU renderer and offscreen editor targets ignore it. The tracer is software by default: a hierarchical voxel DDA in compute shaders, so it runs on MoltenVK; on a device
with hardware ray tracing (RTX, RX 6000+, Arc) ray queries find the bricks a ray crosses (see [Hardware path](#hardware-path)).

## Settings

| flag (env) | values | default |
|---|---|---|
| `-rt` (`BURROW_RT`) | `off`, `shadows` (sun shadows + AO), `full` (+ GI + reflections), or a list of `sun,ao,gi,reflections` | the shader level: low and medium off, **high `shadows` and ultra `full` enable ray tracing by default** (`-rt off` turns it off) |

Flags exist on `examples/voxel_sandbox` and `burrowplay`. `engine.RenderPlugin.RT` and the live `engine.RenderSettings.RT` take the same strings (applied the next frame);
`vulkan.Renderer.SetRayTracing(render.RTSettings)` is the renderer API. Switching on from off rebuilds the HDR target once (it gains the storage usage) and the engine re-meshes the
resident chunks once so the acceleration structure is complete. `BURROW_RT_DEBUG=1..5` shows one signal instead of the lit image (sun visibility, AO, normal, GI, reflection).

## Frame layout

```text
UploadChunkVoxels / RemoveChunk -> acceleration structure (copied at the start of the frame)
main pass -> HDR target + depth
  rt-trace      half resolution: sun shadow ray (cone jitter), AO ray, GI bounce ray, reflection ray      rt_trace.comp
  rt-temporal   reprojection (previous view-projection), per pixel history count, disocclusion test         rt_temporal.comp
  rt-atrous     3 edge-avoiding wavelet iterations (3x3, steps 1, 2, 4)                                    rt_atrous.comp
  rt-composite  depth aware upsampling, applied in place to the HDR target (and the scene copy)            rt_composite.comp
  -> velocity, TAA / FSR 2, bloom, exposure, composite, LDR stage (all unchanged)
```

The traced sun shadow scales the share of the direct sun in each pixel, which the lit voxel shaders write as 1 - share into the alpha of the HDR
target (`gSun` in `voxel_body.glsl`: diffuse, specular and leaf glow after the shadow map and the skylight gate). A cave whose sun the skylight already
removed keeps its light; a blended pass drawn later (water, particles) only raises the alpha (less traced shadow, never black); meshes write 1. (The
composite used to estimate the share from the hemispheric ambient and the full sun, which blackened the sunward faces of every cave.)

Ray traced AO replaces the screen space AO (its passes are skipped while the effect is on; the AO textures are initialised once so the composite never samples garbage).
Ray traced sun shadows replace the shadow map of the world; the map is still rendered, without the world chunks, when something the tracer does not know can cast a shadow: dynamic voxel
bodies, scene meshes and avatars (hybrid frames). Both shadows then multiply. Particles cast no shadow. Under water the whole chain is skipped (the HDR frame is left as rendered).

## Acceleration structure (`render.RTChunk`, `vulkan.rtAS`)

* Per chunk (32^3): an occupancy bitmask (4 KiB, only light blocking blocks: opaque blocks and solid cubes such as leaves; glass, plants and shaped blocks do not occlude),
  a water bitmask, a material byte per voxel (a class of colour / emission / gloss, at most 255 classes, colours are quantised when a registry has more) and the coarse level:
  one bit per 8^3 brick that holds an occluder. A chunk without occluders and water takes no slot.
* A toroidal index of 256 x 32 x 256 chunks (16 MiB) maps a chunk coordinate to its slot. It covers the largest streaming radius (`engine.MaxRadius` = 96, plus 2 columns each side: 197 of the 256 entries) without aliasing; beyond 32 chunk
  layers in Y two layers would share an entry (the key check then gives a missing chunk, never a wrong one).
* Empty chunks and empty bricks are crossed in one DDA step, so open sky and caves are cheap.
* `BURROW_RT_STATS=1` prints every 600 frames the chunks and slots in use, the queue and how far around the camera the structure reaches. Seen in
  the game's world (320 blocks tall, radius 14, in a cave): 610 chunks in 607 of 3584 slots, up to 10 columns away, 122 of the 125 chunks within two
  columns of the camera (layers 0..4; the others are air). The streamer's count of loaded chunks (4446) includes the air chunks, which take no slot.
* Incremental: the mesh workers (`engine/rtvoxels.go`) distil every meshed chunk; an edit re-meshes the chunk and uploads only its data. A cache keyed by chunk pointer and
  `Version` avoids rebuilding the neighbours that are re-meshed next to an edit. At most 48 chunks per frame go through a per-frame staging buffer; the copies are ordered against the
  compute passes by memory barriers. Removal frees the slot and clears the table entry. Capacity: `5 x columns` slots from the renderer's far plane (512..3584, 40 KiB each; `BURROW_RT_SLOTS` overrides it for experiments: a world 10 chunk layers tall keeps more chunks than that). When it is full the nearest chunks to the camera win: a farther resident chunk is evicted, or the new
  one waits in the queue with its data until a slot frees; evictions are reported (`Renderer.TakeRTMisses`) and the streamer re-sends them, so there is no permanent hole (`RayTracingStats.Overflow` counts them).
  Switching ray tracing on re-sends every resident chunk through an RT-only queue (no re-mesh). After 240 frames with ray tracing off the structure, the pipelines and the half resolution
  images are freed (the storage usage of the HDR target stays). If the setup fails, the engine stops building chunk data.

## Denoising and history

The trace takes one sample per effect per half resolution pixel per frame. The temporal pass reprojects with the unjittered previous matrix, rejects taps by view depth and normal, and
blends with `max(1/count, 0.04)`. The a-trous filter stops at depth planes (linear in the tap offset, voxel normals are axis aligned) and, on the shadow / AO channels, at luminance
edges that are trusted more as the history grows. `Renderer.ResetHistory()`, `app.FrameState.CameraCut`, a resize, a preset change and the automatic detection of the anti-aliasing
stage (24 blocks, 75 degrees, 25 degrees of FOV) drop the history; the GPU test `rt-cut` checks it. The composite applies the same linear transform to the scene copy so the
reactive mask of the temporal anti-aliasing does not light up.

## Radiance cache

The GI of the `full` preset (`render/vulkan/rtgi.go`, `shaders/gi.glsl`, `rt_gi.comp`). A toroidal grid of 128 x 64 x 128 cells of one block follows the camera
by steps of 8 blocks. An air cell keeps, for each axis direction n, the cosine-weighted mean radiance arriving on a face of normal n whose solid block is
the neighbour c - n (a voxel face is lit by the air cell in front of it), as halves (rgb, sample count), plus a tag (its world coordinate) that clears it when
the grid scrolls. 52 MiB.

* Update: every frame `rt_gi.comp` visits every `BURROW_RT_GI_STRIDE`-th cell (default 2, rotating) and traces `BURROW_RT_GI_RAYS` rays (default 2) for each
  visible face, from that face. A face is one of an occluder or of a shaped solid block (`render.RTSurface`: stairs, walls, fences, project models such as
  pillars, which get a material byte without occupancy, so rays pass through them). A hit is lit by the sun (one shadow ray), the particle lights, the point
  lights (below), its emission and the radiance cached in front of the hit face: light bounces once more each frame. A ray that leaves its range sees the
  sky; one that runs out of steps carries no sample (a cave tunnel is not lit by the sky through a step cap). New samples blend with `max(new / count, 0.06)`.
* Point lights: the emitters rays cannot hit (torches, lanterns, glowing plants: `RTBlocks.Light`, at most 64 per chunk in `RTChunk.Lights`) within 16 blocks
  of the grid, the 256 nearest its centre (`giLights`, set 1 binding 7, rewritten when they change). At each hit one is picked in proportion to its unshadowed
  share and tested with a shadow ray (`giLight`); its light follows the propagated block light (per channel the level times the colour, minus one per block,
  through `blockRadiance`), so the bounce of a torch matches the torch light the raster shows. Occluding emitters (lava, glowstone, magma) are hit by rays.
* Shading: the lit voxel shaders read the cache per fragment (bilinear over the valid cells of the layer in front of the face, each weighted by its sample
  count, then every valid direction of the fragment's own cell for plants), faded out over the last 12 blocks of the grid, times `BURROW_RT_GI_GAIN`
  (default 0.75: 1 is physically consistent, but enclosed rooms with light walls came out too bright), and take it as their ambient (`ambientOf`) instead of the hemispheric ambient times the propagated skylight. The propagated block light and the
  direct sun are unchanged. Not per vertex: the mesher merges faces of uniform light and AO into large quads, whose corners carry none of the cache's detail.
* Set 0 binding 2 is the cache (a 64 byte placeholder while it is off; the frames' sets are rewritten after a device wait when it is created or freed); the
  scene UBO floats 680..687 are `giHdr` (live, grid corner) and `giHdr2` (debug, frame, gain).
* With the cache on, the trace pass casts no per-pixel GI ray and the composite applies no GI ratio (`BURROW_RT_GI=screen` restores that path for comparison).
* `BURROW_RT_DEBUG=7`: the cached irradiance alone, normalised to the open sky's ambient (magenta = no data).

Measured (M2 Max, MoltenVK, 1920x1200, ultra, no validation, frame GPU time after 50 s): the plains 13.2 ms without ray tracing, 14.1 with the
per-pixel GI, 16.0 with the cache (two runs within 0.1 ms); a magma cave about 10.8 without ray tracing, 13.6 with the cache (one clean run, the
machine was shared). The update pass is most of it; the per-fragment read about 1 ms. Two things made the update expensive before they were
fixed: the game's 3D leaf blocks counted as surfaces (a face per leaf block of every tree, +7 ms) and every hit walked all the point lights (256 in
the plains: magic herbs, glowing caves below, +4 ms) until they were binned.

## Hardware path

`vulkan.RTBackend` is the traversal interface (`Name`, `TraceModule`, `Setup`, `Close`). `rayQueryRT` (`render/vulkan/rtrq.go`) runs when the device was created
with `VK_KHR_acceleration_structure`, `VK_KHR_ray_query`, `VK_KHR_deferred_host_operations` and the `accelerationStructure`, `rayQuery` and `bufferDeviceAddress`
features (`ctx.makeDevice` enables them whenever the device has them: NVIDIA RTX, AMD RX 6000+, Intel Arc; `BURROW_RT_HW=0` does not). The generated bindings
stop before these extensions: `third_party_vulkan/rt_khr.go` loads the entry points with `vkGetDeviceProcAddr` and `rt_khr_decl.h` carries the declarations
that `vulkan_core.h` disables for the binding generator.

* The voxel structure of the software tracer stays (the shaders read the voxels from it). Added: one BLAS per chunk slot, 64 AABBs in chunk-local space, one per
  8^3 brick, inactive (minX = NaN) where the brick holds no occluder, so the primitive index is the brick bit; one TLAS of an instance per occupied slot
  (custom index = slot, translated to the chunk's corner). Storage: one buffer of `cap` BLAS (fixed size for 64 AABBs), host-visible AABB and instance buffers
  per frame in flight, scratch per frame in flight.
* A chunk upload builds its slot's BLAS in the same frame (at most `rtBudget` per frame, one `vkCmdBuildAccelerationStructuresKHR`); any change of the slots
  rebuilds the TLAS (fast build). Global barriers order the builds against the previous frame's traces and this frame's.
* `rt_trace_rq.comp` and `rt_gi_rq.comp` (SPIR-V 1.4: `SHADERS_RQ` in the Makefile, `--target-env=vulkan1.2`) define `RT_RAYQUERY`: `rtTrace` in `rt.glsl` lets
  the hardware report the bricks a ray crosses and walks the voxels of each one in chunk-local space (`rtBrickHit`), committing the nearest. Same contract as
  the software walk, without its step caps. The TLAS is set 1 binding 6.
* Any failure (sizes, buffers, structures, pipelines) prints one line and leaves the software tracer; it is not tried again until restart.
* **Not run yet on hardware**: MoltenVK exposes none of these extensions. `rtrq_test.go` checks the AABB and instance layouts and that the modules carry the
  RayQueryKHR capability at SPIR-V 1.4. To check on a supporting PC: `BURROW_RT=full` (the log prints `hardware structures` and `hardware (VK_KHR_ray_query)
  tracer`), compare with `BURROW_RT_HW=0`, and `BURROW_VK_VALIDATION=1`.

## Measurements (M2 Max, MoltenVK, 2560x1440, radius 12, `-shaders high -aa taa`, no validation, GPU ms of the RT passes, one consistent run after the a-trous filter became 3x3)

| mode | trace | temporal | a-trous | composite | RT total | effect on the rest of the frame |
|---|---|---|---|---|---|---|
| sun shadows | 0.77 | 0.24 | 1.74 | 0.59 | 3.3 | shadow map pass 0.5 -> 0.03 |
| AO only | 0.22 | 0.18 | 1.84 | 0.57 | 2.8 | screen space AO passes (1.5) skipped |
| GI only | 2.69 | 0.36 | 1.94 | 0.65 | 5.6 | |
| reflections only | 0.48 | 0.29 | 1.92 | 0.54 | 3.2 | |
| `shadows` (sun + AO) | 0.61 | 0.31 | 1.85 | 0.60 | 3.4 | shadow map -0.5, AO passes -1.5 |
| `full` | 3.00 | 0.70 | 3.05 | 0.93 | 7.7 | |

Whole frame (GPU total, ms): off 18.6, `shadows` 19.4, `full` 23.4 (the machine is shared; runs repeat to about 1 ms). Memory: about 100 MiB of half resolution images at 1440p plus the
structure (140 MiB at 3584 slots).

Idle machine, `-gen v2 -shaders high` (preset `shadows`, spawn view, 2560x1440, native TAA): trace 0.48, temporal 0.34, a-trous 0.49, composite 0.55, RT total 1.9 ms of a 7.5 ms frame.
The tables above were taken while the GPU was shared with other jobs and read about 3-5x higher; the a-trous pass is already below 1 ms when the GPU is idle, so it was left as is.
At 75% render scale the RT passes cost 0.53 / 0.19 / 0.28 / 0.28 (1.3 ms).

## Tests

`render` (`rt_test.go`): parsing, presets, `RTChunk` bits, material classes; `engine`: `TestBuildRTChunk`; `render/vulkan` (`make render-test`, validation on): every effect changes the
frame, the denoised static scene is stable, `ResetHistory` drops the history, an edit of the structure shows, switching off restores the classic frame, a teleport runs clean, a
glossy floor reflects the tower (`rt-gloss`), a structure with two slots keeps the nearest chunk and reports the others (`rt-capacity`); `vulkan` unit tests: the table never aliases a loaded
region, the shadow map plan; `engine`: the RT-only rebuild re-meshes nothing and re-sends a dropped chunk; `render`: the material table never maps a block to air.

## Limits

* Block light: emitters bounce light through the GI ray with their emission colour; the propagated block light and skylight (docs/lighting.md) are baked into the raster shading and are not traced.

* Glass, plants, shaped blocks (stairs, fences) do not occlude; dynamic voxel bodies and scene meshes are not in the structure.
* Surface normals come from the depth buffer checked against the voxels (axis aligned): smooth water and non-cube meshes get an up / depth normal; water waves in the reflection are a
  small analytic ripple, not the water shader's waves.
* GI is one bounce with the hemispheric ambient at the hit and one sun shadow ray; it is applied as a ratio to the flat ambient of the lit shader, so it adds occlusion and colour bleeding,
  not new energy. Effects fade with the aerial perspective and the far fog.
* By design: unloaded chunks and chunks beyond the structure are empty space (rays leave the loaded world; light can enter through unstreamed terrain). Rays have step caps (shadow 96 steps /
  160 blocks, AO 24 steps / 2.5 blocks, GI 64 / 64 blocks, reflection 128 / 160 blocks, hit shadow rays 40-48 steps): a longer path counts as a miss.
* Fine (sloped) water is not in the structure (the water-only re-mesh does not rebuild it): only whole water blocks mark the surface for reflections. The composite applies the water
  surface's reflection weight to the already refracted colour behind it, so the water tint of a reflective pixel is replaced together with the base reflection.
* The composite never writes a NaN / Inf into the HDR frame (it skips the pixel), so the TAA / FSR 2 history cannot be poisoned.
* The hardware path has not run on a device yet (see Hardware path).
