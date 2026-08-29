/**
 * Army movement along the land road graph (§14, §16, §12).
 *
 * Orders are issued by the player (or AI) through `GameSession`; `stepMovement`
 * advances every ordered stack each simulation tick. Speed is the slowest unit
 * in the stack, scaled by the terrain it is currently crossing. Friendly stacks
 * that come to rest on the same graph node auto-merge into one.
 */

import type { SimContext } from '../sim-context';
import type { ArmyStack } from './army';
import { mergeStacks, stackBaseSpeed } from './army';
import { findPath } from '../movement/pathfind';
import { nearestNode } from '../movement/graph';
import { wrappedDistance } from '../geometry';
import { TERRAIN_CLASS } from '../world-data';

/** Terrain speed multipliers (§16). The graph itself is the road network, so a
 *  flat road bonus is folded in. */
const TERRAIN_SPEED: Record<number, number> = {
  [TERRAIN_CLASS.plain]: 1.0,
  [TERRAIN_CLASS.hill]: 0.72,
  [TERRAIN_CLASS.mountain]: 0.48,
  [TERRAIN_CLASS.forest]: 0.8,
  [TERRAIN_CLASS.urban]: 0.9,
};
const ROAD_BONUS = 1.35;
/** Friendly stacks within this world-distance of a shared node merge. */
const MERGE_SNAP = 26;

export interface MoveOrderResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly nodes?: number;
}

/**
 * Order `armyId` to move to the land node nearest (destX, destZ), pathing on
 * the road graph. `intent` colours the route and marks an attack move.
 */
export function issueMoveOrder(
  session: SimContext, armyId: string, destX: number, destZ: number,
  intent: 'move' | 'attack' = 'move',
): MoveOrderResult {
  const army = session.state.armies[armyId];
  if (!army) return { ok: false, reason: 'No such army.' };
  const graph = session.graph;
  const component = graph.component[army.graphNodeId] ?? -1;
  const goal = nearestNode(graph, destX, destZ, 600, component);
  if (goal < 0) return { ok: false, reason: 'No land route to that location.' };
  const path = findPath(graph, army.graphNodeId, goal);
  if (!path || path.length < 2) {
    if (goal === army.graphNodeId) return { ok: false, reason: 'Already there.' };
    return { ok: false, reason: 'No land route to that location.' };
  }
  // Drop the first node (the army is standing on it).
  const remaining = path.slice(1);
  army.order = {
    path: remaining,
    destX: graph.nodeX[goal],
    destZ: graph.nodeZ[goal],
    intent,
    edgeProgress: 0,
  };
  army.status = 'moving';
  army.extractingNodeId = null;
  return { ok: true, nodes: remaining.length };
}

export function issueStop(session: SimContext, armyId: string): boolean {
  const army = session.state.armies[armyId];
  if (!army) return false;
  army.order = null;
  army.extractingNodeId = null;
  if (army.status === 'moving' || army.status === 'extracting') army.status = 'idle';
  return true;
}

/** Advance every ordered stack. Called once per simulation tick. */
export function stepMovement(session: SimContext, dtHours: number): void {
  const graph = session.graph;
  const world = session.world;
  const arrived: ArmyStack[] = [];

  for (const army of Object.values(session.state.armies)) {
    const order = army.order;
    if (!order || order.path.length === 0) continue;

    let budget = stackBaseSpeed(army) * dtHours;
    if (budget <= 0) continue;

    while (budget > 0 && order.path.length > 0) {
      const targetNode = order.path[0];
      const tx = graph.nodeX[targetNode];
      const tz = graph.nodeZ[targetNode];
      const segLen = Math.max(1, wrappedDistance(army.x, army.z, tx, tz, world.width));
      const terrain = world.terrainClassAt(army.x, army.z);
      const speedScale = (TERRAIN_SPEED[terrain] ?? 0.9) * ROAD_BONUS;
      const advance = budget * speedScale;

      if (advance >= segLen) {
        // Reached the node.
        army.x = tx;
        army.z = tz;
        army.graphNodeId = targetNode;
        order.path.shift();
        order.edgeProgress = 0;
        budget -= segLen / Math.max(speedScale, 0.01);
      } else {
        const t = advance / segLen;
        // Interpolate toward the node (wrapped X handled by short-path lerp).
        let dx = tx - army.x;
        if (dx > world.width / 2) dx -= world.width;
        else if (dx < -world.width / 2) dx += world.width;
        army.x = ((army.x + dx * t) % world.width + world.width) % world.width;
        army.z += (tz - army.z) * t;
        order.edgeProgress += advance;
        budget = 0;
      }
    }

    if (order.path.length === 0) {
      army.order = null;
      army.status = 'idle';
      arrived.push(army);
    }
  }

  for (const army of arrived) mergeArrivals(session, army);
}

/** Merge any friendly, idle, non-extracting stacks sharing this army's node. */
function mergeArrivals(session: SimContext, army: ArmyStack): void {
  if (!session.state.armies[army.id]) return; // already merged away
  for (const other of Object.values(session.state.armies)) {
    if (other.id === army.id) continue;
    if (other.ownerCountryId !== army.ownerCountryId) continue;
    if (other.order || other.extractingNodeId !== null) continue;
    const sameNode = other.graphNodeId === army.graphNodeId
      || wrappedDistance(other.x, other.z, army.x, army.z, session.world.width) <= MERGE_SNAP;
    if (!sameNode) continue;
    // Merge the smaller stack into the larger; keep the larger id/name stable.
    const [keep, gone] = army.units.length >= other.units.length ? [army, other] : [other, army];
    mergeStacks(keep, gone);
    keep.x = army.x;
    keep.z = army.z;
    keep.graphNodeId = army.graphNodeId;
    delete session.state.armies[gone.id];
    if (gone.id === army.id) return; // this army was the one removed
  }
}
