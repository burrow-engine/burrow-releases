# Tutorial 5: cameras and game UI

Cameras and the game UI are **frame domain**: they decide what the player sees, never what the simulation computes, so they cannot change a `StateHash`. Both plugins are off by default (`runtime.plugins.camera: true` / `gameui: true` enable them).

## Part A: a third-person and an isometric camera

1. Open `vox.project` (or **Project > Project Settings**) and enable the camera plugin with two rigs:

   ```json
   { "runtime": { "plugins": { "camera": true },
       "camera": { "start": "third", "rigs": [
         { "name": "third", "kind": "third_person", "distance": 6, "collide": true, "smooth": 0.06 },
         { "name": "iso",   "kind": "isometric", "ortho_size": 9, "smooth": 0.15 } ] } } }
   ```

   Rigs can also be nodes: add a `camera_rig` component to a node in the Inspector, which enables the plugin by itself.

2. Open **View > Cameras...**. Choose a rig in the **Rig** list, check the live preview, then press **Switch to rig** (or **Shake** to test the trauma shake).

3. Press **Ctrl+Shift+P** to play. The view follows the player through the first rig.

4. Switch rigs from a script, with a blend:

   ```go nocheck
   burrowsdk.CameraSwitch("iso", 0.6)
   ```

   The other camera commands (shake, cut) are in the [script API reference](../reference/script-api.md).

Rig kinds are `first_person`, `third_person`, `top_down`, `isometric`, `side_scroller`, `free` and `fixed`; all fields are in [cameras.md](../cameras.md).

## Part B: a HUD

1. Enable the game UI plugin in `vox.project`: `"runtime": { "plugins": { "gameui": true } }`.

2. Create `ui/hud.ui.json` in your project:

   ```json
   { "version": 1, "theme": "hud", "root": { "type": "stack", "layout": "none", "children": [
       { "type": "panel", "anchor": "top-left", "offset": [8, 8], "layout": "stack_v", "children": [
           { "type": "bar", "bind": "hp", "bind_max": "hp_max", "size": [150, 16], "format": "{v}/{max}" } ] } ] } }
   ```

   Every `*.ui.json` of the project is loaded and named after its file.

3. Open **Tools > Game UI Designer** and open `ui/hud.ui.json` (or double-click it in the Assets panel). The screen is drawn the way the game draws it: click a widget to select it, drag it to move it, change its text, colours and bindings on the right. **Preview values** fakes the numbers the bars read, so you see them without running the game. Save with Ctrl+S: a running game reloads the file.

4. Set the value the bar reads from a script, for example `burrowsdk.UISetNum("hp", 14)` (see the [script API](../reference/script-api.md)). The bar eases toward its value.

5. Press Play and check that the bar is drawn over the game.

Widgets, themes, localisation and world labels are explained in [game-ui.md](../game-ui.md). Next: [levels and saves](06-levels-and-saves.md).
