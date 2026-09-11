import type { SimContext } from '../sim-context';
import type { EdgeAllowed } from './pathfind';
import { relationOf } from '../game-state';

const EDGE_SAMPLE_DISTANCE = 18;
const edgeProvinceCache = new WeakMap<object, Map<string, number[]>>();

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

export function warsRequiredForPath(session: SimContext, countryId: number, path: readonly number[]): number[] {
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

