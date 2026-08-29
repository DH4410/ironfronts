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
  /** Surface class 4 at the centre — a city province (§28 production sites). */
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
  /** Raw `connections.f32` (stride 8); the session filters to land edges. */
  readonly connections: Float32Array;
  readonly resourceNodes: readonly WorldResourceNode[];
}
