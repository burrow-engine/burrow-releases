# Linked prefabs

A prefab is a reusable subtree saved as a `.prefab` file (the `.voxscn` format with exactly one root). Placing one from the Assets panel creates a **linked instance**: the nodes are expanded in the scene, and the instance remembers its prefab and the few things you changed on it. Edit the prefab once and every instance follows; each keeps its own settings.

Example, a campfire: a voxel model node, a `particle_emitter` (fire), an `audio_source` (crackle) and a `script` with props. Build it once in the scene, then reuse it in ten places, one of them with `{"on": true}` in the script props and another with the smoke turned off.

## Using prefabs in the editor

* **Create prefab...** (Hierarchy right-click): saves the selected node and its children as a `.prefab` (path inside `assets/`, extension added, existing files are never overwritten), with the root reset to the identity transform, and replaces the selection by a linked instance with the same name and transform. One undo step (the file stays).
* **Place**: drag a `.prefab` into the viewport or the hierarchy. A single-rooted prefab becomes a linked instance; a scene (`.voxscn`) or a multi-rooted prefab is still copied under a holder node.
* Instance roots show the prefab icon in the Hierarchy. The Inspector of an instance (or of any node inside it) shows the prefab, the number of overrides and **Open / Apply / Revert**. Under each component card, the fields you changed are listed as buttons: click one to revert that field to the prefab (undoable).
* **Open prefab** (Hierarchy menu, Inspector header, or double-click the `.prefab` asset): opens the [prefab editor](#the-prefab-editor), a full-screen tool like the model editor.
* **Apply to prefab**: writes the instance's current content into the prefab (the instance keeps its own name and transform) and updates every other instance, which keep their overrides. It is one undo step in the scene: undo restores the previous prefab file, the other instances and the applied instance's own overrides.
* **Revert to prefab**: drops all the overrides of the instance (one undo step). **Unpack**: removes the link and keeps the nodes (one undo step).

## The prefab editor

The prefab editor edits a `.prefab` in isolation. The prefab is its own document: its own scene, selection, undo history and viewport, a small studio with a grid floor and day lighting. **Nothing it does touches the open scene** (nodes, voxels, history, dirty flag) until you save. The scene stays where you left it behind **Back to world**.

* **Tabs**: several prefabs can be open at once; each tab keeps its own camera, selection and undo history, and a tab with unsaved edits asks before it closes (the `x` refuses; Revert drops the edits).
* **Header**: **Save** (Ctrl+S), **Revert** (asks twice), Undo and Redo (Ctrl+Z, Ctrl+Y: the prefab's own history only, never the scene's), the gizmo mode (W move, E rotate, R scale), **Frame** (F selection, Shift+F everything), Back to world.
* **Hierarchy** (left): the prefab's nodes. Click to select (Ctrl+click adds), double-click or F2 renames, drag a row to reorder or reparent (top and bottom edge place it before or after, the middle moves it inside; the node keeps its place in the world), right-click for Duplicate, Add child and Delete (Del). **Add** creates a cube, sphere, sprite, light or empty node, an interact box, a particle emitter, a sound or a script under the selection. A prefab has one root: it cannot be deleted or duplicated, and a second root is refused on save.
* **Viewport** (center): drag on empty space to orbit, right or middle drag to pan, wheel to zoom, double-click a node to frame it, click a node marker to select it. The gizmo moves, rotates or scales the selection (hold Ctrl to snap); one drag is one undo step. Drop an asset from the Content panel to add it at the floor point under the cursor: a voxel model, mesh, PNG (sprite), `.particles.json` (emitter), `.wav` / `.ogg` (spatial looping sound), `.wasm` (script) or another prefab or scene (copied in as plain nodes). A prefab cannot be dropped into itself. A `voxel.group` node shows its box and its blocks (meshed with the block colours of the project); the blocks are only drawn, they are written to the world of whichever scene places the prefab, never to this tool's.
* **Inspector** (right panel): the selected node's transform (the root's transform is not saved: every instance has its own) and component cards with the same field editors as the main Inspector (asset pickers, ranges, colours), Add a component, Reset and Remove in each card's menu.
* **Status line**: how many instances of the prefab are in the open scene, and whether the tab is saved.

**Save** writes the `.prefab` and rebuilds every instance of it in the open scene (also those that contain it through another prefab), keeping their names, transforms and overrides. In the scene this is **one undo step, "Update prefab instances"**, that also holds the file write: Ctrl+Z in the world puts back the previous file and the previous instances, and Redo writes the new one again. A prefab nothing in the open scene uses is just written. A prefab that would contain itself, directly or through other prefabs, or that is not single-rooted, is refused, and nesting is limited to 8 levels. A tab without unsaved edits follows the file when it changes on disk (an undone Apply, git).

* **Previews** (header): the particle button plays or pauses the live preview of the `particle_emitter` nodes (enabled ones only, from their asset or inline params, local or world space, at their place in the prefab; default playing) and the restart button replays it from time zero, with the same particles every time. The speaker button (default off) plays the `audio_source` nodes that have an asset, autoplay and are not muted: spatial sources sit at their node and are heard from the viewport camera (with their min/max distance, rolloff and model; the sound pans and fades as the camera orbits), the others play as plain stereo; they stop when it is switched off, when the tab changes or the tool closes; a looping source repeats, a one-shot plays once per start. Particles with `collide` bounce on the grid floor (y = 0) and on the cells of the `voxel.group` nodes (a rotated or scaled group is tested exactly: the particle's cell box against the blocks in the group's own frame), a spatial source with the Occlusion option is muffled and attenuated like in the game when a `voxel.group` stands between the viewport camera and the node (0.35 per solid cell crossed, fully blocked at three), grass and foliage blocks of a group take the default biome tint, and mesh emitters draw their `.vox`/`.bmodel` model. `voxel.group` blocks draw with their block textures and shapes (slabs, stairs, plants, transparency; flat colours when textures are off). Neither preview touches the prefab file or the open scene.

When a `.prefab` changes on disk (another tool, git, Apply) the open scene's instances are rebuilt in place, keeping their name, transform, position among siblings and overrides. That is not an undo step and marks the scene modified. Opening a scene also refreshes its instances from the current prefab files.

A node inside a prefab that is itself an instance (a campfire inside a camp) is part of the outer instance: edit, apply and revert always work on the outermost link, and the inner one is refreshed through it.

## Variants

A **variant** is a `.prefab` of one node whose `prefab.instance` links a base prefab (a project file, a built-in such as `builtin:player.prefab`, or another variant) with overrides. The engine resolves it as the base plus the overrides, so it follows the base for everything it does not change. Variants nest: a variant of a variant works, up to 8 levels.

* **Create variant**: right-click a prefab in Content (or in the **Engine** folder for a built-in one), or the **Create variant...** button of the `game.mode` player prefab. It writes `<base>_variant.prefab` (next to a project base, in `assets/prefabs` for a built-in one) and opens it in the prefab editor.
* The prefab editor opens a variant expanded (the base's nodes with the overrides applied) and shows a bar under the header: the base, how many fields differ, **Open base**, **Apply to base** and **Revert all**. Each component card lists its overridden fields as buttons; a click reverts that field to the base (undoable in the tab). Save writes the variant back as the diff against its base.
* **Apply to base** writes the variant's content into the base prefab (other users of the base follow) and leaves the variant with no overrides. It is only offered when the base is a project prefab: a built-in base is read-only (a built-in prefab opens for viewing; Save is refused).
* The tab of a variant follows its base when the base is saved and the tab has no unsaved edits.

## A campfire with on and off

1. Model it in the modeler with layers `base`, `logs`, `charred`, `flames`, `embers` and two variants: `off` (base, charred) and `on` (base, logs, flames, embers). See [modeling](modeling.md#layers-and-variants).
2. In a scene, make a node `campfire` with three children: `model` (`render.voxmodel` of the `.bmodel`), `flames` (`particle_emitter`, `builtin:fire`) and `crackle` (`audio_source`, loop, autoplay, spatial).
3. Script panel > New script from a template > **state**, name `campfire`, on the `campfire` node. Props: `{"on": false, "group": "camp"}`. Add an `interact` component on `model` (or on the root) with a box around the fire, e.g. `{"size": [0.5, 0.4, 0.5], "prompt": "Light the fire"}`: the player's right click on it toggles the fire.
4. Hierarchy right-click > **Create prefab...**. Place as many as you like; set `on` to `true` on the instances that start lit (a per-instance override).

The `state` script applies its state when it starts and whenever a message reaches it: every `render.voxmodel` under the node gets the `on_variant` / `off_variant` variant, every `particle_emitter` is enabled or not, every `audio_source` is muted or not. Another script lights them:

```go nocheck
burrowsdk.Publish("state.toggle", []byte("camp")) // every state script whose group is "camp"
burrowsdk.Emit(fire, burrowsdk.BusKind("state.on"), nil) // one node
```

A message without a payload reaches the state scripts whose `group` is empty. Set `no_click` to ignore right clicks.

### Using a node: the `interact` component

A node with `interact` (`size` half extents and `offset` in the node's space, so the box follows its transform; `range`, `prompt`, `disabled`) can be right clicked by the player, before the block behind it. The first person controller sends the journaled `scene_use` command (multiplayer: allowed by the default gate whitelist, 10 per second, the player id forced to the sender); the script runtime delivers a `node.use` event to the nearest script at or above the clicked node, so a script on a prefab root hears clicks on any part. In Go:

```go nocheck
burrowsdk.OnUse(func(self burrowsdk.Entity, ev burrowsdk.UseEvent) { /* ev.Node, ev.Player */ })
```

While a usable node is aimed the HUD shows its prompt (`FrameState.UseNode`, `UsePrompt`) and no block outline. The state is kept in the script's state, so it survives save and load.

## The `prefab.instance` component

The link is a scene component on the instance root, saved in the `.voxscn`:

```json
{ "id": 4, "name": "campfire_north", "components": {
    "transform": { "pos": [12, 3, -4], "rot": [0, 90, 0], "scale": [1, 1, 1] },
    "prefab.instance": {
      "prefab": "assets/prefabs/campfire.prefab",
      "overrides": [
        { "path": "Smoke", "component": "particle_emitter", "fields": { "enabled": false } },
        { "path": "Logic", "component": "script", "fields": { "props": { "on": true } } },
        { "path": "Crackle", "remove": true }
      ] } } }
```

`prefab` is the project-relative path (renaming the file in the Assets panel rewrites it like any other reference). The instance's nodes follow in the file, fully expanded, so **the runtime needs no prefab lookup**: a game loads the scene as usual and the link is only data (the component is registered in the default schema, so every build reads it).

Overrides store only the differences from the prefab, in order:

| key | meaning |
|---|---|
| `path` | node relative to the instance root (`""` = root, `"arm/hand"` = descendant) |
| `component` + `fields` | merge these JSON fields into the component (adds it when absent). A key is a field path: `"intensity"` replaces that top-level field, `"props.on"` sets a nested field (numbers index arrays) and leaves its siblings alone |
| `component` + `drop` | remove the component |
| `remove` | delete the node and its subtree (never the root) |
| `add` | graft a subtree document (`{"version":1,"nodes":[...]}`) as children of the node |
| `rename` | rename the node (a renamed node whose components and descendants are unchanged is one `rename`, not a remove plus an add) |
| `order` | child names of `path` in the wanted order, written when the instance's sibling order differs from the prefab |

The root's name, transform and parent belong to the instance and are never overridden. The editor recomputes the overrides by diffing the instance's nodes against the prefab, field by field (nested objects down to the changed field; arrays are replaced whole), when it saves the scene and before it re-syncs from a changed prefab; the saved list is therefore always current. Limits: `EntityRef` fields inside grafted (`add`) or nested subtrees are not remapped, and a key removed from a nested object replaces that object whole, and one removed at the top level replaces the whole component (a merge cannot unset a key); field names containing a `.` cannot be addressed by a path. Older files whose `fields` hold whole top-level values apply unchanged. In the Inspector, clicking an overridden field path reverts just that path.

## Go API

Package `scene`: `PrefabInstance`, `Override`, `ResolveLinked` (prefab + overrides to an instance document), `DiffOverrides`, `ExpandLinks`, `CheckPrefabCycle`, `SameContent`, `OverriddenFields`, `RevertOverride`. Package `editor/core`: `CreatePrefabFromSelection`, `PlacePrefab`, `PrefabApply`, `PrefabRevert`, `PrefabRevertField`, `PrefabUnpack`, `SyncPrefabInstances`, `PrefabLinkOf`, `RefreshPrefabLinks`, and the prefab editor's workspace: `PrefabWS`, `OpenPrefabDoc`, `ClosePrefabDoc`, `PrefabInstanceCount` and, on a `PrefabDoc`, `Spawn`, `SpawnAsset`, `SpawnPart`, `Delete`, `Duplicate`, `Rename`, `Reparent`, `Reorder`, `SetTransform`, `SetComponent`, `AddComponent`, `RemoveComponent`, `Undo`, `Redo`, `Revert`, `Save`. (`EnterPrefabEdit`, `SavePrefabEdit` and `ExitPrefabEdit`, the older way of swapping the open scene for the prefab, stay as an internal fallback with no UI.)
