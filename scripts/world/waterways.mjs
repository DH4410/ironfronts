import { clamp, sampleHeight, unwrapNear, wrap } from '../infrastructure/common.mjs';

const RIVER_NAMES = new Set([
  'Colorado River', 'Congo River', 'Donau', 'Ganga River', 'Hooghly River', 'Indus River',
  'Krishna River', 'Lena', 'Meghna River', 'Mekong River', 'Mississippi River', 'Nile', 'Ob River',
  'Padma River', 'Rhein', 'Rio Amazonas', 'Snake River', 'St. Lawrence', 'Tocantina River',
  'Volga', 'Yangtze River', 'Yellow River', 'Yukon River', 'Yunisei',
]);

const CANAL_NAMES = new Set(['Kiel Canal', 'Suez Channel']);

// The terrain grid is intentionally much coarser than roads and waterways.
// Sub-unit sampling keeps the solved channel, its clip mask, and its rendered
// surface locked together through narrow valleys and mountain shoulders.
const SAMPLE_SPACING = 0.75;
const OPEN_WATER_HEIGHT = 0.42;

function nodeName(node) {
  return node?.location_name ?? '';
}

function isRiver(node) {
  return node?.kind === 'sea_point' && RIVER_NAMES.has(nodeName(node));
}

function isCanal(node) {
  return node?.kind === 'sea_point' && CANAL_NAMES.has(nodeName(node));
}

function selectSuezEdges(suez, candidates, nodes) {
  const gulf = candidates.find((edge) => nodeName(nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a]) === 'Gulf of Suez');
  if (!gulf) return [];
  const gulfNode = nodes[gulf.node_a === suez.node_id ? gulf.node_b : gulf.node_a];
  const gx = gulfNode.x - suez.x;
  const gz = gulfNode.y - suez.y;
  const gulfLength = Math.max(0.001, Math.hypot(gx, gz));
  const mediterranean = candidates
    .filter((edge) => nodeName(nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a]) === 'Mediterranean Sea')
    .map((edge) => {
      const endpoint = nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a];
      const dx = endpoint.x - suez.x;
      const dz = endpoint.y - suez.y;
      return { edge, alignment: (dx * gx + dz * gz) / (Math.max(0.001, Math.hypot(dx, dz)) * gulfLength) };
    })
    .sort((a, b) => a.alignment - b.alignment)[0]?.edge;
  return mediterranean ? [mediterranean, gulf] : [gulf];
}

function collectEdges(networkData, connectionData) {
  const nodes = networkData.nodes;
  const byNode = Array.from({ length: nodes.length }, () => []);
  for (const edge of connectionData.segments) {
    byNode[edge.node_a]?.push(edge);
    byNode[edge.node_b]?.push(edge);
  }

  const selected = new Map();
  const add = (edge, kind) => selected.set(edge.segment_id, { ...edge, kind });
  for (const edge of connectionData.segments) {
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    if (!a || !b || edge.medium !== 'sea') continue;
    if (isRiver(a) && isRiver(b)) add(edge, 0);
    else if ((isRiver(a) && b.kind === 'sea_point') || (isRiver(b) && a.kind === 'sea_point')) add(edge, 0);
    else if (isCanal(a) && isCanal(b)) add(edge, 1);
  }

  // Kiel is a chain with one open-water endpoint at each side. Suez is stored
  // as a single named point in the broader sea graph, so select the two nearly
  // opposite links that form its actual Mediterranean-to-Gulf passage.
  for (const node of nodes) {
    if (nodeName(node) === 'Kiel Canal') {
      for (const edge of byNode[node.node_id]) {
        const other = nodes[edge.node_a === node.node_id ? edge.node_b : edge.node_a];
        if (edge.medium === 'sea' && other?.kind === 'sea_point') add(edge, 1);
      }
    }
  }
  const suez = nodes.find((node) => nodeName(node) === 'Suez Channel');
  if (suez) {
    const candidates = byNode[suez.node_id].filter((edge) => {
      const other = nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a];
      return edge.medium === 'sea' && other?.kind === 'sea_point';
    });
    for (const edge of selectSuezEdges(suez, candidates, nodes)) add(edge, 1);
  }
  return [...selected.values()].sort((a, b) => a.segment_id - b.segment_id);
}

function pointId(provinceIds, idWidth, idHeight, worldWidth, worldHeight, x, z) {
  const px = wrap(Math.floor(x / worldWidth * idWidth), idWidth);
  const pz = clamp(Math.floor(z / worldHeight * idHeight), 0, idHeight - 1);
  return provinceIds[pz * idWidth + px];
}

function scanBank({ provinceIds, idWidth, idHeight, heights, heightWidth, heightHeight, worldWidth, worldHeight }, x, z, nx, nz, sign) {
  for (let distance = 0.7; distance <= 28; distance += 0.7) {
    const sx = x + nx * distance * sign;
    const sz = z + nz * distance * sign;
    if (pointId(provinceIds, idWidth, idHeight, worldWidth, worldHeight, sx, sz) === 0) continue;
    const inlandX = sx + nx * sign * 1.1;
    const inlandZ = sz + nz * sign * 1.1;
    return {
      distance,
      height: sampleHeight(heights, heightWidth, heightHeight, worldWidth, worldHeight, inlandX, inlandZ),
    };
  }
  return null;
}

function crossSection(context, x, z, dx, dz, kind) {
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const nx = -dz / length;
  const nz = dx / length;
  const leftBank = scanBank(context, x, z, nx, nz, 1);
  const rightBank = scanBank(context, x, z, nx, nz, -1);
  // A river narrower than roughly two high-resolution mask texels can vanish
  // under oblique projection. Keep a strategy-readable minimum while bank
  // scans still allow major channels to widen naturally.
  const minimum = kind === 1 ? 4.2 : 4.0;
  const maximum = kind === 1 ? 6.5 : 8.5;
  const left = clamp((leftBank?.distance ?? minimum) + 0.55, minimum, maximum);
  const right = clamp((rightBank?.distance ?? minimum) + 0.55, minimum, maximum);
  const bankHeights = [leftBank?.height, rightBank?.height].filter(Number.isFinite);
  const waterHeight = bankHeights.length ? Math.max(0.58, Math.min(...bankHeights) - 0.18) : 0.72;
  return { nx, nz, left, right, waterHeight };
}

function makeNodeSurface(context, node, incidentEdges, nodes, kind) {
  if (!isRiver(node) && !isCanal(node)) return { y: OPEN_WATER_HEIGHT, radius: kind === 1 ? 4.2 : 3.5 };
  const sections = [];
  for (const edge of incidentEdges) {
    const other = nodes[edge.node_a === node.node_id ? edge.node_b : edge.node_a];
    const otherX = unwrapNear(other.x, node.x, context.worldWidth);
    sections.push(crossSection(context, node.x, node.y, otherX - node.x, other.y - node.y, kind));
  }
  const y = sections.length ? Math.min(...sections.map((section) => section.waterHeight)) : 0.72;
  const radius = sections.length ? Math.max(...sections.flatMap((section) => [section.left, section.right])) : kind === 1 ? 3.2 : 2.2;
  return { y, radius };
}

function markCircle(field, width, height, worldWidth, worldHeight, x, z, radius, conservative = false) {
  const cx = x / worldWidth * width;
  const cz = z / worldHeight * height;
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const padding = conservative ? Math.hypot(pixelWidth, pixelHeight) * 0.5 : 0;
  const effectiveRadius = radius + padding;
  const rx = Math.max(1, Math.ceil(effectiveRadius / pixelWidth));
  const rz = Math.max(1, Math.ceil(effectiveRadius / pixelHeight));
  for (let oz = -rz; oz <= rz; oz += 1) {
    const py = Math.floor(cz + oz);
    if (py < 0 || py >= height) continue;
    for (let ox = -rx; ox <= rx; ox += 1) {
      const px = wrap(Math.floor(cx + ox), width);
      let deltaPixelsX = px + 0.5 - cx;
      if (deltaPixelsX > width * 0.5) deltaPixelsX -= width;
      if (deltaPixelsX < -width * 0.5) deltaPixelsX += width;
      const dx = deltaPixelsX * pixelWidth;
      const dz = (py + 0.5 - cz) * pixelHeight;
      if (dx * dx + dz * dz > effectiveRadius * effectiveRadius) continue;
      field[py * width + px] = 255;
    }
  }
}

function markCorridor(field, width, height, worldWidth, worldHeight, x, z, section, extraWidth = 0) {
  const cx = x / worldWidth * width;
  const cz = z / worldHeight * height;
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const alongPadding = Math.hypot(pixelWidth, pixelHeight) * 0.55;
  const radius = Math.max(section.left, section.right) + extraWidth + alongPadding;
  const rx = Math.max(1, Math.ceil(radius / pixelWidth));
  const rz = Math.max(1, Math.ceil(radius / pixelHeight));
  const tx = -section.nz;
  const tz = section.nx;
  for (let oz = -rz; oz <= rz; oz += 1) {
    const py = Math.floor(cz + oz);
    if (py < 0 || py >= height) continue;
    for (let ox = -rx; ox <= rx; ox += 1) {
      const px = wrap(Math.floor(cx + ox), width);
      let deltaPixelsX = px + 0.5 - cx;
      if (deltaPixelsX > width * 0.5) deltaPixelsX -= width;
      if (deltaPixelsX < -width * 0.5) deltaPixelsX += width;
      const dx = deltaPixelsX * pixelWidth;
      const dz = (py + 0.5 - cz) * pixelHeight;
      const lateral = dx * section.nx + dz * section.nz;
      const longitudinal = dx * tx + dz * tz;
      if (Math.abs(longitudinal) > SAMPLE_SPACING * 0.6 + alongPadding) continue;
      if (lateral > section.left + extraWidth || lateral < -section.right - extraWidth) continue;
      field[py * width + px] = 255;
    }
  }
}

function sortIndicesByChunk(indices, batches, chunksX, chunksY) {
  const byChunk = Array.from({ length: chunksX * chunksY }, () => []);
  for (const batch of batches) byChunk[batch.chunk].push(batch);
  const sorted = new Uint32Array(indices.length);
  const ranges = [];
  let cursor = 0;
  for (const chunk of byChunk) {
    const firstIndex = cursor;
    for (const batch of chunk) {
      for (let index = batch.firstIndex; index < batch.firstIndex + batch.indexCount; index += 1) sorted[cursor++] = indices[index];
    }
    ranges.push({ firstIndex, indexCount: cursor - firstIndex });
  }
  return { indices: sorted, ranges };
}

export function buildWaterways({
  networkData, connectionData, provinceIds, idWidth, idHeight, heights, heightWidth, heightHeight,
  worldWidth, worldHeight, chunksX = 32, chunksY = 16,
}) {
  const started = performance.now();
  const context = { provinceIds, idWidth, idHeight, heights, heightWidth, heightHeight, worldWidth, worldHeight };
  const nodes = networkData.nodes;
  const edges = collectEdges(networkData, connectionData);
  const incident = new Map();
  for (const edge of edges) {
    if (!incident.has(edge.node_a)) incident.set(edge.node_a, []);
    if (!incident.has(edge.node_b)) incident.set(edge.node_b, []);
    incident.get(edge.node_a).push(edge);
    incident.get(edge.node_b).push(edge);
  }
  const nodeSurfaces = new Map();
  for (const [nodeId, nodeEdges] of incident) {
    const kind = nodeEdges.some((edge) => edge.kind === 1) ? 1 : 0;
    nodeSurfaces.set(nodeId, makeNodeSurface(context, nodes[nodeId], nodeEdges, nodes, kind));
  }
  const networkLines = [];
  const systemIds = new Map();
  const systemId = (name) => {
    if (!systemIds.has(name)) systemIds.set(name, systemIds.size + 1);
    return systemIds.get(name);
  };
  for (const edge of edges) {
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    const aSurface = nodeSurfaces.get(edge.node_a);
    const bSurface = nodeSurfaces.get(edge.node_b);
    const named = isRiver(a) || isCanal(a) ? nodeName(a) : nodeName(b);
    networkLines.push(a.x, a.y, b.x, b.y, aSurface.y, bSurface.y, edge.kind, systemId(named));
  }

  const vertices = [];
  const indices = [];
  const batches = [];
  const clearance = new Uint8Array(idWidth * idHeight);
  const mask = new Uint8Array(idWidth * idHeight);
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);
  const addVertex = (position, uv, edgeFactor, kind) => {
    const vertex = vertices.length / 7;
    vertices.push(...position, ...uv, edgeFactor, kind);
    return vertex;
  };
  let totalLength = 0;
  let minimumHeight = Infinity;
  let maximumHeight = -Infinity;
  let minimumWidth = Infinity;
  let maximumWidth = -Infinity;

  for (const edge of edges) {
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    const bx = unwrapNear(b.x, a.x, worldWidth);
    const dx = bx - a.x;
    const dz = b.y - a.y;
    const length = Math.hypot(dx, dz);
    const segments = Math.max(1, Math.ceil(length / SAMPLE_SPACING));
    const aSurface = nodeSurfaces.get(edge.node_a);
    const bSurface = nodeSurfaces.get(edge.node_b);
    const rings = [];
    const samples = [];
    totalLength += length;
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const x = a.x + dx * t;
      const z = a.y + dz * t;
      const section = crossSection(context, x, z, dx, dz, edge.kind);
      samples.push({ x, z, t, section });
    }
    let profile = samples.map((sample) => sample.section.waterHeight);
    profile[0] = aSurface.y;
    profile[profile.length - 1] = bSurface.y;
    for (let pass = 0; pass < 6; pass += 1) {
      const next = profile.slice();
      for (let index = 1; index + 1 < profile.length; index += 1) {
        const smoothed = (profile[index - 1] + profile[index] * 2 + profile[index + 1]) * 0.25;
        next[index] = clamp(smoothed, 0.48, samples[index].section.waterHeight + 0.12);
      }
      profile = next;
    }
    for (let index = 0; index < samples.length; index += 1) {
      const { x, z, t, section } = samples[index];
      const y = profile[index];
      const left = x + section.nx * section.left;
      const leftZ = z + section.nz * section.left;
      const right = x - section.nx * section.right;
      const rightZ = z - section.nz * section.right;
      rings.push([
        addVertex([left, y, leftZ], [length * t / 24, 0], 1, edge.kind),
        addVertex([x, y + 0.015, z], [length * t / 24, 0.5], 0, edge.kind),
        addVertex([right, y, rightZ], [length * t / 24, 1], 1, edge.kind),
      ]);
      markCorridor(clearance, idWidth, idHeight, worldWidth, worldHeight, x, z, section, 2.5);
      markCorridor(mask, idWidth, idHeight, worldWidth, worldHeight, x, z, section, 0);
      minimumHeight = Math.min(minimumHeight, y);
      maximumHeight = Math.max(maximumHeight, y);
      minimumWidth = Math.min(minimumWidth, section.left + section.right);
      maximumWidth = Math.max(maximumWidth, section.left + section.right);
    }
    for (let index = 0; index < segments; index += 1) {
      const firstIndex = indices.length;
      const current = rings[index];
      const next = rings[index + 1];
      indices.push(current[0], next[0], next[1], current[0], next[1], current[1]);
      indices.push(current[1], next[1], next[2], current[1], next[2], current[2]);
      batches.push({ chunk: chunkFor((a.x + dx * ((index + 0.5) / segments)), a.y + dz * ((index + 0.5) / segments)), firstIndex, indexCount: 12 });
    }
  }

  // Small static patches close differently oriented strips at sources,
  // confluences, and canal bends without altering the supplied centerlines.
  for (const [nodeId, nodeEdges] of incident) {
    const node = nodes[nodeId];
    if (!isRiver(node) && !isCanal(node)) continue;
    const surface = nodeSurfaces.get(nodeId);
    const kind = nodeEdges.some((edge) => edge.kind === 1) ? 1 : 0;
    const firstIndex = indices.length;
    const center = addVertex([node.x, surface.y + 0.02, node.y], [0, 0.5], 0, kind);
    const ring = [];
    for (let step = 0; step < 12; step += 1) {
      const angle = step / 12 * Math.PI * 2;
      ring.push(addVertex([node.x + Math.cos(angle) * surface.radius, surface.y, node.y + Math.sin(angle) * surface.radius],
        [0, step / 12], 1, kind));
    }
    for (let step = 0; step < 12; step += 1) indices.push(center, ring[step], ring[(step + 1) % 12]);
    batches.push({ chunk: chunkFor(node.x, node.y), firstIndex, indexCount: indices.length - firstIndex });
    markCircle(mask, idWidth, idHeight, worldWidth, worldHeight, node.x, node.y, surface.radius + 0.35);
    markCircle(clearance, idWidth, idHeight, worldWidth, worldHeight, node.x, node.y, surface.radius + 2.5, true);
  }

  const sorted = sortIndicesByChunk(indices, batches, chunksX, chunksY);
  const riverNodes = nodes.filter(isRiver);
  const canalNodes = nodes.filter(isCanal);
  const riverEdges = edges.filter((edge) => edge.kind === 0);
  const canalEdges = edges.filter((edge) => edge.kind === 1);
  const mouthEdges = riverEdges.filter((edge) => !isRiver(nodes[edge.node_a]) || !isRiver(nodes[edge.node_b]));
  const riverShowcaseNode = riverNodes.find((node) => nodeName(node) === 'Nile') ?? riverNodes[0];
  const mouthShowcaseEdge = mouthEdges[0];
  const mouthA = mouthShowcaseEdge ? nodes[mouthShowcaseEdge.node_a] : riverShowcaseNode;
  const mouthB = mouthShowcaseEdge ? nodes[mouthShowcaseEdge.node_b] : riverShowcaseNode;
  const kielNode = canalNodes.find((node) => nodeName(node) === 'Kiel Canal');
  const suezNode = canalNodes.find((node) => nodeName(node) === 'Suez Channel');
  const report = {
    source: 'material/movement network sea_point graph',
    staticSurface: true,
    sampleSpacing: SAMPLE_SPACING,
    terrainClipMask: true,
    riverSystems: [...new Set(riverNodes.map(nodeName))].sort(),
    riverSourcePoints: riverNodes.length,
    riverSegments: riverEdges.length,
    riverMouthLinks: mouthEdges.length,
    canalSystems: [...new Set(canalNodes.map(nodeName))].sort(),
    canalSourcePoints: canalNodes.length,
    canalSegments: canalEdges.length,
    totalLength,
    widthRange: [minimumWidth, maximumWidth],
    heightRange: [minimumHeight, maximumHeight],
    buildMilliseconds: performance.now() - started,
  };
  return {
    vertices: new Float32Array(vertices),
    indices: sorted.indices,
    networkLines: new Float32Array(networkLines),
    chunkRanges: sorted.ranges,
    clearance,
    mask,
    report,
    stats: {
      riverSystems: report.riverSystems.length,
      riverSourcePoints: report.riverSourcePoints,
      riverSegments: report.riverSegments,
      riverMouthLinks: report.riverMouthLinks,
      canalSystems: report.canalSystems.length,
      canalSourcePoints: report.canalSourcePoints,
      canalSegments: report.canalSegments,
      waterwayTriangles: sorted.indices.length / 3,
    },
    showcases: {
      river: [riverShowcaseNode.x, riverShowcaseNode.y],
      riverMouth: [(mouthA.x + unwrapNear(mouthB.x, mouthA.x, worldWidth)) * 0.5, (mouthA.y + mouthB.y) * 0.5],
      kielCanal: [kielNode.x, kielNode.y],
      suezCanal: [suezNode.x, suezNode.y],
    },
  };
}
