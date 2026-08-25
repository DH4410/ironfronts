import type { Mesh } from './scene-meshes';

export interface InstanceLayer {
  buffer: GPUBuffer;
  params: GPUBuffer;
  bindGroup: GPUBindGroup;
  count: number;
  views?: Map<string, {
    buffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    revision: number;
    draws: Array<{ mesh: Mesh; firstInstance: number; instanceCount: number; lod: number }>;
    visibleChunks: number;
  }>;
}

export interface PerformanceLayerVisibility {
  terrain: boolean;
  ocean: boolean;
  trees: boolean;
  buildings: boolean;
  roadFurniture: boolean;
  countryTint: boolean;
  countryBorders: boolean;
  countryLabels: boolean;
}
