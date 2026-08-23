import { ROAD_MAX_GRADE, clamp, sampleHeight, sampleScalar, unwrapNear, wrap } from './common.mjs';

function smoothAndResample(source, spacing, worldWidth) {
  let points = source.map((point) => ({ ...point }));
  for (let pass = 0; pass < 2 && points.length > 2; pass += 1) {
    const next = [points[0]];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const bx = unwrapNear(b.x, a.x, worldWidth);
      next.push({ x: a.x * 0.72 + bx * 0.28, z: a.z * 0.72 + b.z * 0.28 });
      next.push({ x: a.x * 0.28 + bx * 0.72, z: a.z * 0.28 + b.z * 0.72 });
    }
    next.push(points.at(-1));
    points = next;
  }
  const sampled = [{ ...points[0] }];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const bx = unwrapNear(b.x, a.x, worldWidth);
    const length = Math.hypot(bx - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      sampled.push({ x: a.x + (bx - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  for (const point of sampled) point.x = wrap(point.x, worldWidth);
  return sampled;
}

function moveToValidLand(point, landField, width, height, worldWidth, worldHeight) {
  const fx = wrap(point.x, worldWidth) / worldWidth * width;
  const fz = point.z / worldHeight * height;
  const cx = Math.round(fx);
  const cz = Math.round(fz);
  let best;
  let fallback;
  for (let radius = 0; radius <= 10; radius += 1) {
    for (let oz = -radius; oz <= radius; oz += 1) {
      const pz = cz + oz;
      if (pz < 0 || pz >= height) continue;
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (radius && Math.abs(ox) !== radius && Math.abs(oz) !== radius) continue;
        const px = wrap(cx + ox, width);
        if (landField[pz * width + px] < 0.5) continue;
        const wx = (px + 0.5) / width * worldWidth;
        const wz = (pz + 0.5) / height * worldHeight;
        const dx = unwrapNear(wx, point.x, worldWidth) - point.x;
        const penalty = Math.hypot(dx, wz - point.z);
        if (!fallback || penalty < fallback.penalty) fallback = { x: wrap(point.x + dx, worldWidth), z: wz, penalty };
        let coastSafe = true;
        for (let sy = -1; sy <= 1 && coastSafe; sy += 1) {
          const sampleZ = pz + sy;
          if (sampleZ < 0 || sampleZ >= height) { coastSafe = false; break; }
          for (let sx = -1; sx <= 1; sx += 1) {
            if (landField[sampleZ * width + wrap(px + sx, width)] < 0.5) { coastSafe = false; break; }
          }
        }
        if (coastSafe && (!best || penalty < best.penalty)) best = { x: wrap(point.x + dx, worldWidth), z: wz, penalty };
      }
    }
    if (best) return best;
  }
  return fallback ?? point;
}

function optimizeRouteThroughTerrain(points, context) {
  const { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  if (points.length < 3) return;
  const original = points.map((point) => ({ ...point }));
  const maximumOffset = 12;
  const offsets = [-3, -2, -1, 0, 1, 2, 3].map((value) => value * maximumOffset / 3);
  const lattice = original.map((point, index) => {
    const previous = original[Math.max(0, index - 1)];
    const next = original[Math.min(original.length - 1, index + 1)];
    let tx = unwrapNear(next.x, previous.x, worldWidth) - previous.x;
    let tz = next.z - previous.z;
    const length = Math.max(0.001, Math.hypot(tx, tz));
    tx /= length;
    tz /= length;
    const nx = -tz;
    const nz = tx;
    const choices = index === 0 || index === original.length - 1 ? [0] : offsets;
    return choices.map((offset) => {
      const candidate = { x: wrap(point.x + nx * offset, worldWidth), z: point.z + nz * offset, offset, nx, nz };
      candidate.valid = candidate.z >= 0 && candidate.z <= worldHeight
        && sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z) >= 0.5;
      candidate.height = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z);
      return candidate;
    });
  });
  const costs = lattice.map((choices) => new Float64Array(choices.length).fill(Number.POSITIVE_INFINITY));
  const previousChoice = lattice.map((choices) => new Int16Array(choices.length).fill(-1));
  costs[0][0] = 0;
  for (let index = 1; index < lattice.length; index += 1) {
    for (let currentIndex = 0; currentIndex < lattice[index].length; currentIndex += 1) {
      const current = lattice[index][currentIndex];
      if (!current.valid) continue;
      for (let priorIndex = 0; priorIndex < lattice[index - 1].length; priorIndex += 1) {
        const prior = lattice[index - 1][priorIndex];
        if (!prior.valid || !Number.isFinite(costs[index - 1][priorIndex])) continue;
        const run = Math.max(1, Math.hypot(unwrapNear(current.x, prior.x, worldWidth) - prior.x, current.z - prior.z));
        const grade = Math.abs(current.height - prior.height) / run;
        const offsetDelta = current.offset - prior.offset;
        const deviation = Math.abs(current.offset) / maximumOffset;
        const gradeExcess = Math.max(0, grade - ROAD_MAX_GRADE);
        const total = costs[index - 1][priorIndex] + grade * grade * 34 + gradeExcess * gradeExcess * 420
          + offsetDelta * offsetDelta * 0.035 + deviation * deviation * 0.16;
        if (total < costs[index][currentIndex]) {
          costs[index][currentIndex] = total;
          previousChoice[index][currentIndex] = priorIndex;
        }
      }
    }
  }
  let selected = 0;
  for (let index = 1; index < costs.at(-1).length; index += 1) {
    if (costs.at(-1)[index] < costs.at(-1)[selected]) selected = index;
  }
  const chosenOffsets = new Float32Array(points.length);
  for (let index = points.length - 1; index >= 0; index -= 1) {
    chosenOffsets[index] = lattice[index][selected]?.offset ?? 0;
    selected = index ? Math.max(0, previousChoice[index][selected]) : 0;
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const source = chosenOffsets.slice();
    for (let index = 1; index + 1 < chosenOffsets.length; index += 1) {
      chosenOffsets[index] = source[index] * 0.44 + (source[index - 1] + source[index + 1]) * 0.28;
    }
  }
  for (let index = 1; index + 1 < points.length; index += 1) {
    const base = lattice[index].find((candidate) => candidate.offset === 0) ?? lattice[index][0];
    const candidate = {
      x: wrap(original[index].x + base.nx * chosenOffsets[index], worldWidth),
      z: original[index].z + base.nz * chosenOffsets[index],
    };
    if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z) >= 0.5) points[index] = candidate;
  }
}

export function adaptRoute(route, context) {
  const { landField, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  let points = smoothAndResample(route.points, 4, worldWidth);
  for (let index = 0; index < points.length; index += 1) {
    const fx = wrap(Math.floor(points[index].x / worldWidth * fieldWidth), fieldWidth);
    const fz = clamp(Math.floor(points[index].z / worldHeight * fieldHeight), 0, fieldHeight - 1);
    const coastUnsafe = landField[fz * fieldWidth + fx] < 0.5 || [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([ox, oz]) => {
      const pz = fz + oz;
      return pz < 0 || pz >= fieldHeight || landField[pz * fieldWidth + wrap(fx + ox, fieldWidth)] < 0.5;
    });
    if (coastUnsafe) points[index] = moveToValidLand(points[index], landField, fieldWidth, fieldHeight, worldWidth, worldHeight);
  }
  optimizeRouteThroughTerrain(points, context);
  for (let pass = 0; pass < 2; pass += 1) {
    const source = points.map((point) => ({ ...point }));
    for (let index = 1; index + 1 < points.length; index += 1) {
      const candidate = {
        x: wrap(source[index].x * 0.54 + (unwrapNear(source[index - 1].x, source[index].x, worldWidth)
          + unwrapNear(source[index + 1].x, source[index].x, worldWidth)) * 0.23, worldWidth),
        z: source[index].z * 0.54 + (source[index - 1].z + source[index + 1].z) * 0.23,
      };
      if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z) >= 0.5) points[index] = candidate;
    }
  }
  route.points = smoothAndResample(points, 2, worldWidth);
}
