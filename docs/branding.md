# Branding and theme

Burrow's identity is a cyan mascot peeking out of a voxel burrow of grass and dirt blocks, on deep navy, with a bold rounded white wordmark.
Every colour below was measured from the artwork in `assets/brand/` (the most frequent exact value of each colour family), not guessed.

## Palette

| role | hex | use |
|---|---|---|
| Navy | `#0c182a` | logo background, dark panel surface |
| Cyan | `#00a6d6` | brand colour, primary accent, focus ring, selection |
| Grass | `#9bc649` | success / confirm, progress bars in games |
| Dirt | `#955c3a` | warm neutrals: tooltips and their border, secondary surfaces |
| Off-white | `#fdfdfd` | wordmark, text on dark |

The editor and Hub themes derive the rest (all in `ui/theme.go`, one definition used everywhere):

| token | dark | light |
|---|---|---|
| surface0 (window) | `#070c15` | `#e4e9f0` |
| surface1 (panel) | `#0c1420` | `#f4f6f9` |
| surface2 (fields, raised) | `#131d2c` | `#ffffff` |
| surface3 (hover) | `#1b283b` | `#e2e8f0` |
| divider / border | `#24324a` / `#04070d` | `#d2dae5` / `#b4c0d0` |
| border_strong | `#6e819c` | `#66788f` |
| warm / warm_border | `#261d19` / `#4a362a` | `#eee5db` / `#cfbaa4` |
| text / text_dim / text_faint | `#ecf1f8` / `#a7b4c6` / `#7d8ca2` | `#0c182a` / `#445468` / `#56657a` |
| accent / accent_fill / accent_text | `#1fb6e3` / `#00a6d6` / `#07111f` | `#006a8f` / `#006a8f` / `#ffffff` |
| success / warning / error | `#9bc649` / `#f5c242` / `#ff7a7a` | `#336a0f` / `#835200` / `#b51f29` |
| play | `#f08a3c` | `#9e4806` |

`ui/contrast_test.go` computes the WCAG contrast of every pair the chrome draws: body text 4.5:1 on all surfaces, state colours 4.5:1 as text,
accent and strong borders 3:1 as UI components, text on the cyan fill and on selected rows 4.5:1. State is never carried by hue alone: toasts
and badges pair the colour with an icon (info, check, triangle, circle) or a label.

Shape language, as in the app icon: rounded corners everywhere (radius steps 3, 5, 7, 10 px, tabs rounded on top), soft borders, cyan focus rings
and selection, accent underline on the active tab. Typography is Inter (Regular, Medium, SemiBold): 11/12 px small labels, 13 px body, 14 px
panel titles, 16-20 px headings.

## Logo

| file | use |
|---|---|
| `assets/brand/burrow-app-icon.png` | the source of every icon (rounded cyan square, 296 px) |
| `assets/brand/burrow-lockup-dark.png` | mascot + wordmark for dark backgrounds |
| `assets/brand/burrow-lockup-light.png` | the same for light backgrounds |
| `assets/brand/icons/{game,editor,hub}/` | per tool icons, 16 to 1024 px |

* **Clear space**: keep at least the height of the mascot's tunnel opening (about a quarter of the logo height) free on all sides.
* **Minimum sizes**: lockup 120 px wide, mascot alone 16 px (the icons are tuned for 16, 24 and 32 px; tool badges stay readable at 16 px).
* Use the dark lockup on navy or photos darker than `#40485a`, the light one on white or pale surfaces. The icon sits on any background.
* **Do**: keep the proportions, the colours and the transparent surround. **Don't**: recolour, stretch, rotate, add shadows or outlines, put the
  wordmark on a busy or mid-grey background, or redraw the mascot.
* The tool variants (plain game, pencil badge for the editor, grid badge for the Hub) exist so the taskbar tells the windows apart.

The source art is 296 px, so the 512 and 1024 px icons are an enlargement (Catmull-Rom plus a mild unsharp mask) with a rebuilt, analytically
anti-aliased rounded edge: the silhouette is crisp but the interior detail is as soft as an upscale of a 296 px image can be. For a sharp store
listing, redraw or re-export the mascot at high resolution and replace `burrow-app-icon.png`.

## Regenerating the assets

```sh
make brand            # or: go run ./scripts/genbrand [icons|banners]
```

Reads `assets/brand/burrow-app-icon.png` and `burrow-lockup-dark.png`, writes (deterministically) the icon PNGs, `.ico` and `.icns` per tool, the
Linux `hicolor` tree, the banners (`docs/img/banner-readme-1280x320.png`, `assets/brand/social-preview-1280x640.png`, `download-cover-630x500.png`,
`hub-header-1600x320.png`, `hub-header-slim-1600x96.png`), the splash (`splash-960x540.png`) and `hub/ui/header.png`. The banners are drawn by a
small 2D rasteriser in the tool (layered voxel hills, a burrow with the mascot peeking out, the lockup composited on a navy to cyan sky), not by
the engine renderer. The Windows build embeds `burrow-editor.ico` and `burrow-hub.ico` in `BurrowEditor.exe` and `BurrowHub.exe`
(`scripts/lib-dist-windows.sh`). Linux packagers install `assets/brand/hicolor/*/apps/*.png`; macOS bundles can use the `.icns` files.

## Game icon

`burrow new` writes an `icon.png` and `vox.project` carries `"icon": "icon.png"`: a PNG inside the project (square, 256 x 256 or larger is best).
The sandbox/game window uses it at runtime (all sizes are scaled from it), and `burrow build --app` turns it into the macOS bundle icon (a missing, non-PNG or non-square icon falls back to the Burrow icon with a warning).
`burrow icon from art.png --set` makes the square 1024 PNG from any image, writes it as `icon.png` in the project (`-C dir`; `-out` must stay inside it) and sets `"icon"` in `vox.project` in one go. On a Windows host, `burrow build` also gives the exe your icon: it generates a COFF resource object in pure Go (`assets/winres`: PNG-compressed 16/32/48/256 px icon entries, the shared manifest, a VERSIONINFO with the game title), drops it as a `.syso` in `cmd/burrowplay` of the Burrow checkout for the duration of one `go build`, and removes it afterwards. The prebuilt player is not patched (its PE tail carries the archive), so this needs the checkout (`BURROW_ROOT`) and a Go toolchain; without them, with `--burrowplay`, or with an invalid icon, the exe keeps the Burrow icon and a warning says why. Other hosts build the native target only, so there is no Windows exe to brand.

## Customising the theme

Put a `theme.json` in the user config folder (`~/Library/Application Support/burrow-editor/`, `%AppData%\burrow-editor\`, `~/.config/burrow-editor/`)
for every project, and/or next to `vox.project` for one project (applied on top). It is validated (16 KiB cap, unknown keys rejected, colours as
`#rrggbb`), hot reloaded in the editor, and also read by the Hub. Contrast problems are reported in the console but the colours are applied.

```json
{
  "version": 1,
  "colors": { "accent": "#ff8a3d", "accent_fill": "#ff8a3d", "accent_text": "#0c182a" },
  "dark":   { "surface1": "#101820" },
  "light":  { "surface1": "#fbfaf7" }
}
```

* `colors` applies to every variant, `dark` / `light` only to that one (`high-contrast` counts as dark).
* Tokens: `surface0` `surface1` `surface2` `surface3` `border` `divider` `border_strong` `warm` `warm_border` `text` `text_dim` `text_faint`
  `accent` `accent_hover` `accent_fill` `accent_press` `accent_text` `success` `warning` `error` `play` `selection` `tooltip` `tooltip_text`.
* `selection` also accepts `#rrggbbaa`; every other token must be opaque. The 3D viewport is not affected: this is chrome only.
* In-game UIs keep their own theme (`gameui`, base `dark`/`light`/`hud`, see [game-ui.md](game-ui.md)); the defaults follow the same palette.
