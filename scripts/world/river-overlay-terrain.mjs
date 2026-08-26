import { distanceToValue, smoothstep, wrap } from './raster.mjs';

export const RIVER_CARVE_DEPTH = 0.35;
export const RIVER_CARVE_FADE = 14;

const SEARCH_DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function channelOverlapsCell(movementMask, visualMask, maskWidth, maskHeight, x, y, width, height) {
  const minX = Math.floor(x / width * maskWidth);
  const maxX = Math.min(maskWidth - 1, Math.ceil((x + 1) / width * maskWidth) - 1);
  const minY = Math.floor(y / height * maskHeight);
  const maxY = Math.min(maskHeight - 1, Math.ceil((y + 1) / height * maskHeight) - 1);
  for (let maskY = minY; maskY <= maxY; maskY += 1) {
    for (let maskX = minX; maskX <= maxX; maskX += 1) {
      const index = maskY * maskWidth + maskX;
      if (movementMask[index] > 127 || visualMask[index] > 127) return true;
    }
  }
  return false;
}

function nearestLandIndex(landField, width, height, x, y, maximumRadius = 32) {
  for (let radius = 1; radius <= maximumRadius; radius += 1) {
    for (const [dx, dy] of SEARCH_DIRECTIONS) {
      const sampleY = y + dy * radius;
      if (sampleY < 0 || sampleY >= height) continue;
      const sampleX = wrap(x + dx * radius, width);
      const index = sampleY * width + sampleX;
      if (landField[index]) return index;
    }
  }
  return -1;
}

export function promoteRiverChannelsToTerrain({
  landField, terrainField, biomeField, provinceField, reliefField,
  width, height, movementMask, visualMask, maskWidth, maskHeight,
}) {
  const terrainLandField = landField.slice();
  let restoredCells = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (landField[index]) continue;
      if (!channelOverlapsCell(movementMask, visualMask, maskWidth, maskHeight, x, y, width, height)) continue;
      const source = nearestLandIndex(landField, width, height, x, y);
      if (source < 0) continue;
      terrainLandField[index] = 1;
      terrainField[index] = terrainField[source];
      biomeField[index] = biomeField[source];
      provinceField[index] = provinceField[source];
      reliefField[index] = reliefField[source];
      restoredCells += 1;
    }
  }
  return { terrainLandField, restoredCells };
}

export function buildTerrainTopology(provinceIds, movementMask, visualMask) {
  const topology = new Uint8Array(provinceIds.length);
  for (let index = 0; index < topology.length; index += 1) {
    topology[index] = provinceIds[index] !== 0 || movementMask[index] > 127 || visualMask[index] > 127 ? 1 : 0;
  }
  return topology;
}

export function carveRiverTerrain({
  heights, landField, width, height, worldWidth, worldHeight,
  movementMask, visualMask, maskWidth, maskHeight,
}) {
  const channel = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (landField[index] && channelOverlapsCell(
        movementMask, visualMask, maskWidth, maskHeight, x, y, width, height,
      )) channel[index] = 1;
    }
  }

  const distance = distanceToValue(channel, width, height, 1);
  const texelSize = (worldWidth / width + worldHeight / height) * 0.5;
  let adjustedCells = 0;
  let totalCut = 0;
  for (let index = 0; index < heights.length; index += 1) {
    if (!landField[index]) continue;
    const distanceWorld = distance[index] * texelSize;
    if (distanceWorld >= RIVER_CARVE_FADE) continue;
    const cut = RIVER_CARVE_DEPTH * (1 - smoothstep(0, RIVER_CARVE_FADE, distanceWorld));
    const next = Math.max(1.2, heights[index] - cut);
    const applied = heights[index] - next;
    if (applied <= 0.0001) continue;
    heights[index] = next;
    adjustedCells += 1;
    totalCut += applied;
  }
  return {
    method: 'shallow lower-only river channel with a short bank fade',
    depth: RIVER_CARVE_DEPTH,
    fadeDistance: RIVER_CARVE_FADE,
    adjustedCells,
    meanCut: totalCut / Math.max(1, adjustedCells),
  };
}
