/**
 * The command boundary: every mutation carries an acting countryId and is
 * checked against authoritative ownership before it reaches state. This is the
 * anti-cheat / server-ready contract — a client cannot move another country's
 * army by sending a command with the wrong countryId.
 */

import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import { applyCommand } from '../../src/game/commands';
import { stepProduction } from '../../src/game/production';
import type { ArmyStack } from '../../src/game/units/army';

function graph(): LandGraph {
  return buildLandGraph(new Float32Array([100, 100, 300, 100, 1, 0, 0, 0]), 10_000, 5_000);
}

function world(): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [{
      id: 10, center: [100, 100], terrainId: 4, population: 500, coastal: false, urban: true,
    }],
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: -1 },
    ],
    provinceOwner: () => 0, provinceAt: () => 10, terrainClassAt: () => 4,
    connections: new Float32Array(0), resourceNodes: [],
  };
}

function ctx(): SimContext {
  const state: GameState = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: { ...emptyStockpile(), funds: 999, manpower: 999, food: 999, metal: 999 }, income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: { ...emptyStockpile(), funds: 999, manpower: 999, food: 999, metal: 999 }, income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: { 10: 1 },
    provinceBuildings: { 10: { barracks: 1, tankPlant: 0, ordnance: 0 } },
    productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {
      a1: {
        id: 'a1', ownerCountryId: 1, name: '1st', x: 100, z: 100, graphNodeId: 0,
        units: [{ typeId: 'infantry', count: 3, hp: 300, experience: 0 }],
        status: 'idle', order: null, extractingNodeId: null,
      } satisfies ArmyStack,
    },
    resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
    nextArmyId: 2, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph: graph(), world: world() };
}

describe('applyCommand ownership gate', () => {
  it('rejects a move for a country that does not own the army', () => {
    const c = ctx();
    const res = applyCommand(c, { type: 'moveArmy', countryId: 2, armyId: 'a1', x: 300, z: 100 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Not your army.');
    expect(c.state.armies.a1.order).toBeNull();
  });

  it('lets the owning country move its own army', () => {
    const c = ctx();
    const res = applyCommand(c, { type: 'moveArmy', countryId: 1, armyId: 'a1', x: 300, z: 100 });
    expect(res.ok).toBe(true);
    expect(c.state.armies.a1.order).not.toBeNull();
  });

  it('rejects production for a country that does not own the province', () => {
    const c = ctx();
    const res = applyCommand(c, { type: 'produce', countryId: 2, provinceId: 10, unitTypeId: 'infantry' });
    expect(res.ok).toBe(false);
    expect(c.state.productionQueues[10]).toBeUndefined();
  });

  it('routes a valid produce command through to the queue', () => {
    const c = ctx();
    const res = applyCommand(c, { type: 'produce', countryId: 1, provinceId: 10, unitTypeId: 'infantry' });
    expect(res.ok).toBe(true);
    expect(c.state.productionQueues[10]).toHaveLength(1);
    expect(c.state.productionQueues[10][0].ownerCountryId).toBe(1);
  });

  it('stops only your own army', () => {
    const c = ctx();
    applyCommand(c, { type: 'moveArmy', countryId: 1, armyId: 'a1', x: 300, z: 100 });
    expect(applyCommand(c, { type: 'stopArmy', countryId: 2, armyId: 'a1' }).ok).toBe(false);
    expect(c.state.armies.a1.order).not.toBeNull();
    expect(applyCommand(c, { type: 'stopArmy', countryId: 1, armyId: 'a1' }).ok).toBe(true);
    expect(c.state.armies.a1.order).toBeNull();
  });

  it('setRally is gated by province ownership and clears with a null target', () => {
    const c = ctx();
    expect(applyCommand(c, {
      type: 'setRally', countryId: 2, provinceId: 10, target: { x: 300, z: 100 },
    }).ok).toBe(false);
    expect(c.state.rallyPoints[10]).toBeUndefined();

    expect(applyCommand(c, {
      type: 'setRally', countryId: 1, provinceId: 10, target: { x: 300, z: 100 },
    }).ok).toBe(true);
    expect(c.state.rallyPoints[10]).toEqual({ x: 300, z: 100 });

    applyCommand(c, { type: 'setRally', countryId: 1, provinceId: 10, target: null });
    expect(c.state.rallyPoints[10]).toBeUndefined();
  });

  it('a produced unit marches to the rally point', () => {
    const c = ctx();
    applyCommand(c, {
      type: 'setRally', countryId: 1, provinceId: 10, target: { x: 300, z: 100 },
    });
    applyCommand(c, { type: 'produce', countryId: 1, provinceId: 10, unitTypeId: 'infantry' });
    const done = stepProduction(c, 999);
    expect(done).toHaveLength(1);
    const army = c.state.armies[done[0].armyId];
    expect(army.order).not.toBeNull();
    expect(army.status).toBe('moving');
  });
});
