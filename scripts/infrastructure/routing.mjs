import {
  LEVEL_WIDTHS, MAX_GRADES, ROLE_CONNECTOR, ROLE_LOCAL, ROLE_TRUNK, ROLE_WIDTH_SCALE, TAU, clamp, sampleHeight,
  sampleScalar, smoothstep, unwrapNear, wrap,
} from './common.mjs';
import { refineRiverSegments } from './network.mjs';

function smoothAndResample(source, spacing, worldWidth) {
  let points = source.map((point) => ({ ...point }));
  for (let pass = 0; pass < 2 && points.length > 2; pass += 1) {
    const next = [points[0]];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      next.push({ x: a.x * 0.72 + b.x * 0.28, z: a.z * 0.72 + b.z * 0.28 });
      next.push({ x: a.x * 0.28 + b.x * 0.72, z: a.z * 0.28 + b.z * 0.72 });
    }
    next.push(points.at(-1));
    points = next;
  }
  const sampled = [{ ...points[0] }];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      sampled.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  for (const point of sampled) point.x = wrap(point.x, worldWidth);
  return sampled;
}

export function moveToValidLand(point, landField, riverMask, width, height, worldWidth, worldHeight, avoidRiver, preferredSide = 0, flow = [0, 0]) {
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
        const index = pz * width + px;
        if (landField[index] < 0.5 || avoidRiver && riverMask[index] > 0.05) continue;
        const wx = (px + 0.5) / width * worldWidth;
        const wz = (pz + 0.5) / height * worldHeight;
        let dx = unwrapNear(wx, point.x, worldWidth) - point.x;
        const dz = wz - point.z;
        let penalty = Math.hypot(dx, dz);
        if (preferredSide) {
          const side = Math.sign((-flow[1]) * dx + flow[0] * dz);
          if (side && side !== preferredSide) penalty += 80;
        }
        if (!fallback || penalty < fallback.penalty) fallback = { x: wrap(point.x + dx, worldWidth), z: wz, penalty };
        let coastSafe = true;
        for (let sy = -1; sy <= 1 && coastSafe; sy += 1) {
          const sampleZ = pz + sy;
          if (sampleZ < 0 || sampleZ >= height) { coastSafe = false; break; }
          for (let sx = -1; sx <= 1; sx += 1) if (landField[sampleZ * width + wrap(px + sx, width)] < 0.5) { coastSafe = false; break; }
        }
        if (!coastSafe) continue;
        if (!best || penalty < best.penalty) best = { x: wrap(point.x + dx, worldWidth), z: wz, penalty };
      }
    }
    if (best) return best;
  }
  return fallback ?? point;
}

function optimizeRouteThroughTerrain(points, route, context) {
  const { heights, landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  if (points.length < 3) return;
  const original = points.map((point) => ({ ...point }));
  const maximumOffset = route.corridorRole === ROLE_TRUNK ? 24 : route.corridorRole === ROLE_CONNECTOR ? 18 : 12;
  const step = maximumOffset / 3;
  const offsets = [-3, -2, -1, 0, 1, 2, 3].map((value) => value * step);
  const maximumGrade = MAX_GRADES[clamp(route.infrastructureLevel - 1, 0, 4)];
  const lattice = original.map((point, index) => {
    const previous = original[Math.max(0, index - 1)];
    const next = original[Math.min(original.length - 1, index + 1)];
    let tx = unwrapNear(next.x, previous.x, worldWidth) - previous.x;
    let tz = next.z - previous.z;
    const length = Math.max(0.001, Math.hypot(tx, tz));
    tx /= length; tz /= length;
    const nx = -tz, nz = tx;
    const choices = index === 0 || index === original.length - 1 ? [0] : offsets;
    return choices.map((offset) => {
      const candidate = { x: wrap(point.x + nx * offset, worldWidth), z: point.z + nz * offset, offset, nx, nz };
      const land = sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z);
      candidate.valid = land >= 0.5 && candidate.z >= 0 && candidate.z <= worldHeight;
      candidate.height = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z);
      candidate.river = sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z);
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
        const deviation = Math.abs(current.offset) / Math.max(1, maximumOffset);
        const gradeExcess = Math.max(0, grade - maximumGrade);
        const transitionCost = grade * grade * 34 + gradeExcess * gradeExcess * 420
          + offsetDelta * offsetDelta * 0.035 + deviation * deviation * 0.16
          + current.river * (route.corridorRole === ROLE_TRUNK ? 2.8 : 5.6);
        const total = costs[index - 1][priorIndex] + transitionCost;
        if (total < costs[index][currentIndex]) {
          costs[index][currentIndex] = total;
          previousChoice[index][currentIndex] = priorIndex;
        }
      }
    }
  }
  let selected = 0;
  for (let index = 1; index < costs.at(-1).length; index += 1) if (costs.at(-1)[index] < costs.at(-1)[selected]) selected = index;
  const chosenOffsets = new Float32Array(points.length);
  for (let index = points.length - 1; index >= 0; index -= 1) {
    chosenOffsets[index] = lattice[index][selected]?.offset ?? 0;
    selected = index ? Math.max(0, previousChoice[index][selected]) : 0;
  }
  // Smooth the selected lateral band as one curve. This prevents the alternating
  // left/right decisions which produced the mountain sawteeth in the old compiler.
  for (let pass = 0; pass < 4; pass += 1) {
    const source = chosenOffsets.slice();
    for (let index = 1; index + 1 < chosenOffsets.length; index += 1) {
      chosenOffsets[index] = source[index] * 0.44 + (source[index - 1] + source[index + 1]) * 0.28;
    }
  }
  for (let index = 1; index + 1 < points.length; index += 1) {
    const base = lattice[index].find((candidate) => candidate.offset === 0) ?? lattice[index][0];
    const candidate = { x: wrap(original[index].x + base.nx * chosenOffsets[index], worldWidth), z: original[index].z + base.nz * chosenOffsets[index] };
    if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z) >= 0.5) points[index] = candidate;
  }
}

export function adaptRoute(route, context) {
  const { landField, riverMask, riverCoreMask, riverTexture, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  let points = smoothAndResample(route.points, 6.8, worldWidth);
  for (let index = 0; index < points.length; index += 1) {
    const fx = wrap(Math.floor(points[index].x / worldWidth * fieldWidth), fieldWidth);
    const fz = clamp(Math.floor(points[index].z / worldHeight * fieldHeight), 0, fieldHeight - 1);
    const coastUnsafe = landField[fz * fieldWidth + fx] < 0.5 || [[-1,0],[1,0],[0,-1],[0,1]].some(([ox, oz]) => {
      const pz = fz + oz;
      return pz < 0 || pz >= fieldHeight || landField[pz * fieldWidth + wrap(fx + ox, fieldWidth)] < 0.5;
    });
    if (coastUnsafe) {
      points[index] = moveToValidLand(points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, false);
    }
  }
  optimizeRouteThroughTerrain(points, route, context);
  for (let index = 0; index < points.length; index += 1) {
    if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, points[index].x, points[index].z) < 0.5) {
      points[index] = moveToValidLand(points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, false);
    }
  }

  points = refineRiverSegments(points, riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight);
  for (let index = 0; index < points.length; index += 1) {
    if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, points[index].x, points[index].z) < 0.5) {
      points[index] = moveToValidLand(points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, false);
    }
  }

  const bridges = [];
  let cursor = 0;
  while (cursor < points.length) {
    const wet = sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight, points[cursor].x, points[cursor].z) > 0.10;
    if (!wet) { cursor += 1; continue; }
    let end = cursor;
    while (end + 1 < points.length && sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight, points[end + 1].x, points[end + 1].z) > 0.06) end += 1;
    let wetStart = cursor;
    let wetEnd = end;
    while (wetStart > 0 && sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, points[wetStart - 1].x, points[wetStart - 1].z) > 0.10) wetStart -= 1;
    while (wetEnd + 1 < points.length && sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, points[wetEnd + 1].x, points[wetEnd + 1].z) > 0.10) wetEnd += 1;
    // Two dry samples provide modeled approach ramps and keep the abutments out
    // of the feathered wet bank.
    const before = Math.max(0, wetStart - 2);
    const after = Math.min(points.length - 1, wetEnd + 2);
    const midpoint = points[Math.floor((cursor + end) * 0.5)];
    const fieldX = wrap(Math.floor(midpoint.x / worldWidth * fieldWidth), fieldWidth);
    const fieldZ = clamp(Math.floor(midpoint.z / worldHeight * fieldHeight), 0, fieldHeight - 1);
    const textureOffset = (fieldZ * fieldWidth + fieldX) * 4;
    const flow = [riverTexture[textureOffset + 1] / 127.5 - 1, riverTexture[textureOffset + 2] / 127.5 - 1];
    const flowLength = Math.max(0.001, Math.hypot(flow[0], flow[1]));
    flow[0] /= flowLength; flow[1] /= flowLength;
    const normal = [-flow[1], flow[0]];
    const bx = unwrapNear(points[before].x, midpoint.x, worldWidth) - midpoint.x;
    const bz = points[before].z - midpoint.z;
    const ax = unwrapNear(points[after].x, midpoint.x, worldWidth) - midpoint.x;
    const az = points[after].z - midpoint.z;
    const sideBefore = Math.sign(bx * normal[0] + bz * normal[1]);
    const sideAfter = Math.sign(ax * normal[0] + az * normal[1]);
    const roadX = unwrapNear(points[after].x, points[before].x, worldWidth) - points[before].x;
    const roadZ = points[after].z - points[before].z;
    const roadLength = Math.max(0.001, Math.hypot(roadX, roadZ));
    const acrossAlignment = Math.abs(roadX / roadLength * normal[0] + roadZ / roadLength * normal[1]);
    const span = Math.hypot(roadX, roadZ);
    const crossesBanks = sideBefore * sideAfter < 0 || acrossAlignment > 0.35;
    const isCrossing = before < wetStart && after > wetEnd && crossesBanks && span < 78;
    if (isCrossing) {
      bridges.push({ start: before, end: after, coreStart: cursor, coreEnd: end });
    } else {
      const preferredSide = sideBefore || sideAfter || 1;
      for (let index = wetStart; index <= wetEnd; index += 1) {
        points[index] = moveToValidLand(points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, true, preferredSide, flow);
      }
    }
    cursor = wetEnd + 1;
  }

  // Merge overlapping bridge intervals and annotate samples.
  bridges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const bridge of bridges) {
    const previous = merged.at(-1);
    if (previous && bridge.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, bridge.end);
      previous.coreStart = Math.min(previous.coreStart, bridge.coreStart);
      previous.coreEnd = Math.max(previous.coreEnd, bridge.coreEnd);
    }
    else merged.push({ ...bridge });
  }
  route.points = points;
  route.bridges = merged;
}

export function buildSharedGateways(routes, nodes, provinces, context) {
  const provinceById = new Map(provinces.map((province) => [province.province_id, province]));
  const approachesByProvince = new Map();
  for (const route of routes) {
    for (const atStart of [true, false]) {
      const endpoint = atStart ? route.start : route.end;
      const node = nodes.get(endpoint);
      if (node?.kind !== 'province_center') continue;
      const center = atStart ? route.points[0] : route.points.at(-1);
      const neighbor = atStart ? route.points[Math.min(3, route.points.length - 1)] : route.points[Math.max(0, route.points.length - 4)];
      let dx = unwrapNear(neighbor.x, center.x, context.worldWidth) - center.x;
      let dz = neighbor.z - center.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      dx /= length; dz /= length;
      if (!approachesByProvince.has(node.location_id)) approachesByProvince.set(node.location_id, []);
      approachesByProvince.get(node.location_id).push({ route, atStart, dx, dz, weight: 1 + route.corridorRole * 1.6 + route.importance });
    }
  }

  const gatewayRoutes = [];
  for (const [provinceId, approaches] of approachesByProvince) {
    const province = provinceById.get(provinceId);
    if (!province || !approaches.length) continue;
    approaches.sort((a, b) => b.weight - a.weight || a.route.id - b.route.id);
    const clusters = [];
    for (const approach of approaches) {
      let bestIndex = -1;
      let bestAngle = Number.POSITIVE_INFINITY;
      for (let index = 0; index < clusters.length; index += 1) {
        const cluster = clusters[index];
        const angle = Math.acos(clamp(approach.dx * cluster.dx + approach.dz * cluster.dz, -1, 1));
        if (angle < bestAngle) { bestAngle = angle; bestIndex = index; }
      }
      if (clusters.length < 3 && bestAngle > 0.82) {
        clusters.push({ dx: approach.dx, dz: approach.dz, weight: approach.weight, members: [approach] });
      } else {
        const cluster = clusters[Math.max(0, bestIndex)];
        cluster.dx = cluster.dx * cluster.weight + approach.dx * approach.weight;
        cluster.dz = cluster.dz * cluster.weight + approach.dz * approach.weight;
        cluster.weight += approach.weight;
        const length = Math.max(0.001, Math.hypot(cluster.dx, cluster.dz));
        cluster.dx /= length; cluster.dz /= length;
        cluster.members.push(approach);
      }
    }
    const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
    const radius = province.terrain_type_id === 14 ? clamp(13 + (populationScale - 4) * 6, 13, 25) : 9.5;
    for (const cluster of clusters) {
      const center = { x: province.center_x, z: province.center_y };
      const minimumReach = Math.min(...cluster.members.map((member) => {
        const far = member.atStart ? member.route.points.at(-1) : member.route.points[0];
        return Math.hypot(unwrapNear(far.x, center.x, context.worldWidth) - center.x, far.z - center.z);
      }));
      const gatewayRadius = clamp(Math.min(radius, minimumReach * 0.34), 4.5, radius);
      let gateway = { x: wrap(center.x + cluster.dx * gatewayRadius, context.worldWidth), z: center.z + cluster.dz * gatewayRadius };
      if (sampleScalar(context.landField, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, gateway.x, gateway.z) < 0.5
        || sampleScalar(context.riverMask, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, gateway.x, gateway.z) > 0.16) {
        gateway = moveToValidLand(gateway, context.landField, context.riverMask, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, true);
      }
      const level = Math.max(...cluster.members.map((member) => member.route.infrastructureLevel));
      const role = Math.max(...cluster.members.map((member) => member.route.corridorRole));
      const gatewayRoute = {
        id: routes.length + gatewayRoutes.length,
        start: nodes.size ? cluster.members[0].atStart ? cluster.members[0].route.start : cluster.members[0].route.end : -1,
        end: -1,
        nodeIds: [], segmentIds: [], provinceIds: [provinceId],
        points: smoothAndResample([center, gateway], 4.6, context.worldWidth),
        infrastructureLevel: level, corridorRole: role, roadClass: role,
        importance: Math.max(...cluster.members.map((member) => member.route.importance)),
        bridges: [], gateway: true, provinceId,
      };
      for (const member of cluster.members) {
        if (member.atStart) {
          let join = 1;
          while (join + 1 < member.route.points.length) {
            const point = member.route.points[join];
            const distance = Math.hypot(unwrapNear(point.x, center.x, context.worldWidth) - center.x, point.z - center.z);
            if (distance >= gatewayRadius * 1.3) break;
            join += 1;
          }
          member.route.points = [{ ...gateway }, ...member.route.points.slice(join)];
          member.route.startGateway = gatewayRoute.id;
        } else {
          let join = member.route.points.length - 2;
          while (join > 0) {
            const point = member.route.points[join];
            const distance = Math.hypot(unwrapNear(point.x, center.x, context.worldWidth) - center.x, point.z - center.z);
            if (distance >= gatewayRadius * 1.3) break;
            join -= 1;
          }
          member.route.points = [...member.route.points.slice(0, join + 1), { ...gateway }];
          member.route.endGateway = gatewayRoute.id;
        }
      }
      gatewayRoutes.push(gatewayRoute);
    }
  }
  routes.push(...gatewayRoutes);
  return gatewayRoutes.length;
}

export function buildCityPlans(routes, nodes, provinces) {
  const incoming = new Map();
  for (const route of routes) {
    for (const endpoint of [route.start, route.end]) {
      const node = nodes.get(endpoint);
      if (node?.kind !== 'province_center') continue;
      const atStart = endpoint === route.start;
      if (!route.gateway && (atStart ? route.startGateway !== undefined : route.endGateway !== undefined)) continue;
      const center = atStart ? route.points[0] : route.points.at(-1);
      const neighbor = atStart ? route.points[Math.min(3, route.points.length - 1)] : route.points[Math.max(0, route.points.length - 4)];
      let dx = unwrapNear(neighbor.x, center.x, 13_562) - center.x;
      let dz = neighbor.z - center.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      dx /= length; dz /= length;
      if (!incoming.has(node.location_id)) incoming.set(node.location_id, []);
      incoming.get(node.location_id).push({ dx, dz, roadClass: route.corridorRole, importance: route.importance });
    }
  }
  const plans = new Map();
  for (const province of provinces) {
    if (province.terrain_type_id !== 14) continue;
    const approaches = incoming.get(province.province_id) ?? [];
    approaches.sort((a, b) => b.roadClass - a.roadClass || b.importance - a.importance);
    const primary = approaches[0] ?? { dx: 1, dz: 0, roadClass: ROLE_CONNECTOR };
    const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
    const radius = clamp(17 + (populationScale - 4) * 8, 16, 35);
    const perpendicular = { dx: -primary.dz, dz: primary.dx };
    const streets = [];
    streets.push({ x1: province.center_x - primary.dx * radius, z1: province.center_y - primary.dz * radius, x2: province.center_x + primary.dx * radius, z2: province.center_y + primary.dz * radius });
    streets.push({ x1: province.center_x - perpendicular.dx * radius * 0.78, z1: province.center_y - perpendicular.dz * radius * 0.78, x2: province.center_x + perpendicular.dx * radius * 0.78, z2: province.center_y + perpendicular.dz * radius * 0.78 });
    if (populationScale > 5.15) {
      for (const offset of [-radius * 0.42, radius * 0.42]) {
        streets.push({
          x1: province.center_x + perpendicular.dx * offset - primary.dx * radius * 0.68,
          z1: province.center_y + perpendicular.dz * offset - primary.dz * radius * 0.68,
          x2: province.center_x + perpendicular.dx * offset + primary.dx * radius * 0.68,
          z2: province.center_y + perpendicular.dz * offset + primary.dz * radius * 0.68,
        });
      }
    }
    plans.set(province.province_id, { center: [province.center_x, province.center_y], radius, primary, perpendicular, streets, populationScale,
      infrastructureLevel: province.infrastructureLevel ?? 1 });
  }
  return plans;
}

export function addLocalStreets(routes, cityPlans, context) {
  for (const [provinceId, plan] of cityPlans) {
    const acceptedStreets = [];
    for (const street of plan.streets) {
      const points = smoothAndResample([{ x: street.x1, z: street.z1 }, { x: street.x2, z: street.z2 }], 4.8, context.worldWidth);
      if (points.some((point) => sampleScalar(context.landField, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, point.x, point.z) < 0.5
        || sampleScalar(context.riverMask, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, point.x, point.z) >= 0.22)) continue;
      if (points.length < 2) continue;
      routes.push({ id: routes.length, start: -1, end: -1, nodeIds: [], segmentIds: [], provinceIds: [provinceId], points,
        infrastructureLevel: plan.infrastructureLevel, corridorRole: ROLE_LOCAL, roadClass: ROLE_LOCAL, importance: 0, bridges: [], localStreet: true, provinceId });
      acceptedStreets.push(street);
    }
    const plazaRadius = clamp(3.0 + (plan.streets.length - 2) * 0.34, 3.0, 4.5);
    const plazaPoints = [];
    for (let step = 0; step <= 14; step += 1) {
      const angle = step / 14 * TAU;
      plazaPoints.push({ x: plan.center[0] + Math.cos(angle) * plazaRadius, z: plan.center[1] + Math.sin(angle) * plazaRadius });
    }
    if (plazaPoints.every((point) => sampleScalar(context.landField, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, point.x, point.z) > 0.5
      && sampleScalar(context.riverMask, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, point.x, point.z) < 0.22)) {
      routes.push({ id: routes.length, start: -1, end: -1, nodeIds: [], segmentIds: [], provinceIds: [provinceId], points: plazaPoints,
        infrastructureLevel: plan.infrastructureLevel, corridorRole: ROLE_LOCAL, roadClass: ROLE_LOCAL, importance: 0, bridges: [], localStreet: true, plaza: true, provinceId });
    }
    plan.streets = acceptedStreets;
  }
}
