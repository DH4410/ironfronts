export const WATERWAY_MAX_VISUAL_GRADE = 0.30;
const STRIDE = 10;

function ringAt(vertices, vertex) {
  const left = vertex * STRIDE;
  const center = (vertex + 1) * STRIDE;
  const right = (vertex + 2) * STRIDE;
  if (right + STRIDE > vertices.length) return null;
  if (vertices[left + 5] < 0.8 || vertices[center + 5] > 0.08 || vertices[right + 5] < 0.8) return null;
  if (vertices[center + 6] > 0.10) return null;
  const lx = vertices[left] - vertices[center], lz = vertices[left + 2] - vertices[center + 2];
  const rx = vertices[right] - vertices[center], rz = vertices[right + 2] - vertices[center + 2];
  const leftWidth = Math.hypot(lx, lz), rightWidth = Math.hypot(rx, rz);
  if (leftWidth < 3 || leftWidth > 14 || rightWidth < 3 || rightWidth > 14) return null;
  if ((lx * rx + lz * rz) / Math.max(0.001, leftWidth * rightWidth) > -0.45) return null;
  return {
    firstVertex: vertex,
    x: vertices[center], y: vertices[center + 1], z: vertices[center + 2],
    flowX: vertices[center + 7], flowZ: vertices[center + 8],
  };
}

export function smoothMovementWaterwayGrades(vertices, maximumGrade = WATERWAY_MAX_VISUAL_GRADE) {
  const rings = [];
  for (let vertex = 0; vertex + 2 < vertices.length / STRIDE; vertex += 1) {
    const ring = ringAt(vertices, vertex);
    if (!ring) continue;
    rings.push(ring);
    vertex += 2;
  }
  if (!rings.length) return { rings: 0, adjustments: 0, maximumGrade: 0 };

  const cellSize = 1.25;
  const buckets = new Map();
  const bucketKey = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  for (let index = 0; index < rings.length; index += 1) {
    const key = bucketKey(rings[index].x, rings[index].z);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  }
  const neighborsOf = (ring) => {
    const bx = Math.floor(ring.x / cellSize), bz = Math.floor(ring.z / cellSize);
    const out = [];
    for (let oz = -1; oz <= 1; oz += 1) for (let ox = -1; ox <= 1; ox += 1) {
      for (const index of buckets.get(`${bx + ox},${bz + oz}`) ?? []) out.push(index);
    }
    return out;
  };

  const queue = rings.map((_, index) => index);
  const queued = new Uint8Array(rings.length); queued.fill(1);
  let adjustments = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    queued[index] = 0;
    const ring = rings[index];
    for (const neighborIndex of neighborsOf(ring)) {
      if (neighborIndex === index) continue;
      const neighbor = rings[neighborIndex];
      const distance = Math.hypot(ring.x - neighbor.x, ring.z - neighbor.z);
      if (distance < 0.15 || distance > 1.05) continue;
      const alignment = Math.abs(ring.flowX * neighbor.flowX + ring.flowZ * neighbor.flowZ);
      if (alignment < 0.35) continue;
      const allowed = maximumGrade * distance;
      const difference = ring.y - neighbor.y;
      if (Math.abs(difference) <= allowed + 0.0001) continue;
      const highIndex = difference > 0 ? index : neighborIndex;
      const lowIndex = difference > 0 ? neighborIndex : index;
      const high = rings[highIndex], low = rings[lowIndex];
      const targetY = low.y + allowed;
      if (targetY >= high.y - 0.0001) continue;
      const delta = high.y - targetY;
      high.y = targetY;
      const first = high.firstVertex * STRIDE;
      vertices[first + 1] -= delta;
      vertices[first + STRIDE + 1] -= delta;
      vertices[first + STRIDE * 2 + 1] -= delta;
      adjustments += 1;
      if (!queued[highIndex]) { queued[highIndex] = 1; queue.push(highIndex); }
      for (const nearby of neighborsOf(high)) if (!queued[nearby]) { queued[nearby] = 1; queue.push(nearby); }
    }
  }

  let observedMaximum = 0;
  for (let index = 0; index < rings.length; index += 1) {
    const ring = rings[index];
    for (const neighborIndex of neighborsOf(ring)) {
      if (neighborIndex <= index) continue;
      const neighbor = rings[neighborIndex];
      const distance = Math.hypot(ring.x - neighbor.x, ring.z - neighbor.z);
      if (distance < 0.15 || distance > 1.05) continue;
      const alignment = Math.abs(ring.flowX * neighbor.flowX + ring.flowZ * neighbor.flowZ);
      if (alignment < 0.35) continue;
      observedMaximum = Math.max(observedMaximum, Math.abs(ring.y - neighbor.y) / distance);
    }
  }
  return { rings: rings.length, adjustments, maximumGrade: observedMaximum };
}
