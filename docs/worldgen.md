# World generation

Two terrain generators (and a blank one) ship with Burrow. Both are pure functions of `(seed, position)`: a chunk never depends on which other chunks were generated, in what
order, or on which goroutine.

| generator | `runtime.generator.kind` | what it is |
|---|---|---|
| **v1** | omitted or `"heightmap"` | the original hills with trees (`worldgen.Heightmap`). Frozen: worlds, scenarios, goldens and `StateHash` never change. Also `"flat"`. |
| **empty** | `"empty"` | all air (`worldgen.Empty`): a blank world to build or script from scratch. No terrain, no trees; the other generators are untouched. |
| **v2** | `"biomes"` | biomes, rivers, lakes, mountains, caves, ores and vegetation (`worldgen.Biomes`), 4 chunk layers high (y 0..127). |

A project, `.voxworld` or scenario without a generator field stays on v1 forever. New projects from the `sandbox` template, the editor's World settings
dialog ("biomes (v2)") and the `biomes` session generator of `burrowd`/`burrowctl` use v2. The sandbox example takes `-gen v2` (default `v1`).

![river](img/worldgen-river.png)
![mountains](img/worldgen-mountains.png)
![desert](img/worldgen-desert.png)
![lake and meadow](img/worldgen-lake-meadow.png)
![taiga and tundra](img/worldgen-taiga-snow.png)

## Settings

`vox.project` -> `runtime.generator`:

```json
{ "kind": "biomes", "sea_level": 36, "scale": 1, "amp": 100, "caves": true, "trees": true }
```

`sea_level` is the top water voxel (0 = 36, 8..90), `scale` the horizontal feature-size factor (0 = 1, 0.25..4), `amp` the vertical relief in percent (0 = 100,
20..150), `caves` and `trees` (trees and ground plants) switch the features. The seed is `runtime.seed` (or the World settings dialog). Block ids: the
default blocks first, then the biome blocks (`worldgen.BiomeBlockNames()`), registered by the engine when the generator is installed; the same ids result
in every engine, editor and agent session.

## How v2 builds a column

Everything below is a function of `(seed, x, z)`; heights are continuous values rounded with a small position-hashed dither, so level lines are stippled
rather than straight stair lines.

1. **Domain warp**, horizontal axes only (no 3D warp, so cliffs stay clean): x and z are displaced by two low-frequency fBm fields.
2. **Climate fields**: continentalness (huge oceans, continents of varied size), erosion (picks the relief class: mountains, hills, plains, flat swampy lowlands),
   temperature in latitude-like bands along z bent by noise and lowered with altitude (a lapse rate), humidity. The area around the origin is biased to land and a
   temperate climate so a new world starts on grass.
3. **Height**: a spline of continentalness (abyssal plain, shelf, a short coastal rise so beaches are a few blocks wide, rolling inland), plus ridged-noise mountains
   weighted by erosion and distance from the coast, plus rare cliff steps, plus detail noise whose amplitude depends on the relief class.
4. **Rivers**: level lines of "position along a seed-chosen axis + wandering noise", repeated every 560 blocks. Because the noise displacement stays below the axis
   gradient, every river is an open curve that crosses the land and meets the sea (tested over three 3600x3600 windows). Valleys are deep and wide in mountains, the
   channel is flat, and the river level follows half the height above sea level, so rivers step down to the sea. Mountain gorges are dry (water would run down a
   slope as a wall).
5. **Lakes**: one candidate per 192-block cell, accepted only on flat land away from rivers, a bowl with a flat water level and an embankment. Cell results are
   cached; a column evaluates the 1-4 cells within reach.
6. **Biomes**: ocean, deep ocean, beach, plains, flower meadow, forest, birch woods, taiga, tundra, desert, savanna, jungle, swamp, mountains, snow peaks, river, lake
   (`worldgen.BiomeList()`). Water columns are rivers, lakes or ocean; land by altitude and slope, then by temperature and humidity with patch noise for forests and
   meadows. Transitions follow the fields, there are no biome borders on a grid.
7. **Surface rules** per biome (grass over dirt, sand over sandstone, mud in swamps, gravel/clay/sand sea and river beds, snow where it is cold). Slope exposes stone:
   steep faces are rock in every biome and medium slopes mix rock with the surface material by hash. Snow only where the local temperature is below 0.2 (or on
   snow peaks), ice only below 0.15.
8. **Caves**: two 3D noise fields sampled on a 4-voxel lattice and interpolated trilinearly (tunnels where both are near zero) plus larger caverns; at least 6 blocks of
   rock stay under the surface (9 under water) except at rare designated entrance columns (no plant or tree grows there). Bedrock at y 0..2, deepslate below y 14.
9. **Ores** (coal, iron, copper, gold, lapis, redstone, diamond, emerald): one candidate blob per 16-voxel cell and kind, positioned by a hash of the cell.
10. **Vegetation**: per-column plants (tall grass, flowers, mushrooms, cactus, dead bush) and trees from a 4-block candidate grid with a dart-throwing priority rule (blue
    noise), thinned by the biome density and by clearing noise. Species: oak, large oak, birch, spruce, acacia, jungle, swamp oak, bushes. A chunk evaluates every candidate
    whose crown can reach it, so trees that straddle chunks are identical on both sides. Plants are `Solid`, non-opaque cubes (the mesher draws every non-solid, non-opaque
    block as a liquid); `tall_grass`, `jungle_leaves` and `acacia_leaves` reuse the oak leaves texture with a biome tint, cactus, flowers, mud and the acacia/jungle logs are
    flat colours, everything else (sandstone, gravel, snow, ice, clay, deepslate, bedrock, ores, birch, spruce) uses its pack texture.

Water is the one existing `water` block (a source block); v2 places it in oceans, lakes and rivers and freezes the top layer in the cold.

## Biome tint

`Biomes.TintAt(seed, kind, x, z)` returns the grass (1), foliage (2) or water (3) tint multiplier: the biome colour of the column averaged over a 5x5 lattice of samples
(4-block step, about 20 blocks wide) and bilinearly interpolated, so colours fade between biomes. The engine uses it automatically for v2 worlds (`engine.SetBiomeGen`;
the editor updates it when the world is regenerated); v1 keeps `ClimateAt`. `blocktex` itself is unchanged.

## API

```go nocheck
b := worldgen.DefaultBiomes()                        // v2, default parameters, palette for a default registry
b.BiomeAt(seed, x, z)                                // Biome (also worldgen.BiomeAt(seed, x, z) for the defaults)
b.Height(seed, x, z)                                 // top solid y
b.ClimateOf(seed, x, z)                              // local temperature, humidity (0..1)
b.BiomeGrid(seed, x0, z0, w, h, step)                // minimap data
worldgen.BiomeList()                                 // id, name, map colour, grass/foliage/water tint
```

`ClimateAt` (used by `weather/` and the v1 tint) is unchanged and stays a v1-style climate: weather in a v2 world therefore does not follow the biome temperature
(a snowy biome can get rain). Making `weather` read `Biomes.ClimateOf` is a possible follow-up.

Editor and agents: `editor_biomes` (generator kind and version, seed, biome list) and `editor_biome_at {x,z}` (biome, height, temperature, humidity of one column, the data a minimap
needs); the seed and generator are set in View > World settings (undoable) or `runtime.generator` in `vox.project`.

## Distance LOD sampling

`Biomes` implements `worldgen.ColumnSource`: the engine draws LOD 2 and LOD 3 columns from `ColumnSampler(seed)` (ground, water level and the surface rule of each column, the slope taken from the four neighbouring columns) instead of generating chunks. Caves, ores, ice and vegetation are not sampled; `Generate` is unchanged.

## Cost and memory

Measured on an Apple M2-class laptop: about 1.0 ms per 32x32x32 chunk generated cold (including the column window that the four layers of a column share), about 0.3 ms per
chunk with 4 workers for a radius-12 disc (2500 chunks in 0.7 s). Memory is bounded: 96 column windows (about 20 KiB each), at most 4096 lake cells, the tint caches are cleared at
131072 / 262144 entries, at most 6 samplers live at once. None of these caches is state: dropping them never changes a result.

## Testing

`go test ./worldgen` covers determinism, order and cache independence, biome distribution over four seeds, per-voxel rules (no plant in water, no floating plant or log, snow only
in the cold, bedrock, caves, ores, no holes in the surface), tint smoothness, palette stability and a fuzz target. Behind the `slow` tag: rivers reach the sea (or the window border,
or a dry mountain gorge) over three seeds, the same rules on wide regions, and a radius-12 generation.

## Inspiration and licence

Larion's published ideas (latitudinal temperature bands, an erosion parameter choosing the relief class, horizontal-only warp, long valleys, exposed stone on slopes) inspired
the design; nothing was copied: all code, names, tables and values are original, so no third-party notice is needed. No other mod or generator was consulted.

## Voxel size

A world can have voxels smaller than one metre: `runtime.generator.voxel_size` (or the scene's world file, set from World settings > Voxel size in the editor) is 1 (default), 0.5, 0.25 or 0.125 metres. The voxel grid stays integer and the simulation (chunks, raycasts, block edits, node transforms) stays in voxels; everything authored in real units is metres and converts through the size:

- The generator parameters (`base`, `amp`, `scale`, `sea_level`, `surface_y`, `depth`, trees) are metres: a 0.25 m world is the same landscape at 4 times the detail. `heightmap` samples its noise at the finer grid (smooth terrain, trees keep their size in metres); `flat`, `biomes` and `empty` are upsampled voxel for voxel.
- The player (1.8 m tall, 1.62 m eye, 0.6 m wide), `player.move` speeds, jump height, step height, `player.build` / `player.interact` reach, gravity, `physics.character`, `physics` and `physics3d` gravity, particle sizes, speeds and gravity, and audio min/max distances are in metres and seconds.
- The load radius grows with the finer voxels (same distance in metres, capped at 24 chunk columns).
- A scene switch into a world of another voxel size carries the size; it is part of the world identity and of the state hash (absent at 1 m, so those worlds hash as before).

Still per voxel: block light falloff (15 levels, one per voxel, so a torch lights a smaller radius in metres), fluid flow distance, nav agent profile sizes, camera rig offsets, fog and weather sizes, and block textures (one texture per voxel face). The editor refuses to change the voxel size of a world while keeping its edits (regenerate without keeping edits, or make a new scene).
