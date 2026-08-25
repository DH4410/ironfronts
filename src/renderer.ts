import { vec3 } from 'gl-matrix';
import { StrategyCamera } from './camera';
import { buildCountryColorBuffer, CountryLabelLayer } from './country-overlay';
import { createMaterialTexture, createTreeMaterialTexture } from './material-texture';
import {
  createEmptyRenderWorkload, PerformanceMonitor,
  type PerformancePhases, type PerformanceSnapshot, type RenderCategory, type RenderWorkload,
} from './performance-monitor';
import { createRendererLayouts, createRendererPipelines } from './renderer-pipelines';
import {
  createBarrierMesh, createBuildingArchetypeMesh, createLampMesh, createSignMesh, createTerrainMesh,
  createTreeFamilyMesh, uploadIndexedMesh,
} from './scene-meshes';
import type { Mesh } from './scene-meshes';
import type { BinaryField, CountryRecord, FrameStats, HoverInfo, ProgressReporter, PropChunkRange, ProvinceRecord, WorldManifest } from './types';

interface InstanceLayer {
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

interface PerformanceLayerVisibility {
  terrain: boolean;
  ocean: boolean;
  trees: boolean;
  buildings: boolean;
  roadFurniture: boolean;
  countryTint: boolean;
  countryBorders: boolean;
  countryLabels: boolean;
}

export class WorldRenderer {
  readonly camera = new StrategyCamera();

  manifest!: WorldManifest;
  onHover?: (info: HoverInfo | null, x: number, y: number) => void;
  onStats?: (stats: FrameStats) => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly countryLabelCanvas?: HTMLCanvasElement;
  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture?: GPUTexture;
  private commonLayout!: GPUBindGroupLayout;
  private instanceLayout!: GPUBindGroupLayout;
  private lineLayout!: GPUBindGroupLayout;
  private countryLabelLayout!: GPUBindGroupLayout;
  private commonBindGroup!: GPUBindGroup;
  private uniformBuffer!: GPUBuffer;
  private terrainPipeline!: GPURenderPipeline;
  private waterPipeline!: GPURenderPipeline;
  private waterwayPipeline!: GPURenderPipeline;
  private infrastructurePipeline!: GPURenderPipeline;
  private propPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private countryLabelPipeline!: GPURenderPipeline;
  private countryLabelBuffer?: GPUBuffer;
  private countryLabelBindGroup?: GPUBindGroup;
  private lastCountryLabelRevision = -1;
  private terrainMeshes!: Mesh[];
  private waterMeshes!: Mesh[];
  private roadMesh!: Mesh;
  private hiddenConnectionMesh!: Mesh;
  private waterwayMesh!: Mesh;
  private treeMeshes!: Mesh[][];
  private buildingMeshes!: Mesh[][];
  private lampMesh!: Mesh;
  private barrierMesh!: Mesh;
  private signMesh!: Mesh;
  private trees!: InstanceLayer;
  private buildings!: InstanceLayer;
  private lamps!: InstanceLayer;
  private barriers!: InstanceLayer;
  private signs!: InstanceLayer;
  private borders!: InstanceLayer;
  private connections?: InstanceLayer;
  private waterwayNetwork?: InstanceLayer;
  private heightTexture!: GPUTexture;
  private surfaceTexture!: GPUTexture;
  private terrainAlbedoTexture!: GPUTexture;
  private provinceTexture!: GPUTexture;
  private coastTexture!: GPUTexture;
  private navigationTexture!: GPUTexture;
  private terrainNormalTexture!: GPUTexture;
  private materialTexture!: GPUTexture;
  private treeMaterialTexture!: GPUTexture;
  private provincePoliticalColorTexture!: GPUTexture;
  private provincePoliticalColors!: Uint8Array;
  private politicalOverlayProvinceIds!: Uint16Array;
  private politicalOverlayBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number } | undefined> = [];
  private politicalOverlayWidth = 0;
  private politicalOverlayHeight = 0;
  private countryColors!: Float32Array;
  private visibleTerrainBuffer!: GPUBuffer;
  private terrainLodDraws: Array<{ firstInstance: number; instanceCount: number; lod: number }> = [];
  private lastTerrainVisibilityRevision = -1;
  private heightData!: Float32Array;
  private provinceData!: Uint16Array;
  private provinceOwners!: Uint32Array;
  private borderData!: Float32Array;
  private borderSegmentsByProvince: number[][] = [];
  private provinceById = new Map<number, ProvinceRecord>();
  private countryById = new Map<number, CountryRecord>();
  private countryLabels?: CountryLabelLayer;
  private running = false;
  private frameHandle = 0;
  private previousTime = performance.now();
  private elapsed = 0;
  private performanceMonitor = new PerformanceMonitor(false);
  private frameWorkload = createEmptyRenderWorkload();
  private statsFrameCountdown = 0;
  private gpuQuerySet?: GPUQuerySet;
  private gpuResolveBuffer?: GPUBuffer;
  private gpuReadBuffer?: GPUBuffer;
  private gpuReadPending = false;
  private gpuQueryCountdown = 0;
  private performanceEpoch = 0;
  private debugView = 0;
  private showWireframe = false;
  private showConnections = false;
  private showWaterwayNetwork = false;
  private showBorders = true;
  private showCountryOverlay = true;
  private showProps = true;
  private showRoads = true;
  private showHiddenConnections = true;
  private showWaterways = true;
  private performanceLayers: PerformanceLayerVisibility = {
    terrain: true,
    ocean: true,
    trees: true,
    buildings: true,
    roadFurniture: true,
    countryTint: true,
    countryBorders: true,
    countryLabels: true,
  };
  private pointer = { x: 0, y: 0, inside: false };
  private hoveredId = 0;
  private pickingDirty = false;
  private lastPickedCameraRevision = -1;
  private lastPickTime = -Infinity;
  private readonly pickPoint = vec3.create();
  private resizeObserver?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, countryLabelCanvas?: HTMLCanvasElement) {
    this.canvas = canvas;
    this.countryLabelCanvas = countryLabelCanvas;
  }

  async initialize(report: ProgressReporter): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable');
    report('Loading world manifest', 0.04);
    this.manifest = await fetchJson<WorldManifest>('/world/world.json');
    this.provinceById = new Map(this.manifest.provinces.map((province) => [province.id, province]));
    this.countryById = new Map(this.manifest.politics.countries.map((country) => [country.id, country]));
    this.camera.configureWorld(this.manifest.world.width, this.manifest.world.height);
    this.camera.minimumAltitude = this.manifest.terrain.maxHeight + 82;

    report('Requesting WebGPU device', 0.1);
    this.adapter = (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      ?? await navigator.gpu.requestAdapter()
      ?? await navigator.gpu.requestAdapter({ forceFallbackAdapter: true })) as GPUAdapter;
    if (!this.adapter) throw new Error('No compatible WebGPU adapter was found');
    const gpuTimingSupported = this.adapter.features.has('timestamp-query');
    this.device = await this.adapter.requestDevice({
      requiredFeatures: gpuTimingSupported ? ['timestamp-query'] : [],
    });
    this.performanceMonitor = new PerformanceMonitor(gpuTimingSupported);
    if (gpuTimingSupported) {
      this.gpuQuerySet = this.device.createQuerySet({ type: 'timestamp', count: 2 });
      this.gpuResolveBuffer = this.device.createBuffer({
        label: 'GPU frame timestamp resolve',
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.gpuReadBuffer = this.device.createBuffer({
        label: 'GPU frame timestamp readback',
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    this.device.lost.then((info) => {
      console.error('WebGPU device lost', info);
      if (this.running) window.location.reload();
    });
    this.device.addEventListener('uncapturederror', (event) => {
      const message = event.error instanceof GPUValidationError ? event.error.message : String(event.error);
      console.error(`WebGPU validation error: ${message}`);
    });

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.createLayouts();

    report('Loading terrain fields', 0.2);
    const [heightBuffer, surfaceBuffer, terrainNormalBuffer, terrainAlbedoBuffer, navigationBuffer, coastBuffer, provinceBuffer, roadVertexBuffer, roadIndexBuffer,
      hiddenConnectionVertexBuffer, hiddenConnectionIndexBuffer, waterwayVertexBuffer, waterwayIndexBuffer,
      borderBuffer, treeBuffer, buildingBuffer, lampBuffer, barrierBuffer, signBuffer,
      provinceOwnerData, provinceAdjacencyData, provinceLabelData] = await Promise.all([
      fetchBinary(`/world/${this.manifest.fields.height.url}`),
      fetchBinary(`/world/${this.manifest.fields.surface.url}`),
      fetchBinary(`/world/${this.manifest.fields.terrainNormal.url}`),
      fetchBinary(`/world/${this.manifest.fields.terrainAlbedo.url}`),
      fetchBinary(`/world/${this.manifest.fields.navigation.url}`),
      fetchBinary(`/world/${this.manifest.fields.coast.url}`),
      fetchBinary(`/world/${this.manifest.fields.provinceIds.url}`),
      fetchBinary(`/world/${this.manifest.buffers.roadVertices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.roadIndices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.hiddenConnectionVertices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.hiddenConnectionIndices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.waterwayVertices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.waterwayIndices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.borders.url}`),
      fetchBinary(`/world/${this.manifest.buffers.trees.url}`),
      fetchBinary(`/world/${this.manifest.buffers.buildings.url}`),
      fetchBinary(`/world/${this.manifest.buffers.lamps.url}`),
      fetchBinary(`/world/${this.manifest.buffers.barriers.url}`),
      fetchBinary(`/world/${this.manifest.buffers.signs.url}`),
      fetchBinary(`/world/${this.manifest.politics.owners.url}`),
      fetchBinary(`/world/${this.manifest.politics.adjacency.url}`),
      fetchBinary(`/world/${this.manifest.politics.labelData.url}`),
    ]);
    this.heightData = new Float32Array(heightBuffer);
    this.provinceData = new Uint16Array(provinceBuffer);
    this.provinceOwners = new Uint32Array(provinceOwnerData);
    this.countryColors = buildCountryColorBuffer(this.manifest.politics.countries);
    this.preparePoliticalCaches(borderBuffer);

    report('Uploading terrain fields', 0.37);
    this.heightTexture = this.uploadTexture(
      'terrain height', this.manifest.fields.height.width, this.manifest.fields.height.height,
      'r32float', new Uint8Array(heightBuffer), this.manifest.fields.height.width * 4,
    );
    this.surfaceTexture = this.uploadTexture(
      'terrain surface', this.manifest.fields.surface.width, this.manifest.fields.surface.height,
      'rgba8uint', new Uint8Array(surfaceBuffer), this.manifest.fields.surface.width * 4,
    );
    this.terrainNormalTexture = this.uploadTexture(
      'precomputed terrain normals', this.manifest.fields.terrainNormal.width, this.manifest.fields.terrainNormal.height,
      'rg8snorm', new Uint8Array(terrainNormalBuffer), this.manifest.fields.terrainNormal.width * 2,
    );
    this.terrainAlbedoTexture = this.uploadMipmappedTexture(
      'baked terrain albedo and occlusion', this.manifest.fields.terrainAlbedo, new Uint8Array(terrainAlbedoBuffer),
    );
    this.navigationTexture = this.uploadTexture(
      'packed roads and waterways', this.manifest.fields.navigation.width, this.manifest.fields.navigation.height,
      'rgba8unorm', new Uint8Array(navigationBuffer), this.manifest.fields.navigation.width * 4,
    );
    this.coastTexture = this.uploadTexture(
      'signed-distance bank field', this.manifest.fields.coast.width, this.manifest.fields.coast.height,
      'rg8unorm', new Uint8Array(coastBuffer), this.manifest.fields.coast.width * 2,
    );
    this.provinceTexture = this.uploadTexture(
      'province ids', this.manifest.fields.provinceIds.width, this.manifest.fields.provinceIds.height,
      'r16uint', new Uint8Array(provinceBuffer), this.manifest.fields.provinceIds.width * 2,
    );
    this.provincePoliticalColorTexture = this.uploadTexture(
      'province political colors', this.politicalOverlayWidth, this.politicalOverlayHeight,
      'rgba8unorm', this.provincePoliticalColors, this.politicalOverlayWidth * 4,
    );

    report('Preparing terrain and tree materials', 0.49);
    [this.materialTexture, this.treeMaterialTexture] = await Promise.all([
      createMaterialTexture(this.device),
      createTreeMaterialTexture(this.device),
    ]);
    this.uniformBuffer = this.device.createBuffer({
      label: 'frame uniforms',
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.visibleTerrainBuffer = this.device.createBuffer({
      label: 'visible terrain chunks',
      size: this.manifest.terrain.chunksX * this.manifest.terrain.chunksY * 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.commonBindGroup = this.device.createBindGroup({
      label: 'world resources',
      layout: this.commonLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.heightTexture.createView() },
        { binding: 2, resource: this.surfaceTexture.createView() },
        { binding: 3, resource: this.provinceTexture.createView() },
        { binding: 4, resource: this.materialTexture.createView({ dimension: '2d-array' }) },
        { binding: 5, resource: this.device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }) },
        { binding: 6, resource: this.coastTexture.createView() },
        { binding: 7, resource: this.navigationTexture.createView() },
        { binding: 8, resource: this.terrainNormalTexture.createView() },
        { binding: 9, resource: this.treeMaterialTexture.createView({ dimension: '2d-array' }) },
        { binding: 10, resource: this.provincePoliticalColorTexture.createView() },
        { binding: 12, resource: { buffer: this.visibleTerrainBuffer } },
        { binding: 13, resource: this.terrainAlbedoTexture.createView() },
      ],
    });

    report('Compiling WebGPU pipelines', 0.62);
    this.createPipelines();
    this.terrainMeshes = [this.manifest.terrain.gridResolution, 33, 17, 9]
      .map((resolution) => createTerrainMesh(this.device, resolution, true));
    this.waterMeshes = [33, 25, 17, 9].map((resolution) => createTerrainMesh(this.device, resolution));
    this.roadMesh = uploadIndexedMesh(this.device, 'terrain roads', roadVertexBuffer, roadIndexBuffer, this.manifest.buffers.roadIndices.count);
    this.hiddenConnectionMesh = uploadIndexedMesh(this.device, 'floating hidden connections', hiddenConnectionVertexBuffer,
      hiddenConnectionIndexBuffer, this.manifest.buffers.hiddenConnectionIndices.count);
    this.waterwayMesh = uploadIndexedMesh(this.device, 'supplied rivers and canals', waterwayVertexBuffer,
      waterwayIndexBuffer, this.manifest.buffers.waterwayIndices.count);
    this.treeMeshes = (['broadleaf', 'conifer'] as const).map((family) =>
      [0, 1, 2].map((lod) => createTreeFamilyMesh(this.device, family, lod as 0 | 1 | 2)));
    this.buildingMeshes = Array.from({ length: 5 }, (_, archetype) =>
      [0, 1].map((lod) => createBuildingArchetypeMesh(this.device, archetype, lod as 0 | 1)));
    this.lampMesh = createLampMesh(this.device);
    this.barrierMesh = createBarrierMesh(this.device);
    this.signMesh = createSignMesh(this.device);

    report('Uploading world geometry', 0.78);
    this.trees = this.createInstanceLayer('trees', treeBuffer, this.manifest.buffers.trees.count, 0, this.instanceLayout, true);
    this.buildings = this.createInstanceLayer('buildings', buildingBuffer, this.manifest.buffers.buildings.count, 1, this.instanceLayout, true);
    this.lamps = this.createInstanceLayer('road lamps', lampBuffer, this.manifest.buffers.lamps.count, 2, this.instanceLayout, true);
    this.barriers = this.createInstanceLayer('road barriers', barrierBuffer, this.manifest.buffers.barriers.count, 3, this.instanceLayout, true);
    this.signs = this.createInstanceLayer('road signs', signBuffer, this.manifest.buffers.signs.count, 4, this.instanceLayout, true);
    this.borders = this.createInstanceLayer('borders', borderBuffer, this.manifest.buffers.borders.count, 0, this.lineLayout);
    this.updateBorderVisibility();
    if (this.countryLabelCanvas) {
      this.countryLabels = new CountryLabelLayer(
        this.countryLabelCanvas,
        this.manifest.politics.countries,
        this.provinceOwners,
        new Uint32Array(provinceAdjacencyData),
        new Float32Array(provinceLabelData),
        this.manifest.world.width,
      );
      this.createCountryLabelResources();
    }

    this.camera.attach(this.canvas);
    this.attachInteraction();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    this.camera.update(0);
    report('World ready', 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.camera.detach();
    this.resizeObserver?.disconnect();
  }

  setDebugView(mode: number): void {
    this.debugView = mode;
  }

  setWireframe(enabled: boolean): void {
    this.showWireframe = enabled;
  }

  setBordersVisible(enabled: boolean): void {
    this.showBorders = enabled;
    this.updateBorderVisibility();
  }

  setCountryOverlayVisible(enabled: boolean): void {
    this.showCountryOverlay = enabled;
    this.countryLabels?.setVisible(enabled && this.performanceLayers.countryLabels && this.debugView === 0);
    this.updateBorderVisibility();
  }

  setProvinceOwner(provinceId: number, countryId: number): void {
    this.setProvinceOwners([{ provinceId, countryId }]);
  }

  setProvinceOwners(changes: Array<{ provinceId: number; countryId: number }>): void {
    const ownershipChanges: Array<{ provinceId: number; previousCountryId: number; countryId: number }> = [];
    for (const change of changes) {
      const encodedId = change.provinceId + 1;
      if (encodedId <= 0 || encodedId >= this.provinceOwners.length) throw new Error(`Unknown province ${change.provinceId}`);
      if (!this.countryById.has(change.countryId)) throw new Error(`Unknown country ${change.countryId}`);
      const previousCountryId = this.provinceOwners[encodedId];
      if (previousCountryId === change.countryId) continue;
      this.provinceOwners[encodedId] = change.countryId;
      ownershipChanges.push({ provinceId: encodedId, previousCountryId, countryId: change.countryId });
    }
    this.updatePoliticalCaches(ownershipChanges.map((change) => change.provinceId));
    this.countryLabels?.refreshOwnership(ownershipChanges);
    if (this.hoveredId) this.updateHover(this.hoveredId, true);
  }

  setPropsVisible(enabled: boolean): void { this.showProps = enabled; }

  setRoadsVisible(enabled: boolean): void { this.showRoads = enabled; }

  setHiddenConnectionsVisible(enabled: boolean): void { this.showHiddenConnections = enabled; }

  setWaterwaysVisible(enabled: boolean): void { this.showWaterways = enabled; }

  focus(x: number, z: number, distance = 520, yaw = -0.48, pitch = 0.82): void {
    this.camera.target[0] = wrap(x, this.manifest.world.width);
    this.camera.target[2] = clamp(z, 0, this.manifest.world.height);
    this.camera.distance = clamp(distance, this.camera.minDistance, this.camera.maxDistance);
    this.camera.yaw = yaw;
    this.camera.pitch = pitch;
    this.camera.update(0);
  }

  getPerformanceSnapshot(): PerformanceSnapshot {
    return this.performanceMonitor.snapshot();
  }

  resetPerformanceSamples(): void {
    this.performanceEpoch += 1;
    this.performanceMonitor.reset();
  }

  setPerformanceLayerVisibility(layers: Partial<PerformanceLayerVisibility>): void {
    Object.assign(this.performanceLayers, layers);
    this.updateBorderVisibility();
  }

  async setConnectionsVisible(enabled: boolean): Promise<void> {
    this.showConnections = enabled;
    if (!enabled || this.connections) return;
    const data = await fetchBinary(`/world/${this.manifest.buffers.connections.url}`);
    this.connections = this.createInstanceLayer('movement connections', data, this.manifest.buffers.connections.count, 1, this.lineLayout);
  }

  async setWaterwayNetworkVisible(enabled: boolean): Promise<void> {
    this.showWaterwayNetwork = enabled;
    if (!enabled || this.waterwayNetwork) return;
    const data = await fetchBinary(`/world/${this.manifest.buffers.waterwayNetworkLines.url}`);
    this.waterwayNetwork = this.createInstanceLayer(
      'authoritative waterway network', data, this.manifest.buffers.waterwayNetworkLines.count, 2, this.lineLayout,
    );
  }

  private createLayouts(): void {
    const layouts = createRendererLayouts(this.device);
    this.commonLayout = layouts.common;
    this.instanceLayout = layouts.instances;
    this.lineLayout = layouts.lines;
    this.countryLabelLayout = layouts.countryLabels;
  }

  private createPipelines(): void {
    const pipelines = createRendererPipelines(this.device, this.format, {
      common: this.commonLayout,
      instances: this.instanceLayout,
      lines: this.lineLayout,
      countryLabels: this.countryLabelLayout,
    });
    this.terrainPipeline = pipelines.terrain;
    this.waterPipeline = pipelines.water;
    this.waterwayPipeline = pipelines.waterways;
    this.infrastructurePipeline = pipelines.infrastructure;
    this.propPipeline = pipelines.props;
    this.linePipeline = pipelines.lines;
    this.countryLabelPipeline = pipelines.countryLabels;
  }

  private createCountryLabelResources(): void {
    if (!this.countryLabels) return;
    this.countryLabelBuffer = this.device.createBuffer({
      label: 'country label instances',
      size: Math.max(4, this.manifest.politics.countries.length * 12 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const atlas = this.countryLabels.atlasCanvas;
    const atlasTexture = this.device.createTexture({
      label: 'country label atlas',
      size: [atlas.width, atlas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlas },
      { texture: atlasTexture },
      [atlas.width, atlas.height],
    );
    this.countryLabelBindGroup = this.device.createBindGroup({
      label: 'country label bind group',
      layout: this.countryLabelLayout,
      entries: [
        { binding: 0, resource: { buffer: this.countryLabelBuffer } },
        { binding: 1, resource: atlasTexture.createView() },
        { binding: 2, resource: this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
      ],
    });
  }

  private uploadTexture(label: string, width: number, height: number, format: GPUTextureFormat, bytes: Uint8Array, bytesPerRow: number): GPUTexture {
    const texture = this.device.createTexture({
      label,
      size: [width, height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture },
      bytes.buffer as ArrayBuffer,
      { offset: bytes.byteOffset, bytesPerRow, rowsPerImage: height },
      [width, height],
    );
    return texture;
  }

  private uploadMipmappedTexture(label: string, field: BinaryField, bytes: Uint8Array): GPUTexture {
    const mipLevelCount = field.mipLevelCount ?? 1;
    const texture = this.device.createTexture({
      label,
      size: [field.width, field.height],
      format: field.format as GPUTextureFormat,
      mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    let width = field.width;
    let height = field.height;
    let offset = 0;
    for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel += 1) {
      const byteLength = width * height * 4;
      this.device.queue.writeTexture(
        { texture, mipLevel },
        bytes.buffer as ArrayBuffer,
        { offset: bytes.byteOffset + offset, bytesPerRow: width * 4, rowsPerImage: height },
        [width, height],
      );
      offset += byteLength;
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
    if (offset !== bytes.byteLength) throw new Error(`${label} mip data size mismatch: used ${offset}, received ${bytes.byteLength}`);
    return texture;
  }

  private createStorageBuffer(label: string, data: ArrayBufferView): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: align4(data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  private preparePoliticalCaches(borderBuffer: ArrayBuffer): void {
    this.politicalOverlayWidth = this.manifest.fields.terrainAlbedo.width;
    this.politicalOverlayHeight = this.manifest.fields.terrainAlbedo.height;
    this.provincePoliticalColors = new Uint8Array(this.politicalOverlayWidth * this.politicalOverlayHeight * 4);
    this.politicalOverlayProvinceIds = new Uint16Array(this.politicalOverlayWidth * this.politicalOverlayHeight);
    this.politicalOverlayBounds = new Array(this.provinceOwners.length);
    const sourceWidth = this.manifest.fields.provinceIds.width;
    const sourceHeight = this.manifest.fields.provinceIds.height;
    for (let y = 0; y < this.politicalOverlayHeight; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / this.politicalOverlayHeight));
      for (let x = 0; x < this.politicalOverlayWidth; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / this.politicalOverlayWidth));
        const index = y * this.politicalOverlayWidth + x;
        const provinceId = this.provinceData[sourceY * sourceWidth + sourceX] ?? 0;
        this.politicalOverlayProvinceIds[index] = provinceId;
        if (provinceId > 0) {
          const bounds = this.politicalOverlayBounds[provinceId];
          if (bounds) {
            bounds.minX = Math.min(bounds.minX, x);
            bounds.minY = Math.min(bounds.minY, y);
            bounds.maxX = Math.max(bounds.maxX, x);
            bounds.maxY = Math.max(bounds.maxY, y);
          } else {
            this.politicalOverlayBounds[provinceId] = { minX: x, minY: y, maxX: x, maxY: y };
          }
        }
        this.writePoliticalOverlayPixel(index, provinceId);
      }
    }
    this.borderData = new Float32Array(borderBuffer);
    this.borderSegmentsByProvince = Array.from({ length: this.provinceOwners.length }, () => [] as number[]);
    for (let segment = 0; segment < this.manifest.buffers.borders.count; segment += 1) {
      const offset = segment * 8;
      const provinceA = Math.round(this.borderData[offset + 4]);
      const provinceB = Math.round(this.borderData[offset + 5]);
      if (provinceA < this.borderSegmentsByProvince.length) this.borderSegmentsByProvince[provinceA].push(segment);
      if (provinceB > 0 && provinceB < this.borderSegmentsByProvince.length) this.borderSegmentsByProvince[provinceB].push(segment);
      const heightAndFlag = Math.abs(this.borderData[offset + 6]);
      this.borderData[offset + 6] = this.provinceOwners[provinceA] !== this.provinceOwners[provinceB]
        ? -heightAndFlag : heightAndFlag;
    }
  }

  private writePoliticalOverlayPixel(index: number, provinceId: number): void {
    const owner = this.provinceOwners[provinceId];
    const target = index * 4;
    if (!owner) {
      this.provincePoliticalColors.fill(0, target, target + 4);
      return;
    }
    const source = owner * 4;
    this.provincePoliticalColors[target] = Math.round(this.countryColors[source] * 255);
    this.provincePoliticalColors[target + 1] = Math.round(this.countryColors[source + 1] * 255);
    this.provincePoliticalColors[target + 2] = Math.round(this.countryColors[source + 2] * 255);
    this.provincePoliticalColors[target + 3] = 255;
  }

  private updatePoliticalCaches(provinceIds: number[]): void {
    if (!provinceIds.length) return;
    const affectedSegments = new Set<number>();
    for (const provinceId of provinceIds) {
      const bounds = this.politicalOverlayBounds[provinceId];
      if (bounds) {
        for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
          for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
            const index = y * this.politicalOverlayWidth + x;
            if (this.politicalOverlayProvinceIds[index] === provinceId) this.writePoliticalOverlayPixel(index, provinceId);
          }
        }
        this.device.queue.writeTexture(
          { texture: this.provincePoliticalColorTexture, origin: [bounds.minX, bounds.minY] },
          this.provincePoliticalColors.buffer as ArrayBuffer,
          {
            offset: this.provincePoliticalColors.byteOffset
              + (bounds.minY * this.politicalOverlayWidth + bounds.minX) * 4,
            bytesPerRow: this.politicalOverlayWidth * 4,
            rowsPerImage: this.politicalOverlayHeight,
          },
          [bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1],
        );
      }
      for (const segment of this.borderSegmentsByProvince[provinceId] ?? []) affectedSegments.add(segment);
    }
    const sortedSegments = [...affectedSegments].sort((a, b) => a - b);
    for (const segment of sortedSegments) {
      const offset = segment * 8;
      const provinceA = Math.round(this.borderData[offset + 4]);
      const provinceB = Math.round(this.borderData[offset + 5]);
      const heightAndFlag = Math.abs(this.borderData[offset + 6]);
      this.borderData[offset + 6] = this.provinceOwners[provinceA] !== this.provinceOwners[provinceB]
        ? -heightAndFlag : heightAndFlag;
    }
    let start = 0;
    while (start < sortedSegments.length) {
      let end = start + 1;
      while (end < sortedSegments.length && sortedSegments[end] === sortedSegments[end - 1] + 1) end += 1;
      const firstSegment = sortedSegments[start];
      const segmentCount = sortedSegments[end - 1] - firstSegment + 1;
      this.device.queue.writeBuffer(
        this.borders.buffer,
        firstSegment * 8 * 4,
        this.borderData.buffer as ArrayBuffer,
        this.borderData.byteOffset + firstSegment * 8 * 4,
        segmentCount * 8 * 4,
      );
      start = end;
    }
  }

  private updateBorderVisibility(): void {
    if (!this.borders) return;
    const flags = (this.showBorders ? 1 : 0)
      | (this.showCountryOverlay && this.performanceLayers.countryBorders ? 2 : 0);
    this.device.queue.writeBuffer(this.borders.params, 8, new Uint32Array([flags]));
  }

  private createInstanceLayer(
    label: string, data: ArrayBuffer, count: number, kind: number, layout: GPUBindGroupLayout, mappedInstances = false,
  ): InstanceLayer {
    const buffer = this.device.createBuffer({
      label: `${label} records`,
      size: align4(data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    const params = this.device.createBuffer({ label: `${label} params`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([count, kind, 1, 0]));
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: params } }];
    let views: InstanceLayer['views'];
    if (mappedInstances) {
      const identityBuffer = this.device.createBuffer({
        label: `${label} identity instances`, size: Math.max(4, count * 3 * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const identity = new Uint32Array(count * 3);
      for (let index = 0; index < identity.length; index += 1) identity[index] = index;
      this.device.queue.writeBuffer(identityBuffer, 0, identity);
      entries.push({ binding: 2, resource: { buffer: identityBuffer } });
      views = new Map();
    }
    const bindGroup = this.device.createBindGroup({
      label: `${label} bind group`,
      layout,
      entries,
    });
    return { buffer, params, bindGroup, count, views };
  }

  private attachInteraction(): void {
    this.canvas.addEventListener('pointermove', (event) => {
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.inside = true;
      this.pickingDirty = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
      this.pickingDirty = false;
      this.updateHover(0);
    });
  }

  private resize(): void {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: 'main depth',
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.camera.resize(width, height);
  }

  private frame = (time: number): void => {
    if (!this.running) return;
    const frameStarted = performance.now();
    const frameMs = Math.max(0, time - this.previousTime);
    const deltaMs = Math.min(50, frameMs);
    this.previousTime = time;
    this.elapsed += deltaMs / 1000;

    let phaseStarted = performance.now();
    this.camera.update(deltaMs / 1000);
    this.resize();
    this.updateVisibleTerrainChunks();
    const cameraMs = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    this.updateUniforms();
    const uniformsMs = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    this.countryLabels?.setVisible(this.showCountryOverlay && this.performanceLayers.countryLabels && this.debugView === 0);
    const visibleLabels = this.countryLabels?.update(
      this.camera.viewProjection,
      this.canvas.width,
      this.canvas.height,
      (x, z) => this.sampleHeight(x, z),
      this.camera.revision,
    ) ?? 0;
    if (this.countryLabels
      && this.countryLabelBuffer
      && this.countryLabels.renderRevision !== this.lastCountryLabelRevision) {
      const data = this.countryLabels.renderData;
      if (data.byteLength) {
        this.device.queue.writeBuffer(
          this.countryLabelBuffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength,
        );
      }
      this.lastCountryLabelRevision = this.countryLabels.renderRevision;
    }
    const labelsMs = performance.now() - phaseStarted;

    let pickRaycastMs = 0;
    let hoverUiMs = 0;
    if (this.pointer.inside && this.lastPickedCameraRevision !== this.camera.revision) this.pickingDirty = true;
    if (this.pointer.inside && this.pickingDirty && time - this.lastPickTime >= 32) {
      const picking = this.pickProvince(this.pointer.x, this.pointer.y);
      pickRaycastMs = picking.raycastMs;
      hoverUiMs = picking.hoverUiMs;
      this.pickingDirty = false;
      this.lastPickTime = time;
      this.lastPickedCameraRevision = this.camera.revision;
    }

    phaseStarted = performance.now();
    this.render(visibleLabels);
    const renderMs = performance.now() - phaseStarted;
    const phases: PerformancePhases = {
      camera: cameraMs,
      uniforms: uniformsMs,
      labels: labelsMs,
      pickRaycast: pickRaycastMs,
      hoverUi: hoverUiMs,
      render: renderMs,
    };
    this.performanceMonitor.record({ frameMs, mainThreadMs: performance.now() - frameStarted, phases }, this.frameWorkload);
    this.updateStats();
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private updateUniforms(): void {
    const values = new Float32Array(64);
    values.set(this.camera.viewProjection, 0);
    values.set(this.camera.inverseViewProjection, 16);
    values.set([this.camera.position[0], this.camera.position[1], this.camera.position[2], 1], 32);
    values.set([0.42, 0.83, 0.36, this.elapsed], 36);
    values.set([this.canvas.width, this.canvas.height, 1 / this.canvas.width, 1 / this.canvas.height], 40);
    values.set([this.manifest.world.width, this.manifest.world.height, this.manifest.terrain.maxHeight, this.debugView], 44);
    values.set([this.hoveredId, this.camera.distance, this.showCountryOverlay && this.performanceLayers.countryTint ? 1 : 0, 0], 48);
    values.set([this.manifest.terrain.chunksX, this.manifest.terrain.chunksY, this.manifest.terrain.gridResolution, this.showWireframe ? 1 : 0], 52);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  private render(visibleLabels: number): void {
    if (!this.depthTexture) return;
    this.frameWorkload = createEmptyRenderWorkload(visibleLabels);
    const encoder = this.device.createCommandEncoder({ label: 'world frame' });
    const collectGpuTiming = Boolean(this.gpuQuerySet && this.gpuResolveBuffer && this.gpuReadBuffer)
      && !this.gpuReadPending && this.gpuQueryCountdown++ % 4 === 0;
    const gpuTimingEpoch = this.performanceEpoch;
    const passDescriptor: GPURenderPassDescriptor = {
      label: 'world render pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.45, g: 0.57, b: 0.61, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };
    if (collectGpuTiming && this.gpuQuerySet) {
      passDescriptor.timestampWrites = {
        querySet: this.gpuQuerySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      };
    }
    const pass = encoder.beginRenderPass(passDescriptor);

    pass.setBindGroup(0, this.commonBindGroup);
    this.frameWorkload.visibleChunks.terrain = this.terrainLodDraws.reduce((sum, draw) => sum + draw.instanceCount, 0);
    for (const draw of this.terrainLodDraws) this.frameWorkload.lodInstances.terrain[draw.lod] += draw.instanceCount;
    if (this.performanceLayers.ocean) {
      pass.setPipeline(this.waterPipeline);
      for (const draw of this.terrainLodDraws) {
        const mesh = this.waterMeshes[draw.lod];
        pass.setVertexBuffer(0, mesh.vertex);
        pass.setIndexBuffer(mesh.index, 'uint16');
        pass.drawIndexed(mesh.indexCount, draw.instanceCount, 0, 0, draw.firstInstance);
        this.recordIndexedDraw('water', mesh.indexCount, draw.instanceCount);
      }
    }

    if (this.performanceLayers.terrain) {
      pass.setPipeline(this.terrainPipeline);
      for (const draw of this.terrainLodDraws) {
        const mesh = this.terrainMeshes[draw.lod];
        pass.setVertexBuffer(0, mesh.vertex);
        pass.setIndexBuffer(mesh.index, 'uint16');
        pass.drawIndexed(mesh.indexCount, draw.instanceCount, 0, 0, draw.firstInstance);
        this.recordIndexedDraw('terrain', mesh.indexCount, draw.instanceCount);
      }
    }

    if (this.showWaterways) {
      pass.setPipeline(this.waterwayPipeline);
      pass.setVertexBuffer(0, this.waterwayMesh.vertex);
      pass.setIndexBuffer(this.waterwayMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.waterwayMesh, this.manifest.infrastructureChunks.waterways, 'waterways', 9_200);
    }

    if (this.showRoads || this.showHiddenConnections) pass.setPipeline(this.infrastructurePipeline);
    if (this.showRoads) {
      pass.setVertexBuffer(0, this.roadMesh.vertex);
      pass.setIndexBuffer(this.roadMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.roadMesh, this.manifest.infrastructureChunks.roads, 'roads');
    }
    if (this.showHiddenConnections) {
      pass.setVertexBuffer(0, this.hiddenConnectionMesh.vertex);
      pass.setIndexBuffer(this.hiddenConnectionMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.hiddenConnectionMesh, this.manifest.infrastructureChunks.hiddenConnections, 'hiddenLinks', 8_000);
    }

    if (this.showProps) {
      pass.setPipeline(this.propPipeline);
      if (this.performanceLayers.trees) {
        this.drawPropChunks(pass, this.trees, this.manifest.propChunks.trees, this.treeMeshes, 'trees', 3_200, [900, 1_850]);
      }
      if (this.performanceLayers.buildings) {
        this.drawPropChunks(pass, this.buildings, this.manifest.propChunks.buildings, this.buildingMeshes, 'buildings', 2_600, [850, 1_650]);
      }
      if (this.performanceLayers.roadFurniture) {
        this.drawPropChunks(pass, this.lamps, this.manifest.propChunks.lamps, [[this.lampMesh]], 'roadFurniture', 1_900, [1_900, 1_900]);
        this.drawPropChunks(pass, this.barriers, this.manifest.propChunks.barriers, [[this.barrierMesh]], 'roadFurniture', 1_900, [1_900, 1_900]);
        this.drawPropChunks(pass, this.signs, this.manifest.propChunks.signs, [[this.signMesh]], 'roadFurniture', 1_900, [1_900, 1_900]);
      }
    }

    pass.setPipeline(this.linePipeline);
    if (this.showBorders || (this.showCountryOverlay && this.performanceLayers.countryBorders)) {
      pass.setBindGroup(1, this.borders.bindGroup);
      this.drawChunkedLines(pass, this.borders, this.manifest.borderChunks.ranges, 'borders');
    }
    if (this.showConnections && this.connections) {
      pass.setBindGroup(1, this.connections.bindGroup);
      const copies = this.visibleWorldCopies();
      const instances = this.connections.count * copies.length;
      pass.draw(6, instances, 0, copies[0] * this.connections.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    if (this.showWaterwayNetwork && this.waterwayNetwork) {
      pass.setBindGroup(1, this.waterwayNetwork.bindGroup);
      const copies = this.visibleWorldCopies();
      const instances = this.waterwayNetwork.count * copies.length;
      pass.draw(6, instances, 0, copies[0] * this.waterwayNetwork.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    if (visibleLabels > 0 && this.countryLabelBindGroup) {
      pass.setPipeline(this.countryLabelPipeline);
      pass.setBindGroup(1, this.countryLabelBindGroup);
      pass.draw(6, visibleLabels);
      this.recordTriangleDraw('labels', visibleLabels * 2, visibleLabels);
    }
    pass.end();
    if (collectGpuTiming && this.gpuQuerySet && this.gpuResolveBuffer && this.gpuReadBuffer) {
      encoder.resolveQuerySet(this.gpuQuerySet, 0, 2, this.gpuResolveBuffer, 0);
      encoder.copyBufferToBuffer(this.gpuResolveBuffer, 0, this.gpuReadBuffer, 0, 16);
    }
    this.device.queue.submit([encoder.finish()]);
    if (collectGpuTiming) this.readGpuTiming(gpuTimingEpoch);
  }

  private drawPropChunks(
    pass: GPURenderPassEncoder,
    layer: InstanceLayer,
    ranges: PropChunkRange[],
    groupMeshes: Mesh[][],
    category: RenderCategory,
    maximumDistance: number,
    lodDistances: [number, number],
  ): void {
    if (this.camera.position[1] > maximumDistance * 1.15) return;
    if (!layer.views) throw new Error(`Missing visible-instance storage for ${category}`);
    const viewKey = String(category);
    let view = layer.views.get(viewKey);
    if (!view) {
      const buffer = this.device.createBuffer({
        label: `${category} visible instances`, size: Math.max(4, layer.count * 3 * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = this.device.createBindGroup({
        label: `${category} visible bind group`, layout: this.instanceLayout,
        entries: [
          { binding: 0, resource: { buffer: layer.buffer } },
          { binding: 1, resource: { buffer: layer.params } },
          { binding: 2, resource: { buffer } },
        ],
      });
      view = { buffer, bindGroup, revision: -1, draws: [], visibleChunks: 0 };
      layer.views.set(viewKey, view);
    }
    if (view.revision !== this.camera.revision) {
      const chunksX = this.manifest.propChunks.chunksX;
      const chunksY = this.manifest.propChunks.chunksY;
      const chunkWidth = this.manifest.world.width / chunksX;
      const chunkHeight = this.manifest.world.height / chunksY;
      const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.55;
      const buckets = groupMeshes.map((meshes) => meshes.map(() => [] as number[]));
      view.visibleChunks = 0;
      for (const copy of this.visibleWorldCopies(maximumDistance + chunkRadius)) {
        const copyOffset = (copy - 1) * this.manifest.world.width;
        for (let chunkIndex = 0; chunkIndex < ranges.length; chunkIndex += 1) {
          const range = ranges[chunkIndex];
          if (!range?.instanceCount) continue;
          const centerX = (chunkIndex % chunksX + 0.5) * chunkWidth + copyOffset;
          const centerZ = (Math.floor(chunkIndex / chunksX) + 0.5) * chunkHeight;
          const distance = Math.hypot(centerX - this.camera.position[0], centerZ - this.camera.position[2], this.camera.position[1]);
          if (distance > maximumDistance + chunkRadius) continue;
          if (!this.chunkIntersectsView(centerX, centerZ, chunkRadius)) continue;
          view.visibleChunks += 1;
          const lod = distance < lodDistances[0] ? 0 : distance < lodDistances[1] ? 1 : 2;
          const groups = groupMeshes.length === 1 ? [range] : range.groups;
          for (let group = 0; group < groups.length; group += 1) {
            const groupRange = groups[group];
            if (!groupRange?.instanceCount) continue;
            const meshGroup = Math.min(group, groupMeshes.length - 1);
            const meshLod = Math.min(lod, groupMeshes[meshGroup].length - 1);
            const bucket = buckets[meshGroup][meshLod];
            for (let index = 0; index < groupRange.instanceCount; index += 1) {
              bucket.push(copy * layer.count + groupRange.firstInstance + index);
            }
          }
        }
      }
      const count = buckets.flat(2).length;
      const visibleInstances = new Uint32Array(count);
      view.draws = [];
      let cursor = 0;
      for (let group = 0; group < buckets.length; group += 1) {
        for (let lod = 0; lod < buckets[group].length; lod += 1) {
          const bucket = buckets[group][lod];
          if (!bucket.length) continue;
          visibleInstances.set(bucket, cursor);
          view.draws.push({ mesh: groupMeshes[group][lod], firstInstance: cursor, instanceCount: bucket.length, lod });
          cursor += bucket.length;
        }
      }
      if (visibleInstances.length) this.device.queue.writeBuffer(view.buffer, 0, visibleInstances);
      view.revision = this.camera.revision;
    }
    if (category === 'trees') this.frameWorkload.visibleChunks.trees += view.visibleChunks;
    else if (category === 'buildings') this.frameWorkload.visibleChunks.buildings += view.visibleChunks;
    else if (category === 'roadFurniture') this.frameWorkload.visibleChunks.roadFurniture += view.visibleChunks;
    pass.setBindGroup(1, view.bindGroup);
    for (const draw of view.draws) {
      pass.setVertexBuffer(0, draw.mesh.vertex);
      pass.setIndexBuffer(draw.mesh.index, 'uint16');
      pass.drawIndexed(draw.mesh.indexCount, draw.instanceCount, 0, 0, draw.firstInstance);
      this.recordIndexedDraw(category, draw.mesh.indexCount, draw.instanceCount);
      if (category === 'trees') this.frameWorkload.lodInstances.trees[draw.lod] += draw.instanceCount;
      else if (category === 'buildings') this.frameWorkload.lodInstances.buildings[draw.lod] += draw.instanceCount;
    }
  }

  private visibleWorldCopies(edgeRange = this.camera.distance * 0.72 + 420): number[] {
    const clampedRange = Math.min(this.manifest.world.width * 0.48, edgeRange);
    if (this.camera.target[0] < clampedRange) return [0, 1];
    if (this.camera.target[0] > this.manifest.world.width - clampedRange) return [1, 2];
    return [1];
  }

  private chunkIntersectsView(centerX: number, centerZ: number, radius: number): boolean {
    const centerY = this.sampleHeight(centerX, centerZ);
    const matrix = this.camera.viewProjection;
    const clipX = matrix[0] * centerX + matrix[4] * centerY + matrix[8] * centerZ + matrix[12];
    const clipY = matrix[1] * centerX + matrix[5] * centerY + matrix[9] * centerZ + matrix[13];
    const clipW = matrix[3] * centerX + matrix[7] * centerY + matrix[11] * centerZ + matrix[15];
    if (clipW <= 1) return false;
    const distance = Math.hypot(
      centerX - this.camera.position[0], centerY - this.camera.position[1], centerZ - this.camera.position[2],
    );
    const margin = Math.min(1.5, radius * 2.8 / Math.max(1, distance));
    return Math.abs(clipX / clipW) <= 1 + margin && Math.abs(clipY / clipW) <= 1 + margin;
  }

  private updateVisibleTerrainChunks(): void {
    if (this.lastTerrainVisibilityRevision === this.camera.revision) return;
    this.lastTerrainVisibilityRevision = this.camera.revision;
    const chunksX = this.manifest.terrain.chunksX;
    const chunksY = this.manifest.terrain.chunksY;
    const chunksPerWorld = chunksX * chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.72;
    const lodEntries: number[][] = [[], [], [], []];
    for (const copy of this.visibleWorldCopies(this.camera.distance * 0.9 + chunkRadius)) {
      const copyOffset = (copy - 1) * this.manifest.world.width;
      for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
        for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
          const centerX = (chunkX + 0.5) * chunkWidth + copyOffset;
          const centerZ = (chunkY + 0.5) * chunkHeight;
          const centerY = this.sampleHeight(centerX, centerZ);
          const distance = Math.hypot(
            centerX - this.camera.position[0], centerY - this.camera.position[1], centerZ - this.camera.position[2],
          );
          if (!this.chunkIntersectsView(centerX, centerZ, chunkRadius)) continue;
          const lod = distance < 1_050 ? 0 : distance < 2_350 ? 1 : distance < 5_000 ? 2 : 3;
          lodEntries[lod].push(copy * chunksPerWorld + chunkY * chunksX + chunkX);
        }
      }
    }
    const flattened = new Uint32Array(lodEntries.reduce((sum, entries) => sum + entries.length, 0));
    this.terrainLodDraws = [];
    let cursor = 0;
    for (let lod = 0; lod < lodEntries.length; lod += 1) {
      const entries = lodEntries[lod];
      if (entries.length) {
        flattened.set(entries, cursor);
        this.terrainLodDraws.push({ firstInstance: cursor, instanceCount: entries.length, lod });
        cursor += entries.length;
      }
    }
    if (flattened.length) this.device.queue.writeBuffer(this.visibleTerrainBuffer, 0, flattened);
  }

  private drawChunkedInfrastructure(
    pass: GPURenderPassEncoder,
    mesh: Mesh,
    ranges: Array<{ firstIndex: number; indexCount: number }>,
    category: 'roads' | 'hiddenLinks' | 'waterways',
    maximumDistance = 4_000,
  ): void {
    if (this.camera.distance >= maximumDistance) return;
    const chunksX = this.manifest.infrastructureChunks.chunksX;
    const chunksY = this.manifest.infrastructureChunks.chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const radius = clamp(this.camera.distance * 1.48 + 720, 940, maximumDistance + 300);
    const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.6;
    const copies = this.visibleWorldCopies(radius + chunkRadius);
    for (const copy of copies) {
      const visibleRanges: Array<{ firstIndex: number; indexCount: number }> = [];
      for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
        for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
          const range = ranges[chunkY * chunksX + chunkX];
          if (!range?.indexCount) continue;
          const centerX = (chunkX + 0.5) * chunkWidth + (copy - 1) * this.manifest.world.width;
          const centerZ = (chunkY + 0.5) * chunkHeight;
          if (Math.hypot(centerX - this.camera.target[0], centerZ - this.camera.target[2]) > radius + chunkRadius) continue;
          if (!this.chunkIntersectsView(centerX, centerZ, chunkRadius)) continue;
          visibleRanges.push(range);
          this.frameWorkload.visibleChunks[category] += 1;
        }
      }
      visibleRanges.sort((a, b) => a.firstIndex - b.firstIndex);
      let merged: { firstIndex: number; indexCount: number } | undefined;
      for (const range of visibleRanges) {
        if (merged && merged.firstIndex + merged.indexCount === range.firstIndex) {
          merged.indexCount += range.indexCount;
          continue;
        }
        if (merged) {
          pass.drawIndexed(merged.indexCount, 1, merged.firstIndex, 0, copy);
          this.recordIndexedDraw(category, merged.indexCount, 1);
        }
        merged = { ...range };
      }
      if (merged) {
        pass.drawIndexed(merged.indexCount, 1, merged.firstIndex, 0, copy);
        this.recordIndexedDraw(category, merged.indexCount, 1);
      }
    }
  }

  private drawChunkedLines(
    pass: GPURenderPassEncoder,
    layer: InstanceLayer,
    ranges: Array<{ firstInstance: number; instanceCount: number }>,
    category: 'borders',
  ): void {
    const chunksX = this.manifest.borderChunks.chunksX;
    const chunksY = this.manifest.borderChunks.chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.62;
    for (const copy of this.visibleWorldCopies(this.camera.distance * 0.9 + chunkRadius)) {
      const copyOffset = (copy - 1) * this.manifest.world.width;
      const visibleRanges: Array<{ firstInstance: number; instanceCount: number }> = [];
      for (let chunkIndex = 0; chunkIndex < ranges.length; chunkIndex += 1) {
        const range = ranges[chunkIndex];
        if (!range?.instanceCount) continue;
        const centerX = (chunkIndex % chunksX + 0.5) * chunkWidth + copyOffset;
        const centerZ = (Math.floor(chunkIndex / chunksX) + 0.5) * chunkHeight;
        if (!this.chunkIntersectsView(centerX, centerZ, chunkRadius)) continue;
        visibleRanges.push(range);
        this.frameWorkload.visibleChunks.borders += 1;
      }
      visibleRanges.sort((a, b) => a.firstInstance - b.firstInstance);
      let merged: { firstInstance: number; instanceCount: number } | undefined;
      for (const range of visibleRanges) {
        if (merged && merged.firstInstance + merged.instanceCount === range.firstInstance) {
          merged.instanceCount += range.instanceCount;
          continue;
        }
        if (merged) {
          pass.draw(6, merged.instanceCount, 0, copy * layer.count + merged.firstInstance);
          this.recordTriangleDraw(category, merged.instanceCount * 2, merged.instanceCount);
        }
        merged = { ...range };
      }
      if (merged) {
        pass.draw(6, merged.instanceCount, 0, copy * layer.count + merged.firstInstance);
        this.recordTriangleDraw(category, merged.instanceCount * 2, merged.instanceCount);
      }
    }
  }

  private recordIndexedDraw(category: RenderCategory, indexCount: number, instances: number): void {
    this.recordTriangleDraw(category, Math.floor(indexCount / 3) * instances, instances);
  }

  private recordTriangleDraw(category: RenderCategory, triangles: number, instances: number): void {
    this.frameWorkload.drawCalls += 1;
    this.frameWorkload.triangles += triangles;
    this.frameWorkload.instances += instances;
    this.frameWorkload.trianglesByCategory[category] += triangles;
  }

  private readGpuTiming(epoch: number): void {
    if (!this.gpuReadBuffer || this.gpuReadPending) return;
    this.gpuReadPending = true;
    void this.gpuReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
      if (!this.gpuReadBuffer) return;
      const timestamps = new BigUint64Array(this.gpuReadBuffer.getMappedRange());
      const elapsedNanoseconds = timestamps[1] - timestamps[0];
      if (epoch === this.performanceEpoch) this.performanceMonitor.recordGpu(Number(elapsedNanoseconds) / 1_000_000);
      this.gpuReadBuffer.unmap();
    }).catch((error) => {
      console.warn('GPU timestamp readback failed', error);
      if (this.gpuReadBuffer?.mapState === 'mapped') this.gpuReadBuffer.unmap();
    }).finally(() => {
      this.gpuReadPending = false;
    });
  }

  private pickProvince(clientX: number, clientY: number): { raycastMs: number; hoverUiMs: number } {
    const started = performance.now();
    const ray = this.camera.screenRay(clientX, clientY);
    if (ray.direction[1] >= -0.0001) {
      return this.finishPicking(0, started);
    }
    const topY = this.manifest.terrain.maxHeight + 12;
    let low = Math.max(0, (topY - ray.origin[1]) / ray.direction[1]);
    let high = Math.max(0, (-2 - ray.origin[1]) / ray.direction[1]);
    if (high < low) [low, high] = [high, low];
    const point = this.pickPoint;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const distance = (low + high) * 0.5;
      vec3.scaleAndAdd(point, ray.origin, ray.direction, distance);
      const height = this.sampleHeight(point[0], point[2]);
      if (point[1] > height) low = distance;
      else high = distance;
    }
    vec3.scaleAndAdd(point, ray.origin, ray.direction, (low + high) * 0.5);
    if (point[2] < 0 || point[2] >= this.manifest.world.height) {
      return this.finishPicking(0, started);
    }
    const id = this.sampleProvince(point[0], point[2]);
    return this.finishPicking(id, started);
  }

  private finishPicking(encodedId: number, started: number): { raycastMs: number; hoverUiMs: number } {
    const raycastMs = performance.now() - started;
    const hoverStarted = performance.now();
    this.updateHover(encodedId);
    return { raycastMs, hoverUiMs: performance.now() - hoverStarted };
  }

  private sampleHeight(worldX: number, worldZ: number): number {
    const field = this.manifest.fields.height;
    const x = wrap(Math.floor(worldX / this.manifest.world.width * field.width), field.width);
    const y = clamp(Math.floor(worldZ / this.manifest.world.height * field.height), 0, field.height - 1);
    return this.heightData[y * field.width + x] ?? 0;
  }

  private sampleProvince(worldX: number, worldZ: number): number {
    const field = this.manifest.fields.provinceIds;
    const x = wrap(Math.floor(worldX / this.manifest.world.width * field.width), field.width);
    const y = clamp(Math.floor(worldZ / this.manifest.world.height * field.height), 0, field.height - 1);
    return this.provinceData[y * field.width + x] ?? 0;
  }

  private updateHover(encodedId: number, force = false): void {
    if (encodedId === this.hoveredId && !force) {
      if (encodedId !== 0) this.onHover?.(this.toHoverInfo(encodedId), this.pointer.x, this.pointer.y);
      return;
    }
    this.hoveredId = encodedId;
    this.onHover?.(encodedId === 0 ? null : this.toHoverInfo(encodedId), this.pointer.x, this.pointer.y);
  }

  private toHoverInfo(encodedId: number): HoverInfo | null {
    const province = this.provinceById.get(encodedId - 1);
    if (!province) return null;
    const country = this.countryById.get(this.provinceOwners[encodedId]);
    return {
      id: province.id,
      name: province.name,
      terrain: province.terrain,
      country: country?.name ?? 'Unassigned',
      countryColor: country?.color ?? '#808080',
    };
  }

  private updateStats(): void {
    if (!this.onStats) {
      this.statsFrameCountdown = 0;
      return;
    }
    if (++this.statsFrameCountdown < 20) return;
    this.statsFrameCountdown = 0;
    const performance = this.performanceMonitor.snapshot();
    this.onStats?.({
      fps: performance.frame.average > 0 ? 1000 / performance.frame.average : 0,
      frameMs: performance.frame.average,
      camera: [this.camera.target[0], this.camera.target[2], this.camera.position[1]],
      distance: this.camera.distance,
      hoveredProvince: this.hoveredId ? this.hoveredId - 1 : null,
      trees: this.trees.count,
      buildings: this.buildings.count,
      borderEdges: this.borders.count,
      emittedRoads: this.manifest.counts.emittedRoads,
      hiddenRoads: this.manifest.counts.hiddenRoads,
      riverSystems: this.manifest.counts.riverSystems,
      riverSegments: this.manifest.counts.riverSegments,
      canalSegments: this.manifest.counts.canalSegments,
      targetElevation: this.sampleHeight(this.camera.target[0], this.camera.target[2]),
      targetProvince: (() => {
        const encoded = this.sampleProvince(this.camera.target[0], this.camera.target[2]);
        return encoded ? encoded - 1 : null;
      })(),
      performance,
    });
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.arrayBuffer();
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}
