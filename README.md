# Ironfronts renderer

A native WebGPU world renderer built from the static map package in `material/`. This visual milestone includes bounded regional topography, biome materials, oceans and source lakes, the 24 supplied river systems, ocean-water Kiel and Suez canals, terrain-draped roads, road-shaped cities, province borders, forests, and diagnostics. Rivers are static surfaces reconstructed from the authored movement graph; bridges, tunnels, ownership, units, gameplay, persistence, and servers are intentionally absent.

## Run locally

Requirements: Node.js 22+ and a current desktop Chrome or Edge release with WebGPU enabled.

```sh
npm install
npm run dev
```

`npm run dev` first bakes manifest v6 into `public/world/`, then starts Vite. Use `npm run build` for a production build and `npm test` for generated-data plus Dawn-backed shader validation.

With the dev server running, `npm run visual-check` launches Chrome through Playwright and writes world, mountain, city, lake-road, and diagnostic captures plus `artifacts/visual-report.json`. On Windows it defaults to a short-lived headed browser because Chrome headless does not reliably expose the hardware WebGPU adapter. Set `IRONFRONTS_BROWSER` to select another Chromium executable or `IRONFRONTS_HEADLESS=true` when a CI GPU adapter is available.

## Controls

- Left drag: pan
- Mouse wheel: zoom
- Right drag: rotate and tilt
- WASD or arrow keys: pan
- F3: diagnostics and renderer debug views

## Generation pipeline

World generation is staged and deterministic:

1. Rasterize immutable land, lake, and ocean masks.
2. Generate capped continuous topography with broad hill and mountain envelopes.
3. Use the classified shared movement graph to shape broad traversable passes.
4. Freeze the heightfield permanently.
5. Route and drape visible roads onto the frozen terrain; impossible physical roads are hidden and reported without changing logical connectivity.
6. Place city streets, buildings, trees, lamps, fences, and signs after road clearances are final.

`scripts/build-world.mjs` orchestrates generation, `scripts/world/topography.mjs` owns the heightfield, and `scripts/build-infrastructure.mjs` coordinates direct province-center routing, audit, and mesh output. Expensive route results are cached under ignored `artifacts/road-cache/`.

The generated `world-generation-report.json` records topography statistics and every hidden corridor with its reason, endpoints, ID, and affected source connections. The source `material/` directory remains untouched.

## Rendering

Terrain materials blend by gameplay terrain, biome, slope, and macro variation. Beach sand is restricted to the actual shoreline mask, while low inland regions retain their biome. Forest ground transitions to a cheap canopy-green signal as individual trees fade. Ocean and lake water uses coastal depth, waves, foam, Fresnel reflection, and sun sparkle.

Road levels 1–5 remain available for future gameplay upgrades, but every initial province and road is level 1. Each unique land-adjacent province pair receives one independent dirt path between its two province centers; the generator emits no shared stems, gateway roads, plazas, or local city streets. Full-width route audits reject static-water incursions, and every road vertex independently samples the frozen terrain with a small deterministic lift.

Excessive incline is reported as a warning but no longer suppresses a road: steep level-1 trails use dense point-by-point terrain draping across hills and mountains. When a physical dirt road is omitted by the water or crossing audit, its logical connection remains visible as a thin floating amber dotted line. These indicators do not enter the road field, reserve clearance, or represent constructed infrastructure.
