/** Authoritative province production, upkeep payment, and shortage pressure. */
import type { GameState, Stockpile } from './game-state';
import { emptyStockpile } from './game-state';
import type { WorldData } from './world-data';
import type { SimContext } from './sim-context';
import { PHYSICAL_RESOURCES } from './economy/resources';
import {
  buildEngineerAssignmentIndex, engineerAssignmentKey, physicalResourceOutput, OCCUPIED_OUTPUT_MULTIPLIER,
} from './economy/resource-production';
import { applyUpkeepAndShortages, ensureCountryEconomy } from './economy/shortages';

/** Recompute gross rates. Baked baselines ensure this never re-normalizes after capture. */
export function recomputeIncome(state: GameState, world: WorldData, graph?: SimContext['graph']): void {
  const income = new Map<number, Stockpile>();
  for (const country of Object.values(state.countries)) income.set(country.id, emptyStockpile());
  const context = graph ? { state, world, graph } as SimContext : null;
  const engineerAssignments = context ? buildEngineerAssignmentIndex(context) : null;
  for (const province of world.provinces) {
    const owner = state.provinceOwners[province.id];
    const line = income.get(owner);
    const economy = state.provinceEconomies?.[province.id];
    if (!owner || !line || !economy) continue;
    const originalOwner = world.provinceOwner(province.id);
    const occupied = originalOwner !== 0 && originalOwner !== owner;
    const multiplier = occupied ? OCCUPIED_OUTPUT_MULTIPLIER : 1;
    line.funds += economy.baseProduction.funds * multiplier;
    line.manpower += economy.baseProduction.manpower * multiplier;
    for (const resource of PHYSICAL_RESOURCES) {
      line[resource] += context
        ? physicalResourceOutput(context, province.id, resource, economy,
          engineerAssignments?.get(engineerAssignmentKey(province.id, resource)) ?? 0)
        : economy.baseProduction[resource] * multiplier;
    }
  }
  for (const [countryId, line] of income) {
    const country = state.countries[countryId];
    if (!country) continue;
    ensureCountryEconomy(country);
    country.income = line;
  }
}

/** Production is credited first, then upkeep is paid from the resulting reserve. */
export function applyIncome(state: GameState, dtHours: number): void {
  for (const country of Object.values(state.countries)) {
    for (const key of Object.keys(country.stockpile) as Array<keyof Stockpile>) {
      country.stockpile[key] += country.income[key] * dtHours;
    }
  }
  applyUpkeepAndShortages(state, dtHours);
}
