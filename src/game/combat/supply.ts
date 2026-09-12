/**
 * Supply: an army far from its own country's territory fights, holds, and
 * moves worse. Deliberately a straight-line-distance approximation rather
 * than a road-network calculation — cheap enough to recompute for every
 * army on a slow cadence (see SUPPLY_RECOMPUTE_INTERVAL in game-session.ts)
 * without a full graph search, at the cost of not modelling supply lines
 * being cut by an encirclement along the roads themselves. Good enough to
 * make deep unsupported offensives costly, which is the actual ask.
 */
import type { SimContext } from '../sim-context';
import { wrappedDistance } from '../geometry';

/** World-space reach of a country's own territory before a stack is
 *  considered out of supply. Calibrated relative to MISSILE_RANGE (3200) —
 *  comfortably covers pushing one or two provinces past the border, not an
 *  unsupported drive across the map. */
export const SUPPLY_RANGE = 1800;

export function stepSupply(ctx: SimContext): void {
  const provinceCentersByCountry = new Map<number, Array<readonly [number, number]>>();
  for (const province of ctx.world.provinces) {
    const owner = ctx.state.provinceOwners[province.id];
    if (!owner) continue;
    let centers = provinceCentersByCountry.get(owner);
    if (!centers) { centers = []; provinceCentersByCountry.set(owner, centers); }
    centers.push(province.center);
  }
  for (const army of Object.values(ctx.state.armies)) {
    const centers = provinceCentersByCountry.get(army.ownerCountryId);
    army.inSupply = !centers?.length ? false : centers.some(
      ([x, z]) => wrappedDistance(army.x, army.z, x, z, ctx.world.width) <= SUPPLY_RANGE,
    );
  }
}
