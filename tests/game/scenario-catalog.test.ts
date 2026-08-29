import { describe, expect, it } from 'vitest';
import {
  SCENARIOS, buildScenarioSelection, isPlayableCountry, resolvePlayableCountries,
  scenarioById,
} from '../../src/game/scenario-catalog';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';

const spainId = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
const franceId = CATALOG_COUNTRY_BY_NAME.get('france')!.id;

describe('scenario catalogue', () => {
  it('mirrors the three operations plus sandbox', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'OP-1939-01', 'OP-1941-22', 'OP-1944-01', 'SANDBOX',
    ]);
  });

  it('World at War is broad; Spain is playable, featured-first', () => {
    const worldAtWar = scenarioById('OP-1939-01');
    const playable = resolvePlayableCountries(worldAtWar);
    expect(playable.length).toBeGreaterThan(100);
    expect(isPlayableCountry(worldAtWar, spainId)).toBe(true);
    expect(playable.slice(0, 8).map((c) => c.name)).toContain('Germany');
  });

  it('Barbarossa restricts playable factions (no Spain)', () => {
    const barbarossa = scenarioById('OP-1941-22');
    const names = resolvePlayableCountries(barbarossa).map((c) => c.name);
    expect(names).toContain('Germany');
    expect(names).not.toContain('Spain');
    expect(isPlayableCountry(barbarossa, spainId)).toBe(false);
    expect(names.length).toBeLessThan(20);
  });

  it('Overlord restricts to western factions (France + Germany, no Spain)', () => {
    const overlord = scenarioById('OP-1944-01');
    const names = resolvePlayableCountries(overlord).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['France', 'Germany']));
    expect(names).not.toContain('Spain');
    expect(isPlayableCountry(overlord, franceId)).toBe(true);
  });

  it('Sandbox allows everything and is fog/economy-free', () => {
    const sandbox = scenarioById('SANDBOX');
    expect(sandbox.fogOfWar).toBe(false);
    expect(sandbox.economyEnabled).toBe(false);
    expect(isPlayableCountry(sandbox, spainId)).toBe(true);
  });

  it('buildScenarioSelection produces typed data and rejects illegal countries', () => {
    const selection = buildScenarioSelection('OP-1939-01', spainId);
    expect(selection).toEqual({
      scenarioId: 'OP-1939-01',
      theater: 'global',
      startDate: '1 Sep 1939',
      playerCountryId: spainId,
      sandbox: false,
    });
    expect(() => buildScenarioSelection('OP-1941-22', spainId)).toThrow(/not playable/);
  });
});
