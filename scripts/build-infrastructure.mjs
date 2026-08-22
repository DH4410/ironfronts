const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, size) => ((value % size) + size) % size;
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function unwrapNear(x, reference, width) {
  while (x - reference > width * 0.5) x -= width;
  while (x - reference < -width * 0.5) x += width;
  return x;
}

function percentileRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Float32Array(values.length);
  const divisor = Math.max(1, values.length - 1);
  for (let index = 0; index < sorted.length; index += 1) ranks[sorted[index].index] = index / divisor;
  return ranks;
}

function sampleScalar(field, width, height, worldWidth, worldHeight, x, z) {
  const px = wrap(Math.floor(wrap(x, worldWidth) / worldWidth * width), width);
  const py = clamp(Math.floor(z / worldHeight * height), 0, height - 1);
  return field[py * width + px] ?? 0;
}

function sampleHeight(field, width, height, worldWidth, worldHeight, x, z) {
  const fx = wrap(x, worldWidth) / worldWidth * width - 0.5;
  const fz = clamp(z / worldHeight * height - 0.5, 0, height - 1);
  const x0Raw = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0Raw;
  const tz = fz - z0;
  const x0 = wrap(x0Raw, width);
  const x1 = wrap(x0 + 1, width);
  const z1 = Math.min(height - 1, z0 + 1);
  const top = field[z0 * width + x0] * (1 - tx) + field[z0 * width + x1] * tx;
  const bottom = field[z1 * width + x0] * (1 - tx) + field[z1 * width + x1] * tx;
  return top * (1 - tz) + bottom * tz;
}

function assembleRoutes(connectionData, networkData, worldWidth) {
  const nodes = new Map(networkData.nodes.map((node) => [node.node_id, node]));
  const land = connectionData.segments.filter((segment) => segment.medium === 'land');
  const adjacency = new Map();
  for (const edge of land) {
    if (!adjacency.has(edge.node_a)) adjacency.set(edge.node_a, []);
    if (!adjacency.has(edge.node_b)) adjacency.set(edge.node_b, []);
    adjacency.get(edge.node_a).push({ node: edge.node_b, edge });
    adjacency.get(edge.node_b).push({ node: edge.node_a, edge });
  }
  const significant = (id) => nodes.get(id)?.kind === 'province_center' || adjacency.get(id)?.length !== 2;
  const visited = new Set();
  const routes = [];
  const walk = (start, first) => {
    const nodeIds = [start];
    const segmentIds = [];
    let previous = start;
    let current = first.node;
    let edge = first.edge;
    while (true) {
      visited.add(edge.segment_id);
      segmentIds.push(edge.segment_id);
      nodeIds.push(current);
      if (significant(current)) break;
      const next = adjacency.get(current).find((entry) => entry.node !== previous && !visited.has(entry.edge.segment_id));
      if (!next) break;
      previous = current;
      current = next.node;
      edge = next.edge;
    }
    const points = [];
    for (const id of nodeIds) {
      const node = nodes.get(id);
      const reference = points.length ? points.at(-1).x : node.x;
      points.push({ x: points.length ? unwrapNear(node.x, reference, worldWidth) : node.x, z: node.y });
    }
    return { id: routes.length, start: nodeIds[0], end: nodeIds.at(-1), nodeIds, segmentIds, points };
  };

  for (const [id, entries] of adjacency) {
    if (!significant(id)) continue;
    for (const entry of entries) if (!visited.has(entry.edge.segment_id)) routes.push(walk(id, entry));
  }
  for (const edge of land) {
    if (visited.has(edge.segment_id)) continue;
    routes.push(walk(edge.node_a, { node: edge.node_b, edge }));
  }
  return { routes, nodes, adjacency, landSegmentCount: land.length };
}

function rankRoutes(routes, nodes, provinces) {
  const graphNodes = [...new Set(routes.flatMap((route) => [route.start, route.end]))];
  const indexByNode = new Map(graphNodes.map((id, index) => [id, index]));
  const graph = graphNodes.map(() => []);
  for (const route of routes) {
    const a = indexByNode.get(route.start);
    const b = indexByNode.get(route.end);
    if (a === b) continue;
    graph[a].push({ to: b, route: route.id });
    graph[b].push({ to: a, route: route.id });
  }

  // Sampled Brandes edge betweenness is stable at this scale and avoids making world builds quadratic.
  const centrality = new Float64Array(routes.length);
  const sourceStep = Math.max(1, Math.floor(graph.length / 1150));
  for (let source = 0; source < graph.length; source += sourceStep) {
    const stack = [];
    const predecessors = graph.map(() => []);
    const paths = new Float64Array(graph.length);
    const distance = new Int32Array(graph.length);
    distance.fill(-1);
    paths[source] = 1;
    distance[source] = 0;
    const queue = [source];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const vertex = queue[cursor];
      stack.push(vertex);
      for (const edge of graph[vertex]) {
        if (distance[edge.to] < 0) {
          distance[edge.to] = distance[vertex] + 1;
          queue.push(edge.to);
        }
        if (distance[edge.to] === distance[vertex] + 1) {
          paths[edge.to] += paths[vertex];
          predecessors[edge.to].push({ from: vertex, route: edge.route });
        }
      }
    }
    const dependency = new Float64Array(graph.length);
    while (stack.length) {
      const vertex = stack.pop();
      for (const predecessor of predecessors[vertex]) {
        const share = paths[vertex] ? paths[predecessor.from] / paths[vertex] * (1 + dependency[vertex]) : 0;
        centrality[predecessor.route] += share;
        dependency[predecessor.from] += share;
      }
    }
  }

  const provinceById = new Map(provinces.map((province) => [province.province_id, province]));
  const populations = routes.map((route) => {
    const start = nodes.get(route.start);
    const end = nodes.get(route.end);
    return Math.log10(Math.max(1_000,
      provinceById.get(start?.location_id)?.population ?? 0,
      provinceById.get(end?.location_id)?.population ?? 0));
  });
  const centralityRank = percentileRanks([...centrality]);
  const populationRank = percentileRanks(populations);
  const scores = routes.map((_, index) => centralityRank[index] * 0.65 + populationRank[index] * 0.35);
  const scoreRank = percentileRanks(scores);
  for (let index = 0; index < routes.length; index += 1) {
    routes[index].importance = scores[index];
    routes[index].roadClass = scoreRank[index] >= 0.88 ? 2 : scoreRank[index] >= 0.55 ? 1 : 0;
  }
}

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

function moveToValidLand(point, landField, riverMask, width, height, worldWidth, worldHeight, avoidRiver, preferredSide = 0, flow = [0, 0]) {
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
        if (landField[index] < 0.5 || avoidRiver && riverMask[index] > 0.16) continue;
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

function relaxRouteThroughTerrain(points, routeId, context) {
  const { heights, landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  for (let pass = 0; pass < 2; pass += 1) {
    const order = pass ? [...Array(points.length - 2)].map((_, index) => points.length - 2 - index) : [...Array(points.length - 2)].map((_, index) => index + 1);
    for (const index of order) {
      const previous = points[index - 1];
      const current = points[index];
      const next = points[index + 1];
      const nextX = unwrapNear(next.x, previous.x, worldWidth);
      let tx = nextX - previous.x;
      let tz = next.z - previous.z;
      const tangentLength = Math.max(0.001, Math.hypot(tx, tz));
      tx /= tangentLength; tz /= tangentLength;
      const nx = -tz, nz = tx;
      const previousHeight = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, previous.x, previous.z);
      const nextHeight = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, next.x, next.z);
      const currentHeight = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, current.x, current.z);
      const baseGrade = (Math.abs(currentHeight - previousHeight) + Math.abs(nextHeight - currentHeight)) / Math.max(1, tangentLength);
      let best = { point: current, cost: Number.POSITIVE_INFINITY };
      for (const offset of [-14, -7, 0, 7, 14]) {
        const candidate = { x: wrap(current.x + nx * offset, worldWidth), z: current.z + nz * offset };
        if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z) < 0.5) continue;
        const candidateHeight = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z);
        const runA = Math.max(1, Math.hypot(unwrapNear(candidate.x, previous.x, worldWidth) - previous.x, candidate.z - previous.z));
        const runB = Math.max(1, Math.hypot(unwrapNear(next.x, candidate.x, worldWidth) - candidate.x, next.z - candidate.z));
        const gradeA = Math.abs(candidateHeight - previousHeight) / runA;
        const gradeB = Math.abs(nextHeight - candidateHeight) / runB;
        const ax = (unwrapNear(candidate.x, previous.x, worldWidth) - previous.x) / runA;
        const az = (candidate.z - previous.z) / runA;
        const bx = (unwrapNear(next.x, candidate.x, worldWidth) - candidate.x) / runB;
        const bz = (next.z - candidate.z) / runB;
        const turnCost = 1 - clamp(ax * bx + az * bz, -1, 1);
        const river = sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, candidate.x, candidate.z);
        const switchbackTarget = baseGrade > 0.26 ? Math.sin(index * 0.72 + routeId * 1.91) * 10 : 0;
        const cost = (gradeA * gradeA + gradeB * gradeB) * 34 + turnCost * 1.8 + Math.abs(offset) * 0.013
          + river * 5.4 + Math.abs(offset - switchbackTarget) * (baseGrade > 0.26 ? 0.018 : 0);
        if (cost < best.cost) best = { point: candidate, cost };
      }
      points[index] = best.point;
    }
  }
}

function adaptRoute(route, context) {
  const { landField, riverMask, riverTexture, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  const points = smoothAndResample(route.points, 6.8, worldWidth);
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
  relaxRouteThroughTerrain(points, route.id, context);
  for (let index = 0; index < points.length; index += 1) {
    if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, points[index].x, points[index].z) < 0.5) {
      points[index] = moveToValidLand(points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, false);
    }
  }

  const bridges = [];
  let cursor = 0;
  while (cursor < points.length) {
    const wet = sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, points[cursor].x, points[cursor].z) > 0.30;
    if (!wet) { cursor += 1; continue; }
    let end = cursor;
    while (end + 1 < points.length && sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, points[end + 1].x, points[end + 1].z) > 0.18) end += 1;
    const before = Math.max(0, cursor - 1);
    const after = Math.min(points.length - 1, end + 1);
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
    const isCrossing = before < cursor && after > end && sideBefore * sideAfter < 0 && acrossAlignment > 0.32 && span < 78;
    if (isCrossing) {
      bridges.push({ start: before, end: after });
    } else {
      const preferredSide = sideBefore || sideAfter || 1;
      for (let index = cursor; index <= end; index += 1) {
        points[index] = moveToValidLand(points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, true, preferredSide, flow);
      }
    }
    cursor = end + 1;
  }

  // Merge overlapping bridge intervals and annotate samples.
  bridges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const bridge of bridges) {
    const previous = merged.at(-1);
    if (previous && bridge.start <= previous.end + 2) previous.end = Math.max(previous.end, bridge.end);
    else merged.push({ ...bridge });
  }
  route.points = points;
  route.bridges = merged;
}

function buildCityPlans(routes, nodes, provinces) {
  const incoming = new Map();
  for (const route of routes) {
    for (const endpoint of [route.start, route.end]) {
      const node = nodes.get(endpoint);
      if (node?.kind !== 'province_center') continue;
      const atStart = endpoint === route.start;
      const center = atStart ? route.points[0] : route.points.at(-1);
      const neighbor = atStart ? route.points[Math.min(3, route.points.length - 1)] : route.points[Math.max(0, route.points.length - 4)];
      let dx = unwrapNear(neighbor.x, center.x, 13_562) - center.x;
      let dz = neighbor.z - center.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      dx /= length; dz /= length;
      if (!incoming.has(node.location_id)) incoming.set(node.location_id, []);
      incoming.get(node.location_id).push({ dx, dz, roadClass: route.roadClass, importance: route.importance });
    }
  }
  const plans = new Map();
  for (const province of provinces) {
    if (province.terrain_type_id !== 14) continue;
    const approaches = incoming.get(province.province_id) ?? [];
    approaches.sort((a, b) => b.roadClass - a.roadClass || b.importance - a.importance);
    const primary = approaches[0] ?? { dx: 1, dz: 0, roadClass: 1 };
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
    plans.set(province.province_id, { center: [province.center_x, province.center_y], radius, primary, perpendicular, streets, populationScale });
  }
  return plans;
}

function addLocalStreets(routes, cityPlans, context) {
  for (const [provinceId, plan] of cityPlans) {
    const acceptedStreets = [];
    for (const street of plan.streets) {
      const points = smoothAndResample([{ x: street.x1, z: street.z1 }, { x: street.x2, z: street.z2 }], 4.8, context.worldWidth);
      if (points.some((point) => sampleScalar(context.landField, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, point.x, point.z) < 0.5
        || sampleScalar(context.riverMask, context.fieldWidth, context.fieldHeight, context.worldWidth, context.worldHeight, point.x, point.z) >= 0.22)) continue;
      if (points.length < 2) continue;
      routes.push({ id: routes.length, start: -1, end: -1, nodeIds: [], segmentIds: [], points, roadClass: 0, importance: 0, bridges: [], localStreet: true, provinceId });
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
      routes.push({ id: routes.length, start: -1, end: -1, nodeIds: [], segmentIds: [], points: plazaPoints, roadClass: 0, importance: 0, bridges: [], localStreet: true, plaza: true, provinceId });
    }
    plan.streets = acceptedStreets;
  }
}

function gradeTerrain(routes, heights, riverMask, width, height, worldWidth, worldHeight) {
  const targets = new Float32Array(heights.length);
  const weights = new Float32Array(heights.length);
  for (const route of routes) {
    const bridgeSample = new Uint8Array(route.points.length);
    for (const bridge of route.bridges) for (let index = bridge.start + 1; index < bridge.end; index += 1) bridgeSample[index] = 1;
    const profile = route.points.map((point) => sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z));
    for (let pass = 0; pass < 4; pass += 1) {
      const source = [...profile];
      for (let index = 1; index + 1 < profile.length; index += 1) {
        if (!bridgeSample[index]) profile[index] = source[index] * 0.42 + (source[index - 1] + source[index + 1]) * 0.29;
      }
    }
    route.profile = profile;
    const halfWidth = route.plaza ? 1.55 : route.localStreet ? 1.1 : [1.2, 1.8, 2.5][route.roadClass];
    const radiusWorld = halfWidth + 6.5;
    const radiusX = Math.max(1, Math.ceil(radiusWorld / worldWidth * width));
    const radiusZ = Math.max(1, Math.ceil(radiusWorld / worldHeight * height));
    for (let sample = 0; sample < route.points.length; sample += 1) {
      if (bridgeSample[sample]) continue;
      const point = route.points[sample];
      const cx = Math.round(wrap(point.x, worldWidth) / worldWidth * width);
      const cz = Math.round(point.z / worldHeight * height);
      for (let oz = -radiusZ; oz <= radiusZ; oz += 1) {
        const pz = cz + oz;
        if (pz < 0 || pz >= height) continue;
        for (let ox = -radiusX; ox <= radiusX; ox += 1) {
          const px = wrap(cx + ox, width);
          const distance = Math.hypot(ox / radiusX, oz / radiusZ);
          if (distance > 1) continue;
          const index = pz * width + px;
          if (riverMask[index] > 0.16) continue;
          const weight = (1 - smoothstep(0.25, 1, distance)) * (route.localStreet ? 0.42 : 0.72);
          targets[index] += profile[sample] * weight;
          weights[index] += weight;
        }
      }
    }
  }
  for (let index = 0; index < heights.length; index += 1) {
    if (!weights[index]) continue;
    const target = targets[index] / weights[index];
    heights[index] += (target - heights[index]) * clamp(weights[index], 0, 0.82);
  }
  for (const route of routes) {
    route.profile = route.points.map((point, index) => {
      if (route.bridges.some((bridge) => index > bridge.start && index < bridge.end)) return route.profile[index];
      return sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z);
    });
  }
}

class InfrastructureMesh {
  vertices = [];
  indices = [];

  vertex(position, normal, uv, roadClass, material) {
    const index = this.vertices.length / 10;
    this.vertices.push(...position, ...normal, ...uv, roadClass, material);
    return index;
  }

  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }

  box(center, yMin, yMax, length, width, angle, roadClass, material) {
    const forward = [Math.cos(angle), Math.sin(angle)];
    const right = [-forward[1], forward[0]];
    const corners = [
      [-length * 0.5, -width * 0.5], [length * 0.5, -width * 0.5],
      [length * 0.5, width * 0.5], [-length * 0.5, width * 0.5],
    ].map(([along, across]) => [center[0] + forward[0] * along + right[0] * across, center[1] + forward[1] * along + right[1] * across]);
    const faces = [
      [[0,1,2,3], [0,1,0]], [[3,2,1,0], [0,-1,0]],
      [[0,3,3,0], [-forward[0],0,-forward[1]]], [[1,1,2,2], [forward[0],0,forward[1]]],
      [[0,1,1,0], [right[0],0,right[1]]], [[3,2,2,3], [-right[0],0,-right[1]]],
    ];
    for (let face = 0; face < faces.length; face += 1) {
      const [ids, normal] = faces[face];
      const ys = face === 0 ? [yMax,yMax,yMax,yMax] : face === 1 ? [yMin,yMin,yMin,yMin] : [yMin,yMin,yMax,yMax];
      const base = [];
      for (let vertex = 0; vertex < 4; vertex += 1) base.push(this.vertex([corners[ids[vertex]][0], ys[vertex], corners[ids[vertex]][1]], normal, [vertex & 1, vertex >> 1], roadClass, material));
      this.quad(...base);
    }
  }
}

function buildMeshes(routes, heights, riverMask, riverBed, width, height, worldWidth, worldHeight, chunksX = 32, chunksY = 16) {
  const roads = new InfrastructureMesh();
  const bridges = new InfrastructureMesh();
  const bridgeRecords = [];
  const roadBatches = [];
  const bridgeBatches = [];
  const classWidths = [2.4, 3.6, 5.0];
  for (const route of routes) {
    const roadIndexStart = roads.indices.length;
    const bridgeIndexStart = bridges.indices.length;
    const roadWidth = route.plaza ? 3.1 : route.localStreet ? 1.8 : classWidths[route.roadClass];
    const shoulder = route.localStreet ? 0.45 : [0.65, 0.82, 1.0][route.roadClass];
    const bridgeAt = new Int32Array(route.points.length);
    bridgeAt.fill(-1);
    for (let bridgeIndex = 0; bridgeIndex < route.bridges.length; bridgeIndex += 1) {
      const bridge = route.bridges[bridgeIndex];
      for (let index = bridge.start; index <= bridge.end; index += 1) bridgeAt[index] = bridgeIndex;
    }
    const cumulative = [0];
    for (let index = 1; index < route.points.length; index += 1) {
      cumulative.push(cumulative[index - 1] + Math.hypot(unwrapNear(route.points[index].x, route.points[index - 1].x, worldWidth) - route.points[index - 1].x, route.points[index].z - route.points[index - 1].z));
    }
    const rings = [];
    const requiredDeck = route.points.map((point, index) => {
      const previous = route.points[Math.max(0, index - 1)];
      const next = route.points[Math.min(route.points.length - 1, index + 1)];
      let dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x;
      let dz = next.z - previous.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const nx = -dz / length;
      const nz = dx / length;
      const reach = roadWidth * 0.5 + shoulder;
      let deck = route.profile[index];
      for (const offset of [-reach, -roadWidth * 0.5, 0, roadWidth * 0.5, reach]) {
        deck = Math.max(deck, sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx * offset, point.z + nz * offset));
      }
      return deck;
    });
    const deckProfile = [...requiredDeck];
    for (let pass = 0; pass < 2; pass += 1) {
      const source = [...deckProfile];
      for (let index = 1; index + 1 < deckProfile.length; index += 1) deckProfile[index] = Math.max(requiredDeck[index], source[index] * 0.56 + (source[index - 1] + source[index + 1]) * 0.22);
    }
    for (let index = 0; index < route.points.length; index += 1) {
      const point = route.points[index];
      const previous = route.points[Math.max(0, index - 1)];
      const next = route.points[Math.min(route.points.length - 1, index + 1)];
      let dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x;
      let dz = next.z - previous.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const nx = -dz / length;
      const nz = dx / length;
      const y = deckProfile[index];
      const offsets = [-roadWidth * 0.5 - shoulder, -roadWidth * 0.5 - shoulder, -roadWidth * 0.5, roadWidth * 0.5, roadWidth * 0.5 + shoulder, roadWidth * 0.5 + shoulder];
      const leftGround = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx * offsets[0], point.z + nz * offsets[0]);
      const rightGround = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx * offsets[5], point.z + nz * offsets[5]);
      const ys = [leftGround - 0.04, y + 0.055, y + 0.13, y + 0.13, y + 0.055, rightGround - 0.04];
      rings.push(offsets.map((offset, slot) => roads.vertex([point.x + nx * offset, ys[slot], point.z + nz * offset], [0,1,0], [cumulative[index] / 18, slot / 5], route.roadClass, slot === 2 || slot === 3 ? 0 : slot === 0 || slot === 5 ? 2 : 1)));
    }
    for (let index = 0; index + 1 < rings.length; index += 1) {
      if (bridgeAt[index] >= 0 && bridgeAt[index + 1] >= 0) continue;
      for (let strip = 0; strip < 5; strip += 1) roads.quad(rings[index][strip], rings[index + 1][strip], rings[index + 1][strip + 1], rings[index][strip + 1]);
    }

    for (const interval of route.bridges) {
      const span = cumulative[interval.end] - cumulative[interval.start];
      // The dry samples bracket the wet bank by roughly one resampling interval on each side.
      const hydraulicSpan = Math.max(2, span - 13.6);
      const type = hydraulicSpan < 10 ? 0 : hydraulicSpan < 28 ? 1 : 2;
      let requiredLift = type === 0 ? 0.65 : type === 1 ? 1.05 : 1.55;
      for (let index = interval.start; index <= interval.end; index += 1) {
        const t = (cumulative[index] - cumulative[interval.start]) / Math.max(0.001, span);
        const base = deckProfile[interval.start] * (1 - t) + deckProfile[interval.end] * t;
        const water = sampleHeight(heights, width, height, worldWidth, worldHeight, route.points[index].x, route.points[index].z) + 0.55;
        requiredLift = Math.max(requiredLift, (water - base) / Math.max(0.15, Math.sin(Math.PI * clamp(t, 0.05, 0.95))));
      }
      const deckHeights = [];
      for (let index = interval.start; index <= interval.end; index += 1) {
        const t = (cumulative[index] - cumulative[interval.start]) / Math.max(0.001, span);
        deckHeights.push(deckProfile[interval.start] * (1 - t) + deckProfile[interval.end] * t + Math.sin(Math.PI * t) * requiredLift + 0.16);
      }
      for (let localIndex = 1; localIndex + 1 < deckHeights.length; localIndex += 1) {
        const index = interval.start + localIndex;
        const point = route.points[index];
        const previous = route.points[index - 1];
        const next = route.points[index + 1];
        const dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x;
        const dz = next.z - previous.z;
        const directionLength = Math.max(0.001, Math.hypot(dx, dz));
        const nx = -dz / directionLength;
        const nz = dx / directionLength;
        const halfDeck = (roadWidth + 1.0) * 0.5;
        const bankHeight = Math.max(
          sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx * halfDeck, point.z + nz * halfDeck),
          sampleHeight(heights, width, height, worldWidth, worldHeight, point.x - nx * halfDeck, point.z - nz * halfDeck),
        );
        deckHeights[localIndex] = Math.max(deckHeights[localIndex], bankHeight + 0.35);
      }
      for (let pass = 0; pass < 2; pass += 1) {
        const source = [...deckHeights];
        for (let index = 1; index + 1 < deckHeights.length; index += 1) deckHeights[index] = Math.max(deckHeights[index], source[index] * 0.58 + (source[index - 1] + source[index + 1]) * 0.21);
      }
      for (let index = interval.start; index < interval.end; index += 1) {
        const a = route.points[index];
        const b = route.points[index + 1];
        const bx = unwrapNear(b.x, a.x, worldWidth);
        const length = Math.hypot(bx - a.x, b.z - a.z);
        const angle = Math.atan2(b.z - a.z, bx - a.x);
        const center = [(a.x + bx) * 0.5, (a.z + b.z) * 0.5];
        const y = (deckHeights[index - interval.start] + deckHeights[index + 1 - interval.start]) * 0.5;
        bridges.box(center, y - 0.58, y, length + 0.18, roadWidth + 1.0, angle, route.roadClass, 6);
        const sideOffset = (roadWidth + 1.0) * 0.5 - 0.13;
        const rx = -Math.sin(angle), rz = Math.cos(angle);
        for (const side of [-1, 1]) {
          const railCenter = [center[0] + rx * sideOffset * side, center[1] + rz * sideOffset * side];
          if (type === 0) {
            bridges.box(railCenter, y, y + 0.58, length + 0.1, 0.20, angle, route.roadClass, 3);
          } else {
            bridges.box(railCenter, y + 0.58, y + 0.72, length + 0.1, 0.16, angle, route.roadClass, 5);
            bridges.box(railCenter, y + 0.29, y + 0.39, length + 0.1, 0.12, angle, route.roadClass, 5);
            bridges.box(railCenter, y, y + 0.70, 0.18, 0.18, angle, route.roadClass, 5);
          }
        }
      }
      if (type === 2) {
        const supports = Math.max(1, Math.floor(span / 18));
        for (let support = 1; support <= supports; support += 1) {
          const t = support / (supports + 1);
          const sampleIndex = clamp(Math.round(interval.start + (interval.end - interval.start) * t), interval.start, interval.end);
          const point = route.points[sampleIndex];
          const deckY = deckHeights[sampleIndex - interval.start] - 0.58;
          const ground = Number.isFinite(sampleScalar(riverBed, width, height, worldWidth, worldHeight, point.x, point.z))
            ? sampleScalar(riverBed, width, height, worldWidth, worldHeight, point.x, point.z)
            : sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z);
          const previous = route.points[Math.max(interval.start, sampleIndex - 1)];
          const next = route.points[Math.min(interval.end, sampleIndex + 1)];
          const angle = Math.atan2(next.z - previous.z, unwrapNear(next.x, previous.x, worldWidth) - previous.x) + Math.PI * 0.5;
          bridges.box([point.x, point.z], ground, deckY, roadWidth * 0.58, 0.7, angle, route.roadClass, 4);
        }
      }
      for (const endpoint of [interval.start, interval.end]) {
        const point = route.points[endpoint];
        const neighbor = route.points[endpoint === interval.start ? endpoint + 1 : endpoint - 1];
        const angle = Math.atan2(neighbor.z - point.z, unwrapNear(neighbor.x, point.x, worldWidth) - point.x);
        const y = endpoint === interval.start ? deckHeights[0] : deckHeights.at(-1);
        const ground = deckProfile[endpoint] - 0.5;
        bridges.box([point.x, point.z], ground, y - 0.1, 1.1, roadWidth + 1.8, angle, route.roadClass, 3);
      }
      const midpoint = route.points[Math.floor((interval.start + interval.end) * 0.5)];
      bridgeRecords.push({ routeId: route.id, start: interval.start, end: interval.end, span: hydraulicSpan, type, x: midpoint.x, z: midpoint.z });
    }
    const midpoint = route.points[Math.floor(route.points.length * 0.5)];
    const chunkX = clamp(Math.floor(wrap(midpoint.x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);
    const chunkY = clamp(Math.floor(midpoint.z / worldHeight * chunksY), 0, chunksY - 1);
    const chunk = chunkY * chunksX + chunkX;
    if (roads.indices.length > roadIndexStart) roadBatches.push({ chunk, start: roadIndexStart, count: roads.indices.length - roadIndexStart });
    if (bridges.indices.length > bridgeIndexStart) bridgeBatches.push({ chunk, start: bridgeIndexStart, count: bridges.indices.length - bridgeIndexStart });
  }

  const reorderIndices = (source, batches) => {
    const sorted = [];
    const ranges = Array.from({ length: chunksX * chunksY }, () => ({ firstIndex: 0, indexCount: 0 }));
    const byChunk = Array.from({ length: chunksX * chunksY }, () => []);
    for (const batch of batches) byChunk[batch.chunk].push(batch);
    for (let chunk = 0; chunk < byChunk.length; chunk += 1) {
      const firstIndex = sorted.length;
      for (const batch of byChunk[chunk]) for (let index = batch.start; index < batch.start + batch.count; index += 1) sorted.push(source[index]);
      ranges[chunk] = { firstIndex, indexCount: sorted.length - firstIndex };
    }
    return { indices: new Uint32Array(sorted), ranges };
  };
  const packedRoads = reorderIndices(roads.indices, roadBatches);
  const packedBridges = reorderIndices(bridges.indices, bridgeBatches);
  return {
    roadVertices: new Float32Array(roads.vertices), roadIndices: packedRoads.indices,
    bridgeVertices: new Float32Array(bridges.vertices), bridgeIndices: packedBridges.indices, bridgeRecords,
    chunkRanges: { chunksX, chunksY, roads: packedRoads.ranges, bridges: packedBridges.ranges },
  };
}

function rasterRoadField(routes, width, height, worldWidth, worldHeight, landField, landWidth, landHeight) {
  const field = new Uint8Array(width * height * 4);
  const clearance = new Uint8Array(width * height);
  const classWidths = [2.4, 3.6, 5.0];
  for (const route of routes) {
    const coreWorld = route.plaza ? 3.1 : route.localStreet ? 1.8 : classWidths[route.roadClass];
    const shoulderWorld = coreWorld + (route.localStreet ? 1.0 : 2.2);
    for (const point of route.points) {
      const fx = wrap(point.x, worldWidth) / worldWidth * width;
      const fz = point.z / worldHeight * height;
      const coreX = Math.max(0.72, coreWorld * 0.5 / worldWidth * width);
      const coreZ = Math.max(0.72, coreWorld * 0.5 / worldHeight * height);
      const shoulderX = Math.max(1.15, shoulderWorld * 0.5 / worldWidth * width);
      const shoulderZ = Math.max(1.15, shoulderWorld * 0.5 / worldHeight * height);
      const reachX = Math.ceil(shoulderX + 1.5);
      const reachZ = Math.ceil(shoulderZ + 1.5);
      for (let oz = -reachZ; oz <= reachZ; oz += 1) {
        const pz = Math.round(fz) + oz;
        if (pz < 0 || pz >= height) continue;
        for (let ox = -reachX; ox <= reachX; ox += 1) {
          const px = wrap(Math.round(fx) + ox, width);
          const dx = Math.round(fx) + ox - fx;
          const dz = pz - fz;
          const coreDistance = Math.hypot(dx / coreX, dz / coreZ);
          const shoulderDistance = Math.hypot(dx / shoulderX, dz / shoulderZ);
          if (shoulderDistance > 1.35) continue;
          const index = pz * width + px;
          const offset = index * 4;
          field[offset] = Math.max(field[offset], Math.round((1 - smoothstep(0.62, 1.18, coreDistance)) * 255));
          field[offset + 1] = Math.max(field[offset + 1], Math.round((1 - smoothstep(0.72, 1.25, shoulderDistance)) * 255));
          field[offset + 2] = Math.max(field[offset + 2], route.roadClass === 2 ? 255 : route.roadClass === 1 ? 154 : 70);
          if (route.localStreet) field[offset + 3] = 255;
          clearance[index] = Math.max(clearance[index], Math.round((1 - smoothstep(0.82, 1.3, shoulderDistance)) * 255));
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    const landY = Math.min(landHeight - 1, Math.floor((y + 0.5) / height * landHeight));
    for (let x = 0; x < width; x += 1) {
      const landX = Math.min(landWidth - 1, Math.floor((x + 0.5) / width * landWidth));
      if (landField[landY * landWidth + landX] >= 0.5) continue;
      field.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      clearance[y * width + x] = 0;
    }
  }
  return { field, clearance };
}

function buildFurniture(routes, cityPlans, heights, width, height, worldWidth, worldHeight) {
  const lamps = [];
  const barriers = [];
  const signs = [];
  const push = (list, x, z, sx, sy, sz, angle, tint, style = 0) => list.push(wrap(x, worldWidth), z, sx, sy, sz, angle, tint, style);
  for (const [, plan] of cityPlans) {
    let counter = 0;
    for (const street of plan.streets.slice(0, 2)) {
      const dx = street.x2 - street.x1;
      const dz = street.z2 - street.z1;
      const length = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      const spacing = 21 + (counter % 3) * 3;
      for (let distance = spacing * 0.55; distance < length; distance += spacing) {
        const t = distance / length;
        const side = counter++ % 2 ? 1 : -1;
        const rx = -Math.sin(angle), rz = Math.cos(angle);
        push(lamps, street.x1 + dx * t + rx * side * 2.2, street.z1 + dz * t + rz * side * 2.2, 1, 1, 1, angle, 0.86, 0);
      }
    }
    if ((Math.floor(plan.center[0] * 13 + plan.center[1] * 7) & 3) === 0) push(signs, plan.center[0] + plan.perpendicular.dx * 4, plan.center[1] + plan.perpendicular.dz * 4, 1, 1, 1, Math.atan2(plan.primary.dz, plan.primary.dx), 0.9, 0);
  }
  for (const route of routes) {
    if (route.localStreet) continue;
    for (let index = 4; index + 4 < route.points.length; index += 18) {
      const point = route.points[index];
      const previous = route.points[index - 2];
      const next = route.points[index + 2];
      const length = Math.hypot(unwrapNear(next.x, previous.x, worldWidth) - previous.x, next.z - previous.z);
      const slope = Math.abs(route.profile[index + 2] - route.profile[index - 2]) / Math.max(0.001, length);
      const angle = Math.atan2(next.z - previous.z, unwrapNear(next.x, previous.x, worldWidth) - previous.x);
      const deterministic = Math.abs(Math.sin(route.id * 91.17 + index * 13.7));
      if (slope > 0.23 && deterministic > 0.38) {
        const side = deterministic > 0.68 ? 1 : -1;
        const offset = ([2.4,3.6,5][route.roadClass] * 0.5 + 0.8) * side;
        push(barriers, point.x - Math.sin(angle) * offset, point.z + Math.cos(angle) * offset, 5.8, 0.7, 0.16, angle, 0.82, 0);
      } else if (route.roadClass < 2 && deterministic > 0.93) {
        const side = deterministic > 0.965 ? 1 : -1;
        const offset = ([2.4,3.6,5][route.roadClass] * 0.5 + 1.6) * side;
        push(barriers, point.x - Math.sin(angle) * offset, point.z + Math.cos(angle) * offset, 7.5, 0.9, 0.12, angle, 0.68, 1);
      }
    }
  }
  void heights; void width; void height;
  return { lamps: new Float32Array(lamps), barriers: new Float32Array(barriers), signs: new Float32Array(signs) };
}

export function buildInfrastructure({
  connectionData, networkData, provinces, heights, landField, riverMask, riverTexture, riverBed,
  fieldWidth, fieldHeight, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight,
}) {
  const assembled = assembleRoutes(connectionData, networkData, worldWidth);
  rankRoutes(assembled.routes, assembled.nodes, provinces);
  const context = { heights, landField, riverMask, riverTexture, fieldWidth, fieldHeight, worldWidth, worldHeight };
  for (const route of assembled.routes) adaptRoute(route, context);
  const logicalRouteCount = assembled.routes.length;
  const cityPlans = buildCityPlans(assembled.routes, assembled.nodes, provinces);
  addLocalStreets(assembled.routes, cityPlans, context);
  gradeTerrain(assembled.routes, heights, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const meshes = buildMeshes(assembled.routes, heights, riverMask, riverBed, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const roadRaster = rasterRoadField(assembled.routes, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight, landField, fieldWidth, fieldHeight);
  const furniture = buildFurniture(assembled.routes, cityPlans, heights, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const classCounts = [0, 0, 0];
  for (const route of assembled.routes.slice(0, logicalRouteCount)) classCounts[route.roadClass] += 1;
  const bridgeTypes = [0, 0, 0];
  for (const bridge of meshes.bridgeRecords) bridgeTypes[bridge.type] += 1;
  let roadSamples = 0;
  let oceanRoadSamples = 0;
  let unbridgedRiverSamples = 0;
  for (const route of assembled.routes) {
    for (let index = 0; index < route.points.length; index += 1) {
      roadSamples += 1;
      const point = route.points[index];
      if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z) < 0.5) oceanRoadSamples += 1;
      const wet = sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z) > 0.30;
      const bridged = route.bridges.some((bridge) => index >= bridge.start && index <= bridge.end);
      if (wet && !bridged) unbridgedRiverSamples += 1;
    }
  }
  const widestBridge = [...meshes.bridgeRecords].sort((a, b) => b.span - a.span)[0];
  const largestCity = [...provinces].filter((province) => province.terrain_type_id === 14).sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  let mountainRoute;
  for (const route of assembled.routes.slice(0, logicalRouteCount)) {
    const elevation = Math.max(...route.profile);
    if (!mountainRoute || elevation > mountainRoute.elevation) mountainRoute = { x: route.points[Math.floor(route.points.length * 0.5)].x, z: route.points[Math.floor(route.points.length * 0.5)].z, elevation };
  }
  return {
    ...meshes, ...furniture, roadField: roadRaster.field, roadClearance: roadRaster.clearance, cityPlans,
    stats: {
      landSegments: assembled.landSegmentCount, logicalRoutes: logicalRouteCount, localStreets: assembled.routes.length - logicalRouteCount,
      localRoutes: classCounts[0], regionalRoutes: classCounts[1], majorRoutes: classCounts[2],
      bridges: meshes.bridgeRecords.length, slabBridges: bridgeTypes[0], girderBridges: bridgeTypes[1], multiSpanBridges: bridgeTypes[2],
      roadSamples, oceanRoadSamples, unbridgedRiverSamples,
    },
    showcases: {
      urban: [largestCity.center_x, largestCity.center_y],
      bridge: widestBridge ? [widestBridge.x, widestBridge.z] : [largestCity.center_x, largestCity.center_y],
      mountain: mountainRoute ? [mountainRoute.x, mountainRoute.z] : [largestCity.center_x, largestCity.center_y],
    },
  };
}
