# Tutorial 2: sculpt terrain

The terrain tools edit columns of voxels with a brush. Every stroke is one undo step and is recorded in the journal, so it is deterministic and replayable.

## Steps

1. Open a project (tutorial 1) and look at an area you want to change. Press **B** to pick **Raise**. The context bar shows the brush options: size, shape (cube, sphere, cylinder, cone, disc), strength, hardness, mirror axes and the block.

2. Move the pointer over the terrain. The preview shows what the next click changes: **green** voxels are added, **red** are removed, a read-out gives the counts and the size.

3. Drag to raise a hill. The wheel changes the brush size, **Alt + wheel** the strength. Hold **Shift** to invert: the same stroke now lowers.

   ![the Lower preview in red: the voxels that the next click removes](../img/editor-terrain-lower.png)

4. Press **N** (Lower) to dig, **G** (Flatten) to level to the height of the first click (a blue plane shows the level) and **U** (Smooth) to soften edges.

5. Press **P** (Ramp) and drag from a low point to a high point to build an even slope as wide as the brush.

6. Press **X** (Extrude), grab the arrow of a face and drag it out or in.

   ![Extrude: drag a face along its arrow, the preview shows the voxels it adds](../img/editor-terrain-extrude.png)

7. Press **O** (Scatter) to sow trees, bushes, rocks or plants. *Density* is a percentage; the result is deterministic for a given seed.

   ![Scatter: trees sown on the terrain, with the next dab previewed](../img/editor-terrain-scatter.png)

8. Press **Y** (Surface paint) to recolour only the top layers, or **K** (Replace) to swap one block for another inside the brush.

9. Undo with **Ctrl+Z**; the whole stroke goes back at once.

## Tips

* The **Options** button of the context bar opens brush presets, radial symmetry (2 to 16 copies around the vertical axis) and the grid snap of the cursor.
* An edit larger than the limit is refused with the numbers in the message instead of freezing the editor.
* All terrain tools are available to AI agents through `editor_tool_apply` ([MCP tools](../reference/mcp-tools.md#editor_tool_apply)).

The full list of tools and keys is in [editor.md](../editor.md#voxel-tools). Next: [place blocks](03-place-blocks.md).
