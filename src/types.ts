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
  terrain: string;
}

export interface ProvinceDetails {
  version: number;
  provinces: Array<{
    id: number;
    center: [number, number];
    terrainId: number;
    visualBiome: string;
    population: number;
    coastal: boolean;
  }>;
}

export interface WorldManifest {
  version: number;
  generatedSeed: number;
  source: { mapId: string; mapVersion: number };
  world: { width: number; height: number; overlapX: number; wrapX: boolean };
  fields: {
    height: BinaryField;
    surface: BinaryField;
    roads: BinaryField;
    waterways: BinaryField;
    coast: BinaryField;
    provinceIds: BinaryField;
  };
  buffers: {
    borders: BinaryBufferDescriptor;
    connections: BinaryBufferDescriptor;
    roadVertices: BinaryBufferDescriptor;
    roadIndices: BinaryBufferDescriptor;
    hiddenConnectionVertices: BinaryBufferDescriptor;
    hiddenConnectionIndices: BinaryBufferDescriptor;
    waterwayVertices: BinaryBufferDescriptor;
    waterwayIndices: BinaryBufferDescriptor;
    waterwayNetworkLines: BinaryBufferDescriptor;
    trees: BinaryBufferDescriptor;
    buildings: BinaryBufferDescriptor;
    lamps: BinaryBufferDescriptor;
    barriers: BinaryBufferDescriptor;
    signs: BinaryBufferDescriptor;
  };
  terrain: {
    chunksX: number;
    chunksY: number;
    gridResolution: number;
    maxHeight: number;
  };
  infrastructureChunks: {
    chunksX: number;
    chunksY: number;
    roads: Array<{ firstIndex: number; indexCount: number }>;
    hiddenConnections: Array<{ firstIndex: number; indexCount: number }>;
    waterways: Array<{ firstIndex: number; indexCount: number }>;
  };
  reports: { generation: { url: string; version: string } };
  sidecars: { provinceDetails: { url: string; version: number } };
  showcases: {
    urban: [number, number]; mountain: [number, number]; steepRoad: [number, number];
    dirtRoad: [number, number]; hiddenConnection: [number, number];
    europe: [number, number]; lakeRoad: [number, number]; liangshan: [number, number];
    river: [number, number]; riverMouth: [number, number];
    kielCanal: [number, number]; suezCanal: [number, number];
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
  emittedRoads: number;
  hiddenRoads: number;
  riverSystems: number;
  riverSegments: number;
  canalSegments: number;
  targetElevation: number;
  targetProvince: number | null;
}

export type ProgressReporter = (stage: string, progress: number) => void;
