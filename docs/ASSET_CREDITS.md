# Third-party asset credits

Ironfronts bundles a small number of third-party UI assets. Each is listed
below with its upstream project, exact source path, and licence. Only the
specific files we actually use are vendored.

## User-provided infantry model

`public/models/infantry.glb` is generated from the project owner's supplied
Saluting Soldier GLB exports. It contains the shared mesh, armature, texture,
and only the `Walking`, `Injured_Walk`, and `Injured_Walk_Backward` clips used
by the game. Run `npm run build:infantry-model` to regenerate it from the
source exports in the repository root. The supplied model is treated as an
Ironfronts project asset; confirm its original author/licence before public
distribution.

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
| `attack-request.png` | `attack-request.png` | Attack-order request marker |
| `repair.png` | `repair.png` | Build / repair actions |
| `stop.png` | `stop.png` | Army stop order (command grid) |
| `kill.png` | `kill.png` | Attack command (command grid) |
| `patrol.png` | `patrol.png` | Patrol command (reserved) |
| `garrison.png` | `garrison.png` | Garrison command (reserved) |
| `heal.png` | `heal.png` | Health / medical stat |
| `promote.png` | `promote.png` | Veterancy / promotion (reserved) |
| `upgrade.png` | `upgrade.png` | Upgrade action (reserved) |
| `cancel.png` | `cancel.png` | Cancel / abort action (reserved) |
| `groups.png` | `groups.png` | Control-group / army-group UI (reserved) |
| `call-to-arms.png` | `call-to-arms.png` | Mobilise / call-to-arms (reserved) |
| `focus-attacked.png` | `focus-attacked.png` | "Force under attack" notification + click-to-focus |
| `focus-rally.png` | `focus-rally.png` | Rally-point focus (reserved) |
| `stances/aggressive.png` | `stances/aggressive.png` | Army stance: aggressive (reserved) |
| `stances/defensive.png` | `stances/defensive.png` | Army stance: defensive (reserved) |
| `stances/passive.png` | `stances/passive.png` | Army stance: passive (reserved) |
| `stances/standground.png` | `stances/standground.png` | Army stance: hold ground (reserved) |
| `ranks/Basic.png` | `ranks/Basic.png` | Army experience tier: green |
| `ranks/Advanced.png` | `ranks/Advanced.png` | Army experience tier: seasoned |
| `ranks/Elite.png` | `ranks/Elite.png` | Army experience tier: elite |
| `formations/column_open.png` | `formations/column_open.png` | Formation: march column (reserved) |
| `formations/line_closed.png` | `formations/line_closed.png` | Formation: firing line (reserved) |
| `formations/wedge.png` | `formations/wedge.png` | Formation: wedge / spearhead (reserved) |
| `formations/flank.png` | `formations/flank.png` | Formation: flanking (reserved) |
| `formations/box.png` | `formations/box.png` | Formation: defensive box (reserved) |
| `formations/scatter.png` | `formations/scatter.png` | Formation: dispersed (reserved) |

CC BY-SA 3.0 is share-alike: these icons remain under CC BY-SA 3.0 as
distributed here. If Ironfronts ships a formal credits screen, these must be
listed there too.

---

## 0 A.D. — session cursors

Vendored under `public/cursors/` (served as-is), copied unmodified from
`0ad/0ad` at `master`, `binaries/data/mods/public/art/textures/cursors/`.
Same CC BY-SA 3.0 art licence. Hotspot (x y, from the upstream `.txt`
sidecar) noted for the CSS `cursor: url(...) x y` fallback.

| Vendored file | Upstream source path | Hotspot | Used in Ironfronts for |
|---|---|---|---|
| `action-attack.png` | `cursors/action-attack.png` | 1 1 | Cursor over a valid attack target |
| `action-attack-move.png` | `cursors/action-attack-move.png` | 1 1 | Cursor for attack-move (reserved) |
| `action-capture.png` | `cursors/action-capture.png` | 1 1 | Cursor over a capturable province (reserved) |
| `action-garrison.png` | `cursors/action-garrison.png` | 1 1 | Cursor over a garrisonable target (reserved) |
| `cursor-rally.png` | `cursors/cursor-rally.png` | 5 31 | Cursor while placing a rally point |
| `cursor-no.png` | `cursors/cursor-no.png` | 13 14 | Cursor over an invalid / disallowed target |

---

## 0 A.D. — interface audio

Vendored under `public/audio/sfx/`, copied unmodified from `0ad/0ad` at
`master`, `binaries/data/mods/public/audio/interface/alarm/`. The
`binaries/data/mods/*/audio` tree is CC BY-SA 3.0 per that repo's
`binaries/data/mods/public/audio/LICENSE.txt` and top-level `LICENSE.txt`.

| Vendored file | Upstream source path | Used in Ironfronts for |
|---|---|---|
| `alarmattackunit_1.ogg` | `audio/interface/alarm/alarmattackunit_1.ogg` | "One of your forces is under attack" alert cue |

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

### Painted WW2 RTS button icons

**Source:** Original Ironfronts assets prepared on 2026-09-08. The four unit
buttons are 256 px derivatives of the established Ironfronts unit portraits
listed below. The building and command illustrations were generated with
OpenAI's built-in image generator. They are not copied from 0 A.D., Call of
War, or another third party and carry the same licence as this repository.

**Prompt direction:** realistic historical-strategy illustration on true
transparent alpha; hand-painted gouache and opaque watercolor, believable
WW2 construction and proportions, strong silhouettes, muted olive/khaki/
gunmetal/brick colors, visible brushwork, and softly broken edges. Command
prompts requested sober military objects and field-map marks. Building prompts
requested ground-level wartime architecture rather than toy-like isometric
facilities. Their selected silhouettes use infantry and rifle racks for the
barracks, an emerging tank for the tank plant, and a field gun plus shells for
the ordnance works so each remains identifiable at 64 px. Every prompt
prohibited text, frames, badges, glossy gold, thick
cartoon outlines, and mobile-game rendering. The direction was informed by
the official [0 A.D. icon showcase](https://play0ad.com/team-blog-icon-showcase/)
and the role clarity of the official [Call of War unit roster](https://wiki.callofwar.com/wiki/UNITS/),
without using either game's artwork as generator input.

**Modification:** the 320 px portrait derivatives and 1254-1536 px generator
outputs were high-quality bicubic downscaled without changing aspect ratio,
centered on 256x256 transparent RGBA canvases for runtime use.

| Runtime file | Slot |
|---|---|
| `src/ui/assets/icons/ironfronts/unit-engineer-icon.png` | Engineer production button |
| `src/ui/assets/icons/ironfronts/unit-armored-car-icon.png` | Armored-car production button |
| `src/ui/assets/icons/ironfronts/unit-light-tank-icon.png` | Light-tank production button |
| `src/ui/assets/icons/ironfronts/unit-medium-tank-icon.png` | Medium-tank production button |
| `src/ui/assets/icons/ironfronts/structure-barracks-icon.png` | Barracks build button |
| `src/ui/assets/icons/ironfronts/structure-tank-plant-icon.png` | Tank-plant build button |
| `src/ui/assets/icons/ironfronts/structure-ordnance-icon.png` | Ordnance-works build button |
| `src/ui/assets/icons/ironfronts/command-move.png` | Move command |
| `src/ui/assets/icons/ironfronts/command-attack.png` | Attack command |
| `src/ui/assets/icons/ironfronts/command-retreat.png` | Retreat command |
| `src/ui/assets/icons/ironfronts/command-split.png` | Split command |
| `src/ui/assets/icons/ironfronts/command-stop.png` | Stop command |
| `src/ui/assets/icons/ironfronts/command-extract.png` | Extract command |

### `public/ui/diplomatic-cable-watermark.png`

Original Ironfronts project artwork generated with OpenAI's built-in image
generation tool on 2026-09-07. The prompt requested a transparent, distressed
two-colour 1939 field-envelope and radio-arc watermark in the HUD's brass and
cream palette. Used decoratively in the diplomacy drawer header; no control or
game state depends on the image.

### `water.png`

**Source: User-provided Ironfronts asset.** A painterly water-drop-in-a-bowl
raster supplied by the project owner for the `water` / `resource-water` icon
slot (`src/ui/icons.ts`). It is **not** from 0 A.D. or any other third party
and carries the same licence as the Ironfronts repository.

**Modification:** the supplied 1254×1254 source (~1 MB) was box-downsampled to
128×128 (~16 KB) for runtime — it is only ever drawn as a ~14–24 px icon.
Regenerate from the original with `scripts/`-style tooling if a larger size is
ever needed.

### Painterly unit portraits & facility / stance art

**Source: User-provided Ironfronts assets.** Painterly WW2 unit portraits,
facility building art and order-stance emblems generated by the project owner
(OpenAI image tool) for Ironfronts. Not from 0 A.D. or any other third party;
same licence as the Ironfronts repository.

**Modification:** each ~1240 px, ~1.7 MB source PNG was alpha-trimmed and
Lanczos-downscaled with Pillow — portraits to 384 px, icons to 256 px
(90–210 KB each). Regenerate larger from the originals if ever needed.

| Runtime file | Slot | Wired? |
|---|---|---|
| `src/ui/assets/units/infantry.png` | Infantry composition portrait | yes (raster beats the SVG) |
| `src/ui/assets/units/engineer.png` | Engineer / pioneer portrait | yes |
| `src/ui/assets/units/armored-car.png` | Armoured-car portrait | yes |
| `src/ui/assets/units/light-tank.png` | Light-tank portrait | yes |
| `src/ui/assets/units/medium-tank.png` | Medium-tank portrait | yes |
| `src/ui/assets/units/artillery.png` | Artillery portrait | yes |
| `src/ui/assets/icons/ironfronts/barracks.png` | Detailed barracks art | legacy; replaced in Build row by the compact generated icon above |
| `src/ui/assets/icons/ironfronts/tank-plant.png` | Detailed tank-plant art | legacy; replaced in Build row by the compact generated icon above |
| `src/ui/assets/icons/ironfronts/ordnance.png` | Detailed ordnance art | legacy; replaced in Build row by the compact generated icon above |
| `src/ui/assets/icons/ironfronts/fortress.png` | `structure-fortress` | reserved — no fortress building exists yet |
| `src/ui/assets/icons/ironfronts/settlement.png` | `structure-city` (walled town) | reserved — no city/settlement icon slot yet |
| `src/ui/assets/icons/ironfronts/stance-attack.png` | `stance-attack` (three swords) | reserved — no army-stance system |
| `src/ui/assets/icons/ironfronts/stance-attack-defend.png` | `stance-attack-defend` (crossed swords + shield) | reserved |
| `src/ui/assets/icons/ironfronts/stance-defend.png` | `stance-defend` (shield + planted spears) | reserved |
| `src/ui/assets/icons/ironfronts/stance-retreat.png` | `stance-retreat` (soldier + fall-back arrow) | reserved |
| `src/ui/assets/icons/ironfronts/stance-defend-retreat.png` | `stance-defend-retreat` (double shield + fall-back arrow) | reserved |
