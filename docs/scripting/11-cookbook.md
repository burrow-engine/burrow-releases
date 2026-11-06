# Cookbook

Complete, compilable scripts for common jobs. Each block is a whole `main.go`: put it in `scripts/<name>/`, run `burrow script build`, attach the module to a node (`"script": {"module": "assets/scripts/<name>.wasm", "props": {...}}`).

* Input actions (`move`, `jump`, `pick`, `place`) are those of the `scripted`, `platformer` and `builder` templates and must exist in your `input.json`. `move` is an `axis2d`: `x` right, `y` forward. Forward is -Z; yaw is `Rot[1]` in degrees.
* Event kinds you pick yourself must stay below `0x40000000` (above are bus topics and timers).
* `FindTag` scans the scene and is charged per node: cache the result in `State`.
* Ignored errors are ones that cannot matter for the recipe; see [errors and limits](09-errors-and-limits.md).

## Spin an entity

What: rotate around Y at `speed` degrees per second. When: decoration, pickups, fans.

```go
package main

import (
	"math"

	"burrow-engine/sdk/burrowsdk"
)

type props struct {
	Speed float32 `json:"speed"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			p, _ := burrowsdk.Props[props]()
			t, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			t.Rot[1] = float32(math.Mod(float64(t.Rot[1]+p.Speed*float32(dt)), 360))
			_ = burrowsdk.SetTransform(self, t)
		},
	})
}

func main() {}
```

## Move with input

What: walk on the XZ plane from the `move` action. When: a top-down or test avatar without physics.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			x, y, ok := burrowsdk.Action("move")
			t, err := burrowsdk.GetTransform(self)
			if !ok || err != nil {
				return
			}
			t.Pos[0] += x * 5 * float32(dt) // 5 blocks per second
			t.Pos[2] -= y * 5 * float32(dt)
			_ = burrowsdk.SetTransform(self, t)
		},
	})
}

func main() {}
```

## Jump pressed edge

What: act once per press, not every tick the key is held. When: any button. Input is a level; derive the edge from your own `State`.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	WasDown bool `json:"was_down"`
	Jumps   int  `json:"jumps"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			x, _, ok := burrowsdk.Action("jump")
			down := ok && x > 0.5
			if down && !st.WasDown {
				st.Jumps++
				burrowsdk.Logf("jump %d", st.Jumps)
			}
			st.WasDown = down
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

## Despawn after a lifetime

What: remove yourself after `ticks`. When: bullets, effects, temporary blocks.

```go
package main

import "burrow-engine/sdk/burrowsdk"

const timerLife = 1

type props struct {
	Ticks int `json:"ticks"`
}

func init() {
	burrowsdk.OnTimer(timerLife, func(self burrowsdk.Entity) {
		_ = burrowsdk.Despawn(self) // the subtree goes too, at commit
	})
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			p, _ := burrowsdk.Props[props]()
			_ = burrowsdk.After(timerLife, max(p.Ticks, 1))
		},
	})
}

func main() {}
```

## Coin pickup with tags and events

What: a coin tells the player it was taken, then vanishes; the player counts. When: collectibles. Tag the player node `"tags": {"tags": ["player"]}`. Two scripts, one event kind.

Coin (`props`: `{"radius": 1}`):

```go
package main

import "burrow-engine/sdk/burrowsdk"

const kindCoin int32 = 1

type props struct {
	Radius float32 `json:"radius"`
}

type state struct {
	Player burrowsdk.Entity `json:"player"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			if !burrowsdk.Exists(st.Player) {
				found, _, err := burrowsdk.FindTag("player", 0)
				if err != nil || len(found) == 0 {
					return
				}
				st.Player = found[0]
				_ = burrowsdk.SaveState(st)
			}
			a, errA := burrowsdk.GetTransform(self)
			b, errB := burrowsdk.GetTransform(st.Player)
			if errA != nil || errB != nil {
				return
			}
			p, _ := burrowsdk.Props[props]()
			dx, dy, dz := a.Pos[0]-b.Pos[0], a.Pos[1]-b.Pos[1], a.Pos[2]-b.Pos[2]
			if r := max(p.Radius, 1); dx*dx+dy*dy+dz*dz <= r*r {
				_ = burrowsdk.Emit(st.Player, kindCoin, nil)
				_ = burrowsdk.Despawn(self)
			}
		},
	})
}

func main() {}
```

Player:

```go
package main

import "burrow-engine/sdk/burrowsdk"

const kindCoin int32 = 1

type state struct {
	Coins int `json:"coins"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnEvent: func(self burrowsdk.Entity, ev burrowsdk.Event) {
			if ev.Kind == kindCoin {
				st, _ := burrowsdk.LoadState[state]()
				st.Coins++
				_ = burrowsdk.SaveState(st)
				burrowsdk.Logf("coins: %d", st.Coins)
			}
		},
	})
}

func main() {}
```

## Door that toggles

What: swing a door open and shut with an eased rotation, from the `pick` key or the `door.toggle` message. When: doors, gates, lids.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Open    bool            `json:"open"`
	Anim    burrowsdk.Tween `json:"anim"`
	WasDown bool            `json:"was_down"`
}

func toggle(st *state) {
	cur := 0.0
	if st.Anim.Dur > 0 {
		cur = st.Anim.Now() // continue a half-finished swing
	}
	st.Open = !st.Open
	to := 0.0
	if st.Open {
		to = 90
	}
	st.Anim = burrowsdk.NewTween(cur, to, 10, burrowsdk.OutQuad)
}

func init() {
	burrowsdk.OnMessage("door.toggle", func(self, from burrowsdk.Entity, payload []byte) {
		st, _ := burrowsdk.LoadState[state]()
		toggle(&st)
		_ = burrowsdk.SaveState(st)
	})
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			x, _, ok := burrowsdk.Action("pick")
			down := ok && x > 0.5
			if down && !st.WasDown {
				toggle(&st)
			}
			st.WasDown = down
			if t, err := burrowsdk.GetTransform(self); err == nil && st.Anim.Dur > 0 {
				t.Rot[1] = float32(st.Anim.Now())
				_ = burrowsdk.SetTransform(self, t)
			}
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

## Break and place voxels

What: on `pick` remove the block a ray hits, on `place` put a block against the hit face. When: digging, building. `props`: `{"reach": 6, "dir": [0,-1,0], "block": "stone"}`. Edits apply at commit (budget 4,096 per tick); reads in the same call already see them.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type props struct {
	Reach float32    `json:"reach"`
	Dir   [3]float32 `json:"dir"`
	Block string     `json:"block"`
}

type state struct {
	Pick  bool `json:"pick"`
	Place bool `json:"place"`
}

func edge(action string, was *bool) bool {
	x, _, ok := burrowsdk.Action(action)
	down := ok && x > 0.5
	pressed := down && !*was
	*was = down
	return pressed
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			defer burrowsdk.SaveState(&st)
			breaking, placing := edge("pick", &st.Pick), edge("place", &st.Place)
			t, err := burrowsdk.GetTransform(self)
			if err != nil || !(breaking || placing) {
				return
			}
			p, _ := burrowsdk.Props[props]()
			hit, ok, err := burrowsdk.Raycast(t.Pos, p.Dir, max(p.Reach, 1))
			if err != nil || !ok {
				return
			}
			if breaking {
				_ = burrowsdk.SetVoxel(int(hit.X), int(hit.Y), int(hit.Z), 0)
			}
			if id, err := burrowsdk.BlockByName(p.Block); placing && err == nil {
				_ = burrowsdk.SetVoxel(int(hit.X+hit.NX), int(hit.Y+hit.NY), int(hit.Z+hit.NZ), id)
			}
		},
	})
}

func main() {}
```

## Wander randomly

What: walk a random heading, pick a new one every 1 to 3 seconds. When: ambient animals, crowds. `RandN` is a per-script deterministic stream, so replays and peers walk the same path.

```go
package main

import (
	"math"

	"burrow-engine/sdk/burrowsdk"
)

type state struct {
	Heading float64 `json:"heading"` // degrees
	Until   uint64  `json:"until"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			if burrowsdk.Tick() >= st.Until {
				st.Heading = float64(burrowsdk.RandN(360))
				st.Until = burrowsdk.Tick() + 20 + uint64(burrowsdk.RandN(40))
			}
			t, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			s, c := math.Sincos(st.Heading * math.Pi / 180)
			t.Pos[0] += float32(s) * 2 * float32(dt)
			t.Pos[2] += float32(c) * 2 * float32(dt)
			t.Rot[1] = float32(st.Heading)
			_ = burrowsdk.SetTransform(self, t)
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

## Timer and countdown

What: count `seconds` down once per second and announce the end. When: round timers, fuses. `Every(id, 20)` fires every 20 ticks (1 s); `CancelTimer` stops it.

```go
package main

import "burrow-engine/sdk/burrowsdk"

const timerSecond = 1

type props struct {
	Seconds int `json:"seconds"`
}

type state struct {
	Left int `json:"left"`
}

func init() {
	burrowsdk.OnTimer(timerSecond, func(self burrowsdk.Entity) {
		st, _ := burrowsdk.LoadState[state]()
		st.Left--
		burrowsdk.Logf("%d s left", st.Left)
		if st.Left <= 0 {
			_ = burrowsdk.CancelTimer(timerSecond)
			_ = burrowsdk.Publish("countdown.done", nil)
		}
		_ = burrowsdk.SaveState(st)
	})
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			p, _ := burrowsdk.Props[props]()
			_ = burrowsdk.SaveState(state{Left: max(p.Seconds, 1)})
			_ = burrowsdk.Every(timerSecond, 20)
		},
	})
}

func main() {}
```

## Tween a property

What: pulse the scale between 1 and 1.5 with a sine ease, 1 s each way. When: any value that moves over time. A `Tween` is plain data kept in `State` and evaluated with the tick.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Anim burrowsdk.Tween `json:"anim"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			if st.Anim.Dur == 0 {
				st.Anim = burrowsdk.NewTween(1, 1.5, 20, burrowsdk.InOutSine)
			} else if st.Anim.Done(burrowsdk.Tick()) {
				st.Anim = burrowsdk.NewTween(st.Anim.To, st.Anim.From, 20, burrowsdk.InOutSine)
			}
			if t, err := burrowsdk.GetTransform(self); err == nil {
				s := float32(st.Anim.Now())
				t.Scale = [3]float32{s, s, s}
				_ = burrowsdk.SetTransform(self, t)
			}
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

## Sound, particles and shake on an event

What: when `coin.pick` is published, play a positional sound, burst sparks and nudge the camera at the sender. When: feedback for gameplay events. Needs `runtime.plugins.audio` / `particles` / `camera` and a real sound file; otherwise each call is silently ignored ([effects](07-effects.md)).

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.OnMessage("coin.pick", func(self, from burrowsdk.Entity, payload []byte) {
		_, err := burrowsdk.GetTransform(from)
		if err != nil { // the sender is already gone
			_, _ = burrowsdk.PlayOn(self, "assets/sfx/coin.ogg", burrowsdk.SoundOpts{Bus: "sfx", Mode: burrowsdk.SoundGlobal})
			return
		}
		_, _ = burrowsdk.PlayOn(self, "assets/sfx/coin.ogg", burrowsdk.SoundOpts{Bus: "sfx", Volume: 0.8})
		_ = burrowsdk.ParticleBurstOn(self, "builtin:sparks", burrowsdk.ParticleOpts{Offset: &[3]float32{0, 1, 0}, Count: 12, Scale: 0.6})
		_ = burrowsdk.CameraShake(0.1)
	})
}

func main() {}
```

## HUD counter and camera shake

What: show a score in the game UI, pop a number where it was earned, bump the camera. When: any HUD. Needs `runtime.plugins.gameui` and a screen with a label `{coins}` or a bar bound to `coins`. Send only changed values: each UI call costs one event of the budget.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Coins int `json:"coins"`
}

func init() {
	burrowsdk.OnMessage("coin.pick", func(self, from burrowsdk.Entity, payload []byte) {
		st, _ := burrowsdk.LoadState[state]()
		st.Coins++
		_ = burrowsdk.SaveState(st)
		_ = burrowsdk.UISetNum("coins", float64(st.Coins))
		if t, err := burrowsdk.GetTransform(from); err == nil {
			_ = burrowsdk.UIPopup(t.Pos[0], t.Pos[1]+1, t.Pos[2], "+1", 1)
		}
		_ = burrowsdk.CameraShake(0.15)
	})
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) { // bind the initial value
			st, _ := burrowsdk.LoadState[state]()
			_ = burrowsdk.UISetNum("coins", float64(st.Coins))
		},
	})
}

func main() {}
```

## Save and load progress

What: keep progress in `State` and mirror it into the save game. When: anything that must survive a quit. `State` is hashed and snapshotted with the world; `SaveSet` / `SaveGet` are game data of the save system and need `runtime.plugins.saves` (else `UNAVAILABLE`).

```go
package main

import (
	"strconv"

	"burrow-engine/sdk/burrowsdk"
)

type state struct {
	Score int `json:"score"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			st, _ := burrowsdk.LoadState[state]()
			if v, ok, err := burrowsdk.SaveGet("score"); err == nil && ok {
				st.Score, _ = strconv.Atoi(v)
			}
			_ = burrowsdk.SaveState(st)
		},
		OnEvent: func(self burrowsdk.Entity, ev burrowsdk.Event) {
			st, _ := burrowsdk.LoadState[state]()
			st.Score += 10
			_ = burrowsdk.SaveState(st)
			_ = burrowsdk.SaveSet("score", strconv.Itoa(st.Score)) // written with the next save
		},
	})
}

func main() {}
```

## Two scripts talking

What: a button publishes a message, a lamp reacts. When: decoupled objects that do not know each other's entity. Messages arrive on a later tick, to every subscriber in ascending entity order.

Button (key `pick`):

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	WasDown bool `json:"was_down"`
	On      bool `json:"on"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			x, _, ok := burrowsdk.Action("pick")
			down := ok && x > 0.5
			if down && !st.WasDown {
				st.On = !st.On
				payload := []byte{0}
				if st.On {
					payload[0] = 1
				}
				_ = burrowsdk.Publish("lamp.set", payload)
			}
			st.WasDown = down
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

Lamp (a node with a `render.pointlight`):

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.OnMessage("lamp.set", func(self, from burrowsdk.Entity, payload []byte) {
		intensity := 0.0
		if len(payload) > 0 && payload[0] == 1 {
			intensity = 8
		}
		if err := burrowsdk.SetFloat(self, "render.pointlight", "intensity", intensity); err != nil {
			burrowsdk.Logf("lamp: %v", err)
		}
	})
}

func main() {}
```

## Trigger zone

What: publish `zone.enter` and `zone.exit` once as the `player`-tagged node crosses a box. When: checkpoints, rooms, damage areas. `props`: `{"min": [0,0,0], "max": [4,3,4]}` in world coordinates. No physics plugin needed.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type props struct {
	Min [3]float32 `json:"min"`
	Max [3]float32 `json:"max"`
}

type state struct {
	Inside bool             `json:"inside"`
	Player burrowsdk.Entity `json:"player"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			if !burrowsdk.Exists(st.Player) {
				found, _, err := burrowsdk.FindTag("player", 0)
				if err != nil || len(found) == 0 {
					return
				}
				st.Player = found[0]
			}
			t, err := burrowsdk.GetTransform(st.Player)
			if err != nil {
				return
			}
			p, _ := burrowsdk.Props[props]()
			in := true
			for i := 0; i < 3; i++ {
				in = in && t.Pos[i] >= p.Min[i] && t.Pos[i] <= p.Max[i]
			}
			if in != st.Inside {
				st.Inside = in
				topic := "zone.exit"
				if in {
					topic = "zone.enter"
				}
				_ = burrowsdk.Publish(topic, nil)
			}
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

## Spawn every N ticks, with limits

What: every `every` ticks (20 = 1 s) spawn a tagged node at a random point, never more than `max` alive and `total` overall. When: waves, loot, projectiles, ambient creatures. Alive counts come from the scene (`FindTag`), so despawned nodes free a slot. `Spawn("", ...)` makes a bare node; a prefab name loads `prefabs/<name>.prefab` from the project, and that is how a script spawns a node that carries a `script` component. Errors: `BUDGET` past 32 spawns per tick, `NOT_FOUND` for an unknown prefab.

```go
package main

import (
	"encoding/json"

	"burrow-engine/sdk/burrowsdk"
)

const timerSpawn = 1

type props struct {
	Every  int     `json:"every"`
	Max    int     `json:"max"`
	Total  int     `json:"total"`
	Radius float32 `json:"radius"`
}

type state struct {
	Spawned int `json:"spawned"`
}

func init() {
	burrowsdk.OnTimer(timerSpawn, func(self burrowsdk.Entity) {
		p, _ := burrowsdk.Props[props]()
		st, _ := burrowsdk.LoadState[state]()
		if st.Spawned >= p.Total {
			_ = burrowsdk.CancelTimer(timerSpawn)
			return
		}
		alive, _, err := burrowsdk.FindTag("mob", 0)
		t, errT := burrowsdk.GetTransform(self)
		if err != nil || errT != nil || len(alive) >= p.Max {
			return
		}
		x := t.Pos[0] + float32(burrowsdk.RandFloat()*2-1)*p.Radius
		z := t.Pos[2] + float32(burrowsdk.RandFloat()*2-1)*p.Radius
		_, err = burrowsdk.Spawn("", burrowsdk.SpawnOpts{
			Transform:  &burrowsdk.Transform{Pos: [3]float32{x, t.Pos[1], z}, Scale: [3]float32{1, 1, 1}},
			Components: map[string]json.RawMessage{"tags": json.RawMessage(`{"tags":["mob"]}`)},
		})
		if err == nil {
			st.Spawned++
			_ = burrowsdk.SaveState(st)
		}
	})
	burrowsdk.Register(burrowsdk.Script{
		OnStart: func(self burrowsdk.Entity) {
			p, _ := burrowsdk.Props[props]()
			_ = burrowsdk.Every(timerSpawn, max(p.Every, 1))
		},
	})
}

func main() {}
```

## Sequences

What: "wait 0.5 s, do X, wait until a condition, do Y" without a hand-written state machine. When: dashes, cutscenes, timed abilities.

`Seq` is the immutable definition (build it once). Its position is a `SeqState` you keep in your `State`, so it is saved, replayed and hot-reload safe. Waits count simulation ticks (seconds round up at 20 Hz). Call `Tick` from `OnTick`.

```go nocheck
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Dash burrowsdk.SeqState `json:"dash"`
}

var dash = burrowsdk.NewSeq("dash").
	Do(func(self burrowsdk.Entity) { _ = burrowsdk.CameraShake(0.1) }).
	Wait(0.5).
	Do(func(self burrowsdk.Entity) { _ = burrowsdk.CameraShake(0.3) }).
	WaitUntil(func(self burrowsdk.Entity) bool {
		x, _, ok := burrowsdk.Action("jump")
		return ok && x > 0
	}).
	Do(func(self burrowsdk.Entity) { _ = burrowsdk.CameraShake(0.05) })

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			st, _ := burrowsdk.LoadState[state]()
			if !dash.Running(self, &st.Dash) {
				if x, _, ok := burrowsdk.Action("pick"); ok && x > 0 {
					dash.Start(self, &st.Dash)
				}
			}
			dash.Tick(self, &st.Dash)
			_ = burrowsdk.SaveState(st)
		},
	})
}

func main() {}
```

## See also

* [Getting started](01-getting-started.md), [execution model](02-execution-model.md), [state and props](03-state-and-props.md).
* [Entities and scene](04-entities-and-scene.md), [world](05-world.md), [input, events, time](06-input-events-time.md).
* [Effects](07-effects.md) (audio, particles, cameras, UI, animation), [multiplayer](08-multiplayer.md), [errors and limits](09-errors-and-limits.md).
* `examples/scripting_demo` and the `scripted`, `builder` and `platformer` templates for full projects.
