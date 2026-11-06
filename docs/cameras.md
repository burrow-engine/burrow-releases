# Cameras

Burrow's camera system is **frame domain**: a rig reads simulation state (the player or a node) and produces the view, so it can never
change a `StateHash`. Packages: `camera` (rigs, behaviours, shake, blends; no engine dependency), `camera/camplug` (the engine plugin) and,
for drawing, the orthographic projection in `scene.Camera`, `render/soft` and `render/vulkan`.

## Quick start

Enable it in `vox.project` and declare rigs (rigs can also be `camera_rig` scene components, which enables the plugin by itself):

```json
{ "runtime": { "plugins": { "camera": true },
    "camera": { "start": "fps", "seed": 7, "rigs": [
      { "name": "fps",   "kind": "first_person" },
      { "name": "third", "kind": "third_person", "distance": 6, "collide": true, "smooth": 0.06 },
      { "name": "iso",   "kind": "isometric", "ortho_size": 9, "smooth": 0.15, "look_ahead": 2 },
      { "name": "side",  "kind": "side_scroller", "axis": "z", "plane": 0, "dead_zone": [2, 1] } ] } } }
```

In code (`examples/camera_ui_demo` is the full program, `go run ./examples/camera_ui_demo`, keys C / I / P / K / L):

```go nocheck
a.AddPlugin(&camplug.Plugin{Rigs: rigs, Start: "third", Seed: 7})
// frame code
cm := camplug.Res(c)
cm.Ctl.Switch("iso", 0.6)   // blend over 0.6 s (a switch between perspective and orthographic cuts)
cm.Ctl.AddTrauma(0.7)       // shake
```

Registering the `camera_rig` component changes `StateHash` (the registry is hashed). The plugin is off by default (`runtime.plugins.camera: true`
enables it; `false` together with a scene that uses the component is a build error). Without a rig configured the plugin stays passive and
does not drive the camera at all.

## Rig kinds

| kind | view | notes |
|---|---|---|
| `first_person` | at the target's eye (`offset`, default y 1.6), looks where the target looks | |
| `third_person` | orbits the focus at `distance` along the target's look angles | `collide`: five rays (centre + 0.25 block in the screen plane) are marched through the voxels, the camera is pulled in to the nearest hit (`min_distance`, default 0.4) at once and eases out in about 0.15 s; an eye inside a block does not collapse the camera |
| `top_down` | `pitch` -89 (default) above the focus, `distance` 24, `yaw` free | perspective, or orthographic with `ortho_size` |
| `isometric` | yaw 45, pitch -35.264, orthographic (`ortho_size` default 10), `distance` 64 | the camera stands back along the view axis |
| `side_scroller` | 2.5D: `axis` z (camera on +Z looks -Z) or x, the focus sits on the constant `plane` of that axis | `distance` 20; perspective or `ortho_size` |
| `free` | detached fly camera: `Input.Move` (right, up, forward) at `speed` blocks/s, `Input.LookYaw/LookPitch` | the plugin keeps the movement keys and the mouse away from the player controller while it is active |
| `fixed` | static at `pos`; `aim`: empty (`yaw`/`pitch`), `point` (`look_at`) or `target` | cinematic shots |

A zero number means the default of the kind; every number is clamped by `Rig.Sanitized`, and `Rig.Validate` rejects unknown kinds, NaN and
huge values. At most 32 rigs, names up to 64 bytes.

## Behaviours

* **Follow with smoothing** (`smooth`, seconds): exponential, frame-rate independent (`1 - exp(-dt/smooth)`).
* **Near plane** (`near`, blocks, 0 = 0.1, at most 16): raise it so a third person camera that grazes a wall does not show its inside; in the Cameras tool it is the *Near* row of Lens.
* **Dead zone** (`dead_zone` [right, up], blocks): the target moves freely inside a window in the screen plane; the focus only follows the excess.
* **Look-ahead** (`look_ahead`, blocks): the focus leads along the horizontal velocity, eased over about 0.35 s.
* **Bounds** (`use_bounds`, `bounds` min xyz / max xyz): the final camera position is clamped.
* **Shake** (`AddTrauma`, request `shake`): trauma 0..1 decays at `shake_decay` per second; the amplitude is trauma squared times `shake_angle` degrees
  and `shake_offset` blocks, from smooth value noise at `shake_freq` Hz seeded with `Controller.Seed` (the same seed and inputs shake identically).
* **Blends** (`Switch(name, seconds)`): position, yaw (shortest way), pitch and FOV are interpolated with a smoothstep from the pose the previous
  rig had; the new rig's smoothing state starts fresh. Perspective and orthographic poses cannot be interpolated, so such a switch is a cut.
* **Cuts**: a zero-second switch, a projection change, a target that jumps more than 32 blocks in a frame (teleport) and `Controller.Cut()` set
  `Output.Cut`; the plugin copies it to `app.FrameState.CameraCut` and the render plugin calls `Renderer.ResetHistory()`, so TAA, FSR 2 and the ray
  tracing denoiser start a clean history. The renderer also detects large jumps and projection changes on its own.

## What the plugin does each frame

`camera.input` (Update, before the controller) keeps movement away from the player while a free rig is active; `camera.update` (PostUpdate)
reads the target (the rig's `target` node, else the `app.Controller` player; the velocity is smoothed from position differences), applies queued
requests, updates the rig and writes the pose into `app.FrameState` (position, yaw, pitch, FOV, `Ortho`, `CameraCut`). For the fixed-angle rigs
(top-down, isometric, side scroller) the player's look yaw is aligned with the rig so WASD means screen directions. The voxel world, the scene
meshes (hybrid frame) and the world-space UI labels all follow `FrameState`. Cost per frame is O(1) plus at most five voxel rays of `3 * distance`
cell steps.

## Orthographic projection

`scene.Camera.Ortho > 0` (half the visible height in blocks) and `app.FrameState.Ortho` select an orthographic camera everywhere:

* `render/soft`: parallel rays from points of the image plane (`Camera.Origin64`); `Camera.Project` and `ViewProj` are orthographic too.
* `render/vulkan`: `Camera.ViewProj` builds the orthographic matrix (the voxel world, the scene meshes and shadows follow it); the hybrid scene camera
  carries the `ortho` projection. The sky is a flat gradient behind an orthographic view (every sky ray is the view direction).
* Limits: depth-based screen-space effects of the HDR levels (AO, FSR 2 depth clip, the ray tracing G-buffer) assume a perspective matrix, so use the
  classic pipeline (`-shaders off`) or accept slightly off AO/RT on isometric views; fog is computed from the distance to the camera position.

## Scripts and SDK

Scripts (module `vox`, ABI additive, see `script/ABI.md`) queue frame-domain requests with `camera_cmd`, delivered with `engine.SendFixed` after
the tick (ignored without the plugin, dropped during a replay verify):

```go nocheck
burrowsdk.CameraSwitch("iso", 0.5) // rig name from camera_rig / runtime.camera
burrowsdk.CameraShake(0.6)
burrowsdk.CameraCut()
```

From a fixed system use `camplug.Emit(fixedCtx, camera.Request{Op: camera.OpSwitch, Rig: "top", Blend: 0.4})`.

## Editor and agents

* The inspector shows the `camera_rig` fields (every field has a tip and a range). Tools > Cameras is a full-screen tool: the rigs of the scene as
  cards (the active one badged, `+ New rig` adds a node with a `camera_rig`), the world seen *through* the selected rig (drawn by the GPU at the panel's resolution, a CPU image only in headless runs, following the
  editor camera focus, with rule-of-thirds guides and the dead zone drawn) or *from outside* with the rig and its view pyramid drawn in the world,
  Switch to rig (with the blend slider) and Test shake. Camera settings holds the rig (kind, target, distance, height), the lens (field of view,
  dead zone, smoothing) and the shake (amplitude, frequency, decay). Every edit is one undo step on the rig's component.
* MCP tool `editor_camera`: without `action` it moves the editor camera as before; `rigs` (rigs, active, pose, trauma), `validate {rig}`,
  `switch {name, blend}`, `shake {amount}`, `cut`, `preview {rig | name, target, look, width, height}` (a CPU render from the rig's pose as an image).

## Fixed rig in a menu scene

A title-screen background uses a `fixed` camera rig plus `scene.settings` with `"controller": false`: the first-person controller, hotbar and
break/place are off **for that scene only** (the project keeps `runtime.plugins.controller`), so the rig drives the camera and the real game scene is
unaffected. See [lighting.md](lighting.md#scene-settings-controller-and-hud).

## Voxel size

Rig lengths (`offset`, `distance`, `min_distance`, `near`, `ortho_size`, `dead_zone`, `look_ahead`, `bounds`, `pos`, `look_at`, `plane`, `speed`,
`shake_offset`, the defaults such as the 1.62 m eye and the 4.5 m third-person distance, and the collision margins) are metres. `camplug` tells the
controller the world's voxels per metre (`Controller.SetSubdiv`) and the rig works in voxels, so it frames the player the same way at every voxel
size. `Controller.Rigs()` and the `camera_rig` component keep the authored metres. At one metre voxels nothing changes.

## Budgets and robustness

Rigs are clamped, never trusted: at most 32 rigs, names 64 bytes, distances 256, ortho size 1024, coordinates 1e7; NaN and infinities become
defaults or are rejected; `dt` is clamped to 0.25 s; requests per frame 64 (the rest are dropped and counted in `editor_camera rigs`).

## Limits

* One active rig; during a blend only the new rig is updated (the old pose is a snapshot).
* The side scroller locks the camera, not the player: movement along the locked axis is a game rule (constrain it with physics or a script).
* No camera roll, no spline paths, no multiple viewports; third-person collision samples voxels only (no scene colliders).
