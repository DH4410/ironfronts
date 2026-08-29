/**
 * Resource-node spatial assignment + strategic baseline guarantee.
 *
 * Part A: every deposit's controlling country is the
 * owner of the province it PHYSICALLY sits in — point-in-province from the id
 * raster (`world.provinceAt`), never nearest-centroid. Water/void cannot own a
 * node.
 *
 * Part B: after correct assignment, every PLAYABLE country in a campaign is
 * guaranteed at least one reachable STONE and one reachable METAL deposit it
 * controls. Countries that already satisfy this are left untouched. Missing
 * deposits are placed deterministically in suitable owned terrain adjacent to a
 * land movement-graph node (mountain > hill > other land), never on water, a
 * city, or right on top of another same-kind deposit. Oil is NOT guaranteed —
 * it stays geographically rare on purpose.
 */

import type { ResourceNodeState } from './game-state';
import type { LandGraph } from './movement/graph';
import { nearestNode } from './movement/graph';
import { TERRAIN_CLASS } from './world-data';
import type { WorldData, WorldResourceNode } from './world-data';
import { wrappedDistance } from './geometry';
import { mulberry32 } from './rng';

/** A node farther than this from any land graph node is unreachable. */
export const ACCESS_SNAP_MAX = 260;
/** Guaranteed deposits keep clear of the province city at its centre. */
const MIN_CITY_DISTANCE = 70;
/** ...and of any pre-existing deposit of the same kind. */
const MIN_SAME_KIND_DISTANCE = 120;
/** Deterministic amount for a guaranteed deposit (mid strategic value). */
const GUARANTEE_AMOUNT: Record<'stone' | 'metal', number> = { stone: 160, metal: 95 };

export type GuaranteedKind = 'stone' | 'metal';

export interface ResourceBootstrapResult {
  readonly nodes: Record<number, ResourceNodeState>;
  readonly guarantees: ReadonlyArray<{
    readonly countryId: number;
    readonly kind: GuaranteedKind;
    readonly nodeId: number;
    readonly provinceId: number;
  }>;
  /** Playable countries that still lack a reachable stone/metal deposit — only
   *  happens for a country with no territory on the land movement graph (an
   *  unreachable island), which is not land-playable anyway. */
  readonly unsatisfied: ReadonlyArray<{ readonly countryId: number; readonly kind: GuaranteedKind }>;
  readonly diagnostics: {
    readonly natural: number;
    readonly naturalInWater: number;
    readonly reachable: number;
    readonly unreachable: number;
    readonly guaranteed: number;
  };
}

interface GraphNodeInfo {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly provinceId: number;
  readonly terrain: number;
}

/** Nudge a resource node that landed on a coastline/void texel back onto land. */
function resolveProvince(world: WorldData, x: number, z: number): number {
  const direct = world.provinceAt(x, z);
  if (direct >= 0) return direct;
  for (const radius of [8, 18, 32, 48]) {
    for (const [dx, dz] of [
      [radius, 0], [-radius, 0], [0, radius], [0, -radius],
      [radius, radius], [-radius, radius], [radius, -radius], [-radius, -radius],
    ] as const) {
      const hit = world.provinceAt(x + dx, z + dz);
      if (hit >= 0) return hit;
    }
  }
  return -1;
}

export function bootstrapResources(
  worldNodes: readonly WorldResourceNode[],
  world: WorldData,
  graph: LandGraph,
  provinceOwners: Record<number, number>,
  playableCountryIds: readonly number[],
  seed: number,
): ResourceBootstrapResult {
  const nodes: Record<number, ResourceNodeState> = {};
  let naturalInWater = 0;
  let reachable = 0;
  let unreachable = 0;

  // ---- Part A: assign every natural deposit by point-in-province -------
  for (const node of worldNodes) {
    const provinceId = resolveProvince(world, node.x, node.z);
    if (provinceId < 0) naturalInWater += 1;
    const accessNodeId = nearestNode(graph, node.x, node.z, ACCESS_SNAP_MAX);
    if (accessNodeId >= 0) reachable += 1; else unreachable += 1;
    nodes[node.id] = {
      id: node.id,
      kind: node.kind,
      x: node.x,
      z: node.z,
      remaining: node.amount,
      initialAmount: node.amount,
      controllerCountryId: provinceId >= 0 ? (provinceOwners[provinceId] ?? 0) : 0,
      provinceId,
      accessNodeId,
      extractorArmyId: null,
      status: 'idle',
      provenance: 'generatedNatural',
    };
  }

  // ---- Part B: guarantee stone + metal for each participant ----------
  // The caller passes ONLY the countries that need an economy this game — the
  // selected player plus any active AI / multiplayer participants — never every
  // theoretically playable nation. Natural geography stays scarce for the rest.
  const graphNodesByCountry = indexGraphNodesByCountry(world, graph, provinceOwners);
  const guarantees: Array<{
    countryId: number; kind: GuaranteedKind; nodeId: number; provinceId: number;
  }> = [];
  const unsatisfied: Array<{ countryId: number; kind: GuaranteedKind }> = [];

  for (const countryId of [...playableCountryIds].sort((a, b) => a - b)) {
    const result = guaranteeStrategicBaseline(
      nodes, { world, graph, provinceOwners }, countryId, seed, graphNodesByCountry,
    );
    for (const added of result.added) {
      reachable += 1;
      guarantees.push({
        countryId, kind: added.kind as GuaranteedKind,
        nodeId: added.id, provinceId: added.provinceId,
      });
    }
    for (const kind of result.unsatisfied) unsatisfied.push({ countryId, kind });
  }

  return {
    nodes,
    guarantees,
    unsatisfied,
    diagnostics: {
      natural: worldNodes.length, naturalInWater, reachable, unreachable,
      guaranteed: guarantees.length,
    },
  };
}

export interface ResourceWorldCtx {
  readonly world: WorldData;
  readonly graph: LandGraph;
  readonly provinceOwners: Record<number, number>;
}

/**
 * Guarantee ONE country a reachable stone + metal deposit it controls, added to
 * `nodes` in place. A no-op for a kind the country already controls reachably.
 * Same deterministic placement as the campaign bootstrap, so calling it later
 * for a country that joins mid-setup (an AI opponent flipped on after
 * `GameSession.create`, or a multiplayer participant) yields the same result as
 * if it had been in the initial participant list.
 */
export function guaranteeStrategicBaseline(
  nodes: Record<number, ResourceNodeState>,
  ctx: ResourceWorldCtx,
  countryId: number,
  seed: number,
  graphIndex?: Map<number, GraphNodeInfo[]>,
): { added: ResourceNodeState[]; unsatisfied: GuaranteedKind[] } {
  const { world, graph, provinceOwners } = ctx;
  const candidates = (graphIndex ?? indexGraphNodesByCountry(world, graph, provinceOwners))
    .get(countryId) ?? [];
  let nextId = 1;
  for (const key of Object.keys(nodes)) nextId = Math.max(nextId, Number(key) + 1);

  const added: ResourceNodeState[] = [];
  const unsatisfied: GuaranteedKind[] = [];
  for (const kind of ['stone', 'metal'] as const) {
    const already = Object.values(nodes).some(
      (n) => n.kind === kind && n.controllerCountryId === countryId && n.accessNodeId >= 0,
    );
    if (already) continue;

    const placed = placeGuaranteedDeposit(
      kind, candidates, nodes, world,
      mulberry32((seed ^ (countryId * 2654435761) ^ (kind === 'stone' ? 0x51 : 0xa7)) >>> 0),
    );
    if (!placed) { unsatisfied.push(kind); continue; }

    const node: ResourceNodeState = {
      id: nextId,
      kind,
      x: placed.x,
      z: placed.z,
      remaining: GUARANTEE_AMOUNT[kind],
      initialAmount: GUARANTEE_AMOUNT[kind],
      controllerCountryId: countryId,
      provinceId: placed.provinceId,
      accessNodeId: placed.accessNodeId,
      extractorArmyId: null,
      status: 'idle',
      provenance: 'scenarioGuarantee',
    };
    nodes[nextId] = node;
    added.push(node);
    nextId += 1;
  }
  return { added, unsatisfied };
}

function indexGraphNodesByCountry(
  world: WorldData, graph: LandGraph, provinceOwners: Record<number, number>,
): Map<number, GraphNodeInfo[]> {
  const byCountry = new Map<number, GraphNodeInfo[]>();
  for (let id = 0; id < graph.nodeCount; id += 1) {
    const x = graph.nodeX[id];
    const z = graph.nodeZ[id];
    const provinceId = world.provinceAt(x, z);
    if (provinceId < 0) continue;
    const owner = provinceOwners[provinceId] ?? 0;
    if (!owner) continue;
    (byCountry.get(owner) ?? byCountry.set(owner, []).get(owner)!).push({
      id, x, z, provinceId, terrain: world.terrainClassAt(x, z),
    });
  }
  return byCountry;
}

/** Terrain desirability for a deposit: mountain > hill > other land, water excluded. */
function terrainRank(terrain: number): number {
  if (terrain === TERRAIN_CLASS.mountain) return 0;
  if (terrain === TERRAIN_CLASS.hill) return 1;
  if (terrain === TERRAIN_CLASS.plain || terrain === TERRAIN_CLASS.forest) return 2;
  return 99; // urban / water — unsuitable
}

function placeGuaranteedDeposit(
  kind: GuaranteedKind,
  candidates: readonly GraphNodeInfo[],
  existing: Record<number, ResourceNodeState>,
  world: WorldData,
  random: () => number,
): { x: number; z: number; provinceId: number; accessNodeId: number } | null {
  const provinceCenter = new Map<number, readonly [number, number]>();
  for (const province of world.provinces) provinceCenter.set(province.id, province.center);

  const sameKind = Object.values(existing).filter((n) => n.kind === kind);

  // Deterministic candidate order: best terrain first (mountain > hill > other
  // land), seeded jitter to break ties.
  const ranked = candidates
    .map((node) => ({ node, rank: terrainRank(node.terrain), jitter: random() }))
    .sort((a, b) => (a.rank - b.rank) || (a.jitter - b.jitter));

  // A deposit point must always be: owned by the same province, land, NOT
  // urban, and adjacent to its (reachable) access node. Tiers only relax the
  // city-clear and same-kind-spacing niceties, and widen the search offsets.
  const isValidPoint = (x: number, z: number, provinceId: number): boolean => {
    const terrain = world.terrainClassAt(x, z);
    return terrain !== TERRAIN_CLASS.water
      && terrain !== TERRAIN_CLASS.urban
      && world.provinceAt(x, z) === provinceId;
  };

  const tiers: Array<{ cityClear: boolean; sameKindClear: boolean; rings: number[] }> = [
    { cityClear: true, sameKindClear: true, rings: [12, 20] },
    { cityClear: true, sameKindClear: false, rings: [12, 20] },
    { cityClear: false, sameKindClear: false, rings: [12, 8, 5, 20, 30] },
    { cityClear: false, sameKindClear: false, rings: [0] }, // last resort: on the node
  ];

  for (const tier of tiers) {
    for (const { node } of ranked) {
      const center = provinceCenter.get(node.provinceId);
      if (tier.cityClear && center &&
        wrappedDistance(node.x, node.z, center[0], center[1], world.width) < MIN_CITY_DISTANCE) {
        continue;
      }
      const baseAngle = random() * Math.PI * 2;
      for (const ring of tier.rings) {
        const steps = ring === 0 ? 1 : 8;
        for (let step = 0; step < steps; step += 1) {
          const angle = baseAngle + (step * Math.PI) / 4;
          const x = node.x + Math.cos(angle) * ring;
          const z = node.z + Math.sin(angle) * ring;
          if (!isValidPoint(x, z, node.provinceId)) continue;
          if (tier.sameKindClear &&
            sameKind.some((n) => wrappedDistance(x, z, n.x, n.z, world.width) < MIN_SAME_KIND_DISTANCE)) {
            continue;
          }
          return { x, z, provinceId: node.provinceId, accessNodeId: node.id };
        }
      }
    }
  }
  return null;
}
