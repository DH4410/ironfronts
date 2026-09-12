/**
 * Combat stances: a player-chosen posture per army that trades off attack
 * output, defensive toughness, willingness to dig in, and willingness to
 * retreat. Every multiplier here is 1 (no effect) for 'attack-defend', the
 * default balanced stance, so choosing a stance is always a deliberate
 * trade-off rather than a strict upgrade.
 */
import type { ArmyStance } from '../units/army';

export interface StanceModifiers {
  /** Multiplies this army's own damage output when attacking or defending. */
  readonly attackOutput: number;
  /** Multiplies damage *received* while this army is defending (on top of
   *  terrain/entrenchment); <1 favours the defender. */
  readonly damageTaken: number;
  /** Multiplies how fast entrenchment builds while holding ground; 0 means
   *  this stance never digs in (it's postured to keep moving/pushing). */
  readonly entrenchmentRate: number;
  /** Multiplies organization drain while engaged; >1 breaks faster. */
  readonly organizationDrain: number;
  /** Multiplies the organization-retreat threshold (see
   *  ORGANIZATION_RETREAT_THRESHOLD): <1 holds the line longer before
   *  breaking, >1 pulls back at the first real pressure. */
  readonly retreatThreshold: number;
}

const BALANCED: StanceModifiers = {
  attackOutput: 1, damageTaken: 1, entrenchmentRate: 1, organizationDrain: 1, retreatThreshold: 1,
};

export const STANCE_MODIFIERS: Record<ArmyStance, StanceModifiers> = {
  'attack-defend': BALANCED,
  // Offensive: hits harder, presses on rather than digging in, and — having
  // committed to the attack — will keep fighting well past where a balanced
  // stance would pull back.
  attack: { attackOutput: 1.25, damageTaken: 1, entrenchmentRate: 0, organizationDrain: 1.2, retreatThreshold: 0.6 },
  // Hold the ground at all costs: strong defensive bonus, digs in fast, will
  // not break until organization is nearly gone.
  defend: { attackOutput: 1, damageTaken: 0.8, entrenchmentRate: 1.5, organizationDrain: 1, retreatThreshold: 0.5 },
  // Cautious defence: a smaller toughness bonus, but pulls out early to
  // preserve the force rather than risk losing it.
  'defend-retreat': { attackOutput: 1, damageTaken: 0.9, entrenchmentRate: 1, organizationDrain: 1, retreatThreshold: 1.5 },
  // Minimal-risk posture: no combat bonus either way, breaks off at the
  // first real pressure.
  retreat: { attackOutput: 1, damageTaken: 1, entrenchmentRate: 0.5, organizationDrain: 1, retreatThreshold: 2.5 },
};

export function stanceModifiers(stance: ArmyStance | undefined): StanceModifiers {
  return STANCE_MODIFIERS[stance ?? 'attack-defend'];
}

export const STANCES: readonly ArmyStance[] = ['attack', 'attack-defend', 'defend', 'defend-retreat', 'retreat'];
