# Triangulation / mesh notes

The original static payload contains a precomputed province mesh under `triangulations`. It is retained untouched in `source/triangulations.original.json` and decoded into convenient files under `mesh/`.

- Mesh format version: 3
- Coordinate precision multiplier: 16.0
- Province IDs: 3303
- Polygon components in mesh: 3430
- `t`: triangle indices
- `e`: edge/bevel vertices, stored at the mesh precision scale
- `ib`: inner-border vertices, stored at the mesh precision scale
- `en`: encoded edge-normal bytes; raw values are preserved rather than inventing a different normal encoding
- `ei`: optional edge indices
- `provinceBounds`: four raw values per province (`minX,minY,maxX,maxY`), divided by precision in the decoded index
- `mapBounds`: overall mesh bounds, also decoded by precision
- `provinceSizes`: min/max province dimensions, also decoded by precision

No shaders, textures or other rendering assets are included. The mesh is retained because it is intrinsic precomputed map geometry.
