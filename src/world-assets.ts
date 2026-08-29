import { fetchBinary } from './gpu-utils';
import type { WorldManifest } from './types';

let assetBaseUrl = '/world';

export function configureWorldAssetBase(url: string): void {
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
    [key, await fetchBinary(worldAssetUrl(path))] as const
  )));
  return Object.fromEntries(entries) as unknown as WorldAssetBuffers;
}
