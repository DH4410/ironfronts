import { describe, expect, it } from 'vitest';
import { COMBAT_VOLLEY_TICKS, stepCombat } from '../../src/game/combat';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { ArmyStack } from '../../src/game/units/army';
import { UNIT_TYPES } from '../../src/game/units/unit-catalog';
import type { WorldData } from '../../src/game/world-data';

function army(
  id: string, ownerCountryId: number, typeId: string, count: number, x = 100, node = 0,
): ArmyStack {
  const type = UNIT_TYPES.find((unit) => unit.id === typeId)!;
  return {
    id, ownerCountryId, name: id, x, z: 100, graphNodeId: node,
    units: [{ typeId, count, hp: count * type.maxHp, experience: 0 }],
    status: 'idle', order: null, extractingNodeId: null,
  };
}

function context(armies: Record<string, ArmyStack>, relations: Record<string, 'war'>): SimContext {
  const graph = buildLandGraph(
    new Float32Array([100, 100, 200, 100, 1, 0, 0, 0]), 1_000, 500,
  );
  const world: WorldData = {
    width: 1_000, height: 500, provinces: [],
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: -1 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: -1 },
    ],
    provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => 0,
    connections: new Float32Array(0), resourceNodes: [],
  };
  const state: GameState = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: {}, provinceBuildings: {}, productionQueues: {},
    constructionQueues: {}, rallyPoints: {}, armies, battles: {}, battleFronts: {},
    resourceNodes: {}, relations, nextArmyId: 10, nextBattleId: 1,
    nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph, world };
}

describe('v2 combat catalog and cadence', () => {
  it('contains the derived armor-specific attack and defence profiles', () => {
    expect(UNIT_TYPES.map((unit) => [unit.id, unit.attack, unit.defense])).toEqual([
      ['infantry', { soft: 8, light: 4.4, heavy: 2.4 }, { soft: 6, light: 3.3, heavy: 1.8 }],
      ['engineer', { soft: 1.8, light: 0.9, heavy: 0.45 }, { soft: 2.4, light: 1.2, heavy: 0.6 }],
      ['armored-car', { soft: 6.6, light: 4.2, heavy: 2.1 }, { soft: 7.7, light: 4.9, heavy: 2.45 }],
      ['light-tank', { soft: 16.8, light: 14.7, heavy: 9.8 }, { soft: 14.4, light: 12.6, heavy: 8.4 }],
      ['medium-tank', { soft: 26.4, light: 23.1, heavy: 15.4 }, { soft: 24, light: 21, heavy: 14 }],
      ['artillery', { soft: 29.9, light: 23.4, heavy: 32.5 }, { soft: 3.45, light: 2.7, heavy: 3.75 }],
    ]);
  });

  it('fires immediately, caps damage at ten units, keeps meat shields targetable, and waits 18,000 ticks', () => {
    const attackers = army('attackers', 1, 'infantry', 12);
    attackers.status = 'moving';
    attackers.order = {
      path: [1], destX: 200, destZ: 100, intent: 'attack',
      target: { kind: 'position', x: 200, z: 100 }, edgeProgress: 0,
    };
    const defenders = army('defenders', 2, 'infantry', 20);
    const ctx = context({ attackers, defenders }, { '1:2': 'war' });

    stepCombat(ctx, 0.05);
    expect(defenders.units[0].hp).toBeCloseTo(1_920, 5); // 10 × 8 attack
    expect(attackers.units[0].hp).toBeCloseTo(1_140, 5); // simultaneous 10 × 6 defence
    expect(defenders.units[0].count).toBe(20); // overflow absorbed pooled damage
    stepCombat(ctx, 0.05);
    expect(defenders.units[0].hp).toBeCloseTo(1_920, 5);

    ctx.state.simulationTick = COMBAT_VOLLEY_TICKS;
    stepCombat(ctx, 0.05);
    // The second volley is 76 because the attacking group now fires at 95% condition.
    expect(defenders.units[0].hp).toBeCloseTo(1_844, 5);
  });

  it('lets peaceful overlapping armies pass without battle or war', () => {
    const ctx = context({
      a: army('a', 1, 'infantry', 2),
      b: army('b', 2, 'infantry', 2),
    }, {});
    stepCombat(ctx, 0.05);
    expect(ctx.state.battles).toEqual({});
    expect(ctx.state.relations).toEqual({});
    expect(ctx.state.armies.a.status).toBe('idle');
    expect(ctx.state.armies.b.status).toBe('idle');
  });

  it('allows only ten artillery pieces to one-shot one ranged target and resets cooldown', () => {
    const battery = army('battery', 1, 'artillery', 11, 100, 0);
    const target = army('target', 2, 'medium-tank', 1, 200, 1);
    const ctx = context({ battery, target }, { '1:2': 'war' });
    const events = stepCombat(ctx, 0.05);
    expect(ctx.state.armies.target).toBeUndefined();
    expect(ctx.state.armies.battery.artillery?.nextVolleyTick).toBe(0);
    expect(events.some((event) => event.kind === 'bombardment')).toBe(true);
  });
});
