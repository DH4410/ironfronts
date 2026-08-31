# Ironfronts — playtest/polish pass 2d (in progress)

**Branch:** `fix/map-playtest-pass-2` (off `6c6fdba`) · **NOT merged** · fork `DH4410/ironfronts` only
**Ready to play:** http://127.0.0.1:5173/

This file is written incrementally as each slice lands. See the bottom for the
running verdict.

---

## Slices landed this pass

### 1. Shared rich-tooltip system + army command strip (`feat(ui): …`)

- New `src/ui/tooltip.ts`: one lazily-created `.ifg-tip` panel reused by every
  hoverable control. `bindTooltip(el, content | () => content)` with
  `{ title, description, shortcut, disabledReason, cost, eta, status }`.
  ~170 ms open delay, immediate hide on leave/blur/Escape/scroll/press,
  flip-above-or-below, viewport-clamped so it never renders offscreen.
- `renderTooltipHtml()` is a pure function (escapes dynamic names) — unit-tested.
- Army command strip (`src/ui/army.ts`) now drives the shared tooltip instead of
  a bare `title=""`. Every command carries a description + shortcut, and every
  **disabled** command carries a concrete reason (§12):
  - Move → "This formation is currently locked in combat." (M)
  - Attack → "No visible hostile target in range." (A)
  - Retreat → close-combat / encirclement rule (R)
  - Split → "This force is too small to divide." (X)
  - Stop → "No active order to cancel." (S)
  - Extract → "No extractable resource deposit at this position." (E)
- Added **R** (retreat) and **X** (split) keyboard shortcuts to match.
- Disabled command buttons keep `pointer-events: auto` + `cursor: help` so the
  reason is reachable on hover.
- Tests: `tests/tooltip.test.ts` (4), `tests/army-command-ui.test.ts` updated.

### 2. War-confirm ordering fix (`fix(combat): …`) — §33

- The attack acknowledgement (target reticle + order cue + "Attack order
  issued" toast) no longer fires optimistically. It is now a single
  `acknowledgeAttack` closure passed as `onAccepted` to
  `orderAttackArmy` / `orderAttackProvince`.
- `RemoteGameSession.send()` gained an `onAccepted?` callback fired in the
  server-`ok` branch — reached on the plain path *and* after the
  "Declare war?" confirmation re-sends the command. Cancelling the war
  declaration now leaves no misleading "attack issued" toast.
- The optimistic `status:'moving' / moveIntent:'attack'` mutation still
  applies instantly, so the panel + red route read "advancing" with no delay
  on the common (already-at-war) path.
- Tests: `tests/combat-feedback.test.ts` updated (+1).

### 3. 0 A.D. rally cursor + ground-order cursor (`feat(input): …`) — §32

- `cursors/cursor-rally.png` (0 A.D., CC BY-SA 3.0) now shows while a rally
  point is armed on an owned province.
- Move / split / retreat aiming gets a `crosshair` instead of the default
  arrow (0 A.D. has no clean bare "move" cursor to vendor).
- `action-capture` / `action-garrison` stay unwired — there is no capture or
  garrison order in the game, and the prompt forbids fake affordances.
- Actually-surfaced cursor count: attack, no-target, rally, ground-aim.

### 4. Live-apply verification + graphics dev readout (`feat(graphics): …`) — §38–§42

- **Live-apply already works** and is now proven: `renderer.setQuality()`
  re-runs `resize()` (render scale), bumps the camera revision and clears the
  terrain-visibility cache, and every other knob (`propDistanceScale`,
  `treeInstanceBudget`, `buildingInstanceBudget`, `furniture`,
  `terrainLodScale`, `detailFactor`, `rainScale`) is read from the live preset
  each frame. No renderer restart, no fake settings.
- **New:** the 3D-army ⇄ strategic-marker LOD swap distance is now
  preset-scaled (`ARMY_MODEL_RANGE_BASE × propDistanceScale`, floored at 900u)
  — LOW drops to markers at ~855u, ULTRA holds models to ~2375u.
- **New:** `renderer.qualityReadout` getter + two diagnostics lines:
  `preset  prop 1.00x  lod 1.00x  detail 0.75  furniture on`
  `budgets trees 60,000  bldg 40,000  3D army <1900u (12 now)`
  so a preset switch is objectively visible in the F-key diagnostics.
- **Preset matrix** (each adjacent pair differs on ≥4 real knobs — test-guarded):

  | knob | low | medium | high | ultra |
  |---|---|---|---|---|
  | renderScale (abs, ×CSS px) | 0.75 | 1.00 | 1.25 | 1.50 |
  | propDistanceScale | 0.45 | 0.70 | 1.00 | 1.25 |
  | treeInstanceBudget | 9,000 | 22,000 | 60,000 | 400,000 |
  | buildingInstanceBudget | 6,000 | 14,000 | 40,000 | 400,000 |
  | terrainLodScale | 0.85 | 0.82 | 1.00 | 1.18 |
  | detailFactor (shader) | 0.12 | 0.40 | 0.75 | 1.00 |
  | rainScale | 0.35 | 0.60 | 1.00 | 1.00 |
  | road furniture | off | off | on | on |
  | 3D-army LOD range | ~855u | ~1330u | 1900u | ~2375u |

  Note: `terrainLodScale` low (0.85) sits just above medium (0.82) on purpose —
  LOW is meant to be cheaper (render scale / budgets / shader detail), not
  visibly flatter terrain.

---

## Running totals

- `npm run check`: 337 tests / 61 files green (pre-pass baseline 333/60).
- 0 A.D. assets in repo: ~40. Actually surfaced in gameplay HUD: (tracked below.)

## Verdict: NOT SAFE TO REVIEW — pass in progress.
