import { routeRoadWidth, unwrapNear, wrap } from './common.mjs';

export function compileSharedPhysicalNetwork(routes, worldWidth) {
  const cellSize = 7;
  const cells = new Map();
  const keyFor = (x, z) => `${Math.floor(wrap(x, worldWidth) / cellSize)},${Math.floor(z / cellSize)}`;
  const ordered = [...routes].sort((a, b) => b.corridorRole - a.corridorRole
    || b.infrastructureLevel - a.infrastructureLevel || b.importance - a.importance || a.id - b.id);
  let sharedSegments = 0, sharedLength = 0;
  for (const route of ordered) {
    route.sharedSegmentOwners = new Int32Array(Math.max(0, route.points.length - 1));
    route.sharedSegmentOwners.fill(-1);
    route.sharedCorridorIds = new Set([route.id]);
    if (route.suppressed) continue;
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index], b = route.points[index + 1];
      const bx = unwrapNear(b.x, a.x, worldWidth), dx = bx - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.5) continue;
      const midpoint = { x: wrap((a.x + bx) * 0.5, worldWidth), z: (a.z + b.z) * 0.5 };
      const heading = Math.atan2(dz, dx);
      const cellX = Math.floor(midpoint.x / cellSize), cellZ = Math.floor(midpoint.z / cellSize);
      let owner, ownerDistance = Number.POSITIVE_INFINITY;
      for (let oz = -1; oz <= 1; oz += 1) for (let ox = -1; ox <= 1; ox += 1) {
        for (const candidate of cells.get(`${cellX + ox},${cellZ + oz}`) ?? []) {
          if (candidate.routeId === route.id) continue;
          const angle = Math.abs(Math.atan2(Math.sin(heading - candidate.heading), Math.cos(heading - candidate.heading)));
          if (Math.min(angle, Math.PI - angle) > 20 * Math.PI / 180) continue;
          const distance = Math.hypot(unwrapNear(candidate.x, midpoint.x, worldWidth) - midpoint.x, candidate.z - midpoint.z);
          const mergeDistance = Math.min(5, (routeRoadWidth(route) + candidate.width) * 0.5 + 1.25);
          if (distance > mergeDistance || distance >= ownerDistance) continue;
          owner = candidate;
          ownerDistance = distance;
        }
      }
      if (owner) {
        route.sharedSegmentOwners[index] = owner.routeId;
        route.sharedCorridorIds.add(owner.routeId);
        sharedSegments += 1;
        sharedLength += length;
      } else {
        const entry = { routeId: route.id, x: midpoint.x, z: midpoint.z, heading, width: routeRoadWidth(route) };
        const key = keyFor(midpoint.x, midpoint.z);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(entry);
      }
    }
  }
  return { sharedSegments, sharedLength };
}

export function buildCorridorMetrics(routes, worldWidth) {
  const metrics = new Float32Array(routes.length * 6);
  const flags = new Uint32Array(routes.length * 4);
  for (const route of routes) {
    if (route.suppressed) {
      const reason = route.hiddenReason === 'water' ? 4 : route.hiddenReason === 'grade' ? 8 : route.hiddenReason === 'crossing' ? 16 : 32;
      flags.set([route.infrastructureLevel, route.corridorRole, route.surfaceMaterial ?? 0, reason], route.id * 4);
      continue;
    }
    let length = 0, ascent = 0, descent = 0, maximumGrade = 0, curvature = 0, sharedLength = 0;
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index], b = route.points[index + 1];
      const run = Math.max(0.001, Math.hypot(unwrapNear(b.x, a.x, worldWidth) - a.x, b.z - a.z));
      const rise = route.profile[index + 1] - route.profile[index];
      length += run;
      if (rise > 0) ascent += rise; else descent -= rise;
      maximumGrade = Math.max(maximumGrade, Math.abs(rise) / run);
      if (route.sharedSegmentOwners?.[index] >= 0) sharedLength += run;
      if (index > 0) {
        const previous = route.points[index - 1];
        const headingA = Math.atan2(a.z - previous.z, unwrapNear(a.x, previous.x, worldWidth) - previous.x);
        const headingB = Math.atan2(b.z - a.z, unwrapNear(b.x, a.x, worldWidth) - a.x);
        curvature += Math.abs(Math.atan2(Math.sin(headingB - headingA), Math.cos(headingB - headingA)));
      }
    }
    metrics.set([length, ascent, descent, maximumGrade, curvature / Math.max(1, route.points.length - 2), 1], route.id * 6);
    flags.set([route.infrastructureLevel, route.corridorRole, route.surfaceMaterial ?? 0, 1 | (sharedLength > 0 ? 2 : 0)], route.id * 4);
  }
  return { corridorMetrics: metrics, corridorFlags: flags };
}
