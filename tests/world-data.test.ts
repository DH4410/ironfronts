import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

interface GeneratedManifest {
  world: { width: number; height: number; wrapX: boolean };
  fields: Record<string, { width: number; height: number }>;
  buffers: Record<string, { count: number }>;
  counts: Record<string, number>;
  provinces: Array<{ id: number; name: string; terrain: string }>;
}

describe('generated world package', () => {
  it('preserves the canonical world dimensions and province set', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    expect(manifest.world).toMatchObject({ width: 13_562, height: 7_000, wrapX: true });
    expect(manifest.provinces).toHaveLength(3_303);
    expect(new Set(manifest.provinces.map((province) => province.id)).size).toBe(3_303);
    expect(manifest.provinces[0]).toMatchObject({ id: 0, name: 'Las Palmas', terrain: 'Plains' });
  });

  it('packs all renderer layers', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    expect(manifest.buffers.borders.count).toBeGreaterThan(70_000);
    expect(manifest.buffers.connections.count).toBe(28_847);
    expect(manifest.buffers.trees.count).toBeGreaterThan(30_000);
    expect(manifest.buffers.buildings.count).toBeGreaterThan(10_000);
    expect(manifest.counts.rivers).toBeGreaterThan(800);
    expect(manifest.counts.riverMouths).toBeGreaterThan(100);
    expect(manifest.buffers.riverVertices.count).toBeGreaterThan(manifest.counts.rivers * 6);
    expect(manifest.buffers.riverIndices.count).toBeGreaterThan(manifest.counts.rivers * 12);
    expect(manifest.fields.rivers.width).toBe(2_048);
    expect(manifest.fields.provinceIds.width).toBe(4_096);
  });

  it('builds a non-empty directed river field', async () => {
    const bytes = await readFile('public/world/rivers.rgba8');
    let channelPixels = 0;
    let directedPixels = 0;
    for (let index = 0; index < bytes.length; index += 4) {
      if (bytes[index] > 16) channelPixels += 1;
      if (bytes[index] > 16 && (Math.abs(bytes[index + 1] - 128) > 4 || Math.abs(bytes[index + 2] - 128) > 4)) directedPixels += 1;
    }
    expect(channelPixels).toBeGreaterThan(10_000);
    expect(directedPixels / channelPixels).toBeGreaterThan(0.9);
  });

  it('keeps mountain transitions continuous and rivers downhill', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    const heightBytes = await readFile('public/world/height.f32');
    const heights = new Float32Array(heightBytes.buffer, heightBytes.byteOffset, heightBytes.byteLength / 4);
    const surface = await readFile('public/world/surface.rgba8');
    const width = manifest.fields.height.width;
    const height = manifest.fields.height.height;
    const mountainBoundarySteps: number[] = [];
    let maximumHeight = 0;
    for (let index = 0; index < heights.length; index += 1) maximumHeight = Math.max(maximumHeight, heights[index]);
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const index = y * width + x;
        for (const neighbor of [index + 1, index + width]) {
          const mountain = surface[index * 4] === 2;
          const neighborMountain = surface[neighbor * 4] === 2;
          if (mountain !== neighborMountain && surface[index * 4 + 3] && surface[neighbor * 4 + 3]) {
            mountainBoundarySteps.push(Math.abs(heights[index] - heights[neighbor]));
          }
        }
      }
    }
    mountainBoundarySteps.sort((a, b) => a - b);
    expect(maximumHeight).toBeLessThan(220);
    expect(mountainBoundarySteps[Math.floor(mountainBoundarySteps.length * 0.9)]).toBeLessThan(35);

    const riverBytes = await readFile('public/world/river-vertices.f32');
    const rivers = new Float32Array(riverBytes.buffer, riverBytes.byteOffset, riverBytes.byteLength / 4);
    expect(rivers.length).toBe(manifest.buffers.riverVertices.count * 8);
    for (let reach = 0; reach < manifest.counts.rivers; reach += 1) {
      const startBed = rivers[reach * 6 * 8 + 4];
      const endBed = rivers[(reach * 6 + 3) * 8 + 4];
      expect(endBed).toBeLessThanOrEqual(startBed);
      const halfWidth = Math.hypot(rivers[reach * 6 * 8 + 2], rivers[reach * 6 * 8 + 3]);
      expect(halfWidth).toBeGreaterThan(8.5);
    }
  });

  it('encodes a filtered coastline rather than a binary pixel edge', async () => {
    const coast = await readFile('public/world/coast.r8');
    let transitionPixels = 0;
    for (const value of coast) if (value > 8 && value < 247) transitionPixels += 1;
    expect(transitionPixels).toBeGreaterThan(25_000);
  });

  it('encodes every province and keeps nearly all supplied centers interior', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    const source = JSON.parse(await readFile('material/metadata/provinces.json', 'utf8')) as { provinces: Array<{ province_id: number; center_x: number; center_y: number }> };
    const bytes = await readFile('public/world/province-ids.u16');
    const ids = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const field = manifest.fields.provinceIds;
    const encoded = new Set(ids);
    for (const province of manifest.provinces) expect(encoded).toContain(province.id + 1);

    let centerHits = 0;
    const sampled = manifest.provinces.filter((_, index) => index % 31 === 0);
    const sourceById = new Map(source.provinces.map((province) => [province.province_id, province]));
    for (const province of sampled) {
      const record = sourceById.get(province.id);
      expect(record).toBeDefined();
      if (!record) continue;
      const x = Math.min(field.width - 1, Math.floor(record.center_x / manifest.world.width * field.width));
      const y = Math.min(field.height - 1, Math.floor(record.center_y / manifest.world.height * field.height));
      const nearby = new Set<number>();
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(field.width - 1, x + offsetX));
          const sampleY = Math.max(0, Math.min(field.height - 1, y + offsetY));
          nearby.add(ids[sampleY * field.width + sampleX]);
        }
      }
      if (nearby.has(province.id + 1)) centerHits += 1;
    }
    expect(centerHits / sampled.length).toBeGreaterThan(0.95);
  });
});
