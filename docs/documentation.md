# Reading the docs in the editor

The whole documentation ships inside the editor binary, so it works offline and in exported editor builds. Open it with **F1** or **Help > Documentation**.

## The Help window

| area | what it does |
|---|---|
| Sidebar | the pages in five groups (Start here, Tutorials, Guides, Scripting, Reference); the page you are reading unfolds its second-level headings |
| Page | headings, paragraphs, bold, italic and `code` spans, lists, tables, block quotes, images and fenced code blocks |
| Search box | full-text search over every page; results are ranked and the matching words are highlighted in the result and on the page you open |
| Back and forward | **Alt+Left** and **Alt+Right**; each page remembers its scroll position |
| Links | a link to another page or a heading opens it inside the window; an `http` or `https` link opens in your browser |

![the Documentation window with search results for "particle emitter": ranked sections, matching words highlighted](img/help-search.png)

Code blocks have a **Copy** button and a simple colour tint for Go, shell, JSON and TOML. The window follows the dark or light theme of the editor and wraps to its width: resize it freely.

Keys inside the window: **Ctrl+F** focuses the search box, **Enter** opens the best result, **Esc** clears the search, **Page Up**, **Page Down**, **Home** and **End** scroll.

## Contextual help

* **F1** with the pointer over a panel opens the page that explains that panel; over a component title in the Inspector it opens that component in the [component reference](reference/components.md). With nothing under the pointer it opens the index. **Shift+F1** is the shortcut cheat sheet.
* Every panel header has a **?** button that does the same.

![hovering the render.material title in the Inspector shows its description and the F1 hint](img/help-tooltip.png)
* Hover a component title or a field name in the Inspector for its description, field type, range and default. Descriptions come from the schema, then from the doc comments of the Go types, so the tooltip and the reference always agree.

## The generated reference

![a reference page: the components table with fields, types, ranges and defaults](img/help-reference.png)

Eight pages under `docs/reference/` are produced from the code, never edited by hand:

| page | source |
|---|---|
| [components](reference/components.md) | the scene component schema (fields, types, ranges, defaults) and the doc comments of the component types |
| [script API](reference/script-api.md) | the host function table of `script/ABI.md` and the exported functions of `sdk/burrowsdk` |
| [MCP tools](reference/mcp-tools.md) | the tool registry of the editor server (parameters, enums, ranges) |
| [command line](reference/cli.md) | the command table and flag definitions of `burrow`, `burrowplay` and `burrowedit` |
| [project file](reference/project-config.md) | the structs of `assets/project`, including every `runtime.*` section |
| [input actions](reference/input-actions.md) | `input/core.DefaultMap` |
| [blocks](reference/blocks.md) | the block set (`blockset/blocks.json`) |
| [render options](reference/render-options.md) | shader levels, anti-aliasing, upscalers, ray tracing and look presets |

After changing any of those sources run:

```sh
make docs-gen
```

`go test ./docs` fails with the list of stale pages when a committed page no longer matches the code, and also checks that every link, heading anchor and image of every page resolves.

## For AI agents

The same pages are served by two read-only MCP tools, available in every editor mode:

* `editor_docs_search {query, limit}` returns ranked sections: page, heading, anchor, snippet.
* `editor_docs_read {page, anchor}` returns a page, or only the section under one heading, as Markdown. Without arguments it lists every page.

## Writing documentation

* Pages are Markdown files in `docs/`; tutorials live in `docs/tutorials/` and are listed in [the index](README.md). Write original text and keep one idea per page.
* Link with relative paths: `[levels](levels-saves.md#the-level-file)`. An anchor is the heading in lower case with spaces turned into hyphens and punctuation dropped.
* Images go to `docs/img/`. Only `editor-*`, `tut-*` and `help-*` PNGs are embedded in the binary (large renderer galleries stay on disk and show a placeholder in the editor), so name tutorial screenshots `tut-<topic>.png` and keep them small. Produce them with the editor self-test or the soft renderer and look at each one before you commit it.
* Go code blocks in the top-level `docs/*.md` files must compile; mark an illustrative snippet with `go nocheck`.
* Never edit `docs/reference/*.md`.

## Not done yet

The documentation is English only. A French translation (a `docs/fr/` tree and a language switch in the Help window) is future work; the library already treats a page path as its identity, so a second tree fits without changing the renderer.
