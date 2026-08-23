import { ROAD_WIDTH, clamp, sampleHeight, sampleScalar, unwrapNear, wrap } from './common.mjs';

const VERTEX_STRIDE = 9;
const ROAD_KIND = 0;
const DOTTED_KIND = 1;

class RoadMesh {
  indices = [];

  constructor(vertexCapacity) {
    this.vertices = new Float32Array(vertexCapacity * VERTEX_STRIDE);
    this.vertexCount = 0;
  }

  vertex(position, normal, uv, kind) {
    const index = this.vertexCount;
    const offset = index * VERTEX_STRIDE;
    this.vertices.set(position, offset);
    this.vertices.set(normal, offset + 3);
    this.vertices.set(uv, offset + 6);
    this.vertices[offset + 8] = kind;
    this.vertexCount += 1;
    return index;
  }

  quad(a, b, c, d) {
    this.indices.push(a, b, c, a, c, d);
  }
}

function sortByChunk(mesh, batches, chunksX, chunksY) {
  const byChunk = Array.from({ length: chunksX * chunksY }, () => []);
  for (const batch of batches) byChunk[batch.chunk].push(batch);
  const sorted = new Uint32Array(mesh.indices.length);
  let cursor = 0;
  const ranges = [];
  for (const chunk of byChunk) {
    const firstIndex = cursor;
    for (const batch of chunk) {
      for (let index = batch.firstIndex; index < batch.firstIndex + batch.indexCount; index += 1) sorted[cursor++] = mesh.indices[index];
    }
    ranges.push({ firstIndex, indexCount: cursor - firstIndex });
  }
  return { indices: sorted, ranges };
}

function buildRings(route, mesh, kind, halfWidth, liftAt, heights, landField, width, height, worldWidth, worldHeight) {
  const cumulative = [0];
  for (let index = 1; index < route.points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      unwrapNear(route.points[index].x, route.points[index - 1].x, worldWidth) - route.points[index - 1].x,
      route.points[index].z - route.points[index - 1].z,
    ));
  }
  const rings = [];
  for (let index = 0; index < route.points.length; index += 1) {
    const point = route.points[index];
    const previous = route.points[Math.max(0, index - 1)];
    const next = route.points[Math.min(route.points.length - 1, index + 1)];
    const dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x;
    const dz = next.z - previous.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const left = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x + nx, point.z + nz);
    const right = sampleHeight(heights, width, height, worldWidth, worldHeight, point.x - nx, point.z - nz);
    const before = sampleHeight(heights, width, height, worldWidth, worldHeight, previous.x, previous.z);
    const after = sampleHeight(heights, width, height, worldWidth, worldHeight, next.x, next.z);
    const normal = [clamp((before - after) / Math.max(1, length * 2), -0.5, 0.5), 1, clamp((right - left) * 0.5, -0.5, 0.5)];
    const normalScale = 1 / Math.max(0.001, Math.hypot(...normal));
    for (let component = 0; component < normal.length; component += 1) normal[component] *= normalScale;
    rings.push([-halfWidth, halfWidth].map((offset, slot) => {
      const x = point.x + nx * offset;
      const z = point.z + nz * offset;
      const dry = sampleScalar(landField, width, height, worldWidth, worldHeight, x, z) >= 0.5;
      const terrain = sampleHeight(heights, width, height, worldWidth, worldHeight, x, z);
      return mesh.vertex([x, liftAt({ dry, terrain }), z], normal, [cumulative[index], slot], kind);
    }));
  }
  return rings;
}

export function buildMeshes(routes, heights, landField, width, height, worldWidth, worldHeight, chunksX = 32, chunksY = 16) {
  const roadCapacity = routes.reduce((sum, route) => sum + (!route.suppressed ? route.points.length * 2 : 0), 0);
  const dottedCapacity = routes.reduce((sum, route) => sum + (route.suppressed ? route.points.length * 2 : 0), 0);
  const roads = new RoadMesh(roadCapacity);
  const dotted = new RoadMesh(dottedCapacity);
  const roadBatches = [];
  const dottedBatches = [];
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);

  for (const route of routes) {
    if (route.suppressed || route.points.length < 2) continue;
    const lift = route.gradeWarning ? 0.14 : 0.08;
    const rings = buildRings(route, roads, ROAD_KIND, ROAD_WIDTH * 0.5, ({ terrain }) => terrain + lift,
      heights, landField, width, height, worldWidth, worldHeight);
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const firstIndex = roads.indices.length;
      roads.quad(rings[index][0], rings[index + 1][0], rings[index + 1][1], rings[index][1]);
      const a = route.points[index];
      const b = route.points[index + 1];
      roadBatches.push({ chunk: chunkFor((a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, (a.z + b.z) * 0.5),
        firstIndex, indexCount: roads.indices.length - firstIndex });
    }
  }

  // Omitted physical roads remain visible as terrain-following dotted links.
  // They never enter the road field or placement-clearance mask.
  for (const route of routes) {
    if (!route.suppressed || route.points.length < 2) continue;
    const rings = buildRings(route, dotted, DOTTED_KIND, 0.48,
      ({ dry, terrain }) => dry ? terrain + 0.72 : 1.72,
      heights, landField, width, height, worldWidth, worldHeight);
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const firstIndex = dotted.indices.length;
      dotted.quad(rings[index][0], rings[index + 1][0], rings[index + 1][1], rings[index][1]);
      const a = route.points[index];
      const b = route.points[index + 1];
      dottedBatches.push({ chunk: chunkFor((a.x + unwrapNear(b.x, a.x, worldWidth)) * 0.5, (a.z + b.z) * 0.5),
        firstIndex, indexCount: dotted.indices.length - firstIndex });
    }
  }

  const sortedRoads = sortByChunk(roads, roadBatches, chunksX, chunksY);
  const sortedDotted = sortByChunk(dotted, dottedBatches, chunksX, chunksY);
  return {
    roadVertices: roads.vertices.slice(0, roads.vertexCount * VERTEX_STRIDE),
    roadIndices: sortedRoads.indices,
    hiddenConnectionVertices: dotted.vertices.slice(0, dotted.vertexCount * VERTEX_STRIDE),
    hiddenConnectionIndices: sortedDotted.indices,
    chunkRanges: { chunksX, chunksY, roads: sortedRoads.ranges, hiddenConnections: sortedDotted.ranges },
  };
}
