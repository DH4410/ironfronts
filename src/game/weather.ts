import type { GameState, WorldWeather } from './game-state';

const MIN_RAIN_MINUTES = 60;
const RAIN_DURATION_RANGE = 61;

function hash(seed: number, value: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function automaticWeatherForDay(seed: number, nowEpochMs: number): Omit<WorldWeather, 'mode' | 'raining'> {
  const date = new Date(nowEpochMs);
  const dayKey = date.toISOString().slice(0, 10);
  const durationMinutes = MIN_RAIN_MINUTES + hash(seed, `${dayKey}:duration`) % RAIN_DURATION_RANGE;
  const latestStart = 24 * 60 - durationMinutes;
  const rainStartMinute = hash(seed, `${dayKey}:start`) % (latestStart + 1);
  return { scheduleDay: dayKey, rainStartMinute, rainDurationMinutes: durationMinutes };
}

/** Reconcile persistent weather against the real-world UTC day. Returns true on a state change. */
export function updateRealWeather(state: GameState, nowEpochMs: number): boolean {
  const schedule = automaticWeatherForDay(state.seed, nowEpochMs);
  const previous = state.weather;
  const mode = previous?.mode ?? 'automatic';
  const minute = new Date(nowEpochMs).getUTCHours() * 60 + new Date(nowEpochMs).getUTCMinutes();
  const automaticRain = minute >= schedule.rainStartMinute
    && minute < schedule.rainStartMinute + schedule.rainDurationMinutes;
  const raining = mode === 'forced-rain' || (mode === 'automatic' && automaticRain);
  const next: WorldWeather = { mode, raining, ...schedule };
  const changed = !previous || previous.mode !== next.mode || previous.raining !== next.raining
    || previous.scheduleDay !== next.scheduleDay || previous.rainStartMinute !== next.rainStartMinute
    || previous.rainDurationMinutes !== next.rainDurationMinutes;
  if (changed) state.weather = next;
  return changed;
}

export function setWeatherMode(state: GameState, mode: WorldWeather['mode'], nowEpochMs: number): void {
  state.weather = { ...(state.weather ?? automaticWeatherForDay(state.seed, nowEpochMs)), mode, raining: false };
  updateRealWeather(state, nowEpochMs);
}
