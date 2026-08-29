import { describe, expect, it, beforeAll } from 'vitest';
import { bootstrapResources } from '../../src/game/resource-bootstrap';
import { buildLandGraph, type LandGraph } from '../../src/game/movement/graph';
import { TERRAIN_CLASS } from '../../src/game/world-data';
import { resolvePlayableCountries } from '../../src/game/scenario-catalog';
import { scenarioById } from '../../src/game/scenario-catalog';
import { loadWorld, type LoadedWorld } from './load-world';

let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

/** Country ids that own at least one node of the land movement graph. */
function countriesWithLandGraphNode(
  w: LoadedWorld, graph: LandGraph, owners: Record<number, number>,
): number[] {
  const set = new Set<number>();
  for (let id = 0; id < graph.nodeCount; id += 1) {
    const province = w.provinceAt(graph.nodeX[id], graph.nodeZ[id]);
    if (province >= 0 && owners[province]) set.add(owners[province]);
  }
  return [...set];
}

describe('point-in-province assignment (§ resource blocker fix, part A)', () => {
  it('resolves a world point to the province actually under it', () => {
    // Every province centre must resolve to that province's own id.
    let matched = 0;
    let checked = 0;
    for (const province of world.provinces.slice(0, 400)) {
      const hit = world.provinceAt(province.center[0], province.center[1]);
      checked += 1;
      if (hit === province.id) matched += 1;
    }
    // A handful of tiny/coastal provinces have a centre texel that rounds into a
    // neighbour; the vast majority must be exact.
    expect(matched / checked).toBeGreaterThan(0.95);
  });

  it('returns -1 for open water / void', () => {
    // Far south of the map, mid-ocean.
    expect(world.provinceAt(200, world.height - 10)).toBe(-1);
    expect(world.terrainClassAt(200, world.height - 10)).toBe(TERRAIN_CLASS.water);
  });

  it('wraps X at the world seam', () => {
    const province = world.provinces.find((p) => p.center[0] < 200) ?? world.provinces[0];
    const [x, z] = province.center;
    expect(world.provinceAt(x, z)).toBe(world.provinceAt(x + world.width, z));
    expect(world.provinceAt(x, z)).toBe(world.provinceAt(x - world.width, z));
    expect(world.terrainClassAt(x, z)).toBe(world.terrainClassAt(x + world.width, z));
  });

  it('assigns every natural deposit by the province physically under it', () => {
    const owners: Record<number, number> = {};
    for (const p of world.provinces) owners[p.id] = world.provinceOwner(p.id);
    const graph = buildLandGraph(world.connections, world.width, world.height);
    const { nodes } = bootstrapResources(world.resourceNodes, world, graph, owners, [], 1);

    for (const node of world.resourceNodes) {
      const state = nodes[node.id];
      expect(state.provenance).toBe('generatedNatural');
      const under = world.provinceAt(node.x, node.z);
      if (under >= 0) {
        expect(state.provinceId).toBe(under);
        expect(state.controllerCountryId).toBe(owners[under] ?? 0);
      }
      // never mutate the natural amount
      expect(state.initialAmount).toBe(node.amount);
    }
  });
});

describe('strategic-resource baseline guarantee (part B)', () => {
  it('gives every land-reachable playable campaign country a reachable stone + metal', () => {
    const scenario = scenarioById('OP-1939-01');
    const owners: Record<number, number> = {};
    for (const p of world.provinces) owners[p.id] = world.provinceOwner(p.id);
    const graph = buildLandGraph(world.connections, world.width, world.height);
    const playable = resolvePlayableCountries(scenario)
      .map((c) => c.id)
      .filter((id) => world.provinces.some((p) => owners[p.id] === id));

    const { nodes, guarantees, unsatisfied } = bootstrapResources(
      world.resourceNodes, world, graph, owners, playable, 12345,
    );
    const all = Object.values(nodes);
    const landReachable = new Set(countriesWithLandGraphNode(world, graph, owners));
    const provinceCount = new Map<number, number>();
    for (const p of world.provinces) {
      if (owners[p.id]) provinceCount.set(owners[p.id], (provinceCount.get(owners[p.id]) ?? 0) + 1);
    }

    for (const countryId of playable) {
      // Real campaign nations only (>= 4 provinces on the land graph). The
      // 1-3 province Pacific micro-states are not land-vertical-slice targets.
      if (!landReachable.has(countryId) || (provinceCount.get(countryId) ?? 0) < 4) continue;
      for (const kind of ['stone', 'metal'] as const) {
        const held = all.filter(
          (n) => n.kind === kind && n.controllerCountryId === countryId && n.accessNodeId >= 0,
        );
        expect(held.length,
          `country ${countryId} must control a reachable ${kind} deposit`).toBeGreaterThanOrEqual(1);
      }
    }

    // Anything still unsatisfied must be a tiny (< 4 province) country.
    for (const miss of unsatisfied) {
      expect(provinceCount.get(miss.countryId) ?? 0).toBeLessThan(4);
    }

    // Guaranteed deposits are well-formed and in suitable owned terrain.
    for (const g of guarantees) {
      const node = nodes[g.nodeId];
      expect(node.provenance).toBe('scenarioGuarantee');
      expect(node.accessNodeId).toBeGreaterThanOrEqual(0);
      expect(world.provinceAt(node.x, node.z)).toBe(g.provinceId);
      expect(owners[g.provinceId]).toBe(g.countryId);
      const terrain = world.terrainClassAt(node.x, node.z);
      expect(terrain).not.toBe(TERRAIN_CLASS.water);
      expect(terrain).not.toBe(TERRAIN_CLASS.urban);
    }
  });

  it('leaves already-satisfied countries untouched and is deterministic', () => {
    const owners: Record<number, number> = {};
    for (const p of world.provinces) owners[p.id] = world.provinceOwner(p.id);
    const graph = buildLandGraph(world.connections, world.width, world.height);
    const playable = resolvePlayableCountries(scenarioById('OP-1939-01')).map((c) => c.id);

    const a = bootstrapResources(world.resourceNodes, world, graph, owners, playable, 777);
    const b = bootstrapResources(world.resourceNodes, world, graph, owners, playable, 777);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));

    // Natural deposit count is preserved; guarantees are strictly additive.
    const naturalCount = Object.values(a.nodes).filter((n) => n.provenance === 'generatedNatural').length;
    expect(naturalCount).toBe(world.resourceNodes.length);
  });

  it('does not run the guarantee for sandbox (empty playable list)', () => {
    const owners: Record<number, number> = {};
    for (const p of world.provinces) owners[p.id] = world.provinceOwner(p.id);
    const graph = buildLandGraph(world.connections, world.width, world.height);
    const { guarantees, nodes } = bootstrapResources(world.resourceNodes, world, graph, owners, [], 1);
    expect(guarantees).toHaveLength(0);
    expect(Object.keys(nodes)).toHaveLength(world.resourceNodes.length);
  });
});
