import { vec3 } from 'gl-matrix';
import { StrategyCamera } from './camera';
import { buildPropVisibility, buildTerrainVisibility } from './chunk-visibility';
import { buildCountryColorBuffer, CountryLabelLayer } from './country-overlay';
import { loadCountryLabelFont } from './country-labels/atlas';
import { isValidCountryLabelPoint } from './country-labels/territory';
import { buildDiplomacyColorData, findCountryByName } from './diplomacy';
import { align4, fetchBinary, fetchJson, uploadMipmappedTexture, uploadTexture } from './gpu-utils';
import { createMaterialTexture, createTreeMaterialTexture } from './material-texture';
import {
  createEmptyRenderWorkload, PerformanceMonitor,
  type PerformancePhases, type PerformanceSnapshot, type RenderCategory,
} from './performance-monitor';
import { createHoverInfo, pickTerrainPoint } from './picking';
import { PoliticalCache } from './political-cache';
import { createRendererLayouts, createRendererPipelines } from './renderer-pipelines';
import { beginWorldFrame, submitWorldFrame } from './renderer-frame';
import type { InstanceLayer, PerformanceLayerVisibility } from './renderer-types';
import { COUNTRY_LABEL_FADE_END_ALTITUDE } from './shaders/country-labels';
import {
  createBarrierMesh, createBuildingArchetypeMesh, createLampMesh, createSignMesh, createTerrainMesh,
  createTreeFamilyMesh, uploadIndexedMesh,
} from './scene-meshes';
import type { Mesh } from './scene-meshes';
import type {
  CountryRecord, DiplomacyState, DiplomaticRelation, FrameStats, HoverInfo, ProgressReporter, PropChunkRange,
  ProvinceRecord, WorldManifest,
} from './types';
import {
  extractFrustumPlanes, sphereIntersectsFrustum, sphereIntersectsHorizontalWorldWindow, WORLD_COPY_INDICES,
} from './visibility';
import { sampleWrappedField } from './world-sampling';
import { loadWorldAssetBuffers } from './world-assets';
import {
  advanceHour, calculateTimeOfDay, clampTimeMultiplier, DEFAULT_START_HOUR, formatClock, wrapHour,
  type TimeOfDayLighting,
} from './time-of-day';

const LABELS_ABOVE_PROPS_DISTANCE = 2_500;

export type MapMode = 'political' | 'diplomacy' | 'clear' | 'balanced';

export interface TimeOfDayState extends TimeOfDayLighting {
  clock: string;
  multiplier: number;
}

export class WorldRenderer {
  readonly camera = new StrategyCamera();

  manifest!: WorldManifest;
  onHover?: (info: HoverInfo | null, x: number, y: number) => void;
  onStats?: (stats: FrameStats) => void;
  onDiplomacyChange?: (state: DiplomacyState) => void;
  onProvinceCaptured?: (provinceId: number, previousCountry: CountryRecord, player: CountryRecord) => void;
  onTimeOfDayChange?: (state: TimeOfDayState) => void;

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
  private polarCapPipeline!: GPURenderPipeline;
  private waterPipeline!: GPURenderPipeline;
  private waterwayPipeline!: GPURenderPipeline;
  private infrastructurePipeline!: GPURenderPipeline;
  private propPipeline!: GPURenderPipeline;
  private cityLightPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private countryLabelPipeline!: GPURenderPipeline;
  private countryLabelBuffer?: GPUBuffer;
  private countryLabelParamsBuffer?: GPUBuffer;
  private countryLabelBindGroup?: GPUBindGroup;
  private lastCountryLabelRevision = -1;
  private terrainMeshes!: Mesh[];
  private polarCapMesh!: Mesh;
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
  private diplomacyColorTexture!: GPUTexture;
  private politicalCache!: PoliticalCache;
  private countryColors!: Float32Array;
  private visibleTerrainBuffer!: GPUBuffer;
  private terrainLodDraws: Array<{ firstInstance: number; instanceCount: number; lod: number }> = [];
  private lastTerrainVisibilityRevision = -1;
  private readonly frustumPlanes = new Float32Array(24);
  private frustumPlanesRevision = -1;
  private heightData!: Float32Array;
  private provinceData!: Uint16Array;
  private waterwayMask!: Uint8Array;
  private provinceOwners!: Uint32Array;
  private provinceById = new Map<number, ProvinceRecord>();
  private countryById = new Map<number, CountryRecord>();
  private playerCountryId = 0;
  private readonly diplomaticRelations = new Map<number, DiplomaticRelation>();
  private countryLabels?: CountryLabelLayer;
  private running = false;
  private frameHandle = 0;
  private previousTime = performance.now();
  private elapsed = 0;
  private timeOfDayHour = DEFAULT_START_HOUR;
  private timeMultiplier = 1;
  private timeLighting = calculateTimeOfDay(DEFAULT_START_HOUR);
  private reportedClock = '';
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
  private mapMode: MapMode = 'balanced';
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
  private clickStart?: { pointerId: number; x: number; y: number };
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
    if (this.manifest.politics.countries.some((country) => country.id > 255)) {
      throw new Error('Diplomacy rendering supports country ids up to 255');
    }
    const defaultPlayer = findCountryByName(this.manifest.politics.countries, 'Spain')
      ?? this.manifest.politics.countries[0];
    if (!defaultPlayer) throw new Error('The world has no countries');
    this.playerCountryId = defaultPlayer.id;
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
    const {
      heightBuffer, surfaceBuffer, terrainNormalBuffer, terrainAlbedoBuffer, navigationBuffer, coastBuffer,
      provinceBuffer, roadVertexBuffer, roadIndexBuffer, hiddenConnectionVertexBuffer, hiddenConnectionIndexBuffer,
      waterwayVertexBuffer, waterwayIndexBuffer, borderBuffer, treeBuffer, buildingBuffer, lampBuffer,
      barrierBuffer, signBuffer, provinceOwnerData, provinceAdjacencyData, provinceLabelData,
    } = await loadWorldAssetBuffers(this.manifest);
    this.heightData = new Float32Array(heightBuffer);
    this.provinceData = new Uint16Array(provinceBuffer);
    this.waterwayMask = buildWaterwayMask(new Uint8Array(navigationBuffer), this.provinceData.length);
    this.provinceOwners = new Uint32Array(provinceOwnerData);
    this.countryColors = buildCountryColorBuffer(this.manifest.politics.countries);
    this.politicalCache = new PoliticalCache(
      this.manifest,
      this.provinceData,
      this.provinceOwners,
      this.countryColors,
      borderBuffer,
    );

    report('Uploading terrain fields', 0.37);
    this.heightTexture = uploadTexture(this.device,
      'terrain height', this.manifest.fields.height.width, this.manifest.fields.height.height,
      'r32float', new Uint8Array(heightBuffer), this.manifest.fields.height.width * 4,
    );
    this.surfaceTexture = uploadTexture(this.device,
      'terrain surface', this.manifest.fields.surface.width, this.manifest.fields.surface.height,
      'rgba8uint', new Uint8Array(surfaceBuffer), this.manifest.fields.surface.width * 4,
    );
    this.terrainNormalTexture = uploadTexture(this.device,
      'precomputed terrain normals', this.manifest.fields.terrainNormal.width, this.manifest.fields.terrainNormal.height,
      'rg8snorm', new Uint8Array(terrainNormalBuffer), this.manifest.fields.terrainNormal.width * 2,
    );
    this.terrainAlbedoTexture = uploadMipmappedTexture(this.device,
      'baked terrain albedo and occlusion', this.manifest.fields.terrainAlbedo, new Uint8Array(terrainAlbedoBuffer),
    );
    this.navigationTexture = uploadTexture(this.device,
      'packed roads and waterways', this.manifest.fields.navigation.width, this.manifest.fields.navigation.height,
      'rgba8unorm', new Uint8Array(navigationBuffer), this.manifest.fields.navigation.width * 4,
    );
    this.coastTexture = uploadTexture(this.device,
      'signed-distance bank field', this.manifest.fields.coast.width, this.manifest.fields.coast.height,
      'rg8unorm', new Uint8Array(coastBuffer), this.manifest.fields.coast.width * 2,
    );
    this.provinceTexture = uploadTexture(this.device,
      'province ids', this.manifest.fields.provinceIds.width, this.manifest.fields.provinceIds.height,
      'r16uint', new Uint8Array(provinceBuffer), this.manifest.fields.provinceIds.width * 2,
    );
    this.provincePoliticalColorTexture = uploadTexture(this.device,
      'province political colors', this.politicalCache.width, this.politicalCache.height,
      'rgba8unorm', this.politicalCache.colors, this.politicalCache.width * 4,
    );
    const diplomacyColors = buildDiplomacyColorData(
      this.manifest.politics.countries,
      this.diplomaticRelations,
      this.playerCountryId,
    );
    this.diplomacyColorTexture = uploadTexture(this.device,
      'diplomacy country colors', diplomacyColors.length / 4, 1,
      'rgba8unorm', diplomacyColors, diplomacyColors.length,
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
        { binding: 11, resource: this.diplomacyColorTexture.createView() },
        { binding: 12, resource: { buffer: this.visibleTerrainBuffer } },
        { binding: 13, resource: this.terrainAlbedoTexture.createView() },
      ],
    });

    report('Compiling WebGPU pipelines', 0.62);
    this.createPipelines();
    this.terrainMeshes = [this.manifest.terrain.gridResolution, 33, 17, 9]
      .map((resolution) => createTerrainMesh(this.device, resolution, true));
    this.polarCapMesh = createTerrainMesh(this.device, 65);
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
      await loadCountryLabelFont();
      this.countryLabels = new CountryLabelLayer(
        this.countryLabelCanvas,
        this.manifest.politics.countries,
        this.provinceOwners,
        new Uint32Array(provinceAdjacencyData),
        new Float32Array(provinceLabelData),
        this.manifest.world.width,
        (countryId, x, z) => isValidCountryLabelPoint(
          countryId,
          this.sampleProvince(x, z),
          this.sampleWaterway(x, z),
          this.provinceOwners,
        ),
        Math.max(
          this.manifest.world.width / this.manifest.fields.provinceIds.width,
          this.manifest.world.height / this.manifest.fields.provinceIds.height,
        ),
        (x, z) => this.sampleHeight(x, z),
        Math.min(
          this.manifest.world.width / this.manifest.fields.height.width,
          this.manifest.world.height / this.manifest.fields.height.height,
        ) * 0.5,
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
    this.notifyDiplomacyChange();
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

  setTimeOfDay(hour: number): void {
    this.timeOfDayHour = wrapHour(hour);
    this.timeLighting = calculateTimeOfDay(this.timeOfDayHour);
    this.notifyTimeOfDayChange(true);
  }

  setTimeMultiplier(multiplier: number): number {
    this.timeMultiplier = clampTimeMultiplier(multiplier);
    this.notifyTimeOfDayChange(true);
    return this.timeMultiplier;
  }

  getTimeOfDay(): TimeOfDayState {
    return {
      ...this.timeLighting,
      clock: formatClock(this.timeOfDayHour),
      multiplier: this.timeMultiplier,
    };
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

  setMapMode(mode: MapMode): void {
    this.mapMode = mode;
  }

  getCountries(): readonly CountryRecord[] {
    return this.manifest.politics.countries;
  }

  findCountry(name: string): CountryRecord | undefined {
    return findCountryByName(this.manifest.politics.countries, name);
  }

  getDiplomacyState(): DiplomacyState {
    const player = this.countryById.get(this.playerCountryId);
    if (!player) throw new Error('The player country is not initialized');
    const countriesFor = (relation: DiplomaticRelation) => [...this.diplomaticRelations]
      .filter(([, value]) => value === relation)
      .map(([countryId]) => this.countryById.get(countryId))
      .filter((country): country is CountryRecord => Boolean(country))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { player, allies: countriesFor('allied'), enemies: countriesFor('war') };
  }

  setPlayerCountryByName(name: string): CountryRecord | undefined {
    const country = this.findCountry(name);
    if (!country) return undefined;
    this.playerCountryId = country.id;
    this.diplomaticRelations.clear();
    this.refreshDiplomacyTexture();
    this.notifyDiplomacyChange();
    return country;
  }

  setDiplomaticRelationByName(name: string, relation: Exclude<DiplomaticRelation, 'neutral'>): CountryRecord | undefined {
    const country = this.findCountry(name);
    if (!country || country.id === this.playerCountryId) return undefined;
    this.diplomaticRelations.set(country.id, relation);
    this.refreshDiplomacyTexture();
    this.notifyDiplomacyChange();
    return country;
  }

  clearDiplomaticRelation(countryId: number): void {
    if (!this.diplomaticRelations.delete(countryId)) return;
    this.refreshDiplomacyTexture();
    this.notifyDiplomacyChange();
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
    this.politicalCache.update(
      ownershipChanges.map((change) => change.provinceId),
      this.device,
      this.provincePoliticalColorTexture,
      this.borders.buffer,
    );
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
    this.polarCapPipeline = pipelines.polarCaps;
    this.waterPipeline = pipelines.water;
    this.waterwayPipeline = pipelines.waterways;
    this.infrastructurePipeline = pipelines.infrastructure;
    this.propPipeline = pipelines.props;
    this.cityLightPipeline = pipelines.cityLights;
    this.linePipeline = pipelines.lines;
    this.countryLabelPipeline = pipelines.countryLabels;
  }

  private createCountryLabelResources(): void {
    if (!this.countryLabels) return;
    this.countryLabelBuffer = this.device.createBuffer({
      label: 'country label glyphs',
      size: Math.max(4, this.countryLabels.maximumGlyphCount * 12 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.countryLabelParamsBuffer = this.device.createBuffer({
      label: 'country label parameters',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
        { binding: 2, resource: this.device.createSampler({
          magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
        }) },
        { binding: 3, resource: { buffer: this.countryLabelParamsBuffer } },
      ],
    });
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
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.clickStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    });
    window.addEventListener('pointerup', (event) => {
      const start = this.clickStart;
      this.clickStart = undefined;
      if (!start || start.pointerId !== event.pointerId || event.button !== 0) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      this.captureProvinceAt(event.clientX, event.clientY);
    });
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
    this.timeOfDayHour = advanceHour(this.timeOfDayHour, Math.min(frameMs, 250) / 1000, this.timeMultiplier);
    this.timeLighting = calculateTimeOfDay(this.timeOfDayHour);
    this.notifyTimeOfDayChange();

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
    const labelsAboveFadeEnd = this.camera.position[1] > COUNTRY_LABEL_FADE_END_ALTITUDE;
    const visibleLabels = labelsAboveFadeEnd ? this.countryLabels?.visibleLabelCount ?? 0 : 0;
    const visibleLabelGlyphs = labelsAboveFadeEnd ? this.countryLabels?.visibleGlyphCount ?? 0 : 0;
    if (this.countryLabels
      && this.countryLabelBuffer
      && this.countryLabelParamsBuffer
      && this.countryLabels.renderRevision !== this.lastCountryLabelRevision) {
      const data = this.countryLabels.renderData;
      if (data.byteLength) {
        this.device.queue.writeBuffer(
          this.countryLabelBuffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength,
        );
      }
      this.device.queue.writeBuffer(
        this.countryLabelParamsBuffer, 0, new Uint32Array([data.length / 12, WORLD_COPY_INDICES.length, 0, 0]),
      );
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
    this.render(visibleLabels, visibleLabelGlyphs);
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
    values.set([this.camera.position[0], this.camera.position[1], this.camera.position[2], this.camera.target[0]], 32);
    values.set([...this.timeLighting.sunDirection, this.elapsed], 36);
    values.set([this.canvas.width, this.canvas.height, 1 / this.canvas.width, 1 / this.canvas.height], 40);
    values.set([this.manifest.world.width, this.manifest.world.height, this.manifest.terrain.maxHeight, this.debugView], 44);
    const tintMode = this.showCountryOverlay && this.performanceLayers.countryTint
      ? this.mapMode === 'diplomacy' ? 3 : this.mapMode === 'political' ? 2 : this.mapMode === 'balanced' ? 1 : 0
      : 0;
    const countryBordersEnabled = this.showCountryOverlay && this.performanceLayers.countryBorders ? 1 : 0;
    values.set([this.hoveredId, this.camera.distance, tintMode, countryBordersEnabled], 48);
    values.set([this.manifest.terrain.chunksX, this.manifest.terrain.chunksY, this.manifest.terrain.gridResolution, this.showWireframe ? 1 : 0], 52);
    values.set([
      this.timeLighting.daylight, this.timeLighting.twilight, this.timeLighting.night, this.timeOfDayHour / 24,
    ], 56);
    values.set([...this.timeLighting.skyColor, 0], 60);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  private render(visibleLabels: number, visibleLabelGlyphs: number): void {
    if (!this.depthTexture) return;
    this.frameWorkload = createEmptyRenderWorkload(visibleLabels);
    const collectGpuTiming = Boolean(this.gpuQuerySet && this.gpuResolveBuffer && this.gpuReadBuffer)
      && !this.gpuReadPending && this.gpuQueryCountdown++ % 4 === 0;
    const gpuTimingEpoch = this.performanceEpoch;
    const frame = beginWorldFrame(
      this.device,
      this.context,
      this.depthTexture,
      this.timeLighting.skyColor,
      collectGpuTiming ? this.gpuQuerySet : undefined,
    );
    const pass = frame.pass;

    pass.setBindGroup(0, this.commonBindGroup);
    pass.setPipeline(this.polarCapPipeline);
    pass.setVertexBuffer(0, this.polarCapMesh.vertex);
    pass.setIndexBuffer(this.polarCapMesh.index, 'uint16');
    pass.drawIndexed(this.polarCapMesh.indexCount, 6);
    this.recordIndexedDraw('polarCaps', this.polarCapMesh.indexCount, 6);
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
      this.drawChunkedInfrastructure(pass, this.manifest.infrastructureChunks.waterways, 'waterways', 9_200);
    }

    if (this.showRoads || this.showHiddenConnections) pass.setPipeline(this.infrastructurePipeline);
    if (this.showRoads) {
      pass.setVertexBuffer(0, this.roadMesh.vertex);
      pass.setIndexBuffer(this.roadMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.manifest.infrastructureChunks.roads, 'roads');
    }
    if (this.showHiddenConnections) {
      pass.setVertexBuffer(0, this.hiddenConnectionMesh.vertex);
      pass.setIndexBuffer(this.hiddenConnectionMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.manifest.infrastructureChunks.hiddenConnections, 'hiddenLinks', 8_000);
    }

    const labelsAboveProps = this.camera.distance >= LABELS_ABOVE_PROPS_DISTANCE;
    if (!labelsAboveProps) this.drawCountryLabels(pass, visibleLabelGlyphs);

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
      if (this.performanceLayers.buildings) this.drawCityLights(pass);
    }

    if (labelsAboveProps) this.drawCountryLabels(pass, visibleLabelGlyphs);

    pass.setPipeline(this.linePipeline);
    if (this.showBorders || (this.showCountryOverlay && this.performanceLayers.countryBorders)) {
      pass.setBindGroup(1, this.borders.bindGroup);
      this.drawChunkedLines(pass, this.borders, this.manifest.borderChunks.ranges, 'borders');
    }
    if (this.showConnections && this.connections) {
      pass.setBindGroup(1, this.connections.bindGroup);
      const instances = this.connections.count * WORLD_COPY_INDICES.length;
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.connections.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    if (this.showWaterwayNetwork && this.waterwayNetwork) {
      pass.setBindGroup(1, this.waterwayNetwork.bindGroup);
      const instances = this.waterwayNetwork.count * WORLD_COPY_INDICES.length;
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.waterwayNetwork.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    submitWorldFrame(
      this.device,
      frame,
      collectGpuTiming ? this.gpuQuerySet : undefined,
      collectGpuTiming ? this.gpuResolveBuffer : undefined,
      collectGpuTiming ? this.gpuReadBuffer : undefined,
    );
    if (collectGpuTiming) this.readGpuTiming(gpuTimingEpoch);
  }

  private notifyTimeOfDayChange(force = false): void {
    const clock = formatClock(this.timeOfDayHour);
    if (!force && clock === this.reportedClock) return;
    this.reportedClock = clock;
    this.onTimeOfDayChange?.(this.getTimeOfDay());
  }

  private drawCityLights(pass: GPURenderPassEncoder): void {
    if (!this.buildings.views) throw new Error('Missing visible-instance storage for city lights');
    const viewKey = 'cityLights';
    let view = this.buildings.views.get(viewKey);
    if (!view) {
      const buffer = this.device.createBuffer({
        label: 'city light visible instances', size: Math.max(4, this.buildings.count * 3 * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = this.device.createBindGroup({
        label: 'city light visible bind group', layout: this.instanceLayout,
        entries: [
          { binding: 0, resource: { buffer: this.buildings.buffer } },
          { binding: 1, resource: { buffer: this.buildings.params } },
          { binding: 2, resource: { buffer } },
        ],
      });
      view = { buffer, bindGroup, revision: -1, draws: [], visibleChunks: 0 };
      this.buildings.views.set(viewKey, view);
    }
    if (view.revision !== this.camera.revision) {
      const visibility = buildPropVisibility(
        this.manifest,
        this.manifest.propChunks.buildings,
        this.buildingMeshes.map((group) => [group[group.length - 1]]),
        this.buildings.count,
        this.camera.position,
        Math.max(24_000, this.manifest.world.width * 1.2),
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        (centerX, centerZ, radius) => this.chunkIntersectsView(centerX, centerZ, radius),
      );
      view.visibleChunks = visibility.visibleChunks;
      view.draws = visibility.draws;
      if (visibility.instances.length) {
        this.device.queue.writeBuffer(
          view.buffer,
          0,
          visibility.instances.buffer as ArrayBuffer,
          visibility.instances.byteOffset,
          visibility.instances.byteLength,
        );
      }
      view.revision = this.camera.revision;
    }
    this.frameWorkload.visibleChunks.buildings = Math.max(
      this.frameWorkload.visibleChunks.buildings,
      view.visibleChunks,
    );
    pass.setPipeline(this.cityLightPipeline);
    pass.setBindGroup(1, view.bindGroup);
    for (const draw of view.draws) {
      pass.draw(6, draw.instanceCount, 0, draw.firstInstance);
      this.recordTriangleDraw('buildings', draw.instanceCount * 2, draw.instanceCount);
    }
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
      const visibility = buildPropVisibility(
        this.manifest,
        ranges,
        groupMeshes,
        layer.count,
        this.camera.position,
        maximumDistance,
        lodDistances,
        (centerX, centerZ, radius) => this.chunkIntersectsView(centerX, centerZ, radius),
      );
      view.visibleChunks = visibility.visibleChunks;
      view.draws = visibility.draws;
      if (visibility.instances.length) {
        this.device.queue.writeBuffer(
          view.buffer,
          0,
          visibility.instances.buffer as ArrayBuffer,
          visibility.instances.byteOffset,
          visibility.instances.byteLength,
        );
      }
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

  private drawCountryLabels(pass: GPURenderPassEncoder, glyphCount: number): void {
    if (glyphCount <= 0 || !this.countryLabelBindGroup) return;
    const instances = glyphCount * WORLD_COPY_INDICES.length;
    pass.setPipeline(this.countryLabelPipeline);
    pass.setBindGroup(1, this.countryLabelBindGroup);
    pass.draw(6, instances);
    this.recordTriangleDraw('labels', instances * 2, instances);
  }

  private chunkIntersectsView(centerX: number, centerZ: number, radius: number): boolean {
    if (!sphereIntersectsHorizontalWorldWindow(
      centerX, radius, this.camera.target[0], this.manifest.world.width,
    )) return false;
    if (this.frustumPlanesRevision !== this.camera.revision) {
      extractFrustumPlanes(this.camera.viewProjection, this.frustumPlanes);
      this.frustumPlanesRevision = this.camera.revision;
    }
    return sphereIntersectsFrustum(this.frustumPlanes, centerX, this.sampleHeight(centerX, centerZ), centerZ, radius);
  }

  private updateVisibleTerrainChunks(): void {
    if (this.lastTerrainVisibilityRevision === this.camera.revision) return;
    this.lastTerrainVisibilityRevision = this.camera.revision;
    const visibility = buildTerrainVisibility(
      this.manifest,
      this.camera.position,
      (x, z) => this.sampleHeight(x, z),
      (centerX, centerZ, radius) => this.chunkIntersectsView(centerX, centerZ, radius),
    );
    this.terrainLodDraws = visibility.draws;
    if (visibility.instances.length) {
      this.device.queue.writeBuffer(
        this.visibleTerrainBuffer,
        0,
        visibility.instances.buffer as ArrayBuffer,
        visibility.instances.byteOffset,
        visibility.instances.byteLength,
      );
    }
  }

  private drawChunkedInfrastructure(
    pass: GPURenderPassEncoder,
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
    for (const copy of WORLD_COPY_INDICES) {
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
    for (const copy of WORLD_COPY_INDICES) {
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
    const id = this.provinceAtScreenPoint(clientX, clientY);
    return this.finishPicking(id, started);
  }

  private provinceAtScreenPoint(clientX: number, clientY: number): number {
    const point = pickTerrainPoint(
      this.camera,
      clientX,
      clientY,
      this.manifest.terrain.maxHeight,
      this.manifest.world.height,
      (x, z) => this.sampleHeight(x, z),
      this.pickPoint,
    );
    return point ? this.sampleProvince(point[0], point[2]) : 0;
  }

  private captureProvinceAt(clientX: number, clientY: number): void {
    const encodedId = this.provinceAtScreenPoint(clientX, clientY);
    if (!encodedId) return;
    const previousCountryId = this.provinceOwners[encodedId];
    if (this.diplomaticRelations.get(previousCountryId) !== 'war') return;
    const previousCountry = this.countryById.get(previousCountryId);
    const player = this.countryById.get(this.playerCountryId);
    if (!previousCountry || !player) return;
    this.setProvinceOwner(encodedId - 1, this.playerCountryId);
    this.onProvinceCaptured?.(encodedId - 1, previousCountry, player);
  }

  private finishPicking(encodedId: number, started: number): { raycastMs: number; hoverUiMs: number } {
    const raycastMs = performance.now() - started;
    const hoverStarted = performance.now();
    this.updateHover(encodedId);
    return { raycastMs, hoverUiMs: performance.now() - hoverStarted };
  }

  private sampleHeight(worldX: number, worldZ: number): number {
    return sampleWrappedField(
      this.heightData,
      this.manifest.fields.height,
      this.manifest.world.width,
      this.manifest.world.height,
      worldX,
      worldZ,
    );
  }

  private sampleProvince(worldX: number, worldZ: number): number {
    return sampleWrappedField(
      this.provinceData,
      this.manifest.fields.provinceIds,
      this.manifest.world.width,
      this.manifest.world.height,
      worldX,
      worldZ,
    );
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
    return createHoverInfo(encodedId, this.provinceById, this.countryById, this.provinceOwners);
  }

  private sampleWaterway(worldX: number, worldZ: number): boolean {
    const field = this.manifest.fields.navigation;
    const x = wrap(Math.floor(worldX / this.manifest.world.width * field.width), field.width);
    const y = clamp(Math.floor(worldZ / this.manifest.world.height * field.height), 0, field.height - 1);
    const index = y * field.width + x;
    return (this.waterwayMask[index >>> 3] & (1 << (index & 7))) !== 0;
  }

  private refreshDiplomacyTexture(): void {
    const data = buildDiplomacyColorData(
      this.manifest.politics.countries,
      this.diplomaticRelations,
      this.playerCountryId,
    );
    this.device.queue.writeTexture(
      { texture: this.diplomacyColorTexture },
      data.buffer as ArrayBuffer,
      { bytesPerRow: data.length, rowsPerImage: 1 },
      [data.length / 4, 1],
    );
  }

  private notifyDiplomacyChange(): void {
    this.onDiplomacyChange?.(this.getDiplomacyState());
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function buildWaterwayMask(navigationData: Uint8Array, pixelCount: number): Uint8Array {
  const mask = new Uint8Array(Math.ceil(pixelCount / 8));
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (navigationData[offset + 2] > 114 || navigationData[offset + 3] > 114) {
      mask[index >>> 3] |= 1 << (index & 7);
    }
  }
  return mask;
}
