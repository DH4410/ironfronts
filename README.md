# Ironfronts renderer

A native WebGPU world renderer built from the static map package in `material/`. This visual milestone includes bounded regional topography, biome materials, oceans and source lakes, the 24 supplied river systems, ocean-water Kiel and Suez canals, terrain-draped roads, road-shaped cities, province borders, forests, and diagnostics. Rivers are reconstructed from the authored movement graph and source water topology; bridges, tunnels, ownership, units, gameplay, persistence, and servers are intentionally absent.

## Run locally

Requirements: Node.js 22+ and a current desktop Chrome or Edge release with WebGPU enabled.

```sh
npm install
npm run dev
```

`npm run dev` first bakes manifest v10 into `public/world/`, then starts Vite. Use `npm run build` for a production build and `npm test` for generated-data plus Dawn-backed shader validation.

With the dev server running, `npm run visual-check` launches Chrome through Playwright and writes world, mountain, city, lake-road, and diagnostic captures plus `artifacts/visual-report.json`. On Windows it defaults to a short-lived headed browser because Chrome headless does not reliably expose the hardware WebGPU adapter. Set `IRONFRONTS_BROWSER` to select another Chromium executable or `IRONFRONTS_HEADLESS=true` when a CI GPU adapter is available.

## Controls

- Left drag: pan
- Mouse wheel: zoom
- Right drag: rotate and tilt
- WASD or arrow keys: pan
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

`scripts/build-world.mjs` orchestrates generation, `scripts/world/topography.mjs` owns the base heightfield, and `scripts/build-infrastructure.mjs` coordinates direct province-center routing, audit, and mesh output. Mountain terrain uses a broad regional uplift plus tighter shoulder/core fields, with a 60-unit cap and a strict local slope reconciliation. Movement-path conditioning targets only segments that exceed the 24% dirt-trail grade target, so ordinary routes no longer flatten unrelated mountain terrain. River seating is lower-only and local: it creates room for the existing authored channels without rerouting rivers or imposing a hydrology simulation. Expensive route results are cached under ignored `artifacts/road-cache/`.

The compact `world.json` contains only runtime-critical province hover data. Population, centers, biome tags, and source terrain IDs live in the lazy `province-details.json` sidecar. The generated `world-generation-report.json` records topography statistics and every hidden road with its reason, endpoints, ID, and affected source connections. The source `material/` directory remains untouched.

## Rendering

Terrain materials blend by gameplay terrain, biome, slope, and macro variation. Beach sand is restricted to the actual shoreline mask, while low inland regions retain their biome. Forest ground transitions to a cheap canopy-green signal as individual trees fade. A signed-distance bank field smooths ocean, lake, and visual-river edges without blurring narrow channels closed. Visual-only one- and two-texel river channels are expanded to a strategy-readable 7.6-unit minimum in a presentation-only mask, while movement rivers keep their independent 11-unit minimum and graph semantics. Ocean and lake water combines slowly varying directional wave packets, domain-warped wind ripples, broken shoreline foam, Fresnel reflection, and sun sparkle.

Supplied movement rivers remain densely resampled explicit ribbons, while visual-only rivers now receive their own explicit terrain-aware surface mesh rather than relying on the sea-level ocean plane. Both surfaces may climb or descend with the authored channel; a simple visual grade limiter removes near-vertical water ramps without deciding downstream direction. A local lower-only terrain pass seats the surrounding banks around both river classes before the final road bake, so mountain crossings read as valleys/notches instead of razor-thin terrain holes. The two authored canals remain in diagnostics but use the province-zero ocean-water channels directly, avoiding duplicate ribbons or offshore caps.

There is one road type in this milestone: a narrow dirt path. Each unique land-adjacent province pair receives one independent path between its two province centers. There are no infrastructure levels, importance classes, shared corridors, shared stems, gateway roads, plazas, or emitted local city streets. The two-channel strategic road field stores only core and verge coverage. Full-width route audits reject static-water incursions, and every road vertex independently samples the frozen terrain with a small deterministic lift.

Excessive incline is reported as a warning but no longer suppresses a road: steep trails use dense point-by-point terrain draping across hills and mountains. When a physical dirt road is omitted by the water or crossing audit, its logical connection remains visible as a thin floating amber dotted line. These indicators do not enter the road field, reserve clearance, or represent constructed infrastructure.
