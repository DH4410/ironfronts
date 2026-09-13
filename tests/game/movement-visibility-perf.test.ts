/**
 * stepMovement() used to unconditionally recompute fog-of-war visibility
 * (once per distinct owning country) before validating every ordered army's
 * move, even though revalidateOrder()/targetPoint() only ever read it for an
 * order.target.kind === 'army' pursuit. With many armies spread across many
 * countries — an ordinary large campaign — that turned every simulation tick
 * into an O(countries) visibility recomputation.
 */

import { describe, expect, it, vi } from 'vitest';
import * as visibilityModule from '../../src/game/visibility';
import { stepMovement } from '../../src/game/units/movement';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData, WorldProvince } from '../../src/game/world-data';
import type { ArmyStack } from '../../src/game/units/army';

function prov(id: number, x: number, z: number): WorldProvince {
  return { id, center: [x, z], terrainId: 0, population: 100, coastal: false, urban: false };
}

function graph(): LandGraph {
  return buildLandGraph(new Float32Array([100, 100, 900, 100, 1, 0, 0, 0]), 10_000, 5_000);
}

describe('stepMovement visibility cost', () => {
  it('never computes fog-of-war visibility for a plain point-to-point move order', () => {
    const provinces = [prov(10, 100, 100), prov(20, 900, 100)];
    const world: WorldData = {
      width: 10_000, height: 5_000, provinces,
      countries: [
        { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
      ],
      provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => 0,
      connections: new Float32Array(0), resourceNodes: [],
    };
    const state: GameState = {
      version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
      fogOfWar: true, economyEnabled: false,
      clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
      countries: {
        1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      },
      provinceOwners: { 10: 1, 20: 1 },
      provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
      armies: {
        marcher: {
          id: 'marcher', ownerCountryId: 1, name: 'Marcher', x: 100, z: 100, graphNodeId: 0,
          units: [{ typeId: 'infantry', count: 1, hp: 100, experience: 0 }],
          status: 'moving', extractingNodeId: null,
          order: { path: [1], destX: 900, destZ: 100, intent: 'move', edgeProgress: 0 },
        } satisfies ArmyStack,
      },
      resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
      nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
    };
    const ctx: SimContext = { state, graph: graph(), world };

    const spy = vi.spyOn(visibilityModule, 'computeArmyVisibility');
    stepMovement(ctx, 0.1 / 3_600);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
