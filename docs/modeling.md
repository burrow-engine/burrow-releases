# Modelling and texturing

Burrow has built-in tools to make voxel models and pixel-art textures, for humans in the editor (Tools > Model editor and Tools > Texture Editor: each opens as a full-window docked panel, or in a separate window from the asset's right-click menu) and for AI agents
through MCP (`editor_model`, `editor_texture`). Both are **declarative and deterministic**: you send a list of operations (ops), the same ops always give a
byte-identical result, and the op list is stored with the asset so it can be edited later. Packages: `model/` (voxel models), `texedit/` (textures);
windows `editor/ui/model_ws.go`, `editor/ui/texture_ui.go`, `editor/ui/toolwin.go`; tools `editor/agent/modeltools.go`.

Everything an agent needs is in the tool descriptions and this page. The loop is: send ops, **look at the returned image**, fix, repeat, save.

Textures also get surface relief: the texture editor's **Relief** section derives a height from the colours (dark = deeper), or reads a painted
one (**Painted**: a grey layer named `height`, white = surface, darker = sunk; it is not part of the colours), builds a normal map from it and a
constant specular map, and writes `<name>_n.png` / `<name>_s.png` next to the texture (see [rendering.md](rendering.md), "Parallax relief").

## Voxel models (`.bmodel`)

A `.bmodel` is versioned JSON (`"format":"burrow.bmodel","version":1`): name, grid size (up to 256 x 256 x 256), a **palette of materials**
(`color #rrggbb`, `emissive` 0..255, `gloss` 0..255, `alpha` 0..255), **named parts** (a part is a rigid bone: `parent`, `pivot`), **attachment points**
(`attach`: a hand, a socket, a light position), the voxel grid (run-length encoded, gzip, base64, with a SHA-256) and the **op list** that built it.
Decoding is strict: unknown fields, a bad version, a wrong checksum, oversize grids and corrupt runs are rejected (`model.Decode` never panics, fuzzed).

Axes: x right, y up, z toward the viewer (Burrow axes). A cell `(x,y,z)` fills `[x,x+1)`. Box corners are inclusive cell coordinates; centres, pivots and
attachment points are **corner coordinates** (`center=[8,8,8]` is the corner shared by the eight middle cells, so `sphere center=[8,8,8] radius=3` is symmetric
in a 16 grid).

### Two ways to send ops

JSON list (`ops`) or the text DSL (`dsl`), one op per line, `op key=value ...`; values are JSON or bare words (`mat=wood`, `min=[0,0,0]`, `colors=[a,b]`);
`repeat count=4 offset=[2,0,0] { ... }` opens a block; `#` starts a comment. `model.ParseDSL` and `model.FormatDSL` round-trip; `editor_model {action:get}`
returns the stored recipe as DSL or JSON.

```
editor_model {"action":"ops","dsl":"size size=[16,16,16]\nmaterial name=wood color=#a67c45\nbox min=[2,0,2] max=[9,5,9] mat=wood"}
```

`ops` is **all or nothing** (one undo step; on error nothing changes and the error names the op index and the valid values). `build` replaces the model by
building it from scratch. `verify` replays the stored ops and compares the result (the determinism check).

### Ops

| op | what it does |
|---|---|
| `size {size:[x,y,z]}` | grid size, <= 256 per axis (content kept, cropped). First op of a model. |
| `material {name,color,emissive,gloss,alpha}` | defines or updates a palette entry (index order = definition order, max 255). `mat` of any op also accepts `#rrggbb`, auto-added. `material {name,rename:new}` renames an entry (index kept); `material {name,remove:true}` deletes it (its voxels are cleared, higher indexes shift down). `material {name,move:n}` moves an entry to the 0-based palette index `n` (voxels are remapped, the model looks the same; drag a swatch in the Palette panel). |
| `use {mat}` | default material for the next ops. |
| `part {name,parent,pivot}` | creates or selects a part; new voxels belong to the active part. `parent` must exist already. `part {name,rename:new}` renames a part (children and attachments follow); `part {name,remove:true}` deletes it (its voxels are cleared, children re-attached to its parent; the root cannot be removed). |
| `attach {name,pos,part,dir}` | a named point. `attach {name,remove:true}` deletes it. |
| `box {min,max}`, `sphere {center,radius}`, `ellipsoid {center,radii}`, `cylinder {center,radius,height,axis}`, `cone {center,radius,height,axis}`, `torus {center,radius,r2,axis}`, `capsule {a,b,radius}` | primitives. A cone's base is at `center`, its apex `height` away (negative flips); a cylinder is centred on `center`; a torus ring lies in the plane perpendicular to `axis` (`radius` = ring, `r2` = tube). |
| `voxel {pos}`, `line {a,b,radius}` | single cell; 3D line between cells (radius > 0 makes it a capsule). |
| `mode` on every shape | `add` (union, default), `sub` (subtract), `and` (intersect: keep only what is inside), `paint` (recolour existing voxels inside). Aliases `union`, `subtract`, `intersect`. |
| `fill {pos,mat}` | flood recolour of the connected region of equal material (`mode:sub` erases it). |
| `extrude {pos,dir,count}` | pushes the face under `pos` out along `dir` (negative `count` carves in). |
| `clear {}` | empties the active part (`all:true`: everything). |
| `mirror {axis,at,side,name}` | copies one side onto the other (default plane: middle of the grid). With `name` the copy becomes a new part (mirrored pivot): left arm to right arm. |
| `array {count,offset,min,max}` | copies the (boxed) content `count` times. |
| `repeat {count,offset,ops}` | runs nested ops `count` times, each shifted by `offset` more (depth <= 4). |
| `translate`, `rotate {axis,turns,center}`, `flip {axis}`, `scale {factor}` | move, rotate by 90 degree turns, mirror in place, grow (2..8) or shrink (-2..-8). Target: active part, `part:"name"`, or `all:true`; `min`/`max` restrict to a box. |
| `hollow {thickness}`, `erode {iter}`, `dilate {iter}`, `smooth {iter}` | remove the inside, shrink, grow, round off (majority filter). |
| `displace {amp,scale,seed,noise,octaves}` | noise displacement of the surface (`noise` value or perlin). |
| `paint {rule,...}` | `all`, `gradient {colors,axis,jitter,seed}` (height bands, low to high), `speckle {mat|colors,density,seed}`, `replace {from,mat}`; `surface:true` only touches exposed voxels. |
| `stamp {pos,size,mats,data}` | writes a copied box of voxels at `pos` (into the active part): `size` is the box, `mats` its material names, `data` the cells as run-length `(count, material index)` pairs (x fastest, then y, then z; index 0 = empty) base64 url-encoded. `StampOp` builds it; it is what Ctrl+C of the editor's model window captures. |
| `layer {name,rename,move,hidden,locked,copy,remove}` | creates a layer on top (`copy:other` starts it as a duplicate; `move:n` puts it at index `n`, 0 = bottom), or renames, reorders, hides, locks or deletes it (the last layer cannot be deleted; variants follow renames and deletions). Every other op takes `layer:"name"` to draw into that layer (default: the first); on `repeat` it applies to the body. See [Layers and variants](#layers-and-variants). |
| `variant {name,layers,rename,move,remove}` | creates a variant or sets the layers it shows; `move:0` makes it the default. |

Determinism: all geometry is integer arithmetic on 1/32-voxel coordinates, noise is fixed-point hashed noise with an explicit `seed`; nothing reads a clock, a
global random generator or map order. Limits (hostile input): grid <= 256^3, 4096 executed ops, repeat depth 4, a global evaluation budget (an op over the whole
grid costs the grid volume), 255 materials, 64 parts, 64 attachments, 1 MiB of ops text, 64 MiB files; floats must be finite and within 512 voxels.

### Layers and variants

A model has ordered **layers** (up to 32, bottom first), each its own voxel grid of the model's size with a material and a part per voxel. They are composited bottom
to top: a filled voxel of an upper layer replaces the one below. Layers are independent of parts (bones): one part can have voxels in several layers. A layer has a
name, a **hidden** flag (editor visibility only: the game ignores it) and a **locked** flag (tools and `ModelApply` refuse edits to it).

A **variant** (up to 64) is a named list of layers shown together. With no variants every layer is shown; the first variant is the default. A campfire:

```
size size=[8,8,8]
material name=wood color=#6b4423
material name=fire color=#ff8a1e emissive=200
box min=[1,0,1] max=[6,1,6] mat=wood
layer name=flame
box layer=flame min=[3,1,3] max=[4,4,4] mat=fire
variant name=off layers=[base]
variant name=on layers=[base,flame]
```

All variants share one frame (the union of their bounds), so switching variant does not move the model. Draw into a layer with `layer:` on the ops. Old files are one
layer called `base`; a model with just that layer is still written in the original format (`version 1`), others as `version 2` (voxels stored per layer, plus
`variants`); both versions are read. `.vox` export (`export_vox {variant}`) flattens the chosen variant; the asset loader gives `render.voxmodel` every variant.

Pick the variant a node shows with `render.voxmodel.variant` (empty or unknown = the default variant). A script switches it at run time, for instance
`field_set(node, "render.voxmodel", "variant", "\"on\"")` (or `entity_set_component`) when a campfire is lit; the new variant is meshed once and cached. In the modeler, the **Layers** tab of
the settings panel lists the layers (eye = hide in the editor, lock, click to make one active; add, duplicate, move up/down, rename, delete) and the variants (a
checkbox per layer, rename, make default, delete, and a **Preview** selector that composites only that variant in the viewport). Tools paint, erase and fill into the
active layer; every layer or variant change is one undo step. `editor_model {action:layer_list}` lists them for an agent (`layers` is the ASCII slice dump).

### Recolor: colour variants without a new file

`render.voxmodel.recolor` (and `character.recolor`) changes palette entries for one instance: `index=#rrggbb[aa]` entries separated by commas, with the 1-based palette indices of the `.vox`, for instance `"3=#c02020,7=#2060d0"` makes the red team and the blue team from one model. The recoloured mesh is built once per combination and cached, so there is no per-frame cost. A script sets it at run time with `field_set(node, "render.voxmodel", "recolor", "\"3=#c02020\"")`. In the editor the inspector shows one colour row per colour the model uses (the 16 most used), with **Reset colours**. It composes with `variant`. A `character` with a built-in model (`humanoid`...) ignores it; use `skin` there.

### Which way a `.vox` faces

MagicaVoxel's front is its -Y side (what its default camera sees). `render.voxmodel` puts that side toward the engine forward (-Z, yaw 0), the same as a `character` made from the same file. There is no option: it is the only convention. A project made before it (`vox_front` absent or `"legacy"`) is converted by `burrow migrate`, which turns its `render.voxmodel` nodes by 180 degrees about Y (and their direct children back) so they look the same. Bounds and editor picking follow the same front. The model editor's own viewport keeps its fixed view.

### Feedback an agent gets

`editor_model` returns **stats** (voxel count, bounds, colours with counts, per-part counts, mirror symmetry per axis for shape and colour, connected pieces and
**floating/disconnected voxels** with their positions) and, for `ops`/`build`/`load`, a **montage image**: front (F), side (S), top (T) and isometric (I) views.
`preview {view,part,yaw,pitch}` renders one view (`part` dims the others: the onion view). `layers` prints the voxels as ASCII layers (top layer first).
**Read the image after every batch**: stats cannot tell you a nose is on the wrong side.

### Scale and size references

A block is one world voxel edge: 1 m at the default world voxel size 1, 0.25 m in a world with 0.25 m voxels. A model stores its **target scale**, `voxels_per_block` (default 16, so one model voxel is 6.25 cm and `render.voxmodel` `scale` is 1/16), optionally with a `kind` hint (`prop`, `character`, `vehicle`, `building`, `item`). Both are optional fields of the `.bmodel` (absent = 16 and no kind) and `Model.PreferredScale()` is the `scale` the model asks for when placed. Metres per model voxel = world voxel size / `voxels_per_block`.

The player is 1.8 m tall (28.8 model voxels at 16 per block), eye line 1.62 m, shoulders 0.6 m; a door is 1 m wide and 2 m high. Typical sizes: character height 1.2-2.5 m, item largest side up to 1 m, prop 0.1-4 m, vehicle 1.5-12 m, building 3-64 m; a model outside its kind's range gets a warning.

In the editor, the Advanced tab of Model Settings has a **Scale** section: voxels per block (drag or 8/16/32/64), the kind, the size in metres, blocks and voxels, the ratio to the player, a "fits a 1 x 2 m door" check and the warnings. Its toggles (also in the viewport menu, Scale references) draw over the viewport: a player silhouette, a one-block cube, a block grid on the floor, rulers along the bounds (metres, blocks, voxels), and a doorway with the 2 m door and 3 m ceiling lines. Changing the scale or the kind is one undo step.

Agents: `editor_model` results carry `dimensions` (voxels, blocks, metres, `player_ratio`, `fits_door`, `warnings`) and `dimensions_text`; the montage draws a blue player figure and a red one-block cube left of and behind the model at the same scale (`no_reference` turns them off). `action: scale` with `voxels_per_block` and/or `kind` sets the target scale; a rebuild keeps it and `spawn` uses it when `scale` is 0.

### Assets, instances, bones

* `save {path}` writes `assets/models/<name>.bmodel` (project relative, confined to the project). `export_vox` / `load` handle MagicaVoxel `.vox` (parts become
  scene-graph nodes and come back as parts with their pivots; palette colours become materials `c<index>`; emissive and gloss have no `.vox` equivalent here).
* `.bmodel` loads through the asset system as the same value as `.vox`, so it works wherever a `.vox` does: the `render.voxmodel` component (props, entities:
  `editor_model {action:spawn}` adds the node, saving again hot reloads it), character models (`"model":"assets/x.bmodel"`) and the animation skeleton
  (`anim.SkeletonFromVox`: each part is a bone with its pivot, `parent` gives the hierarchy, the root part is the skeleton root; docs/animation.md). Model 0
  of the loaded file is the whole model merged (what `render.voxmodel` draws), models 1.. are the parts.
* **Dynamic voxel bodies** (physics3d): `model.SolidMask()` gives the dense occupancy array for `physics3d.VoxelBody`.
* **Block custom shapes**: a 16 x 16 x 16 model gives `BlockBoxes()` / `editor_model {action:block_shape}`: boxes in sixteenths of a block with the axes and
  units of package `shape` (`shape.Box`). Registering a new shape family still means appending to the frozen `shape.Models` table (a source change); the
  boxes are the geometry to put there.
* **Scripts** (read access only): `burrowsdk.SpawnModel("assets/models/crate.bmodel", 0, burrowsdk.SpawnOpts{...})` spawns a node showing the asset by name. It
  is sugar over `Spawn` with a `render.voxmodel` component: no new host call, the script reads nothing, the sim is unaffected.

**In the editor** the model editor is a docked panel (Unreal-style asset editor): Tools > Model editor, or double-click a `.bmodel` / `.vox` in the Content browser,
opens the **Model** panel in the dock (a tab next to the Viewport), with **Model settings** on the right and the Content browser below as the content browser. The panel has
one header row (document name with an unsaved dot, Save, undo/redo, the Iso / Front / Side / Top views, Frame, and the ⋯ menu), the tool rail on the left with each tool's
key on its button (B place, E erase, C paint, X box, O sphere, L line, F fill, T extrude, S select) and the viewport in the middle. Model settings has three tabs:
**Palette** (the material grid with number keys, double-click a swatch for its colour picker, a Recent row, the selected material's name, colour, emissive and gloss, then the options of the active tool: Add or Carve for the
shapes, brush size, mirror, *Stay on the start plane*, slice), **Parts** and **Advanced** (file, selection, modifiers, recipe, model info). The viewport is a real 3D render
(perspective by default, orthographic with the header's Persp / Ortho switch or P; the picking uses the same camera; daylight lighting) when a GPU is available, with the software render as fallback. Save writes the asset path directly (Ctrl+S);
New and Save-as are inline forms in Model settings (New also offers the embedded templates crate / lantern / tree / creature), Open is the Content browser — no modal
dialogs. A separate OS window is still available (right-click the asset > "Open in a separate window", or Window > New window; `burrowedit -tool model -project <dir>
-asset <file>`, a second process that saves into the project and the editor picks the saved file up).

| input | action |
|---|---|
| left click, left drag | use the tool (place, erase and paint drag as one stroke, held to the plane it started on unless *Stay on the start plane* is off); a ghost voxel in the material colour shows where a voxel will land, and with brush > 1 the real brush sphere is drawn |
| drag (box, sphere, line, select) | draw the shape live from one end to the other, its size shown next to the pointer; it is placed when the pointer is released. In the docked panel a **Box on a flat footprint takes a second step**: move the pointer up to set the height, click to place, Esc cancels. A click without dragging sets the first corner of the two-click workflow instead. **Hold Shift (or choose Carve) to carve instead of add** |
| right drag, Alt + left drag | orbit (Alt + drag for trackpads); the preset views animate |
| P | switch between the perspective and orthographic camera |
| orientation cube (bottom left) | click X, Y or Z to look along that axis; click it again for the opposite side |
| middle drag, Shift + right drag, Space + left drag | pan |
| wheel | zoom toward the pointer |
| 1 to 9 | pick a material (or click a swatch; Alt + click a voxel picks its material) |
| Home | isometric view (also Front, Side, Top, Back, Left, Right, Bottom in the View menu) |
| Shift+F | frame the selection (or the hovered cell) in the viewport |
| Shift+X / Y / Z | toggle the mirror plane of that axis |
| Ctrl+A | select the whole grid |
| Ctrl+C, Ctrl+V | copy the selection; then a ghost of the copy follows the pointer and the next click drops it (Esc cancels) |
| Esc | cancel the first click of a two-click tool, a paste or a gizmo drag, clear the selection |
| Delete | delete the selection |
| + / - | brush size |
| Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+N | undo, redo, save, save as, open, new |

Menus: the tool window's menu bar has **File** (New..., *New from template* ▸ crate/lantern/tree/creature, Open, Save, Save as, Export .vox), **Edit** (undo/redo, Select all, Copy/Paste/Delete selection, brush size +/−), **View** (presets, Frame selection, Reset zoom and pan, mirror, slice, onion, hide part) and **Help** (keyboard shortcuts). The docked panel exposes the same entries in its **⋯ header menu**, and the viewport opens the same menu on a **right click without drag** (a right drag still orbits). In the main editor, *Tools > Model editor* opens the panel and also offers New from template and Open in a separate window; the Content browser's right-click menu on a `.bmodel` / `.vox` adds **Spawn in scene at focus** and **Export .vox**, and *New > New voxel model from template* starts from a template.

With the Select tool, the selection shows a **move gizmo**: drag one of its three coloured axes to translate the selection (one undo step). The **Modifiers** panel
applies the engine's procedural ops to the selection (or the whole model without one), each one undo step: Hollow (thickness), Smooth / Erode / Dilate (iterations),
Displace (noise amp, scale, seed), Paint gradient (from/to material, axis) and speckle (density), mirror fix (copy one half onto the other), and Array (duplicate the
selection N times with an offset). The **Palette** panel shows the usage count of each material, renames (name field) and deletes (Delete button or right-click a swatch)
entries. The **Parts** panel renames and deletes parts and edits the **attach points** (add one at the hovered cell). The **Model** panel resizes the grid (content kept,
cropped if smaller) and shows the stats; the **Recipe** panel shows the stored op list (DSL) that rebuilds the model byte for byte. The status bar shows the active tool,
brush, mirror planes, selection and zoom at a glance, and an empty model shows its shortcut hints in the viewport itself.

Mirror X, Y and Z (the tool options) mirror every edit across the middle plane of the grid; the planes are drawn in the viewport while they are active. The **Slice**
buttons (the tool options or View menu) cut the model along an axis to reach the inside: the slider keeps the first N layers, the cut plane is drawn in the viewport and
picking ignores the cut cells, so you edit the exposed interior directly. The view draws the floor grid and axes, and renders at half resolution while you orbit,
pan or stroke so the view stays smooth on big models. Every stroke is one step of the window's undo history and appends an op to the recipe. Model edits

Mirror X, Y and Z (options bar) mirror every edit across the middle plane of the grid; the planes are drawn in the viewport while they are active. The **Slice**
buttons (options bar or View menu) cut the model along an axis to reach the inside: the slider keeps the first N layers, the cut plane is drawn in the viewport and
picking ignores the cut cells, so you edit the exposed interior directly. The view draws the floor grid and axes, and renders at half resolution while you orbit,
pan or stroke so the view stays smooth on big models. Every stroke is one step of the window's undo history and appends an op to the recipe. Model edits
are not part of the simulation hash.

## Textures

`editor_texture` edits one texture at a time: block textures 16 x 16 .. 128 x 128 (square or not), item icons, with layers. Ops are JSON:

| op | what it does |
|---|---|
| `size {count}` or `{w,h}` | texture size (4..128). First op. |
| `palette {name,color}` | names a colour; any colour field accepts `#rrggbb`, `#rrggbbaa`, `transparent` or a palette name. |
| `lock {colors}` | palette lock: every later op snaps its result to these colours (no `colors` = unlock). |
| `fill`, `clear`, `erase {rect|points}` | `rect` is `[x,y,w,h]`, optional on most ops. |
| `gradient {from,to,dir,count}` | `dir` v, h, d (diagonal) or r (radial); `count` > 1 makes bands. |
| `noise {kind,seed,scale,colors|from,to,octaves,count,strength}` | value or perlin noise mapped to a colour ramp. **Periodic**: it tiles seamlessly. |
| `dither {from,to,kind,dir|strength}` | ordered dither (bayer4, bayer2, checker) between two colours along a gradient or at a constant level. |
| `speckle {colors,density,seed}` | random pixels. |
| `pattern {kind,colors,mortar,seed,...}` | `bricks` (bw, bh, gap), `planks` (bh), `cobble` (cell), `ore` (count, depth), `grass_edge` (depth), `checker`, `stripes`. Sizes must divide the texture to tile (the error tells you which). |
| `ascii {grid,legend,pos}` | draw from a character grid; `.` and space are transparent unless the legend says otherwise. `editor_texture {action:ascii}` dumps the current pixels in the same format. |
| `pixel`, `line`, `rect {hollow}`, `ellipse {hollow}`, `flood {pos,color,tolerance}`, `replace {from,to,tolerance}` | pixel tools. |
| `outline {kind,color}` | `outer`, `inner`, `both` or `border` (tile edge). |
| `shade {kind,amount}` | `edges` (light from the top left), `bevel` (tile border), `relief` (luminance steps read as height). |
| `hue {deg,sat,light}` | hue shift and saturation / lightness percent. |
| `seamless {amount}` | cross-fades the shifted copy so the borders match. |
| `quantize {colors,kind:bayer,strength}` | nearest-palette (optionally dithered). |
| `offset {dx,dy}`, `flip {dir}`, `rotate {count}` | wrap shift, mirror, quarter turns. |
| `layer {action,name,opacity,visible,locked,kind}` | `new`, `duplicate`, `select`, `delete`, `merge_down`, `opacity`, `visible`, `lock` (`locked`: a locked layer refuses drawing ops), `blend` (`kind`: `normal`, `multiply`, `screen`, `overlay`). Ops draw on the active layer. |

Limits: 128 x 128, 2048 ops, 8 layers, 1 MiB PNG, 128 x 128 ASCII cells. The same ops always give the same PNG bytes.

Feedback: `ops` returns the texture **tiled 3 x 3** (read the seams), a **block-in-world render** (3 x 3 blocks with a pillar, isometric; give `top`/`side`/`bottom`
texture names to see a real block), the **mip chain**, and stats: colours and counts, transparent pixels, wrap-around steps (`seam_error_h/v`) against the
largest interior step and `tileable_h/v`. A grass side texture is meant to tile horizontally only.

### Saving: the project override layer

`save {kind:block,name:"cobblestone"}` or `save {block:"grass_block", face:"side"}` writes `<project>/textures/block/<texture>.png` (and the recipe
`<texture>.texops.json` beside it). `block`+`face` resolves the pack texture name that face samples, so the override replaces exactly it (a texture shared by
several blocks changes all of them). The bundled third-party pack (Pixel Perfection CC-BY-SA) is **never modified**: overrides live in
the project, win over the pack, and are resampled to the pack size (16) because the layer table has one size (the PNG keeps its resolution). The running
game (editor Play, `burrow run`) rebuilds its block texture layers on the next frame (`blocktex.OverrideGeneration`); `burrow build` packs only the folders listed in `asset_dirs` of `vox.project`: add `"textures"` there to ship the overrides. Item icons go to `textures/item/`. Tinted textures (grass top, leaves) are gray luma in the packs and biome tinted at render time.

**In the editor** the texture editor is a window of its own (Tools > Texture Editor, or double-click a `.png` in the Content browser; `burrowedit -tool texture
-project <dir> -asset <file>`). Tools are on the left (B pencil, E eraser, L line, R rectangle, O ellipse, F fill, A replace colour, I picker, G gradient, plus
the Hollow toggle for rectangle and ellipse, mirror left-right and top-bottom and the primary / secondary colours), the canvas takes the middle and the colours,
layers, previews, generators and relief maps are on the right.

A **block texture has three faces**: the side is the main picture, the top and the bottom are drawn only when they differ (the header's Face
selector; a new face starts as a copy of the side). Save writes `<name>.png`, `<name>_top.png` and `<name>_bottom.png` (the packs' naming), open reads them
back, and undo goes back to the face it was made on. Layers can be hidden, locked (drawing tools refuse a locked layer) and blended (normal, multiply,
screen, overlay) with an opacity.

| input | action |
|---|---|
| left button, right button | draw with the primary, the secondary colour |
| Alt + click | pick the colour under the pointer (any tool) |
| wheel | zoom toward the pointer (the pixel grid shows from 6x) |
| middle drag, Space + drag | pan |
| 0 or Home, + / - | fit to the window, zoom |
| X | swap the primary and secondary colours |
| Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+N | undo, redo, save, save as, open, new |

**One-click styles** (Generate panel): pick a style (Stone, Planks, Bricks, Cobble, Metal, Grass, Sand, Ore, Fabric), a seed and a base colour, press Generate:
the layer is cleared and rebuilt by a curated op stack (pattern, periodic noise, speckle, shading, seamless) as one undo step, the whole "patron" of a block texture.
**From a 3D model**: pick a `.bmodel` or `.vox` of the project and press Import: its material palette (most used first) fills the swatches and the primary /
secondary colours, so the styles match the model they will sit next to. The pattern steps always divide the texture size, so the tiled styles tile by
construction; `texedit.StyleOps` builds the same stacks programmatically.

Strokes are filled in between mouse samples, so a fast drag leaves no gaps, and each stroke is one undo step. The brush size (pencil and eraser) goes up to 8.
A texture made with New saves to `textures/<block|item>/<name>.png` (the override layer above); a `.png` opened from the Content browser saves back to that file.
File > Save to a block face writes the texture over the one a block uses on a face. The status bar shows the pixel and colour under the pointer.

## Examples (generated by these ops, original work)

Each one is in `docs/examples/`; the tests build every file twice and require identical bytes. Montages: `MODEL_MONTAGE_DIR=/tmp/m go test ./model -run Montages`.

### Tree

```
# Oak-like tree, 24x32x24. Trunk, three leaf blobs, noise-eroded crown, speckled leaves.
size size=[24,32,24]
material name=bark color=#6b4423 gloss=10
material name=bark_dark color=#4e3118
material name=leaf color=#3f8f2f
material name=leaf_light color=#62b341
material name=leaf_dark color=#2c6a22
part name=trunk pivot=[12,0,12]
use mat=bark
cylinder center=[12,7,12] radius=2.5 height=14 axis=y
cone center=[12,0,12] radius=4 height=5 axis=y
capsule a=[12,13,12] b=[7,18,12] radius=1.3
capsule a=[12,14,12] b=[17,19,13] radius=1.3
paint rule=speckle colors=[bark,bark_dark] density=0.35 seed=7
part name=crown parent=trunk pivot=[12,16,12]
use mat=leaf
ellipsoid center=[12,22,12] radii=[8,6.5,8]
ellipsoid center=[6,19,12] radii=[4.5,3.5,4.5]
ellipsoid center=[18,20,13] radii=[4.5,3.5,4.5]
ellipsoid center=[12,27,11] radii=[4.5,3,4.5]
displace amp=1.6 scale=3.5 seed=3 noise=perlin
erode iter=1 
smooth iter=1
paint rule=gradient colors=[leaf_dark,leaf,leaf_light] axis=y jitter=0.8 seed=5
paint rule=speckle mat=leaf_dark density=0.12 seed=11
attach name=top pos=[12,31,12] part=crown
```

### Crate

```
# Wooden crate, 16x16x16: frame, planks, corner studs, hollow inside, a lid line.
size size=[16,16,16]
material name=plank color=#b5854a
material name=plank_dark color=#8f6636
material name=frame color=#6d4a24
box min=[1,0,1] max=[14,13,14] mat=plank
box min=[2,1,2] max=[13,12,13] mode=sub
box min=[2,12,2] max=[13,12,13] mat=plank_dark
paint rule=speckle colors=[plank,plank_dark] density=0.3 seed=2 from=plank
box min=[1,0,1] max=[2,13,2] mat=frame
box min=[13,0,1] max=[14,13,2] mat=frame
box min=[1,0,13] max=[2,13,14] mat=frame
box min=[13,0,13] max=[14,13,14] mat=frame
box min=[1,0,1] max=[14,1,14] mat=frame mode=paint
box min=[1,12,1] max=[14,13,14] mat=frame mode=paint
box min=[1,6,1] max=[14,7,14] mat=frame mode=paint
```

### Lantern with an emissive core

```
# Lantern with an emissive core (emissive=255 glows), hanging from a ring. 12x16x12.
size size=[12,16,12]
material name=iron color=#2e2e36 gloss=90
material name=glass color=#ffd36a alpha=140 emissive=120
material name=flame color=#fff3b0 emissive=255
part name=lantern pivot=[6,16,6]
use mat=iron
box min=[3,0,3] max=[8,1,8]
box min=[3,10,3] max=[8,11,8]
box min=[3,1,3] max=[3,9,3]
box min=[8,1,3] max=[8,9,3]
box min=[3,1,8] max=[3,9,8]
box min=[8,1,8] max=[8,9,8]
box min=[4,11,4] max=[7,12,7]
torus center=[6,12.8,6] radius=1.9 r2=0.9 axis=z
box min=[4,1,4] max=[7,9,7] mat=glass
box min=[5,2,5] max=[6,6,6] mat=flame
attach name=light pos=[6,5,6] part=lantern
```

### Animated creature with bones

Parts are bones: `body` is the root, `head`, `tail` and the legs are children (the right legs are `mirror ... name=leg_fr part=leg_fl` copies). Load it as a
skeleton with `anim.SkeletonFromVox` (or a `character` with this model) and animate the bone names in an `.anim` clip (`docs/animation.md`).

```
# Simple animated creature: every part is a bone (body > head, tail, four legs). 24x20x28, faces +z (toward the viewer).
size size=[24,20,28]
material name=fur color=#c98a4b
material name=belly color=#ecd2a4
material name=dark color=#3b2a1c
material name=eye color=#ffffff emissive=40
material name=pupil color=#111111
part name=body pivot=[12,9,14]
use mat=fur
ellipsoid center=[12,10,14] radii=[5,4,8]
box min=[9,6,8] max=[14,6,19] mat=belly
part name=head parent=body pivot=[12,12,21]
sphere center=[12,13,22] radius=3.6
box min=[10,11,25] max=[13,12,27]
box min=[9,16,21] max=[10,18,22]
box min=[14,16,21] max=[15,18,22]
voxel pos=[10,14,25] mat=eye
voxel pos=[13,14,25] mat=eye
voxel pos=[10,14,26] mat=pupil
voxel pos=[13,14,26] mat=pupil
voxel pos=[11,12,27] mat=dark
voxel pos=[12,12,27] mat=dark
part name=tail parent=body pivot=[12,11,6]
capsule a=[12,11,5] b=[12,16,1] radius=1.2 mat=fur
voxel pos=[12,17,1] mat=belly
part name=leg_fl parent=body pivot=[9,6,18]
box min=[8,0,17] max=[9,5,18] mat=fur
box min=[8,0,17] max=[9,0,18] mat=dark
part name=leg_bl parent=body pivot=[9,6,8]
box min=[8,0,7] max=[9,5,8] mat=fur
box min=[8,0,7] max=[9,0,8] mat=dark
mirror axis=x name=leg_fr part=leg_fl
mirror axis=x name=leg_br part=leg_bl
attach name=mouth pos=[12,12,27] part=head dir=[0,0,1]
attach name=saddle pos=[12,14,14] part=body dir=[0,1,0]
```

### Textures

Send each list as `editor_texture {"action":"ops","ops": <list>, "name":"..."}`.

Cobblestone:

```json
[
 {"op":"size","count":16},
 {"op":"fill","color":"#6e6e6e"},
 {"op":"pattern","kind":"cobble","cell":4,"seed":12,"colors":["#8a8a8a","#7a7a7a","#969696","#6f6f72"],"mortar":"#4a4a4c"},
 {"op":"noise","kind":"value","seed":3,"scale":3,"from":"#00000000","to":"#00000000","strength":0.1},
 {"op":"speckle","colors":["#5c5c5c","#a4a4a4"],"density":0.08,"seed":9}
]
```

Planks:

```json
[
 {"op":"size","count":16},
 {"op":"pattern","kind":"planks","bh":4,"seed":5,"strength":0.5,"colors":["#a67c45","#b08650","#9c7440","#ad8049"],"mortar":"#5e4220"}
]
```

Ore (gold in stone):

```json
[
 {"op":"size","count":16},
 {"op":"fill","color":"#7d7d7d"},
 {"op":"noise","kind":"perlin","seed":21,"scale":5,"colors":["#707070","#7d7d7d","#8a8a8a"],"octaves":2},
 {"op":"speckle","colors":["#6a6a6a","#909090"],"density":0.07,"seed":4},
 {"op":"pattern","kind":"ore","seed":8,"count":6,"depth":3,"colors":["#d8a02a","#f2cf5a"],"mortar":"#5a4a22"}
]
```

Grass top and side (save with `block:"grass_block"`, `face:"top"` / `"side"`):

```json
[
 {"op":"size","count":16},
 {"op":"noise","kind":"perlin","seed":2,"scale":4,"octaves":2,"colors":["#4f8f2a","#62aa35","#74bd42"]},
 {"op":"speckle","colors":["#3e7a20","#86cf50"],"density":0.1,"seed":6},
 {"op":"seamless","amount":60}
]
```

```json
[
 {"op":"size","count":16},
 {"op":"noise","kind":"value","seed":14,"scale":4,"colors":["#7a5230","#866038","#6d4828"]},
 {"op":"speckle","colors":["#5a3a1e","#97703f"],"density":0.1,"seed":15},
 {"op":"pattern","kind":"grass_edge","seed":33,"depth":3,"colors":["#74bd42","#62aa35","#4f8f2a"]}
]
```
