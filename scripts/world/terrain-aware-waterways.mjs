import { buildWaterways as buildMovementWaterways } from './waterways.mjs';
import { buildVisualWaterways } from './visual-waterways.mjs';

function mergeChunkedIndices(movement, visual) {
  const vertexOffset = movement.vertices.length / 10;
  const indices = new Uint32Array(movement.indices.length + visual.indices.length);
  const ranges = [];
  let cursor = 0;
  const chunks = Math.max(movement.chunkRanges.length, visual.chunkRanges.length);
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const firstIndex = cursor;
    const movementRange = movement.chunkRanges[chunk] ?? { firstIndex: 0, indexCount: 0 };
    for (let index = movementRange.firstIndex; index < movementRange.firstIndex + movementRange.indexCount; index += 1) {
      indices[cursor++] = movement.indices[index];
    }
    const visualRange = visual.chunkRanges[chunk] ?? { firstIndex: 0, indexCount: 0 };
    for (let index = visualRange.firstIndex; index < visualRange.firstIndex + visualRange.indexCount; index += 1) {
      indices[cursor++] = visual.indices[index] + vertexOffset;
    }
    ranges.push({ firstIndex, indexCount: cursor - firstIndex });
  }
  return { indices, ranges };
}

function preserveVisualVertexSemantics(visual) {
  // Keep the fractional kind so the shared shader can apply the interpolated
  // visual-river mask only to topology-derived water surfaces.
  for (let vertex = 0; vertex < visual.vertices.length / 10; vertex += 1) {
    const offset = vertex * 10;
    // Existing generated-data checks reserve exact edgeFactor=0 for authored
    // movement-river centerlines. Keep the visual center effectively central
    // while making that distinction stable without adding another attribute.
    if (visual.vertices[offset + 5] < 0.01) visual.vertices[offset + 5] = 0.02;
  }
  visual.report.renderKind = 0.25;
}

export function buildTerrainAwareWaterways({ visualMask, ...movementArgs }) {
  const movement = buildMovementWaterways(movementArgs);
  const visual = buildVisualWaterways({
    visualMask,
    provinceIds: movementArgs.provinceIds,
    width: movementArgs.idWidth,
    height: movementArgs.idHeight,
    worldWidth: movementArgs.worldWidth,
    worldHeight: movementArgs.worldHeight,
    heights: movementArgs.heights,
    heightWidth: movementArgs.heightWidth,
    heightHeight: movementArgs.heightHeight,
  });
  preserveVisualVertexSemantics(visual);
  const vertices = new Float32Array(movement.vertices.length + visual.vertices.length);
  vertices.set(movement.vertices, 0);
  vertices.set(visual.vertices, movement.vertices.length);
  const merged = mergeChunkedIndices(movement, visual);
  return {
    ...movement,
    vertices,
    indices: merged.indices,
    chunkRanges: merged.ranges,
    report: {
      ...movement.report,
      surfaceDraping: 'independent terrain sample per vertex',
      visualSurface: visual.report,
    },
    stats: {
      ...movement.stats,
      visualWaterwayTriangles: visual.indices.length / 3,
      waterwayTriangles: merged.indices.length / 3,
    },
  };
}
