# The Go SDK in depth

Everything a Go script can call lives in one package, `burrow-engine/sdk/burrowsdk`: one source file per domain, pure helpers mixed with host calls, and a generated file of typed component accessors. This page is the map of that package; the generated [script API reference](../reference/script-api.md) lists every function, type, constant and struct field with its doc comment, and [script/ABI.md](../../script/ABI.md) is the raw ABI underneath.

## Package map

| file | domain | highlights |
|---|---|---|
| `voxsdk.go` | core: the entity handle, errors, logging, time, randomness, components, spawn, transform, voxels, light, raycasts, input, events, props and state, registration | `Self`, `Tick`, `Rand`, `Log`, `Get`/`Set`/`Has`/`Remove`, `Spawn`/`Despawn`, `FindByName`/`FindByPath`, `GetTransform`/`SetTransform`, `Voxel`/`SetVoxel`, `LightAt`, `Raycast`, `PhysicsRaycast`, `Action`, `Emit`, `Props`, `SaveState`/`LoadState`, `Register`/`RegisterNamed` |
| `fields.go` | field-level component access by schema path | `FieldRaw`, `GetFloat`/`GetFloats`/`GetInt`/`GetBool`/`GetString`, `SetFloat`/`SetInt`/`SetBool`/`SetString`/`SetFieldRaw`, `GetFields`, `Patch` |
| `components_gen.go` | generated typed accessors for the built-in components | one `Comp<Name>` constant per component, one getter and setter per scalar field (`make sdk-gen`, do not edit) |
| `scene.go` | scene queries and tags | `Parent`, `Children`, `ScenePath`, `FindWith`, `FindTag`, `SceneLoad`, `TagsOf`/`HasTag`/`AddTag`/`RemoveTag`, `MaxQueryResults` |
| `blocks.go` | block logic: block data, block events, schedules, networks | `OnBlockChange`/`OnBlockSet`/`OnBlockBreak`/`OnBlockUse`/`OnBlockTick`/`OnBlockRandomTick`, `BlockSchedule`/`BlockUnschedule`, `BlockFlood`, `BlockData`/`SetBlockData`/`BlockDataJSON`/`BlockDataMany`/`BlockDataIn`/`BlockDataApply`, `BlockBase`/`BlockProp`, `KindBlockBatch`/`KindBlockTick` |
| `bus.go` | message bus and timers | `OnMessage`, `Publish`, `Subscribe`/`Unsubscribe`, `OnTimer`, `After`, `Every`, `TimerStart`/`CancelTimer`/`TimerRemaining`, `BusKind`, `KindTimer` |
| `tween.go` | easing and tweens in tick time (pure data) | `EaseKind` and its curves, `Lerp`, `Tween`/`NewTween`, `Cooldown` |
| `codec.go` | compact binary state codec (pure) | `Writer`, `Reader`/`NewReader` |
| `items.go` | items and stacks (pure helpers over the registry) | `ItemCount`/`ItemIDByName`/`ItemName`/`ItemInfo`, `ItemStack` with `Encode`/`Split`/`Merge`, `DecodeItemStack`, `ItemStackSize`, `ItemProps` |
| `data.go` | project data files and registries | `ReadAsset`/`ReadAssetJSON`, `BlockCount`/`BlockName`/`BlockInfo`/`BlockProps`, `Registry` |
| `level.go` | levels, zones and saves | `LevelLoad`/`LevelCurrent`/`LevelSpawnCount`/`LevelSpawnAt`/`LevelZoneAt`/`LevelSettings`, `SaveSet`/`SaveGet`/`SaveDelete`, `SaveSlot`/`LoadSlot`/`DeleteSlot` |
| `nav.go` | navigation goals and the AI blackboard | `NavSetGoal`/`NavSetGoalPos`/`NavStop`/`NavGetState`/`NavPath`, `NavSetBB`/`NavGetBB`/`NavPutBB`/`NavReadBB`/`NavDelBB`, `NavSensed`, `NavNode`/`NavVec3`/`BBValue` |
| `net.go` | multiplayer player registry (reads) | `NetPlayerCount`/`NetPlayerAt`/`NetPlayerInfo`, `NetPlayer`, `NetInput` |
| `physics.go` | rigid bodies, voxel bodies, water (physics3d plugin) | `Physics3DRaycast`/`Physics3DOverlap`/`Physics3DApplyImpulse`/`Physics3DBody`/`Physics3DRemoveVoxel`/`Physics3DWaterAt`, `RayHit3D`, `Body3D`, `Water3D` |
| `contact.go` | physics3d contact and trigger events of the script's own body | `OnContact`, `Contact`, `ContactKind`, `ContactBegin`/`ContactEnd`/`TriggerEnter`/`TriggerExit`, `KindContact` |
| `fluid.go` | water volumes in and out of the world | `FluidAmount`/`FluidPour`/`FluidDrain`, `FluidFull` |
| `anim.go` | animation control (drives the `anim.player` component) | `AnimPlay`/`AnimStop`/`AnimSetSpeed`/`AnimSetParam`/`AnimTrigger`/`AnimTime`, `AnimPlayOpts`, `AnimMode` |
| `audio.go` | sounds and music (frame domain) | `PlayOn`/`AudioStop`/`AudioSet`/`AudioBus`/`AudioListener`, `SoundOpts`, `SoundMode`, `SoundHandle` |
| `particles.go` | particle effects (frame domain) | `ParticleBurstOn`/`ParticleBlockBreakOn`/`ParticleEmit`/`ParticleStop`, `ParticleOpts` |
| `fx.go` | air distortion (frame domain) | `Shockwave` |
| `camera.go` | camera rigs (frame domain) | `CameraSwitch`/`CameraShake`/`CameraCut` |
| `gameui.go` | game UI (frame domain) and journaled UI events | `UISetNum`/`UISetStr`/`UISetBool`/`UISetItems`, `UIShow`/`UIHide`/`UIToggle`, `UILocale`, `UILabel`/`UIPopup`/`UIRemoveLabel`, `UIEvents`, `UIEvent`, `UIItem` |
| `model.go` | spawning a voxel model node | `SpawnModel` |
| `warm.go` | the pre-grown guest heap | `WarmHeapBytes` |
| `abi/` | the raw host imports, one function per ABI row | for custom wrappers and conformance tests only; see [script/ABI.md](../../script/ABI.md) |

## Core types

Everything is keyed by `Entity`, a `uint64` handle to a scene node (0 = none). The full field-by-field reference is the [Types section of the script API](../reference/script-api.md#types-sdkburrowsdk):

| type | role |
|---|---|
| `Entity` | a scene node handle; `Exists` checks it |
| `Script` | the four hooks (`OnStart`, `OnTick`, `OnEvent`, `OnDestroy`), installed with `Register` or `RegisterNamed` from `init()` |
| `Event` | one delivered message: `From`, `Kind`, `Payload` |
| `Error` | a failed host call: `Op` (the host function) and `Code` (an `abi.Err*` code); `IsNotFound(err)` matches `ErrNotFound` |
| `Transform` | `Pos`, `Rot` (Euler degrees), `Scale`; read/write with `GetTransform`/`SetTransform` |
| `Writer`/`Reader` | binary codec for `State` (see below) |

## Calling conventions

* **Errors.** Every host call returns an `error` that is an `*Error` (`Op` + `Code`), or `nil`. Check specific failures with `IsNotFound`. The error codes and their meanings are listed in [errors and limits](09-errors-and-limits.md); the raw codes are the `Err*` constants of `sdk/burrowsdk/abi`.
* **Budgets.** Every call is charged gas (50,000,000 per hook) and most calls have their own limits (payload 1 KiB, state 64 KiB, 4,096 block edits per call, ...). A call that exceeds a budget faults the whole transaction: its writes are discarded, see [execution model](02-execution-model.md).
* **Results.** Reads that return bytes or lists (`GetRaw`, `BlockDataIn`, `FindWith`, ...) grow their buffer internally until the data fits; large answers report `ErrTooSmall`-style resizing transparently.

### Simulation domain vs frame domain

| domain | files | what it means for your script |
|---|---|---|
| Simulation (journaled, hashed, replayed) | `voxsdk.go`, `fields.go`, `components_gen.go`, `scene.go`, `blocks.go`, `bus.go`, `level.go`, `nav.go`, `net.go`, `physics.go`, `fluid.go`, `model.go` | Changes commit with the call, are saved, hashed and replayed exactly. `LightAt`, `Voxel` and the scene queries read the committed state (plus this call's own writes where documented). |
| Frame (queued requests) | `audio.go`, `particles.go`, `fx.go`, `anim.go`, `camera.go`, `gameui.go` | Requests take effect after the tick, in call order. They are deterministic (a replay shows the same effects) but never part of the `StateHash`, and they are ignored when the matching `runtime.plugins.*` is off. |
| Pure Go (no host call) | `tween.go`, `codec.go`, parts of `items.go`, `bus.go`'s `BusKind`, `voxsdk.go`'s `Rand*`/`CanonF32` | Free, safe to call anywhere — including from `init()` for everything except `Rand*`, which need a tick. |

## Pure helpers worth knowing

These need no host call and no component, so they are the building blocks of `State` logic:

* **Binary state.** `Writer` appends `U8`/`Bool`/`U32`/`I32`/`U64`/`F32`/`String` little-endian; `Reader` (from `NewReader`) reads them back, setting `Reader.Err` when it runs past the end. Encode with `w.Bytes()`, store with `SetStateRaw`, read with `StateRaw`. Faster and smaller than `SaveState` JSON, at the price of writing the layout yourself. `CanonF32` canonicalises NaN so its payload bits never reach hashed state.
* **Tweens and cooldowns in tick time.** `Tween` is plain JSON-able data: `NewTween(from, to, durTicks, ease)` starts one now, `t.At(tick)`/`t.Now()` evaluate it, `t.Done(tick)` reports the end. `EaseKind` has 13 curves (`Linear`, `InQuad`, `OutCubic`, `OutBounce`, `SmoothStep`, ...) and `EaseKind.Apply` maps [0,1] through one; `Lerp(a, b, t)` is the linear case. `Cooldown` is a one-field deadline: `Start(n)`, `Ready()`.
* **Item stacks.** `ItemStack{Item, Count}` with `Empty`, `Encode` (the 6-byte wire form, `ItemStackSize`), `DecodeItemStack`, `Split(n)` and `Merge(src, maxStack)`. Ids and limits come from the project: `ItemIDByName`, `ItemInfo` (`ItemProps.MaxStack`).
* **Block names with states.** `BlockBase("mymod:belt[facing=east]")` gives `"mymod:belt"`, `BlockProp(name, "facing")` gives `"east"`.
* **Deterministic randomness.** `Rand()`, `RandFloat()` in [0,1), `RandN(n)` in [0,n): a private stream per script entity, derived from the seed, entity, tick and draw index; it never touches the shared simulation RNG.
* **Event kinds.** `BusKind(topic)` computes the kind a bus message arrives with; `KindTimer`, `KindBlockBatch` and `KindBlockTick` are reserved kinds handled by `OnTimer`/`OnMessage` and the block handlers.

## Generated component accessors

`components_gen.go` holds one `Comp<Name>` constant per built-in component (`CompTransform = "transform"`, `CompRenderCamera = "render.camera"`, ...) and, for every scalar field, a typed getter and setter (`TransformPos(e)`, `SetTransformPos(e, v)`, built on `GetFloats`/`SetFieldRaw`). It is generated from the same component schema as the inspector and the [components reference](../reference/components.md): regenerate it with `make sdk-gen` after changing the schema (`make sdk-check` fails when it is stale). For object fields and custom components use the generic `Get`/`Set`/`Patch` or the `fields.go` accessors.

## A complete example

One module using registration, props, state, the codec, a tween, the bus and the transform — the same shapes the [cookbook](11-cookbook.md) recipes use:

```go
package main

import "burrow-engine/sdk/burrowsdk"

type props struct {
	Speed float32 `json:"speed"` // degrees per second
}

type state struct {
	Turns int `json:"turns"` // ticks since start, kept as binary state
}

const kindDone int32 = 1 // below 0x40000000: our own event kind

func init() {
	burrowsdk.OnMessage("game.reset", func(self, from burrowsdk.Entity, payload []byte) {
		_ = burrowsdk.SetStateRaw(new(burrowsdk.Writer).Bytes()) // clear the state
	})
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			burrowsdk.Log(burrowsdk.LevelInfo, "spinner ready")
		},
		OnTick: func(self burrowsdk.Entity, dt float64) {
			p, err := burrowsdk.Props[props]()
			if err != nil {
				return
			}
			var st state
			r := burrowsdk.NewReader(burrowsdk.StateRaw())
			st.Turns = int(r.I32())
			if r.Err {
				st.Turns = 0 // first tick: empty state decodes as zeros anyway
			}
			tw := burrowsdk.NewTween(0, 1, 20, burrowsdk.OutQuad) // ease in over one second
			t, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			t.Rot[1] += p.Speed * float32(dt) * float32(tw.Now())
			if err := burrowsdk.SetTransform(self, t); err != nil {
				return
			}
			st.Turns++
			w := new(burrowsdk.Writer).I32(int32(st.Turns))
			_ = burrowsdk.SetStateRaw(w.Bytes())
			if st.Turns == 20 {
				_ = burrowsdk.Emit(0, kindDone, []byte("one second"))
			}
		},
		OnEvent: func(self burrowsdk.Entity, ev burrowsdk.Event) {
			if ev.Kind == kindDone {
				burrowsdk.Logf("done, from=%d payload=%s", uint64(ev.From), ev.Payload)
			}
		},
	})
}

func main() {}
```

## Where the full reference lives

* [Script API reference](../reference/script-api.md) (generated by `make docs-gen`): the **host functions** (the `vox` imports, from [script/ABI.md](../../script/ABI.md)), then the **Go SDK functions** grouped by source file, then every **type** with its struct fields, then every **constant and variable** — all with their doc comments.
* From the command line or your IDE: `go doc burrow-engine/sdk/burrowsdk` and `go doc burrow-engine/sdk/burrowsdk.<Name>` show the same comments.
* `sdk/burrowsdk/abi` declares the raw imports one-to-one (one function per ABI row, same signatures as the host-function table); use it only for custom wrappers, and note that outside `wasip1` every call returns `ErrUnavailable` so tests can run on the host.

## See also

* [Getting started](01-getting-started.md) for building and attaching scripts, [execution model](02-execution-model.md) for transactions and determinism.
* [State and props](03-state-and-props.md), [entities and scene](04-entities-and-scene.md), [world](05-world.md), [input, events and time](06-input-events-time.md), [effects](07-effects.md).
* [Errors and limits](09-errors-and-limits.md), [debugging and testing](10-debugging-and-testing.md), [cookbook](11-cookbook.md).
* [Embedding and the ABI](12-embedding-and-abi.md) to run scripts from your own program.

Application control (`app.go`, frame domain, windowed runs only): `AppQuit`, `NetJoin(link, name)`, `NetHost(name)`, `WorldPlay(slot)`, `WorldCreate(slot, name, seed, generator, mode)`, `Title`. See [effects](07-effects.md#application-control).
