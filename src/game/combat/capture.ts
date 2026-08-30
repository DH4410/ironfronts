/** Province-center capture and capture-side cleanup. */

import { relationOf } from '../game-state';
import type { SimContext } from '../sim-context';
import { wrappedDistance } from '../geometry';
import { COMBAT_SNAP } from './constants';
import { provinceAtNode } from './location';

export interface CaptureEvent {
  readonly provinceId: number;
  readonly fromCountryId: number;
  readonly toCountryId: number;
}

export function stepCapture(session: SimContext): CaptureEvent[] {
  const events: CaptureEvent[] = [];
  for (const army of Object.values(session.state.armies)) {
    if (army.status === 'engaged' || army.status === 'retreating') continue;
    const provinceId = provinceAtNode(session, army.graphNodeId);
    if (provinceId === null) continue;
    const owner = session.state.provinceOwners[provinceId] ?? 0;
    if (owner === army.ownerCountryId || (
      owner > 0 && relationOf(session.state, army.ownerCountryId, owner) !== 'war'
    )) continue;

    const defended = Object.values(session.state.armies).some((other) => (
      other.id !== army.id && other.ownerCountryId === owner
      && wrappedDistance(other.x, other.z, army.x, army.z, session.world.width) <= COMBAT_SNAP
    ));
    if (defended) continue;
    session.state.provinceOwners[provinceId] = army.ownerCountryId;
    delete session.state.productionQueues[provinceId];
    delete session.state.constructionQueues[provinceId];
    delete session.state.rallyPoints[provinceId];
    for (const node of Object.values(session.state.resourceNodes)) {
      if (node.provinceId !== provinceId) continue;
      node.controllerCountryId = army.ownerCountryId;
      const extractor = node.extractorArmyId ? session.state.armies[node.extractorArmyId] : undefined;
      if (extractor && extractor.ownerCountryId !== army.ownerCountryId) {
        extractor.extractingNodeId = null;
        if (extractor.status === 'extracting') extractor.status = 'idle';
        node.extractorArmyId = null;
        node.status = node.remaining > 0 ? 'idle' : 'exhausted';
      }
    }
    events.push({ provinceId, fromCountryId: owner, toCountryId: army.ownerCountryId });
  }
  return events;
}
