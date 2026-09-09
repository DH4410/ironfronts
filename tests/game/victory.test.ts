import { describe, expect, it } from 'vitest';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import type { GameState } from '../../src/game/game-state';
import { stepVictory } from '../../src/game/victory';

/**
 * Conquest victory: the player wins once every country they are at war with has
 * lost its capital; the player loses if their own capital falls or they are
 * wiped off the map.
 */
function world(): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [
      { id: 1, center: [100, 100], terrainId: 0, population: 0, coastal: false, urban: true },
      { id: 2, center: [300, 100], terrainId: 0, population: 0, coastal: false, urban: true },
      { id: 3, center: [500, 100], terrainId: 0, population: 0, coastal: false, urban: true },
    ],
    countries: [
      { id: 1, name: 'Player', color: '#fff', capitalProvinceId: 1 },
      { id: 2, name: 'Foe A', color: '#f00', capitalProvinceId: 2 },
      { id: 3, name: 'Foe B', color: '#0f0', capitalProvinceId: 3 },
    ],
    provinceOwner: () => 0,
    provinceAt: () => 0,
    connections: new Float32Array(0),
    resourceNodes: [],
  } as unknown as WorldData;
}

function ctx(overrides: {
  owners?: Record<number, number>;
  relations?: Record<string, string>;
  outcome?: GameState['outcome'];
} = {}): SimContext {
  const state = {
    clock: { gameTimeHours: 42, startDate: 'x' },
    countries: {
      1: { id: 1, name: 'Player', color: '#fff', controller: 'player' },
      2: { id: 2, name: 'Foe A', color: '#f00', controller: 'ai' },
      3: { id: 3, name: 'Foe B', color: '#0f0', controller: 'ai' },
    },
    provinceOwners: overrides.owners ?? { 1: 1, 2: 2, 3: 3 },
    relations: overrides.relations ?? {},
    outcome: overrides.outcome,
  } as unknown as GameState;
  return { state, graph: {} as never, world: world() };
}

describe('stepVictory', () => {
  it('does nothing while no war is in progress', () => {
    const c = ctx();
    expect(stepVictory(c)).toBeNull();
    expect(c.state.outcome).toBeUndefined();
  });

  it('does nothing while a hostile still holds its capital', () => {
    const c = ctx({ relations: { '1:2': 'war' } });
    expect(stepVictory(c)).toBeNull();
  });

  it('declares victory once every hostile capital has fallen', () => {
    const c = ctx({
      owners: { 1: 1, 2: 1, 3: 3 },
      relations: { '1:2': 'war' },
    });
    const outcome = stepVictory(c);
    expect(outcome).toMatchObject({ result: 'victory', atGameHours: 42 });
    expect(c.state.outcome).toEqual(outcome);
  });

  it('needs every hostile beaten, not just one', () => {
    const c = ctx({
      owners: { 1: 1, 2: 1, 3: 3 },
      relations: { '1:2': 'war', '1:3': 'war' },
    });
    expect(stepVictory(c)).toBeNull(); // Foe B still holds province 3
  });

  it('declares defeat when the player loses their capital but still holds ground', () => {
    // Player lost capital province 1 to Foe A, but still holds province 3.
    const c = ctx({ owners: { 1: 2, 2: 2, 3: 1 }, relations: { '1:2': 'war' } });
    expect(stepVictory(c)).toMatchObject({ result: 'defeat', reason: 'Your capital has fallen.' });
  });

  it('declares defeat when the player holds no territory', () => {
    const c = ctx({ owners: { 2: 2, 3: 3 } });
    expect(stepVictory(c)).toMatchObject({ result: 'defeat', reason: 'Your nation has been overrun.' });
  });

  it('never overwrites a decided outcome', () => {
    const decided = { result: 'victory', reason: 'x', atGameHours: 1 } as const;
    const c = ctx({ owners: { 1: 2, 2: 2, 3: 3 }, relations: { '1:2': 'war' }, outcome: decided });
    expect(stepVictory(c)).toBeNull();
    expect(c.state.outcome).toBe(decided);
  });
});
