# Feature ideas — design sketches

Requested directions: "add more features — characters, planes, nukes". These
are each a multi-session build; sketched here so implementation starts from a
spec, not a blank page. The sim is authoritative (10 ticks/s, `src/game/**`),
browser-free game-core in `packages/game-core` + `src/game`, projected per
player through `src/game/player-view.ts`.

## 1. Air units (medium build)

**Concept:** a third movement layer. Planes fly from an owned **airfield**
building, have a large operating radius, and return to base to rearm.

- **Data:** new `category: 'air'` in `src/game/units/unit-catalog.ts`
  (`fighter`, `bomber`, `transport`). New `airfield` building in the building
  catalog + `requiredBuilding: 'airfield'`.
- **Movement:** planes ignore the land road graph — straight-line travel with
  a fuel/range limit measured from the home airfield. Add an `air` branch in
  `src/game/units/movement.ts` that does not call `movementEdgeAllowed`.
- **Combat:** a bomber over an enemy stack/province runs a **strike** (one
  damage pulse, then must fly home) rather than joining a front. Fighters
  intercept enemy air over friendly territory.
- **Fog:** planes are `VISIBLE` far wider than ground vision; a plane over
  your land is always at least `CONTACT`.
- **Render:** new marker sprite (heading-rotated), reuse `combat-effects`
  kind 6 for the bomb hit. Small 3D model optional.
- **Risk:** interception/air-superiority rules can balloon; ship strike-only
  first, add fighters later.

## 2. Strategic strike / "nuke" (small–medium build)

**Concept:** a one-shot, long-cooldown province-wipe. Deliberately rare.

- **Data:** a `warhead` item built at an `ordnanceWorks` (exists) over a long
  build time and high `metal`/`oil`/`funds` cost. Stored as a per-country
  `warheads: number` count, not a unit.
- **Order:** a new targeting mode (`main.ts`), click an enemy province →
  confirm dialog → `session.orderStrike(provinceId)`. Server: consume one
  warhead, destroy every stack in the province, drop the province's health /
  buildings, mark it scorched for N game-days (movement/vision penalty).
- **Diplomacy:** using one auto-declares war and applies a global relations
  penalty with everyone.
- **Render:** `combat-effects` — a new kind or an amped kind 6: rising
  volumetric smoke column + white flash + heat haze. **No thin geometric
  ring** (owner's standing note). A scorched decal on the province.
- **Save:** `warheads` and `scorchedUntilTick` are additive `GameState`
  fields — default them on load, do **not** bump `GAME_VERSION`, so existing
  campaigns survive (`apps/game-server/src/main.ts:25` gates on version/id,
  not shape).

## 3. Commander characters (small build, mostly UI + persistence)

**Concept:** the menu already shows `Dimatest1 / LEVEL 1 · RECRUIT`. Make it
real: the commander gains XP from battles won and provinces taken, levels up,
and picks one passive perk per few levels (e.g. +5% infantry defence,
−10% build time, +1 vision).

- **Persistence:** commander XP/level/perks live in the auth/profile store
  (per account, across campaigns) — see the `feat/campaign-flow` branch which
  already started "real persisted commander progression".
- **Hook:** award XP in `stepCombat` / `stepCapture` events, surfaced to the
  client, tallied client-side against the profile.
- **UI:** expand the top-right commander chip into a small "service record"
  popover — portrait, level bar, perk list. Art: `docs/ART-NEEDS.md` P2.
- **Balance:** keep perks small (single-digit %) so multiplayer stays fair.

## Suggested order

Nuke (most contained, biggest "wow") → Commander characters (low risk, mostly
UI) → Air units (largest, do last).
