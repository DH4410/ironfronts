# World Generator

The world generator is a deterministic offline compiler. It transforms the immutable source dataset in `material/` plus source textures into the versioned static package in `public/world/`. That package is consumed independently by the WebGPU client and authoritative game server.

The generator does not run inside either service and does not mutate `material/`.

## Run it

```sh
npm run build:world
```

Current fixed configuration in `scripts/world/config.mjs`:

| Setting | Value |
|---|---:|
| World size | 13,562 × 7,000 world units |
| Province/navigation raster width | 4,096 |
| Province/navigation raster height | proportional to world aspect |
| Terrain-field width | 2,048 |
| Terrain-field height | proportional to world aspect |
| Deterministic seed | `0x49f2a631` |
| Expected provinces | 3,303 |
| Manifest version | 12 |
| Generation report version | `world-generation-v12` |

`public/world`, `artifacts`, and `data` are ignored outputs. Production builds invoke world generation before workspace/client compilation.

## Inputs

The compiler reads selected JSON/source assets below `material/`:

- decoded province polygons, including detached components;
- province metadata, centers, terrain, visual biomes, population, and urban/coastal flags;
- countries and initial ownership;
- logical border/coast segments and province adjacency;
- exact movement connection segments and network nodes;
- explicit terrain marker positions;
- map ID/version metadata.

The source dataset uses game coordinates with origin at top-left, positive X right, and positive Y/down—not geographic longitude/latitude. World X wraps.

Terrain albedo baking also reads source material textures from `public/textures`.

## Pipeline

`scripts/build-world.mjs` is the orchestrator. The major stages are ordered because later outputs depend on frozen earlier fields.

### 1. Source validation and province rasterization

The compiler loads source files in parallel, requires exactly 3,303 geometry and metadata provinces, rasterizes every polygon component to the high-resolution province-ID field, and calculates per-province area. Province IDs use `0` for water/void and encode land province `id + 1`.

Initial ownership, label data, adjacency, and a deterministic political palette are constructed. Every province must have a nonzero initial owner.

### 2. Base terrain fields

Metadata is mapped to terrain and visual-biome codes. The compiler creates land, relief, terrain, biome, and province fields at terrain resolution. Continuous topography uses deterministic noise, broad regional envelopes, terrain-class limits, coastline distance, authored markers, and route conditioning.

### 3. River topology and final topography

An initial movement-waterway pass distinguishes authored movement rivers/canals from visual-only channels. Narrow visual channels are expanded for strategy-map readability. River-overlay cells are promoted into the terrain topology before topography is regenerated so channels remain intact.

The final terrain is then shallowly carved around movement and visual rivers. A topology-preserving signed-distance bank field supplies coverage and coast/river proximity without blurring narrow channels shut.

### 4. Roads and infrastructure

`buildInfrastructure` creates one direct logical route for land-connected province pairs, adapts it to frozen terrain, builds city plans, audits the full physical width, suppresses water-crossing or illegal crossing geometry, and produces meshes/raster/furniture.

- Road width: 1.2 world units.
- Grade target/warning threshold: 24% plus audit tolerance.
- Excessive grade is reported but not hidden.
- A route crossing static water or another incompatible road is visually suppressed.
- Logical connectivity remains, represented by dotted hidden-connection geometry.

Terrain-adapted road routes are cached under `artifacts/road-cache/`. The cache key includes routing version, routes, final heights, and land field. Unreadable/stale cache entries are ignored or naturally invalidated.

### 5. Terrain-aware waterways

Movement and visual water surfaces are draped over final terrain. The pipeline writes indexed waterway meshes, optional diagnostic network lines, masks, clearance, showcase locations, and audit/report statistics.

### 6. Props and cities

Deterministic per-province RNG places forest/plain trees and city buildings while respecting province topology, road/water clearance, and full building footprints at coastlines. City plans also emit lamps, barriers, and signs.

Trees/buildings/furniture are packed into 32 × 16 spatial chunks. Tree families and building archetypes receive grouped ranges so the renderer can cull and batch by chunk/category/LOD.

### 7. Precomputed presentation fields

The generator computes:

- signed terrain normals;
- packed road/water navigation channels;
- baked sRGB terrain albedo with mip chain;
- prop contact occlusion in albedo alpha;
- chunked terrain/border/prop/infrastructure ranges;
- terrain-following border segments;
- country label metrics.

### 8. Manifest/report and promotion

All artifacts are written to `public/.world-staging-<pid>`. Before replacing the live package, the compiler verifies nonempty core files and a 3,303-province manifest.

Promotion is recoverable:

1. Remove an obsolete `.world-previous`.
2. Rename current `public/world` to `.world-previous` if present.
3. Rename staging to `public/world`.
4. Restore the previous package if promotion fails before a new final exists.
5. Remove the backup after success.

At startup, the generator also restores `.world-previous` if an earlier interrupted promotion left no final directory. It refuses to manage paths outside `public/`.

## Module layout

| Module area | Responsibility |
|---|---|
| `world/source-data.mjs`, `raster.mjs` | Input JSON and raster primitives |
| `world/topography*.mjs`, `noise.mjs` | Elevation, regional envelopes, deterministic noise |
| `world/waterways*.mjs`, `visual-*.mjs` | Movement/visual river selection, masks, surfaces, smoothing |
| `world/river-*-terrain.mjs`, `water-fields.mjs` | Terrain integration, carving, signed bank fields |
| `world/terrain-precompute.mjs` | Normals, navigation texture, baked albedo/mips/AO |
| `world/instances.mjs` | Deterministic props and coastal footprint validation |
| `world/chunk-packing.mjs` | Spatial/group ranges and line packing |
| `infrastructure/province-routes.mjs` | Direct province route assembly |
| `infrastructure/road-routing.mjs` | Terrain adaptation/draping |
| `infrastructure/route-audit.mjs` | Water/grade physical-width audit |
| `infrastructure/route-cache.mjs` | Content-addressed road cache |
| `infrastructure/city-plans.mjs` | City layout planning |
| `infrastructure/meshes.mjs`, `outputs.mjs` | Road meshes, navigation raster, furniture |

## Determinism

The fixed seed and deterministic ID/tie ordering make identical inputs/configuration produce the same logical package. Content-addressed road caching is an optimization, not another source of truth.

Potential sources of changed output include source material, textures used during albedo baking, compiler code/constants, Node/runtime behavior affecting numeric operations, or manifest/report version changes. Treat a regenerated package as a new immutable deployment unit.

## Validation and diagnosis

After generation:

- inspect `public/world/world-generation-report.json` for height/slope repairs, bank coverage, waterways, hidden roads, grade warnings, and rejected coastal buildings;
- ensure `world.json` counts and showcase points are plausible;
- start all runtime components and use `npm run visual-check` for rendered validation;
- use inspector debug views for province IDs, slope, river corridors, road footprint, and navigation channels;
- use `npm run performance-check` after geometry/count/material changes.

The game server hashes raw `world.json` bytes for save/client compatibility. Sidecar/binary files are not individually included in that hash, so never mix artifacts from different generator runs under one manifest.

See [Generated artifacts](artifacts.md) for the package contract.
