/**
 * Simple defensive AI v1 (§56, "IMPORTANT AI RULE").
 *
 * AI-controlled countries issue the SAME GameSession commands the player does —
 * `issueMoveOrder`, `queueUnit`, `issueExtract` — never direct state edits.
 * v1 goals: keep producing cheap infantry, work owned resource nodes, garrison
 * cities, and only push out to retake a lost home province or hit an obviously
 * weaker adjacent enemy stack. Nothing clever.
 */

import type { SimContext } from '../sim-context';
import { issueMoveOrder } from '../units/movement';
import { issueExtract } from '../extraction';
import { queueUnit, producibleUnits } from '../production';
import { canExtract, stackUnitCount } from '../units/army';
import { relationOf } from '../game-state';
import { wrappedDistance } from '../geometry';

export function stepAi(session: SimContext, _dtHours: number): void {
  const state = session.state;
  const aiCountries = Object.values(state.countries).filter((c) => c.controller === 'ai');
  if (aiCountries.length === 0) return;

  for (const country of aiCountries) {
    const armies = Object.values(state.armies).filter((a) => a.ownerCountryId === country.id);
    const ownProvinces = Object.entries(state.provinceOwners)
      .filter(([, owner]) => owner === country.id)
      .map(([id]) => Number(id));

    // 1. Produce a cheap defender if we can afford it and a barracks exists.
    for (const provinceId of ownProvinces) {
      if (!producibleUnits(session, provinceId, country.id).includes('infantry')) continue;
      const queued = state.productionQueues[provinceId]?.length ?? 0;
      if (queued >= 2) continue;
      if (country.stockpile.manpower > 120 && country.stockpile.funds > 80) {
        queueUnit(session, provinceId, 'infantry', country.id);
      }
      break; // one order per pass keeps it slow
    }

    // 2. Idle stacks with miners: work the nearest controlled deposit.
    for (const army of armies) {
      if (army.order || army.status === 'engaged' || army.extractingNodeId !== null) continue;
      if (!canExtract(army)) continue;
      const node = Object.values(state.resourceNodes).find(
        (n) => n.controllerCountryId === country.id && n.remaining > 0 && n.accessNodeId >= 0
          && n.status !== 'extracting',
      );
      if (!node) continue;
      if (army.graphNodeId === node.accessNodeId) {
        issueExtract(session, army.id);
      } else {
        issueMoveOrder(session, army.id, node.x, node.z, 'move');
      }
      break;
    }

    // 3. If at war and a distinctly weaker enemy stack sits on our doorstep,
    //    send our strongest idle stack to hit it. Otherwise hold.
    const atWar = Object.values(state.countries).some(
      (o) => o.id !== country.id && relationOf(state, country.id, o.id) === 'war',
    );
    if (!atWar) continue;
    const strongest = armies
      .filter((a) => !a.order && a.status !== 'engaged' && a.extractingNodeId === null)
      .sort((a, b) => stackUnitCount(b) - stackUnitCount(a))[0];
    if (!strongest) continue;
    const myStrength = stackUnitCount(strongest);
    const target = Object.values(state.armies)
      .filter((e) => relationOf(state, e.ownerCountryId, country.id) === 'war')
      .filter((e) => stackUnitCount(e) * 1.4 < myStrength)
      .map((e) => ({ e, d: wrappedDistance(strongest.x, strongest.z, e.x, e.z, session.world.width) }))
      .filter((x) => x.d < 900)
      .sort((a, b) => a.d - b.d)[0];
    if (target) issueMoveOrder(session, strongest.id, target.e.x, target.e.z, 'attack');
  }
}
