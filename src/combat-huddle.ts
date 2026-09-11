/**
 * Purely visual "combat huddle" for engaged army-stack pairs.
 *
 * Two hostile stacks trigger a fight once they come within COMBAT_SNAP world
 * units (see src/game/combat/constants.ts) — but that authoritative trigger
 * range is still wide enough that the pair can render far apart on the map,
 * reading as two distant icons rather than a clash. This module never touches
 * simulation coordinates; it only computes a render-layer nudge the caller
 * adds to the *displayed* position, so it can never desync the client from
 * the authoritative sim or multiplayer state.
 *
 * Every engaged stack in one grid cell (see `battleClusterKey`) huddles
 * toward the SAME shared anchor point — the same point syncCombatMarkers
 * already uses for the persistent crossed-swords battle marker — so the
 * army badges, that marker, and the continuous fight FX all read as one
 * clash instead of drifting apart from each other.
 */

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface HuddleOffset {
  readonly x: number;
  readonly z: number;
}

const ZERO: HuddleOffset = { x: 0, z: 0 };

/** World-space grid used to cluster engaged stacks into one shared battle
 *  point (~one road-node's worth of slack). Matches syncCombatMarkers. */
export const BATTLE_CLUSTER_GRID = 70;

export function battleClusterKey(x: number, z: number): string {
  return `${Math.round(x / BATTLE_CLUSTER_GRID)}:${Math.round(z / BATTLE_CLUSTER_GRID)}`;
}

/** Rendered gap (world units) an engaged stack huddles down to around its
 *  battle anchor — small enough that two badges read as one clash. */
export const HUDDLE_TARGET_RADIUS = 30;
/** Safety cap on the pull distance so a stray/mis-clustered stack can never
 *  visually teleport across the map. */
export const HUDDLE_MAX_PULL = 260;

/**
 * Render-only offset pulling `self` toward the shared `anchor` for its
 * battle cluster, closing the gap to at most `targetRadius` world units
 * (capped by `maxPull`). Returns {0,0} once already inside the radius.
 */
export function combatHuddleOffset(
  self: Point,
  anchor: Point,
  targetRadius: number = HUDDLE_TARGET_RADIUS,
  maxPull: number = HUDDLE_MAX_PULL,
): HuddleOffset {
  const dx = anchor.x - self.x;
  const dz = anchor.z - self.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= targetRadius) return ZERO;
  const pull = Math.min(maxPull, dist - targetRadius);
  return { x: (dx / dist) * pull, z: (dz / dist) * pull };
}
