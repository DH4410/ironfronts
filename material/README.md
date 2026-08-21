

## Included

- Province polygon geometry, including detached island/components
- Exact province centers
- Sea points and names
- Exact movement/connection network
- Exact province adjacency and border topology (`bn` / `bt`)
- Logical shared-border/coastline runs plus lossless raw edge/vertex topology
- Exact explicit terrain-marker positions (`tmp`)
- Static terrain, population, VP, region and resource-production metadata
- Precomputed triangulated province mesh and map/province bounds
- Regions and province-to-region membership
- Initial/start ownership for all provinces, with sanitized country metadata
- Field dictionaries and decoder notes
- Untouched static high-resolution map JSON and raw `connections_v2` bytes


## Core counts

- Provinces: 3303
- Polygon components: 3430
- Sea points: 4546
- Edge-sharing province adjacency pairs: 7805
- Corner-touch-only contacts: 67
- Directed logical border segments: 17834
- Directed coastline runs: 2190
- Explicit terrain-marker positions: 2554 across 323 provinces
- Movement segments: 28847
- Movement network nodes: 17581
- Triangulated polygon components: 3430
- Regions: 11
- Initial countries: 200

All coordinates use the game's own map coordinate system (origin top-left, +x right, +y down), **not latitude/longitude**.
