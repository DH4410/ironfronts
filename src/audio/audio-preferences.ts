export type AudioBus = 'master' | 'music' | 'ui' | 'ambience' | 'effects';

export type AudioPreferences = Record<AudioBus, number>;

export interface AudioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const AUDIO_PREFERENCES_KEY = 'ironfronts.audio.v1';

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  master: 0.74,
  music: 0.42,
  ui: 0.72,
  ambience: 0.55,
  effects: 0.72,
};

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeAudioPreferences(value: Partial<AudioPreferences> | undefined): AudioPreferences {
  return {
    master: clampVolume(value?.master ?? DEFAULT_AUDIO_PREFERENCES.master),
    music: clampVolume(value?.music ?? DEFAULT_AUDIO_PREFERENCES.music),
    ui: clampVolume(value?.ui ?? DEFAULT_AUDIO_PREFERENCES.ui),
    ambience: clampVolume(value?.ambience ?? DEFAULT_AUDIO_PREFERENCES.ambience),
    effects: clampVolume(value?.effects ?? DEFAULT_AUDIO_PREFERENCES.effects),
  };
}

export function loadAudioPreferences(storage?: AudioStorage): AudioPreferences {
  if (!storage) return { ...DEFAULT_AUDIO_PREFERENCES };
  try {
    const raw = storage.getItem(AUDIO_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<AudioPreferences>;
    return normalizeAudioPreferences(parsed);
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(storage: AudioStorage | undefined, preferences: AudioPreferences): void {
  if (!storage) return;
  try {
    storage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(normalizeAudioPreferences(preferences)));
  } catch {
    // Storage can be unavailable in privacy modes. Audio should continue in-memory.
  }
}
