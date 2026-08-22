import {
  LEVEL_WIDTHS, MAX_GRADES, ROLE_WIDTH_SCALE, clamp, sampleHeight, smoothstep, unwrapNear, wrap,
} from './common.mjs';

export function rasterRoadField(routes, width, height, worldWidth, worldHeight, landField, landWidth, landHeight) {
  const field = new Uint8Array(width * height * 4);
  const clearance = new Uint8Array(width * height);
  for (const route of routes) {
    if (route.suppressed) continue;
    const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
    const coreWorld = route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
      : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
    const shoulderWorld = coreWorld + (route.infrastructureLevel === 1 ? 0.45 : route.localStreet ? 0.7 : 1.25 + levelIndex * 0.28);
    const surfaceMaterial = route.surfaceMaterial ?? (route.infrastructureLevel === 1 ? 0 : route.infrastructureLevel === 2 ? 1 : route.infrastructureLevel);
    const packedMetadata = (route.corridorRole & 3) | (route.localStreet ? 4 : 0) | ((surfaceMaterial & 7) << 3);
    for (let pointIndex = 0; pointIndex < route.points.length; pointIndex += 1) {
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

export function buildFurniture(routes, cityPlans, heights, width, height, worldWidth, worldHeight) {
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
    if (route.suppressed) continue;
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

export function buildConnectionCorridorMap(routes, logicalRouteCount, segmentRecordCount) {
  const references = Array.from({ length: segmentRecordCount }, () => []);
  for (const route of routes.slice(0, logicalRouteCount)) {
    const physicalOwners = route.sharedSegmentOwners ? [...new Set([...route.sharedSegmentOwners].filter((owner) => owner >= 0))] : [];
    const emitsOwnGeometry = !route.sharedSegmentOwners || [...route.sharedSegmentOwners].some((owner) => owner < 0);
    const corridors = [route.startGateway, ...(emitsOwnGeometry ? [route.id] : []), ...physicalOwners, route.endGateway]
      .filter((value, index, values) => Number.isInteger(value) && values.indexOf(value) === index);
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
