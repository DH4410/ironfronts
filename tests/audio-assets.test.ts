import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const assets = [
  'public/audio/sfx/ui-click.wav',
  'public/audio/sfx/ui-hover.wav',
  'public/audio/sfx/ui-switch.wav',
  'public/audio/sfx/dossier-open.wav',
  'public/audio/sfx/dossier-close.wav',
  'public/audio/sfx/order-confirm.wav',
  'public/audio/sfx/weather-thunder.ogg',
  'public/audio/ambience/rain.ogg',
  'public/audio/ambience/wind.ogg',
  'public/audio/ambience/ocean-waves.wav',
] as const;

describe('audio asset bundle', () => {
  it('includes the basic UI and environmental samples', () => {
    for (const asset of assets) {
      const filename = path.join(root, asset);
      expect(existsSync(filename), asset).toBe(true);
      expect(statSync(filename).size, asset).toBeGreaterThan(1_000);
    }
  });

  it('documents third-party audio provenance', () => {
    const credits = readFileSync(path.join(root, 'AUDIO_CREDITS.md'), 'utf8');
    expect(credits).toContain('Kenney UI Audio');
    expect(credits).toContain('Rain (loopable)');
    expect(credits).toContain('Opening and Closing a Map Sounds');
    expect(credits).toContain('wind whoosh loop');
    expect(credits).toContain('Beach Ocean Waves');
    expect(credits).toContain('100 CC0 SFX #2');
    for (const asset of assets) {
      expect(credits).toContain(path.basename(asset));
    }
  });
});
