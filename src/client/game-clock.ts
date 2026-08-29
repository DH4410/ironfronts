import type { GameClockSync } from '@ironfronts/protocol';

const DAY_MS = 86_400_000;
const MAX_CORRECTION_RATE = 0.1;

export interface GameClockReading {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Fractional seconds allow the analogue second hand to move smoothly. */
  readonly second: number;
  readonly utcOffsetMinutes: number;
}

/**
 * Advances sparse server time locally at 1:1 wall-clock speed. A later sample
 * changes the target, never the displayed hand position: ordinary drift is
 * recovered at no more than 10% extra/slower speed and therefore cannot jump.
 */
export class InterpolatedGameClock {
  private initialized = false;
  private gameStartedAtEpochMs = 0;
  private utcOffsetMinutes = 120;
  private targetEpochMs = 0;
  private targetAtMonotonicMs = 0;
  private displayedEpochMs = 0;
  private displayedAtMonotonicMs = 0;

  constructor(private readonly monotonicNow: () => number = () => performance.now()) {}

  synchronize(sync: GameClockSync): void {
    const now = this.monotonicNow();
    if (this.initialized) this.advance(now);
    else {
      this.initialized = true;
      this.displayedEpochMs = sync.serverEpochMs;
      this.displayedAtMonotonicMs = now;
    }
    this.gameStartedAtEpochMs = sync.gameStartedAtEpochMs;
    this.utcOffsetMinutes = sync.utcOffsetMinutes;
    this.targetEpochMs = sync.serverEpochMs;
    this.targetAtMonotonicMs = now;
  }

  read(): GameClockReading {
    if (!this.initialized) throw new Error('The game clock has not been synchronized.');
    const epochMs = this.advance(this.monotonicNow());
    const offsetMs = this.utcOffsetMinutes * 60_000;
    const shiftedEpochMs = epochMs + offsetMs;
    const shiftedStartMs = this.gameStartedAtEpochMs + offsetMs;
    const date = new Date(shiftedEpochMs);
    return {
      day: Math.max(1, Math.floor(shiftedEpochMs / DAY_MS) - Math.floor(shiftedStartMs / DAY_MS) + 1),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds() + date.getUTCMilliseconds() / 1_000,
      utcOffsetMinutes: this.utcOffsetMinutes,
    };
  }

  private advance(now: number): number {
    const elapsed = Math.max(0, now - this.displayedAtMonotonicMs);
    const natural = this.displayedEpochMs + elapsed;
    const target = this.targetEpochMs + Math.max(0, now - this.targetAtMonotonicMs);
    const maxCorrection = elapsed * MAX_CORRECTION_RATE;
    const correction = Math.max(-maxCorrection, Math.min(maxCorrection, target - natural));
    this.displayedEpochMs = natural + correction;
    this.displayedAtMonotonicMs = now;
    return this.displayedEpochMs;
  }
}
