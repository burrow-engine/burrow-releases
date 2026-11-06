# Scripting

Scripts are WebAssembly modules that run inside the deterministic simulation. You write them in Go with the guest SDK `burrow-engine/sdk/burrowsdk` (Go 1.24+, `GOOS=wasip1`, no TinyGo needed), or in any language that targets the [ABI](../script/ABI.md). Everything a script does is journaled, so a game replays bit for bit.

This category has one page per topic. Read pages 1 to 3 once, then use the rest as a manual.

| # | page | answers |
|---|---|---|
| 1 | [Getting started](scripting/01-getting-started.md) | write, build, attach and run a first script; the `Script` hooks; every `burrow script` command |
| 2 | [Execution model](scripting/02-execution-model.md) | when a script runs, what is reset, how effects are applied, time, randomness, the determinism rules |
| 3 | [State and props](scripting/03-state-and-props.md) | how a script remembers things: `Props`, `State`, components |
| 4 | [Entities and scene](scripting/04-entities-and-scene.md) | components, transforms, spawning, finding entities, tags |
| 5 | [World](scripting/05-world.md) | voxels, raycasts, physics queries, navigation, levels |
| 6 | [Input, events and time](scripting/06-input-events-time.md) | input actions, events between scripts, timers, tweens |
| 7 | [Effects](scripting/07-effects.md) | audio, particles, animation, cameras, game UI |
| 8 | [Multiplayer](scripting/08-multiplayer.md) | what changes for a script in a networked game |
| 9 | [Errors and limits](scripting/09-errors-and-limits.md) | every error code and limit, faults and how they are handled |
| 10 | [Debugging and testing](scripting/10-debugging-and-testing.md) | logs, profiling, replay tests, common pitfalls |
| 11 | [Cookbook](scripting/11-cookbook.md) | complete recipes to copy |
| 12 | [Embedding and ABI](scripting/12-embedding-and-abi.md) | run scripts from your own program; write guests in other languages |
| 13 | [The Go SDK in depth](scripting/13-go-sdk.md) | map of `sdk/burrowsdk`: one file per domain, core types, pure helpers, generated accessors, calling conventions |
| 15 | [Native scripts](scripting/15-native.md) | the shipped game links scripts natively (`burrow build --native`), parity test, the state rule, no gas |

Reference pages generated from the code: [every host function, SDK function, type and constant](reference/script-api.md), [every component](reference/components.md).

## Which page do I need?

| I want to... | go to |
|---|---|
| make a cube spin | [Getting started](scripting/01-getting-started.md) |
| know why my global variable is reset | [Execution model](scripting/02-execution-model.md), [State and props](scripting/03-state-and-props.md) |
| read the player's keys | [Input, events and time](scripting/06-input-events-time.md) |
| create or remove things | [Entities and scene](scripting/04-entities-and-scene.md) |
| break or place blocks | [World](scripting/05-world.md) |
| play a sound or show a HUD | [Effects](scripting/07-effects.md) |
| understand an error or a disabled script | [Errors and limits](scripting/09-errors-and-limits.md) |
| copy a working example | [Cookbook](scripting/11-cookbook.md) |
| find the function or type of the Go SDK | [The Go SDK in depth](scripting/13-go-sdk.md), [script API reference](reference/script-api.md) |
| follow a guided exercise | [Tutorial 4](tutorials/04-scripted-entity.md) |
