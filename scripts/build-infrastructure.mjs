import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TAU = Math.PI * 2;
const ROUTING_CACHE_VERSION = 'hierarchical-roads-v3.4';
const LEVEL_WIDTHS = [1.5, 2.2, 3.4, 4.8, 8.4];
const ROLE_WIDTH_SCALE = [0.8, 1.0, 1.2];
const MAX_GRADES = [0.18, 0.14, 0.10, 0.08, 0.06];
const CUT_FILL_LIMITS = [1.5, 2.5, 4.0, 6.0, 8.0];
const TUNNEL_MAX_LENGTHS = [0, 45, 90, 160, 240];
const ROLE_LOCAL = 0;
const ROLE_CONNECTOR = 1;
const ROLE_TRUNK = 2;

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

function refineRiverSegments(points, riverCoreMask, width, height, worldWidth, worldHeight) {
  const refined = [points[0]];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const bx = unwrapNear(points[index + 1].x, a.x, worldWidth);
    const bz = points[index + 1].z;
    const length = Math.hypot(bx - a.x, bz - a.z);
    const steps = Math.max(1, Math.ceil(length / 2.2));
    const samples = [];
    let touchesCore = false;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const point = { x: wrap(a.x + (bx - a.x) * t, worldWidth), z: a.z + (bz - a.z) * t };
      samples.push(point);
      touchesCore ||= sampleScalar(riverCoreMask, width, height, worldWidth, worldHeight, point.x, point.z) > 0.10;
    }
    // Extra samples are only needed where a segment intersects actual rendered
    // channel geometry. Keeping dry segments coarse controls mesh size.
    if (touchesCore) refined.push(...samples);
    else refined.push(points[index + 1]);
  }
  return refined;
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
  return { routes, nodes, adjacency, land, landSegmentCount: land.length };
}

function classifyInfrastructure(routes, nodes, adjacency, provinces, landSegments) {
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
  const segmentById = new Map(landSegments.map((segment) => [segment.segment_id, segment]));
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

  // Convert movement-node connectivity into land components. Infrastructure quotas are
  // applied within each component so islands and smaller continents retain a hierarchy.
  const visitedNodes = new Set();
  const components = [];
  for (const nodeId of adjacency.keys()) {
    if (visitedNodes.has(nodeId)) continue;
    const queue = [nodeId];
    const provinceIds = new Set();
    visitedNodes.add(nodeId);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const node = nodes.get(current);
      if (node?.kind === 'province_center' && Number.isInteger(node.location_id)) provinceIds.add(node.location_id);
      for (const edge of adjacency.get(current) ?? []) {
        if (!visitedNodes.has(edge.node)) {
          visitedNodes.add(edge.node);
          queue.push(edge.node);
        }
      }
    }
    if (provinceIds.size) components.push([...provinceIds]);
  }

  const provinceCentrality = new Map(provinces.map((province) => [province.province_id, 0]));
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const ids = new Set(route.segmentIds.map((id) => segmentById.get(id)?.location_id).filter((id) => Number.isInteger(id) && id >= 0));
    for (const endpoint of [route.start, route.end]) {
      const locationId = nodes.get(endpoint)?.location_id;
      if (Number.isInteger(locationId)) ids.add(locationId);
    }
    route.provinceIds = [...ids];
    for (const id of ids) provinceCentrality.set(id, (provinceCentrality.get(id) ?? 0) + centrality[index]);
  }

  const provinceLevels = new Map(provinces.map((province) => [province.province_id, 1]));
  const provinceScores = new Map();
  for (const component of components) {
    const populationValues = component.map((id) => Math.log10(Math.max(1_000, provinceById.get(id)?.population ?? 0)));
    const centralityValues = component.map((id) => provinceCentrality.get(id) ?? 0);
    const populationRanks = percentileRanks(populationValues);
    const componentCentralityRanks = percentileRanks(centralityValues);
    const ordered = component.map((id, index) => ({
      id,
      score: populationRanks[index] * 0.75 + componentCentralityRanks[index] * 0.25,
      urban: provinceById.get(id)?.terrain_type_id === 14,
      population: provinceById.get(id)?.population ?? 0,
    })).sort((a, b) => b.score - a.score || b.population - a.population || a.id - b.id);
    for (const item of ordered) provinceScores.set(item.id, item.score);
    if (ordered.length < 4) {
      if (ordered.some((item) => item.urban)) provinceLevels.set(ordered[0].id, ordered[0].population >= 430_000 ? 3 : 2);
      continue;
    }
    const level3Count = ordered.length < 8 ? 1 : Math.max(1, Math.round(ordered.length * 0.14));
    const level2Count = ordered.length < 8 ? Math.min(2, ordered.length - level3Count) : Math.max(1, Math.round(ordered.length * 0.29));
    for (let index = 0; index < ordered.length; index += 1) {
      provinceLevels.set(ordered[index].id, index < level3Count ? 3 : index < level3Count + level2Count ? 2 : 1);
    }
  }

  for (let index = 0; index < routes.length; index += 1) {
    routes[index].importance = scores[index];
    routes[index].scoreRank = scoreRank[index];
    routes[index].infrastructureLevel = Math.max(1, ...routes[index].provinceIds.map((id) => provinceLevels.get(id) ?? 1));
    routes[index].corridorRole = routes[index].infrastructureLevel >= 3 && scoreRank[index] >= 0.62
      ? ROLE_TRUNK
      : routes[index].infrastructureLevel >= 2 || scoreRank[index] >= 0.44 ? ROLE_CONNECTOR : ROLE_LOCAL;
    // Keep the legacy property populated while downstream code is migrated.
    routes[index].roadClass = routes[index].corridorRole;
  }
  return { provinceLevels, provinceScores, centrality };
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

function adaptRoute(route, context) {
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

function buildSharedGateways(routes, nodes, provinces, context) {
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

function buildCityPlans(routes, nodes, provinces) {
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

function addLocalStreets(routes, cityPlans, context) {
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

function gradeTerrain(routes, heights, riverMask, width, height, worldWidth, worldHeight) {
  const targets = new Float32Array(heights.length);
  const weights = new Float32Array(heights.length);
  for (const route of routes) {
    const bridgeSample = new Uint8Array(route.points.length);
    for (const bridge of route.bridges) for (let index = bridge.start + 1; index < bridge.end; index += 1) bridgeSample[index] = 1;
    const natural = route.points.map((point) => sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z));
    const profile = [...natural];
    const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
    const maximumGrade = MAX_GRADES[levelIndex];
    const cutFillLimit = CUT_FILL_LIMITS[levelIndex];
    for (let pass = 0; pass < 10; pass += 1) {
      const source = [...profile];
      for (let index = 1; index + 1 < profile.length; index += 1) {
        profile[index] = source[index] * 0.54 + (source[index - 1] + source[index + 1]) * 0.23;
      }
    }
    for (let pass = 0; pass < 8; pass += 1) {
      for (let index = 1; index < profile.length; index += 1) {
        const previous = route.points[index - 1], current = route.points[index];
        const run = Math.max(0.001, Math.hypot(unwrapNear(current.x, previous.x, worldWidth) - previous.x, current.z - previous.z));
        profile[index] = clamp(profile[index], profile[index - 1] - maximumGrade * run, profile[index - 1] + maximumGrade * run);
      }
      for (let index = profile.length - 2; index >= 0; index -= 1) {
        const next = route.points[index + 1], current = route.points[index];
        const run = Math.max(0.001, Math.hypot(unwrapNear(next.x, current.x, worldWidth) - current.x, next.z - current.z));
        profile[index] = clamp(profile[index], profile[index + 1] - maximumGrade * run, profile[index + 1] + maximumGrade * run);
      }
    }

    route.tunnels = [];
    if (route.infrastructureLevel >= 2 && !route.localStreet && !route.gateway) {
      let cursor = 1;
      while (cursor + 1 < profile.length) {
        const requiresTunnel = natural[cursor] - profile[cursor] > cutFillLimit * 1.12 && riverMask[clamp(Math.floor(route.points[cursor].z / worldHeight * height), 0, height - 1) * width
          + wrap(Math.floor(route.points[cursor].x / worldWidth * width), width)] < 0.12;
        if (!requiresTunnel) { cursor += 1; continue; }
        let end = cursor;
        while (end + 1 < profile.length - 1 && natural[end + 1] - profile[end + 1] > cutFillLimit * 0.72) end += 1;
        const start = Math.max(0, cursor - 1);
        const finish = Math.min(profile.length - 1, end + 1);
        let length = 0;
        for (let index = start; index < finish; index += 1) length += Math.hypot(
          unwrapNear(route.points[index + 1].x, route.points[index].x, worldWidth) - route.points[index].x,
          route.points[index + 1].z - route.points[index].z);
        const maximumLength = TUNNEL_MAX_LENGTHS[levelIndex];
        const dryPortals = route.points.slice(start, finish + 1).every((point) => sampleScalar(riverMask, width, height, worldWidth, worldHeight, point.x, point.z) < 0.12);
        if (length >= 9 && length <= maximumLength && dryPortals) {
          route.tunnels.push({ start, end: finish, length });
          for (let index = start + 1; index < finish; index += 1) {
            const t = (index - start) / (finish - start);
            profile[index] = profile[start] * (1 - t) + profile[finish] * t;
          }
        }
        cursor = end + 1;
      }
    }
    route.profile = profile;
    const roadWidth = route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
      : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
    const halfWidth = roadWidth * 0.5;
    const radiusWorld = halfWidth + (route.infrastructureLevel === 1 ? 3.2 : 5.2);
    const radiusX = Math.max(1, Math.ceil(radiusWorld / worldWidth * width));
    const radiusZ = Math.max(1, Math.ceil(radiusWorld / worldHeight * height));
    for (let sample = 0; sample < route.points.length; sample += 1) {
      if (bridgeSample[sample] || route.tunnels.some((tunnel) => sample > tunnel.start && sample < tunnel.end)) continue;
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
          const weight = (1 - smoothstep(0.22, 1, distance)) * (route.infrastructureLevel === 1 ? 0.30 : route.localStreet ? 0.42 : 0.68);
          const boundedTarget = clamp(profile[sample], heights[index] - cutFillLimit, heights[index] + cutFillLimit);
          targets[index] += boundedTarget * weight;
          weights[index] += weight;
        }
      }
    }
  }
  for (let index = 0; index < heights.length; index += 1) {
    if (!weights[index]) continue;
    const target = targets[index] / weights[index];
    heights[index] += (target - heights[index]) * clamp(weights[index], 0, 0.78);
  }
}

class InfrastructureMesh {
  vertices = [];
  indices = [];

  vertex(position, normal, uv, level, role, surfaceMaterial, structureMaterial, corridorId) {
    const index = this.vertices.length / 13;
    this.vertices.push(...position, ...normal, ...uv, level, role, surfaceMaterial, structureMaterial, corridorId);
    return index;
  }

  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }

  box(center, yMin, yMax, length, width, angle, level, role, surfaceMaterial, structureMaterial, corridorId) {
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
      for (let vertex = 0; vertex < 4; vertex += 1) base.push(this.vertex([corners[ids[vertex]][0], ys[vertex], corners[ids[vertex]][1]], normal,
        [vertex & 1, vertex >> 1], level, role, surfaceMaterial, structureMaterial, corridorId));
      this.quad(...base);
    }
  }
}

function buildMeshes(routes, heights, riverMask, riverBed, width, height, worldWidth, worldHeight, chunksX = 32, chunksY = 16) {
  const roads = new InfrastructureMesh();
  const bridges = new InfrastructureMesh();
  const tunnels = new InfrastructureMesh();
  const bridgeRecords = [];
  const tunnelRecords = [];
  const roadBatches = [];
  const bridgeBatches = [];
  const tunnelBatches = [];
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);
  const pushBatch = (batches, start, end, x, z) => {
    if (end > start) batches.push({ chunk: chunkFor(x, z), start, count: end - start });
  };
  for (const route of routes) {
    const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
    const roadWidth = route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
      : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
    const shoulder = route.infrastructureLevel === 1 ? 0.22 : route.localStreet ? 0.34 : [0.35, 0.55, 0.78, 1.05, 1.25][levelIndex];
    const surfaceMaterial = route.surfaceMaterial ?? (route.infrastructureLevel === 1 ? 0 : route.infrastructureLevel === 2 ? 1 : route.infrastructureLevel + 0);
    const corridorId = route.id;
    const bridgeAt = new Int32Array(route.points.length);
    bridgeAt.fill(-1);
    for (let bridgeIndex = 0; bridgeIndex < route.bridges.length; bridgeIndex += 1) {
      const bridge = route.bridges[bridgeIndex];
      for (let index = bridge.start; index <= bridge.end; index += 1) bridgeAt[index] = bridgeIndex;
    }
    const tunnelAt = new Int32Array(route.points.length);
    tunnelAt.fill(-1);
    for (let tunnelIndex = 0; tunnelIndex < (route.tunnels?.length ?? 0); tunnelIndex += 1) {
      const tunnel = route.tunnels[tunnelIndex];
      for (let index = tunnel.start; index <= tunnel.end; index += 1) tunnelAt[index] = tunnelIndex;
    }
    const cumulative = [0];
    for (let index = 1; index < route.points.length; index += 1) {
      cumulative.push(cumulative[index - 1] + Math.hypot(unwrapNear(route.points[index].x, route.points[index - 1].x, worldWidth) - route.points[index - 1].x, route.points[index].z - route.points[index - 1].z));
    }
    const deckProfile = route.profile;
    const rings = [];
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
      const dy = deckProfile[Math.min(deckProfile.length - 1, index + 1)] - deckProfile[Math.max(0, index - 1)];
      const normalLength = Math.max(0.001, Math.hypot(dx, dz));
      const topNormalRaw = [-dx / normalLength * dy / Math.max(1, length), 1, -dz / normalLength * dy / Math.max(1, length)];
      const topNormalScale = 1 / Math.max(0.001, Math.hypot(...topNormalRaw));
      const topNormal = topNormalRaw.map((value) => value * topNormalScale);
      const offsets = [-roadWidth * 0.5 - shoulder, -roadWidth * 0.5 - shoulder, -roadWidth * 0.5, roadWidth * 0.5, roadWidth * 0.5 + shoulder, roadWidth * 0.5 + shoulder];
      const limit = CUT_FILL_LIMITS[levelIndex];
      const leftGround = clamp(sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx * offsets[0], point.z + nz * offsets[0]), y - limit, y + limit);
      const rightGround = clamp(sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx * offsets[5], point.z + nz * offsets[5]), y - limit, y + limit);
      const lift = route.infrastructureLevel === 1 ? 0.055 : 0.10;
      const ys = [leftGround, y + lift * 0.45, y + lift, y + lift, y + lift * 0.45, rightGround];
      rings.push(offsets.map((offset, slot) => roads.vertex([point.x + nx * offset, ys[slot], point.z + nz * offset], topNormal,
        [cumulative[index] / 18, slot / 5], route.infrastructureLevel, route.corridorRole, surfaceMaterial,
        slot === 2 || slot === 3 ? 0 : slot === 0 || slot === 5 ? 7 : 6, corridorId)));
    }
    for (let index = 0; index + 1 < rings.length; index += 1) {
      if (bridgeAt[index] >= 0 && bridgeAt[index + 1] >= 0 || tunnelAt[index] >= 0 && tunnelAt[index + 1] >= 0) continue;
      const batchStart = roads.indices.length;
      for (let strip = 0; strip < 5; strip += 1) roads.quad(rings[index][strip], rings[index + 1][strip], rings[index + 1][strip + 1], rings[index][strip + 1]);
      const a = route.points[index], b = route.points[index + 1];
      pushBatch(roadBatches, batchStart, roads.indices.length, (a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, (a.z + b.z) * 0.5);
    }

    for (const interval of route.bridges) {
      const span = cumulative[interval.end] - cumulative[interval.start];
      const coreStart = clamp(interval.coreStart ?? interval.start + 1, interval.start, interval.end);
      const coreEnd = clamp(interval.coreEnd ?? interval.end - 1, coreStart, interval.end);
      const hydraulicSpan = Math.max(3.2, cumulative[coreEnd] - cumulative[coreStart] + 2.2);
      const type = hydraulicSpan < 10 ? 0 : hydraulicSpan < 28 ? 1 : 2;
      const roadLift = route.infrastructureLevel === 1 ? 0.055 : 0.10;
      const startTop = deckProfile[interval.start] + roadLift;
      const endTop = deckProfile[interval.end] + roadLift;
      let maximumWater = Number.NEGATIVE_INFINITY;
      for (let index = coreStart; index <= coreEnd; index += 1) {
        const bed = sampleScalar(riverBed, width, height, worldWidth, worldHeight, route.points[index].x, route.points[index].z);
        if (Number.isFinite(bed)) maximumWater = Math.max(maximumWater, bed + 0.38);
      }
      if (!Number.isFinite(maximumWater)) {
        const midpoint = route.points[Math.floor((coreStart + coreEnd) * 0.5)];
        maximumWater = sampleHeight(heights, width, height, worldWidth, worldHeight, midpoint.x, midpoint.z) + 0.38;
      }
      // Bridge tops are derived from the rendered water surface. A flat/slightly
      // sloped engineered deck with bounded approach ramps replaces the old sine
      // lift, whose near-bank division could create arbitrarily tall arches.
      const requiredTop = maximumWater + (type === 0 ? 0.82 : type === 1 ? 0.96 : 1.10);
      const coreStartT = (cumulative[coreStart] - cumulative[interval.start]) / Math.max(0.001, span);
      const coreEndT = (cumulative[coreEnd] - cumulative[interval.start]) / Math.max(0.001, span);
      const coreStartTop = Math.max(requiredTop, startTop * (1 - coreStartT) + endTop * coreStartT);
      const coreEndTop = Math.max(requiredTop, startTop * (1 - coreEndT) + endTop * coreEndT);
      const deckHeights = [];
      for (let index = interval.start; index <= interval.end; index += 1) {
        let deckTop;
        if (index <= coreStart) {
          const approachLength = cumulative[coreStart] - cumulative[interval.start];
          const t = approachLength > 0.001 ? smoothstep(0, 1, (cumulative[index] - cumulative[interval.start]) / approachLength) : 1;
          deckTop = startTop * (1 - t) + coreStartTop * t;
        } else if (index >= coreEnd) {
          const approachLength = cumulative[interval.end] - cumulative[coreEnd];
          const t = approachLength > 0.001 ? smoothstep(0, 1, (cumulative[index] - cumulative[coreEnd]) / approachLength) : 1;
          deckTop = coreEndTop * (1 - t) + endTop * t;
        } else {
          const t = (cumulative[index] - cumulative[coreStart]) / Math.max(0.001, cumulative[coreEnd] - cumulative[coreStart]);
          deckTop = coreStartTop * (1 - t) + coreEndTop * t;
        }
        deckHeights.push(deckTop);
      }
      for (let index = interval.start; index < interval.end; index += 1) {
        const a = route.points[index];
        const b = route.points[index + 1];
        const bx = unwrapNear(b.x, a.x, worldWidth);
        const length = Math.hypot(bx - a.x, b.z - a.z);
        const angle = Math.atan2(b.z - a.z, bx - a.x);
        const center = [(a.x + bx) * 0.5, (a.z + b.z) * 0.5];
        const y = (deckHeights[index - interval.start] + deckHeights[index + 1 - interval.start]) * 0.5;
        const batchStart = bridges.indices.length;
        bridges.box(center, y - 0.58, y, length + 0.18, roadWidth + 1.0, angle,
          route.infrastructureLevel, route.corridorRole, surfaceMaterial, 8, corridorId);
        const sideOffset = (roadWidth + 1.0) * 0.5 - 0.13;
        const rx = -Math.sin(angle), rz = Math.cos(angle);
        if (type > 0) {
          for (const side of [-1, 1]) {
            const girderCenter = [center[0] + rx * sideOffset * 0.72 * side, center[1] + rz * sideOffset * 0.72 * side];
            bridges.box(girderCenter, y - 1.18, y - 0.46, length + 0.12, 0.24, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
          }
        }
        for (const side of [-1, 1]) {
          const railCenter = [center[0] + rx * sideOffset * side, center[1] + rz * sideOffset * side];
          if (type === 0) {
            bridges.box(railCenter, y, y + 0.58, length + 0.1, 0.20, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, route.infrastructureLevel <= 2 ? 2 : 9, corridorId);
          } else {
            bridges.box(railCenter, y + 0.58, y + 0.72, length + 0.1, 0.16, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
            bridges.box(railCenter, y + 0.29, y + 0.39, length + 0.1, 0.12, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
            bridges.box(railCenter, y, y + 0.70, 0.18, 0.18, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
          }
        }
        pushBatch(bridgeBatches, batchStart, bridges.indices.length, center[0], center[1]);
      }
      let maximumGeneratedPierHeight = 0;
      if (type === 2) {
        const supports = Math.max(1, Math.floor(hydraulicSpan / 22));
        for (let support = 1; support <= supports; support += 1) {
          const t = support / (supports + 1);
          const sampleIndex = clamp(Math.round(coreStart + (coreEnd - coreStart) * t), coreStart, coreEnd);
          const point = route.points[sampleIndex];
          const deckY = deckHeights[sampleIndex - interval.start] - 0.58;
          const ground = Number.isFinite(sampleScalar(riverBed, width, height, worldWidth, worldHeight, point.x, point.z))
            ? sampleScalar(riverBed, width, height, worldWidth, worldHeight, point.x, point.z)
            : sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z);
          const previous = route.points[Math.max(interval.start, sampleIndex - 1)];
          const next = route.points[Math.min(interval.end, sampleIndex + 1)];
          const angle = Math.atan2(next.z - previous.z, unwrapNear(next.x, previous.x, worldWidth) - previous.x) + Math.PI * 0.5;
          const pierHeight = deckY - ground;
          // Deep gorges are carried by the continuous girders between rock
          // abutments; needle-like freestanding piers are visually misleading.
          if (pierHeight > 18) continue;
          const batchStart = bridges.indices.length;
          bridges.box([point.x, point.z], ground, deckY, roadWidth * 0.58, 0.7, angle,
            route.infrastructureLevel, route.corridorRole, surfaceMaterial, 9, corridorId);
          maximumGeneratedPierHeight = Math.max(maximumGeneratedPierHeight, pierHeight);
          pushBatch(bridgeBatches, batchStart, bridges.indices.length, point.x, point.z);
        }
      }
      for (const endpoint of [interval.start, interval.end]) {
        const point = route.points[endpoint];
        const neighbor = route.points[endpoint === interval.start ? endpoint + 1 : endpoint - 1];
        const angle = Math.atan2(neighbor.z - point.z, unwrapNear(neighbor.x, point.x, worldWidth) - point.x);
        const y = endpoint === interval.start ? deckHeights[0] : deckHeights.at(-1);
        const ground = Math.min(sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z), y - 0.42);
        const batchStart = bridges.indices.length;
        bridges.box([point.x, point.z], ground, y - 0.08, 1.1, roadWidth + 1.8, angle,
          route.infrastructureLevel, route.corridorRole, surfaceMaterial, 9, corridorId);
        pushBatch(bridgeBatches, batchStart, bridges.indices.length, point.x, point.z);
      }
      const midpoint = route.points[Math.floor((interval.start + interval.end) * 0.5)];
      let minimumClearance = Number.POSITIVE_INFINITY;
      for (let index = coreStart; index <= coreEnd; index += 1) {
        const bed = sampleScalar(riverBed, width, height, worldWidth, worldHeight, route.points[index].x, route.points[index].z);
        if (!Number.isFinite(bed)) continue;
        minimumClearance = Math.min(minimumClearance, deckHeights[index - interval.start] - 0.58 - (bed + 0.38));
      }
      bridgeRecords.push({
        routeId: route.id, start: interval.start, end: interval.end, coreStart, coreEnd,
        span: hydraulicSpan, type, x: midpoint.x, z: midpoint.z,
        minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : 0,
        maximumPierHeight: maximumGeneratedPierHeight,
        seamError: Math.max(Math.abs(deckHeights[0] - startTop), Math.abs(deckHeights.at(-1) - endTop)),
      });
    }

    for (const interval of route.tunnels ?? []) {
      for (const endpoint of [interval.start, interval.end]) {
        const point = route.points[endpoint];
        const neighbor = route.points[endpoint === interval.start ? endpoint + 1 : endpoint - 1];
        const angle = Math.atan2(neighbor.z - point.z, unwrapNear(neighbor.x, point.x, worldWidth) - point.x);
        const ground = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z);
        const direction = endpoint === interval.start ? 1 : -1;
        const centerX = point.x + Math.cos(angle) * direction * 0.35;
        const centerZ = point.z + Math.sin(angle) * direction * 0.35;
        const batchStart = tunnels.indices.length;
        const portalWidth = roadWidth + 1.8;
        for (const side of [-1, 1]) {
          const rx = -Math.sin(angle), rz = Math.cos(angle);
          tunnels.box([centerX + rx * side * portalWidth * 0.44, centerZ + rz * side * portalWidth * 0.44], ground, ground + 3.1,
            1.15, 0.72, angle, route.infrastructureLevel, route.corridorRole, surfaceMaterial, 9, corridorId);
        }
        tunnels.box([centerX, centerZ], ground + 2.55, ground + 3.35, 1.2, portalWidth,
          angle, route.infrastructureLevel, route.corridorRole, surfaceMaterial, 9, corridorId);
        tunnels.box([centerX + Math.cos(angle) * direction * 0.08, centerZ + Math.sin(angle) * direction * 0.08], ground + 0.15, ground + 2.55,
          0.18, Math.max(0.7, roadWidth - 0.1), angle, route.infrastructureLevel, route.corridorRole, surfaceMaterial, 12, corridorId);
        pushBatch(tunnelBatches, batchStart, tunnels.indices.length, point.x, point.z);
      }
      let dashDistance = 0;
      for (let index = interval.start; index < interval.end; index += 1) {
        const a = route.points[index], b = route.points[index + 1];
        const bx = unwrapNear(b.x, a.x, worldWidth);
        const segmentLength = Math.hypot(bx - a.x, b.z - a.z);
        dashDistance += segmentLength;
        if (Math.floor(dashDistance / 5.5) % 2) continue;
        const angle = Math.atan2(b.z - a.z, bx - a.x);
        const center = [(a.x + bx) * 0.5, (a.z + b.z) * 0.5];
        const top = sampleHeight(heights, width, height, worldWidth, worldHeight, center[0], center[1]) + 0.28;
        const batchStart = tunnels.indices.length;
        tunnels.box(center, top, top + 0.065, Math.min(3.4, segmentLength * 0.68), 0.9, angle,
          route.infrastructureLevel, route.corridorRole, surfaceMaterial, 11, corridorId);
        pushBatch(tunnelBatches, batchStart, tunnels.indices.length, center[0], center[1]);
      }
      const midpoint = route.points[Math.floor((interval.start + interval.end) * 0.5)];
      tunnelRecords.push({ routeId: route.id, level: route.infrastructureLevel, length: interval.length, x: midpoint.x, z: midpoint.z });
    }
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
  const packedTunnels = reorderIndices(tunnels.indices, tunnelBatches);
  return {
    roadVertices: new Float32Array(roads.vertices), roadIndices: packedRoads.indices,
    bridgeVertices: new Float32Array(bridges.vertices), bridgeIndices: packedBridges.indices, bridgeRecords,
    tunnelVertices: new Float32Array(tunnels.vertices), tunnelIndices: packedTunnels.indices, tunnelRecords,
    chunkRanges: { chunksX, chunksY, roads: packedRoads.ranges, bridges: packedBridges.ranges, tunnels: packedTunnels.ranges },
  };
}

function rasterRoadField(routes, width, height, worldWidth, worldHeight, landField, landWidth, landHeight) {
  const field = new Uint8Array(width * height * 4);
  const clearance = new Uint8Array(width * height);
  for (const route of routes) {
    const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
    const coreWorld = route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
      : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
    const shoulderWorld = coreWorld + (route.infrastructureLevel === 1 ? 0.45 : route.localStreet ? 0.7 : 1.25 + levelIndex * 0.28);
    const surfaceMaterial = route.surfaceMaterial ?? (route.infrastructureLevel === 1 ? 0 : route.infrastructureLevel === 2 ? 1 : route.infrastructureLevel);
    const packedMetadata = (route.corridorRole & 3) | (route.localStreet ? 4 : 0) | ((surfaceMaterial & 7) << 3);
    for (let pointIndex = 0; pointIndex < route.points.length; pointIndex += 1) {
      if ((route.tunnels ?? []).some((tunnel) => pointIndex > tunnel.start && pointIndex < tunnel.end)) continue;
      if ((route.bridges ?? []).some((bridge) => pointIndex > bridge.start && pointIndex < bridge.end)) continue;
      const point = route.points[pointIndex];
      const fx = wrap(point.x, worldWidth) / worldWidth * width;
      const fz = point.z / worldHeight * height;
      const minimumCore = route.infrastructureLevel === 1 ? 0.32 : route.infrastructureLevel === 2 ? 0.50 : 0.68;
      const minimumShoulder = route.infrastructureLevel === 1 ? 0.58 : route.infrastructureLevel === 2 ? 0.82 : 1.05;
      const coreX = Math.max(minimumCore, coreWorld * 0.5 / worldWidth * width);
      const coreZ = Math.max(minimumCore, coreWorld * 0.5 / worldHeight * height);
      const shoulderX = Math.max(minimumShoulder, shoulderWorld * 0.5 / worldWidth * width);
      const shoulderZ = Math.max(minimumShoulder, shoulderWorld * 0.5 / worldHeight * height);
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
          const coreStrength = route.infrastructureLevel === 1 ? 0.48 : route.infrastructureLevel === 2 ? 0.76 : 1.0;
          field[offset] = Math.max(field[offset], Math.round((1 - smoothstep(0.56, 1.12, coreDistance)) * 255 * coreStrength));
          field[offset + 1] = Math.max(field[offset + 1], Math.round((1 - smoothstep(0.72, 1.25, shoulderDistance)) * 255));
          const encodedLevel = route.infrastructureLevel * 51;
          if (encodedLevel >= field[offset + 2]) {
            field[offset + 2] = encodedLevel;
            field[offset + 3] = packedMetadata;
          }
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
      const roadWidth = LEVEL_WIDTHS[clamp(route.infrastructureLevel - 1, 0, 4)] * ROLE_WIDTH_SCALE[route.corridorRole];
      if (slope > MAX_GRADES[clamp(route.infrastructureLevel - 1, 0, 4)] * 0.78 && route.infrastructureLevel >= 2 && deterministic > 0.38) {
        const side = deterministic > 0.68 ? 1 : -1;
        const offset = (roadWidth * 0.5 + 0.8) * side;
        push(barriers, point.x - Math.sin(angle) * offset, point.z + Math.cos(angle) * offset, 5.8, 0.7, 0.16, angle, 0.82, 0);
      } else if (route.infrastructureLevel <= 2 && deterministic > 0.95) {
        const side = deterministic > 0.965 ? 1 : -1;
        const offset = (roadWidth * 0.5 + 1.6) * side;
        push(barriers, point.x - Math.sin(angle) * offset, point.z + Math.cos(angle) * offset, 7.5, 0.9, 0.12, angle, 0.68, 1);
      }
    }
  }
  void heights; void width; void height;
  return { lamps: new Float32Array(lamps), barriers: new Float32Array(barriers), signs: new Float32Array(signs) };
}

function buildConnectionCorridorMap(routes, logicalRouteCount, segmentRecordCount) {
  const references = Array.from({ length: segmentRecordCount }, () => []);
  for (const route of routes.slice(0, logicalRouteCount)) {
    const corridors = [route.startGateway, route.id, route.endGateway].filter((value, index, values) => Number.isInteger(value) && values.indexOf(value) === index);
    for (const segmentId of route.segmentIds) references[segmentId]?.push(...corridors);
  }
  const offsets = new Uint32Array(segmentRecordCount + 1);
  const flattened = [];
  for (let segmentId = 0; segmentId < references.length; segmentId += 1) {
    offsets[segmentId] = flattened.length;
    for (const corridorId of [...new Set(references[segmentId])]) flattened.push(corridorId);
  }
  offsets[segmentRecordCount] = flattened.length;
  return { connectionCorridorOffsets: offsets, connectionCorridorIds: new Uint32Array(flattened) };
}

function routeCachePath(routes, provinces, heights, riverMask) {
  const digest = createHash('sha256')
    .update(ROUTING_CACHE_VERSION)
    .update(JSON.stringify(routes.map((route) => [route.start, route.end, route.nodeIds, route.points, route.infrastructureLevel, route.corridorRole])))
    .update(JSON.stringify(provinces.map((province) => [province.province_id, province.population, province.infrastructureLevel])))
    .update(Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength))
    .update(Buffer.from(riverMask.buffer, riverMask.byteOffset, riverMask.byteLength))
    .digest('hex').slice(0, 20);
  const directory = path.resolve('artifacts', 'road-cache');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${ROUTING_CACHE_VERSION}-${digest}.json`);
}

function adaptLogicalRoutesWithCache(routes, context, provinces) {
  const cachePath = routeCachePath(routes, provinces, context.heights, context.riverMask);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (cached.version === ROUTING_CACHE_VERSION && cached.routes.length === routes.length) {
        for (let index = 0; index < routes.length; index += 1) {
          routes[index].points = cached.routes[index].points;
          routes[index].bridges = cached.routes[index].bridges;
        }
        console.log(`Reused hierarchical road routing cache ${path.basename(cachePath)}`);
        return;
      }
    } catch (error) {
      console.warn(`Ignoring unreadable road routing cache: ${error.message}`);
    }
  }
  for (const route of routes) adaptRoute(route, context);
  writeFileSync(cachePath, JSON.stringify({ version: ROUTING_CACHE_VERSION, routes: routes.map((route) => ({ points: route.points, bridges: route.bridges })) }));
  console.log(`Stored hierarchical road routing cache ${path.basename(cachePath)}`);
}

export function buildInfrastructure({
  connectionData, networkData, provinces, heights, landField, riverMask, riverCoreMask, riverTexture, riverBed,
  fieldWidth, fieldHeight, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight,
}) {
  const assembled = assembleRoutes(connectionData, networkData, worldWidth);
  const classification = classifyInfrastructure(assembled.routes, assembled.nodes, assembled.adjacency, provinces, assembled.land);
  for (const province of provinces) province.infrastructureLevel = classification.provinceLevels.get(province.province_id) ?? 1;
  const provinceById = new Map(provinces.map((province) => [province.province_id, province]));
  for (const route of assembled.routes) {
    const contextualTimber = route.infrastructureLevel === 2 && route.provinceIds.some((id) => {
      const province = provinceById.get(id);
      return province?.terrain_type_id === 13 || province?.visual_terrain_tag === 'Boreal' || province?.visual_terrain_tag === 'Jungle';
    }) && Math.abs(Math.sin(route.id * 19.731)) > 0.22;
    route.surfaceMaterial = route.infrastructureLevel === 1 ? 0 : route.infrastructureLevel === 2 ? contextualTimber ? 2 : 1 : route.infrastructureLevel;
  }
  const context = { heights, landField, riverMask, riverCoreMask, riverTexture, fieldWidth, fieldHeight, worldWidth, worldHeight };
  const logicalRouteCount = assembled.routes.length;
  const gatewayCount = buildSharedGateways(assembled.routes, assembled.nodes, provinces, context);
  adaptLogicalRoutesWithCache(assembled.routes.slice(0, logicalRouteCount), context, provinces);
  for (const route of assembled.routes.slice(logicalRouteCount)) adaptRoute(route, context);
  const cityPlans = buildCityPlans(assembled.routes, assembled.nodes, provinces);
  const localStreetStart = assembled.routes.length;
  addLocalStreets(assembled.routes, cityPlans, context);
  for (const route of assembled.routes.slice(localStreetStart)) adaptRoute(route, context);
  gradeTerrain(assembled.routes, heights, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const meshes = buildMeshes(assembled.routes, heights, riverMask, riverBed, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const roadRaster = rasterRoadField(assembled.routes, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight, landField, fieldWidth, fieldHeight);
  const furniture = buildFurniture(assembled.routes, cityPlans, heights, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const mapping = buildConnectionCorridorMap(assembled.routes, logicalRouteCount, connectionData.segments.length);
  const classCounts = [0, 0, 0];
  const routeLevelCounts = [0, 0, 0, 0, 0];
  const materialCounts = [0, 0, 0, 0, 0, 0];
  for (const route of assembled.routes.slice(0, logicalRouteCount)) {
    classCounts[route.corridorRole] += 1;
    routeLevelCounts[route.infrastructureLevel - 1] += 1;
    materialCounts[route.surfaceMaterial] += 1;
  }
  const provinceLevelCounts = [0, 0, 0, 0, 0];
  for (const province of provinces) provinceLevelCounts[province.infrastructureLevel - 1] += 1;
  const bridgeTypes = [0, 0, 0];
  for (const bridge of meshes.bridgeRecords) bridgeTypes[bridge.type] += 1;
  let roadSamples = 0;
  let oceanRoadSamples = 0;
  let unbridgedRiverSamples = 0;
  let unbridgedLogicalRiverSamples = 0;
  let unbridgedGatewayRiverSamples = 0;
  let unbridgedLocalStreetRiverSamples = 0;
  for (const route of assembled.routes) {
    for (let index = 0; index < route.points.length; index += 1) {
      roadSamples += 1;
      const point = route.points[index];
      if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z) < 0.5) oceanRoadSamples += 1;
      const wet = sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z) > 0.10;
      const bridged = route.bridges.some((bridge) => index >= bridge.start && index <= bridge.end);
      if (wet && !bridged) {
        unbridgedRiverSamples += 1;
        if (route.localStreet) unbridgedLocalStreetRiverSamples += 1;
        else if (route.gateway) unbridgedGatewayRiverSamples += 1;
        else unbridgedLogicalRiverSamples += 1;
      }
    }
  }
  const widestBridge = [...meshes.bridgeRecords].sort((a, b) => b.span - a.span)[0];
  const lowestClearanceBridge = [...meshes.bridgeRecords].sort((a, b) => a.minimumClearance - b.minimumClearance)[0];
  const tallestPierBridge = [...meshes.bridgeRecords].sort((a, b) => b.maximumPierHeight - a.maximumPierHeight)[0];
  const longestTunnel = [...meshes.tunnelRecords].sort((a, b) => b.length - a.length)[0];
  const timberRoute = assembled.routes.find((route) => route.surfaceMaterial === 2);
  const largestCity = [...provinces].filter((province) => province.terrain_type_id === 14).sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  let mountainRoute;
  for (const route of assembled.routes.slice(0, logicalRouteCount)) {
    const elevation = Math.max(...route.profile);
    if (!mountainRoute || elevation > mountainRoute.elevation) mountainRoute = { x: route.points[Math.floor(route.points.length * 0.5)].x, z: route.points[Math.floor(route.points.length * 0.5)].z, elevation };
  }
  return {
    ...meshes, ...furniture, ...mapping, roadField: roadRaster.field, roadClearance: roadRaster.clearance, cityPlans,
    provinceLevels: classification.provinceLevels,
    stats: {
      landSegments: assembled.landSegmentCount, logicalRoutes: logicalRouteCount, localStreets: assembled.routes.filter((route) => route.localStreet).length,
      localRoutes: classCounts[0], regionalRoutes: classCounts[1], majorRoutes: classCounts[2],
      bridges: meshes.bridgeRecords.length, slabBridges: bridgeTypes[0], girderBridges: bridgeTypes[1], multiSpanBridges: bridgeTypes[2],
      tunnels: meshes.tunnelRecords.length, sharedGateways: gatewayCount, connectionCorridorReferences: mapping.connectionCorridorIds.length,
      level1Provinces: provinceLevelCounts[0], level2Provinces: provinceLevelCounts[1], level3Provinces: provinceLevelCounts[2],
      level4Provinces: provinceLevelCounts[3], level5Provinces: provinceLevelCounts[4],
      level1Routes: routeLevelCounts[0], level2Routes: routeLevelCounts[1], level3Routes: routeLevelCounts[2],
      dirtRoutes: materialCounts[0], gravelRoutes: materialCounts[1], timberRoutes: materialCounts[2], pavedRoutes: materialCounts[3],
      roadSamples, oceanRoadSamples, unbridgedRiverSamples,
      unbridgedLogicalRiverSamples, unbridgedGatewayRiverSamples, unbridgedLocalStreetRiverSamples,
      minimumBridgeClearance: meshes.bridgeRecords.length ? Math.min(...meshes.bridgeRecords.map((bridge) => bridge.minimumClearance)) : 0,
      maximumBridgeSeamError: meshes.bridgeRecords.length ? Math.max(...meshes.bridgeRecords.map((bridge) => bridge.seamError)) : 0,
      maximumBridgePierHeight: meshes.bridgeRecords.length ? Math.max(...meshes.bridgeRecords.map((bridge) => bridge.maximumPierHeight)) : 0,
    },
    showcases: {
      urban: [largestCity.center_x, largestCity.center_y],
      bridge: widestBridge ? [widestBridge.x, widestBridge.z] : [largestCity.center_x, largestCity.center_y],
      bridgeClearance: lowestClearanceBridge ? [lowestClearanceBridge.x, lowestClearanceBridge.z] : [largestCity.center_x, largestCity.center_y],
      bridgePier: tallestPierBridge ? [tallestPierBridge.x, tallestPierBridge.z] : [largestCity.center_x, largestCity.center_y],
      mountain: mountainRoute ? [mountainRoute.x, mountainRoute.z] : [largestCity.center_x, largestCity.center_y],
      tunnel: longestTunnel ? [longestTunnel.x, longestTunnel.z] : mountainRoute ? [mountainRoute.x, mountainRoute.z] : [largestCity.center_x, largestCity.center_y],
      timber: timberRoute ? [timberRoute.points[Math.floor(timberRoute.points.length * 0.5)].x, timberRoute.points[Math.floor(timberRoute.points.length * 0.5)].z] : [largestCity.center_x, largestCity.center_y],
      liangshan: [10_583, 2_990],
    },
  };
}
