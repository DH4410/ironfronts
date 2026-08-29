/**
 * Basic ground combat + province capture.
 *
 * When hostile stacks occupy the same movement node they are ENGAGED and trade
 * damage each tick until one is destroyed or withdraws. Damage is
 * armour-class-aware and frontage-capped (only the strongest N units per side
 * deal full damage; the rest add staying power). An unopposed stack on a
 * foreign province centre captures it.
 */

import type { SimContext } from './sim-context';
import { relationOf, setRelation } from './game-state';
import type { ArmyStack } from './units/army';
import { stackUnitCount } from './units/army';
import { unitType } from './units/unit-catalog';
import type { UnitCategory } from './units/unit-types';
import { wrappedDistance } from './geometry';

/** Attacker category -> damage multiplier vs {unarmored, light, heavy}. */
const DAMAGE_VS: Record<UnitCategory, [number, number, number]> = {
  infantry: [1.0, 0.55, 0.3],
  engineer: [0.6, 0.3, 0.15],
  recon: [1.1, 0.7, 0.35],
  armor: [1.2, 1.05, 0.7],
  artillery: [1.15, 0.9, 1.25],
};
const ARMOR_INDEX = { unarmored: 0, light: 1, heavy: 2 } as const;
/** Only the strongest this-many units per side deal full damage. */
const FRONTAGE = 10;
const COMBAT_SNAP = 26;

export interface CombatEvent {
  readonly kind: 'engaged' | 'destroyed';
  readonly attacker: number;
  readonly defender: number;
  readonly provinceHint?: string;
}

function effectiveAttack(stack: ArmyStack, targetArmor: 'unarmored' | 'light' | 'heavy'): number {
  // Take the strongest FRONTAGE units by stackPriority.
  const units: Array<{ atk: number; cat: UnitCategory; prio: number }> = [];
  for (const g of stack.units) {
    const t = unitType(g.typeId);
    for (let i = 0; i < g.count; i += 1) {
      units.push({ atk: t.attack, cat: t.category, prio: t.stackPriority });
    }
  }
  units.sort((a, b) => b.prio - a.prio);
  let total = 0;
  for (let i = 0; i < units.length; i += 1) {
    const front = i < FRONTAGE ? 1 : 0.15; // overstack still adds a little
    total += units[i].atk * DAMAGE_VS[units[i].cat][ARMOR_INDEX[targetArmor]] * front;
  }
  return total;
}

/** Dominant armour class of a stack (what the enemy is mostly shooting at). */
function dominantArmor(stack: ArmyStack): 'unarmored' | 'light' | 'heavy' {
  const tally = { unarmored: 0, light: 0, heavy: 0 };
  for (const g of stack.units) tally[unitType(g.typeId).armorClass] += g.count;
  if (tally.heavy >= tally.light && tally.heavy >= tally.unarmored) return 'heavy';
  if (tally.light >= tally.unarmored) return 'light';
  return 'unarmored';
}

function applyDamage(stack: ArmyStack, amount: number): void {
  let remaining = amount;
  // Distribute proportionally to current hp, heaviest armour last.
  const totalHp = stack.units.reduce((s, g) => s + g.hp, 0);
  if (totalHp <= 0) { stack.units = []; return; }
  for (const g of stack.units) {
    const share = (g.hp / totalHp) * remaining;
    const def = unitType(g.typeId).defense;
    const mitigated = share * (100 / (100 + def * g.count * 0.05));
    g.hp = Math.max(0, g.hp - mitigated);
  }
  remaining = 0;
  // Shed unit count as pooled hp drops: a group of N units is at full strength
  // until its pool falls below (N-1)*maxHp, then it is down a man, and so on.
  // count = "units with any hp left" = ceil(hp / maxHp). For 4 infantry at
  // 100 maxHp this gives 4/4/3/2/1/0 as the pool drains 400→350→250→150→50→0.
  stack.units = stack.units.filter((g) => {
    const per = unitType(g.typeId).maxHp;
    g.count = Math.max(0, Math.min(g.count, Math.ceil(g.hp / per)));
    return g.count > 0 && g.hp > 0;
  });
}

/** One combat + capture pass. Returns notable events. */
export function stepCombat(session: SimContext, dtHours: number): CombatEvent[] {
  const events: CombatEvent[] = [];
  const armies = Object.values(session.state.armies);

  // --- engagements ---------------------------------------------------
  for (let i = 0; i < armies.length; i += 1) {
    const a = armies[i];
    if (!session.state.armies[a.id]) continue;
    for (let j = i + 1; j < armies.length; j += 1) {
      const b = armies[j];
      if (!session.state.armies[b.id]) continue;
      if (a.ownerCountryId === b.ownerCountryId) continue;
      const together = a.graphNodeId === b.graphNodeId
        || wrappedDistance(a.x, a.z, b.x, b.z, session.world.width) <= COMBAT_SNAP;
      if (!together) continue;

      if (relationOf(session.state, a.ownerCountryId, b.ownerCountryId) !== 'war') {
        setRelation(session.state, a.ownerCountryId, b.ownerCountryId, 'war');
      }
      if (a.status !== 'engaged' || b.status !== 'engaged') {
        events.push({ kind: 'engaged', attacker: a.ownerCountryId, defender: b.ownerCountryId });
      }
      a.status = 'engaged';
      b.status = 'engaged';
      a.order = null;
      b.order = null;

      const dmgToB = effectiveAttack(a, dominantArmor(b)) * dtHours * 0.5;
      const dmgToA = effectiveAttack(b, dominantArmor(a)) * dtHours * 0.5;
      applyDamage(b, dmgToB);
      applyDamage(a, dmgToA);

      if (stackUnitCount(a) === 0) {
        delete session.state.armies[a.id];
        events.push({ kind: 'destroyed', attacker: b.ownerCountryId, defender: a.ownerCountryId });
      }
      if (session.state.armies[b.id] && stackUnitCount(b) === 0) {
        delete session.state.armies[b.id];
        events.push({ kind: 'destroyed', attacker: a.ownerCountryId, defender: b.ownerCountryId });
      }
      break; // a resolved this tick
    }
  }

  // Anyone who was engaged but has no adjacent enemy returns to idle.
  for (const army of Object.values(session.state.armies)) {
    if (army.status !== 'engaged') continue;
    const stillFighting = Object.values(session.state.armies).some(
      (o) => o.id !== army.id && o.ownerCountryId !== army.ownerCountryId
        && wrappedDistance(o.x, o.z, army.x, army.z, session.world.width) <= COMBAT_SNAP,
    );
    if (!stillFighting) army.status = 'idle';
  }

  return events;
}

export interface CaptureEvent {
  readonly provinceId: number;
  readonly fromCountryId: number;
  readonly toCountryId: number;
}

/** Unopposed stack on a foreign province centre captures it. */
export function stepCapture(session: SimContext): CaptureEvent[] {
  const events: CaptureEvent[] = [];
  const world = session.world;
  for (const army of Object.values(session.state.armies)) {
    if (army.status === 'engaged') continue;
    // Which province centre is this node?
    const province = world.provinces.find(
      (p) => Math.round(session.graph.nodeX[army.graphNodeId]) === Math.round(p.center[0])
        && Math.round(session.graph.nodeZ[army.graphNodeId]) === Math.round(p.center[1]),
    );
    if (!province) continue;
    const owner = session.state.provinceOwners[province.id] ?? 0;
    if (owner === army.ownerCountryId) continue;

    const defended = Object.values(session.state.armies).some(
      (o) => o.ownerCountryId === owner
        && wrappedDistance(o.x, o.z, army.x, army.z, world.width) <= COMBAT_SNAP,
    );
    if (defended) continue;

    session.state.provinceOwners[province.id] = army.ownerCountryId;
    setRelation(session.state, army.ownerCountryId, owner, 'war');
    // Units and buildings the previous owner was working on here are forfeit,
    // and their rally point no longer applies.
    delete session.state.productionQueues[province.id];
    delete session.state.constructionQueues[province.id];
    delete session.state.rallyPoints[province.id];
    // Resource nodes in the province change controller.
    for (const node of Object.values(session.state.resourceNodes)) {
      if (node.provinceId !== province.id) continue;
      node.controllerCountryId = army.ownerCountryId;
      const extractor = node.extractorArmyId ? session.state.armies[node.extractorArmyId] : undefined;
      if (extractor && extractor.ownerCountryId !== army.ownerCountryId) {
        // Mine seized from under an enemy extractor: clear BOTH sides. Once the
        // node leaves 'extracting', stepExtraction's own cleanup can't reach the
        // army, so it would otherwise stay pinned in 'extracting' forever.
        extractor.extractingNodeId = null;
        if (extractor.status === 'extracting') extractor.status = 'idle';
        node.extractorArmyId = null;
        node.status = node.remaining > 0 ? 'idle' : 'exhausted';
      }
    }
    events.push({ provinceId: province.id, fromCountryId: owner, toCountryId: army.ownerCountryId });
  }
  return events;
}
