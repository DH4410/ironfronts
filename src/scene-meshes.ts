import { MeshBuilder } from './geometry';

export interface Mesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

const align4 = (value: number): number => (value + 3) & ~3;

export function createTerrainMesh(device: GPUDevice, resolution: number, skirts = false): Mesh {
  const vertexValues: number[] = [];
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      vertexValues.push(x / (resolution - 1), y / (resolution - 1), 0);
    }
  }
  const indexValues: number[] = [];
  for (let y = 0; y < resolution - 1; y += 1) {
    for (let x = 0; x < resolution - 1; x += 1) {
      const a = y * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indexValues.push(a, c, b, b, c, d);
    }
  }
  if (skirts) {
    const addSkirtSegment = (u1: number, v1: number, u2: number, v2: number): void => {
      const first = vertexValues.length / 3;
      vertexValues.push(u1, v1, 0, u2, v2, 0, u1, v1, 1, u2, v2, 1);
      indexValues.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    };
    for (let index = 0; index < resolution - 1; index += 1) {
      const a = index / (resolution - 1);
      const b = (index + 1) / (resolution - 1);
      addSkirtSegment(a, 0, b, 0);
      addSkirtSegment(b, 1, a, 1);
      addSkirtSegment(0, b, 0, a);
      addSkirtSegment(1, a, 1, b);
    }
  }
  return uploadMesh(device, 'terrain grid', new Float32Array(vertexValues), new Uint16Array(indexValues));
}

export function createTreeMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  // One compact primitive set is morphed into five silhouettes by the prop
  // vertex shader. Parts 1-3 are broadleaf crowns; 4-6 are conifer tiers.
  builder.addBox(-0.5, 0, -0.5, 0.5, 1, 0.5, 0);
  for (let part = 1; part <= 3; part += 1) builder.addFacetedSphere(part);
  for (let part = 4; part <= 6; part += 1) builder.addCone(0, -1, 0, 1, 1, 8, part);
  return uploadMesh(device,'tree mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createTreeFamilyMesh(device: GPUDevice, family: 'broadleaf' | 'conifer', lod: 0 | 1 | 2): Mesh {
  const builder = new MeshBuilder();
  if (lod < 2) builder.addBox(-0.5, 0, -0.5, 0.5, 1, 0.5, 0);
  const partCount = lod === 0 ? 3 : lod === 1 ? 2 : 1;
  if (family === 'broadleaf') {
    for (let part = 1; part <= partCount; part += 1) builder.addFacetedSphere(part);
  } else {
    for (let part = 4; part < 4 + partCount; part += 1) builder.addCone(0, -1, 0, 1, 1, lod === 2 ? 6 : 8, part);
  }
  return uploadMesh(device, `${family} tree lod ${lod}`, new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createBuildingMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  builder.addBox(-0.5, 0, -0.5, 0.5, 1, 0.5, 0);
  builder.addGableRoof(-0.56, 1, -0.56, 0.56, 1.24, 0.56, 1);
  builder.addBox(-0.68, 0, -0.38, 0.68, 0.42, 0.38, 2, 2);
  builder.addBox(-0.18, 1, -0.18, 0.18, 1.52, 0.18, 3, 3);
  builder.addHipRoof(0, 1, 0, 0.62, 1.24, 4);
  builder.addBox(-0.54, 1, -0.54, 0.54, 1.055, 0.54, 5, 5);
  return uploadMesh(device,'building mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createBuildingArchetypeMesh(device: GPUDevice, archetype: number, lod: 0 | 1 | 2): Mesh {
  const builder = new MeshBuilder();
  builder.addBox(-0.5, 0, -0.5, 0.5, 1, 0.5, 0);
  if (lod < 2) {
    if (archetype === 1) builder.addHipRoof(0, 1, 0, 0.62, 1.24, 4);
    else if (archetype === 2) builder.addBox(-0.54, 1, -0.54, 0.54, 1.055, 0.54, 5, 5);
    else builder.addGableRoof(-0.56, 1, -0.56, 0.56, lod === 0 ? 1.24 : 1.18, 0.56, 1);
    if (lod === 0 && archetype === 3) builder.addBox(-0.68, 0, -0.38, 0.68, 0.42, 0.38, 2, 2);
    if (lod === 0 && archetype === 4) builder.addBox(-0.18, 1, -0.18, 0.18, 1.52, 0.18, 3, 3);
  }
  return uploadMesh(device, `building archetype ${archetype} lod ${lod}`, new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createLampMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  builder.addBox(-0.07, 0, -0.07, 0.07, 3.2, 0.07, 0);
  builder.addBox(-0.10, 3.0, -0.10, 0.10, 3.42, 0.10, 0);
  builder.addBox(-0.18, 3.38, -0.18, 0.18, 3.57, 0.18, 1, 1);
  return uploadMesh(device,'road lamp mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createBarrierMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  for (const x of [-0.46, 0, 0.46]) builder.addBox(x - 0.025, 0, -0.07, x + 0.025, 0.86, 0.07, 0);
  builder.addBox(-0.5, 0.58, -0.055, 0.5, 0.72, 0.055, 1, 1);
  return uploadMesh(device,'road barrier mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createSignMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  builder.addBox(-0.045, 0, -0.045, 0.045, 1.55, 0.045, 0);
  builder.addBox(-0.42, 1.08, -0.055, 0.42, 1.52, 0.055, 1, 1);
  return uploadMesh(device,'road sign mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createShadowMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  builder.addPlane(9);
  return uploadMesh(device,'contact shadow mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

function uploadMesh(device: GPUDevice, label: string, vertices: Float32Array, indices: Uint16Array): Mesh {
  const vertex = device.createBuffer({ label: `${label} vertices`, size: align4(vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const index = device.createBuffer({ label: `${label} indices`, size: align4(indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertex, 0, vertices.buffer as ArrayBuffer, vertices.byteOffset, vertices.byteLength);
  device.queue.writeBuffer(index, 0, indices.buffer as ArrayBuffer, indices.byteOffset, indices.byteLength);
  return { vertex, index, indexCount: indices.length };
}

export function uploadIndexedMesh(device: GPUDevice, label: string, vertexData: ArrayBuffer, indexData: ArrayBuffer, indexCount: number): Mesh {
  const vertex = device.createBuffer({ label: `${label} vertices`, size: align4(vertexData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const index = device.createBuffer({ label: `${label} indices`, size: align4(indexData.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertex, 0, vertexData);
  device.queue.writeBuffer(index, 0, indexData);
  return { vertex, index, indexCount };
}
