export const ROUTING_CACHE_VERSION = 'direct-dirt-roads-v7';
export const ROAD_WIDTH = 1.2;
export const ROAD_MAX_GRADE = 0.24;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const wrap = (value, size) => ((value % size) + size) % size;

export function smoothstep(a, b, value) {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function unwrapNear(x, reference, width) {
  while (x - reference > width * 0.5) x -= width;
  while (x - reference < -width * 0.5) x += width;
  return x;
}

export function sampleScalar(field, width, height, worldWidth, worldHeight, x, z) {
  const px = wrap(Math.floor(wrap(x, worldWidth) / worldWidth * width), width);
  const py = clamp(Math.floor(z / worldHeight * height), 0, height - 1);
  return field[py * width + px] ?? 0;
}

export function sampleHeight(field, width, height, worldWidth, worldHeight, x, z) {
  const fx = wrap(x, worldWidth) / worldWidth * width - 0.5;
  const fz = clamp(z / worldHeight * height - 0.5, 0, height - 1);
  const x0Raw = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0Raw;
  const tz = fz - z0;
  const x0 = wrap(x0Raw, width);
  const x1 = wrap(x0 + 1, width);
  const z1 = Math.min(height - 1, z0 + 1);
  const top = field[z0 * width + x0] * (1 - tx) + field[z0 * width + x1] * tx;
  const bottom = field[z1 * width + x0] * (1 - tx) + field[z1 * width + x1] * tx;
  return top * (1 - tz) + bottom * tz;
}
