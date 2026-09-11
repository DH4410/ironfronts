/**
 * Read-only situation assessment for the AI.
 *
 * `stepAi` builds these indices ONCE per pass and every AI country plans
 * against them, so the whole AI stays O(provinces + armies) plus per-country
 * work. Nothing in this module mutates `GameState` — all AI mutations go
 * through `applyCommand`.
 */

import type { SimContext } from '../sim-context';
import type { GameState } from '../game-state';
import { relationOf } from '../game-state';
import type { ArmyStack } from '../units/army';
import { unitType } from '../units/unit-catalog';
import type { WorldProvince } from '../world-data';
import { wrappedDistance } from '../geometry';
import { nearestNode } from '../movement/graph';

/** An enemy stack this close to a city is a live threat to it (~2 moves). */
export const THREAT_RADIUS = 900;
/** Defenders counted around an objective when testing local superiority. */
export const CONTACT_RADIUS = 500;

/**
 * Cross-pass AI bookkeeping. Deliberately NOT part of `GameState`: it is a
 * planning cache, not simulation truth, and must never enter a save. Keyed by
 * the state object, the same pattern `units/movement.ts` uses for its edge
 * cache. A reload simply re-baselines, which is harmless.
 */
export interface AiMemory {
  /** country id -> province count the first time we saw it (losing-ground test). */
  readonly baselineProvinces: Map<number, number>;
  /** country id -> game-hour of its last strategic strike. */
  readonly lastStrikeHours: Map<number, number>;
  /** country id -> game-hour of its last peace proposal. */
  readonly lastPeaceOfferHours: Map<number, number>;
  /** province id -> its road-graph node (resolved once, then reused). */
  readonly provinceNodes: Map<number, number>;
}

const MEMORY = new WeakMap<GameState, AiMemory>();

export function aiMemory(state: GameState): AiMemory {
  let memory = MEMORY.get(state);
  if (!memory) {
    memory = {
      baselineProvinces: new Map(),
      lastStrikeHours: new Map(),
      lastPeaceOfferHours: new Map(),
      provinceNodes: new Map(),
    };
    MEMORY.set(state, memory);
  }
  return memory;
}

/**
 * A province's garrison node: the road node fresh units spawn on. Uses the
 * same uncapped `nearestNode` lookup as `production.spawnUnit`, so "standing on
 * the city" means exactly what production means by it. Cached — the scan is
 * linear in `nodeCount` and must not run per tick.
 */
export function provinceNode(
  session: SimContext, memory: AiMemory, province: WorldProvince,
): number {
  let node = memory.provinceNodes.get(province.id);
  if (node === undefined) {
    node = nearestNode(session.graph, province.center[0], province.center[1]);
    memory.provinceNodes.set(province.id, node);
  }
  return node;
}

/**
 * Fighting weight of a stack. Pooled hp already folds unit count, unit quality
 * (a medium tank is 190hp against an infantryman's 100) and battle damage into
 * one number — exactly what "am I outnumbered" and "do I have 1.5x" need.
 * Engineers are excluded: they are the mining arm, not the line.
 */
export function combatStrength(stack: ArmyStack): number {
  let hp = 0;
  for (const group of stack.units) {
    if (unitType(group.typeId).category === 'engineer') continue;
    hp += group.hp;
  }
  return hp;
}

/** Combined combat weight of `armies` within `radius` of a world point. */
export function strengthNear(
  armies: readonly ArmyStack[], x: number, z: number, radius: number, worldWidth: number,
): number {
  let total = 0;
  for (const army of armies) {
    if (wrappedDistance(army.x, army.z, x, z, worldWidth) <= radius) total += combatStrength(army);
  }
  return total;
}

/** One of our cities and how well it is currently held. */
export interface CityStatus {
  readonly province: WorldProvince;
  readonly node: number;
  readonly isCapital: boolean;
  readonly garrison: ArmyStack[];
  readonly garrisonStrength: number;
  readonly threatStrength: number;
}

export interface Assessment {
  readonly countryId: number;
  readonly armies: readonly ArmyStack[];
  readonly provinces: readonly WorldProvince[];
  /** Urban provinces plus the capital — the places worth garrisoning. */
  readonly cities: readonly CityStatus[];
  readonly capital: CityStatus | null;
  readonly enemyIds: ReadonlySet<number>;
  readonly enemyArmies: readonly ArmyStack[];
  readonly enemyProvinces: readonly WorldProvince[];
  /** enemy country id -> provinces it holds, for "who is the strongest enemy". */
  readonly enemySizes: ReadonlyMap<number, number>;
  /** Enemy capital province ids — the objectives worth weighting. */
  readonly enemyCapitals: ReadonlySet<number>;
  /** Enemy province nearest our capital — the axis the front forms along. */
  readonly frontTarget: WorldProvince | null;
  /** Our own province nearest `frontTarget`; where loose stacks gather. */
  readonly staging: WorldProvince | null;
  readonly atWar: boolean;
  /** Fewer provinces than we started with, or the capital is threatened. */
  readonly losing: boolean;
}

export function indexArmies(state: GameState): Map<number, ArmyStack[]> {
  const byOwner = new Map<number, ArmyStack[]>();
  for (const army of Object.values(state.armies)) {
    const list = byOwner.get(army.ownerCountryId);
    if (list) list.push(army);
    else byOwner.set(army.ownerCountryId, [army]);
  }
  return byOwner;
}

export function indexProvinces(session: SimContext): Map<number, WorldProvince[]> {
  const byOwner = new Map<number, WorldProvince[]>();
  for (const province of session.world.provinces) {
    const owner = session.state.provinceOwners[province.id] ?? 0;
    if (!owner) continue;
    const list = byOwner.get(owner);
    if (list) list.push(province);
    else byOwner.set(owner, [province]);
  }
  return byOwner;
}

export function assess(
  session: SimContext,
  memory: AiMemory,
  countryId: number,
  armiesByOwner: ReadonlyMap<number, ArmyStack[]>,
  provincesByOwner: ReadonlyMap<number, WorldProvince[]>,
): Assessment {
  const { state, world } = session;
  const armies = armiesByOwner.get(countryId) ?? [];
  const provinces = provincesByOwner.get(countryId) ?? [];

  const enemyIds = new Set<number>();
  for (const other of Object.values(state.countries)) {
    if (other.id !== countryId && relationOf(state, countryId, other.id) === 'war') {
      enemyIds.add(other.id);
    }
  }
  const enemyArmies: ArmyStack[] = [];
  const enemyProvinces: WorldProvince[] = [];
  const enemySizes = new Map<number, number>();
  const enemyCapitals = new Set<number>();
  for (const enemyId of enemyIds) {
    for (const army of armiesByOwner.get(enemyId) ?? []) enemyArmies.push(army);
    const held = provincesByOwner.get(enemyId) ?? [];
    for (const province of held) enemyProvinces.push(province);
    enemySizes.set(enemyId, held.length);
    const seat = world.countries.find((c) => c.id === enemyId)?.capitalProvinceId;
    if (seat !== undefined) enemyCapitals.add(seat);
  }

  const capitalId = world.countries.find((c) => c.id === countryId)?.capitalProvinceId ?? -1;
  const cities: CityStatus[] = [];
  let capital: CityStatus | null = null;
  for (const province of provinces) {
    if (!province.urban && province.id !== capitalId) continue;
    const node = provinceNode(session, memory, province);
    const garrison = armies.filter((a) => a.graphNodeId === node && a.status !== 'retreating');
    let garrisonStrength = 0;
    for (const army of garrison) garrisonStrength += combatStrength(army);
    const status: CityStatus = {
      province,
      node,
      isCapital: province.id === capitalId,
      garrison,
      garrisonStrength,
      threatStrength: strengthNear(
        enemyArmies, province.center[0], province.center[1], THREAT_RADIUS, world.width,
      ),
    };
    cities.push(status);
    if (province.id === capitalId) capital = status;
  }
  // Capital first, then the most badly outmatched city.
  cities.sort((a, b) => Number(b.province.id === capitalId) - Number(a.province.id === capitalId)
    || (b.threatStrength - b.garrisonStrength) - (a.threatStrength - a.garrisonStrength));

  const anchor = capital?.province ?? provinces[0] ?? null;
  const frontTarget = anchor ? nearestProvince(enemyProvinces, anchor, world.width) : null;
  const staging = frontTarget ? nearestProvince(provinces, frontTarget, world.width) : null;

  const baseline = memory.baselineProvinces.get(countryId);
  if (baseline === undefined) memory.baselineProvinces.set(countryId, provinces.length);

  return {
    countryId,
    armies,
    provinces,
    cities,
    capital,
    enemyIds,
    enemyArmies,
    enemyProvinces,
    enemySizes,
    enemyCapitals,
    frontTarget,
    staging,
    atWar: enemyIds.size > 0,
    losing: provinces.length < (baseline ?? provinces.length)
      || (capital !== null && capital.threatStrength > capital.garrisonStrength),
  };
}

function nearestProvince(
  candidates: readonly WorldProvince[], to: WorldProvince, worldWidth: number,
): WorldProvince | null {
  let best: WorldProvince | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = wrappedDistance(
      candidate.center[0], candidate.center[1], to.center[0], to.center[1], worldWidth,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
