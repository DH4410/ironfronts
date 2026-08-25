# Ironfronts renderer

A native WebGPU world renderer built from the static map package in `material/`. This visual milestone includes bounded regional topography, biome materials, oceans and source lakes, the 24 supplied river systems, ocean-water Kiel and Suez canals, terrain-draped roads, road-shaped cities, dynamic country ownership, province and country borders, forests, and diagnostics. Rivers are reconstructed from the authored movement graph and source water topology; bridges, tunnels, units, gameplay, persistence, and servers are intentionally absent.

## Run locally

Requirements: Node.js 22+ and a current desktop Chrome or Edge release with WebGPU enabled.

```sh
npm install
npm run dev
```

`npm run dev` first bakes manifest v11 into `public/world/`, then starts Vite. Use `npm run build` for a production build and `npm test` for generated-data plus Dawn-backed shader validation.

With the dev server running, `npm run visual-check` launches Chrome through Playwright and writes world, mountain, city, lake-road, and diagnostic captures plus `artifacts/visual-report.json`. On Windows it defaults to a short-lived headed browser because Chrome headless does not reliably expose the hardware WebGPU adapter. Set `IRONFRONTS_BROWSER` to select another Chromium executable or `IRONFRONTS_HEADLESS=true` when a CI GPU adapter is available.

`npm run performance-check` runs a repeatable world/regional, dense-scene, pan, orbit, zoom, and layer-ablation benchmark. It writes `artifacts/performance-report.json` for tooling and `artifacts/performance-report.md` for review. Set `IRONFRONTS_BENCHMARK_MS` and `IRONFRONTS_BENCHMARK_WARMUP_MS` to adjust its measurement and warmup windows.

## Controls

- Left drag: pan
- Mouse wheel: zoom
- Right drag: rotate and tilt
- WASD or arrow keys: pan
- C: toggle country colors, political borders, and country labels
- F3: world inspector with terrain, infrastructure, waterway, coastline, and navigation views
- [ / ] while F3 is open: cycle diagnostic views

## Generation pipeline

World generation is staged and deterministic:

1. Rasterize immutable land, lake, and ocean masks.
2. Generate capped continuous topography with broad hill and mountain envelopes.
3. Use direct province-to-province movement paths to shape broad traversable passes.
4. Reconstruct movement and visual river surfaces, lower only the nearby terrain needed to seat those surfaces naturally, and reconcile local terrain slopes.
5. Freeze the final heightfield, then route and drape visible roads onto it; impossible physical roads are hidden and reported without changing logical connectivity.
6. Place visual city layouts, buildings, trees, lamps, fences, and signs after road and river clearances are final.
7. Precompute terrain normals, faithful terrain albedo with baked prop occlusion, and a packed road/waterway navigation field.
8. Package initial province ownership, country colors, province adjacency, and label metrics for the dynamic political overlay.

`scripts/build-world.mjs` orchestrates generation, `scripts/world/topography.mjs` owns the base heightfield, and `scripts/build-infrastructure.mjs` coordinates direct province-center routing, audit, and mesh output. Mountain terrain uses a broad regional uplift plus tighter shoulder/core fields, with a 60-unit cap and a strict local slope reconciliation. Movement-path conditioning targets only segments that exceed the 24% dirt-trail grade target, so ordinary routes no longer flatten unrelated mountain terrain. River seating is lower-only and local: it creates room for the existing authored channels without rerouting rivers or imposing a hydrology simulation. Expensive route results are cached under ignored `artifacts/road-cache/`.

The compact `world.json` contains runtime-critical province hover and country catalog data. Population, centers, biome tags, and source terrain IDs live in the lazy `province-details.json` sidecar. Initial owners, political adjacency, and label metrics are compact binary buffers; the mutable province-to-country table lets territory colors and borders change without rebuilding terrain or border geometry. The generated `world-generation-report.json` records topography statistics and every hidden road with its reason, endpoints, ID, and affected source connections. The source `material/` directory remains untouched.

## Rendering

Terrain materials blend by gameplay terrain, biome, slope, and macro variation. A default-on political layer applies a restrained, zoom-aware country tint without replacing terrain detail; country borders are classified dynamically from neighboring province owners and country names follow the largest connected owned region. Beach sand is restricted to the actual shoreline mask, while low inland regions retain their biome. Forests use five low-poly tree silhouettes with compact light/dark foliage and bark textures; suitable non-arid plains receive a much sparser light-green-only scattering. Forest ground transitions to a cheap canopy-green signal as individual trees fade. A signed-distance bank field smooths ocean, lake, and visual-river edges without blurring narrow channels closed. Visual-only one- and two-texel river channels are expanded to a strategy-readable 7.6-unit minimum in a presentation-only mask, while movement rivers keep their independent 11-unit minimum and graph semantics. Ocean and lake water combines slowly varying directional wave packets, domain-warped wind ripples, broken shoreline foam, Fresnel reflection, and sun sparkle.

The renderer keeps the full-resolution source data but submits only the work visible to the current camera. Terrain uses a GPU visible-chunk indirection list and four skirted grid LODs. Close terrain retains the original tiled materials, while regional and overview distances blend into a faithful 2048-pixel-wide baked albedo with precomputed mipmaps instead of a simplified palette. Terrain lighting reads one precomputed signed normal sample rather than reconstructing a normal from the heightfield per fragment. Tree and building grounding is baked into the albedo alpha as ambient occlusion, replacing geometric contact-shadow draws. Roads and waterways share one packed RGBA navigation texture, reducing texture bindings and duplicate sampling. Generated prop records are ordered into 32×16 spatial chunks, with separate tree-family and building-archetype ranges; camera changes rebuild small visible-instance lists that batch each family/LOD into one draw. Distant prop geometry is never submitted. Horizontal world copies are selected consistently across terrain, props, roads, waterways, and borders. Country label layout and prop/terrain visibility are revision-cached, while hover raycasts run only after pointer or camera changes. F3 reports visible chunk and LOD counts alongside timing and triangle categories. Render resolution remains fixed apart from the existing device-pixel-ratio cap; there is no dynamic-resolution scaling.

Supplied movement rivers remain densely resampled explicit ribbons, while visual-only rivers now receive their own explicit terrain-aware surface mesh rather than relying on the sea-level ocean plane. Both surfaces may climb or descend with the authored channel; a simple visual grade limiter removes near-vertical water ramps without deciding downstream direction. A local lower-only terrain pass seats the surrounding banks around both river classes before the final road bake, so mountain crossings read as valleys/notches instead of razor-thin terrain holes. The two authored canals remain in diagnostics but use the province-zero ocean-water channels directly, avoiding duplicate ribbons or offshore caps.

There is one road type in this milestone: a narrow dirt path. Each unique land-adjacent province pair receives one independent path between its two province centers. There are no infrastructure levels, importance classes, shared corridors, shared stems, gateway roads, plazas, or emitted local city streets. The two-channel strategic road field stores only core and verge coverage. Full-width route audits reject static-water incursions, and every road vertex independently samples the frozen terrain with a small deterministic lift.

Excessive incline is reported as a warning but no longer suppresses a road: steep trails use dense point-by-point terrain draping across hills and mountains. When a physical dirt road is omitted by the water or crossing audit, its logical connection remains visible as a thin floating amber dotted line. These indicators do not enter the road field, reserve clearance, or represent constructed infrastructure.
