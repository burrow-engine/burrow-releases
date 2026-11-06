# Assets

Everything a game loads lives under the directories listed in `asset_dirs` of `vox.project` (default `assets`, `scenes`).

## The database

`assets.DB` scans those directories, gives every file a stable **GUID** stored in a `<file>.vmeta` sidecar (commit these: they keep references valid when
you move or rename files), imports files lazily through typed loaders and tracks dependencies. Handles are typed and reference counted;
a polling watcher drives **hot reload** (the editor and `assets.Plugin` use it; scripts recompile when their `.wasm` changes).

| kind | extensions | notes |
|---|---|---|
| texture | `.png` | decoded with size caps, mip chain |
| voxel model | `.vox` (MagicaVoxel) | read and write |
| mesh | `.obj` (+ `.mtl`) | bounded parser |
| mesh | `.gltf` / `.glb` (glTF 2.0) | bounded parser; node hierarchy, skins, animations, see [glTF models](#gltf-models) |
| scene / prefab | `.voxscn` / `.prefab` | validated against the component schema |
| world | `.voxworld` | terrain overlay, see [concepts.md](concepts.md) |
| font | `.ttf` | rasterised with `golang.org/x/image`; a Go font is embedded |
| audio | `.wav` | parser only |
| script | `.wasm` | loaded through the script runtime |
| animation | `.anim` | JSON clips and state machines (`format` `burrow.anim`, versioned), bounded and validated; hot reload replaces the clips of that file, see [animation.md](animation.md) |

Every importer is pure and bounded: corrupt input is an error, never a panic.

## Commands

```sh
burrow assets list  [dir]        # JSON: every asset, importer, dependencies
burrow assets check [dir]        # dry-run import of everything; exit 1 on problems
burrow assets import [dir]       # assign GUIDs (writes .vmeta) and import
burrow assets atlas dir -o atlas.png -json atlas.json -gutter 1 -max 2048   # pack every PNG below dir
```

These wrap `burrowasset`. Atlas packing is deterministic (sorted inputs, power-of-two size).

## In a running game

`burrowplay` scans the project with a dry-run database (it never writes sidecars into your project) and registers every PNG under `asset_dirs` with the renderer
under its project path, so `{"render.material": {"texture": "assets/tex/brick.png"}}` works; the builtin meshes are `cube`, `sphere` and `plane`.
Scripts are resolved by project path. In `burrowplay` (windowed, headless and from a `.voxpak`) the renderer's asset resolver is layered:
the builtin meshes and project PNGs first (`rworld.MemAssets`), then every other project file through the `assets.DB` (`.obj` meshes,
`.vox` models, material JSON, `<ref>.vert.spv`/`.frag.spv` shader pairs) via `engine.LayeredAssets` and `rworld/dbassets`. Library users
wire the same with `engine.RenderWorldPlugin{Assets: &engine.LayeredAssets{Primary: mem, Lazy: ...}}`. The `models` template shows an `.obj`,
a `.vox` and a sprite.

## glTF models

`.glb` and `.gltf` files (Blender, other DCC tools) import as one document: scenes and nodes (TRS or matrix), meshes with several primitives
(`POSITION`, `NORMAL`, `TEXCOORD_0`, `COLOR_0`, indices of any component type, triangles, strips and fans), materials (`baseColorFactor`,
`baseColorTexture`, emissive, alpha mode), skins and animations (translation, rotation, scale; `LINEAR`, `STEP`, and `CUBICSPLINE` read as its
values without tangents). A `.gltf` may use base64 data URIs and `.bin` / image files in its own directory (never outside it, no `..`); copy the
`.bin` into the project next to the `.gltf`. Files are untrusted: size, counts, accessor ranges, strides and indices are bounded and corrupt input is an
error, never a panic. Sparse accessors, morph targets, cameras, lights and KHR extensions are ignored or refused.

A `render.mesh` ref names the file and optionally a mesh (index or name) and a rigid part:

```
assets/robot.glb            the first mesh, all primitives merged
assets/robot.glb#2          mesh 2
assets/robot.glb#Body       the mesh named "Body"
assets/robot.glb#Body:5     the rigid part of joint node 5 of that skinned mesh
```

Vertex colours are kept; the material comes from the node's `render.material` (a mesh with several materials gets its first one when imported as a scene).
Hot reload works like for `.obj`.

**Skinning is rigid, not smooth.** The renderer has no GPU vertex skinning. Every triangle of a skinned mesh follows the one joint with the
largest summed vertex weight, and that joint's scene node draws its triangles (expressed in the joint's local space). Animations move the joints, so
the parts move as solid pieces; there is no blending between joints, so bends show seams. Smooth deformation, morph targets and
animated weights are not supported.

**Import into a scene.** In the editor, right-click a `.glb` / `.gltf` in the Content browser and choose *Add glTF scene*, or drag it into the viewport
(Project > Import File... accepts `.glb`, `.gltf` and `.bin`). `Editor.ImportGLTFScene(path, parent)` (package `editor/core`) does it as one undo step: a
root node named after the file with one child node per glTF node (same hierarchy and rest transforms; 1 metre is 1 scene unit, scale the root to fit),
`render.mesh` + `render.material` on the nodes that draw something, and an `anim.player` on the root. The animations are written to `<file>.anim` next to
the asset (clips named like the glTF animations, tracks `transform.pos|rot|scale` on node paths below the root) and open in the animation
editor like any `.anim`. Embedded textures are saved next to the file as `<file>_tex<N>.png|jpg`. Existing files are never overwritten.

## Custom shaders

`burrowshader -write-include ./shaders` writes the `scene3d.glsl` interface; `burrowshader -I ./shaders my.vert my.frag` compiles (with a `glslc`
on the PATH, else with the compiler built into Burrow: nothing to install) and `burrowshader -pair my` verifies the pair. A material references it as `"shader": "dir/my"`.

### Shader assets (`.shader`)

A project shader is one text file, `shaders/<name>.shader`: parameter annotations in comments plus `#stage vertex|fragment` sections of GLSL.
The editor compiles it (glslc on the PATH when there is one, else the built-in compiler) whenever it is saved and writes `<name>.vert.spv` / `<name>.frag.spv` next to it (these are what a game
loads and `burrow build` packs, and `burrow build` compiles every `.shader` of the project first and fails with `file:line` diagnostics; games never compile). A material without a `#stage vertex` section reuses the built-in `mesh.vert`.

```glsl
// @kind material
// @param float glow = 0.25 range(0,1) "Glow"
// @param color tint = #ffffff
// @texture albedo "Albedo"
#stage fragment
layout(location = 0) in vec3 vWorld;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec2 vUV;
layout(location = 3) in vec4 vColor;
layout(location = 0) out vec4 outColor;
void main() {
    vec4 c = pc.base * vColor * texture(tex_albedo, vUV);
    outColor = vec4(c.rgb * param_tint + vec3(param_glow), c.a);
}
```

Do not write `#version` or include `scene3d.glsl` in a material: both are added, with one `param_<name>` define per parameter and `tex_<name>` per
texture, and `BW_OUT(rgb, a)`, which writes a colour the way the target wants it (linear for sRGB / HDR targets). Parameter types: `float int bool
vec2 vec3 vec4 color color4`; they pack in order into a 16-float block (vec3/vec4 never cross a 4-float row). The renderer uploads all 16 floats and
binds up to 4 textures per material: floats 0..3 are the push-constant `pc.params`, floats 4..15 a per-draw dynamic uniform block
(`layout(set = 3, binding = 3)`), texture slot 0 is `uTex` (set 1) and slots 1..3 are set 3 bindings 0..2 (a white image where the material sets none).
Compile errors show as `file:line`; the SPIR-V is then checked (reflection) against the Scene3D interface of the kind.

### The compiler

Shaders compile with **glslc** when one is on the PATH (`$BURROW_GLSLC`, the PATH, a cached download), else with **glslang built for WebAssembly and
embedded in the editor and `burrow`** (`shadersys/glslang`, run with wazero): offline, no install, every platform. Both produce the same interface
(SPIR-V 1.0 for Vulkan 1.0, optimised). `make glslang-wasm` rebuilds the module reproducibly (wasi-sdk and glslang at pinned versions, checksum in
`glslang.wasm.sha256`, checked by a test). `BURROW_GLSLC_URL` + `BURROW_GLSLC_SHA256` still download a glslc into the cache; `BURROW_OFFLINE` forbids it.

### Tools

The editor has three full-screen tools (Content panel: double-click, or Tools): the **shader editor** (`.shader`: code with GLSL highlighting, compile
on idle, gutter marks and a clickable problem list, live preview, parameters from the annotations, built-in modules read-only with *Override in
project*, templates unlit / lit_standard / toon / dissolve), the **shader graph** (`.shadergraph.json`: nodes to GLSL, *Convert to code*) and the
**material editor** (`.material.json`). See [materials.md](materials.md).

### Overriding a built-in pipeline shader

Every built-in vertex/fragment module is listed read-only in the Engine folder as `builtin:<module>` (for example `builtin:mesh.frag`) with its
GLSL source. Copy it to `shaders/override/<module>.shader` (keep its `// @kind pipeline:<module>` header), edit, save: it compiles to
`shaders/override/<module>.spv`. At load (and on hot reload) the engine reflects the override and compares it with the built-in: same stage and
entry, only the built-in's inputs, the same outputs, only the built-in's descriptors, no larger push block. A mismatch, a compile failure or a driver
rejection logs the reason and keeps the built-in. Includes (`common.glsl`, `water.glsl`...) resolve to the engine's own files.
