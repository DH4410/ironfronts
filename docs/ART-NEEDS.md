# Art & animation needs — for Codex

Prioritised list of visual assets the game is currently missing or making do
with. Style reference: the existing painted / stamped-dossier look — muted
field-grey, aged brass, cream type, painterly not flat-vector. Match
`src/ui/assets/units/*.png` (unit portraits) and the irregular generated skins
under `src/ui/assets/skins/`. The old `army-marker-plate.png` is retained only
as a historical reference and must not be used as the current shape template.

Deliver PNGs alpha-trimmed + Lanczos-downscaled (portraits ~384px, icons
~256px, marker/HUD sprites at their used size). Register each new icon in
`src/ui/icons.ts` and credit it in `docs/ASSET_CREDITS.md`.

## P1 — fills a visible gap

| Asset | Where it's used | Notes |
|---|---|---|
| Unit portraits: `militia`, `motorised`, `mechanised`, `paratrooper` | `src/ui/assets/units/<id>.png`, army composition cards | The 6 core roster ids have painted portraits; these four fall back to the generic SVG. Add them if/when the roster can build them. |
| City / settlement icon (`structure-city`) | province card, `structure-city` IconName is registered but has no slot in the UI | Painted walled-town emblem; a `settlement.png` already exists in `assets/icons/ironfronts/` but nothing shows it. Wire a slot + supply final art. |
| Diplomacy panel identity art | `.ifg-dip__header` watermark, empty-state | The cable watermark is generic; a painted foreign-office / telegraph motif would lift it. Optional. |

## P2 — needed if the matching feature lands (see `docs/FEATURE-IDEAS.md`)

| Feature | Assets |
|---|---|
| Air units | plane portraits (fighter, bomber, transport), a top-down plane marker sprite (3–4 heading frames or a rotatable silhouette), a strafing-run / bomb-drop VFX sprite sheet, an airfield building icon |
| Strategic strike / "nuke" | a mushroom-cloud VFX (rising column + flash + shockwave ring — but per the owner's note, *no thin geometric ring*, use volumetric smoke), a warhead / rocket build icon, a scorched-crater decal for the struck province, an alert klaxon SFX |
| Commander characters | 4–6 painted commander portraits (bust, WW2 officer, faction-neutral), rank insignia set (Recruit → …), a medal/ribbon strip |

## P3 — polish

- Terrain LOD: the mountain↔desert boundary stair-steps badly at close zoom — a
  transition/blend texture or a fringe decal would hide it (this is a shader
  fix too, `src/shaders/terrain.ts`).
- Combat SFX: rifle volley, MG, tank cannon, artillery boom, explosion — the
  visuals exist (`src/shaders/combat-effects.ts`), the audio does not.
- Weather: rain already renders; a snow particle + a fog-bank sprite for polar
  provinces.

## Completed 2026-09-09

- Army counters now compose six separate realistic silhouettes and live counts
  over an irregular cartouche; the full tapered roster opens only for a selected
  close-range formation, preventing strategic-map clutter.
- Move / Attack / Retreat / Split / Stop / Extract use painted icons on a wide
  generated command medallion with hover-only text.
- Building/production buttons and queue portraits have dedicated non-square
  generated plaques; building art is larger than unit-production art.
- The low-resolution menu edge, torn map frame, corner, compass, and grid crops
  were replaced with high-resolution, true-alpha generated assets and are no
  longer stretched as whole images.
