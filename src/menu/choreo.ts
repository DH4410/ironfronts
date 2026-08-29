/**
 * Drives a single clock (0..1, strictly linear in wall-clock time) over
 * `duration` ms via one rAF loop and calls `update(t)` every frame.
 *
 * The loop is deliberately fail-safe: if an update throws, or a browser drops
 * the animation callback for too long, the promise rejects instead of hanging
 * forever. Menu callers can then snap to the requested end state and restore
 * pointer events rather than leaving the UI permanently "busy".
 */
export function runChoreo(duration: number, direction: 1 | -1, update: (t: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const safeDuration = Math.max(1, duration);
    const start = performance.now();
    const from = direction === 1 ? 0 : 1;
    const to = direction === 1 ? 1 : 0;
    let settled = false;
    let raf = 0;

    const settle = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(watchdog);
      if (error) reject(error);
      else resolve();
    };

    const finishAtTarget = (): void => {
      try {
        update(to);
        settle();
      } catch (error) {
        settle(error);
      }
    };

    function frame(now: number): void {
      if (settled) return;
      try {
        const elapsed = Math.min(1, Math.max(0, (now - start) / safeDuration));
        update(from + (to - from) * elapsed);
        if (elapsed < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          settle();
        }
      } catch (error) {
        settle(error);
      }
    }

    // Browsers can occasionally starve rAF during devtools, tab restores, GPU
    // hiccups, or heavy decode work. Never let that strand the menu forever.
    const watchdog = window.setTimeout(finishAtTarget, safeDuration + 750);
    raf = requestAnimationFrame(frame);
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
