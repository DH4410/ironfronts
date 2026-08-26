import { sampleHeight } from '../infrastructure/common.mjs';
import { clamp, wrap } from './raster.mjs';

export const VISUAL_WATERWAY_KIND = 0.25;
export const VISUAL_WATERWAY_THRESHOLD = 0.45;
const WATER_SURFACE_LIFT = 0.08;

function isActive(mask, index) {
  return (mask[index] ?? 0) / 255 > VISUAL_WATERWAY_THRESHOLD;
}

function worldCenter(x, y, width, height, worldWidth, worldHeight) {
  return [(x + 0.5) / width * worldWidth, (y + 0.5) / height * worldHeight];
}

function maximumNeighborGrade(records, slotByIndex, width, height, pixelWidth, pixelHeight) {
  let maximum = 0;
  for (const record of records) {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const ny = record.y + dy;
      if (ny < 0 || ny >= height) continue;
      const nx = wrap(record.x + dx, width);
      const slot = slotByIndex.get(ny * width + nx);
      if (slot === undefined) continue;
      const run = Math.hypot(dx * pixelWidth, dy * pixelHeight);
      maximum = Math.max(maximum, Math.abs(record.height - records[slot].height) / Math.max(0.001, run));
    }
  }
  return maximum;
}

export function solveVisualWaterwayHeights({ visualMask, width, height, worldWidth, worldHeight, heights, heightWidth, heightHeight }) {
  const started = performance.now();
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const records = [];
  const slotByIndex = new Map();
  let minimumHeight = Infinity;
  let maximumHeight = -Infinity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!isActive(visualMask, index)) continue;
      const [worldX, worldZ] = worldCenter(x, y, width, height, worldWidth, worldHeight);
      const waterHeight = sampleHeight(
        heights, heightWidth, heightHeight, worldWidth, worldHeight, worldX, worldZ,
      ) + WATER_SURFACE_LIFT;
      slotByIndex.set(index, records.length);
      records.push({ index, x, y, height: waterHeight });
      minimumHeight = Math.min(minimumHeight, waterHeight);
      maximumHeight = Math.max(maximumHeight, waterHeight);
    }
  }

  minimumHeight = Infinity;
  maximumHeight = -Infinity;
  for (const record of records) {
    minimumHeight = Math.min(minimumHeight, record.height);
    maximumHeight = Math.max(maximumHeight, record.height);
  }
  return {
    records,
    slotByIndex,
    report: {
      activePixels: records.length,
      heightRange: records.length ? [minimumHeight, maximumHeight] : [0, 0],
      maximumLocalGrade: maximumNeighborGrade(records, slotByIndex, width, height, pixelWidth, pixelHeight),
      heightMethod: 'direct terrain sample plus constant lift',
      buildMilliseconds: performance.now() - started,
    },
  };
}

function principalFlow(record, slotByIndex, width, height, pixelWidth, pixelHeight) {
  let xx = 0, xy = 0, yy = 0, weight = 0;
  for (let oy = -2; oy <= 2; oy += 1) {
    const py = record.y + oy;
    if (py < 0 || py >= height) continue;
    for (let ox = -2; ox <= 2; ox += 1) {
      if (!ox && !oy) continue;
      const px = wrap(record.x + ox, width);
      if (slotByIndex.get(py * width + px) === undefined) continue;
      const dx = ox * pixelWidth;
      const dz = oy * pixelHeight;
      const w = 1 / Math.max(1, Math.hypot(dx, dz));
      xx += dx * dx * w;
      xy += dx * dz * w;
      yy += dz * dz * w;
      weight += w;
    }
  }
  if (!weight) return [1, 0];
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let fx = Math.cos(angle), fz = Math.sin(angle);
  if (fx < -0.0001 || (Math.abs(fx) <= 0.0001 && fz < 0)) { fx = -fx; fz = -fz; }
  return [fx, fz];
}

function cornerEdgeFactor(cx, cy, slotByIndex, width, height) {
  let active = 0;
  for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const py = cy + oy;
    if (py < 0 || py >= height) continue;
    const px = wrap(cx + ox, width);
    if (slotByIndex.get(py * width + px) !== undefined) active += 1;
  }
  return clamp(1 - Math.max(0, active - 1) * 0.25, 0.25, 1);
}

function sortIndicesByChunk(indices, batches, chunksX, chunksY) {
  const byChunk = Array.from({ length: chunksX * chunksY }, () => []);
  for (const batch of batches) byChunk[batch.chunk].push(batch);
  const sorted = new Uint32Array(indices.length);
  const ranges = [];
  let cursor = 0;
  for (const chunk of byChunk) {
    const firstIndex = cursor;
    for (const batch of chunk) {
      for (let index = batch.firstIndex; index < batch.firstIndex + batch.indexCount; index += 1) sorted[cursor++] = indices[index];
    }
    ranges.push({ firstIndex, indexCount: cursor - firstIndex });
  }
  return { indices: sorted, ranges };
}

export function buildVisualWaterways({ visualMask, provinceIds, width, height, worldWidth, worldHeight, heights, heightWidth, heightHeight, chunksX = 32, chunksY = 16 }) {
  const started = performance.now();
  const solved = solveVisualWaterwayHeights({ visualMask, provinceIds, width, height, worldWidth, worldHeight, heights, heightWidth, heightHeight });
  const { records, slotByIndex } = solved;
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const vertices = [];
  const indices = [];
  const batches = [];
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);
  const addVertex = (position, uv, edgeFactor, flow, speed) => {
    const vertex = vertices.length / 10;
    vertices.push(...position, ...uv, edgeFactor, VISUAL_WATERWAY_KIND, ...flow, speed);
    return vertex;
  };

  for (const record of records) {
    const x0 = record.x / width * worldWidth;
    const x1 = (record.x + 1) / width * worldWidth;
    const z0 = record.y / height * worldHeight;
    const z1 = (record.y + 1) / height * worldHeight;
    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const flow = principalFlow(record, slotByIndex, width, height, pixelWidth, pixelHeight);
    const speed = 0.46 + 0.08 * Math.sin(record.index * 0.017);
    const center = addVertex([cx, record.height + 0.018, cz], [cx / 24, cz / 24], 0, flow, speed);
    const corners = [
      [x0, z0, record.x, record.y], [x1, z0, record.x + 1, record.y],
      [x1, z1, record.x + 1, record.y + 1], [x0, z1, record.x, record.y + 1],
    ].map(([x, z, gx, gy]) => addVertex([x, sampleHeight(
      heights, heightWidth, heightHeight, worldWidth, worldHeight, x, z,
    ) + WATER_SURFACE_LIFT, z],
      [x / 24, z / 24], cornerEdgeFactor(gx, gy, slotByIndex, width, height), flow, speed * 0.48));
    const firstIndex = indices.length;
    indices.push(center, corners[0], corners[1], center, corners[1], corners[2],
      center, corners[2], corners[3], center, corners[3], corners[0]);
    batches.push({ chunk: chunkFor(cx, cz), firstIndex, indexCount: 12 });
  }

  const sorted = sortIndicesByChunk(indices, batches, chunksX, chunksY);
  return {
    vertices: new Float32Array(vertices),
    indices: sorted.indices,
    chunkRanges: sorted.ranges,
    report: {
      ...solved.report,
      surface: 'terrain-aware explicit visual-river mesh',
      kind: VISUAL_WATERWAY_KIND,
      triangles: sorted.indices.length / 3,
      totalBuildMilliseconds: performance.now() - started,
    },
  };
}
