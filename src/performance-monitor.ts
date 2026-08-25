export interface PerformanceDistribution {
  average: number;
  median: number;
  p95: number;
  p99: number;
  maximum: number;
}

export interface PerformancePhases {
  camera: number;
  uniforms: number;
  labels: number;
  pickRaycast: number;
  hoverUi: number;
  render: number;
}

export type RenderCategory = 'terrain' | 'water' | 'waterways' | 'roads' | 'hiddenLinks'
  | 'polarCaps' | 'trees' | 'buildings' | 'roadFurniture' | 'borders' | 'debugLines' | 'labels';

export interface RenderWorkload {
  drawCalls: number;
  triangles: number;
  instances: number;
  labels: number;
  visibleChunks: { terrain: number; trees: number; buildings: number; roadFurniture: number; roads: number; hiddenLinks: number; waterways: number; borders: number };
  lodInstances: { terrain: number[]; trees: number[]; buildings: number[] };
  trianglesByCategory: Record<RenderCategory, number>;
}

export interface FramePerformanceSample {
  frameMs: number;
  mainThreadMs: number;
  phases: PerformancePhases;
}

export interface PerformanceSnapshot {
  sampleCount: number;
  frame: PerformanceDistribution;
  mainThread: PerformanceDistribution;
  phases: Record<keyof PerformancePhases, PerformanceDistribution>;
  gpu: PerformanceDistribution | null;
  gpuSampleCount: number;
  gpuTimingSupported: boolean;
  workload: RenderWorkload;
}

const EMPTY_DISTRIBUTION: PerformanceDistribution = {
  average: 0,
  median: 0,
  p95: 0,
  p99: 0,
  maximum: 0,
};

export class PerformanceMonitor {
  private readonly samples: FramePerformanceSample[] = [];
  private readonly gpuSamples: number[] = [];
  private latestWorkload = createEmptyRenderWorkload();

  constructor(
    private readonly gpuTimingSupported: boolean,
    private readonly maximumSamples = 600,
  ) {}

  record(sample: FramePerformanceSample, workload: RenderWorkload): void {
    this.samples.push(sample);
    if (this.samples.length > this.maximumSamples) this.samples.shift();
    this.latestWorkload = workload;
  }

  recordGpu(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.gpuSamples.push(milliseconds);
    if (this.gpuSamples.length > this.maximumSamples) this.gpuSamples.shift();
  }

  reset(): void {
    this.samples.length = 0;
    this.gpuSamples.length = 0;
  }

  snapshot(): PerformanceSnapshot {
    const phases = {} as Record<keyof PerformancePhases, PerformanceDistribution>;
    for (const phase of ['camera', 'uniforms', 'labels', 'pickRaycast', 'hoverUi', 'render'] as const) {
      phases[phase] = distribution(this.samples.map((sample) => sample.phases[phase]));
    }
    return {
      sampleCount: this.samples.length,
      frame: distribution(this.samples.map((sample) => sample.frameMs)),
      mainThread: distribution(this.samples.map((sample) => sample.mainThreadMs)),
      phases,
      gpu: this.gpuSamples.length ? distribution(this.gpuSamples) : null,
      gpuSampleCount: this.gpuSamples.length,
      gpuTimingSupported: this.gpuTimingSupported,
      workload: cloneWorkload(this.latestWorkload),
    };
  }
}

export function createEmptyRenderWorkload(labels = 0): RenderWorkload {
  return {
    drawCalls: 0,
    triangles: 0,
    instances: 0,
    labels,
    visibleChunks: { terrain: 0, trees: 0, buildings: 0, roadFurniture: 0, roads: 0, hiddenLinks: 0, waterways: 0, borders: 0 },
    lodInstances: { terrain: [0, 0, 0, 0], trees: [0, 0, 0], buildings: [0, 0, 0] },
    trianglesByCategory: {
      terrain: 0,
      water: 0,
      waterways: 0,
      polarCaps: 0,
      roads: 0,
      hiddenLinks: 0,
      trees: 0,
      buildings: 0,
      roadFurniture: 0,
      borders: 0,
      debugLines: 0,
      labels: 0,
    },
  };
}

function distribution(values: number[]): PerformanceDistribution {
  if (!values.length) return { ...EMPTY_DISTRIBUTION };
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    average: total / values.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maximum: sorted[sorted.length - 1],
  };
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function cloneWorkload(workload: RenderWorkload): RenderWorkload {
  return {
    ...workload,
    visibleChunks: { ...workload.visibleChunks },
    lodInstances: {
      terrain: [...workload.lodInstances.terrain],
      trees: [...workload.lodInstances.trees],
      buildings: [...workload.lodInstances.buildings],
    },
    trianglesByCategory: { ...workload.trianglesByCategory },
  };
}
