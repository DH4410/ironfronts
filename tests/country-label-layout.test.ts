import { describe, expect, it } from 'vitest';
import type { CountryLabelGlyph } from '../src/country-labels/atlas';
import { LABEL_GLYPH_STRIDE, layoutCountryLabel, type CountryLabelMetrics } from '../src/country-labels/layout';
import type { CountryAnchor } from '../src/country-labels/topology';

const glyph: CountryLabelGlyph = {
  u0: 0,
  v0: 0,
  u1: 1,
  v1: 1,
  advanceAtMeasurementSize: 10,
  widthAtMeasurementSize: 12,
  heightAtMeasurementSize: 20,
};
const metrics: CountryLabelMetrics = {
  lineHeightAtMeasurementSize: 20,
  trackingAtMeasurementSize: 0,
  getGlyph: (character) => character === ' ' ? undefined : glyph,
  getAdvance: () => 10,
  measureLabel: (label) => label.length * 10,
};

function anchor(overrides: Partial<CountryAnchor> = {}): CountryAnchor {
  return { countryId: 1, x: 500, z: 300, axisX: 1, axisZ: 0, span: 1_000, crossSpan: 500, ...overrides };
}

describe('country label layout', () => {
  it('emits one world-space record per visible glyph', () => {
    const data = layoutCountryLabel('ABC DEF', anchor(), metrics);
    expect(data.length).toBe(6 * LABEL_GLYPH_STRIDE);
    expect(data.every(Number.isFinite)).toBe(true);
    expect(data[10]).toBe(1);
  });

  it('adds a gentle curve only when the country has spare cross-axis room', () => {
    const curved = layoutCountryLabel('ABCDEF', anchor(), metrics);
    const flat = layoutCountryLabel('ABCDEF', anchor({ crossSpan: 40 }), metrics);
    const firstZ = curved[1];
    const middleZ = curved[3 * LABEL_GLYPH_STRIDE + 1];
    expect(middleZ).toBeLessThan(firstZ);
    for (let offset = 1; offset < flat.length; offset += LABEL_GLYPH_STRIDE) {
      expect(flat[offset]).toBeCloseTo(300);
    }
  });

  it('keeps its placement entirely independent of a camera', () => {
    const first = layoutCountryLabel('NORTHLAND', anchor({ axisX: 0.8, axisZ: 0.6 }), metrics);
    const second = layoutCountryLabel('NORTHLAND', anchor({ axisX: 0.8, axisZ: 0.6 }), metrics);
    expect(second).toEqual(first);
  });
});
