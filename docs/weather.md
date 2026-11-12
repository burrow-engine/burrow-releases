# Weather

`burrow-engine/weather` is a deterministic weather simulation: a seeded state machine of fronts (clear, cloudy, fog, light rain, heavy rain, storm, snow),
smoothed intensities, a slowly turning wind, a day clock with an optional seasonal cycle, lightning and thunder, and a per-position sampler
(`At`) that turns the front into the weather felt at one place. This page is the simulation foundation and its API; **rendering the weather
(visible rain and snow, lightning flashes, fog, wet surfaces, wind on clouds and leaves, overcast sky) is the shader stage S3**
([rendering.md](rendering.md#shader-levels-stage-s3-water-weather-atmosphere)), which reads the `weather.State` described below
through `weather.RenderFX`. The simulation never depends on the renderer.

## Enabling it, and why it is off by default

`weather.Plugin{Options{Enabled: true, Seasons: true}}` installs the module; the zero `Options` installs it **inert**: nothing evolves, `At`
answers "clear", and the `StateHash` of the app is bit for bit what it was without the plugin (an inert extra contributes nothing to the hash).
That keeps every existing project, golden and journal valid. It is **on** where a game wants it:

| where | how |
|---|---|
| `burrowplay` / game projects | `"runtime": {"weather": true, "seasons": true}` in `vox.project` (the `sandbox` template sets both) |
| code | `app.AddPlugin(&weather.Plugin{Options: weather.Options{Enabled: true}})` after `ScenePlugin` |
| editor, `burrowd` sessions | always installed, disabled; turn it on with `editor_weather {enabled:true}`, the View > Weather panel, or `vox_act` `weather_set` |
| a bare `sim.Engine` | `weather.Install(e, seed, opts)` from `sim.Config.Setup` |

A journal recorded with weather enabled replays only on an engine that installs the module (the editor, burrowd and the app plugin all do).

## Model

All evolving state is integer (Q16 fixed point, permille, `splitmix64` of `(world seed, counter, salt)`); there is no wall clock, no `math/rand`,
no floating point in the state, so every platform reaches the same hash. Floats exist only in the frame-domain `State` / `Local` values.

* **Fronts.** A front (`Kind`) lasts a drawn number of ticks (20 ticks = 1 s): clear 5 to 20 min, cloudy 4 to 14 min, fog 2 to 6 min, light rain
  3 to 10 min, heavy rain 2 to 7 min, storm 1.5 to 5 min, snow 3 to 10 min. The next front is drawn from a transition table (clear -> cloudy ->
  rain -> clearing; storms end in heavy rain; fog burns off), adjusted by the mean temperature (no snow above 2 C, snow x4 below 0 C, no storm
  below 4 C) and the hour (morning fog x3). Each front draws its targets: precipitation, cloud cover, fog, humidity.
* **Smoothing.** The current values move toward the targets by a bounded step per tick (precipitation 0 to 1 over 60 s, cover 45 s, fog 75 s),
  so a change of front never jumps. Surface wetness rises under rain and dries over about 9 minutes.
* **Wind.** Every 30 s a new target heading (at most 45 degrees from the previous) and speed (3 to 17 m/s plus a boost from the front) is drawn;
  the heading slews at 2.7 deg/s, the speed slowly. Heading is where the wind blows toward, radians in the XZ plane (0 = +X, pi/2 = +Z).
* **Lightning and thunder.** In a storm with precipitation >= 0.5 a strike occurs with probability proportional to the precipitation (about one
  every 6 s at full intensity), at a drawn bearing and distance (80 to 2480 blocks) from the listener. Thunder arrives `distance / 343 m/s`
  later (up to 4 pending). Both are state (`StrikeSeq`, `ThunderSeq`), and the plugin turns new ones into `LightningEvent` / `ThunderEvent`.
* **Time and seasons.** `Clock` is the day clock in ticks, starting at 6000 (sunrise, the renderer's existing sky offset): `scene.NewSky(State.Clock)`
  is the matching sky. A day is 24000 ticks (20 min). With `Seasons` the temperature follows a 12 day year (288000 ticks) of +-9 C.
* **Temperature.** `10 C` mean + seasonal + diurnal (+-4 C, warmest at 14:24) + climate noise (`worldgen.ClimateAt`, +-8 C) - 0.15 C per block
  above `RefY` (20) - cover and precipitation cooling (up to 3 C). Integer milli-degrees; rain falls as **snow where `Temp <= SnowC` (0 C)**, so one
  front can be snow on a mountain and rain in the valley. There is no biome system yet, so the climate noise stands for biomes; a sand-storm
  front is not modelled (no desert biome exists).

## API

```go nocheck
st := weather.Res(ctx)                  // *weather.State, refreshed each frame (Update stage); also valid from Startup
l  := st.At(pos)                        // weather.Local at a world position (no allocation)
ex := weather.ExposureAt(st, blocks, reg, blockPos) // sheltered? under rain/snow? wet?
st.SkyLightFactor(); st.SkyLightLevel(15) // cloud/precipitation dimming for a sky-light level
```

`weather.State` (frame domain, plain copyable values): `Enabled`, `Frozen`, `TimeFrozen`, `Kind`, `Intensity` (precipitation 0..1), `Cover`, `Fog`,
`Humidity`, `Wetness`, `Wind{Dir, Speed, Vec, Gust}`, `Temp`, `Clock`, `DayTime` (0..1), `Day`, `Season`, `TicksLeft`, `Strike` and `Thunder`
(`{Seq, Tick, Bearing, Dist}`), `Overcast`, and `FlashAt(tick)` (lightning illumination envelope 0..1).

`weather.Local` (from `At`): `Kind` (snow only where it is cold enough), `Phase` (none/rain/snow), `Intensity`, `Temp`, `Humidity`, `Cover`, `Fog`,
`Wetness`, `Wind`, `Lightning` (a storm in the rain phase), `RainSupply`, `SnowSupply`, `Extinguish`.

`ExposureAt` scans the voxel column above the point (up to `MaxSkyScan` = 96 blocks) for a Solid or Opaque block: `Sheltered`, `CeilingY`,
`UnderRain`, `UnderSnow`, `Wet` (open sky under rain >= 0.15), `Wetness`. It is deterministic and does not allocate.

### Gameplay hooks (the sim does not edit voxels)

The repository has no fire and no sky-light level yet, so those are hooks, not behaviour: `Local.Extinguish` (rain strong enough to put a fire out)
and `State.SkyLightFactor()` (0.3..1) are what a fire system or a sky-light consumer should read, from FixedUpdate through
`weather.Of(sim).At(pos)` (journal-safe: it reads state only). `Local.RainSupply` / `SnowSupply` (0..1) are the **rain inflow hook for the water
simulation (W1)**: the water layer reads them per column; weather itself never places water, snow cover or ice. Snow accumulation and ice on
water are out of scope here and are extensions tied to the water/physics layer.

## Commands, editor and agents

One journaled command, `weather_set` (`weather.Set`), with optional fields: `enabled`, `type` (`clear|cloudy|fog|light_rain|heavy_rain|storm|snow`),
`intensity` 0..1 (precipitation for rain/storm/snow, fog density for fog, cloud cover for clear/cloudy), `cover`, `wind_dir` (degrees),
`wind_speed` (m/s, holds the wind until `wind_auto`), `time` (day fraction), `freeze` (stop the front), `freeze_time` (stop the clock), `seasons`,
`instant` (skip the smoothing), `plan` (the weather plan, below) and `day_length` (seconds per day, 60 and up). Anything but `enabled` needs the weather enabled. Validation happens before any change; a failed command leaves no
trace. `weather_restore` replaces the whole state (the inverse used by undo).

* **Editor**: Tools > Environment is a full-screen tool: the world with a wind compass (drag the dial to turn the wind), the Day strip (a 24 h
  band coloured by the sky, a sun marker you drag to set the time of day, and the plan lane), and Environment settings on the right (weather
  cards, intensity, wind, plan segments, time, start time, day length, freeze). The header switch (Frozen, Live x1, x60, x600) previews the time of
  day and the plan running in the editor at that speed: it is not saved, makes no undo step and no dirty flag, and leaving the tool, editing, or
  pressing Play puts the edited time and weather back (the preview is not journaled; strike flashes do not animate in it). `Freeze time` stays a
  separate setting that Play and the game obey.
  One change or one slider drag is one undo step; it is journaled, replayed by `editor_verify_replay` and restored exactly by Stop. The weather
  is a runtime setting of the world: saving a scene does not store it, except the plan and the day length, which go to `environment.json`.

### The weather plan

`Params.Plan` is a schedule of segments over the day: `{"from":250,"to":380,"type":"light_rain","intensity":600}` (`from` and `to` are permille
of the day, 0..1000, sorted and not overlapping; `type` is a kind name; `intensity` is permille, as the `intensity` of `weather_set`). While the day
clock is inside a segment the front is that segment's kind (the random fronts are held, `Sim.PlanSeg` says which segment runs); between segments
the weather changes by itself as before. Entering a segment starts its front with the smoothing of any other change. At most 24 segments.
Set it with `weather_set {"plan":[...]}` (an empty list clears it). The editor writes the plan and `day_length` to `environment.json` at the root
of the project and reads them back when the project opens; a game that installs `weather.Plugin` sets `Options.Params.Plan` itself.

### environment.json and the game

`environment.json` is `{"enabled":true,"plan":[...],"day_length":1200,"start_time":0.25}` (`weather.Env`). `start_time` is the time of day the game and
the editor's Simulate (Play) start at, a day fraction (0 midnight, 0.25 sunrise, 0.5 noon); it is `Params.ClockStart`, set with `weather_set
{"start_time":0.5}` (changing only `day_length` keeps the start fraction). A standalone game (`burrowplay`, the editor's Play window) that finds the file
loads it into the `weather.Plugin` options (`Env.Apply`): the weather is on unless `enabled` is false (older files without the field mean on), the
plan runs, and the sky, time and rain use the same `render.WeatherFX` as the editor. Without the file the game behaves as before (`runtime.weather`).
* **MCP**: `editor_weather` (same fields; no arguments reads; `at:[x,y,z]` also samples the local weather). `burrowd`/`burrowctl`: `vox_act` with
  `{"kind":"weather_set","data":{...}}`.

## Determinism contract

The plan (`Params.Plan`, `Sim.PlanSeg`) is part of the hashed state, so enabling the weather gives a different `StateHash` than before the plan existed (the 100k-tick golden changed once).

`StateHash` includes the weather (type, counters, targets, smoothed values, wind, strikes, clock, parameters, seed) when it is enabled, in the engine
extra `"weather"`; it is rolled back with a failed tick, snapshotted and restored, and replayed from the journal. Tests: 100k tick golden hash,
no per-tick jump, transition statistics, snow only below the threshold, journal replay, snapshot/restore, undo, zero allocation per tick
(`weather/*_test.go`, `editor/core/weather_test.go`). A snapshot taken before the module was installed does not restore into an engine that has it
(the extra count differs); this only affects snapshots saved by an older build.

## Time of day without the weather simulation

An `env.time` node with `frozen: true` (a day fraction, 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset) freezes the sky and sun of the running scene
**without** `runtime.weather`: the renderer builds `scene.NewSky(time * 24000)` from the frame-domain `engine.SceneRuntime`, the weather module
stays inert, the clock does not advance and the `StateHash` is bit for bit the same as without the setting (`internal/game` test
`TestSceneSettingsApplyAndKeepStateHash`). It overrides the weather clock while the scene runs. See [lighting.md](lighting.md#scene-settings-controller-and-hud).

## Environment components and the weather

`env.time` and `env.weather` ([lighting.md](lighting.md#environment-components-time-sun-sky-weather-fog-post)) are the declarative way to set the clock and the
front. Both are hashed (simulation state): the running game resolves them each frame and hands the clock and the front to this module as journaled
`weather_set` commands (`weather.SetFromEnv`), once per change, so they replay and enter the `StateHash` like any weather command. `env.time` sets the day
clock (`start`, `day_length`, `frozen`), `env.weather` holds a front (`kind`, `intensity`, wind, `frozen`) and works with the weather module enabled or not.
`env.sky.clouds`, `env.fog` and `env.sun` are renderer-only and never reach the module: a thick `env.fog` volume thickens the aerial perspective on top of the
weather fog (`WeatherFX.Fog` takes the larger), `env.sky.clouds` `on`/`off` replaces the cloud cover the weather asks for. The editor viewport shows `env.time`
as the sky time; it does not run the weather from it.

## What the shader stage (S3) consumes

The plugin's `weather.render` system (PostUpdate) reads `weather.Res(ctx)` once per frame, samples `st.At(camera position)` and
writes the frame resource `*render.WeatherFX` (`weather.RenderFX(st, cam, tick)`); `RenderPlugin` hands it to the Vulkan renderer,
and the editor viewport computes it for the editor camera. All levels `low`..`ultra` draw it; `-shaders off` ignores it.

| effect | inputs |
|---|---|
| sky time | `State.Clock` -> `scene.NewSky(Clock)` when `Enabled` (otherwise keep the existing sky tick) |
| cloud cover / overcast | `State.Cover` (target for `-clouds auto`; the CLI `-clouds` keeps priority), `State.Overcast`, `Local.Cover` |
| rain / snow particles | `Local.Phase`, `Local.Intensity`, `Wind.Vec` (slant), temperature for flake vs drop; draw only where the column is open (`ExposureAt` or a height map) |
| fog / mist | `Local.Fog`, `Local.Humidity`, `State.Kind == KindFog` |
| wet surfaces | `State.Wetness` / `Local.Wetness` (darker albedo, higher specular on opaque, non-sheltered pixels) |
| lightning | `State.FlashAt(tick)` (global fill light + sky), `State.Strike{Seq,Bearing,Dist}` for the bolt, `LightningEvent` / `ThunderEvent` for audio |
| wind on clouds and foliage | `Wind.Vec`, `Wind.Speed`, `Wind.Gust` (0..1), `Wind.Dir` |
| precipitation size | `render.WeatherFX.Unit` (voxels per metre, `weather.RenderFXUnit`): drop length and width, fall speeds, wind drift and the spawn box are in metres; the precipitation height map spans 64 m at every voxel size (`engine.PrecipGrid`: 64 x 64 texels of 1 voxel at 1 voxel per metre, up to 256 x 256 texels of several voxels, a texel being roofed by any of its columns) |
| ambient dimming | `SkyLightFactor()` on the sun term (the CPU twin `scene.Sky.Atmo(cover)` already takes a cover) |

## Project climate and local weather

`weather.SetClimate(c)` installs a project's own climate (`WeatherClimate(seed, x, y, z, clock) (tempC, humidity)`): `At`
takes the temperature and humidity of a place from it, and a precipitating front falls in rain cells that drift with the
wind. The climate may also implement `weather.LocalWeather`:

```go nocheck
WeatherOverride(seed uint64, x, y, z int, clock uint64) (kind weather.Kind, intensity float32, ok bool)
```

`At` asks it first; `ok=false` leaves the place to the front. `KindClear` stops any precipitation there (the sky clears:
cover at most 0.25, no fog), `KindCloudy` is overcast and dry, `KindFog` is fog of density `intensity` (0.8 when 0),
`KindLightRain`, `KindHeavyRain`, `KindStorm`, `KindSnow` fall with `intensity` (0 = the kind's usual one), rain or snow
by the place's temperature, `Lightning` set in a storm's rain phase. `Local.Override` tells that the place decided.
Neither the state nor its hash see it (like the climate): feed it from state every machine shares and install it on the
server and every client. `RenderFX` follows it at the camera (rain or snow, cloud cover, overcast and sunlight, fog,
wet ground): a player inside a rain disk sees rain, one outside does not. A local storm under a front that is not a
storm draws its own flashes (a pure function of the seed and the clock; no `ThunderEvent`, the game plays the thunder of
its own strikes). It is called from the tick and once per frame at the camera: keep it cheap.

## Limits and extensions

* No biome system: the climate is `worldgen.ClimateAt` (render-tint noise) plus altitude. A biome table would replace `Sim.at`'s two inputs.
* No sand storm (no desert biome), no snow cover, no ice on water, no fire, no per-entity wetness component; the hooks above are in place.
* Lightning is global (bearing and distance from the listener), not tied to a world column; a bolt that ignites or electrifies a block is a gameplay layer on top of `StrikeSeq`.
* Rendering (S3): snow does not accumulate, the bolt is a sky effect (no ground strike), `BURROW_LIGHTNING=<deg>` forces a bolt for captures.
