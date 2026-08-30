/**
 * A* pathfinding on the land movement graph.
 *
 * Pure. Returns the node-id sequence from `start` to `goal` inclusive, or
 * `null` when they are not connected (different components — e.g. an island
 * exclave). The heuristic is straight-line wrapped distance, which is
 * admissible because every edge cost is the true wrapped distance between its
 * endpoints.
 */

import type { LandGraph } from './graph';
import { wrappedDistance } from '../geometry';

export type EdgeAllowed = (from: number, to: number) => boolean;

export function findPath(
  graph: LandGraph, start: number, goal: number, edgeAllowed?: EdgeAllowed,
): number[] | null {
  if (start < 0 || goal < 0 || start >= graph.nodeCount || goal >= graph.nodeCount) return null;
  if (start === goal) return [start];
  if (graph.component[start] !== graph.component[goal]) return null;

  const h = (node: number): number => wrappedDistance(
    graph.nodeX[node], graph.nodeZ[node], graph.nodeX[goal], graph.nodeZ[goal], graph.width,
  );

  const gScore = new Float64Array(graph.nodeCount).fill(Infinity);
  const cameFrom = new Int32Array(graph.nodeCount).fill(-1);
  gScore[start] = 0;

  // Binary min-heap of [fScore, node].
  const heap: Array<[number, number]> = [[h(start), start]];
  const push = (item: [number, number]): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  const closed = new Uint8Array(graph.nodeCount);
  while (heap.length > 0) {
    const [, current] = pop();
    if (current === goal) {
      const path: number[] = [current];
      let node = current;
      while (cameFrom[node] !== -1) {
        node = cameFrom[node];
        path.push(node);
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;

    const neighbours = graph.adjacency[current];
    const costs = graph.edgeCost[current];
    for (let k = 0; k < neighbours.length; k += 1) {
      const next = neighbours[k];
      if (closed[next]) continue;
      if (edgeAllowed && !edgeAllowed(current, next)) continue;
      const tentative = gScore[current] + costs[k];
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = current;
        push([tentative + h(next), next]);
      }
    }
  }
  return null;
}

/** Reachable node geometrically closest to a target, plus the path to it. */
export function closestReachablePath(
  graph: LandGraph, start: number, targetX: number, targetZ: number,
  edgeAllowed?: EdgeAllowed,
): number[] {
  if (start < 0 || start >= graph.nodeCount) return [];
  const distance = new Float64Array(graph.nodeCount).fill(Infinity);
  const parent = new Int32Array(graph.nodeCount).fill(-1);
  const visited = new Uint8Array(graph.nodeCount);
  distance[start] = 0;
  let best = start;
  let bestTarget = wrappedDistance(graph.nodeX[start], graph.nodeZ[start], targetX, targetZ, graph.width);
  for (;;) {
    let current = -1;
    let currentDistance = Infinity;
    for (let id = 0; id < graph.nodeCount; id += 1) {
      if (!visited[id] && distance[id] < currentDistance) {
        current = id;
        currentDistance = distance[id];
      }
    }
    if (current < 0) break;
    visited[current] = 1;
    const targetDistance = wrappedDistance(
      graph.nodeX[current], graph.nodeZ[current], targetX, targetZ, graph.width,
    );
    if (targetDistance < bestTarget) { bestTarget = targetDistance; best = current; }
    for (let i = 0; i < graph.adjacency[current].length; i += 1) {
      const next = graph.adjacency[current][i];
      if (edgeAllowed && !edgeAllowed(current, next)) continue;
      const candidate = currentDistance + graph.edgeCost[current][i];
      if (candidate < distance[next]) { distance[next] = candidate; parent[next] = current; }
    }
  }
  const path = [best];
  for (let node = best; parent[node] >= 0; node = parent[node]) path.push(parent[node]);
  path.reverse();
  return path;
}

/** Total world-distance length of a node path. */
export function pathLength(graph: LandGraph, path: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += wrappedDistance(
      graph.nodeX[path[i - 1]], graph.nodeZ[path[i - 1]],
      graph.nodeX[path[i]], graph.nodeZ[path[i]], graph.width,
    );
  }
  return total;
}
