/**
 * The read-only world facts `GameSession` needs, as a plain interface.
 *
 * `main.ts` adapts the loaded `WorldManifest` / renderer output into this shape.
 * The game layer NEVER imports the renderer (enforced by the architecture
 * test), so this interface is the boundary.
 */

export interface WorldProvince {
  readonly id: number;
  /** World-space centre [x, z] (world units). */
  readonly center: readonly [number, number];
  readonly terrainId: number;
  readonly population: number;
  readonly coastal: boolean;
  /** Surface class 4 at the centre — a city province (production sites). */
  readonly urban: boolean;
}

export interface WorldCountry {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly capitalProvinceId: number;
}

export interface WorldResourceNode {
  readonly id: number;
  readonly kind: 'stone' | 'metal' | 'oil';
  readonly x: number;
  readonly z: number;
  readonly amount: number;
}

/** Authored terrain class from the surface field, channel 0. */
export const TERRAIN_CLASS = {
  plain: 0,
  hill: 1,
  mountain: 2,
  forest: 3,
  urban: 4,
  /** Not land: surface alpha 0 (open water / void). */
  water: -1,
} as const;
export type TerrainClass = (typeof TERRAIN_CLASS)[keyof typeof TERRAIN_CLASS];

export interface WorldData {
  readonly width: number;
  readonly height: number;
  readonly provinces: readonly WorldProvince[];
  readonly countries: readonly WorldCountry[];
  /**
   * Authoritative initial owner: RAW province id -> country id (0 = unowned).
   * `main.ts` must translate the encoded-id `province-owners.u32` buffer
   * (indexed by `province_id + 1`) into this raw-id accessor. The whole game
   * layer speaks raw province ids, matching the renderer's public API.
   */
  readonly provinceOwner: (provinceId: number) => number;
  /**
   * Point-in-province lookup from the province-id raster at an actual world
   * position (X wraps). Returns the RAW province id under the point, or -1 for
   * open water / void. This is the canonical spatial owner answer — do NOT use
   * nearest-centroid for authoritative assignment.
   */
  readonly provinceAt: (x: number, z: number) => number;
  /**
   * Authored terrain class under a world position (X wraps), from the surface
   * field. -1 (`TERRAIN_CLASS.water`) when the point is not land.
   */
  readonly terrainClassAt: (x: number, z: number) => TerrainClass;
  /** Raw `connections.f32` (stride 8); the session filters to land edges. */
  readonly connections: Float32Array;
  readonly resourceNodes: readonly WorldResourceNode[];
}
