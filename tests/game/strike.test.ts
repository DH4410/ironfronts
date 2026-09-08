import { describe, expect, it, beforeAll } from 'vitest';
import { GameSession } from '../../src/game/game-session';
import { relationOf } from '../../src/game/game-state';
import { buildScenarioSelection } from '../../src/game/scenario-catalog';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import { loadWorld, type LoadedWorld } from './load-world';

const SPAIN = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

function session(): GameSession {
  return GameSession.create(buildScenarioSelection('OP-1939-01', SPAIN), world);
}

function foreignProvince(s: GameSession) {
  const p = world.provinces.find((province) => {
    const owner = s.state.provinceOwners[province.id];
    return owner && owner !== SPAIN;
  });
  if (!p) throw new Error('no foreign province in scenario');
  return { province: p, ownerId: s.state.provinceOwners[p.id] };
}

describe('strategic strike', () => {
  it('spends a warhead, wipes stacks, levels buildings and forces war', () => {
    const s = session();
    const { province, ownerId } = foreignProvince(s);
    const [x, z] = province.center;

    s.state.countries[SPAIN].warheads = 1;
    s.state.provinceBuildings[province.id] = { barracks: 2, tankPlant: 1, ordnance: 0 };
    s.state.armies['victim'] = {
      id: 'victim', ownerCountryId: ownerId, name: 'Garrison', x, z,
      graphNodeId: 0, units: [{ typeId: 'infantry', count: 3, hp: 240, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    } as never;

    const res = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });

    expect(res.ok).toBe(true);
    expect(res.strike).toMatchObject({ attacker: SPAIN, defender: ownerId, provinceId: province.id });
    expect(s.state.countries[SPAIN].warheads).toBe(0);
    expect(s.state.armies.victim).toBeUndefined();
    expect(s.state.provinceBuildings[province.id]).toMatchObject({ barracks: 1, tankPlant: 0, ordnance: 0 });
    expect(relationOf(s.state, SPAIN, ownerId)).toBe('war');

    const event = s.pendingCombat.find((e) => e.kind === 'strike');
    expect(event).toMatchObject({ attacker: SPAIN, defender: ownerId, provinceId: province.id, x, z });
  });

  it('rejects cleanly when the country has no warhead field (pre-strike save)', () => {
    const s = session();
    const { province } = foreignProvince(s);
    const [x, z] = province.center;
    delete (s.state.countries[SPAIN] as { warheads?: number }).warheads;

    const res = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });

    expect(res.ok).toBe(false);
    expect(res.strike).toBeUndefined();
    expect(s.pendingCombat.some((e) => e.kind === 'strike')).toBe(false);
  });

  it('rejects a strike on your own territory', () => {
    const s = session();
    const own = world.provinces.find((p) => s.state.provinceOwners[p.id] === SPAIN)!;
    s.state.countries[SPAIN].warheads = 1;
    const res = s.applyCommand({
      type: 'strike', countryId: SPAIN, provinceId: own.id, x: own.center[0], z: own.center[1],
    });
    expect(res.ok).toBe(false);
    expect(s.state.countries[SPAIN].warheads).toBe(1);
  });

  it('accrues warheads while holding an Ordnance Workshop', () => {
    const s = session();
    const own = world.provinces.find((p) => s.state.provinceOwners[p.id] === SPAIN)!;
    s.state.countries[SPAIN].warheads = 0;
    s.state.provinceBuildings[own.id] = { barracks: 0, tankPlant: 0, ordnance: 1 };

    s.tick(18 * 24 + 10); // just over one warhead's worth of game-hours

    expect(s.state.countries[SPAIN].warheads ?? 0).toBeGreaterThanOrEqual(1);
  });
});
