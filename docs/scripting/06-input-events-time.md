# Input, events and time

How a script reads player input, talks to other scripts through events and the message bus, schedules work with timers, and animates values with tweens, all in deterministic simulation time.

Signatures are in [reference/script-api.md](../reference/script-api.md). Error codes: `1 INVALID`, `3 NOT_FOUND`, `5 BUDGET`, `7 UNAVAILABLE`, `9 LIMIT` ([errors and limits](09-errors-and-limits.md)).

## Time

* The simulation runs at a fixed rate: **20 ticks per second** unless `runtime.tick_rate` says 30, 40 or 60 (see [determinism](../determinism.md#simulation-rate)). `OnTick` receives `dt = 1 / rate` (0.05 s at 20 Hz) every time; `burrowsdk.Tick()` is the index of the current tick and the only clock a script has. Everything below counts ticks (20 ticks = 1 second at the default rate); the `...Seconds` forms and `burrowsdk.TickRate()` keep a script right if the rate changes.
* There is no wall clock and no randomness outside `Rand`, so timers, tweens and cooldowns stop when the simulation pauses and replay exactly.
* Order inside one script run: `OnStart` (first tick only), then queued events and fired timers (see [delivery order](#delivery-order)), then `OnTick`. One script's run is committed before the next script starts ([execution model](02-execution-model.md)).

## Input

`Action(name) (x, y float32, ok bool)` reads one input action as of the current tick.

| action kind | `x` | `y` |
|---|---|---|
| button | `0` or `1` | `0` |
| `axis1d` | the axis value | `0` |
| `axis2d` | x of the value | y of the value |

* `ok` is `false` when no action has that name, when the project has no input plugin, or before any input has been sampled. No error value is returned.
* Precision is three decimals: the host passes thousandths (`float32(milli)/1000`), clamped to `+-1000`.
* Axes from sticks and composites are in `-1..1` after dead zone and sensitivity. **Relative actions** (mouse delta, scroll and mouse-axis bindings) are not levels but amounts: they are the sum of all motion since the previous tick, in pixels (or wheel steps) times the action's `sensitivity`, so they can exceed 1. The first tick after a frame consumes them: if the game runs several ticks to catch up, the later ticks read 0 and the motion is applied once.
* A script gets **levels, not edges**. Derive "pressed" and "released" from your own `State`, as below. The value is the latest snapshot taken before the tick; a press that starts and ends between two ticks (under 50 ms) is not seen, so do not rely on one-frame taps for critical actions.
* A paused game journals no input, and motion made while paused is dropped, so resuming does not replay it as one big camera turn.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type jumpState struct {
	WasDown bool `json:"was_down"`
	Presses int  `json:"presses"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[jumpState]()
			down := false
			if x, _, ok := burrowsdk.Action("jump"); ok {
				down = x > 0.5
			}
			if down && !st.WasDown { // rising edge
				st.Presses++
				burrowsdk.Logf("jump pressed %d times", st.Presses)
			}
			st.WasDown = down
			_ = burrowsdk.SaveState(st)

			mx, my, _ := burrowsdk.Action("move") // axis2d: x strafe, y forward
			lx, ly, _ := burrowsdk.Action("look") // mouse movement since the last tick
			_, _, _, _ = mx, my, lx, ly
		},
	})
}

func main() {}
```

### Input map (`input.json`)

Scripts read **actions**, never keys. The project file named by `input_map` in `vox.project` (conventionally `input.json`) defines them; without it the engine's default map is used ([reference/input-actions.md](../reference/input-actions.md) lists its actions: `move`, `look`, `jump`, `sprint`, `break`, `place`, `hotbar1`..`hotbar9`, ...). A map that fails to load is logged and the default stays.

```json
{
  "version": 1,
  "contexts": [
    { "name": "gameplay", "priority": 0, "enabled": true, "actions": [
      { "name": "move", "kind": "axis2d", "bindings": [
        { "type": "composite2d", "up": "W", "down": "S", "left": "A", "right": "D" },
        { "type": "pad_stick", "scale": 1, "deadzone": 0.15 } ] },
      { "name": "look", "kind": "axis2d", "sensitivity": 0.12, "bindings": [ { "type": "mouse_delta" } ] },
      { "name": "jump", "kind": "button", "bindings": [ { "type": "key", "key": "Space" }, { "type": "pad_button", "button": 0 } ] }
    ] }
  ]
}
```

| element | fields |
|---|---|
| file | `version` (must be `1`), `contexts` |
| context | `name`, `priority` (higher wins), `enabled` (default true), `modal` (lower contexts are ignored while it is active), `actions` |
| action | `name`, `kind` (`button`, `axis1d`, `axis2d`), `deadzone` (0..1, radial for 2D), `sensitivity` (multiplier after the dead zone, 0 = 1), `consume` (its bindings are hidden from lower-priority contexts) |
| binding `type` | `key`, `mouse_button`, `mouse_axis`, `scroll`, `pad_button`, `pad_axis`, `composite1d` (`neg`, `pos`), `composite2d` (`up`, `down`, `left`, `right`), `mouse_delta`, `mouse_pos` (pointer position `-1..1`, needs a free cursor), `pad_stick` (`axis`, `scale`, `deadzone`) |
| binding extras | `mods` (`ctrl`, `shift`, `alt`), `exclusive`, `scale` |

Which binding types suit which kind, key names and the parse errors (the loader names the JSON path and suggests the intended spelling) are in the `input` package ([input actions reference](../reference/input-actions.md) lists them). Rules at runtime:

* A button is `1` while any of its bindings is active (an analog binding needs a value of at least 0.5). An axis takes the strongest of its bindings.
* The context with the highest priority that has the action active owns it; actions of a context with `enabled: false` read `0`. Scripts cannot enable or disable a context.
* The template projects (`burrow new`) ship an `input.json` ready to edit.

### What the window reports

| runner | keys and buttons that reach the map |
|---|---|
| game window (`burrow run`, `burrowplay`, exported games) | every physical key by US-layout position (layout independent), all mouse buttons, mouse movement, scroll, modifiers, and the first connected gamepad |
| editor Play mode | only while the pointer is over the viewport: letters `a`-`z`, digits `0`-`9`, Space, Tab, Enter, the arrow keys, left Shift, left Ctrl, the left, right and middle mouse buttons, mouse movement (pointer travel between two frames, none on the first frame over the viewport), the wheel, and the first connected gamepad. Not routed: Esc (it stops Play), function keys and the other modifiers. Before 0.2.2 movement, wheel, arrows and gamepad were missing. The pointer is not captured, so a mouse-look game turns only while you drag across the viewport. |

Typed text is for UI fields only; scripts do not receive it. In a multiplayer session the local device snapshot is replaced by per-player input ([multiplayer](08-multiplayer.md)).

### Frame look

Mouse look read from `Action("look")` arrives once per tick (20 Hz). To make the **view** turn at frame rate without changing the simulation, set `frame_look` on the `camera_rig` component of a first or third person rig to the degrees per mouse pixel your script applies (range 0..10, 0 = off). The rig then adds the mouse motion no tick has consumed yet to the target's look angles and drops it when a tick completes. The script still receives the summed motion once per tick, so no double rotation happens. The value must equal the script's own sensitivity; other rig kinds ignore it. There is no script call for it: it is a field of the component ([cameras](../cameras.md)).

```json
"camera_rig": { "name": "fp", "kind": "first_person", "frame_look": 0.12 }
```

## Events between scripts

`Emit(target, kind, payload)` queues an event for another script (or for all). The receiver gets it in `OnEvent(self, ev Event)` with `Event{From, Kind, Payload}`.

| function | what it does | errors |
|---|---|---|
| `Emit(target, kind, payload)` | queue an event; `target 0` = every script (the sender included) | `NOT_FOUND` (dead target), `LIMIT` (payload over 1024 bytes), `BUDGET`, `MEMORY` |

* **Commit, then next tick.** The event is queued with the call and appended to the receivers' inboxes when the sender's run commits. It is delivered in the **next tick** or later, never in the tick that sent it, even to a receiver that runs after the sender.
* `kind` is an application number (any `int32`). Use values below `0x40000000`: `0x40000000..0x7fff0000` are bus topics and `0x7fff0001` is the timer kind ([below](#message-bus)), and the SDK routes them to bus and timer handlers before `OnEvent`.
* `From` is the emitting entity. `Payload` is at most 1 KiB of opaque bytes; copy it if you keep it, because it is only valid during the handler.
* A target that has no `script` component, or is despawned before the commit, is skipped silently. A target that is a pending handle from this call (a node you just spawned) is resolved at commit.
* Budgets: 64 events per call and 4096 per tick (`BUDGET`). A broadcast counts as one.
* **Inbox.** Each script holds at most 64 undelivered events. A further event to a full inbox is dropped and reported as a non-fatal fault in the console naming the receiver; the sender gets no error. The inbox is emptied each time the script runs, so overflow needs more than 64 events aimed at one script between two of its runs.
* A script without `OnEvent` still consumes its events (they are dropped).

```go
package main

import (
	"encoding/binary"

	"burrow-engine/sdk/burrowsdk"
)

const kindDamage = 1

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			if target, err := burrowsdk.FindByName("boss"); err == nil && burrowsdk.Tick()%40 == 0 {
				var p [4]byte
				binary.LittleEndian.PutUint32(p[:], 7)
				if err := burrowsdk.Emit(target, kindDamage, p[:]); err != nil {
					burrowsdk.Logf("emit: %v", err)
				}
			}
		},
		OnEvent: func(self burrowsdk.Entity, ev burrowsdk.Event) {
			if ev.Kind == kindDamage && len(ev.Payload) == 4 {
				burrowsdk.Logf("%d took %d damage from %d", self, binary.LittleEndian.Uint32(ev.Payload), ev.From)
			}
		},
	})
}

func main() {}
```

Engine events (trigger enter/exit, collisions) are frame-domain and are **not** delivered to scripts. Poll instead: `PhysicsOverlap` diffed against the previous tick's result kept in `State`, [game UI events](07-effects.md), or `LevelCurrent`.

### Delivery order

Everything a script receives comes from one queue, in a fixed order:

1. `OnStart` (first tick of the script only).
2. Inbox events in arrival order. Arrival order is the commit order: scripts run in ascending entity id, and one run's emits and publishes keep their call order. Direct events and bus messages share the queue.
3. Fired timers, ordered by (due tick, timer id).
4. `OnTick`.

A script that faults keeps its inbox and gets the same events again next tick ([errors](09-errors-and-limits.md)).

## Message bus

The bus is publish/subscribe by topic name. Subscriptions are stored in the script component, so they survive the guest memory reset, snapshots and replays.

| function | what it does | errors |
|---|---|---|
| `OnMessage(topic, fn)` | register a handler from `init()`; the SDK subscribes for you before `OnStart` and `OnTick` | panics at load on two topics whose kinds collide |
| `Publish(topic, payload)` | send to every script subscribed to `topic` | `INVALID` (bad topic), `LIMIT` (payload over 1024 bytes), `BUDGET` |
| `Subscribe(topic)` | subscribe without a handler; read it in `OnEvent` with `BusKind(topic)` | `INVALID`, `LIMIT` (more than 32 topics) |
| `Unsubscribe(topic)` | drop a subscription (no error if not subscribed) | `INVALID` |
| `BusKind(topic)` | the `Event.Kind` a topic arrives with: `0x40000000 + FNV-1a32(topic) % 0x3fff0000` | none |

* A topic is `[A-Za-z0-9_.:/-]{1,64}`. At most 32 subscriptions per script (idempotent: subscribing twice counts once).
* `Publish` takes effect at commit. The message goes to every subscribed script in ascending entity order, **the publisher included** if it subscribed, and arrives in a later tick with `from` = the publisher. A subscription made in a run counts for publishes committed after that run commits; a message published earlier in the same tick is not delivered to it.
* Each delivery uses one unit of the per-tick event budget (4096), plus a small charge for scanning the scripts. When the tick budget runs out the remaining deliveries are dropped with a non-fatal fault, and a full inbox drops a message the same way.
* `Publish` costs gas: 48 + 1 per 64 payload bytes + 1 per 8 scripts in the scene, even with no subscriber.
* A handler registered with `OnMessage` is re-subscribed by the SDK whenever the host holds fewer subscriptions than there are handlers. `Unsubscribe` on such a topic is therefore undone on the next call; remove the handler instead.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.OnMessage("door.open", func(self, from burrowsdk.Entity, payload []byte) {
		burrowsdk.Logf("door opened by %d: %q", from, payload)
		_ = burrowsdk.After(1, 60) // close again in 3 s
	})
	burrowsdk.OnTimer(1, func(self burrowsdk.Entity) {
		_ = burrowsdk.Publish("door.close", nil)
	})
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) { _ = burrowsdk.Every(2, 20) },
	})
}

func main() {}
```

## Timers

Timers are kept by the host in the script component, in ticks.

| function | what it does | errors |
|---|---|---|
| `After(id, n)` | fire timer `id` once, `n` ticks from now (`n < 1` is 1) | `INVALID` (negative id), `LIMIT` |
| `Every(id, n)` | fire every `n` ticks, the first time `n` ticks from now (`n < 1` is 1) | as above |
| `AfterSeconds(id, sec)` / `EverySeconds(id, sec)` | `After` / `Every` in seconds, rounded up to whole ticks; they stay correct when `runtime.tick_rate` changes | as above |
| `TimerStart(id, delay, every)` | raw form: first firing `delay` ticks after the next tick, then every `every` ticks (0 = once) | `INVALID` (negative, or over 2^30), `LIMIT` |
| `CancelTimer(id)` | disarm | `NOT_FOUND` if not armed |
| `TimerRemaining(id)` | ticks before it fires (`0` = at the start of the next tick) | `NOT_FOUND` if not armed |
| `OnTimer(id, fn)` | handler for a timer id, registered in `init()` | none |

* Ids are your own non-negative `int32` numbers, per script. At most 64 armed timers per script; arming an id that exists **replaces** it (no `LIMIT`).
* `After(id, n)` armed in tick `T` fires at the start of tick `T + n`: `After(id, 1)` is the next tick. A timer never fires in the tick that armed it. The effect of arming is stored when your run commits.
* `Every` keeps its phase: a period is never shifted by the time spent in handlers. If a script missed periods (it was disabled), the timer fires once and continues on its original phase.
* A one-shot timer is removed before its handler runs, so the handler can re-arm it. A firing is delivered as an event of kind `KindTimer` (`0x7fff0001`) with a 4-byte little-endian id payload; `OnTimer` handles it for you. A timer with no `OnTimer` handler arrives in `OnEvent` with that kind.
* All timers count simulation ticks: they stop with a paused game and replay exactly. Use `Cooldown` below for state kept by hand.

## Tweens and easing

A `Tween` is plain data evaluated at a tick. It runs no goroutine and holds no hidden state, so it can live in `State` as JSON and replays exactly.

| item | meaning |
|---|---|
| `Tween{From, To, Start, Dur, Ease}` | `Start` and `Dur` in ticks; JSON keys `from`, `to`, `start`, `dur`, `ease` |
| `NewTween(from, to, dur, ease)` | start now (`Start = Tick()`); `dur < 1` becomes 1 |
| `t.At(tick)` | value at `tick`: `From` at or before `Start`, `To` from `Start+Dur` on (progress is clamped), and `From` always if `Dur` is 0 |
| `t.Now()` | `At(Tick())` |
| `t.Done(tick)` | `tick >= Start + Dur` |
| `Lerp(a, b, t)` | `a + (b-a)*t`, no clamping |
| `EaseKind.Apply(t)` | the curve at progress `t`; `t` is clamped to `[0,1]`, NaN counts as 0 |

A tween advances only because you evaluate it: call `Now()` in `OnTick`, store the tween once. Progress at tick `k` is `(k - Start) / Dur`, so a tween started at tick `S` with `Dur = 30` shows `From` at tick `S`, and reaches `To` at tick `S + 30`.

Easing curves (`t` in `0..1`; the result is in `0..1` except where noted):

| `EaseKind` | formula |
|---|---|
| `Linear` | `t` |
| `InQuad` / `OutQuad` / `InOutQuad` | `t^2` / `1-(1-t)^2` / `2t^2` then `1-(2-2t)^2/2` |
| `InCubic` / `OutCubic` / `InOutCubic` | `t^3` / `1-(1-t)^3` / `4t^3` then `1-(2-2t)^3/2` |
| `InSine` / `OutSine` / `InOutSine` | `1-cos(t*pi/2)` / `sin(t*pi/2)` / `-(cos(pi*t)-1)/2` |
| `OutBack` | `1 + 2.70158(t-1)^3 + 1.70158(t-1)^2`; overshoots 1 (to about 1.1) before settling |
| `OutBounce` | the standard four-bounce curve (`7.5625 t^2` pieces, ends at exactly 1) |
| `SmoothStep` | `t^2 (3-2t)` |

`Cooldown{Until}` is a tick deadline for "can act again in N ticks": `c.Start(n)` sets `Until = Tick()+n` (`n < 0` is 0), `c.Ready()` is `Tick() >= Until`; the zero value is ready. Keep it in `State` (JSON key `until`).

Determinism: curves and `Lerp` are `float64` code compiled into the guest, so they give the same bits on every machine; a stored tween round-trips exactly through JSON.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type doorState struct {
	Anim burrowsdk.Tween `json:"anim"`
	Cool burrowsdk.Cooldown `json:"cool"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			st, _ := burrowsdk.LoadState[doorState]()
			st.Anim = burrowsdk.NewTween(0, 90, 30, burrowsdk.OutBounce) // 1.5 s
			st.Cool.Start(100)
			_ = burrowsdk.SaveState(st)
		},
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[doorState]()
			if !st.Anim.Done(burrowsdk.Tick()) {
				_ = burrowsdk.SetFloat(self, "transform", "rot[1]", st.Anim.Now())
			}
			if st.Cool.Ready() {
				// can act again
			}
		},
	})
}

func main() {}
```

## See also

* [Execution model](02-execution-model.md): tick order, commit, faults.
* [State and props](03-state-and-props.md): where tweens, cooldowns and edge flags live.
* [Entities and scene](04-entities-and-scene.md): finding event targets.
* [World](05-world.md): physics overlap polling, levels.
* [Effects](07-effects.md): cameras, audio, UI events.
* [Multiplayer](08-multiplayer.md): per-player input.
* [Errors and limits](09-errors-and-limits.md).
* [reference/input-actions.md](../reference/input-actions.md), [cameras](../cameras.md).
