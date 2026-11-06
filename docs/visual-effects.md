# Frame visuals

Effects that must follow the screen rate, not the 20 Hz simulation: a weapon that lags behind a turn, a light that pulses, a field of view that widens when running, a crosshair that opens while moving.

## Two layers

| layer | runs | in the `StateHash` | replayed | on a dedicated server |
|---|---|---|---|---|
| **Frame visuals** (this page) | every frame, at the screen rate | no | no | no |
| **Simulation** (scripts, physics, animation clips) | 20 times a second | yes | yes | yes |

A frame visual only changes what is drawn. Scripts, physics and the hash never see it. **A value drawn on screen never flows back into the simulation.** When gameplay needs the same behaviour (a recoil that moves the aim, a hit zone that follows a swinging arm), compute it in the simulation with the same formula and read that value.

Moved nodes are already interpolated between ticks ([execution model](scripting/02-execution-model.md#20-hz-scripts-and-smooth-visuals)). The components below add what interpolation cannot: springs, mouse reaction and animated values.

## Turning them on

Registering a component changes the `StateHash`, so the three components exist only when the project asks for them: set `runtime.plugins.visual` to `true` (`burrow config set runtime.plugins.visual true`), or use one in a scene or prefab (the project is scanned once, like the audio components). Projects that do not use them keep their hashes. The editor always offers them.

## Components

All three are normal components: saved in the scene, shown by the inspector, editable by the editor agent (`editor_set_component`), undoable. They are ignored while editing with the free editor camera.

### `visual.spring`

The drawn node follows its real position through a damped spring: it lags behind a move and settles with a little overshoot. Children and parts follow.

| field | default | meaning |
|---|---|---|
| `stiffness` | 120 | spring constant k, higher is tighter |
| `damping` | 0.6 | damping ratio, 1 is critical (no overshoot), below 1 bounces |

A jump of more than 8 blocks is a teleport: no glide.

### `visual.sway`

A held node (one with `render.viewattach`) reacts to the mouse and to walking: it lags behind a turn, tilts into it and bobs while the player moves. On a node that is not held it offsets the node in the world.

| field | meaning |
|---|---|
| `look_pos` | blocks of lag per mouse pixel |
| `look_rot` | degrees of tilt per mouse pixel |
| `bob`, `bob_hz` | walking bob amplitude (blocks at 4 blocks/s) and frequency |
| `max` | largest offset in blocks (0 = 0.15) |
| `stiffness`, `damping` | the spring, as above |

Mouse values are in pixels per 60 fps frame, whatever the real frame rate.

A held node is sized by `render.viewattach.scale`, not by its own transform scale: a unit cube with `scale` 0 is one block big, 0.6 blocks in front of the camera, and fills the screen.

```json
"render.viewattach": {"offset": [0.3, -0.25, -0.5]},
"visual.sway": {"look_pos": 0.004, "look_rot": 0.15, "bob": 0.015}
```

### `visual.bind`

Drives values from expressions evaluated every frame.

```json
"visual.bind": {"binds": [
  {"target": "light.intensity", "expr": "6 + 2*sin(time*5)", "mode": "set"},
  {"target": "camera.fov",      "expr": "clamp(speed-4, 0, 4)*2"},
  {"target": "ui.crosshair",    "expr": "0.2 + speed*0.05", "mode": "set"}
]}
```

| target | drives |
|---|---|
| `pos.x` `pos.y` `pos.z` | position offset of the node, in blocks (camera space for a held node) |
| `rot.x` `rot.y` `rot.z` | rotation offset in degrees, around the node |
| `scale` | size factor (add: 1 + value) |
| `light.intensity`, `light.r` `light.g` `light.b` | the node's point light |
| `material.p0` .. `material.p3` | the first shader parameters of the node's mesh |
| `camera.fov` | field of view of the active camera, degrees |
| `ui.<key>` | a game UI number (`game.ui`, key as in the UI file) |

`mode`: `add` (default) adds to the value, `set` replaces it. At most 16 bindings per node.

Variables: `time`, `dt`, `alpha`, `mouse_dx`, `mouse_dy`, `speed` (horizontal blocks/s of the node, measured between ticks), `vy`, `pos_x`, `pos_y`, `pos_z`, `yaw`, `pitch`.
Operators: `+ - * / % ^`, comparisons, `a ? b : c`. Functions: `abs sin cos tan sqrt min max clamp lerp smooth floor ceil sign pow mix saturate pulse`, constant `pi`. An expression cannot loop or allocate, is at most 512 bytes and 32 levels deep, and a non-finite result is 0. A wrong expression or target is refused when the component is set.

## The same formula in the simulation

`burrowsdk.Spring` is the renderer's spring stepped once per tick. It is plain data, lives in the script `State`, is hashed and replayed:

```text
// recoil that moves the aim: the simulation owns the value
var recoil burrowsdk.Spring
// on fire:      recoil.Kick(6)
// every tick:   recoil.Step(0, 90, 0.4)  // k = 90, damping ratio 0.4
// aim:          pitch := basePitch + recoil.X
```

The frame layer draws a smoother version of the same motion (a `visual.sway` or `visual.bind` on the weapon). They agree in shape, not sample for sample: gameplay reads `recoil.X`, never the drawn value.

A hit zone that follows an animated arm needs nothing new: animation clips run in the simulation, so a trigger node under the arm sits where the arm is at the tick, and the drawing interpolates it.

## Free code every frame

For what the components cannot express, a script can export `OnFrame` ([frame scripts](scripting/14-frame-scripts.md)). It runs every frame, can only write the same targets (`VisualSet`, `VisualAdd`), cannot read or write simulation state and never runs on a server.

## Limits

* Springs and bindings act on the node they sit on and its children, not on other nodes.
* `visual.bind` reads the node's own measured speed, not another node's.
* Frame visuals do not run on a dedicated server, in a replay check or with the editor's free camera.
