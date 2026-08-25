import type { CountryLabelGlyph } from './atlas';
import type { CountryAnchor } from './topology';

export const LABEL_GLYPH_STRIDE = 12;

export interface CountryLabelMetrics {
  readonly lineHeightAtMeasurementSize: number;
  readonly trackingAtMeasurementSize: number;
  getGlyph(character: string): CountryLabelGlyph | undefined;
  getAdvance(character: string): number;
  measureLabel(label: string): number;
}

/** Builds camera-independent glyph quads along a stable, gently curved map-space baseline. */
export function layoutCountryLabel(
  name: string,
  anchor: CountryAnchor,
  atlas: CountryLabelMetrics,
): Float32Array {
  const label = name.toLocaleUpperCase();
  const measuredWidth = atlas.measureLabel(label);
  if (measuredWidth <= 0 || anchor.span <= 0 || anchor.crossSpan <= 0) return new Float32Array(0);

  const availableWidth = anchor.span * 0.7;
  const availableHeight = anchor.crossSpan * 0.5;
  const scale = Math.min(
    availableWidth / measuredWidth,
    availableHeight / atlas.lineHeightAtMeasurementSize,
  );
  if (!Number.isFinite(scale) || scale <= 0) return new Float32Array(0);

  const labelWidth = measuredWidth * scale;
  const labelHeight = atlas.lineHeightAtMeasurementSize * scale;
  const spareHeight = Math.max(0, availableHeight - labelHeight);
  const visibleCharacters = [...label].filter((character) => character.trim().length > 0).length;
  const curvature = visibleCharacters >= 6
    ? Math.min(labelWidth * 0.065, spareHeight * 0.7)
    : 0;
  const crossX = -anchor.axisZ;
  const crossZ = anchor.axisX;
  const values: number[] = [];
  let pen = -labelWidth * 0.5;
  const characters = [...label];

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const advance = atlas.getAdvance(character) * scale;
    const centerDistance = pen + advance * 0.5;
    const t = labelWidth > 0 ? Math.min(1, Math.max(0, centerDistance / labelWidth + 0.5)) : 0.5;
    const crossOffset = -4 * curvature * t * (1 - t);
    const crossSlope = labelWidth > 0 ? -4 * curvature * (1 - 2 * t) / labelWidth : 0;
    const tangentLength = Math.hypot(
      anchor.axisX + crossX * crossSlope,
      anchor.axisZ + crossZ * crossSlope,
    );
    const tangentX = (anchor.axisX + crossX * crossSlope) / tangentLength;
    const tangentZ = (anchor.axisZ + crossZ * crossSlope) / tangentLength;
    const glyph = atlas.getGlyph(character);
    if (glyph) {
      values.push(
        anchor.x + anchor.axisX * centerDistance + crossX * crossOffset,
        anchor.z + anchor.axisZ * centerDistance + crossZ * crossOffset,
        tangentX,
        tangentZ,
        glyph.widthAtMeasurementSize * scale,
        glyph.heightAtMeasurementSize * scale,
        glyph.u0,
        glyph.v0,
        glyph.u1,
        glyph.v1,
        anchor.countryId,
        0,
      );
    }
    pen += advance;
    if (index + 1 < characters.length) pen += atlas.trackingAtMeasurementSize * scale;
  }
  return new Float32Array(values);
}
