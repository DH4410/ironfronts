import type { GameClockSync } from '@ironfronts/protocol';
import { gameEpochMs, type GameState } from '@ironfronts/game-core';
export const GAME_UTC_OFFSET_MINUTES = 120;

/** The civil clock is a projection of simulation state, never a second clock. */
export class AuthoritativeGameClock {
  constructor(private readonly state: () => GameState, private readonly speed: () => number = () => 1) {}
  get gameStartedAtEpochMs(): number { return this.state().clock.initialEpochMs!; }
  snapshot(serverEpochMs = Date.now()): GameClockSync {
    const clock = this.state().clock;
    return { gameStartedAtEpochMs: this.gameStartedAtEpochMs, gameEpochMs: gameEpochMs(clock),
      serverEpochMs, speed: this.speed(), generation: clock.generation ?? 0, utcOffsetMinutes: GAME_UTC_OFFSET_MINUTES };
  }
  setEpoch(epochMs: number): void {
    const clock = this.state().clock;
    clock.initialEpochMs = epochMs - clock.gameTimeHours * 3_600_000;
    clock.generation = (clock.generation ?? 0) + 1;
  }
}
