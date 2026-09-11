/** All domain durations are hours on the authoritative, normally 1:1 timeline. */
export const SECONDS_PER_HOUR = 3_600;
export const FIXED_STEP_SECONDS = 0.1;
export const FIXED_STEP_HOURS = FIXED_STEP_SECONDS / SECONDS_PER_HOUR;
/** Conversion of the prototype's accelerated work units; used for tuning and v2 migration. */
export const PROTOTYPE_HOURS_PER_HOUR = 1_800;
export const INITIAL_GAME_EPOCH_MS = Date.UTC(1939, 8, 1, 10);

export function gameEpochMs(clock: { gameTimeHours: number; initialEpochMs?: number }): number {
  return (clock.initialEpochMs ?? INITIAL_GAME_EPOCH_MS) + clock.gameTimeHours * 3_600_000;
}
