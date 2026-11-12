# Builtin assets

Every asset the engine ships is a visible, read-only **builtin asset** addressed as `builtin:<name>`. A project uses it as is, or copies it
into the project as an editable variant that overrides it (Unity/Unreal style).

| Kind | Names | Project file form |
|---|---|---|
| particles | `builtin:smoke sparks dust splash fire soul_fire debris` | `.particles.json` |
| texture (sprites) | `builtin:soft puff spark flame square ring` | `.png` |
| mesh | `builtin:cube sphere plane` (also the bare `cube`, `sphere`, `plane` of `render.mesh`) | `.obj` |
| prefab, ui, sound | registered by their own packages (`builtinprefabs`, ...) | `.prefab`, `.ui.json`, ... |

## Registry

Package `builtinassets` imports nothing heavy. `Get(kind, name)`, `List(kinds...)` and `Entry.Bytes()` return the file content in the same format a
project asset has. Another package adds its kind from `init` (no import cycle: it imports `builtinassets`, never the reverse):

```go nocheck
func init() {
	builtinassets.Register(builtinassets.Entry{Name: "builtin:player.prefab", Kind: builtinassets.Prefab,
		Ext: ".prefab", Data: func() []byte { return playerPrefab }})
}
```

The embedded files live in `builtinassets/data/{particles,textures,meshes}`. They are generated from Go: `go test ./particles -run TestBuiltinUpdate
-update-builtin` rewrites the effects and sprites from the reference definitions in `particles/presets_legacy_test.go`, and `go test ./render/rworld -run
TestBuiltinMeshUpdate -update-builtin` the meshes. Golden tests (`TestBuiltinMatchesGo`, `TestBuiltinSpritesMatchGo`, `TestBuiltinMeshOBJ`) keep the files and the Go
definitions equal.

## Engine folder and variants

The Content panel has a virtual **Engine** folder (read-only, thumbnails for sprites). Its context menu offers:

- **Copy to project**: writes `assets/particles/fire.particles.json`, `assets/meshes/cube.obj`, `assets/textures/flame.png`, ... (`_2`, `_3` when the name is taken).
- **Copy to project and replace references in the open scene**: also switches every `builtin:x` (or `cube`) in the open scene's components to the copy, as one undo step.
- **Create variant**: kinds that register `editorui.EngineVariantHooks[kind]` run their own variant flow; otherwise it is Copy to project. A prefab becomes a project `.prefab` that links the built-in with no overrides (see [prefabs](prefabs.md#variants)) and opens in the prefab editor; a game UI is copied into the project and opens in the designer.
- The Inspector offers the built-in and project assets in one picker: `game.mode.player_prefab` (prefabs holding a `player` component), `game.ui` slots (game UI files, with `(none)`), `material_ref` / `material` (`.material.json`), `particle_emitter.asset` (effects), `audio_source.asset` (sounds). The picker's icon buttons open the asset or make a variant.

## Overriding a builtin for the whole game

`partplug.Plugin.Overrides` / `particles.Library.SetOverrides` map a builtin name to a project file; everything naming the builtin (emitters, sub-emitters,
`BlockDebris`, `BlockBreak`) then uses it, and a broken file falls back to the builtin. Block break debris is the effect `builtin:debris`:

```go nocheck
&partplug.Plugin{Component: true, Overrides: map[string]string{"builtin:debris": "assets/particles/debris.particles.json"}}
```

`rworld.RegisterBuiltinMeshes(assets)` registers the meshes under both names; `MemAssets.Mesh("builtin:cube")` resolves to `cube`, so a project mesh registered as `cube` overrides it.
