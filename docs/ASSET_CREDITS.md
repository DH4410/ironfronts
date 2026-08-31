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
`binaries/data/mods/public/art/textures/ui/session/icons/`. The
`binaries/data/mods/*/art` tree is CC BY-SA 3.0 per that repo's
`binaries/data/mods/public/art/LICENSE.txt` and top-level `LICENSE.txt`.

| Vendored file | Upstream source path | Used in Ironfronts for |
|---|---|---|
| `food.png` | `resources/food.png` | Food resource |
| `metal.png` | `resources/metal.png` | Metal resource · metal-ore map marker |
| `stone.png` | `resources/stone.png` | Stone/rock deposit map marker |
| `wood.png` | `resources/wood.png` | (reserved — forestry) |
| `population.png` | `resources/population.png` | Manpower resource |
| `economics.png` | `economics.png` | Funds resource · Economy dock button |
| `production.png` | `production.png` | Industry resource · Tank-plant facility chip |
| `training.png` | `training.png` | Barracks facility chip (city panel) |
| `construction.png` | `construction.png` | Ordnance-works facility chip (city panel) |
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

**Historical accuracy:** `src/ui/flags.ts` maps each in-game country to a
**September 1939** flag. Where a nation's flag is unchanged since 1939 (plain
tricolours, Nordic crosses, the Hinomaru, the Union Jack) the flag-icons file
above is used directly. Where it differs, a period flag is vendored from
Wikimedia Commons — see the next section and `docs/flags.md`. The leftover
modern flag-icons files (`de.svg`, `it.svg`, `gr.svg`, …) stay vendored only as
fallbacks and are not referenced for those countries.

---

## Historical national flags — Wikimedia Commons

**Source:** Wikimedia Commons, retrieved 2026-08-30 via
`commons.wikimedia.org/wiki/Special:FilePath/`.
**Licence:** Public domain (PD-old — pre-1929 designs and/or expired government
works). Each file carries its source URL and licence in a leading XML comment.

Vendored under `src/ui/assets/flags/`, unmodified:
`de-1935-1945` (Germany, 1935–45 national flag — period-accurate for the
scenario, incl. the swastika, per the campaign brief),
`it-1861-1946` (Kingdom of Italy), `su-1936-1955` (USSR),
`gr-1935-1970` (Greece, royalist land flag), `yu-1918-1941` (Kingdom of
Yugoslavia), `eg-1922-1958` (Kingdom of Egypt), `iq-1921-1959` (Kingdom of
Iraq), `ir-1925-1979` (Imperial Persia, Lion and Sun),
`za-1928-1994` (Union of South Africa), `et-empire` (Ethiopian Empire),
`cn-roc` (Republic of China), `manchukuo` (Manchukuo).

Full per-entity rationale, colony→metropole mapping and known gaps: `docs/flags.md`.

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

**Modification:** the supplied 1254×1254 source (~1 MB) was box-downsampled to
128×128 (~16 KB) for runtime — it is only ever drawn as a ~14–24 px icon.
Regenerate from the original with `scripts/`-style tooling if a larger size is
ever needed.
