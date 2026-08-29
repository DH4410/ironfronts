import type { GameClockSync } from '@ironfronts/protocol';

/** World at War uses a fixed civil timezone regardless of server location. */
export const GAME_UTC_OFFSET_MINUTES = 120;

export class AuthoritativeGameClock {
  constructor(
    readonly gameStartedAtEpochMs = Date.now(),
    readonly utcOffsetMinutes = GAME_UTC_OFFSET_MINUTES,
  ) {}

  snapshot(serverEpochMs = Date.now()): GameClockSync {
    return {
      gameStartedAtEpochMs: this.gameStartedAtEpochMs,
      serverEpochMs,
      utcOffsetMinutes: this.utcOffsetMinutes,
    };
  }
}
