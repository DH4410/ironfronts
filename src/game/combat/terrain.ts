/** Terrain shapes combat outcomes, not just movement speed (see
 *  movement/speed.ts's TERRAIN_SPEED for the movement-side numbers). Applied
 *  as a multiplier on damage dealt to whichever side is defending at a front. */
import type { WorldData, TerrainClass } from '../world-data';
import { TERRAIN_CLASS } from '../world-data';

export const TERRAIN_DEFENSE_MULTIPLIER: Record<TerrainClass, number> = {
  // Open ground favours the attacker's mobility and firepower — no defender bonus.
  [TERRAIN_CLASS.plain]: 1,
  // Elevation and cover favour whoever is dug in.
  [TERRAIN_CLASS.hill]: 0.85,
  [TERRAIN_CLASS.mountain]: 0.6,
  [TERRAIN_CLASS.forest]: 0.8,
  // Street-to-street fighting is slow and costly for the attacker.
  [TERRAIN_CLASS.urban]: 0.7,
  [TERRAIN_CLASS.water]: 1,
};

export function terrainDefenseMultiplier(world: WorldData, x: number, z: number): number {
  return TERRAIN_DEFENSE_MULTIPLIER[world.terrainClassAt(x, z)] ?? 1;
}
