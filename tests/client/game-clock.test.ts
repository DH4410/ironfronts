import { describe, expect, it } from 'vitest';
import { InterpolatedGameClock } from '../../src/client/game-clock';
import { AuthoritativeGameClock, GAME_UTC_OFFSET_MINUTES } from '../../apps/game-server/src/game-clock';
import { CLOCK_SYNC_INTERVAL_MS, SIMULATION_INTERVAL_MS, SIMULATION_TICK_HOURS } from '../../apps/game-server/src/timing';

describe('authoritative civil clock', () => {
  it('preserves the existing gameplay tick rate and simulation delta', () => {
    expect(SIMULATION_INTERVAL_MS).toBe(100);
    expect(SIMULATION_TICK_HOURS).toBe(0.05);
    expect(CLOCK_SYNC_INTERVAL_MS).toBe(60_000);
  });

  it('publishes a fixed GMT+2 sample without coupling it to simulation time', () => {
    const startedAt = Date.UTC(2026, 0, 1, 10, 0, 0);
    const clock = new AuthoritativeGameClock(startedAt);
    expect(clock.snapshot(startedAt + 60_000)).toEqual({
      gameStartedAtEpochMs: startedAt,
      serverEpochMs: startedAt + 60_000,
      utcOffsetMinutes: GAME_UTC_OFFSET_MINUTES,
    });
  });

  it('advances one game second per real second and rolls the campaign day at GMT+2 midnight', () => {
    let monotonic = 0;
    const clock = new InterpolatedGameClock(() => monotonic);
    const startedAt = Date.UTC(2026, 0, 1, 21, 59, 59);
    clock.synchronize({ gameStartedAtEpochMs: startedAt, serverEpochMs: startedAt, utcOffsetMinutes: 120 });
    expect(clock.read()).toMatchObject({ day: 1, hour: 23, minute: 59, second: 59 });

    monotonic = 2_000;
    expect(clock.read()).toMatchObject({ day: 2, hour: 0, minute: 0, second: 1 });
  });

  it('recovers correction differences gradually instead of jumping the hands', () => {
    let monotonic = 0;
    const clock = new InterpolatedGameClock(() => monotonic);
    const startedAt = Date.UTC(2026, 0, 1, 10, 0, 0);
    clock.synchronize({ gameStartedAtEpochMs: startedAt, serverEpochMs: startedAt, utcOffsetMinutes: 120 });

    monotonic = 10_000;
    expect(clock.read().second).toBe(10);
    clock.synchronize({
      gameStartedAtEpochMs: startedAt,
      serverEpochMs: startedAt + 12_000,
      utcOffsetMinutes: 120,
    });
    expect(clock.read().second).toBe(10);

    monotonic = 11_000;
    expect(clock.read().second).toBeCloseTo(11.1, 5);
  });
});
