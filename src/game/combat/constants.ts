/** Directional combat tuning; damage is integrated continuously. */
export const COMBAT_FRONTAGE = 10;
export const COMBAT_SNAP = 26;
/** A city's shattered defences retain only 40% of their normal combat output. */
export const DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER = 0.4;
export const COMBAT_DAMAGE_SCALE = 9.6;
export const MIN_COMBAT_EFFECTIVENESS = 0.25;

/** Organization/readiness cap. Separate stat from HP — see organization.ts. */
export const ORGANIZATION_MAX = 100;
/** Baseline organization drain per game-hour spent in any close-combat front,
 *  independent of casualties (the stress of being under fire at all).
 *  Calibrated so a short, decisive skirmish (a couple of hours) barely dents
 *  it, while a siege lasting days grinds a holding force down. */
export const ORGANIZATION_DRAIN_PER_HOUR = 1.5;
/** Extra drain per full fractional-stack casualty taken this tick — a badly
 *  mauled stack breaks faster than one merely under pressure. Kept small
 *  relative to the per-hour term so it does not dominate fast fights. */
export const ORGANIZATION_DRAIN_PER_CASUALTY_FRACTION = 6;
/** Recovery per game-hour once clear of combat (~25 game-hours to fully
 *  recover from zero). */
export const ORGANIZATION_REGEN_PER_HOUR = 4;
/** A side is pulled back once its average organization falls below this
 *  fraction of max, even with most of its HP pool intact — see autoRetreat. */
export const ORGANIZATION_RETREAT_THRESHOLD = 0.25;
/** Damage output floor at zero organization: broken units still fight, just
 *  badly, rather than becoming literally harmless. */
export const MIN_ORGANIZATION_EFFECTIVENESS = 0.35;

/** Entrenchment cap. Separate stat from organization — see entrenchment.ts. */
export const ENTRENCHMENT_MAX = 100;
/** Game-hours of continuous holding to reach full entrenchment (~2 days). */
export const HOURS_TO_FULL_ENTRENCHMENT = 48;
export const ENTRENCHMENT_GAIN_PER_HOUR = ENTRENCHMENT_MAX / HOURS_TO_FULL_ENTRENCHMENT;
/** Incoming-damage reduction per entrenchment point, capped so a dug-in stack
 *  is tougher but never invulnerable. */
export const ENTRENCHMENT_DEFENSE_PER_POINT = 0.005;
export const ENTRENCHMENT_DEFENSE_CAP = 0.5;

/** An out-of-supply stack (see combat/supply.ts) fights, holds, and moves
 *  worse — deliberately harsher than a stance choice, since this one isn't
 *  a choice the player made on purpose. */
export const OUT_OF_SUPPLY_COMBAT_MULTIPLIER = 0.6;
export const OUT_OF_SUPPLY_ENTRENCHMENT_MULTIPLIER = 0.4;
export const OUT_OF_SUPPLY_SPEED_MULTIPLIER = 0.7;
export const OUT_OF_SUPPLY_ORGANIZATION_REGEN_MULTIPLIER = 0.25;
