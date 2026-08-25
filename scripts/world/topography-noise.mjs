import { SEED } from './config.mjs';
import { clamp, wrap } from './raster.mjs';

function hash2(x, y, seed = SEED) {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x27d4eb2d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 0xffffffff;
}

export function periodicTopographyNoise(u, v, cellsX, cellsY) {
  const x = u * cellsX, y = v * cellsY;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const sample = (px, py) => hash2(wrap(px, cellsX), clamp(py, 0, cellsY));
  const top = sample(x0, y0) * (1 - sx) + sample(x0 + 1, y0) * sx;
  const bottom = sample(x0, y0 + 1) * (1 - sx) + sample(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

export function topographyFbm(u, v) {
  let value = 0, amplitude = 0.56, normalization = 0;
  for (const [x, y] of [[9, 5], [19, 10], [37, 19], [73, 37]]) {
    value += periodicTopographyNoise(u, v, x, y) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
  }
  return value / normalization;
}

export function terrainHeightLimit(terrain, hillEnvelope, mountainEnvelope, regionalMountain) {
  const base = terrain === 1 ? 18 : terrain === 2 ? 60 : 8;
  return clamp(Math.max(base,
    8 + hillEnvelope * 10 + mountainEnvelope * 44 + regionalMountain * 8), 8, 60);
}

export function terrainSlopeLimit(hillEnvelope, mountainEnvelope) {
  return 0.65 + hillEnvelope * 0.50 + mountainEnvelope * 0.85;
}
