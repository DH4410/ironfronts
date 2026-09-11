import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { wrappedDistance } from '../geometry';
import { findPath, pathLength, type EdgeAllowed } from './pathfind';
import type { LandGraph } from './graph';

export const ARRIVAL_DISTANCE = 0.01;

export function armyAtNode(ctx: SimContext, army: ArmyStack, node = army.graphNodeId): boolean {
  return node >= 0 && node < ctx.graph.nodeCount && wrappedDistance(
    army.x, army.z, ctx.graph.nodeX[node], ctx.graph.nodeZ[node], ctx.world.width,
  ) <= ARRIVAL_DISTANCE;
}

/** Physical edge persists through stop, split, combat and order replacement. */
export function occupiedEdge(ctx: SimContext, army: ArmyStack): { from: number; to: number } | null {
  if (armyAtNode(ctx, army)) return null;
  if (army.edge) return army.edge;
  const next = army.order?.path[0] ?? army.suspendedOrder?.path[0];
  return next !== undefined && ctx.graph.adjacency[army.graphNodeId]?.includes(next)
    ? { from: army.graphNodeId, to: next } : null;
}

/** Returns the existing inclusive-node route convention, including a partial
 * leading edge. Reversing on an edge explicitly visits its origin first. */
export function routeFromArmy(
  ctx: SimContext, army: ArmyStack, goal: number, allowed?: EdgeAllowed,
  graph: LandGraph = ctx.graph,
): number[] | null {
  if (armyAtNode(ctx, army)) return findPath(graph, army.graphNodeId, goal, allowed);
  const edge = occupiedEdge(ctx, army);
  if (!edge) return null;
  const choices: Array<{ path: number[]; cost: number }> = [];
  for (const endpoint of [edge.from, edge.to]) {
    // Returning to the origin is the only permitted recovery from a blocked edge.
    if (endpoint !== edge.from && allowed && !allowed(edge.from, edge.to)) continue;
    const tail = findPath(graph, endpoint, goal, allowed);
    if (!tail) continue;
    choices.push({ path: [army.graphNodeId, ...tail], cost: pathLength(graph, tail)
      + wrappedDistance(army.x, army.z, ctx.graph.nodeX[endpoint], ctx.graph.nodeZ[endpoint], ctx.world.width) });
  }
  choices.sort((a, b) => a.cost - b.cost || a.path[1] - b.path[1]);
  return choices[0]?.path ?? null;
}

export function leadingEdgeValid(ctx: SimContext, army: ArmyStack, next: number, allowed: EdgeAllowed): boolean {
  const edge = occupiedEdge(ctx, army);
  if (edge) return (next === edge.from || next === edge.to)
    && ctx.graph.adjacency[edge.from]?.includes(edge.to)
    && (next === edge.from || allowed(edge.from, edge.to));
  return Boolean(ctx.graph.adjacency[army.graphNodeId]?.includes(next)) && allowed(army.graphNodeId, next);
}
