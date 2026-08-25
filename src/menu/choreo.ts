/**
 * Drives a single clock (0..1, strictly linear in wall-clock time) over
 * `duration` ms via one rAF loop and calls `update(t)` every frame. All
 * dossier-open sub-motions read from this same `t` and ease themselves
 * locally within their own phase window (see `phase`/`smooth`), so the
 * choreography stays on one timeline instead of independently-timed CSS
 * transitions, and motion stays visible across the whole duration instead
 * of front-loading into a global ease-out.
 */
export function runChoreo(duration: number, direction: 1 | -1, update: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const from = direction === 1 ? 0 : 1;
    const to = direction === 1 ? 1 : 0;
    function frame(now: number): void {
      const elapsed = Math.min(1, (now - start) / duration);
      update(from + (to - from) * elapsed);
      if (elapsed < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Maps global t into a local 0..1 progress within [start, end]. */
export function phase(t: number, start: number, end: number): number {
  return clamp01((t - start) / (end - start));
}

/** Ease-in-out smoothstep, applied locally within a phase window. */
export function smooth(p: number): number {
  return p * p * (3 - 2 * p);
}
