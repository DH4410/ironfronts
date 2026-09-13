import { describe, expect, it } from 'vitest';
import { MAX_SIM_SPEED, MIN_SIM_SPEED, clampSimSpeed } from '../../apps/game-server/src/timing';

describe('clampSimSpeed', () => {
  it('keeps every in-range unified multiplier as-is', () => {
    expect(clampSimSpeed(1)).toBe(1);
    expect(clampSimSpeed(100)).toBe(100);
    expect(clampSimSpeed(10_000)).toBe(10_000);
  });

  it('clamps out-of-range requests to the bounds', () => {
    expect(clampSimSpeed(-5)).toBe(MIN_SIM_SPEED);
    expect(clampSimSpeed(99_999)).toBe(MAX_SIM_SPEED);
  });

  it('falls back to 1 for a non-finite request', () => {
    expect(clampSimSpeed(Number.NaN)).toBe(1);
    expect(clampSimSpeed(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
