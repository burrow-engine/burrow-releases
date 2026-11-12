# Multiplayer

How scripts behave in a multiplayer session, which functions read the players, and what a script must never do. The protocol, hosting and joining are in [networking](../networking.md).

## Who runs what

Burrow multiplayer is server-authoritative ([replication](../replication.md)): the server runs the whole simulation, scripts included, and streams to each client what it needs. So:

* **Only the server runs scripts.** Clients run frame stages (rendering, UI, audio) on a replicated copy and never call a script. A script cannot tell which player is "local"; no SDK function returns a local player id. Keep per-player data under the player id and let the game's presentation code pick the local one.
* **Script `State` never reaches a client.** Anything a client must show or read (an inventory, a furnace, skills, a health bar) belongs in a **component** written by the script, with a visibility rule: everyone, the owner only, or nearby clients ([component visibility](../replication.md#component-visibility)). Rule of thumb: keep client-visible state in components, not in script `State`. A script may keep its working data in `State` and copy what clients show into the component when it changes.
* Frame-domain effects ([audio, particles, cameras, UI](07-effects.md)) are requested by the scripts on the server, which has no plugins for them and ignores them; a client's own presentation code produces them from the replicated components. A script cannot play a sound "only for player 3".

## Opting in

Add `"net": true` to `runtime.plugins` in `vox.project`. The plugin installs the hashed player registry (`net/netsim`), so a project without it keeps its old `StateHash`. Without it the three functions below return `UNAVAILABLE` (code 7), as they do outside a tick. Host with `burrow serve`, join with `burrowplay -connect`; see [networking](../networking.md#playing-host-join-editor).

## Player functions

Reads of simulation state: free of side effects.

| function | result | errors |
|---|---|---|
| `NetPlayerCount() (int, error)` | number of connected players | `UNAVAILABLE` without the plugin |
| `NetPlayerAt(i) (uint32, error)` | id of the i-th connected player, ascending ids | `UNAVAILABLE`; `NOT_FOUND`: `i` negative or past the end |
| `NetPlayerInfo(id) (NetPlayer, error)` | the player's record | `UNAVAILABLE`; `NOT_FOUND`: unknown id |

```go nocheck
type NetPlayer struct {
	ID        uint32
	Name      string
	Connected bool
	Input     NetInput
}
```

* Ids are assigned by the server and are stable across a reconnect (the token gives the slot back within the 60 s grace).
* A player who leaves stays in the registry with `Connected` false and an empty `Input`, so `NetPlayerInfo` still answers for that id; `NetPlayerCount` and `NetPlayerAt` list connected players only. After the grace period the record is removed and `NetPlayerInfo` gives `NOT_FOUND`.
* Join and leave are commands applied at a tick of the server.
* The registry also stores a join tick, a spawn point and a spawned flag; scripts cannot read them (`NetPlayer` has only the four fields above).

### Input

`NetInput` is quantized to integers so it hashes and travels exactly:

| field | unit and range |
|---|---|
| `MoveX`, `MoveY` | thousandths, -1000..1000 (strafe, forward) |
| `Yaw` | millidegrees, 0..359999 |
| `Pitch` | millidegrees, -90000..90000 |
| `Buttons` | bit field, one bit per game action |

The game window fills it from the input map every frame: action `move` gives the axes, action `look` (mouse delta) accumulates into yaw (0.1 degree per unit) and pitch (clamped to +-89), and every other action, in name order, is a button bit (bit 0 is the first name, at most 32, pressed above 0.5). Rename or add an action and the bits shift; derive them from the sorted action names of `input.json`.

`Input` is the player's **last applied** input: a client sends its input and the server applies it at a tick. It stays until the next input replaces it, and is cleared when the player leaves. Edges (pressed this tick) are derived by the script from its own `State`, as in [input](06-input-events-time.md).

### Local input does not exist in a session

The command that feeds `Action(name)` (`script_set_input`) is dropped by the command router on server and clients: in a session read `NetPlayerInfo` instead of `Action`. The local player's input reaches the simulation only through the server, so a script behaves the same for the local and for remote players.

## Rules for script authors

A script that follows the [determinism](../determinism.md) rules of the single-player engine is multiplayer-ready; these are the ones that bite:

1. **Only the simulation decides.** Use `Tick()`, `Rand()`/`RandN` (a per-script stream from seed, entity and tick), `NetPlayer*` and components. Never use anything that differs per machine: wall-clock time, the machine's locale, `os` calls, Go map iteration order (iterate sorted keys or slices), goroutines. The sandbox already blocks most of these (see [errors and limits](09-errors-and-limits.md)); the rest is your discipline.
2. **Iterate players in a fixed order.** `NetPlayerAt(0..n-1)` is ascending by id; keep that order when you spawn, score or tie-break.
3. **Never branch on frame-domain facts.** Do not use a sound, camera, UI or particle outcome as a condition (you cannot read them anyway), and do not store presentation state in components. UI input comes back only as `UIEvents` of `sim` widgets.
4. **No hidden state.** Guest memory resets before every call; anything that must outlive a tick lives in `State`, `Props` or components, which saves and snapshots carry. Only components reach clients.
5. **No hot reload.** Replacing a script module during a session is refused; modules are pinned by the project hash.
6. **Respect command whitelists for clients.** A client may submit only `net_player_input`, `set_block`, `fill_box` (4096 voxels), `fill_sphere` (radius 8) and `gameui_event` (when the project uses game UI). Script effects are not client commands: they run inside the server's simulation, so budgets and limits ([errors and limits](09-errors-and-limits.md)) apply to the server.
7. **Level changes** (`LevelLoad`) are served by the server's frame; clients load the same level files (they are part of the project hash). Calling it from several scripts in the same tick is a request race: designate one script.
8. **Test with two runs.** Run the project headless twice and compare `StateHash` ([debugging and testing](10-debugging-and-testing.md)).

## Example

An avatar per connected player, created on join and moved by that player's input. It runs unchanged on the host and on every client.

```go
package main

import (
	"fmt"

	"burrow-engine/sdk/burrowsdk"
)

const speed = 6.0 // blocks per second at full stick

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			n, err := burrowsdk.NetPlayerCount()
			if err != nil {
				return // plugin off: nothing to do
			}
			for i := 0; i < n; i++ { // ascending ids: a fixed order
				id, err := burrowsdk.NetPlayerAt(i)
				if err != nil {
					continue
				}
				p, err := burrowsdk.NetPlayerInfo(id)
				if err != nil {
					continue
				}
				name := fmt.Sprintf("avatar_%d", id)
				avatar, err := burrowsdk.FindByName(name)
				if err != nil {
					_, _ = burrowsdk.Spawn("", burrowsdk.SpawnOpts{
						Name:      name,
						Transform: &burrowsdk.Transform{Pos: [3]float32{float32(id) * 3, 10, 0}, Scale: [3]float32{1, 1, 1}},
					})
					continue // it exists from the next tick
				}
				t, err := burrowsdk.GetTransform(avatar)
				if err != nil {
					continue
				}
				t.Pos[0] += float32(p.Input.MoveX) / 1000 * speed * float32(dt)
				t.Pos[2] -= float32(p.Input.MoveY) / 1000 * speed * float32(dt)
				t.Rot[1] = float32(p.Input.Yaw) / 1000
				_ = burrowsdk.SetTransform(avatar, t)
			}
		},
	})
}

func main() {}
```

Leaving players keep their avatar here; despawn it when `p.Connected` is false to clean up.

## Ready-made base script: the `multiplayer` template

The `multiplayer` template (`burrow new -t multiplayer`) ships exactly this pattern as an overloadable
base script, `scripts/avatars/main.go`: one avatar per connected player, driven by
`NetPlayerInfo(id).Input` into a `physics.character` component (walk intents + facing), and in solo
(no connected players) the same script falls back to `Action()` on its own `player` node. Tweak the
`props` of the `script` component in `scenes/main.voxscn` (`speed`, `sprint_mul`, `jump_bit`,
`sprint_bit`, `auto_test` — the last one walks forward regardless of input, so movement is verifiable
headlessly), or edit and rebuild the script (`burrow script build`). Remember the rule above: in a
session `Action()` is empty by design, so a player script must read `NetPlayerInfo`, not `Action`.

## Lobby functions

With `runtime.lobby` ([lobby](../lobby.md)) three more functions exist, all `UNAVAILABLE` without it: `LobbyPhase() (int, error)` (0 lobby, 1 countdown, 2 playing, 3 results), `ReadLobby() (LobbyInfo, error)` (phase, host, match counter, countdown, slots with team and colour, the chosen settings, the last results, the configuration) and `LobbyEndMatch(results []byte) error` (ends the running match with a JSON verdict of at most 4096 bytes; `REJECTED` when no match is running). The end takes effect when the script call commits; clients see the new phase through the replicated lobby state.

## See also

* [Networking](../networking.md): the model, hosting, pins, limits.
* [Lobby](../lobby.md): teams, colours, ready, settings, match results.
* [Replication](../replication.md): what clients receive, and component visibility.
* [Determinism](../determinism.md): the rules the server relies on.
* [Execution model](02-execution-model.md), [input, events, time](06-input-events-time.md).
* [Effects](07-effects.md): what runs per peer on the screen.
* [Embedding and ABI](12-embedding-and-abi.md): `net_player_*` in the ABI table.
