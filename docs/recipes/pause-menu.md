# Recipe: pause menu

P toggles the menu. `SetPausedBy` freezes the simulation while it is open. The key is read raw in `OnFrame` (cosmetic input only, no simulation change).

```go
package main

import (
	"burrow-engine/gameui/imui"
	"burrow-engine/gogame"
)

var (
	paused bool // frame side only (OnFrame and UI run on the same goroutine)
	quit   bool
	held   bool
	volume = float32(0.8)
)

func main() {
	gogame.Main(gogame.Game{
		OnFrame: func(f *gogame.Frame) {
			now := f.Key("P")
			if now && !held {
				paused = !paused
			}
			held = now
			f.Context().SetPausedBy("menu", paused)
			if quit {
				f.Quit()
			}
		},
		UI: func(ui *imui.UI) {
			if !paused {
				return
			}
			ui.Window("Paused", func() {
				if ui.Button("Resume") {
					paused = false
				}
				ui.Slider("Volume", &volume, 0, 1)
				if ui.Button("Quit") {
					quit = true
				}
			})
		},
	})
}
```
