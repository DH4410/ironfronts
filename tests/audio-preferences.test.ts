import { describe, expect, it } from 'vitest';
import {
  AUDIO_PREFERENCES_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  clampVolume,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
  type AudioStorage,
} from '../src/audio/audio-preferences';

class MemoryStorage implements AudioStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('audio preferences', () => {
  it('clamps invalid volume values into the supported range', () => {
    expect(clampVolume(-2)).toBe(0);
    expect(clampVolume(0.4)).toBe(0.4);
    expect(clampVolume(3)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(0);
  });

  it('uses stable defaults when no preferences have been saved', () => {
    expect(loadAudioPreferences(new MemoryStorage())).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });

  it('normalizes partial or out-of-range saved preferences', () => {
    expect(normalizeAudioPreferences({
      master: 2,
      music: -1,
      ui: 0.33,
    })).toEqual({
      ...DEFAULT_AUDIO_PREFERENCES,
      master: 1,
      music: 0,
      ui: 0.33,
    });
  });

  it('round-trips saved preferences', () => {
    const storage = new MemoryStorage();
    const preferences = {
      ...DEFAULT_AUDIO_PREFERENCES,
      master: 0.61,
      music: 0.27,
    };

    saveAudioPreferences(storage, preferences);

    expect(storage.getItem(AUDIO_PREFERENCES_KEY)).not.toBeNull();
    expect(loadAudioPreferences(storage)).toEqual(preferences);
  });

  it('falls back safely when stored JSON is corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem(AUDIO_PREFERENCES_KEY, '{broken json');

    expect(loadAudioPreferences(storage)).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });
});
