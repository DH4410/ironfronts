/**
 * Shared test helper: assemble a `WorldData` from the built world output on
 * disk (public/world/**). `pretest` runs `build:world`, so these files exist
 * whenever the suite runs.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorldData, WorldProvince } from '../../src/game/world-data';
import { generateResourceNodes } from '../../src/resource-nodes';

const WORLD_DIR = path.resolve(__dirname, '../../public/world');

async function bin(name: string): Promise<ArrayBuffer> {
  const buffer = await readFile(path.join(WORLD_DIR, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export interface LoadedWorld extends WorldData {
  readonly countryByName: (name: string) => { id: number; capitalProvinceId: number } | undefined;
}

export async function loadWorld(): Promise<LoadedWorld> {
  const manifest = JSON.parse(await readFile(path.join(WORLD_DIR, 'world.json'), 'utf8'));
  const details = JSON.parse(
    await readFile(path.join(WORLD_DIR, 'province-details.json'), 'utf8'),
  ).provinces as Array<{
    id: number; center: [number, number]; terrainId: number; population: number; coastal: boolean;
  }>;
  const owners = new Uint32Array(await bin('province-owners.u32'));
  const connections = new Float32Array(await bin('connections.f32'));
  const surface = new Uint8Array(await bin('surface.rgba8'));
  const height = new Float32Array(await bin('height.f32'));

  const width: number = manifest.world.width;
  const heightUnits: number = manifest.world.height;
  const surfaceField = manifest.fields.surface;
  const heightField = manifest.fields.height;

  const surfaceClassAt = (x: number, z: number): number => {
    const px = ((Math.floor((((x % width) + width) % width) / width * surfaceField.width) % surfaceField.width) + surfaceField.width) % surfaceField.width;
    const pz = Math.min(surfaceField.height - 1, Math.max(0, Math.floor(z / heightUnits * surfaceField.height)));
    return surface[(pz * surfaceField.width + px) * 4];
  };

  const provinces: WorldProvince[] = details.map((detail) => ({
    id: detail.id,
    center: [detail.center[0], detail.center[1]] as const,
    terrainId: detail.terrainId,
    population: detail.population,
    coastal: detail.coastal,
    urban: surfaceClassAt(detail.center[0], detail.center[1]) === 4,
  }));

  const countries = manifest.politics.countries.map((country: {
    id: number; name: string; color: string; capitalProvinceId: number;
  }) => ({
    id: country.id,
    name: country.name,
    color: country.color,
    capitalProvinceId: country.capitalProvinceId,
  }));

  const resourceNodes = generateResourceNodes({
    surface,
    surfaceField,
    height,
    heightField,
    world: { width, height: heightUnits },
  }).map((node) => ({ id: node.id, kind: node.kind, x: node.x, z: node.z, amount: node.amount }));

  return {
    width,
    height: heightUnits,
    provinces,
    countries,
    // `province-owners.u32` is indexed by ENCODED id (raw province_id + 1);
    // the game layer works in raw province ids throughout (§ renderer public API).
    provinceOwner: (provinceId: number) => owners[provinceId + 1] ?? 0,
    connections,
    resourceNodes,
    countryByName: (name: string) => countries.find(
      (country: { name: string }) => country.name.toLowerCase() === name.toLowerCase(),
    ),
  };
}
