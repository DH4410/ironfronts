import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfrastructure } from './build-infrastructure.mjs';
import { FIELD_HEIGHT, FIELD_WIDTH, ID_HEIGHT, ID_WIDTH, SEED, WORLD_HEIGHT, WORLD_WIDTH } from './world/config.mjs';
import { blurField, clamp, distanceToValue, wrap } from './world/raster.mjs';
import { buildInstances } from './world/instances.mjs';
import { generateTopography } from './world/topography.mjs';
import { buildBankField } from './world/water-fields.mjs';
import { buildWaterways } from './world/waterways.mjs';
import { buildTerrainAwareWaterways } from './world/terrain-aware-waterways.mjs';
import { seatRiverTerrain } from './world/river-terrain.mjs';
import { buildVisualRiverField } from './world/visual-rivers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL = path.join(ROOT, 'material');
const OUTPUT = path.join(ROOT, 'public', 'world');

const terrainCodes = new Map([
  [10, 0],
  [11, 1],
  [12, 2],
  [13, 3],
  [14, 4],
]);

const visualCodes = new Map([
  ['', 0],
  ['Desert', 1],
  ['Mediterranean', 2],
  ['Boreal', 3],
  ['Jungle', 4],
  ['Grassland', 5],
  ['Tundra', 6],
  ['Sand Dunes', 7],
  ['Arctic', 8],
]);

function hash2(x, y, seed = SEED) {
  let h = Math.imul(x ^ seed, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

function periodicNoise(u, v, cellsX, cellsY) {
  const px = u * cellsX;
  const py = v * cellsY;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx0 = px - x0;
  const ty0 = py - y0;
  const tx = tx0 * tx0 * (3 - 2 * tx0);
  const ty = ty0 * ty0 * (3 - 2 * ty0);
  const ix0 = wrap(x0, cellsX);
  const ix1 = wrap(x0 + 1, cellsX);
  const iy0 = clamp(y0, 0, cellsY);
  const iy1 = clamp(y0 + 1, 0, cellsY);
  const a = hash2(ix0, iy0);
  const b = hash2(ix1, iy0);
  const c = hash2(ix0, iy1);
  const d = hash2(ix1, iy1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function fbm(u, v) {
  let value = 0;
  let weight = 0.55;
  let total = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    const cellsX = 8 << octave;
    const cellsY = Math.max(4, Math.round(cellsX * WORLD_HEIGHT / WORLD_WIDTH));
    value += periodicNoise(u, v, cellsX, cellsY) * weight;
    total += weight;
    weight *= 0.5;
  }
  return value / total;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(MATERIAL, relativePath), 'utf8'));
}

function fillPolygon(ids, points, encodedId) {
  const scaled = points.map(([x, y]) => [x * ID_WIDTH / WORLD_WIDTH, y * ID_HEIGHT / WORLD_HEIGHT]);
  let minY = ID_HEIGHT - 1;
  let maxY = 0;
  for (const [, y] of scaled) {
    minY = Math.min(minY, Math.floor(y));
    maxY = Math.max(maxY, Math.ceil(y));
  }
  minY = clamp(minY, 0, ID_HEIGHT - 1);
  maxY = clamp(maxY, 0, ID_HEIGHT - 1);

  for (let py = minY; py <= maxY; py += 1) {
    const scanY = py + 0.5;
    const intersections = [];
    for (let i = 0, j = scaled.length - 1; i < scaled.length; j = i, i += 1) {
      const [xi, yi] = scaled[i];
      const [xj, yj] = scaled[j];
      if ((yi > scanY) !== (yj > scanY)) {
        intersections.push(xi + (scanY - yi) * (xj - xi) / (yj - yi));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = Math.ceil(intersections[i] - 0.5);
      const xEnd = Math.floor(intersections[i + 1] - 0.5);
      for (let px = xStart; px <= xEnd; px += 1) {
        ids[py * ID_WIDTH + wrap(px, ID_WIDTH)] = encodedId;
      }
    }
  }
}

function writeTyped(relativePath, typedArray) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  return writeFile(path.join(OUTPUT, relativePath), bytes);
}

function buildBorders(borderData) {
  const records = [];
  for (const segment of borderData.segments) {
    const neighbor = segment.neighbor_province_id;
    if (neighbor !== null && segment.province_id > neighbor) continue;
    const kind = segment.boundary_kind === 'coastline' ? 0 : 1;
    for (let index = 0; index + 1 < segment.coordinates.length; index += 1) {
      const [x1, y1] = segment.coordinates[index];
      const [x2, y2] = segment.coordinates[index + 1];
      records.push(x1, y1, x2, y2, segment.province_id + 1, neighbor === null ? 0 : neighbor + 1, kind, 0);
    }
  }
  return new Float32Array(records);
}

function buildConnections(connectionData) {
  const records = [];
  for (const edge of connectionData.segments) {
    records.push(edge.x1, edge.y1, edge.x2, edge.y2, edge.medium === 'land' ? 1 : 0, 0, 0, 0);
  }
  return new Float32Array(records);
}

async function main() {
  const [geometry, metadata, markers, borderData, connectionData, networkData, mapMetadata] = await Promise.all([
    readJson('geometry/province_polygons_decoded.json'),
    readJson('metadata/provinces.json'),
    readJson('geometry/terrain_marker_positions.json'),
    readJson('topology/logical_border_segments.json'),
    readJson('movement/connection_segments.json'),
    readJson('movement/network_nodes.json'),
    readJson('metadata/map_metadata.json'),
  ]);

  if (geometry.provinces.length !== 3_303 || metadata.provinces.length !== 3_303) {
    throw new Error('Expected 3,303 provinces in geometry and metadata');
  }

  const expectedOutput = path.resolve(ROOT, 'public', 'world');
  if (path.resolve(OUTPUT) !== expectedOutput) throw new Error(`Refusing to clean unexpected output directory: ${OUTPUT}`);
  await rm(expectedOutput, { recursive: true, force: true });
  await mkdir(expectedOutput, { recursive: true });
  console.log(`Rasterizing ${geometry.provinces.length} provinces at ${ID_WIDTH}x${ID_HEIGHT}…`);
  const provinceIds = new Uint16Array(ID_WIDTH * ID_HEIGHT);
  const geometryById = new Map();
  for (const province of geometry.provinces) {
    geometryById.set(province.province_id, province);
    for (const component of province.components) fillPolygon(provinceIds, component, province.province_id + 1);
  }
  const bankField = buildBankField(provinceIds, ID_WIDTH, ID_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT);

  const metadataById = new Map(metadata.provinces.map((province) => [province.province_id, province]));
  const maximumProvinceId = Math.max(...metadata.provinces.map((province) => province.province_id));
  const areaCounts = new Uint32Array(maximumProvinceId + 2);
  for (const encodedId of provinceIds) areaCounts[encodedId] += 1;

  console.log(`Building ${FIELD_WIDTH}x${FIELD_HEIGHT} terrain fields…`);
  const surface = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT * 4);
  const landField = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const reliefField = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const terrainField = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT);
  const biomeField = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT);
  const provinceField = new Uint16Array(FIELD_WIDTH * FIELD_HEIGHT);

  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    const idY = Math.min(ID_HEIGHT - 1, Math.floor((y + 0.5) / FIELD_HEIGHT * ID_HEIGHT));
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const idX = Math.min(ID_WIDTH - 1, Math.floor((x + 0.5) / FIELD_WIDTH * ID_WIDTH));
      const encodedId = provinceIds[idY * ID_WIDTH + idX];
      const index = y * FIELD_WIDTH + x;
      if (encodedId === 0) {
        terrainField[index] = 255;
        continue;
      }
      const province = metadataById.get(encodedId - 1);
      provinceField[index] = encodedId;
      const terrain = terrainCodes.get(province.terrain_type_id) ?? 0;
      const biome = visualCodes.get(province.visual_terrain_tag ?? '') ?? 0;
      terrainField[index] = terrain;
      biomeField[index] = biome;
      landField[index] = 1;
      reliefField[index] = [12, 46, 126, 30, 10][terrain];
    }
  }

  const coastBlend = blurField(landField.slice(), FIELD_WIDTH, FIELD_HEIGHT, 5, 3);
  const landDistance = distanceToValue(landField, FIELD_WIDTH, FIELD_HEIGHT, 0);
  const oceanDistance = distanceToValue(landField, FIELD_WIDTH, FIELD_HEIGHT, 1);
  const { heights, caps, limits, report: topographyReport } = generateTopography({
    landField, terrainField, provinceField, coastBlend, landDistance, markers, borderData, connectionData, networkData, provinces: metadata.provinces,
  });
  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    const v = y / Math.max(1, FIELD_HEIGHT - 1);
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const index = y * FIELD_WIDTH + x, offset = index * 4;
      if (!landField[index]) {
        surface[offset + 2] = Math.round(clamp(oceanDistance[index] / 42, 0, 1) * 255);
        continue;
      }
      surface[offset] = terrainField[index];
      surface[offset + 1] = biomeField[index];
      surface[offset + 2] = Math.round(fbm(x / FIELD_WIDTH, v) * 255);
      surface[offset + 3] = 255;
    }
  }

  console.log('Packing borders, movement graph, forests, and cities…');
  const borders = buildBorders(borderData);
  const connections = buildConnections(connectionData);

  // The first movement-river pass gives the visual-only detector its exact
  // exclusion mask and provides terrain-aware river samples for valley seating.
  console.log('Preparing terrain-aware river corridors...');
  const preliminaryWaterways = buildWaterways({
    networkData, connectionData, provinceIds, idWidth: ID_WIDTH, idHeight: ID_HEIGHT, heights,
    heightWidth: FIELD_WIDTH, heightHeight: FIELD_HEIGHT, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  console.log('Expanding narrow visual-only river channels...');
  const visualRivers = buildVisualRiverField({
    provinceIds, movementMask: preliminaryWaterways.mask, networkData, connectionData, width: ID_WIDTH, height: ID_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  console.log('Seating river surfaces into surrounding terrain...');
  const riverTerrain = seatRiverTerrain({
    heights, caps, limits, landField, terrainField, fieldWidth: FIELD_WIDTH, fieldHeight: FIELD_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, movementWaterways: preliminaryWaterways,
    visualMask: visualRivers.mask, provinceIds, idWidth: ID_WIDTH, idHeight: ID_HEIGHT,
  });
  Object.assign(topographyReport, riverTerrain.summary);
  topographyReport.riverSeating = riverTerrain.report;

  console.log('Compiling terrain-aware movement and visual river surfaces...');
  const waterways = buildTerrainAwareWaterways({
    visualMask: visualRivers.mask,
    networkData, connectionData, provinceIds, idWidth: ID_WIDTH, idHeight: ID_HEIGHT, heights,
    heightWidth: FIELD_WIDTH, heightHeight: FIELD_HEIGHT, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  visualRivers.report.surface = waterways.report.visualSurface.surface;
  visualRivers.report.surfaceHeightRange = waterways.report.visualSurface.heightRange;
  visualRivers.report.maximumSurfaceGrade = waterways.report.visualSurface.maximumLocalGrade;

  const waterwayField = new Uint8Array(ID_WIDTH * ID_HEIGHT * 2);
  for (let index = 0; index < provinceIds.length; index += 1) {
    waterwayField[index * 2] = waterways.mask[index];
    waterwayField[index * 2 + 1] = visualRivers.mask[index];
  }

  console.log('Compiling direct province-center roads and city placement...');
  const infrastructure = buildInfrastructure({
    borderData, connectionData, networkData, provinces: metadata.provinces, heights, landField,
    fieldWidth: FIELD_WIDTH, fieldHeight: FIELD_HEIGHT, roadFieldWidth: ID_WIDTH, roadFieldHeight: ID_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  const placementClearance = infrastructure.roadClearance.slice();
  for (let index = 0; index < placementClearance.length; index += 1) {
    placementClearance[index] = Math.max(placementClearance[index], waterways.clearance[index], visualRivers.clearance[index]);
  }
  const { trees, buildings } = buildInstances(metadata.provinces, geometryById, provinceIds, areaCounts, placementClearance, infrastructure.cityPlans);

  const provinceRecords = metadata.provinces.map((province) => ({
    id: province.province_id,
    name: province.name,
    terrain: province.terrain_type,
  }));
  const provinceDetails = {
    version: 1,
    provinces: metadata.provinces.map((province) => ({
      id: province.province_id,
      center: [province.center_x, province.center_y],
      terrainId: province.terrain_type_id,
      visualBiome: province.visual_terrain_tag ?? '',
      population: province.population ?? 0,
      coastal: province.coastal_flag,
    })),
  };

  let maxHeight = 0;
  for (const height of heights) maxHeight = Math.max(maxHeight, height);

  const worldGenerationReport = {
    version: 'world-generation-v10',
    topography: topographyReport,
    banks: bankField.report,
    waterways: waterways.report,
    visualRivers: visualRivers.report,
    roads: infrastructure.roadReport,
  };

  const manifest = {
    version: 10,
    source: { mapId: mapMetadata.map_id, mapVersion: mapMetadata.map_version },
    generatedSeed: SEED,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, overlapX: 250, wrapX: true },
    fields: {
      height: { url: 'height.f32', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'r32float' },
      surface: { url: 'surface.rgba8', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'rgba8uint' },
      roads: { url: 'roads.rg8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rg8unorm' },
      waterways: { url: 'waterways.rg8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rg8unorm' },
      coast: { url: 'coast.rg8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rg8unorm' },
      provinceIds: { url: 'province-ids.u16', width: ID_WIDTH, height: ID_HEIGHT, format: 'r16uint' },
    },
    buffers: {
      borders: { url: 'borders.f32', count: borders.length / 8, stride: 8 },
      connections: { url: 'connections.f32', count: connections.length / 8, stride: 8, lazy: true },
      roadVertices: { url: 'road-vertices.f32', count: infrastructure.roadVertices.length / 9, stride: 9 },
      roadIndices: { url: 'road-indices.u32', count: infrastructure.roadIndices.length, stride: 1 },
      hiddenConnectionVertices: { url: 'hidden-connection-vertices.f32', count: infrastructure.hiddenConnectionVertices.length / 9, stride: 9 },
      hiddenConnectionIndices: { url: 'hidden-connection-indices.u32', count: infrastructure.hiddenConnectionIndices.length, stride: 1 },
      waterwayVertices: { url: 'waterway-vertices.f32', count: waterways.vertices.length / 10, stride: 10 },
      waterwayIndices: { url: 'waterway-indices.u32', count: waterways.indices.length, stride: 1 },
      waterwayNetworkLines: { url: 'waterway-network-lines.f32', count: waterways.networkLines.length / 8, stride: 8, lazy: true },
      trees: { url: 'trees.f32', count: trees.length / 8, stride: 8 },
      buildings: { url: 'buildings.f32', count: buildings.length / 8, stride: 8 },
      lamps: { url: 'lamps.f32', count: infrastructure.lamps.length / 8, stride: 8 },
      barriers: { url: 'barriers.f32', count: infrastructure.barriers.length / 8, stride: 8 },
      signs: { url: 'signs.f32', count: infrastructure.signs.length / 8, stride: 8 },
    },
    terrain: { chunksX: 32, chunksY: 16, gridResolution: 49, maxHeight },
    infrastructureChunks: { ...infrastructure.chunkRanges, waterways: waterways.chunkRanges },
    reports: { generation: { url: 'world-generation-report.json', version: worldGenerationReport.version } },
    sidecars: { provinceDetails: { url: 'province-details.json', version: provinceDetails.version } },
    showcases: { ...infrastructure.showcases, ...waterways.showcases },
    counts: {
      provinces: provinceRecords.length,
      borders: borders.length / 8,
      trees: trees.length / 8,
      buildings: buildings.length / 8,
      connections: connections.length / 8,
      ...waterways.stats,
      ...visualRivers.stats,
      ...infrastructure.stats,
      lamps: infrastructure.lamps.length / 8,
      barriers: infrastructure.barriers.length / 8,
      signs: infrastructure.signs.length / 8,
    },
    provinces: provinceRecords,
  };

  await Promise.all([
    writeTyped('province-ids.u16', provinceIds),
    writeTyped('height.f32', heights),
    writeTyped('surface.rgba8', surface),
    writeTyped('roads.rg8', infrastructure.roadField),
    writeTyped('waterways.rg8', waterwayField),
    writeTyped('coast.rg8', bankField.field),
    writeTyped('borders.f32', borders),
    writeTyped('connections.f32', connections),
    writeTyped('road-vertices.f32', infrastructure.roadVertices),
    writeTyped('road-indices.u32', infrastructure.roadIndices),
    writeTyped('hidden-connection-vertices.f32', infrastructure.hiddenConnectionVertices),
    writeTyped('hidden-connection-indices.u32', infrastructure.hiddenConnectionIndices),
    writeTyped('waterway-vertices.f32', waterways.vertices),
    writeTyped('waterway-indices.u32', waterways.indices),
    writeTyped('waterway-network-lines.f32', waterways.networkLines),
    writeTyped('trees.f32', trees),
    writeTyped('buildings.f32', buildings),
    writeTyped('lamps.f32', infrastructure.lamps),
    writeTyped('barriers.f32', infrastructure.barriers),
    writeTyped('signs.f32', infrastructure.signs),
    writeFile(path.join(OUTPUT, 'world-generation-report.json'), `${JSON.stringify(worldGenerationReport, null, 2)}\n`),
    writeFile(path.join(OUTPUT, 'province-details.json'), `${JSON.stringify(provinceDetails)}\n`),
    writeFile(path.join(OUTPUT, 'world.json'), `${JSON.stringify(manifest)}\n`),
  ]);
  console.log(`World assets ready: ${provinceRecords.length} provinces, ${waterways.stats.riverSystems} river systems, ${waterways.stats.canalSystems} canals, ${infrastructure.stats.logicalRoads} logical roads (${infrastructure.stats.emittedRoads} visible, ${infrastructure.stats.hiddenRoads} hidden), ${trees.length / 8} trees, ${buildings.length / 8} buildings.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
