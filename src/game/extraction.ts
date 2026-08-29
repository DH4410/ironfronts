/**
 * Physical resource extraction.
 *
 * A friendly stack standing on a deposit's access node, with extraction-capable
 * units (engineers/infantry), can EXTRACT: the deposit drains into the
 * controlling country's stockpile over game time at a rate set by the stack's
 * composition. Tanks/cars contribute nothing but can guard the miners.
 */

import type { SimContext } from './sim-context';
import { canExtract, stackExtractionRate } from './units/army';

export interface ExtractResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Begin extracting at the resource node the army is standing on. */
export function issueExtract(session: SimContext, armyId: string): ExtractResult {
  const army = session.state.armies[armyId];
  if (!army) return { ok: false, reason: 'No such army.' };
  if (army.order) return { ok: false, reason: 'Army is moving.' };
  if (!canExtract(army)) return { ok: false, reason: 'Engineers or infantry required.' };

  const node = Object.values(session.state.resourceNodes).find(
    (n) => n.accessNodeId === army.graphNodeId && n.remaining > 0,
  );
  if (!node) return { ok: false, reason: 'No reachable deposit here.' };
  if (node.controllerCountryId !== army.ownerCountryId) {
    return { ok: false, reason: 'Deposit is not under your control.' };
  }

  // Release any previous extractor of this node.
  if (node.extractorArmyId && node.extractorArmyId !== armyId) {
    const prev = session.state.armies[node.extractorArmyId];
    if (prev) { prev.status = 'idle'; prev.extractingNodeId = null; }
  }
  army.status = 'extracting';
  army.extractingNodeId = node.id;
  node.extractorArmyId = armyId;
  node.status = 'extracting';
  return { ok: true };
}

/** Transfer deposit -> stockpile for every extracting stack this tick. */
export function stepExtraction(session: SimContext, dtHours: number): void {
  for (const node of Object.values(session.state.resourceNodes)) {
    if (node.status !== 'extracting' || node.remaining <= 0) continue;
    const army = node.extractorArmyId ? session.state.armies[node.extractorArmyId] : undefined;
    if (!army || army.extractingNodeId !== node.id || army.order) {
      // Extractor gone or moved off — stop.
      node.status = node.remaining > 0 ? 'idle' : 'exhausted';
      node.extractorArmyId = null;
      if (army && army.extractingNodeId === node.id) {
        army.extractingNodeId = null;
        if (army.status === 'extracting') army.status = 'idle';
      }
      continue;
    }
    const rate = stackExtractionRate(army);
    if (rate <= 0) continue;
    const moved = Math.min(node.remaining, rate * dtHours);
    node.remaining -= moved;
    const country = session.state.countries[node.controllerCountryId];
    if (country) country.stockpile[node.kind] += moved;

    if (node.remaining <= 0) {
      node.remaining = 0;
      node.status = 'exhausted';
      node.extractorArmyId = null;
      army.extractingNodeId = null;
      army.status = 'idle';
    }
  }
}
