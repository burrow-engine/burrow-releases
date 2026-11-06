# Recipe: main menu that loads the game scene

`vox.project` default scene is `scenes/menu.voxscn` (camera, sky, one root node named `MenuRoot`). Play despawns it and loads `scenes/game.voxscn`. The button emits a UI signal (`ui.Emit`); it reaches `OnTick` on the next tick through a journaled command, so the run replays exactly.

```go
package main

import (
	"sync/atomic"

	"burrow-engine/gameui/imui"
	"burrow-engine/gogame"
)

var (
	quit   atomic.Bool // frame side only (closing the window is not simulation)
	inGame atomic.Bool
)

func main() {
	gogame.Main(gogame.Game{
		OnTick: func(c *gogame.Ctx) {
			if !c.UIClicked("play") {
				return
			}
			if root, ok := c.Find("MenuRoot"); ok {
				_ = c.Despawn(root)
			}
			_ = c.LoadScene("scenes/game.voxscn")
			inGame.Store(true)
		},
		OnFrame: func(f *gogame.Frame) {
			if quit.Load() {
				f.Quit()
			}
		},
		UI: func(ui *imui.UI) {
			if inGame.Load() {
				return
			}
			ui.Window("My Game", func() {
				if ui.Button("Play") {
					ui.Emit("play", 0)
				}
				if ui.Button("Quit") {
					quit.Store(true)
				}
			})
		},
	})
}
```

Keep `"runtime":{"plugins":{"scripts":true}}` in `vox.project`.
