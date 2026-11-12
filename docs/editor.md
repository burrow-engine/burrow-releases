# The editor (burrowedit)

```sh
burrow edit                 # in a project directory: opens it (burrowedit -project .)
burrowedit                  # empty document
burrowedit -scene a.voxscn -seed 7 -radius 8
```

![the burrowedit editor: menu bar, context bar, tool bar, viewport, hierarchy, inspector and the assets dock](img/editor-default.png)

## Layout

The window follows the layout of Unity and Unreal style editors:

* **Menu bar** with icons and shortcut text (File, Edit, View, Project, Voxels, Play, Help).
* **Tool bar** below it: the options of the active tool on the left (they take the free width); the play controls (**Play** in the game's orange,
  with a menu for *Play the game* or *Play this scene*, **Simulate** and **Step**; while simulating: a *Simulating* badge with the tick on the
  left, **Pause** / **Resume**, **Step** and **Stop**, and an orange line under the bar); then undo / redo, the **Layout** preset picker and the
  preferences gear.
* **Tool rail** on the left, in captioned groups: *Edit* (Select, Move, Rotate, Scale), *Voxels* (Place, Erase, Paint, Pick), *Shapes* (Box,
  Sphere, Line, Fill), *Terrain* (sculpt, scatter...), *Area* (Region select), and *Frame selection* at the bottom. A one-key shortcut is printed on
  its button; the active tool has an accent bar; every button has a tooltip with its name, a description and its shortcut.
* **Viewport** in the middle with overlay widgets: the view and shading drop-down (Perspective, Top, Bottom, Front, Back, Left, Right, Shaded,
  Wireframe), the axis gizmo (click an axis bubble to snap the camera to that view), the slice chip `Y<=N` (click to turn it off), the
  *Simulating* badge, the gestures of the active tool (bottom left) and a stats chip (bottom right).
  **Grid** (view menu, `Shift+G`, saved in the preferences): a ground grid at the selection's height (else the camera target's) with voxel,
  metre and chunk lines that follow the world's voxel size, fade with distance and hide when too dense, a red X and a blue Z axis line (drawn by the renderer as a depth-tested plane pass, `render.WorldGrid` / `Renderer.SetWorldGrid`, so terrain and models hide it; the CPU renderer has no such pass and the 2D overlay draws the lines instead) and
  metre rulers along the lines through the camera target. It is a screen-space overlay, so terrain does not hide it. Camera speeds, orbit
  limits, the near/far planes and the frame-selection distance are in metres, so they feel the same at every voxel size. Regenerating with another voxel size rescales the camera target and distance by the size ratio so the view stays on the same place in metres (undo rescales back).
* **Right column**: Outliner above Inspector. **Bottom dock**: Content, Console, Profiler and Blocks as tabs. Panel titles are in sentence case
  (*Model settings*); the panel ids used by saved layouts and agent tools keep their old names (`Hierarchy`, `Assets`, `Model Settings`...).
* **Status bar**: state (Ready / Unsaved / PLAYING with an orange tint), chunk and node counts, selection, frame time, snap, scene name,
  and *Agent control* while an agent is attached.

Every panel has a header with a drag grip (drag it onto another panel to re-dock, onto an edge to split) and a kebab menu (Maximize, Close,
Reset layout). Splitters light up on hover and remember their position; panels have a minimum size. The layout is stored as
`layout.json` (versioned: an older or unknown file falls back to the new default and is kept as `layout.v1.json.bak`).

| View menu / key | |
|---|---|
| Layout preset | Default, Voxel editing (bigger viewport, blocks and content below), Scripting / Debug (console, Script and profiler get room), Minimal; also the **Layout** button of the tool bar. The asset editors and world tools (model, texture, animation, particles, graph, game UI, code, character, environment, audio, cameras, levels) are full screen with their own layout, so no preset is needed for them |
| Panels | show / hide any panel (Outliner, Inspector, Content, Console, Profiler, Blocks, Character) |
| Reset layout | back to the default dock |
| Space | full-screen viewport (panels hidden); press again to restore |
| Ctrl+Space | maximize the panel under the pointer; again to restore |
| Ctrl+Tab, Ctrl+Shift+Tab | next / previous tab of the group under the pointer |
| (dock) double-click a tab | maximize the panel; again to restore |
| (dock) middle-click a tab | close the panel (the viewport stays) |

## Panels

* **Outliner**: search field, a type filter (models, meshes, cameras, lights, sprites, scripts, physics, groups) and the object count, a
  NAME / TYPE caption (with the eye and lock of their columns), tree with a per-type icon coloured by kind and the type word on the right, eye and lock toggles (shown on hover and for the selection: the eye, also H / Edit > Toggle visibility, hides the node and its whole subtree in the editor viewport whatever it draws — meshes, voxel models, sprites, lights, voxel groups, prefab instances — without changing the scene, and hidden nodes cannot be picked; they are remembered with the scene in its editor sidecar. The game's own switch for a mesh is the inspector's *Enabled* toggle, `render.mesh.hidden`), inline rename (F2 or
  double click), drag to reparent or reorder, context menu. Empty scenes explain what to do. Above the scene nodes, three fixed rows cover
  what lives in the level without being a node: **World (voxel terrain)** (seed, edited chunks, *World settings...*), **Environment** (weather
  and time of day) and **Block lights (N)**, the light-emitting voxels (torches, lamps) of the edited chunks; pick one to see it in the
  Inspector, double click to frame it, *Remove* to break it. Placed blocks are terrain, not nodes: edit them with the voxel tools.
* **Inspector**: an icon tile, the name field and a faint *type · asset* line, an *Enabled* switch for rendered nodes, a warm *layer* chip
  (or *+ Layer*); *Transform* and every component are cards (caret, icon, name, a one-line summary such as the mesh asset, and a *...* menu); a *Transform* section (X / Y / Z fields with coloured axes, reset arrows, a dash for mixed values
  of a multi selection) and one collapsible section per component. The component menu offers *Reset to defaults*, *Copy values*, *Paste values*
  and *Remove*. Fields come from the component schema through a property grid: ranges become sliders, vec3 becomes three axis fields, colour
  fields get a swatch and picker, texture / mesh / material / module references are asset fields that accept drops from the Content browser, unit
  suffixes (m, kg, deg, s) are inferred from the field name, tooltips come from the schema. A `script` component shows its module and a fault
  banner. *Add a component* (a dashed button under the cards) opens a searchable list. The **Filter properties** field at the top hides every component and field whose name does not contain the text (a component whose name matches keeps all its fields).
* **Character** (View > Panels): model (built-ins and the project's `.vox` assets), 64x64 skin import, scale and held block of the selected node's
  `character` component (or *Create character node*), an orbitable 3D preview drawn by the GPU at the panel's size (right drag orbits, middle drag pans, wheel zooms, F frames) and can turn by itself (**Turntable**), skin **Edit** (opens the skin in the texture editor window) and **New...** (a copy of the default skin saved in the project and opened there), view selector (Orbit, First, Back, Front), walk-speed
  slider, animation list with loop and playback speed. [character.md](character.md)
* **Animation** (View > Panels): timeline with dope sheet and curve editor for `.anim` clips, scrub / preview / play, record mode (property edits
  become keys), key interpolation, events; every edit is undoable. [animation.md](animation.md)
* **Content** (the asset browser): Favorites (*Recent*) and the project's folders with their item counts on the left, clickable breadcrumbs,
  kind chips (All, Models, Textures, Anims, UI, Scenes, Scripts), **New** and **Import**, cards with a coloured kind badge; search, kind filter, thumbnails (with a **Size** slider, 48 to 160 pixels, generated at 128) or table, item count, a progress bar while thumbnails render, and a **folder tree** (toggle with
  the folder button) with a breadcrumb: click a folder to filter, drag assets onto a folder to move them (sidecars follow and path references in
  scenes, prefabs and animations are rewritten). Ctrl+click toggles and Shift+click selects a range; F2 renames, Del deletes, Ctrl+A selects
  all. Delete goes to a project trash: **Edit > Undo Delete Asset** (or the undo button in the header) restores the last delete, also for a
  multi-selection. The **+** button creates a scene, prefab, text file or folder (in the selected folder). Right-click an asset
  for Open, Edit in built-in editor, Open in VS Code, **Find usages**, Reveal in file manager, Rename, Duplicate and Delete; right-click a folder or the
  empty pane for New, Import, Undo delete and Rescan. Drag an asset into the viewport to stamp or place it. Double-click opens scenes, worlds and text files (Script panel).
* **Tools menu** (also in the command palette, category *Tools*): the content-creation editors in one place. **Model editor**
  (submenu: open, New from template, Open in a separate window) and **Texture Editor** (see [modeling.md](modeling.md)), **Animation Editor**
  (panel *Animation*), **Character editor**, **Code editor** (the detach button of its toolbar opens the current
  file in a window of its own), then Particle editor, Weather, Audio, Cameras, Levels and the Game UI editor.
  The asset editors (model, texture, particles, game UI) are docked panels: opening one fills the window with the editor and brings its
  *Settings* panel; **Ctrl+Space** or the back arrow returns to the editor, the **x** closes it (the document stays loaded). Save writes the asset
  path directly. Opening another asset, New, Quit or switching project asks first when the open asset has unsaved changes. Right-click an asset
  > *Open in a separate window* starts the editor in a second process you can move to another screen. The **Window** menu lists the tool windows started from this editor (a window that is already open for an asset is not opened twice) and starts a new one.
  In the Content browser **+ > New voxel model / animation / particle effect** creates the file and
  opens it in its editor; double-clicking a `.bmodel` / `.vox`, a `.png`, `.anim` or `.particles.json` opens it the same way (in its docked editor).
* **Preferences > Rendering**: brightness, saturation and contrast of the viewport look, normal-map strength, specular boost and parallax depth of the block surfaces in the viewport (live, saved with the preferences).
* **Welcome window** (Help > Welcome Window): shown at startup when no project or scene was given: new / open project, recent projects, the tutorial; untick *Show this window at startup* to hide it.
* **Code editor** (Tools > Code editor, full screen like the model editor): a Files column (project text files with a red error count, search, *New script from a template*), open-file tabs with a dirty dot, a status line (Ln/Col, indentation, UTF-8, language, problems), a bottom drawer (Problems, Build output, Script log; a problem row jumps to its file and line) and *Script settings* on the right (Outline of funcs and types, API used, File info, the nodes the script is attached to, *Build on save* and *Open in VS Code*). The header has Save, Undo / Redo (also Ctrl+Z / Ctrl+Y), Build (Ctrl+B), Find, Format and a menu (new files, reload, close, fold, external editor, own window). It is a built-in code editor with tabs, line numbers, syntax colours (Go, GLSL, Lua, JSON, TOML, YAML, INI, Markdown),
  autocompletion (keywords and identifiers of the file; Ctrl+Space; Up/Down, Tab or Enter accept, Esc closes), live syntax errors for Go and JSON
  (red dot in the gutter, underlined line, message in the status bar), a Format button (gofmt / JSON indent), double-click selects a word and
  triple-click a line, a draggable scrollbar, a minimap, block folding (gutter arrows, fold / unfold all), bracket matching, auto-closing brackets and quotes,
  Ctrl+/ comment toggle, Ctrl+Shift+D duplicate line, Ctrl+Shift+K delete line, Alt+Up/Down move lines, auto-indent, Tab / Shift+Tab (also on a multi-line selection), find and replace (Ctrl+F, F3 / Shift+F3), go to line, Ctrl+S, and a
  status bar with line, column and indentation. A file changed on disk (for example saved from VS Code) is reloaded, or a banner offers
  Reload / Keep my version when you have unsaved edits. Opening a file in the external editor saves unsaved panel edits first. Tabs are restored when the project is reopened (Ctrl+PageUp/PageDown switch, with Shift they reorder, Ctrl+W closes; an unsaved tab asks for a second close). **Ctrl+E** (Project > Go to File) fuzzy-opens any project file, **Ctrl+Shift+F** (Project > Search in Project) searches the text of the project, and clicking a console line such as `assets/x.go:12` opens the file at that line. In the Inspector the script module row has *Show in Assets* and *Edit source* buttons, and clicking an asset reference selects it in the Content browser. **Open in VS Code** and **Project in VS Code** (also *Open in ...* in the asset
  right-click menu and Project > Open Project in External Editor) hand the file (at a line) or the whole project to `code`; set another
  editor (`cursor`, `subl {file}:{line}`, ...) in Preferences > External editor, and tick *Open text assets externally* to make
  double-click use it instead of the panel.
* **Console**: monospaced, severity colours and icons, filter, level drop-down, follow toggle, clear button.
* **Profiler**: frame, render CPU, GPU and sim + UI times as cards, a sparkline of the last 120 frames with the 60 fps line, per-pass GPU
  times when the driver provides them, chunk, draw and triangle counts, UI vertices and draws, Go heap and process memory.
* **Blocks**: isometric 3D block icons (`assets/blockicon`: top / left / right faces lit 1.0 / 0.8 / 0.6, real albedo, plains tint for grass and leaves, alpha kept for glass; flat shaded colour when a block has no texture or under `nopp`; generated once on the CPU and cached, so no per-frame cost), search, a favourites star and a *Recent* row; the same palette opens as a popup from the block chip in the
  context bar.

## Tools and shortcuts

| key | action | context bar |
|---|---|---|
| 1 | Select | hint only |
| W / E / R | Move / Rotate / Scale gizmo | Global / Local, Snap toggle and step (m, deg, x) |
| 2 / 3 / 4 | Place / Erase / Paint | Place / Erase / Paint switch, brush size, cube or round brush, X / Y / Z mirror, block chip |
| 5 | Pick (eyedropper) | hint |
| 6 / 7 | Box / Sphere | Hollow, mirror, block chip |
| 8 | Line | brush size, mirror, block chip |
| 9 | Fill | limit, block chip |
| 0 | Region select | copy, cut, paste, rotate, mirror, fill, delete, deselect, region size |
| B / N | Raise / Lower terrain | size, shape, strength, hardness, mirror, block chip, *Options* |
| G / U | Flatten / Smooth | same |
| P | Ramp (drag low point to high point) | size, shape, hardness, block |
| Y / K | Surface paint / Replace | size, shape, strength (layers), hardness, source block |
| X / O | Extrude face / Scatter | size, kind and density (scatter) |
| F | frame selection | |
| T | gizmo Local / Global | |
| Space, Ctrl+Space | full-screen viewport, maximize panel | |
| Ctrl+P | command palette (icons, category chips, recent commands) | |
| F1 | documentation (the page of the panel under the pointer) | |
| Shift+F1 | keyboard cheat sheet | |

Every key can be rebound in the preferences (Keybindings tab) and in `keymap.json`.

## Preferences

The gear in the context bar (or View > Preferences) opens a form. All changes apply live and persist in `prefs.json`.

| setting | values |
|---|---|
| Theme | Dark, Light, High contrast, or a JSON theme dropped into `os.UserConfigDir()/burrow-editor/themes/` (`ui.Theme.JSON` writes one) |
| UI scale | Auto (display content scale), 100, 125, 150, 175, 200, 250, 300 %; Ctrl/Cmd plus, minus and 0 change and reset it ([display scaling](platforms.md)) |
| Density | Compact (22 px rows) or Comfortable (26 px) |
| Font size | 10 to 20 px |
| Reduce motion | turns every animation off |
| Accent colour | seven preset swatches |
| Camera and editing | fly speed, orbit sensitivity, autosave, reparent behaviour |

## Viewport

| action | input |
|---|---|
| orbit / pan / zoom | MMB or Alt+LMB / Shift+MMB / wheel |
| fly | hold RMB + WASD, Q/E down/up, wheel = speed, Shift = boost |
| focus selection | F |
| select | click (voxel raycast + node bounds) |
| gizmo | W move, E rotate, R scale, T local/global, Ctrl snaps while dragging (or the Snap toggle in the context bar) |
| view | click an axis bubble of the gizmo, or use the view drop-down |

## Voxel tools

Keys 1-9, 0 select: select, place, erase, paint, pick (eyedropper), box, sphere, line, fill, region; the terrain tools have their own keys (below).
Every key can be rebound (Keybindings in the preferences) and is shown in the tool's tooltip.

![voxel tools: ramp preview adds voxels in green and removes them in red](img/editor-voxel-tools.png)

Sizes are voxels, with the metres next to them when the world voxel is smaller than a metre (World settings > Voxel size): the brush size shows
`6 vox (1.5 m)`, the region, ghost and Line labels show the box in metres too, the Line preview adds its length between the two clicks, and the
cursor snap items give their step in metres (the one that equals the voxels per metre is marked `1 m`). World settings also shows the voxels per
metre and how many voxels tall the 1.8 m player is.

### The cursor and the preview

Under the pointer the viewport draws the voxel (thin white outline), the targeted face (accent quad) and its normal (arrow). The ghost shows exactly
the voxels the next click would change: **green** = added, **red** = removed, **block colour** = recoloured, with a read-out `+N -M paint K  WxHxD`
and the modifier keys that matter for the tool. A preview bigger than 20 000 voxels shows only its bounds and an estimate; an edit over the cap
(1 048 576 voxels per operation, 4x that per stroke) is refused with the numbers in the message instead of freezing the editor. Nothing happens
without a click: the preview is always visible, the left button is the only action.

| input | effect |
|---|---|
| left drag | a stroke: dabs are interpolated between pointer positions (no gaps) and the whole stroke is **one undo step** |
| Shift | invert: place / erase, raise / lower, fill / empty, extrusion in / out (the preview turns red) |
| Ctrl + click | temporary eyedropper (picks the block under the cursor) |
| wheel | brush size (1..64); Alt + wheel = strength; while dragging a box = its height; Ctrl + wheel always zooms (preference *Wheel resizes the brush*) |
| Alt + drag, MMB, RMB | orbit, pan, fly as usual |

### Terrain tools

| tool | what it does |
|---|---|
| Raise / Lower (B / N) | sculpts columns: the strength is the most one stroke adds or removes at the centre, the hardness sets how much of the radius is applied fully before the smooth fall-off |
| Flatten (G) | levels to the height of the first click; a blue plane labelled `level y=N` shows it |
| Smooth (U) | averages heights with the 8 neighbours, *strength* passes |
| Ramp (P) | drag from a low to a high point: an even slope, as wide as the brush |
| Surface paint (Y) | recolours the top *strength* layers without changing the shape |
| Replace (K) | replaces the source block (or the block under the cursor) by the active block inside the brush |
| Extrude (X) | drag a face along its arrow to push it out or pull it in (brush footprint, or the whole connected face) |
| Scatter (O) | sows trees, bushes, rocks or plants; *density* in percent, deterministic for a given seed, trees keep a spacing, also across the dabs of a stroke |
| Fill (9) | bounded 3D flood fill with a limit and a preview; Shift empties the region |

Brush shapes: cube, sphere, cylinder, cone, disc. Options (the *Options* button of the context bar, or View > Panels > Tool): size, strength, hardness, surface-only
(place only the skin, erase / paint / replace only voxels touching air), mirror X / Y / Z around the origin voxel, **radial symmetry** (2..16 copies around the
vertical axis through the origin), snap of the cursor to a 2 / 4 / 8 / 16 grid (16 = chunk corners), pointer reach, brush **presets** (saved in the preferences, a few
are built in) and the block palette with search, favourites and recent blocks (kept between sessions).

Every edit is a journaled `ApplyVoxels` command, so strokes are deterministic, undoable and replayable; agents reach all of it through `editor_tool_apply`
(`tool` raise, lower, flatten, smooth, ramp, surface, replace, extrude, scatter; `strength`, `hardness`, `surface_only`, `radial`, `seed`, `density`, `kind`, `from`, `level`,
`amount`, `invert`, `dry_run` to get the count and bounds without writing) and `editor_selection_op` `replace`. Old calls work unchanged.

Region selection supports Ctrl+C / Ctrl+X / Ctrl+V, Shift+R rotate and Shift+M mirror, and *replace in selection* (agents: `editor_selection_op replace`).

![lower preview in red](img/editor-terrain-lower.png)
![extrude drag with its preview](img/editor-terrain-extrude.png)
![scatter: trees sown on a platform, next preview](img/editor-terrain-scatter.png)
![tool options popup](img/editor-tool-options.png)

## Files

| | |
|---|---|
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | new / open / save / save as scene (`.voxscn`) |
| World menu | save / load / clear the `.voxworld` overlay |
| Project menu | new project, open `vox.project`, rescan, import assets |
| Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y | undo / redo the focused document (a drag, a stroke or a paste is one step; 1000 steps / 64 MiB each; see [Undo](#undo-one-history-per-document)) |
| Ctrl+D, Delete, H | duplicate, delete, hide mesh |
| Ctrl+P | command palette: fuzzy search over every action |

### Undo: one history per document

Like Blender or Unity, each document has its own undo history, save point and dirty dot.

* **Scene**: nodes, voxels, world, and every tool that edits the scene (animation, character, cameras, levels, environment, audio). Its steps are journaled engine commands, so replay and agents work as before. Stop (after Play) restores the scene history.
* **Model, texture, particle effect, game UI**: one history each, kept while the editor is open. Their steps are not journaled. Closing the editor panel drops its history; loading another asset into the editor is itself a step of that history. Code, shader, material, prefab and block editors keep their own text or draft undo.
* **Which one Ctrl+Z uses**: the full-screen tool, else the panel under the pointer, else the scene. The Undo / Redo buttons of a tool act on that tool's document only; a tool window (own process) has just its document.
* **Dirty and save points**: saving marks the document's history as saved; undoing past that point makes it dirty again, redoing back makes it clean. Saving never creates a step in another history.
* **Across documents**: an operation touching two documents is a step of the document it changes (a model or texture saved in its editor just rewrites the file, the scene and the characters using it pick it up through hot reload; "create prefab from selection" is one scene step). Undo of one document never replays the other.
* **Agents**: `editor_undo` / `editor_redo` take `doc` (`scene` by default, `model`, `texture`, `particles`, `gameui`); edits made with `editor_model` / `editor_texture` are undone with `doc=model` / `doc=texture`.

## Play, Simulate and Stop

**Play** (Ctrl+Shift+P, the toolbar's main button) runs the game as the players will: `burrow run` on the project, in its own
window, with the player, the controller, the HUD, the game UI, the captured mouse, the start level and the saves. The game reads the
files on disk, so Play first saves the scene and every asset editor with unsaved changes (an untitled scene asks for a path). Pressing
the button again (or Stop) closes the game window; a crash shows its last lines in a toast. From a source checkout (`go run
./cmd/burrowedit`) the game is built from the same sources first, so it always matches the editor.

**Game panel.** Play opens the **Game** panel (View > Panels): the editor starts the game with `-debug-listen 127.0.0.1:0` and a random
token in the environment (`BURROW_DEBUG_TOKEN`, never logged), reads the one stdout line `debuglink: listening <addr>` and connects.
The panel then shows the game's live scene tree, the components of the selected node as JSON (refreshed twice a second), the game's
console (filter by level, Follow, Clear) and a stats line (tick, fps, node count, `StateHash`). It is read only. The game only listens
on loopback, refuses a wrong token and bounds every message (a tree is cut at 5000 nodes); it never writes to the simulation, so the
`StateHash` is the same with or without the link. Without Play (or once the game exits) the panel shows "Press Play to run the game".
A game started by hand can serve the same link: `BURROW_DEBUG_TOKEN=<16+ chars> burrowplay -debug-listen 127.0.0.1:0 <project>`.

**Play This Scene** (Ctrl+Shift+Alt+P, or the arrow next to Play) starts the game on the scene open in the editor instead of the
project's start scene (`burrow run <project> -- -scene scenes/x.voxscn`); the scene must be saved inside the project.

**Simulate** (Ctrl+Alt+P, the lightning button) runs scripts and physics inside the editor's viewport to inspect them: the editor
takes a snapshot, runs the simulation and looks through the first active `render.camera` node. **Esc** or Stop restores the snapshot:
the `StateHash` after Stop equals the hash before Simulate, and edits made meanwhile are discarded. Pause and Step one tick are in the
Play menu.

While simulating and the pointer is over the viewport, the keyboard and mouse buttons are routed to the game's input map, so
scripts see the same actions as in `burrowplay` (see [scripting.md](scripting.md)); Esc always stops.

![playing inside the editor](img/editor-play.png)

## Agent control

The editor exposes `editor_*` MCP tools so an AI agent and a human edit the same document:

```sh
burrowedit -headless -agent stdio                    # JSON-RPC lines on stdin/stdout, CPU screenshots, no GPU
burrowedit -headless -agent unix:/tmp/voxed/ed.sock  # unix socket (mode 0600, directory 0700)
burrowedit -agent unix:/tmp/voxed/ed.sock            # windowed: human and agent edit the same document
burrow agent --stdio mygame                          # same as the first line, opening the project
```

File access of the agent is confined to the open project (and `-agent-allow` directories). See [agents.md](agents.md).

Terrain helpers for placing things: `editor_ground_at {x,z,ignore_foliage}` returns the top solid block of a column (plants and liquids are skipped, `stand_y` is where feet go); `editor_find_view {near:[x,z],radius,height,look_at,apply}` finds a high camera position with an unobstructed line of sight to the target and returns position, yaw and pitch (`apply` moves the editor camera); `editor_place_on_ground {node,offset}` snaps a scene node onto the terrain as one undoable step.

## Asset and node pickers in the Inspector

Reference fields use one picker: a field showing the current value that opens a searchable list of the built-in assets and the project's files of the right kind, with icon buttons beside it (open the asset, make a variant). `game.mode` has a player prefab picker (only prefabs holding a `player` component; **Create variant...** makes a variant of the current one and selects it), node pickers for `spawn` and `spawns`, an input map picker, dropdowns for the enums and the respawn and kill plane fields in their own groups. `game.ui` has one picker per slot. Materials, particle effects and sounds (`material_ref`, `particle_emitter.asset`, `audio_source.asset`) use the same picker. See [prefabs](prefabs.md#variants) and [built-in assets](builtin-assets.md).

## Assets: thumbnails, drag into the viewport, hot reload

The Content browser shows a thumbnail grid (List toggles the table): png (scaled), `.vox` (isometric render), `.obj` (lit preview), `.voxscn` / `.prefab`
(top view of the node positions). Thumbnails are generated lazily by at most 2 background workers (queue bounded at 64), are deterministic, and are
cached on disk in `<project>/.burrow-cache/thumbs/<sha256 of kind+content>.png` (directory `0700`); an edited file gets a new key.

Drag an asset into the viewport: `.vox` stamps its voxels (nearest palette colour -> solid block) with a ghost preview on the face under the cursor
(**R** rotates 90 degrees, **Esc** cancels, one undo step) as a **voxel group** node (see below); `.glb` / `.gltf` adds the whole glTF scene (nodes, rigid skin parts, a `.anim` file, see [assets.md](assets.md#gltf-models)); `.obj` creates a MeshInstance node (+ Material from the MTL); `.png` a billboard Sprite;
`.voxscn` / `.prefab` instantiate under a node named after the file at the cursor (one undo step). Mesh, sprite and scene assets are referenced by their
project path; the editor resolves them through the project's `assets.DB` (`render/rworld/dbassets`) behind the procedural assets, so the viewport,
picking and saved scenes agree.

### Voxel groups

A voxel group is a scene node (component `voxel.group`) that owns a set of world voxels: every `.vox` stamp creates one, and
**Voxels > Group Region Blocks** (**Ctrl+G**) turns the blocks of the box selection into one, which is how structures built before groups existed
become objects. Clicking one of its blocks selects the node. Move or turn it with the gizmo or the Transform fields (whole cells; the rotation snaps to
quarter turns about the node corner on any axis, also under a turned parent; scale is ignored), or **Voxels > Rotate voxel group 90°**: the
blocks it covered come back and it is written at the new place. Delete it and what it covered comes back;
Duplicate stacks a copy on it (move the copy away to see both). Edits made inside it with the voxel tools travel with it; a broken block leaves the
group. **Bake** (Inspector, or **Voxels > Bake Voxel Group**) drops the record and leaves the blocks as plain terrain.

The blocks always stay in the world (`.voxworld`), so games, collisions, networking and worlds from earlier releases are unchanged: the component
is only the editor's record (palette by block name, owned cells and covered cells, run-length encoded). Opening a scene never rewrites the world.
A scene that uses `voxel.group` or `layer` needs this release or later to open.

### Layers

**Edit > Layers Panel** opens the Layers tab beside the Outliner. Type a name and press *New layer* (the selection joins it); each row has an eye
(hide in the editor viewport only), a lock (not pickable; the voxels of its voxel groups cannot be changed by the voxel tools), the node count,
*Select*, *Move the selection here*, *Rename* and *Delete* (nodes stay). The Inspector's **Layer** field moves the selection to a layer. A node joins a
layer through the `layer` component, saved in the scene so a team shares it; a child without one inherits its parent's layer. The layer list,
visibility and lock live in the editor sidecar `.<scene>.voxscn.editor` (which also holds the root order), never in the game. A hidden layer's voxel
groups disappear from the viewport too (render-only mask: the world, collisions and the ray-traced lighting still hold the blocks) and the pointer
goes through them.

MCP: `editor_voxel_group` (list, info, create from a box, stamp a `.vox`, bake) and `editor_layers` (list, create, rename, delete, hide, show,
lock, unlock, assign, select).

Hot reload: the project is polled about once a second. Changed textures, meshes and voxel models refresh in the viewport (handle versions bump), `.wasm`
scripts are re-registered and bound scripts re-pinned (journaled `script_module_changed`), every event is logged to the console, and a change of the open
scene file (not our own save) asks "Reload from disk / Keep my version" (the prompt says whether there are unsaved edits).

## World and project settings

Every scene is a world of its own. **Save** (Ctrl+S) writes the scene and its world next to it: `scenes/main.voxscn` keeps its seed, generator and voxel edits (blocks, fine water) in `scenes/main.voxworld`. Opening a scene switches the terrain to its world, and **New scene** starts on the project terrain without edits. The game (`burrow run`) loads the world of its start scene. Older projects kept every edit in `runtime.world` (`world.voxworld`): the default scene still loads it until it is saved with a world of its own.

Dragging a voxel model (`.bmodel`, `.vox`) into the viewport places it as a free object (a node drawing it with `render.voxmodel`; R turns it a quarter); it writes no blocks. To place blocks, use a prefab holding a voxel group.

Double-clicking a compiled script (`.wasm`) opens its Go source (`scripts/<name>/main.go`) in the Script panel, or in the external editor when Preferences > Prefer external editor is on.

**Project > World settings** rebuilds the base terrain with a new seed and generator parameters (heightmap or flat); the voxel edits are kept (re-applied on the
new base) or discarded. The whole operation is a journaled command (`editor_world_regen`) and one undo step that restores the previous terrain and overlay.
Loading a `.voxworld` made with another seed is refused unless you choose **Adopt seed from file** (regenerates the base with the file's seed, then loads
its edits, one undo step; the generator parameters must still match). The load radius applies immediately (**Apply radius**, or with Regenerate; `VoxelWorld.SetRadius`: growing streams the new ring, shrinking unloads chunks beyond radius+2); tick the checkbox to also save it to `vox.project`.
**Project > Project Settings** edits `vox.project` (name, window title/size, radius, fly/walk, start position, texture pack, plugins, input map) with inline
validation errors; nothing is written until the form validates.

## Scene editing

Several nodes can be selected (Ctrl/Shift in the hierarchy or Ctrl+click in the viewport). Editing a transform or a component field in the Inspector applies
only that field to every selected node as one undo step; fields whose values differ are listed as "mixed". Reparenting (drag onto a node) keeps the
**world** transform by default (Preferences: keep local); dropping between rows reorders siblings, and **Alt+Up / Alt+Down** move the selection among its
siblings (journaled as `scene_reorder`). Undo of a delete restores the EntityRefs from outside the subtree that the delete cleared. The hierarchy rows have an eye
(hide the mesh) and a lock (not pickable in the viewport). Roots can be reordered too (drag, Alt+Up / Alt+Down): that order is editor-only and
lives in the hidden `.<scene>.voxscn.editor` sidecar next to the scene, so the `.voxscn` (sorted by name, hashed and replicated) never changes. A scene
without that file lists its roots in creation order.

**View > Slice view** hides everything above a height (slider, Alt+wheel over the viewport, `Y<=N` badge); it is editor-only state, not in the journal.
**Shift+F1** lists the shortcuts from the real binding table; keybindings are remapped in Preferences, checked for conflicts as an `input.Map` and exportable to
`keymap.json` (the same JSON format the game loads).

## Feature windows (View menu)

Weather, Audio, Cameras and Levels are docked panels (Tools menu): they tab with the others and stay open while you work in the viewport, where their
effect shows. Particle editor, the Game UI editor and the model and texture editors are windows of their own. Each one works on
the open project and needs its plugin (a message says when it is missing):

| window | what it does | page |
|---|---|---|
| Weather (panel) | read and set the deterministic weather, day clock and seasons | [weather.md](weather.md) |
| Audio (panel) | mixer buses, mutes, audition of the built-in sounds | [audio.md](audio.md) |
| Particle editor (panel) | edit an effect with a live preview, curves and a gradient | [particles.md](particles.md) |
| Cameras (panel) | list the rigs, switch, shake, live preview | [cameras.md](cameras.md) |
| Game UI editor (panel) | design a `.ui.json` screen visually: outline, canvas, properties, preview values | [game-ui.md](game-ui.md) |
| Levels (panel) | open, save a region as a level, mark spawns and zones | [levels-saves.md](levels-saves.md) |
| Model editor..., Texture editor... | voxel model and pixel-art texture editing | [modeling.md](modeling.md) |

The shader level, anti-aliasing and ray tracing of the viewport follow the `-shaders`, `-aa` and `-rt` flags of `burrowedit` ([render options](reference/render-options.md)); lighting is described in [lighting.md](lighting.md).

## Help

**F1** (or **Help > Documentation**) opens the built-in documentation: guides, [tutorials](tutorials/01-first-project.md) and the reference generated from the code, with search, history and links. With the pointer over a panel it opens that panel's page; every panel header has a **?** button, and hovering a component or field in the Inspector shows its description. **Shift+F1** is the shortcut cheat sheet. See [Reading the docs in the editor](documentation.md).

## Security notes

The in-app file dialog is confined to the project folder; "Browse outside project..." (and the import / open project pickers) ask first in a modal that lists the
path. Agent file writes and reads are fd-based (`openat` with `O_NOFOLLOW` from a root fd, temp file + `renameat`), so a directory swapped for a symlink
between the check and the use cannot make a write land outside the project (tests with a racing goroutine and `FuzzConfineRace`).

## Known gaps

Play routes letters, digits, Space, Shift, Ctrl and mouse buttons only. The streaming load radius can be changed live in World settings.
Details: [editor/README.md](../editor/README.md).
