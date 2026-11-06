# Audio

Burrow's audio subsystem is **frame domain**: it never reads or writes simulation state, so it can never change a `StateHash`.
The simulation can only *request* sounds (`audio.SoundEvent`, deterministic per tick) and the frame domain turns requests into
voices. Packages: `audio` (mixer, decoders, synthesis, backends; no engine dependency) and `audio/audioplug` (the engine plugin).

## Quick start

Enable it in `vox.project` (the sandbox template does): `"runtime": { "plugins": { "audio": true } }`. This installs the mixer,
the `audio_source` / `audio_listener` scene components and, in windowed runs, the sandbox ambience. In code:

```go
package main

import (
	"burrow-engine/audio"
	"burrow-engine/audio/audioamb"
	"burrow-engine/audio/audioplug"
	"burrow-engine/engine"
)

func main() {
	app := engine.New(engine.Options{Seed: 1})
	app.AddPlugin(&engine.ScenePlugin{})
	app.AddPlugin(&audioplug.Plugin{Component: true, Backend: "null", Hooks: []audioplug.Hook{audioamb.New()}})
	// a deterministic gameplay system asks for a sound; the frame domain plays it
	app.AddFixedSystem("bell", func(c *engine.FixedContext) error {
		if c.Tick%100 != 0 {
			return nil
		}
		return audioplug.Emit(c, audio.SoundEvent{Kind: audio.EvPlay, Sound: "assets/confirm.wav", Bus: "ui"})
	})
	if err := app.RunHeadless(300); err != nil {
		panic(err)
	}
}
```

`Plugin.Component` registers the scene components. The component registry is part of `StateHash`; audio is off by default
(`runtime.plugins.audio: true` enables it, the ambience and music need it), and any `.voxscn` / `.prefab` of the project mentioning `audio_source` /
`audio_listener` registers the components too (scanned once at build, so headless and windowed runs register the same set and a
later scene never fails with "unknown component"). `audio: false` together with such a scene is a build error. The editor always registers them (like
`character`), so its document hash differs from a runtime that does not use audio. `Backend` is `auto` (a sound device if
one opens, else silent), `device` or `null`; the environment variable `BURROW_AUDIO=null` forces silence and
`BURROW_AUDIO_DEVICE=<id>` picks the output (the editor's Audio tool sets it from *Output > Device*).

## Mixer model

| concept | details |
|---|---|
| buses | `sfx` (default), `music`, `ambient`, `ui`, all summed into `master`. Volume 0..4, mute per bus. |
| ducking | `DuckRule{Source, Target, Gain, Attack, Release}`: while a voice plays on Source, Target is lowered. Default: UI lowers music (0.6) and ambient (0.7). |
| voices | at most `MaxVoices` (default 32). A new sound outranks a playing one with a lower `Priority`, or an equal priority and a louder gain; the quietest lowest-priority voice is stolen (5 ms fade), otherwise `Play` returns `ErrNoVoice`. |
| spatial | listener position and orientation, distance attenuation (`inverse`, `linear`, `exponential`, `none`; `min_dist`, `max_dist`, `rolloff`), constant-power stereo panning, optional doppler (`Plugin.Doppler`). Silent past `max_dist` (linear fade over the last 10%). |
| occlusion | sources with `occlusion` raycast through the voxel grid (each opaque solid block adds 0.35); the voice is low-passed (20 kHz down to 500 Hz) and attenuated up to 6 dB, smoothly. At most 12 rays per frame. |
| music | `Mixer.PlayMusic(params, fade)` crossfades; OGG files over 256 KiB on the music bus are decoded progressively. |
| loops, one-shots | `Loop` repeats seamlessly; one-shots free their voice at the end. Pitch resamples on the fly (linear). |
| formats | WAV (PCM 8/16/24/32, float 32/64, extensible, mono/stereo) and OGG Vorbis; `Clip.Resample` converts rates. |

The listener is, in order: the node of an `audio_listener` component (highest priority), the editor camera override, the active
`camera` node, then the player camera. Positions use the engine convention (x right, y up, yaw 0 looks -Z).

## Every sound comes from an entity

A sound is never "just played": it is emitted by an entity placed in the scene, and its **mode** says who hears it.

| mode | who hears it | position |
|---|---|---|
| `global` | every player | none (plain stereo) |
| `local` | one player: the `player` field, 0 = the player that owns the entity (found by walking up to a `player` component), else the local player of the client | none |
| `localized` | everyone, attenuated by distance (the default) | the entity's world position plus an optional offset |

Each client decides for itself whether it is a listener (`audio.Audible`, `audioplug.Resolve`): a `local` sound aimed at another player
is simply not played here. All of this is frame domain, so the StateHash never changes. This covers music, ambience, script and visual-script
sounds, footsteps, block break / place / hit impacts and UI sounds. `audio.SoundEvent.Entity` is mandatory for `EvPlay`
(`Validate` rejects an entity-less play), `Mode` and `Player` choose the audience and `X, Y, Z` is the offset from the entity.

## Scene components

`audio_source`: `asset`, `bus`, `volume`, `pitch` (0 = 1), `loop`, `mode` (`global|local|localized`, default localized), `player`,
`spatial` (deprecated alias: true = localized, false = global, only read when `mode` is empty; `Source.MigrateMode` rewrites it), `autoplay`, `muted`, `min_dist`, `max_dist`, `rolloff`,
`model`, `priority`, `occlusion`. A source plays from its node position (it follows the node; velocity feeds the doppler). Editing
volume/pitch/muted/position updates the live voice, changing the asset or the spatial settings restarts it. In the editor, sources
sound only in play mode. A `local` source is silent on the clients of other players. `audio_listener`: `priority`. Both appear in the
inspector through the component schema.

### Music and ambience are entities

* `audio.music` (prefab `builtin:music.prefab`): `mode` (`local` default, or `global`), `player`, `context` (empty = automatic day / night / cave from the
  clock and the cover above the listener; or `day`, `night`, `cave`, `menu` or any custom `music.<name>` of the sound pack), `sound` (a project asset looped
  instead of the pack's music), `volume`, `crossfade` (seconds, 0 = the pack's), `disabled`. The sound pack's music scheduler (gaps, tracks, crossfade)
  runs on each client that is a listener of the entity. Several entities: the lowest entity id that this client hears wins.
* `audio.ambient` (prefab `builtin:ambience.prefab`): `mode`, `player`, `volume`, and switches `weather` (rain, wind, thunder), `water` (streams and waterfalls
  scanned around the listener), `lava`, `cave` (random cave noises underground), `disabled`.
* `player.sounds` on the player prefab: `overrides` (`event`, `sound`, `volume`, `pitch`) replace single pack events (`step.grass`, `player.jump`,
  `block.break.stone`, `ui.click`...) for that player; an empty `sound` silences the event; `mute` silences the player's footsteps, impacts and UI sounds; `pack` is the project path of a sound pack folder (`sounds.json` or the folder layout, no `..`, relative) whose events replace the project's mapping for that player's own sounds (events it does not map keep the project's; `overrides` still win).
  Without the component the sound pack decides, as before.

All three are scene-level data (like the `env.*` components): decoded in every scene, not part of the StateHash. New projects and the templates carry a
`Music` and an `Ambience` node. **With no `audio.music` / `audio.ambient` entity there is no music or ambience.** Compatibility: a project whose scenes never
mention these components keeps the old always-on music and ambience (also a packed game) until a scene gets such an entity; from then on the entities alone
decide. `burrow migrate` turns the old `scene.settings.music` into a `Music` node with `audio.music {context}`; a modal screen's `music` still picks the context of an automatic `audio.music`.

## Sound events from the simulation


`audioplug.Emit(fixedCtx, SoundEvent)` (or scripts, below) sends the event with `engine.SendFixed`: one ordered list per tick, byte
identical across replays, delivered to the frame domain as the `audio.SoundEvent` event type. Kinds: `EvPlay`, `EvStop`, `EvSet`,
`EvBus`, `EvStopAll`, `EvListener`, `EvMusic` (host code only: scripts do not send it any more, see `audio.music`). `audio.MakeHandle(source, tick, seq)` makes a deterministic handle so a later
`EvStop`/`EvSet` can address the voice. With no audio plugin the events are ignored.

## Scripts

Host functions in module `vox` (ABI additive, see `script/ABI.md`): `audio_play`, `audio_stop`, `audio_set`, `audio_bus`,
`audio_music` (removed: always `DENIED`, the music is the `audio.music` component of an entity), `audio_listener`. **Breaking change:** `audio_play` must name
an entity in its options (`entity`, self or another node); without one it fails with `INVALID`. Go SDK in `sdk/burrowsdk/audio.go` (`PlayOn(entity, name, SoundOpts)`
replaces `AudioPlay` / `AudioPlayAt` / `AudioMusic`; `SoundOpts.Mode`, `Player`, `Offset`):

```go nocheck
h, _ := burrowsdk.PlayOn(self, "assets/thunder.wav", burrowsdk.SoundOpts{Bus: "ambient", Volume: 0.8, Offset: &[3]float32{10, 5, -3}})
burrowsdk.AudioSet(h, 0.4, -1) // quieter, pitch unchanged
burrowsdk.AudioStop(h, 0.5)
```

## Built-in sandbox ambience (`audio/audioamb`, installed with `Plugin.Hooks`)

* rain loop from `render.WeatherFX` (rain intensity), wind loop from the wind speed and gusts, thunder on `weather.ThunderEvent`
  (placed at the strike bearing);
* flowing water: the fluid cells around the listener (17 x 9 x 17) set the loudness of a stream loop at their centroid; vertical
  liquid columns drive a waterfall loop; still water is silent;
* footsteps from the player controller every 2.1 blocks walked, on the ground only (never in fly mode), on the material of the block under
  the feet, and a landing thud; block break / place / hit sounds from the edits of the player. These are emitted **by the player entity** (the
  `player` node of this client): footsteps `localized` at its feet, impacts `localized` at the block (an offset from the player), UI sounds (`ui.click`, `ui.hover`, `ui.open`, `ui.close`, `ui.back`, `ui.error`, `ui.slider`, `ui.tick`, sent
  as an `audio.UIEvent` by the game UI) `local`. The footsteps of the other players are derived from the motion of their nodes (a stepper per player id), so every
  client hears them without any network traffic. `Audio.Emitted` lists the last emissions (entity, event, mode, position) for tools and tests. Without a player
  node (a bare simulation) a legacy project plays them from the listener, any other client plays nothing.
* music, cave noises, lava, streams and the weather sounds run only for the `audio.music` / `audio.ambient` entity in effect for this client (see above).

The hook plays **nothing by default**: its sounds come from a sound pack (below); an event the pack does not map is silent.

## Sound packs

Burrow's game binaries (`burrowplay`, `Burrow.exe`, `voxel_sandbox`) embed a small **default sound pack** (`assets/sounds/default/`, ~6 MB, CC0 files from
Kenney and Juhani Junkala, credits in its `CREDITS.md`; `-tags nosounds` compiles it out): footsteps per material, block break / place / hit, jump / land,
UI click, a cave creak and six calm music tracks. It is the base layer: a user pack overrides it **per event** (events the user pack does not map still play
from the default). It also has rain, wind and thunder, flowing water and lava loops (original filtered noise, generated by `assets/sounds/gen/weather.py`). Not covered yet, therefore silent: water splash / enter / exit (map them in your pack).
`-sounds off` (or `none`, also in `BURROW_SOUNDS` and `runtime.audio.pack`) disables every pack, the default one included.

A **user** sound pack is a folder of your own `.ogg` (Vorbis) / `.wav` files on your machine that the game maps to
engine events. **You are responsible for the rights of the files you use.** A pack is read at run time from where it is; it is
**never bundled into an export**: `burrow build` refuses to pack a project whose asset folders contain a `sounds.json` or a `.burrow` folder, or
that contain the configured pack folder (any of the four locations below), and `scripts/dist-windows.sh` and `scripts/dist-engine-windows.sh` (`make dist-all`) refuse to zip one. Keep the
pack outside the project. A project that owns its pack can declare it with `runtime.audio.default_pack` (a project folder; its `sounds.json` is then allowed). Plain audio files in a project's own asset folders are never refused.

Where the game looks, first match wins:

1. `-sounds <dir>` (`voxel_sandbox`, `burrowplay`)
2. environment variable `BURROW_SOUNDS`
3. `runtime.audio.pack` in `vox.project` (absolute, `~/...`, or relative to the project folder; a packed game ignores relative paths)
4. `~/.burrow/sounds`, if it exists

`voxel_sandbox` needs `-audio`; `burrowplay` needs `runtime.plugins.audio: true` (the sandbox template has it). `runtime.audio` (all optional):
`pack`, `music_gap_min` / `music_gap_max` (seconds of
silence between tracks, default 90..240), `music_fade` (3), `music_volume` (0.6).

### Folder layout (no `sounds.json`)

Without `sounds.json` the folder is read by convention (the folder itself, or a `sounds/` subfolder). The numbers at the end of a file name
are variants (`grass1.ogg`, `grass2.ogg`):

```
step/grass1.ogg stone1.ogg wood1.ogg sand1.ogg gravel1.ogg snow1.ogg cloth1.ogg (wool1 also)   -> step.<material>, block.hit.<material> (quiet)
dig/stone1.ogg grass1.ogg wood1.ogg gravel1.ogg sand1.ogg glass1.ogg ...                         -> block.break.<material>, block.place.<material>
liquid/swim1.ogg  splash.ogg  water.ogg (loop)  lava.ogg (loop)                                  -> step.swim, water.splash, fluid.water.flow, fluid.lava
random/splash.ogg  click.ogg                                                                     -> water.splash, ui.click
damage/hit1.ogg                                                                                  -> player.hurt
ambient/cave/cave1.ogg cave2.ogg ...                                                             -> ambient.cave
ambient/weather/rain1.ogg (loop)  thunder1.ogg  wind1.ogg (loop)                                 -> ambient.rain, ambient.thunder, ambient.wind
music/game/*.ogg (subfolders ok)                                                                 -> music.day, music.night, music.cave (streamed)
music/menu/*.ogg                                                                                 -> music.menu
```

The table is data (`audio/soundpack/autodetect_table.go`): edit the rules to fit another naming scheme. Only `.ogg` and `.wav` are read.

### `sounds.json`

When present it replaces the autodetect. Reloaded while the game runs (checked every 2 s; a broken file keeps the previous mapping and warns).

```json
{
  "version": 1,
  "fallback": "none",
  "music": { "gap_min": 120, "gap_max": 300, "fade": 4, "volume": 0.5 },
  "materials": { "my_custom_block": "metal", "red_*": "cloth" },
  "material_fallback": { "cloth": "grass" },
  "events": {
    "step.grass": [ "step/grass1.ogg", { "file": "step/grass2.ogg", "weight": 2, "volume": 0.8, "pitch": [0.9, 1.1] } ],
    "block.break.stone": [ { "file": "dig/stone1.ogg", "attenuation": { "ref_dist": 3, "max_dist": 24 } } ],
    "ambient.rain": [ "ambient/rain.ogg" ],
    "music.day": [ { "file": "music/a.ogg", "stream": true }, { "file": "music/b.ogg", "stream": true } ]
  }
}
```

A variant is a file name or an object: `file` (relative path, slash separated), `weight` (default 1), `volume` (default 1), `pitch` (`[min, max]`
or `[value]`), `stream` (decode progressively: use it for music), `attenuation` (`ref_dist`, `max_dist`, `rolloff`, for sounds placed in the world).

Events: `step.<material>`, `block.break.<material>`, `block.place.<material>`, `block.hit.<material>` (mining ticks), `player.jump`, `player.land`,
`player.hurt`, `water.splash`, `water.enter`, `water.exit`, `ambient.cave`, `ambient.rain`, `ambient.thunder`, `ambient.wind`, `fluid.water.flow`,
`fluid.lava`, `ui.click`, `ui.hover`, `ui.open`, `ui.close`, `ui.back`, `ui.error`, `music.day`, `music.night`, `music.cave`, `music.menu`. Materials: `stone wood grass dirt sand gravel snow cloth glass metal water swim`
(plus your own). The material of a block comes from its name (`soundpack.MaterialOf`: `red_wool` is cloth, `oak_planks` wood, `sandstone` stone, ...),
overridden by `materials` (exact name or `prefix*`). An event with no entry for a material tries `material_fallback` (default: dirt, snow, cloth ->
grass; sand -> gravel; gravel, glass, metal, wood -> stone; swim -> water), then the plain family event (`step`, `block.break`, ...).
The default pack ships `ui.click` and small procedural sounds for `ui.hover`, `ui.open`, `ui.close`, `ui.back`, `ui.error`, `ui.slider` (a slider value change, at most one every 60 ms) and `ui.tick` (a choice stepper step), generated by `go run ./assets/sounds/gen/uisounds` into `assets/sounds/default/sfx/ui_*.wav`. A pack on top that does not map one of them keeps the default sound; a pack without a default underneath plays its `ui.click` softer and at a fixed pitch instead (map the event, even to nothing, to override). `player.hurt` and `ui.click` are mapped but nothing in the sandbox fires them yet (scripts and games can).

### Behaviour

* Variants are chosen by a seeded RNG per event (weighted, never the same file twice in a row). This is frame domain: it never touches the simulation or `StateHash`.
* Footsteps: one per 2.1 blocks walked (distance, not frames), on the ground, never in fly mode; swimming strokes in water; jump, landing, water enter / exit.
* Block sounds come from the edits of the player (seen as changes under the crosshair); hit ticks play while the attack button is held on a block.
* Music: a random track of the context (cave when under a roof of 6+ solid blocks, night / day from the weather clock, day otherwise), faded in and
  out, one track at a time, a random silence of `music_gap_min..max` seconds between tracks, a context change fades the track out. `ambient.cave` plays
  at random (25..80 s) underground. Rain, thunder and wind follow the weather; water and lava loops follow the nearby liquid. "Dark" is not tested: the
  block light is renderer-only.
* Limits: `sounds.json` 1 MiB, 1024 events, 256 variants per event, 4096 in total; 32 MiB per file (64 MiB streamed), decoded clips of at most ~2 minutes
  (use `stream`), the OGG/WAV decoder limits above; paths with `..`, absolute paths, `\`, drive letters and every symbolic link are refused; the autodetect reads at most
  8192 files, 6 levels deep. Decoded clips live in a 64 MiB LRU cache and are decoded on first use.
* `BURROW_SOUNDS_TRACE=1` prints every resolved sound on stderr (with the null backend, `BURROW_AUDIO=null`, it shows what would play).

## Music contexts

The `audio.music` component (`context` empty) picks the music context `day`, `night` or `cave`; a non-empty `context` fixes it. Two frame-domain requests override
the automatic choice, when the sound pack has
`music.<context>` (otherwise day/night continues): the `music` field of the running scene's `scene.settings` component, and the topmost modal game UI
screen's `music` (`(*uiplug.GameUI).ModalMusic()`, which wins over the scene). `"menu"` plays `music.menu` (`music/menu/*.ogg`). The time of the `env.time` node
also decides day or night for the music. The request is the `engine.SceneRuntime.Music` resource field, set by `internal/game`.

## Backends and testing

`audio.NewBackend(kind, rate)`: `device` plays through [miniaudio](https://miniaud.io) via
[gen2brain/malgo](https://github.com/gen2brain/malgo) (public domain; CoreAudio, WASAPI, PulseAudio / ALSA) in builds with cgo (the editor
and the game), which lists the outputs (`audio.OutputDevices`) and opens the chosen one (`audio.SetPreferredDevice`, or live with the
backend's `SetOutputDevice`; a device that is gone falls back to the system default). Builds without cgo (servers, tools) keep
[ebitengine/oto v3](https://github.com/ebitengine/oto) (Apache-2.0), which only plays on the system default. `null` renders nothing until you call `Pump`. `Mixer.Render` is deterministic, so tests
render offline: build a mixer, `Play`, `Update`, then `RenderFrames(n)` and compare with a golden WAV (`audio/testdata`,
refresh with `go test ./audio -run Golden -update`; the comparison tolerates 3 LSB because FMA differs between CPUs). Real sound
output cannot be verified in CI.

## Editor and agents

* Tools > Audio: a full-screen tool like the model editor. **Mixer**: one channel strip per bus (Master, Music, Sound effects,
  Ambient, UI) with the voice count, a level meter (`BusInfo.Level`, the peak of the last ~100 ms), a fader in dB (+6 to silence;
  double-click resets to 0 dB), **Mute** and **Solo** (`Mixer.SetBusSolo`: while any sub-bus is soloed the others are silent; a
  muted bus stays muted; the master cannot be soloed; Alt+click Mute solos; solo is a session tool and is not saved). **Sounds**
  and Audio settings: the project's `.wav`/`.ogg` files with a play/stop preview (on the `ui` bus), a bus hint and the length
  (`Audio.Duration`), and the output (backend, voices, sample rate). **Stop all** stops every voice. In the asset browser, a
  `.wav`/`.ogg` selection shows a play button; double-click auditions it.
* The mix (bus volumes and mutes) is saved in `vox.project` under `settings.audio_mix` (`audio.Mix`: `{"volumes":{"music":0.5},
  "muted":["ui"]}`, only what differs from the default) and applied when the tool opens; every edit is one undo step. To start a
  game with the saved mix set `audioplug.Plugin.Mix`.
* MCP tool `editor_audio` (`state`, `list`, `play`, `stop`, `bus`, `music`, `render`): in a headless editor `render {ms}` renders the
  mixer offline and reports `peak` and `rms`, so an agent can check a sound without a speaker.

A null backend has nobody pulling audio, so the plugin advances the mixer with a virtual clock (`Mixer.Discard`) every frame:
one-shots end and stopped voices are freed in headless runs too.

## Robustness

Sound loads are bounded: at most 8 uncached disk reads per frame (`ErrBusy`, retried next frame), a 256-entry negative cache whose
entries expire after 3 s (`Audio.Invalidate(name)` forgets one sooner), compressed music kept once for streaming, one `EvMusic` per
frame and none for the music already playing. OGG output is limited to 2000 frames per input byte. Non-finite or overflowing
geometry is inaudible rather than poisoning the mix, samples are clamped to +-8 and denormals flushed. `State` reports the backend
and its device error.

## Voice chat

Proximity voice chat between players is a separate plugin built on this mixer: each remote speaker is a spatial stream voice
on the `sfx` bus, placed at the speaker's position and fading to silence at the voice radius. See [Voice chat](voice.md).

## Limits

Mono or stereo only; no HRTF, reverb zones or streaming WAV. Decoders are bounded (`audio.MaxFrames`) and never panic on hostile input
(fuzzed). Decoding a clip happens on first use in the frame thread.
