# Voice chat

Proximity voice chat lets players talk through their microphone. The others hear them **spatialised** by the engine mixer: louder
when close, panned left or right by direction, fading to silence at a radius, and not played at all beyond it. Voice is frame
domain like chat: it is **never simulation state**, never journaled, never part of a snapshot or a `StateHash`.

Packages: `voice` (the client and the engine plugin), `voice/capture` (microphones), `voice/codec` (frame format and codec),
`voice/route` (the server's routing and limits), `voice/voicecfg` (the `runtime.voice` section).

## Setup

Voice chat is **off by default** because it opens the microphone. Turn it on in `vox.project` (multiplayer, `runtime.plugins.net`,
must stay on):

```json
{
  "runtime": {
    "plugins": { "voice": true },
    "voice": { "radius": 32, "mode": "push_to_talk", "key": "V" }
  }
}
```

Hold **V** to talk. When the project's input map defines a `push_to_talk` button action (or the action named by
`runtime.voice.action`), that action is used and can be rebound like any other. Otherwise the plugin reads `runtime.voice.key`
directly, ignored while a modal UI context is open so typing in a text field never transmits. The plugin never adds the action to
the map itself: the action list is journaled script input and gives the network button bits, so adding one would change the
simulation. (Defining it in your own map does add it there, on purpose.)

Playback needs the audio plugin (`runtime.plugins.audio: true`): each remote speaker is a spatial stream voice on the `sfx`
bus at mixer priority 50. The listener is the audio listener (the active camera).

## Configuration reference (`runtime.voice`)

| key | default | meaning |
|---|---|---|
| `radius` | 32 | blocks; farther speakers are not heard (1..512) |
| `ref_distance` | 2 | full volume up to this distance, then inverse-distance falloff, fading to 0 over the last 10% of the radius |
| `mode` | `push_to_talk` | or `voice_activation` (energy detector with an adaptive noise floor and 300 ms hangover) |
| `action` | `push_to_talk` | input action held to talk, when the input map defines it |
| `key` | `V` | key held to talk when the map has no such action |
| `max_speakers` | 8 | remote speakers heard at once (1..32); further speakers are dropped until one stops |
| `channels` | `["proximity"]` | channels the player may speak on: `proximity`, `team`, `global` (the server allows `global` to admins only) |
| `vad_threshold_db` | -40 | voice activation level in dBFS |
| `noise_gate_db` | -55 | frames quieter than this are silenced while transmitting (-100 = off) |
| `mic_gain` | 1 | microphone gain (0..8) |
| `volume` | 1 | volume of every received voice (0..4) |

`burrow check` validates the section (an unknown key, mode, channel or key name is an error, and `runtime.voice` needs
`plugins.voice: true`).

**Configuration hash.** Voice is presentation, so `runtime.voice` is not part of the session configuration hash. The radius matters
for fairness (who can eavesdrop), but the **server** enforces it with its own `route.Config` and its own authoritative positions; a
client that changes its radius only changes what it plays, never what it receives.

## In game code

The plugin inserts a `*voice.Voice` resource:

```go nocheck
v := engine.Res[*voice.Voice](app)
v.SetMuted(playerID, true)            // personal mute (also sent to the server when the transport supports it)
v.SetMicMuted(true)                   // close the microphone
v.SetMode(voicecfg.ModeVoiceActivation)
v.SetPushToTalk(true)                 // push-to-talk from a UI button or a script
v.SetChannel(codec.ChannelTeam)       // one of runtime.voice.channels
v.SetMicGain(1.5); v.SetVolume(0.8)
for _, t := range v.Talking() { fmt.Println(t.Name, t.Distance) } // closest first
state, err := v.Mic()                 // "none", "off", "starting", "on", "error" + why
```

`voice.SpeakerGain(cfg, listener, pos)` returns the distance gain the mixer applies, for UI hints.

### HUD values

Every change is published to the game UI (`gameui.Request` events, frame domain), so a `.ui.json` screen can show speaker icons
without code:

| value | type | content |
|---|---|---|
| `voice_talking` | items | one row per remote speaker heard now: icon `builtin:volume-2`, text = name |
| `voice_talking_count` | number | rows of `voice_talking` |
| `voice_transmitting` | bool | the local player is sending |

Names come from `Plugin.NameOf` (default `Player <id>`).

## Network

Voice rides the multiplayer session next to chat. Nothing to wire in a
game: when the project has `runtime.plugins.voice`, `netplay.StartHost` (`burrow serve`, `burrow-server`) relays voice with the
project's `runtime.voice` routing, and `netplay.Join` (`burrowplay -connect`) attaches the session to the voice plugin.
`netplay.StartHostApp` (the editor's listen server) relays voice only when `HostOptions.Voice` is set.

**Messages** (see [Networking](networking.md#protocol)):

| type | name | direction | fields |
|---|---|---|---|
| `0x80` | VoiceUp | C→S | `bytes` voice frame (1..256): the sender's own voice; there is no speaker field to forge |
| `0x81` | VoiceDown | S→C | `uv` speaker (≥1), `bytes` voice frame (1..256), forwarded unchanged |
| `0x82` | VoiceBlock | C→S | `uv` player (≥1), `bool` blocked: a personal mute |

**Server.** `replica.ServerConfig.Voice` (a `*VoiceConfig` with the `route.Config`) turns
relaying on; nil refuses every voice message, counts it (`VoiceStatus`, `Disabled`) and records a violation. With voice on,
each frame goes through `voice/route` with the **server's** positions, never the client's:

* the player's interest center (its authoritative avatar, else its leashed view), the position of replicated
  proximity chat; the listen host's own player uses the avatar / spawn point rule.

Teams come from the lobby (`net/lobby`, spectators have none) when installed; on a listen server only the host's own player
is an admin (may speak on `global`). A listener is `Congested` when its connection holds 64 KiB or more not yet consumed
(`VoiceConfig.Congestion`): its copy is dropped, never queued, so voice never delays a batch or a frame, and a full window
never kicks anyone because of voice. Voice is not part of the replicated bandwidth budget, the journal, a snapshot or a
`StateHash`. A player who leaves is forgotten (limits, block lists); a server mute stays until lifted.

Violations (each counts toward the kick for abuse like any refused message): a frame over the speaker's rate limit, a
malformed frame header, more than 256 personal blocks, any voice message to a server without voice. An oversized message
(over 256 bytes) or a `VoiceDown` sent by a client is a protocol error and ends the connection.

Server API (both servers, and the `netplay.Server` interface):

```go nocheck
srv.MuteVoice(player, true)              // moderation: nobody hears the player (false when voice is off)
on, m, muted := srv.VoiceStatus()        // m: gate.VoiceMetrics{In, Out, Dropped, Refused, Disabled, Bad}
srv.SubmitVoice(localPlayer, frame)      // a listen server's own player (AddLocalPlayer)
srv.BlockVoice(localPlayer, speaker, true)
```

A dedicated server has the admin commands `voice mute <name>`, `voice unmute <name>` and `voice status`
([Dedicated server](dedicated-server.md)).

**Client.** `replica.Client` implements `voice.Transport` and `voice.Blocker`: `SendVoice` never blocks
and drops the frame (`ErrVoiceDropped`) when the client is not in a game or 32 KiB are already queued; `OnVoice` runs on the
goroutine that polls the client. `internal/netplay` attaches them: `Guest.Voice` and `Host.Voice` (a listen server's own
player) are the app's `*voice.Voice` with `SetTransport` done, `PositionOf` the world transform of each player's avatar as
drawn (smoothed in the replicated model) and `NameOf` the registry name. A guest sends its personal mutes again after a
reconnect. `HostOptions.Voice` (a `*route.Config`, default `netplay.VoiceRoute(runtime)`) overrides the routing.

For other transports the client side is one interface:

```go nocheck
type Transport interface {
	SendVoice(frame []byte) error           // must not block: drop the frame when congested
	OnVoice(func(from uint32, frame []byte)) // frames from other players, any goroutine
}
```

`Voice.SetTransport(t)` attaches it after the session connects. A transport that also implements
`SetVoiceBlocked(player uint32, blocked bool) error` (`voice.Blocker`) receives personal mutes so the server stops sending them.
`Plugin.PositionOf(player) (mathx.Vec3, bool)` gives each speaker's frame-domain position (the interpolated avatar head); without
it, or for team and global frames, voices play centred.

The routing itself is `voice/route`, which has no session dependency:

```go nocheck
r := route.NewRouter(route.Config{Radius: 32, Channels: []codec.Channel{codec.ChannelProximity, codec.ChannelTeam}})
to, err := r.Route(time.Now(), from, frame, players, nil) // players: []route.Player{ID, Pos, HasPos, Team, Admin, Congested}
for _, id := range to {
	sendVoiceTo(id, from, frame) // forward the frame unchanged
}
```

`Route` checks the header, the server mute (`SetServerMuted`), the speaker's rate limits (60 frames/s and 12000 bytes/s with a 1 s
burst by default), the channel rules, the radius against the **server's** positions and each listener's block list
(`SetBlocked`), then drops the copy for a listener whose connection is `Congested`, who is over its byte budget (50400 bytes/s by
default) or who already hears `MaxSpeakers` others. Voice is always the first traffic to drop: losing a frame costs 20 ms of
concealed audio, nothing else. `route.Recipients` is the stateless part (channel, radius, blocks) for callers that keep their own
limits. `Forget(id)` cleans up after a player leaves. `net/gate.VoiceHub` wraps a router with the per-player bookkeeping both
servers share (block list bound, persistent server mutes, counters).

## Format and bandwidth

16 kHz mono, 20 ms frames, IMA ADPCM (4 bits per sample). A frame is an 8-byte header (codec id, flags: start/end of a talk spurt
and the channel, a 16-bit sequence number, the ADPCM predictor and step index) and 160 bytes of audio: 168 bytes, 50 per second,
about **67 kbit/s per active speaker** (plus the transport's own framing). Each frame carries the decoder state it starts from, so a
lost frame is a 20 ms gap, never a corrupted stream. The codec id leaves room for a better codec later.

Receivers keep a jitter buffer per speaker: 60 ms target, growing by 20 ms after an underrun (up to 200 ms) and shrinking back after
5 s without one, frames reordered by sequence number, late frames dropped, a missing frame replaced by the previous one attenuated
(up to 80 ms), and a backlog skipped down to the target.

## Privacy

* Voice is **never recorded or stored**. Frames exist in memory between capture and send, and between receive and playback.
  Nothing is written to disk, to a replay or to a save.
* In push-to-talk mode the microphone is **open only while the key is held**. In voice activation mode it stays open while voice
  activation is enabled (`SetVoiceActivation(false)` or `SetMicMuted(true)` close it); only frames above the threshold are sent.
* Muting a player drops their frames locally and, with a supporting transport, asks the server not to send them.
* Servers forward frames without decoding them and keep no copy.

## Microphone permissions

| OS | backend | permission |
|---|---|---|
| macOS | AudioToolbox AudioQueue through purego (no cgo) | the system asks once per app. A packaged `.app` must declare `NSMicrophoneUsageDescription` in `Info.plist`, or macOS terminates it on first access: `burrow build` writes it for game apps, and the editor installer's plist has it. A binary started from a terminal is attributed to the terminal app. Denied: System Settings > Privacy & Security > Microphone. |
| Linux | PulseAudio record stream (PipeWire's pulse server works) through `jfreymuth/pulse` (pure Go) | none beyond access to the user's sound server; sandboxed (Flatpak) builds need the `--socket=pulseaudio` permission |
| Windows | winmm `waveIn` through `golang.org/x/sys/windows` | Settings > Privacy > Microphone > "Let desktop apps access your microphone" |

Opening the microphone never blocks a frame: it runs on a worker goroutine (the macOS prompt can take seconds). Failures are
reported by `Voice.Mic()` (`capture.ErrNoDevice`, `capture.ErrPermissionDenied`) and retried every 5 s while push-to-talk is held.
A microphone that delivers only digital silence for 2 s is reported too (a denied permission on some systems looks like that).
`BURROW_VOICE_MIC=off` disables the microphone. Headless runs and servers never open one.

## Testing

Tests need no microphone: `capture.Fake` feeds samples, a fake transport links two apps, and the null audio backend advances the
mixer. `go test ./voice/...` covers the codec (SNR thresholds and a decoder fuzz target), voice activation, the jitter buffer
(reorder, loss, late frames, wrap-around, adaptation), the spatial gain, the routing rules and limits, and a two-app loopback.
`BURROW_VOICE_REAL_MIC=1 go test ./voice/capture -run Real` records one second from the real default microphone.

## Limits

* The capture backends build without cgo on all three systems, but automated tests use the fake device only: run the opt-in
  real-microphone test on each platform before relying on it.
* No echo cancellation: use headphones, or push-to-talk.
* No resampling on capture: the device must accept 16 kHz mono (PulseAudio and the Windows wave mapper convert; AudioQueue
  converts).
* IMA ADPCM is simple and robust but costs about 67 kbit/s per speaker; a narrowband codec would cut that by 4 to 8.
* Speakers beyond `max_speakers` are dropped first come, not by distance.
* Voice uses the `sfx` bus: the sound effects volume applies to it, and voice does not duck music.
