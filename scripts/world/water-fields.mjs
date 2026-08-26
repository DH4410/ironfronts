import { blurField, clamp, distanceToValue } from './raster.mjs';

// The province raster remains the authoritative topology. This presentation
// field turns its hard boundary into a signed, linearly filterable coastline
// without the channel-closing behavior of a blur.
export function buildBankField(provinceIds, width, height, worldWidth, worldHeight, landOverride, riverMask) {
  const land = new Float32Array(provinceIds.length);
  for (let index = 0; index < provinceIds.length; index += 1) {
    land[index] = landOverride ? Number(landOverride[index] > 0) : provinceIds[index] === 0 ? 0 : 1;
  }
  const distanceToWater = distanceToValue(land, width, height, 0);
  const distanceToLand = distanceToValue(land, width, height, 1);
  const texelSize = (worldWidth / width + worldHeight / height) * 0.5;
  const edgeHalfWidth = texelSize * 1.15;
  const bankRange = 22;
  const signedDistance = new Float32Array(land.length);
  for (let index = 0; index < land.length; index += 1) {
    signedDistance[index] = (distanceToWater[index] - distanceToLand[index]) * texelSize;
  }
  const smoothedDistance = blurField(signedDistance, width, height, 1, 2);
  const field = new Uint8Array(width * height * 2);
  let bankPixels = 0;
  let riverBankPixels = 0;
  const distanceToRiver = riverMask ? distanceToValue(riverMask, width, height, 1) : null;
  for (let index = 0; index < land.length; index += 1) {
    // Smoothing alters contour position but may never flip an authoritative
    // land/water cell, so even one-cell-wide visual channels survive.
    const topologyFloor = texelSize * 0.06;
    const safeDistance = land[index]
      ? Math.max(topologyFloor, smoothedDistance[index])
      : Math.min(-topologyFloor, smoothedDistance[index]);
    const coverage = clamp(0.5 + safeDistance / (edgeHalfWidth * 2), 0, 1);
    const coastProximity = 1 - clamp(Math.abs(safeDistance) / bankRange, 0, 1);
    const riverProximity = distanceToRiver
      ? 1 - clamp(distanceToRiver[index] * texelSize / bankRange, 0, 1)
      : 0;
    const proximity = Math.max(coastProximity, riverProximity);
    field[index * 2] = Math.round(coverage * 255);
    field[index * 2 + 1] = Math.round(proximity * 255);
    if (proximity > 0) bankPixels += 1;
    if (riverProximity > 0) riverBankPixels += 1;
  }
  return {
    field,
    report: {
      method: 'topology-preserving-smoothed-signed-distance with river-bank fade',
      smoothingPasses: 2, texelSize, edgeHalfWidth, bankRange, bankPixels, riverBankPixels,
    },
  };
}
