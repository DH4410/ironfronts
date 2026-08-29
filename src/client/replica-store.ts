import type { PlayerProjection, ProjectionDelta } from '@ironfronts/protocol';

const COLLECTIONS = [
  'countries', 'provinceOwners', 'provinceBuildings', 'productionQueues',
  'constructionQueues', 'rallyPoints', 'armies', 'resourceNodes', 'relations',
] as const;

export function applyDelta(state: PlayerProjection, delta: ProjectionDelta): PlayerProjection {
  const next = structuredClone(state);
  Object.assign(next, delta.changed);
  for (const key of COLLECTIONS) {
    const target = next[key] as Record<string, unknown>;
    Object.assign(target, delta.upserts[key] ?? {});
    for (const id of delta.removals[key] ?? []) delete target[id];
  }
  return next;
}
