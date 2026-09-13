/** Coarse unattended economy simulation used by balance tests and tuning tools.
 * It deliberately calls the production, construction, upkeep and AI modules
 * used by the live server; only movement/combat/rendering are omitted. */
import type { GameSession } from '../game-session';
import type { Stockpile, UpkeepResource } from '../game-state';
import { stepAiEconomy } from '../ai/simple-ai';
import { stepConstruction } from '../construction';
import { applyIncome, recomputeIncome } from '../economy';
import { stepExtraction } from '../extraction';
import { stepProduction } from '../production';

export interface EconomySimulationCountry {
  countryId: number;
  stockpile: Stockpile;
  production: Stockpile;
  upkeep: Stockpile;
  net: Stockpile;
  coverage: Record<UpkeepResource, number>;
  shortageSeverity: Record<UpkeepResource, number>;
}

export interface EconomySimulationSnapshot {
  day: number;
  countries: Record<number, EconomySimulationCountry>;
}

function snapshot(session: GameSession, day: number): EconomySimulationSnapshot {
  return { day, countries: Object.fromEntries(Object.values(session.state.countries).map((country) => [country.id, {
    countryId: country.id,
    stockpile: { ...country.stockpile }, production: { ...country.income },
    upkeep: { ...(country.upkeep ?? { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 }) },
    net: { ...(country.netIncome ?? country.income) },
    coverage: { ...(country.coverage ?? { funds: 1, food: 1, metal: 1, oil: 1 }) },
    shortageSeverity: Object.fromEntries((['funds', 'food', 'metal', 'oil'] as const)
      .map((resource) => [resource, country.shortages?.[resource]?.severity ?? 0])) as Record<UpkeepResource, number>,
  }])) };
}

export function runEconomySimulation(
  session: GameSession,
  days: readonly number[] = [1, 3, 7, 14, 35],
  stepHours = 6,
): EconomySimulationSnapshot[] {
  if (!Number.isFinite(stepHours) || stepHours <= 0 || stepHours > 6) {
    throw new Error('Economy simulator step must be in (0, 6] hours.');
  }
  const targets = [...new Set(days)].filter((day) => Number.isFinite(day) && day >= 0).sort((a, b) => a - b);
  const result: EconomySimulationSnapshot[] = [];
  let elapsed = 0;
  for (const day of targets) {
    const targetHours = day * 24;
    while (elapsed + 1e-9 < targetHours) {
      const dt = Math.min(stepHours, targetHours - elapsed);
      session.state.clock.gameTimeHours += dt;
      session.state.simulationTick += 1;
      stepExtraction(session, dt);
      recomputeIncome(session.state, session.world, session.graph);
      applyIncome(session.state, dt);
      stepConstruction(session, dt);
      stepProduction(session, dt);
      stepAiEconomy(session);
      elapsed += dt;
    }
    recomputeIncome(session.state, session.world, session.graph);
    result.push(snapshot(session, day));
  }
  return result;
}
