# Ray tracing

Render-only (frame domain): nothing here touches the simulation or `StateHash`. It applies to the HDR shader levels of the Vulkan renderer; `-shaders off`, `-look classic`,
the soft CPU renderer and offscreen editor targets ignore it. The tracer is software: a hierarchical voxel DDA in compute shaders, so it runs on MoltenVK. No hardware ray
tracing is required (see [Hardware path](#hardware-path-stub)).

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
* Incremental: the mesh workers (`engine/rtvoxels.go`) distil every meshed chunk; an edit re-meshes the chunk and uploads only its data. A cache keyed by chunk pointer and
  `Version` avoids rebuilding the neighbours that are re-meshed next to an edit. At most 48 chunks per frame go through a per-frame staging buffer; the copies are ordered against the
  compute passes by memory barriers. Removal frees the slot and clears the table entry. Capacity: `5 x columns` slots from the renderer's far plane (512..3584, 40 KiB each). When it is full the nearest chunks to the camera win: a farther resident chunk is evicted, or the new
  one waits in the queue with its data until a slot frees; evictions are reported (`Renderer.TakeRTMisses`) and the streamer re-sends them, so there is no permanent hole (`RayTracingStats.Overflow` counts them).
  Switching ray tracing on re-sends every resident chunk through an RT-only queue (no re-mesh). After 240 frames with ray tracing off the structure, the pipelines and the half resolution
  images are freed (the storage usage of the HDR target stays). If the setup fails, the engine stops building chunk data.

## Denoising and history

The trace takes one sample per effect per half resolution pixel per frame. The temporal pass reprojects with the unjittered previous matrix, rejects taps by view depth and normal, and
blends with `max(1/count, 0.04)`. The a-trous filter stops at depth planes (linear in the tap offset, voxel normals are axis aligned) and, on the shadow / AO channels, at luminance
edges that are trusted more as the history grows. `Renderer.ResetHistory()`, `app.FrameState.CameraCut`, a resize, a preset change and the automatic detection of the anti-aliasing
stage (24 blocks, 75 degrees, 25 degrees of FOV) drop the history; the GPU test `rt-cut` checks it. The composite applies the same linear transform to the scene copy so the
reactive mask of the temporal anti-aliasing does not light up.

## Hardware path (stub)

`vulkan.RTBackend` is the traversal interface (`Name`, `TraceModule`, `Setup`, `Close`). `softwareRT` is the only working backend. `rayQueryRT` is selected by a capability check
(`VK_KHR_ray_query`, `VK_KHR_acceleration_structure`, `VK_KHR_deferred_host_operations` on the device) but its `Setup` returns `ErrRTUnavailable` and the renderer prints one line and keeps the
software tracer. It cannot be tested on MoltenVK, so it is not implemented: a real backend builds BLAS / TLAS from the chunk data and ships an `rt_trace_rq.comp` using `rayQueryEXT`.

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
* Untested on AMD, NVIDIA, Intel and Windows; the hardware path is untested everywhere.
