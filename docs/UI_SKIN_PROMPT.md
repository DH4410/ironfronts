# Ironfronts UI skin prompts (for ChatGPT / OpenAI image generator)

Goal: replace every **flat square / rectangle fill** in the HUD with a
hand-painted "field-command" surface, the way 0 A.D. frames its panels — but
original art, WW2 grand-strategy, no 0 A.D. / Call of War pixels copied.

> **Status:** codex already generated a first set of these (see
> `docs/ASSET_CREDITS.md` → "Irregular field-command UI skins") and is wiring
> them in. Use this doc to regenerate any piece you want to redo. Keep the
> **filename and pixel size** below exactly, so the new PNG drops straight into
> `scripts/prepare-generated-ui-skins.mjs` and `src/ui/assets/skins/`.

---

## Shared art direction (paste into every prompt)

```
Style: original hand-painted militaria for a historical WW2 grand-strategy game
UI, in the spirit of 0 A.D.'s framed panels. Materials only: soot-blackened
iron, chipped field-green enamel over steel, worn oil-rubbed leather, oxidised
brass fittings, bone-pale edge wear where paint has rubbed through. Lighting:
soft top-left studio light, matte finish, subtle grain, no gloss. Era-accurate
1939-1945 proportions and hardware. Muted palette: iron grey #2b2b28, enamel
green #3f4a3a, brass #b08d52, bone #d8c9a4, near-black #1a1815.

Hard constraints: PNG with a genuine transparent background (real alpha, not a
checkerboard drawn in). NO text, letters, numbers, glyphs, icons, national
flags, insignia, unit symbols, logos, watermarks or signatures. NO rounded
"mobile game" bevels, NO glossy plastic, NO neon, NO fantasy filigree, NO
scenery or background illustration. Centered, symmetrical, evenly lit, filling
the canvas with only a few transparent pixels of margin unless told otherwise.
```

---

## A. `hud-panel-frame.png` — 1024×512 (delivered), downscaled to 512×256

**Covers (this is the big one — "the tab above", the province panel, the message
toasts, every dialog):** top strategic bar, province info card, army detail
panel, diplomacy panel, command confirm dialog, campaign/settings overlay card,
**notification toast**.

Used as a CSS **nine-slice** border (`border-image-slice: 42 fill`), so the art
must be a **hollow rectangular frame**: decorated edges and corners, and a
**flat, near-uniform centre fill** that will be stretched behind arbitrary
content. The middle 60% horizontally and vertically must stay plain so text
stays readable on top of it.

```
A rectangular field-command panel frame, landscape, filling the canvas edge to
edge. A riveted soot-iron border about 12% of the width thick on every side,
with brass corner brackets and a few flush rivets. The large inner area is a
single flat sheet of chipped dark field-green enamel over steel, matte, with
faint scuffing and a slightly darker vignette at the very edge of the border —
but essentially uniform so UI text sits on it cleanly. No inner panels, no
dividers, no hardware crossing the middle. Transparent outside the outer rivet
line. Corners squared, not rounded.
```

## B. `hud-action-ribbon.png` — 1024×342 (delivered), downscaled to 512×171

**Covers:** every button and pill — province actions, diplomacy actions, dialog
buttons, army stance buttons, status chips, battle-side readouts, tooltips.

Also a **nine-slice** (`slice: 42 76 fill`), wider horizontal slice. A short,
wide **horizontal plaque**: worn brass end-caps left and right, flat leather or
dark-enamel middle band that stretches. Middle must be plain.

```
A long low horizontal control plaque, landscape ~3:1. Oxidised brass end-caps
with a single rivet each, joined by a flat band of worn oil-rubbed dark leather.
Matte, softly lit, gently domed so it reads as a physical key. The central 70%
is an unbroken flat band with only faint grain — no stitching pattern across the
middle, no text, no icon. Transparent above and below the plaque. Squared ends.
```

## C. `hud-control-plate.png` — 512×394 (delivered), downscaled to 256×197

**Covers:** square icon buttons — dock buttons, top-bar system button, card icon
buttons, army command buttons, build-structure tiles.

**Contained** (not stretched): art stays a fixed shape centred in the button,
with a live icon drawn on top. Slightly taller than square.

```
A single squarish field-command medallion / control key, centred, ~1.3:1
portrait. Soot-iron plate with a raised brass rim, four corner rivets, a shallow
flat recessed centre of chipped green enamel where a symbol would be stamped —
but leave that centre BLANK and flat. Matte, soft top-left light, subtle wear on
the rim. Small soft contact shadow under it. Transparent everywhere else.
```

---

## D. Army-map skins (world-space troop counters — regenerate only if redoing the map markers)

### `army-counter-cartouche.png` — 1024×768 → 256×192
```
An irregular winged army marker cartouche seen from straight above, landscape
4:3. A soot-iron shield-ish plaque with soft asymmetric brass wings sweeping
left and right, a bone-worn raised rim, a broad FLAT blank centre of chipped
field-green enamel for a number and silhouette to be drawn on later. Painted
militaria, matte, top-left light. Transparent background, small margin.
```

### `army-roster-plaque.png` — 1024×1280 → 256×320
```
A tall vertical composition plaque, portrait 4:5, for a stacked list of six unit
rows. A leather-backed iron board with a brass top bar and bottom bar, plain
flat dark-green enamel field between them, faint horizontal wear lines but no
printed dividers. Matte, top-left light. Transparent background.
```

### `army-unit-card-frame.png` — 1024×1365 → 256×341
```
An arched portrait surround, portrait 3:4, like a framed field photograph. Heavy
soot-iron arch top, straight iron sides and base, brass corner tacks, bone edge
wear. The inner opening is a clean arched hole (fully transparent) where a unit
portrait will show through. Only the frame is painted. Transparent outside the
frame too.
```

The matching `army-unit-card-mask.png` is derived automatically by
`scripts/prepare-generated-ui-skins.mjs` from the frame's alpha — no separate
generation.

---

## After you have the PNGs

Put each source PNG somewhere and run (sizes = the "downscaled to" numbers above):

```
node scripts/prepare-generated-ui-skins.mjs \
  hud-panel-frame=panel.png@512x256 \
  hud-action-ribbon=ribbon.png@512x171 \
  hud-control-plate=control.png@256x197 \
  army-counter-cartouche=cartouche.png@256x192 \
  army-roster-plaque=roster.png@256x320 \
  army-unit-card-frame=unitframe.png@256x341
```

It alpha-trims, premultiplied-Lanczos-downscales, and writes into
`src/ui/assets/skins/`. No code change needed — the CSS variables in
`src/ui/game-ui.css` already point at those filenames.
