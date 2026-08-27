import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const assets = [
  'public/audio/sfx/ui-click.wav',
  'public/audio/sfx/ui-hover.wav',
  'public/audio/sfx/ui-switch.wav',
  'public/audio/ambience/rain.ogg',
] as const;

describe('audio asset bundle', () => {
  it('includes the basic UI and weather samples', () => {
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
    for (const asset of assets) {
      expect(credits).toContain(path.basename(asset));
    }
  });
});
