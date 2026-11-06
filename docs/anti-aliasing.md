# Anti-aliasing and temporal upscaling

Render-only (frame domain): nothing here touches the simulation or `StateHash`. It applies to the HDR shader levels (`-shaders low|medium|high|ultra`) of the
Vulkan renderer; `-shaders off`, `-look classic` and the soft CPU renderer keep the aliased reference (the soft renderer ignores every setting below).
Foundation for the planned ray-tracing stage: jitter, a velocity buffer, a reactive mask and a history already exist.

## Settings

| flag (env) | values | default |
|---|---|---|
| `-aa` (`BURROW_AA`) | `off`, `fxaa`, `smaa` (SMAA 1x), `taa` | the shader level: low fxaa, medium smaa, high and ultra taa (native resolution), off none |
| `-upscale` (`BURROW_UPSCALE`) | `off` (bilinear stretch), `fsr1`, `fsr2`, `dlss`, `xess` | `off`; below 100% `-render-scale`: `fsr1` at medium and high, `fsr2` at ultra (`-upscale fsr2` asks for it at any level) |
| `-render-scale` (`BURROW_RENDER_SCALE`) | `native`, `quality` (67%), `balanced` (59%), `performance` (50%), `0.5..1` or `50..100` | `native` |

Flags exist on `examples/voxel_sandbox` and `burrowplay`; `burrowedit -aa off|fxaa|smaa` sets the viewport. The project file (`vox.project`, `runtime`)
takes `aa`, `upscale` and `render_scale` (validated; the flags win). Live: `engine.RenderSettings` has the string fields `AA`, `Upscale`,
`RenderScale`; the render system re-resolves them every frame and calls `vulkan.Renderer.SetAntiAliasing`, so Go plugins and the editor can change them at run
time. The wasm scripts (ABI v1) are simulation-domain and deliberately get no render setting. Editor: the viewport menu lists
"Anti-aliasing: off / fxaa / smaa", the agent tool `editor_viewport_screenshot` takes an `aa` argument. The editor viewport is an offscreen target that is rendered
on demand, so temporal modes and scaling stay game-only there (default off keeps editor screenshots unchanged).

Combinations are normalised (`render.AASettings.Effective`): an upscaler replaces the AA mode (`fsr2` is itself the AA, `fsr1` runs on the finished image),
a scale below 100% with `-upscale off` and fxaa/smaa becomes fsr1, `taa` with a scale is a temporal upsample (history at display resolution). A missing
device feature falls back to the built-in TAA (stderr says so); `dlss`/`xess` do the same, see below.

## Frame layout

```text
main pass (render resolution, projection jittered by Halton(2,3)) -> aa-velocity (+ object velocity)
  -> (upscaling) bloom / exposure / DoF + motion blur at the RENDER resolution, DoF result feeds the HDR stage
  -> HDR stage: taa | fsr2 | stub        (render -> display resolution, before the tone mapping; fsr2 sanitises NaN / Inf first)
  -> (native temporal) bloom / exposure / DoF + motion blur at the display resolution
  -> composite (display resolution; samples the bloom bilinearly)
  -> LDR stage on the display-encoded image: fxaa | smaa | easu(fsr1) | bilinear, then rcas sharpening
  -> HUD and canvas at native resolution, over the result
```

Without anything to do after the composite the composite writes the swapchain directly (as before); otherwise it writes `ldr` (RGBA8 UNORM, display encoded) and the
LDR stage writes the swapchain. GPU timestamps: `aa-velocity`, `taa`, `fsr2-*`, `fxaa`, `smaa-edges/weights/blend`, `easu`, `rcas`, `upscale-blit`, `hud`.

## Velocity and jitter

* The projection of the scene UBO (`S.vp`) is jittered by `render.Jitter` (Halton 2,3, `8*(display/render)^2` phases like FSR 2); `S.vpU` is the unjittered matrix,
  `S.prevVP` the previous unjittered one, `S.invVPJ` the inverse of the jittered one. Every pipeline that reads `S.vp` (terrain, water, glass, rain, scene meshes, sprites) is jittered for free.
* `post_vel.frag` writes, per render pixel, `rg = previous uv - current uv` of the unjittered surface point (world position from the depth buffer and `invVPJ`, projected with
  `vpU` and `prevVP`): exact for static geometry, whatever the camera does. CPU twin and unit test: `render.VelocityUV`, `TestVelocityReprojectionStaticScene` (error 0.018 px, float32 depth).
  `a` holds the view depth in the previous camera (disocclusion test), `b` the reactive mask.
* Moving scene meshes (hybrid frames, `rworld.Draw.Entity`): `shaders/vel_mesh.vert` draws each opaque mesh with its current and its previous model matrix (remembered per entity)
  into `velocity-objects`, depth tested against the main pass; the velocity pass prefers it. Masked and custom-shader materials keep the camera velocity.
  `Renderer.RegisterVelocityPass` is the hook for other draw paths (the dynamic voxel bodies of `dynvox.go`: TODO, register a function that draws them with the
  `vel_mesh` contract).
* Animated vertices: wind sway (at most 7 cm) and water waves are not in the velocity (their amplitude is below the variance clip); water, glass and rain/snow are
  flagged reactive instead. The reactive mask is the colour difference between the scene copy (taken before the water, glass and rain) and the final HDR image, so the
  copy is also taken for glass and precipitation when the frame is temporal. Water without a scene copy (nothing transparent in view) needs none.
* Mip LOD bias of upscaled rendering: `render.MipLODBias` = log2(render/display) - 1 (temporal) or log2(render/display) (spatial) on the block textures and scene meshes.

## Robustness

* **Camera cuts.** A teleport, respawn or scene load must not blend with the old view: `Renderer.ResetHistory()`, `app.FrameState.CameraCut` and an automatic detection (translation above 24 blocks, yaw or pitch above 75 degrees, FOV above 25 degrees between two frames) drop the history for that frame (TAA ignores it, FSR 2 clears its images). Unit test `TestAACameraCutDetection`, GPU check `aa-cut` (`ResetHistory` really drops a converged history). The editor viewport has no history (offscreen, non-temporal), so its camera jumps need no hook.
* **Failures.** A configuration whose setup fails (injected in the GPU test with `fsr2TestFail`) is not retried every frame: the post state is rebuilt native, or the HDR stage falls back to the built-in TAA for any FSR 2 / DLSS / XeSS setup error (also a device without subgroup quad operations or storage image formats). `AntiAliasingActive()` and `AntiAliasingStage()` report what really runs; the warning is printed once per reason.
* **NaN / Inf.** `post_taa.frag` tests bit patterns (comparisons and `max` are undefined on NaN in SPIR-V) on the current samples, the history, the velocity and the stored depth; FSR 2 gets its colour through `post_sanitize.frag`.
* **Captures.** `Renderer.Screenshot()` re-renders with the jitter of the frame just drawn and does not advance the sequence, so a golden never depends on how many screenshots were taken before it.
* **Tiny render sizes.** The FSR 2 luminance pyramid image is at least 64 px (mips 4 and 5 exist) and its mip dimensions are clamped to 1; checked by the `aa-tiny` GPU test at 72x48.

## Modes

* **FXAA**: an original FXAA-style filter (contrast gate, edge walk, shift across the edge) on the tone mapped image. 0.13 ms at 1280x720 (idle), 0.9 ms at 2560x1440 in the shared run below.
* **SMAA 1x**: the reference implementation (edges, weights, blend; `HIGH` preset, area and search tables embedded) on the tone mapped image.
* **TAA** (`post_taa.frag`): Gaussian reconstruction of the 3x3 jittered samples (narrow at native, wide when upsampling), velocity of the closest sample, Catmull-Rom history,
  variance clipping in YCoCg (mean +- 1.25 sigma, inside the min/max box, clipped along the ray to the mean), Karis weighting `c/(1+max c)`, rejection by disocclusion (history view depth vs the
  reprojected depth), screen exit and the reactive mask, feedback 0.9. Sharpening is RCAS (strength 0.25 by default) after the tone mapping.
* **FSR 1**: EASU then RCAS from the official `ffx_fsr1.h`, on the finished image, so the whole post chain runs at the render resolution.
* **FSR 2**: AMD's official compute passes (`shaders/third_party/fsr2`, MIT, unmodified except two storage format qualifiers) driven by `render/vulkan/fsr2.go`, a Go port of the host side of
  `ffx_fsr2.cpp` (resources, constants, dispatch order, Lanczos and maximum-bias tables). It needs `shaderStorageImageExtendedFormats` and write-without-format (enabled when present)
  and subgroup quad operations. Its RCAS and auto-reactive passes are not used (Burrow's RCAS and velocity-pass mask replace them). Quality presets: quality 67%, balanced 59%, performance 50%.
* **MSAA**: not offered. The HDR frame is RGBA16F with depth read by the AO, scene copy, sun shaft and velocity passes: multisampled targets would need resolves of colour and depth and a second copy
  of every post input, cost 4x the bandwidth of the opaque pass, and do nothing for the cutout leaves or the shader aliasing (specular, water) that dominate this renderer.

## `Upscaler` interface (DLSS, XeSS)

`vulkan.Upscaler` (`render/vulkan/aa.go`): `Name`, `Temporal`, `Stage` (HDR before the tone mapping, or LDR after), `Setup(r, postState)`, `Record(*UpscaleInputs)`, `Close`. A temporal HDR stage gets
the jittered HDR colour, depth, velocity (uv, previous minus current), reactive mask, the jitter and frame index, a reset flag and writes `Out` at the display resolution; it adds its passes
to the render graph (`rgRes.storage` marks compute written images). `taa` and `fsr2` implement it; `-upscale dlss|xess` select `unavailableUpscaler`, whose `Setup` fails with
`ErrUpscalerUnavailable` so the renderer falls back to the built-in TAA. **DLSS needs NVIDIA's NGX / Streamline SDK under NVIDIA's licence: it is not downloadable by this project and was not fetched.** A backend
wraps it (and XeSS) behind this interface once the SDK is obtained from the vendor. Untested on NVIDIA, AMD, Intel and Windows hardware.

## Tests

* `render` (no GPU): jitter sequence (range, centring, period, FSR 2 phase counts), `JitterProjection`, `InvertMat4`, velocity reprojection of a static scene under camera motion and jitter, mip bias,
  render-scale / `-aa` / `-upscale` parsing, preset mapping, combination rules; `assets/project` (runtime fields), `engine` (live settings).
* `render/vulkan`: SPIR-V binding reflection of the FSR 2 passes, embedded tables; `make render-test` (GPU, validation on) renders a voxel scene with every mode and checks golden-ish
  thresholds (the mode changes the frame, stays within a mean abs difference of the native frame: fxaa/smaa/taa < 6, upscaled < 14-18; static scenes converge: TAA/FSR 2 change < 0.6 between frames; switching back
  restores the native frame exactly) with zero validation messages.

## Measurements (M2 Max, MoltenVK, 2560x1440, radius 12, no validation, `-cam 0,58,100,0,8`, GPU ms)

The machine was shared with other builds and GPU jobs during the run (the native baseline measured 12.4-14.3 ms against 5.4 ms idle in
[rendering.md](rendering.md#shader-levels-stage-s1)): compare rows with each other, not with older tables. Runs are repeatable to about 1 ms.

| medium | main | post | total | notes |
|---|---|---|---|---|
| off (`-aa off`) | 6.1-7.3 | 5.6 | 12.4-14.3 | |
| fxaa | 7.7 | 6.6 | 15.4 | fxaa 0.88, hud 0.40 |
| smaa | 6.7 | 10.4 | 18.4 | edges 0.73, weights 1.59, blend 1.15, hud 1.04 |
| taa | 6.2-6.6 | 9.7 | 17.5-18.4 | velocity 0.87, taa 1.64, rcas 0.76, hud 0.55 |
| fsr1 quality | 5.0 | 8.4 | 14.7 | easu 1.25, rcas 0.80 |
| fsr2 native | 6.4 | 19.2 | 26.4 | |
| fsr2 quality | 4.3-4.8 | 17.6 | 22.5-22.9 | velocity 1.15, reactive 0.41, luma 0.33, reconstruct 0.57, depth clip 1.34, lock 0.65, accumulate 2.59, bloom at display res |
| fsr2 performance | 3.8 | 15.7 | 20.6 | accumulate 2.57 |

| ultra | main | post | total |
|---|---|---|---|
| off | 14.5 | 6.1 | 21.4 |
| taa | 14.8 | 11.2 | 26.7 |
| fsr2 native | 14.9 | 18.2 | 33.8 |
| fsr2 quality | 9.1 | 16.3 | 26.2 |
| fsr2 performance | 7.5 | 16.4 | 24.7 |

FPS is 1000/total (GPU bound). When upscaling, bloom, exposure and DoF / motion blur now run at the render resolution before the upscale (re-measured, medium, same shared machine,
GPU ms; main / post / total): off 6.0 / 6.5 / 13.4, taa 6.5 / 9.4 / 16.8, fsr2 quality 4.0 / 15.2 / 20.0 (was 22.5-22.9), fsr2 performance 3.5 / 14.2 / 18.5 (was 20.6). The upscale saves the main pass (ultra:
14.5 to 9.1 / 7.5 ms, sky and clouds dominate) but FSR 2 itself costs about 6-7 ms at 2560x1440 here (accumulate 2.4-2.5, depth clip 0.7-1.1, lock 0.3-0.6, reactive + sanitize 0.8, velocity 1.0), more than
the main pass saves at medium; FSR 1 and the bilinear stretch are the cheap upscalers on this GPU, FSR 2 pays off where the main pass is expensive (ultra, clouds, heavy water) and on GPUs whose compute throughput is higher
(untested).

### Default upscaler below 100% (re-measured, idle machine, `-gen v2 -shaders high -retina -novsync`, spawn view, 2560x1440, GPU ms)

The 22.5 ms figures above were taken on a loaded GPU (other jobs running): on an idle M2 Max the same scene takes 7.5 ms native. Relative costs hold.

| config | main | post | total | notes |
|---|---|---|---|---|
| native (taa) | 4.0 | 3.5 | 7.5 | velocity 0.23, taa 0.85, rcas 0.11 |
| 75% fsr1 (new default) | 3.4 | 2.3 | 5.7 | easu 0.47, rcas 0.15, no velocity / history |
| 75% fsr2 (`-upscale fsr2`) | 2.5 | 4.1 | 6.6 | accumulate 1.48, depth clip 0.45, reconstruct 0.15, luma 0.07, lock 0.09, reactive + sanitize 0.08 |
| 50% fsr1 | 3.0 | 2.1 | 5.2 | easu 0.68 |
| 50% fsr2 | 1.7 | 3.5 | 5.3 | accumulate 1.87 |

FSR 2 at 75% saves 1.5 ms of main pass and spends 0.6 ms more in post: it only barely beats native at medium and high, so FSR 1 is now the default there (always faster than native);
FSR 2 stays the default at ultra, where the main pass is heavy. Trade-off: FSR 1 is spatial, so there is no temporal supersampling, and the preset's TAA is not stacked on it (as before for
fxaa / smaa at a sub-native scale). Mean abs diff against native on the capture: fsr1 3.2, fsr2 2.8 (0..255), both visually close on foliage and clouds.

## Captures

![static: off, taa, fxaa, smaa](img/aa-static-off-taa-fxaa-smaa.png)
![moving camera: off, taa, smaa / fsr2 quality, fsr2 performance, taa](img/aa-motion-off-taa-smaa-fsr2q-fsr2p.png)
![waterfall (-fluid fine -demo waterfall): off, taa, fsr2 quality, taa](img/aa-waterfall-off-taa-fsr2q.png)

Scripts: `examples/voxel_sandbox/testdata/aa_motion.json` (camera strafing then turning, a shot after every step) with `-script`. In the sequences no ghost trail follows the foliage, the shoreline or the
water curtain; the cost of the temporal modes is a slight softening of fine texture in motion (RCAS 0.25 compensates), and at 50% a visible thinning of leaf cut-outs.

## Limits

* Hybrid frames (scene components) are native resolution only; every AA mode works there.
* Cloud drift and rain streaks are not in the velocity (clouds are low contrast; rain is flagged reactive).
* The sun glint and SSR of the water are reactive too, so water is less anti-aliased than terrain.
* FSR 2 untested on AMD, NVIDIA, Intel, Windows; Metal (Apple Silicon) only.
