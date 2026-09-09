# Army marker redesign handoff

Updated: 2026-09-09

## Goal

Replace the unclear on-map army badge with a Call-of-War-like composited
counter:

- one reusable painted/stamped backplate;
- separate live unit silhouettes;
- exact per-type counts assembled at runtime;
- clear health, owner colour, selected, engaged, and unknown-contact states;
- all six current troop categories remain distinguishable.

`docs/ART-NEEDS.md` was followed for alpha trimming, Lanczos resizing,
small-size legibility, painted/stamped styling, registry, and credits.

## Branch and safety

- Work branch: `feat/callofwar-army-markers-v2`
- Branch point: `82dd821`
- The older `feat/callofwar-army-markers` already existed at an older commit,
  so the `-v2` branch avoids rewriting it.
- Do not continue this work on `main`.
- Preserve the route scratch layout in `src/main.ts`: 8 floats per segment,
  with fraction at +5, retreat at +6, and arrow at +7.

## Implementation

- Six genuine-alpha 96x96 silhouettes: infantry, engineer, armoured car,
  light tank, medium tank, and artillery.
- A six-cell 576x96 runtime atlas at
  `src/ui/assets/army-unit-silhouettes.png`.
- `scripts/prepare-army-marker-silhouettes.mjs` removes baked checkerboards,
  isolates the subject, and Lanczos-downscales each source.
- The six individual sprites are registered in `src/ui/icons.ts`.
- Strategic composition now preserves six exact identities. Close-range 3D
  models remain mapped onto four existing compatible model families.
- Each GPU marker record now uses 28 floats / 7 vec4 values for base data,
  state, six counts, six kinds, and interpolated motion.
- The silhouette atlas is bound at WebGPU binding 16.
- Procedural glyphs were replaced by atlas silhouettes with half-texel UV
  insets to avoid neighbouring-cell bleed.
- The main counter presents the two largest exact categories. At close zoom,
  all six categories fit in a compact two-column, three-row roster.
- The previously prepared `src/ui/assets/army-marker-plate.png` supplies the
  metal counter surface. Owner edge, health bar, selected ring, engaged tab,
  and fog-safe `?` state remain intact.

## Generated source files

Sources are stored outside the repository under:

`C:\Users\dimah\.codex\generated_images\01a07cbe-934b-7b62-bd93-3bfc096b5146`

- `exec-8b31d517-c872-421b-8766-a590e6e29d05.png` - infantry
- `exec-d2ba42d2-553b-48f7-808b-282b609770fa.png` - engineer
- `exec-2f40868d-0e8a-44bc-86a5-ab4d82e7e29c.png` - armoured car
- `exec-adf658f2-014b-4922-8b2b-06220c81c002.png` - light tank
- `exec-fd9f0e44-74cf-4655-980c-92b8c29efb87.png` - medium tank
- `exec-fd69b59e-c232-4e9c-9798-4a4b70b58d73.png` - artillery

Four inputs contained baked checkerboards. The preparation script extracts
their warm bone/charcoal subject masks instead of copying that background.

## Verification completed

- `npx.cmd tsc --noEmit`
- `npx.cmd vitest run tests/army-map-presentation.test.ts tests/shaders.test.ts`
  - 2 files and 36 tests passed
  - Dawn WebGPU semantic shader compilation passed
- `npx.cmd vite build`
- `npm run lint:scripts`
- `git diff --check`
- `npm.cmd run check`
  - all 76 test files and 449 tests passed

Authenticated WebGPU browser verification used a temporary copy of the combat
fixture; the real `data/game.json` was not changed. It confirmed:

- two-category strategic stacks remain legible at map scale;
- all six exact categories and counts fit at close zoom;
- no atlas-cell bleeding is visible;
- health, owner, engaged, selected, and unknown states remain readable;
- command tooltips and existing painted troop portraits still render;
- no browser console errors or Vite error overlay appeared.

Focused capture: `artifacts/qa-army-marker-six-types-grid.png`

The repository visual pass also captured strategic/close/quality states and
`artifacts/qa-ui-army.png` for the existing portrait and command-art audit.

## Main-line check

Both remotes were fetched immediately before publication. `upstream/main` is
an ancestor of this branch and is 35 commits behind its branch point.
`origin/main` has diverged: this line is 43 commits ahead and 7 behind. Those
seven commits also remove many active game systems and art files, so they were
intentionally not merged or rebased into the tested feature work.

The feature branch should be reviewed and merged from its current local-main
lineage rather than force-updating or rewriting either remote main branch.
