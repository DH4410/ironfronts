import {
  intervalAt, routeRoadWidth, sampleScalar, unwrapNear, wrap,
} from './common.mjs';
import { moveToValidLand } from './routing.mjs';

export function compileSharedPhysicalNetwork(routes, worldWidth) {
  const cellSize = 7;
  const cells = new Map();
  const keyFor = (x, z) => `${Math.floor(wrap(x, worldWidth) / cellSize)},${Math.floor(z / cellSize)}`;
  const ordered = [...routes].sort((a, b) => b.corridorRole - a.corridorRole
    || b.infrastructureLevel - a.infrastructureLevel || b.importance - a.importance || a.id - b.id);
  let sharedSegments = 0;
  let sharedLength = 0;
  for (const route of ordered) {
    route.sharedSegmentOwners = new Int32Array(Math.max(0, route.points.length - 1));
    route.sharedSegmentOwners.fill(-1);
    route.sharedCorridorIds = new Set([route.id]);
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index], b = route.points[index + 1];
      const bx = unwrapNear(b.x, a.x, worldWidth);
      const dx = bx - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.5) continue;
      const midpoint = { x: wrap((a.x + bx) * 0.5, worldWidth), z: (a.z + b.z) * 0.5 };
      const heading = Math.atan2(dz, dx);
      const cellX = Math.floor(wrap(midpoint.x, worldWidth) / cellSize);
      const cellZ = Math.floor(midpoint.z / cellSize);
      let owner;
      let ownerDistance = Number.POSITIVE_INFINITY;
      for (let oz = -1; oz <= 1; oz += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const candidates = cells.get(`${cellX + ox},${cellZ + oz}`) ?? [];
          for (const candidate of candidates) {
            if (candidate.routeId === route.id) continue;
            const angleDifference = Math.abs(Math.atan2(Math.sin(heading - candidate.heading), Math.cos(heading - candidate.heading)));
            const parallelDifference = Math.min(angleDifference, Math.PI - angleDifference);
            if (parallelDifference > 20 * Math.PI / 180) continue;
            const distance = Math.hypot(unwrapNear(candidate.x, midpoint.x, worldWidth) - midpoint.x, candidate.z - midpoint.z);
            const mergeDistance = Math.min(5, (routeRoadWidth(route) + candidate.width) * 0.5 + 1.25);
            if (distance > mergeDistance || distance >= ownerDistance) continue;
            owner = candidate;
            ownerDistance = distance;
          }
        }
      }
      if (owner && !intervalAt(route, index, 'bridges') && !intervalAt(route, index, 'tunnels')) {
        route.sharedSegmentOwners[index] = owner.routeId;
        route.sharedCorridorIds.add(owner.routeId);
        sharedSegments += 1;
        sharedLength += length;
      } else {
        const entry = { routeId: route.id, segmentIndex: index, x: midpoint.x, z: midpoint.z, heading, width: routeRoadWidth(route) };
        const key = keyFor(midpoint.x, midpoint.z);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(entry);
      }
    }
  }
  return { sharedSegments, sharedLength };
}

export function repairResidualRiverCrossings(routes, context, forceLongBridge = false) {
  const { landField, riverMask, riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  let added = 0;
  for (const route of routes) {
    if (route.suppressed) continue;
    const halfWidth = routeRoadWidth(route) * 0.5 + 0.5;
    const wetSegments = [];
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      if (intervalAt(route, index, 'bridges')) continue;
      const a = route.points[index], b = route.points[index + 1], bx = unwrapNear(b.x, a.x, worldWidth);
      const length = Math.hypot(bx - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(length / 0.40));
      let wet = false;
      const dx = bx - a.x, dz = b.z - a.z;
      const inverseLength = 1 / Math.max(0.001, length);
      const nx = -dz * inverseLength, nz = dx * inverseLength;
      for (let step = 0; step <= steps && !wet; step += 1) {
        const t = step / steps;
        for (const lateral of [-halfWidth, 0, halfWidth]) {
          wet ||= sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight,
            a.x + dx * t + nx * lateral, a.z + dz * t + nz * lateral) > 0.10;
        }
      }
      if (wet) wetSegments.push(index);
    }
    if (!wetSegments.length) continue;
    const groups = [];
    for (const index of wetSegments) {
      const previous = groups.at(-1);
      if (previous && index <= previous.end + 1) previous.end = index;
      else groups.push({ start: index, end: index });
    }
    for (const group of groups) {
      let span = 0;
      for (let index = group.start; index <= group.end; index += 1) span += Math.hypot(
        unwrapNear(route.points[index + 1].x, route.points[index].x, worldWidth) - route.points[index].x,
        route.points[index + 1].z - route.points[index].z);
      if (span > 78 && !forceLongBridge) {
        for (let index = group.start; index <= group.end + 1; index += 1) {
          route.points[index] = moveToValidLand(route.points[index], landField, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, true);
        }
        continue;
      }
      route.bridges.push({ start: Math.max(0, group.start - 2), end: Math.min(route.points.length - 1, group.end + 3),
        coreStart: group.start, coreEnd: group.end + 1 });
      added += 1;
    }
    route.bridges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const interval of route.bridges) {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end);
        previous.coreStart = Math.min(previous.coreStart, interval.coreStart);
        previous.coreEnd = Math.max(previous.coreEnd, interval.coreEnd);
      } else merged.push({ ...interval });
    }
    route.bridges = merged;
  }
  return added;
}

export function normalizeBridgeIntervals(routes, context) {
  const { riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  let intervals = 0;
  for (const route of routes) {
    const halfWidth = routeRoadWidth(route) * 0.5 + 0.5;
    const wetSegments = [];
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index], b = route.points[index + 1], bx = unwrapNear(b.x, a.x, worldWidth);
      const dx = bx - a.x, dz = b.z - a.z, length = Math.max(0.001, Math.hypot(dx, dz));
      const nx = -dz / length, nz = dx / length;
      const steps = Math.max(1, Math.ceil(length / 0.4));
      let wet = false;
      for (let step = 0; step <= steps && !wet; step += 1) {
        const t = step / steps;
        for (const lateral of [-halfWidth, 0, halfWidth]) {
          wet ||= sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight,
            a.x + dx * t + nx * lateral, a.z + dz * t + nz * lateral) > 0.10;
        }
      }
      if (wet) wetSegments.push(index);
    }
    const groups = [];
    for (const index of wetSegments) {
      const previous = groups.at(-1);
      if (previous && index <= previous.end + 1) previous.end = index;
      else groups.push({ start: index, end: index });
    }
    route.bridges = groups.map((group) => ({
      start: Math.max(0, group.start - 2),
      end: Math.min(route.points.length - 1, group.end + 3),
      coreStart: group.start,
      coreEnd: group.end + 1,
    }));
    intervals += route.bridges.length;
  }
  return intervals;
}

export function buildCorridorMetrics(routes, worldWidth) {
  const metrics = new Float32Array(routes.length * 8);
  const flags = new Uint32Array(routes.length * 4);
  for (const route of routes) {
    if (route.suppressed) {
      flags.set([route.infrastructureLevel, route.corridorRole, route.surfaceMaterial ?? 0, 8], route.id * 4);
      continue;
    }
    let length = 0, ascent = 0, descent = 0, maximumGrade = 0, curvature = 0, bridgeLength = 0, tunnelLength = 0;
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index], b = route.points[index + 1];
      const run = Math.max(0.001, Math.hypot(unwrapNear(b.x, a.x, worldWidth) - a.x, b.z - a.z));
      const rise = route.profile[index + 1] - route.profile[index];
      length += run;
      if (rise > 0) ascent += rise; else descent -= rise;
      maximumGrade = Math.max(maximumGrade, Math.abs(rise) / run);
      if (intervalAt(route, index, 'bridges')) bridgeLength += run;
      if (intervalAt(route, index, 'tunnels')) tunnelLength += run;
      if (index > 0) {
        const previous = route.points[index - 1];
        const headingA = Math.atan2(a.z - previous.z, unwrapNear(a.x, previous.x, worldWidth) - previous.x);
        const headingB = Math.atan2(b.z - a.z, unwrapNear(b.x, a.x, worldWidth) - a.x);
        curvature += Math.abs(Math.atan2(Math.sin(headingB - headingA), Math.cos(headingB - headingA)));
      }
    }
    const sharedLength = route.sharedSegmentOwners?.reduce((sum, owner, index) => owner >= 0 ? sum + Math.hypot(
      unwrapNear(route.points[index + 1].x, route.points[index].x, worldWidth) - route.points[index].x,
      route.points[index + 1].z - route.points[index].z) : sum, 0) ?? 0;
    metrics.set([length, ascent, descent, maximumGrade, curvature / Math.max(1, route.points.length - 2),
      length ? (bridgeLength + tunnelLength) / length : 0, bridgeLength, tunnelLength], route.id * 8);
    const repairFlags = (sharedLength > 0 ? 1 : 0) | ((route.bridges?.length ?? 0) ? 2 : 0) | ((route.tunnels?.length ?? 0) ? 4 : 0);
    flags.set([route.infrastructureLevel, route.corridorRole, route.surfaceMaterial ?? 0, repairFlags], route.id * 4);
  }
  return { corridorMetrics: metrics, corridorFlags: flags };
}
