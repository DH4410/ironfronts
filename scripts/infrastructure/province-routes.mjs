import { clamp, unwrapNear } from './common.mjs';

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

// The visual road graph deliberately has no movement junction nodes, shared
// stems, hierarchy, or inferred local streets. Each unique land-adjacent
// province pair receives one independent dirt path between province centers.
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
    const aId = Math.min(first, second);
    const bId = Math.max(first, second);
    const key = `${aId}:${bId}`;
    if (pairToRoute.has(key)) continue;
    const a = centers.get(aId);
    const b = centers.get(bId);
    if (!a || !b) continue;
    const route = {
      id: routes.length,
      start: a.node_id,
      end: b.node_id,
      segmentIds: [],
      provinceIds: [aId, bId],
      points: [{ x: a.x, z: a.y }, { x: unwrapNear(b.x, a.x, worldWidth), z: b.y }],
      population: Math.max(provinceById.get(aId)?.population ?? 0, provinceById.get(bId)?.population ?? 0),
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
    const a = nodes.get(segment.node_a);
    const b = nodes.get(segment.node_b);
    if (!candidates.length || !a || !b) {
      unmappedLandSegments.push(segment.segment_id);
      continue;
    }
    const midpoint = { x: (a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, z: (a.y + b.y) * 0.5 };
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const route of candidates) {
      const distance = distanceToWrappedSegment(midpoint, route.points[0], route.points[1], worldWidth);
      if (distance < bestDistance) {
        best = route;
        bestDistance = distance;
      }
    }
    best.segmentIds.push(segment.segment_id);
  }

  return { routes, nodes, landSegmentCount: land.length, unmappedLandSegments };
}
