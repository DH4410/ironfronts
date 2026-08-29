/**
 * The scenario catalogue. Mirrors the three operation rows already in
 * `index.html` plus the Map Sandbox card, and is the single typed source of
 * truth for what each operation means. `menu.ts` renders the operation and
 * country lists from this; it never invents rows.
 *
 * The world is procedurally generated (200 nations), so the operations are
 * historical framing over procedural countries. Faction lists below are curated
 * from names that exist in the generated world; `resolvePlayableCountries()`
 * drops any that are absent so a seed change degrades gracefully instead of
 * throwing.
 */

import type { CatalogCountry } from './data/countries.generated';
import { CATALOG_COUNTRIES, CATALOG_COUNTRY_BY_NAME } from './data/countries.generated';
import type { ScenarioDef, ScenarioSelection } from './scenario';

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'OP-1939-01',
    name: 'World at War',
    theater: 'global',
    theaterLabel: 'Global',
    startDate: '1 Sep 1939',
    mode: 'campaign',
    playableCountries: 'all',
    featuredCountries: [
      'Germany', 'France', 'United Kingdom', 'Italy', 'Poland', 'Spain', 'Turkey', 'Japan',
    ],
    fogOfWar: true,
    economyEnabled: true,
    blurb: 'Coordinate a global mobilization and hold every theater at once.',
  },
  {
    id: 'OP-1941-22',
    name: 'Operation Barbarossa',
    theater: 'eastern-front',
    theaterLabel: 'Eastern Front',
    startDate: '22 Jun 1941',
    mode: 'campaign',
    playableCountries: [
      'Germany', 'Belarus', 'Ukraine', 'Arkhangelsk', 'Volga Perm', 'Volga Nzhny',
      'Caucasus', 'Kazakhstan', 'Turkestan', 'Siberia', 'Mongolia', 'Manchukuo',
    ],
    featuredCountries: ['Germany', 'Belarus', 'Ukraine', 'Caucasus'],
    fogOfWar: true,
    economyEnabled: true,
    blurb: 'Break Soviet resistance in the west before winter closes the front.',
  },
  {
    id: 'OP-1944-01',
    name: 'Operation Overlord',
    theater: 'western-europe',
    theaterLabel: 'Western Europe',
    startDate: '6 Jun 1944',
    mode: 'campaign',
    playableCountries: [
      'Germany', 'France', 'United Kingdom', 'Belgium', 'Netherlands', 'Denmark',
      'Norway', 'New England',
    ],
    featuredCountries: ['France', 'United Kingdom', 'Germany', 'New England'],
    fogOfWar: true,
    economyEnabled: true,
    blurb: 'Break the Atlantic Wall and open a second front in the west.',
  },
  {
    id: 'SANDBOX',
    name: 'Map Sandbox',
    theater: 'free',
    theaterLabel: 'Sandbox',
    startDate: 'Free deployment',
    mode: 'sandbox',
    playableCountries: 'all',
    featuredCountries: ['Spain', 'Germany', 'France', 'United Kingdom'],
    fogOfWar: false,
    economyEnabled: false,
    blurb: 'No fog, no economy limits — explore the whole world freely.',
  },
];

export const SCENARIO_BY_ID: ReadonlyMap<string, ScenarioDef> =
  new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function scenarioById(id: string): ScenarioDef {
  const scenario = SCENARIO_BY_ID.get(id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return scenario;
}

/**
 * Resolve a scenario's playable countries to concrete catalogue records,
 * ordered featured-first. `'all'` returns every country with territory.
 * Unknown names in a curated list are skipped (logged by the caller if needed).
 */
export function resolvePlayableCountries(scenario: ScenarioDef): CatalogCountry[] {
  if (scenario.playableCountries === 'all') {
    const featured = new Set(scenario.featuredCountries.map((name) => name.toLowerCase()));
    const withTerritory = CATALOG_COUNTRIES.filter((country) => country.provinceCount > 0);
    return withTerritory.sort((a, b) => {
      const af = featured.has(a.name.toLowerCase()) ? 0 : 1;
      const bf = featured.has(b.name.toLowerCase()) ? 0 : 1;
      if (af !== bf) return af - bf;
      return b.provinceCount - a.provinceCount;
    });
  }
  const seen = new Set<number>();
  const resolved: CatalogCountry[] = [];
  for (const name of scenario.playableCountries) {
    const country = CATALOG_COUNTRY_BY_NAME.get(name.toLowerCase());
    if (country && country.provinceCount > 0 && !seen.has(country.id)) {
      seen.add(country.id);
      resolved.push(country);
    }
  }
  return resolved;
}

/** True when `countryId` is a legal player choice for the scenario (safety). */
export function isPlayableCountry(scenario: ScenarioDef, countryId: number): boolean {
  return resolvePlayableCountries(scenario).some((country) => country.id === countryId);
}

/** Build the typed menu -> game hand-off. Throws on an illegal country. */
export function buildScenarioSelection(
  scenarioId: string, playerCountryId: number,
): ScenarioSelection {
  const scenario = scenarioById(scenarioId);
  if (!isPlayableCountry(scenario, playerCountryId)) {
    throw new Error(
      `Country ${playerCountryId} is not playable in scenario ${scenarioId}.`,
    );
  }
  return {
    scenarioId,
    theater: scenario.theater,
    startDate: scenario.startDate,
    playerCountryId,
    sandbox: scenario.mode === 'sandbox',
  };
}
