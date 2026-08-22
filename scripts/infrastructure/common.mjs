export const TAU = Math.PI * 2;
export const ROUTING_CACHE_VERSION = 'hierarchical-roads-v4.4';
export const AUDIT_VERSION = 'infrastructure-audit-v4.0';
export const MAX_AUDIT_PASSES = 12;
export const LEVEL_WIDTHS = [1.5, 2.2, 3.4, 4.8, 8.4];
export const ROLE_WIDTH_SCALE = [0.8, 1.0, 1.2];
export const MAX_GRADES = [0.18, 0.14, 0.10, 0.08, 0.06];
export const CUT_FILL_LIMITS = [1.5, 2.5, 4.0, 6.0, 8.0];
export const TUNNEL_MAX_LENGTHS = [45, 45, 90, 160, 240];
export const ROLE_LOCAL = 0;
export const ROLE_CONNECTOR = 1;
export const ROLE_TRUNK = 2;

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

export function routeRoadWidth(route) {
  const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
  return route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
    : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
}

export function intervalAt(route, segmentIndex, key) {
  return (route[key] ?? []).find((interval) => segmentIndex >= interval.start && segmentIndex < interval.end);
}
