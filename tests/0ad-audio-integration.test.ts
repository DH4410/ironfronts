import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const sfx = path.join(root, 'public/audio/sfx');

describe('0 A.D. audio integration', () => {
  it('routes selection and movement through the UI volume bus', () => {
    expect(audio).toContain("select: '/audio/sfx/0ad-army-select.ogg'");
    expect(audio).toContain("move: '/audio/sfx/0ad-move-order.ogg'");
    expect(main).toContain("audio.playUiCue('select')");
    expect(main).toContain("audio.playUiCue('move')");
  });

  it('plays licensed end-state and close-battle cues through the SFX bus', () => {
    expect(audio).toContain("victory: { url: '/audio/sfx/0ad-victory.ogg'");
    expect(audio).toContain("defeat: { url: '/audio/sfx/0ad-defeat.ogg'");
    expect(audio).toContain("'close-battle': { url: '/audio/sfx/0ad-close-battle.ogg'");
    expect(main).toContain("audio.playEffectCue(won ? 'victory' : 'defeat')");
    expect(main).toContain("audio.playEffectCue('close-battle')");
  });

  it('ships real Ogg files and attribution with the game', () => {
    for (const name of ['0ad-army-select.ogg', '0ad-move-order.ogg', '0ad-victory.ogg', '0ad-defeat.ogg', '0ad-close-battle.ogg']) {
      const file = path.join(sfx, name);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString('ascii')).toBe('OggS');
    }
    expect(readFileSync(path.join(sfx, '0ad-AUDIO-CREDITS.txt'), 'utf8')).toContain('Wildfire Games');
    expect(existsSync(path.join(sfx, '0ad-AUDIO-LICENSE.txt'))).toBe(true);
  });
});
