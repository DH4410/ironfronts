import { ROLE_CONNECTOR, ROLE_LOCAL, ROLE_TRUNK, clamp, unwrapNear, wrap } from './common.mjs';

function percentileRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Float32Array(values.length);
  const divisor = Math.max(1, values.length - 1);
  for (let index = 0; index < sorted.length; index += 1) ranks[sorted[index].index] = index / divisor;
  return ranks;
}


export function assembleRoutes(connectionData, networkData, worldWidth) {
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

function distanceToWrappedSegment(point, start, end, worldWidth) {
  const px = unwrapNear(point.x, start.x, worldWidth);
  const ex = unwrapNear(end.x, start.x, worldWidth);
  const dx = ex - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0
    ? clamp(((px - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1)
    : 0;
  return Math.hypot(px - (start.x + dx * t), point.z - (start.z + dz * t));
}

// The visual road graph deliberately has no movement junction nodes or shared
// stems. Each unique land-adjacent province pair gets one independent road
// whose authoritative endpoints are the two province centers.
export function assembleProvinceRoutes(borderData, connectionData, networkData, provinces, worldWidth) {
  const nodes = new Map(networkData.nodes.map((node) => [node.node_id, node]));
  const centers = new Map(networkData.nodes
    .filter((node) => node.kind === 'province_center' && Number.isInteger(Number(node.location_id)))
    .map((node) => [Number(node.location_id), node]));
  const provinceById = new Map(provinces.map((province) => [province.province_id, province]));
  const pairToRoute = new Map();
  const routes = [];

  for (const border of borderData.segments) {
    if (border.neighbor_province_id === null || border.neighbor_province_id === undefined || border.neighbor_province_id === '') continue;
    const first = Number(border.province_id);
    const second = Number(border.neighbor_province_id);
    if (!Number.isInteger(first) || !Number.isInteger(second) || first === second) continue;
    const aId = Math.min(first, second), bId = Math.max(first, second);
    const key = `${aId}:${bId}`;
    if (pairToRoute.has(key)) continue;
    const a = centers.get(aId), b = centers.get(bId);
    if (!a || !b) continue;
    const population = Math.max(provinceById.get(aId)?.population ?? 0, provinceById.get(bId)?.population ?? 0);
    const route = {
      id: routes.length,
      start: a.node_id,
      end: b.node_id,
      nodeIds: [a.node_id, b.node_id],
      segmentIds: [],
      provinceIds: [aId, bId],
      points: [{ x: a.x, z: a.y }, { x: unwrapNear(b.x, a.x, worldWidth), z: b.y }],
      infrastructureLevel: 1,
      corridorRole: ROLE_LOCAL,
      roadClass: ROLE_LOCAL,
      surfaceMaterial: 0,
      importance: Math.log10(Math.max(1_000, population)),
      scoreRank: 0,
    };
    pairToRoute.set(key, route);
    routes.push(route);
  }

  const routesByProvince = new Map();
  for (const route of routes) {
    for (const provinceId of route.provinceIds) {
      if (!routesByProvince.has(provinceId)) routesByProvince.set(provinceId, []);
      routesByProvince.get(provinceId).push(route);
    }
  }

  const land = connectionData.segments.filter((segment) => segment.medium === 'land');
  const unmappedLandSegments = [];
  for (const segment of land) {
    const provinceId = Number(segment.location_id);
    const candidates = routesByProvince.get(provinceId) ?? [];
    const a = nodes.get(segment.node_a), b = nodes.get(segment.node_b);
    if (!candidates.length || !a || !b) {
      unmappedLandSegments.push(segment.segment_id);
      continue;
    }
    const midpoint = { x: (a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, z: (a.y + b.y) * 0.5 };
    let best = candidates[0], bestDistance = Infinity;
    for (const route of candidates) {
      const distance = distanceToWrappedSegment(midpoint, route.points[0], route.points[1], worldWidth);
      if (distance < bestDistance) { best = route; bestDistance = distance; }
    }
    best.segmentIds.push(segment.segment_id);
  }

  const adjacency = new Map();
  for (const route of routes) {
    for (const [nodeId, other] of [[route.start, route.end], [route.end, route.start]]) {
      if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
      adjacency.get(nodeId).push({ node: other, route: route.id });
    }
  }
  return { routes, nodes, adjacency, land, landSegmentCount: land.length, unmappedLandSegments };
}

export function classifyInfrastructure(routes, nodes, adjacency, provinces, landSegments) {
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
