# Genre templates

Burrow is a voxel engine, not a sandbox. Four project templates prove it: each one is a `burrow new -template <name>` project (data, levels,
UI documents and one WebAssembly game script) with no game logic in the engine, plus a runnable example and a scripted pilot that wins the game.

| template | genre | what it exercises |
|---|---|---|
| `platformer` | 2.5D side scroller | `side_scroller` camera rig, hand-built `.level` files, checkpoints (zones), moving platforms (physics3d kinematic bodies carrying a `physics.character`), coins, hazard blocks, kill plane, lives, HUD, pause menu, quick save/load, particles, sounds, level progression |

Multiplayer starters (not genre showcases):

| template | what it exercises |
|---|---|
| `multiplayer` | the first-person controller plus a base script that moves one avatar per connected player from the server registry |
| `lobby_match` | `runtime.lobby` (2 to 8 players, 2 teams, `map` and `length` settings), the *Lobby* game UI screen, a script that loads the chosen map when the match starts, ends it with `lobby_end_match` (`{"placements": ...}`) and returns to the lobby; two arenas with a goal zone. See [Lobby screen](lobby.md#lobby-screen) |

```sh
burrow new mygame -template platformer      # also multiplayer, lobby_match
cd mygame && burrow run                      # play; burrow test is the headless check
go run ./examples/tpl_platformer             # in a Burrow checkout: play (also -auto, -shot dir)
make templates-test                          # all four, headless and on the GPU
```

## How a template is built

`templates/files/<name>` holds `vox.project` (plugins on, rigs, UI screens), `input.json`, `scenes/main.voxscn`, `levels/*.level`, `ui/*.ui.json`
and `scripts/game/main.go.tmpl`. The levels are binary assets written by `go run ./templates/mkassets [name]` (plain block boxes plus nodes, spawns
and zones). All rules live in the script: named scripts (`burrowsdk.RegisterNamed`) selected by the `entry` of the `script` component. A script keeps
nothing in guest memory: game data (score, ore, health) is in the save key/value store, which is simulation state, so it is hashed, replayed and
restored by a quick load together with the world. Scripts avoid `encoding/json` on hot paths (one call costs about a millisecond in Go-in-wasm) and keep
their private state as packed bytes.

## The `-auto` proof

`internal/tplkit` scaffolds the template exactly like `burrow new`, builds the script, opens the project through the same `internal/game.Build` as
`burrowplay`, and plays a pilot: a function of the world and the tick that returns the input of one frame (keys, mouse buttons and motion, the cursor).
`-auto` is headless (one tick per frame): it asserts the goals of the example, then checks the journal replay (`VerifyReplay`), runs the whole game a
second time and compares the `StateHash`, and runs a template-specific `Extra` (pause menu freezes the simulation, quick save then quick load restores the
saved hash, mouse look turns by 0.1 degree per pixel). `-shot dir` plays the same pilot on a hidden GPU window with the validation layer on and writes
PNGs; `make templates-test` fails on any `VUID`. Reached goal: platformer tick 875 (two levels, two deaths and respawns).

## Engine gaps found while building them

Fixed (generic, with tests):

* **Mouse look lost at 60 fps.** Scripts run at 20 Hz but a mouse delta is a per-frame amount, so two of three deltas never reached the script. Relative
  actions (mouse delta, scroll) are now summed over the frames between two ticks (`script/relinput_test.go`).
* **No pause.** `App.SetPaused` / `Context.SetPaused` (frame domain: no fixed tick, no banked time) and the game UI document field `pause_sim` (the
  simulation is paused while the screen is visible). Also the built-in widget action `game:quit`, so a project without Go host code can have a Quit button.
* **No physics3d overlap query for scripts** (`physics_overlap` only knows the old AABB `physics`): added `physics3d_overlap` (ABI, host, SDK
  `Physics3DOverlap`, `physics3d.OverlapBoxFixed`).
* **No pointer for scripts.** `input.Frame` gets `CX, CY, HasCursor`, a `mouse_pos` binding (axis2d, -1..1), `runtime.cursor: "free"` in `vox.project`
  (`WindowPlugin.FreeCursor`), `Injector.SetCursor` for scripted runs.
* **Voxel bodies were not drawn by project games.** `physics3d/p3render` is now installed for windowed projects with physics3d (`VoxelOnly`: bodies
  that are scene nodes with `render.mesh` are not drawn twice).
* **Sandbox HUD (crosshair, hotbar, frame statistics) in every project.** `runtime.hud`; default off when `plugins.controller` is false. Migration: a project that set `controller: false` and wants the old overlay adds `"hud": true` to `runtime`.
* **Pause details.** `pause_sim` also stops the first-person controller; several pausers coexist (`App.SetPausedBy`); relative input is dropped (not journaled) while paused; catch-up ticks do not repeat a mouse delta; `TickAlpha` is frozen while paused and follows the controller's accumulator. `game:quit` needs `uiplug.Plugin.AllowQuit` (set by the project runner for the project's own UI files only).
* **No host handle on the scene tree.** `App.SceneReader()` (read nodes and component JSON from tools and tests).
* **No child enumeration or find by component.** `scene_parent`, `scene_children`, `scene_path`, `scene_find_with`, `scene_find_tag` (bounded, gas per node
  scanned) and the `tags` component; coins and mobs no longer need to be found by name.
* **Whole-component JSON only.** `field_get` / `field_set` / `field_get_num` / `field_set_num` and `component_patch` access one value by schema path
  (`pos[0]`, `bodies[2].mass`) with schema-validated, replayed partial writes; typed accessors for the built-in components are generated (`make sdk-gen`).
* **Scripts could not read data files, and block ids had no names.** `asset_read` (project data files, 256 KiB, 16 reads per transaction) and
  `block_count`, `block_name`, `block_info`, `registry_list`.
* **First-person look stepped at 20 Hz.** A frame-domain look layer for rigs (`camera_rig.frame_look`): the view turns at frame rate and the sim receives the
  look once per tick, with no double rotation (`camera/camera_test.go`).

Remaining (listed, not fixed):

* Time of day is fixed at 24000 ticks and not configurable; level `settings` (sky, weather, fog, gravity) are data that nothing applies in project games. The survival
  template defines its own 2400-tick night, the sky does not follow it. Enclosed rooms are black (no block light yet: a roofless design was used).
* `LevelZoneAt` returns only the first zone; the level `kill_y` respawns at the default spawn only (the platformer implements its own kill plane and checkpoints).
* Engine trigger and collision events are not bridged to scripts (frame-domain only). Scripts use `physics_overlap` diffing, `gameui_poll` and `level_current` polling.
* A UI button that goes through the simulation (`sim:` actions) does nothing while the simulation is paused, so the pause menu only has Resume and Quit; save and load are keys.
* Not built: a minimap widget, a selection rectangle widget (the box select has no drawn rectangle; selected units are tinted), an item name in grid slots.
* Body positions authored in level nodes must be given in world coordinates (the body writes the node transform).
* Voxel body drawing showed nothing on the GPU in the shared tree while another change to the mesher was in flight (`examples/physics3d_playground -gpu` too);
  a destructible voxel-body wall is correct in the simulation but the capture does not show it until that is back.
