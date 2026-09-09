/**
 * Strategic AI v2 ("IMPORTANT AI RULE").
 *
 * AI-controlled countries go through the SAME `applyCommand` boundary the
 * player does (with their own countryId) — never direct state edits, and never
 * a `confirmedWarCountryIds` field, which is what keeps the AI from declaring
 * opportunistic wars: any order whose route needs a fresh war is simply
 * refused.
 *
 * One pass per country, strict priority order, at most one order per concern so
 * armies never thrash:
 *   1. pull a broken stack out of a battle it is losing
 *   2. relieve the capital / a threatened city
 *   3. work a controlled deposit with an idle miner
 *   4. queue a unit  5. queue a building
 *   6. gather loose stacks at one staging province (they merge on arrival)
 *   7. assault, but only with local superiority
 *   8. a rate-limited strategic strike
 *   9. peace when losing a multi-front war
 * Steps 6-9 are war-only; a country at peace just defends and builds.
 */

import type { SimContext } from '../sim-context';
import { applyCommand } from '../commands';
import { producibleUnits } from '../production';
import { buildableBuildings } from '../construction';
import { canExtract, stackHealthFraction, type ArmyStack } from '../units/army';
import { unitType } from '../units/unit-catalog';
import type { BuildingId } from '../units/unit-types';
import type { WorldProvince } from '../world-data';
import { wrappedDistance } from '../geometry';
import {
  CONTACT_RADIUS, aiMemory, assess, combatStrength, indexArmies, indexProvinces,
  provinceNode, strengthNear, type AiMemory, type Assessment, type CityStatus,
} from './assessment';

/** A threatened city keeps this much more weight than is bearing down on it. */
const DEFENCE_MARGIN = 1.5;
/** ~3 infantry: the token the capital always keeps back. */
const MIN_GARRISON_STRENGTH = 300;
/** Enemy weight counted around an engaged stack when judging the battle. */
const MELEE_RADIUS = 150;
/** Break off below this share of full hp... */
const RETREAT_HEALTH = 0.35;
/** ...or below this share of the enemy weight pressing us. */
const RETREAT_RATIO = 0.6;
/** Never let a province sit on more than this many queued units. */
const MAX_QUEUED_UNITS = 2;
/** A city this close to the front builds to fight, not to industrialise. */
const FRONTLINE_RADIUS = 1200;
/** Move orders spent gathering the loose stacks in one pass. */
const STAGING_ORDERS_PER_PASS = 2;
/** Attack only with this much more weight than the local defence. */
const COMMIT_RATIO = 1.5;
/** ~4 infantry at full strength: below this a stack stages, it does not attack. */
const MIN_ASSAULT_STRENGTH = 400;
/** How far the spearhead will reach for an isolated enemy stack. */
const OPPORTUNITY_RADIUS = 900;
/** Objectives to try before giving up for this pass (skips unreachable ground). */
const OBJECTIVE_TRIES = 3;
/**
 * Missile Site reach. Re-declared from `src/game/strike.ts`, where it is
 * deliberately module-private — keep the two in step if that one is retuned.
 */
const MISSILE_RANGE = 3200;
/** At most one strike per country per ~10 game-days. */
const STRIKE_COOLDOWN_HOURS = 240;
/** At most one peace offer per country per ~2 game-weeks. */
const PEACE_OFFER_COOLDOWN_HOURS = 336;
/** Wars being fought at once before peace looks better than pride. */
const MULTI_FRONT_WARS = 3;

export function stepAi(session: SimContext, _dtHours: number): void {
  const state = session.state;
  const aiCountries = Object.values(state.countries).filter((c) => c.controller === 'ai');
  if (aiCountries.length === 0) return;

  const memory = aiMemory(state);
  const armiesByOwner = indexArmies(state);
  const provincesByOwner = indexProvinces(session);

  for (const country of aiCountries) {
    const situation = assess(session, memory, country.id, armiesByOwner, provincesByOwner);
    retreatBrokenStack(session, situation);
    defendCities(session, situation);
    workDeposits(session, situation);
    produceUnits(session, situation);
    buildIndustry(session, situation);
    if (!situation.atWar) continue;
    mobilise(session, memory, situation);
    concentrate(session, memory, situation);
    assault(session, situation);
    strategicStrike(session, memory, situation);
    negotiate(session, memory, situation);
  }
}

/**
 * What a city must keep back: cover for whatever is bearing down on it, a token
 * force at the capital whatever the map looks like, and nothing at all at a
 * quiet rear city — a province no one is near does not tie down a field army.
 */
function requiredGarrison(city: CityStatus): number {
  if (city.threatStrength > 0) {
    return Math.max(city.threatStrength * DEFENCE_MARGIN, MIN_GARRISON_STRENGTH);
  }
  return city.isCapital ? MIN_GARRISON_STRENGTH : 0;
}

/**
 * Stacks free to be given a new job. A stack standing on one of our cities may
 * only leave if the city still covers the threat against it once he is gone —
 * so the last defender of the capital or of a pressed city is never stripped,
 * while a garrison sitting on ten times what it needs is not frozen either.
 * Strengths are re-read live, so a split earlier in this pass counts.
 */
function availableStacks(situation: Assessment): ArmyStack[] {
  const spareByNode = new Map<number, number>();
  for (const city of situation.cities) {
    let held = 0;
    for (const army of city.garrison) held += combatStrength(army);
    const spare = held - requiredGarrison(city);
    spareByNode.set(city.node, Math.min(spareByNode.get(city.node) ?? Infinity, spare));
  }
  return situation.armies.filter((army) => {
    if (army.order || army.status !== 'idle' || army.extractingNodeId !== null) return false;
    const strength = combatStrength(army);
    if (strength <= 0) return false;
    const spare = spareByNode.get(army.graphNodeId);
    return spare === undefined || strength <= spare;
  });
}

/** 1. A stack that is losing its battle walks back into friendly territory. */
function retreatBrokenStack(session: SimContext, situation: Assessment): void {
  for (const army of situation.armies) {
    if (army.status !== 'engaged' || !army.battleFrontIds?.length) continue;
    const pressure = strengthNear(
      situation.enemyArmies, army.x, army.z, MELEE_RADIUS, session.world.width,
    );
    if (stackHealthFraction(army) >= RETREAT_HEALTH
      && combatStrength(army) >= pressure * RETREAT_RATIO) continue;
    // `retreatArmy` picks the adjacent road node best aimed at the point we
    // give it, so aim exactly at the exit we want. Two candidates at most:
    // each attempt re-plans every friendly escape route and is not cheap.
    for (const exit of escapeNodes(session, situation, army).slice(0, 2)) {
      const done = applyCommand(session, {
        type: 'retreatArmy', countryId: situation.countryId, armyId: army.id,
        x: session.graph.nodeX[exit], z: session.graph.nodeZ[exit],
      }).ok;
      if (done) return;
    }
    return;
  }
}

/** Neighbouring road nodes that do not face the enemy, homeward first. */
function escapeNodes(
  session: SimContext, situation: Assessment, army: ArmyStack,
): number[] {
  const battleIds = new Set(
    (army.battleFrontIds ?? []).map((id) => session.state.battleFronts[id]?.battleId),
  );
  const facingEnemy = new Set<number>();
  for (const front of Object.values(session.state.battleFronts)) {
    if (!battleIds.has(front.battleId)) continue;
    for (const side of [front.sideA, front.sideB]) {
      if (side.countryId !== situation.countryId) facingEnemy.add(side.directionNodeId);
    }
  }
  const homeDistance = (node: number): number => {
    let best = Infinity;
    for (const province of situation.provinces) {
      best = Math.min(best, wrappedDistance(
        session.graph.nodeX[node], session.graph.nodeZ[node],
        province.center[0], province.center[1], session.world.width,
      ));
    }
    return best;
  };
  return (session.graph.adjacency[army.graphNodeId] ?? [])
    .filter((node) => !facingEnemy.has(node))
    .sort((a, b) => homeDistance(a) - homeDistance(b));
}

/** 2. Send the nearest spare stack to the worst-held city (capital first). */
function defendCities(session: SimContext, situation: Assessment): void {
  const available = availableStacks(situation);
  if (available.length === 0) return;
  for (const city of situation.cities) {
    if (city.threatStrength <= city.garrisonStrength) continue;
    const relief = available
      .filter((army) => army.graphNodeId !== city.node)
      .sort((a, b) => wrappedDistance(
        a.x, a.z, city.province.center[0], city.province.center[1], session.world.width,
      ) - wrappedDistance(
        b.x, b.z, city.province.center[0], city.province.center[1], session.world.width,
      ))[0];
    if (!relief) continue;
    const done = applyCommand(session, {
      type: 'moveArmy', countryId: situation.countryId, armyId: relief.id,
      x: city.province.center[0], z: city.province.center[1],
    }).ok;
    if (done) return;
  }
}

/** 3. Put one idle miner on the nearest controlled deposit. */
function workDeposits(session: SimContext, situation: Assessment): void {
  const deposits = Object.values(session.state.resourceNodes).filter(
    (node) => node.controllerCountryId === situation.countryId && node.remaining > 0
      && node.accessNodeId >= 0 && node.status !== 'extracting',
  );
  if (deposits.length === 0) return;
  for (const army of situation.armies) {
    if (army.order || army.status !== 'idle' || army.extractingNodeId !== null) continue;
    if (!canExtract(army)) continue;
    const target = deposits.reduce((best, node) => (wrappedDistance(
      army.x, army.z, node.x, node.z, session.world.width,
    ) < wrappedDistance(army.x, army.z, best.x, best.z, session.world.width) ? node : best));
    applyCommand(session, army.graphNodeId === target.accessNodeId
      ? { type: 'extract', countryId: situation.countryId, armyId: army.id }
      : {
        type: 'moveArmy', countryId: situation.countryId, armyId: army.id,
        x: target.x, z: target.z,
      });
    return;
  }
}

/** 4. One unit order per pass, at the most pressed city that can take it. */
function produceUnits(session: SimContext, situation: Assessment): void {
  const country = session.state.countries[situation.countryId];
  if (!country) return;
  const miners = situation.armies.filter(canExtract).length;
  for (const city of situation.cities) {
    const provinceId = city.province.id;
    if ((session.state.productionQueues[provinceId]?.length ?? 0) >= MAX_QUEUED_UNITS) continue;
    const options = producibleUnits(session, provinceId, situation.countryId);
    const pick = chooseUnit(country.stockpile, options, miners);
    if (!pick) continue;
    const done = applyCommand(session, {
      type: 'produce', countryId: situation.countryId, provinceId, unitTypeId: pick,
    }).ok;
    if (done) return;
  }
}

/** Cheap infantry is the staple; armour only once the metal really covers it. */
function chooseUnit(
  stockpile: { funds: number; manpower: number; metal: number; oil: number },
  options: readonly string[], miners: number,
): string | null {
  if (miners < 2 && options.includes('engineer')
    && stockpile.funds > 120 && stockpile.manpower > 80) return 'engineer';
  if (options.includes('medium-tank')
    && stockpile.metal > 400 && stockpile.oil > 200 && stockpile.funds > 300) return 'medium-tank';
  if (options.includes('light-tank')
    && stockpile.metal > 220 && stockpile.oil > 120 && stockpile.funds > 180) return 'light-tank';
  if (options.includes('artillery')
    && stockpile.metal > 200 && stockpile.funds > 220) return 'artillery';
  if (options.includes('infantry')
    && stockpile.manpower > 120 && stockpile.funds > 80) return 'infantry';
  return null;
}

/** 5. Frontline cities build to fight; rear cities industrialise. */
function buildIndustry(session: SimContext, situation: Assessment): void {
  for (const city of situation.cities) {
    const provinceId = city.province.id;
    if ((session.state.constructionQueues[provinceId]?.length ?? 0) >= 1) continue;
    const options = buildableBuildings(session, provinceId, situation.countryId);
    if (options.length === 0) continue;
    const frontline = city.threatStrength > 0 || (situation.frontTarget !== null
      && wrappedDistance(
        city.province.center[0], city.province.center[1],
        situation.frontTarget.center[0], situation.frontTarget.center[1], session.world.width,
      ) < FRONTLINE_RADIUS);
    const order: BuildingId[] = frontline
      ? ['barracks', 'ordnance', 'tankPlant', 'missileSite']
      : ['tankPlant', 'ordnance', 'barracks', 'missileSite'];
    const pick = order.find((id) => options.includes(id));
    if (!pick) continue;
    const done = applyCommand(session, {
      type: 'build', countryId: situation.countryId, provinceId, buildingId: pick,
    }).ok;
    if (done) return;
  }
}

/**
 * 6a. Mobilise. A country whose whole army IS its capital garrison can never
 * free a stack the normal way — the stack is worth more than the city can
 * spare. Split the surplus off instead: the covering garrison stays put and the
 * field army marches. Without this a small nation just sat on its capital.
 */
function mobilise(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const staging = situation.staging;
  if (!staging) return;
  const stagingNode = provinceNode(session, memory, staging);
  for (const city of situation.cities) {
    if (city.node === stagingNode) continue; // the fist already forms here
    let held = 0;
    for (const army of city.garrison) held += combatStrength(army);
    const spare = held - requiredGarrison(city);
    if (spare < MIN_ASSAULT_STRENGTH) continue;
    // Only stacks too big to march off on their own need cutting down.
    const parent = city.garrison.find((army) => !army.order && army.status === 'idle'
      && army.extractingNodeId === null && combatStrength(army) > spare);
    if (!parent) continue;
    const groups = detachment(parent, spare);
    if (groups.length === 0) continue;
    const done = applyCommand(session, {
      type: 'splitArmy', countryId: situation.countryId, armyId: parent.id,
      groups, x: staging.center[0], z: staging.center[1],
    }).ok;
    if (done) return;
  }
}

/** Up to `budget` worth of fighting units; engineers stay home and mine. */
function detachment(
  stack: ArmyStack, budget: number,
): { typeId: string; count: number }[] {
  const groups: { typeId: string; count: number }[] = [];
  let remaining = budget;
  for (const group of stack.units) {
    if (group.count <= 0 || unitType(group.typeId).category === 'engineer') continue;
    const perUnit = group.hp / group.count;
    const take = Math.min(group.count, Math.floor(remaining / Math.max(perUnit, 1)));
    if (take <= 0) continue;
    groups.push({ typeId: group.typeId, count: take });
    remaining -= take * perUnit;
  }
  return groups;
}

/**
 * 6b. Gather. Loose stacks march on ONE staging province behind the front, where
 * `stepMovement` folds arrivals into the stack already resting there — so the
 * country builds a fist instead of feeding the enemy one stack at a time. Rear
 * cities rally their production to the same point.
 */
function concentrate(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const staging = situation.staging;
  if (!staging) return;
  const stagingNode = provinceNode(session, memory, staging);
  let issued = 0;
  for (const army of availableStacks(situation)) {
    if (army.graphNodeId === stagingNode) continue;
    const done = applyCommand(session, {
      type: 'moveArmy', countryId: situation.countryId, armyId: army.id,
      x: staging.center[0], z: staging.center[1],
    }).ok;
    if (done && (issued += 1) >= STAGING_ORDERS_PER_PASS) break;
  }
  for (const city of situation.cities) {
    if (city.province.id === staging.id || city.threatStrength > 0) continue;
    const rally = session.state.rallyPoints[city.province.id];
    if (rally && rally.x === staging.center[0] && rally.z === staging.center[1]) continue;
    const done = applyCommand(session, {
      type: 'setRally', countryId: situation.countryId, provinceId: city.province.id,
      target: { x: staging.center[0], z: staging.center[1] },
    }).ok;
    if (done) return;
  }
}

/** 7. Commit the massed stack — an isolated enemy first, then enemy ground. */
function assault(session: SimContext, situation: Assessment): void {
  const spearhead = availableStacks(situation)
    .sort((a, b) => combatStrength(b) - combatStrength(a))[0];
  if (!spearhead) return;
  const strength = combatStrength(spearhead);
  if (strength < MIN_ASSAULT_STRENGTH) return;
  const width = session.world.width;

  const prey = situation.enemyArmies
    .filter((enemy) => combatStrength(enemy) * COMMIT_RATIO < strength)
    .map((enemy) => ({
      enemy, distance: wrappedDistance(spearhead.x, spearhead.z, enemy.x, enemy.z, width),
    }))
    .filter((candidate) => candidate.distance < OPPORTUNITY_RADIUS)
    .sort((a, b) => a.distance - b.distance)[0];
  if (prey) {
    const done = applyCommand(session, {
      type: 'attackArmy', countryId: situation.countryId, armyId: spearhead.id,
      target: { kind: 'army', armyId: prey.enemy.id },
    }).ok;
    if (done) return;
  }

  const enemyCapitals = new Set(
    [...situation.enemyIds]
      .map((id) => session.world.countries.find((c) => c.id === id)?.capitalProvinceId)
      .filter((id): id is number => id !== undefined),
  );
  const objectives = situation.enemyProvinces
    .map((province) => ({
      province,
      score: wrappedDistance(
        spearhead.x, spearhead.z, province.center[0], province.center[1], width,
      ) * (enemyCapitals.has(province.id) ? 0.6 : 1),
    }))
    .sort((a, b) => a.score - b.score);
  let tried = 0;
  for (const { province } of objectives) {
    if (strength < oppositionTo(situation, spearhead, province, width) * COMMIT_RATIO) continue;
    // No aim point: `issueAttack` then marches on the province centre without a
    // point-in-province check, and reports failure for ground we cannot reach.
    const done = applyCommand(session, {
      type: 'attackArmy', countryId: situation.countryId, armyId: spearhead.id,
      target: { kind: 'province', provinceId: province.id },
    }).ok;
    if (done || (tried += 1) >= OBJECTIVE_TRIES) return;
  }
}

/**
 * Enemy weight standing in the way of an assault: whatever holds the objective,
 * plus every stack between us and it. A province that looks undefended because
 * it sits behind an intact enemy field army is not undefended, and marching a
 * column past that army to reach it is how the old AI lost its stacks.
 */
function oppositionTo(
  situation: Assessment, from: ArmyStack, target: WorldProvince, width: number,
): number {
  const reach = wrappedDistance(from.x, from.z, target.center[0], target.center[1], width);
  let total = 0;
  for (const enemy of situation.enemyArmies) {
    const toObjective = wrappedDistance(
      enemy.x, enemy.z, target.center[0], target.center[1], width,
    );
    const toUs = wrappedDistance(from.x, from.z, enemy.x, enemy.z, width);
    if (toObjective > CONTACT_RADIUS && (toUs > reach || toObjective > reach)) continue;
    total += combatStrength(enemy);
  }
  return total;
}

/** 8. One warhead at the most valuable reachable enemy province, rarely. */
function strategicStrike(
  session: SimContext, memory: AiMemory, situation: Assessment,
): void {
  const country = session.state.countries[situation.countryId];
  if (!country || (country.warheads ?? 0) < 1) return;
  const now = session.state.clock.gameTimeHours;
  const last = memory.lastStrikeHours.get(situation.countryId);
  if (last !== undefined && now - last < STRIKE_COOLDOWN_HOURS) return;
  const sites = situation.provinces.filter(
    (province) => (session.state.provinceBuildings[province.id]?.missileSite ?? 0) > 0,
  );
  if (sites.length === 0) return;

  const width = session.world.width;
  const enemyCapitals = new Set(
    [...situation.enemyIds]
      .map((id) => session.world.countries.find((c) => c.id === id)?.capitalProvinceId)
      .filter((id): id is number => id !== undefined),
  );
  let best = situation.enemyProvinces[0] ?? null;
  let bestValue = 0;
  for (const province of situation.enemyProvinces) {
    const inRange = sites.some((site) => wrappedDistance(
      site.center[0], site.center[1], province.center[0], province.center[1], width,
    ) <= MISSILE_RANGE);
    if (!inRange) continue;
    const value = strengthNear(
      situation.enemyArmies, province.center[0], province.center[1], CONTACT_RADIUS, width,
    ) + (enemyCapitals.has(province.id) ? 1500 : 0);
    if (value > bestValue) {
      bestValue = value;
      best = province;
    }
  }
  if (!best || bestValue <= 0) return;
  const done = applyCommand(session, {
    type: 'strike', countryId: situation.countryId, provinceId: best.id,
    x: best.center[0], z: best.center[1],
  }).ok;
  if (done) memory.lastStrikeHours.set(situation.countryId, now);
}

/**
 * 9. Answer peace offers honestly — accept while losing, refuse while winning —
 * and sue for peace when a losing country is fighting too many wars at once.
 * `proposeDiplomacy` only accepts a player-controlled recipient, so an offer
 * can only ever reach a human belligerent.
 */
function negotiate(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const state = session.state;
  for (const proposal of Object.values(state.diplomacyProposals ?? {})) {
    if (proposal.status !== 'pending' || proposal.kind !== 'peace') continue;
    if (proposal.toCountryId !== situation.countryId) continue;
    applyCommand(session, {
      type: 'respondDiplomacy', countryId: situation.countryId,
      proposalId: proposal.id, accept: situation.losing,
    });
    return;
  }
  if (!situation.losing || situation.enemyIds.size < MULTI_FRONT_WARS) return;
  const now = state.clock.gameTimeHours;
  const last = memory.lastPeaceOfferHours.get(situation.countryId);
  if (last !== undefined && now - last < PEACE_OFFER_COOLDOWN_HOURS) return;

  let target = -1;
  let targetSize = 0;
  for (const enemyId of situation.enemyIds) {
    if (state.countries[enemyId]?.controller !== 'player') continue;
    const size = situation.enemySizes.get(enemyId) ?? 0;
    if (size > targetSize) {
      targetSize = size;
      target = enemyId;
    }
  }
  if (target < 0) return;
  const done = applyCommand(session, {
    type: 'proposeDiplomacy', countryId: situation.countryId,
    targetCountryId: target, proposal: 'peace',
  }).ok;
  if (done) memory.lastPeaceOfferHours.set(situation.countryId, now);
}
