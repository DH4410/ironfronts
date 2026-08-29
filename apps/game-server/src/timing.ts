/** Existing authoritative gameplay cadence: ten fixed simulation steps/sec. */
export const SIMULATION_INTERVAL_MS = 100;
/** Existing gameplay delta per step. Movement/economy balance depends on it. */
export const SIMULATION_TICK_HOURS = 0.5 / 10;

/** Civil-clock corrections are sparse; interpolation happens in the browser. */
export const CLOCK_SYNC_INTERVAL_MS = 60_000;
