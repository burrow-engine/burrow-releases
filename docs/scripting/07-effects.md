# Effects: audio, particles, animation, cameras, UI, models

What a script can trigger outside the simulation core, and which of it is replayed, hashed or only presented.

## Two domains

| domain | functions | when applied | in the `StateHash` | replay |
|---|---|---|---|---|
| frame (presentation) | `Audio*`, `Particle*`, `Camera*`, `UI*` setters | queued at commit, delivered after the tick, in call order | no | the same requests are re-emitted when ticks are re-executed |
| simulation | `Anim*`, `SpawnModel`, `UIEvents` (read) | `Anim*` and `SpawnModel`: at commit, like `Set` / `Spawn`; `UIEvents`: reads the journaled inbox now | yes | exact |

Rules for every frame-domain call:

* Queued with the buffered effects of the transaction: if the script faults, its sounds, bursts, camera and UI requests are dropped with everything else.
* Deterministic and never read back. There is no return value that depends on the presentation (a handle is derived from the tick, never from the mixer). A script cannot learn whether a sound loaded, a voice was stolen, a rig exists or a screen exists.
* Ignored, with `nil` error, when the plugin is off: `runtime.plugins.audio: false`, `particles: false`, `camera: false`, `gameui: false` in `vox.project` (all on by default, see [project-config](../reference/project-config.md)). `App.VerifyReplay` and rolled-back ticks drop the requests; headless runs with the plugin installed process them (audio on the silent null backend). The `StateHash` is identical with or without them.
* Each request costs one host call and one **event** of the budget (64 per script per tick, 4096 per tick overall, shared with `Emit` and `Publish`; see [errors and limits](09-errors-and-limits.md)). Over budget the call returns `BUDGET` (code 5). A HUD that sets 70 keys every tick exhausts it: set a key only when it changes.
* A NaN or Inf in `SoundOpts` / `ParticleOpts` makes the SDK's JSON encoding fail silently and the call goes out with no options (defaults). In the camera and UI setters it returns the Go encoding error instead of a `*burrowsdk.Error`.
* Argument errors come back at call time: `INVALID` (1) for NaN or out-of-range numbers, `REJECTED` (8) for malformed option JSON, `LIMIT` (9) for oversized options, `UNAVAILABLE` (7) outside a tick. Validation of the engine side (unknown rig, unknown screen, missing file) happens later, in the frame, and is silent for the script.
* Per frame the plugins consume a bounded number of requests and drop the rest: camera 64, game UI 128, particles 256. Audio has no such cap, but the mixer has 32 voices by default.

See the generated signatures in [Script API](../reference/script-api.md#audio).

## Audio

Plugin: `runtime.plugins.audio`. Subsystem: [audio](../audio.md).

| function | what it does | errors |
|---|---|---|
| `PlayOn(entity, name, SoundOpts) (SoundHandle, error)` | start a sound emitted by an entity (self or another node), return its handle | `INVALID`: no entity (0), a pending entity, unknown `Mode`, empty name, name over 256 bytes, unknown bus, NaN, volume or pitch outside 0..8 or negative, fade NaN. `NOT_FOUND`: no such entity. `REJECTED`: bad options JSON |
| `AudioStop(h, fade)` | fade the sound out over `fade` seconds (0..60, clamped) | `INVALID`: handle 0 |
| `AudioSet(h, volume, pitch)` | change a playing sound; a negative value keeps the parameter | `INVALID`: handle 0, NaN, a value over 8 |
| `AudioBus(bus, volume)` | volume of `sfx`, `music`, `ambient`, `ui` or `master`, 0..4 | `INVALID`: unknown bus, NaN, outside 0..4 |
| `AudioListener(e)` | use entity `e` as the ears; 0 returns to the default listener | `NOT_FOUND`: no such entity |

`SoundOpts` (zero value = all defaults):

| field | default | range |
|---|---|---|
| `Bus` | `sfx` | `sfx`, `music`, `ambient`, `ui` |
| `Volume` | 1 | 0..8 (0 means 1, not silence) |
| `Pitch` | 1 | 0.05..8 after clamping (0 means 1) |
| `Loop` | false | |
| `Priority` | 0 | -100..100; a higher priority survives voice stealing |
| `Fade` | 0 | fade-in seconds |
| `Mode` | `localized` | `global` (every player, no position), `local` (one player, no position) or `localized` (3D at the entity: distance attenuation, panning, occlusion through voxels) |
| `Player` | 0 | `local` only: the player that hears it; 0 = the player owning the entity, else the local player |
| `Offset` | none | `localized` only: position relative to the entity |

**Breaking change.** Every sound comes from an entity placed in the scene. `AudioPlay`, `AudioPlayAt` and `AudioMusic` are gone; the music is the `audio.music` component of an
entity (write its `sound` / `context` fields with the component functions). The raw `audio_music` host function always returns `DENIED`.

**Names.** A sound name is a project-relative path to a `.wav` or `.ogg` file (`assets/sfx/coin.ogg`), read through the project source (files in a packed game included, 64 MiB per file). Files are decoded on first use, at most 8 new loads per frame; a sound requested while the budget is spent is skipped. `builtin:<name>` is documented in the SDK comment and used by some templates, but **the engine has no builtin sounds any more** (the synthesised set was removed), so such a call returns a handle and plays nothing.

**Sound pack.** The pack (default and user packs, `sounds.json`) belongs to the engine's ambience hook: it maps engine events (`step.stone`, `ui.click`, music scheduling) to files and plays them itself. Scripts cannot trigger pack events and the pack cannot see script sounds. They share the same mixer: buses, the 32-voice limit and ducking (a sound on `ui` lowers `music` and `ambient`) apply to both. The `audio.music` component picks between the pack's scheduler and a looped `sound` asset, so a game that drives its music from a script writes that component instead of fighting the pack.

**Handles.** `SoundHandle` is positive and derived from (entity, entry point, tick, request index): a replay produces the same values, and it is valid for the voice that call started. A handle may be kept in `State` and used in later ticks as long as the voice exists. `AudioStop` / `AudioSet` on a finished, stolen or never-started voice succeed and do nothing. A one-shot ends by itself; only loops need a stop.

**Other details.**

* `AudioSet` clamps: volume 0..8, pitch 0.05..8. Here `0` really sets 0 (silent) and 0.05 for pitch; only negative means "keep". It cannot move a 3D sound (position is fixed at play time).
* `AudioListener` beats an `audio_listener` component and the camera. If the entity is despawned the default listener comes back.
* Without a sound device or in headless runs the null backend runs the mixer silently.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Engine burrowsdk.SoundHandle `json:"engine"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			h, err := burrowsdk.PlayOn(self, "assets/sfx/engine.ogg",
				burrowsdk.SoundOpts{Bus: "ambient", Loop: true, Volume: 0.6, Fade: 1})
			if err == nil {
				_ = burrowsdk.SaveState(state{Engine: h})
			}
		},
		OnDestroy: func(self burrowsdk.Entity) {
			st, _ := burrowsdk.LoadState[state]()
			_ = burrowsdk.AudioStop(st.Engine, 0.5)
		},
	})
}

func main() {}
```

## Particles

Plugin: `runtime.plugins.particles`. Subsystem: [particles](../particles.md).

| function | what it does | errors |
|---|---|---|
| `ParticleBurstOn(entity, effect, ParticleOpts)` | one-shot effect emitted by an entity (self or another node), at `Offset` from it; lives on its own | `INVALID`: no entity (0), empty or over-long (256) effect, huge offset, count outside 0..4096, scale outside 0..16. `NOT_FOUND`: no such entity. `REJECTED`: bad options JSON |
| `ParticleBlockBreakOn(entity, block, ox, oy, oz)` | debris of a broken block, centred on the offset from the entity | as above |
| `ParticleEmit(e, count)` | emit `count` extra particles from the `particle_emitter` component of `e` | `INVALID`: entity 0, count outside 1..4096. `NOT_FOUND`: no such entity |
| `ParticleStop(e)` | stop the emitter of `e` and clear its particles; entity 0 clears every particle | `NOT_FOUND`: no such entity |
| `Shockwave(entity, ox, oy, oz, radius, strength, duration)` | expanding ring of distorted air emitted by an entity, centred on its position plus the offset (heat-haze style lens ripple, see [rendering.md](../rendering.md) "Air distortion"): grows to `radius` blocks over `duration` seconds and fades; needs shader level medium and up | `INVALID`: no entity (0), NaN or huge offset, radius outside 0..256, strength outside 0..8 (0 means 1), duration outside 0..30 s |


`effect` is `builtin:smoke`, `sparks`, `dust`, `splash`, `fire`, `debris` or a `.particles.json` project path. `ParticleOpts`: `Offset` (from the emitter, default at it; `Entity` is filled by `ParticleBurstOn`), `Dir` (emission axis override, world space), `Count` (default the asset's burst, else 16), `Scale` (size, spawn volume and speed multiplier, 0 means 1), `Block` (block name whose texture replaces the sprite, for debris).

* Randomness is seeded from the tick and the request index, so a replay shows the same burst. An unknown effect or block draws nothing and raises no error.
* `ParticleEmit` / `ParticleStop` need the entity only to exist: an entity without `particle_emitter` is accepted and ignored. An emitter is switched on and off with its `enabled` field (`Set` / `SetBool`, simulation domain).

```go nocheck
_ = burrowsdk.ParticleBurstOn(self, "builtin:sparks", burrowsdk.ParticleOpts{Offset: &[3]float32{4, 20, -3}, Count: 24, Scale: 0.5})
_ = burrowsdk.ParticleBlockBreakOn(self, "stone", 4.5, 20.5, -2.5)
_ = burrowsdk.ParticleEmit(self, 50)
```

## Animation

Not a frame-domain effect. `Anim*` edit the `anim.player` component of the entity: the change is applied at commit, journaled, hashed and replayed exactly, and the `anim.step` system advances the player with the fixed tick. Use it for animation that matters to gameplay (moving platforms, doors, hazards); purely visual animation runs in the frame domain on the host. Subsystem: [animation](../animation.md).

| function | what it does | errors |
|---|---|---|
| `AnimPlay(e, clip, AnimPlayOpts)` | play `clip` now (or queued) | `NOT_FOUND`: entity or its `anim.player` missing. `LIMIT`: queue already holds 64. `INVALID`: empty or over-long (128) clip name. `NOT_FOUND` also for entity 0 |
| `AnimStop(e)` | halt the player, the pose stays | `NOT_FOUND` |
| `AnimSetSpeed(e, speed)` | speed multiplier, 0..100 (0 means 1) | `INVALID`: NaN or outside the range |
| `AnimSetParam(e, name, v)` | set a state machine parameter (bool = 0/1) | `INVALID`: NaN or Inf. `LIMIT`: 64 parameters already set |
| `AnimTrigger(e, name)` | raise a trigger parameter; the next transition that tests it consumes it | `NOT_FOUND` |
| `AnimTime(e) (int64, error)` | playhead in microseconds | `NOT_FOUND` |

`AnimPlayOpts`: `Mode` (`AnimMode`: `AnimDefault` = the clip's flag, `AnimOnce`, `AnimLoop`, `AnimPingPong`), `Queue` (play after the current clip ends; if nothing is playing it starts now), `FadeMillis` (crossfade, 0..65535 ms).

* The clip name is not checked: an unknown clip plays nothing and is not an error. Clips and machines come from `.anim` files of the project.
* `AnimPlay` detaches the player from its state machine (`machine` and `state` are cleared); to drive a machine, set `machine` on the component and use `AnimSetParam` / `AnimTrigger` only.
* Reads see your own writes in the same call. Events crossed by the last advance are in `anim.player.fired` (read with `FieldRaw(e, "anim.player", "fired")`), at most 256 per tick.
* The component must already be on the entity (scene or prefab); these calls never add it.

```go nocheck
_ = burrowsdk.AnimPlay(door, "open", burrowsdk.AnimPlayOpts{Mode: burrowsdk.AnimOnce, FadeMillis: 150})
_ = burrowsdk.AnimSetParam(door, "locked", 0)
_ = burrowsdk.AnimTrigger(door, "slam")
```

## Cameras

Plugin: `runtime.plugins.camera` (also enabled by a scene that uses `camera_rig`). Subsystem: [cameras](../cameras.md). Rig names are the `name` of a `camera_rig` component or of a rig in `runtime.camera.rigs`.

| function | what it does | errors |
|---|---|---|
| `CameraSwitch(rig, blend)` | activate a rig, blending over `blend` seconds | `INVALID`: empty rig name, name over 64, blend NaN or outside 0..1000 |
| `CameraShake(amount)` | add trauma 0..1 (the total is capped at 1; amplitude grows with its square) | `INVALID`: NaN or outside 0..1000 |
| `CameraCut()` | mark a discontinuity (teleport, respawn): temporal history is dropped | none |

`blend` 0 is a cut that resets TAA/FSR2 history; blends longer than 30 s are clamped; switching between perspective and orthographic rigs always cuts; switching to the active rig is a no-op. An unknown rig is dropped in the frame without a trace in the script. Shake values above 1 are accepted and clamped by the controller.

```go nocheck
_ = burrowsdk.CameraSwitch("iso", 0.6)
_ = burrowsdk.CameraShake(0.4)
```

## Game UI

Plugin: `runtime.plugins.gameui`. Subsystem: [game UI](../game-ui.md). Screens are `*.ui.json` files named after the file (or listed in `runtime.gameui.screens`).

| function | what it does | errors |
|---|---|---|
| `UISetNum(key, v)` / `UISetStr(key, v)` / `UISetBool(key, v)` | bind a value to `key` (bars, `{key}` in labels, `bind_visible`) | `INVALID`: NaN, over 1e15, string over 4096 bytes, key over 128 |
| `UISetItems(key, []UIItem)` | bind an item list (grid, list); `UIItem{Icon, Text, Count}`, empty `Icon` = empty slot | `INVALID`: more than 4096 items, text or icon over 4096 |
| `UIShow(screen)` / `UIHide(screen)` / `UIToggle(screen)` | screen visibility | `INVALID`: name over 128 |
| `UILocale(code)` | switch locale (`""` or over 16 bytes is dropped in the frame) | |
| `UILabel(id, x, y, z, text, bar)` | persistent world-space nameplate; `bar` 0 = none, else (0,1] | `INVALID`: NaN |
| `UIPopup(x, y, z, text, life)` | floating number that rises and fades over `life` seconds | `INVALID`: NaN |
| `UIRemoveLabel(id)` | remove a nameplate | |
| `UIEvents(since) ([]UIEvent, uint32)` | journaled UI events newer than `since`, and the latest sequence number | no error: returns nothing without the plugin |

Details:

* Setters are frame domain and last-write-wins per key. An unknown screen, a full value store (1024 keys) or a pool of 128 labels / 128 popups drops the request in the frame. `UIShow` of a modal screen takes input focus.
* The host also accepts `focus` (`ui:focus`) and `clear_labels` and a label `color`/`size`; the Go SDK has no wrapper for them (use a UI action in the `.ui.json` instead).
* **Events back.** A widget with `"sim": true`, or an action starting with `sim:`, becomes the journaled command `gameui_event` stored in a 32-event ring (simulation state, hashed). `UIEvents` returns events with `Seq > since` and the new last sequence; keep it in `State`:

  | field | meaning |
  |---|---|
  | `Seq` | increasing event number |
  | `Screen`, `Widget` | screen name and widget `id` |
  | `Kind` | `click`, `select`, `move`, `use`, `change`, `submit`, `cancel` |
  | `Action` | the widget's `action` string |
  | `Value` | text (input fields, up to 1 KiB) |
  | `Index`, `To` | slot index; `To` is the destination of a `move` |

* Poll every tick: the reply buffer is 4096 bytes. If the JSON of the pending events is larger (a full ring of long names can be), the call returns nothing and `since` does not advance. Events a widget does not mark `sim` never reach scripts.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Seen  uint32 `json:"seen"`
	Coins int    `json:"coins"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			evs, last := burrowsdk.UIEvents(st.Seen)
			for _, e := range evs {
				if e.Kind == "click" && e.Action == "sim:buy" {
					st.Coins--
					_ = burrowsdk.UISetNum("coins", float64(st.Coins))
					_ = burrowsdk.UIPopup(0, 12, 0, "-1", 1)
					_ = burrowsdk.CameraShake(0.2)
				}
			}
			if last != st.Seen {
				st.Seen = last
				_ = burrowsdk.SaveState(st)
			}
		},
	})
}

func main() {}
```

## Models

`SpawnModel(asset, voxelScale, SpawnOpts) (Entity, error)` is `Spawn` with a `render.voxmodel` component (`cast_shadow` on). It adds no host call: the spawn is an ordinary journaled command with the same rules and budgets as [Spawn](04-entities-and-scene.md) (32 per script per tick), and errors are `Spawn`'s. `asset` is a project path to a `.bmodel` or `.vox`; `voxelScale` is the world size of one voxel (0 means 1/16). An unknown asset spawns the node and draws nothing (a warning is logged by the host). Model editing and character models: [modeling](../modeling.md), [character](../character.md).

```go nocheck
crate, err := burrowsdk.SpawnModel("assets/models/crate.bmodel", 0.0625, burrowsdk.SpawnOpts{
	Name: "crate", Transform: &burrowsdk.Transform{Pos: [3]float32{4, 10, 4}, Scale: [3]float32{1, 1, 1}},
})
```

## Editor overlay and editor commands

`DrawBox(min, max, opts)`, `DrawLine(a, b, opts)`, `DrawSphere(center, r, opts)` and `DrawLabel(pos, text, opts)` (`DrawOpts{Color, Layer, Life}`) draw debug shapes in the editor viewport. `EditorZoneAdd`, `EditorZoneRemove`, `EditorSpawnAdd` and `EditorSpawnRemove` queue authoring edits for the level. All take **world** blocks.

They are **frame domain**, like particles: queued at commit, never part of the simulation state (the state hash and replays are unchanged), and ignored when the game runs outside the editor. `Life` is a number of frames (0 = this frame only, at most 600); a label is at most 128 bytes and a layer name at most 32. The editor applies the queued `Editor*` commands to the level draft as **one undo step when Play stops**, so the edit survives the snapshot restore of Stop. Errors: `INVALID` for a bad shape or command.

```go nocheck
burrowsdk.DrawBox([3]float32{0, 10, 0}, [3]float32{8, 14, 8}, burrowsdk.DrawOpts{Color: burrowsdk.RGBA{255, 80, 0, 255}, Life: 60})
burrowsdk.EditorZoneAdd("arena", [3]float32{0, 10, 0}, [3]float32{8, 14, 8}, map[string]string{"team": "red"})
```

## See also

* [Execution model](02-execution-model.md): transactions, commit, what a fault drops.
* [Errors and limits](09-errors-and-limits.md): error codes, event and call budgets.
* [Entities and scene](04-entities-and-scene.md): `Spawn`, components, tags.
* [Multiplayer](08-multiplayer.md): effects run on every peer.
* [Cookbook](11-cookbook.md): sound on event, burst on hit, HUD counter.
* [Script API reference](../reference/script-api.md), [ABI](../../script/ABI.md).
* Subsystems: [audio](../audio.md), [particles](../particles.md), [animation](../animation.md), [cameras](../cameras.md), [game UI](../game-ui.md).

## Application control

Plugin: none (the launcher, `burrowplay`, serves it). A script can quit the game, join or host a multiplayer game, play or create a world and go back to the title screen, the same things the game UI actions `app:*`, `net:*` and `world:*` do:

```go nocheck
burrowsdk.AppQuit()
burrowsdk.NetJoin("burrow://host:7777?fp=...&key=...", "Ada") // name "" = the user name
burrowsdk.NetHost("Ada")                                      // embedded server, you play on it; the join link is printed
burrowsdk.WorldPlay("w1")                                     // a world is a save slot (docs/levels-saves.md)
burrowsdk.WorldCreate("w2", "My world", 0, "flat", "creative") // seed 0 = random, generator "" = the project's
burrowsdk.Title()                                             // back to the start scene
burrowsdk.SetShaders("high")                                  // shader level, no restart (docs/rendering.md)
burrowsdk.SetGraphics("god_rays", 32)                          // one graphics setting on top of the level
burrowsdk.SetGraphicsOn("bloom", false)
burrowsdk.ResetGraphics()                                      // back to the level's preset
```

These are frame domain (`app_cmd`): they only queue a request that ends the windowed run when the invocation commits, then the launcher builds what was asked. The window stays open across the change, like in Minecraft: the old game shows the loading screen, the new one keeps it up while the world around the player streams in (the simulation is held meanwhile, so nobody falls through missing terrain; 15 s at most), then the game starts. To move between scenes of the same game without rebuilding it, use `SceneSwitch`. They never change the `StateHash`; headless runs, replays and `-shot` runs ignore them, and only the first request of a run is served. A bad slot name or link returns `INVALID`.
