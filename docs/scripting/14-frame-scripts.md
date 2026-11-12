# OnFrame (frame domain)

`OnTick` runs 20 times per second and drives the simulation. `OnFrame` runs once per rendered frame, at screen rate. It is for cosmetics only: it can write a visual overlay and nothing else.

```go
package main

import (
	"math"

	"burrow-engine/sdk/burrowsdk"
)

func init() {
	burrowsdk.Register(burrowsdk.Script{
		OnFrame: func(self burrowsdk.Entity, f burrowsdk.Frame) {
			// bob the node with the player's speed, smooth at any frame rate
			_ = burrowsdk.VisualAdd("pos.y", 0.05*math.Sin(f.Time*8)*f.Speed)
			_ = burrowsdk.VisualSet("ui.speed", f.Speed)
		},
	})
}

func main() {}
```

## Frame info

| field | meaning |
|---|---|
| `Dt` | seconds since the previous frame |
| `Time` | elapsed seconds |
| `Alpha` | position between the last tick and the next, 0..1 |
| `MouseDX`, `MouseDY` | mouse pixels per 60 fps frame, as in `visual.bind` |
| `Speed` | horizontal speed of this node in blocks per second, measured between ticks |
| `Yaw`, `Pitch` | the player's view angles |

## Writes

- `VisualSet(target, v)` replaces the drawn value. `VisualAdd(target, v)` adds to it.
- `VisualSetOn(e, ...)` and `VisualAddOn(e, ...)` do the same on another node.
- Targets are those of `visual.bind`: `pos.x|y|z`, `rot.x|y|z`, `scale`, `light.intensity|r|g|b`, `material.p0..p3`, `camera.fov`, `ui.<key>`.
- A write lasts one frame. Write it again next frame.
- Writes are never saved, journaled or hashed.
- At most 64 writes per call. A bad target or a NaN returns an error.

## What is blocked

Inside `OnFrame` only these work: the writes above, `Self`, `Props`, `LoadState`, `Log` (the log is discarded) and `imui_frame`, the immediate-mode UI (see `docs/game-ui.md`, "Immediate-mode UI from scripts"). Every other host call returns `ErrUnavailable`: `Set`, `Spawn`, `Emit`, timers, voxels, `Rand`, `Tick`, physics, `SaveState`. The list is a whitelist, so a new host function is blocked by default.

The reverse holds too: `VisualSet` in `OnTick` returns `ErrUnavailable`.

## Limits

- Budget: `Config.FrameGas`, default `GasPerInvocation/20`. Memory is reset after every call, like in a tick.
- At most 256 scripts per frame, in ascending entity id.
- Skipped while the game is paused by the editor, a fault or loading. A pause by the game UI (a menu or an `IMUI` modal) keeps it running, with `Frame.Paused` set: see "Pause menu" in `docs/game-ui.md`. Also skipped with the editor free camera, and when no render plugin runs (headless, dedicated server).
- A module that exports only `OnFrame` is valid at the ABI level. The Go SDK exports every entry, so Go scripts always have all of them.

## Faults

A fault in `OnFrame` (gas, trap) drops that call's writes. It never fails a tick, never rolls back, never journals `script_disable` and never changes the state hash. Faults are counted (`Runtime.FrameFaults`) and the first one is logged to the console. After 3 consecutive faults `OnFrame` stops for that node until its module changes.

## Determinism

Replays and `StateHash` are identical with and without `OnFrame` scripts. A test runs the same project with and without the frame system and compares the hashes.
