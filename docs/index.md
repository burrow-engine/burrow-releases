# Burrow documentation

![Burrow](img/banner-readme-1280x320.png)

Burrow is a deterministic voxel game engine with a native editor, a scripting host and an agent interface. These pages are also built into the editor: press **F1** (or **Help > Documentation**) to read them next to your project, search them, and follow links between pages. Everything is written in English; a French translation is future work (see [Reading the docs in the editor](documentation.md)).

## Start here

| page | for |
|---|---|
| [Getting started](getting-started.md) | install the tools, create a game, play, test and ship from the command line |
| [Concepts](concepts.md) | how the engine is organised: simulation, frame domain, determinism |
| [The editor](editor.md) | every panel, tool and shortcut of `burrowedit` |
| [Branding and theme](branding.md) | palette, logo usage, regenerating the icons and banners, customising the theme with `theme.json` |
| [Platforms](platforms.md) | Windows, macOS, Linux: what is tested, what is only built, requirements |
| [Determinism](determinism.md) | what the same-hash promise covers, how it is tested, the rules for contributors |
| [Networking](networking.md) | the multiplayer core: server-authoritative replication, protocol, security, limits |
| [Replication](replication.md) | the opt-in replicated network model of persistent public servers: interest management, bandwidth budget, protocol |
| [Lobby](lobby.md) | the multiplayer lobby: teams, colours, ready, settings, countdown and match results as simulation state |
| [Dedicated server](dedicated-server.md) | `burrow-server`: headless server (persistent world, lobby or matchmaking mode), admin commands, systemd and Docker deployment |
| [Reading the docs in the editor](documentation.md) | the Help window, search, contextual help and the generated reference |

## Tutorials

Each tutorial is a short list of steps you can finish in ten minutes, in this order.

1. [Your first project](tutorials/01-first-project.md): create, open, edit, save and play.
2. [Sculpt terrain](tutorials/02-sculpt-terrain.md): raise, lower, flatten, ramp, extrude, scatter.
3. [Place and shape blocks](tutorials/03-place-blocks.md): palette, shapes, regions.
4. [Add a scripted entity](tutorials/04-scripted-entity.md): a Go script compiled to WebAssembly.
5. [Cameras and game UI](tutorials/05-cameras-and-game-ui.md): rigs, a HUD.
6. [Levels and saves](tutorials/06-levels-and-saves.md): fixed levels, spawns, trigger zones, slots.
7. [Particles](tutorials/07-particles.md): presets, emitters, bursts.
8. [Audio packs](tutorials/08-audio-packs.md): your own sounds, mixer buses.
9. [Export for Windows](tutorials/09-export-windows.md): pack the game and build the Windows runner.

## Guides

| page | topic |
|---|---|
| [Architecture and package map](architecture.md) | how the repository is laid out |
| [Assets](assets.md), [Built-in assets](builtin-assets.md), [Materials and shaders](materials.md), [Blocks](blocks.md), [Block shapes](block-shapes.md), [Items](items.md), [Texture packs](texture-packs.md) | content: models, textures, blocks, items |
| [Physics](physics.md), [Navigation and AI](navigation-ai.md), [Character](character.md), [Animation](animation.md), [Frame visuals](visual-effects.md) | gameplay building blocks |
| [Cameras](cameras.md), [Linked prefabs](prefabs.md), [Game UI](game-ui.md), [Levels and saves](levels-saves.md), [Particles](particles.md), [Audio](audio.md), [Voice chat](voice.md) | game features |
| [Lighting](lighting.md), [Modelling](modeling.md) | block light, the model and texture editors |
| [Rendering](rendering.md), [Anti-aliasing](anti-aliasing.md), [Ray tracing](ray-tracing.md), [Weather](weather.md), [Water](water-physics.md), [Fine water](water-fine.md), [World generation](worldgen.md) | look and world |
| [UI design](ui-design.md) | the editor's design system |
| [Agents](agents.md) | driving the engine and the editor from an AI agent |
| [Security](security.md), [Troubleshooting](troubleshooting.md) | trust model, common problems |

Other guides (genre templates and more) appear in the sidebar of the Help window as soon as their page exists.

## Recipes

Complete, compiled programs for a main menu, pause menu, pickup and score HUD, chasing enemy and door zone: [recipes](recipes/README.md). Agent cards: [llms-gogame.txt](../llms-gogame.txt), [llms-script.txt](../llms-script.txt).

## Scripting

Go and WebAssembly scripts, from a first script to embedding the runtime. Start with the [overview](scripting.md).

| page | topic |
|---|---|
| [Getting started](scripting/01-getting-started.md) | write, build, attach and run a first script; the hooks; every `burrow script` command |
| [Execution model](scripting/02-execution-model.md) | when scripts run, what is reset, effects, time, randomness, determinism rules |
| [State and props](scripting/03-state-and-props.md) | how a script remembers things |
| [Entities and scene](scripting/04-entities-and-scene.md) | components, transforms, spawning, finding entities, tags |
| [World](scripting/05-world.md) | voxels, raycasts, physics queries, navigation, levels |
| [Input, events and time](scripting/06-input-events-time.md) | input actions, events, timers, tweens |
| [Effects](scripting/07-effects.md) | audio, particles, animation, cameras, game UI |
| [Multiplayer](scripting/08-multiplayer.md) | scripts in a networked game |
| [Errors and limits](scripting/09-errors-and-limits.md) | every error code and limit, faults |
| [Debugging and testing](scripting/10-debugging-and-testing.md) | logs, profiling, replay tests, pitfalls |
| [Cookbook](scripting/11-cookbook.md) | complete recipes |
| [Embedding and ABI](scripting/12-embedding-and-abi.md) | run scripts from your own program; other languages |
| [The Go SDK in depth](scripting/13-go-sdk.md) | map of `sdk/burrowsdk`: files, core types, pure helpers, conventions |
| [Native scripts](scripting/15-native.md) | ship scripts compiled into the game (`burrow build --native`), parity with wasm, the state rule |

## Reference (generated from the code)

[Components](reference/components.md), [script API](reference/script-api.md), [MCP tools](reference/mcp-tools.md), [command line](reference/cli.md), [project file](reference/project-config.md), [input actions](reference/input-actions.md), [blocks](reference/blocks.md) and [render options](reference/render-options.md). Run `make docs-gen` after changing any of them; a test fails when a page is stale.

## Also in the repository

[README](../README.md), [ARCHITECTURE](../ARCHITECTURE.md), [CHANGELOG](../CHANGELOG.md), [CONTRIBUTING](../CONTRIBUTING.md), the script ABI in [script/ABI.md](../script/ABI.md) and `llms.txt` for models.
