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
  infrastructureLevel: number;
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
    coast: BinaryField;
    provinceIds: BinaryField;
  };
  buffers: {
    borders: BinaryBufferDescriptor;
    connections: BinaryBufferDescriptor;
    roadVertices: BinaryBufferDescriptor;
    roadIndices: BinaryBufferDescriptor;
    corridorMetrics: BinaryBufferDescriptor;
    corridorFlags: BinaryBufferDescriptor;
    connectionCorridorOffsets: BinaryBufferDescriptor;
    connectionCorridorIds: BinaryBufferDescriptor;
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
  };
  reports: { generation: { url: string; version: string } };
  showcases: {
    urban: [number, number]; mountain: [number, number]; steepRoad: [number, number];
    dirtRoad: [number, number]; europe: [number, number]; lakeRoad: [number, number]; liangshan: [number, number];
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
  roads: number;
  debugView: number;
}

export type ProgressReporter = (stage: string, progress: number) => void;
