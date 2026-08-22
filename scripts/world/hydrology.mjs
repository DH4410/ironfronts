import { FIELD_HEIGHT, FIELD_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.mjs';
import { blurField, clamp, wrap } from './raster.mjs';

class MinHeap {
  constructor() { this.items = []; }
  push(priority, index) {
    const item = [priority, index];
    let position = this.items.length;
    this.items.push(item);
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.items[parent][0] <= priority) break;
      this.items[position] = this.items[parent];
      position = parent;
    }
    this.items[position] = item;
  }
  pop() {
    const root = this.items[0];
    const tail = this.items.pop();
    if (this.items.length > 0) {
      let position = 0;
      while (true) {
        const left = position * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let child = left;
        if (right < this.items.length && this.items[right][0] < this.items[left][0]) child = right;
        if (this.items[child][0] >= tail[0]) break;
        this.items[position] = this.items[child];
        position = child;
      }
      this.items[position] = tail;
    }
    return root;
  }
  get length() { return this.items.length; }
}

function buildRiverMesh(edges, accumulation, threshold) {
  const nodes = new Map();
  const ensureNode = (id, x, z, bed, steepness, flow, water = false) => {
    let node = nodes.get(id);
    if (!node) {
      node = { id, x: wrap(x, WORLD_WIDTH), z, bed, steepness, flow, water, neighbors: new Set() };
      nodes.set(id, node);
    } else {
      node.bed = Math.min(node.bed, bed);
      node.steepness = Math.max(node.steepness, steepness);
      node.flow = Math.max(node.flow, flow);
      node.water ||= water;
    }
    return node;
  };

  for (const edge of edges) {
    const startFlow = Math.max(threshold, accumulation[edge.start] || threshold);
    const finishFlow = edge.finishLand ? Math.max(startFlow, accumulation[edge.finish] || threshold) : startFlow;
    const start = ensureNode(edge.start, edge.x1, edge.z1, edge.startBed, edge.steepness, startFlow);
    const finish = ensureNode(edge.finish, edge.x2, edge.z2, edge.endBed, edge.steepness, finishFlow, !edge.finishLand);
    start.neighbors.add(finish.id);
    finish.neighbors.add(start.id);
  }

  // Relax only centerline positions. Beds remain untouched and monotonically downhill.
  for (let pass = 0; pass < 4; pass += 1) {
    const positions = new Map();
    for (const node of nodes.values()) {
      if (node.neighbors.size === 0) continue;
      let deltaX = 0;
      let deltaZ = 0;
      for (const neighborId of node.neighbors) {
        const neighbor = nodes.get(neighborId);
        let dx = neighbor.x - node.x;
        if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
        if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
        deltaX += dx;
        deltaZ += neighbor.z - node.z;
      }
      const pull = node.neighbors.size === 2 ? 0.24 : 0.10;
      positions.set(node.id, [wrap(node.x + deltaX / node.neighbors.size * pull, WORLD_WIDTH), clamp(node.z + deltaZ / node.neighbors.size * pull, 0, WORLD_HEIGHT)]);
    }
    for (const [id, position] of positions) {
      nodes.get(id).x = position[0];
      nodes.get(id).z = position[1];
    }
  }

  const vertices = [];
  const indices = [];
  const renderEdges = [];
  const pushVertex = (cx, cz, ox, oz, bed, strength, steepness, edge) => {
    vertices.push(cx, cz, ox, oz, bed, strength, steepness, edge);
    return vertices.length / 8 - 1;
  };
  const nodeVisual = (node) => {
    const flow = Math.max(threshold, node.flow);
    const strength = clamp(Math.log2(flow / threshold + 1) / 5, 0, 1);
    const width = (6.4 + Math.pow(flow / threshold, 0.36) * 4.6) * (1 - node.steepness * 0.16) * (node.water ? 1.48 : 1);
    return { strength, width };
  };

  // Carry river mouths well into the receiving water and flare them into estuaries.
  for (const node of nodes.values()) {
    if (!node.water || node.neighbors.size === 0) continue;
    const neighbor = nodes.get(node.neighbors.values().next().value);
    let dx = node.x - neighbor.x;
    if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
    if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
    const dz = node.z - neighbor.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const extension = nodeVisual(node).width * 1.65;
    node.x = wrap(node.x + dx / length * extension, WORLD_WIDTH);
    node.z = clamp(node.z + dz / length * extension, 0, WORLD_HEIGHT);
    node.bed = 0.12;
  }

  for (const edge of edges) {
    const start = nodes.get(edge.start);
    const finish = nodes.get(edge.finish);
    let dx = finish.x - start.x;
    if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
    if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
    const dz = finish.z - start.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const startVisual = nodeVisual(start);
    const finishVisual = nodeVisual(finish);
    const x2 = start.x + dx;
    const z2 = finish.z;
    renderEdges.push({ x1: start.x, z1: start.z, x2, z2, startBed: start.bed, endBed: finish.bed, startWidth: startVisual.width, endWidth: finishVisual.width });
    const base = vertices.length / 8;
    pushVertex(start.x, start.z, -nx * startVisual.width, -nz * startVisual.width, start.bed, startVisual.strength, edge.steepness, 1);
    pushVertex(start.x, start.z, 0, 0, start.bed, startVisual.strength, edge.steepness, 0);
    pushVertex(start.x, start.z, nx * startVisual.width, nz * startVisual.width, start.bed, startVisual.strength, edge.steepness, 1);
    pushVertex(x2, z2, -nx * finishVisual.width, -nz * finishVisual.width, finish.bed, finishVisual.strength, edge.steepness, 1);
    pushVertex(x2, z2, 0, 0, finish.bed, finishVisual.strength, edge.steepness, 0);
    pushVertex(x2, z2, nx * finishVisual.width, nz * finishVisual.width, finish.bed, finishVisual.strength, edge.steepness, 1);
    indices.push(base, base + 3, base + 1, base + 1, base + 3, base + 4, base + 1, base + 4, base + 2, base + 2, base + 4, base + 5);
  }

  // Round patches hide strip joins and make confluences read as one body of water.
  const circleSteps = 10;
  for (const node of nodes.values()) {
    if (node.water) continue;
    const visual = nodeVisual(node);
    const base = vertices.length / 8;
    pushVertex(node.x, node.z, 0, 0, node.bed, visual.strength, node.steepness, 0);
    for (let step = 0; step < circleSteps; step += 1) {
      const angle = step / circleSteps * Math.PI * 2;
      pushVertex(node.x, node.z, Math.cos(angle) * visual.width, Math.sin(angle) * visual.width, node.bed, visual.strength, node.steepness, 1);
    }
    for (let step = 0; step < circleSteps; step += 1) indices.push(base, base + 1 + step, base + 1 + (step + 1) % circleSteps);
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), renderEdges };
}

export function buildHydrology(heights, landField, biomeField) {
  const width = 1_024;
  const height = Math.round(width * WORLD_HEIGHT / WORLD_WIDTH);
  const count = width * height;
  const terrainHeight = new Float32Array(count);
  const land = new Uint8Array(count);
  const biome = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(FIELD_HEIGHT - 1, Math.floor((y + 0.5) / height * FIELD_HEIGHT));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(FIELD_WIDTH - 1, Math.floor((x + 0.5) / width * FIELD_WIDTH));
      const source = sourceY * FIELD_WIDTH + sourceX;
      const index = y * width + x;
      terrainHeight[index] = heights[source];
      land[index] = landField[source] > 0.5 ? 1 : 0;
      biome[index] = biomeField[source];
    }
  }

  // Priority flood supplies a deterministic, depression-free drainage surface.
  const filled = terrainHeight.slice();
  const visited = new Uint8Array(count);
  const heap = new MinHeap();
  const neighborOffsets = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!land[index]) continue;
      const coastal = neighborOffsets.some(([ox, oy]) => {
        const py = y + oy;
        return py < 0 || py >= height || !land[py * width + wrap(x + ox, width)];
      });
      if (coastal) {
        visited[index] = 1;
        heap.push(filled[index], index);
      }
    }
  }
  while (heap.length) {
    const [level, index] = heap.pop();
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [ox, oy] of neighborOffsets) {
      const py = y + oy;
      if (py < 0 || py >= height) continue;
      const next = py * width + wrap(x + ox, width);
      if (!land[next] || visited[next]) continue;
      visited[next] = 1;
      filled[next] = Math.max(filled[next], level + 0.004);
      heap.push(filled[next], next);
    }
  }

  const downstream = new Int32Array(count);
  downstream.fill(-1);
  const accumulation = new Float32Array(count);
  const order = [];
  for (let index = 0; index < count; index += 1) {
    if (!land[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    let best = -1;
    let bestLevel = filled[index];
    for (const [ox, oy] of neighborOffsets) {
      const py = y + oy;
      if (py < 0 || py >= height) continue;
      const next = py * width + wrap(x + ox, width);
      if (!land[next]) { best = next; bestLevel = -1e6; break; }
      const diagonalPenalty = ox !== 0 && oy !== 0 ? 0.001 : 0;
      const candidate = filled[next] + diagonalPenalty;
      if (candidate < bestLevel) { best = next; bestLevel = candidate; }
    }
    downstream[index] = best;
    const rainfall = biome[index] === 1 || biome[index] === 7 ? 0.28 : biome[index] === 4 ? 1.55 : biome[index] === 3 ? 1.24 : 0.92;
    accumulation[index] = rainfall;
    order.push(index);
  }
  order.sort((a, b) => filled[b] - filled[a]);
  for (const index of order) {
    const next = downstream[index];
    if (next >= 0 && land[next]) accumulation[next] += accumulation[index];
  }

  const riverEdges = [];
  const riverMask = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const flowX = new Float32Array(riverMask.length);
  const flowY = new Float32Array(riverMask.length);
  const riverBed = new Float32Array(riverMask.length);
  riverBed.fill(Number.POSITIVE_INFINITY);
  const threshold = 112;
  const bed = terrainHeight.slice();
  for (const index of order) {
    const next = downstream[index];
    if (next < 0 || accumulation[index] < threshold || !land[next]) continue;
    bed[next] = Math.min(bed[next], bed[index] - 0.025);
  }
  for (const index of order) {
    const next = downstream[index];
    if (next < 0 || accumulation[index] < threshold) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const nextXRaw = next % width;
    const nextY = Math.floor(next / width);
    let dx = nextXRaw - x;
    if (dx > width / 2) dx -= width;
    if (dx < -width / 2) dx += width;
    const nextX = x + dx;
    const x1 = (x + 0.5) / width * WORLD_WIDTH;
    const z1 = (y + 0.5) / height * WORLD_HEIGHT;
    const x2 = (nextX + 0.5) / width * WORLD_WIDTH;
    const z2 = (nextY + 0.5) / height * WORLD_HEIGHT;
    const strength = clamp(Math.log2(accumulation[index] / threshold + 1) / 5, 0, 1);
    const startBed = bed[index];
    const endBed = land[next] ? Math.min(bed[next], startBed - 0.025) : 0.12;
    const nextHeight = land[next] ? terrainHeight[next] : terrainHeight[index];
    const run = Math.max(0.001, Math.hypot(x2 - x1, z2 - z1));
    const steepness = clamp(Math.max(0, terrainHeight[index] - nextHeight) / run * 2.2, 0, 1);
    const worldWidth = (3.2 + Math.pow(accumulation[index] / threshold, 0.42) * 3.1) * (1 - steepness * 0.24);
    riverEdges.push({ start: index, finish: next, finishLand: Boolean(land[next]), x1, z1, x2, z2, startBed, endBed, steepness });

    const fx1 = x1 / WORLD_WIDTH * FIELD_WIDTH;
    const fy1 = z1 / WORLD_HEIGHT * FIELD_HEIGHT;
    const fx2 = x2 / WORLD_WIDTH * FIELD_WIDTH;
    const fy2 = z2 / WORLD_HEIGHT * FIELD_HEIGHT;
    const steps = Math.max(1, Math.ceil(Math.hypot(fx2 - fx1, fy2 - fy1) * 1.35));
    const radius = clamp(0.75 + worldWidth * FIELD_WIDTH / WORLD_WIDTH * 0.7, 0.8, 3.8);
    const flowLength = Math.max(0.001, Math.hypot(x2 - x1, z2 - z1));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cx = fx1 + (fx2 - fx1) * t;
      const cy = fy1 + (fy2 - fy1) * t;
      const reach = Math.ceil(radius * 2);
      for (let oy = -reach; oy <= reach; oy += 1) {
        const py = Math.round(cy) + oy;
        if (py < 0 || py >= FIELD_HEIGHT) continue;
        for (let ox = -reach; ox <= reach; ox += 1) {
          const distance = Math.hypot(Math.round(cx) + ox - cx, py - cy);
          if (distance > radius * 2) continue;
          const px = wrap(Math.round(cx) + ox, FIELD_WIDTH);
          const target = py * FIELD_WIDTH + px;
          if (!landField[target]) continue;
          const intensity = Math.exp(-(distance * distance) / (radius * radius * 0.72));
          riverBed[target] = Math.min(riverBed[target], startBed + (endBed - startBed) * t);
          if (intensity > riverMask[target]) {
            riverMask[target] = intensity;
            flowX[target] = (x2 - x1) / flowLength;
            flowY[target] = (z2 - z1) / flowLength;
          }
        }
      }
    }
  }

  const riverMesh = buildRiverMesh(riverEdges, accumulation, threshold);
  // Re-carve along the relaxed centerline so rendered water and terrain channels coincide.
  for (const edge of riverMesh.renderEdges) {
    const fx1 = edge.x1 / WORLD_WIDTH * FIELD_WIDTH;
    const fy1 = edge.z1 / WORLD_HEIGHT * FIELD_HEIGHT;
    const fx2 = edge.x2 / WORLD_WIDTH * FIELD_WIDTH;
    const fy2 = edge.z2 / WORLD_HEIGHT * FIELD_HEIGHT;
    const steps = Math.max(1, Math.ceil(Math.hypot(fx2 - fx1, fy2 - fy1) * 1.7));
    const flowLength = Math.max(0.001, Math.hypot(edge.x2 - edge.x1, edge.z2 - edge.z1));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cx = fx1 + (fx2 - fx1) * t;
      const cy = fy1 + (fy2 - fy1) * t;
      const width = edge.startWidth + (edge.endWidth - edge.startWidth) * t;
      const radius = clamp(1.0 + width * FIELD_WIDTH / WORLD_WIDTH * 0.95, 1.15, 5.2);
      const reach = Math.ceil(radius * 2);
      for (let oy = -reach; oy <= reach; oy += 1) {
        const py = Math.round(cy) + oy;
        if (py < 0 || py >= FIELD_HEIGHT) continue;
        for (let ox = -reach; ox <= reach; ox += 1) {
          const distance = Math.hypot(Math.round(cx) + ox - cx, py - cy);
          if (distance > radius * 2) continue;
          const px = wrap(Math.round(cx) + ox, FIELD_WIDTH);
          const target = py * FIELD_WIDTH + px;
          if (!landField[target]) continue;
          const intensity = Math.exp(-(distance * distance) / (radius * radius * 0.78));
          riverMask[target] = Math.max(riverMask[target], intensity);
          riverBed[target] = Math.min(riverBed[target], edge.startBed + (edge.endBed - edge.startBed) * t);
          if (intensity > 0.08) {
            flowX[target] = (edge.x2 - edge.x1) / flowLength;
            flowY[target] = (edge.z2 - edge.z1) / flowLength;
          }
        }
      }
    }
  }
  const smoothedRiverMask = blurField(riverMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 1, 1);
  const riverClearance = blurField(smoothedRiverMask.slice(), FIELD_WIDTH, FIELD_HEIGHT, 4, 2);
  const expandedFlowX = flowX.slice();
  const expandedFlowY = flowY.slice();
  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const index = y * FIELD_WIDTH + x;
      if (smoothedRiverMask[index] < 0.02 || flowX[index] * flowX[index] + flowY[index] * flowY[index] > 0.01) continue;
      let best = -1;
      let bestMask = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const py = y + oy;
        if (py < 0 || py >= FIELD_HEIGHT) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const neighbor = py * FIELD_WIDTH + wrap(x + ox, FIELD_WIDTH);
          if (flowX[neighbor] * flowX[neighbor] + flowY[neighbor] * flowY[neighbor] > 0.01 && riverMask[neighbor] > bestMask) {
            best = neighbor;
            bestMask = riverMask[neighbor];
          }
        }
      }
      if (best >= 0) {
        expandedFlowX[index] = flowX[best];
        expandedFlowY[index] = flowY[best];
      }
    }
  }
  const riverTexture = new Uint8Array(riverMask.length * 4);
  for (let index = 0; index < riverMask.length; index += 1) {
    const intensity = clamp(smoothedRiverMask[index] * 1.16, 0, 1);
    riverTexture[index * 4] = Math.round(intensity * 255);
    riverTexture[index * 4 + 1] = Math.round((expandedFlowX[index] * 0.5 + 0.5) * 255);
    riverTexture[index * 4 + 2] = Math.round((expandedFlowY[index] * 0.5 + 0.5) * 255);
    riverTexture[index * 4 + 3] = intensity > 0.02 ? 255 : 0;
  }
  return { riverMesh, riverCount: riverEdges.length, riverMouthCount: riverEdges.filter((edge) => !edge.finishLand).length, riverTexture, riverMask: smoothedRiverMask, riverCoreMask: riverMask, riverClearance, riverBed };
}

