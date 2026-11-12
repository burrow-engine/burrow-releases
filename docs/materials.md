# Materials

A material asset (`materials/<name>.material.json`) chooses a shader and sets its parameters and textures. `render.mesh` (`material_ref`) and
`render.voxmodel` reference one; the node's `render.material` component stays as a per-node override merged on top. On a `render.voxmodel` node with no material asset, a `render.material` on the node tints (`base_color`) and lights (`emissive`) that instance.

```json
{
  "shader": "builtin:standard",
  "parent": "materials/base.material.json",
  "params": {"glow": 0.5, "tint": "#ff8800"},
  "textures": {"albedo": "textures/a.png"},
  "base_color": [1, 1, 1, 1],
  "emissive": [0, 0, 0],
  "render": {"alpha": "blend", "alpha_cutoff": 0.5, "double_sided": true, "cast_shadow": true}
}
```

- `shader`: `builtin:standard` (the engine's lit shading, no parameters) or a project `*.shader` (see assets.md, "Shader assets").
- `parent`: another material (project path or `builtin:` name). A child inherits everything and overrides per key: `params` and `textures` merge, each
  `render` field and `base_color`/`emissive`/`shader` replace when set. Chains are limited to 8, cycles are errors.
- `params` values: number, bool, `[x,y,z]` array or `"#rrggbb"` colour string; unknown names, wrong arity and values outside `range(...)` are errors.
- Built-in materials (Engine folder, usable as `builtin:<name>` or as a parent): `standard`, `emissive`, `glass`, `foliage`.
- A file in the older format (`base_color`, `texture`, array `params`, `shader` base path) still loads unchanged.

Go: `shadersys.Resolve(loader, ref)` flattens and maps a material onto `rworld.Material`; `dbassets.Assets.Material` does it for a project.

## Editing

The **material editor** (double-click a `.material.json`, or Tools) lists the project's materials on the left; the body shows the shader and parent,
the shader's parameters (sliders with their `range(...)`, colour pickers, vector fields, toggles), the texture slots and the surface state (base
colour, emissive, alpha mode and cutoff, double sided, casts shadow). A material with a **parent** is a variant: every field it sets is marked, and the
reset arrow of a marked field removes it so the parent's value shows again. Changing the parent checks the chain (cycles and more than 8 parents are
refused). The preview sphere on the right (drag turns it, the wheel zooms, Ctrl+drag turns the sun, a combo picks sphere / cube / plane) is the real
renderer with the material's compiled shader. Edits save 0.6 s after the last change; Undo / Redo (Ctrl+Z / Ctrl+Y; a slider drag is one step) and **Revert** (back to the state when opened) are in the header.

The **shader editor** edits `.shader` files; the **shader graph editor** builds one from nodes and writes the same annotated GLSL. Graph nodes:

- inputs: `uv normal position time view_dir vertex_color sun_dir param_float param_color param_vec4 const_float const_color texture`
- math: `add subtract multiply divide min max power sin cos abs fract floor saturate one_minus smoothstep dot length normalize split_x/y/z/w combine_vec2/vec3`
- colour and texture: `mix fresnel desaturate contrast noise`
- `output`: `albedo`, `emissive`, `alpha`, `normal` (the graph is lit with the sun, shadows and ambient).

A float, colour or vec4 parameter node and a texture node become `@param` / `@texture` lines; unconnected input pins use the constants shown on the node.
**Graph canvas.** The wheel zooms at the pointer (`+` / `-` around the centre, `0` resets, `F` frames the whole graph, `Shift+F` the selection); middle, right or Space + left drag pans. A drag on empty space is a rubber band (Shift / Ctrl adds), Shift / Ctrl click toggles a node, and the selection moves, deletes (`Delete`), copies (`Ctrl+C` / `X` / `V`, new ids, links among the copies kept) and duplicates (`Ctrl+D`) as one undo step each. `Ctrl+G` (or the Group button) frames the selection in a **group**: a titled, coloured frame (title, note and colour in the inspector, resize from the corner) that moves the nodes inside it; it is saved in the graph file (`groups`) and ignored by the generator. A **comment** is a free text box (library entry Comment, palette `comment`): no header, it never moves nodes, its text is edited in the inspector or in place (double-click the box on the canvas and type, `Enter` makes a new line, `Esc` or a click elsewhere ends it; the whole session is one undo step) (stored as a group whose id starts with `comment`). Title, note and comment text edits are one undo step per edit session of a field, and a library entry dragged onto the canvas lands at the drop point (a click still adds it near the view). Right click, double click or `Tab` opens the node search: type a name, `Enter` adds it. A minimap at the bottom right pans the view.

**Saving and leaving.** The shader, shader graph and material editors autosave shortly after the last edit. Back to world (Ctrl+Space), Quit and switching file save a pending edit first and only prompt (Save again / Discard / Cancel) when that save fails; a failed save is not retried until the next edit. Each header has Undo / Redo and **Revert** (the shader editor also uses the text's own undo, Ctrl+Z).

The graph file is plain JSON (`nodes` with `id`, `type`, `x`, `y`, `name`, `const`, `in`; optional `groups` with `id`, `title`, `note`, `x`, `y`, `w`, `h`, `color`); `shadersys.ParseGraph(...).Generate()` returns the shader text.

## Limits

16 floats and 4 textures per material (`shadersys.PerMaterialFloats`, `TexturesSupported`); the extended block is a per-draw dynamic uniform sliced
from one host buffer, up to 4096 custom-shader draws per scene pass (the remaining draws reuse the last slice). Textures of slots 1..3 are sampled with
the repeat sampler. A shader the renderer cannot build keeps the built-in lit shading for that draw (the error is in `Renderer.ShaderError`).
`render/soft` ignores custom shaders.

## Shadows and motion vectors

A material is drawn again in the sun's shadow pass and in the object velocity pass of the temporal anti-aliasing, so a vertex stage that moves vertices
(wind, swell, dissolve) and a fragment stage that discards act there too. The compiler (`shadersys`, `variants.go`) writes the variants beside the pair:
`<base>.shadow.vert.spv`, `<base>.shadow.frag.spv`, `<base>.vel.vert.spv`, `<base>.vel.frag.spv` (an `rworld.ShaderVariants` Assets serves them; a
variant a material does not need is removed on recompile).

- **Shadow vertex**: made when the material has a vertex stage (or is a cut-out). It is the same stage with `S.vp` read as the sun's matrix, so write
  `gl_Position = S.vp * wp;` (or use `BW_VP` in the variant only) and the displaced mesh casts the displaced shadow.
- **Shadow fragment**: made when the fragment stage contains `discard` or the file says `// @shadow cutout`. It runs in the depth-only pass with
  `BW_SHADOW` defined (`sunShadow()` returns 1 there, the pass writes the map) and cuts the shadow where it discards. `// @shadow opaque` keeps the solid
  shadow of a material that discards.
- **Velocity**: the vertex stage runs twice, with the shader clock `F.misc.y` read as the previous frame's time and then the current one (the previous
  model matrix and time reach the variant through the material block), so the vectors include the vertex animation's own motion (wind, swell). Animation
  driven by another clock (`S.qual.w`, `S.wind.w`) is evaluated at the current time in both runs and contributes no motion. The vertex stage must declare `inPos` and write
  `vWorld` (the displaced world position), the fragment stage must write `outColor`, as the templates do.
- A material with neither a custom vertex stage nor a discard keeps the built-in depth-only shadow pipeline; `cast_shadow: false` skips the shadow pass
  altogether. A variant that does not compile is a warning in the compile result and the built-in path serves that material. Pipelines are cached per
  material and version like the colour pipelines.

## Hot reload of pipeline overrides

A change of a project shader override (`shaders.OverrideGeneration`) rebuilds, at the next frame and only for the modules that changed: the classic and
HDR post pipelines (offscreen post states of the editor viewport are recreated), the scene pipelines (custom materials included), the anti-aliasing and
velocity pipelines (TAA, FXAA, SMAA, FSR 1, `post_vel`), the FSR 2 compute passes, the particle, particle trail and mesh particle pipelines, and the ray
tracing compute passes (`render/vulkan/shaderreload.go`, `moduleFamilies`). The device is idle while pipelines are replaced; a pipeline that fails to
build keeps the previous one and logs the error.
