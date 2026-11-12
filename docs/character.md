# Characters

The player avatar and animated characters: package `character` (rig, skins, animation, `.vox` import, held items),
`character/charplay` (the engine plugin: views, camera, scene nodes), the **Character** editor panel and the
`character` scene component. Everything is **frame domain** (visual): it never writes simulation state, never changes
`StateHash` or the journal, and the animation clock is the frame `dt` you give it, never the wall clock.

```
 physics / controller state  --(read only)-->  character.Motion  -->  Animator  -->  Pose  -->  part matrices
                                                                                            |
 skin (64x64 PNG) or .vox  -->  Rig (named parts, pivots, meshes)  ------------------------+--> rworld.MeshItem
                                                                         (render.extract input hook; soft AND Vulkan)
```

## The rig

A `character.Rig` is a hierarchy of named **parts** in world units: +Y up, the character faces **-Z** (camera yaw 0), its
right hand is **+X**, the origin is the centre of the feet. Each `Part` has a role, a parent, a **pivot** (the joint
position at rest) and a mesh whose vertices are relative to the pivot. Animated roles: `torso`, `head`, `arm_r`, `arm_l`,
`leg_r`, `leg_l`. Any other part is a static child of its parent (a tail, a backpack). Parents precede children.

A `Pose` holds a root yaw/pitch/offset and a rotation (degrees: pitch X, yaw Y, roll Z) and an offset per role. Positive
pitch swings a hanging limb **forward** and makes the head look **up**. `Rig.Solve(root, pose)` returns one object-to-world
matrix per part.

Two model sources feed the same rig:

| model id | source | look |
| --- | --- | --- |
| `humanoid` | boxes + a 64x64 skin, 4 px arms | 1.8 blocks tall (one skin pixel = 1.8/32 block) |
| `humanoid_slim` | same, 3 px arms | |
| `voxel_hero` | the bundled voxel humanoid, 16 voxels tall | |
| `assets/x.vox` | any `.vox` split into named parts (below) | scaled to 1.8 blocks, times `scale` |

## Skins (64x64)

The format is the usual 64x64 RGBA layout: head 8x8x8, body 8x12x4, limbs 4x12x4 (3 px wide arms in the slim variant), an
**inner** layer and an **outer overlay** layer (hat, jacket, sleeves, pants) drawn as a box 0.5 px larger and **alpha
masked** (transparent texels show nothing). Each box is unfolded as

```
            U+D        U+D+W
   V        +--- top ---+-- bottom --+
   V+D  +---+---front---+---left-----+---back---+
        |right|  W x H  |   D x H    |  W x H   |
```

`right` is the character's right side (+X), `left` is -X, `front` is -Z. The layout table is `character.BoxUV` /
`FaceRect`; the tests paint every face of every box with its own colour and check that the mesh samples it.
`character.SampleNearest` is the reference nearest-texel sampler. Because both renderers filter bilinearly and choose mips
from the pixel footprint, the texture handed to them is the skin enlarged 4x with nearest neighbour (`SkinTexture`), which
keeps the blocky look.

**Default skin.** `character.DefaultSkin` draws an original skin ("Wanderer": cap, green tunic, red scarf) pixel by pixel
from code; a golden PNG (`character/testdata/default_skin.png`) pins it. It is not derived from any third-party skin.

**Importing a skin.** Skins are plain PNG files: import one in the Character panel (**Import PNG...**, it must be exactly
64x64) or reference any project PNG in the component's `skin` field. **New...** writes a copy of the default skin into the project and opens it in the texture editor window, and **Edit** opens the current skin there (pixel grid, mirror drawing, layers); the preview picks the saved file up. No network download, no pack loader. A wrong size falls
back to the default skin with a console warning. Skins of the old 64x32 layout are not supported.

## Voxel characters (`.vox`)

`character.ImportVox` splits a MagicaVoxel file into parts. In MagicaVoxel axes (Z up) the character **faces -Y**, so its
right hand is at **-X**. Name each body piece (the object name in the scene panel, stored as the transform node's `_name`;
groups are fine, the nearest named transform wins):

| name | meaning |
| --- | --- |
| `head`, `torso` (or `body`), `arm_r`, `arm_l`, `leg_r`, `leg_l` | the animated parts (`arm_r` = the character's right) |
| `forearm_r`, `forearm_l`, `shin_r`, `shin_l` | optional elbows and knees: the forearm hangs on its arm, the shin on its leg (joint: the top centre of the piece). The animator folds the knees backwards on each forward swing of the leg, bends the elbows (more on the forward swing of the arm, a lot when running), keeps them bent when crouching, jumping, falling, swimming or flying, and cocks the elbow in the `attack` and `place` clips. With `forearm_r` the held item sits at its front-bottom (`pivot.hand` still wins), and the first-person arm draws the forearm hanging from it |
| `head.hat`, `arm_r.glove` | more voxels merged into that part (`<role>.<anything>`) |
| `tail@torso` | a static extra part attached to `torso` (`<name>@<role>`) |
| `pivot.head`, `pivot.arm_r`, ... | a marker object: its centre is the joint of that role |
| `pivot.eye`, `pivot.hand` | optional eye and held-item anchors |
| (no name) | merged into the torso |

Without a `pivot.*` marker the joint is the top centre of arms and legs and the bottom centre of head and torso. The model
is moved so its feet touch y=0, centred on the origin, and scaled to 1.8 blocks (times the component `scale`).
`character.SampleVoxHero()` builds the bundled example; `character.EncodeVoxParts` writes it (`examples/characters/voxel_hero.vox`).
A `torso` part is required.

### Body plans: quadrupeds

A rig has a body plan, `humanoid` (default, everything above) or `quadruped` (wolf, deer, sheep, horse...). Same axes
(faces -Y, the animal's right is -X). The plan is **detected** as soon as one of the four legs below exists, or forced with
`VoxOptions.Plan` (`"humanoid"` / `"quadruped"`; forcing maps `arm_r, arm_l, leg_r, leg_l` to `leg_fr, leg_fl, leg_br, leg_bl`
and back).

| name | meaning |
| --- | --- |
| `torso` (or `body`), `head` | as for humanoids; the head hinges at its back-bottom |
| `leg_fr`, `leg_fl`, `leg_br`, `leg_bl` | front/back, right/left legs (`leg_fr` = front right). Aliases: `front_leg_r`, `foreleg_r`, `back_leg_l`, `hind_leg_l`, `hindleg_l`... |
| `tail` | hinged at its front end, sways and lifts |
| `jaw` (alias `mouth`, `lower_jaw`) | hinged at its back-top, child of `head`; opens with the `bite`, `eat`, `howl`, `rear` clips |
| `neck` | optional; when present `head` hangs on it |
| `ear_r`, `ear_l` | optional, children of `head`, flick at idle |

A quadruped is 1 block tall by default (times `scale`); the held item attaches to the mouth. Animate it with
`character.NewAnimatorFor(rig)` (or set `Animator.Plan = rig.Plan`): walk and crouch move the legs in diagonal pairs
(`leg_fr`+`leg_bl` against `leg_fl`+`leg_br`), run is a bounding gallop with a lifted tail and panting jaw, idle sways the
tail and breathes, jump and fall spread the legs. Head look is limited to +-55 degrees yaw and -35..+40 pitch. The
`attack` and `hurt` triggers play `bite` and `hurt_q` on a quadruped. `character.SampleVoxQuadruped()` is the bundled
reference fox (humanoid-only first-person arm code simply draws nothing for it).

## Animation

`character.Animator` is a deterministic state machine with blending. `Step(dt, Motion)` advances it:

```go nocheck
m := character.Motion{Speed: 4.3, OnGround: true, Yaw: 90, Pitch: -10} // from the physics state + the camera
an.Step(1.0/60, m)
pose := an.Pose()
```

States, chosen by `character.Classify` (priority top to bottom): `swim` (Swimming), `fly` (Flying), `jump` (airborne and
rising), `fall`, `crouch`, `run` (speed above 5.6 or sprinting), `walk` (speed above 0.15), `idle`. Poses are blended
linearly over 0.12 s. The gait phase advances with the **distance travelled** (2.3 rad per block), so feet do not slide.
Look: the head follows the camera pitch and yaw relative to the body (yaw clamped to 75 degrees); the body yaw follows the
look yaw with exponential damping while moving or acting, and only drags along once the head is turned more than 50 degrees
when standing still.

**Clips** are keyframed overlays (smoothstep between keys, fade in/out): `attack` (break), `place`, `wave`, `hurt`, `cheer`,
`nod`; the locomotion state names are also valid clip names (they force that state, walking in place: the editor's preview).
`Animator.Trigger(name)` plays a one-shot, `Play(name, loop, rate)` loops at a rate, `Stop()` fades out. `Animator.Rate`
scales time.

**Triggering from scripts and agents**: set the `anim` field of the `character` component (`editor_set_component`, a
script's `Insert`) to loop a named animation, `""` to hand control back to the motion; Go hosts can also send the
`charplay.Trigger{Path, Name, Loop}` engine event ("" path = the player). The player attack/place swings fire on the left/right
mouse buttons.

**Water.** `Motion.Swimming` selects the swim animation. The player adapter derives it from `app.FrameState.HeadUnder`,
`InWater` while airborne, or a liquid voxel at chest height; `charplay.Avatar.Swimming` replaces that test (the hook for
other water physics). Scene characters use the position deltas of their node plus `physics.character`'s `on_ground`/`vy`.

## Rendering

`render.extract` builds an `rworld.Input` from the scene; `engine.AddRenderInputHook` lets a plugin edit it before
`rworld.Extract`. The character plugin appends `MeshInstance` items (one per part, plus the held object) with the texture
and alpha-mask material, and `CastShadow` set, so the existing soft and Vulkan paths draw them (sun shadows on the terrain
and on themselves where the renderer supports them) **without any shader or `render/vulkan` change**. Part meshes and
textures live in a `character.Store` layered over the project assets (`character.Overlay`, keys start with `char:`).

Parity soft/Vulkan is measured by `make character-test` (Vulkan shot vs `render/soft` hybrid of the same frame, shaders off,
mean abs RGB difference 0..255 over the pixels the character covers): third person walking 8.9, running from behind 6.2,
voxel hero 4.7, first person 2.6 (the whole image, dominated by unrelated terrain differences, is 37 to 41: the soft frame
has no load radius or fog). Tolerance 12.

## Views and camera

`charplay.Plugin{Player: true}` (burrowplay and the games enable it; `runtime.plugins.character: false` turns it off) draws
the player and moves the camera:

* **First person**: camera at the eyes; the right arm and the held object at the bottom right with a gait bob and the
  attack/place swing. The body and head are not drawn.
* **Third person back / front**: the whole body; the camera sits `dist` blocks behind (or in front of, looking back at)
  the eye, shortened by a voxel raycast so it never goes through terrain.

Input actions (in the default input map; custom maps add them to opt in): `camera_toggle` (F5: first, back, front),
`camera_closer` / `camera_farther` (PageUp/PageDown, `=`/`-`), `camera_zoom` (Ctrl + wheel), `crouch` (C, visual only: the
sandbox controller has no crouch physics). Rebind them in `vox.project`'s input map like any action. F5 used to toggle
block textures in the window; while the avatar plugin is on it belongs to the camera (`engine.KeyReservations`).

The held object is the selected hotbar block: a cube with the blocktex face textures and the same plains biome tint as the
3D hotbar icons (`blockicon.FaceImage`); a block without a texture uses its flat colour; a non-block item
(`charplay.Avatar.Held = &character.Held{Kind: character.HeldItem}`) is a generic tool placeholder. The game hotbar keeps its
3D block icons. Project blocks (`runtime.custom_blocks`) show their own PNG faces too (a texture reload refreshes the held atlas).

Precedence of the local player's held object, highest first: `charplay.Avatar.Held` (Go), `held_model` of the Avatar child's `character`
component, a non-empty `held` of that component (a block name; a game with its own inventory sets it from a script, empty gives the hotbar back),
the engine hotbar block.

Walking sway: the speed that drives the walk cycle is measured over 0.2 s (0.5 s for scene characters), so the arm does not jitter at any frame rate.

## Your own character, from scratch

Use data, never a script, for the body, the arm and the hand:

1. Draw a `.vox` with named parts (`head`, `torso`, `arm_r`, `arm_l`, `leg_r`, `leg_l`, optional `pivot.hand`) or a 64x64 skin, and set it on the
   `Avatar` child of your player prefab variant (`model`, `skin`, `scale`).
2. The first-person arm is that model's `arm_r`; tune it with `fp_offset`, `fp_rot` and `fp_scale`.
3. Hold a custom object with `held_model` (a `.vox`), or leave the hotbar block (textured, tinted like the icons).

From an empty project (`burrow new mygame --template empty`), write `assets/prefabs/hero_player.prefab`:

```json
{"version":1,"nodes":[{"id":1,"name":"Player","components":{"prefab.instance":{"prefab":"builtin:player.prefab","overrides":[
  {"path":"Avatar","component":"character","fields":{"model":"assets/hero.vox","held_model":"assets/tool.vox","fp_offset":[0.3,-0.25,-0.3],"fp_rot":[60,10,0],"fp_scale":0.8}}]}}}]}
```

then `burrow config set runtime.player_prefab assets/prefabs/hero_player.prefab`, check with `burrow test` and look at the arm and the held object with
`burrowplay -shot out.png -frames 30 -freeze` (run in the project folder; the player starts in first person).

The arm and the held object are drawn in the render hook with the interpolated camera, so they never jitter. A script updates a node at the
simulation rate (20 Hz): do not move a node from a script to fake a viewmodel, and do not push blocks to the hotbar to show them in hand.

## The `character` component

```json
{"id": 2, "name": "Hero", "components": {
  "transform": {"pos": {"x": 0, "y": 9, "z": 0}, "rot": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}},
  "character": {"model": "humanoid", "skin": "assets/skins/me.png", "scale": 1, "held": "stone", "anim": "", "speed": 1, "hidden": false}}}
```

`model`: `humanoid`, `humanoid_slim`, `voxel_hero` or a `.vox` asset path; `skin`: a 64x64 PNG asset (empty = built-in);
`scale`: 0.05..20 (0 = 1); `variant`: the layer set of a layered `.vox` / `.bmodel` model (antlers, a collar, shorn wool: each part is built from the variant's replacement model; empty or unknown = default); `recolor`: palette changes of a `.vox` model (`3=#c02020,7=#2060d0`, see [modeling.md](modeling.md)) for colour variants of one animal or villager without a new file; `held`: a block name; `held_model`: a `.vox` asset held instead of a block (its longest side is 1 block, times `held_scale`; with two marker instances `pivot.grip` (where the fist closes) and `pivot.tip` (along the handle, towards the working end) it is held like a tool: the grip in the fist, the handle forward and up, the prop's x axis (its width) in the vertical plane of the handle, `HeldGripSize` 0.62 block long times `held_scale`; the markers are not drawn; `held_angle` sets the handle's angle above the horizontal, 0 = 25 degrees, 70 for a torch carried up; a `pivot.fx` marker plus `held_fx` (a particle effect such as `builtin:fire`) and `held_fx_scale` put that effect at the marker every frame, through `particles.FrameEmitters`: a torch burns in the hand);
`fp_offset` / `fp_rot` / `fp_scale`: the first-person arm and held object in camera space (right, up, forward is -Z; rotation in degrees pitch, yaw, roll;
all zero = the defaults `0.30,-0.20,-0.20`, `70,16,-6`, `0.7`); `fp_sway` / `fp_bob`: multipliers of the first-person walking arm swing and bob (0 = 1, negative = off, max 3; the swing of an attack or place clip is not scaled); `anim`: see above; `speed`: animation rate (0 = 1); `hidden`. It is a normal
schema component: saved in `.voxscn`, validated (unknown animation or a negative scale is refused), shown by the inspector
with tooltips and ranges, undoable, and editable by the editor agent with the generic tools (`editor_create_node` with
`components`, `editor_set_component`, `editor_remove_component`); no dedicated MCP tool is needed.

Registering a component is part of the simulation configuration and changes `StateHash`. To keep the hashes of existing
projects, a game registers `character` only when `runtime.plugins.character` is explicitly `true` or its default scene uses
it (the editor always registers it). The avatar and the animation themselves never change the hash (test
`TestAnimationDoesNotTouchStateHash`).

## Fill light

At low sun a character can turn into a black silhouette. `env.post` `fill_light` (0..2, see [lighting.md](lighting.md))
adds a real light to the character meshes (`character.Subject.Fill`): a warm directional fill from the camera side (above and slightly left of the view) plus a cool rim
(back light, fresnel-like edge, `pow(1 - n.v, 3)`), both scaled by the strength and added to the lighting before albedo. It lives in the built-in mesh
shaders (`mesh.frag`, `mesh_hdr.frag`; the strength travels in `Material.Params[0]`, so materials with a custom `shader` ignore it), costs a few ALU per pixel
and does not touch the simulation. It applies to scene characters and to the player avatar (third person and the first-person arm). The soft renderer draws no
characters. Pair it with `exposure` for a menu backdrop.

## Editor panel

Tools > **Character editor** is a full-screen tool like the model editor. The header shows the node, undo/redo, the view
(Orbit, First person, Back, Front), **Turntable**, **Frame** (F) and a menu. The rail on the left has **Select a part** (V: click
a part of the preview), **Pose** (R: drag rotates the selected part; an editor-only pose, never saved, with a **Reset pose**
chip), **Paint the skin** (P: opens the skin in the texture editor) and **Attach a held item** (H: pick the held block). The
centre is the isolated 3D preview (left or right drag orbits, middle drag or Shift+right drag pans, wheel zooms, **F** frames it; drawn by the GPU at the
panel's own pixel size, with the `render/soft` CPU renderer only for headless runs) above the **Animations** strip: a card per clip (length, loop, progress of the playing one), a click plays it, and
**Open in the animation editor**. **Character settings** has three tabs: **Body** (model cards for the built-ins and the
project's `.vox` assets, scale, height, eye height, preview walk speed, held items), **Skin** (64x64 thumbnail, Edit, New,
Import) and **Motion** (walk speed, animation speed, loop). With no character node selected the preview still works and an
empty-state card offers **Create character node** / **Add to selection**. Every change to a node is one undo step.

## Limits

* The first-person arm is depth tested against the terrain, so it clips into a wall you press against.
* No inverse kinematics, no foot planting on slopes, no cloth or secondary motion, no per-part tint, no capes.
* The sandbox controller has no crouch or swim physics of its own: crouch is visual, swim follows `FrameState`.
* Skins are 64x64 only (no 64x32 legacy skins) and are not downloaded.
* The player is rendered from the controller state of the frame: another player or NPC needs a `character` node.
* The Vulkan shadow of the character depends on the renderer's sun shadow settings (unchanged here).

## The player is an entity

The first person player is a node of the scene, an instance of a prefab you can override.

### Defining the player (one path)

A player is `game.mode` (what the scene wants) plus a player prefab (what the player is). Everything else is a fallback
for projects without a `game.mode`; first match wins.

| Question | 1. Scene | 2. Project | 3. Engine |
|---|---|---|---|
| Which prefab? | explicit `scene_spawn_player.prefab` | `game.mode.player_prefab`, then `runtime.player_prefab` | `builtin:player.prefab` |
| Where? | `game.mode.spawns` + `spawn_tag` (picked by `spawn_pick`), then `game.mode.spawn` | `runtime.start` | above the terrain at the origin |

`scene.ResolveSpawn` and `scene.PlayerPrefabPath` are the only implementations; the controller, a scene switch and a session
join all call them. A node you build by hand with `physics.character` and a script is a creature, not a player: it gets no
camera, input or capabilities. Give the scene a `game.mode` and a prefab variant instead. All three walkers (the
player, `physics.character` and remote players) are one function, `physics/walker.Step`, with the same defaults:
gravity 32, terminal speed 78, jump 1.25 blocks, sneak edge reach 0.6; a player steps 1.05 (only where shaped blocks exist), a creature takes its own `step_height`.

* **Prefab.** The player is spawned from `builtin:player.prefab` (engine prefab, shipped in the binary; `builtinprefabs.List()`):
  a root `Player` with the `player` component (`id`, `mode` walk/fly, `eye`) and the tag `player`, and a child `Camera` with an
  active `render.camera` at eye height. A scene chooses another with the `game.mode` component (`player_prefab`, `spawn`);
  without one, `runtime.player_prefab` in `vox.project` applies, else the built-in. A project prefab is usually a **variant**:
  a file holding one node with a `prefab.instance` link to `builtin:player.prefab` and overrides (for example
  `{"path":"Camera","component":"transform","fields":{"pos":[0,2,0]}}`); add scripts or children with `add` overrides.
* **Spawn.** The controller spawns player 0 on its first frame (journaled `scene_spawn_player`) at `game.mode.spawn` (a node
  path; its position and yaw), else `runtime.start`, else above the terrain. In a session every `PlayerJoin` spawns one instance
  (`Player<id>`, inactive camera) and a leave despawns it. A scene switch keeps the players and respawns them from the new
  scene's prefab and spawn point. In the editor, Play spawns the node and Stop discards it.
* **Pose.** In single player the controller mirrors its feet position, yaw, pitch and mode into the node with the journaled,
  quantized `scene_player_pose` command, so the node is hashed, replayed and snapshotted. In a session the pose stays frame
  domain (each peer owns its camera); the node stays at the spawn point. The view itself uses the controller's interpolated
  pose and FOV (the player camera node is rendered with `app.FrameState`), so camera rigs keep working. The camera height
  comes from the prefab's `Camera` node.
* **Scripts.** `burrowsdk.Player(id)` / `burrowsdk.LocalPlayer()` return the node; `FindTag("player", 0)` finds all.
* **Avatar.** The prefab has a child `Avatar` with a `character` component (model, skin, scale). A variant changes the model
  with an override (`{"path":"Avatar","component":"character","fields":{"model":"voxel_hero"}}`). The character plugin draws
  the body from that node (mesh entities are the node, so the editor selects it), driven by the player's animator; first
  person hides it. A prefab without an `Avatar` child falls back to the frame-domain avatar at the controller's pose. The
  `character` component is registered by default (`runtime.plugins.character: false` turns it off; the built-in prefab then
  loads without it).

### Capabilities

What the player may do is data on the player node, read every frame by the controller (all hashed, so a replay agrees). The
**absent component means the capability is off**; `builtin:player.prefab` carries every one with today's behaviour, and a
variant overrides fields or removes the component. A player without a node (bare simulations) keeps everything on.

| Component | Fields |
|---|---|
| `player.move` | `walk`, `fly`, `walk_speed`, `fly_speed`, `sprint`, `sprint_mul`, `crouch`, `jump`, `jump_height`, `step_height`, `gravity_scale`, `swim`, `fly_toggle` (`both`/`key`/`double_tap`/`none`), `no_climb` (ladders and vines cannot be climbed). A zero number takes the controller default. Neither `walk` nor `fly`: the player cannot move. |
| `player.build` | `break`, `place`, `reach`, `blocks` (names that may be placed, empty = any), `protect` (names that cannot be broken), `repeat` (hold to repeat) |
| `player.interact` | `block` (doors, buttons, block logic), `node` (nodes with `interact`), `reach` |
| `player.inventory` | `slots` (0..9 usable hotbar slots), `creative` (the creative panel), `items` (block names of the first slots at spawn) |
| `player.controls` | `input_map` (project path of an input map) |
| `player.impulse` | `vel` (m/s), `seq`; not on the built-in prefab, a script adds it (see Impulses) |

**Climbing.** Inside a ladder, vine or rope cell (a non-solid block whose name contains `ladder`, `vine` or `rope`: the rule nav
agents use with `can_climb`) a walking player goes up at 2.35 m/s with forward or jump, down with back or the down key, holds
its height while sneaking and otherwise slides down at 2 m/s at most, slower than a hard landing, so no landing hit or fall
damage follows. `player.move.no_climb` turns it off.

**Entities.** The controller collides with the voxels and, once wired with `entcollide`, with solid entities: `physics.body`
(not triggers), `physics.character` creatures and `physics3d` rigid bodies and voxel bodies, each as an axis-aligned box
(rotated bodies by their rotated extent). Sweeps stop at the first box face (no tunnelling), a box that overlaps the player
is pushed out along the shortest axis (at most 0.15 m per physics step), and you can stand on a box. The player node and its
children never collide with the player, nor does a node tagged `player_passthrough`. Wire it with
`ctl.SetEntityBoxes(entcollide.Source(engine, schema))` (package `app/entcollide`; `app` itself cannot import physics).

**Impulses.** `player.impulse` pushes the player: write `vel` (m/s, x y z) and a new `seq` and the controller adds `vel` to its
velocity once per `seq` (knockback, jump pads). From Go scripts `burrowsdk.PlayerImpulse(player, [3]float64{0, 9, 0})` bumps
the `seq` for you. The component is hashed and replayed like the other player data, and a project that never writes it keeps
its state hash. A controller that first sees a node only records its `seq`, so a loaded game does not replay an old push.

**Controls.** The input map in use is the local player's `player.controls.input_map`, else the scene's `game.mode.input_map`,
else the project's `input_map`. Switching scene or player prefab switches the map (`input/controls`, frame domain).

**Spawn points** (`game.mode`): `spawns` (node paths) and `spawn_tag`, `spawn_pick` (`round_robin` by player id | `random`, seeded by
the engine seed | `farthest` from the other players).

**Health, death and respawn are the game's rules, not the engine's.** The engine has no hit points, lives, respawn delay or kill
plane (`player.health` and the `lives`, `respawn_delay`, `respawn_at`, `kill_plane` and `kill_y` fields of `game.mode` were
removed, along with the `scene_player_hurt`/`die`/`respawn`/`checkpoint`/`rules` commands and the `player.died` and
`player.respawned` events). Keep the values in the game's own state (a Go game: `Ctx.State`), decide in your tick, and put the
player back with a pose (`scene_player_pose`, `Ctx.SetPos`). Scenes and prefabs saved with the removed component or fields still
load: they are dropped on load, and `burrow migrate` removes them from the files. The level `settings.kill_y` and `bounds` of the
levels plugin return an actor that leaves the level to the level's default spawn (a plain teleport).

**Scene switch.** Players survive a switch. A scene root with the same name as a kept player (for example `Player`) is renamed
`Player_scene` (then `Player_scene2`, ...) when it loads; the player keeps its name.

**Hooks for sound and effects** (frame domain, on `app.Controller`): `OnFootstep(pos, ground, sprinting)` every ~1.9 voxels
walked, `OnJump`, `OnLand(pos, ground, speed)`, `OnBreak`, `OnPlace`. Player id 0 is the local player; in a session it is the
netsim player id (`Controller.PlayerID`).
