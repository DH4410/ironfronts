import {
  GAME_PACE, MAX_DEBUG_GAME_SPEED, MIN_DEBUG_GAME_SPEED,
} from '@ironfronts/game-core';

/** Authoritative live pump cadence; gameplay dt still comes from real elapsed time. */
export const SIMULATION_INTERVAL_MS = GAME_PACE.clock.livePumpMilliseconds;
export const SIMULATION_TICK_HOURS = SIMULATION_INTERVAL_MS / 1_000
  * GAME_PACE.clock.simulationHoursPerRealSecond;

/** Civil-clock corrections are sparse; interpolation happens in the browser. */
export const CLOCK_SYNC_INTERVAL_MS = 1_000;

/** One shared debug multiplier for every gameplay system. */
export const MIN_SIM_SPEED = MIN_DEBUG_GAME_SPEED;
export const MAX_SIM_SPEED = MAX_DEBUG_GAME_SPEED;
/** Clamp a requested dev sim-speed multiplier; non-finite falls back to 1. */
export function clampSimSpeed(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return 1;
  return Math.max(MIN_SIM_SPEED, Math.min(MAX_SIM_SPEED, multiplier));
}

/** Real elapsed time missed by a stopped server, always replayed at normal 1x. */
export function offlineSimulationHours(savedAtEpochMs: number, nowEpochMs = Date.now()): number {
  if (!Number.isFinite(savedAtEpochMs) || !Number.isFinite(nowEpochMs)) return 0;
  return Math.max(0, nowEpochMs - savedAtEpochMs) / 3_600_000;
}
