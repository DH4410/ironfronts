# Diplomacy feature handoff

Completed on 2026-09-07, integrated with the RTS icon and production-queue work,
and reverified on 2026-09-08.

## Git state

- Published branch: `feat/rts-icon-controls`
- Canonical base/tracking ref: `upstream/main`
- Upstream base at final verification: `d64ec60`
- Do not merge `origin/main` blindly; it was a divergent fork while this work was developed.

## Delivered

- A left-side, non-modal **Diplomatic cables** drawer attached to the command dock.
- Country ledger with `Neutral`, `Allied`, and `At war` relationship states, unread/proposal attention counts, and player/AI availability handling.
- Private player-to-player diplomatic messages retained in the authoritative save state.
- Alliance and peace proposals with accept/decline responses, plus declare-war and end-alliance actions.
- Authenticated command routing over the existing game WebSocket used by the deployed/Raspberry Pi service; no separate Pi-only API exists in this repository.
- Viewer-filtered server projections so only message/proposal participants receive their diplomatic records.
- Incoming-message/proposal and proposal-resolution notifications.
- Responsive 640 px layout, keyboard/focus handling, Escape-first closing behavior, reduced motion, and a generated cable watermark.
- Production packaging for `public/ui` assets.

## Verification completed

- Combined-branch `npm run check`: 75 files / 441 tests passed, including workspace typechecks, ESLint, and architecture checks.
- Focused diplomacy UI check after final fixes: 7 tests passed.
- Full production world/client build completed; a follow-up Vite production build confirmed the UI asset at `dist/ui/diplomatic-cable-watermark.png`.
- Two isolated browser users claimed Finland and Poland. Poland sent a cable and alliance proposal; Finland received both and accepted; both clients changed to `Allied`. The alliance was then ended and war declared; both clients changed to `At war` and exposed `Offer peace`.
- Desktop and 640 px responsive screenshots: `artifacts/diplomacy-window-desktop.png` and `artifacts/diplomacy-window-mobile.png`.
- Browser page-error checks were empty.
- Scoped axe audit: 0 violations (contrast remained inconclusive because textured gradients prevent automatic background calculation).
- Escape closed the drawer without also opening the system overlay.

## Generated asset

- `public/ui/diplomatic-cable-watermark.png`
- Generated with the built-in image generator as a transparent, sparse 1939 dossier-style sealed envelope with two radio arcs in aged brass and field cream.
- Provenance is recorded in `docs/ASSET_CREDITS.md`.

## Runtime note

The browser QA stack used isolated ignored data under `artifacts/diplomacy-e2e-runtime-20260907-2024`; it did not touch the normal `data/` save or account database, and the temporary runtime data was removed after verification.

---

## Follow-on (2026-09-08, Claude)

- `feat/callofwar-army-markers` (`dc31b1b`, painted marker plate) is folded
  into local `main` = the consolidated line. It had one broken WGSL test
  (`textureSample` in non-uniform control flow after conditional discards);
  fixed with `textureSampleLevel`. If you resume the marker branch, rebase it
  onto `main` first — `main` is ahead.
- **`docs/ART-NEEDS.md`** — prioritised list of icons / portraits / VFX / SFX
  to generate. Start at P1.
- **`docs/FEATURE-IDEAS.md`** — design sketches for planes / strategic-strike
  / commander progression, each with save-compat + balance notes.
- Diplomacy panel got a clarity pass (stance-count summary, relation sort,
  bold colour chips, a name filter for the ~200-country roster).

### Strategic strike / "nuke" shipped (`9902a61`)

- Nation-level order: press **N** (arms if a warhead is ready) → click an enemy
  province → confirm. Spends one warhead, destroys every stack within 95 world
  units of the aim point (owner-agnostic — friendly fire is intended), knocks a
  tier off the province's buildings, voids its queues, forces war with the owner.
- `CountryState.warheads` is optional/additive, defaulted in `GameSession.restore`,
  seeded to 1 for selectable powers in `scenario-init`, accrued by `stepWarheads`
  (one per Ordnance Workshop level / ~18 game-days, cap 3). **No `GAME_VERSION`
  bump** — existing saves load with 0 and must build an Ordnance Workshop.
- VFX is a placeholder: a cluster of the existing kind-6 explosion + long-lived
  smoke. **Codex art:** the P2 "mushroom-cloud VFX" + "warhead / rocket build
  icon" in `docs/ART-NEEDS.md` are the real deliverables — the warhead HUD chip
  currently borrows `structure-ordnance`.
- Known gap: a *third* country whose stack sits in the blast loses it with no
  event routed to them (`eventsForCountry` only notifies attacker/defender), so
  their replica just drops the army. Cosmetic until someone reads it as a
  desync — widen the strike event's recipient set if it matters.
