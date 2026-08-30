import { describe, expect, it } from 'vitest';
import { bearingLabel, orderRouteForClient, retreatExitsForClient } from '../../apps/game-server/src/projection';

describe('bearingLabel', () => {
  it('maps world deltas to an 8-point compass (north = -z, east = +x)', () => {
    expect(bearingLabel(0, -10)).toBe('N');
    expect(bearingLabel(10, 0)).toBe('E');
    expect(bearingLabel(0, 10)).toBe('S');
    expect(bearingLabel(-10, 0)).toBe('W');
    expect(bearingLabel(10, -10)).toBe('NE');
    expect(bearingLabel(-8, 8)).toBe('SW');
  });
});

describe('retreatExitsForClient', () => {
  const graph = {
    nodeX: [0, 100, 100, -100],
    nodeZ: [0, -100, -80, 100],
  };

  it('collapses per-province routes to one entry per distinct escape node', () => {
    const routes = [
      { firstNodeId: 1, destinationProvinceId: 10 },
      { firstNodeId: 1, destinationProvinceId: 11 },
      { firstNodeId: 1, destinationProvinceId: 12 },
      { firstNodeId: 3, destinationProvinceId: 20 },
      { firstNodeId: 1, destinationProvinceId: 13 },
    ];
    const exits = retreatExitsForClient(routes, graph, 100_000, 0, 0);
    expect(exits.map((e) => e.firstNodeId)).toEqual([1, 3]);
  });

  it('keeps the first (shortest, already sorted) destination for each node and tags a bearing', () => {
    const exits = retreatExitsForClient(
      [
        { firstNodeId: 1, destinationProvinceId: 10 },
        { firstNodeId: 1, destinationProvinceId: 11 },
        { firstNodeId: 3, destinationProvinceId: 20 },
      ],
      graph, 100_000, 0, 0,
    );
    expect(exits[0]).toMatchObject({ firstNodeId: 1, destinationProvinceId: 10, bearing: 'NE' });
    expect(exits[1]).toMatchObject({ firstNodeId: 3, destinationProvinceId: 20, bearing: 'SW' });
  });

  it('resolves the escape bearing across the world-x seam', () => {
    // Army near x=0, escape node at x=99_990 — really 10 units west, not far east.
    const exits = retreatExitsForClient(
      [{ firstNodeId: 0, destinationProvinceId: 1 }],
      { nodeX: [99_990], nodeZ: [0] }, 100_000, 5, 0,
    );
    expect(exits[0].bearing).toBe('W');
  });
});

describe('orderRouteForClient', () => {
  const graph = { nodeX: [10, 40, 40, 80], nodeZ: [0, 0, 30, 30] };

  it('prefixes the live army position and walks the remaining path nodes', () => {
    const route = orderRouteForClient({ path: [1, 2, 3] }, graph, 5, -2);
    expect(route).toEqual([
      { x: 5, z: -2 }, { x: 40, z: 0 }, { x: 40, z: 30 }, { x: 80, z: 30 },
    ]);
  });

  it('returns null for an order whose path has been consumed', () => {
    expect(orderRouteForClient({ path: [] }, graph, 0, 0)).toBeNull();
  });
});
