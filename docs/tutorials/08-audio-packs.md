# Tutorial 8: audio and sound packs

Burrow ships **no sound files**. A sound pack is a folder of your own `.ogg` or `.wav` files on your machine that the game maps to engine events. You are responsible for the rights of the files you use.

## Steps

1. Enable audio in `vox.project`: `"runtime": { "plugins": { "audio": true } }` (the sandbox template already has it).

2. Open **View > Audio...** to see the mixer: master, music, sfx, ambient and ui buses with mute switches, and an audition list of the built-in sounds.

   ![the Audio popup: one volume slider and one mute switch per bus, and the audition list](../img/tut-popup-audio.png)

3. Create the pack folder **outside your project**, for example `~/my-sounds`, with this layout (a number at the end of a name is a variant):

   ```text
   step/grass1.ogg stone1.ogg wood1.ogg
   dig/stone1.ogg grass1.ogg
   liquid/splash.ogg
   ambient/weather/rain1.ogg
   music/game/theme1.ogg
   ```

4. Tell the game where it is, with the first that applies: `-sounds <dir>` on `burrowplay`, the `BURROW_SOUNDS` variable, `runtime.audio.pack` in `vox.project`, or `~/.burrow/sounds`:

   ```json
   { "runtime": { "audio": { "pack": "~/my-sounds", "fallback": "none", "music_volume": 0.6 } } }
   ```

5. Press Play and walk on different blocks: the step sounds follow the block material. In the Assets panel a `.wav` or `.ogg` has a play button; double-click auditions it.

6. Play a sound from a script (a project sound file; the pack fills in the events the game raises itself):

   ```go nocheck
   burrowsdk.PlayOn(self, "assets/thunder.wav", burrowsdk.SoundOpts{Bus: "ambient", Volume: 0.8})
   ```

## Rules worth remembering

* A pack is **never bundled into an export**: `burrow build` refuses a project folder that contains one.
* With `sounds.json` you map event names to files yourself; without it the folder layout above is detected.

All the details (events, buses, `sounds.json`, limits) are in [audio.md](../audio.md#sound-packs). Next: [export for Windows](09-export-windows.md).
