import type { CountryLabelGlyph } from './atlas';
import type { CountryAnchor } from './topology';

export const LABEL_GLYPH_STRIDE = 12;
export const LABEL_TERRAIN_HEIGHT_OFFSET = 0.6;

export interface CountryLabelMetrics {
  readonly lineHeightAtMeasurementSize: number;
  readonly trackingAtMeasurementSize: number;
  getGlyph(character: string): CountryLabelGlyph | undefined;
  getAdvance(character: string): number;
  measureLabel(label: string): number;
}

export interface CountryLabelCandidate {
  x: number;
  z: number;
}

/** Builds camera-independent glyph quads along a stable, gently curved map-space baseline. */
export function layoutCountryLabel(
  name: string,
  anchor: CountryAnchor,
  atlas: CountryLabelMetrics,
  sizeMultiplier = 1,
  curveDirection = 1,
): Float32Array {
  const label = name.toLocaleUpperCase();
  const measuredWidth = atlas.measureLabel(label);
  if (measuredWidth <= 0 || anchor.span <= 0 || anchor.crossSpan <= 0) return new Float32Array(0);

  const availableWidth = anchor.span * 0.7;
  const availableHeight = anchor.crossSpan * 0.5;
  const scale = Math.min(
    availableWidth / measuredWidth,
    availableHeight / atlas.lineHeightAtMeasurementSize,
  ) * sizeMultiplier;
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
    const crossOffset = -4 * curvature * curveDirection * t * (1 - t);
    const crossSlope = labelWidth > 0 ? -4 * curvature * curveDirection * (1 - 2 * t) / labelWidth : 0;
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
        glyph.inkWidthAtMeasurementSize * scale,
        glyph.inkHeightAtMeasurementSize * scale,
      );
    }
    pen += advance;
    if (index + 1 < characters.length) pen += atlas.trackingAtMeasurementSize * scale;
  }
  return new Float32Array(values);
}

/** Chooses the largest layout whose visible glyph area stays entirely on owned land. */
export function layoutCountryLabelWithinTerritory(
  name: string,
  anchor: CountryAnchor,
  atlas: CountryLabelMetrics,
  candidates: CountryLabelCandidate[],
  ownsPoint: (x: number, z: number) => boolean,
  sampleSpacing = 8,
): Float32Array {
  const sizeSteps = [1, 0.88, 0.76, 0.64, 0.52, 0.42, 0.34, 0.27, 0.21, 0.16, 0.12];
  const nudge = sampleSpacing * 2;
  const localNudges = [
    [0, 0], [nudge, 0], [-nudge, 0], [0, nudge], [0, -nudge],
    [nudge, nudge], [nudge, -nudge], [-nudge, nudge], [-nudge, -nudge],
  ] as const;
  const crossX = -anchor.axisZ;
  const crossZ = anchor.axisX;
  for (const size of sizeSteps) {
    for (const candidate of candidates) {
      for (const [along, across] of localNudges) {
        const x = candidate.x + anchor.axisX * along + crossX * across;
        const z = candidate.z + anchor.axisZ * along + crossZ * across;
        // Available space is often asymmetric around the dominant axis. Try
        // both bows and a straight baseline before shrinking the name.
        for (const curveDirection of [1, -1, 0]) {
          const data = layoutCountryLabel(name, { ...anchor, x, z }, atlas, size, curveDirection);
          if (data.length && glyphsStayWithinTerritory(data, ownsPoint, sampleSpacing)) return data;
        }
      }
    }
  }
  return new Float32Array(0);
}

/**
 * Replaces the layout-only ink bounds with a render elevation for each glyph.
 * Every letter gets its own flat plane at the highest terrain sample beneath
 * its visible ink, keeping long labels close to the landscape without letting
 * a ridge pass through a character.
 */
export function placeCountryLabelOnTerrain(
  data: Float32Array,
  sampleHeight: (x: number, z: number) => number,
  sampleSpacing: number,
): Float32Array {
  const placed = data.slice();
  const spacing = Math.max(0.01, sampleSpacing);
  for (let offset = 0; offset < placed.length; offset += LABEL_GLYPH_STRIDE) {
    const centerX = placed[offset];
    const centerZ = placed[offset + 1];
    const tangentX = placed[offset + 2];
    const tangentZ = placed[offset + 3];
    const inkWidth = placed[offset + 10];
    const inkHeight = placed[offset + 11];
    const crossX = -tangentZ;
    const crossZ = tangentX;
    const alongSamples = Math.max(2, Math.ceil(inkWidth / spacing) + 1);
    const acrossSamples = Math.max(2, Math.ceil(inkHeight / spacing) + 1);
    let maximumHeight = -Infinity;
    for (let alongIndex = 0; alongIndex < alongSamples; alongIndex += 1) {
      const along = -0.5 + alongIndex / (alongSamples - 1);
      for (let acrossIndex = 0; acrossIndex < acrossSamples; acrossIndex += 1) {
        const across = -0.5 + acrossIndex / (acrossSamples - 1);
        maximumHeight = Math.max(maximumHeight, sampleHeight(
          centerX + tangentX * inkWidth * along + crossX * inkHeight * across,
          centerZ + tangentZ * inkWidth * along + crossZ * inkHeight * across,
        ));
      }
    }
    // These two values were only needed while validating the layout. The GPU
    // uses c.z for the per-letter elevation and leaves c.w reserved.
    placed[offset + 10] = (Number.isFinite(maximumHeight) ? maximumHeight : 0)
      + LABEL_TERRAIN_HEIGHT_OFFSET;
    placed[offset + 11] = 0;
  }
  return placed;
}

function glyphsStayWithinTerritory(
  data: Float32Array,
  ownsPoint: (x: number, z: number) => boolean,
  sampleSpacing: number,
): boolean {
  for (let offset = 0; offset < data.length; offset += LABEL_GLYPH_STRIDE) {
    const centerX = data[offset];
    const centerZ = data[offset + 1];
    const tangentX = data[offset + 2];
    const tangentZ = data[offset + 3];
    const width = data[offset + 10];
    const height = data[offset + 11];
    const crossX = -tangentZ;
    const crossZ = tangentX;
    const alongSamples = Math.max(3, Math.ceil(width / sampleSpacing) + 1);
    const acrossSamples = Math.max(3, Math.ceil(height / sampleSpacing) + 1);
    for (let alongIndex = 0; alongIndex < alongSamples; alongIndex += 1) {
      const along = -0.5 + alongIndex / (alongSamples - 1);
      for (let acrossIndex = 0; acrossIndex < acrossSamples; acrossIndex += 1) {
        const across = -0.5 + acrossIndex / (acrossSamples - 1);
        const x = centerX + tangentX * width * along + crossX * height * across;
        const z = centerZ + tangentZ * width * along + crossZ * height * across;
        if (!ownsPoint(x, z)) return false;
      }
    }
  }
  return true;
}
