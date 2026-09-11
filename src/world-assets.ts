import { fetchBinary } from './gpu-utils';
import type { WorldDescriptor } from '@ironfronts/protocol';
import type { WorldManifest } from './types';

let assetBaseUrl = '/world';
let expectedHashes: Record<string, string> = {};
const verifiedBuffers = new Map<string, Promise<ArrayBuffer>>();

export function configureWorldAssetBase(url: string, hashes: Record<string, string> = {}): void {
  expectedHashes = hashes; verifiedBuffers.clear();
  assetBaseUrl = url.replace(/\/$/, '');
}

export function worldAssetUrl(path: string): string {
  return `${assetBaseUrl}/${path.replace(/^\//, '')}`;
}

export interface WorldAssetBuffers {
  heightBuffer: ArrayBuffer;
  surfaceBuffer: ArrayBuffer;
  terrainNormalBuffer: ArrayBuffer;
  terrainAlbedoBuffer: ArrayBuffer;
  navigationBuffer: ArrayBuffer;
  coastBuffer: ArrayBuffer;
  provinceBuffer: ArrayBuffer;
  roadVertexBuffer: ArrayBuffer;
  roadIndexBuffer: ArrayBuffer;
  hiddenConnectionVertexBuffer: ArrayBuffer;
  hiddenConnectionIndexBuffer: ArrayBuffer;
  waterwayVertexBuffer: ArrayBuffer;
  waterwayIndexBuffer: ArrayBuffer;
  borderBuffer: ArrayBuffer;
  treeBuffer: ArrayBuffer;
  buildingBuffer: ArrayBuffer;
  lampBuffer: ArrayBuffer;
  barrierBuffer: ArrayBuffer;
  signBuffer: ArrayBuffer;
  provinceOwnerData: ArrayBuffer;
  provinceAdjacencyData: ArrayBuffer;
  provinceLabelData: ArrayBuffer;
}

export async function loadWorldAssetBuffers(manifest: WorldManifest): Promise<WorldAssetBuffers> {
  const paths = {
    heightBuffer: manifest.fields.height.url,
    surfaceBuffer: manifest.fields.surface.url,
    terrainNormalBuffer: manifest.fields.terrainNormal.url,
    terrainAlbedoBuffer: manifest.fields.terrainAlbedo.url,
    navigationBuffer: manifest.fields.navigation.url,
    coastBuffer: manifest.fields.coast.url,
    provinceBuffer: manifest.fields.provinceIds.url,
    roadVertexBuffer: manifest.buffers.roadVertices.url,
    roadIndexBuffer: manifest.buffers.roadIndices.url,
    hiddenConnectionVertexBuffer: manifest.buffers.hiddenConnectionVertices.url,
    hiddenConnectionIndexBuffer: manifest.buffers.hiddenConnectionIndices.url,
    waterwayVertexBuffer: manifest.buffers.waterwayVertices.url,
    waterwayIndexBuffer: manifest.buffers.waterwayIndices.url,
    borderBuffer: manifest.buffers.borders.url,
    treeBuffer: manifest.buffers.trees.url,
    buildingBuffer: manifest.buffers.buildings.url,
    lampBuffer: manifest.buffers.lamps.url,
    barrierBuffer: manifest.buffers.barriers.url,
    signBuffer: manifest.buffers.signs.url,
    provinceOwnerData: manifest.politics.owners.url,
    provinceAdjacencyData: manifest.politics.adjacency.url,
    provinceLabelData: manifest.politics.labelData.url,
  } satisfies Record<keyof WorldAssetBuffers, string>;

  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => (
    [key, await fetchWorldBinary(path)] as const
  )));
  return Object.fromEntries(entries) as unknown as WorldAssetBuffers;
}

function hex(buffer: ArrayBuffer): string { return [...new Uint8Array(buffer)].map((n) => n.toString(16).padStart(2, '0')).join(''); }
export async function verifyWorldDescriptor(descriptor: WorldDescriptor): Promise<void> {
  const required = ['world.json', 'province-details.json', 'province-owners.u32', 'province-ids.u16', 'surface.rgba8', 'height.f32', 'connections.f32'];
  if (required.some((name) => !/^[a-f0-9]{64}$/.test(descriptor.artifactHashes[name] ?? ''))) {
    throw new Error('Server did not identify every gameplay world artifact.');
  }
  const hashes = Object.fromEntries(Object.entries(descriptor.artifactHashes).sort(([a], [b]) => a.localeCompare(b)));
  const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(hashes))));
  if (hash !== descriptor.hash) throw new Error('World package identity is inconsistent.');
}
export function fetchWorldBinary(name: string): Promise<ArrayBuffer> {
  const key = name.replace(/^\//, '');
  let pending = verifiedBuffers.get(key);
  if (!pending) {
    const expected = expectedHashes[key];
    pending = fetchBinary(worldAssetUrl(name)).then(async (buffer) => {
      if (expected && hex(await crypto.subtle.digest('SHA-256', buffer)) !== expected) throw new Error(`World artifact mismatch: ${key}`);
      return buffer;
    });
    verifiedBuffers.set(key, pending);
  }
  return pending;
}
export async function fetchWorldJson<T>(name: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchWorldBinary(name))) as T;
}
