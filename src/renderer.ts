import { vec3 } from 'gl-matrix';
import { StrategyCamera } from './camera';
import { createMaterialTexture } from './material-texture';
import { createRendererLayouts, createRendererPipelines } from './renderer-pipelines';
import {
  createBarrierMesh, createBuildingMesh, createLampMesh, createShadowMesh, createSignMesh, createTerrainMesh,
  createTreeMesh, uploadIndexedMesh,
} from './scene-meshes';
import type { Mesh } from './scene-meshes';
import type { FrameStats, HoverInfo, ProgressReporter, ProvinceRecord, WorldManifest } from './types';

interface InstanceLayer {
  buffer: GPUBuffer;
  params: GPUBuffer;
  bindGroup: GPUBindGroup;
  count: number;
}

export class WorldRenderer {
  readonly camera = new StrategyCamera();

  manifest!: WorldManifest;
  onHover?: (info: HoverInfo | null, x: number, y: number) => void;
  onStats?: (stats: FrameStats) => void;

  private readonly canvas: HTMLCanvasElement;
  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture?: GPUTexture;
  private commonLayout!: GPUBindGroupLayout;
  private instanceLayout!: GPUBindGroupLayout;
  private lineLayout!: GPUBindGroupLayout;
  private commonBindGroup!: GPUBindGroup;
  private uniformBuffer!: GPUBuffer;
  private terrainPipeline!: GPURenderPipeline;
  private waterPipeline!: GPURenderPipeline;
  private waterwayPipeline!: GPURenderPipeline;
  private infrastructurePipeline!: GPURenderPipeline;
  private propPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private terrainMesh!: Mesh;
  private waterMesh!: Mesh;
  private roadMesh!: Mesh;
  private hiddenConnectionMesh!: Mesh;
  private waterwayMesh!: Mesh;
  private treeMesh!: Mesh;
  private buildingMesh!: Mesh;
  private shadowMesh!: Mesh;
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
  private provinceTexture!: GPUTexture;
  private coastTexture!: GPUTexture;
  private roadTexture!: GPUTexture;
  private waterwayTexture!: GPUTexture;
  private materialTexture!: GPUTexture;
  private heightData!: Float32Array;
  private provinceData!: Uint16Array;
  private provinceById = new Map<number, ProvinceRecord>();
  private running = false;
  private frameHandle = 0;
  private previousTime = performance.now();
  private elapsed = 0;
  private frameSamples: number[] = [];
  private debugView = 0;
  private showWireframe = false;
  private showConnections = false;
  private showWaterwayNetwork = false;
  private showBorders = true;
  private showProps = true;
  private showRoads = true;
  private showHiddenConnections = true;
  private showWaterways = true;
  private pointer = { x: 0, y: 0, inside: false };
  private hoveredId = 0;
  private pickCountdown = 0;
  private resizeObserver?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize(report: ProgressReporter): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable');
    report('Loading world manifest', 0.04);
    this.manifest = await fetchJson<WorldManifest>('/world/world.json');
    this.provinceById = new Map(this.manifest.provinces.map((province) => [province.id, province]));
    this.camera.configureWorld(this.manifest.world.width, this.manifest.world.height);
    this.camera.minimumAltitude = this.manifest.terrain.maxHeight + 82;

    report('Requesting WebGPU device', 0.1);
    this.adapter = (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      ?? await navigator.gpu.requestAdapter()
      ?? await navigator.gpu.requestAdapter({ forceFallbackAdapter: true })) as GPUAdapter;
    if (!this.adapter) throw new Error('No compatible WebGPU adapter was found');
    this.device = await this.adapter.requestDevice();
    this.device.lost.then((info) => {
      console.error('WebGPU device lost', info);
      if (this.running) window.location.reload();
    });
    this.device.addEventListener('uncapturederror', (event) => console.error('WebGPU validation error', event.error));

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.createLayouts();

    report('Loading terrain fields', 0.2);
    const [heightBuffer, surfaceBuffer, roadFieldBuffer, waterwayFieldBuffer, coastBuffer, provinceBuffer, roadVertexBuffer, roadIndexBuffer,
      hiddenConnectionVertexBuffer, hiddenConnectionIndexBuffer, waterwayVertexBuffer, waterwayIndexBuffer,
      borderBuffer, treeBuffer, buildingBuffer, lampBuffer, barrierBuffer, signBuffer] = await Promise.all([
      fetchBinary(`/world/${this.manifest.fields.height.url}`),
      fetchBinary(`/world/${this.manifest.fields.surface.url}`),
      fetchBinary(`/world/${this.manifest.fields.roads.url}`),
      fetchBinary(`/world/${this.manifest.fields.waterways.url}`),
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
    ]);
    this.heightData = new Float32Array(heightBuffer);
    this.provinceData = new Uint16Array(provinceBuffer);

    report('Uploading terrain fields', 0.37);
    this.heightTexture = this.uploadTexture(
      'terrain height', this.manifest.fields.height.width, this.manifest.fields.height.height,
      'r32float', new Uint8Array(heightBuffer), this.manifest.fields.height.width * 4,
    );
    this.surfaceTexture = this.uploadTexture(
      'terrain surface', this.manifest.fields.surface.width, this.manifest.fields.surface.height,
      'rgba8uint', new Uint8Array(surfaceBuffer), this.manifest.fields.surface.width * 4,
    );
    this.roadTexture = this.uploadTexture(
      'strategic road field', this.manifest.fields.roads.width, this.manifest.fields.roads.height,
      'rg8unorm', new Uint8Array(roadFieldBuffer), this.manifest.fields.roads.width * 2,
    );
    this.waterwayTexture = this.uploadTexture(
      'authored waterway mask', this.manifest.fields.waterways.width, this.manifest.fields.waterways.height,
      'r8unorm', new Uint8Array(waterwayFieldBuffer), this.manifest.fields.waterways.width,
    );
    this.coastTexture = this.uploadTexture(
      'filtered coast mask', this.manifest.fields.coast.width, this.manifest.fields.coast.height,
      'r8unorm', new Uint8Array(coastBuffer), this.manifest.fields.coast.width,
    );
    this.provinceTexture = this.uploadTexture(
      'province ids', this.manifest.fields.provinceIds.width, this.manifest.fields.provinceIds.height,
      'r16uint', new Uint8Array(provinceBuffer), this.manifest.fields.provinceIds.width * 2,
    );

    report('Preparing terrain materials', 0.49);
    this.materialTexture = await createMaterialTexture(this.device);
    this.uniformBuffer = this.device.createBuffer({
      label: 'frame uniforms',
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
        { binding: 5, resource: this.device.createSampler({ addressModeU: 'repeat', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }) },
        { binding: 6, resource: this.coastTexture.createView() },
        { binding: 7, resource: this.roadTexture.createView() },
        { binding: 8, resource: this.waterwayTexture.createView() },
      ],
    });

    report('Compiling WebGPU pipelines', 0.62);
    this.createPipelines();
    this.terrainMesh = createTerrainMesh(this.device, this.manifest.terrain.gridResolution);
    this.waterMesh = createTerrainMesh(this.device, 33);
    this.roadMesh = uploadIndexedMesh(this.device, 'terrain roads', roadVertexBuffer, roadIndexBuffer, this.manifest.buffers.roadIndices.count);
    this.hiddenConnectionMesh = uploadIndexedMesh(this.device, 'floating hidden connections', hiddenConnectionVertexBuffer,
      hiddenConnectionIndexBuffer, this.manifest.buffers.hiddenConnectionIndices.count);
    this.waterwayMesh = uploadIndexedMesh(this.device, 'supplied rivers and canals', waterwayVertexBuffer,
      waterwayIndexBuffer, this.manifest.buffers.waterwayIndices.count);
    this.treeMesh = createTreeMesh(this.device);
    this.buildingMesh = createBuildingMesh(this.device);
    this.shadowMesh = createShadowMesh(this.device);
    this.lampMesh = createLampMesh(this.device);
    this.barrierMesh = createBarrierMesh(this.device);
    this.signMesh = createSignMesh(this.device);

    report('Uploading world geometry', 0.78);
    this.trees = this.createInstanceLayer('trees', treeBuffer, this.manifest.buffers.trees.count, 0, this.instanceLayout);
    this.buildings = this.createInstanceLayer('buildings', buildingBuffer, this.manifest.buffers.buildings.count, 1, this.instanceLayout);
    this.lamps = this.createInstanceLayer('road lamps', lampBuffer, this.manifest.buffers.lamps.count, 2, this.instanceLayout);
    this.barriers = this.createInstanceLayer('road barriers', barrierBuffer, this.manifest.buffers.barriers.count, 3, this.instanceLayout);
    this.signs = this.createInstanceLayer('road signs', signBuffer, this.manifest.buffers.signs.count, 4, this.instanceLayout);
    this.borders = this.createInstanceLayer('borders', borderBuffer, this.manifest.buffers.borders.count, 0, this.lineLayout);

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

  setBordersVisible(enabled: boolean): void { this.showBorders = enabled; }

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
  }

  private createPipelines(): void {
    const pipelines = createRendererPipelines(this.device, this.format, {
      common: this.commonLayout,
      instances: this.instanceLayout,
      lines: this.lineLayout,
    });
    this.terrainPipeline = pipelines.terrain;
    this.waterPipeline = pipelines.water;
    this.waterwayPipeline = pipelines.waterways;
    this.infrastructurePipeline = pipelines.infrastructure;
    this.propPipeline = pipelines.props;
    this.linePipeline = pipelines.lines;
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

  private createInstanceLayer(label: string, data: ArrayBuffer, count: number, kind: number, layout: GPUBindGroupLayout): InstanceLayer {
    const buffer = this.device.createBuffer({
      label: `${label} records`,
      size: align4(data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    const params = this.device.createBuffer({ label: `${label} params`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([count, kind, 1, 0]));
    const bindGroup = this.device.createBindGroup({
      label: `${label} bind group`,
      layout,
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: params } }],
    });
    return { buffer, params, bindGroup, count };
  }

  private attachInteraction(): void {
    this.canvas.addEventListener('pointermove', (event) => {
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.inside = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
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
    const deltaMs = Math.min(50, time - this.previousTime);
    this.previousTime = time;
    this.elapsed += deltaMs / 1000;
    this.camera.update(deltaMs / 1000);
    this.resize();
    this.updateUniforms();

    if (this.pointer.inside && this.pickCountdown-- <= 0) {
      this.pickCountdown = 2;
      this.pickProvince(this.pointer.x, this.pointer.y);
    }

    this.render();
    this.updateStats(deltaMs);
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
    values.set([this.hoveredId, this.camera.distance, 0, 0], 48);
    values.set([this.manifest.terrain.chunksX, this.manifest.terrain.chunksY, this.manifest.terrain.gridResolution, this.showWireframe ? 1 : 0], 52);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  private render(): void {
    if (!this.depthTexture) return;
    const encoder = this.device.createCommandEncoder({ label: 'world frame' });
    const pass = encoder.beginRenderPass({
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
    });

    pass.setBindGroup(0, this.commonBindGroup);
    pass.setPipeline(this.waterPipeline);
    pass.setVertexBuffer(0, this.waterMesh.vertex);
    pass.setIndexBuffer(this.waterMesh.index, 'uint16');
    pass.drawIndexed(this.waterMesh.indexCount, this.manifest.terrain.chunksX * this.manifest.terrain.chunksY * 3);

    pass.setPipeline(this.terrainPipeline);
    pass.setVertexBuffer(0, this.terrainMesh.vertex);
    pass.setIndexBuffer(this.terrainMesh.index, 'uint16');
    pass.drawIndexed(this.terrainMesh.indexCount, this.manifest.terrain.chunksX * this.manifest.terrain.chunksY * 3);

    if (this.showWaterways) {
      pass.setPipeline(this.waterwayPipeline);
      pass.setVertexBuffer(0, this.waterwayMesh.vertex);
      pass.setIndexBuffer(this.waterwayMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.waterwayMesh, this.manifest.infrastructureChunks.waterways, 9_200);
    }

    if (this.showRoads || this.showHiddenConnections) pass.setPipeline(this.infrastructurePipeline);
    if (this.showRoads) {
      pass.setVertexBuffer(0, this.roadMesh.vertex);
      pass.setIndexBuffer(this.roadMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.roadMesh, this.manifest.infrastructureChunks.roads);
    }
    if (this.showHiddenConnections) {
      pass.setVertexBuffer(0, this.hiddenConnectionMesh.vertex);
      pass.setIndexBuffer(this.hiddenConnectionMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.hiddenConnectionMesh, this.manifest.infrastructureChunks.hiddenConnections, 8_000);
    }

    if (this.showProps) {
      pass.setPipeline(this.propPipeline);
      this.drawMeshInstances(pass, this.shadowMesh, this.trees);
      this.drawMeshInstances(pass, this.shadowMesh, this.buildings);
      this.drawMeshInstances(pass, this.treeMesh, this.trees);
      this.drawMeshInstances(pass, this.buildingMesh, this.buildings);
      this.drawMeshInstances(pass, this.lampMesh, this.lamps);
      this.drawMeshInstances(pass, this.barrierMesh, this.barriers);
      this.drawMeshInstances(pass, this.signMesh, this.signs);
    }

    pass.setPipeline(this.linePipeline);
    if (this.showBorders) {
      pass.setBindGroup(1, this.borders.bindGroup);
      pass.draw(6, this.borders.count * 3);
    }
    if (this.showConnections && this.connections) {
      pass.setBindGroup(1, this.connections.bindGroup);
      pass.draw(6, this.connections.count * 3);
    }
    if (this.showWaterwayNetwork && this.waterwayNetwork) {
      pass.setBindGroup(1, this.waterwayNetwork.bindGroup);
      pass.draw(6, this.waterwayNetwork.count * 3);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private drawMeshInstances(pass: GPURenderPassEncoder, mesh: Mesh, layer: InstanceLayer): void {
    pass.setBindGroup(1, layer.bindGroup);
    pass.setVertexBuffer(0, mesh.vertex);
    pass.setIndexBuffer(mesh.index, 'uint16');
    const edgeRange = 1_800;
    if (this.camera.target[0] < edgeRange) pass.drawIndexed(mesh.indexCount, layer.count * 2, 0, 0, 0);
    else if (this.camera.target[0] > this.manifest.world.width - edgeRange) pass.drawIndexed(mesh.indexCount, layer.count * 2, 0, 0, layer.count);
    else pass.drawIndexed(mesh.indexCount, layer.count, 0, 0, layer.count);
  }

  private drawChunkedInfrastructure(pass: GPURenderPassEncoder, mesh: Mesh, ranges: Array<{ firstIndex: number; indexCount: number }>, maximumDistance = 4_000): void {
    if (this.camera.distance >= maximumDistance) return;
    const chunksX = this.manifest.infrastructureChunks.chunksX;
    const chunksY = this.manifest.infrastructureChunks.chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const radius = clamp(this.camera.distance * 1.48 + 720, 940, maximumDistance + 300);
    const edgeRange = 1_800;
    for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
      for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
        const range = ranges[chunkY * chunksX + chunkX];
        if (!range?.indexCount) continue;
        let dx = (chunkX + 0.5) * chunkWidth - this.camera.target[0];
        if (dx > this.manifest.world.width * 0.5) dx -= this.manifest.world.width;
        if (dx < -this.manifest.world.width * 0.5) dx += this.manifest.world.width;
        const dz = (chunkY + 0.5) * chunkHeight - this.camera.target[2];
        if (Math.hypot(dx, dz) > radius + Math.hypot(chunkWidth, chunkHeight) * 0.6) continue;
        if (this.camera.target[0] < edgeRange) pass.drawIndexed(range.indexCount, 2, range.firstIndex, 0, 0);
        else if (this.camera.target[0] > this.manifest.world.width - edgeRange) pass.drawIndexed(range.indexCount, 2, range.firstIndex, 0, 1);
        else pass.drawIndexed(range.indexCount, 1, range.firstIndex, 0, 1);
      }
    }
  }

  private pickProvince(clientX: number, clientY: number): void {
    const ray = this.camera.screenRay(clientX, clientY);
    if (ray.direction[1] >= -0.0001) {
      this.updateHover(0);
      return;
    }
    const topY = this.manifest.terrain.maxHeight + 12;
    let low = Math.max(0, (topY - ray.origin[1]) / ray.direction[1]);
    let high = Math.max(0, (-2 - ray.origin[1]) / ray.direction[1]);
    if (high < low) [low, high] = [high, low];
    let point = vec3.create();
    for (let iteration = 0; iteration < 15; iteration += 1) {
      const distance = (low + high) * 0.5;
      vec3.scaleAndAdd(point, ray.origin, ray.direction, distance);
      const height = this.sampleHeight(point[0], point[2]);
      if (point[1] > height) low = distance;
      else high = distance;
    }
    vec3.scaleAndAdd(point, ray.origin, ray.direction, (low + high) * 0.5);
    if (point[2] < 0 || point[2] >= this.manifest.world.height) {
      this.updateHover(0);
      return;
    }
    const id = this.sampleProvince(point[0], point[2]);
    this.updateHover(id);
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

  private updateHover(encodedId: number): void {
    if (encodedId === this.hoveredId) {
      if (encodedId !== 0) this.onHover?.(this.toHoverInfo(encodedId), this.pointer.x, this.pointer.y);
      return;
    }
    this.hoveredId = encodedId;
    this.onHover?.(encodedId === 0 ? null : this.toHoverInfo(encodedId), this.pointer.x, this.pointer.y);
  }

  private toHoverInfo(encodedId: number): HoverInfo | null {
    const province = this.provinceById.get(encodedId - 1);
    return province ? { id: province.id, name: province.name, terrain: province.terrain } : null;
  }

  private updateStats(frameMs: number): void {
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length < 20) return;
    const average = this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
    this.frameSamples.length = 0;
    this.onStats?.({
      fps: 1000 / average,
      frameMs: average,
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
