import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_GRADES, ROUTING_CACHE_VERSION, routeRoadWidth, sampleHeight, sampleScalar, unwrapNear, wrap } from './infrastructure/common.mjs';
import { buildMeshes } from './infrastructure/meshes.mjs';
import { assembleProvinceRoutes } from './infrastructure/network.mjs';
import { buildCorridorMetrics } from './infrastructure/network-compiler.mjs';
import { buildConnectionCorridorMap, buildFurniture, rasterRoadField } from './infrastructure/outputs.mjs';
import { adaptRoute, buildCityPlans } from './infrastructure/routing.mjs';

function routeCachePath(routes, provinces, heights, landField) {
  const digest = createHash('sha256')
    .update(ROUTING_CACHE_VERSION)
    .update(JSON.stringify(routes.map((route) => [route.start, route.end, route.nodeIds, route.points, route.infrastructureLevel, route.corridorRole])))
    .update(JSON.stringify(provinces.map((province) => [province.province_id, province.population, province.infrastructureLevel])))
    .update(Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength))
    .update(Buffer.from(landField.buffer, landField.byteOffset, landField.byteLength))
    .digest('hex').slice(0, 20);
  const directory = path.resolve('artifacts', 'road-cache');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${ROUTING_CACHE_VERSION}-${digest}.json`);
}

function adaptLogicalRoutesWithCache(routes, context, provinces) {
  const cachePath = routeCachePath(routes, provinces, context.heights, context.landField);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (cached.version === ROUTING_CACHE_VERSION && cached.routes.length === routes.length) {
        for (let index = 0; index < routes.length; index += 1) routes[index].points = cached.routes[index].points;
        console.log(`Reused terrain-draped road cache ${path.basename(cachePath)}`);
        return;
      }
    } catch (error) {
      console.warn(`Ignoring unreadable road routing cache: ${error.message}`);
    }
  }
  for (const route of routes) adaptRoute(route, context);
  writeFileSync(cachePath, JSON.stringify({ version: ROUTING_CACHE_VERSION, routes: routes.map((route) => ({ points: route.points })) }));
  console.log(`Stored terrain-draped road cache ${path.basename(cachePath)}`);
}

function auditRoute(route, context) {
  const { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  const halfWidth = routeRoadWidth(route) * 0.5 + (route.infrastructureLevel === 1 ? 0.45 : 0.75);
  const maximumGrade = MAX_GRADES[Math.max(0, Math.min(4, route.infrastructureLevel - 1))];
  let maximumObservedGrade = 0;
  for (let index = 0; index + 1 < route.points.length; index += 1) {
    const a = route.points[index], b = route.points[index + 1];
    const bx = unwrapNear(b.x, a.x, worldWidth), dx = bx - a.x, dz = b.z - a.z;
    const length = Math.max(0.001, Math.hypot(dx, dz)), nx = -dz / length, nz = dx / length;
    const steps = Math.max(1, Math.ceil(length));
    let previousHeight;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps, x = a.x + dx * t, z = a.z + dz * t;
      for (const lateral of [-halfWidth, 0, halfWidth]) {
        if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, x + nx * lateral, z + nz * lateral) < 0.5) {
          return { visible: false, reason: 'water', maximumGrade: maximumObservedGrade, x, z };
        }
      }
      const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z);
      if (previousHeight !== undefined) maximumObservedGrade = Math.max(maximumObservedGrade, Math.abs(terrain - previousHeight) / Math.max(0.001, length / steps));
      previousHeight = terrain;
    }
  }
  if (maximumObservedGrade > maximumGrade + 0.015) {
    const midpoint = route.points[Math.floor(route.points.length * 0.5)];
    return { visible: false, reason: 'grade', maximumGrade: maximumObservedGrade, x: midpoint.x, z: midpoint.z };
  }
  return { visible: true, maximumGrade: maximumObservedGrade };
}

function suppressIllegalCrossings(routes, logicalRouteCount, worldWidth) {
  const cellSize = 6;
  const cellsX = Math.ceil(worldWidth / cellSize);
  const cells = new Map();
  const ordered = routes.slice(0, logicalRouteCount).filter((route) => !route.suppressed)
    .sort((a, b) => b.corridorRole - a.corridorRole || b.infrastructureLevel - a.infrastructureLevel
      || b.importance - a.importance || a.id - b.id);
  const connected = (a, b) => a.start === b.start || a.start === b.end || a.end === b.start || a.end === b.end;
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(denominator) < 0.0001) return undefined;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
    const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator;
    return t >= -0.001 && t <= 1.001 && u >= -0.001 && u <= 1.001 ? { t, u } : undefined;
  };
  const hidden = [];
  for (const route of ordered) {
    let conflict;
    for (let index = 0; index + 1 < route.points.length && !conflict; index += 1) {
      const a = route.points[index], bx = unwrapNear(route.points[index + 1].x, a.x, worldWidth), bz = route.points[index + 1].z;
      const midpointX = wrap((a.x + bx) * 0.5, worldWidth), midpointZ = (a.z + bz) * 0.5;
      const cellX = Math.floor(midpointX / cellSize), cellZ = Math.floor(midpointZ / cellSize);
      const heading = Math.atan2(bz - a.z, bx - a.x);
      for (let oz = -1; oz <= 1 && !conflict; oz += 1) for (let ox = -1; ox <= 1 && !conflict; ox += 1) {
        const key = `${wrap(cellX + ox, cellsX)},${cellZ + oz}`;
        for (const candidate of cells.get(key) ?? []) {
          if (connected(route, candidate.route)) continue;
          const angle = Math.abs(Math.atan2(Math.sin(heading - candidate.heading), Math.cos(heading - candidate.heading)));
          if (Math.min(angle, Math.PI - angle) < 20 * Math.PI / 180) continue;
          const cx = unwrapNear(candidate.ax, a.x, worldWidth);
          const dx = unwrapNear(candidate.bx, cx, worldWidth);
          const intersection = cross(a.x, a.z, bx, bz, cx, candidate.az, dx, candidate.bz);
          if (!intersection) continue;
          conflict = { x: wrap(a.x + (bx - a.x) * intersection.t, worldWidth), z: a.z + (bz - a.z) * intersection.t,
            otherCorridorId: candidate.route.id };
          break;
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
      const a = route.points[index], bx = unwrapNear(route.points[index + 1].x, a.x, worldWidth), bz = route.points[index + 1].z;
      const midpointX = wrap((a.x + bx) * 0.5, worldWidth), midpointZ = (a.z + bz) * 0.5;
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
  const provinceLevels = new Map(provinces.map((province) => [province.province_id, 1]));
  for (const province of provinces) province.infrastructureLevel = 1;
  const context = { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight };
  const logicalRouteCount = assembled.routes.length;
  adaptLogicalRoutesWithCache(assembled.routes, context, provinces);
  const cityPlans = buildCityPlans(assembled.routes, assembled.nodes, provinces);

  const hiddenRoads = [];
  for (const route of assembled.routes) {
    route.profile = route.points.map((point) => sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z));
    const result = auditRoute(route, context);
    route.maximumObservedGrade = result.maximumGrade;
    if (result.visible) continue;
    route.suppressed = true;
    route.hiddenReason = result.reason;
    if (route.id < logicalRouteCount) hiddenRoads.push({ corridorId: route.id, reason: result.reason, x: result.x, z: result.z,
      endpoints: [route.start, route.end], affectedConnections: route.segmentIds, maximumGrade: result.maximumGrade });
  }

  for (const conflict of suppressIllegalCrossings(assembled.routes, logicalRouteCount, worldWidth)) {
    const { route } = conflict;
    hiddenRoads.push({ corridorId: route.id, reason: 'crossing', x: conflict.x, z: conflict.z,
      endpoints: [route.start, route.end], affectedConnections: route.segmentIds,
      otherCorridorId: conflict.otherCorridorId, maximumGrade: route.maximumObservedGrade });
  }

  const meshes = buildMeshes(assembled.routes, heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const corridorData = buildCorridorMetrics(assembled.routes, worldWidth);
  const roadRaster = rasterRoadField(assembled.routes, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight, landField, fieldWidth, fieldHeight);
  const furniture = buildFurniture(assembled.routes, cityPlans, heights, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const mapping = buildConnectionCorridorMap(assembled.routes, logicalRouteCount, connectionData.segments.length);

  const classCounts = [0, 0, 0], levelCounts = [0, 0, 0, 0, 0], materialCounts = [0, 0, 0, 0, 0, 0];
  for (const route of assembled.routes.slice(0, logicalRouteCount)) {
    classCounts[route.corridorRole] += 1;
    levelCounts[route.infrastructureLevel - 1] += 1;
    materialCounts[route.surfaceMaterial] += 1;
  }
  const provinceLevelCounts = [0, 0, 0, 0, 0];
  for (const province of provinces) provinceLevelCounts[province.infrastructureLevel - 1] += 1;
  const hiddenByReason = hiddenRoads.reduce((counts, road) => ({ ...counts, [road.reason]: (counts[road.reason] ?? 0) + 1 }), {});
  const largestCity = [...provinces].filter((province) => province.terrain_type_id === 14).sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  const mountainRoute = assembled.routes.slice(0, logicalRouteCount).filter((route) => !route.suppressed)
    .sort((a, b) => Math.max(...b.profile) - Math.max(...a.profile))[0];
  const dirtRoute = assembled.routes.find((route) => !route.suppressed && route.surfaceMaterial === 0);
  const steepRoute = assembled.routes.slice(0, logicalRouteCount).filter((route) => !route.suppressed)
    .sort((a, b) => b.maximumObservedGrade - a.maximumObservedGrade)[0];

  console.log(`Hidden physical roads: ${hiddenRoads.length} (${Object.entries(hiddenByReason).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'})`);
  return {
    ...meshes, ...furniture, ...mapping, ...corridorData,
    roadField: roadRaster.field, roadClearance: roadRaster.clearance, cityPlans,
    provinceLevels,
    roadReport: { version: 'world-generation-v5', logicalCorridors: logicalRouteCount,
      emittedCorridors: assembled.routes.slice(0, logicalRouteCount).filter((route) => !route.suppressed).length,
      hiddenCorridors: hiddenRoads.length, hiddenByReason, hiddenRoads,
      unmappedLandSegments: assembled.unmappedLandSegments, sharedSegments: 0, sharedLength: 0 },
    stats: {
      landSegments: assembled.landSegmentCount, logicalRoutes: logicalRouteCount,
      emittedRoutes: assembled.routes.slice(0, logicalRouteCount).filter((route) => !route.suppressed).length,
      hiddenRoutes: hiddenRoads.length, hiddenWaterRoutes: hiddenByReason.water ?? 0, hiddenGradeRoutes: hiddenByReason.grade ?? 0,
      hiddenCrossingRoutes: hiddenByReason.crossing ?? 0,
      unmappedLandSegments: assembled.unmappedLandSegments.length,
      localStreets: 0,
      localRoutes: classCounts[0], regionalRoutes: classCounts[1], majorRoutes: classCounts[2], sharedGateways: 0,
      physicalSharedSegments: 0, physicalSharedLength: 0,
      connectionCorridorReferences: mapping.connectionCorridorIds.length,
      level1Provinces: provinceLevelCounts[0], level2Provinces: provinceLevelCounts[1], level3Provinces: provinceLevelCounts[2],
      level4Provinces: provinceLevelCounts[3], level5Provinces: provinceLevelCounts[4],
      level1Routes: levelCounts[0], level2Routes: levelCounts[1], level3Routes: levelCounts[2],
      dirtRoutes: materialCounts[0], gravelRoutes: materialCounts[1], timberRoutes: materialCounts[2], pavedRoutes: materialCounts[3],
      oceanRoadSamples: 0,
    },
    showcases: {
      urban: [largestCity.center_x, largestCity.center_y],
      mountain: mountainRoute ? [mountainRoute.points[Math.floor(mountainRoute.points.length * 0.5)].x, mountainRoute.points[Math.floor(mountainRoute.points.length * 0.5)].z] : [largestCity.center_x, largestCity.center_y],
      steepRoad: steepRoute ? [steepRoute.points[Math.floor(steepRoute.points.length * 0.5)].x, steepRoute.points[Math.floor(steepRoute.points.length * 0.5)].z] : [largestCity.center_x, largestCity.center_y],
      dirtRoad: dirtRoute ? [dirtRoute.points[Math.floor(dirtRoute.points.length * 0.5)].x, dirtRoute.points[Math.floor(dirtRoute.points.length * 0.5)].z] : [largestCity.center_x, largestCity.center_y],
      europe: [7_050, 1_900], lakeRoad: [7_600, 2_600], liangshan: [10_583, 2_990],
    },
  };
}
