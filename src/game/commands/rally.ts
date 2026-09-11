import type { SimContext } from '../sim-context';
import { nearestNode } from '../movement/graph';
import { findPath } from '../movement/pathfind';
import { movementEdgeAllowed } from '../units/movement';

export function validateRally(ctx: SimContext, countryId: number, provinceId: number, target: { x: number; z: number }) {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.z) || target.x < 0 || target.x >= ctx.world.width
    || target.z < 0 || target.z >= ctx.world.height || ctx.world.provinceAt(target.x, target.z) < 0) {
    return { ok: false, reason: 'Rally destination must be on the world land network.' };
  }
  const province = ctx.world.provinces.find((p) => p.id === provinceId);
  if (!province) return { ok: false, reason: 'No such province.' };
  const from = nearestNode(ctx.graph, province.center[0], province.center[1], 500);
  if (from < 0) return { ok: false, reason: 'No legal rally route. Rally points cannot declare transit wars.' };
  const to = nearestNode(ctx.graph, target.x, target.z, 600, ctx.graph.component[from]);
  if (to < 0 || !findPath(ctx.graph, from, to, movementEdgeAllowed(ctx, countryId))) {
    return { ok: false, reason: 'No legal rally route. Rally points cannot declare transit wars.' };
  }
  return { ok: true };
}
