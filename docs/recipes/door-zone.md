# Recipe: door and trigger zone

A wall of three blocks at x=10, z=10, y=9..11 opens (air) while the player stands inside the box around it and closes (stone) when they leave. Stateless: the voxels are the state, so it is deterministic and survives saves.

## gogame

```go
package main

import "burrow-engine/gogame"

func inZone(x, y, z float32) bool {
	return x >= 7 && x <= 13 && y >= 8 && y <= 13 && z >= 7 && z <= 13
}

func main() {
	gogame.Main(gogame.Game{
		OnTick: func(c *gogame.Ctx) {
			player, ok := c.Player()
			if !ok {
				return
			}
			p, _ := c.Pos(player)
			want := "stone"
			if inZone(p.X, p.Y, p.Z) {
				want = "air"
			}
			for y := 9; y <= 11; y++ {
				if c.Voxel(10, y, 10) != want {
					_ = c.SetVoxel(10, y, 10, want)
				}
			}
		},
	})
}
```

## WASM script

On any node (for example the player). Resolve block ids once per call with `BlockByName`.

```go
package main

import "burrow-engine/sdk/burrowsdk"

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnTick: func(self burrowsdk.Entity, dt float64) {
			player, ok := burrowsdk.LocalPlayer()
			if !ok {
				return
			}
			t, err := burrowsdk.GetTransform(player)
			if err != nil {
				return
			}
			x, y, z := t.Pos[0], t.Pos[1], t.Pos[2]
			open := x >= 7 && x <= 13 && y >= 8 && y <= 13 && z >= 7 && z <= 13
			name := "stone"
			if open {
				name = "air"
			}
			want, err := burrowsdk.BlockByName(name)
			if err != nil {
				return
			}
			for by := 9; by <= 11; by++ {
				if cur, err := burrowsdk.Voxel(10, by, 10); err == nil && cur != want {
					_ = burrowsdk.SetVoxel(10, by, 10, want)
				}
			}
		},
	})
}

func main() {}
```
