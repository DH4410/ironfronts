# Field dictionary

## Static map top-level fields

- `mapID`: static map/scenario geometry ID.
- `width`, `height`: map dimensions in game-map units.
- `overlapX`: horizontal wrap/overlap band.
- `populationFactor`, `usePopulation`: static population-related map configuration.
- `locations`: province (`@c = p`) and sea-point (`@c = sp`) records.
- `connections_v2`: Base64 encoded movement-network segments.
- `triangulations`: precomputed province mesh used by the map renderer.
- `version`: static map payload version.

## Static province fields (`@c = p`)

- `id`: province ID.
- `b`: main province boundary, Base64 encoded unsigned big-endian 16-bit `x,y` pairs.
- `xb`: detached/extra polygon components such as islands.
- `c`: exact province center `{x,y}`.
- `bn`: per-main-boundary-vertex neighbor-ID lists. Used for exact border topology.
- `bt`: Base64 encoded byte mask, one byte per main-boundary vertex. On this map the verified bits are:
  - `1`: coastline
  - `2`: shared province border where both provinces have the same initial/core country
  - `8`: shared province border where the provinces have different initial/core countries
  - junction values are bitwise OR combinations (`3`, `9`, `10`, `11`).
- `ci`: static core-country IDs. Exactly one on every province in this map; matches captured initial ownership 3303/3303.
- `co`: coastal flag.
- `cp`: static configured/base resource-production values. These match the dynamic maximum-production map where both are present.
- `p`: population. Verified against the dynamic province population wherever both copies carry it.
- `r`: unresolved raw resource-class code. Strongly resource-related; preserved without renaming.
- `bp`: unresolved raw resource-related field. Preserved without guessing its original meaning.
- `rg`: region ID list. Every province belongs to exactly one of the 11 regions on this map.
- `tmp`: explicit terrain marker positions (`terrainMarkerPositions` in client code).
- `tt`: gameplay terrain type ID.
- `vtt`: static visual-terrain/biome tag. Preserved as map metadata; no render assets are included.
- `vp`: victory-point value where present.

## Static sea-point fields (`@c = sp`)

- `id`: sea-point ID.
- `c`: exact sea-point center.
- `ed`, `hst`, `pal`: raw static sea-point fields whose semantics were not sufficiently confirmed; preserved as raw values.

## Dynamic province schema reference

The package does **not** include evolving live values for these fields (except the initial owner/name used to identify the static map), but the client code gives the following mappings:

- `n`: province name
- `o`: owner ID
- `lo`: legal owner ID
- `us`: upgrades/buildings
- `m`: morale
- `p`: population
- `dt`: deployment target
- `apt`: army-production end/time field
- `tapt`: army-production duration/time field
- `sa`: stationary army ID
- `cos`: constructions
- `prs`: productions
- `cs`: construction slots
- `ps`: production slots
- `lb`: last battle
- `ib`: besieged state
- `arp`: all/current resource productions
- `ci`: core country IDs
- `vp`: victory points
- `rg`: region IDs
- `ims`: impacts
- `uuc`: unknown-upgrade count
- `pst`: province-state ID
- `plv`: province level
- `poi`: point-of-interest flag
- `mpm`: maximum production map
- `cp`: configured productions
- `mt`: morale trend

These mappings are documented as schema knowledge only; live-game state is intentionally excluded from this archive.
