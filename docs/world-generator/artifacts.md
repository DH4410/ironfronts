# Generated World Package

The compiler writes `public/world/`. `world.json` is the package index; every URL in it is relative to the configured world asset base.

## Manifest overview

Current manifest version is `12` and contains:

- source map ID/version and deterministic seed;
- world dimensions, horizontal overlap, and wrap flag;
- typed raster field descriptors;
- typed mesh/instance buffer descriptors;
- terrain, infrastructure, border, and prop chunk ranges;
- generation report and province sidecar descriptors;
- starting ownership, adjacency, label data, and country catalog;
- named showcase camera points;
- aggregate counts and compact province records.

All typed-array files use the host-written little-endian representation expected by the current browser/server platforms. There is no standalone cross-endian conversion layer.

## Raster fields

| File | Manifest format | Meaning |
|---|---|---|
| `province-ids.u16` | `r16uint` | High-resolution topology/picking field; `0` water, land `provinceId + 1` |
| `height.f32` | `r32float` | Final terrain elevation |
| `surface.rgba8` | `rgba8uint` | Terrain class, visual biome, macro variation, land alpha |
| `terrain-normal.rg8` | `rg8snorm` | Precomputed signed X/Z surface normal components |
| `terrain-albedo.rgba8` | `rgba8unorm-srgb` | Baked regional material color; alpha carries prop occlusion; mip levels concatenated |
| `navigation.rgba8` | `rgba8unorm` | Road core, road shoulder/verge, movement waterway, visual waterway |
| `coast.rg8` | `rg8unorm` | Topology-preserving land coverage and coast/river-bank proximity |

The manifest supplies exact width, height, and format. Do not infer dimensions from file size when a descriptor is available.

## Politics and province sidecars

| File | Type/stride | Meaning |
|---|---|---|
| `province-owners.u32` | `uint32`, stride 1 | Encoded province index to starting country ID |
| `province-adjacency.u32` | `uint32`, stride 2 | Encoded province adjacency pairs |
| `province-label-data.f32` | `float32`, stride 3 | Province center X, center Z, raster area |
| `province-details.json` | JSON v1 | Center, terrain ID, visual biome, population, coastal flag per province |

`world.json.provinces` keeps only runtime-critical ID/name/terrain records. Heavier province data is in the sidecar.

The manifest embeds the country catalog with ID, name, deterministic political colors, and capital province ID.

## Geometry and line buffers

| File | Scalar type | Record stride | Purpose |
|---|---|---:|---|
| `borders.f32` | float32 | 8 | Terrain-following province/coast segments and encoded neighbor IDs |
| `connections.f32` | float32 | 8 | Logical movement graph lines; marked lazy for client diagnostics, required by server |
| `road-vertices.f32` | float32 | 9 | Terrain-draped visible road vertices |
| `road-indices.u32` | uint32 | 1 | Visible road triangle indices |
| `hidden-connection-vertices.f32` | float32 | 9 | Floating dotted logical-link vertices |
| `hidden-connection-indices.u32` | uint32 | 1 | Dotted-link triangle indices |
| `waterway-vertices.f32` | float32 | 10 | Terrain-aware movement and visual water surfaces |
| `waterway-indices.u32` | uint32 | 1 | Waterway triangle indices |
| `waterway-network-lines.f32` | float32 | 8 | Lazy diagnostic river/canal network lines |

Counts in the manifest are record/index counts, not byte counts.

## Instance buffers

Every static instance record has eight float32 components. The exact component interpretation is layer-specific in renderer/generator code.

| File | Content |
|---|---|
| `trees.f32` | Position, scale/variant/orientation/palette/province data |
| `buildings.f32` | Position and building archetype transform/style data |
| `lamps.f32` | Road/city lamp transforms |
| `barriers.f32` | Road barrier transforms |
| `signs.f32` | Road sign transforms |

The manifest's `propChunks` maps the 32 × 16 world chunks to ranges. Tree ranges contain family groups; building ranges contain archetype groups. `infrastructureChunks` and `borderChunks` similarly avoid whole-world submission.

## Terrain descriptor

The terrain section declares 32 × 16 chunks, base grid resolution 49, and maximum generated height. The renderer derives its additional lower LOD grids and uses maximum height to constrain camera altitude.

## Reports and showcases

`world-generation-report.json` currently includes:

- topography caps, slopes, repairs, and conditioning;
- signed bank-field statistics;
- movement/visual waterways and surface audit;
- direct-road totals, hidden reasons, grade warnings, and unmapped segments;
- rejected coastal prop footprints.

Named showcase points include representative urban, mountain, steep/dirt road, hidden connection, Europe, lake-road, river, river-mouth, and canal locations where available. Browser QA uses these instead of hardcoding most camera positions.

## Consumer behavior

The client loads almost every presentation field/mesh in parallel after the manifest. `connections.f32` and diagnostic network lines are lazy/optional for renderer features.

The game server locally reads `world.json`, `province-details.json`, `province-owners.u32`, `province-ids.u16`, `surface.rgba8`, `height.f32`, and `connections.f32`. It builds authoritative world lookup/graph data and deterministically derives gameplay resource nodes from surface/height inputs.

Because client and server share coordinate/topology assumptions, any schema change must update:

- manifest/type definitions in `src/types.ts`;
- generator writers;
- `src/world-assets.ts` and renderer consumers;
- `apps/game-server/src/world-loader.ts`;
- compatibility/version handling and these docs.

## Deployment rule

Deploy the directory atomically and treat it as immutable. The game server's local `WORLD_DIRECTORY` and browser-facing `WORLD_PUBLIC_URL` must refer to identical bytes. Versioned CDN paths are preferable to replacing cached artifacts in place.
