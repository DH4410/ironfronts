# External asset sources

Ironfronts' in-game polish branch deliberately uses externally sourced, reusable art instead of generated replacement models.

## Active in this branch

### Kenney — City Kit (Suburban)

- Creator: Kenney
- License: CC0 1.0 Universal / public domain dedication
- Source: https://kenney.nl/assets/city-kit-suburban
- Mirror used by the runtime loader: https://github.com/petroulacl/fps-buildings-env-kit/tree/main/buildings/kenney-city-kit-suburban
- Runtime models: `building-type-a.obj`, `building-type-g.obj`, `building-type-i.obj`, `building-type-q.obj`, `building-type-t.obj`
- Purpose: replace Ironfronts' close-range procedural building boxes while retaining cheap existing distant LODs.

The mirror preserves Kenney's `License.txt` and model attribution. Runtime loading is best-effort; if the source cannot be reached, Ironfronts falls back to its existing local building mesh so the map still starts offline.

## Reviewed for later passes

These were reviewed as candidate sources but are not yet shipped by this branch:

- Kenney — Modular Buildings (CC0): https://kenney.nl/assets/modular-buildings
- OpenGameArt — CC0 low-poly tree packs: https://opengameart.org/
- Quaternius — public-domain low-poly military packs: https://quaternius.com/

Before any later asset is enabled in production, keep its source and license recorded here.
