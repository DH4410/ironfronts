import { describe, expect, it } from 'vitest';
import { resolvePrimaryClick } from '../src/picking';

describe('resolvePrimaryClick', () => {
  it('selects the province under a normal left-click', () => {
    expect(resolvePrimaryClick(7)).toEqual({ kind: 'select', encodedProvinceId: 7 });
  });

  it('clears the selection when the click misses any province', () => {
    expect(resolvePrimaryClick(0)).toEqual({ kind: 'clear-selection' });
  });

  it('never resolves a primary click to an ownership mutation', () => {
    for (const encodedId of [0, 1, 42, 999]) {
      const action = resolvePrimaryClick(encodedId);
      expect(['select', 'clear-selection']).toContain(action.kind);
    }
  });
});
