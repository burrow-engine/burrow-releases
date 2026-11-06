# Blocks (extended set)

The engine ships a **small neutral block set** (the 47 classic blocks plus about twenty building blocks and a few shaped ones: cobblestone, stone bricks, planks, glass,
metal and wool blocks, torch, slabs, stairs, fences, doors, ladder, glass pane). The **full Minecraft catalog** (338 full cubes and about 230 shaped items) is an optional
content pack, `minecraft`, that a project enables explicitly; it pairs with the Pixel Perfection CE textures (see [texture-packs.md](texture-packs.md)). The default textures are the
engine's own neutral pack, generated in code: nothing from the Mojang game or a third-party texture pack is used unless a project asks for it.

### Behaviour is data

Core code never looks at block names. Light, heat, fluids and wind read explicit `voxel.Block` properties, set by the block definition (`blockset/*.json` and `runtime.custom_blocks`):
`emit`, `emit_color` (light), `heat` (haze), `light_loss` (per channel), `translucency` (`foliage`: leaves, absorb 1 per channel and sway; `tinted`: stained glass keeps its colour),
`fluid` (`water` flows with the water rules, level `liquid`, a source by default; `lava`), `fragile`. A custom block named `dice` is not ice, one named `leaves` does not sway,
one with `"fluid": "water"` flows. Lava cooling results are `fluid.Config.CoolSource/CoolFlow/CoolWater` (default obsidian, cobblestone, stone).

## Project registry: the blocks stay in the project

A project can keep its **own copy of the block registry** so that no engine release changes its blocks:

```sh
burrow blocks export                      # writes blocks/blocks.json + blocks/shapes.json, sets runtime.block_registry
burrow blocks export --pack minecraft     # the same, with the full Minecraft catalog included
burrow blocks packs                       # the optional packs this engine carries
```

`burrow new` does this for every new project. With `runtime.block_registry` set, the project's files ARE the registry: the engine's
own blocks and the packs are not used, file order is id order, and each entry has the format of `blockset/blocks.json`
(properties, palette data, family). `runtime.custom_blocks` are still appended after it. The folder ships with `burrow build`.
Without it, `runtime.block_packs` (for example `["minecraft"]`) chooses the packs on top of the neutral set. `burrow migrate` adds
`["minecraft"]` to projects made before 0.7, when that catalog was built in.

Edit the copy freely (a block renamed or reordered there is your decision); `burrow blocks export` refuses to overwrite it without
`--force`.

**Maps are matched to the registry by block name.** A `.voxworld` lists the blocks it was written with, in the order of its own
registry; opening it renumbers its chunks to the project's ids, so a map made with another engine version, other packs or another
generator still opens. Only a block the registry does not have at all is an error, and the message names it.

## Opt in, ids

The neutral set is data: `blockset/blocks.json` and `blockset/shapes.json`; the Minecraft pack is `blockset/packs/minecraft/{blocks,shapes}.json` (all committed, described by package `blockset`). A program
enables packs with `engine.VoxelWorldPlugin{BlockPacks: []string{"minecraft"}}` (or `blockset.SetPacks`); their blocks are appended after the neutral set, in order. Since `runtime.blocks: "shapes"` is the only supported value, every project gets it (new projects from `burrow new` are created with `"blocks": "shapes"` and `"texture_pack": "pixelperfection"`; `"classic"` and `"extended"` are **deprecated**, still accepted and resolved to `"shapes"`). A program
passes `engine.VoxelWorldPlugin{ExtendedBlocks: true}` or calls `blockset.Register(registry)` last. Old projects without the field or with `classic`/`extended` now get the shaped registry: ids of the extended set are unchanged, but worlds, journals and hashes of classic projects change.

Registration order = ids and is frozen: `defaults (7: stone dirt grass sand water wood leaves)`, generator v2 blocks (33), water levels `water_1..7` (ids 1..47, "core"), then the extended
blocks in the order of `blocks.json` (ids 48..385 in a v2 world with water). The set is registered by a *late* setup hook (`App.OnSimSetupLate`) so nothing registered by other plugins moves.
`blockset/testdata/ids.golden` freezes every id; the test fails if one moves, new blocks may only be appended (`go test ./blockset -update` after appending).

## Shapes (level `shapes`, stage B2)

`"runtime": {"blocks": "shapes"}` is the extended set plus the non-cubic shapes: the default and the only supported level. Engine: `engine.VoxelWorldPlugin{ShapedBlocks: true}` or `blockset.RegisterShapes(reg)`.
`burrow new` and the editor scratch session use `shapes`.

Every stored state is its own registry block, appended after the extended set: about 1109 new ids for about 254 items (slabs, stairs, walls, fences, fence gates, doors, trapdoors,
pressure plates, buttons, carpets, snow layers, glass panes and iron bars, torches, ladders, vines, cross plants (flowers, grasses, saplings, mushrooms, corals), tall plants, cactus, lily pad).
The default state carries the bare item name (`oak_stairs`), the others the state in brackets (`oak_stairs[facing=east,half=top]`). Neighbour-derived state (stair corners,
fence, pane and wall connections) is computed at meshing and collision time and never stored.

Models live in package `shape` (boxes in sixteenths, quads); `blockset/shapes.json` is generated by `go run ./scripts/genshapes`. `voxel.Block.Shape` links a block to its model.
`voxel.MoveAABB`, `Overlaps` and `Raycast` become shape-aware when the registry has shaped blocks (`ChunkMap.SetShapeRegistry`); `voxel.Hit.Point` is the exact hit point.

The mesher gives chunks that contain shaped blocks `mesh.Mesh.Fine` meshes (positions and UVs in sixteenths; the shader push constant `pc.b.x=1` scales by 1/16); other chunks are
unchanged. The soft renderer ray-traces the shape quads. Under this level generator v2 flowers, mushrooms, tall grass and dead bush become cross plants, and cactus a real cactus (ids unchanged).

Editor: placement orients shaped blocks from the face, point or camera (`blockset.Place`); `Editor.Interact` toggles doors, trapdoors and fence gates (`blockset.Toggle`).
A right click (without sneaking) toggles a door (both halves), trapdoor or fence gate. Breaking a door removes both halves, and breaking a block removes the plants, doors, torches, buttons, ladders and vines that rested on it.

Gallery: `go run ./examples/voxel_sandbox -gallery-shapes -textures pixelperfection ...` writes `docs/img/blocks-shapes-gallery.png`.
Details: [block-shapes.md](block-shapes.md).

## Metadata (palette, search, MCP)

`blockset.Info(name)` returns for each block: `Display` (readable name), `Category`, `Aliases` (English and French search keywords), `Hardness` (-1 unbreakable), `Material`
(sound family), `Tint`, `Placeholder`, plus the registry attributes. Also `All`, `Extended`, `ByCategory`, `Search(q)`. Categories: Naturel, Pierre, Bois, Laine/Couleurs, Verre, Minerais,
Nether/End, Décoration, Lumière, Liquide, Technique. The editor MCP tool `editor_blocks` lists category, display name, aliases, hardness and material of every registered block. The
palette UI (T1) can read the same API; this stage does not touch it.

| category | extended blocks | examples |
|---|---|---|
| Laine/Couleurs | 81 | 16 wools, concretes, concrete powders, terracottas, glazed terracottas, terracotta |
| Bois | 46 | logs, stripped logs, wood, stripped wood, planks of 11 species, crimson/warped stems |
| Pierre | 41 | granite, diorite, andesite, polished, bricks, mossy, cracked, chiseled, deepslate family, tuff, calcite, sandstones, prismarine, obsidian |
| Minerais | 34 | ores (stone, deepslate, nether), iron/gold/diamond/emerald/lapis/coal/netherite blocks, copper and oxidised variants, raw blocks, ancient debris |
| Nether/End | 31 | netherrack, soul sand, nylium, wart blocks, nether bricks, blackstone family, basalt, quartz, end stone, purpur, magma, crying obsidian |
| Technique | 28 | crafting table, furnaces, dispenser/dropper/observer, command blocks, TNT, spawner, slime, honey, note block, jukebox, target |
| Naturel | 27 | dirt, coarse dirt, podzol, mycelium, grass block, mud, clay, gravel, sands, snow, ices, 14 leaves, moss, mushroom blocks, sculk |
| Décoration | 25 | bookshelf, barrel, hay, melon, pumpkin, sponge, coral blocks, bee nest, beehive, bone block, honeycomb |
| Verre | 17 | glass and 16 stained glasses |
| Lumière | 8 | glowstone, sea lantern, shroomlight, jack o'lantern, redstone lamp, 3 froglights (Emit 15) |
| Liquide | 8 (core) | `water`, `water_1..7`: W1's model, untouched. Lava is not in the set: `fluid.Config{Lava: true}` registers `lava` and `lava_1..3` (docs/water-physics.md) |

Counts above are the extended blocks (core blocks carry metadata too). Names are the canonical game names (lower snake case, no namespace); the colour of a block is the average texel of
its Pixel Perfection texture (plains tint applied to foliage).

## Conventions

* One block = one entry; `texture` overrides which `mcnames.json` block draws it (`redstone_lamp` uses the lit image because a registry block has no state and `redstone_lamp` emits by name).
* Faces: `cube_all`, `cube_column` (logs: side + end on top and bottom), `top_side_bottom` and `orientable` (furnace, dispenser, command blocks, ...). **Limit**: the mesher has no
  per-block orientation, so an orientable block always shows its front on +z; the other three sides use the side texture.
* Opacity: leaves, glass, ice, frosted ice, spawner and mangrove roots are solid and not opaque (cut-out or blended pass); everything else is solid and opaque. No extended block is fragile or a liquid.
* Light: `Emit` 15 for glowstone, sea lantern, shroomlight, jack o'lantern, redstone lamp and froglights, 10 for crying obsidian; magma block uses its by-name default (4).
* Excluded on purpose: cactus, chorus, farmland, dirt path, dragon egg, end portal frame, beacon, powder snow (not full cubes, B2), structure block and jigsaw (not useful), infested blocks. Lava is registered by the fluid plugin (`Config.Lava`), not by the block set, like water.

## Placeholders

75 extended blocks are 1.17+ blocks with no image in Pixel Perfection 1.16: they render as a flat colour (suggested average colour from `mcnames.json`) and carry `placeholder: true`:
amethyst_block, azalea_leaves, bamboo_block, bamboo_mosaic, bamboo_planks, budding_amethyst, calcite, cherry_leaves/log/planks, chiseled_bookshelf, chiseled_copper, chiseled_deepslate,
chiseled_tuff, cobbled_deepslate, the copper family (copper_block, copper_bulb, copper_grate, cut_copper, exposed/weathered/oxidized and their cut variants, raw_copper/gold/iron_block),
crafter, creaking_heart, deepslate bricks/tiles and their cracked variants, polished_deepslate, reinforced_deepslate, all `deepslate_*_ore`, dripstone_block, flowering_azalea_leaves,
the three froglights, mangrove leaves/log/planks/roots and muddy_mangrove_roots, moss_block, pale_moss_block, pale_oak leaves/log/planks, mud_bricks, packed_mud, polished_tuff, resin_block,
resin_bricks, rooted_dirt, sculk, sculk_catalyst, sculk_shrieker, smooth_basalt, stripped_bamboo_block, suspicious_gravel/sand, tuff, tuff_bricks, vault, stripped bamboo. A later pack
can fill them without changing ids. (Core blocks `deepslate` and `mud` of generator v2 have no image either and stay flat.)

## Visual check

`docs/img/blocks-gallery.png`: wall of every solid block at a one-block pitch, `natural` look, rendered with
`go run ./examples/voxel_sandbox -gallery-wall -textures pixelperfection -look natural -freeze -nohud -radius 3 -frames 3 -w 2400 -h 1500 -cam 11,49,20,0,0 -shot out.png`
(categories in order, left to right, top to bottom: nature, stone, wood, colours, glass, ores, Nether/End, decoration, light, technical). Contact sheets per category come from
`go run ./scripts/blocksheet -out .build/sheets` (CPU icons of `assets/blockicon`, orange label = placeholder): `docs/img/blocks-sheet-naturel.png`, `-couleurs.png`, `-technique.png`.
Honest defects: the placeholders are flat squares and look unfinished next to the textured ones; stained glass shows a dark frame with a faint pane (Pixel Perfection's art, 46/255 pane); the
sun and bloom wash out the light-emitting blocks and the lit blocks cast a coloured glow on the floor; animated textures (command blocks, lanterns, magma, froglights, sea lantern, prismarine) show frame 0 only,
the strips are cropped to the first 16x16 frame, never shown whole; leaves are cut-out and look flat on a wall seen straight on; no texture is gray unintentionally after the tint
recalibration, but terrain far away still gets the biome tint of the column.

## Add a block

1. If the pack has its image, make sure `assets/blocktex/mcnames.json` knows it (`scripts/gen-mcnames.py`); otherwise add it under `missing` with a colour (it becomes a placeholder).
2. Adjust the rules or the `excluded`/`texOverride` tables in `scripts/genblocks/main.go` when the default category, hardness, opacity or light is wrong.
3. `go run ./scripts/genblocks` (keeps the order of the existing file and appends the new blocks alphabetically), then `go test ./blockset -update` for the id golden, then `go test ./blockset ./scripts/genblocks`.
4. Never reorder or delete an entry: ids are saved in worlds. Run `go run ./scripts/blocksheet` and read the sheet of the category.

## Project blocks

A project adds its own blocks, the building material of a machine mod, with one JSON file named by `runtime.custom_blocks` in `vox.project`
(project relative, under an asset directory so `burrow build` packs it; the build adds the file itself and the `textures/` folder).

```json
{ "blocks": [
  { "name": "mymod:gear",   "display": "Gear", "color": [200, 160, 40], "material": "metal", "hardness": 2, "texture": "gear" },
  { "name": "mymod:chest",  "color": [120, 80, 30], "top": "chest_top", "side": "chest_side", "interact": true },
  { "name": "mymod:lamp",   "color": [255, 230, 150], "emit": 15 }
] }
```

| field | meaning |
|---|---|
| `name` | registry name, `[a-z][a-z0-9_]*` with an optional `namespace:` (at most 20 + 28 characters). It must not exist yet: a project block never shadows a built-in one |
| `display`, `category`, `aliases` | palette text (`category` is one of the palette categories, default `Technique`) |
| `solid`, `opaque` | default `true`; `opaque` follows `solid` |
| `color` | colour of a face without a texture. Unset: the average colour of the block's textures (mid grey for a block without textures), in the editor preview and in the game alike; with textures off (flat colours) the registry colour, the colour field or mid grey, is drawn |
| `emit`, `emit_color` | block light 0..15 and its colour (default: the block colour) |
| `heat` | heat haze 0..15 |
| `light_loss`, `translucency` | light levels each channel absorbs entering a non-opaque block; or `foliage` / `tinted` / `clear` for the standard filters |
| `fluid`, `liquid` | `water` (non-solid; `liquid` 1..7 flowing, 8 or unset a source) or `lava`; flows by the water rules, no name needed |
| `fragile` | non-solid block destroyed by flowing liquid |
| `hardness`, `material` | mining time factor (-1 = unbreakable, default 1.5) and sound family (default `stone`) |
| `texture`, `top`, `bottom`, `side` | texture names: `texture` draws every face, the others override a face group. Images are the project files `textures/block/<name>.png` (any size, resampled to 16x16); a missing file draws the flat colour |
| `model`, `facing` | boxes instead of the cube (see below) |
| `random_tick` | the block receives random ticks (`OnBlockRandomTick`: crops, grass spread, leaf decay); needs `runtime.plugins.blocks` |
| `interact` | a right click without sneaking sends a `block.use` event instead of placing a block (needs `runtime.plugins.blocks`) |

* **Ids.** The blocks are appended after every built-in block, in file order, so ids stay stable as long as the file is only appended to (reordering or removing a block, or
  changing `facing`, changes the ids of the saved worlds that use it). The editor applies appended blocks and property changes without a restart (see Block editor, Live blocks).
* **Models.** `"model": [[x0,y0,z0,x1,y1,z1], ...]` replaces the cube by up to 32 boxes in sixteenths of a block (`0 <= min < max <= 16` on each axis). The boxes are the collision, the
  selection and the look: the player walks on them, rays hit them, neighbours show the faces they do not cover. The faces are textured like the cube (`texture`, `top`, `bottom`,
  `side`), each box face showing the part of the texture that lies under it. A model block is solid (it can be targeted) and not opaque. `"facing": true` makes four stored states,
  the model authored **facing north** (its front looks toward -Z) and turned a quarter turn clockwise for each other state: `name`, `name[facing=east]`, `name[facing=south]`,
  `name[facing=west]`, consecutive ids in that order. The placed state faces the player. Scripts get the state in the event names (`BlockProp(name, "facing")`) and the base name
  in the topics (`block.set/mymod:belt` covers all four), and `interact` and `OnBlockUse("mymod:belt")` work for every state.
  Models are shared by the process: do not run two projects with different models in one process.

  ```json
  { "name": "mymod:belt", "model": [[0,0,0,16,4,16],[0,4,0,2,6,16],[14,4,0,16,6,16]], "facing": true, "texture": "belt" }
  ```
* **Hotbar.** `runtime.hotbar` lists up to nine names put in the first slots at start (`"hotbar": ["mymod:gear", "mymod:chest"]`); the other slots keep the default fill and the
  middle click picks any block as before.
* **Determinism.** The registry is part of the world identity: the file must be the same for every peer and every replay of a session. A project without the key keeps its hashes.
* Scripts see the blocks like any other by name (`BlockByName("mymod:gear")`, `BlockInfo`); the editor palette lists them and `editor_blocks` returns them.
* **Items.** A machine mod declares what its blocks and machines carry with `runtime.items` (names, stable ids, stack limits); the engine provides the registry and the 6-byte stack, not an inventory. See [items](items.md).

### Block editor

The editor makes a project block from textures alone, with no JSON to write. Right-click a PNG in the Content panel and choose **Create block**, or use Content > **New block...** (the
**Block editor** also lists the project's blocks, and a click on one edits it). It opens full screen, like the other asset editors: the block turns in the middle, the **Block settings**
panel on the right holds the form.

* **Block**: the name (validated as above), the display name and the palette category. A saved block can be **renamed** (it keeps its place, so its id, and its textures) unless
  the open world places it or a project world file lists it: a world file names every registered block and only loads when that list is a prefix of the registry. A block that was
  saved but never registered in a running editor renames freely; a registered one is renamed in the file and the registry follows after a restart.
* **Textures**: one texture for every face, or one for the top, the bottom and the four sides. Each is a PNG of the project (a `textures/block/` file, or any PNG, which is copied to
  `textures/block/<name>.png` on save; the face files of a block are `<name>_top`, `<name>_bottom`, `<name>_side`). A texture must be square with an edge that is a power of two
  from 8 to 256 (16 is the block size; larger images are resampled); anything else is refused with the reason.
* **Properties**: colour (off = the average of the textures), solid, opaque, light 0..15, hardness, sound family and interact.
* A face without a texture wears the colour field, else the average of the block's textures, else grey: the preview and the game use the same colour.
* Switching to another block, **New block** or **Create block** on a PNG while the form has unsaved changes opens an **Unsaved block** prompt (Save, Discard, Cancel); the header shows
  *unsaved*. The form is also part of the editor's shared unsaved-asset guard: **Quit**, closing the window, **Back to world** and **Restart editor** ask Save / Discard / Cancel
  for it like the model, texture, particle and game UI editors do. Closing the full-screen editor with the X keeps the form.
* **References.** Before a block is renamed or deleted, the project is searched for its name and the hits are listed in a dialog (file:line, or the file and the kind): scenes
  and prefabs (`voxel.group` palettes, `world.edits` boxes, `particle_emitter` textures, any other component string), `data/*.json` (items, recipes: values and keys), Go sources under
  `scripts/` (string literals equal to the name or `name[...]`), `.level` palettes, `.ui.json` and `.particles.json` files, and the block's textures. A state `name[prop=value]`
  follows its block everywhere (the suffix is kept). A rename offers **Rename references too**, per category: scene/prefab palettes and world edits (on), data JSON values (on),
  **UI and effects** (`.ui.json`, `.particles.json`, `block:<name>` sprites; on), the block's **own textures** (`textures/block/<name>[_top|_bottom|_side].png` become `<new>...` and the
  block's texture fields follow; on; a texture another block uses stays), plain string literals in scripts (`"name"`, `"name[...]"`; off) and **level palettes** (off). Keys and other
  components are only listed. A level is decoded, renamed and re-encoded, so its content hash changes: a journal that pinned the old hash keeps the old bytes (that replay stays valid) and
  the level library cache is dropped; a level whose palette already holds the new name has the two entries merged (the stored chunks are remapped to the first one). The files are rewritten as one action after a backup of the originals in
  `.burrow-cache/block-rename-<time>/` (with a manifest of the file hashes); the open scene is edited in memory as one undo step (Ctrl+Z). World files that place or list the block
  still refuse the rename and the delete.
* **Restore backup** (block editor header, shown while a backup exists) lists the last five rename backups and puts one back as one action: the rewritten files, the moved textures and
  the block file, so the block gets its old name again. It refuses when a file changed since the rename (the dialog marks it) unless confirmed with **Restore anyway**; if the block file itself was edited since, only the renamed block's entry is put back (merged into the current file, every other edit stays); a restored
  backup is consumed and older ones are pruned. The open scene is not part of it (Ctrl+Z).
* **Save** writes the block to the file named by `runtime.custom_blocks` (`data/blocks.json` is created and set when the project has none): a new block is appended, an existing one
  is replaced in place, so ids stay stable. **Delete** removes it from the file. The file is checked like a project load before it is written.

**Live blocks.** A saved block is applied to the running editor at once, with no restart: new blocks are appended to the block registry (next free ids), the shape table, the
texture layers (the renderer re-uploads its atlas next frame) and the palette, and the meshes are rebuilt. The colour, solid, opaque, emission, heat, model, textures, hardness, sound,
category and interact of an existing block are redefined in place (same name, same id), and a changed texture file also changes the derived colour of a block without colour (the registry keeps the file's colour only: it is part of snapshots, so it never depends on texture files; the average is applied by the texture layers).
Only edit mode applies them: blocks saved while playing wait for **Stop** (the status line says so), because Stop restores the play snapshot, which carries the registry it was taken with.

Determinism: ids are append-only and never renumbered, and the registry is not part of the state hash. It is part of the journal stamp (`Registry.Fingerprint`: name, solid, opaque,
fragile, liquid, shape) and of every snapshot, so after a live change the editor starts a new journal from a checkpoint snapshot (`editor_verify_replay` keeps working); a replay engine
registers the live block list, not the startup one. A game running a project registers its blocks at startup from the file as before.

What still needs a restart (the block editor shows a **Restart editor** button, which asks about unsaved scenes and assets, closes the window and relaunches the editor on the same
project): removing a block, renaming a registered block, moving a block, and switching `facing` (the number of states changes). **Delete** never renumbers a block under saved data:
it is refused while the open world places the block (or a later one, whose id would move) and while a project world file lists it; a block that was only saved, never registered, is
removed freely. Editing is only possible in edit mode.

## Block logic

Blocks alone are inert. Block logic is off by default (`runtime.plugins.blocks: true` enables it; it is hashed simulation state, package `blocklogic`) and gives scripts what a machine mod needs.

**Block data** (what other engines call a block entity). A string of at most 16 KiB (JSON by convention) attached to a cell that holds a block: 131,072 cells and 16 MiB in all.
The SDK reads and writes it with `BlockData`, `SetBlockData`, `BlockDataJSON`, `SetBlockDataJSON`, `DeleteBlockData`; `BlockDataIn(min, max, limit)` lists the cells of a box,
`BlockDataMany` reads up to 4,096 cells with one host call and `BlockDataApply` updates up to 4,096 with one. It is saved, hashed, rolled back and replayed with the game. The data is
**bound to the block** the cell held when it was written: when the cell later holds another block (broken, replaced by a piston, a script, a fluid) the data is deleted, and the change
event carries it (`BlockEvent.Data`, up to 512 bytes) so a script can drop the contents of a machine. Writes are buffered with the other effects of the call and applied at commit, in
order, together with its voxel writes: writing the data right after `SetVoxel` of the same call works.

**Block events.** Every change of a voxel (a player, a script, a command, a tool; not flowing water) is queued (at most 65,536 per tick, then dropped and counted:
`blocklogic.State.Dropped`) and handed to the scripts that subscribed, in the script run of the same tick (edits made before it) or of the next one (edits made by scripts):

| handler (topic) | when |
|---|---|
| `OnBlockChange` (`block.change`) | any change of a voxel |
| `OnBlockSet(name)` (`block.set/<name>`) | the voxel now holds block `<name>` |
| `OnBlockBreak(name)` (`block.break/<name>`) | the voxel held `<name>` and does not any more (broken or replaced) |
| `OnBlockUse(name)` (`block.use`, `block.use/<name>`) | a player right clicked an `interact` block |
| `OnBlockTick(name)` (`block.tick`, `block.tick/<name>`) | scheduled cells that are due |
| `OnBlockRandomTick(name)` (`block.random`, `block.random/<name>`) | randomly drawn cells of a `random_tick` block |

A script gets its events as **batches** (`KindBlockBatch`, up to 16 KiB of JSON each), so a burst of thousands of changes costs a few inbox slots and one unit of the per-tick event budget per batch. The
SDK handlers hand you one `BlockEvent` per event (`Topic`, `X, Y, Z`, `Old`, `New`, `Block`, `ID`, the clicked face `NX, NY, NZ`, `Data`, `Truncated`, and on a brick `Micro`, `MicroN`, `MicroBlock`). A script holds at most 32 subscriptions: **one manager
script per mod** (not one per machine) is the design that scales.

**Random ticks.** A block declared `"random_tick": true` in `runtime.custom_blocks` receives Minecraft-style random ticks: every tick, each loaded chunk (the voxel map's chunks: edited, placed or streamed in) draws
`runtime.random_tick_rate` random cells (default 24 per 32^3 chunk, the equivalent of Minecraft's 3 per 16^3 section; 1..4096), and the drawn cells that hold an opted-in block reach `OnBlockRandomTick(name, fn)` in the
same binary batches as `OnBlockTick` (a cell drawn twice appears twice; at most 16,384 cells per tick). The draw is a pure function of the sim seed, the tick and the chunk coordinate, so it does not depend on the order
chunks were loaded in, needs no stored RNG state, replays identically and leaves the `StateHash` untouched until a script subscribes and acts. Grow a crop by reading its state with `BlockData` and writing the next block with `SetVoxel`.

**Scheduled machines.** `BlockSchedule(x, y, z, delay, every)` makes a cell a ticking machine: it comes back in `OnBlockTick` `delay` ticks after the next tick, then every `every` ticks (0 = once). Only
the machines that are **due** cost anything: the host keeps the schedule in the simulation state and hands the script the due cells of a tick as binary batches of about 1,000 cells (`KindBlockTick`), at most
65,536 cells per tick (the rest stays due for the next tick, in order). The schedule is bound to the block like the data (another block in the cell cancels it) and survives snapshots, rollbacks and
replays; `BlockUnschedule` or `DeleteBlockData` cancels it, `SetBlockData` keeps it. Hosts and tests use the journaled `block_schedule` and `block_unschedule` commands.

**Networks.** `BlockFlood(x, y, z, through, ends, max)` walks a cable, pipe or belt network natively: the blocks named in `through` are listed and expanded, the ones in `ends` (machines, tanks) are
listed but not expanded, breadth first in a fixed order, up to 60,000 cells, with one host call. A script balances the network it got with `BlockDataMany` and `BlockDataApply`.

**Block use.** The first person controller sends the journaled `block_use` command for an `interact` block (multiplayer clients may send it too, 10 per second, the whitelist checks it). Sneaking places a
block as usual, so a machine can still be built against.

Journaled commands for hosts and tests: `block_data_set`, `block_data_delete`, `block_use`, `block_schedule`, `block_unschedule`.

### Water

Pumps, tanks, drains and fountains move water through `FluidAmount(x, y, z)`, `FluidPour(x, y, z, units)` and `FluidDrain(x, y, z, units)` (needs the fluid automaton, `runtime.plugins.fluid: true`): a
full cell is `FluidFull` = 64 units, a source block counts 64, a coarse flowing level is 8. A pour or a drain acts at once (the amount returned is exact, a later fault of the call does not give the
water back); the water then flows by the rules of the automaton, and in the fine water every pour is entered in the ledger (`Created`, `Displaced`). A pump is `FluidDrain` on its intake cell, a credit on
the tank's block data, and a `FluidPour` on the output: water is conserved because the script credits what the drain returned. Only water exists: other fluids and gases are numbers in block data
(tanks, pipes: `BlockFlood` finds the network, the script moves the amounts).

### Scaling

The costs a mod meets and what the engine gives for each:

| problem | answer |
|---|---|
| polling thousands of machines every tick | `BlockSchedule` + `OnBlockTick`: the work follows the machines that are due. Measured on an M2 Max (`go test ./script -bench MachineTick`): 1,000 machines due every 10 ticks 0.2 ms per tick, 10,000 machines 1.2 ms, 50,000 machines (5,000 due per tick) 6.1 ms of the 50 ms tick |
| JSON in a guest costs tens of thousands of instructions per cell | the hot calls (`OnBlockTick`, `BlockDataMany`, `BlockDataApply`, `BlockFlood`) are binary: a few instructions per cell. Keep machine state as a short string you parse by hand, not JSON, when thousands of machines tick |
| 1,000 host calls and 4,096 voxel edits per script transaction | batch with `BlockDataMany` and `BlockDataApply` (each operation counts as one edit); raise the budgets in `runtime.script_limits` (below) |
| a burst of block events | batches, plus the 65,536 queue; a burst beyond it is dropped and counted |
| cable networks | `BlockFlood` walks 60,000 cells with one call |
| per-tick event budget (4,096) | batches count once each; raise `per_tick.events` when needed |

`runtime.script_limits` raises the limits of the scripting host for the project (the game and the editor's Play mode build the same host from it): `gas` per call (default 50,000,000, at most 2,000,000,000), `memory_pages`,
`max_faults`, and the host call budgets `per_script` and `per_tick` (`calls`, `bytes`, `spawns`, `voxel_edits`, `events`). A zero field keeps its default. The limits are part of the simulation identity: the same
project file must be used to record and to replay.

```json
{ "runtime": { "plugins": { "blocks": true }, "custom_blocks": "data/blocks.json",
  "script_limits": { "gas": 200000000, "per_script": { "voxel_edits": 32768, "calls": 8000 }, "per_tick": { "events": 100000 } } } }
```

### Building a machine

A furnace is a block, a record of data, and a schedule. This script sets a new furnace up when it is placed, adds fuel on a right click, and burns the fuel of the furnaces that are due, one batch of
reads and one batch of writes per call, however many furnaces the world holds:

```go
package main

import (
	"strconv"

	"burrow-engine/sdk/burrowsdk"
)

// the state of a furnace is "fuel,progress"
func parse(s string) (fuel, progress int) {
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			fuel, _ = strconv.Atoi(s[:i])
			progress, _ = strconv.Atoi(s[i+1:])
			return
		}
	}
	return
}

func init() {
	burrowsdk.OnBlockSet("mymod:furnace", func(self burrowsdk.Entity, ev burrowsdk.BlockEvent) {
		_ = burrowsdk.SetBlockData(ev.X, ev.Y, ev.Z, "0,0")
		_ = burrowsdk.BlockSchedule(ev.X, ev.Y, ev.Z, 0, 10) // ticks every 10 ticks (0.5 s)
	})
	burrowsdk.OnBlockUse("mymod:furnace", func(self burrowsdk.Entity, ev burrowsdk.BlockEvent) {
		d, ok, _ := burrowsdk.BlockData(ev.X, ev.Y, ev.Z)
		if !ok {
			return
		}
		fuel, progress := parse(d)
		_ = burrowsdk.SetBlockData(ev.X, ev.Y, ev.Z, strconv.Itoa(fuel+100)+","+strconv.Itoa(progress))
	})
	burrowsdk.OnBlockTick("mymod:furnace", func(self burrowsdk.Entity, cells [][3]int) {
		data, ok, err := burrowsdk.BlockDataMany(cells)
		if err != nil {
			return
		}
		var ops []burrowsdk.BlockDataOp
		for i, c := range cells {
			if !ok[i] {
				continue
			}
			if fuel, progress := parse(data[i]); fuel > 0 {
				ops = append(ops, burrowsdk.BlockDataOp{X: c[0], Y: c[1], Z: c[2], Data: strconv.Itoa(fuel-1) + "," + strconv.Itoa(progress+1)})
			}
		}
		_ = burrowsdk.BlockDataApply(ops)
	})
}

func main() {}
```

Conveyors, cables and pipes follow the same pattern: the network is data in the cells (a belt keeps the item it carries, a cable its stored energy), a block event re-links the neighbours when one is placed
or broken (`BlockFlood` finds the network), and the loop moves the contents a step per tick. The engine provides item identity, stable ids and the 6-byte stack format ([items](items.md)); what it does
**not** provide, and a mod writes itself: the items and recipes (the engine ships no item list), dropped items and an inventory API (keep counts in block data or the save store, show them with the game
UI), fluids other than water, and per-block animation or particles beyond the models and the effects a script can already spawn.

## Micro-voxels

A single world cell can be subdivided into a **brick** of micro-voxels (a "chisel"), next to normal blocks, on top of the per-world voxel size. A brick is `N x N x N` voxels, `N` = 2, 4, 8 or 16 (default 16: it matches the 1/16 units of shapes and custom block boxes; every `N` divides 16, so a micro edge is a whole number of sixteenths).

**Storage.** The cell holds the reserved block id `voxel.MicroID` (65535, not a registry block: `Registry.Get` returns the zero block) and the chunk keeps the brick in a sparse map cell -> `*voxel.Brick` (palette of block ids, at most 255, plus one byte per voxel, `x + N*(y + N*z)`). Bricks are immutable once installed (copy on write), so undo pre-images, snapshots and the mesher share them. A brick whose voxels are all one block collapses back to that plain block (`Chunk.SetMicro`, `ChunkMap.SetMicro`); a plain `SetBlock` over a brick drops it, and `SetBlock(p, MicroID)` is ignored. Limits: `voxel.MaxBricksPerChunk` (1024) and `voxel.MaxMicroBytes` (512 MiB over the world, checked by `sim.MicroEdits`). Memory: a 16^3 brick is about 4.2 KB, 8^3 about 0.6 KB, 4^3 about 0.2 KB (a chunk of 1024 16^3 bricks is 4.2 MB); a world without bricks pays nothing.

**State and files.** Bricks are part of the chunk overlay: `Chunk.Hash` and `StateHash` mix them in only when bricks exist, so every existing hash is unchanged. `Chunk.MarshalBinary` writes format version 1 for a chunk without bricks (byte for byte what it was) and version 2 (the runs, then a brick section: count, then cell, length and `Brick.MarshalBinary` per brick in cell order) when it has some; `.voxworld` files and engine snapshots carry the chunk blobs, so they gain bricks with no other change. Replica tracking and undo recordings use the same chunk copies.

**Commands.** One journaled command, `micro_edit` (`sim.MicroEdits{Edits}`), with these edits (`op`): `set` (voxels `[x,y,z,block]` into the brick of `p`; a plain cell is first subdivided at resolution `n`, filled with its block), `fill` (micro box `[min,max)` with block `b`, 0 carves), `clear` (the cell becomes Air), `to_brick` (subdivide a plain cell at `n`, optionally carving `min`/`max`; a brick equal to a plain block stays a plain block), `to_block` (collapse to block `b`, 0 = the majority block) and `put` (install a `Brick.MarshalBinary` blob in `data`, or the plain block `b`; what undo uses). Example: `{"edits":[{"op":"fill","p":{"X":3,"Y":40,"Z":3},"n":8,"min":[0,4,0],"max":[8,8,8]}]}`. Validation: world limit, registry ids, `n`, voxel ranges, brick limits; a failing command changes nothing. The editor wraps them in `Editor.SetMicro`, `FillMicro`, `ConvertToMicro`, `ConvertFromMicro`, `ClearMicro`, `ApplyMicro` (several edits, one undo step) and `MicroAt`; undo restores the exact previous cell. `VoxelOp` keeps the bricks it replaces, so any voxel tool can erase one and undo it.

**Queries.** `Raycast`/`RaycastReg`, `MoveAABB`, `Overlaps` and `SelectionBoxes` see a brick as its solid micro voxels (registry `Solid`), merged greedily into boxes (x, then y, then z, like `model.BlockBoxes`; cached per brick and registry revision), so a ray hits the exact micro face (`Hit.MicroVoxel(n)` gives the voxel) and the player stands on a half-slab brick. They need a reader that implements `voxel.MicroReader` (`ChunkMap`, `ReadView`, `engine.View`) and take the box path only once the map ever held a brick, so worlds without bricks keep the cube code. Breaking: the default break (`SetBlock` Air) removes the whole cell; tools use `micro_edit` to remove one micro voxel. Navigation reads a brick's solid micro voxels (walk on a micro slab, through a carved doorway; see navigation-ai.md). Fluids treat a brick as a solid cell: water neither enters nor displaces it (unknown ids are walls in the automaton).

**Light.** The light field is per cell, so partial opacity is one rule: a brick is opaque (blocks block light and skylight in every direction) only when every micro voxel is an opaque block; otherwise light and sky pass undimmed through the cell. Micro voxels do not emit light.

**Meshing.** A chunk with bricks is meshed like one with shaped blocks (`Mesh.Fine`: positions and UVs in sixteenths). The cube pass skips brick cells; a cube next to a brick keeps its face unless the brick fully covers that face with opaque voxels. The brick pass merges visible micro faces greedily per direction and layer (equal block, AO and light), draws opaque blocks in the opaque mesh and glass-like blocks in the transparent one, culls faces between equal transparent blocks and against opaque neighbours (also across bricks of different resolution), and computes AO at micro resolution. A micro face maps to the 1/N sub-rectangle of the block texture it covers (a brick of stone looks like stone; with `MetreTex` it follows the metre tiling like shapes); `Opts.MicroTile` gives each micro voxel the whole texture instead. Light is the light of the cell (the open side's cell on the brick boundary). Distance LOD meshes draw a brick as its majority block. The vertex format is unchanged, so no renderer change is needed (`BURROW_GPU=1 BURROW_GPU_ONLY=micro go test ./render/vulkan -run GPUChecks` checks that a pillar and a plate brick render their shape).

**Chisel tools (editor).** Three tools sculpt micro voxels (`editor/core/chisel.go`, `editor/ui/chisel_ui.go`): *Chisel* (`C`: add, cut or paint with a micro brush, radius 0..16 micro voxels, cube or sphere; Shift swaps add and cut; Ctrl picks the block under the pointer; the wheel sets the radius, Alt+wheel the resolution), *Micro box* (`V`: drag a box of micro voxels, Shift carves) and *Micro smooth* (`J`: majority smoothing, Shift erodes the skin). Options: resolution 4 / 8 / 16 (Shift+C cycles; default 16, 2 stays available through the API), Mirror X / Y / Z around the symmetry origin, block. The hover preview shows the exact micro voxels (green adds, red cuts, yellow repaints) with the count and the size in micro voxels and metres (a micro voxel is `1/(voxels per metre * resolution)` m). A stroke is one undo step. Where a cell already holds a finer brick the tool writes at the brick's resolution; a coarser brick is resampled up first (lossless). The *Voxels* menu has `Merge bricks of the region into blocks` (each brick becomes a block under the merge rule below) and `Resample bricks ... to the chisel resolution`. The world default resolution is `GenParams.MicroN` (`Editor.SetWorldMicroN`, the **World** button of the chisel options): stored in the world settings and in the `.voxworld` header (`gen.micro_n`), absent for 16, so existing files do not change.

**Copy, paste and prefabs.** Region copy / cut / paste / move / rotate / mirror carry bricks (`ClipCell.Brick`; rotating or mirroring the clipboard turns each brick with its cell). A `voxel.group` node keeps the bricks of its cells in the optional `bricks` field (base64 of `(cell index, length, Brick blob)` records in the group's local frame; the cells name the palette entry `#micro`): placing, moving, rotating, undoing and duplicating the node carries them, the prefab editor preview meshes them at micro resolution, and a group without bricks encodes exactly as before. What a group covers is recorded cell by cell, plain blocks and bricks alike (`under` palette; the covered bricks are in the optional `under_bricks` field, same encoding as `bricks` but in the world frame, the palette entry `#micro`), so deleting, moving or undoing a group puts back the exact previous content; a group saved without `under_bricks` loads as before.

**Scripts.** `voxel_micro_get`, `voxel_micro_set`, `voxel_micro_fill` and `voxel_micro_res` (SDK: `Micro`, `SetMicro`, `FillMicro`, `MicroResolution`) read and write micro voxels; writes are buffered like `voxel_set`, charged as voxel edits and applied at commit by the rules of `micro_edit`.

**Network.** `micro_edit` is in the default client whitelist (20 per second, at most 16 edits, 128 listed voxels, ops `set`, `fill`, `clear`, `to_brick`, `to_block`, never `put`) and is replicated like `set_block`.

**Agents.** `editor_micro` (get, set, fill, convert, clear, brush) edits bricks, each call one undo step.

**Merge rules.** `Editor.ConvertFromMicro(p, 0, opts...)`, `MergeBricks(cells, opts)` and `ChiselConvert(0, opts...)` take a `MergeOptions{Rule, MinSolid, Tolerance}` (zero value = default). `majority_solid` (default): the most common non-air block when at least `MinSolid` (default 0.5) of the voxels are filled, else the cell becomes air (ties: lowest id). `majority`: `Brick.Majority`, air as soon as more than half the voxels are air. `keep_shape`: when the brick matches, within `Tolerance` (default 4 % of the 16^3 grid) and better than a plain cube, the first variant of a shaped block of its material (a slab, stairs, wall, ... named `<material>_<family>`, `oak_planks` also matches `oak_*`; a brick made of a shaped block keeps its own item, so chisel then merge gives the same block back), it becomes that block with the matching orientation; otherwise it falls back to `majority_solid`. `MergeBlock(brick, opts)` previews the result.

**Shaped blocks.** Chiselling a shaped block (stairs, slab, fence, wall, plant, door, trapdoor, project block with a `model`) first converts it into the brick that reproduces its boxes (`Editor.ShapedBrick`: selection boxes, else collision boxes, in sixteenths with the state and neighbour-derived variant it has in the world; exact at `N` = 16, nearest voxel at 2, 4 and 8; the voxels hold the shaped block itself, so texture and softness are kept), and the chisel then carves that brick; the conversion is part of the same undo step.

**Placing from the hotbar.** `player.build.micro` stores only ids the micro mesher draws as cubes (`microBlock` in `app/microplace.go`): a shaped block of a family with a material cube (slab, stairs, wall, fence, fence gate, trapdoor, pane, carpet) is placed as that full cube (`oak_stairs` becomes `oak_planks`; the stem is the item name without `_<family>`, tried with the suffixes `` / `_planks` / `_block` / `s` / `_bricks` / `_wool`), and a state id never enters a brick. A shaped block without such a cube (plants, torches, doors, buttons, ladders, vines) and any liquid are refused: nothing is placed and `Controller.OnNotice` gets the reason. Other blocks go in as they are, event-driven logic included (micro events name the voxel); the hotbar attaches no block data.

Not covered: micro voxels have no per voxel block data or fluids (events and `interact` work per micro voxel, see below), and `to_brick` of an uncarved plain cell is a no-op by design (a brick equal to a plain block is a plain block).

### Radial symmetry, model stamps and micro events

**Radial symmetry (chisel).** The chisel tools have a **Radial** option (Off, 2, 3, 4, 6, 8; `Tool.Radial`, any count up to `MaxRadial` through the API) next to Mirror: every dab is repeated N times around the vertical axis through the middle of the symmetry-origin voxel (a pure rotation of 360/N degrees; quarter turns are exact, other angles round each micro voxel centre) and combines with Mirror X / Y / Z (mirror first, then rotate: `mirror images x N` copies). Unless **Pin** is on, the centre is the voxel under the pointer when the stroke starts (the ghost follows the pointer until then; it moves `Tool.SymOrigin`); with Pin on the centre stays at `SymOrigin` (set it with the Origin button of the tool panel). The ghost shows every copy and the whole stroke is one undo step; the cap `MaxChiselVoxels` counts the copies. `editor_tool` takes `radial` for the chisel brush too.

**Stamp a model as micro-voxels.** A `.bmodel` or `.vox` becomes bricks of the world instead of a free `render.voxmodel` node: `Editor.StampModelMicro(rel, hit, MicroStampOpts)` (or `LoadMicroStamp` + `PlaceMicroStamp(stamp, originCell, label)`), one undo step. The model is read at its own `voxels_per_block` (`.vox`: 16; override with `VoxelsPerBlock`): 16 per block gives `N = 16` bricks exactly (a 16^3 model fills one cell voxel for voxel), any other ratio is resampled to the brick resolution `N` (default 16, 2/4/8/16): nearest voxel when scaling up, the majority block of the covered voxels when scaling down (solid when at least half are). Colours map to the nearest solid registry block (`Block` forces one block, `Palette` maps `"#rrggbb"` to blocks first). `Yaw` turns it in quarter turns; the stamp sits on the hovered face like the old stamp (`MicroStampOrigin`, the model's bounding box in whole cells, cropped for `.vox`, the whole grid for `.bmodel`) and keeps existing content where the model is empty. Limits: 4096 blocks (`MaxMicroStampCells`) and 2^23 micro voxels (`MaxMicroStampVolume`); beyond them the error says "model too large to stamp" with the size. UI: Content context menu **Stamp as micro-voxels at focus**, and when dragging a model into the viewport **M** (toggle) or **Alt** at the drop stamps bricks (R still rotates; the preview outlines the cells and shows the size); the default drop stays the free node. Agents: `editor_micro` `op: stamp_model` (`asset`, `cell` = minimum corner cell, `n`, `voxels_per_block`, `yaw` 0..3, `block`, `palette`, `dry_run`).

**Micro block events.** Block events on a brick name the micro voxel. `block_use` (`blocklogic.Use`) takes `micro_n` (the brick resolution) and `micro` (`[x,y,z]`): the event reports the micro voxel's block (`block.use/<micro block>`, `Event.New`) and `block_use` is only sent when *that* block is `interact`, so an interactive block chiselled into a brick works per micro voxel. A new journaled command `block_micro_event` (`blocklogic.MicroChange{Pos, MicroN, Micro, Old, New}`, validated: `New` must be what the brick holds now, a brick the edit collapsed counts) queues a change event for one micro voxel (`block.change`, `block.set/<New>`, `block.break/<Old>`); micro events are saved in snapshots (kind byte flag `0x80`, absent for whole-cell events, so existing states keep their bytes). The SDK `BlockEvent` gets `Micro [3]int`, `MicroN` (0 = whole cell) and `MicroBlock` (the micro voxel's block name, `air` when broken). The first person controller sends them: a right click on a brick uses the aimed micro voxel (`block_use` with `micro_n`/`micro`), and `player.build.micro: true` makes left click break and right click place a single micro voxel with the hotbar block (a brick at its own resolution, a plain cell subdivided at `Config.MicroN`, default 16; break on a plain cell carves one voxel out of it): each is a `micro_edit` plus `block_micro_event`, one controller undo step (Z / Y). Without the option the break stays the whole cell. The runtime does not read the world's `GenParams.MicroN` yet: the host sets `app.Config.MicroN`.

## Memory and layers

Textures are a GPU 2D array (layer = unique 16x16 image, deduplicated; `blocktex.MaxLayers` 2048 = the engine cap in `render/vulkan`, MoltenVK/Metal report 2048). All 385 blocks need **399-435
layers** (albedo + normal + spec arrays with 5 mips: **1.56 MiB** measured by the renderer, about 0.5 MiB of albedo). If a pack ever needs more, `blocktex.NewTable` keeps the longest prefix of blocks
that fits and draws the others flat (`Table.Truncated` counts them); a device with fewer than 2048 layers (the Vulkan minimum is 256) is rejected by the renderer with an explicit message.
