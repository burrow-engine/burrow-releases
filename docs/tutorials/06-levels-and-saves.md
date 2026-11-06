# Tutorial 6: levels and saves

A **level** is a hand-built voxel region with spawn points and trigger zones. A **save** is a slot holding a snapshot of the simulation, the current level and your own key-value data. Both are deterministic and off by default (`runtime.plugins.levels: true` / `saves: true` enable them).

## Steps

1. Enable both plugins in `vox.project`:

   ```json
   { "runtime": {
       "plugins": { "levels": true, "saves": true },
       "levels":  { "dir": "levels", "initial": "hall", "actors": ["/player"] },
       "saves":   { "game": "my_game", "version": 1, "autosave_seconds": 60, "autosave_slots": 2 } } }
   ```

2. Build the area you want to keep as a level, using the tools of [tutorial 3](03-place-blocks.md).

3. Select the area with the Region tool (**0**), then open **View > Levels...** and press **Save region as level**: it writes a `.level` file into the `levels` folder. The popup also lists the existing levels; **Open (place into the world)** loads one.

4. Still in the popup, use **Mark spawn at focus** to add a named spawn point where the camera looks, and **Mark zone from the box** to turn the current box into a zone; **Clear draft** starts over. A *trigger* zone whose `target` is another level switches level when an actor stands in it. The switch is a journaled command, so replays follow it.

5. Press Play and walk into the trigger. Stop with **Esc**: the editor restores the world from before Play.

6. Save games from a script with the `save_*` host functions, or let autosave do it. Loading a slot restores the exact `StateHash` it was saved with.

## Good to know

* Procedural worldgen stays the base layer. A level overlays it: `mix: replace` carves the whole box, `mix: keep` replaces only stored chunks, so a level can be a fixed building inside a generated world.
* Blocks are stored by name, so a level loads into any registry that has those blocks and fails naming a missing one.

The format, zones and settings are in [levels-saves.md](../levels-saves.md). Next: [particles](07-particles.md).
