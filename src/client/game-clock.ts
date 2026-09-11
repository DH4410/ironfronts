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
 * Advances sparse server time locally at the authoritative simulation speed. A later sample
 * changes the target, never the displayed hand position: ordinary drift is
 * recovered at no more than 10% extra/slower speed and therefore cannot jump.
 */
export class InterpolatedGameClock {
  private initialized = false;
  private speed = 1;
  private generation = -1;
  private fresh = true;
  private gameStartedAtEpochMs = 0;
  private utcOffsetMinutes = 120;
  private targetEpochMs = 0;
  private targetAtMonotonicMs = 0;
  private displayedEpochMs = 0;
  private displayedAtMonotonicMs = 0;

  constructor(private readonly monotonicNow: () => number = () => performance.now()) {}

  synchronize(sync: GameClockSync): void {
    const now = this.monotonicNow();
    if (this.initialized && this.generation === sync.generation && this.fresh && sync.speed === this.speed) this.advance(now);
    else {
      this.initialized = true;
      this.displayedEpochMs = sync.gameEpochMs;
      this.displayedAtMonotonicMs = now;
    }
    this.gameStartedAtEpochMs = sync.gameStartedAtEpochMs;
    this.utcOffsetMinutes = sync.utcOffsetMinutes;
    this.targetEpochMs = sync.gameEpochMs;
    this.speed = sync.speed;
    this.generation = sync.generation;
    this.fresh = true;
    this.targetAtMonotonicMs = now;
  }

  readEpochMs(): number { return this.advance(this.monotonicNow()); }

  freeze(): void { if (this.initialized) this.advance(this.monotonicNow()); this.fresh = false; }

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
    if (!this.fresh) return this.displayedEpochMs;
    now = Math.min(now, this.targetAtMonotonicMs + 1_500);
    const elapsed = Math.max(0, now - this.displayedAtMonotonicMs);
    const natural = this.displayedEpochMs + elapsed * this.speed;
    const target = this.targetEpochMs + Math.max(0, now - this.targetAtMonotonicMs) * this.speed;
    const maxCorrection = elapsed * MAX_CORRECTION_RATE * this.speed;
    const correction = Math.max(-maxCorrection, Math.min(maxCorrection, target - natural));
    this.displayedEpochMs = natural + correction;
    this.displayedAtMonotonicMs = now;
    return this.displayedEpochMs;
  }
}
