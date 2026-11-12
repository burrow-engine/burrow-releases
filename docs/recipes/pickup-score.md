# Recipe: pickup and score HUD

Scene nodes tagged `coin` (component `"tags"`). Touching one (within 1.5 blocks of the player) removes it and adds 1 to the score.

## gogame

```go
package main

import (
	"fmt"
	"sync/atomic"

	"burrow-engine/gameui/imui"
	"burrow-engine/gogame"
)

var score atomic.Int64 // read by the UI, written by OnTick

func main() {
	gogame.Main(gogame.Game{
		OnTick: func(c *gogame.Ctx) {
			player, ok := c.Player()
			if !ok {
				return
			}
			pp, _ := c.Pos(player)
			for _, coin := range c.FindByTag("coin") {
				cp, ok := c.Pos(coin)
				if !ok {
					continue
				}
				dx, dy, dz := cp.X-pp.X, cp.Y-pp.Y, cp.Z-pp.Z
				if dx*dx+dy*dy+dz*dz < 1.5*1.5 {
					_ = c.Despawn(coin)
					score.Add(1)
				}
			}
		},
		UI: func(ui *imui.UI) {
			ui.Panel("hud", imui.Rect{X: 12, Y: 12, W: 160, H: 40}, func() {
				ui.Label(fmt.Sprintf("Score: %d", score.Load()))
			})
		},
	})
}
```

## WASM script

Put the script on the player node. The score lives in `State` (memory resets every call) and goes to the HUD with `UISetNum`. `ui/hud.ui.json` holds a label `{"type":"label","text":"Score {score}"}` and `plugins.gameui` is on.

```go
package main

import "burrow-engine/sdk/burrowsdk"

type state struct {
	Score int `json:"score"`
}

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			me, err := burrowsdk.GetTransform(self)
			if err != nil {
				return
			}
			coins, _, _ := burrowsdk.FindTag("coin", 0)
			st, _ := burrowsdk.LoadState[state]()
			before := st.Score
			for _, coin := range coins {
				t, err := burrowsdk.GetTransform(coin)
				if err != nil {
					continue
				}
				dx, dy, dz := t.Pos[0]-me.Pos[0], t.Pos[1]-me.Pos[1], t.Pos[2]-me.Pos[2]
				if dx*dx+dy*dy+dz*dz < 1.5*1.5 {
					_ = burrowsdk.Despawn(coin)
					st.Score++
				}
			}
			if st.Score != before {
				_ = burrowsdk.SaveState(st)
				_ = burrowsdk.UISetNum("score", float64(st.Score))
			}
		},
	})
}

func main() {}
```
