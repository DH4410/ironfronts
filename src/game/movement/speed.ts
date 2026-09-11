import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { stackBaseSpeed } from '../units/army';
import { TERRAIN_CLASS } from '../world-data';
import { wrappedDistance } from '../geometry';

export const TERRAIN_SPEED: Record<number, number> = {
  [TERRAIN_CLASS.plain]: 1,
  [TERRAIN_CLASS.hill]: 0.72,
  [TERRAIN_CLASS.mountain]: 0.48,
  [TERRAIN_CLASS.forest]: 0.8,
  [TERRAIN_CLASS.urban]: 0.9,
};
export const ROAD_BONUS = 1.35;
/**
 * Global pacing multiplier on how far a stack travels per simulation hour.
 * Tuned purely for feel (strategic movement across a country, not units
 * sliding across the map) — it scales every stack equally, so relative speeds,
 * terrain ordering (plain > hill > mountain) and the road bonus are unchanged.
 * Does NOT touch the simulation tick.
 */
export const STRATEGIC_MOVEMENT_SCALE = 0.30;
export interface CurrentMovementLeg {
  readonly targetX: number;
  readonly targetZ: number;
  /** Effective distance travelled per game hour on the current terrain. */
  readonly worldUnitsPerGameHour: number;
  readonly distance: number;
}

/** The currently traversed edge, expressed for network presentation. Keeping
 * this beside stepMovement ensures client ETA projection uses the exact same
 * terrain, road, retreat, and global movement multipliers as simulation. */
export function currentMovementLeg(session: SimContext, army: ArmyStack): CurrentMovementLeg | null {
  const order = army.order;
  if (!order?.path.length || army.status === 'engaged'
    || army.status === 'embarking' || army.status === 'disembarking') return null;
  const targetNode = order.path[0];
  const targetX = session.graph.nodeX[targetNode];
  const targetZ = session.graph.nodeZ[targetNode];
  const terrainScale = army.status === 'atSea'
    ? ROAD_BONUS
    : (TERRAIN_SPEED[session.world.terrainClassAt(army.x, army.z)] ?? 0.9) * ROAD_BONUS;
  const worldUnitsPerGameHour = stackBaseSpeed(army) * STRATEGIC_MOVEMENT_SCALE * terrainScale
    * (army.status === 'retreating' ? 3 : 1) * (session.movementSpeedMultiplier ?? 1);
  return {
    targetX,
    targetZ,
    worldUnitsPerGameHour,
    distance: wrappedDistance(army.x, army.z, targetX, targetZ, session.world.width),
  };
}

