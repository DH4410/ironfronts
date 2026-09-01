/**
 * SCAFFOLD — external 3D building models + construction-site visual.
 *
 * This is the first, deliberately non-wired pass of the deferred "real 3D
 * buildings" work (pass-4 report items 35-38 / 14 / 39). It defines the data
 * shape and the integration contract so the follow-up pass — and the incoming
 * building-art asset drop — have a fixed landing spot, WITHOUT touching the
 * render loop while `main` is under active change.
 *
 * ── Integration path (three touch points, none taken yet) ────────────────────
 *
 * 1. ASSET FORMAT. glTF 2.0 binary (.glb), one file per building archetype,
 *    Y-up, +Z forward, metres, origin at the ground-plane centre of the
 *    footprint. CC0 sources already scouted: Quaternius "Medieval Village" and
 *    Kenney "City Kit" / "Building Kit". Files live under
 *    `public/models/buildings/<id>.glb` and are listed in
 *    `BUILDING_MODEL_MANIFEST` below (empty until the drop lands).
 *
 * 2. GPU UPLOAD. A new `BuildingModelSet` loaded once alongside the terrain
 *    meshes in `renderer.ts` (mirror `createTreeFamilyMesh` / the tree
 *    `InstanceLayer`): decode each .glb to interleaved position/normal/uv,
 *    upload as an indexed mesh, build one instance buffer keyed by the
 *    existing `buildingBuffer` records so placement, yaw and archetype come
 *    straight from the world manifest — no new world data, no worldHash change.
 *
 * 3. DRAW + LOD. Draw the instanced models in the existing prop pass, gated to
 *    close zoom, and cross-fade to the current procedural `props.ts` kind==1u
 *    boxes as the camera pulls back (same `smoothstep` distance term the boxes
 *    already use). The procedural boxes stay as the far-LOD and the fallback
 *    when a model id has no .glb yet.
 *
 * ── Construction-site visual (item 14/39) ───────────────────────────────────
 *
 * `ConstructionSite` below is the CPU-side record the renderer would consume:
 * one per province building whose `progress01 < 1`. The intended visual is a
 * vertical reveal — the finished model clipped to `progress01 * height` with a
 * scaffold lattice + dust plane at the cut line — which needs only a clip
 * uniform on the same instanced draw, no extra geometry.
 */

/** Archetype buckets shared with the procedural prop shader (props.ts kind==1u). */
export type BuildingArchetype = 0 | 1 | 2 | 3 | 4;

export interface BuildingModelDef {
  /** Stable id: facility id ("barracks", "tank-plant", …) or "archetype-N". */
  readonly id: string;
  /** Served path, e.g. "/models/buildings/barracks.glb". */
  readonly url: string;
  /** Archetype bucket used for the procedural far-LOD / fallback. */
  readonly archetype: BuildingArchetype;
  /** Ground footprint of the model in world units, for placement scaling. */
  readonly footprint: number;
  /** Extra yaw (radians) if the model's forward axis isn't +Z. */
  readonly yawOffset: number;
  /** Uniform vertical scale tweak (1 = as authored). */
  readonly heightScale: number;
}

/**
 * Populated when the building-art drop lands in `public/models/buildings/`.
 * Empty is the correct current state — the renderer must treat a missing id as
 * "use the procedural box".
 */
export const BUILDING_MODEL_MANIFEST: Readonly<Record<string, BuildingModelDef>> = {};

/** One in-progress construction, projected from province building state. */
export interface ConstructionSite {
  readonly provinceId: number;
  readonly buildingId: string;
  /** 0 = just started, 1 = complete (complete sites are not emitted). */
  readonly progress01: number;
  readonly worldX: number;
  readonly worldZ: number;
}

/** Resolve a building id to its model URL, or null to fall back to the box. */
export function resolveBuildingModelUrl(id: string): string | null {
  return BUILDING_MODEL_MANIFEST[id]?.url ?? null;
}

/** True once at least one real model is available to draw. */
export function hasBuildingModels(): boolean {
  return Object.keys(BUILDING_MODEL_MANIFEST).length > 0;
}
