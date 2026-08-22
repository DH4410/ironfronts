import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfrastructure } from './build-infrastructure.mjs';
import { FIELD_HEIGHT, FIELD_WIDTH, ID_HEIGHT, ID_WIDTH, SEED, WORLD_HEIGHT, WORLD_WIDTH } from './world/config.mjs';
import { blurField, clamp, distanceToValue, smoothstep, wrap } from './world/raster.mjs';
import { buildHydrology } from './world/hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL = path.join(ROOT, 'material');
const OUTPUT = path.join(ROOT, 'public', 'world');

const terrainCodes = new Map([
  [10, 0], // plains
  [11, 1], // hills
  [12, 2], // mountain
  [13, 3], // forest
  [14, 4], // urban
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

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
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

function pointProvince(ids, x, y) {
  const px = wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
  const py = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1);
  return ids[py * ID_WIDTH + px];
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

function buildInstances(provinces, geometryById, provinceIds, areaCounts, riverClearance, roadClearance, cityPlans) {
  const trees = [];
  const buildings = [];

  for (const province of provinces) {
    const geometry = geometryById.get(province.province_id);
    if (!geometry) continue;
    const allPoints = geometry.components.flat();
    const minX = Math.min(...allPoints.map((point) => point[0]));
    const maxX = Math.max(...allPoints.map((point) => point[0]));
    const minY = Math.min(...allPoints.map((point) => point[1]));
    const maxY = Math.max(...allPoints.map((point) => point[1]));
    const rng = makeRng(SEED ^ Math.imul(province.province_id + 1, 0x9e3779b1));
    const encodedId = province.province_id + 1;
    const area = areaCounts[encodedId] ?? 0;
    const visual = province.visual_terrain_tag ?? '';
    const isForest = province.terrain_type_id === 13;
    const supportsTrees = isForest || visual === 'Jungle' || visual === 'Boreal';

    if (supportsTrees) {
      const density = isForest ? 1 : 0.35;
      const target = clamp(Math.round(area / 11 * density), 5, isForest ? 90 : 36);
      let placed = 0;
      for (let attempt = 0; attempt < target * 14 && placed < target; attempt += 1) {
        const x = minX + (maxX - minX) * rng();
        const y = minY + (maxY - minY) * rng();
        if (pointProvince(provinceIds, x, y) !== encodedId) continue;
        const riverIndex = clamp(Math.floor(y / WORLD_HEIGHT * FIELD_HEIGHT), 0, FIELD_HEIGHT - 1) * FIELD_WIDTH + wrap(Math.floor(x / WORLD_WIDTH * FIELD_WIDTH), FIELD_WIDTH);
        if (riverClearance[riverIndex] > 0.012) continue;
        const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
        if (roadClearance[roadIndex] > 20) continue;
        const treeType = visual === 'Jungle' ? 2 : visual === 'Boreal' || visual === 'Tundra' ? 1 : 0;
        trees.push(x, y, 0.72 + rng() * 0.72, treeType, rng() * Math.PI * 2, 0.82 + rng() * 0.28, encodedId, 0);
        placed += 1;
      }
    }

    if (province.terrain_type_id === 14) {
      const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
      const target = clamp(Math.round((populationScale - 3) * 17), 12, 54);
      const plan = cityPlans.get(province.province_id);
      const radius = plan?.radius ?? clamp(Math.sqrt(Math.max(30, area)) * 1.9, 9, 38);
      const placedBuildings = [];
      for (let attempt = 0, placed = 0; attempt < target * 56 && placed < target; attempt += 1) {
        const street = plan?.streets[Math.floor(rng() * plan.streets.length)];
        let angle;
        let x;
        let y;
        let distance;
        if (street) {
          const t = 0.08 + rng() * 0.84;
          const dx = street.x2 - street.x1;
          const dy = street.z2 - street.z1;
          angle = Math.atan2(dy, dx);
          const side = rng() < 0.5 ? -1 : 1;
          const setback = 4.4 + rng() * Math.max(5.2, radius * 0.34);
          x = street.x1 + dx * t - Math.sin(angle) * side * setback;
          y = street.z1 + dy * t + Math.cos(angle) * side * setback;
          distance = Math.hypot(x - province.center_x, y - province.center_y);
        } else {
          angle = rng() * Math.PI * 2;
          distance = Math.sqrt(rng()) * radius;
          x = province.center_x + Math.cos(angle) * distance;
          y = province.center_y + Math.sin(angle) * distance * 0.72;
        }
        if (pointProvince(provinceIds, x, y) !== encodedId) continue;
        const riverIndex = clamp(Math.floor(y / WORLD_HEIGHT * FIELD_HEIGHT), 0, FIELD_HEIGHT - 1) * FIELD_WIDTH + wrap(Math.floor(x / WORLD_WIDTH * FIELD_WIDTH), FIELD_WIDTH);
        if (riverClearance[riverIndex] > 0.055) continue;
        const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
        if (roadClearance[roadIndex] > 178) continue;
        const centerBias = 1 - distance / radius;
        let archetype;
        const visual = province.visual_terrain_tag ?? '';
        if (placed === 0 && populationScale > 5.35) archetype = 4;
        else if (rng() < 0.10) archetype = 3;
        else if (visual === 'Desert' || visual === 'Sand Dunes' || visual === 'Mediterranean') archetype = rng() < 0.72 ? 2 : 1;
        else archetype = rng() < 0.46 ? 0 : rng() < 0.72 ? 1 : 2;
        const sx = archetype === 3 ? 5.4 + rng() * 5.2 : 2.8 + rng() * 4.2;
        const sz = archetype === 3 ? 4.8 + rng() * 5.8 : 2.8 + rng() * 4.4;
        if (placedBuildings.some((other) => Math.hypot(other.x - x, other.y - y) < (other.radius + Math.max(sx, sz)) * 0.34)) continue;
        let sy = 4.2 + rng() * 7.5 + Math.max(0, centerBias) * Math.max(0, populationScale - 4) * 3.6;
        if (archetype === 4) sy *= 1.55;
        if (archetype === 3) sy *= 0.68;
        const palette = visual === 'Desert' || visual === 'Sand Dunes' ? 1 : visual === 'Mediterranean' ? 2 : visual === 'Boreal' || visual === 'Tundra' ? 3 : 0;
        buildings.push(x, y, sx, sy, sz, angle + (rng() - 0.5) * 0.08, palette + 0.72 + rng() * 0.24, archetype);
        placedBuildings.push({ x, y, radius: Math.max(sx, sz) });
        placed += 1;
      }
    }
  }

  return { trees: new Float32Array(trees), buildings: new Float32Array(buildings) };
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

  await mkdir(OUTPUT, { recursive: true });
  console.log(`Rasterizing ${geometry.provinces.length} provinces at ${ID_WIDTH}x${ID_HEIGHT}…`);
  const provinceIds = new Uint16Array(ID_WIDTH * ID_HEIGHT);
  const geometryById = new Map();
  for (const province of geometry.provinces) {
    geometryById.set(province.province_id, province);
    for (const component of province.components) fillPolygon(provinceIds, component, province.province_id + 1);
  }
  const coastSource = new Float32Array(provinceIds.length);
  for (let index = 0; index < provinceIds.length; index += 1) coastSource[index] = provinceIds[index] === 0 ? 0 : 1;
  const coastBlendHighResolution = blurField(coastSource, ID_WIDTH, ID_HEIGHT, 2, 2);
  const coastMask = new Uint8Array(provinceIds.length);
  for (let index = 0; index < coastMask.length; index += 1) coastMask[index] = Math.round(clamp(coastBlendHighResolution[index], 0, 1) * 255);

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
  const mountainMask = new Float32Array(landField.length);
  const hillMask = new Float32Array(landField.length);
  for (let index = 0; index < landField.length; index += 1) {
    mountainMask[index] = terrainField[index] === 2 ? 1 : 0;
    hillMask[index] = terrainField[index] === 1 ? 1 : 0;
  }
  // Regional orogeny lifts whole belts, while the tighter masks keep their craggy identity.
  const mountainCore = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 4, 2);
  const mountainShoulder = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 18, 2);
  const mountainRegion = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 46, 2);
  const mountainBelt = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 96, 2);
  const hillShoulder = blurField(hillMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 10, 2);
  const hillRegion = blurField(hillMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 30, 2);
  const markerField = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  for (const marker of markers.markers) {
    const cx = Math.round(marker.x / WORLD_WIDTH * FIELD_WIDTH);
    const cy = Math.round(marker.y / WORLD_HEIGHT * FIELD_HEIGHT);
    const radius = marker.terrain_type_id === 12 ? 13 : 8;
    for (let oy = -radius; oy <= radius; oy += 1) {
      const py = cy + oy;
      if (py < 0 || py >= FIELD_HEIGHT) continue;
      for (let ox = -radius; ox <= radius; ox += 1) {
        const distance2 = ox * ox + oy * oy;
        if (distance2 > radius * radius) continue;
        const px = wrap(cx + ox, FIELD_WIDTH);
        const influence = Math.exp(-distance2 / (radius * radius * 0.31));
        markerField[py * FIELD_WIDTH + px] = Math.max(markerField[py * FIELD_WIDTH + px], influence);
      }
    }
  }

  const heights = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    const v = y / Math.max(1, FIELD_HEIGHT - 1);
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const index = y * FIELD_WIDTH + x;
      const encodedId = provinceIds[Math.min(ID_HEIGHT - 1, Math.floor((y + 0.5) / FIELD_HEIGHT * ID_HEIGHT)) * ID_WIDTH + Math.min(ID_WIDTH - 1, Math.floor((x + 0.5) / FIELD_WIDTH * ID_WIDTH))];
      const offset = index * 4;
      if (encodedId === 0) {
        surface[offset + 3] = 0;
        continue;
      }
      const u = x / FIELD_WIDTH;
      const noise = fbm(u, v);
      const ridged = 1 - Math.abs(noise * 2 - 1);
      const coast = smoothstep(0.48, 0.995, coastBlend[index]);
      const terrain = terrainField[index];
      const macro = periodicNoise(u, v, 13, 7);
      const continentalRise = smoothstep(0, 24, landDistance[index]);
      const regionalUplift = mountainRegion[index] * 34 + mountainBelt[index] * 28 + hillRegion[index] * 10;
      const rollingGround = (macro - 0.42) * 10 + (noise - 0.5) * 5;
      let localRelief = 1.5 + rollingGround;
      const hillRelief = Math.pow(hillShoulder[index], 0.78) * (9 + noise * 18 + ridged * 5);
      const clusterScale = 0.76 + smoothstep(0.02, 0.19, mountainRegion[index]) * 0.62;
      const mountainEnvelope = Math.pow(mountainShoulder[index], 0.72);
      const cragDetail = Math.pow(ridged, 1.38) * (56 + mountainCore[index] * 24) * clusterScale;
      localRelief += hillRelief + mountainEnvelope * (14 + cragDetail);
      if (terrain === 3) {
        localRelief += 5 + noise * 10;
      } else if (terrain === 4) {
        localRelief += 2 + noise * 4;
      }
      const markerScale = 14 + mountainCore[index] * 28 * (0.78 + mountainRegion[index] * 0.72);
      const markerRelief = markerField[index] * markerScale;
      heights[index] = Math.max(1.2, 3 + coast * (continentalRise * 6 + regionalUplift + localRelief + markerRelief));
      surface[offset] = terrain;
      surface[offset + 1] = biomeField[index];
      surface[offset + 2] = Math.round(noise * 255);
      surface[offset + 3] = 255;
    }
  }

  // Keep dense urban props seated on calmer terrain without flattening entire provinces.
  for (const province of metadata.provinces) {
    if (province.terrain_type_id !== 14) continue;
    const cx = Math.round(province.center_x / WORLD_WIDTH * FIELD_WIDTH);
    const cy = Math.round(province.center_y / WORLD_HEIGHT * FIELD_HEIGHT);
    const radius = 5;
    let average = 0;
    let samples = 0;
    for (let oy = -radius; oy <= radius; oy += 1) {
      const py = clamp(cy + oy, 0, FIELD_HEIGHT - 1);
      for (let ox = -radius; ox <= radius; ox += 1) {
        const px = wrap(cx + ox, FIELD_WIDTH);
        average += heights[py * FIELD_WIDTH + px];
        samples += 1;
      }
    }
    average /= samples;
    for (let oy = -radius; oy <= radius; oy += 1) {
      const py = clamp(cy + oy, 0, FIELD_HEIGHT - 1);
      for (let ox = -radius; ox <= radius; ox += 1) {
        const px = wrap(cx + ox, FIELD_WIDTH);
        const distance = Math.hypot(ox, oy) / radius;
        const blend = smoothstep(1, 0.15, distance) * 0.74;
        const index = py * FIELD_WIDTH + px;
        heights[index] += (average - heights[index]) * blend;
      }
    }
  }

  console.log('Packing borders, movement graph, forests, and cities…');
  console.log('Tracing watersheds and carving river channels...');
  const { riverMesh, riverCount, riverMouthCount, riverTexture, riverMask, riverCoreMask, riverClearance, riverBed } = buildHydrology(heights, landField, biomeField);
  for (let index = 0; index < heights.length; index += 1) {
    if (landField[index]) {
      const channel = Math.max(smoothstep(0.08, 0.68, riverCoreMask[index]), smoothstep(0.12, 0.88, riverMask[index]) * 0.78);
      const bedTarget = Number.isFinite(riverBed[index]) ? riverBed[index] - 0.38 : heights[index] - 0.7;
      heights[index] += (Math.min(heights[index], bedTarget) - heights[index]) * channel;
      heights[index] = Math.max(0.62, heights[index]);
    } else {
      surface[index * 4 + 2] = Math.round(clamp(oceanDistance[index] / 42, 0, 1) * 255);
    }
  }

  const borders = buildBorders(borderData);
  const connections = buildConnections(connectionData);
  console.log('Compiling terrain-aware roads, bridges, and city streets...');
  const infrastructure = buildInfrastructure({
    connectionData, networkData, provinces: metadata.provinces, heights, landField, riverMask, riverCoreMask, riverTexture, riverBed,
    fieldWidth: FIELD_WIDTH, fieldHeight: FIELD_HEIGHT, roadFieldWidth: ID_WIDTH, roadFieldHeight: ID_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  // Infrastructure owns the final bounded terrain/hydrology reconciliation.
  // No height mutation is permitted after its audited meshes are emitted.
  const { trees, buildings } = buildInstances(metadata.provinces, geometryById, provinceIds, areaCounts, riverClearance, infrastructure.roadClearance, infrastructure.cityPlans);

  const provinceRecords = metadata.provinces.map((province) => ({
    id: province.province_id,
    name: province.name,
    center: [province.center_x, province.center_y],
    terrainId: province.terrain_type_id,
    terrain: province.terrain_type,
    visualBiome: province.visual_terrain_tag ?? '',
    population: province.population ?? 0,
    coastal: province.coastal_flag,
    infrastructureLevel: infrastructure.provinceLevels.get(province.province_id) ?? 1,
  }));

  let maxHeight = 0;
  for (const height of heights) maxHeight = Math.max(maxHeight, height);

  const manifest = {
    version: 4,
    source: { mapId: mapMetadata.map_id, mapVersion: mapMetadata.map_version },
    generatedSeed: SEED,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, overlapX: 250, wrapX: true },
    fields: {
      height: { url: 'height.f32', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'r32float' },
      surface: { url: 'surface.rgba8', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'rgba8uint' },
      rivers: { url: 'rivers.rgba8', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'rgba8unorm' },
      roads: { url: 'roads.rgba8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rgba8unorm' },
      infrastructureEngineering: { url: 'infrastructure-engineering.rgba8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rgba8unorm' },
      coast: { url: 'coast.r8', width: ID_WIDTH, height: ID_HEIGHT, format: 'r8unorm' },
      provinceIds: { url: 'province-ids.u16', width: ID_WIDTH, height: ID_HEIGHT, format: 'r16uint' },
    },
    buffers: {
      borders: { url: 'borders.f32', count: borders.length / 8, stride: 8 },
      riverVertices: { url: 'river-vertices.f32', count: riverMesh.vertices.length / 8, stride: 8 },
      riverIndices: { url: 'river-indices.u32', count: riverMesh.indices.length, stride: 1 },
      connections: { url: 'connections.f32', count: connections.length / 8, stride: 8, lazy: true },
      roadVertices: { url: 'road-vertices.f32', count: infrastructure.roadVertices.length / 13, stride: 13 },
      roadIndices: { url: 'road-indices.u32', count: infrastructure.roadIndices.length, stride: 1 },
      bridgeVertices: { url: 'bridge-vertices.f32', count: infrastructure.bridgeVertices.length / 13, stride: 13 },
      bridgeIndices: { url: 'bridge-indices.u32', count: infrastructure.bridgeIndices.length, stride: 1 },
      tunnelVertices: { url: 'tunnel-vertices.f32', count: infrastructure.tunnelVertices.length / 13, stride: 13 },
      tunnelIndices: { url: 'tunnel-indices.u32', count: infrastructure.tunnelIndices.length, stride: 1 },
      engineeringVertices: { url: 'engineering-vertices.f32', count: infrastructure.engineeringVertices.length / 13, stride: 13 },
      engineeringIndices: { url: 'engineering-indices.u32', count: infrastructure.engineeringIndices.length, stride: 1 },
      corridorMetrics: { url: 'corridor-metrics.f32', count: infrastructure.corridorMetrics.length / 8, stride: 8, lazy: true },
      corridorFlags: { url: 'corridor-flags.u32', count: infrastructure.corridorFlags.length / 4, stride: 4, lazy: true },
      connectionCorridorOffsets: { url: 'connection-corridor-offsets.u32', count: infrastructure.connectionCorridorOffsets.length, stride: 1, lazy: true },
      connectionCorridorIds: { url: 'connection-corridor-ids.u32', count: infrastructure.connectionCorridorIds.length, stride: 1, lazy: true },
      trees: { url: 'trees.f32', count: trees.length / 8, stride: 8 },
      buildings: { url: 'buildings.f32', count: buildings.length / 8, stride: 8 },
      lamps: { url: 'lamps.f32', count: infrastructure.lamps.length / 8, stride: 8 },
      barriers: { url: 'barriers.f32', count: infrastructure.barriers.length / 8, stride: 8 },
      signs: { url: 'signs.f32', count: infrastructure.signs.length / 8, stride: 8 },
    },
    terrain: { chunksX: 32, chunksY: 16, gridResolution: 49, maxHeight },
    infrastructureChunks: infrastructure.chunkRanges,
    reports: { infrastructure: { url: 'infrastructure-report.json', version: infrastructure.infrastructureReport.version } },
    showcases: infrastructure.showcases,
    counts: {
      provinces: provinceRecords.length,
      borders: borders.length / 8,
      trees: trees.length / 8,
      buildings: buildings.length / 8,
      connections: connections.length / 8,
      rivers: riverCount,
      riverMouths: riverMouthCount,
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
    writeTyped('rivers.rgba8', riverTexture),
    writeTyped('roads.rgba8', infrastructure.roadField),
    writeTyped('infrastructure-engineering.rgba8', infrastructure.engineeringField),
    writeTyped('coast.r8', coastMask),
    writeTyped('river-vertices.f32', riverMesh.vertices),
    writeTyped('river-indices.u32', riverMesh.indices),
    writeTyped('borders.f32', borders),
    writeTyped('connections.f32', connections),
    writeTyped('road-vertices.f32', infrastructure.roadVertices),
    writeTyped('road-indices.u32', infrastructure.roadIndices),
    writeTyped('bridge-vertices.f32', infrastructure.bridgeVertices),
    writeTyped('bridge-indices.u32', infrastructure.bridgeIndices),
    writeTyped('tunnel-vertices.f32', infrastructure.tunnelVertices),
    writeTyped('tunnel-indices.u32', infrastructure.tunnelIndices),
    writeTyped('engineering-vertices.f32', infrastructure.engineeringVertices),
    writeTyped('engineering-indices.u32', infrastructure.engineeringIndices),
    writeTyped('corridor-metrics.f32', infrastructure.corridorMetrics),
    writeTyped('corridor-flags.u32', infrastructure.corridorFlags),
    writeTyped('connection-corridor-offsets.u32', infrastructure.connectionCorridorOffsets),
    writeTyped('connection-corridor-ids.u32', infrastructure.connectionCorridorIds),
    writeTyped('trees.f32', trees),
    writeTyped('buildings.f32', buildings),
    writeTyped('lamps.f32', infrastructure.lamps),
    writeTyped('barriers.f32', infrastructure.barriers),
    writeTyped('signs.f32', infrastructure.signs),
    writeFile(path.join(OUTPUT, 'infrastructure-report.json'), `${JSON.stringify(infrastructure.infrastructureReport, null, 2)}\n`),
    writeFile(path.join(OUTPUT, 'world.json'), `${JSON.stringify(manifest)}\n`),
  ]);

  const digest = createHash('sha256')
    .update(Buffer.from(provinceIds.buffer))
    .update(Buffer.from(heights.buffer))
    .update(Buffer.from(surface.buffer))
    .update(Buffer.from(riverTexture.buffer))
    .update(Buffer.from(infrastructure.roadField.buffer))
    .update(Buffer.from(infrastructure.engineeringField.buffer))
    .update(Buffer.from(coastMask.buffer))
    .update(Buffer.from(riverMesh.vertices.buffer))
    .update(Buffer.from(riverMesh.indices.buffer))
    .update(Buffer.from(borders.buffer))
    .update(Buffer.from(connections.buffer))
    .update(Buffer.from(infrastructure.roadVertices.buffer))
    .update(Buffer.from(infrastructure.roadIndices.buffer))
    .update(Buffer.from(infrastructure.bridgeVertices.buffer))
    .update(Buffer.from(infrastructure.bridgeIndices.buffer))
    .update(Buffer.from(infrastructure.tunnelVertices.buffer))
    .update(Buffer.from(infrastructure.tunnelIndices.buffer))
    .update(Buffer.from(infrastructure.engineeringVertices.buffer))
    .update(Buffer.from(infrastructure.engineeringIndices.buffer))
    .update(Buffer.from(infrastructure.corridorMetrics.buffer))
    .update(Buffer.from(infrastructure.corridorFlags.buffer))
    .update(Buffer.from(infrastructure.connectionCorridorOffsets.buffer))
    .update(Buffer.from(infrastructure.connectionCorridorIds.buffer))
    .update(Buffer.from(trees.buffer))
    .update(Buffer.from(buildings.buffer))
    .digest('hex');
  await writeFile(path.join(OUTPUT, 'build.json'), `${JSON.stringify({ digest }, null, 2)}\n`);
  console.log(`World assets ready: ${provinceRecords.length} provinces, ${riverCount} river reaches, ${infrastructure.stats.logicalRoutes} roads, ${infrastructure.stats.bridges} bridges, ${trees.length / 8} trees, ${buildings.length / 8} buildings.`);
  console.log(`Digest ${digest}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
