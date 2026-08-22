import {
  CUT_FILL_LIMITS, LEVEL_WIDTHS, ROLE_WIDTH_SCALE, clamp, sampleHeight, sampleScalar, smoothstep, unwrapNear, wrap,
} from './common.mjs';

class InfrastructureMesh {
  vertices = new Float32Array(1_048_576);
  vertexLength = 0;
  indices = [];

  vertex(position, normal, uv, level, role, surfaceMaterial, structureMaterial, corridorId) {
    const values = [...position, ...normal, ...uv, level, role, surfaceMaterial, structureMaterial, corridorId];
    const index = this.vertexLength / 13;
    if (this.vertexLength + values.length > this.vertices.length) {
      let capacity = this.vertices.length;
      while (capacity < this.vertexLength + values.length) capacity *= 2;
      const grown = new Float32Array(capacity);
      grown.set(this.vertices.subarray(0, this.vertexLength));
      this.vertices = grown;
    }
    this.vertices.set(values, this.vertexLength);
    this.vertexLength += values.length;
    return index;
  }

  packedVertices() { return this.vertices.subarray(0, this.vertexLength); }

  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }

  wall(a, b, yMin, yMax, level, role, surfaceMaterial, structureMaterial, corridorId) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const normal = [-dz / length, 0, dx / length];
    const vertices = [
      this.vertex([a[0], yMin, a[1]], normal, [0, 0], level, role, surfaceMaterial, structureMaterial, corridorId),
      this.vertex([b[0], yMin, b[1]], normal, [1, 0], level, role, surfaceMaterial, structureMaterial, corridorId),
      this.vertex([b[0], yMax, b[1]], normal, [1, 1], level, role, surfaceMaterial, structureMaterial, corridorId),
      this.vertex([a[0], yMax, a[1]], normal, [0, 1], level, role, surfaceMaterial, structureMaterial, corridorId),
    ];
    this.quad(...vertices);
    this.quad(vertices[3], vertices[2], vertices[1], vertices[0]);
  }

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

  compactBox(center, yMin, yMax, length, width, angle, level, role, surfaceMaterial, structureMaterial, corridorId) {
    const forward = [Math.cos(angle), Math.sin(angle)];
    const right = [-forward[1], forward[0]];
    const footprint = [
      [-length * 0.5, -width * 0.5], [length * 0.5, -width * 0.5],
      [length * 0.5, width * 0.5], [-length * 0.5, width * 0.5],
    ].map(([along, across]) => [center[0] + forward[0] * along + right[0] * across, center[1] + forward[1] * along + right[1] * across]);
    const vertices = [];
    for (const y of [yMin, yMax]) {
      for (let index = 0; index < 4; index += 1) vertices.push(this.vertex([footprint[index][0], y, footprint[index][1]],
        [0, y === yMax ? 1 : -1, 0], [index & 1, index >> 1], level, role, surfaceMaterial, structureMaterial, corridorId));
    }
    this.quad(vertices[4], vertices[5], vertices[6], vertices[7]);
    this.quad(vertices[3], vertices[2], vertices[1], vertices[0]);
    this.quad(vertices[0], vertices[1], vertices[5], vertices[4]);
    this.quad(vertices[1], vertices[2], vertices[6], vertices[5]);
    this.quad(vertices[2], vertices[3], vertices[7], vertices[6]);
    this.quad(vertices[3], vertices[0], vertices[4], vertices[7]);
  }
}

export function buildMeshes(routes, heights, riverMask, riverBed, width, height, worldWidth, worldHeight, chunksX = 32, chunksY = 16) {
  const roads = new InfrastructureMesh();
  const bridges = new InfrastructureMesh();
  const tunnels = new InfrastructureMesh();
  const engineering = new InfrastructureMesh();
  const bridgeRecords = [];
  const tunnelRecords = [];
  const roadBatches = [];
  const bridgeBatches = [];
  const tunnelBatches = [];
  const engineeringBatches = [];
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);
  const pushBatch = (batches, start, end, x, z) => {
    if (end > start) batches.push({ chunk: chunkFor(x, z), start, count: end - start });
  };
  for (const route of routes) {
    if (route.suppressed) continue;
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
    const emittedRoadSegments = Array.from({ length: Math.max(0, route.points.length - 1) }, (_, index) =>
      route.sharedSegmentOwners?.[index] < 0
      && !(bridgeAt[index] >= 0 && bridgeAt[index + 1] >= 0)
      && !(tunnelAt[index] >= 0 && tunnelAt[index + 1] >= 0));
    const rings = [];
    for (let index = 0; index < route.points.length; index += 1) {
      if (!emittedRoadSegments[index - 1] && !emittedRoadSegments[index]) {
        rings.push(null);
        continue;
      }
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
      if (!emittedRoadSegments[index]) continue;
      const batchStart = roads.indices.length;
      for (let strip = 0; strip < 5; strip += 1) roads.quad(rings[index][strip], rings[index + 1][strip], rings[index + 1][strip + 1], rings[index][strip + 1]);
      const a = route.points[index], b = route.points[index + 1];
      pushBatch(roadBatches, batchStart, roads.indices.length, (a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, (a.z + b.z) * 0.5);

      const bx = unwrapNear(b.x, a.x, worldWidth);
      const segmentLength = Math.max(0.001, Math.hypot(bx - a.x, b.z - a.z));
      const angle = Math.atan2(b.z - a.z, bx - a.x);
      const rx = -Math.sin(angle), rz = Math.cos(angle);
      const centerX = (a.x + bx) * 0.5, centerZ = (a.z + b.z) * 0.5;
      const roadY = (deckProfile[index] + deckProfile[index + 1]) * 0.5;
      const outerOffset = roadWidth * 0.5 + shoulder * 0.82;
      for (const side of [-1, 1]) {
        const x = centerX + rx * outerOffset * side, z = centerZ + rz * outerOffset * side;
        const ground = sampleHeight(heights, width, height, worldWidth, worldHeight, x, z);
        const difference = roadY - ground;
        if (Math.abs(difference) < 4.0) continue;
        const engineeringStart = engineering.indices.length;
        const ax = a.x + rx * outerOffset * side, az = a.z + rz * outerOffset * side;
        const endX = bx + rx * outerOffset * side, endZ = b.z + rz * outerOffset * side;
        engineering.wall([ax, az], [endX, endZ], Math.min(ground, roadY - 0.08), Math.max(ground, roadY - 0.08),
          route.infrastructureLevel, route.corridorRole, surfaceMaterial, difference > 0 ? 9 : 7, corridorId);
        pushBatch(engineeringBatches, engineeringStart, engineering.indices.length, x, z);
      }
      const drainage = sampleScalar(riverMask, width, height, worldWidth, worldHeight, centerX, centerZ);
      if (drainage > 0.025 && drainage <= 0.10 && Math.floor(cumulative[index] / 12) !== Math.floor(cumulative[index + 1] / 12)) {
        const ground = sampleHeight(heights, width, height, worldWidth, worldHeight, centerX, centerZ);
        const engineeringStart = engineering.indices.length;
        engineering.box([centerX, centerZ], ground - 0.12, ground + 0.12, roadWidth + shoulder * 2 + 0.6, 0.42,
          angle + Math.PI * 0.5, route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
        pushBatch(engineeringBatches, engineeringStart, engineering.indices.length, centerX, centerZ);
      }
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
      const bridgeHalfWidth = (roadWidth + 1.0) * 0.5;
      let maximumWater = Number.NEGATIVE_INFINITY;
      for (let index = Math.max(interval.start, coreStart - 1); index < Math.min(interval.end, coreEnd + 1); index += 1) {
        const a = route.points[index], b = route.points[index + 1], bx = unwrapNear(b.x, a.x, worldWidth);
        const dx = bx - a.x, dz = b.z - a.z, length = Math.max(0.001, Math.hypot(dx, dz));
        const nx = -dz / length, nz = dx / length;
        const steps = Math.max(1, Math.ceil(length));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          for (const lateral of [-bridgeHalfWidth, 0, bridgeHalfWidth]) {
            const bed = sampleScalar(riverBed, width, height, worldWidth, worldHeight,
              a.x + dx * t + nx * lateral, a.z + dz * t + nz * lateral);
            if (Number.isFinite(bed)) maximumWater = Math.max(maximumWater, bed + 0.38);
          }
        }
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
          // A river core can legitimately reach the terminal movement endpoint.
          // With no dry exit ramp, keep the core deck height instead of pulling
          // the final bridge section down into the rendered water surface.
          const t = approachLength > 0.001 ? smoothstep(0, 1, (cumulative[index] - cumulative[coreEnd]) / approachLength) : 0;
          deckTop = coreEndTop * (1 - t) + endTop * t;
        } else {
          const t = (cumulative[index] - cumulative[coreStart]) / Math.max(0.001, cumulative[coreEnd] - cumulative[coreStart]);
          deckTop = coreStartTop * (1 - t) + coreEndTop * t;
        }
        deckHeights.push(deckTop);
      }
      const bridgeSections = [interval.start];
      for (let index = interval.start + 1; index <= interval.end; index += 1) {
        if (index === interval.end || cumulative[index] - cumulative[bridgeSections.at(-1)] >= 9.0) bridgeSections.push(index);
      }
      let minimumClearance = Number.POSITIVE_INFINITY;
      for (let section = 0; section + 1 < bridgeSections.length; section += 1) {
        const index = bridgeSections[section];
        const nextIndex = bridgeSections[section + 1];
        const a = route.points[index];
        const b = route.points[nextIndex];
        const bx = unwrapNear(b.x, a.x, worldWidth);
        const length = Math.hypot(bx - a.x, b.z - a.z);
        const angle = Math.atan2(b.z - a.z, bx - a.x);
        const center = [(a.x + bx) * 0.5, (a.z + b.z) * 0.5];
        const averageDeckY = (deckHeights[index - interval.start] + deckHeights[nextIndex - interval.start]) * 0.5;
        const sectionTouchesCore = nextIndex >= coreStart && index <= coreEnd;
        const y = sectionTouchesCore ? Math.max(averageDeckY, requiredTop) : averageDeckY;
        const clearanceSteps = Math.max(1, Math.ceil(length));
        const dx = bx - a.x, dz = b.z - a.z;
        const nx = -dz / Math.max(0.001, length), nz = dx / Math.max(0.001, length);
        for (let step = 0; step <= clearanceSteps; step += 1) {
          const t = step / clearanceSteps;
          for (const lateral of [-bridgeHalfWidth, 0, bridgeHalfWidth]) {
            const bed = sampleScalar(riverBed, width, height, worldWidth, worldHeight,
              a.x + dx * t + nx * lateral, a.z + dz * t + nz * lateral);
            if (Number.isFinite(bed)) minimumClearance = Math.min(minimumClearance, y - 0.58 - (bed + 0.38));
          }
        }
        const batchStart = bridges.indices.length;
        bridges.compactBox(center, y - 0.58, y, length + 0.18, roadWidth + 1.0, angle,
          route.infrastructureLevel, route.corridorRole, surfaceMaterial, 8, corridorId);
        const sideOffset = (roadWidth + 1.0) * 0.5 - 0.13;
        const rx = -Math.sin(angle), rz = Math.cos(angle);
        if (type > 0) {
          for (const side of [-1, 1]) {
            const girderCenter = [center[0] + rx * sideOffset * 0.72 * side, center[1] + rz * sideOffset * 0.72 * side];
            bridges.compactBox(girderCenter, y - 1.18, y - 0.46, length + 0.12, 0.24, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
          }
        }
        for (const side of [-1, 1]) {
          const railCenter = [center[0] + rx * sideOffset * side, center[1] + rz * sideOffset * side];
          if (type === 0) {
            bridges.compactBox(railCenter, y, y + 0.58, length + 0.1, 0.20, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, route.infrastructureLevel <= 2 ? 2 : 9, corridorId);
          } else {
            bridges.compactBox(railCenter, y + 0.58, y + 0.72, length + 0.1, 0.16, angle,
              route.infrastructureLevel, route.corridorRole, surfaceMaterial, 10, corridorId);
            if (section % 3 === 0) bridges.compactBox(railCenter, y, y + 0.70, 0.18, 0.18, angle,
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
          bridges.compactBox([point.x, point.z], ground, deckY, roadWidth * 0.58, 0.7, angle,
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
        bridges.compactBox([point.x, point.z], ground, y - 0.08, 1.1, roadWidth + 1.8, angle,
          route.infrastructureLevel, route.corridorRole, surfaceMaterial, 9, corridorId);
        pushBatch(bridgeBatches, batchStart, bridges.indices.length, point.x, point.z);
      }
      const midpoint = route.points[Math.floor((interval.start + interval.end) * 0.5)];
      bridgeRecords.push({
        routeId: route.id, start: interval.start, end: interval.end, coreStart, coreEnd,
        span: hydraulicSpan, type, x: midpoint.x, z: midpoint.z,
        minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : 1,
        maximumPierHeight: maximumGeneratedPierHeight,
        // A terminal crossing has no ordinary-road seam on that side.
        seamError: Math.max(
          coreStart > interval.start ? Math.abs(deckHeights[0] - startTop) : 0,
          coreEnd < interval.end ? Math.abs(deckHeights.at(-1) - endTop) : 0,
        ),
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
  const packedEngineering = reorderIndices(engineering.indices, engineeringBatches);
  return {
    roadVertices: roads.packedVertices(), roadIndices: packedRoads.indices,
    bridgeVertices: bridges.packedVertices(), bridgeIndices: packedBridges.indices, bridgeRecords,
    tunnelVertices: tunnels.packedVertices(), tunnelIndices: packedTunnels.indices, tunnelRecords,
    engineeringVertices: engineering.packedVertices(), engineeringIndices: packedEngineering.indices,
    chunkRanges: { chunksX, chunksY, roads: packedRoads.ranges, bridges: packedBridges.ranges, tunnels: packedTunnels.ranges,
      engineering: packedEngineering.ranges },
  };
}
