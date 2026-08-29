/**
 * Building construction (BUILD).
 *
 * An owned URBAN province can queue one of three production buildings. Cost is
 * paid up front from the country stockpile; the active order advances in game
 * time; on completion the building level goes up by one, which unlocks the
 * matching unit line in that province's PRODUCE panel.
 *
 * Same ownership rule as unit production: an order belongs to the country that
 * paid for it. If the province is captured mid-build the order is void and the
 * cost is forfeit — the new owner does not inherit a half-built factory.
 *
 * v1 deliberately small: three buildings, one level each. No upgrades, no
 * infrastructure, no defensive works.
 */

import type { SimContext } from './sim-context';
import type { ConstructionOrder, ProvinceBuildings, Stockpile } from './game-state';
import type { BuildingId } from './units/unit-types';

/** Accelerated prototype clock, matching unit production. */
const BUILD_TIME_SCALE = 4;

interface BuildingDef {
  readonly label: string;
  readonly cost: Partial<Stockpile>;
  /** Real build time in game-hours; divided by BUILD_TIME_SCALE in play. */
  readonly buildTimeHours: number;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  barracks: { label: 'Barracks', cost: { funds: 120, stone: 60 }, buildTimeHours: 48 },
  ordnance: { label: 'Ordnance Workshop', cost: { funds: 220, stone: 70, metal: 60 }, buildTimeHours: 72 },
  tankPlant: { label: 'Tank Plant', cost: { funds: 300, stone: 90, metal: 120 }, buildTimeHours: 96 },
};

const EMPTY_BUILDINGS: ProvinceBuildings = { barracks: 0, tankPlant: 0, ordnance: 0 };

export interface BuildResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly orderId?: string;
}

function isUrban(ctx: SimContext, provinceId: number): boolean {
  return ctx.world.provinces.find((p) => p.id === provinceId)?.urban ?? false;
}

function levelOf(ctx: SimContext, provinceId: number, building: BuildingId): number {
  return (ctx.state.provinceBuildings[provinceId] ?? EMPTY_BUILDINGS)[building];
}

function queuedAlready(ctx: SimContext, provinceId: number, building: BuildingId): boolean {
  return (ctx.state.constructionQueues[provinceId] ?? []).some((o) => o.buildingId === building);
}

export function costLabel(building: BuildingId): string {
  return Object.entries(BUILDINGS[building].cost).map(([k, v]) => `${v} ${k}`).join(' · ');
}

/** Buildings `countryId` can start in this province right now (owned, urban,
 *  not already built or queued, affordable). */
export function buildableBuildings(
  ctx: SimContext, provinceId: number, countryId: number,
): BuildingId[] {
  if (ctx.state.provinceOwners[provinceId] !== countryId) return [];
  if (!isUrban(ctx, provinceId)) return [];
  const country = ctx.state.countries[countryId];
  if (!country) return [];
  const out: BuildingId[] = [];
  for (const id of Object.keys(BUILDINGS) as BuildingId[]) {
    if (levelOf(ctx, provinceId, id) >= 1) continue;
    if (queuedAlready(ctx, provinceId, id)) continue;
    if (!affordable(country.stockpile, BUILDINGS[id].cost)) continue;
    out.push(id);
  }
  return out;
}

function affordable(stockpile: Stockpile, cost: Partial<Stockpile>): boolean {
  for (const [key, amount] of Object.entries(cost)) {
    if ((stockpile as Record<string, number>)[key] < (amount ?? 0)) return false;
  }
  return true;
}

export function queueBuilding(
  ctx: SimContext, provinceId: number, buildingId: BuildingId, countryId: number,
): BuildResult {
  if (ctx.state.provinceOwners[provinceId] !== countryId) {
    return { ok: false, reason: 'Not your province.' };
  }
  if (!isUrban(ctx, provinceId)) return { ok: false, reason: 'Only urban provinces can build.' };
  if (levelOf(ctx, provinceId, buildingId) >= 1) {
    return { ok: false, reason: `${BUILDINGS[buildingId].label} already built here.` };
  }
  if (queuedAlready(ctx, provinceId, buildingId)) {
    return { ok: false, reason: `${BUILDINGS[buildingId].label} already under construction.` };
  }
  const country = ctx.state.countries[countryId];
  if (!country) return { ok: false, reason: 'Unknown country.' };
  const { cost } = BUILDINGS[buildingId];
  if (!affordable(country.stockpile, cost)) {
    return { ok: false, reason: `Not enough resources for a ${BUILDINGS[buildingId].label}.` };
  }
  for (const [key, amount] of Object.entries(cost)) {
    (country.stockpile as Record<string, number>)[key] -= amount ?? 0;
  }
  const order: ConstructionOrder = {
    id: `bld-${ctx.state.nextOrderId}`,
    buildingId,
    ownerCountryId: countryId,
    progressHours: 0,
    totalHours: BUILDINGS[buildingId].buildTimeHours / BUILD_TIME_SCALE,
  };
  ctx.state.nextOrderId += 1;
  (ctx.state.constructionQueues[provinceId] ??= []).push(order);
  return { ok: true, orderId: order.id };
}

export interface BuildingCompletion {
  readonly provinceId: number;
  readonly buildingId: BuildingId;
}

/** Advance every construction queue; returns buildings finished this tick. */
export function stepConstruction(ctx: SimContext, dtHours: number): BuildingCompletion[] {
  const done: BuildingCompletion[] = [];
  for (const [pidStr, queue] of Object.entries(ctx.state.constructionQueues)) {
    const provinceId = Number(pidStr);
    // Void leading orders whose payer no longer owns the province (captured).
    while (queue.length > 0 && ctx.state.provinceOwners[provinceId] !== queue[0].ownerCountryId) {
      queue.shift();
    }
    if (queue.length === 0) continue;
    const active = queue[0];
    active.progressHours += dtHours;
    if (active.progressHours < active.totalHours) continue;
    queue.shift();
    const buildings = (ctx.state.provinceBuildings[provinceId] ??= { ...EMPTY_BUILDINGS });
    buildings[active.buildingId] += 1;
    done.push({ provinceId, buildingId: active.buildingId });
  }
  for (const [pid, queue] of Object.entries(ctx.state.constructionQueues)) {
    if (queue.length === 0) delete ctx.state.constructionQueues[Number(pid)];
  }
  return done;
}
