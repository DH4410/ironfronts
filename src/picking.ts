import { vec3 } from 'gl-matrix';
import type { StrategyCamera } from './camera';
import type { CountryRecord, HoverInfo, ProvinceRecord } from './types';

export function pickTerrainPoint(
  camera: StrategyCamera,
  clientX: number,
  clientY: number,
  maximumTerrainHeight: number,
  worldHeight: number,
  sampleHeight: (worldX: number, worldZ: number) => number,
  result: vec3,
): vec3 | null {
  const ray = camera.screenRay(clientX, clientY);
  if (ray.direction[1] >= -0.0001) return null;

  const topY = maximumTerrainHeight + 12;
  let low = Math.max(0, (topY - ray.origin[1]) / ray.direction[1]);
  let high = Math.max(0, (-2 - ray.origin[1]) / ray.direction[1]);
  if (high < low) [low, high] = [high, low];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const distance = (low + high) * 0.5;
    vec3.scaleAndAdd(result, ray.origin, ray.direction, distance);
    if (result[1] > sampleHeight(result[0], result[2])) low = distance;
    else high = distance;
  }
  vec3.scaleAndAdd(result, ray.origin, ray.direction, (low + high) * 0.5);
  return result[2] < 0 || result[2] >= worldHeight ? null : result;
}

export function createHoverInfo(
  encodedId: number,
  provinces: ReadonlyMap<number, ProvinceRecord>,
  countries: ReadonlyMap<number, CountryRecord>,
  provinceOwners: Uint32Array,
): HoverInfo | null {
  const province = provinces.get(encodedId - 1);
  if (!province) return null;
  const country = countries.get(provinceOwners[encodedId]);
  return {
    id: province.id,
    name: province.name,
    terrain: province.terrain,
    country: country?.name ?? 'Unassigned',
    countryColor: country?.color ?? '#808080',
  };
}
