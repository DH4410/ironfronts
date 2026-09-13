import type { PhysicalResource, ResourceBuildingId, ResourceBuildingTiers, ResourcePotential } from '../game-state';

export const PHYSICAL_RESOURCES: readonly PhysicalResource[] = ['food', 'stone', 'metal', 'oil'];
export const RESOURCE_BUILDINGS: readonly ResourceBuildingId[] = ['fields', 'quarry', 'mine', 'oilPump'];

export const RESOURCE_FOR_BUILDING: Record<ResourceBuildingId, PhysicalResource> = {
  fields: 'food', quarry: 'stone', mine: 'metal', oilPump: 'oil',
};
export const BUILDING_FOR_RESOURCE: Record<PhysicalResource, ResourceBuildingId> = {
  food: 'fields', stone: 'quarry', metal: 'mine', oil: 'oilPump',
};

export const RESOURCE_PRESENCE_CUTOFF: Record<PhysicalResource, number> = {
  food: 0.08, stone: 0.10, metal: 0.12, oil: 0.12,
};

export const RESOURCE_TIER_GATES: Record<ResourceBuildingId, readonly [number, number, number, number, number]> = {
  fields: [0.18, 0.45, 0.72, 0.86, 0.96],
  quarry: [0.20, 0.48, 0.74, 0.88, 0.97],
  mine: [0.24, 0.52, 0.78, 0.90, 0.98],
  oilPump: [0.25, 0.55, 0.82, 0.92, 0.98],
};

export const RESOURCE_TIER_PASSIVE = [0, 2, 5, 12, 20, 32] as const;
export const RESOURCE_TIER_ENGINEER_CAP = [1, 2, 4, 8, 12, 18] as const;
export const RESOURCE_TIER_ENGINEER_MULTIPLIER = [1, 1.5, 2, 2.5, 3.25, 4.25] as const;
export const ENGINEER_PRODUCTION_PER_HOUR = 0.75;

export function emptyPotential(): ResourcePotential {
  return { food: 0, stone: 0, metal: 0, oil: 0 };
}

export function emptyResourceBuildings(): ResourceBuildingTiers {
  return { fields: 0, quarry: 0, mine: 0, oilPump: 0 };
}

export function maximumResourceTier(building: ResourceBuildingId, potential: number): number {
  const gates = RESOURCE_TIER_GATES[building];
  for (let tier = gates.length; tier >= 1; tier -= 1) {
    if (potential >= gates[tier - 1]) return tier;
  }
  return 0;
}

export function effectiveEngineerCount(engineers: number, cap: number): number {
  if (engineers <= cap) return Math.max(0, engineers);
  return cap + cap * (1 - Math.exp(-(engineers - cap) / cap));
}
