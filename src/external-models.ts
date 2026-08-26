export interface ExternalMeshData {
  vertices: Float32Array;
  indices: Uint16Array;
}

const KENNEY_SUBURBAN_BASE = 'https://raw.githubusercontent.com/petroulacl/fps-buildings-env-kit/main/buildings/kenney-city-kit-suburban/Models/OBJ%20format';
const MODEL_FETCH_TIMEOUT_MS = 2_000;

// Keep the map-scale settlement pass deliberately restrained. These three
// compact Kenney CC0 houses produce cleaner silhouettes than the taller,
// more decorative variants previously used for archetypes 3 and 4.
const BUILDING_SOURCES = [
  `${KENNEY_SUBURBAN_BASE}/building-type-a.obj`,
  `${KENNEY_SUBURBAN_BASE}/building-type-g.obj`,
  `${KENNEY_SUBURBAN_BASE}/building-type-i.obj`,
] as const;

/**
 * Near-LOD building meshes sourced from Kenney's CC0 City Kit (Suburban).
 * The browser fetch is deliberately best-effort: a blocked/offline source
 * falls back to Ironfronts' existing generated LOD without breaking startup.
 */
export const externalBuildingMeshes = new Map<number, ExternalMeshData>();

if (typeof window !== 'undefined') {
  const results = await Promise.allSettled(BUILDING_SOURCES.map(async (url, archetype) => {
    const response = await fetch(url, {
      cache: 'force-cache',
      mode: 'cors',
      signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { archetype, mesh: parseObj(await response.text()) };
  }));
  for (const result of results) {
    if (result.status === 'fulfilled') externalBuildingMeshes.set(result.value.archetype, result.value.mesh);
    else console.warn('External CC0 building model unavailable; using local fallback.', result.reason);
  }
}

export function parseObj(source: string): ExternalMeshData {
  const positions: Array<[number, number, number]> = [];
  const normals: Array<[number, number, number]> = [];
  const packed: number[] = [];
  const indices: number[] = [];
  const vertexByKey = new Map<string, number>();

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      const position: [number, number, number] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      positions.push(position);
      minX = Math.min(minX, position[0]); maxX = Math.max(maxX, position[0]);
      minY = Math.min(minY, position[1]); maxY = Math.max(maxY, position[1]);
      minZ = Math.min(minZ, position[2]); maxZ = Math.max(maxZ, position[2]);
    } else if (parts[0] === 'vn' && parts.length >= 4) {
      normals.push(normalize([Number(parts[1]), Number(parts[2]), Number(parts[3])]));
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const face = parts.slice(1).map((token) => resolveVertex(token));
      for (let index = 1; index + 1 < face.length; index += 1) indices.push(face[0], face[index], face[index + 1]);
    }
  }

  if (!positions.length || !indices.length) throw new Error('OBJ contains no renderable geometry');
  if (packed.length / 7 > 65_535) throw new Error('OBJ exceeds Ironfronts uint16 mesh limit');

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const spanZ = Math.max(1e-6, maxZ - minZ);
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  for (let offset = 0; offset < packed.length; offset += 7) {
    packed[offset] = (packed[offset] - centerX) / spanX;
    packed[offset + 1] = (packed[offset + 1] - minY) / spanY;
    packed[offset + 2] = (packed[offset + 2] - centerZ) / spanZ;
    // Positions are normalized independently on each axis. Normals need the
    // inverse-transpose of that transform, hence multiplication by the source spans.
    const transformed = normalize([
      packed[offset + 3] * spanX,
      packed[offset + 4] * spanY,
      packed[offset + 5] * spanZ,
    ]);
    packed[offset + 3] = transformed[0];
    packed[offset + 4] = transformed[1];
    packed[offset + 5] = transformed[2];
    // Existing prop shader treats 0 as wall and 1 as roof. Classifying
    // upward-facing sourced faces keeps roofs from receiving window emission.
    packed[offset + 6] = transformed[1] > 0.45 ? 1 : 0;
  }

  return { vertices: new Float32Array(packed), indices: new Uint16Array(indices) };

  function resolveVertex(token: string): number {
    const [positionToken, , normalToken] = token.split('/');
    const positionIndex = resolveIndex(Number(positionToken), positions.length);
    const normalIndex = normalToken ? resolveIndex(Number(normalToken), normals.length) : -1;
    const key = `${positionIndex}/${normalIndex}`;
    const existing = vertexByKey.get(key);
    if (existing !== undefined) return existing;
    const position = positions[positionIndex];
    if (!position) throw new Error(`OBJ references missing position ${positionToken}`);
    const normal = normalIndex >= 0 && normals[normalIndex] ? normals[normalIndex] : [0, 1, 0] as [number, number, number];
    const index = packed.length / 7;
    packed.push(position[0], position[1], position[2], normal[0], normal[1], normal[2], 0);
    vertexByKey.set(key, index);
    return index;
  }
}

function resolveIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index === 0) throw new Error(`Invalid OBJ index ${index}`);
  return index > 0 ? index - 1 : length + index;
}

function normalize(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}
