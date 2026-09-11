/** Ownership-aware army movement on the land road graph. */

import type { SimContext } from '../sim-context';
import type { ArmyStack, MoveOrder } from './army';
import { ensureArmyRuntimeState, mergeStacks, stackBaseSpeed } from './army';
import {
  closestReachablePath, findPath, pathLength, type EdgeAllowed,
} from '../movement/pathfind';
import { nearestNode, type LandGraph } from '../movement/graph';
import { wrappedDistance } from '../geometry';
import { TERRAIN_CLASS } from '../world-data';
import { relationOf, setRelation } from '../game-state';
import { computeArmyVisibility } from '../visibility';

/**
 * Embark/disembark dwell time for a sea/ferry crossing, chosen to read as
 * ~20 real-world minutes at 1x sim speed — matching the server's fixed tick
 * (apps/game-server/src/timing.ts, not imported here to keep src/game free
 * of a dependency on the server package): SIMULATION_INTERVAL_MS = 100ms
 * real per tick, SIMULATION_TICK_HOURS = 0.05 sim-hours per tick, so at 1x
 * speed 1 real second = (1000 / 100) * 0.05 = 0.5 sim-hours. 20 real minutes
 * = 1200 real seconds * 0.5 sim-hours/real-second = 600 sim-hours.
 */
export const NAVAL_DWELL_HOURS = 600;

/**
 * Land graph + sea/ferry edges merged into one routable view, built lazily
 * and cached per graph instance. Only used as a fallback when a destination
 * is unreachable on the land graph alone (a different landmass) — every
 * ordinary land order still resolves via the untouched land-only graph, so
 * existing pathing/messages are unaffected.
 */
const combinedGraphCache = new WeakMap<LandGraph, LandGraph>();
function combinedGraph(graph: LandGraph): LandGraph {
  const cached = combinedGraphCache.get(graph);
  if (cached) return cached;
  const adjacency = graph.adjacency.map((list, id) => [...list, ...graph.seaAdjacency[id]]);
  const edgeCost = graph.edgeCost.map((list, id) => [...list, ...graph.seaEdgeCost[id]]);
  const component = new Int32Array(graph.nodeCount).fill(-1);
  const componentSize: number[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < graph.nodeCount; seed += 1) {
    if (component[seed] !== -1) continue;
    const componentId = componentSize.length;
    component[seed] = componentId;
    stack.length = 0;
    stack.push(seed);
    let size = 0;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      size += 1;
      for (const next of adjacency[current]) {
        if (component[next] === -1) {
          component[next] = componentId;
          stack.push(next);
        }
      }
    }
    componentSize.push(size);
  }
  const combined: LandGraph = { ...graph, adjacency, edgeCost, component, componentSize };
  combinedGraphCache.set(graph, combined);
  return combined;
}

/** Whether the hop from `from` to `to` is a sea/ferry edge (vs. a land edge). */
function isSeaEdge(graph: LandGraph, from: number, to: number): boolean {
  return graph.seaAdjacency[from]?.includes(to) ?? false;
}

/** Naval crossing states — army is not usable for combat/orders while so. */
const NAVAL_STATUSES = new Set(['embarking', 'atSea', 'disembarking']);

const TERRAIN_SPEED: Record<number, number> = {
  [TERRAIN_CLASS.plain]: 1,
  [TERRAIN_CLASS.hill]: 0.72,
  [TERRAIN_CLASS.mountain]: 0.48,
  [TERRAIN_CLASS.forest]: 0.8,
  [TERRAIN_CLASS.urban]: 0.9,
};
const ROAD_BONUS = 1.35;
/**
 * Global pacing multiplier on how far a stack travels per simulation hour.
 * Tuned purely for feel (strategic movement across a country, not units
 * sliding across the map) — it scales every stack equally, so relative speeds,
 * terrain ordering (plain > hill > mountain) and the road bonus are unchanged.
 * Does NOT touch the simulation tick.
 */
const STRATEGIC_MOVEMENT_SCALE = 0.30;
const EDGE_SAMPLE_DISTANCE = 18;
const edgeProvinceCache = new WeakMap<object, Map<string, number[]>>();

export interface MoveOrderResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
}

export interface CurrentMovementLeg {
  readonly targetX: number;
  readonly targetZ: number;
  /** Effective distance travelled per game hour on the current terrain. */
  readonly worldUnitsPerGameHour: number;
  readonly distance: number;
}

/** The currently traversed edge, expressed for network presentation. Keeping
 * this beside stepMovement ensures client ETA projection uses the exact same
 * terrain, road, retreat, and global movement multipliers as simulation. */
export function currentMovementLeg(session: SimContext, army: ArmyStack): CurrentMovementLeg | null {
  const order = army.order;
  if (!order?.path.length || army.status === 'engaged'
    || army.status === 'embarking' || army.status === 'disembarking') return null;
  const targetNode = order.path[0];
  const targetX = session.graph.nodeX[targetNode];
  const targetZ = session.graph.nodeZ[targetNode];
  const terrainScale = (TERRAIN_SPEED[session.world.terrainClassAt(army.x, army.z)] ?? 0.9) * ROAD_BONUS;
  const worldUnitsPerGameHour = stackBaseSpeed(army) * STRATEGIC_MOVEMENT_SCALE * terrainScale
    * (army.status === 'retreating' ? 3 : 1);
  return {
    targetX,
    targetZ,
    worldUnitsPerGameHour,
    distance: wrappedDistance(army.x, army.z, targetX, targetZ, session.world.width),
  };
}

function edgeProvinceIds(session: SimContext, from: number, to: number): number[] {
  const { graph, world } = session;
  const cache = edgeProvinceCache.get(graph) ?? new Map<string, number[]>();
  edgeProvinceCache.set(graph, cache);
  const key = from < to ? `${from}:${to}` : `${to}:${from}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const ax = graph.nodeX[from];
  const az = graph.nodeZ[from];
  let dx = graph.nodeX[to] - ax;
  if (dx > world.width / 2) dx -= world.width;
  else if (dx < -world.width / 2) dx += world.width;
  const dz = graph.nodeZ[to] - az;
  const length = Math.max(1, Math.hypot(dx, dz));
  const steps = Math.max(2, Math.ceil(length / EDGE_SAMPLE_DISTANCE));
  const ids = new Set<number>();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = ((ax + dx * t) % world.width + world.width) % world.width;
    const provinceId = world.provinceAt(x, az + dz * t);
    if (provinceId >= 0) ids.add(provinceId);
  }
  const result = [...ids];
  cache.set(key, result);
  return result;
}

function countriesOnEdge(session: SimContext, from: number, to: number): number[] {
  const countries = new Set<number>();
  for (const provinceId of edgeProvinceIds(session, from, to)) {
    const countryId = session.state.provinceOwners[provinceId] ?? 0;
    if (countryId > 0) countries.add(countryId);
  }
  return [...countries];
}

/** Edge predicate used by movement, pursuit, and friendly-only retreat routing. */
export function movementEdgeAllowed(
  session: SimContext, countryId: number, friendlyOnly = false,
  prospectiveWars: ReadonlySet<number> = new Set(),
): EdgeAllowed {
  return (from, to) => countriesOnEdge(session, from, to).every((ownerId) => (
    ownerId === countryId || (!friendlyOnly && (
      relationOf(session.state, countryId, ownerId) === 'war' || prospectiveWars.has(ownerId)
    ))
  ));
}

function warsRequiredForPath(session: SimContext, countryId: number, path: readonly number[]): number[] {
  const required = new Set<number>();
  for (let i = 1; i < path.length; i += 1) {
    for (const ownerId of countriesOnEdge(session, path[i - 1], path[i])) {
      if (ownerId !== countryId && relationOf(session.state, countryId, ownerId) !== 'war') {
        required.add(ownerId);
      }
    }
  }
  return [...required].sort((a, b) => a - b);
}

function installOrder(
  army: ArmyStack, path: readonly number[], destX: number, destZ: number,
  intent: 'move' | 'attack', target?: MoveOrder['target'],
): void {
  army.order = {
    path: path.slice(1), destX, destZ, intent, target, edgeProgress: 0,
  };
  army.status = 'moving';
  army.extractingNodeId = null;
}

/** Create a route, atomically declaring every confirmed transit war. */
export function issueMoveOrder(
  session: SimContext, armyId: string, destX: number, destZ: number,
  intent: 'move' | 'attack' = 'move', target?: MoveOrder['target'],
  confirmedWarCountryIds: readonly number[] = [],
  forcedWarCountryIds: readonly number[] = [],
): MoveOrderResult {
  const army = session.state.armies[armyId];
  if (!army) return { ok: false, reason: 'No such army.' };
  ensureArmyRuntimeState(army);
  if (army.status === 'engaged') return { ok: false, reason: 'Army is in close combat.' };
  if (army.status === 'retreating') return { ok: false, reason: 'Army is retreating.' };
  if (NAVAL_STATUSES.has(army.status)) return { ok: false, reason: 'Army is mid sea crossing.' };

  const component = session.graph.component[army.graphNodeId] ?? -1;
  let graph = session.graph;
  let goal = nearestNode(graph, destX, destZ, 600, component);
  if (goal < 0) {
    // Not reachable on the land graph alone — try the combined land+sea view
    // before giving up, so a destination on another landmass with a ferry
    // link still resolves (the crossing itself is handled in stepMovement).
    const merged = combinedGraph(session.graph);
    const mergedComponent = merged.component[army.graphNodeId] ?? -1;
    const mergedGoal = nearestNode(merged, destX, destZ, 600, mergedComponent);
    if (mergedGoal >= 0) {
      graph = merged;
      goal = mergedGoal;
    }
  }
  if (goal < 0) {
    // No reachable graph node near the point at all: it is water/void, or on
    // a landmass this army cannot reach even via a ferry link.
    const anyGoal = nearestNode(combinedGraph(session.graph), destX, destZ, 600, -1);
    return anyGoal < 0
      ? { ok: false, reason: 'That destination is off the road network — pick a spot on land.' }
      : { ok: false, reason: 'That destination is on a separate landmass this army cannot reach.' };
  }
  const unrestricted = findPath(graph, army.graphNodeId, goal);
  if (!unrestricted) {
    return { ok: false, reason: 'No route to that location.' };
  }
  const alreadyThere = unrestricted.length < 2;
  if (alreadyThere && intent === 'move') return { ok: false, reason: 'Already there.' };

  const currentlyLegal = findPath(
    graph, army.graphNodeId, goal, movementEdgeAllowed(session, army.ownerCountryId),
  );
  const required = new Set(currentlyLegal
    ? [] : warsRequiredForPath(session, army.ownerCountryId, unrestricted));
  for (const countryId of forcedWarCountryIds) {
    if (countryId > 0 && countryId !== army.ownerCountryId
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'war') required.add(countryId);
  }
  const confirmed = new Set(confirmedWarCountryIds);
  const requiredList = [...required].sort((a, b) => a - b);
  const missing = requiredList.filter((id) => !confirmed.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: missing };
  }
  const legal = currentlyLegal ?? findPath(
    graph, army.graphNodeId, goal,
    movementEdgeAllowed(session, army.ownerCountryId, false, required),
  );
  if (!legal || (!alreadyThere && legal.length < 2)) {
    return { ok: false, reason: 'No legal route to that location.' };
  }
  for (const countryId of required) setRelation(session.state, army.ownerCountryId, countryId, 'war');
  if (alreadyThere) {
    army.order = null;
    if (army.status === 'moving') army.status = 'idle';
    return { ok: true, nodes: 0 };
  }
  installOrder(
    army, legal, graph.nodeX[goal], graph.nodeZ[goal], intent,
    target ?? { kind: 'position', x: destX, z: destZ },
  );
  return { ok: true, nodes: legal.length - 1 };
}

export function issueStop(session: SimContext, armyId: string): boolean {
  const army = session.state.armies[armyId];
  if (!army) return false;
  ensureArmyRuntimeState(army);
  if (army.status === 'engaged' || army.status === 'retreating' || NAVAL_STATUSES.has(army.status)) return false;
  army.order = null;
  army.extractingNodeId = null;
  if (army.status === 'moving' || army.status === 'extracting') army.status = 'idle';
  return true;
}

function targetPoint(session: SimContext, army: ArmyStack, order: MoveOrder): [number, number] {
  if (order.target?.kind === 'province') {
    if (order.target.x !== undefined && order.target.z !== undefined) {
      return [order.target.x, order.target.z];
    }
    const center = session.world.provinces[order.target.provinceId]?.center;
    return center ? [center[0], center[1]] : [order.destX, order.destZ];
  }
  if (order.target?.kind === 'army') {
    const target = session.state.armies[order.target.armyId];
    const visibility = computeArmyVisibility(session.state, session.world, army.ownerCountryId)
      .get(order.target.armyId) ?? 'hidden';
    if (target && visibility !== 'hidden') {
      order.target.lastKnownX = target.x;
      order.target.lastKnownZ = target.z;
    }
    return [order.target.lastKnownX, order.target.lastKnownZ];
  }
  return order.target?.kind === 'position'
    ? [order.target.x, order.target.z]
    : [order.destX, order.destZ];
}

/**
 * Re-audit a live order against the current graph and diplomacy. Returns
 * `false` when the order can no longer make progress toward its target — it is
 * walled off by territory this army may not enter, or the destination is
 * simply unreachable — so the caller can stop the stack cleanly instead of
 * leaving it re-pathing in place every tick (which read as marching forever).
 */
function revalidateOrder(session: SimContext, army: ArmyStack, order: MoveOrder): boolean {
  const [targetX, targetZ] = targetPoint(session, army, order);
  const targetArmy = order.target?.kind === 'army' ? session.state.armies[order.target.armyId] : null;
  const targetVisible = targetArmy && order.target?.kind === 'army'
    && (computeArmyVisibility(session.state, session.world, army.ownerCountryId)
      .get(order.target.armyId) ?? 'hidden') !== 'hidden';
  const targetNode = targetArmy && targetVisible
    ? targetArmy.graphNodeId
    : nearestNode(session.graph, targetX, targetZ, 600, session.graph.component[army.graphNodeId]);
  const edgeAllowed = movementEdgeAllowed(session, army.ownerCountryId);
  // A path loaded from a save (or laid before a world rebuild) can contain an
  // edge the audited graph no longer links — e.g. a land connection whose
  // corridor was found to cross water. Treat a missing leading edge exactly
  // like an ownership-blocked one: re-path around it, or stop if nothing legal
  // remains. Without this a stale order lerps a land army straight over water.
  // A sea/ferry leg can never be blocked by ownership/war (open water isn't
  // territory) and is intentionally absent from the land-only adjacency
  // checked below, so it is never treated as missing or re-audited here —
  // stepMovement's naval state machine owns everything about that hop.
  if (order.path.length > 0 && isSeaEdge(session.graph, army.graphNodeId, order.path[0])) return true;
  const nextMissing = order.path.length > 0
    && !session.graph.adjacency[army.graphNodeId]?.includes(order.path[0]);
  const nextInvalid = order.path.length > 0
    && (nextMissing || !edgeAllowed(army.graphNodeId, order.path[0]));
  const pursuitChanged = order.target?.kind === 'army'
    && targetNode >= 0 && order.path[order.path.length - 1] !== targetNode;
  if (!nextInvalid && !pursuitChanged) return true;

  let path = targetNode >= 0
    ? findPath(session.graph, army.graphNodeId, targetNode, edgeAllowed)
    : null;
  if (!path) {
    path = closestReachablePath(session.graph, army.graphNodeId, targetX, targetZ, edgeAllowed);
  }
  order.path.splice(0, order.path.length, ...path.slice(1));
  Object.assign(order, {
    destX: session.graph.nodeX[path[path.length - 1]] ?? army.x,
    destZ: session.graph.nodeZ[path[path.length - 1]] ?? army.z,
  });
  order.edgeProgress = 0;

  if (order.path.length === 0) return false;
  // The best the repath could reach must actually be nearer the target than we
  // already are; otherwise the target is boxed off and we would just oscillate.
  const endNode = path[path.length - 1];
  const armyToTarget = wrappedDistance(army.x, army.z, targetX, targetZ, session.world.width);
  const endToTarget = wrappedDistance(
    session.graph.nodeX[endNode], session.graph.nodeZ[endNode],
    targetX, targetZ, session.world.width,
  );
  return endToTarget < armyToTarget - 1;
}

export interface RetreatPath {
  readonly firstNodeId: number;
  readonly destinationProvinceId: number;
  readonly path: readonly number[];
  readonly length: number;
}

/** Candidate friendly-only escape routes, sorted nearest first. */
export function retreatPaths(
  session: SimContext, army: ArmyStack, allowedFirstNodes?: readonly number[],
): RetreatPath[] {
  const firstNodes = allowedFirstNodes?.length
    ? [...allowedFirstNodes]
    : [...session.graph.adjacency[army.graphNodeId]];
  const allowed = movementEdgeAllowed(session, army.ownerCountryId, true);
  const result: RetreatPath[] = [];
  for (const first of firstNodes) {
    if (!allowed(army.graphNodeId, first)) continue;
    for (const province of session.world.provinces) {
      if ((session.state.provinceOwners[province.id] ?? 0) !== army.ownerCountryId) continue;
      const destinationNode = nearestNode(
        session.graph, province.center[0], province.center[1], 600,
        session.graph.component[first],
      );
      if (destinationNode < 0 || destinationNode === army.graphNodeId) continue;
      const tail = findPath(session.graph, first, destinationNode, allowed);
      if (!tail) continue;
      const path = [army.graphNodeId, ...tail];
      result.push({
        firstNodeId: first,
        destinationProvinceId: province.id,
        path,
        length: pathLength(session.graph, path),
      });
    }
  }
  result.sort((a, b) => a.length - b.length
    || a.destinationProvinceId - b.destinationProvinceId || a.firstNodeId - b.firstNodeId);
  return result;
}

export function issueRetreatOrder(session: SimContext, army: ArmyStack, route: RetreatPath): void {
  ensureArmyRuntimeState(army);
  const last = route.path[route.path.length - 1];
  installOrder(
    army, route.path, session.graph.nodeX[last], session.graph.nodeZ[last], 'move',
    { kind: 'province', provinceId: route.destinationProvinceId },
  );
  army.status = 'retreating';
  army.retreat = {
    destinationProvinceId: route.destinationProvinceId,
    protectedUntilNodeId: route.firstNodeId,
    protected: true,
  };
}

/**
 * Fold a just-arrived stack into a friendly stack already resting on the same
 * graph node. Both stacks must be genuinely at rest — no order, status `idle`,
 * and not referenced by any battle front — so a merge can never absorb a stack
 * that combat still tracks. The pre-existing stack keeps its id (selection and
 * any rally wiring stay put); the arriving one is removed and replication drops
 * it from the client on the next delta.
 */
function mergeArrivedStack(session: SimContext, arrived: ArmyStack): void {
  if (arrived.order || arrived.status !== 'idle' || arrived.battleFrontIds?.length) return;
  for (const other of Object.values(session.state.armies)) {
    if (other === arrived) continue;
    if (other.ownerCountryId !== arrived.ownerCountryId) continue;
    if (other.graphNodeId !== arrived.graphNodeId) continue;
    if (other.order || other.status !== 'idle' || other.battleFrontIds?.length) continue;
    mergeStacks(other, arrived);
    delete session.state.armies[arrived.id];
    return;
  }
}

/**
 * Advance every ordered stack. On arrival a friendly stack now merges into an
 * idle friendly stack already on the destination node (see `mergeArrivedStack`).
 */
export function stepMovement(session: SimContext, dtHours: number): void {
  const { graph, world } = session;
  for (const army of Object.values(session.state.armies)) {
    ensureArmyRuntimeState(army);
    const order = army.order;
    if (!order || army.status === 'engaged') continue;
    if (NAVAL_STATUSES.has(army.status)) {
      stepNavalCrossing(session, army, order, dtHours);
      continue;
    }
    // A revalidated order can be left with an empty path when the route now
    // crosses ground this army may not enter (a neutral border it is not at
    // war with). Resolve it to a clean stop instead of leaving the stack in
    // `moving` forever, which had it marching in place at the frontier.
    if (order.path.length === 0 || !revalidateOrder(session, army, order)) {
      army.order = null;
      army.status = 'idle';
      army.retreat = null;
      mergeArrivedStack(session, army);
      continue;
    }
    let budget = stackBaseSpeed(army) * dtHours * STRATEGIC_MOVEMENT_SCALE
      * (army.status === 'retreating' ? 3 : 1);

    while (budget > 0 && order.path.length > 0) {
      const targetNode = order.path[0];
      if (isSeaEdge(graph, army.graphNodeId, targetNode)) {
        // A sea/ferry hop is never crossed by the ordinary distance budget
        // below — begin the timed embark/transit/disembark sequence instead
        // and leave the rest of this tick's budget unused; stepNavalCrossing
        // takes over on the next tick.
        army.status = 'embarking';
        army.navalCrossing = { fromNodeId: army.graphNodeId, toNodeId: targetNode, hoursRemaining: NAVAL_DWELL_HOURS };
        budget = 0;
        break;
      }
      const tx = graph.nodeX[targetNode];
      const tz = graph.nodeZ[targetNode];
      const rawSegLen = wrappedDistance(army.x, army.z, tx, tz, world.width);
      // Coincident graph nodes (a zero-length road-graph edge) must not trap the
      // stack. The partial-move branch below only clears a node once the tick's
      // step reaches `segLen` — which the `Math.max(1, …)` floor keeps at 1 even
      // for a duplicate node — and on slow terrain (mountain 0.48 × road 1.35 ⇒
      // advance ≈ 0.83 < 1) that never happens, so the stack sits on the node
      // reporting "moving" forever. Step through any sub-unit segment for free.
      if (rawSegLen < 1) {
        army.x = tx;
        army.z = tz;
        army.lastGraphNodeId = army.graphNodeId;
        army.graphNodeId = targetNode;
        order.path.shift();
        order.edgeProgress = 0;
        if (army.retreat?.protected && targetNode === army.retreat.protectedUntilNodeId) {
          army.retreat.protected = false;
        }
        continue;
      }
      const segLen = rawSegLen;
      const speedScale = (TERRAIN_SPEED[world.terrainClassAt(army.x, army.z)] ?? 0.9) * ROAD_BONUS;
      const advance = budget * speedScale;
      if (advance >= segLen) {
        army.x = tx;
        army.z = tz;
        army.lastGraphNodeId = army.graphNodeId;
        army.graphNodeId = targetNode;
        order.path.shift();
        order.edgeProgress = 0;
        budget -= segLen / Math.max(speedScale, 0.01);
        if (army.retreat?.protected && targetNode === army.retreat.protectedUntilNodeId) {
          army.retreat.protected = false;
        }
      } else {
        const t = advance / segLen;
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
      const tracking = order.target?.kind === 'army';
      if (tracking) {
        revalidateOrder(session, army, order);
        if (order.path.length > 0) continue;
      }
      army.order = null;
      army.status = 'idle';
      army.retreat = null;
      mergeArrivedStack(session, army);
    }
  }
}

/**
 * Advance one tick of an in-progress sea/ferry crossing. Embarking and
 * disembarking are pure dwell timers (NAVAL_DWELL_HOURS each); the atSea
 * phase reuses the same distance-budget edge traversal as ordinary land
 * movement — reasonable open-water speed, no terrain penalty — for exactly
 * the one sea edge in `crossing`, then hands off to the disembark timer.
 */
function stepNavalCrossing(
  session: SimContext, army: ArmyStack, order: MoveOrder, dtHours: number,
): void {
  const { graph, world } = session;
  const crossing = army.navalCrossing;
  if (!crossing) {
    // Defensive: should be unreachable (status and navalCrossing are always
    // set together), but never leave a stack stuck in a naval status with no
    // crossing data to drive it.
    army.status = 'idle';
    return;
  }
  if (army.status === 'embarking') {
    crossing.hoursRemaining -= dtHours;
    if (crossing.hoursRemaining <= 0) army.status = 'atSea';
    return;
  }
  if (army.status === 'atSea') {
    const tx = graph.nodeX[crossing.toNodeId];
    const tz = graph.nodeZ[crossing.toNodeId];
    const rawSegLen = wrappedDistance(army.x, army.z, tx, tz, world.width);
    const advance = stackBaseSpeed(army) * dtHours * STRATEGIC_MOVEMENT_SCALE * ROAD_BONUS;
    if (rawSegLen < 1 || advance >= rawSegLen) {
      army.x = tx;
      army.z = tz;
      army.lastGraphNodeId = army.graphNodeId;
      army.graphNodeId = crossing.toNodeId;
      order.path.shift();
      order.edgeProgress = 0;
      army.status = 'disembarking';
      crossing.hoursRemaining = NAVAL_DWELL_HOURS;
    } else {
      const t = advance / rawSegLen;
      let dx = tx - army.x;
      if (dx > world.width / 2) dx -= world.width;
      else if (dx < -world.width / 2) dx += world.width;
      army.x = ((army.x + dx * t) % world.width + world.width) % world.width;
      army.z += (tz - army.z) * t;
    }
    return;
  }
  // disembarking
  crossing.hoursRemaining -= dtHours;
  if (crossing.hoursRemaining > 0) return;
  army.navalCrossing = null;
  if (order.path.length === 0) {
    army.order = null;
    army.status = 'idle';
    army.retreat = null;
    mergeArrivedStack(session, army);
  } else {
    army.status = 'moving';
  }
}
