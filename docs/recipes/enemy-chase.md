# Recipe: enemy that chases the player

Enemy nodes are tagged `enemy`. They walk straight toward the player on the XZ plane and stop within 1.2 blocks. There is no pathfinding here: for walls and slopes add a `nav.agent` component and `NavSetGoalPos` ([navigation](../navigation-ai.md)).

## gogame

```go
package main

import (
	"math"

	"burrow-engine/gogame"
)

const (
	speed = 3.0 // blocks per second
	stop  = 1.2
)

func main() {
	gogame.Main(gogame.Game{
		OnTick: func(c *gogame.Ctx) {
			player, ok := c.Player()
			if !ok {
				return
			}
			pp, _ := c.Pos(player)
			for _, e := range c.FindByTag("enemy") {
				ep, ok := c.Pos(e)
				if !ok {
					continue
				}
				dx, dz := float64(pp.X-ep.X), float64(pp.Z-ep.Z)
				d := math.Hypot(dx, dz)
				if d < stop {
					continue
				}
				step := float64(speed * c.Dt())
				ep.X += float32(dx / d * step)
				ep.Z += float32(dz / d * step)
				_ = c.SetPos(e, ep)
			}
		},
	})
}
```

## WASM script

On the enemy node, with props `{"speed": 3}`.

```go
package main

import (
	"math"

	"burrow-engine/sdk/burrowsdk"
)

type props struct {
	Speed float64 `json:"speed"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			p, _ := burrowsdk.Props[props]()
			player, ok := burrowsdk.LocalPlayer()
			if !ok {
				return
			}
			pt, err1 := burrowsdk.GetTransform(player)
			me, err2 := burrowsdk.GetTransform(self)
			if err1 != nil || err2 != nil {
				return
			}
			dx, dz := float64(pt.Pos[0]-me.Pos[0]), float64(pt.Pos[2]-me.Pos[2])
			d := math.Hypot(dx, dz)
			if d < 1.2 {
				return
			}
			me.Pos[0] += float32(dx / d * p.Speed * dt)
			me.Pos[2] += float32(dz / d * p.Speed * dt)
			_ = burrowsdk.SetTransform(self, me)
		},
	})
}

func main() {}
```
