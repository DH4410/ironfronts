# PR merge plan (#29–#42) + `feat/graphics-quality-settings`

For Zoande, tomorrow. **Nothing here has been merged or closed.**

## Summary

- All 14 open PRs (#29–#42) are authored by `DH4410`, target `Zoande:main`,
  and **merge cleanly onto `main` in the recommended order** and cleanly with
  each other (verified with a throwaway sequential test-merge; `npm run check`
  passes on the fully-merged result — 72 tests).
- Only **two** PRs regenerate `public/world/` and need
  `npm run build:world` after merge: **#32** and **#40**.
- **#36 is superseded** by `feat/graphics-quality-settings` (same one line in
  `renderer.ts`).
- Four PRs are deliberately *partial* and leave their tracking issue open:
  **#31** (issue #5), **#34** (#28), **#35** (#7), and #32 covers #4 fully but
  only part of the wider city-visual work.

## Overlap map (files touched)

| File | PRs that touch it |
|---|---|
| `src/renderer.ts` | **#30**, **#36** (+ `feat/graphics-quality-settings`) |
| `src/shaders/terrain.ts` | **#37**, **#42** |
| `scripts/world/*` (regenerates world) | **#32** (`instances.mjs`, `build-world.mjs`), **#40** (`terrain-precompute.mjs`) |
| `tests/shaders.test.ts` | #33, #34, #35, #38, #39 (non-adjacent additions — 3-way merges fine) |
| `src/menu/menu.ts` + `menu.css` | **#29** (+ `feat/graphics-quality-settings`, + `feat/audio-foundation`) |
| `src/shaders/common.ts` | #33 | 
| `src/shaders/lines.ts` | #34 |
| `src/shaders/props.ts` | #35 |
| `src/shaders/waterways.ts` | #38 |
| `src/shaders/polar-caps.ts` | #39 |
| `src/camera.ts` | #41 |
| `src/country-labels/layout.ts` | #31 |
| `src/picking.ts` | #30 |

`#30` and `#36` both edit `renderer.ts` but in **different functions**
(`#30`: pointer-up handler + `captureProvinceAt`→`selectProvinceAt`;
`#36`: `resize()`) — they auto-merge. `#37` and `#42` both edit `terrain.ts`
in **different regions** (`#37`: the `terrain == 3u` canopy block; `#42`: the
rock branches + the lighting term) — they auto-merge, but see "Reconcile after
merge".

## Recommended order

Order is by blast radius / confidence, not by conflict avoidance (there are no
conflicts among #29–#42). Run `npm run build:world && npm run check` after the
two rebuild PRs.

| # | PR | Purpose | Risk | Overlaps | Rebuild world? | Order | Ready? |
|---|---|---|---|---|---|---|---|
| 1 | **#29** | Dossier slides up instead of fading | Low (menu only) | menu.ts/.css with `feat/audio-foundation` + graphics feature (different regions) | no | **1** | Ready — you said this is approved |
| 2 | **#41** | Fix inverted vertical drag-pan | Low (`camera.ts`, 3 sign flips) | none | no | **2** | Ready |
| 3 | **#39** | Polar ice-cap noise scale-up | Low (1 shader hunk) | `tests/shaders.test.ts` | no | **3** | Ready |
| 4 | **#37** | Forest canopy lift (regional) | Low (1 `terrain.ts` hunk) | #42 (`terrain.ts`) | no | **4** | Ready |
| 5 | **#42** | Mountain black-void fix + hillshade + relief noise + forest-floor lift + desert tone | Medium (several `terrain.ts` hunks; new per-fragment noise gated to `< 3200` orbit) | **#37** (`terrain.ts`) | no | **5** (right after #37) | Ready. After both land, fold the canopy + rock + forest-floor lifts into one block (see below). Consider gating the relief noise on `uniforms.weather.z` once the graphics feature is in. |
| 6 | **#33** | Coastline halo / shallow sheen calmed | Low | `tests/shaders.test.ts` | no | **6** | Ready. Reconcile with `feature/in-game-ui-world-polish`'s "Tone down ocean cyan" if that branch is revived — pick one. |
| 7 | **#38** | River edge de-speckle + per-river flow | Low | `tests/shaders.test.ts` | no | **7** | Ready. The underlying per-mask-texel *geometry* is still a quilt — a real fix is a `buildVisualWaterways` rewrite (overlaps `upstream/fix/widen-visual-rivers`); noted in the PR. |
| 8 | **#34** | National vs province border weight at overview | Low | `tests/shaders.test.ts` | no | **8** | Ready. **Partial** — issue #28 stays open (no selection-edge treatment; that needs renderer state, see #30/#14). |
| 9 | **#31** | Map-space country-label size cap | Low | none | no | **9** | Ready. **Partial** — issue #5 stays open (no city-collision avoidance; needs city data threaded into `country-overlay.ts`). |
| 10 | **#40** | Baked prop-AO strengths reduced | Low code, **regenerates world** | **#32** (both regenerate `public/world/`) | **YES** — `npm run build:world` after merge | **10** | Ready. Merge #40 then #32, rebuild once after #32. |
| 11 | **#32** | Reject building footprints over water **+ fewer/spaced city buildings, island hamlets** | Medium — **regenerates world**; whole-map building count 22,188 → ~6,200 (deliberate; verify it isn't too sparse for you) | **#40** | **YES** — `npm run build:world` after merge, *before* trusting `tests/world-data.test.ts` (`npm test` does this automatically; a bare `vitest` will not) | **11** | Ready. If the city thin-out is too aggressive, bump the `(populationScale - 3) * 10` multiplier in `instances.mjs`. |
| 12 | **#35** | Shader city regional LOD + building-lighting floor | Low (shader only) | `tests/shaders.test.ts` | no | **12** | Ready. **Partial** — issue #7 stays open. This is shader-fade only; a true instance-budget LOD now exists in `feat/graphics-quality-settings` (`capVisibleInstances`) — reconcile after both land (the graphics feature should own the instance budget; #35 keeps the per-building height/footprint fade). |
| 13 | **#36** | Cap HiDPI render scale `2 → 1.5` | Low (1 line) | **superseded** by `feat/graphics-quality-settings` | no | **13** — or **close it** | **Needs a decision.** Either close #36 (its cap becomes the Medium/High preset default) or merge it here as a stopgap and let the graphics-settings author drop the duplicated line (~3-line conflict in `resize()`). |
| 14 | **#30** | Map click selects a province instead of capturing it | **Medium–High — behavioural.** Ownership change moves behind `forceCaptureProvinceAt`. No debug UI wired for the new path (noted in PR). | `renderer.ts` with #36 / graphics feature (different functions) | no | **14 (last)** | Ready, but review the interaction change yourself — it changes what a plain click does. |
| 15 | `feat/graphics-quality-settings` | Graphics Quality presets (this task) | Medium — new renderer knobs, new settings UI, new visible-instance budget | `renderer.ts` (**conflicts with #36 only**), `menu.ts`/`.css` (auto-merge with #29), `main.ts`, `index.html`, new `graphics/quality.ts` + `chunk-visibility.ts` | no | **after the stack** | Ready. If #36 was closed, merges clean. If #36 was merged, resolve the 3-line `resize()` conflict (keep the preset version, drop `Math.min(dpr, 1.5)`). |

## Reconcile after merge (not blocking)

- **#37 + #42** — both improve `terrain.ts` readability. Once both are in,
  collapse the canopy lift (#37), the rock/hill lifts + hillshade + relief
  noise + forest-floor lift (#42) into one coherent "terrain readability"
  block, and gate the relief-noise cost on `uniforms.weather.z` (the graphics
  feature's detail factor).
- **#35 + `feat/graphics-quality-settings`** — the graphics feature adds a real
  renderer-side visible-instance budget (`capVisibleInstances`) and preset
  draw-distance scaling. #35's shader-only regional fade should stay for the
  per-building height/footprint shrink; the *count* reduction should be owned
  by the budget. Trim any now-redundant shader culling in #35 after both land.
- **#33 / #34 vs `feature/in-game-ui-world-polish`** — that stale branch has
  "Tone down ocean cyan" and "Mute strategic political palette" commits that
  overlap #33 and #34 in intent. If it is revived, don't apply both.
- **#36 vs `feat/graphics-quality-settings`** — pick one owner of the render
  scale (recommended: the graphics feature).

## Things that stay open after this batch

Issues **#5, #7, #28** (partials #31, #35, #34). Follow-ups noted in the PR
bodies: selection-edge treatment for #28, city-label collision avoidance for
#5, a true `buildVisualWaterways` ribbon rewrite for the river geometry,
road-tiering for #6, coastline terrace/step artefacts, and bridges where roads
cross rivers.
