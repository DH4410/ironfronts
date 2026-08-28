# Branch status

Snapshot taken while Zoande is away. `origin` = `DH4410/ironfronts` (fork,
where the PR branches live). `upstream` = `Zoande/ironfronts`.
`upstream/main` HEAD = `7ff1e2e`.

**Nothing was force-pushed, no open-PR branch was modified, and no branch that
carries unique unmerged work was deleted.** One branch was deleted: see the
bottom of this file for the proof.

## A. Open-PR branches — KEEP EXACTLY AS THEY ARE

All are `origin/DH4410`, all target `Zoande:main`, all currently `MERGEABLE`
against `main` and merge cleanly in sequence with each other (verified by a
throwaway sequential test-merge). See `PR_MERGE_PLAN.md` for order and overlaps.

| Branch | PR | Base | Unique work | Rebuild `world`? | Safe to delete? |
|---|---|---|---|---|---|
| `fix/dossier-slide-up-from-below` | #29 | `main` | menu dossier slides up instead of fading | no | **No — open PR** |
| `fix/click-selects-province` | #30 | `main` | click selects, not captures; `forceCaptureProvinceAt` | no | **No — open PR** |
| `fix/zoom-aware-country-labels` | #31 | `main` | map-space label size cap | no | **No — open PR** |
| `fix/coastal-buildings-over-water` | #32 | `main` | footprint water rejection **+ lower city building density / island hamlets** | **yes** | **No — open PR** |
| `fix/coastline-halo-overview` | #33 | `main` | shallow-shelf + foam + sheen calmed | no | **No — open PR** |
| `fix/border-hierarchy-overview` | #34 | `main` | national vs province border weight at overview | no | **No — open PR** |
| `fix/city-regional-lod` | #35 | `main` | shader city LOD **+ building-lighting floor (no black cities)** | no | **No — open PR** |
| `perf/lower-hidpi-render-scale` | #36 | `main` | render-scale cap `2 → 1.5` | no | **No — open PR** (but **superseded**, see below) |
| `fix/regional-forest-canopy-blackout` | #37 | `main` | forest canopy lift | no | **No — open PR** |
| `fix/visual-river-fragmentation` | #38 | `main` | river edge de-speckle + per-river flow | no | **No — open PR** |
| `fix/polar-cap-ice-stipple` | #39 | `main` | polar-cap noise scale-up | no | **No — open PR** |
| `fix/soften-prop-ground-ao` | #40 | `main` | baked prop-AO strengths reduced | **yes** | **No — open PR** |
| `fix/pan-vertical-inverted` | #41 | `main` | vertical drag-pan sign fix | no | **No — open PR** |
| `fix/terrain-mountain-blackout` | #42 | `main` | rock lift + hillshade + relief noise + forest-floor lift + desert tone | no | **No — open PR** |

`origin/perf/lower-hidpi-render-scale` (#36) is **functionally superseded** by
`feat/graphics-quality-settings`: that branch replaces the same one line in
`renderer.ts resize()` with a preset-driven render scale (Medium = 1.0,
High = 1.25). Recommendation: close #36, or merge it first as a stopgap and let
the graphics-settings author drop the duplicate line (~3-line conflict). Do
**not** delete the branch while the PR is open.

## B. Active development branches — KEEP

| Branch | Purpose | Open PR | Base | Unique work | Status | Safe to delete? |
|---|---|---|---|---|---|---|
| `origin/feat/audio-foundation` | Audio layer (UI SFX, music director, ambience) **+ the menu crash-resistance work**: compositor-only dossier animation, serialized AudioContext unlock, no hover-triggered unlock, low-cost UI sounds, deferred world renderer. | none yet | `7ff1e2e` (current `main`) | 63 commits, 0 behind. ~30 files incl. `src/audio/*`, `src/menu/menu.ts`, `index.html`, `tests/music-director.test.ts`, `tests/ui-audio-profile.test.ts`. | Active. Not stale. | **No.** Deleting this destroys the audio layer and the menu-freeze fixes. |
| `feat/graphics-quality-settings` | This task: Graphics Quality presets. | opening now (`DH4410:feat/graphics-quality-settings`) | `7ff1e2e` | `src/graphics/quality.ts`, `src/chunk-visibility.ts`, `src/renderer.ts`, `src/main.ts`, `src/menu/menu.ts`, `src/menu/menu.css`, `index.html`, `tests/graphics-quality.test.ts`. | Active. | **No.** |

## C. Temporary review / integration branches — KEEP while useful

| Branch | Purpose | Open PR | Base | Unique work | Status | Safe to delete? |
|---|---|---|---|---|---|---|
| `origin/review/claude-ui-stack` | Combines the audio/menu work with PRs #29–#42 for **combined manual + CI testing**. Adds a combined-UI capture script and a GitHub Actions workflow (`Run automated combined UI review`, tolerant of CI runners without a Dawn GPU adapter). | none (not an upstream PR) | `7ff1e2e` | 83 commits, 0 behind. | Useful right now for end-to-end testing of the whole stack. | **No** while it is being used for review. It is **not** an upstream merge branch — do not convert it into one, do not force-push it. May be rebuilt/updated for testing. |
| `preview-all` (local only, not pushed) | Claude's local integration of `main` + all 14 PRs (+ this feature) for screenshot/perf testing. | n/a | `upstream/main` | none unique — pure merge of pushed branches. | Local scratch. | Local-only; irrelevant to the remote. Rebuilt on demand. |

## D. Stale / superseded branches — documented, NOT deleted (except one, below)

| Branch | Purpose | Open PR | Base | Unique work | Status | Safe to delete? | Notes |
|---|---|---|---|---|---|---|---|
| `origin/feature/in-game-ui-world-polish` | Earlier visual-polish pass: "Reduce dense forest and settlement visual clutter", "Tone down ocean cyan saturation", "Mute strategic political palette", `external-models.test.ts`. | none | `98b3d35` (old — pre menu merge) | **16 commits, 15 behind `main`.** | Stale base. Overlaps in *intent* with #33 (ocean cyan), #34 + #37 (political/forest clutter) but the commits are **not** identical and are **not** merged anywhere. | **No — not proven dead.** | Zoande to decide: cherry-pick anything still wanted, or close. Do not delete until then. |
| `origin/preview-in-game-ui` | Codespaces-preview sibling of the above: "Add one-click Codespaces preview" + two "Sync … into Codespaces preview" commits. | none | `98b3d35` | 14 commits, 15 behind. Includes a `.devcontainer` / one-click preview config not present elsewhere. | Stale base; preview tooling may still be wanted. | **No — not proven dead.** | Keep until Zoande confirms the Codespaces preview is obsolete. |
| `upstream/fix/widen-visual-rivers` | Zoande's earlier river-widening work. | none | — | **Ancestor of `upstream/main`** (its tip is the merge-base with `main`) — i.e. already fully merged. | Merged. | **N/A — it lives on Zoande's repo.** Not ours to touch. | Mentioned only for completeness. Leave it for Zoande. |

## Branch deleted

**`origin/feature/dossier-main-menu`** — deleted from the `DH4410` fork.

Proof it was provably dead and safe:

- `git rev-list --count upstream/main..origin/feature/dossier-main-menu` → **0**
  (every commit on the branch is already in `upstream/main`).
- Its tip `20c11ab` is an ancestor of `upstream/main`; it was merged via
  `Zoande/ironfronts` **PR #3** ("Merge pull request #3 from
  DH4410/feature/dossier-main-menu", commit `3d70004`), which is closed.
- No open PR references it (`gh pr list --state open` → only #29–#42).
- No other branch is based on it: `feat/audio-foundation`,
  `review/claude-ui-stack`, and every `fix/*` PR branch have merge-base
  `7ff1e2e` with `main`, not `20c11ab`.
- Fully recoverable — every commit remains in `upstream/main` history; the ref
  can be re-created with `git branch feature/dossier-main-menu 20c11ab` if ever
  wanted.

Nothing else was deleted. When in doubt, the branch was kept and documented.
