import { FIELD_HEIGHT, FIELD_WIDTH, SEED, WORLD_HEIGHT, WORLD_WIDTH } from './config.mjs';
import { blurField, clamp, smoothstep, wrap } from './raster.mjs';
import { ROAD_MAX_GRADE } from '../infrastructure/common.mjs';
import { assembleProvinceRoutes } from '../infrastructure/province-routes.mjs';

function hash2(x, y, seed = SEED) {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x27d4eb2d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 0xffffffff;
}

function periodicNoise(u, v, cellsX, cellsY) {
  const x = u * cellsX, y = v * cellsY;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const sample = (px, py) => hash2(wrap(px, cellsX), clamp(py, 0, cellsY));
  const top = sample(x0, y0) * (1 - sx) + sample(x0 + 1, y0) * sx;
  const bottom = sample(x0, y0 + 1) * (1 - sx) + sample(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

function fbm(u, v) {
  let value = 0, amplitude = 0.56, normalization = 0;
  for (const [x, y] of [[9, 5], [19, 10], [37, 19], [73, 37]]) {
    value += periodicNoise(u, v, x, y) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
  }
  return value / normalization;
}

function terrainLimit(terrain, hillEnvelope, mountainEnvelope, regionalMountain) {
  const base = terrain === 1 ? 18 : terrain === 2 ? 60 : 8;
  return clamp(Math.max(base,
    8 + hillEnvelope * 10 + mountainEnvelope * 44 + regionalMountain * 8), 8, 60);
}

function slopeLimit(hillEnvelope, mountainEnvelope) {
  return 0.65 + hillEnvelope * 0.50 + mountainEnvelope * 0.85;
}

function cleanAndProject(heights, caps, limits, landField, passes = 10) {
  const width = FIELD_WIDTH, height = FIELD_HEIGHT;
  let source = heights.slice();
  let target = heights.slice();
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!landField[index]) { target[index] = 0; continue; }
        const neighbors = [
          source[index], source[y * width + wrap(x - 1, width)], source[y * width + wrap(x + 1, width)],
          source[Math.max(0, y - 1) * width + x], source[Math.min(height - 1, y + 1) * width + x],
        ].sort((a, b) => a - b);
        const median = neighbors[2];
        const pitTolerance = 0.55 + limits[index] * 0.55;
        let value = clamp(source[index], median - pitTolerance, median + pitTolerance);
        const adjacent = [
          source[y * width + wrap(x - 1, width)], source[y * width + wrap(x + 1, width)],
          source[Math.max(0, y - 1) * width + x], source[Math.min(height - 1, y + 1) * width + x],
        ];
        for (const neighbor of adjacent) value = clamp(value, neighbor - limits[index], neighbor + limits[index]);
        target[index] = clamp(value, 1.2, caps[index]);
      }
    }
    [source, target] = [target, source];
  }
  heights.set(source);
  for (let pass = 0; pass < passes * 3; pass += 1) {
    let violations = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!landField[index]) continue;
        for (const neighbor of [y * width + wrap(x + 1, width), Math.min(height - 1, y + 1) * width + x]) {
          if (neighbor === index || !landField[neighbor]) continue;
          const allowed = (limits[index] + limits[neighbor]) * 0.5;
          const difference = heights[index] - heights[neighbor];
          if (Math.abs(difference) <= allowed + 0.0001) continue;
          violations += 1;
          const high = difference > 0 ? index : neighbor;
          const low = difference > 0 ? neighbor : index;
          let excess = Math.abs(difference) - allowed;
          const lowerHigh = Math.min(excess * 0.5, heights[high] - 1.2);
          heights[high] -= lowerHigh;
          excess -= lowerHigh;
          const raiseLow = Math.min(excess, caps[low] - heights[low]);
          heights[low] += raiseLow;
          excess -= raiseLow;
          if (excess > 0) heights[high] = Math.max(1.2, heights[high] - excess);
        }
      }
    }
    if (!violations) break;
  }
}

function enforceLocalSlopes(heights, limits, landField) {
  const size = heights.length;
  const queue = new Int32Array(size + 1);
  const queued = new Uint8Array(size);
  let head = 0, tail = 0, count = 0, repairs = 0;
  const enqueue = (index) => {
    if (!landField[index] || queued[index]) return;
    queued[index] = 1;
    queue[tail] = index;
    tail = (tail + 1) % queue.length;
    count += 1;
  };
  for (let index = 0; index < size; index += 1) if (landField[index]) enqueue(index);
  while (count) {
    const index = queue[head];
    head = (head + 1) % queue.length;
    count -= 1;
    queued[index] = 0;
    const y = Math.floor(index / FIELD_WIDTH), x = index - y * FIELD_WIDTH;
    const neighbors = [
      y * FIELD_WIDTH + wrap(x - 1, FIELD_WIDTH), y * FIELD_WIDTH + wrap(x + 1, FIELD_WIDTH),
      Math.max(0, y - 1) * FIELD_WIDTH + x, Math.min(FIELD_HEIGHT - 1, y + 1) * FIELD_WIDTH + x,
    ];
    for (const neighbor of neighbors) {
      if (neighbor === index || !landField[neighbor]) continue;
      const allowed = (limits[index] + limits[neighbor]) * 0.5;
      const difference = heights[index] - heights[neighbor];
      if (Math.abs(difference) <= allowed + 0.0001) continue;
      const high = difference > 0 ? index : neighbor;
      const low = difference > 0 ? neighbor : index;
      const nextHeight = Math.max(1.2, heights[low] + allowed);
      if (nextHeight >= heights[high] - 0.0001) continue;
      heights[high] = nextHeight;
      repairs += 1;
      const hy = Math.floor(high / FIELD_WIDTH), hx = high - hy * FIELD_WIDTH;
      enqueue(high);
      enqueue(hy * FIELD_WIDTH + wrap(hx - 1, FIELD_WIDTH));
      enqueue(hy * FIELD_WIDTH + wrap(hx + 1, FIELD_WIDTH));
      enqueue(Math.max(0, hy - 1) * FIELD_WIDTH + hx);
      enqueue(Math.min(FIELD_HEIGHT - 1, hy + 1) * FIELD_WIDTH + hx);
    }
  }
  return repairs;
}

function conditionMovementPaths(heights, caps, limits, landField, terrainField, provinceField, borderData, connectionData, networkData, provinces) {
  const assembled = assembleProvinceRoutes(borderData, connectionData, networkData, provinces, WORLD_WIDTH);
  const baseline = heights.slice();
  const accumulated = new Float32Array(heights.length);
  const classLowerBudgets = [4, 6, 12, 4, 4];
  const classRaiseBudgets = [4, 6, 6, 4, 4];
  const classMeanBudgets = [2.5, 4, 6, 2.5, 2.5];
  const conditionedSegmentKeys = new Set();
  let passes = 0;
  let conditionedSamples = 0;
  for (let pass = 0; pass < 6; pass += 1) {
    const targets = new Float64Array(heights.length);
    const weights = new Float32Array(heights.length);
    let violations = 0;
    for (const route of assembled.routes) {
      for (let segment = 0; segment + 1 < route.points.length; segment += 1) {
        const a = route.points[segment], b = route.points[segment + 1];
        let dx = b.x - a.x;
        if (dx > WORLD_WIDTH * 0.5) dx -= WORLD_WIDTH;
        if (dx < -WORLD_WIDTH * 0.5) dx += WORLD_WIDTH;
        const dz = b.z - a.z;
        const run = Math.max(0.001, Math.hypot(dx, dz));
        const steps = Math.max(1, Math.ceil(run / 8));
        const stepRun = run / steps;
        const samples = [];
        let previousHeight;
        let maximumObservedGrade = 0;
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const x = wrap(a.x + dx * t, WORLD_WIDTH), z = a.z + dz * t;
          const px = wrap(Math.round(x / WORLD_WIDTH * FIELD_WIDTH), FIELD_WIDTH);
          const py = clamp(Math.round(z / WORLD_HEIGHT * FIELD_HEIGHT), 0, FIELD_HEIGHT - 1);
          const index = py * FIELD_WIDTH + px;
          if (!landField[index]) {
            previousHeight = undefined;
            continue;
          }
          const current = heights[index];
          if (previousHeight !== undefined) {
            maximumObservedGrade = Math.max(maximumObservedGrade,
              Math.abs(current - previousHeight) / Math.max(0.001, stepRun));
          }
          previousHeight = current;
          samples.push({ t, px, py, index });
        }
        const gradeExcess = maximumObservedGrade - ROAD_MAX_GRADE;
        if (samples.length < 2 || gradeExcess <= 0.007) continue;
        violations += 1;
        conditionedSegmentKeys.add(`${route.start}:${route.end}:${segment}`);
        // Mildly excessive trails should barely reshape their surroundings;
        // only truly extreme grades approach the full legacy conditioning force.
        const severity = clamp(gradeExcess / 0.16, 0.12, 1);
        const endpointA = heights[clamp(Math.round(a.z / WORLD_HEIGHT * FIELD_HEIGHT), 0, FIELD_HEIGHT - 1) * FIELD_WIDTH
          + wrap(Math.round(a.x / WORLD_WIDTH * FIELD_WIDTH), FIELD_WIDTH)];
        const endpointB = heights[clamp(Math.round(b.z / WORLD_HEIGHT * FIELD_HEIGHT), 0, FIELD_HEIGHT - 1) * FIELD_WIDTH
          + wrap(Math.round(wrap(b.x, WORLD_WIDTH) / WORLD_WIDTH * FIELD_WIDTH), FIELD_WIDTH)];
        for (const samplePoint of samples) {
          const { t, px, py, index } = samplePoint;
          const desired = endpointA * (1 - t) + endpointB * t;
          const terrain = terrainField[index] > 4 ? 0 : terrainField[index];
          const radius = terrain === 2 ? 18 : terrain === 1 ? 14 : 10;
          for (let oy = -radius; oy <= radius; oy += 1) {
            const sy = py + oy;
            if (sy < 0 || sy >= FIELD_HEIGHT) continue;
            for (let ox = -radius; ox <= radius; ox += 1) {
              const distance = Math.hypot(ox, oy);
              if (distance > radius) continue;
              const sx = wrap(px + ox, FIELD_WIDTH), targetIndex = sy * FIELD_WIDTH + sx;
              if (!landField[targetIndex]) continue;
              const influence = Math.exp(-distance * distance / (radius * radius * 0.46)) * severity;
              const classId = terrainField[targetIndex] > 4 ? 0 : terrainField[targetIndex];
              const bounded = clamp(desired, baseline[targetIndex] - classLowerBudgets[classId], baseline[targetIndex] + classRaiseBudgets[classId]);
              targets[targetIndex] += bounded * influence;
              weights[targetIndex] += influence;
            }
          }
        }
      }
    }
    passes = pass + 1;
    if (!violations) break;
    for (let index = 0; index < heights.length; index += 1) {
      if (!weights[index]) continue;
      const terrain = terrainField[index] > 4 ? 0 : terrainField[index];
      const meanBudget = classMeanBudgets[terrain];
      const desired = targets[index] / weights[index];
      const delta = clamp((desired - heights[index]) * 0.38, -meanBudget / 6, meanBudget / 6);
      heights[index] = clamp(heights[index] + delta, 1.2, caps[index]);
      accumulated[index] += Math.abs(delta);
      conditionedSamples += 1;
    }
    cleanAndProject(heights, caps, limits, landField, 3);
    for (let index = 0; index < heights.length; index += 1) {
      if (!landField[index]) continue;
      const terrain = terrainField[index] > 4 ? 0 : terrainField[index];
      heights[index] = clamp(heights[index], baseline[index] - classLowerBudgets[terrain], baseline[index] + classRaiseBudgets[terrain]);
    }
  }
  // Pull the conditioning toward the original topology before the final
  // bounded solve. This keeps even tiny provinces inside their mean budget;
  // the following projection then restores the exact local slope guarantee.
  for (let index = 0; index < heights.length; index += 1) {
    if (landField[index]) heights[index] = baseline[index] + (heights[index] - baseline[index]) * 0.22;
  }
  // The conditioning budget clamp can reintroduce a sharp edge where many
  // movement-path envelopes overlap. Reconcile those edges while staying inside
  // the same immutable per-cell budgets.
  for (let pass = 0; pass < 256; pass += 1) {
    let violations = 0;
    for (let y = 0; y < FIELD_HEIGHT; y += 1) {
      for (let x = 0; x < FIELD_WIDTH; x += 1) {
        const index = y * FIELD_WIDTH + x;
        if (!landField[index]) continue;
        for (const neighbor of [y * FIELD_WIDTH + wrap(x + 1, FIELD_WIDTH), Math.min(FIELD_HEIGHT - 1, y + 1) * FIELD_WIDTH + x]) {
          if (neighbor === index || !landField[neighbor]) continue;
          const allowed = (limits[index] + limits[neighbor]) * 0.5;
          const difference = heights[index] - heights[neighbor];
          if (Math.abs(difference) <= allowed + 0.0001) continue;
          violations += 1;
          const high = difference > 0 ? index : neighbor;
          const low = difference > 0 ? neighbor : index;
          const highTerrain = terrainField[high] > 4 ? 0 : terrainField[high];
          const lowTerrain = terrainField[low] > 4 ? 0 : terrainField[low];
          const highMinimum = baseline[high] - classLowerBudgets[highTerrain];
          const lowMaximum = Math.min(caps[low], baseline[low] + classRaiseBudgets[lowTerrain]);
          let excess = Math.abs(difference) - allowed;
          const lower = Math.min(excess * 0.5, Math.max(0, heights[high] - highMinimum));
          heights[high] -= lower;
          excess -= lower;
          const raise = Math.min(excess, Math.max(0, lowMaximum - heights[low]));
          heights[low] += raise;
          excess -= raise;
          if (excess > 0) heights[high] = Math.max(highMinimum, heights[high] - excess);
        }
      }
    }
    if (!violations) break;
  }
  let maximumAdjustment = 0;
  const provinceMaximum = new Float32Array(provinces.length);
  const provinceSum = new Float64Array(provinces.length);
  const provinceAbsoluteSum = new Float64Array(provinces.length);
  const provinceCount = new Uint32Array(provinces.length);
  for (let index = 0; index < heights.length; index += 1) {
    const adjustment = Math.abs(heights[index] - baseline[index]);
    maximumAdjustment = Math.max(maximumAdjustment, adjustment);
    const provinceId = (provinceField[index] ?? 0) - 1;
    if (provinceId < 0 || provinceId >= provinces.length) continue;
    provinceMaximum[provinceId] = Math.max(provinceMaximum[provinceId], adjustment);
    provinceSum[provinceId] += heights[index] - baseline[index];
    provinceAbsoluteSum[provinceId] += adjustment;
    provinceCount[provinceId] += 1;
  }
  const provinceAdjustments = provinces.map((province) => ({ provinceId: province.province_id,
    maximum: provinceMaximum[province.province_id] ?? 0,
    mean: provinceCount[province.province_id] ? provinceSum[province.province_id] / provinceCount[province.province_id] : 0,
    meanAbsolute: provinceCount[province.province_id] ? provinceAbsoluteSum[province.province_id] / provinceCount[province.province_id] : 0 }));
  return { passes, conditionedSamples, conditionedSegments: conditionedSegmentKeys.size, maximumAdjustment, provinceAdjustments };
}

export function generateTopography({ landField, terrainField, provinceField, coastBlend, landDistance, markers, borderData, connectionData, networkData, provinces }) {
  const mountainMask = new Float32Array(landField.length);
  const hillMask = new Float32Array(landField.length);
  for (let index = 0; index < landField.length; index += 1) {
    mountainMask[index] = terrainField[index] === 2 ? 1 : 0;
    hillMask[index] = terrainField[index] === 1 ? 1 : 0;
  }
  const mountainCore = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 5, 2);
  const mountainShoulder = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 18, 2);
  const mountainCluster = blurField(mountainMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 66, 2);
  const hillShoulder = blurField(hillMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 8, 2);
  const markerField = new Float32Array(landField.length);
  for (const marker of markers.markers) {
    const cx = Math.round(marker.x / WORLD_WIDTH * FIELD_WIDTH), cy = Math.round(marker.y / WORLD_HEIGHT * FIELD_HEIGHT);
    const radius = marker.terrain_type_id === 12 ? 16 : 9;
    for (let oy = -radius; oy <= radius; oy += 1) {
      const py = cy + oy;
      if (py < 0 || py >= FIELD_HEIGHT) continue;
      for (let ox = -radius; ox <= radius; ox += 1) {
        const distance2 = ox * ox + oy * oy;
        if (distance2 > radius * radius) continue;
        const index = py * FIELD_WIDTH + wrap(cx + ox, FIELD_WIDTH);
        markerField[index] = Math.max(markerField[index], Math.exp(-distance2 / (radius * radius * 0.42)));
      }
    }
  }
  const heights = new Float32Array(landField.length);
  const caps = new Float32Array(landField.length);
  const limits = new Float32Array(landField.length);
  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    const v = y / Math.max(1, FIELD_HEIGHT - 1);
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const index = y * FIELD_WIDTH + x;
      if (!landField[index]) continue;
      const u = x / FIELD_WIDTH;
      const noise = fbm(u, v), macro = periodicNoise(u, v, 13, 7);
      const ridge = 1 - Math.abs(periodicNoise(u, v, 31, 16) * 2 - 1);
      const mountain = smoothstep(0.012, 0.72, mountainShoulder[index]);
      const regionalMountain = smoothstep(0.02, 0.18, mountainCluster[index]);
      const hill = clamp(Math.max(smoothstep(0.02, 0.78, hillShoulder[index]), mountain * 0.38), 0, 1);
      caps[index] = terrainLimit(terrainField[index], hill, mountain, regionalMountain);
      limits[index] = slopeLimit(hill, mountain);
      const coast = smoothstep(0.48, 0.995, coastBlend[index]);
      const continental = smoothstep(0, 18, landDistance[index]);
      const base = 1.2 + coast * (1.1 + continental * 1.8 + (macro - 0.5) * 1.4 + (noise - 0.5) * 1.2);
      const hills = hill * (2.8 + noise * 5.8);
      const regionalUplift = regionalMountain * (1.5 + mountainCluster[index] * 4.5);
      const clusterHeight = 14 + mountainCluster[index] * 20;
      const mountains = mountain * (12 + ridge * clusterHeight + mountainCore[index] * 8 + markerField[index] * 3) * 1.12;
      heights[index] = clamp(base + hills + regionalUplift + mountains, 1.2, caps[index]);
    }
  }
  cleanAndProject(heights, caps, limits, landField, 12);
  const slopeRepairs = enforceLocalSlopes(heights, limits, landField);
  const conditioning = conditionMovementPaths(heights, caps, limits, landField, terrainField, provinceField, borderData, connectionData, networkData, provinces);
  let maximumHeight = 0, maximumSlopeStep = 0, capViolations = 0;
  const classMaxima = [0, 0, 0, 0, 0], classMinima = [Infinity, Infinity, Infinity, Infinity, Infinity];
  const classSums = [0, 0, 0, 0, 0], classCounts = [0, 0, 0, 0, 0], classSlopeSteps = [0, 0, 0, 0, 0];
  for (let y = 0; y < FIELD_HEIGHT; y += 1) for (let x = 0; x < FIELD_WIDTH; x += 1) {
    const index = y * FIELD_WIDTH + x;
    if (!landField[index]) continue;
    maximumHeight = Math.max(maximumHeight, heights[index]);
    const terrain = terrainField[index] > 4 ? 0 : terrainField[index];
    classMaxima[terrain] = Math.max(classMaxima[terrain], heights[index]);
    classMinima[terrain] = Math.min(classMinima[terrain], heights[index]);
    classSums[terrain] += heights[index];
    classCounts[terrain] += 1;
    if (heights[index] > caps[index] + 0.001) capViolations += 1;
    const right = y * FIELD_WIDTH + wrap(x + 1, FIELD_WIDTH);
    const down = Math.min(FIELD_HEIGHT - 1, y + 1) * FIELD_WIDTH + x;
    if (landField[right]) {
      const step = Math.abs(heights[index] - heights[right]);
      maximumSlopeStep = Math.max(maximumSlopeStep, step);
      classSlopeSteps[terrain] = Math.max(classSlopeSteps[terrain], step);
    }
    if (landField[down]) {
      const step = Math.abs(heights[index] - heights[down]);
      maximumSlopeStep = Math.max(maximumSlopeStep, step);
      classSlopeSteps[terrain] = Math.max(classSlopeSteps[terrain], step);
    }
  }
  const names = ['ordinary', 'hills', 'mountains', 'forest', 'urban'];
  const terrainClasses = Object.fromEntries(names.map((name, index) => [name, { minimum: classMinima[index],
    maximum: classMaxima[index], mean: classSums[index] / Math.max(1, classCounts[index]), maximumSlopeStep: classSlopeSteps[index] }]));
  return { heights, caps, limits, report: { maximumHeight, maximumSlopeStep, terrainClasses, capViolations, slopeRepairs, conditioning } };
}
