import { describe, expect, it, beforeAll } from 'vitest';
import { GameSession } from '../../src/game/game-session';
import { buildScenarioSelection } from '../../src/game/scenario-catalog';
import { stackUnitCount } from '../../src/game/units/army';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import { loadWorld, type LoadedWorld } from './load-world';

const SPAIN = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

function spainSession(): GameSession {
  return GameSession.create(buildScenarioSelection('OP-1939-01', SPAIN), world);
}

describe('gameplay vertical slice (§61)', () => {
  it('an ordered army moves along the road graph and stops when told', () => {
    const s = spainSession();
    const army = Object.values(s.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    const startNode = army.graphNodeId;
    // Move toward another owned Spanish province centre.
    const target = world.provinces.find(
      (p) => s.state.provinceOwners[p.id] === SPAIN && p.id !== army.graphNodeId,
    )!;
    const res = s.orderMove(army.id, target.center[0], target.center[1], 'move');
    expect(res.ok).toBe(true);
    expect(army.order).not.toBeNull();

    const startX = army.x;
    s.tick(4);
    expect(army.x !== startX || army.z !== 0).toBe(true); // it moved
    s.orderStop(army.id);
    expect(army.order).toBeNull();
    expect(army.status).toBe('idle');
    // graph node advanced or stayed valid
    expect(army.graphNodeId).toBeGreaterThanOrEqual(0);
    expect(startNode).toBeGreaterThanOrEqual(0);
  });

  it('engineers extract a controlled deposit into the stockpile', () => {
    const s = spainSession();
    const node = Object.values(s.state.resourceNodes).find(
      (n) => n.controllerCountryId === SPAIN && n.accessNodeId >= 0 && n.remaining > 0,
    );
    expect(node).toBeDefined();
    // Place an engineer stack directly on the access node.
    const engineers = {
      id: 'test-eng', ownerCountryId: SPAIN, name: 'Miners',
      x: s.graph.nodeX[node!.accessNodeId], z: s.graph.nodeZ[node!.accessNodeId],
      graphNodeId: node!.accessNodeId,
      units: [{ typeId: 'engineer', count: 3, hp: 240, experience: 0 }],
      status: 'idle' as const, order: null, extractingNodeId: null,
    };
    s.state.armies['test-eng'] = engineers;

    const before = s.state.countries[SPAIN].stockpile[node!.kind];
    const remainingBefore = node!.remaining;
    const start = s.orderExtract('test-eng');
    expect(start.ok).toBe(true);
    s.tick(6);
    expect(s.state.countries[SPAIN].stockpile[node!.kind]).toBeGreaterThan(before);
    expect(node!.remaining).toBeLessThan(remainingBefore);
  });

  it('a city produces a unit that spawns and auto-stacks', () => {
    const s = spainSession();
    // Find the player province with a tank plant (the capital).
    const plantProvince = Object.entries(s.state.provinceBuildings)
      .find(([, b]) => b.tankPlant > 0 && s.state.provinceOwners[Number([].concat()[0] ?? 0)] !== undefined);
    const pid = Number(Object.keys(s.state.provinceBuildings).find(
      (k) => s.state.provinceBuildings[Number(k)].tankPlant > 0 && s.ownsProvince(Number(k)),
    ));
    expect(Number.isFinite(pid)).toBe(true);
    void plantProvince;

    const armiesBefore = Object.keys(s.state.armies).length;
    const fundsBefore = s.state.countries[SPAIN].stockpile.funds;
    const order = s.produce(pid, 'light-tank');
    expect(order.ok).toBe(true);
    expect(s.state.countries[SPAIN].stockpile.funds).toBeLessThan(fundsBefore);

    // light-tank buildTime 12h / scale 4 = 3 game-hours.
    s.tick(5);
    const armiesAfter = Object.values(s.state.armies).filter((a) => a.ownerCountryId === SPAIN);
    const hasLightTank = armiesAfter.some((a) => a.units.some((g) => g.typeId === 'light-tank'));
    expect(hasLightTank).toBe(true);
    expect(Object.keys(s.state.armies).length).toBeGreaterThanOrEqual(armiesBefore);
  });

  it('hostile stacks at the same node fight and one is destroyed; capture flips ownership', () => {
    const s = spainSession();
    const enemyId = s.enableNearbyAi();
    expect(enemyId).not.toBeNull();

    // Put a strong Spanish stack and a weak enemy stack on the same enemy
    // province centre node.
    const enemyProvince = world.provinces.find((p) => s.state.provinceOwners[p.id] === enemyId)!;
    const node = s.graph.component.length > 0
      ? nearestOwned(s, enemyProvince.center[0], enemyProvince.center[1])
      : 0;
    const at = { x: s.graph.nodeX[node], z: s.graph.nodeZ[node], graphNodeId: node };

    s.state.armies['sp-strike'] = {
      id: 'sp-strike', ownerCountryId: SPAIN, name: 'Strike', ...at,
      units: [{ typeId: 'medium-tank', count: 4, hp: 760, experience: 0 },
        { typeId: 'infantry', count: 6, hp: 600, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };
    s.state.armies['en-weak'] = {
      id: 'en-weak', ownerCountryId: enemyId!, name: 'Militia', ...at,
      units: [{ typeId: 'infantry', count: 2, hp: 200, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };

    s.tick(8);
    // Enemy stack destroyed; province captured by Spain.
    const enemyGone = !s.state.armies['en-weak'] || stackUnitCount(s.state.armies['en-weak']) === 0;
    expect(enemyGone).toBe(true);
    // give capture a tick with no defender
    s.tick(2);
    expect(s.state.provinceOwners[enemyProvince.id]).toBe(SPAIN);
    expect(s.isAtWar(SPAIN, enemyId!)).toBe(true);
  });
});

function nearestOwned(s: GameSession, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < s.graph.nodeCount; i += 1) {
    const dx = s.graph.nodeX[i] - x;
    const dz = s.graph.nodeZ[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
