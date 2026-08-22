import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

interface GeneratedManifest {
  version: number;
  world: { width: number; height: number; wrapX: boolean };
  fields: Record<string, { width: number; height: number }>;
  buffers: Record<string, { count: number }>;
  counts: Record<string, number>;
  infrastructureChunks: { roads: Array<{ firstIndex: number; indexCount: number }>; bridges: Array<{ firstIndex: number; indexCount: number }>; tunnels: Array<{ firstIndex: number; indexCount: number }> };
  provinces: Array<{ id: number; name: string; center: [number, number]; terrain: string; infrastructureLevel: number }>;
}

describe('generated world package', () => {
  it('preserves the canonical world dimensions and province set', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    expect(manifest.version).toBe(3);
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
    expect(manifest.buffers.roadVertices.count).toBeGreaterThan(300_000);
    expect(manifest.buffers.roadIndices.count).toBeGreaterThan(manifest.buffers.roadVertices.count * 3);
    expect(manifest.buffers.bridgeVertices.count).toBeGreaterThan(10_000);
    expect(manifest.buffers.tunnelVertices.count).toBeGreaterThan(1_000);
    expect(manifest.counts.logicalRoutes).toBeGreaterThan(9_000);
    expect(manifest.counts.landSegments).toBe(17_405);
    expect(manifest.counts.logicalRoutes).toBe(manifest.counts.localRoutes + manifest.counts.regionalRoutes + manifest.counts.majorRoutes);
    expect(manifest.counts.bridges).toBeGreaterThan(100);
    expect(manifest.counts.oceanRoadSamples).toBe(0);
    expect(manifest.counts.unbridgedRiverSamples).toBe(0);
    expect(manifest.counts.minimumBridgeClearance).toBeGreaterThanOrEqual(0.2);
    expect(manifest.counts.maximumBridgeSeamError).toBeLessThanOrEqual(0.2);
    expect(manifest.counts.maximumBridgePierHeight).toBeLessThanOrEqual(18.01);
    expect(manifest.counts.tunnels).toBeGreaterThan(50);
    expect(manifest.counts.sharedGateways).toBeGreaterThan(3_000);
    expect(manifest.counts.sharedGateways).toBeLessThanOrEqual(3_303 * 3);
    expect(manifest.counts.level1Provinces + manifest.counts.level2Provinces + manifest.counts.level3Provinces).toBe(3_303);
    expect(manifest.counts.level3Provinces / 3_303).toBeGreaterThanOrEqual(0.12);
    expect(manifest.counts.level3Provinces / 3_303).toBeLessThanOrEqual(0.16);
    expect(manifest.counts.localStreets).toBeGreaterThan(1_000);
    expect(manifest.buffers.lamps.count).toBeGreaterThan(1_000);
    expect(manifest.infrastructureChunks.roads).toHaveLength(512);
    expect(manifest.infrastructureChunks.bridges).toHaveLength(512);
    expect(manifest.infrastructureChunks.tunnels).toHaveLength(512);
    expect(manifest.infrastructureChunks.roads.reduce((sum, range) => sum + range.indexCount, 0)).toBe(manifest.buffers.roadIndices.count);
    expect(manifest.infrastructureChunks.bridges.reduce((sum, range) => sum + range.indexCount, 0)).toBe(manifest.buffers.bridgeIndices.count);
    expect(manifest.counts.rivers).toBeGreaterThan(800);
    expect(manifest.counts.riverMouths).toBeGreaterThan(100);
    expect(manifest.buffers.riverVertices.count).toBeGreaterThan(manifest.counts.rivers * 6);
    expect(manifest.buffers.riverIndices.count).toBeGreaterThan(manifest.counts.rivers * 12);
    expect(manifest.fields.rivers.width).toBe(2_048);
    expect(manifest.fields.roads.width).toBe(4_096);
    expect(manifest.fields.provinceIds.width).toBe(4_096);
  });

  it('encodes a sparse five-level road field with roles and contextual surfaces', async () => {
    const bytes = await readFile('public/world/roads.rgba8');
    let core = 0;
    let shoulder = 0;
    let level3 = 0;
    let localStreet = 0;
    let timber = 0;
    for (let index = 0; index < bytes.length; index += 4) {
      if (bytes[index] > 32) core += 1;
      if (bytes[index + 1] > 32) shoulder += 1;
      if (Math.round(bytes[index + 2] / 51) === 3) level3 += 1;
      if ((bytes[index + 3] & 4) !== 0) localStreet += 1;
      if (((bytes[index + 3] >> 3) & 7) === 2) timber += 1;
    }
    expect(core).toBeGreaterThan(80_000);
    expect(shoulder).toBeGreaterThan(core);
    expect(core / (bytes.length / 4)).toBeLessThanOrEqual(0.024);
    expect(level3).toBeGreaterThan(10_000);
    expect(localStreet).toBeGreaterThan(5_000);
    expect(timber).toBeGreaterThan(5_000);

    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    const width = manifest.fields.roads.width;
    const height = manifest.fields.roads.height;
    const coverages = manifest.provinces.map((province) => {
      const centerX = Math.round(province.center[0] / manifest.world.width * width);
      const centerY = Math.round(province.center[1] / manifest.world.height * height);
      const radiusX = Math.ceil(75 / manifest.world.width * width);
      const radiusY = Math.ceil(75 / manifest.world.height * height);
      let covered = 0;
      let samples = 0;
      for (let offsetY = -radiusY; offsetY <= radiusY; offsetY += 1) {
        const y = centerY + offsetY;
        if (y < 0 || y >= height) continue;
        for (let offsetX = -radiusX; offsetX <= radiusX; offsetX += 1) {
          if ((offsetX / radiusX) ** 2 + (offsetY / radiusY) ** 2 > 1) continue;
          const x = (centerX + offsetX + width) % width;
          samples += 1;
          if (bytes[(y * width + x) * 4] > 32) covered += 1;
        }
      }
      return covered / samples;
    }).sort((a, b) => a - b);
    expect(coverages[Math.floor(coverages.length * 0.9)]).toBeLessThanOrEqual(0.13);
  });

  it('maps every land movement segment to one or more visual corridors', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    const source = JSON.parse(await readFile('material/movement/connection_segments.json', 'utf8')) as { segments: Array<{ segment_id: number; medium: string }> };
    const [offsetBytes, idBytes] = await Promise.all([
      readFile('public/world/connection-corridor-offsets.u32'), readFile('public/world/connection-corridor-ids.u32'),
    ]);
    const offsets = new Uint32Array(offsetBytes.buffer, offsetBytes.byteOffset, offsetBytes.byteLength / 4);
    const ids = new Uint32Array(idBytes.buffer, idBytes.byteOffset, idBytes.byteLength / 4);
    expect(offsets).toHaveLength(source.segments.length + 1);
    expect(offsets.at(-1)).toBe(ids.length);
    for (const segment of source.segments) {
      const count = offsets[segment.segment_id + 1] - offsets[segment.segment_id];
      if (segment.medium === 'land') expect(count).toBeGreaterThan(0);
      else expect(count).toBe(0);
    }
    expect(Math.max(...ids.filter((_, index) => index % 37 === 0))).toBeLessThan(manifest.counts.logicalRoutes + manifest.counts.sharedGateways);
  });

  it('keeps compiled infrastructure finite, indexed, and off ocean pixels', async () => {
    const manifest = JSON.parse(await readFile('public/world/world.json', 'utf8')) as GeneratedManifest;
    const [roadBytes, roadIndexBytes, bridgeBytes, bridgeIndexBytes, tunnelBytes, tunnelIndexBytes, roadField, provinceBytes] = await Promise.all([
      readFile('public/world/road-vertices.f32'), readFile('public/world/road-indices.u32'),
      readFile('public/world/bridge-vertices.f32'), readFile('public/world/bridge-indices.u32'),
      readFile('public/world/tunnel-vertices.f32'), readFile('public/world/tunnel-indices.u32'),
      readFile('public/world/roads.rgba8'), readFile('public/world/province-ids.u16'),
    ]);
    const roadVertices = new Float32Array(roadBytes.buffer, roadBytes.byteOffset, roadBytes.byteLength / 4);
    const roadIndices = new Uint32Array(roadIndexBytes.buffer, roadIndexBytes.byteOffset, roadIndexBytes.byteLength / 4);
    const bridgeVertices = new Float32Array(bridgeBytes.buffer, bridgeBytes.byteOffset, bridgeBytes.byteLength / 4);
    const bridgeIndices = new Uint32Array(bridgeIndexBytes.buffer, bridgeIndexBytes.byteOffset, bridgeIndexBytes.byteLength / 4);
    const tunnelVertices = new Float32Array(tunnelBytes.buffer, tunnelBytes.byteOffset, tunnelBytes.byteLength / 4);
    const tunnelIndices = new Uint32Array(tunnelIndexBytes.buffer, tunnelIndexBytes.byteOffset, tunnelIndexBytes.byteLength / 4);
    expect(roadVertices.every(Number.isFinite)).toBe(true);
    expect(bridgeVertices.every(Number.isFinite)).toBe(true);
    expect(tunnelVertices.every(Number.isFinite)).toBe(true);
    expect(Math.max(...roadIndices.filter((_, index) => index % 251 === 0))).toBeLessThan(manifest.buffers.roadVertices.count);
    expect(Math.max(...bridgeIndices.filter((_, index) => index % 101 === 0))).toBeLessThan(manifest.buffers.bridgeVertices.count);
    expect(Math.max(...tunnelIndices.filter((_, index) => index % 101 === 0))).toBeLessThan(manifest.buffers.tunnelVertices.count);
    const provinceIds = new Uint16Array(provinceBytes.buffer, provinceBytes.byteOffset, provinceBytes.byteLength / 2);
    let oceanRoadPixels = 0;
    for (let pixel = 0; pixel < provinceIds.length; pixel += 1) {
      if (provinceIds[pixel] === 0 && (roadField[pixel * 4] || roadField[pixel * 4 + 1])) oceanRoadPixels += 1;
    }
    expect(oceanRoadPixels / provinceIds.length).toBeLessThan(0.0005);
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
