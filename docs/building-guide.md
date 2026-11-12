# Building guide for agents

Models that build with `fill_box` tend to produce the same thing: a plain box in three or four unrelated blocks with a flat roof. This page explains the tools that fix that. They give an agent the rules of the public Minecraft building guides, palettes of block names that exist in the world it is building in, generators for the geometry that is easy to get wrong (pitched roofs with correctly oriented stairs, towers, domes, arches) and a review that reads the finished structure back and says what looks poor.

| | `burrowedit` (the editor, full block set) | `burrowd` (sessions, a handful of blocks) |
|---|---|---|
| rules, styles, palettes | `editor_build_guide` | `vox_build_guide` |
| roofs, round shapes, arches | `editor_build_plan` | `vox_build_plan` |
| structure review | `editor_build_review` | `vox_build_review` |

The data behind them (16 styles with their palettes, about 50 rules, roof recipes, proportions, furniture, the limits of the block set) is listed on the [building guide data](reference/build-styles.md) page. It comes from package `buildguide`; every block it names is checked against the engine's block set by a test, so a palette never contains an invented block.

## The workflow the guide teaches

1. **Decide** the style, the site, the footprint and the storeys. Use odd widths where something must be centred (a single door, a ridge).
2. **Palette.** `editor_build_guide` with `topic: "style"` and a style name returns one block per role, resolved against the world: `foundation`, `wall`, `wall_alt`, `frame`, `roof`, `roof_stairs`, `trim`, `window`, `light`, `floor`, `path`, `door`, `fence`, plus shaped variants (`roof_slab`, `wall_stairs`, `shutter`, ...). Keep to three to five blocks plus accents: a base of about half of the surface, a secondary of about a third, an accent of about a fifth, darker below and lighter above, a frame of another tone than the infill.
3. **Masses.** `editor_build_plan` with `kind: "house"` builds a whole house from a style in one call (below); or fill the foundation, walls (hollow boxes) and floors with `editor_tool_apply` (`box`, `hollow`) or `vox_act` (`fill_box`). Break the rectangle: an L, T or U footprint, two or three volumes of different heights, a porch or a tower.
4. **Roof.** `editor_build_plan` with `kind: "gable_roof"`, `"hip_roof"` or `"shed_roof"`. Round towers: `cylinder` for the shaft, `cone` for the roof, `dome` for a dome.
5. **Relief.** No facade is a single plane: pillars every 3 to 5 blocks, windows recessed one block and framed with trapdoors, a plinth, a cornice of upside-down stairs, a chimney.
6. **Openings and interior.** A framed door with a step, windows 1 to 2 blocks above the floor in varied sizes, floor patterns, furniture from stairs, slabs, fences, trapdoors and plates (`topic: "interior"`), light every 6 to 8 blocks hidden in the structure.
7. **Surroundings.** A path of two or three mixed blocks, a garden, a hedge, a fence, trees; dig into slopes instead of leaving a flat lawn square.
8. **Review.** `editor_build_review` on the box around the building; fix the warnings, look at a screenshot, repeat.

`topic: "overview"` returns this workflow with the ten most important rules and the style list; `topic: "checklist"` is the final check; `topic: "mistakes"` lists the usual failures and their fixes.

## Palettes that exist

A style lists candidates per role, most preferred first, and the first one the world has is chosen. That matters because worlds differ: the editor's block set has no gravel or sandstone unless world generation v2 created them, and a `burrowd` session may have only `stone`, `dirt`, `grass`, `sand`, `water`, `wood` and `leaves`. When no candidate exists, a block of a suitable kind is chosen (a solid, opaque, non-loose block for walls, the brightest emitter for light) and a warning says so; a role with nothing suitable is listed in `missing` (leave an opening, or reuse a neighbouring role).

The block set has limits an agent must know (`topic: "engine"`): no lanterns, chains, candles, beds, signs or chests (light comes from glowstone, sea lanterns, redstone lamps, shroomlights, torches); stairs exist for about 38 materials only (none for deepslate, tuff, mud brick, concrete, wool, cherry, bamboo or mangrove); there is no double slab (use the cube); stair corners and fence, wall and pane connections are derived from the neighbours.

Stairs: `facing` is the direction a stair climbs toward (its tall back is on that side), `half=top` turns it upside down for cornices and eaves, and the default state (facing north, bottom) is the bare item name:

| wanted | block name |
|---|---|
| stair climbing north | `oak_stairs` |
| stair climbing east | `oak_stairs[facing=east,half=bottom]` |
| upside-down stair climbing south | `oak_stairs[facing=south,half=top]` |
| top slab | `oak_slab[type=top]` |

`editor_blocks` takes `query`, `category`, `material`, `family`, `limit`, `names_only` and `states`: `family: "stairs"` with `names_only: true` and `states: false` lists the stair materials in one short answer, instead of the roughly 1500 entries of the full list.

## Generators

`editor_build_plan` and `vox_build_plan` return a plan: a list of inclusive fill boxes, later boxes overwriting earlier ones, with the bounds and the cell count. Nothing is written unless `apply: true`, which writes one undoable step in the editor (`vox_build_plan` returns ready `fill_box` commands for `vox_act` and also accepts `apply`). Pass `style` to take the blocks you leave out (stairs, ridge block, slab, gable fill, shape block) from the style's palette.

| kind | parameters | result |
|---|---|---|
| `house` | `style`, `origin`, `size`, `storeys`, `door`, `roof`, `no_porch`, `no_chimney` | a whole house in the style's palette: foundation and plinth, framed walls whose intermediate pillars stand one block out of the wall, a belt beam per storey, windows with sills in every bay, a door framed by two pillars with a step and a porch, floors and a stair for upper storeys, lamps, the roof (`roof`: `gable`, `hip` or `flat` with a parapet; the default comes from the style: flat for modern and desert, hip for japanese) and a chimney |
| `gable_roof` | `origin`, `size`, `ridge_axis`, `overhang`, `gable_overhang`, `stairs`, `block`, `fill` | stairs on both slopes facing the ridge, a ridge row, closed gable ends; an odd span gets a block ridge, an even span two stairs back to back |
| `hip_roof` | same, plus `slab` | rings of inward-facing stairs shrinking one block per layer, a slab or block cap; corner shapes come from the engine's own stair rule |
| `shed_roof` | `facing`, `origin`, `size`, ... | one slope climbing toward `facing` |
| `disc`, `cylinder`, `sphere`, `dome`, `cone` | `origin`, `diameter`, `height`, `block`, `hollow`, `thickness`, `step` | round shapes by the pixel-circle rule; an odd diameter is centred on a block |
| `arch` | `origin`, `axis`, `width`, `height`, `depth`, `shape` | an opening to carve out of a wall: piers up to the spring line, then a semicircle or a gothic point |

For roofs `origin` is the minimum corner of the footprint (the outer wall faces) with `y` on the row right above the top row of the walls, and `size` is the footprint in x and z. With an eaves overhang of one the lowest stairs sit one block outside the walls and one block lower, which is how the slope continues past the wall. A world without stairs (a `burrowd` session) gets a stepped roof of full blocks with a second block under every step, so it stays watertight.

```json
{"kind": "house", "style": "nordic", "origin": [10, 9, 10], "size": [11, 9], "storeys": 2, "door": "south", "apply": true}
{"kind": "gable_roof", "style": "nordic", "origin": [10, 14, 10], "size": [9, 7], "overhang": 1}
```

A house stays within five material families (a floor, trim or gable fill that would be a sixth is folded into a neighbour), and the generated houses of all 16 styles pass the review without warnings in the tests. Treat the result as a base: vary the plan (add a wing with a second `house` or a roof), furnish it, add a path and a garden.

## Review

`editor_build_review` takes the box that bounds one building (terrain, water and plants are ignored, but terrain blocks inside the box count) and reports the materials with their shares, findings and a score from 0 to 100. Each finding has a severity (`error`, `warn`, `info`), a code, a message and a fix:

| code | what it means |
|---|---|
| `too-many-materials`, `single-material`, `no-secondary` | more than five material families above 3 percent; one material only; one material above 85 percent |
| `noisy-weathering` | cracked or mossy variants make up more than a quarter of a family: random noise instead of age |
| `flat-facade` | 90 percent of a side lies in one plane |
| `flat-roof`, `low-roof-relief` | 70 percent of the footprint ends at the same height without a parapet (with one it is only the note `flat-roof-parapet`); almost no height variation |
| `no-windows`, `no-door`, `no-light`, `sparse-light` | too little glass for the walls; no door; no light source; fewer than one source per 60 footprint cells |
| `loose-blocks`, `illogical-floor`, `fire-hazard` | dirt, sand or gravel in the walls; glass, wool, leaves or ice as floor; wood or wool touching lava, fire or a campfire |
| `perfect-symmetry`, `small`, `low` | mirror symmetry to the block; footprint under 5; under 4 blocks tall |

It is a heuristic, not a judge: a modern house is allowed a flat roof, a ruin is meant to look weathered. Read the findings against the style you chose.

## Where the knowledge comes from

The rules are distilled from the public Minecraft Wiki building tutorials (adding beauty, colour palette, materials, floors, furniture, architectural terms, roof types and construction guidelines, walls and buttresses, creating shapes, water features, settlements, villages and the metropolis themes) and from several community building-tip guides. Facts and rules of thumb are restated in our own words; the wiki is licensed CC BY-NC-SA 3.0. The list of sources is `topic: "sources"` and the end of the [data page](reference/build-styles.md).

To add or change a style, edit `buildguide/styles.go`: list the candidate blocks of every role, most preferred first. `go test ./buildguide` fails if a block does not exist in the engine, if a style cannot resolve every role in the editor's block set, or if a roof cannot get stairs and a slab.
