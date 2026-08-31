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

---

## Running totals

- `npm run check`: 337 tests / 61 files green (pre-pass baseline 333/60).
- 0 A.D. assets in repo: ~40. Actually surfaced in gameplay HUD: (tracked below.)

## Verdict: NOT SAFE TO REVIEW — pass in progress.
