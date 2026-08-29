/**
 * Urban unit production.
 *
 * A player-owned urban province with the right building can queue units. Cost
 * is paid up front; the active order advances in game time; on completion the
 * unit spawns at the province's movement node and auto-stacks with any friendly
 * army already there.
 */

import type { SimContext } from './sim-context';
import type { ProductionOrder } from './game-state';
import type { BuildingId } from './units/unit-types';
import { UNIT_TYPE_BY_ID, unitType } from './units/unit-catalog';
import { makeGroup, mergeStacks, type ArmyStack } from './units/army';
import { nearestNode } from './movement/graph';
import { issueMoveOrder } from './units/movement';

/** Accelerated prototype clock: real build times divided by this. */
const BUILD_TIME_SCALE = 4;

export interface ProduceResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly orderId?: string;
}

function hasBuilding(session: SimContext, provinceId: number, building: BuildingId): boolean {
  const b = session.state.provinceBuildings[provinceId];
  if (!b) return false;
  return (building === 'barracks' ? b.barracks
    : building === 'tankPlant' ? b.tankPlant
    : b.ordnance) > 0;
}

/** Units `countryId` can produce in this province now. */
export function producibleUnits(
  session: SimContext, provinceId: number, countryId: number,
): string[] {
  if (session.state.provinceOwners[provinceId] !== countryId) return [];
  const out: string[] = [];
  for (const type of UNIT_TYPE_BY_ID.values()) {
    if (hasBuilding(session, provinceId, type.requiredBuilding)) out.push(type.id);
  }
  return out;
}

export function queueUnit(
  session: SimContext, provinceId: number, unitTypeId: string,
  countryId: number,
): ProduceResult {
  if (session.state.provinceOwners[provinceId] !== countryId) {
    return { ok: false, reason: 'Not your province.' };
  }
  const type = UNIT_TYPE_BY_ID.get(unitTypeId);
  if (!type) return { ok: false, reason: 'Unknown unit.' };
  if (!hasBuilding(session, provinceId, type.requiredBuilding)) {
    return { ok: false, reason: `Requires a ${type.requiredBuilding}.` };
  }
  const country = session.state.countries[countryId];
  if (!country) return { ok: false, reason: 'Unknown country.' };
  for (const [key, amount] of Object.entries(type.cost)) {
    if ((country.stockpile as Record<string, number>)[key] < (amount ?? 0)) {
      return { ok: false, reason: `Not enough ${key}.` };
    }
  }
  for (const [key, amount] of Object.entries(type.cost)) {
    (country.stockpile as Record<string, number>)[key] -= amount ?? 0;
  }
  const order: ProductionOrder = {
    id: `ord-${session.state.nextOrderId}`,
    unitTypeId,
    ownerCountryId: countryId,
    progressHours: 0,
    totalHours: type.buildTimeHours / BUILD_TIME_SCALE,
  };
  session.state.nextOrderId += 1;
  (session.state.productionQueues[provinceId] ??= []).push(order);
  return { ok: true, orderId: order.id };
}

export interface UnitCompletion {
  readonly provinceId: number;
  readonly unitTypeId: string;
  readonly armyId: string;
}

/** Advance every queue; returns units finished this tick (for notifications). */
export function stepProduction(session: SimContext, dtHours: number): UnitCompletion[] {
  const completed: UnitCompletion[] = [];
  for (const [pidStr, queue] of Object.entries(session.state.productionQueues)) {
    const provinceId = Number(pidStr);
    // Drop any leading orders whose paying country no longer owns the province
    // (captured since it was queued). Cost is forfeit — v1 rule.
    while (queue.length > 0 && session.state.provinceOwners[provinceId] !== queue[0].ownerCountryId) {
      queue.shift();
    }
    if (queue.length === 0) continue;
    const active = queue[0];
    active.progressHours += dtHours;
    if (active.progressHours < active.totalHours) continue;

    queue.shift();
    const armyId = spawnUnit(session, provinceId, active.unitTypeId, active.ownerCountryId);
    completed.push({ provinceId, unitTypeId: active.unitTypeId, armyId });

    // Rally point: march the fresh unit (or the idle stack it joined) toward it.
    const rally = session.state.rallyPoints[provinceId];
    const army = session.state.armies[armyId];
    if (rally && army && !army.order && army.status === 'idle') {
      issueMoveOrder(session, armyId, rally.x, rally.z, 'move');
    }
  }
  // Drop empty queues so the record stays sparse.
  for (const [pid, queue] of Object.entries(session.state.productionQueues)) {
    if (queue.length === 0) delete session.state.productionQueues[Number(pid)];
  }
  return completed;
}

function spawnUnit(
  session: SimContext, provinceId: number, unitTypeId: string, ownerCountryId: number,
): string {
  const world = session.world;
  const province = world.provinces.find((p) => p.id === provinceId);
  const [cx, cz] = province ? province.center : [world.width / 2, world.height / 2];
  const node = nearestNode(session.graph, cx, cz, 500);
  const nx = node >= 0 ? session.graph.nodeX[node] : cx;
  const nz = node >= 0 ? session.graph.nodeZ[node] : cz;

  // Auto-stack onto a friendly idle army already at that node.
  const existing = Object.values(session.state.armies).find(
    (a) => a.ownerCountryId === ownerCountryId
      && a.graphNodeId === node && !a.order && a.extractingNodeId === null,
  );
  const group = makeGroup(unitTypeId, 1);
  if (existing) {
    const fresh: ArmyStack = {
      id: 'tmp', ownerCountryId, name: 'tmp',
      x: nx, z: nz, graphNodeId: node, units: [group],
      status: 'idle', order: null, extractingNodeId: null,
    };
    mergeStacks(existing, fresh);
    return existing.id;
  }
  const id = `army-${session.state.nextArmyId}`;
  session.state.nextArmyId += 1;
  session.state.armies[id] = {
    id,
    ownerCountryId,
    name: `${unitType(unitTypeId).name} Detachment`,
    x: nx,
    z: nz,
    graphNodeId: node >= 0 ? node : 0,
    units: [group],
    status: 'idle',
    order: null,
    extractingNodeId: null,
  };
  return id;
}
