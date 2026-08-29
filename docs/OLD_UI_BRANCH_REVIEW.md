# Review — `origin/feature/in-game-ui-world-polish`

Reviewed 2026-08-28 while building the in-game command UI v2. **Nothing on
that branch was merged.** It is a broad, stale branch (merge-base
`98b3d35`, 15 commits behind `main`) whose renderer/world commits overlap
newer PR work; only its UI *concepts* were considered.

## What it contains

| Area | Files | Verdict |
|---|---|---|
| Strategic in-game HUD | `src/game-ui.ts` (195 lines), `src/game-ui.css` (277 lines) | **Concepts reused, code rewritten** — see below |
| CC0 external model loader | `src/external-models.ts`, `ASSET_SOURCES.md`, `tests/external-models.test.ts`, `scene-meshes.ts` edits | **Rejected here.** Out of scope for UI; remote model loading is a separate call for Zoande. |
| World-visual tuning | `scripts/world/instances.mjs`, `political-palette.mjs`, `shaders/lines.ts`, `shaders/water.ts`, `country-labels/*` | **Rejected.** Overlaps #32/#33/#34/#37 in intent, different code, stale base. Already flagged in `BRANCH_STATUS.md` §D. |

## HUD: reused vs replaced

### Reused (as ideas, re-implemented in `src/ui/`)

- **Overall information architecture** — top strategic bar with country +
  world-time + weather; a bottom "field report" panel for the selected
  province; a map-mode control that mirrors the renderer. v2 keeps this
  shape and adds the left nav rail, notifications and pause overlay the
  task asks for.
- **War-room visual register** — square geometry, brass hairlines, cream
  type, `<small>` overline + value pairs. v2's `game-ui.css` is a fresh
  sheet in the same language, wired to the global `--hud-*` tokens.
- **"Pin on click, follow hover only if it matches"** selection feel.
- The `#hud-inspector` "F3" affordance → v2 keeps an inspector button,
  but only when `debugEnabled`.

### Replaced / explicitly rejected

- **The entire state-acquisition architecture.** The old HUD derives every
  value by `MutationObserver` on debug DOM:
  `#debug-player-country`, `#debug-country-flag`, `#debug-time-state`,
  `#debug-rain`, and it parses the `#tooltip` text (`" · "` splitting) to
  reconstruct hover/selection. v2 does **none** of this. It consumes a
  typed `StrategicUiState` published from `main.ts`, which is fed by real
  renderer events — `onProvinceSelected` (PR #30), `onDiplomacyChange`,
  `onTimeOfDayChange`. `grep -R "MutationObserver" src/ui` is empty.
- **Synthesising selection from the tooltip.** v2 selection comes from
  `renderer.onProvinceSelected` / `renderer.selectedProvinceId`, and the
  map now draws a real selected-province outline (border shader reads the
  id from `weather.w`).
- **Clicking hidden radio inputs to change map mode.** The old code finds
  `input[name="map-mode"]`, sets `.checked` and dispatches a synthetic
  `change`. v2 calls `renderer.setMapMode()` directly through one
  `setMapModeUnified()` in `main.ts` that also keeps the legacy fieldset
  in sync (the fieldset stays in the DOM but is `hidden`).
- **`src/game-ui.ts` / `src/game-ui.css` at the source root.** v2 lives in
  `src/ui/` as `ui-state.ts` + `game-ui.ts` + `game-ui.css` + `army.ts`,
  no single giant file.
- Country-name / clock formatting that read from debug text nodes — v2
  formats from `renderer.getTimeOfDay()` and `DiplomacyState`.

## Recommendation

Leave `feature/in-game-ui-world-polish` as-is for Zoande to cherry-pick
the external-model loader from if still wanted. The HUD portion is
superseded by `src/ui/*` on `feat/in-game-command-ui-v2`.
