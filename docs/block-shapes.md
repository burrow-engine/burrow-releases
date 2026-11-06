# Block shapes (stage B2)

Phase 2 of the Minecraft block set: the blocks that are not full cubes. B1 ([blocks.md](blocks.md)) gave 338 cubes; B2 adds slabs, stairs, walls, fences,
fence gates, doors, trapdoors, pressure plates, buttons, carpets, snow layers, glass panes and iron bars, torches, ladders, vines, cross plants (flowers, grasses,
saplings, mushrooms, corals), two-block tall plants, the cactus and the lily pad: 254 palette items, 1109 registry blocks. It is opt-in (`runtime.blocks: "shapes"`).

## Design: what is the state of a block?

Constraint: ids, hashes, goldens, journals and worlds of every project without the opt-in must not change, and the registry must not explode.

Options evaluated:

| option | chunk format / hash / journal / undo / `.voxworld` | verdict |
|---|---|---|
| a state field stored beside the 16-bit id (id + 4..8 bits) | every layer changes: chunk palette/RLE, `StateHash` overlay, `Change`/`SetBlock`, diff, snapshot, journal JSON, undo, `.voxworld`, wire protocols | rejected: touches the frozen formats of all projects |
| one id per stored state, generated from compact data | nothing changes: `BlockID` stays `uint16`, a `SetBlock` is still `(pos, id)`, the palette-compressed chunk, hash, journal, undo and `.voxworld` carry it as any block | **chosen** |
| derived state stored too (fence connections: 16 states, stair corners: 5 shapes, wall posts) | 16-fold or 5-fold id growth for no information the neighbours do not already hold | rejected: derived at meshing/collision time |

Chosen model:

* **Stored state = registry id.** The states a player chooses (stairs: 4 facings x 2 halves; slab: bottom/top; door: 4 facings x 2 halves x 2 hinges x open;
  trapdoor, gate, torch, button, ladder, vine, snow layers 1..7, tall plant lower/upper) are separate registry blocks. 1109 ids = 1.7 % of the 65536 space, assigned
  after the extended set, **append-only** (`blockset/testdata/shape_ids.golden` fails when one moves). The id of a state is a pure function of the order
  of `blockset/shapes.json` (the items, generated, appended alphabetically) and of the frozen state order of package `shape` (loops in `shape/catalog.go`).
* **Names.** The default state keeps the bare item name (`oak_stairs`: facing north, bottom), every other state is `oak_stairs[facing=east,half=top]` (props
  in the family's fixed order). So `set_block`, scripts, MCP and the palette work with the bare names; `blockset.Resolve`/`StateName` map (item, props) to a block.
* **Derived state is never stored.** Stair corner shapes (straight, inner left/right, outer left/right; the vanilla rule), fence/wall/pane connections (a 4-bit mask;
  walls also decide their post) are computed from the horizontal neighbours by `shape.Model.Key`, in the mesher (from the padded chunk), in collision and in
  raycasts (from the reader). It is a pure function of the neighbours, so it is canonical; an edit already re-meshes the chunks around it (the streamer re-meshes
  the neighbours of a changed voxel), so connections and corners update with no extra bookkeeping.
* **Hash/format impact.** Zero without the opt-in: no block is registered, `voxel.Block.Shape` is omitted from JSON when 0, `Registry.HasShapes()` is false and
  every shape-aware path falls back to the old code. With the opt-in a world is a normal world of more ids: snapshot, restore, replay, undo and `VerifyReplay` need nothing new.
* **Existing ids that change model.** Under `shapes` the generator-v2 plants (`flower_red/yellow/white/blue`, `mushroom_red/brown`, `tall_grass`, `dead_bush`) and `cactus`
  keep their id and become cross plants / a cactus (`Registry.Update`: not solid, fragile; cactus solid). Worlds are unchanged, only the model of the cell changes.

* **Behaviour change when moving a v2 world from `extended` to `shapes`.** The StateHash does not hash the registry, and `Registry.Update` changes
  attributes of existing ids: the v2 plants (`flower_*`, `mushroom_*`, `tall_grass`, `dead_bush`) stop being solid cubes (they become walk-through and fragile) and the
  `cactus` stops being opaque. The world data and its hash are identical but collision, raycast and rendering are not: the physics of an existing world changes with the level.
* **Registry fingerprint (guard).** `voxel.Registry.Fingerprint()` hashes, in id order, name, Solid, Opaque, Fragile, Liquid and Shape of every block. It is not part of any
  state hash (existing hashes and goldens are unchanged). The first journal entry carries it (`registry_id`) and `sim.ReplayWith` refuses a journal recorded with another
  registry ("replay registry mismatch"); snapshot restore compares every block of the registry and reports both fingerprints. Journals written before the field skip the check.
* **Two-block plants and water.** Flowing water destroys the fragile lower half; `blockset.InstallShapes` (used by the `shapes` level) adds the `shapes.support` system, which removes the upper
  halves left floating. Only overlay chunks (where water wrote) are examined, plus the y=0 layer of the chunk above each of them (halves split across a vertical chunk border; that chunk may be base
  terrain). A chunk is examined every 32 ticks at a phase that is a pure function of its position, so the work per tick is bounded and the result depends only on the tick and the hashed world
  (replay and snapshot restore remove the same cells at the same ticks; the system is not journaled). Maximum latency 32 ticks (1.6 s). Measured cost: 13.9 ms per tick in a synthetic pathological case
  (3750 overlay chunks each holding an upper half, radius 12 x 6 layers), about nothing in a world with no overlay chunk. `fluid/` is untouched.

## Geometry data (package `shape`)

`shape.Model` is one stored state: family, decoded props (`Facing`, `Top`, `Open`, `Right`, `Layers`), a `Derive` kind and `Variants` (1, 5 for stairs, 16 for connections). A `shape.Variant`
holds the **collision boxes**, **selection boxes** (when different: fences select 1.5 high, flowers a small box, ladders a thin one) and the **render quads**, in sixteenths of a block. Quads are
generated from boxes by `shape.BoxQuads` (faces and parts of faces hidden inside or behind sibling boxes are removed, so there are no coplanar duplicates:
`TestNoCoplanarOverlap`) or authored (cross planes, ladders, vines, double sided). Each quad carries the texture **slot** (which face texture of the block), the lighting face, the UV window (texture
coordinates are the block-space position of the quad: a slab side shows the lower half of the image, a torch the middle pixels: no stretching) and `Cull`, the cell face it lies on.
`Variant.Cover` is a 16x16 bitmap per face of the area covered with opaque material (used for culling). Tables are Go data built at init in a fixed order (no map iteration), the items are JSON.

## Meshing

* `mesh.Mesh.Fine` (set on both meshes of a chunk that contains at least one shaped cell): vertex positions in sixteenths (0..512, int16) and UVs in sixteenths of a texture; merged
  cube quads are capped at 15 blocks so a UV still fits the byte of the 16-byte vertex. Chunks without shaped blocks are bit-identical to before.
* Cubes: a shaped neighbour never occludes (AO unchanged), but hides the cube's face when its `CoverAll` (the part covered by every derived variant) covers the face.
* Shaped cells: appended in z, y, x order to the transparent mesh (alpha-tested like leaves; glass panes go to the blended range by name). A quad on a cell face is dropped when the neighbour is an opaque
  cube or a shaped block whose covered bitmap contains the quad. So a slab does not hide the cube above it, a stair hides half of what is behind it, two slabs side by side lose their touching faces.
* Light: block light of a shaped quad is the light of its cell (and of the open neighbour for boundary quads); shaped cells are non-opaque for the flood fill, so torch light and sky pass.
* Tint: the biome tint of the cell column applies to grass, ferns, tall grass, vines and foliage plants through the usual tint/biome tables.
* AO is 3 (none) on shaped quads and shaped blocks do not occlude neighbours' AO: documented limitation.

## Renderers

* Vulkan: `chunkGPU.fine` sets `pc.b.x = 1`; `voxel.vert`, `water.vert`, `shadow.vert` and `shadowcut.vert` scale positions (and UVs) by 1/16 for such chunks. The `.spv` files are rebuilt with `make shaders`.
* Soft (`-shaders off`, the reference): a `kShape` cell is ray-traced against the quads of its variant with the same UVs and cut-out rule (`render/soft/shapes.go`).
  Limitation: shaped cells do not cast shadows in the soft renderer.

## Physics and interaction

* `voxel.MoveAABB`, `Overlaps` and `Raycast` become shape-aware automatically when the reader knows a registry with shapes (`ChunkMap.SetShapeRegistry`, set by `sim`; `View` and the editor reader implement `voxel.ShapeSource`).
  Multiple boxes per cell, fences are 1.5 high, plants/torches/carpets/plates/buttons have no collision. `Hit.Point` is the exact entry point; the normal is the face of the sub-box.
  The controller (`app`) steps up one block (`Config.StepHeight`, default 1.05), so stairs are ramps and never need a jump; the physics character steps by `StepHeight` too.
* Placement (`blockset.Place`, used by the editor place tool and the game controller): stairs face the camera, slab/trapdoor half from the face and the hit point, doors are two blocks (refused without
  headroom), wall torches/buttons/ladders/vines from the clicked face (a torch cannot hang from a ceiling), snow layers stack. Nothing is stored beyond the ids: the undo step of a door is both halves.
* Interaction: `blockset.Toggle` / `Editor.Interact` / MCP `editor_interact {pos}` open or close doors (both halves), trapdoors and gates as one undoable journaled edit (plain `SetBlock`s).
* Water (`fluid/`, untouched): cross plants, torches, ladders, carpets, snow layers, plates, buttons and vines are `Fragile` (flow destroys them); slabs, stairs, fences, doors, panes block like walls.

## Where things are

`shape/` (models), `blockset/shapes.json` + `shapes.go` + `place.go`, `scripts/genshapes`, `mesh/shapes.go`, `voxel/shapes.go`, `render/soft/shapes.go`, `assets/blocktex/mcshapes.go` (images),
`assets/blockicon/shape.go` (isometric icons), `character/held.go` (held shapes), `engine/gallery_shapes.go`.

## Visual check

`docs/img/blocks-shapes-gallery.png` (`go run ./examples/voxel_sandbox -gallery-shapes -textures pixelperfection -look natural -freeze -nohud -radius 4 -frames 3 -w 1800 -h 1000 -cam 14,52,17,0,-40`, second half `-cam 43,52,17,0,-40`)
and `docs/img/worldgen-meadow-shapes.png` (before: cubes; after: cross plants; `-gen v2 -seed 1 -cam 34,66,-22,0,-30`, `-shapes` for the right half).
Honest defects: see the end of this page.

## Limits and known defects

* Wall torches are straight boxes (no 22.5 degree tilt shear beyond a lean); trapdoor, fence and door textures are the block-space window of the planks image (no vanilla crop).
* Corner stairs: neighbours that are themselves corner variants are seen as straight ones by the culling bitmap (conservative: never a hole, sometimes a hidden face drawn).
* Ladders do not climb (no physics), vines have one stored face per state (no multi-face vines), no double slabs (use the cube), no waterlogging, no banners, beds, signs, candles, lanterns, chains, rails, crops.
* Animated textures (lantern, kelp, seagrass) show frame 0.
* The soft renderer has no shadows from shaped blocks and no AO on them.
