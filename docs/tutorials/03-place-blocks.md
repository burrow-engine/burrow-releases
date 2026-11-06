# Tutorial 3: place and shape blocks

Where sculpting moves terrain, the shape tools build things: walls, towers, houses.

## Steps

1. Press **2** for **Place**. Click the block chip in the context bar to open the palette.

   ![the block palette open from the context bar](../img/editor-palette.png)

2. Type in the search field: the palette matches names, display names and aliases (English and French), for example `oak` or `pierre`. Starred blocks and recent blocks stay on top between sessions.

3. Click on a face of the world to put the block next to it. Press **3** to erase and **4** to paint. **5** is the eyedropper; **Ctrl + click** works as a temporary eyedropper from any tool.

4. Build faster with the shape tools: **6** Box, **7** Sphere, **8** Line, **9** Fill. Drag the base of a box, then move the pointer to set its height (or use the wheel while dragging). *Hollow* makes a shell.

   ![the Ramp tool previewing the voxels it will add in green and remove in red](../img/editor-voxel-tools.png)

5. Turn on a mirror axis (**X**, **Y**, **Z** in the context bar) to build symmetric things, or radial symmetry in the tool options.

6. Press **0** for **Region select**: drag a box, then copy, cut, paste, rotate (Shift+R), mirror (Shift+M), fill or delete it. A pasted region is one undo step.

7. Some blocks have shapes (slabs, stairs, fences, doors, panes, torches) and some emit light. The [block list](../reference/blocks.md) shows names, hardness and light levels; [block-shapes.md](../block-shapes.md) explains the non-cubic shapes.

## Tips

* The preview never changes the world: only a click does.
* **Ctrl+Z** and **Ctrl+Shift+Z** (or **Ctrl+Y**) walk through your edits.
* Hold the right mouse button to fly, so you can reach the face you want.

Next: [add a scripted entity](04-scripted-entity.md).
