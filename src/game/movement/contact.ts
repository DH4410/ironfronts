import type { SpatialIndex } from '../spatial-index';
import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { relationOf } from '../game-state';
import { COMBAT_SNAP } from '../combat/constants';

/** Swept contact against the current positions: a movement segment stops at
 * the first hostile contact, even if it would cross several short graph edges. */
export function contactDistance(ctx: SimContext, army: ArmyStack, tx: number, tz: number, limit: number, index?: SpatialIndex<ArmyStack>): number {
  if (army.retreat?.protected) return limit;
  const wrap = (x: number): number => x > ctx.world.width / 2 ? x - ctx.world.width
    : x < -ctx.world.width / 2 ? x + ctx.world.width : x;
  const dx = wrap(tx - army.x), dz = tz - army.z;
  const length = Math.hypot(dx, dz);
  if (!length) return 0;
  const ux = dx / length, uz = dz / length;
  let allowed = limit;
  for (const other of (index?.query(army.x, army.z, limit + COMBAT_SNAP) ?? Object.values(ctx.state.armies))) {
    if (other === army || other.retreat?.protected || relationOf(ctx.state, army.ownerCountryId, other.ownerCountryId) !== 'war') continue;
    const ox = wrap(other.x - army.x), oz = other.z - army.z;
    const radius = COMBAT_SNAP - 1e-6;
    if (Math.hypot(ox, oz) <= COMBAT_SNAP) return 0;
    const projected = ox * ux + oz * uz;
    const perpendicularSq = ox * ox + oz * oz - projected * projected;
    if (projected < 0 || perpendicularSq > radius * radius) continue;
    allowed = Math.min(allowed, Math.max(0, projected - Math.sqrt(radius * radius - perpendicularSq)));
  }
  return allowed;
}
