# Border topology notes

`bn` and `bt` are aligned to the vertices of each province's main `b` polygon.

The lossless representation is in:

- `topology/border_topology_vertices.*`
- `topology/border_edge_pieces.*`

For each polygon edge, the common neighbor IDs of its two endpoints identify an actual shared-edge neighbor. This yields **7805 unique edge-sharing province pairs**.

`bn` also contains **67 extra province pairs** that touch only at a corner/junction; these are separated into `corner_touch_contacts.*` rather than incorrectly treating them as traversable shared borders.

Contiguous edge pieces are grouped into **17834 directed logical border runs**, including **2190 coastline runs**. Shared-border runs are stored once from each province's perspective, so they are directed representations rather than a deduplicated physical-line count.

The raw `bt` values are bit masks. Values such as 3/9/10/11 occur at transitions/junction vertices because multiple boundary classes meet at a point.
