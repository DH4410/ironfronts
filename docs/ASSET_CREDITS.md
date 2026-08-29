# Third-party asset credits

Ironfronts bundles a small number of third-party UI assets. Each is listed
below with its upstream project, exact source path, and licence. Only the
specific files we actually use are vendored.

---

## 0 A.D. — session UI icons

**Project:** 0 A.D. (Wildfire Games) — <https://github.com/0ad/0ad>
**Licence:** CC BY-SA 3.0 (0 A.D. art assets) —
<https://creativecommons.org/licenses/by-sa/3.0/>
**Attribution:** © Wildfire Games and 0 A.D. contributors.

Vendored under `src/ui/assets/icons/0ad/` (bundled by Vite). Each file is
copied unmodified from `0ad/0ad` at ref `master`, from
`binaries/data/mods/public/art/textures/ui/session/icons/`:

| Vendored file | Upstream source path | Used in Ironfronts for |
|---|---|---|
| `food.png` | `resources/food.png` | Food resource |
| `metal.png` | `resources/metal.png` | Metal resource · metal-ore map marker |
| `stone.png` | `resources/stone.png` | Stone/rock deposit map marker |
| `wood.png` | `resources/wood.png` | (reserved — forestry) |
| `population.png` | `resources/population.png` | Manpower resource |
| `economics.png` | `economics.png` | Funds resource · Economy dock button |
| `production.png` | `production.png` | Industry resource |
| `diplomacy.png` | `diplomacy.png` | Diplomacy map mode · Diplomacy dock button |
| `objectives.png` | `objectives.png` | Objectives dock button |
| `attack-request.png` | `attack-request.png` | (reserved — army/combat UI) |
| `repair.png` | `repair.png` | (reserved — build/repair actions) |
| `stop.png` | `stop.png` | (reserved — army stop order) |

CC BY-SA 3.0 is share-alike: these icons remain under CC BY-SA 3.0 as
distributed here. If Ironfronts ships a formal credits screen, these must be
listed there too.

---

## flag-icons — country flag SVGs

**Project:** flag-icons (Panayiotis Lipiridis / contributors) —
<https://github.com/lipis/flag-icons>
**Licence:** MIT.

Vendored under `src/ui/assets/flags/` (bundled by Vite), copied unmodified
from `lipis/flag-icons` at ref `main`, path `flags/4x3/<code>.svg`.

Codes vendored: `at be bg ch cz de dk eg es et fi fr gb gr ie ir is it jp
lu nl no nz pl pt ro sa se tr za`.

**Note on historical accuracy:** these are **modern** national flags used as
a first pass. `src/ui/flags.ts` is a registry keyed by in-game country name,
so scenario-specific / 1939-era flags can be substituted later without
touching the components. In particular `de.svg` is the modern
black-red-gold tricolour — Ironfronts deliberately does **not** vendor
1933–1945 German state symbology.

---

## Original Ironfronts icons

`src/ui/assets/icons/ironfronts/` — authored for this project (same licence
as the Ironfronts repository). Used where no suitable 0 A.D. artwork exists:
`oil.svg` (Oil resource), `strategic.svg` / `political.svg` / `terrain.svg`
(map modes), `pickaxe.svg` (resource overlay toggle), `provinces.svg`,
`event.svg`, `close.svg`, `focus.svg`.

### `water.png`

**Source: User-provided Ironfronts asset.** A painterly water-drop-in-a-bowl
raster supplied by the project owner for the `water` / `resource-water` icon
slot (`src/ui/icons.ts`). It is **not** from 0 A.D. or any other third party
and carries the same licence as the Ironfronts repository.
