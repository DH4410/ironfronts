/** Authoritative combat phase; subsystems share stable front membership. */
import type { SimContext } from './sim-context';
import { stackUnitCount } from './units/army';
import { addDamage, applyPendingDamage, calculateDamage, type GroupRef, type PendingDamage } from './combat/damage';
import { initializeState, detectEngagements, sideArmies, removeArmyFromAllFronts, cleanupFronts } from './combat/fronts';
import { DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER } from './combat/constants';
import { autoRetreat } from './combat/retreat';
import { stepArtillery } from './combat/artillery';
import type { CombatEvent } from './combat/events';
export type { CombatEvent } from './combat/events';
export { COMBAT_FRONTAGE } from './combat/constants';
export { stepCapture, type CaptureEvent } from './combat/capture';
export { legalRetreatPaths, issueManualRetreat } from './combat/retreat';

function isDevastated(session: SimContext, provinceId: number | null): boolean {
  return provinceId !== null
    && (session.state.provinceDevastation?.[provinceId] ?? 0) > session.state.clock.gameTimeHours;
}

function scaledDamage(
  damage: Array<{ ref: GroupRef; amount: number }>, multiplier: number,
): Array<{ ref: GroupRef; amount: number }> {
  return multiplier === 1 ? damage : damage.map(({ ref, amount }) => ({ ref, amount: amount * multiplier }));
}

/** Detach a stack from every combat front and remove it from authoritative state. */
export function destroyArmy(session: SimContext, armyId: string): void {
  removeArmyFromAllFronts(session, armyId);
  delete session.state.armies[armyId];
}

/** One fixed authoritative combat pass. All fronts use one pre-damage snapshot. */
export function stepCombat(session: SimContext, dtHours: number): CombatEvent[] {
  initializeState(session);
  const events: CombatEvent[] = [];
  detectEngagements(session, events);
  const pending = new Map<string, PendingDamage>();
  const activeFronts = Object.values(session.state.battleFronts);
  for (const front of activeFronts) {
    const a = sideArmies(session, front.sideA);
    const b = sideArmies(session, front.sideB);
    const devastationMultiplier = isDevastated(session, front.provinceId)
      ? DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER : 1;
    addDamage(pending, scaledDamage(
      calculateDamage(a, front.sideA.role, b, dtHours),
      front.sideA.role === 'defense' ? devastationMultiplier : 1,
    ));
    addDamage(pending, scaledDamage(
      calculateDamage(b, front.sideB.role, a, dtHours),
      front.sideB.role === 'defense' ? devastationMultiplier : 1,
    ));
  }
  applyPendingDamage(pending);
  if (session.state.simulationTick % 10 === 0) {
    for (const front of activeFronts) {
      events.push({
        kind: 'combatPulse', attacker: front.sideA.countryId, defender: front.sideB.countryId,
        battleId: front.battleId, frontId: front.id, x: front.x, z: front.z,
      });
    }
  }
  for (const army of Object.values(session.state.armies)) {
    if (stackUnitCount(army) > 0) continue;
    const front = army.battleFrontIds?.map((id) => session.state.battleFronts[id]).find(Boolean);
    const attacker = front
      ? (front.sideA.countryId === army.ownerCountryId ? front.sideB.countryId : front.sideA.countryId)
      : 0;
    events.push({
      kind: 'destroyed', attacker, defender: army.ownerCountryId, armyId: army.id,
      x: army.x, z: army.z, battleId: front?.battleId, frontId: front?.id,
    });
    destroyArmy(session, army.id);
  }
  for (const front of activeFronts) {
    if (!session.state.battleFronts[front.id]) continue;
    if (autoRetreat(session, front, front.sideA)) {
      events.push({
        kind: 'retreat', attacker: front.sideB.countryId, defender: front.sideA.countryId,
        x: front.x, z: front.z, battleId: front.battleId, frontId: front.id,
      });
    }
    if (session.state.battleFronts[front.id] && autoRetreat(session, front, front.sideB)) {
      events.push({
        kind: 'retreat', attacker: front.sideA.countryId, defender: front.sideB.countryId,
        x: front.x, z: front.z, battleId: front.battleId, frontId: front.id,
      });
    }
  }
  stepArtillery(session, dtHours, events);
  cleanupFronts(session, events);
  return events;
}
