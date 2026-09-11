/**
 * Passive macro economy.
 *
 * FUNDS and MANPOWER accrue from owned populated provinces; FOOD from owned
 * provinces generally (agriculture proxy). STONE / METAL / OIL are NOT passive —
 * they come only from physical extraction and are added by that system.
 *
 * `recomputeIncome` sets each country's per-game-hour `income`; `applyIncome`
 * adds `income * dtHours` to the stockpile. Split so the HUD can show a stable
 * rate without re-deriving it.
 */

import { PROTOTYPE_HOURS_PER_HOUR } from './time';
import type { GameState, Stockpile } from './game-state';
import { emptyStockpile } from './game-state';
import type { WorldData } from './world-data';

/** Per 100k population, per game-hour. Deliberately gentle. */
const FUNDS_PER_100K = 0.9;
const MANPOWER_PER_100K = 0.5;
// econ-rebalance: infantry's food cost rose 20x (5 -> 100, steeper than
// funds' 10x) while this rate stayed put, so food income silently became the
// dominant bottleneck — a small nation's funds/manpower would balloon unspent
// while food crawled back for tens of hours per unit. Raised ~2.7x so food's
// time-to-afford-one-infantry roughly tracks funds' (still the tighter of the
// two for a tank), not so far that it revives spam: a fresh selectable
// country still takes hours per infantry from income alone, nowhere near the
// near-instant old cadence.
const FOOD_PER_PROVINCE = 0.4;
const URBAN_FUNDS_BONUS = 4;

export function recomputeIncome(state: GameState, world: WorldData): void {
  const income = new Map<number, Stockpile>();
  for (const countryId of Object.keys(state.countries)) {
    income.set(Number(countryId), emptyStockpile());
  }
  for (const province of world.provinces) {
    const owner = state.provinceOwners[province.id];
    if (!owner) continue;
    const line = income.get(owner);
    if (!line) continue;
    line.funds += (province.population / 100_000) * FUNDS_PER_100K;
    line.manpower += (province.population / 100_000) * MANPOWER_PER_100K;
    line.food += FOOD_PER_PROVINCE;
    if (province.urban) line.funds += URBAN_FUNDS_BONUS;
  }
  for (const [countryId, line] of income) {
    const country = state.countries[countryId];
    if (country) country.income = Object.fromEntries(Object.entries(line).map(([key, value]) => [key, value * PROTOTYPE_HOURS_PER_HOUR])) as Stockpile;
  }
}

export function applyIncome(state: GameState, dtHours: number): void {
  for (const country of Object.values(state.countries)) {
    country.stockpile.funds += country.income.funds * dtHours;
    country.stockpile.manpower += country.income.manpower * dtHours;
    country.stockpile.food += country.income.food * dtHours;
    // stone/metal/oil intentionally excluded — physical extraction only.
  }
}
