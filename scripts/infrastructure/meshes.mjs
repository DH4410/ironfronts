import { LEVEL_WIDTHS, ROLE_WIDTH_SCALE, clamp, sampleHeight, sampleScalar, unwrapNear, wrap } from './common.mjs';

class RoadMesh {
  indices = [];

  constructor(vertexCapacity) {
    this.vertices = new Float32Array(vertexCapacity * 13);
    this.vertexCount = 0;
  }

  vertex(position, normal, uv, level, role, surface, structure, corridorId) {
    const index = this.vertexCount;
    const offset = index * 13;
    this.vertices.set(position, offset);
    this.vertices.set(normal, offset + 3);
    this.vertices.set(uv, offset + 6);
    this.vertices[offset + 8] = level;
    this.vertices[offset + 9] = role;
    this.vertices[offset + 10] = surface;
    this.vertices[offset + 11] = structure;
    this.vertices[offset + 12] = corridorId;
    this.vertexCount += 1;
    return index;
  }

  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }
}

function roadWidth(route) {
  const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
  return route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
    : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
}

export function buildMeshes(routes, heights, landField, width, height, worldWidth, worldHeight, chunksX = 32, chunksY = 16) {
  const vertexCapacity = routes.reduce((sum, route) => sum + (route.suppressed ? 0 : route.points.length * 2), 0);
  const hiddenVertexCapacity = routes.reduce((sum, route) => sum + (route.suppressed ? route.points.length * 2 : 0), 0);
  const roads = new RoadMesh(vertexCapacity);
  const hiddenConnections = new RoadMesh(hiddenVertexCapacity);
  const batches = [];
  const hiddenBatches = [];
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);

  for (const route of routes) {
    if (route.suppressed || route.points.length < 2) continue;
    const widthWorld = roadWidth(route);
    const surface = route.surfaceMaterial ?? (route.infrastructureLevel === 1 ? 0 : route.infrastructureLevel === 2 ? 1 : route.infrastructureLevel);
    const lift = route.gradeOverride ? 0.14 : route.infrastructureLevel === 1 ? 0.08 : 0.10;
    const cumulative = [0];
    for (let index = 1; index < route.points.length; index += 1) cumulative.push(cumulative[index - 1] + Math.hypot(
      unwrapNear(route.points[index].x, route.points[index - 1].x, worldWidth) - route.points[index - 1].x,
      route.points[index].z - route.points[index - 1].z));
    const emitted = Array.from({ length: route.points.length - 1 }, (_, index) =>
      route.sharedSegmentOwners ? route.sharedSegmentOwners[index] < 0 : true);
    const rings = [];
    // The nearby mesh represents the physical road core. Verges and ditches
    // remain in the terrain road field, avoiding a second coplanar ribbon and
    // keeping the single WebGPU vertex buffer below common 256 MiB limits.
    const offsets = [-widthWorld * 0.5, widthWorld * 0.5];
    for (let index = 0; index < route.points.length; index += 1) {
      if (!emitted[index - 1] && !emitted[index]) { rings.push(null); continue; }
      const point = route.points[index], previous = route.points[Math.max(0, index - 1)], next = route.points[Math.min(route.points.length - 1, index + 1)];
      const dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x, dz = next.z - previous.z;
      const length = Math.max(0.001, Math.hypot(dx, dz)), nx = -dz / length, nz = dx / length;
      const left = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx, point.z + nz);
      const right = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x - nx, point.z - nz);
      const before = sampleHeight(heights, width, height, worldWidth, worldHeight, previous.x, previous.z);
      const after = sampleHeight(heights, width, height, worldWidth, worldHeight, next.x, next.z);
      const normal = [clamp((before - after) / Math.max(1, length * 2), -0.5, 0.5), 1, clamp((right - left) * 0.5, -0.5, 0.5)];
      const normalScale = 1 / Math.max(0.001, Math.hypot(...normal));
      for (let component = 0; component < normal.length; component += 1) normal[component] *= normalScale;
      rings.push(offsets.map((offset, slot) => {
        const x = point.x + nx * offset, z = point.z + nz * offset;
        const terrain = sampleHeight(heights, width, height, worldWidth, worldHeight, x, z);
        const y = terrain + lift;
        return roads.vertex([x, y, z], normal, [cumulative[index] / 18, slot / (offsets.length - 1)],
          route.infrastructureLevel, route.corridorRole, surface, 0, route.id);
      }));
    }
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      if (!emitted[index] || !rings[index] || !rings[index + 1]) continue;
      const firstIndex = roads.indices.length;
      for (let strip = 0; strip + 1 < offsets.length; strip += 1) roads.quad(rings[index][strip], rings[index + 1][strip], rings[index + 1][strip + 1], rings[index][strip + 1]);
      const a = route.points[index], b = route.points[index + 1];
      batches.push({ chunk: chunkFor((a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, (a.z + b.z) * 0.5), firstIndex, indexCount: roads.indices.length - firstIndex });
    }
  }

  // Suppressed roads remain visible as narrow floating dotted connectors. They
  // are deliberately excluded from the road field and clearance maps: this is
  // a visual statement of logical connectivity, not physical infrastructure.
  for (const route of routes) {
    if (!route.suppressed || route.points.length < 2) continue;
    const halfWidth = 0.48;
    const cumulative = [0];
    for (let index = 1; index < route.points.length; index += 1) cumulative.push(cumulative[index - 1] + Math.hypot(
      unwrapNear(route.points[index].x, route.points[index - 1].x, worldWidth) - route.points[index - 1].x,
      route.points[index].z - route.points[index - 1].z));
    const rings = [];
    for (let index = 0; index < route.points.length; index += 1) {
      const point = route.points[index], previous = route.points[Math.max(0, index - 1)], next = route.points[Math.min(route.points.length - 1, index + 1)];
      const dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x, dz = next.z - previous.z;
      const length = Math.max(0.001, Math.hypot(dx, dz)), nx = -dz / length, nz = dx / length;
      rings.push([-halfWidth, halfWidth].map((offset, slot) => {
        const x = point.x + nx * offset, z = point.z + nz * offset;
        const dry = sampleScalar(landField, width, height, worldWidth, worldHeight, x, z) >= 0.5;
        const y = dry ? sampleHeight(heights, width, height, worldWidth, worldHeight, x, z) + 0.72 : 1.72;
        return hiddenConnections.vertex([x, y, z], [0, 1, 0], [cumulative[index], slot],
          route.infrastructureLevel, route.corridorRole, route.surfaceMaterial ?? 0, 12, route.id);
      }));
    }
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const firstIndex = hiddenConnections.indices.length;
      hiddenConnections.quad(rings[index][0], rings[index + 1][0], rings[index + 1][1], rings[index][1]);
      const a = route.points[index], b = route.points[index + 1];
      hiddenBatches.push({ chunk: chunkFor((a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, (a.z + b.z) * 0.5),
        firstIndex, indexCount: hiddenConnections.indices.length - firstIndex });
    }
  }

  const sortByChunk = (mesh, sourceBatches) => {
    const byChunk = Array.from({ length: chunksX * chunksY }, () => []);
    for (const batch of sourceBatches) byChunk[batch.chunk].push(batch);
    const sorted = new Uint32Array(mesh.indices.length);
    let sortedLength = 0;
    const ranges = [];
    for (const chunk of byChunk) {
      const firstIndex = sortedLength;
      for (const batch of chunk) for (let index = batch.firstIndex; index < batch.firstIndex + batch.indexCount; index += 1) sorted[sortedLength++] = mesh.indices[index];
      ranges.push({ firstIndex, indexCount: sortedLength - firstIndex });
    }
    return { indices: sorted, ranges };
  };
  const sortedRoads = sortByChunk(roads, batches);
  const sortedHidden = sortByChunk(hiddenConnections, hiddenBatches);
  return {
    roadVertices: roads.vertices.slice(0, roads.vertexCount * 13),
    roadIndices: sortedRoads.indices,
    hiddenConnectionVertices: hiddenConnections.vertices.slice(0, hiddenConnections.vertexCount * 13),
    hiddenConnectionIndices: sortedHidden.indices,
    chunkRanges: { chunksX, chunksY, roads: sortedRoads.ranges, hiddenConnections: sortedHidden.ranges },
  };
}
