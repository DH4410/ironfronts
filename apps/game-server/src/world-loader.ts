import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildWorldData, type WorldData } from '@ironfronts/game-core';
import { generateResourceNodes } from '../../../src/resource-nodes';

async function arrayBuffer(directory: string, name: string): Promise<ArrayBuffer> {
  const buffer = await readFile(path.join(directory, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export async function loadWorld(directory: string): Promise<{ world: WorldData; version: string; hash: string }> {
  const manifestBytes = await readFile(path.join(directory, 'world.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const details = JSON.parse(await readFile(path.join(directory, 'province-details.json'), 'utf8')).provinces;
  const [owners, ids, surface, height, connections] = await Promise.all([
    arrayBuffer(directory, 'province-owners.u32'),
    arrayBuffer(directory, 'province-ids.u16'),
    arrayBuffer(directory, 'surface.rgba8'),
    arrayBuffer(directory, 'height.f32'),
    arrayBuffer(directory, 'connections.f32'),
  ]);
  const resourceNodes = generateResourceNodes({
    surface: new Uint8Array(surface),
    surfaceField: manifest.fields.surface,
    height: new Float32Array(height),
    heightField: manifest.fields.height,
    world: manifest.world,
  }).map((node) => ({ id: node.id, kind: node.kind, x: node.x, z: node.z, amount: node.amount }));
  return {
    world: buildWorldData({
      worldWidth: manifest.world.width,
      worldHeight: manifest.world.height,
      provinceDetails: details,
      countries: manifest.politics.countries,
      provinceOwners: new Uint32Array(owners),
      provinceIdRaster: new Uint16Array(ids),
      provinceIdField: manifest.fields.provinceIds,
      surface: new Uint8Array(surface),
      surfaceField: manifest.fields.surface,
      connections: new Float32Array(connections),
      resourceNodes,
    }),
    version: String(manifest.version),
    hash: createHash('sha256').update(manifestBytes).digest('hex'),
  };
}
