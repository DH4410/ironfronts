import type { GameClockSync } from '@ironfronts/protocol';
import { INITIAL_GAME_EPOCH_MS, type GameState } from '@ironfronts/game-core';
export const GAME_UTC_OFFSET_MINUTES = 120;

/**
 * Persistent visual world clock. It deliberately does not read simulation
 * speed or elapsed gameplay time. Manual clocks and timezone-linked clocks
 * both continue across server downtime from real epoch anchors in the save.
 */
export class AuthoritativeGameClock {
  constructor(private readonly state: () => GameState) {}
  get gameStartedAtEpochMs(): number { return this.state().clock.initialEpochMs ?? INITIAL_GAME_EPOCH_MS; }
  snapshot(serverEpochMs = Date.now()): GameClockSync {
    const clock = this.state().clock;
    clock.visualEpochMs ??= this.gameStartedAtEpochMs;
    clock.visualAnchorRealEpochMs ??= serverEpochMs;
    clock.visualUtcOffsetMinutes ??= GAME_UTC_OFFSET_MINUTES;
    clock.visualTimezoneLinked ??= false;
    const gameEpochMs = clock.visualTimezoneLinked
      ? serverEpochMs
      : clock.visualEpochMs + Math.max(0, serverEpochMs - clock.visualAnchorRealEpochMs);
    return {
      gameStartedAtEpochMs: this.gameStartedAtEpochMs,
      gameEpochMs,
      campaignElapsedSeconds: clock.gameTimeHours * 3_600,
      serverEpochMs,
      speed: 1,
      generation: clock.visualGeneration ?? 0,
      utcOffsetMinutes: clock.visualUtcOffsetMinutes,
      timezoneLinked: clock.visualTimezoneLinked,
    };
  }
  setEpoch(epochMs: number, serverEpochMs = Date.now()): void {
    const clock = this.state().clock;
    clock.visualEpochMs = epochMs;
    clock.visualAnchorRealEpochMs = serverEpochMs;
    clock.visualTimezoneLinked = false;
    clock.visualGeneration = (clock.visualGeneration ?? 0) + 1;
  }

  linkTimezone(utcOffsetMinutes: number, serverEpochMs = Date.now()): void {
    const clock = this.state().clock;
    clock.visualEpochMs = serverEpochMs;
    clock.visualAnchorRealEpochMs = serverEpochMs;
    clock.visualUtcOffsetMinutes = Math.max(-840, Math.min(840, Math.round(utcOffsetMinutes)));
    clock.visualTimezoneLinked = true;
    clock.visualGeneration = (clock.visualGeneration ?? 0) + 1;
  }
}
