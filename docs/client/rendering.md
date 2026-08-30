# WebGPU Rendering

`WorldRenderer` is the stable renderer facade. It owns WebGPU initialization, world assets, GPU resources, camera/picking, visibility caches, map presentation, diagnostics, and per-frame submission. Game/UI code interacts through methods and callbacks rather than reading internal GPU state.

## Initialization

Initialization reports staged progress and performs:

1. Fetch and index `world.json`.
2. Configure wrapped world/camera bounds and minimum terrain-clearing altitude.
3. Request a high-performance adapter, then default/fallback adapters if needed.
4. Request `timestamp-query` only when supported and create performance query buffers.
5. Fetch required binary world fields/meshes/instances in parallel.
6. Reconstruct CPU sampling fields and deterministic resource-node positions.
7. Optionally fetch the lazy movement graph and province details for diagnostics/settlement clearance.
8. Build mutable political caches from province ownership/country colors.
9. Upload terrain, surface, normals, baked albedo, navigation, coast, province, and political textures.
10. Build material textures, layouts, bind groups, pipelines, terrain/water LOD meshes, and prop meshes.
11. Upload chunked instance layers and dynamic marker buffers.
12. Build the country-label atlas/layer.
13. Attach runtime bindings, size the canvas, and make the renderer ready.

The world descriptor comes from the authenticated game handshake. `configureWorldAssetBase` switches every manifest/artifact fetch to that declared static package.

## World representation

The generated package provides two main raster scales:

- 4096-wide province/navigation/coast fields for picking and sharp strategic features.
- 2048-wide height/surface/normal/albedo fields for terrain presentation.

World X wraps. Terrain, props, roads, waterways, borders, markers, picking, labels, and camera normalization select consistent horizontal copies.

The renderer keeps CPU copies of height/province data for sampling and uses immutable generated meshes/instance records for static presentation. Province ownership is mutable and patches political color/cache regions without rebuilding terrain.

## Frame pipeline

Each animation frame updates camera/environment, resizes as needed, refreshes visibility only when relevant revisions change, writes shared uniforms, and submits one render pass. Major draw categories include:

- polar caps and ocean;
- visible terrain chunks at one of four LODs;
- rivers/canals and direct dirt roads;
- dotted logical links whose physical road was suppressed;
- chunk-filtered trees, buildings, and road furniture;
- borders and optional diagnostic graph lines;
- strategic resource markers;
- army models and shared counters/health markers;
- country labels;
- night city lights and procedural rain.

WGSL programs live in focused modules under `src/shaders`. Pipeline construction is centralized in `renderer-pipelines.ts`, and frame attachment creation is isolated in `renderer-frame.ts`.

## Terrain and materials

Terrain uses generated height, categorical surface, signed normal, packed navigation, coast/bank, and baked sRGB albedo textures. Close views retain material/relief detail; regional views use the precomputed terrain albedo/mips. Albedo alpha carries baked prop contact occlusion.

Four skirted terrain-grid resolutions reduce geometry with distance. Chunk visibility supplies GPU indirection records rather than issuing the whole world. Water uses separate LOD meshes and generated bank fields for coast/river transitions.

## Props and infrastructure

Trees use broadleaf/conifer families with three mesh LODs. Buildings use five archetypes with two LODs. Lamps, barriers, and signs are distinct furniture layers.

Generated instance records are spatially chunked. Camera changes rebuild compact visible-index buffers; unchanged views reuse cached GPU buffers/draw lists. Quality presets cap trees/buildings and alter prop/terrain distances. Roads and waterways use indexed generated meshes and one packed navigation texture.

## Politics and labels

Map modes are `political`, `diplomacy`, `clear`, and `balanced`. A political cache maps province pixels to country colors and tracks incident borders. Authoritative ownership changes patch only affected province regions.

Country labels use their own canvas-backed atlas preparation and a WebGPU instanced draw. Topology/layout chooses the largest connected owned region and valid land positions, while projection/color modules keep responsibilities separated. Label visibility is cached and disabled with political overlays/debug views as appropriate.

## Armies and resources

Static generator-derived deposits are used for CPU sampling, but player-visible resource markers come from the fog-filtered game projection through `setGameResourceMarkers`.

Army uploads use dynamic typed-array buffers for:

- at most four 3D unit-category models per army;
- one shared map counter/health/selection marker;
- fog/contact styling;
- selected-artillery range presentation and targeting highlights.

The client orchestration determines visual slot allocation; the renderer only consumes the resulting records.

## Picking and interaction

Camera screen rays and terrain/province sampling drive hover and selection. Hover work is revision-gated so it reruns only after pointer/camera changes. The renderer exposes callbacks for hover, province selection, raw map clicks, diplomacy presentation, frame stats, and time-of-day changes.

Camera behavior includes wrapped horizontal pan, bounded vertical pan, cursor-anchored wheel zoom, mouse orbit/tilt, touch pan/pinch, and keyboard movement. Minimum altitude accounts for generated maximum terrain height.

## Graphics presets

Backing scale is absolute relative to CSS pixels—not multiplied by device pixel ratio—and is clamped to `0.5..1.5`.

| Preset | Render scale | Prop distance | Trees | Buildings | Furniture | Terrain LOD | Rain | Shader detail |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| Low | 0.75 | 0.45 | 9,000 | 6,000 | Off | 0.85 | 0.35 | 0.12 |
| Medium | 1.0 | 0.70 | 22,000 | 14,000 | Off | 0.82 | 0.60 | 0.40 |
| High | 1.25 | 1.0 | 60,000 | 40,000 | On | 1.0 | 1.0 | 0.75 |
| Ultra | 1.5 | 1.25 | 400,000 | 400,000 | On | 1.18 | 1.0 | 1.0 |

Changing quality updates render scale, budgets, distances, furniture, rain count, and shader detail without changing authoritative state.

## Diagnostics and performance

The inspector exposes beauty, elevation, terrain class, province ID, normal, slope, river corridor, land/coast, road footprint, and navigation composite views. Lazy connection and waterway-network line buffers load only when requested.

`PerformanceMonitor` records frame interval, main-thread phases, workload counts, and optional GPU timestamp samples. The automation API is exposed as `window.__ironfrontsRenderer` only in development or debug/benchmark mode.

`npm run visual-check` captures deterministic showcase/debug views and writes `artifacts/visual-report.json`. `npm run performance-check` measures overview, urban, weather, movement, zoom, and layer-ablation scenarios and writes JSON/Markdown reports. See [Development and QA](../development.md).

## Resource lifecycle

`start` attaches runtime input and begins `requestAnimationFrame`; `stop` cancels it. `dispose` is terminal: it stops rendering, aborts interaction, clears callbacks/caches, removes GPU error listeners, destroys owned resources where implemented, and prevents reinitialization. Non-bfcache navigation invokes disposal.

Device loss is logged. If it occurs during active rendering, the page reloads to reconstruct the full device/resource graph.
