import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROAD_MAX_GRADE, ROAD_WIDTH, ROUTING_CACHE_VERSION, sampleHeight, sampleScalar, unwrapNear, wrap } from './infrastructure/common.mjs';
import { buildCityPlans } from './infrastructure/city-plans.mjs';
import { buildMeshes } from './infrastructure/meshes.mjs';
import { assembleProvinceRoutes } from './infrastructure/province-routes.mjs';
import { buildFurniture, rasterRoadField } from './infrastructure/outputs.mjs';
import { adaptRoute } from './infrastructure/road-routing.mjs';

function routeCachePath(routes, heights, landField) {
  const digest = createHash('sha256')
    .update(ROUTING_CACHE_VERSION)
    .update(JSON.stringify(routes.map((route) => [route.start, route.end, route.points])))
    .update(Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength))
    .update(Buffer.from(landField.buffer, landField.byteOffset, landField.byteLength))
    .digest('hex').slice(0, 20);
  const directory = path.resolve('artifacts', 'road-cache');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${ROUTING_CACHE_VERSION}-${digest}.json`);
}

function adaptRoutesWithCache(routes, context) {
  const cachePath = routeCachePath(routes, context.heights, context.landField);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (cached.version === ROUTING_CACHE_VERSION && cached.routes.length === routes.length) {
        for (let index = 0; index < routes.length; index += 1) routes[index].points = cached.routes[index];
        console.log(`Reused terrain-draped road cache ${path.basename(cachePath)}`);
        return;
      }
    } catch (error) {
      console.warn(`Ignoring unreadable road routing cache: ${error.message}`);
    }
  }
  for (const route of routes) adaptRoute(route, context);
  writeFileSync(cachePath, JSON.stringify({ version: ROUTING_CACHE_VERSION, routes: routes.map((route) => route.points) }));
  console.log(`Stored terrain-draped road cache ${path.basename(cachePath)}`);
}

function auditRoute(route, context) {
  const { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  const halfWidth = ROAD_WIDTH * 0.5 + 0.45;
  let maximumGrade = 0;
  for (let index = 0; index + 1 < route.points.length; index += 1) {
    const a = route.points[index];
    const b = route.points[index + 1];
    const bx = unwrapNear(b.x, a.x, worldWidth);
    const dx = bx - a.x;
    const dz = b.z - a.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const steps = Math.max(1, Math.ceil(length));
    let previousHeight;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      for (const lateral of [-halfWidth, 0, halfWidth]) {
        if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, x + nx * lateral, z + nz * lateral) < 0.5) {
          return { visible: false, reason: 'water', maximumGrade, x, z };
        }
      }
      const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z);
      if (previousHeight !== undefined) maximumGrade = Math.max(maximumGrade,
        Math.abs(terrain - previousHeight) / Math.max(0.001, length / steps));
      previousHeight = terrain;
    }
  }
  return { visible: true, maximumGrade };
}

function suppressIllegalCrossings(routes, worldWidth) {
  const cellSize = 6;
  const cellsX = Math.ceil(worldWidth / cellSize);
  const cells = new Map();
  const ordered = routes.filter((route) => !route.suppressed)
    .sort((a, b) => Number(a.gradeWarning) - Number(b.gradeWarning) || b.population - a.population || a.id - b.id);
  const connected = (a, b) => a.start === b.start || a.start === b.end || a.end === b.start || a.end === b.end;
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(denominator) < 0.0001) return undefined;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
    const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator;
    return t >= -0.001 && t <= 1.001 && u >= -0.001 && u <= 1.001 ? { t } : undefined;
  };
  const hidden = [];
  for (const route of ordered) {
    let conflict;
    for (let index = 0; index + 1 < route.points.length && !conflict; index += 1) {
      const a = route.points[index];
      const bx = unwrapNear(route.points[index + 1].x, a.x, worldWidth);
      const bz = route.points[index + 1].z;
      const midpointX = wrap((a.x + bx) * 0.5, worldWidth);
      const midpointZ = (a.z + bz) * 0.5;
      const cellX = Math.floor(midpointX / cellSize);
      const cellZ = Math.floor(midpointZ / cellSize);
      const heading = Math.atan2(bz - a.z, bx - a.x);
      for (let oz = -1; oz <= 1 && !conflict; oz += 1) {
        for (let ox = -1; ox <= 1 && !conflict; ox += 1) {
          const key = `${wrap(cellX + ox, cellsX)},${cellZ + oz}`;
          for (const candidate of cells.get(key) ?? []) {
            if (connected(route, candidate.route)) continue;
            const angle = Math.abs(Math.atan2(Math.sin(heading - candidate.heading), Math.cos(heading - candidate.heading)));
            if (Math.min(angle, Math.PI - angle) < 20 * Math.PI / 180) continue;
            const cx = unwrapNear(candidate.ax, a.x, worldWidth);
            const candidateBx = unwrapNear(candidate.bx, cx, worldWidth);
            const intersection = cross(a.x, a.z, bx, bz, cx, candidate.az, candidateBx, candidate.bz);
            if (!intersection) continue;
            conflict = { x: wrap(a.x + (bx - a.x) * intersection.t, worldWidth), z: a.z + (bz - a.z) * intersection.t,
              otherRoadId: candidate.route.id };
            break;
          }
        }
      }
    }
    if (conflict) {
      route.suppressed = true;
      route.hiddenReason = 'crossing';
      hidden.push({ route, ...conflict });
      continue;
    }
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index];
      const bx = unwrapNear(route.points[index + 1].x, a.x, worldWidth);
      const bz = route.points[index + 1].z;
      const midpointX = wrap((a.x + bx) * 0.5, worldWidth);
      const midpointZ = (a.z + bz) * 0.5;
      const key = `${Math.floor(midpointX / cellSize)},${Math.floor(midpointZ / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ route, ax: a.x, az: a.z, bx: wrap(bx, worldWidth), bz, heading: Math.atan2(bz - a.z, bx - a.x) });
    }
  }
  return hidden;
}

export function buildInfrastructure({
  borderData, connectionData, networkData, provinces, heights, landField,
  fieldWidth, fieldHeight, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight,
}) {
  const assembled = assembleProvinceRoutes(borderData, connectionData, networkData, provinces, worldWidth);
  const context = { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight };
  adaptRoutesWithCache(assembled.routes, context);
  const cityPlans = buildCityPlans(assembled.routes, assembled.nodes, provinces, worldWidth);
  const hiddenRoads = [];
  const gradeWarnings = [];

  for (const route of assembled.routes) {
    route.profile = route.points.map((point) => sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z));
    const result = auditRoute(route, context);
    route.maximumGrade = result.maximumGrade;
    if (result.maximumGrade > ROAD_MAX_GRADE + 0.015) {
      route.gradeWarning = true;
      const midpoint = route.points[Math.floor(route.points.length * 0.5)];
      gradeWarnings.push({ roadId: route.id, x: midpoint.x, z: midpoint.z,
        endpoints: [route.start, route.end], affectedConnections: route.segmentIds, maximumGrade: result.maximumGrade });
    }
    if (result.visible) continue;
    route.suppressed = true;
    route.hiddenReason = result.reason;
    hiddenRoads.push({ roadId: route.id, reason: result.reason, x: result.x, z: result.z,
      endpoints: [route.start, route.end], affectedConnections: route.segmentIds, maximumGrade: result.maximumGrade });
  }

  for (const conflict of suppressIllegalCrossings(assembled.routes, worldWidth)) {
    const { route } = conflict;
    hiddenRoads.push({ roadId: route.id, reason: 'crossing', x: conflict.x, z: conflict.z,
      endpoints: [route.start, route.end], affectedConnections: route.segmentIds,
      otherRoadId: conflict.otherRoadId, maximumGrade: route.maximumGrade });
  }

  const meshes = buildMeshes(assembled.routes, heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const roadRaster = rasterRoadField(assembled.routes, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight,
    landField, fieldWidth, fieldHeight);
  const furniture = buildFurniture(assembled.routes, cityPlans, worldWidth);
  const hiddenByReason = hiddenRoads.reduce((counts, road) => ({ ...counts, [road.reason]: (counts[road.reason] ?? 0) + 1 }), {});
  const largestCity = [...provinces].filter((province) => province.terrain_type_id === 14)
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  const visibleRoads = assembled.routes.filter((route) => !route.suppressed);
  const mountainRoad = [...visibleRoads].sort((a, b) => Math.max(...b.profile) - Math.max(...a.profile))[0];
  const steepRoad = [...visibleRoads].sort((a, b) => b.maximumGrade - a.maximumGrade)[0];
  const hiddenShowcase = hiddenRoads.find((road) => road.reason === 'water') ?? hiddenRoads[0];
  const midpoint = (road) => road.points[Math.floor(road.points.length * 0.5)];

  console.log(`Hidden physical roads: ${hiddenRoads.length} (${Object.entries(hiddenByReason).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'})`);
  return {
    ...meshes,
    ...furniture,
    roadField: roadRaster.field,
    roadClearance: roadRaster.clearance,
    cityPlans,
    roadReport: {
      version: 'direct-roads-v1',
      logicalRoads: assembled.routes.length,
      emittedRoads: visibleRoads.length,
      hiddenRoadCount: hiddenRoads.length,
      hiddenByReason,
      hiddenRoads,
      gradeWarnings: gradeWarnings.map((warning) => ({ ...warning, emitted: !assembled.routes[warning.roadId].suppressed })),
      unmappedLandSegments: assembled.unmappedLandSegments,
    },
    stats: {
      landSegments: assembled.landSegmentCount,
      logicalRoads: assembled.routes.length,
      emittedRoads: visibleRoads.length,
      hiddenRoads: hiddenRoads.length,
      hiddenWaterRoads: hiddenByReason.water ?? 0,
      hiddenCrossingRoads: hiddenByReason.crossing ?? 0,
      steepRoads: gradeWarnings.length,
      steepEmittedRoads: gradeWarnings.filter((warning) => !assembled.routes[warning.roadId].suppressed).length,
      unmappedLandSegments: assembled.unmappedLandSegments.length,
    },
    showcases: {
      urban: [largestCity.center_x, largestCity.center_y],
      mountain: mountainRoad ? [midpoint(mountainRoad).x, midpoint(mountainRoad).z] : [largestCity.center_x, largestCity.center_y],
      steepRoad: steepRoad ? [midpoint(steepRoad).x, midpoint(steepRoad).z] : [largestCity.center_x, largestCity.center_y],
      dirtRoad: visibleRoads[0] ? [midpoint(visibleRoads[0]).x, midpoint(visibleRoads[0]).z] : [largestCity.center_x, largestCity.center_y],
      hiddenConnection: hiddenShowcase ? [hiddenShowcase.x, hiddenShowcase.z] : [largestCity.center_x, largestCity.center_y],
      europe: [7_050, 1_900], lakeRoad: [7_600, 2_600], liangshan: [10_583, 2_990],
    },
  };
}
