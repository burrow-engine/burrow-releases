# Dedicated server

`burrow-server` is a headless server for [Burrow multiplayer](networking.md): it hosts one game, keeps the world on disk and
runs until you stop it. Players join with `burrowplay -connect`, exactly as for `burrow serve`, but nobody has to keep a game window open.

## Contents

* [What it is](#what-it-is)
* [Quick start](#quick-start)
* [Data directory](#data-directory)
* [server.json](#serverjson)
* [Commands](#commands)
* [Admin control](#admin-control)
* [Large servers](#large-servers)
* [Saves and game changes](#saves-and-game-changes)
* [Lobby mode](#lobby-mode)
* [Deploying](#deploying)
* [Firewall and ports](#firewall-and-ports)
* [Backups and restore](#backups-and-restore)
* [Upgrading the game](#upgrading-the-game)
* [Security notes](#security-notes)
* [Limits](#limits)

## What it is

* **Headless.** No window, no GPU, no audio. It runs on any small Linux VPS.
* **cgo-free.** A single static binary (`CGO_ENABLED=0`); it cross-builds for Linux, macOS and Windows with `make server-dist`.
* **Persistent world.** The world is restored from `world/world.snap` at start and saved on a timer, on `save` and on shutdown.
* **Same protocol as `burrow serve`.** Clients need nothing special; see [Networking](networking.md).

## Quick start

```sh
burrow-server init --data ./srv --project ../mygame     # writes srv/server.json and the TLS certificate
burrow-server run  --data ./srv                         # starts the server on :7777
burrow-server ctl  --data ./srv link                    # prints the join link (from another terminal)
```

`--project` is a path relative to the data directory: a project directory or a `.voxpak`. Give the join link to your players.

## Data directory

Everything the server writes lives in one directory (`--data`, default `.`):

| path | content |
|---|---|
| `server.json` | the configuration ([below](#serverjson)) |
| `join.key` | the generated join password, mode `0600` (only when no password is set) |
| `cert/` | `server.crt` and `server.key` (mode `0600`): the TLS identity, created by `init` |
| `world/world.snap` | the current world snapshot |
| `world/meta.json` | metadata of the world: seed, tick, save time, engine version, project name and content hash |
| `world/backups/world-<UTC timestamp>.snap` | rotated backups |
| `players.json` | roster `{"players": {"<key>": {"id": N, "name": "last name"}}}`. The key is the player's identity id (anonymous players: `name:<lowercased name>`), so a player keeps its id after renaming and a name owned by one identity is refused to others. The old `{"ids": {...}}` format is migrated on start |
| `bans.json` | banned names, identities (`identities`) and addresses |
| `whitelist.json` | allowed names or identity ids |
| `control.sock` | unix socket of the admin control, mode `0600` |

## server.json

`burrow-server init` writes the defaults. Unknown fields are an error.

| field | default | meaning |
|---|---|---|
| `project` | none | game to host, path relative to the data directory: a project directory or a `.voxpak` |
| `world` | `"world"` | directory of the world, relative to the data directory |
| `addr` | `":7777"` | listen address (TCP, TLS) |
| `advertise` | `""` | `host:port` written in the join link; set it to the public name when it differs from `addr` |
| `password` | `""` | join password. Empty and `open` false: a random key is generated once and kept in `join.key` |
| `open` | `false` | `true` accepts players without any password |
| `max_players` | `16` | players connected at the same time: at most 1024 |
| `view` | `0` (default) | view distance in chunks of each player ([Replication](replication.md)) |
| `bytes_per_second` | `0` (default) | bandwidth budget per player |
| `migrate` | `false` | start a saved world after the game lost a component, dropping its saved values (see [Saves and game changes](#saves-and-game-changes)) |
| `seed` | `0` | world seed; `0` means the project's. Ignored once a world exists: the world's seed wins |
| `autosave_minutes` | `5` | autosave period; `0` disables it |
| `backups` | `5` | rotated backup copies kept |
| `pause_when_empty_seconds` | `60` | once no player has been connected for that long, the simulation stops (no tick: the world, the time of day and the game's rules wait) after a save; it resumes as soon as a player is authenticated. `0`: the world keeps running with nobody on it |
| `motd` | `""` | chat line sent by the server whenever a player joins (at most 200 bytes) |
| `whitelist` | `false` | only names or identities in `whitelist.json` may join |
| `mode` | `"persistent"` | `"persistent"`: the world is restored, autosaved and saved on shutdown (a survival-style server). `"lobby"`: matches (see [Lobby mode](#lobby-mode)). |
| `claim_anonymous` | `false` | let the first identity that joins with a name take the anonymous roster entry of that name. Off by default, because anybody could claim someone else's past; use the `claim` command instead |
| `require_identity` | `true` from `init`; `false` when absent | reject clients without an identity key (`<config dir>/burrow/identity.key`, created by the client) |

The environment variable `BURROW_SERVE_PASSWORD` overrides `password`.

## Commands

```
burrow-server init [--data DIR] --project PATH     write DIR/server.json with defaults (fails if it exists), create cert
burrow-server run  [--data DIR] [--config FILE] [--addr A] [--advertise H:P] [--password P | --open] [--max-players N]
burrow-server ctl  [--data DIR] <command...>       send an admin command to the running server
burrow-server version
```

`--data` defaults to `.`; `--config` defaults to `DIR/server.json`. The flags of `run` override the file.
`init` fails if `server.json` already exists. `ctl` talks to the unix socket `DIR/control.sock`.

Signals: `SIGTERM` and `SIGINT` save the world, then stop. On start the world is restored from `world.snap`, and players still marked
connected (after a crash) are marked left. The journal is trimmed before each save so snapshots stay small.

## Admin control

The same commands work on the console (stdin, when the server runs in a terminal) and through `burrow-server ctl`:

| command | effect |
|---|---|
| `list` | connected players |
| `status` | JSON: project, tick, players, max players, uptime, last save, paused (nobody connected), motd, whitelist, require_identity, connected players with their identity ids, certificate fingerprint, engine |
| `link` | print the join link |
| `say <text>` | message to every player |
| `kick <name> [reason]` | disconnect a player |
| `ban <name> [reason]` | ban the identity of the known player with that name (an anonymous one: the name) and kick it |
| `ban-ip <addr>` | ban an address |
| `pardon <name\|identity\|addr>` | lift a ban |
| `claim <name> <identity id>` | bind an anonymous player's roster entry (its id, so its per-player state) to an identity; the player sees the exact command when the server refuses its name |
| `whitelist on\|off\|add <name\|identity>\|remove <name\|identity>\|list` | manage the whitelist |
| `lobby` | the lobby state as JSON (games with `runtime.lobby`) |
| `lobby start\|cancel\|return` | start the countdown, cancel it, go back to the lobby after a match (the server acts as player 0, always an authority) |
| `lobby end [results JSON]` | end the running match |
| `lobby set <key> <value>` | change a game setting |
| `voice mute <name>` | mute a player's voice chat for everyone; kept across reconnects until lifted ([voice chat](voice.md)) |
| `voice unmute <name>` | lift a voice mute |
| `voice status` | voice relaying on/off, frame counters (in, out, dropped, refused, malformed) and muted players, as JSON |
| `save` | save the world now (persistent mode only) |
| `stop` | save and stop |

`control.sock` is mode `0600`: whoever can open it is an admin, so only the user running the server (and root) can use `ctl`.

## Large servers

The server alone simulates ([Replication](replication.md)), and each player receives only the chunks and entities around it, so a
server holds up to 1024 players and a big world. Tune `view` and `bytes_per_second`; roughly 300 busy players per
core at 20 ticks per second, about 100 KB/s per player in a busy area and a few hundred bytes per second in a quiet one. Lobby
mode works the same way: the lobby state is replicated to every client.

## Saves and game changes

The world restored at start must fit the game. A component the game gained is added empty (logged). A component the game lost
would lose its saved values: the server refuses to start with `the saved world holds component data the game no longer has:
<component> (<n> values)`. Restore the previous component name, set `"migrate": true` in `server.json` to drop that data
(the previous save stays in `world/backups`), or move the `world` directory away for a new world. A plugin turned on or off
(lobby, weather, fluid) cannot be converted and is named in the error.

## Lobby mode

With `"mode": "lobby"` the server hosts matches instead of a lasting world, for games with a lobby (`runtime.lobby`, see
[Lobby](lobby.md)): players gather, pick teams and colours, get ready, and the host starts the match.

* Nothing is saved or restored: every server start is a fresh world. The journal is still trimmed every `autosave_minutes`.
* While a match runs (countdown or playing), new players are refused with "a match is running" unless the lobby sets `late_join`;
  players who lost their connection may still come back. A full lobby (`max_players` of the lobby, without spectators) refuses
  new players too.
* With `"host": "server"` in the lobby configuration, only the server changes settings and starts matches: use `lobby set`,
  `lobby start` and `lobby end` (from `ctl`, or from a script of your own). With `"host": "first"` the first player hosts.
* The world is not reset between matches by the server: the game does it when the match starts (load the map level, see
  [Loading the chosen map](lobby.md#loading-the-chosen-map-when-the-match-starts)).

## Deploying

### systemd

`deploy/install.sh` (also in the `server-dist` archives) does it all, on Linux as root:

```sh
sudo sh deploy/install.sh ./burrow-server ./mygame        # or ./mygame.voxpak
```

It creates the system user `burrow`, `/var/lib/burrow-server` (mode `0750`), copies the binary to `/usr/local/bin`, the game to
`/var/lib/burrow-server/game`, runs `init` if `server.json` is missing, then installs, enables and starts `burrow-server.service`.
It is safe to run again (to update the binary or the game). The unit is hardened (`ProtectSystem=strict`, no capabilities, restricted address families)
and reads optional settings from `/etc/burrow-server.env`, for example `BURROW_SERVE_PASSWORD=...`.

```sh
sudo systemctl status burrow-server
sudo journalctl -u burrow-server -f
sudo runuser -u burrow -- burrow-server ctl --data /var/lib/burrow-server link
```

### Docker

```sh
make server-image                       # docker build -f deploy/docker/Dockerfile -t burrow-server .
mkdir -p data && cp -R ./mygame data/game && sudo chown -R 65532 data
docker compose -f deploy/docker/compose.yaml run --rm burrow-server init --data /data --project game
docker compose -f deploy/docker/compose.yaml up -d
```

The image is distroless, runs as `nonroot` (uid 65532), keeps everything in the `/data` volume and exposes `7777/tcp`. The game goes
to `/data/game`, either copied into the volume as above or mounted: `-v /path/to/mygame:/data/game:ro` (or a single file,
`-v /path/mygame.voxpak:/data/game.voxpak:ro` with `--project game.voxpak`). The compose file gives the server 30 s to save on `docker stop`.
Admin commands: `docker compose exec burrow-server /burrow-server ctl --data /data status`.

### Plain binary

Run `burrow-server run --data DIR` under any supervisor (tmux, launchd, a Windows service wrapper). The `server-dist` archives contain builds for
Linux amd64/arm64, macOS arm64 and Windows amd64. On Windows (10 1803 and later) the control socket works too, so `ctl` is available everywhere.

## Firewall and ports

The server listens on one TCP port, `7777` by default (`addr`). Open it inbound: `ufw allow 7777/tcp`, or the equivalent on your cloud
provider's security group and any router in front of the machine. Set `advertise` to the public `host:port` so the join link is right behind NAT or a proxy.

## Backups and restore

Autosave rotates `backups` copies in `world/backups/world-<UTC timestamp>.snap`. To back up by hand, run `save` then copy the data directory (or only
`world/`, `players.json`, `bans.json`, `whitelist.json`, `server.json`, `cert/` and `join.key`).

To restore: stop the server, copy the chosen `world/backups/world-<timestamp>.snap` over `world/world.snap`, start the server.

## Upgrading the game

A world snapshot must match the project that loads it. If you change the components of the game (new, removed or reshaped components), restoring the old
snapshot fails with a clear error and the server does not start. Before replacing the game in `game/`: stop the server, make a backup of the data directory, replace the game, start.
If the start fails, put the previous game back (and the backup if needed). Changes that do not touch components (scripts logic, assets, text) restore normally,
but clients must have the same game version to join ([Networking](networking.md) pins).

## Security notes

* **Identity is a key, a name is only a label.** With `require_identity` (the default of `init`) every player proves it owns an ed25519 key, bans and the roster
  follow the key, and nobody can take a name another identity uses. Anonymous clients (identified by name only, so anyone knowing a name can join as it) are
  admitted only when `require_identity` is false, as in a `server.json` written before this option. Protect the server with the password (the default: a random key in
  `join.key`) and, for a closed group, the whitelist. `list` and `status` show identity ids.
* **Treat the join link as a secret.** It carries the key; anyone with it can join. Rotate it by changing `password` (or deleting `join.key`) and restarting.
* **TLS.** The connection is encrypted with the certificate in `cert/`; clients pin it by fingerprint, which the join link contains. Keep `server.key` private; if you
  regenerate the certificate, previous links stop working.
* `--open` accepts anyone: use it only on a private network.
* The admin control is the unix socket only; nothing admin is reachable over the network.

## Limits

* **Server cost.** The server runs the whole simulation and builds one stream per player; clients only draw it, so the weakest player's machine does not limit the game.
* The player registry keeps up to **1024 players** at the same time.
* Roster ids go up to **65535**: `players.json` assigns a new id to each new player (identity or anonymous name), so a public server with many one-off identities eventually exhausts them.
* `max_players` counts connected players only.
