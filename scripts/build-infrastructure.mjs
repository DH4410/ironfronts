import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTING_CACHE_VERSION, sampleScalar } from './infrastructure/common.mjs';
import { buildMeshes } from './infrastructure/meshes.mjs';
import { buildConnectionCorridorMap, buildFurniture, rasterRoadField } from './infrastructure/outputs.mjs';
import { assembleRoutes, classifyInfrastructure } from './infrastructure/network.mjs';
import {
  buildCorridorMetrics, compileSharedPhysicalNetwork, normalizeBridgeIntervals, repairResidualRiverCrossings,
} from './infrastructure/network-compiler.mjs';
import { adaptRoute, addLocalStreets, buildCityPlans, buildSharedGateways } from './infrastructure/routing.mjs';
import {
  escalateTerrainConflicts, gradeTerrain, reinciseProtectedHydrology, runInfrastructureAuditAndRepair,
} from './infrastructure/terrain-solver.mjs';

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
  const context = { heights, landField, riverMask, riverCoreMask, riverTexture, riverBed, fieldWidth, fieldHeight, worldWidth, worldHeight };
  const logicalRouteCount = assembled.routes.length;
  const gatewayCount = buildSharedGateways(assembled.routes, assembled.nodes, provinces, context);
  adaptLogicalRoutesWithCache(assembled.routes.slice(0, logicalRouteCount), context, provinces);
  for (const route of assembled.routes.slice(logicalRouteCount)) adaptRoute(route, context);
  const cityPlans = buildCityPlans(assembled.routes, assembled.nodes, provinces);
  const localStreetStart = assembled.routes.length;
  addLocalStreets(assembled.routes, cityPlans, context);
  for (const route of assembled.routes.slice(localStreetStart)) adaptRoute(route, context);
  const residualBridges = repairResidualRiverCrossings(assembled.routes, context)
    + repairResidualRiverCrossings(assembled.routes, context)
    + repairResidualRiverCrossings(assembled.routes, context, true);
  normalizeBridgeIntervals(assembled.routes, context);
  const networkRepair = compileSharedPhysicalNetwork(assembled.routes, worldWidth);
  gradeTerrain(assembled.routes, heights, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight);
  reinciseProtectedHydrology(heights, landField, riverMask, riverCoreMask, riverBed);
  const structuralEscalation = escalateTerrainConflicts(assembled.routes, context);
  const audit = runInfrastructureAuditAndRepair(assembled.routes, context, roadFieldWidth, roadFieldHeight);
  for (const key of ['worstPenetration', 'worstUnsupported']) {
    const site = audit.report.violations[key];
    if (!site) continue;
    const route = assembled.routes[site.routeId];
    site.route = route ? { level: route.infrastructureLevel, role: route.corridorRole, localStreet: Boolean(route.localStreet),
      gateway: Boolean(route.gateway), pointCount: route.points.length, bridges: route.bridges?.length ?? 0, tunnels: route.tunnels?.length ?? 0 } : null;
  }
  audit.report.repairs.sharedSegments = networkRepair.sharedSegments;
  audit.report.repairs.sharedLength = networkRepair.sharedLength;
  mkdirSync(path.resolve('artifacts'), { recursive: true });
  writeFileSync(path.resolve('artifacts', 'infrastructure-audit-latest.json'), JSON.stringify(audit.report, null, 2));
  const meshes = buildMeshes(assembled.routes, heights, riverMask, riverBed, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const corridorData = buildCorridorMetrics(assembled.routes, worldWidth);
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
  const bridgeFailures = meshes.bridgeRecords.filter((bridge) => bridge.minimumClearance < 0.20 || bridge.seamError > 0.20 || bridge.maximumPierHeight > 18.01);
  if (bridgeFailures.length) {
    audit.report.severe.push(...bridgeFailures.slice(0, 64).map((bridge) => ({ type: 'invalid-bridge', routeId: bridge.routeId, x: bridge.x, z: bridge.z,
      minimumClearance: bridge.minimumClearance, seamError: bridge.seamError, maximumPierHeight: bridge.maximumPierHeight })));
    audit.report.violations.final = audit.report.severe.length;
    audit.report.converged = false;
  }
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
    ...meshes, ...furniture, ...mapping, ...corridorData,
    roadField: roadRaster.field, engineeringField: audit.engineeringField, roadClearance: roadRaster.clearance, cityPlans,
    infrastructureReport: audit.report,
    provinceLevels: classification.provinceLevels,
    stats: {
      landSegments: assembled.landSegmentCount, logicalRoutes: logicalRouteCount, localStreets: assembled.routes.filter((route) => route.localStreet).length,
      localRoutes: classCounts[0], regionalRoutes: classCounts[1], majorRoutes: classCounts[2],
      bridges: meshes.bridgeRecords.length, slabBridges: bridgeTypes[0], girderBridges: bridgeTypes[1], multiSpanBridges: bridgeTypes[2],
      tunnels: meshes.tunnelRecords.length, sharedGateways: gatewayCount, connectionCorridorReferences: mapping.connectionCorridorIds.length,
      physicalSharedSegments: networkRepair.sharedSegments, physicalSharedLength: networkRepair.sharedLength,
      residualBridges,
      auditAddedTunnels: structuralEscalation.addedTunnels, auditLoweredViaducts: structuralEscalation.loweredViaducts,
      auditPasses: audit.report.passes, auditInitialViolations: audit.report.violations.initial,
      auditSevereViolations: audit.report.violations.final, auditTerrainRepairs: audit.report.repairs.terrainCells,
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
