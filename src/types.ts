export interface BinaryField {
  url: string;
  width: number;
  height: number;
  format: string;
}

export interface BinaryBufferDescriptor {
  url: string;
  count: number;
  stride: number;
  lazy?: boolean;
}

export interface ProvinceRecord {
  id: number;
  name: string;
  center: [number, number];
  terrainId: number;
  terrain: string;
  visualBiome: string;
  population: number;
  coastal: boolean;
}

export interface WorldManifest {
  version: number;
  generatedSeed: number;
  source: { mapId: string; mapVersion: number };
  world: { width: number; height: number; overlapX: number; wrapX: boolean };
  fields: {
    height: BinaryField;
    surface: BinaryField;
    rivers: BinaryField;
    coast: BinaryField;
    provinceIds: BinaryField;
  };
  buffers: {
    borders: BinaryBufferDescriptor;
    riverVertices: BinaryBufferDescriptor;
    riverIndices: BinaryBufferDescriptor;
    connections: BinaryBufferDescriptor;
    trees: BinaryBufferDescriptor;
    buildings: BinaryBufferDescriptor;
  };
  terrain: {
    chunksX: number;
    chunksY: number;
    gridResolution: number;
    maxHeight: number;
  };
  counts: Record<string, number>;
  provinces: ProvinceRecord[];
}

export interface HoverInfo {
  id: number;
  name: string;
  terrain: string;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  camera: [number, number, number];
  distance: number;
  hoveredProvince: number | null;
  trees: number;
  buildings: number;
  borderEdges: number;
  debugView: number;
}

export type ProgressReporter = (stage: string, progress: number) => void;
