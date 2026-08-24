import { clamp, wrap } from './raster.mjs';
import { solveVisualWaterwayHeights } from './visual-waterways.mjs';
import { smoothMovementWaterwayGrades } from './waterway-smoothing.mjs';

function seatSamples({ heights, baseline, landField, fieldWidth, fieldHeight, worldWidth, worldHeight,
  samples, radius, halfWidth, sideGrade, maximumCut }) {
  const pixelWidth = worldWidth / fieldWidth;
  const pixelHeight = worldHeight / fieldHeight;
  let adjustedCells = 0;
  let maximumAdjustment = 0;
  let totalAdjustment = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.z) || !Number.isFinite(sample.y)) continue;
    const cx = wrap(Math.floor(wrap(sample.x, worldWidth) / worldWidth * fieldWidth), fieldWidth);
    const cy = clamp(Math.floor(sample.z / worldHeight * fieldHeight), 0, fieldHeight - 1);
    const rx = Math.ceil(radius / pixelWidth);
    const ry = Math.ceil(radius / pixelHeight);
    for (let oy = -ry; oy <= ry; oy += 1) {
      const py = cy + oy;
      if (py < 0 || py >= fieldHeight) continue;
      for (let ox = -rx; ox <= rx; ox += 1) {
        const px = wrap(cx + ox, fieldWidth);
        const index = py * fieldWidth + px;
        if (!landField[index]) continue;
        const worldX = (px + 0.5) / fieldWidth * worldWidth;
        const worldZ = (py + 0.5) / fieldHeight * worldHeight;
        let dx = worldX - sample.x;
        if (dx > worldWidth * 0.5) dx -= worldWidth;
        if (dx < -worldWidth * 0.5) dx += worldWidth;
        const distance = Math.hypot(dx, worldZ - sample.z);
        if (distance > radius) continue;
        const bankDistance = Math.max(0, distance - halfWidth);
        const ceiling = sample.y + 0.42 + bankDistance * sideGrade;
        const minimum = baseline[index] - maximumCut;
        const target = Math.max(minimum, ceiling);
        if (target >= heights[index] - 0.0001) continue;
        const influence = Math.pow(1 - distance / radius, 2);
        const next = Math.max(target, heights[index] + (target - heights[index]) * influence);
        if (next >= heights[index] - 0.0001) continue;
        const adjustment = heights[index] - next;
        heights[index] = next;
        adjustedCells += 1;
        maximumAdjustment = Math.max(maximumAdjustment, baseline[index] - heights[index]);
        totalAdjustment += adjustment;
      }
    }
  }
  return { adjustedCells, maximumAdjustment, totalAdjustment };
}

function enforceLocalSlopes(heights, limits, landField, width, height) {
  const queue = new Int32Array(heights.length + 1);
  const queued = new Uint8Array(heights.length);
  let head = 0, tail = 0, count = 0, repairs = 0;
  const enqueue = (index) => {
    if (!landField[index] || queued[index]) return;
    queued[index] = 1;
    queue[tail] = index;
    tail = (tail + 1) % queue.length;
    count += 1;
  };
  for (let index = 0; index < heights.length; index += 1) if (landField[index]) enqueue(index);
  while (count) {
    const index = queue[head];
    head = (head + 1) % queue.length;
    count -= 1;
    queued[index] = 0;
    const y = Math.floor(index / width), x = index - y * width;
    const neighbors = [
      y * width + wrap(x - 1, width), y * width + wrap(x + 1, width),
      Math.max(0, y - 1) * width + x, Math.min(height - 1, y + 1) * width + x,
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
      const hy = Math.floor(high / width), hx = high - hy * width;
      enqueue(high);
      enqueue(hy * width + wrap(hx - 1, width));
      enqueue(hy * width + wrap(hx + 1, width));
      enqueue(Math.max(0, hy - 1) * width + hx);
      enqueue(Math.min(height - 1, hy + 1) * width + hx);
    }
  }
  return repairs;
}

function summarizeTopography(heights, caps, limits, landField, terrainField, width, height) {
  let maximumHeight = 0, maximumSlopeStep = 0, capViolations = 0;
  const classMaxima = [0, 0, 0, 0, 0], classMinima = [Infinity, Infinity, Infinity, Infinity, Infinity];
  const classSums = [0, 0, 0, 0, 0], classCounts = [0, 0, 0, 0, 0], classSlopeSteps = [0, 0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (!landField[index]) continue;
    const terrain = terrainField[index] > 4 ? 0 : terrainField[index];
    maximumHeight = Math.max(maximumHeight, heights[index]);
    classMaxima[terrain] = Math.max(classMaxima[terrain], heights[index]);
    classMinima[terrain] = Math.min(classMinima[terrain], heights[index]);
    classSums[terrain] += heights[index];
    classCounts[terrain] += 1;
    if (heights[index] > caps[index] + 0.001) capViolations += 1;
    for (const neighbor of [y * width + wrap(x + 1, width), Math.min(height - 1, y + 1) * width + x]) {
      if (neighbor === index || !landField[neighbor]) continue;
      const step = Math.abs(heights[index] - heights[neighbor]);
      maximumSlopeStep = Math.max(maximumSlopeStep, step);
      classSlopeSteps[terrain] = Math.max(classSlopeSteps[terrain], step);
    }
  }
  const names = ['ordinary', 'hills', 'mountains', 'forest', 'urban'];
  const terrainClasses = Object.fromEntries(names.map((name, index) => [name, {
    minimum: classMinima[index], maximum: classMaxima[index],
    mean: classSums[index] / Math.max(1, classCounts[index]), maximumSlopeStep: classSlopeSteps[index],
  }]));
  return { maximumHeight, maximumSlopeStep, capViolations, terrainClasses };
}

export function seatRiverTerrain({
  heights, caps, limits, landField, terrainField, fieldWidth, fieldHeight,
  worldWidth, worldHeight, movementWaterways, visualMask, provinceIds, idWidth, idHeight,
}) {
  const started = performance.now();
  const baseline = heights.slice();
  const movementSmoothing = smoothMovementWaterwayGrades(movementWaterways.vertices);
  const movementSamples = [];
  const vertices = movementWaterways.vertices;
  for (let vertex = 0; vertex < vertices.length / 10; vertex += 1) {
    const offset = vertex * 10;
    const edgeFactor = vertices[offset + 5];
    const kind = vertices[offset + 6];
    if (edgeFactor > 0.02 || kind > 0.10) continue;
    movementSamples.push({ x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] });
  }
  const visualSolved = solveVisualWaterwayHeights({
    visualMask, provinceIds, width: idWidth, height: idHeight, worldWidth, worldHeight,
    heights, heightWidth: fieldWidth, heightHeight: fieldHeight,
  });
  const visualSamples = visualSolved.records.map((record) => ({
    x: (record.x + 0.5) / idWidth * worldWidth,
    y: record.height,
    z: (record.y + 0.5) / idHeight * worldHeight,
  }));
  const movement = seatSamples({ heights, baseline, landField, fieldWidth, fieldHeight, worldWidth, worldHeight,
    samples: movementSamples, radius: 28, halfWidth: 6.5, sideGrade: 0.40, maximumCut: 6 });
  const visual = seatSamples({ heights, baseline, landField, fieldWidth, fieldHeight, worldWidth, worldHeight,
    samples: visualSamples, radius: 16, halfWidth: 3.8, sideGrade: 0.45, maximumCut: 4 });
  const slopeRepairs = enforceLocalSlopes(heights, limits, landField, fieldWidth, fieldHeight);
  const summary = summarizeTopography(heights, caps, limits, landField, terrainField, fieldWidth, fieldHeight);
  let finalMaximumCut = 0, finalCutSum = 0, finalAdjustedCells = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const cut = baseline[index] - heights[index];
    if (cut <= 0.0001) continue;
    finalAdjustedCells += 1;
    finalMaximumCut = Math.max(finalMaximumCut, cut);
    finalCutSum += cut;
  }
  return {
    summary: { maximumHeight: summary.maximumHeight, maximumSlopeStep: summary.maximumSlopeStep, capViolations: summary.capViolations },
    report: {
      finalTopography: summary,
      method: 'lower-only local river seating with strict slope reconciliation',
      movementSamples: movementSamples.length,
      movementSmoothing,
      visualSamples: visualSamples.length,
      adjustedCells: finalAdjustedCells,
      maximumCut: finalMaximumCut,
      meanCut: finalCutSum / Math.max(1, finalAdjustedCells),
      slopeRepairs,
      movementPass: movement,
      visualPass: visual,
      preliminaryVisualSurface: visualSolved.report,
      buildMilliseconds: performance.now() - started,
    },
  };
}
