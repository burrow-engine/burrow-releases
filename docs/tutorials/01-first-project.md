# Tutorial 1: your first project

You will create a project from a template, open it in the editor, change one thing, save and press Play. It takes about ten minutes. Everything here works the same from the terminal (`burrow`) and from inside the editor.

## Before you start

Install the tools once (see [Getting started](../getting-started.md)): `burrow doctor` must report no missing requirement. You do not need to read any other page first. Press **F1** in the editor at any time to open this documentation; the **?** button of a panel opens the page that explains that panel.

![the Documentation window opened with F1: page tree on the left, search box on top](../img/help-index.png)

## Steps

1. Create the project from a terminal:

   ```sh
   burrow new mygame --template sandbox
   cd mygame
   ```

   The `sandbox` template gives you hills, trees, a first-person controller and a HUD. Use `--template empty` for a flat world and an empty scene. `burrow new --list` prints every template.

2. Open it in the editor:

   ```sh
   burrow edit
   ```

   The window shows the menu bar, the tool bar on the left, the viewport in the middle, the Hierarchy and Inspector on the right and the Assets, Console, Profiler and Blocks tabs at the bottom.

   Already inside the editor? Use **Project > New Project...**, pick or create a folder, then press Open.

3. Look around. Hold the right mouse button and use **W A S D** to fly, **Q** and **E** go down and up, the wheel changes the speed. Orbit with the middle button or **Alt + left button**, pan with **Shift + middle button**. **F** frames the selected node.

4. Select a node in the Hierarchy and look at the Inspector. Every component has a section; hover a section title to read what it is for.

5. Make a small edit: press **2** (Place), pick a block in the block chip of the context bar and click in the world. One click is one undo step: **Ctrl+Z** takes it back.

6. Save with **Ctrl+S**. The scene is stored in `scenes/main.voxscn` and your voxel edits in the `.voxworld` overlay of the project.

7. Press **Ctrl+Shift+P** (or the Play button). The editor snapshots the world and runs the simulation; the keyboard and mouse now go to the game. **Esc** stops and restores the snapshot exactly, so playing never costs you an edit.

## What you learned

* A project is a folder with `vox.project`, scenes, an input map, assets and scripts (see [project file](../reference/project-config.md)).
* The editor and `burrowplay` share the same simulation: what you see in Play is what ships.
* **F1** opens the documentation, **Ctrl+P** the command palette, **Shift+F1** the shortcut list.

Next: [sculpt terrain](02-sculpt-terrain.md).
