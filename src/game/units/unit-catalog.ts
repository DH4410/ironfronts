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
 * Speeds are world-units / game-hour. Provinces sit ~150-400 units apart, so a
 * 90 u/h infantry stack crosses a short hop in a few game-hours; the sim runs
 * game-time faster than wall-clock so this is minutes of play.
 */

import type { UnitType } from './unit-types';

export const UNIT_TYPES: readonly UnitType[] = [
  {
    id: 'infantry',
    name: 'Infantry',
    category: 'infantry',
    armorClass: 'soft',
    icon: 'unit-infantry',
    maxHp: 100,
    speed: 90,
    attack: { soft: 8, light: 4.4, heavy: 2.4 },
    defense: { soft: 6, light: 3.3, heavy: 1.8 },
    visionOuter: 180,
    visionInner: 90,
    extractionRate: 0.4,
    engagementRange: 0,
    cost: { funds: 20, manpower: 40, food: 5 },
    buildTimeHours: 6,
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
    speed: 85,
    attack: { soft: 1.8, light: 0.9, heavy: 0.45 },
    defense: { soft: 2.4, light: 1.2, heavy: 0.6 },
    visionOuter: 160,
    visionInner: 80,
    extractionRate: 2.0,
    engagementRange: 0,
    cost: { funds: 30, manpower: 25, metal: 10 },
    buildTimeHours: 7,
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
    speed: 190,
    attack: { soft: 6.6, light: 4.2, heavy: 2.1 },
    defense: { soft: 7.7, light: 4.9, heavy: 2.45 },
    visionOuter: 300,
    visionInner: 160,
    extractionRate: 0,
    engagementRange: 0,
    cost: { funds: 40, manpower: 10, metal: 40, oil: 20 },
    buildTimeHours: 8,
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
    speed: 150,
    attack: { soft: 16.8, light: 14.7, heavy: 9.8 },
    defense: { soft: 14.4, light: 12.6, heavy: 8.4 },
    visionOuter: 220,
    visionInner: 110,
    extractionRate: 0,
    engagementRange: 0,
    cost: { funds: 60, manpower: 15, metal: 70, oil: 35 },
    buildTimeHours: 12,
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
    speed: 110,
    attack: { soft: 26.4, light: 23.1, heavy: 15.4 },
    defense: { soft: 24, light: 21, heavy: 14 },
    visionOuter: 200,
    visionInner: 100,
    extractionRate: 0,
    engagementRange: 0,
    cost: { funds: 110, manpower: 25, metal: 120, oil: 60 },
    buildTimeHours: 20,
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
    speed: 70,
    attack: { soft: 29.9, light: 23.4, heavy: 32.5 },
    defense: { soft: 3.45, light: 2.7, heavy: 3.75 },
    visionOuter: 170,
    visionInner: 70,
    extractionRate: 0,
    engagementRange: 140,
    cost: { funds: 70, manpower: 20, metal: 55, oil: 15 },
    buildTimeHours: 14,
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
