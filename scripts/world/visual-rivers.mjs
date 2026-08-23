import { clamp, wrap } from './raster.mjs';

// Visual-only rivers are implicit narrow gaps in the province topology rather
// than authored movement-graph entities. Keep them readable without granting
// movement semantics or widening broad ocean/lake coastlines.
export const MINIMUM_VISUAL_RIVER_WIDTH = 7.6;
export const VISUAL_RIVER_THRESHOLD = 0.45;
const MINIMUM_COMPONENT_PIXELS = 5;
const GRAPH_EXCLUSION_RADIUS_PIXELS = 2;
const CANAL_EXCLUSION_HALF_WIDTH = 12;
const CANAL_NAMES = new Set(['Kiel Canal', 'Suez Channel']);
const BANK_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

function nearestLand(provinceIds, width, height, x, y, dx, dy, maxSteps) {
  for (let step = 1; step <= maxSteps; step += 1) {
    const py = y + dy * step;
    if (py < 0 || py >= height) return 0;
    const px = wrap(x + dx * step, width);
    if (provinceIds[py * width + px] !== 0) return step;
  }
  return 0;
}

function markPixelCircle(field, width, height, cx, cy, radiusPixels) {
  const radiusSquared = radiusPixels * radiusPixels;
  const radius = Math.ceil(radiusPixels);
  for (let oy = -radius; oy <= radius; oy += 1) {
    const y = cy + oy;
    if (y < 0 || y >= height) continue;
    for (let ox = -radius; ox <= radius; ox += 1) {
      if (ox * ox + oy * oy > radiusSquared) continue;
      field[y * width + wrap(cx + ox, width)] = 255;
    }
  }
}

function addGraphExclusions({ exclusion, movementMask, networkData, connectionData, width, height, worldWidth, worldHeight }) {
  const movementSeeds = [];
  for (let index = 0; index < movementMask.length; index += 1) {
    if (movementMask[index] === 0) continue;
    exclusion[index] = 255;
    movementSeeds.push(index);
  }
  for (const index of movementSeeds) {
    const x = index % width;
    const y = Math.floor(index / width);
    markPixelCircle(exclusion, width, height, x, y, GRAPH_EXCLUSION_RADIUS_PIXELS);
  }

  const nodes = networkData.nodes;
  const canalNodeIds = new Set(nodes.filter((node) => node.kind === 'sea_point' && CANAL_NAMES.has(node.location_name ?? '')).map((node) => node.node_id));
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const canalRadiusPixels = CANAL_EXCLUSION_HALF_WIDTH / ((pixelWidth + pixelHeight) * 0.5);
  const sampleSpacing = Math.max(1.5, Math.min(pixelWidth, pixelHeight) * 0.55);

  for (const edge of connectionData.segments) {
    if (edge.medium !== 'sea' || (!canalNodeIds.has(edge.node_a) && !canalNodeIds.has(edge.node_b))) continue;
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    if (!a || !b || a.kind !== 'sea_point' || b.kind !== 'sea_point') continue;
    let bx = b.x;
    const halfWorld = worldWidth * 0.5;
    if (bx - a.x > halfWorld) bx -= worldWidth;
    if (bx - a.x < -halfWorld) bx += worldWidth;
    const dx = bx - a.x;
    const dz = b.y - a.y;
    const length = Math.hypot(dx, dz);
    const segments = Math.max(1, Math.ceil(length / sampleSpacing));
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      const worldX = a.x + dx * t;
      const worldY = a.y + dz * t;
      const px = wrap(Math.floor(worldX / worldWidth * width), width);
      const py = clamp(Math.floor(worldY / worldHeight * height), 0, height - 1);
      markPixelCircle(exclusion, width, height, px, py, canalRadiusPixels);
    }
  }
}

function pruneSmallComponents(candidate, expansion, width, height) {
  const visited = new Uint8Array(candidate.length);
  const queue = [];
  let keptComponents = 0;
  let removedComponents = 0;
  let removedPixels = 0;

  for (let start = 0; start < candidate.length; start += 1) {
    if (!candidate[start] || visited[start]) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    const component = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of NEIGHBORS) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const nx = wrap(x + dx, width);
        const next = ny * width + nx;
        if (!candidate[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    if (component.length >= MINIMUM_COMPONENT_PIXELS) {
      keptComponents += 1;
      continue;
    }
    removedComponents += 1;
    removedPixels += component.length;
    for (const index of component) {
      candidate[index] = 0;
      expansion[index] = 0;
    }
  }
  return { keptComponents, removedComponents, removedPixels };
}

function neighborMaskValue(expansionWorld, stepWorld) {
  if (expansionWorld <= 0) return 0;
  // The source land/water contour lies halfway between pixel centers. Solve
  // for the neighboring land sample value that moves a 0.45 filtered-mask
  // contour outward by exactly expansionWorld, without a second dilation row.
  const desired = 0.5 + expansionWorld / stepWorld;
  if (desired <= 1) return clamp(1 + (VISUAL_RIVER_THRESHOLD - 1) / Math.max(0.5001, desired), 0, 1);
  return clamp(VISUAL_RIVER_THRESHOLD / Math.max(0.0001, 2 - desired), 0, 1);
}

export function buildVisualRiverField({
  provinceIds, movementMask, networkData, connectionData, width, height, worldWidth, worldHeight,
}) {
  const started = performance.now();
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const averageTexelSize = (pixelWidth + pixelHeight) * 0.5;
  const candidate = new Uint8Array(provinceIds.length);
  const expansion = new Float32Array(provinceIds.length);
  const exclusion = new Uint8Array(provinceIds.length);
  addGraphExclusions({ exclusion, movementMask, networkData, connectionData, width, height, worldWidth, worldHeight });

  let rawCandidatePixels = 0;
  let minimumDetectedWidth = Infinity;
  let maximumDetectedWidth = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (provinceIds[index] !== 0 || exclusion[index]) continue;
      let sourceWidth = Infinity;
      for (const [dx, dy] of BANK_DIRECTIONS) {
        const stepWorld = Math.hypot(dx * pixelWidth, dy * pixelHeight);
        const maxSteps = Math.ceil(MINIMUM_VISUAL_RIVER_WIDTH / stepWorld) + 1;
        const positive = nearestLand(provinceIds, width, height, x, y, dx, dy, maxSteps);
        if (!positive) continue;
        const negative = nearestLand(provinceIds, width, height, x, y, -dx, -dy, maxSteps);
        if (!negative) continue;
        const widthWorld = (positive + negative - 1) * stepWorld;
        sourceWidth = Math.min(sourceWidth, widthWorld);
      }
      if (!Number.isFinite(sourceWidth) || sourceWidth >= MINIMUM_VISUAL_RIVER_WIDTH - 0.01) continue;
      candidate[index] = 1;
      expansion[index] = (MINIMUM_VISUAL_RIVER_WIDTH - sourceWidth) * 0.5;
      rawCandidatePixels += 1;
      minimumDetectedWidth = Math.min(minimumDetectedWidth, sourceWidth);
      maximumDetectedWidth = Math.max(maximumDetectedWidth, sourceWidth);
    }
  }

  const components = pruneSmallComponents(candidate, expansion, width, height);
  const mask = new Uint8Array(provinceIds.length);
  const clearance = new Uint8Array(provinceIds.length);
  let centerPixels = 0;
  let widenedLandPixels = 0;
  let maximumExpansion = 0;

  for (let index = 0; index < candidate.length; index += 1) {
    if (!candidate[index]) continue;
    centerPixels += 1;
    mask[index] = 255;
    clearance[index] = 255;
    maximumExpansion = Math.max(maximumExpansion, expansion[index]);
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of NEIGHBORS) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      const nx = wrap(x + dx, width);
      const neighbor = ny * width + nx;
      if (provinceIds[neighbor] === 0 || exclusion[neighbor]) continue;
      const stepWorld = Math.hypot(dx * pixelWidth, dy * pixelHeight);
      const value = Math.round(neighborMaskValue(expansion[index], stepWorld) * 255);
      if (value <= mask[neighbor]) continue;
      if (mask[neighbor] === 0 && value > 0) widenedLandPixels += 1;
      mask[neighbor] = value;
      // Any land cell whose filtered mask contributes to the widened channel
      // must stay clear of generated trees/buildings, even if its center falls
      // just outside the final shader cutoff.
      if (value > 0) clearance[neighbor] = 255;
    }
  }

  const effectivePixels = mask.reduce((count, value) => count + (value / 255 > VISUAL_RIVER_THRESHOLD ? 1 : 0), 0);
  return {
    mask,
    clearance,
    report: {
      source: 'province-zero narrow-channel topology (no movement semantics)',
      method: 'opposing-bank minimum-width expansion',
      minimumRenderedWidth: MINIMUM_VISUAL_RIVER_WIDTH,
      shaderThreshold: VISUAL_RIVER_THRESHOLD,
      texelSize: averageTexelSize,
      minimumComponentPixels: MINIMUM_COMPONENT_PIXELS,
      rawCandidatePixels,
      centerPixels,
      effectivePixels,
      widenedLandPixels,
      graphExclusionPixels: exclusion.reduce((count, value) => count + (value > 0 ? 1 : 0), 0),
      keptComponents: components.keptComponents,
      removedSmallComponents: components.removedComponents,
      removedSmallPixels: components.removedPixels,
      detectedSourceWidthRange: rawCandidatePixels ? [minimumDetectedWidth, maximumDetectedWidth] : [0, 0],
      maximumBankExpansion: maximumExpansion,
      buildMilliseconds: performance.now() - started,
    },
    stats: {
      visualRiverComponents: components.keptComponents,
      visualRiverCenterPixels: centerPixels,
      visualRiverExpandedPixels: effectivePixels,
    },
  };
}
