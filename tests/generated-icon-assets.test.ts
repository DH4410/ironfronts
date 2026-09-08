import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const assetDirectory = path.join(root, 'src/ui/assets/icons/ironfronts');
const iconRegistry = readFileSync(path.join(root, 'src/ui/icons.ts'), 'utf8');

const generatedIcons = [
  'unit-engineer-icon.png',
  'unit-armored-car-icon.png',
  'unit-light-tank-icon.png',
  'unit-medium-tank-icon.png',
  'structure-barracks-icon.png',
  'structure-tank-plant-icon.png',
  'structure-ordnance-icon.png',
  'command-move.png',
  'command-attack.png',
  'command-retreat.png',
  'command-split.png',
  'command-stop.png',
  'command-extract.png',
] as const;

describe('generated 0 A.D.-inspired icon assets', () => {
  it.each(generatedIcons)('%s is a compact 256px RGBA PNG', (name) => {
    const bytes = readFileSync(path.join(assetDirectory, name));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(256);
    expect(bytes.readUInt32BE(20)).toBe(256);
    expect(bytes[25]).toBe(6);
    expect(bytes.byteLength).toBeLessThan(140_000);
  });

  it.each(generatedIcons)('%s is wired through the HUD icon registry', (name) => {
    expect(iconRegistry).toContain(`ironfrontsPng('${name.slice(0, -4)}')`);
  });
});
