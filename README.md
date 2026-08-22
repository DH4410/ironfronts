# Ironfronts renderer

A native WebGPU world renderer built on the static map package in `material/`. The current milestone is deliberately visual: regional topography, biome materials, animated oceans and terrain-following rivers, province borders and hover feedback, forests, compact cities, and a hidden diagnostics view. It contains no ownership, units, gameplay, persistence, or server.

## Run locally

Requirements: Node.js 22+ and a current desktop Chrome or Edge release with WebGPU enabled.

```sh
npm install
npm run dev
```

The development command first converts the source map into compact files under `public/world/`, then starts Vite. Production builds use `npm run build`. Run the data and Dawn-backed shader checks with `npm test`.

With the dev server running, `npm run visual-check` launches the installed Chrome executable through Playwright and writes overview, close-terrain, and diagnostics captures under `artifacts/`. Set `IRONFRONTS_BROWSER` to use a different Chromium executable.

## Controls

- Left drag: pan
- Mouse wheel: zoom
- Right drag: rotate and tilt
- WASD or arrow keys: pan
- F3: diagnostics and renderer debug views

Province borders grow stronger as the camera approaches. Hovering a province highlights its complete boundary and shows its name and gameplay terrain.

## Data and rendering

The source `material/` directory remains untouched. `scripts/build-world.mjs` rasterizes exact province IDs, produces a continuous periodic heightfield with multi-scale mountain uplift, traces depression-free watersheds, carves river channels, packs topology and future movement paths, and creates deterministic tree/building instance buffers. The browser only downloads these generated renderer assets.

Terrain shaders blend the generated material set by gameplay terrain, visual biome, elevation, slope, and macro variation. Forest ground transitions to a cheap canopy-green signal when individual trees fade out. Ocean shading uses coastal depth, vertex waves, foam, Fresnel reflection and sun sparkle. Rivers combine a terrain-conforming water layer with continuous reflective network meshes, rounded confluences, cleared banks, downhill bed profiles, distance-aware strategic visibility, and flared lake/ocean outlets. Material names are stable, so the PNG files under `public/textures/` can later be replaced without changing shader or world data.
