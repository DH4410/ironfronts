import { describe, expect, it } from 'vitest';
import {
  buildLandGraph, largestComponent, nearestNode,
} from '../../src/game/movement/graph';

/** Stride-8 connection record helper: [x1,y1,x2,y2,medium,0,0,0]. */
function seg(x1: number, y1: number, x2: number, y2: number, land: boolean): number[] {
  return [x1, y1, x2, y2, land ? 1 : 0, 0, 0, 0];
}

describe('land movement graph (guardrail 2)', () => {
  it('excludes sea/ferry edges so a land army cannot cross water', () => {
    const conn = new Float32Array([
      ...seg(0, 0, 100, 0, true),      // land A-B
      ...seg(100, 0, 200, 0, true),    // land B-C
      ...seg(200, 0, 900, 0, false),   // SEA C-D (island bridge) — must be dropped
      ...seg(900, 0, 1000, 0, true),   // land D-E
    ]);
    const graph = buildLandGraph(conn, 4000, 2000);

    expect(graph.componentSize.length).toBe(2); // {A,B,C} and {D,E}, not bridged
    const nodeAtStart = nearestNode(graph, 0, 0);
    const nodeAtEnd = nearestNode(graph, 1000, 0);
    expect(graph.component[nodeAtStart]).not.toBe(graph.component[nodeAtEnd]);
  });

  it('merges shared endpoints into one node and links neighbours', () => {
    const conn = new Float32Array([
      ...seg(0, 0, 100, 0, true),
      ...seg(100, 0, 100, 100, true), // shares the (100,0) vertex
    ]);
    const graph = buildLandGraph(conn, 4000, 2000);
    expect(graph.nodeCount).toBe(3);
    expect(graph.componentSize).toEqual([3]);
    const mid = nearestNode(graph, 100, 0);
    expect(graph.adjacency[mid]).toHaveLength(2);
  });

  it('wraps X for distance and nearest-node', () => {
    const width = 1000;
    const conn = new Float32Array([...seg(990, 50, 10, 50, true)]); // crosses the seam
    const graph = buildLandGraph(conn, width, 500);
    const a = nearestNode(graph, 992, 50);
    const b = nearestNode(graph, 8, 50);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(a).not.toBe(b);
    // edge cost is the wrapped (short) distance ~20, not ~980.
    expect(graph.edgeCost[a][0]).toBeLessThan(50);
  });

  it('largestComponent returns the biggest mainland', () => {
    // Segment endpoints must be spaced well beyond GRAPH_CELL (20) or the
    // quantiser merges them — real world segments are ~25+ units long.
    const conn = new Float32Array([
      ...seg(0, 0, 100, 0, true),
      ...seg(100, 0, 200, 0, true),
      ...seg(200, 0, 300, 0, true),
      ...seg(600, 600, 700, 600, true), // small island
    ]);
    const graph = buildLandGraph(conn, 4000, 2000);
    const main = largestComponent(graph);
    expect(graph.componentSize[main]).toBe(4);
  });

  it('nearestNode honours maxDistance and component restriction', () => {
    const conn = new Float32Array([
      ...seg(0, 0, 100, 0, true),
      ...seg(1000, 0, 1100, 0, true),
    ]);
    const graph = buildLandGraph(conn, 4000, 2000);
    expect(nearestNode(graph, 500, 0, 100)).toBe(-1); // nothing within 100
    const near0 = nearestNode(graph, 50, 0);
    // Restricting to near0's component excludes the far cluster: nothing in
    // that component is within 200 units of (1050, 0).
    const far = nearestNode(graph, 1050, 0, 200, graph.component[near0]);
    expect(far).toBe(-1);
  });
});
