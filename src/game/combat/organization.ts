/**
 * Organization/readiness: a second combat stat separate from HP. It drains
 * under fire and recovers away from it, and lets a battered force be pushed
 * off the line (see autoRetreat in retreat.ts) or fight at reduced output
 * well before its HP pool is exhausted — modelling a unit breaking rather
 * than always fighting to annihilation.
 */
import type { SimContext } from '../sim-context';
import type { PendingDamage } from './damage';
import { stackMaxHp } from '../units/army';
import {
  ORGANIZATION_MAX, ORGANIZATION_DRAIN_PER_HOUR, ORGANIZATION_DRAIN_PER_CASUALTY_FRACTION,
  ORGANIZATION_REGEN_PER_HOUR, MIN_ORGANIZATION_EFFECTIVENESS, OUT_OF_SUPPLY_ORGANIZATION_REGEN_MULTIPLIER,
} from './constants';
import { stanceModifiers } from './stance';

export function organizationEffectiveness(organization: number): number {
  const fraction = Math.max(0, Math.min(1, organization / ORGANIZATION_MAX));
  return MIN_ORGANIZATION_EFFECTIVENESS + (1 - MIN_ORGANIZATION_EFFECTIVENESS) * fraction;
}

/** Passive regeneration for every army not currently in a close-combat front.
 *  Engaged armies are drained by `drainOrganizationFromDamage` instead. */
export function regenOrganization(ctx: SimContext, dtHours: number): void {
  if (dtHours <= 0) return;
  for (const army of Object.values(ctx.state.armies)) {
    if (army.status === 'engaged') continue;
    const supplyRate = army.inSupply === false ? OUT_OF_SUPPLY_ORGANIZATION_REGEN_MULTIPLIER : 1;
    army.organization = Math.min(
      ORGANIZATION_MAX, (army.organization ?? ORGANIZATION_MAX) + ORGANIZATION_REGEN_PER_HOUR * supplyRate * dtHours,
    );
  }
}

/** Drain each engaged army's organization by the casualties it just took this
 *  tick (as a fraction of its own max HP) plus a flat under-fire cost. Called
 *  once per combat tick, after `applyPendingDamage`. */
export function drainOrganizationFromCombat(
  ctx: SimContext, pending: ReadonlyMap<string, PendingDamage>, dtHours: number,
): void {
  const casualtyFraction = new Map<string, number>();
  for (const item of pending.values()) {
    const maxHp = stackMaxHp(item.army);
    if (maxHp <= 0) continue;
    casualtyFraction.set(item.army.id, (casualtyFraction.get(item.army.id) ?? 0) + item.amount / maxHp);
  }
  for (const army of Object.values(ctx.state.armies)) {
    if (army.status !== 'engaged') continue;
    const fraction = casualtyFraction.get(army.id) ?? 0;
    const drain = (ORGANIZATION_DRAIN_PER_HOUR * dtHours + fraction * ORGANIZATION_DRAIN_PER_CASUALTY_FRACTION)
      * stanceModifiers(army.stance).organizationDrain;
    army.organization = Math.max(0, (army.organization ?? ORGANIZATION_MAX) - drain);
  }
}
