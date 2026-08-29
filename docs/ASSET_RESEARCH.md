# Asset & visual-reference research

Research-only working document. It gathers (1) Call of War gameplay/UI mechanics as a
*design reference*, (2) concrete, licence-checked candidate assets for an original
WW2 grand-strategy army/production UI, (3) an inventory of what is already vendored
in this repo, and (4) a shortlist for a first unit roster.

No Call of War art, screenshots, sprites or icon files are referenced or reproduced
here — only mechanics text and public wiki page URLs. Call of War is proprietary;
this document treats it strictly as a mechanics reference, not an art source.

---

## 1. Call of War systems (REFERENCE ONLY — do not copy proprietary art)

Primary source: the official Bytro wiki at `wiki.callofwar.com` (the Fandom wikis
`call-of-war.fandom.com` / `call-of-war-by-bytro.fandom.com` are mostly empty stubs
and were only used for the Structures/Units/Provinces overview lists).

Pages read:

- ARMY CONTROLS — <https://wiki.callofwar.com/wiki/ARMY_CONTROLS>
- COMBAT — <https://wiki.callofwar.com/wiki/COMBAT>
- CONSTRUCTION & PRODUCTION — <https://wiki.callofwar.com/wiki/CONSTRUCTION_%26_PRODUCTION>
- BUILDINGS — <https://wiki.callofwar.com/wiki/BUILDINGS>
- UNITS — <https://wiki.callofwar.com/wiki/UNITS>
- MAIN INTERFACE — <https://wiki.callofwar.com/wiki/MAIN_INTERFACE>
- RESOURCES & MARKET — <https://wiki.callofwar.com/wiki/RESOURCES_%26_MARKET>
- MORALE & UPRISING — <https://wiki.callofwar.com/wiki/MORALE_%26_UPRISING>
- ESPIONAGE — <https://wiki.callofwar.com/wiki/ESPIONAGE>
- FAQ — <https://wiki.callofwar.com/wiki/FAQ>
- Structures (Fandom overview) — <https://call-of-war-by-bytro.fandom.com/wiki/Structures>
- Units (Fandom overview) — <https://call-of-war-by-bytro.fandom.com/wiki/Units>
- Provinces (Fandom overview) — <https://call-of-war-by-bytro.fandom.com/wiki/Provinces>

### 1.1 Army controls

Source: ARMY CONTROLS, FAQ.

**Selecting.** Click/tap an army to select it; the army interface opens as a bar at
the bottom of the screen. Double-click an army selects every army made of the same
unit types. Multi-select: Shift+click additional armies on desktop, or **hold the
RIGHT mouse button and drag a lasso circle** around several armies (mobile: tap-hold
and draw the circle). "Add Army" is the mobile equivalent of Shift+click.

> **Divergence from the task brief.** The brief says "right-click orders, drag-move."
> Call of War is the opposite: **left-button hold-and-drag** on an army issues the
> move / attack / patrol order (drag the cursor to the target location); the
> **right-button drag** is the lasso *selection* tool. Adopt the left-drag-to-order
> binding for Ironfronts unless there is a reason to deviate. There is also a
> "snapping" behaviour: an army within distance 5 of an enemy army or enemy province
> centre jumps directly onto it when it receives its next command, skipping the
> remaining travel time.

**Commands** (availability depends on unit types in the army and its current
activity):

| Command | Effect |
|---|---|
| **Move** | Click button then a map location, or left-drag. Moves there, close-combats anything hostile encountered along the path. Also used to walk into and capture provinces. |
| **Attack** | Select an enemy army or province; army closes to range and attacks, close-combatting other targets on the way. Can also re-point an ongoing attack to another in-range target. |
| **Patrol** | Aircraft only. Fly to a point and orbit; every 15 min the patrol damages all enemy troops in the patrol radius for 50% strength and creates an espionage snapshot of them. |
| **Add Army** | Adds another army to the current selection so one order goes to several armies (mobile; Shift+click / right-drag on desktop). |
| **Delay** | Only while already moving. Pauses the army for a set time before it continues — used to synchronise arrivals. Select several moving armies + Delay with the timer untouched and the game auto-computes each delay so they all arrive together. |
| **Add Target** | Only while already moving; not for aircraft. Appends a waypoint; the army chains through waypoints. Used to pre-plan a route around threats or to queue conquests while offline. |
| **Forced March** | Toggle; only while moving; not aircraft. +50% movement speed, −5% HP per hour. For racing an enemy to a point or catching a fleeing one. |
| **Stop** | Halts all current orders and movement; sends aircraft back to base. Only available for abortable orders that do not lock the army in place. |
| **Split** | Only if the army has >1 unit. Opens a picker to peel specific units into a new army, which can immediately be given its own order. Used to optimise stack composition or send damaged units back to heal. |
| **Upgrade** | Upgrades all eligible units to the highest researched level. Costs 50% of the target level's resources and 50% of its minimum production time. Cannot be stopped once started; units are immobile and defence-only while upgrading. |
| **Convert** | Currently Paratroopers only — swap between infantry form and aircraft form. Immobile while converting. |
| **Fire Control** | Premium ("High Command") only. Sets the engagement stance of ranged units, submarines and destroyers (see 1.7). |

There is **no separate "delimit" command** — the closest real commands are Delay and
Add Target.

**Army bar contents** (per ARMY CONTROLS): army name + army ID; owner country name,
flag and coalition; a green/red dot for human vs AI control; the doctrine banner;
current activity + a countdown timer to the next order execution; a per-unit-type
grid (each square = one unit type, showing armour class, count and HP); an info
button opening full damage tables. The status line shows: highest damage value and
which armour class it is best against (= preferred target); protection value
(fortification / home-defence damage reduction); current unit count with a **warning
icon once the count exceeds 10** (see 1.8); current movement speed (set by the
slowest unit; a warning appears if a sub-50%-HP unit is dragging the stack down);
total HP, which becomes a gold "heal 10% of missing HP" button when damaged.

### 1.2 Provinces

Sources: PROVINCES (Fandom), BUILDINGS, MORALE & UPRISING, FAQ.

- A nation is a set of **provinces**, each named after its city. Two kinds:
  **urban provinces** (cities) and **non-urban / rural provinces** (Plains, Forest,
  Hills, Mountains terrain). **Water provinces** have centres and routes like land
  but are owned by nobody and can hold no buildings or production.
- **Units can only be produced in urban provinces**, and most buildings are
  urban-only. Rural provinces still take economy and support buildings.
- **Core provinces**: the provinces a nation starts with. Core provinces give better
  morale and resource output, and grant the **Home Defence bonus** to friendly
  armies fighting in them: +15% damage potential *and* +15% damage reduction.
  Non-core = conquered territory or ownerless colonies. In balanced scenarios every
  territory is usually core; in historical scenarios some nations hold non-core
  colonies.
- **Resource output**: every province yields Money and Manpower; only some yield one
  of the five stockpile resources, and those are marked on the map with that
  resource's icon (urban provinces show a doubled icon = higher output). Output
  scales with province **morale** and with the level of Industry / Local Industry.
- **Morale** (0–100%). Drives resource, money and manpower output; unit production
  time and building construction time (below 80% morale everything is slowed; only
  ≥80% produces at the minimum time); the uprising chance; and the morale push/pull
  on neighbouring provinces. Target morale = 102 − (negative influences) +
  (positive influences); each day-change the value moves 15% of the way toward
  target. Influences include distance from the Capitol, neighbouring-province
  morale (helpful if neighbours are ≥80%, harmful below), number of bordering enemy
  provinces, total province count (an expansion penalty), Propaganda Office level,
  resource shortages, and nuclear fallout.
- **Immediate morale events**: conquering any province drops it to **25%**;
  conquering an enemy Capitol instantly −20% to all that nation's provinces and
  +10% to all of yours (and you take half their stored Money); direct attacks on a
  province chip its morale each combat round.
- **Uprising / revolt**: below **31% morale** a province may revolt at day-change
  (lower morale ⇒ higher chance). A revolt can flip the province and/or its
  garrison to a neighbour, damage the garrison and buildings, etc. Stationing units
  in the province centre suppresses it (more garrison strength ⇒ lower chance).
  Revolt-risk provinces show a smoke column and red hatching on the map.

### 1.3 Construction & production

Source: CONSTRUCTION & PRODUCTION, FAQ.

- Select a province → **Construction** button opens the build menu on the buildings
  tab; **Production** button opens it on a unit tab (production only offered in
  urban provinces).
- Build cost is paid **up front** when the order starts. Only **one unit at a time**
  can be produced per province; further orders **queue** (build queue beyond the
  current item is a Premium feature). Buildings and units queued across several
  provinces are prioritised by queue order.
- Build/production time is **increased when province morale < 80%** (a penalty
  warning is shown).
- A running build can be **sped up with Gold** — each press skips 12 h of build
  time.
- **Production-building level halves unit production time per level**, down to the
  unit's **minimum production time**. Rule of thumb: production building level =
  unit level ⇒ minimum time (going higher does nothing). Higher unit levels
  roughly double build time per level, so the production building has to be levelled
  in step.
- Multi-province building: select several provinces (province list checkboxes, or
  Ctrl+click on the map) and the build menu acts on all of them at once; "smart"
  construct picks the next available level per province.

### 1.4 Buildings

Source: BUILDINGS. Effects scale with level; exact numbers are in the in-game info
popup and are deliberately omitted here.

**Urban-only:**

| Building | Effect | Build resources |
|---|---|---|
| **Barracks** | Required to produce **Infantry**-category units. Each level halves production time to the minimum. | Food, Goods, Metal |
| **Ordnance Foundry** | Required to produce **Ordnance** units (larger-calibre support: anti-tank, artillery, anti-air, SP variants). Each level halves production time. | Food, Goods, Metal |
| **Tank Plant** | Required to produce **Armor** units. Each level halves production time. | Metal, Oil, Rare Materials |
| **Aircraft Factory** | Required to produce **Air** units; lets aircraft take off/land; reduces refuel time. Each level halves production time. | Goods, Metal, Rare Materials |
| **Naval Base** | Shoreline urban only. Required to produce **Naval** units; reduces embark/disembark delay on that shore. Each level halves production time. | Goods, Metal, Oil |
| **Secret Lab** | Required to produce **Secret** units; its level is hidden from other players. Each level halves production time. | Food, Oil, Rare Materials |
| **Industry** | Raises resource + money output of the province. | Metal, Oil, Rare Materials |
| **Bunkers** | Cuts damage to units in the province centre; level ≥3 also **hides the composition** of the garrison (revealable by certain scout units). | Food, Goods, Metal |
| **Capitol** | The national capital. Provinces farther from it lose morale; losing it drops all your provinces' morale, raises the conqueror's, and hands them a share of your Money. One per nation, movable. | Food, Goods, Metal |

**Rural-only:**

| Building | Effect | Build resources |
|---|---|---|
| **Local Industry** | Rural counterpart of Industry — raises resource + money output. | Metal, Oil, Rare Materials |
| **Airstrip** | Lets aircraft take off/land in a rural province; each level cuts refuel time. | Goods, Metal, Rare Materials |
| **Fortifications** | Rural counterpart of Bunkers — cuts damage to centre units; level 3 hides garrison composition. | Food, Goods, Metal |
| **Local Port** | Shoreline rural only. Cuts embark/disembark delay on that shore. | Goods, Metal, Oil |

**Any province:**

| Building | Effect | Build resources |
|---|---|---|
| **Infrastructure** | Raises movement speed of units anywhere in the province. | Food, Goods, Oil |
| **Propaganda Office** | Adds a positive modifier to province morale. | Food, Goods, Rare Materials |
| **Recruiting Station** | Raises the province's Manpower output. | Food, Goods, Metal |

> Note the naming: Call of War splits the "recruiting office" idea into two
> different buildings — **Recruiting Station** (manpower output) and **Propaganda
> Office** (morale). "Barracks" is only the infantry production building.

### 1.5 Units — early-war roster

Source: UNITS. Category → production building: Infantry → Barracks; Ordnance →
Ordnance Foundry; Tanks/Armor → Tank Plant; Aircraft → Aircraft Factory; Naval →
Naval Base; Secret → Secret Lab. Values below are the wiki's **relative** words
(Very low … Very high), not numbers.

**Infantry (Barracks):**

| Unit | Role | Armour class | Speed | Cost | Notable |
|---|---|---|---|---|---|
| **Militia** | Last-ditch defence, ambush | Unarmoured | Very slow | Very low | Stealth in forest/hills/mountain/urban. Low HP. Early game. |
| **Infantry** | Backbone of armies, city defence | Unarmoured | Slow | Very low | No special. Prefers urban/mountain, defensive. Early game. |
| **Motorized Infantry** | Scouting, fast offensives | Unarmoured | Fast | Medium | **Reveals stealth units on land, larger view range.** Uses Oil. Early game. |
| **Mechanized Infantry** | Versatile attack/defend | Light armour | Fast | Medium | Mid game. |
| **Commandos** | Behind-the-lines, assault fortifications | Unarmoured | Slow | High | Stealth on all land terrain; ignores enemy defence bonuses. Mid game. |
| **Paratroopers** | Behind-the-lines drop / ambush | Aircraft ↔ Unarmoured | — | High | Converts between aircraft and infantry form. Mid game. |

**Ordnance (Ordnance Foundry):**

| Unit | Role | Armour class | Speed | Cost | Notable |
|---|---|---|---|---|---|
| **Anti-Tank** | Stop tank attacks, ambush | Unarmoured | Slow | Low | Best vs light & heavy armour; stealth in forest/hills/urban; defensive. Early game. |
| **Artillery** | Bombard armies & fortifications | Unarmoured | Slow | Medium | **Ranged attack** (medium range); very low HP; best vs heavy armour. Early game. |
| **SP Artillery** | Mobile bombardment | Light armour | Fast | High | Ranged; self-propelled artillery. Mid game. |
| **Anti-Air** | City air defence | Unarmoured | Slow | Low | Best vs aircraft; defensive. Early game. |
| **SP Anti-Air** | Mobile air defence | Light armour | Fast | Medium | Mid game. |

**Armor (Tank Plant):**

| Unit | Role | Armour class | Speed | Cost | Notable |
|---|---|---|---|---|---|
| **Armored Car** | Scouting, mobile defence | Light armour | Fast | Medium | **Reveals stealth units on land, larger view range.** Best vs unarmoured; prefers plains. Early game. |
| **Light Tank** | Fast offensives | Light armour | Fast | Medium | Best vs light armour; prefers plains. Early game. |
| **Medium Tank** | Break through enemy lines | Heavy armour | Medium | High | High HP; best vs light armour. Mid game. |
| **Heavy Tank** | Breakthrough + versatile | Heavy armour | Slow | Very high | Very high HP. Mid game. |
| **Tank Destroyer** | Stop tank attacks, mobile defence | Heavy armour | Medium | High | Best vs heavy armour; defensive. Mid game. |

Rough relationships to carry into Ironfronts: cost and HP climb
militia < infantry < motorized/armored-car < light tank < medium tank <
heavy tank; speed is highest for motorized infantry / armored car / light tank and
lowest for militia, heavy tank, static artillery; scouting/vision is the special
property of **motorized infantry and armored cars** (and aircraft); artillery trades
almost all HP for stand-off range; anti-tank and militia trade mobility for cheap
defensive value and terrain stealth.

Later categories (Air: Interceptor, Tactical/Attack/Strategic/Naval Bomber; Naval:
Destroyer, Submarine, Cruiser, Battleship, Carrier, Transport; Secret: Rocket
Artillery, Railroad Gun, Flying Bomb, Rocket, Nuclear Bomber/Rocket) are out of
scope for a first roster but follow the same "category needs its building" rule.

### 1.6 Main interface

Source: MAIN INTERFACE.

- **Top resource bar**: current **stockpiles** of each resource plus the **Gold**
  balance. Hover (desktop) / tap (mobile) a resource for its production vs
  consumption rate. Clicking Gold opens the shop. A **day-change countdown** sits in
  a corner (top-right desktop, bottom-right mobile).
- **Market toggle** hangs directly under the resource bar (desktop).
- **Menu buttons** (top-left desktop / bottom bar mobile): Diplomacy list,
  Province list, Research, Coalition, Newspaper, Front reports, Espionage, Settings
  (map view modes + sound; also the bug-report form), plus a server-connection
  indicator.
- **Map** in the centre shows provinces with their terrain and produced-resource
  icons, armies, and striped movement paths; the path's end carries an icon for the
  order type (moving / attacking / patrolling). A quick-reselect icon for the last
  army appears at the screen edge after you deselect one.
- **Province list** (right-side toggle): every owned province with quick access to
  its construction menu and multi-select build.
- **Selected-army interface**: the bottom bar described in 1.1.
- **Map view modes** (Settings): Diplomatic (you gold, enemies red, allies green,
  neutrals brown), Political (per-country colour), Morale (green/yellow/red by
  morale, shown for foreign provinces too), plus a low-graphics toggle.

### 1.7 Fog of war

Sources: FAQ ("Why are enemy armies shown with question marks?" / "…buildings…with a
question mark?"), ESPIONAGE, ARMY CONTROLS. A dedicated "Fog of War & Stealth" wiki
page exists but is an unwritten stub.

- Each army has an **outer view range** and an **inner view range**.
  - **Outer view range = detection/contact only.** A foreign army inside your outer
    range but outside your inner range is shown as a **question-mark marker**: you
    know something is there and where, but not its composition or size.
  - **Inner view range = full reveal.** Once the foreign army crosses into your
    inner range its **stack composition** (unit types, counts, armour classes) is
    shown.
  - The inner circle is the value reported by a unit's "view range" stat. A
    community forum thread (Call of War forum, "Fog-of-War range") states the inner
    radius is ~60% of the outer radius — treat the 60% figure as forum-sourced, not
    wiki-confirmed; the outer/inner *behaviour* above is from the official FAQ.
- **Province visibility**: buildings in a foreign province are hidden behind a
  question mark until you get that **province's centre inside an army's inner view
  range**, or reveal it via espionage.
- **Scouting units**: Motorized Infantry, Armored Car and Interceptors "reveal
  stealth units on land" and have a larger view range; Destroyers and Naval Bombers
  reveal Submarines. Stealth units (Militia, Commandos, Anti-Tank, Submarines,
  Paratrooper-infantry, etc.) are invisible outside the relevant detector's range
  or in their preferred terrain.
- **Bunkers / Fortifications level ≥3** hide the composition of the garrison even
  when the army itself is visible; only destroying the building or a scout/espionage
  reveal exposes it.
- **Espionage** (ESPIONAGE page) supplements vision: instant **Agent** actions
  (Gold, 100% success) — "Reveal Local Armies" (snapshot of a province + neighbours
  within range 200), "Reveal Country's Armies", "Country Information" (resources,
  diplomacy, factory buildings, ongoing production). **Spies** (money upkeep, 50%
  base success, resolve on day-change) do Intelligence / Economic Sabotage /
  Military Sabotage / Counter-Espionage. **Aircraft on Patrol** create an espionage
  snapshot of everything in the patrol circle every 15 min. Snapshots persist
  (marked with an espionage icon) until the next day-change and can be stale.

### 1.8 "Strongest unit on the stack" + stack-count conventions

Sources: ARMY CONTROLS, COMBAT, FAQ.

- On the map an army is drawn as **the image of its single strongest unit**, with an
  adjacent readout of **unit count**, the armour classes present, and the owner
  country. Selecting the army shows its full per-unit-type grid.
- If too many unit sprites are on screen the engine stops drawing them and shows
  **just the number** for an army until it is selected (an explicit engine limit
  noted in the FAQ).
- **Stack size / "10-unit" rule.** Only the **10 strongest attack and defence
  values against each armour class** contribute damage in a fight. Units beyond that
  only add hit points — a warning icon appears on the army bar once the stack
  exceeds 10. You can still make good use of a >10 stack by mixing units that are
  each best against a *different* armour class (e.g. 10 AA + 5 infantry: all 10 AA
  fire at aircraft; 5 infantry + 5 AA fire at unarmoured).
- Combat resolves in **30-minute ticks** (15 min for air patrols at half damage);
  damage each tick = damage-potential (base × count × terrain × home-defence ×
  efficiency) × random ±20%, then reduced by the target's protection, then
  distributed across the target stack in proportion to its composition. Damage
  efficiency falls with lost HP (down to 20% near death) and with the >10 overstack.
- **Splash**: any attack also hits every other army within radius 5 of the target,
  splitting the damage; defenders' return damage in that radius is summed *before*
  the 10-unit cap, so splitting a stack to dodge the cap does not help on defence.
- Conquest: walking an army onto an **undefended** foreign province centre flips it
  instantly; a **garrisoned** centre must be cleared in combat first. Conquest
  damages the province's buildings and slams its morale to 25%.

---

## 2. Reusable asset sources — candidate table

Licence summary:

- **game-icons.net** — every icon is **CC BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Site's stated attribution form
  (about page, <https://game-icons.net/about.html>): *"Icons made by {author}.
  Available on https://game-icons.net"* — i.e. credit the **individual author** of
  each icon used (Lorc, Delapouite, Skoll, Quoting, Cathelineau, Faithtoken,
  Willdabeast, John Colburn, …). Mirror: <https://github.com/game-icons/icons>
  (same CC BY 3.0). Canonical page URL form:
  `https://game-icons.net/1x1/<author>/<slug>.html`.
- **0 A.D.** art & sound assets — **CC BY-SA 3.0**
  (<https://creativecommons.org/licenses/by-sa/3.0/>); source code is GPL. The
  primary licence page (`trac.wildfiregames.com/wiki/Credits`) was unreachable in
  this pass (Anubis anti-bot challenge), but CC BY-SA 3.0 for art/sound is
  corroborated by the OpenGameArt 0 A.D. asset pages, the Creative Commons wiki
  case study (<https://wiki.creativecommons.org/wiki/Case_Studies/0_A.D.>), and this
  repo's own `docs/ASSET_CREDITS.md`. **Share-alike**: any 0 A.D. PNG, and any
  recolour/composite/derivative of one, stays CC BY-SA 3.0 and must be credited to
  "© Wildfire Games and 0 A.D. contributors". Keeping 0 A.D. PNGs as their own
  standalone files (never merged into a shared sprite sheet with the CC BY
  game-icons art) is what keeps the share-alike obligation contained.

> **Licence-family recommendation.** Use **game-icons.net (CC BY 3.0)** for the new
> unit/order icon family so no share-alike obligation is pulled into a fresh icon
> set. Keep **0 A.D. (CC BY-SA 3.0)** where it already sits — resources and generic
> commands — and do not composite the two families.

### 2.1 game-icons.net candidates

All CC BY 3.0. "Verified" = the author/slug pair was read directly off a
game-icons.net tag page or a game-icons.net search-result title in this pass.

| Concept | Icon name | Page URL | Author | Verified | Suggested Ironfronts use |
|---|---|---|---|---|---|
| Tank (generic) | Tank | https://game-icons.net/1x1/lorc/tank.html | Lorc | yes | Light tank unit |
| Tank (aiming, heavier look) | Battle tank | https://game-icons.net/1x1/lorc/battle-tank.html | Lorc | yes | Medium tank unit |
| Tank (WW1/interwar) | Great war tank | https://game-icons.net/1x1/cathelineau/great-war-tank.html | Cathelineau | yes | Alt early/heavy tank, or "armor" category glyph |
| Tank treads | Tank tread | https://game-icons.net/1x1/skoll/tank-tread.html | Skoll | yes | Armor-category / "tracked" marker |
| APC | APC | https://game-icons.net/1x1/skoll/apc.html | Skoll | yes | Armored car / mechanized infantry |
| Jeep | Jeep | https://game-icons.net/1x1/skoll/jeep.html | Skoll | yes | Armored car / recon |
| Jeep (alt) | Jeep | https://game-icons.net/1x1/delapouite/jeep.html | Delapouite | yes | Armored car / recon (alt style) |
| Truck | Truck | https://game-icons.net/1x1/delapouite/truck.html | Delapouite | yes | Motorized infantry / supply column |
| Field gun | Field gun | https://game-icons.net/1x1/quoting/field-gun.html | Quoting | yes | Artillery unit |
| Artillery shell | Artillery shell | https://game-icons.net/1x1/quoting/artillery-shell.html | Quoting | yes | Bombard order / ammo indicator |
| Cannon blast | Cannon shot | https://game-icons.net/1x1/lorc/cannon-shot.html | Lorc | yes | Bombard / fire order |
| Rifle | Lee Enfield | https://game-icons.net/1x1/skoll/lee-enfield.html | Skoll | yes | Infantry unit |
| Machine gun | Machine gun | https://game-icons.net/1x1/skoll/machine-gun.html | Skoll | yes | Support / MG infantry |
| Person silhouette | Person | https://game-icons.net/1x1/delapouite/person.html | Delapouite | yes | Infantry unit (fallback) · manpower (alt) |
| Person silhouette (alt) | Character | https://game-icons.net/1x1/delapouite/character.html | Delapouite | yes | Manpower (alt) |
| Troops w/ banner | Rally the troops | https://game-icons.net/1x1/lorc/rally-the-troops.html | Lorc | yes | "Reinforce" / muster (spears — not WW2-accurate) |
| Move arrow | Move | https://game-icons.net/1x1/delapouite/move.html | Delapouite | yes | Move order |
| Multi-direction arrows | Multi directions | https://game-icons.net/1x1/delapouite/multi-directions.html | Delapouite | yes | Move / reposition order (alt) |
| Split arrows | Split arrows | https://game-icons.net/1x1/delapouite/split-arrows.html | Delapouite | yes | Split-stack order |
| Diverging arrows | Divergence | https://game-icons.net/1x1/lorc/divergence.html | Lorc | yes | Split / detach order (alt) |
| Crossed swords | Crossed swords | https://game-icons.net/1x1/lorc/crossed-swords.html | Lorc | yes | Attack order · "in combat" marker |
| Swords + shield emblem | Swords emblem | https://game-icons.net/1x1/lorc/swords-emblem.html | Lorc | yes | Army / combat panel header |
| Footsteps | Footsteps | https://game-icons.net/1x1/skoll/footsteps.html | Skoll | yes | March / movement order |
| Walking boot | Walking boot | https://game-icons.net/1x1/lorc/walking-boot.html | Lorc | yes | March / forced-march order |
| Boot prints | Boot prints | https://game-icons.net/1x1/lorc/boot-prints.html | Lorc | yes | Movement trail marker |
| Hazard / warning triangle | Hazard sign | https://game-icons.net/1x1/lorc/hazard-sign.html | Lorc | yes | Stop order (alt) · warning |
| Binoculars | Binoculars | https://game-icons.net/1x1/delapouite/binoculars.html | Delapouite | yes | Scout / recon order · reveal |
| Miner digging | Mining | https://game-icons.net/1x1/lorc/mining.html | Lorc | yes | "Extract" / seize-resource order · engineers |
| War pick | War pick | https://game-icons.net/1x1/delapouite/war-pick.html | Delapouite | yes | Engineers unit (alt) |
| Factory | Factory | https://game-icons.net/1x1/delapouite/factory.html | Delapouite | yes | Industry building |
| Barracks | Barracks | https://game-icons.net/1x1/delapouite/barracks.html | Delapouite | yes | Barracks / recruiting building |
| Barracks tent | Barracks tent | https://game-icons.net/1x1/delapouite/barracks-tent.html | Delapouite | yes | Field HQ / muster point |
| Brick pile | Brick Pile | https://game-icons.net/1x1/delapouite/brick-pile.html | Delapouite | yes | Construction / build menu |
| Brick wall | Brick wall | https://game-icons.net/1x1/delapouite/brick-wall.html | Delapouite | yes | Fortifications / bunker building |
| Crane | Crane | https://game-icons.net/1x1/delapouite/crane.html | Delapouite | yes | Construction in progress |
| Warehouse | Warehouse | https://game-icons.net/1x1/delapouite/warehouse.html | Delapouite | yes | Stockpile / logistics |
| Stockpiles | Stockpiles | https://game-icons.net/1x1/delapouite/stockpiles.html | Delapouite | yes | Resource stockpile |
| Gold mine | Gold mine | https://game-icons.net/1x1/delapouite/gold-mine.html | Delapouite | yes | Resource node (mine) |
| Oil pump | Oil pump | https://game-icons.net/1x1/delapouite/oil-pump.html | Delapouite | yes | Oil node |
| Oil rig | Oil rig | https://game-icons.net/1x1/delapouite/oil-rig.html | Delapouite | yes | Oil node (alt) |
| Refinery | Refinery | https://game-icons.net/1x1/delapouite/refinery.html | Delapouite | yes | Oil / fuel production |
| Oil drum | Oil drum | https://game-icons.net/1x1/skoll/oil-drum.html | Skoll | yes | Oil resource / fuel |
| Metal bar | Metal bar | https://game-icons.net/1x1/lorc/metal-bar.html | Lorc | yes | Metal resource |
| Metal plate | Metal plate | https://game-icons.net/1x1/delapouite/metal-plate.html | Delapouite | yes | Metal resource (alt) |
| Gold bar | Gold bar | https://game-icons.net/1x1/willdabeast/gold-bar.html | Willdabeast | yes | Funds (alt) |
| Anvil | Anvil | https://game-icons.net/1x1/lorc/anvil.html | Lorc | yes | Ordnance foundry / production |
| Stone block | Stone block | https://game-icons.net/1x1/lorc/stone-block.html | Lorc | yes | Stone resource |
| Stone pile | Stone pile | https://game-icons.net/1x1/delapouite/stone-pile.html | Delapouite | yes | Stone resource (alt) |
| Rock | Rock | https://game-icons.net/1x1/lorc/rock.html | Lorc | yes | Stone node |
| Stone stack | Stone stack | https://game-icons.net/1x1/delapouite/stone-stack.html | Delapouite | yes | Stone resource (alt) |
| Coins | Coins | https://game-icons.net/1x1/delapouite/coins.html | Delapouite | yes | Funds resource |
| Two coins | Two coins | https://game-icons.net/1x1/delapouite/two-coins.html | Delapouite | yes | Funds (alt) |
| Coins pile | Coins pile | https://game-icons.net/1x1/delapouite/coins-pile.html | Delapouite | yes | Treasury / funds (alt) |
| Cash | Cash | https://game-icons.net/1x1/lorc/cash.html | Lorc | yes | Funds (alt) |
| Money stack | Money stack | https://game-icons.net/1x1/delapouite/money-stack.html | Delapouite | yes | Treasury |
| Pay money | Pay money | https://game-icons.net/1x1/delapouite/pay-money.html | Delapouite | yes | Upkeep / expense |
| Receive money | Receive money | https://game-icons.net/1x1/delapouite/receive-money.html | Delapouite | yes | Income |
| Wheat | Wheat | https://game-icons.net/1x1/lorc/wheat.html | Lorc | yes | Food resource |
| Meat cleaver | Meat cleaver | https://game-icons.net/1x1/lorc/meat-cleaver.html | Lorc | yes | Food / rations (alt) |
| Meat hook | Meat hook | https://game-icons.net/1x1/lorc/meat-hook.html | Lorc | yes | Food / supply (alt) |
| Flying flag | Flying flag | https://game-icons.net/1x1/lorc/flying-flag.html | Lorc | yes | Capture-province order · ownership marker |
| Flag objective | Flag objective | https://game-icons.net/1x1/delapouite/flag-objective.html | Delapouite | yes | Objective / victory point |
| Occupy | Occupy | https://game-icons.net/1x1/cathelineau/occupy.html | Cathelineau | yes | Occupy / annex province |
| Ore chunk | Ore | https://game-icons.net/1x1/faithtoken/ore.html | Faithtoken | low confidence (single search hit) | Metal ore node — verify page before vendoring |

Lower-confidence rows to **verify on the live page before vendoring** (the fetch
returned mixed `.svg`/`.html` extensions, a sign the extraction was reconstructing):
`delapouite/grain`, `delapouite/corn`, `delapouite/bread`, `delapouite/flour`,
`faithtoken/ore`. None are needed for the shortlist — food/metal are already covered
by vendored 0 A.D. art.

Useful tag pages for further browsing: `/tags/vehicle.html`, `/tags/building.html`,
`/tags/gun.html`, `/tags/weapon.html`, `/tags/arrow.html`, `/tags/metal.html`,
`/tags/stone.html`, `/tags/money.html`, `/tags/food.html`, `/tags/flag.html`,
`/tags/boot.html`, `/tags/tool.html`, `/tags/symbol.html`. (`/tags/tank.html`,
`/tags/military.html`, `/tags/war.html`, `/tags/infantry.html` return 404 — those
tag slugs do not exist.)

### 2.2 0 A.D. art already vendored in this repo

Under `src/ui/assets/icons/0ad/` (see `docs/ASSET_CREDITS.md` for full provenance;
each file is copied unmodified from
`binaries/data/mods/public/art/textures/ui/session/icons/` in `0ad/0ad`). All
**CC BY-SA 3.0**, © Wildfire Games and 0 A.D. contributors.

| File | Fits | Currently wired in `icons.ts` as |
|---|---|---|
| `economics.png` | Funds / money resource | `funds`, `economy` |
| `population.png` | Manpower resource | `manpower` |
| `food.png` | Food resource | `food` |
| `metal.png` | Metal resource + metal-ore node | `metal`, `node-metal` |
| `stone.png` | Stone resource + rock node | `node-stone` |
| `wood.png` | (unused — reserve for forestry) | — |
| `production.png` | Industry / production output | `industry` |
| `diplomacy.png` | Diplomacy map mode / relations | `mode-diplomacy`, `diplomacy`, `note-diplomacy` |
| `objectives.png` | Objectives / victory panel | `objectives` |
| `attack-request.png` | Army/combat notification | `note-combat` |
| `repair.png` | Build / repair action (reserved) | — |
| `stop.png` | **Army stop order** (reserved) | — |

`repair.png` and `stop.png` are already the natural, in-repo choices for the
build-repair and stop-order commands — no new asset needed for those.

### 2.3 Wikimedia Commons / NATO APP-6

**No Commons file was verified in this pass.** Commons licences are per-file and the
task's premise that "NATO APP-6 military symbol SVGs are public domain" was not
checked against any specific file page, so it is not restated here as a finding.

Recommendation instead: draw the **APP-6 unit frames natively as Ironfronts SVGs**.
The basic frames are uncopyrightable geometry —

- rectangle = generic land unit,
- rectangle + single diagonal or an "X" = infantry,
- rectangle + oval (ellipse) = armour / mechanized,
- rectangle + a single filled dot = artillery,
- rectangle + a small vertical bar / "cannon" tick = anti-tank / AT gun,

— and small flat SVGs fit the existing `src/ui/assets/icons/ironfronts/*.svg` tier
(inlined `?raw`, inherits `currentColor` for hover/active states). This avoids a
licensing gamble and gives a consistent monochrome NATO-style layer that can sit
under the painterly game-icons unit art. If a Commons APP-6 set is wanted later,
verify each file's individual licence tag (look for **PD-shape / PD-ineligible**,
i.e. "too simple to be copyrightable") before vendoring.

---

## 3. Existing repo asset inventory

### `src/ui/assets/flags/` — 30 SVG country flags

`at be bg ch cz de dk eg es et fi fr gb gr ie ir is it jp lu nl no nz pl pt ro sa
se tr za` (`.svg` each).

- Source: **flag-icons** by Panayiotis Lipiridis / contributors —
  <https://github.com/lipis/flag-icons>, path `flags/4x3/<code>.svg`, ref `main`,
  copied unmodified.
- Licence: **MIT**.
- Note in `ASSET_CREDITS.md`: these are **modern** national flags as a first pass;
  `de.svg` is the modern black-red-gold tricolour — the project deliberately does
  **not** vendor 1933–1945 German state symbology. `src/ui/flags.ts` is a registry
  keyed by in-game country name so era-correct flags can be swapped later.

### `src/ui/assets/icons/0ad/` — 12 PNG session-UI icons

`attack-request diplomacy economics food metal objectives population production
repair stone stop wood` (`.png` each). Provenance and licence: see 2.2 above and
`docs/ASSET_CREDITS.md`. **CC BY-SA 3.0**, © Wildfire Games.

### `src/ui/assets/icons/ironfronts/` — 16 SVGs + 1 PNG, original to this project

SVGs: `check clear-sky close event expand focus info oil pickaxe political provinces
rain strategic system terrain warning`. Plus `water.png` (~1 MB raster, supplied by
the project owner). All under **the Ironfronts repository licence** (authored for
this project; not third-party). Wired in `icons.ts`: `oil`→`oil.svg`,
`mode-strategic`/`mode-political`/`mode-terrain`, `resource-overlay`→`pickaxe.svg`,
`provinces`, `events`→`event.svg`, `close`, `focus`, `expand`, `system`,
`weather-clear`→`clear-sky.svg`, `weather-rain`→`rain.svg`,
`note-warning`→`warning.svg`, `note-completed`→`check.svg`,
`note-information`→`info.svg`, `resource-water`→`water.png`.

> `pickaxe.svg` is already bound to `resource-overlay` (the resource map-overlay
> toggle). Do **not** reuse it for an "extract/seize resource" order — one glyph for
> two meanings is a latent UI bug. Use a distinct icon (`lorc/mining`) for that.

### Attribution format used by the project

`docs/ASSET_CREDITS.md` (and root `AUDIO_CREDITS.md`) use this shape, which any new
vendoring commit should copy:

- A per-source **heading** with `**Project:**`, `**Licence:**` (name + URL) and
  `**Attribution:**` lines.
- A statement of the exact vendor path, the upstream repo + ref + upstream path, and
  that files are copied **unmodified**.
- A **table**: `| Vendored file | Upstream source path | Used in Ironfronts for |`.
- For share-alike assets, an explicit note that the files remain under that licence
  as distributed and must appear on any formal credits screen.
- `AUDIO_CREDITS.md` additionally pins **exact upstream commit hashes** for each
  vendored media file — do the same for any new icon vendoring.

### `icons.ts` loader structure (constraint on where new files can go)

`src/ui/icons.ts` has exactly two import globs: `./assets/icons/0ad/*.png` (rendered
as `<img>`) and `./assets/icons/ironfronts/*.svg` (inlined via `?raw`, so they
inherit `currentColor`), plus `./assets/icons/ironfronts/*.png` for `water.png`.
New CC BY 3.0 game-icons SVGs want the **inline tier** (for hover/active colour) but
**must not** be dropped into `ironfronts/` — that directory is documented as
"authored for this project" and mixing in third-party files corrupts the provenance
boundary. Add a **third directory** `src/ui/assets/icons/game-icons/` with its own
glob and its own `ASSET_CREDITS.md` section.

---

## 4. Recommendation — first-roster shortlist

Target Ironfronts set: 6 units (infantry, engineers, armored car, light tank, medium
tank, artillery), 5 orders (move, attack, stop, extract, split), 6 resources (funds,
manpower, food, stone, metal, oil).

### 4a. Already covered in-repo — no download needed

| Ironfronts slot | Use existing file | Licence |
|---|---|---|
| Resource: funds | `src/ui/assets/icons/0ad/economics.png` (already `funds`) | CC BY-SA 3.0 (Wildfire Games) |
| Resource: manpower | `src/ui/assets/icons/0ad/population.png` (already `manpower`) | CC BY-SA 3.0 |
| Resource: food | `src/ui/assets/icons/0ad/food.png` (already `food`) | CC BY-SA 3.0 |
| Resource: stone | `src/ui/assets/icons/0ad/stone.png` (already `node-stone`) | CC BY-SA 3.0 |
| Resource: metal | `src/ui/assets/icons/0ad/metal.png` (already `metal`) | CC BY-SA 3.0 |
| Resource: oil | `src/ui/assets/icons/ironfronts/oil.svg` (already `oil`) | Ironfronts repo licence |
| Order: stop | `src/ui/assets/icons/0ad/stop.png` (reserved for army stop) | CC BY-SA 3.0 |
| Order: build/repair | `src/ui/assets/icons/0ad/repair.png` (reserved) | CC BY-SA 3.0 |

### 4b. Vendor new — 9 files from game-icons.net (all CC BY 3.0)

Proposed location: `src/ui/assets/icons/game-icons/<slug>.svg`, from
`github.com/game-icons/icons` (path `<author>/<slug>.svg`), copied unmodified, with a
new `ASSET_CREDITS.md` section pinned to a specific commit.

| Ironfronts slot | File (slug) | Upstream path | Author | Page URL |
|---|---|---|---|---|
| Unit: infantry | `lee-enfield.svg` | `skoll/lee-enfield.svg` | Skoll | https://game-icons.net/1x1/skoll/lee-enfield.html |
| Unit: engineers | `mining.svg` | `lorc/mining.svg` | Lorc | https://game-icons.net/1x1/lorc/mining.html |
| Unit: armored car | `jeep.svg` | `skoll/jeep.svg` | Skoll | https://game-icons.net/1x1/skoll/jeep.html |
| Unit: light tank | `tank.svg` | `lorc/tank.svg` | Lorc | https://game-icons.net/1x1/lorc/tank.html |
| Unit: medium tank | `battle-tank.svg` | `lorc/battle-tank.svg` | Lorc | https://game-icons.net/1x1/lorc/battle-tank.html |
| Unit: artillery | `field-gun.svg` | `quoting/field-gun.svg` | Quoting | https://game-icons.net/1x1/quoting/field-gun.html |
| Order: move | `move.svg` | `delapouite/move.svg` | Delapouite | https://game-icons.net/1x1/delapouite/move.html |
| Order: attack | `crossed-swords.svg` | `lorc/crossed-swords.svg` | Lorc | https://game-icons.net/1x1/lorc/crossed-swords.html |
| Order: extract | `mining.svg` (shared with engineers) or `war-pick.svg` | `lorc/mining.svg` / `delapouite/war-pick.svg` | Lorc / Delapouite | https://game-icons.net/1x1/delapouite/war-pick.html |
| Order: split | `split-arrows.svg` | `delapouite/split-arrows.svg` | Delapouite | https://game-icons.net/1x1/delapouite/split-arrows.html |

(That is 9 distinct files if "extract" reuses `mining.svg` with engineers; 10 if
`war-pick.svg` is vendored separately to keep the two meanings visually distinct —
recommended.)

Fallbacks / notes:

- **Infantry**: no verified rifle-*infantry-silhouette* icon exists on
  game-icons.net. `skoll/lee-enfield` (a rifle) is the pick; `delapouite/person`
  (plain silhouette) is the fallback; or draw the APP-6 "rectangle + X" frame
  natively per section 2.3.
- **Armored car**: `skoll/jeep` chosen for the recon read; `skoll/apc` or
  `delapouite/jeep` are equivalent-licence alternates.
- **Medium tank**: `lorc/battle-tank` reads as heavier/turreted next to `lorc/tank`;
  `cathelineau/great-war-tank` is an interwar-styled alternate.
- **Move**: pair with `skoll/footsteps` or `lorc/walking-boot` if a distinct
  "march / forced-march" order icon is wanted alongside plain "move".
- **Scout order** (not in the 5 but implied by CoW recon units):
  `delapouite/binoculars`. **Capture-province order**: `lorc/flying-flag`.

### 4c. Attribution block to add when 4b is vendored

Add to `docs/ASSET_CREDITS.md` (mirroring the existing 0 A.D. / flag-icons blocks):

- **Project:** game-icons.net — <https://github.com/game-icons/icons>
- **Licence:** CC BY 3.0 — <https://creativecommons.org/licenses/by/3.0/>
- **Attribution:** "Icons made by Lorc, Delapouite, Skoll and Quoting — available on
  https://game-icons.net" (list the exact per-file author in the table).
- Vendored under `src/ui/assets/icons/game-icons/`, copied unmodified from
  `game-icons/icons` at commit `<pin a hash>`, path `<author>/<slug>.svg`.
- Table: `| Vendored file | Upstream source path | Author | Used in Ironfronts for |`.

### 4d. Design finding — resource-model divergence (needs a project decision)

Call of War and the current Ironfronts `IconName` set do not use the same resource
list:

| Call of War | Ironfronts (`icons.ts`) | Match? |
|---|---|---|
| Money | `funds` | yes |
| Manpower | `manpower` | yes |
| Food | `food` | yes |
| Metal | `metal` / `node-metal` | yes |
| Oil | `oil` / `node-oil` | yes |
| Goods | — | **no Ironfronts analogue** |
| Rare Materials | — | **no Ironfronts analogue** |
| — | `industry` (production output, from 0 A.D. `production.png`) | CoW treats industry as a building, not a stockpile |
| — | `node-stone` / `resource-water` | **"Stone" / "Water" have no CoW analogue** — inherited from the 0 A.D. economy |

If Ironfronts wants Call-of-War-style production gating (each unit category needs
Food/Goods/Metal/Oil/Rare-Materials in different mixes), someone has to decide
whether "Stone" stays (a 0 A.D. inheritance, no WW2 grand-strategy precedent) and
whether "Goods" and "Rare Materials" get added. game-icons.net has clean candidates
for both if added: Goods → `delapouite/stockpiles` or `delapouite/warehouse`;
Rare Materials → `faithtoken/ore` (verify) or `delapouite/gold-nuggets`.

---

## Appendix — source URLs used

Call of War wiki: the eleven `wiki.callofwar.com` pages and three
`call-of-war-by-bytro.fandom.com` pages listed at the top of section 1, plus the
Call of War forum thread "Fog-of-War range" (`forum.callofwar.com`) for the
inner ≈ 60% × outer figure only.

Licences: <https://creativecommons.org/licenses/by/3.0/> (game-icons),
<https://creativecommons.org/licenses/by-sa/3.0/> (0 A.D.),
<https://wiki.creativecommons.org/wiki/Case_Studies/0_A.D.>,
<https://game-icons.net/about.html>, <https://github.com/game-icons/icons>,
<https://github.com/lipis/flag-icons>.

game-icons.net icon pages: as listed inline in section 2.1 / 4.
