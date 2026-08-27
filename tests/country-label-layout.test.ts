import { describe, expect, it } from 'vitest';
import type { CountryLabelGlyph } from '../src/country-labels/atlas';
import {
  LABEL_GLYPH_STRIDE, LABEL_TERRAIN_HEIGHT_OFFSET, layoutCountryLabel,
  layoutCountryLabelWithinTerritory, MAX_LABEL_WORLD_HEIGHT, MAX_LABEL_WORLD_WIDTH,
  placeCountryLabelOnTerrain, type CountryLabelMetrics,
} from '../src/country-labels/layout';
import type { CountryAnchor } from '../src/country-labels/topology';
import { isValidCountryLabelPoint } from '../src/country-labels/territory';

const glyph: CountryLabelGlyph = {
  u0: 0,
  v0: 0,
  u1: 1,
  v1: 1,
  advanceAtMeasurementSize: 10,
  widthAtMeasurementSize: 12,
  heightAtMeasurementSize: 20,
  inkWidthAtMeasurementSize: 10,
  inkHeightAtMeasurementSize: 14,
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
  it('allows internal river channels but rejects open water and foreign provinces', () => {
    const owners = new Uint32Array([0, 7, 9]);
    expect(isValidCountryLabelPoint(7, 0, true, owners)).toBe(true);
    expect(isValidCountryLabelPoint(7, 0, false, owners)).toBe(false);
    expect(isValidCountryLabelPoint(7, 1, true, owners)).toBe(true);
    expect(isValidCountryLabelPoint(7, 2, true, owners)).toBe(false);
  });

  it('emits one world-space record per visible glyph', () => {
    const data = layoutCountryLabel('ABC DEF', anchor(), metrics);
    expect(data.length).toBe(6 * LABEL_GLYPH_STRIDE);
    expect(data.every(Number.isFinite)).toBe(true);
    expect(data[10]).toBeGreaterThan(0);
  });

  it('caps a huge country label at the map-space size ceiling instead of scaling with span', () => {
    const huge = layoutCountryLabel('ABCDEF', anchor({ span: 20_000, crossSpan: 10_000 }), metrics);
    for (let offset = 0; offset < huge.length; offset += LABEL_GLYPH_STRIDE) {
      expect(huge[offset + 5]).toBeLessThanOrEqual(MAX_LABEL_WORLD_HEIGHT + 1e-6);
    }
    // Height cap binds first for a short name: glyph height sits right at the ceiling.
    expect(huge[5]).toBeCloseTo(MAX_LABEL_WORLD_HEIGHT);
  });

  it('caps total label width for a long name in a wide country', () => {
    const name = 'A'.repeat(40);
    const wide = layoutCountryLabel(name, anchor({ span: 40_000, crossSpan: 20_000 }), metrics);
    const scale = wide[5] / glyph.heightAtMeasurementSize;
    const labelWidth = metrics.measureLabel(name) * scale;
    expect(labelWidth).toBeLessThanOrEqual(MAX_LABEL_WORLD_WIDTH + 1e-6);
  });

  it('leaves labels that already fit well within the cap untouched', () => {
    const before = layoutCountryLabel('ABC', anchor({ span: 900, crossSpan: 400 }), metrics);
    expect(before[5]).toBeLessThan(MAX_LABEL_WORLD_HEIGHT);
    // Territory sizing, not the cap, is what set this size.
    const scale = before[5] / glyph.heightAtMeasurementSize;
    expect(scale).toBeCloseTo(Math.min((900 * 0.7) / (3 * 10), (400 * 0.5) / 20));
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

  it('can reverse or remove its bend without changing text size', () => {
    const downward = layoutCountryLabel('ABCDEF', anchor(), metrics, 1, 1);
    const upward = layoutCountryLabel('ABCDEF', anchor(), metrics, 1, -1);
    const straight = layoutCountryLabel('ABCDEF', anchor(), metrics, 1, 0);
    expect(downward[3 * LABEL_GLYPH_STRIDE + 1]).toBeLessThan(300);
    expect(upward[3 * LABEL_GLYPH_STRIDE + 1]).toBeGreaterThan(300);
    expect(straight[3 * LABEL_GLYPH_STRIDE + 1]).toBeCloseTo(300);
    expect(upward[4]).toBeCloseTo(downward[4]);
  });

  it('keeps its placement entirely independent of a camera', () => {
    const first = layoutCountryLabel('NORTHLAND', anchor({ axisX: 0.8, axisZ: 0.6 }), metrics);
    const second = layoutCountryLabel('NORTHLAND', anchor({ axisX: 0.8, axisZ: 0.6 }), metrics);
    expect(second).toEqual(first);
  });

  it('places each glyph just above its own highest terrain sample', () => {
    const layout = layoutCountryLabel('AB', anchor({ span: 100, crossSpan: 40 }), metrics);
    const placed = placeCountryLabelOnTerrain(
      layout,
      (x) => x < 502 ? 12 : 37,
      2,
    );
    expect(placed[10]).toBeCloseTo(12 + LABEL_TERRAIN_HEIGHT_OFFSET);
    expect(placed[LABEL_GLYPH_STRIDE + 10]).toBeCloseTo(37 + LABEL_TERRAIN_HEIGHT_OFFSET);
  });

  it('moves and scales a label until all glyphs fit owned land', () => {
    const data = layoutCountryLabelWithinTerritory(
      'ABCDEF',
      anchor(),
      metrics,
      [{ x: 500, z: 300 }, { x: 100, z: 100 }],
      (x, z) => x >= 0 && x <= 200 && z >= 0 && z <= 200,
    );
    expect(data.length).toBe(6 * LABEL_GLYPH_STRIDE);
    expect(data[0]).toBeLessThan(200);
    expect(data[4]).toBeLessThan(glyph.widthAtMeasurementSize * 10);
  });

  it('omits a label when no owned placement exists', () => {
    const data = layoutCountryLabelWithinTerritory(
      'ABCDEF', anchor(), metrics, [{ x: 500, z: 300 }], () => false,
    );
    expect(data).toHaveLength(0);
  });
});
