# Ironfronts

An authoritative multiplayer strategy game with a native WebGPU client. The repository is an npm-workspace monorepo: `apps/client` is the stable browser entry, `apps/auth-server` owns accounts and sessions, `apps/game-server` owns the single always-running World at War simulation, and `packages/protocol` / `packages/game-core` define the shared boundaries.

## Run locally

Requirements: Node.js 22+ and a current desktop Chrome or Edge release with WebGPU enabled.

```sh
npm install
npm run game:dev
npm run auth:dev
npm run dev
```

Copy `.env.example` to `.env` or export the same variables before starting the processes. Local defaults use client `5173`, auth `3001`, and game `3002`. State is intentionally memory-only: restarting the suite clears accounts, sessions, country assignments, and the game. The client/static host serves the heavy generated world package under `/world`; the game server keeps a local copy only for authoritative simulation and declares the browser-facing package URL and hash during its handshake. Future game versions can select different client/CDN-hosted packages with `WORLD_PUBLIC_URL`. Use `npm run build` for a production build and `npm run check` for workspace type checks plus the complete automated suite.

With the dev server running, `npm run visual-check` launches Chrome through Playwright and writes world, mountain, city, lake-road, and diagnostic captures plus `artifacts/visual-report.json`. On Windows it defaults to a short-lived headed browser because Chrome headless does not reliably expose the hardware WebGPU adapter. Set `IRONFRONTS_BROWSER` to select another Chromium executable or `IRONFRONTS_HEADLESS=true` when a CI GPU adapter is available.

`npm run performance-check` runs a repeatable world/regional, dense-scene, pan, orbit, zoom, and layer-ablation benchmark. It writes `artifacts/performance-report.json` for tooling and `artifacts/performance-report.md` for review. Set `IRONFRONTS_BENCHMARK_MS` and `IRONFRONTS_BENCHMARK_WARMUP_MS` to adjust its measurement and warmup windows.

## Controls

- Left drag: pan
- Mouse wheel: zoom
- Right drag: rotate and tilt
- WASD or arrow keys: pan
- Map overlay island: switch between Political, Diplomacy, Clear, and Balanced views
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

`scripts/build-world.mjs` is the generation entrypoint. Source loading/rasterization, deterministic noise, chunk packing, typed-artifact writing, topography phases, and waterway selection live under `scripts/world/`. `scripts/build-infrastructure.mjs` coordinates direct province-center routing while cache and audit phases live under `scripts/infrastructure/`. Mountain terrain uses a broad regional uplift plus tighter shoulder/core fields, with a 60-unit cap and a strict local slope reconciliation. Movement-path conditioning targets only segments that exceed the 24% dirt-trail grade target, so ordinary routes no longer flatten unrelated mountain terrain. River seating is lower-only and local: both movement-graph and visual-only channels receive a subtle 0.35-unit cut with a short sandy bank fade, without rerouting rivers or imposing a hydrology simulation. Expensive route results are cached under ignored `artifacts/road-cache/`.

The compact `world.json` contains runtime-critical province hover and country catalog data. Population, centers, biome tags, and source terrain IDs live in the lazy `province-details.json` sidecar. Initial owners, political adjacency, and label metrics are compact binary buffers; the mutable province-to-country table lets territory colors and borders change without rebuilding terrain or border geometry. The generated `world-generation-report.json` records topography statistics and every hidden road with its reason, endpoints, ID, and affected source connections. The source `material/` directory remains untouched.

## Rendering

`src/renderer.ts` keeps the stable `WorldRenderer` façade used by the app and browser automation. GPU/fetch helpers, asset loading, political mutation, picking, sampling, pipeline construction, and renderer-owned types are separate runtime modules. Country labels are divided into atlas, topology, projection, and color modules under `src/country-labels/`; each WGSL program lives in `src/shaders/` and remains available through the existing `src/shaders.ts` barrel. Visual and performance checks share browser, error, and report utilities under `scripts/qa/`. Run `npm run check` for TypeScript unused-code checks, `.mjs` linting, dependency-boundary tests, and the unit suite.

Terrain materials blend by gameplay terrain, biome, slope, and macro variation. Forest, plain, hill, mountain, and visual-biome boundaries use a narrow filtered-albedo transition band instead of exposing square categorical texels. A default-on political layer applies a restrained, zoom-aware country tint without replacing terrain detail; a coherent map-space political texture and country-boundary flags are cached, with territory changes patching only affected province rectangles and incident borders. Country names follow the largest connected owned region, are rasterized once into an atlas, and render as one instanced WebGPU batch without a second full-screen composited canvas. Beach sand is restricted to the actual shoreline mask, while low inland regions retain their biome. Forests use five low-poly tree silhouettes with compact light/dark foliage and bark textures; suitable non-arid plains receive a much sparser light-green-only scattering. Forest ground transitions to a cheap canopy-green signal as individual trees fade. A signed-distance bank field smooths ocean, lake, and visual-river edges without blurring narrow channels closed. Visual-only one- and two-texel river channels are expanded to a strategy-readable 7.6-unit minimum in a presentation-only mask, while movement rivers keep their independent 11-unit minimum and graph semantics. Ocean and lake water combines slowly varying directional wave packets, domain-warped wind ripples, broken shoreline foam, Fresnel reflection, and sun sparkle.

The renderer keeps the full-resolution source data but submits only the work visible to the current camera. Terrain uses a GPU visible-chunk indirection list and four skirted grid LODs. Close terrain retains the original tiled materials, while regional and overview distances blend into a faithful 2048-pixel-wide baked albedo with precomputed mipmaps instead of a simplified palette. Terrain lighting reads one precomputed signed normal sample rather than reconstructing a normal from the heightfield per fragment. Tree and building grounding is baked into the albedo alpha as ambient occlusion, replacing geometric contact-shadow draws. Roads and waterways share one packed RGBA navigation texture, reducing texture bindings and duplicate sampling. Generated prop records are ordered into 32×16 spatial chunks, with separate tree-family and building-archetype ranges; camera changes rebuild small visible-instance lists that batch each family/LOD into one draw. Cities retain roofed silhouettes through the regional view instead of switching to a box-only intermediate tier, while their existing far-distance cutoff remains unchanged. Distant prop geometry is never submitted. Horizontal world copies are selected consistently across terrain, props, roads, waterways, and borders. Country label instances and prop/terrain visibility are revision-cached, while hover raycasts run only after pointer or camera changes. F3 reports visible chunk and LOD counts alongside timing and triangle categories. Render resolution remains fixed apart from the existing device-pixel-ratio cap; there is no dynamic-resolution scaling.

Supplied movement rivers use dense five-lane explicit ribbons, while visual-only rivers use a twice-subdivided terrain-aware support mesh rather than the sea-level ocean plane. Both river classes share a subtle two-band flow-aligned shimmer driven by their existing direction and speed data. The visual-river fragment contour samples the linearly filtered source mask, removing whole-texel stair steps, and a guarded inner terrain cut prevents coarse terrain LOD triangles from bridging across either river class. A local lower-only terrain pass seats the surrounding sandy banks before the final road bake, so mountain crossings remain terrain-following valleys instead of holes or submerged water. The two authored canals remain in diagnostics but use the province-zero ocean-water channels directly, avoiding duplicate ribbons or offshore caps.

There is one road type in this milestone: a narrow dirt path. Each unique land-adjacent province pair receives one independent path between its two province centers. There are no infrastructure levels, importance classes, shared corridors, shared stems, gateway roads, plazas, or emitted local city streets. The two-channel strategic road field stores only core and verge coverage. Full-width route audits reject static-water incursions, and every road vertex independently samples the frozen terrain with a small deterministic lift.

Excessive incline is reported as a warning but no longer suppresses a road: steep trails use dense point-by-point terrain draping across hills and mountains. When a physical dirt road is omitted by the water or crossing audit, its logical connection remains visible as a thin floating amber dotted line. These indicators do not enter the road field, reserve clearance, or represent constructed infrastructure.
