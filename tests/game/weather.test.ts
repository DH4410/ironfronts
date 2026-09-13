import { describe, expect, it } from 'vitest';
import { automaticWeatherForDay, setWeatherMode, updateRealWeather } from '../../src/game/weather';
import { fixture } from '../helpers/simulation';

describe('persistent real-time weather', () => {
  it('generates one stable 1–2 hour rain window per UTC day', () => {
    const noon = Date.UTC(2026, 8, 14, 12);
    const first = automaticWeatherForDay(42, noon);
    const again = automaticWeatherForDay(42, noon + 3_600_000);
    expect(again).toEqual(first);
    expect(first.rainDurationMinutes).toBeGreaterThanOrEqual(60);
    expect(first.rainDurationMinutes).toBeLessThanOrEqual(120);
    expect(first.rainStartMinute + first.rainDurationMinutes).toBeLessThanOrEqual(1_440);
  });

  it('reconciles after downtime and honors persistent debug overrides', () => {
    const state = fixture().state;
    const day = Date.UTC(2026, 8, 14);
    const schedule = automaticWeatherForDay(state.seed, day);
    const duringRain = day + (schedule.rainStartMinute + 1) * 60_000;
    expect(updateRealWeather(state, duringRain)).toBe(true);
    expect(state.weather?.raining).toBe(true);
    setWeatherMode(state, 'forced-clear', duringRain);
    expect(state.weather).toMatchObject({ mode: 'forced-clear', raining: false });
    setWeatherMode(state, 'forced-rain', day);
    expect(state.weather).toMatchObject({ mode: 'forced-rain', raining: true });
  });
});
