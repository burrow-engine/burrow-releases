# Tutorial 4: add a scripted entity

A script is a small WebAssembly module, written in Go, that runs inside the deterministic simulation. This tutorial makes a cube spin.

## Steps

1. In your project folder, scaffold the script:

   ```sh
   burrow script new spin
   ```

   This creates `scripts/spin/main.go`.

2. Replace the body of `scripts/spin/main.go` with a script that turns its entity:

   ```go nocheck
   package main

   import "burrow-engine/sdk/burrowsdk"

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
   			t.Rot[1] += p.Speed * float32(dt)
   			burrowsdk.SetTransform(self, t)
   		},
   	})
   }

   func main() {}
   ```

3. Build it:

   ```sh
   burrow script build
   ```

   The module lands in `assets/scripts/spin.wasm`. Every host function and SDK helper you can call is listed in the [script API reference](../reference/script-api.md).

4. In the editor, choose **Edit > Create > Cube** (or the **+** of the Hierarchy). Select the cube.

5. In the Inspector press **Add component**, type `script` and pick it. Set `module` to `assets/scripts/spin.wasm` and `props` to `{"speed": 90}`. Hover the component title: the tooltip describes the component, and **F1** opens its entry in the [components reference](../reference/components.md#script).

6. Press **Ctrl+Shift+P**. The cube spins at 90 degrees per second. **Esc** stops, and the cube returns to its angle from before Play.

7. Save with **Ctrl+S**.

## Why it behaves this way

* Script memory is reset before every call. What a script remembers lives in components (`State`, `Props` or any other) so snapshots, replays and rollbacks are exact.
* Time is the tick: `dt` is always 50 ms. Use `burrowsdk.Rand()` for randomness, never the wall clock.
* The editor hot-reloads a rebuilt `.wasm` while you edit.
* A script that does not behave: see [debugging and testing](../scripting/10-debugging-and-testing.md).

Go further with the [Scripting category](../scripting.md): [execution model](../scripting/02-execution-model.md), [state and props](../scripting/03-state-and-props.md), [cookbook](../scripting/11-cookbook.md) and the [ABI](../../script/ABI.md). Next: [cameras and game UI](05-cameras-and-game-ui.md).
