# Ironfronts renderer

A native WebGPU world renderer built on the static map package in `material/`. The current milestone is deliberately visual: regional topography, biome materials, animated oceans and terrain-following rivers, a terrain-aware 3D road network with bridges, road-shaped cities, province borders and hover feedback, forests, and a hidden diagnostics view. It contains no ownership, units, gameplay, persistence, or server.

## Run locally

Requirements: Node.js 22+ and a current desktop Chrome or Edge release with WebGPU enabled.

```sh
npm install
npm run dev
```

The development command first converts the source map into compact files under `public/world/`, then starts Vite. Production builds use `npm run build`. Run the data and Dawn-backed shader checks with `npm test`.

With the dev server running, `npm run visual-check` launches the installed Chrome executable through Playwright and writes overview, bridge-clearance, tallest-pier, close-terrain, and diagnostics captures plus `artifacts/visual-report.json`. On Windows it uses a short-lived headed window because Chrome's headless backend does not reliably expose the hardware WebGPU adapter. Set `IRONFRONTS_BROWSER` to use a different Chromium executable or `IRONFRONTS_HEADLESS=true` when a CI GPU adapter is available.

## Controls

- Left drag: pan
- Mouse wheel: zoom
- Right drag: rotate and tilt
- WASD or arrow keys: pan
- F3: diagnostics and renderer debug views

Province borders grow stronger as the camera approaches. Hovering a province highlights its complete boundary and shows its name and gameplay terrain.

## Data and rendering

The source `material/` directory remains untouched. `scripts/build-world.mjs` rasterizes exact province IDs, produces a continuous periodic heightfield with multi-scale mountain uplift, traces depression-free watersheds, carves river channels, packs topology and future movement paths, and creates deterministic tree/building instance buffers. The browser only downloads these generated renderer assets.

Terrain shaders blend the generated material set by gameplay terrain, visual biome, elevation, slope, and macro variation. Forest ground transitions to a cheap canopy-green signal when individual trees fade out. Ocean shading uses coastal depth, vertex waves, foam, Fresnel reflection and sun sparkle. Rivers combine a terrain-conforming water layer with continuous reflective network meshes, rounded confluences, cleared banks, downhill bed profiles, distance-aware strategic visibility, and flared lake/ocean outlets.

The road compiler preserves every land movement link while separating province infrastructure level from local, connector, and trunk corridor roles. Initial levels are population-led, component-aware, and restricted to levels 1–3; the renderer already supports the full dirt-to-highway 1–5 progression. Shared gateway stems reduce city starbursts, global lateral optimization removes mountain sawteeth, constrained vertical profiles produce bounded cuts and fills, and levels 2–5 may create modeled tunnels with terrain-projected dotted indicators. Contextual level-2 roads use gravel or timber reinforcement in wet forest biomes. Every source connection maps back to its generated corridor IDs, while sea movement links remain diagnostic-only.

Roads, bridges, and tunnels are chunked by their actual segment positions. Their terrain field stores core coverage, verge coverage, infrastructure level, corridor role, city-street state, and surface material for strategic LOD and F3 inspection. Expensive centerline results are cached deterministically under ignored `artifacts/road-cache/`.
