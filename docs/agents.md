# Agents

Burrow is built so an AI agent can create, inspect, test and ship a game without a window or GPU. There are three levels, all deterministic
(same seed + same commands = same `session_hash`).

| tool | for | transport |
|---|---|---|
| `burrow` CLI (`--json`) | project workflow: new, test, build, script, assets, doctor | process, exit codes 0/1/2 |
| `burrowd` | engine sessions: build voxel worlds, observe, snapshot, replay | MCP over stdio; optional JSON-RPC on a unix socket or loopback with a Bearer token |
| `burrowedit -headless -agent` | the editor document: nodes, components, voxel tools, Play | MCP over stdio or unix socket |

`burrow agent --stdio [project]` starts the editor server for a project; `burrowctl` is a stateless JSON CLI over the same session API as `burrowd`.

## Use `llms.txt`

[llms.txt](../llms.txt) is the compact briefing to give to a model: coordinate conventions, cheap-to-expensive ways to observe, the tool lists, error
format. Put it in the system prompt or let the agent read it first.

Writing game code? Start with the cards [llms-gogame.txt](../llms-gogame.txt) (plain-Go game) and [llms-script.txt](../llms-script.txt) (WASM scripts), and copy from the [recipes](recipes/README.md).

Small or fast models (GLM flash, Haiku...) do better with the task cards: [llms-voxel.txt](../llms-voxel.txt) (build a world),
[llms-project.txt](../llms-project.txt) (game project and scripts), [llms-editor.txt](../llms-editor.txt) (editor tools). Each is under 300 words with
copyable calls. Suggested system prompt: "You drive the Burrow engine through tools. Use names not ids, coordinates x right/y up/z toward viewer, observe
cheap before expensive, on error read hint and valid[] and retry, never invent API names (search the docs)." plus one card.

## Recipes

**Build a world, look at it, keep it** (burrowd):

1. `vox_session_create {generator:"flat", seed:1}`
2. `vox_act {commands:[{kind:"fill_box", data:{min:[0,9,0], max:[4,12,4], block:"stone"}}, ...]}` (atomic; batch up to 4096 commands)
3. `vox_observe {min, max}` for RLE text, then `vox_screenshot {ascii:true}`, and `png:true` only when the picture matters
4. `vox_snapshot` before risky edits; `vox_diff from:"last"`; `vox_restore` or `vox_undo`
5. Weather (optional, deterministic, off until enabled): `vox_act {commands:[{kind:"weather_set", data:{enabled:true, type:"storm", instant:true}}]}`, then `vox_step`; in the editor use `editor_weather`. See [weather.md](weather.md).
6. Water (flows by itself): `vox_act` `fill_box`/`set_block` with `water`, then `vox_step`; read a cell with `editor_water` in the editor. See [water-physics.md](water-physics.md).
7. Documentation: `editor_docs_search {query}` finds sections of the embedded docs (guides, tutorials, the generated [reference](reference/index.md)); `editor_docs_read {page, anchor}` reads one. They are read-only and work in every mode.

**Edit a project through the editor** (burrowedit):

```sh
burrow agent --stdio mygame        # or: burrowedit -headless -agent stdio -project mygame
```

`editor_create_node`, `editor_set_component {path, component, data}`, `editor_tool_apply {tool:"box", start, end, block}`, `editor_save`, then
`editor_play` -> `editor_step {ticks}` -> `editor_state` (hashes) -> `editor_stop` (`engine_hash` and `doc_hash` return to their pre-play values); `editor_verify_replay` checks that the journal reproduces the live state. Every mutation is one undo step and a journaled command.
Paths are node paths like `/Tower/Door`. Errors are `{code, message, hint, valid[]}`: read `hint` and `valid`, then retry.

**Verify a change** (any agent, no GPU):

```sh
burrow test --json                 # {"ok":true,"hash":"...","runs":[...],"report":{...}}
burrowplay -headless -ticks 600 -hash mygame
burrowplay -headless -ticks 600 -journal j.json mygame && burrowplay -replay j.json -expect <hash> mygame
```

**Write a behaviour**: `burrow script new bot`, edit `scripts/bot/main.go`, `burrow script build`, attach it with `editor_set_component` (component `script`,
`{"module":"assets/scripts/bot.wasm","props":{...}}`), `burrow test`. See [scripting.md](scripting.md).

**Edit without hand-written JSON**: `burrow config set runtime.plugins.controller false`, `burrow scene set-component scenes/main.voxscn /Sun render.pointlight intensity=3` (both validated, atomic). Find names with `burrow docs search <terms>` and `burrow ui icons`; make the app icon with `burrow icon from logo.png`. For terrain use `editor_ground_at {x,z}` (ground height), `editor_find_view {near:[x,z]}` (a clear high camera) and `editor_place_on_ground {node}` instead of probing with raycasts.

**Ship**: `burrow build -o game && ./game -headless -ticks 200 -hash` prints the same hash as `burrow test`.

## Safety

Servers never open TCP without a token; sockets are created 0600 in a 0700 directory; the editor confines file tools to the project; request lines, batch sizes
and screenshot sizes are capped. The full tool list and limits are in [agent/README.md](../agent/README.md) and [editor/README.md](../editor/README.md).
