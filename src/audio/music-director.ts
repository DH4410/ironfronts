import type { MusicPlaybackOptions } from './audio-manager';
import {
  TRACK_BY_ID,
  chooseTrack,
  trackSources,
  tracksForState,
  type MusicState,
  type MusicTrack,
} from './music-catalog';

export interface MusicPlayer {
  playMusic(url: string, options?: MusicPlaybackOptions): Promise<boolean>;
  stopMusic(fadeSeconds?: number): void;
}

export interface MusicDirectorOptions {
  random?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const RECENT_HISTORY = 4;

export class MusicDirector {
  private readonly random: () => number;
  private readonly setTimer: NonNullable<MusicDirectorOptions['setTimer']>;
  private readonly clearTimer: NonNullable<MusicDirectorOptions['clearTimer']>;
  private state: MusicState | null = null;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private recentIds: string[] = [];
  private menuPlayed = false;

  constructor(
    private readonly player: MusicPlayer,
    options: MusicDirectorOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
  }

  getState(): MusicState | null {
    return this.state;
  }

  async setState(next: MusicState): Promise<void> {
    if (this.state === next && next !== 'victory') return;

    this.state = next;
    this.generation += 1;
    const generation = this.generation;
    this.cancelTimer();

    if (next === 'victory') {
      this.recentIds = [];
      const victory = TRACK_BY_ID.get('victorious');
      if (victory) await this.playTrack(victory, next, generation, 0.45);
      return;
    }

    if (next === 'opening') {
      this.recentIds = [];
      const opening = TRACK_BY_ID.get('first-sighting');
      if (opening && await this.playTrack(opening, next, generation, 0.85)) return;

      // The archived GitHub mirror no longer carries this old Jeff Willet
      // track. Until the supplied MP3 archive is vendored, use a short calm
      // fallback instead of leaving the opening silent.
      const fallback = TRACK_BY_ID.get('land-two-seas');
      if (fallback) await this.playTrack(fallback, next, generation, 0.85);
      return;
    }

    if (next === 'menu') {
      this.recentIds = [];
      const firstMenuTrack = TRACK_BY_ID.get(this.menuPlayed ? 'calm-before-the-storm' : 'honor-bound');
      this.menuPlayed = true;
      if (firstMenuTrack) await this.playTrack(firstMenuTrack, next, generation, 1.4);
      return;
    }

    this.recentIds = [];
    await this.playNextFromPool(next, generation);
  }

  stop(fadeSeconds = 0.8): void {
    this.generation += 1;
    this.state = null;
    this.cancelTimer();
    this.player.stopMusic(fadeSeconds);
  }

  private async playNextFromPool(state: Extract<MusicState, 'menu' | 'peace' | 'war'>, generation: number): Promise<void> {
    if (!this.isCurrent(state, generation)) return;
    const pool = tracksForState(state);
    const candidate = chooseTrack(pool, this.recentIds, this.random);
    if (!candidate) return;

    const played = await this.playTrack(candidate, state, generation, state === 'war' ? 0.55 : 1.35);
    if (!played && this.isCurrent(state, generation)) {
      this.remember(candidate.id);
      await this.playNextFromPool(state, generation);
    }
  }

  private async playTrack(
    candidate: MusicTrack,
    state: MusicState,
    generation: number,
    fadeSeconds: number,
  ): Promise<boolean> {
    for (const source of trackSources(candidate)) {
      if (!this.isCurrent(state, generation)) return false;
      const played = await this.player.playMusic(source, {
        fadeSeconds,
        onEnded: () => this.onTrackEnded(candidate, state, generation),
      });
      if (played) {
        this.remember(candidate.id);
        return true;
      }
    }
    return false;
  }

  private onTrackEnded(candidate: MusicTrack, state: MusicState, generation: number): void {
    if (!this.isCurrent(state, generation)) return;

    if (state === 'victory') return;
    if (state === 'opening') {
      void this.setState('peace');
      return;
    }

    const minimumSeconds = state === 'war' ? 2 : state === 'menu' ? 5 : 8;
    const maximumSeconds = state === 'war' ? 6 : state === 'menu' ? 11 : 20;
    const delaySeconds = minimumSeconds + this.random() * (maximumSeconds - minimumSeconds);

    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (!this.isCurrent(state, generation)) return;
      void this.playNextFromPool(state, generation);
    }, Math.round(delaySeconds * 1000));

    // Keep TypeScript aware that this callback belongs to the track that ended,
    // and make debugging state transitions easier in devtools.
    void candidate;
  }

  private remember(id: string): void {
    this.recentIds = [id, ...this.recentIds.filter((candidate) => candidate !== id)].slice(0, RECENT_HISTORY);
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private isCurrent(state: MusicState, generation: number): boolean {
    return this.state === state && this.generation === generation;
  }
}
