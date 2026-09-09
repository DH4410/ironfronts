import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const assetDirectory = path.join(root, 'src/ui/assets/icons/ironfronts');
const skinDirectory = path.join(root, 'src/ui/assets/skins');
const menuKitDirectory = path.join(root, 'public/menu/kit');
const iconRegistry = readFileSync(path.join(root, 'src/ui/icons.ts'), 'utf8');

const paintedIcons = [
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

const generatedSkins = [
  ['army-counter-cartouche.png', 256, 192],
  ['army-roster-plaque.png', 256, 320],
  ['army-unit-card-frame.png', 256, 341],
  ['army-unit-card-mask.png', 256, 341],
  ['hud-action-ribbon.png', 512, 171],
  ['hud-building-plaque.png', 384, 256],
  ['hud-control-plate.png', 384, 256],
  ['hud-panel-frame.png', 512, 256],
  ['hud-queue-slot.png', 320, 240],
] as const;

const generatedMenuKit = [
  ['edge-strip.png', 512, 64],
  ['torn-paper-frame.png', 768, 576],
  ['corner-fastener.png', 128, 128],
  ['compass-marker.png', 128, 128],
  ['map-grid.png', 512, 512],
] as const;

describe('painted WW2 icon assets', () => {
  it.each(paintedIcons)('%s is a compact 256px RGBA PNG', (name) => {
    const bytes = readFileSync(path.join(assetDirectory, name));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(256);
    expect(bytes.readUInt32BE(20)).toBe(256);
    expect(bytes[25]).toBe(6);
    expect(bytes.byteLength).toBeLessThan(140_000);
  });

  it.each(paintedIcons)('%s is wired through the HUD icon registry', (name) => {
    expect(iconRegistry).toContain(`ironfrontsPng('${name.slice(0, -4)}')`);
  });
});

describe('generated irregular HUD skins', () => {
  it.each(generatedSkins)('%s preserves its intended aspect and genuine transparency', (name, width, height) => {
    const bytes = readFileSync(path.join(skinDirectory, name));
    const image = PNG.sync.read(bytes);
    expect(image.width).toBe(width);
    expect(image.height).toBe(height);
    let transparent = 0;
    let visible = 0;
    for (let offset = 3; offset < image.data.length; offset += 4) {
      if (image.data[offset] < 8) transparent += 1;
      if (image.data[offset] > 247) visible += 1;
    }
    expect(transparent).toBeGreaterThan(width * height * 0.01);
    expect(visible).toBeGreaterThan(width * height * 0.05);
    expect(bytes.byteLength).toBeLessThan(300_000);
  });
});

describe('generated war-room menu kit', () => {
  it.each(generatedMenuKit)('%s is clean high-resolution RGBA artwork', (name, width, height) => {
    const bytes = readFileSync(path.join(menuKitDirectory, name));
    const image = PNG.sync.read(bytes);
    expect(image.width).toBe(width);
    expect(image.height).toBe(height);
    let transparent = 0;
    let painted = 0;
    for (let offset = 3; offset < image.data.length; offset += 4) {
      if (image.data[offset] < 8) transparent += 1;
      if (image.data[offset] > 32) painted += 1;
    }
    expect(transparent).toBeGreaterThan(width * height * 0.01);
    expect(painted).toBeGreaterThan(width * height * 0.01);
    expect(bytes.byteLength).toBeLessThan(500_000);
  });
});
