# Game UI

`gameui` is the UI toolkit of *games* (HUD, menus, inventories, dialogs), distinct from the editor toolkit in `ui`. A screen is data: a
`.ui.json` document built into a retained widget tree. It is **frame domain**; UI input reaches the simulation only through journaled
commands, so replays work. Packages: `gameui` (documents, widgets, layout, focus, themes, localisation, world labels; no engine dependency),
`gameui/uiplug` (the engine plugin) and `render/canvas` (drawing: the Vulkan overlay and the CPU rasterizer share it).

## Quick start

`vox.project`: `"runtime": { "plugins": { "gameui": true } }`. Every `*.ui.json` of the project is loaded (named after the file), or list them:
`"gameui": { "screens": [ { "name": "hud", "path": "ui/hud.ui.json" } ], "locale": "en", "scale": 1 }`. The inbox that carries UI events to the
simulation is simulation state; the plugin is off by default (`runtime.plugins.gameui: true` enables it). `examples/camera_ui_demo` is a complete game (HUD, pause menu, inventory):

```json
{ "version": 1, "theme": "hud", "root": { "type": "stack", "layout": "none", "children": [
    { "type": "panel", "anchor": "top-left", "offset": [8, 8], "layout": "stack_v", "children": [
        { "type": "bar", "bind": "hp", "bind_max": "hp_max", "size": [150, 16], "format": "{v}/{max}" } ] },
    { "type": "grid", "id": "bag", "anchor": "bottom", "columns": 9, "slots": 9, "bind": "hotbar", "action": "inv", "sim": true } ] } }
```

```go nocheck
a.AddPlugin(&uiplug.Plugin{Docs: []uiplug.Doc{{Name: "hud", Path: "ui/hud.ui.json"}}, Read: readProjectFile})
ui := uiplug.Res(c).UI
ui.Values.SetNum("hp", 14)      // frame code binds values directly
ui.Show("pause")                // modal screens take the focus and the input
```

## Documents

A `.ui.json` document: `version` 1, `name`, `theme`, `styles`, `atlases`, `strings`, `locale`, and for screens `modal`, `layer` (draw order),
`hidden` (loaded but not shown), `cancel` (action of the cancel key) and `focus` (id focused when a modal screen opens). `gameui.Decode` rejects
unknown fields, trailing data, unknown types, anchors, themes and styles, and every rejection names the valid choices (`unknown theme color "accnt"
(valid: text, text_dim, …)`, `unknown field "colour" (valid: base, colors, font_size, radius)`, …); limits: 512 KiB, 2048 widgets, depth 16,
512 children per node, strings 4096 bytes, 4096 items, 32 screens, 4096 localisation strings.

| widget | purpose | main fields |
|---|---|---|
| `label` | text; wraps when `size[0]` is set | `text` / `key`, `font_size`, `bold`, `align`, `fg`, `bind` |
| `image` | an icon | `icon`: `builtin:<lucide or g-heart, g-sword, g-shield, g-coin, g-potion, g-block>`, `<atlas>:<n or name>`, a `.png` path (the full builtin icon list is in the `editor_gameui` MCP tool, `state`) |
| `button` | click, Enter, gamepad A | `text` / `key`, `icon`, `action`, `disabled` |
| `bar` | progress | `bind`, `bind_max` or `min`/`max`, `format` (`{v}`, `{max}`, `{pct}`), `fg`; eases toward its value |
| `panel` | background, border, title | `title` / `title_key`, `layout`, `padding` |
| `list` | scrolling rows | `items` or `bind` (item list), `row_height`, `col_widths`; events `select`. An item with `disabled: true` is read-only (dimmed, no hover highlight, no `select` event). `col_widths` (at most 16 widths, in units) aligns columns: a row's text is split at tab characters and each part starts at its column (the last width repeats for extra parts) |
| `grid` | inventory slots | `columns`, `slots`, `slot_size`, `bind`; two clicks make a `move`, a click on the selected slot a `use` |
| `input` | text field | `bind`, `max_len`, `placeholder`; events `change`, `submit`; caret, Home/End/Delete, UTF-8 safe |
| `dialog` | modal box: title, wrapped text, buttons | `title`, `text`, `buttons` [{text, action, sim}] |
| `toggle` | on/off switch (bool) | `bind`, `text` / `key`, `action`; event `change` |
| `slider` | float in a range | `bind`, `min`, `max`, `step` (snap, 0 = continuous), `value`; left/right or drag; event `change` |
| `choice` | cycles `options` with left/right or click | `options`, `bind` (selected index), `action`; event `change` |
| `dropdown` | popup list of `options` opened by click or Enter, index bound | `options`, `bind` (selected index), `action`; event `change` |
| `tabs` | container whose children are the pages, one per `options` title | `options` (titles), `bind` (shown index; local state when unbound); event `change` |
| `separator` | thin line | `fg` (else `panel_border`), `margin` |
| `stack`, `spacer` | transparent container, flexible gap | `layout`, `weight` |

Common fields: `id`, `style` (a named partial node from `styles`), `anchor`, `offset`, `size` (0 = automatic), `margin`, `padding`, `weight`
(share of free main-axis space in a stack), `fg`/`bg`/`border`/`radius`, `hidden`, `bind_visible`, `focusable`, `sim`.

**Extended look** (any widget unless noted): `hover_bg`, `press_bg`, `hover_fg` (buttons, toggles, choices, list and grid cells), `border_width` (0..16),
`opacity` (0..1, widget and children), `bg` + `bg_end` + `gradient` (`vertical` default | `horizontal`), `shadow` {`offset`, `spread`, `blur`, `color`},
`text_shadow` (a color: 1 unit drop shadow under text), `tint` and `fit` (`contain` | `cover` | `stretch`) for images, `hover_scale` (e.g. 1.05 grows the
widget while hovered or focused; 0 = off), `hover_offset` [x,y] (UI units; the widget eases toward that slide while hovered or focused, like
`hover_scale`) and `tooltip`. An `image` with only one of `size[0]`/`size[1]` set (or none) derives the other from the image aspect ratio, and `contain`
letterboxes inside the box. Images larger than 2048 px are downscaled on load. A list item's `icon` (builtin, atlas or .png) is drawn at the row start,
scaled to the row height. Load notices (unknown `builtin:` icon, downscaled or missing image, hot reload) go to `UI.Warnings` / `Loader.Warn`; `gameui.IconNames()` lists the builtin icons. Put the shared ones in `styles` and reference them with `style`:

```json
{ "version": 1, "theme": { "base": "dark", "radius": 8, "colors": { "accent": [255,190,74,255] } },
  "styles": { "btn": { "bg": [52,58,96,255], "bg_end": [40,45,78,255], "hover_bg": [88,98,156,255], "press_bg": [34,38,66,255],
      "border": [120,128,188,255], "border_width": 2, "hover_scale": 1.04, "size": [240,44],
      "shadow": { "offset": [0,3], "blur": 6, "color": [0,0,0,120] }, "text_shadow": [0,0,0,140] } },
  "root": { "type": "stack", "layout": "none", "children": [
    { "type": "panel", "anchor": "center", "layout": "stack_v", "gap": 10, "padding": [24,20,24,20], "children": [
      { "type": "slider", "bind": "vol", "min": 0, "max": 1, "step": 0.05, "tooltip": "Master volume" },
      { "type": "toggle", "bind": "fullscreen", "text": "Fullscreen" },
      { "type": "choice", "bind": "quality", "options": ["Low", "Medium", "High"] },
      { "type": "separator" },
      { "type": "button", "style": "btn", "text": "Apply", "action": "apply" } ] } ] } }
```

**Background image and nine-slice**: `bg_image` fills the widget with an image (a project path or an atlas icon spec). `slice` = `[left, top, right, bottom]`
in texels turns it into a nine-slice: the corners and edges keep their size while the middle stretches, so a frame scales without blurred borders.

```json
{ "type": "panel", "bg_image": "ui/frame.png", "slice": [12, 12, 12, 12], "padding": [20,16,20,16], "layout": "stack_v", "children": [] }
```

**Animation**: `anim` = `{ "kind": ..., "duration": seconds, "delay": seconds, "loop": bool }` plays on one widget. Looping kinds: `pulse` (scale breathing),
`bob` (vertical float), `wiggle` (small rotation). Once-only kinds run when the screen appears: `fade_in`, `slide_up`, `slide_down`, `slide_left`,
`slide_right`; `loop: true` repeats them. `duration` defaults to 0.6 s (max 30), `delay` max 30 s, so a staggered menu just raises the delay per button:

```json
{ "type": "label", "style": "title", "text": "GAME TITLE", "anim": { "kind": "bob" } },
{ "type": "button", "style": "btn", "text": "New game", "action": "play", "anim": { "kind": "fade_in", "delay": 0.0 } },
{ "type": "button", "style": "btn", "text": "Settings", "action": "settings", "anim": { "kind": "fade_in", "delay": 0.12 } },
{ "type": "button", "style": "btn", "text": "Quit", "action": "quit", "anim": { "kind": "slide_up", "duration": 0.4, "delay": 0.24 } }
```

**Tabs and dropdown**: `tabs` shows one child page at a time; `options` are the tab titles, one per child, in order. `dropdown` is a compact choice list:

```json
{ "type": "tabs", "id": "settings_tabs", "options": ["Audio", "Video"], "children": [
  { "type": "stack", "layout": "stack_v", "gap": 10, "children": [
    { "type": "slider", "bind": "vol_master", "min": 0, "max": 1, "step": 0.05, "value": 0.8 } ] },
  { "type": "stack", "layout": "stack_v", "gap": 10, "children": [
    { "type": "dropdown", "bind": "resolution", "options": ["1280x720", "1920x1080"], "size": [200, 32] } ] } ] }
```

**Transitions**: a screen animates with `show` and `hide`, each `{ "kind": ..., "duration": seconds }`; `kind` is `fade`, `slide_up`, `slide_down`,
`slide_left`, `slide_right` or `scale` (empty = none), `duration` 0..3 (default 0.2). Example: `"show": { "kind": "slide_up", "duration": 0.25 }, "hide": { "kind": "fade" }`.

**Layout**: containers use `layout` `none` (children placed by anchor: `top-left` ... `bottom-right`, `center`, `stretch`, plus `offset` and `margin`),
`stack_v`, `stack_h` (`gap`, `align` start/center/end/stretch, `weight`) or `grid` (`columns`). The root fills the **safe area** (`UI.Safe` insets in
pixels). **DPI scaling**: layout is in logical units; the scale is the target height over the theme's `RefHeight` (720) times `UI.Scale`, and fonts are
rasterized at the exact device size, so text stays crisp.

**Themes**: built-ins `dark` (default), `light`, `hud` — pick one with `"theme": "hud"`, or override it with an object:
`"theme": {"base": "dark", "colors": {"accent": [r,g,b,a]}, "font_size": 18, "radius": 4}`. The `colors` keys are the named theme colors
(`gameui.ColorNames()`, also listed by the `editor_gameui` MCP tool, `state`); an unknown key or base is rejected with the valid names:

| name | paints | name | paints |
|---|---|---|---|
| `text` | label and button text | `bar_back` | bar background |
| `text_dim` | dimmed text, placeholder, disabled labels | `bar_fill` | bar fill (healthy) |
| `accent` | the source slot of a grid move | `bar_low` | bar fill when low |
| `panel` | panel, list and dialog background | `danger` | danger text |
| `panel_border` | panel, button, list, bar and slot border | `backdrop` | dimming behind a modal screen |
| `button` | button face | `input_back` | text field background |
| `button_hover` | hovered / focused button face | `slot` | inventory slot |
| `button_press` | pressed button face | `slot_sel` | selected inventory slot |
| `button_disabled` | disabled button face | `focus` | focus ring around the focused widget |

For a retro / pixel look, set `radius` to 0 (square corners) and an earthy palette, e.g.:
`"theme": {"base": "dark", "radius": 0, "colors": {"panel": [41,34,26,245], "panel_border": [14,11,8,255], "button": [96,83,64,255], "button_hover": [114,99,77,255], "button_press": [70,60,46,255], "text": [240,230,200,255], "text_dim": [170,154,122,255], "accent": [126,196,74,255], "focus": [255,212,92,255], "bar_fill": [155,198,73,255]}}`.
(The font stays Inter, rasterized crisp at the device size; there is no built-in bitmap font.)

**Localisation**: `strings` {locale: {key: text}} in the document, or `UI.Loc.Set`. A node's `key` wins over `text`; lookups fall back to the fallback locale
and then to the key itself (a missing translation stays visible). `{name}` in any text expands a bound value. `ui:locale:fr` or `UI.Loc.Locale = "fr"` switches.

**Hot reload**: `gameui.Loader` re-reads four files every 15 frames and compares content hashes; a changed file replaces the screen, keeping focus, scroll,
selection and typed text; a broken save keeps the last good version and the error shows up in `editor_gameui state` (`errors`).

## Input and focus

One set of navigation keys (`gameui.NavKey`) for the keyboard (arrows, WASD, Enter/Space, Escape, Tab, Backspace/Delete/Home/End), a gamepad (D-pad or left
stick, A accept, B/Start cancel, bumpers next/previous; held directions repeat after 0.4 s) and the mouse. Focus moves spatially (the nearest widget in
the pressed direction), Tab cycles in tree order, grids and lists navigate inside themselves first, a hover focuses what is under the pointer, and a modal
screen or `dialog` traps the focus. While a modal screen is open the plugin releases the cursor (`engine.UIPointer`, menu mode: clicks go to the UI and never
recapture the mouse) and removes movement, look and buttons from `app.Input`, so the game does not walk behind a menu. Set `Plugin.NoBlock` to keep them.
Without a window the controller's keys stand in (W/S/A/D, Space, Esc), so scripted runs can drive menus.

**Escape and the pause screen.** `runtime.gameui.pause` (a screen name) makes Escape open that screen when no modal screen is open (the mouse is freed with
it); inside a modal screen Escape runs the screen's `cancel` (`ui:back`) as before. With `pause` set the window never quits on Escape (`Window.SetEscapeQuits(false)`);
without it Escape frees the mouse, then quits on the second press. The default input map has a `pause` action (Escape, gamepad Start) next to `quit`.
A modal screen can carry `"music": "menu"`; `(*uiplug.GameUI).ModalMusic()` returns the top modal's value for the audio layer.

## Values, actions and events

Widgets bind to a `Values` store (numbers, strings, booleans, item lists; at most 1024 keys, strings 1024 bytes, NaN rejected). Frame code sets values
directly; the simulation and scripts push them with `uiplug.Emit(fixedCtx, gameui.Request{...})` or the SDK; the requests travel with `engine.SendFixed`, so a
replay shows the same HUD.

Interactions produce `gameui.Event`s (`click`, `select`, `move`, `use`, `change`, `submit`, `cancel`) with the widget id, the `action`, indexes and a value.
Built-in actions run locally: `ui:show:<screen>`, `ui:hide:<screen>`, `ui:toggle:<screen>`, `ui:back`, `ui:set:<key>=<value>`, `ui:locale:<code>`, `ui:focus:<id>`.
An `action` can hold several actions separated by `;` (`"ui:hide:pause; ui:show:settings"`): they run in order, and each part that is not built in is its own event.
**Events into the simulation**: a widget with `"sim": true` (or an action starting with `sim:`) becomes the journaled command `gameui_event`, applied to a
singleton `gameui.inbox` component (a ring of 32 events, hashed). Fixed systems and scripts read it, so a replay of the journal reproduces the same input:

```go nocheck
evs, last, ok := uiplug.PollInbox(fixedCtx, since) // events with Seq > since
for _, e := range evs { /* e.Widget "bag", e.Kind "move", e.Index -> e.To */ }
```

The demo keeps the inventory in a fixed resource changed only by these events and publishes it back with `OpItems` requests.

**App actions** (frame domain, never journaled; each also reaches `Plugin.Handler`; the host opts in with `Plugin.AllowApp`/`AllowQuit`, they ask the `appctl.Ctl`
resource and end the run, the launcher then acts): `game:quit` / `app:quit`, `app:title`, `net:join:<link>`, `net:host`, `world:play:<slot>`, `world:create`,
`world:delete:<slot>`, `net:server_add`, `net:server_remove:<i>`. Arguments may use `{value}` references (`"world:play:{pick}"`). `world:play` / `world:delete`
without a slot use the selected row of the `worlds` list (`select` event index, else the value `worlds_sel`). `world:create` reads `world_name`, `world_seed`
(empty = random; text is hashed), `world_type` (index or text: flat, normal, empty) and `world_mode` (index or text: survival, creative); the slot is derived from the name.
`net:join` and `net:host` use the value `player_name` when set.

**Data sources** (`Plugin.Worlds`, `Servers`, `Settings`, implemented by the host): the list value `worlds` (rows `name<TAB>mode<TAB>date`, item icon = thumbnail
path) refreshed at start and after a delete; the list value `servers` (rows `name<TAB>link`); and the setting values `fov`, `render_distance`, `vol_master`,
`vol_music`, `vol_sfx`, `vol_ambient`, `vol_ui`, `fullscreen`, `locale` seeded from `SettingsSink.Load` and pushed with `Apply` after each `change` event.

## Sounds

The game UI plays `ui.click` (a button, list row or slot is activated), `ui.hover` (the pointer or keyboard focus enters an
interactive widget; once per enter, at most one every 40 ms; disabled widgets are silent), `ui.open` / `ui.close` (a modal
screen is shown or hidden, once per change and not per frame of its transition), `ui.back` (Escape / the cancel button runs the
screen's `cancel` action; it replaces the close sound) and `ui.error` (a disabled widget is activated, or a `ui:show` /
`ui:hide` action names an unknown screen), `ui.slider` (a slider value changes, rate limited to one every 60 ms while dragging) and `ui.tick` (a choice stepper steps). Non-modal screens (the HUD) are silent on show and hide unless they ask for a sound.
All come from the local player entity in mode `local`, through the sound pack, and obey `player.sounds` overrides and `mute`.

A widget and a screen take an optional `sounds` object (`click`, `hover`, `open`, `close`, `back`, `error`, `slider`, `tick`; a widget's `open` / `close` /
`back` are ignored). A value is a project sound file (`sounds/x.wav`), a pack event name (`step.stone`), or `""` / `"none"` for
silence; absent keeps the default. A widget's value wins over its screen's, which acts as the default of its widgets:

```json
{"version":1,"modal":true,"sounds":{"open":"sounds/menu_open.ogg","hover":"none"},
 "root":{"type":"button","text":"Buy","sounds":{"click":"sounds/coin.ogg","error":"ui.error"}}}
```

## World-space labels

`UI.Labels`: `Set` a persistent nameplate (id, position, text, color, optional bar `(0,1]`) and `Pop` a floating number (damage) that rises and fades over
`Life` seconds. They are projected with the frame's camera (perspective or orthographic), sorted far to near, culled behind the camera and faded beyond
`MaxDist` (64); at most 128 nameplates and 128 popups. Scripts: `UILabel`, `UIPopup`, `UIRemoveLabel`.

## Rendering

The plugin draws into `engine.RenderOverlay` (the hybrid frame's canvas) at the renderer's real size (`engine.RenderExtent`); `UI.Render(w, h, bg)` rasterizes
the same canvas on the CPU (`render/canvas/soft`) for headless tests, the editor preview and MCP screenshots. `gameui/testdata/golden/*.png` are the golden
captures (`go test ./gameui -update` rewrites them; `GAMEUI_SHOTS=dir` also writes copies).

## Scripts and SDK

Module `vox`, ABI additive (`script/ABI.md`): `gameui_cmd` (JSON requests: `set`, `items`, `show`/`hide`/`toggle`, `focus`, `locale`, `label`, `pop`, `remove_label`,
`clear_labels`) and `gameui_poll(since, out, cap)`:

```go nocheck
burrowsdk.UISetNum("hp", 14)
burrowsdk.UISetItems("bag", []burrowsdk.UIItem{{Icon: "builtin:g-sword", Count: 1}})
burrowsdk.UIShow("pause")
evs, last := burrowsdk.UIEvents(since) // journaled events; keep `last` with SaveState
```

A menu screen can hand over to the game scene from a script with `burrowsdk.SceneLoad("scenes/game.voxscn")` (see
[scripting/04-entities-and-scene.md](scripting/04-entities-and-scene.md)): the `default_scene` of `vox.project` can be the menu.

## Editor and agents

**The designer** is a docked full-screen panel (Unreal-style widget editor): Tools > Game UI editor, or a double-click on a `.ui.json` in the Content browser, opens the **Game UI** panel with its **Game UI settings** panel; Save writes the asset directly, Open is the Content browser (content browser). A separate OS window is still available (right-click the asset > "Open in a separate window"; `burrowedit -tool gameui -project <dir> -asset <file>`).
File > New offers **templates** ("Start from": Empty, Main menu, Pause, HUD, Dialog, Inventory, Title screen, Settings, Game over, Loading, Shop, Save slots, Credits, Confirm dialog, Lobby; `gameui.Template` builds them, and they work whatever the
screen ends up being named: the close and resume buttons use the built-in `ui:back`); the library column's template picker swaps the current screen for one.
The header has one **tab per screen** of the project (a click opens it, `+ Screen` starts a new one); the Screen tab lists every screen with its layer,
whether it is modal or pauses the game and how it opens. Library tiles can also be **dragged** onto the canvas: the widget lands in the container under the
pointer, at the drop point in a free layout. Width and height are **Auto** (fit the content), **Fixed** (pixels) or **Fill** (share the free space of the
parent row or column, the weight); margin and padding are edited on a nested box diagram. The Style tab shows the main **colours as cards** (background,
text, border, hover: own colour, the style's, or none), sliders for radius, border, opacity, font size and hover grow, and **Detach** copies a style's look
into the widget. Behaviour builds **several actions** per click (`+ Add an action`). The Screen tab also has a **Data** card (each bound value, where it is
used and a slider to try it) and a **Translations** table (keys x languages, missing ones outlined, a preview language for the canvas).
The docked layout: the **widget library** on the left (tiles grouped as Text and buttons, Layout, Input, with a search; a click adds the widget inside
the selected container or after the selected widget) above the **layers** (the widget tree); the screen in the middle with the selection's size and its
path (screen › parent › widget); **Game UI settings** on the right in four tabs: **Layout** (a 3 x 3 anchor grid plus Stretch, offset, size, margin,
padding, how a container places its children: Free, Column, Row or Grid, then the id, text and data), **Style** (the shared style and how many widgets use
it, then the widget's own look), **Behaviour** (what a click does, chosen as words: show, hide or toggle a screen, close this screen, set a value, change
the language, focus a widget, or send an event to the game, plus visibility and keyboard / gamepad focus) and **Screen** (the screen settings, preview
values, styles, theme, atlases, strings and the file). The **Preview** button (F5) runs the draft as the game would: the
screen takes the pointer and the keys (mouse, arrows, Enter, Tab, typing), keeps focus, scroll and typed text across frames, the last event shows in the status
bar and `Escape` leaves the test. A draft change rebuilds the tested screen (focus and typing survive an unrelated edit only when the tree did not change).
The outline of the screen is on the left (the plus button adds the widget picked next to it, inside the selected container or after the selected widget; arrows
reorder, copy duplicates, the bin deletes; Widget > Group wraps the selection in one panel). Ctrl+click adds a widget to the selection or removes it from there
(the outline and the canvas), a drag on the empty background draws a rubber band that selects what it covers, and a drag of an already-selected widget moves
every selected widget of a free layout at once, as one undo step. Delete, duplicate, move and group all work on the whole selection; the inspector edits the last
one picked. The screen is in the middle, drawn by the game's own renderer at the
device size you pick (1280 x 720, 1920 x 1080, 1024 x 768, 800 x 600, portrait, ultrawide): click a widget to select it, drag it to move it, drag one of the eight
handles to resize it (positions snap to 4 pixels, hold Alt for free movement; arrows nudge by 1, Shift 8). Moving works for children of a free (`none`)
layout, where it edits `offset`; the children of a stack or grid layout are placed by the parent, so change their size, weight or order. The properties of the
selected widget are on the right, grouped as placement, layout, content, data, look and behaviour, with the items of a list or grid and the buttons of a dialog;
the Screen panel has the document settings (name, modal, layer, pause, cancel action, focus, theme, locale). *Preview values* fake the numbers, texts and
lists that bars, labels and lists are bound to, so a health bar shows something while you design (they are not saved). Every edit is an undo step and an
invalid document is refused. Save writes the `.ui.json`, and a running game reloads it. Styles and atlases are edited in the file. MCP tool `editor_gameui`: `state`, `list`, `get`, `validate {doc}` (reason
or layout tree), `save {path, doc}`, `show|hide|toggle {screen}`, `set`, `items`, `focus`, `label`, `preview {doc?, values?, locale?, plain?, width?, height?}` (an
image plus the widget tree).

## Templates

`gameui.TemplateNames` / `gameui.Template(name)` return complete documents sharing one identity (indigo panels, amber accent, `styles` `btn`, `btn_danger`, `card`,
`title`, `head`, `muted`, `row`, `slider`; a `theme` override; `show`/`hide` transitions). Actions are placeholders to rewire (`play`, `settings`, `quit`, `apply`, `buy`,
`confirm`...); closing uses `ui:back`. Bind names (`hp`, `vol_master`, `quality`, `loading`, `tip`, `gold`, `shop`...) are the values your game sets.

| template | content |
|---|---|
| Empty | blank stack |
| Main menu | card with title and Play / Settings / Quit (`fade_in`, staggered) |
| Tabbed menu | modal card, `tabs` (Play / Multiplayer / Help) with `fade_in` buttons, Back |
| Pause | modal, pauses the sim, Resume / Settings / Quit |
| HUD | health and stamina bars, crosshair, hotbar |
| Dialog | bottom dialog with two buttons |
| Inventory | modal 9x3 grid |
| Title screen | gradient background, bobbing title (`bob`), staggered `fade_in` buttons, `hover_scale` |
| Settings | `tabs` (Audio sliders / Video resolution `dropdown`, toggles, quality / Controls sensitivity, invert), language choice, Apply / Back |
| Game over | dark red gradient, score labels, Try again / Main menu |
| Loading | gradient, `{pct}` bar bound to `loading`, tip label bound to `tip` |
| Shop | stock grid, detail panel (name, description, price, Buy), gold counter |
| Save slots | list of slots with Load / Delete / Back |
| Credits | scrolling-free credits block with Back |
| Confirm dialog | modal Cancel / Confirm (danger style) |
| Lobby | the screen of the multiplayer lobby: scrolling player, spectator and settings lists, ready / team / colour / spectate buttons, host start and cancel, countdown, results with placements; its `lobby:*` actions become lobby commands (see [Lobby screen](lobby.md#lobby-screen)) |

## Built-in UI

Every engine UI is a built-in `.ui.json` asset, addressed `builtin:<name>` and listed read-only in the editor's Engine folder (UI): `hud`, `inventory`, `main_menu`, `pause_menu`, `settings`, `lobby`, `title_screen`, `tabbed_menu`, `game_over`, `loading`, `shop`, `save_slots`, `credits`, `confirm_dialog`, `dialog`, `hud_stats` and `bag` (the menus are the Templates below, generated from them and kept equal by a golden test; `hud` and `inventory` are the in-game ones). The scene component `game.ui` chooses which asset implements each slot:

```json
"game.ui": { "hud": "builtin:hud", "inventory": "builtin:inventory", "pause_menu": "ui/my_pause.ui.json", "main_menu": "none" }
```

| Slot | Screen name | Default (no `game.ui`) | Role |
|---|---|---|---|
| `hud` | `game.hud` | `builtin:hud` | crosshair, use hint, text lines, hotbar; shown unless `-nohud` / `runtime.hud=false` / `scene.settings` `hud=false` |
| `inventory` | `game.inventory` | `builtin:inventory` | the creative inventory panel, drawn while the inventory is open |
| `pause_menu` | `game.pause_menu` | `builtin:pause_menu` | opened by Escape (modal, pauses the simulation); `runtime.gameui.pause` wins when set |
| `main_menu`, `settings`, `lobby` | `game.main_menu`, ... | none | loaded hidden, shown by `ui:show:game.main_menu` and the like |

A value of `""` or `"none"` turns a slot off (a component with only some fields set turns the others off; without the component the defaults above apply). With the pause slot off, Escape ends the run as it did before. A project path (`ui/my_hud.ui.json`) replaces the built-in one and hot reloads like any project screen; to start from the engine's version, copy it into the project from the Engine folder and point the slot at the copy. The game UI designer opens a `builtin:` document read-only (edits and Save are refused; Save as a project path writes an editable copy). In the built-in menus the placeholder actions `quit` and `settings` mean: pause menu `quit` goes back to the title (`app:title`), main menu `quit` quits, `settings` shows `game.settings` when that slot is set.

HUD widgets and values (set by the plugin from the player state every frame, read by any screen):

| Widget | Bindings | Draws |
|---|---|---|
| `crosshair` | `size` (arm length), `fg`, `text_shadow`, `border_width` (thickness) | a + at the centre of its rectangle |
| `hotbar` | `bind` item list (icons `block:<id>`), `bind_sel` selected slot, `slots` (9), `slot_size`, `gap`, `bg`, `border`, `fg` (selection frame) | numbered slots with block icons; the selected slot is framed |
| `inventory_view` | `bind_visible` `hud.inventory`; `bg`, `border`, `fg`, `hover_bg` | the creative inventory frame (panel, tabs, grid page, hotbar row, tooltip). The game owns the geometry and the clicks (as before); the widget only draws it |

| Value | Meaning |
|---|---|
| `hud.text` | the debug text lines (`FrameState.HUD`) joined by newlines |
| `hud.use_text` | `Right click: <prompt>` while a usable node is aimed, else empty |
| `hud.hotbar` | 9 items, `Icon` = `block:<id>` (empty slot: no icon) |
| `hud.selected` | selected hotbar slot, 0-based |
| `hud.inventory` | true while the creative inventory is open |

The icon spec `block:<id>` draws the isometric block icon (any `image`, `grid` or `list` item can use it); hosts without block textures (headless runs) draw nothing for it. The renderer keeps drawing only the frame statistics (FPS) itself when the game UI plugin is on; a build without the plugin (`runtime.plugins.gameui=false`) keeps the renderer's own HUD.

### Built-in screens in the designer

A built-in screen (`builtin:hud`, `builtin:inventory`, `builtin:pause_menu`) opens in the designer for viewing only: a banner under the header says so and offers **Copy to project** and **Create variant**, which copy the screen into `assets/ui` and open the copy for editing. The `game.ui` inspector picks each slot from the built-in and project screens (`(none)` turns a slot off), opens a slot in the designer and makes a variant of it. The widget library has a **Game HUD** family: `crosshair`, `hotbar` (slots, slot size, gap, the `hud.hotbar` / `hud.selected` values and colours) and `inventory_view` (the creative inventory frame, shown by `hud.inventory`).

## Budgets and robustness

Hostile documents are rejected by `Decode` (limits above). Per frame the cost is bounded by the widget cap: one layout pass, one hit test, one draw; text wrap is
capped at 64 lines, images at 64 per UI (4 MiB, 2048 px), events at 256 per frame, requests at 128 per frame; extra work is dropped and counted.

## Limits

* Pointer and text input in a live window need the cgo window (`engine.UIPointer`); headless runs use the controller keys or `Plugin.Input`.
* No drag-and-drop (inventory moves are two clicks or keys), no rich text, no right-to-left or complex shaping (Latin, Latin-1 and symbols only), no scrolling
  containers except `list`, animations are limited to bar easing, hover scale and screen transitions.
* Atlases and image icons need project assets; builtin icons are vector (Lucide + `g-*`) and need none.

## Immediate-mode UI from scripts

For free-form menus a script can build widgets in code instead of a `.ui.json` file. The API mirrors Go's `gameui/imui`. It needs `runtime.plugins.gameui`; without it nothing is drawn and widgets return false.

```go nocheck
burrowsdk.Register(burrowsdk.Script{
	OnFrame: func(self burrowsdk.Entity, f burrowsdk.Frame) {
		burrowsdk.IMFrame(func(ui *burrowsdk.IMUI) {
			ui.Window("Pause", func() {
				ui.Button("Resume")
				ui.Slider("Volume", &vol, 0, 1) // vol comes from Props or state, every frame
			})
		})
	},
	OnTick: func(self burrowsdk.Entity, dt float64) {
		evs, last := burrowsdk.UIEvents(since)
		if burrowsdk.IMClicked(evs, "Resume") { /* simulation reacts here */ }
		if v, ok := burrowsdk.IMNumber(evs, "Volume"); ok { /* ... */ }
	},
})
```

- The tree is built in `OnFrame`, every frame. `IMFrame` sends it to the host as one command list (host call `imui_frame`). The host draws every node's list in entity order, on top of the game UI.
- A widget returns the result of the previous frame: `Button` is true for one frame after a click.
- Clicks and edited values reach the simulation as journaled UI events with the action `im:<key>`, read with `UIEvents`, `IMClicked`, `IMValue` and `IMNumber`. Replays see the same input. Events arrive one frame after the click.
- The key of a widget is its label (the id for `ButtonID` and `TextInput`). Equal keys in one frame become `key`, `key#1`, ... in call order.
- The host keeps the value the player edits (`Checkbox`, `Slider`, `TextInput`). The value you pass wins only when it differs from the one you passed the frame before, so keep the real value in the simulation and pass it every frame.
- While a window is open the cursor is free, and the mouse is not passed to the game while it is over the window.
- Limits: 160 commands, 6 nested levels, 32 KiB per frame and node. `OnFrame` runs inside a small gas budget (`Config.FrameGas`): keep the tree small.

### Pause menu

`Modal` is a window that exists only while open. The host keeps the open state (frame domain, not journaled) and flips it when the input-map action `toggleAction` is pressed. While any modal is open the simulation is paused, the cursor is free and the game input is blocked. `OnFrame` keeps running (`Frame.Paused` is true) so the menu stays alive; `OnTick` does not.

```go nocheck
OnFrame: func(self burrowsdk.Entity, f burrowsdk.Frame) {
	burrowsdk.IMFrame(func(ui *burrowsdk.IMUI) {
		ui.Modal("pause", "pause", func() { // key, input-map action that toggles it
			ui.Label("Paused")
			if ui.Button("Resume") {
				ui.Close() // closes the innermost modal at the end of the frame
			}
			ui.Button("Quit to menu") // im:Quit to menu is read in OnTick once ticks resume
		})
	})
},
```

- Keep the `Modal` call in every frame, open or not. A modal the script stops describing is dropped.
- A closed modal costs two commands: `fn` runs only while it is open, from the very frame its action is pressed.
- Buttons inside still emit journaled `im:` events; they are consumed when ticks resume, so call `Close` for anything the simulation must act on.
- Only game UI pauses keep `OnFrame` running. A pause by the editor or a fault stops it.
