import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';

interface Manifest {
  version: number;
  world: { width: number; height: number; wrapX: boolean };
  fields: Record<string, { width: number; height: number }>;
  buffers: Record<string, { count: number; stride: number }>;
  terrain: { maxHeight: number };
  infrastructureChunks: {
    roads: Array<{ firstIndex: number; indexCount: number }>;
    hiddenConnections: Array<{ firstIndex: number; indexCount: number }>;
    waterways: Array<{ firstIndex: number; indexCount: number }>;
  };
  counts: Record<string, number>;
  provinces: Array<{ id: number; name: string; terrain: string; infrastructureLevel: number }>;
}

async function manifest(): Promise<Manifest> {
  return JSON.parse(await readFile('public/world/world.json', 'utf8')) as Manifest;
}

function viewF32(bytes: Buffer): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function viewU32(bytes: Buffer): Uint32Array {
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

describe('generated v6 world package', () => {
  it('preserves the canonical world and exposes simplified roads plus supplied waterways', async () => {
    const data = await manifest();
    expect(data.version).toBe(6);
    expect(data.world).toEqual(expect.objectContaining({ width: 13_562, height: 7_000, wrapX: true }));
    expect(data.provinces).toHaveLength(3_303);
    expect(new Set(data.provinces.map((province) => province.id)).size).toBe(3_303);
    expect(data.provinces[0]).toEqual(expect.objectContaining({ id: 0, name: 'Las Palmas', terrain: 'Plains' }));
    expect(Object.keys(data.fields).sort()).toEqual(['coast', 'height', 'provinceIds', 'roads', 'surface', 'waterways']);
    for (const obsolete of ['riverVertices', 'riverIndices', 'bridgeVertices', 'bridgeIndices', 'tunnelVertices', 'tunnelIndices', 'engineeringVertices', 'engineeringIndices']) {
      expect(data.buffers[obsolete]).toBeUndefined();
    }
    expect(data.buffers.waterwayVertices).toEqual(expect.objectContaining({ stride: 8 }));
    expect(data.buffers.waterwayIndices).toEqual(expect.objectContaining({ stride: 1 }));
    expect(data.provinces.every((province) => province.infrastructureLevel === 1)).toBe(true);
    expect(data.counts).toEqual(expect.objectContaining({
      level1Provinces: 3_303, level2Provinces: 0, level3Provinces: 0,
      localStreets: 0, regionalRoutes: 0, majorRoutes: 0,
      sharedGateways: 0, physicalSharedSegments: 0, physicalSharedLength: 0,
      hiddenConnectorRoutes: data.counts.hiddenRoutes,
      hiddenGradeRoutes: 0,
    }));
  });

  it('reconstructs the authoritative river graph and both static ocean-water canals', async () => {
    const data = await manifest();
    const [vertexBytes, indexBytes, maskBytes, nodeBytes, reportBytes] = await Promise.all([
      readFile('public/world/waterway-vertices.f32'), readFile('public/world/waterway-indices.u32'),
      readFile('public/world/waterways.r8'),
      readFile('material/movement/network_nodes.json', 'utf8'), readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const vertices = viewF32(vertexBytes), indices = viewU32(indexBytes);
    const source = JSON.parse(nodeBytes) as { nodes: Array<{ kind: string; location_name: string }> };
    const report = JSON.parse(reportBytes);
    const riverNames = new Set(report.waterways.riverSystems);
    const sourceRiverPoints = source.nodes.filter((node) => node.kind === 'sea_point' && riverNames.has(node.location_name));
    const sourceCanalPoints = source.nodes.filter((node) => node.kind === 'sea_point' && ['Kiel Canal', 'Suez Channel'].includes(node.location_name));
    expect(report.version).toBe('world-generation-v6');
    expect(report.waterways.staticSurface).toBe(true);
    expect(report.waterways.riverSystems).toHaveLength(24);
    expect(sourceRiverPoints).toHaveLength(520);
    expect(sourceCanalPoints).toHaveLength(8);
    expect(data.counts).toEqual(expect.objectContaining({
      riverSystems: 24, riverSourcePoints: 520, riverSegments: 527, riverMouthLinks: 29,
      canalSystems: 2, canalSourcePoints: 8, canalSegments: 10,
    }));
    expect(vertices.length).toBe(data.buffers.waterwayVertices.count * 8);
    expect(indices.length).toBe(data.buffers.waterwayIndices.count);
    expect(maskBytes.byteLength).toBe(data.fields.waterways.width * data.fields.waterways.height);
    expect(maskBytes.some((value) => value > 0)).toBe(true);
    expect(vertices.every(Number.isFinite)).toBe(true);
    let centerVertices = 0;
    for (let vertex = 0; vertex < data.buffers.waterwayVertices.count; vertex += 113) {
      const offset = vertex * 8;
      expect(vertices[offset + 1]).toBeGreaterThanOrEqual(0.4);
      expect(vertices[offset + 1]).toBeLessThanOrEqual(50.5);
      expect([0, 1]).toContain(vertices[offset + 6]);
    }
    for (let vertex = 0; vertex < data.buffers.waterwayVertices.count; vertex += 1) {
      const offset = vertex * 8;
      if (vertices[offset + 5] > 0.01) continue;
      centerVertices += 1;
      const px = Math.min(data.fields.waterways.width - 1, Math.max(0,
        Math.floor(((vertices[offset] % data.world.width) + data.world.width) % data.world.width / data.world.width * data.fields.waterways.width)));
      const pz = Math.min(data.fields.waterways.height - 1, Math.max(0,
        Math.floor(vertices[offset + 2] / data.world.height * data.fields.waterways.height)));
      expect(maskBytes[pz * data.fields.waterways.width + px]).toBe(255);
    }
    expect(centerVertices).toBeGreaterThan(10_000);
    for (let index = 0; index < indices.length; index += 127) expect(indices[index]).toBeLessThan(data.buffers.waterwayVertices.count);
    expect(data.infrastructureChunks.waterways).toHaveLength(512);
    expect(data.infrastructureChunks.waterways.reduce((sum, range) => sum + range.indexCount, 0)).toBe(indices.length);
  });

  it('emits finite capped topography without terrain-class spikes', async () => {
    const data = await manifest();
    const [heightBytes, surfaceBytes, reportBytes] = await Promise.all([
      readFile('public/world/height.f32'), readFile('public/world/surface.rgba8'), readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const heights = viewF32(heightBytes);
    const surface = new Uint8Array(surfaceBytes.buffer, surfaceBytes.byteOffset, surfaceBytes.byteLength);
    const report = JSON.parse(reportBytes);
    expect(heights.every(Number.isFinite)).toBe(true);
    let maximum = 0;
    for (let index = 0; index < heights.length; index += 1) if (surface[index * 4 + 3]) maximum = Math.max(maximum, heights[index]);
    expect(maximum).toBeLessThanOrEqual(50.5);
    for (let index = 0; index < heights.length; index += 997) {
      if (surface[index * 4 + 3]) expect(heights[index]).toBeGreaterThanOrEqual(1.199);
      else expect(heights[index]).toBe(0);
    }
    expect(report.topography.capViolations).toBe(0);
    expect(report.topography.maximumSlopeStep).toBeLessThanOrEqual(2.01);
    expect(report.topography.conditioning.maximumAdjustment).toBeLessThanOrEqual(12.001);
    const provinceById = new Map(data.provinces.map((province) => [province.id, province]));
    for (const adjustment of report.topography.conditioning.provinceAdjustments) {
      const terrain = provinceById.get(adjustment.provinceId)?.terrain;
      const meanBudget = terrain === 'Mountain' ? 6 : terrain === 'Hills' ? 4 : 2.5;
      expect(Math.abs(adjustment.mean)).toBeLessThanOrEqual(meanBudget + 0.001);
    }
    expect(data.terrain.maxHeight).toBeLessThanOrEqual(50.5);
  });

  it('drapes every emitted road vertex over final dry terrain', async () => {
    const data = await manifest();
    const [roadBytes, indexBytes, heightBytes, surfaceBytes] = await Promise.all([
      readFile('public/world/road-vertices.f32'), readFile('public/world/road-indices.u32'),
      readFile('public/world/height.f32'), readFile('public/world/surface.rgba8'),
    ]);
    const vertices = viewF32(roadBytes), indices = viewU32(indexBytes), heights = viewF32(heightBytes);
    const surface = new Uint8Array(surfaceBytes.buffer, surfaceBytes.byteOffset, surfaceBytes.byteLength);
    expect(vertices.length).toBe(data.buffers.roadVertices.count * 13);
    expect(indices.length).toBe(data.buffers.roadIndices.count);
    expect(vertices.every(Number.isFinite)).toBe(true);
    for (let index = 0; index < indices.length; index += 1009) expect(indices[index]).toBeLessThan(data.buffers.roadVertices.count);
    const width = data.fields.height.width, height = data.fields.height.height;
    const sampleHeight = (x: number, z: number) => {
      const fx = ((x % data.world.width) + data.world.width) % data.world.width / data.world.width * width - 0.5;
      const fz = Math.max(0, Math.min(height - 1, z / data.world.height * height - 0.5));
      const x0raw = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0raw, tz = fz - z0;
      const x0 = ((x0raw % width) + width) % width, x1 = (x0 + 1) % width, z1 = Math.min(height - 1, z0 + 1);
      const top = heights[z0 * width + x0] * (1 - tx) + heights[z0 * width + x1] * tx;
      const bottom = heights[z1 * width + x0] * (1 - tx) + heights[z1 * width + x1] * tx;
      return top * (1 - tz) + bottom * tz;
    };
    for (let vertex = 0; vertex < data.buffers.roadVertices.count; vertex += 503) {
      const offset = vertex * 13, x = vertices[offset], y = vertices[offset + 1], z = vertices[offset + 2];
      const px = Math.min(width - 1, Math.max(0, Math.floor(((x % data.world.width) + data.world.width) % data.world.width / data.world.width * width)));
      const pz = Math.min(height - 1, Math.max(0, Math.floor(z / data.world.height * height)));
      expect(surface[(pz * width + px) * 4 + 3]).toBeGreaterThan(0);
      const lift = y - sampleHeight(x, z);
      expect(lift).toBeGreaterThanOrEqual(0.079);
      expect(lift).toBeLessThanOrEqual(0.161);
    }
    expect(data.infrastructureChunks.roads).toHaveLength(512);
    expect(data.infrastructureChunks.roads.reduce((sum, range) => sum + range.indexCount, 0)).toBe(indices.length);
  }, 20_000);

  it('renders every omitted road as a floating dotted connector', async () => {
    const data = await manifest();
    const [vertexBytes, indexBytes] = await Promise.all([
      readFile('public/world/hidden-connection-vertices.f32'),
      readFile('public/world/hidden-connection-indices.u32'),
    ]);
    const vertices = viewF32(vertexBytes), indices = viewU32(indexBytes);
    expect(data.buffers.hiddenConnectionVertices.count).toBeGreaterThan(0);
    expect(vertices.length).toBe(data.buffers.hiddenConnectionVertices.count * 13);
    expect(indices.length).toBe(data.buffers.hiddenConnectionIndices.count);
    expect(vertices.every(Number.isFinite)).toBe(true);
    for (let vertex = 0; vertex < data.buffers.hiddenConnectionVertices.count; vertex += 97) {
      expect(vertices[vertex * 13 + 1]).toBeGreaterThanOrEqual(0.7);
      expect(vertices[vertex * 13 + 11]).toBe(12);
    }
    for (let index = 0; index < indices.length; index += 101) expect(indices[index]).toBeLessThan(data.buffers.hiddenConnectionVertices.count);
    expect(data.infrastructureChunks.hiddenConnections).toHaveLength(512);
    expect(data.infrastructureChunks.hiddenConnections.reduce((sum, range) => sum + range.indexCount, 0)).toBe(indices.length);
  });

  it('maps every land connection and reports every hidden physical corridor', async () => {
    const data = await manifest();
    const [sourceBytes, offsetBytes, idBytes, flagBytes, reportBytes] = await Promise.all([
      readFile('material/movement/connection_segments.json', 'utf8'), readFile('public/world/connection-corridor-offsets.u32'),
      readFile('public/world/connection-corridor-ids.u32'), readFile('public/world/corridor-flags.u32'),
      readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const source = JSON.parse(sourceBytes) as { segments: Array<{ segment_id: number; medium: string }> };
    const offsets = viewU32(offsetBytes), ids = viewU32(idBytes), flags = viewU32(flagBytes);
    const report = JSON.parse(reportBytes);
    expect(offsets.length).toBe(source.segments.length + 1);
    expect(offsets.at(-1)).toBe(ids.length);
    const unmapped = new Set<number>(report.roads.unmappedLandSegments);
    let mappedLand = 0;
    for (let segment = 0; segment < source.segments.length; segment += 1) {
      if (source.segments[segment].medium !== 'land') continue;
      if (unmapped.has(source.segments[segment].segment_id)) expect(offsets[segment + 1]).toBe(offsets[segment]);
      else {
        expect(offsets[segment + 1]).toBeGreaterThan(offsets[segment]);
        mappedLand += 1;
      }
    }
    for (let index = 0; index < ids.length; index += 101) expect(ids[index] * 4 + 3).toBeLessThan(flags.length);
    expect(report.roads.hiddenCorridors).toBe(data.counts.hiddenRoutes);
    expect(report.roads.hiddenRoads).toHaveLength(data.counts.hiddenRoutes);
    expect(report.roads.emittedCorridors + report.roads.hiddenCorridors).toBe(report.roads.logicalCorridors);
    expect(report.roads.logicalCorridors).toBe(7_805);
    expect(mappedLand + unmapped.size).toBe(data.counts.landSegments);
    expect(unmapped.size).toBe(data.counts.unmappedLandSegments);
    expect(report.roads.sharedSegments).toBe(0);
    expect(report.roads.sharedLength).toBe(0);
    expect(report.roads.gradeWarnings.length).toBe(data.counts.steepRoadRoutes);
    expect(data.counts.steepEmittedRoutes).toBeGreaterThan(0);
  });

  it('removes all obsolete procedural-hydrology and structure files from generated output', async () => {
    for (const name of ['rivers.rgba8', 'river-vertices.f32', 'bridge-vertices.f32', 'tunnel-vertices.f32', 'infrastructure-engineering.rgba8', 'engineering-vertices.f32']) {
      await expect(access(`public/world/${name}`)).rejects.toThrow();
    }
  });
});
