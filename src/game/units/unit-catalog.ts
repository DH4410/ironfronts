/**
 * The first playable roster. Six data-driven types, no more.
 *
 * Tuning intent:
 *  - Infantry: cheap, slow, holds ground, modest extraction.
 *  - Engineers: weak in a fight, best extraction, economic backbone.
 *  - Armored Car: fast scout, big view range, light punch.
 *  - Light Tank: fast armour, strong vs infantry/light, mid cost.
 *  - Medium Tank: expensive frontline armour, slower, heavy metal/oil use.
 *  - Artillery: slow ranged support (engagementRange > 0), no extraction.
 *
 * Speeds are world-units per authoritative timeline hour. The prototype values
 * are converted below so normal-speed real movement pacing stays unchanged.
 */

import { PROTOTYPE_HOURS_PER_HOUR } from '../time';
import { COMBAT_DAMAGE_SCALE } from '../combat/constants';
import type { DamageProfile, UnitType } from './unit-types';

/** Continuous HP per timeline hour, integrated every simulation step. */
function damagePerHour(soft: number, light: number, heavy: number): DamageProfile {
  return {
    soft: soft * COMBAT_DAMAGE_SCALE,
    light: light * COMBAT_DAMAGE_SCALE,
    heavy: heavy * COMBAT_DAMAGE_SCALE,
  };
}

export const UNIT_TYPES: readonly UnitType[] = [
  {
    id: 'infantry',
    name: 'Infantry',
    category: 'infantry',
    armorClass: 'soft',
    icon: 'unit-infantry',
    maxHp: 100,
    speed: 90 * PROTOTYPE_HOURS_PER_HOUR,
    attack: damagePerHour(8, 4.4, 2.4),
    defense: damagePerHour(6, 3.3, 1.8),
    visionOuter: 180,
    visionInner: 90,
    extractionRate: 0.4 * PROTOTYPE_HOURS_PER_HOUR,
    engagementRange: 0,
    buildCost: { funds: 350, manpower: 45, food: 35 },
    buildWork: 2,
    upkeep: { fundsPerHour: 0.5, foodPerHour: 0.5 },
    shortageEffects: [
      { resource: 'food', stat: 'combatOutput', maxPenalty: 0.5, curve: 'linear' },
      { resource: 'funds', stat: 'organizationCap', maxPenalty: 0.6, curve: 'soft' },
    ],
    cost: { funds: 350, manpower: 45, food: 35 },
    buildTimeHours: 2,
    requiredBuilding: 'barracks',
    stackPriority: 10,
  },
  {
    id: 'engineer',
    name: 'Engineers',
    category: 'engineer',
    armorClass: 'soft',
    icon: 'unit-engineer',
    maxHp: 80,
    speed: 85 * PROTOTYPE_HOURS_PER_HOUR,
    attack: damagePerHour(1.8, 0.9, 0.45),
    defense: damagePerHour(2.4, 1.2, 0.6),
    visionOuter: 160,
    visionInner: 80,
    extractionRate: 2.0 * PROTOTYPE_HOURS_PER_HOUR,
    engagementRange: 0,
    buildCost: { funds: 450, manpower: 35, food: 30, metal: 10 },
    buildWork: 3,
    upkeep: { fundsPerHour: 0.7, foodPerHour: 0.5, metalPerHour: 0.05 },
    shortageEffects: [
      { resource: 'metal', stat: 'extractionOutput', maxPenalty: 0.8, curve: 'linear' },
      { resource: 'food', stat: 'combatOutput', maxPenalty: 0.4, curve: 'linear' },
      { resource: 'funds', stat: 'organizationCap', maxPenalty: 0.6, curve: 'soft' },
    ],
    cost: { funds: 450, manpower: 35, food: 30, metal: 10 },
    buildTimeHours: 3,
    requiredBuilding: 'barracks',
    stackPriority: 8,
  },
  {
    id: 'armored-car',
    name: 'Armored Car',
    category: 'recon',
    armorClass: 'light',
    icon: 'unit-armored-car',
    maxHp: 90,
    speed: 190 * PROTOTYPE_HOURS_PER_HOUR,
    attack: damagePerHour(6.6, 4.2, 2.1),
    defense: damagePerHour(7.7, 4.9, 2.45),
    visionOuter: 300,
    visionInner: 160,
    extractionRate: 0 * PROTOTYPE_HOURS_PER_HOUR,
    engagementRange: 0,
    buildCost: { funds: 650, manpower: 20, metal: 70, oil: 25 },
    buildWork: 4,
    upkeep: { fundsPerHour: 1.2, metalPerHour: 0.1, oilPerHour: 0.5 },
    shortageEffects: [
      { resource: 'oil', stat: 'movementSpeed', maxPenalty: 0.8, curve: 'linear' },
      { resource: 'oil', stat: 'visionRange', maxPenalty: 0.65, curve: 'linear' },
      { resource: 'metal', stat: 'combatOutput', maxPenalty: 0.35, curve: 'late' },
      { resource: 'funds', stat: 'organizationCap', maxPenalty: 0.6, curve: 'soft' },
    ],
    cost: { funds: 650, manpower: 20, metal: 70, oil: 25 },
    buildTimeHours: 4,
    requiredBuilding: 'tankPlant',
    stackPriority: 20,
  },
  {
    id: 'light-tank',
    name: 'Light Tank',
    category: 'armor',
    armorClass: 'light',
    icon: 'unit-light-tank',
    maxHp: 130,
    speed: 150 * PROTOTYPE_HOURS_PER_HOUR,
    attack: damagePerHour(16.8, 14.7, 9.8),
    defense: damagePerHour(14.4, 12.6, 8.4),
    visionOuter: 220,
    visionInner: 110,
    extractionRate: 0 * PROTOTYPE_HOURS_PER_HOUR,
    engagementRange: 0,
    buildCost: { funds: 1100, manpower: 30, metal: 140, oil: 55 },
    buildWork: 6,
    upkeep: { fundsPerHour: 2, metalPerHour: 0.2, oilPerHour: 1 },
    shortageEffects: [
      { resource: 'oil', stat: 'movementSpeed', maxPenalty: 0.8, curve: 'linear' },
      { resource: 'metal', stat: 'combatOutput', maxPenalty: 0.5, curve: 'linear' },
      { resource: 'funds', stat: 'organizationCap', maxPenalty: 0.65, curve: 'soft' },
    ],
    cost: { funds: 1100, manpower: 30, metal: 140, oil: 55 },
    buildTimeHours: 6,
    requiredBuilding: 'tankPlant',
    stackPriority: 40,
  },
  {
    id: 'medium-tank',
    name: 'Medium Tank',
    category: 'armor',
    armorClass: 'heavy',
    icon: 'unit-medium-tank',
    maxHp: 190,
    speed: 110 * PROTOTYPE_HOURS_PER_HOUR,
    attack: damagePerHour(26.4, 23.1, 15.4),
    defense: damagePerHour(24, 21, 14),
    visionOuter: 200,
    visionInner: 100,
    extractionRate: 0 * PROTOTYPE_HOURS_PER_HOUR,
    engagementRange: 0,
    buildCost: { funds: 2000, manpower: 45, metal: 260, oil: 110 },
    buildWork: 11,
    upkeep: { fundsPerHour: 3.5, metalPerHour: 0.35, oilPerHour: 2 },
    shortageEffects: [
      { resource: 'oil', stat: 'movementSpeed', maxPenalty: 0.9, curve: 'linear' },
      { resource: 'metal', stat: 'combatOutput', maxPenalty: 0.6, curve: 'linear' },
      { resource: 'funds', stat: 'organizationCap', maxPenalty: 0.7, curve: 'soft' },
    ],
    cost: { funds: 2000, manpower: 45, metal: 260, oil: 110 },
    buildTimeHours: 11,
    requiredBuilding: 'tankPlant',
    stackPriority: 70,
  },
  {
    id: 'artillery',
    name: 'Artillery',
    category: 'artillery',
    armorClass: 'soft',
    icon: 'unit-artillery',
    maxHp: 70,
    speed: 70 * PROTOTYPE_HOURS_PER_HOUR,
    attack: damagePerHour(29.9, 23.4, 32.5),
    defense: damagePerHour(3.45, 2.7, 3.75),
    visionOuter: 170,
    visionInner: 70,
    extractionRate: 0 * PROTOTYPE_HOURS_PER_HOUR,
    engagementRange: 140,
    buildCost: { funds: 1400, manpower: 35, food: 15, metal: 180, oil: 20 },
    buildWork: 8,
    upkeep: { fundsPerHour: 1.8, foodPerHour: 0.1, metalPerHour: 0.3, oilPerHour: 0.2 },
    shortageEffects: [
      { resource: 'metal', stat: 'combatOutput', maxPenalty: 0.65, curve: 'linear' },
      { resource: 'oil', stat: 'movementSpeed', maxPenalty: 0.6, curve: 'linear' },
      { resource: 'food', stat: 'combatOutput', maxPenalty: 0.2, curve: 'late' },
      { resource: 'funds', stat: 'organizationCap', maxPenalty: 0.6, curve: 'soft' },
    ],
    cost: { funds: 1400, manpower: 35, food: 15, metal: 180, oil: 20 },
    buildTimeHours: 8,
    requiredBuilding: 'ordnance',
    stackPriority: 50,
  },
];

export const UNIT_TYPE_BY_ID: ReadonlyMap<string, UnitType> =
  new Map(UNIT_TYPES.map((unit) => [unit.id, unit]));

export function unitType(id: string): UnitType {
  const type = UNIT_TYPE_BY_ID.get(id);
  if (!type) throw new Error(`Unknown unit type: ${id}`);
  return type;
}
