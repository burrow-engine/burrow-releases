# Tutorial 7: particles

Particles are frame domain: they never touch the simulation or its hash. The simulation only *requests* effects; the renderer shows them.

## Steps

1. Enable the system in `vox.project`: `"runtime": { "plugins": { "particles": true } }`. This also registers the `particle_emitter` component.

2. Open **Tools > Particle Effects**: the particle editor fills the window as a docked panel, with its *Particles Settings* panel (Ctrl+Space goes back to the editor). Click `fire` in the library on the left: the preview in the middle loops the effect, and every parameter on the right changes it live (drag a slider, the size curve or a colour). To keep your own copy, type an asset path in the File section of *Particles Settings* and press Save: it writes a `.particles.json`. The six built-ins are `smoke`, `sparks`, `dust`, `splash`, `fire` and `debris`.

3. Make a continuous effect: create an Empty node (**Edit > Create > Empty**), name it `campfire`, then **Add component** > `particle_emitter`. Set `asset` to `builtin:fire` and `enabled` to true. Hover the fields to read what each one does; [the component reference](../reference/components.md#particle_emitter) lists every field, range and default.

4. Press **Ctrl+Shift+P**. The fire burns in the game view too.

5. Fire a one-shot burst from a script, for example when something breaks:

   ```go nocheck
   burrowsdk.ParticleBurstOn(self, "builtin:sparks", burrowsdk.ParticleOpts{Count: 40})
   ```

6. Write your own effect as a `.particles.json` asset and point `asset` at it. The *Validate* action of the `editor_particles` tool checks it.

Limits and the format are in [particles.md](../particles.md). Next: [audio packs](08-audio-packs.md).
