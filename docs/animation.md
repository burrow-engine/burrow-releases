# Animation

Package `anim` is a generic animation system for any voxel game: keyframe tracks on any component property of the scene schema,
clips, a player with queue / speed / loop / ping-pong / events, crossfade, layers (masked, additive), a state machine, tweens,
skeletons of rigid voxel parts imported from MagicaVoxel, two IK helpers, the `.anim` asset format, an editor timeline and
script / agent control.

```
 .anim file --(assets loader, hot reload)--> anim.Library (clips, machines)
                                                   |
        +------------------------------------------+--------------------------------+
        | SIM domain                                                                | FRAME domain
        | anim.player component (hashed)  --tick-->  "anim.step" system             | anim.Animator (layers, machine)
        |   integer time, fixed step, quantised writes  -> scene properties         |   frame dt  -> Pose -> Skeleton -> matrices
        v                                                                           v
   StateHash / journal / snapshot / replay                                  drawn only: never touches sim state
```

## The domain rule (read this first)

| | **sim domain** (gameplay) | **frame domain** (visual) |
| --- | --- | --- |
| use it for | moving platforms, doors, timed hazards, anything the game logic or physics reads | creature and character poses, UI motion, cosmetic effects |
| state lives in | the `anim.player` component of a scene node | an `anim.Animator` you own (never saved, never hashed) |
| clock | the fixed tick: every tick adds exactly `anim.TickUS` = 50 000 microseconds | the frame `dt` you pass to `Step` |
| writes | scene properties (transform, any component field), **quantised to 1/4096** | nothing: you read `Pose()` and draw |
| in `StateHash` | **yes**, while a player exists (name, clip, time, fade, queue, parameters, last events) | no |
| snapshot / restore / replay | exact: it is a plain component and every control action is a journaled command | not applicable |

Rules the implementation keeps, and your code must keep too:

* **Time is integer microseconds** (`int64`) everywhere. Playback, crossfade, events and the state machine never use a float clock. A
  speed multiplier is applied as `round(dt * speed)`, one rounded product, so it is identical on every CPU.
* Sim writes go through `anim.Quantize` (a multiple of 1/4096) and the interpolation maths forbids fused multiply-add (explicit
  rounded products), so two machines agree bit for bit.
* A sim player is stepped by the `anim.step` system in **entity order**, not store order.
* **Events are bounded.** `Player.Fired` holds at most `MaxFired` (256) events per tick, the rest are counted in `dropped`; when one
  advance covers more than 64 loop cycles the skipped cycles report nothing, and a crossfade's fading-out clip never reports events. `Fired`
  is cleared on the first tick after it was filled and by `Stop`.
* **Control is journaled.** `anim_play`, `anim_stop`, `anim_speed`, `anim_param`, `anim_trigger` are sim commands; scripts use the host
  functions below (their effect is applied like `entity_set_component`). Do not mutate `anim.player` behind the journal.
* **The clip library is versioned, not shared mutable state.** `Library.Add` stores deep copies and publishes an immutable version
  identified by `Library.Hash()`; recent versions are retained (`Retained`). The sim system never reads "the library now": it reads the
  version pinned in its own state (`anim.lib` extra: rolled back, snapshotted, hashed once pinned). `anim.SyncCommands(e)` returns the
  `anim_lib` commands that pin the current version; run them through the journal before the ticks that must see new clips (`animplay.Plugin`
  does it every frame, starting with the version the engine began with; the editor does it at Play and before player commands). A replay
  re-applies them and so plays old ticks with the old clips; a version that is no longer retained is an explicit error, never a silent
  divergence. For a sim you drive by hand, call `SyncCommands` after changing the library. Ticks that run before the first sync use the
  version present when `Install` ran.
* An engine that never calls `anim.Register` does not register the component, so its `StateHash` is unchanged: every existing golden
  stays valid.
* A visual animation must never write a scene component. If something visual needs a scene node (a light colour, a sprite), animate it
  in the sim domain on purpose, or keep the value in your own frame-side data.

## Root motion

A clip drives a character's movement with the reserved track property `root.move` (vec3, `Target` empty): a velocity in blocks
per second in the **local frame** of the target node, rotated by that node's yaw (`transform.rot.y`, degrees). `Target` empty is the node that
owns the `anim.player`; a path (`"kid"`, `"a/b"`) targets a descendant, so one player can walk several characters.

* While the clip plays, `anim.step` writes the world-space result to `physics.character.root_move` (quantised). The character system
  adds it to `move` for that tick and never stores the sum, so collisions, steps, gravity, water and moving platforms still apply.
  A script can keep writing `move` (input) at the same time: the two add up.
* The target needs a `physics.character`. Without one nothing moves (counted as `Missing`).
* `root_move` is cleared the tick after the clip ends, is stopped (`AnimStop`) or is replaced by a clip with no `root.move` track.
* Facing is the node's yaw: at yaw 0 the vector is the world vector (the avatar template walks towards -Z). Rotate the node (script or
  `physics.character` intent) to turn a dash.
* Sim domain only. A frame-domain `Animator` carries `root.move` in its `Pose()` without moving anything: read it to drive visuals.
* Replay-safe: `anim.player` hashes a `root` flag only while root motion is active, and `root_move` only when non-zero, so worlds that
  never use it keep their `StateHash`.

```text
{"format":"burrow.anim","version":1,
 "clips":[{"name":"dash","length":0.4,
   "tracks":[{"target":"","prop":"root.move","kind":"vec3",
     "keys":[{"t":0,"v":[0,0,-14],"i":"smooth"},{"t":0.4,"v":[0,0,-2]}]}]}]}
```

Script: `AnimPlay(self, "dash", AnimPlayOpts{Mode: AnimOnce})` starts it; the dash then walks the character for the clip's length.

## Quick start

```go nocheck
lib := anim.NewLibrary()
doc, _ := anim.Decode(fileBytes)                 // a .anim file
_ = lib.Add("assets/lift.anim", doc)             // source label = project path (hot reload replaces it)

// sim domain, inside sim.Config.Setup:
sch := scene.DefaultSchema()
_ = anim.Register(sch)                           // anim.player, hashable
_, _ = scene.Install(e, sch)
_ = anim.Install(e, sch, lib)                    // system "anim.step" + the commands

e.Do(scene.AddComponent{Path: "lift", Name: anim.CompName, Data: []byte(`{"clip":"shuttle","playing":true}`)})
e.Do(anim.Play{Path: "lift", Clip: "shuttle", Mode: "pingpong", Fade: 0.25})   // journaled control
```

With an `engine.App` add `&animplay.Plugin{Library: lib}` after `engine.ScenePlugin`: it registers the component, installs the system on
every sim engine of the app (live and replays), and hot-reloads `.anim` files of an `assets.DB` resource.

```go nocheck
// frame domain
an := anim.NewAnimator(lib)
an.Base().Player = anim.Player{Machine: "locomotion", Playing: true}
an.Layer("nod").Additive = true
an.Base().Player.SetParam("speed", 1)            // state machine parameter
an.Layer("nod").Player.Play("nod", anim.ModeOnce)
an.Step(dt)                                      // frame seconds
pose := an.Pose()                                // *anim.Bag, sorted (target, property) -> Value
mats := skeleton.Solve(pose, rootMatrix, nil)    // one matrix per bone
```

`examples/anim_demo` does both: a platform shuttles in the sim domain (`go run ./examples/anim_demo -verify` checks twin, replay and a
mid-clip snapshot without a window) while a voxel creature on it idles and walks in the frame domain.

## Tracks, keys, interpolation

A `Track` animates one property of one target. `Target` is a node path relative to the node that owns the player (`""` = itself) or a
bone name; `Prop` is `component.field[.sub]` exactly as the schema names it (`transform.pos`, `transform.rot.y`, `light.color`,
`physics.body.mass`). `anim.CheckProp` validates a property and a kind against the schema; the editor and tools use it.

| kind | value | interpolation | typical property |
| --- | --- | --- | --- |
| `float` | number | all modes | `transform.pos.x`, any float field |
| `vec3` | `[x,y,z]` | all modes | `transform.pos`, `transform.scale`, `vec3` fields |
| `quat` | `[x,y,z,w]` (a file may give Euler degrees `[x,y,z]`) | slerp, shortest path; cubic and bezier ease the slerp | `transform.rot` (written back as Euler degrees) |
| `color` | `[r,g,b,a]`, 0..1 | per channel | any array/object field of four numbers |
| `bool` | `true`/`false` | always step | `bool` fields |
| `int` | integer | rounded | `int` fields |

Each key has the interpolation of the segment that *starts* at it:

| `i` | behaviour |
| --- | --- |
| `linear` (default) | straight line |
| `step` | hold the value until the next key |
| `smooth` | smoothstep ease in/out |
| `cubic` | cubic Hermite with tangents `in`/`out` (value units per second); absent tangents are automatic (Catmull-Rom) |
| `bezier` | CSS-style `cubic-bezier(x1,y1,x2,y2)` easing of the progress (`ease`, default 0.42,0,0.58,1), then linear |

Outside the first and last key the value is clamped. Keys must have strictly increasing times; `Decode` sorts them and then validates.

## The Player

`anim.Player` is a plain value: clip, playhead (`t`, microseconds), direction, mode (`once`, `loop`, `pingpong`, empty = the clip's
default), `speed` (0 = 1), a crossfade (`prev`, `fade`, `fade_dur`), a `queue`, an optional `machine` with `state` and `params`, and the
events fired by the last `Advance`. It serialises to JSON, hashes canonically and is the `anim.player` component.

* `Play`, `CrossFade(clip, mode, fadeUS)`, `Enqueue`, `Stop`, `SetSpeed`, `SeekTo`, `SetParam`, `SetTrigger`.
* **Events** are markers on the timeline. They fire once when playback crosses them (also on the first frame for time 0, on each loop
  wrap, and in both directions in ping-pong) and are listed in `Player.Fired` for that tick; a script or a system reads them there.
* A once clip that ends keeps its last pose, stops (`playing:false`) and starts the next queued clip.

### Blending, crossfade, layers

`Mix(a, b, w)` blends two bags; `Overlay(base, layer, ref, w, additive, mask)` puts a layer over a base. The `Animator` keeps a list of
`Layer`s, mixed in creation order: a layer has its own `Player`, a `Weight`, an optional `Mask` (targets equal to or below the listed
names) and an `Additive` flag. Additive adds `(pose - reference) * weight`, where the reference is the first frame of the layer's clip
(vectors and colours add, rotations compose). Properties present on one side only are kept unchanged.

### State machine

A `Machine` has parameters (`float`, `int`, `bool`, `trigger`), states (a clip and a mode each) and transitions
`from` (a state, `""` or `*` = any) `to`, with conditions on parameters (`== != < <= > >=`, `true`, `false`), an optional `exit_time`
(a fraction of the current clip) and a `fade` in seconds. The first transition whose conditions hold is taken, once per tick; a trigger
tested by that transition is consumed. A machine works identically in both domains (`Player.Machine` / `anim_param` / `anim_trigger`).

### Tweens

`anim.Tween{From, To, Dur, Delay, Ease, PingPong, Repeat}` is a small value stepped with `Step(dtMicroseconds)`: keep it in sim state and
step it with `anim.TickUS`, or in frame state and step it with the frame time. Easings: `linear in_quad out_quad inout_quad in_cubic
out_cubic inout_cubic smooth out_back out_bounce`. `anim.Tweens` runs callbacks (`Start`, `Cancel`, `Step(dt seconds)`) for the frame domain.

## Skeletons of rigid voxel parts

`anim.SkeletonFromVox(file, name, unit)` reads the scene graph of a MagicaVoxel file (`importers.VoxFile.Graph`, the transform-node
hierarchy that `Instances` flattens): every **named** transform node (an object or group you named in MagicaVoxel) becomes a bone whose
joint is the node's translation; nested nodes become child bones; unnamed nodes only contribute their transform; the models below a bone
are its rigid parts (`Skeleton.Parts`, each with a `Local` matrix to bone space, world units, +Y up). `unit` is the world size of one
voxel. Bone names must be unique. Axes follow package `character`: MagicaVoxel Z up, facing -Y, becomes +Y up, facing -Z.

Skinning is rigid: a part follows exactly one bone, so a pose is one matrix per bone and there are no vertex weights. `Skeleton.Solve(pose,
root, dst)` returns the model-space matrix of every bone; the pose values are absolute local transforms (`transform.pos|rot|scale` on the
bone's name), anything missing keeps its rest value. `RestPose()` returns the rest bag (to edit or to blend against).

**IK helpers** write rotations into a pose:

* `Skeleton.TwoBoneIK(pose, root, upper, lower, end, target, pole, weight)`: leg and arm reach; the middle joint bends towards `pole`; a
  target beyond reach stretches the chain towards it (returns false).
* `Skeleton.LookAtIK(pose, root, bone, target, up, forward, maxDeg, weight)`: shortest-arc aim of a bone's forward axis (default -Z) with a
  turn limit. `anim.LookAtRotation` and `anim.SolveTwoBone` are the pure maths.

Package `character` keeps its procedural gait animator (it is code, not keyframes, and its tests and goldens pin it) and adds an adapter:
`(*character.Clip).ToAnim()` converts the keyframed one-shot clips (attack, wave, cheer...) to `anim.Clip`s with identical sampling, and
`Pose.ApplyBag` writes an anim pose (role names as bones) onto a character pose.

## The `.anim` format

Stable and versioned (`"format":"burrow.anim"`, `"version":1`). `Decode` rejects unknown fields, other formats and future versions, bounds
every size (8 MiB file, 4096 tracks, 65 536 keys per track, 4096 events), sorts keys, validates, and `Encode(Decode(x))` is canonical:
decoding that output and encoding again gives the same bytes. Times are seconds (rounded to the microsecond).

```go nocheck
{"format":"burrow.anim","version":1,
 "clips":[{"name":"shuttle","length":8,"loop":true,
   "tracks":[{"target":"","prop":"transform.pos","kind":"vec3",
     "keys":[{"t":0,"v":[0,0,0],"i":"smooth"},{"t":2,"v":[8,0,0],"i":"smooth"},{"t":8,"v":[0,0,0]}]}],
   "events":[{"t":2,"name":"arrive","arg":"east"}]}],
 "machines":[{"name":"locomotion","params":[{"name":"speed","type":"float"}],
   "states":[{"name":"idle","clip":"idle"},{"name":"walk","clip":"walk"}],
   "transitions":[{"from":"idle","to":"walk","conds":[{"param":"speed","op":">","value":0.1}],"fade":0.2}]}]}
```

(the snippet is JSON, shown with the `go nocheck` marker only so the docs checker skips it).

`.anim` files are an asset kind (`animation`) of the asset database: GUID sidecar, thumbnails-less, listed by the Content browser. The loader
returns an `*anim.Doc`. `animplay.Plugin` and the editor reload a changed file into the library (source label = project path); a file that
does not parse keeps the previous content and the error is available from `Library.Errors()` and the console. Clip names are unique across
sources.

## Editor

**Tools > Animation Editor**, or double-click a `.anim` in the Content browser, opens the animation editor full screen, like the model editor
(Ctrl+Space or *Back to world* returns; the Animation layout keeps it docked under the viewport). The header holds the file, the clip
(*+ Clip* adds one), the node the clip animates (the crosshair button uses the selection), Dope sheet / Curves, the ⋯ file menu (new, open,
save as, delete clip) and Save. The preview above the timeline shows the animated node and its children **alone in a studio** (dark
backdrop, grid floor; drag turns around it, the wheel zooms, a double-click frames it again), with the **motion path** of the node (a dot
every 1/10 s, keys as diamonds) and **ghosts** 0.3 s before (blue) and after (orange). *Show the world* swaps it for the world viewport when
the scenery matters (a platform that must meet a ledge); *Isolate the node* comes back. The studio is drawn from the game's own render
items (`core.AnimFrame3D`: the render input hook keeps the node's meshes, sprites, voxel models and lights), so it shows exactly what the game
draws. **Animation settings**, on the right, edits
the selected key (value, easing with a preview of the curve, bezier presets and handles, cubic tangents Auto / Flat, Copy / Paste / Delete),
the tracks (add one for a property of the selected node, remove one), the clip (length, loop in the game, node), the motion presets and the
events (name, argument, move to the playhead, delete).

* **Rail tools**: *Select keys* (V), *Add key* (K: a click on a lane keys it there), *Event* (E: a click on the Events lane adds one) and
  *Record* (R).
* **Dope sheet**: an Events lane, then the tracks grouped by the node they animate (the group row shows every key time), a diamond per key.
  Click selects (Shift adds), drag moves the selected keys (snaps to 1/30 s, hold Alt for free), `Delete` removes them (the shortcut does not
  delete the node while the pointer is over the timeline). With the pointer over the timeline, Space plays or pauses, Home and End jump to
  the ends, Left and Right step a frame (Shift: a second), Up and Down jump to the next and previous key, `K` keys the selected track at the
  playhead and `F` zooms to the whole clip. Ctrl+click on a row adds a key. The ruler scrubs; the wheel zooms, Shift+wheel pans.
* **Curves**: the value of the selected track over time; the channels of the track (X, Y, Z, ...) are listed under it, click one to draw
  it; drag a key in time and value.
* **Transport bar**: start, previous key, Play, next key, end, the playhead and the clip length, Loop, **Preview** (writes the pose at the
  playhead onto the scene; **Play** advances it with the frame time), Path and Ghosts, Key (the selected track), Key all, Fit. The preview
  is remembered: ending it (toggle off, save, Play, any ordinary edit) restores the scene exactly, so scrubbing never leaves a trace in the
  `.voxscn`.
* **Record**: with Preview on, editing a property of a node below the root (gizmo, Inspector, `editor_set_component`) creates a key at the
  playhead for the property that changed (transform position / rotation / scale, any float, int, bool or vec3 field). Only the key goes
  into the undo history (the scene shows the preview pose, so keeping the edit would write that pose into the document); a drag updates one
  key; an edit that also changes fields that cannot be keyed is reverted with a console warning.
* **In the game** gives the node its animation player (`anim.player`): *Plays at start* runs the clip as soon as the level
  runs, *Script starts it* leaves it waiting for a script (`burrowsdk.AnimPlay(e, "clip", burrowsdk.AnimPlayOpts{})`, the call is shown
  with a Copy button). The game loads clips from the saved `.anim` files.
* **Models in parts** (a weapon's magazine and bolt, a door's leaf, a creature's limbs): a node that draws a `.bmodel` split into
  parts in the model editor (Parts tab: names, pivots, parents) offers *Split into animatable parts* (Animation settings, Tracks section,
  or the Outliner's context menu). One undo step turns it into a node per part at its pivot, parented as in the model, each with a
  `voxels` child drawing the part (`model.Rig`, `core.RigNode`); the voxels stay exactly in place. The *Node* picker of the Tracks section
  then chooses which part the next track animates.
* **Motion presets** generate a tween in one undo step from the playhead to the end of the loop, keyed from the current pose: *Bob* (pos
  ±0.5 up/down), *Shuttle* (pos ±2 on x), *Spin* (a full turn around y in quarter turns) and *Pulse* (scale x1.25 and back); the last key
  repeats the first one's value, so the loop is seamless.

Every edit is an undoable `core.Op` (`AnimKeyOp`, `AnimMoveKeyOp`, `AnimDeleteKeyOp`, `AnimTrackOp`, `AnimEventOp`, `AnimClipOp`,
`AnimPlayerOp`), so Ctrl+Z works across scene and animation edits, and record mode folds the property edit and its key into one undo step.

## Scripts

Scripts run in the fixed tick, so they control the **sim** player (host module `vox`, additive; `script/host_anim.go`,
`sdk/burrowsdk/anim.go`): `anim_play(entity, clip, flags)` (mode bits 0-1, queue bit 2, crossfade milliseconds in bits 8-23), `anim_stop`,
`anim_set_speed`, `anim_set_param`, `anim_trigger`, `anim_time` (the playhead in microseconds). Events of the last tick are in the
`fired` array of the entity's `anim.player` component. See [script/ABI.md](../script/ABI.md).

```go nocheck
burrowsdk.AnimPlay(self, "shuttle", burrowsdk.AnimPlayOpts{Mode: burrowsdk.AnimPingPong, FadeMillis: 250})
burrowsdk.AnimSetParam(self, "speed", 1)
```

## Agents

`editor_anim` lists clips, machines and players and controls a player (play, stop, speed, param, trigger; one undo step in edit mode, plain
journaled commands while playing). `editor_anim_edit` is the timeline as a tool (open, save, clips, keys, events, scrub, preview, record;
edit mode only). The sim commands `anim_play`, `anim_stop`, `anim_speed`, `anim_param`, `anim_trigger` are also available to any game that
installs `anim` (`vox_act` can carry them once its engine does; the `burrowd` default session has no scene, so it does not).

## Limits and what is not covered

* No vertex skinning (rigid parts only), no inverse-kinematics solver beyond two-bone and look-at, no retargeting between skeletons.
* Cubic interpolation of rotations is an eased slerp (no tangents); use more keys for tight paths.
* Tracks cannot drive `anim.player` or entity-reference fields (`CheckProp` rejects them, the sim system refuses to write them). Component
  JSON is read-modify-written with numbers preserved (integers above 2^53 survive).
* A property track needs the property to exist: a missing node or component counts in `ApplyStats.Missing` and is skipped silently.
* The sim system writes through the scene API of the node tree: only nodes below the player's node are reachable.

## Held items (first person)

`render.viewattach` draws a node and everything under it in front of the active camera, as if the viewer held it: a weapon or a
tool, hands, a compass, a cockpit. `offset` is in camera space (x right, y up, z backward: a negative z is in front), `rot` turns it
(degrees), `scale` sizes it (the node's own scale is not used: a unit cube with `scale` 0 fills the screen), `off` draws it at its place in the world instead (third person). Only the drawing moves: physics, scripts and
the node's animation keep it at its place in the scene, and its parts keep their animated poses relative to it, so a rigged weapon plays its
reload clip in the player's hands. In the editor the node stays at its place while editing; *Hold in first person* (Hierarchy context
menu) adds the component and *Preview as held* shows it from the editor camera to tune the offset; in Play it follows the player's view.

A reload, for instance: split the weapon model into parts (body, magazine, bolt), make a `reload` clip that moves the magazine out and in
and the bolt back, with events `mag_out`, `mag_in`, `bolt` (argument `sound=...`) for the sounds, set *In the game* to *Script starts it*,
and call `burrowsdk.AnimPlay(gun, "reload", burrowsdk.AnimPlayOpts{Mode: burrowsdk.AnimOnce})` from the script that reads the reload key;
queue `idle` after it with `Queue: true`.

