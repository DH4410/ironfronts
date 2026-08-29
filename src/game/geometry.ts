/**
 * Wrapped-X world geometry helpers for the game layer.
 *
 * The world map wraps horizontally (see renderer `wrap()` / `WORLD_COPY_INDICES`).
 * Every gameplay distance — vision, merge/snap radius, path cost — MUST use the
 * shorter of the two X directions, never a raw `Math.hypot`. Z does not wrap.
 *
 * This module has no dependencies: it is safe to import from anywhere in
 * `src/game/**` and from tests.
 */

export interface WorldExtent {
  readonly width: number;
  readonly height: number;
}

/** Signed shortest delta a->b along the wrapping X axis, in [-width/2, width/2]. */
export function wrappedDeltaX(ax: number, bx: number, width: number): number {
  let dx = bx - ax;
  const half = width / 2;
  if (dx > half) dx -= width;
  else if (dx < -half) dx += width;
  return dx;
}

/** Normalise an X coordinate into [0, width). */
export function wrapX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

/** Euclidean distance using the shorter X path. Z is treated linearly. */
export function wrappedDistance(
  ax: number, az: number, bx: number, bz: number, width: number,
): number {
  const dx = wrappedDeltaX(ax, bx, width);
  const dz = bz - az;
  return Math.hypot(dx, dz);
}

/** Squared wrapped distance — cheaper for nearest-of comparisons. */
export function wrappedDistanceSq(
  ax: number, az: number, bx: number, bz: number, width: number,
): number {
  const dx = wrappedDeltaX(ax, bx, width);
  const dz = bz - az;
  return dx * dx + dz * dz;
}
