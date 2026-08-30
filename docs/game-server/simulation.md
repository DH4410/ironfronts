# Authoritative Simulation

## Time model and system order

The process calls `GameRuntime.tick(0.05)` every 100 ms. Therefore:

- 10 simulation ticks run per real second;
- one running-server second advances 0.5 game hours;
- `simulationTick` is the exact combat-cooldown clock;
- `clock.gameTimeHours` drives movement, economy, extraction, construction, production, and AI cadence.

The simulation does not catch up after process downtime. A delayed individual call is not derived from wall-clock elapsed time; the fixed `0.05` game-hour step is used.

Every tick executes systems in this fixed order:

1. Increment `simulationTick` and game time.
2. Recompute periodic income if due, then apply passive income.
3. Move armies and revalidate routes/pursuit.
4. Extract physical resources.
5. Advance construction.
6. Advance unit production.
7. Resolve close combat and artillery.
8. Capture undefended hostile province centers.
9. Re-plan AI when its game-time cadence is due.

This ordering is a gameplay contract. For example, movement can create a battle in the same tick, combat happens before capture, and a newly completed unit exists before combat detection.

## Authoritative state

`GameState` is plain JSON data with version `2`. It contains scenario flags and clocks, countries and stockpiles, territory, buildings and queues, rally points, armies and orders, battles/fronts, resource nodes, diplomacy, and monotonic ID counters.

Armies contain unit groups, not individual entity records. A group stores `typeId`, unit `count`, pooled `hp`, and experience. Group count is kept coherent with pooled HP after damage: surviving count becomes `ceil(hp / unitMaxHp)`. Same-type reinforcement pools count and HP; different types never share condition.

Army status is one of `idle`, `moving`, `extracting`, `engaged`, or `retreating`.

## Unit catalog

Attack and defence are firepower profiles against armor pools. Defence is stationary return fire, not mitigation. One firepower point removes one pooled HP per volley before proportional distribution.

| Unit | Armor | HP | Speed | Attack S/L/H | Defence S/L/H | Vision outer/inner | Extraction | Range | Building |
|---|---:|---:|---:|---|---|---:|---:|---:|---|
| Infantry | Soft | 100 | 90 | 8 / 4.4 / 2.4 | 6 / 3.3 / 1.8 | 180 / 90 | 0.4 | 0 | Barracks |
| Engineers | Soft | 80 | 85 | 1.8 / 0.9 / 0.45 | 2.4 / 1.2 / 0.6 | 160 / 80 | 2.0 | 0 | Barracks |
| Armored Car | Light | 90 | 190 | 6.6 / 4.2 / 2.1 | 7.7 / 4.9 / 2.45 | 300 / 160 | 0 | 0 | Tank Plant |
| Light Tank | Light | 130 | 150 | 16.8 / 14.7 / 9.8 | 14.4 / 12.6 / 8.4 | 220 / 110 | 0 | 0 | Tank Plant |
| Medium Tank | Heavy | 190 | 110 | 26.4 / 23.1 / 15.4 | 24 / 21 / 14 | 200 / 100 | 0 | 0 | Tank Plant |
| Artillery | Soft | 70 | 70 | 29.9 / 23.4 / 32.5 | 3.45 / 2.7 / 3.75 | 170 / 70 | 0 | 140 | Ordnance |

Speeds are world units per game hour before terrain/road multipliers. Army base speed is its slowest surviving unit.

Production costs and active queue times are:

| Unit | Cost | Nominal hours | Simulated queue hours |
|---|---|---:|---:|
| Infantry | 20 funds, 40 manpower, 5 food | 6 | 1.5 |
| Engineers | 30 funds, 25 manpower, 10 metal | 7 | 1.75 |
| Armored Car | 40 funds, 10 manpower, 40 metal, 20 oil | 8 | 2 |
| Light Tank | 60 funds, 15 manpower, 70 metal, 35 oil | 12 | 3 |
| Medium Tank | 110 funds, 25 manpower, 120 metal, 60 oil | 20 | 5 |
| Artillery | 70 funds, 20 manpower, 55 metal, 15 oil | 14 | 3.5 |

## Movement and territorial legality

Land movement follows the authoritative road graph. An order stores remaining node IDs, final graph coordinates, intent, typed strategic target, and edge progress. The army stores its current graph node and previous graph node; its continuous `x/z` position moves along the active edge.

Routes may traverse:

- territory owned by the moving country;
- territory owned by a country already at war; or
- territory whose required war declaration is atomically confirmed with the order.

Peaceful neutral territory is otherwise blocked. Each graph edge is sampled every 18 world units and caches the province IDs it crosses. This allows the route validator to account for an edge crossing territory even when neither endpoint belongs to it.

Movement speed is:

```text
slowest unit speed × game-hour delta × terrain multiplier × 1.35 road bonus
```

Terrain multipliers are plain `1.0`, hill `0.72`, mountain `0.48`, forest `0.8`, and urban `0.9`.

Orders are revalidated while moving. When the next edge becomes illegal, the server tries a currently legal route; if none reaches the target, it chooses the legal reachable point closest to the target. It never enters newly peaceful territory. Army pursuit repaths when the target's graph destination changes while visible. Once hidden, pursuit uses the last detected coordinates and stops there unless reacquired before arrival.

Friendly armies never automatically merge through movement. Freshly produced units are the only exception: they may attach to the oldest eligible friendly local non-battle stack.

## Close combat and directional fronts

Hostile armies enter close combat when they are within 26 world units. Same-country overlaps and peaceful-country overlaps do nothing. Combat does not declare war.

A `BattleState` groups one or more `BattleFrontState` records at an engagement location. A front has a road/province anchor and two country-direction sides. Each side records role, participating army IDs, full entry/reinforcement HP by army, and its next volley tick. Armies may retain separate IDs while sharing a side.

Entering close combat:

- sets status to `engaged`;
- saves the current order in `suspendedOrder`;
- clears active movement/extraction;
- joins the matching country/direction side, or creates a new directional front;
- makes a newly created side immediately ready to fire.

Reinforcement adds the army's full maximum HP to the side baseline but does not reset or accelerate the existing side timer. When all of an army's fronts end, its still-present suspended order resumes; otherwise it becomes idle.

### Roles

An advancing side uses its Attack profiles. A province holder or stationary road force uses Defence profiles. If both road forces are advancing, both use Attack. Roles are recorded on the front and used for every volley on that contact.

### Frontage selection

Each country-direction side has ten damaging slots. For each individual unit candidate, expected matchup output is:

```text
same-type pooled health fraction × (
  profile.soft  × enemy soft HP ratio +
  profile.light × enemy light HP ratio +
  profile.heavy × enemy heavy HP ratio
)
```

The ten highest candidates fire. Ties are deterministic by unit type ID, army ID, then unit ordinal. Overflow units produce no firepower but remain in the targetable HP pools, so they absorb their proportional share of damage as meat shields.

The health multiplier for a unit type is pooled across all same-type groups on the firing side. Reinforcement therefore changes the average condition of that type without averaging it with other types.

### Damage distribution and simultaneity

For each armor class:

```text
class damage = selected class firepower × defender current class-HP ratio
```

That class damage is distributed across every defending group of the class in proportion to the group's current pooled HP. Soft, light, and heavy pools are independent.

All sides due on a simulation tick calculate from the same pre-damage state. Their pending damage is combined and applied afterward. A force destroyed by a simultaneous volley still returns its already-calculated fire.

Each side fires immediately when a new front is created and then every 18,000 simulation ticks (30 real minutes while the server runs). The cooldown belongs to the direction-side, not an army. Ending a front deletes its timer.

## Retreat

For each side, the front baseline is the sum of full maximum HP contributed by every currently participating army when it joined. Casualties do not reduce the denominator. A manual withdrawal removes that army's current participation and its baseline entry.

After a close-combat volley, a side automatically tries to retreat when:

```text
combined current side HP < 10% × current side baseline HP
```

Every army on that side must have a legal friendly-only escape route. If any does not, none auto-retreats and the side makes a last stand.

Manual retreat is available only in close combat. Legal first edges are:

- road front: the army's recorded previous-node/back edge only;
- province front: adjacent edges except directions currently used by hostile approaches in the battle.

Candidate paths may traverse only territory currently owned by the retreating country and are sorted by path length with deterministic province/node ties. The selected first edge determines the nearest reachable owned destination province.

A retreat:

- removes the army and its baseline from all fronts;
- locks the destination province and path at that moment;
- moves at three times normal slowest-unit terrain-adjusted speed;
- is immune to combat/artillery until it reaches the first escape node;
- can be engaged or bombarded normally after that protection clears;
- rejects additional move, attack, stop, extract, split, or retreat commands.

Arrival clears retreat state and leaves the army idle. Later ownership changes do not recalculate the already installed retreat path.

## Artillery bombardment

Any stationary (`idle` or `extracting`) army containing artillery can bombard. An engaged or moving army cannot. Only artillery groups participate in ranged damage; the same frontage calculation caps the firing army at ten artillery units and uses Attack profiles.

Valid targets are detected/contact-visible armies belonging to a country already at war, inside the maximum artillery range, and not protected on their first retreat edge. The closest target is selected automatically with army-ID tie-breaking.

An artillery-only army may use Attack on one in-range detected enemy to set a manual override. That target remains preferred while valid. If it becomes hidden, leaves range, or is destroyed, the override clears and closest-target acquisition resumes. Mixed armies use Attack as movement/pursuit and still auto-bombard only while stationary.

A bombardment damages one target army and causes no return fire. Its cooldown belongs to the firing army:

- ordinary volley: set to current tick + 18,000;
- target switch/loss: preserve the remaining timer;
- target destroyed by the volley: become ready immediately.

Artillery damage does not create a close battle and therefore does not invoke close-front automatic retreat.

## Capture and diplomacy

Relations are independent country pairs with `peace` as the absent/default value and `war` as an explicit record. No alliance side is modeled.

An army at an authored province-center graph node captures when it is neither engaged nor retreating, the owner is itself or an already-hostile/neutral owner, and no defending army of the current owner is within 26 world units. Peaceful foreign land is not captured.

Capture is immediate and:

- changes province ownership;
- clears its production queue, construction queue, and rally point;
- transfers control of resource nodes in the province;
- stops an incompatible prior owner's active extractor;
- emits a public capture event.

## Economy, extraction, construction, and production

Passive per-game-hour income is recomputed every game hour from current territory:

- funds: `0.9 × population / 100,000`, plus `4` per urban province;
- manpower: `0.5 × population / 100,000`;
- food: `0.15` per province;
- stone, metal, and oil: no passive income.

Stone, metal, and oil come from physical deposits. Infantry contributes `0.4` extraction units per unit per game hour and engineers contribute `2.0`; other units contribute none. One eligible army controls a node's extraction at a time. Movement, loss of capability, destruction, capture incompatibility, or exhaustion stops it.

Building costs and nominal times are:

| Building | Cost | Nominal hours | Simulated queue hours |
|---|---|---:|---:|
| Barracks | 120 funds, 60 stone | 48 | 12 |
| Ordnance Workshop | 220 funds, 70 stone, 60 metal | 72 | 18 |
| Tank Plant | 300 funds, 90 stone, 120 metal | 96 | 24 |

Only urban provinces build. Each building is currently one level and a duplicate cannot be built or queued. Queues are ordered, only their head progresses, and cost is paid up front.

Unit nominal build times are listed in the catalog source and are also divided by four in the active queue. Production requires the matching building. If a province changes hands, leading construction/production orders paid by the former owner are discarded and their cost is forfeited.

On completion, a unit spawns at the province graph node. It joins the oldest eligible friendly local army that has no active order/extraction and is not engaged/retreating; otherwise it creates a new detachment. A rally order is attempted for the resulting eligible idle stack.

## AI

AI planning runs every two game hours and issues the same authoritative commands as players. The current AI:

- slowly queues infantry when a barracks and stockpile allow it;
- moves extraction-capable idle armies to controlled deposits and extracts;
- while at war, sends its strongest eligible idle army toward a nearby enemy within 900 world units only when the target has less than roughly `1 / 1.4` of its unit count.

AI country control is stored in the same country state and projection as player/neutral control.

## Fog of war

Foreign army knowledge has three levels:

- `hidden`: absent from projection;
- `contact`: position and owner, but generic name/status and no composition;
- `visible`: current composition and status, but no private order information.

Own armies are always visible. If fog is disabled, all armies and resource nodes are visible.

Army vision uses the strongest group's catalog radii. Owned province centers contribute 130 world units of outer/contact vision and no inner reveal. Resource nodes controlled by the viewer are always projected; foreign nodes require contact vision. Own province buildings, queues, and rallies plus the viewer's economy are private even though province ownership, country summaries, and relations are public.
