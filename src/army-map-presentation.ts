export type ArmyVisualKind = 0 | 1 | 2 | 3;

export interface ProjectedTroopGroup {
  readonly typeId: string;
  readonly count: number;
  readonly health: number;
}

export interface ArmyFormationGroup {
  readonly kind: ArmyVisualKind;
  readonly count: number;
  readonly health: number;
}

export function visualKindForUnit(typeId: string): ArmyVisualKind {
  if (typeId === 'armored-car') return 2;
  if (typeId === 'light-tank' || typeId === 'medium-tank') return 1;
  if (typeId === 'artillery') return 3;
  return 0;
}

/** Collapse rule-level unit types into the few silhouettes useful on the map. */
export function buildArmyFormation(groups: readonly ProjectedTroopGroup[]): ArmyFormationGroup[] {
  const buckets = new Map<ArmyVisualKind, { count: number; weightedHealth: number }>();
  for (const group of groups) {
    if (group.count <= 0) continue;
    const kind = visualKindForUnit(group.typeId);
    const bucket = buckets.get(kind) ?? { count: 0, weightedHealth: 0 };
    bucket.count += group.count;
    bucket.weightedHealth += group.health * group.count;
    buckets.set(kind, bucket);
  }
  return [...buckets.entries()]
    .map(([kind, bucket]) => ({ kind, count: bucket.count, health: bucket.weightedHealth / bucket.count }))
    .sort((a, b) => a.kind - b.kind);
}

export function dominantVisualKind(formation: readonly ArmyFormationGroup[]): ArmyVisualKind {
  return formation.reduce((dominant, candidate) => candidate.count > dominant.count ? candidate : dominant,
    formation[0] ?? { kind: 0 as const, count: 0, health: 0 }).kind;
}
