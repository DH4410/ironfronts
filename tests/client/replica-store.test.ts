import { describe, expect, it } from 'vitest';
import { applyDelta } from '../../src/client/replica-store';
import type { PlayerProjection } from '../../packages/protocol/src/index';

function baseline(): PlayerProjection {
  return {
    gameTimeHours: 0, viewerCountryId: 1, startCamera: { x: 0, z: 0, distance: 900 },
    countries: { 1: { id: 1, name: 'A', color: '#fff', controller: 'player', alive: true } },
    provinceOwners: { 1: 1 }, provinceBuildings: {}, productionQueues: {}, constructionQueues: {},
    rallyPoints: {}, armies: {}, resourceNodes: {}, ownCountry: { id: 1 }, relations: {},
  };
}

describe('client replica deltas', () => {
  it('applies scalar changes, upserts, removals, and redactions without mutating the baseline', () => {
    const original = baseline();
    original.armies.a = { id: 'a', name: 'A', ownerCountryId: 1, ownerName: 'A', ownerColor: '#fff', x: 0, z: 0, own: true, contact: 'visible', status: 'idle', composition: null, moveOrder: null };
    const next = applyDelta(original, {
      changed: { gameTimeHours: 1 },
      upserts: { provinceOwners: { 2: 1 } },
      removals: { armies: ['a'] },
      redactions: ['armies.a'],
    });
    expect(next.gameTimeHours).toBe(1);
    expect(next.provinceOwners[2]).toBe(1);
    expect(next.armies.a).toBeUndefined();
    expect(original.armies.a).toBeDefined();
  });
});
