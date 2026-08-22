import { mat4, vec3 } from 'gl-matrix';
import { StrategyCamera } from './camera';
import { infrastructureShader, lineShader, propShader, riverShader, terrainShader, waterShader } from './shaders';
import type { FrameStats, HoverInfo, ProgressReporter, ProvinceRecord, WorldManifest } from './types';

const MATERIAL_NAMES = ['grassland', 'dry-earth', 'desert-sand', 'forest-floor', 'exposed-rock', 'tundra-snow', 'urban-ground', 'shoreline'];
const FALLBACK_COLORS = ['#718456', '#987e55', '#bba36b', '#43533a', '#77736b', '#a9aaa0', '#68665f', '#bea978'];

interface Mesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

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
  private riverPipeline!: GPURenderPipeline;
  private infrastructurePipeline!: GPURenderPipeline;
  private propPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private terrainMesh!: Mesh;
  private waterMesh!: Mesh;
  private riverMesh!: Mesh;
  private roadMesh!: Mesh;
  private bridgeMesh!: Mesh;
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
  private heightTexture!: GPUTexture;
  private surfaceTexture!: GPUTexture;
  private provinceTexture!: GPUTexture;
  private riverTexture!: GPUTexture;
  private coastTexture!: GPUTexture;
  private roadTexture!: GPUTexture;
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
      ?? await navigator.gpu.requestAdapter()) as GPUAdapter;
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
    const [heightBuffer, surfaceBuffer, riverFieldBuffer, roadFieldBuffer, coastBuffer, provinceBuffer, riverVertexBuffer, riverIndexBuffer, roadVertexBuffer, roadIndexBuffer, bridgeVertexBuffer, bridgeIndexBuffer, borderBuffer, treeBuffer, buildingBuffer, lampBuffer, barrierBuffer, signBuffer] = await Promise.all([
      fetchBinary(`/world/${this.manifest.fields.height.url}`),
      fetchBinary(`/world/${this.manifest.fields.surface.url}`),
      fetchBinary(`/world/${this.manifest.fields.rivers.url}`),
      fetchBinary(`/world/${this.manifest.fields.roads.url}`),
      fetchBinary(`/world/${this.manifest.fields.coast.url}`),
      fetchBinary(`/world/${this.manifest.fields.provinceIds.url}`),
      fetchBinary(`/world/${this.manifest.buffers.riverVertices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.riverIndices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.roadVertices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.roadIndices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.bridgeVertices.url}`),
      fetchBinary(`/world/${this.manifest.buffers.bridgeIndices.url}`),
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
    this.riverTexture = this.uploadTexture(
      'river field', this.manifest.fields.rivers.width, this.manifest.fields.rivers.height,
      'rgba8unorm', new Uint8Array(riverFieldBuffer), this.manifest.fields.rivers.width * 4,
    );
    this.roadTexture = this.uploadTexture(
      'strategic road field', this.manifest.fields.roads.width, this.manifest.fields.roads.height,
      'rgba8unorm', new Uint8Array(roadFieldBuffer), this.manifest.fields.roads.width * 4,
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
    this.materialTexture = await this.createMaterialTexture();
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
        { binding: 6, resource: this.riverTexture.createView() },
        { binding: 7, resource: this.coastTexture.createView() },
        { binding: 8, resource: this.roadTexture.createView() },
      ],
    });

    report('Compiling WebGPU pipelines', 0.62);
    this.createPipelines();
    this.terrainMesh = this.createTerrainMesh(this.manifest.terrain.gridResolution);
    this.waterMesh = this.createTerrainMesh(33);
    this.riverMesh = this.uploadRiverMesh(riverVertexBuffer, riverIndexBuffer, this.manifest.buffers.riverIndices.count);
    this.roadMesh = this.uploadIndexedMesh('terrain roads', roadVertexBuffer, roadIndexBuffer, this.manifest.buffers.roadIndices.count);
    this.bridgeMesh = this.uploadIndexedMesh('road bridges', bridgeVertexBuffer, bridgeIndexBuffer, this.manifest.buffers.bridgeIndices.count);
    this.treeMesh = this.createTreeMesh();
    this.buildingMesh = this.createBuildingMesh();
    this.shadowMesh = this.createShadowMesh();
    this.lampMesh = this.createLampMesh();
    this.barrierMesh = this.createBarrierMesh();
    this.signMesh = this.createSignMesh();

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

  private createLayouts(): void {
    this.commonLayout = this.device.createBindGroupLayout({
      label: 'common world layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    this.instanceLayout = this.device.createBindGroupLayout({
      label: 'instance layer layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    this.lineLayout = this.device.createBindGroupLayout({
      label: 'line layer layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPipelines(): void {
    const depthStencil: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    const terrainModule = this.device.createShaderModule({ label: 'terrain shader', code: terrainShader });
    const waterModule = this.device.createShaderModule({ label: 'water shader', code: waterShader });
    const riverModule = this.device.createShaderModule({ label: 'river shader', code: riverShader });
    const infrastructureModule = this.device.createShaderModule({ label: 'roads and bridges shader', code: infrastructureShader });
    const propModule = this.device.createShaderModule({ label: 'prop shader', code: propShader });
    const lineModule = this.device.createShaderModule({ label: 'line shader', code: lineShader });

    this.terrainPipeline = this.device.createRenderPipeline({
      label: 'terrain pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.commonLayout] }),
      vertex: {
        module: terrainModule,
        entryPoint: 'terrainVertex',
        buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }],
      },
      fragment: { module: terrainModule, entryPoint: 'terrainFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
    });

    this.waterPipeline = this.device.createRenderPipeline({
      label: 'water pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.commonLayout] }),
      vertex: {
        module: waterModule,
        entryPoint: 'waterVertex',
        buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }],
      },
      fragment: { module: waterModule, entryPoint: 'waterFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
    });

    this.riverPipeline = this.device.createRenderPipeline({
      label: 'river ribbons pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.commonLayout] }),
      vertex: {
        module: riverModule,
        entryPoint: 'riverVertex',
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32' },
            { shaderLocation: 3, offset: 20, format: 'float32' },
            { shaderLocation: 4, offset: 24, format: 'float32' },
            { shaderLocation: 5, offset: 28, format: 'float32' },
          ],
        }],
      },
      fragment: { module: riverModule, entryPoint: 'riverFragment', targets: [{ format: this.format, blend: alphaBlend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    this.infrastructurePipeline = this.device.createRenderPipeline({
      label: 'roads and bridges pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.commonLayout] }),
      vertex: {
        module: infrastructureModule,
        entryPoint: 'infrastructureVertex',
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
            { shaderLocation: 3, offset: 32, format: 'float32' },
            { shaderLocation: 4, offset: 36, format: 'float32' },
          ],
        }],
      },
      fragment: { module: infrastructureModule, entryPoint: 'infrastructureFragment', targets: [{ format: this.format, blend: alphaBlend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
    });

    this.propPipeline = this.device.createRenderPipeline({
      label: 'world props pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.commonLayout, this.instanceLayout] }),
      vertex: {
        module: propModule,
        entryPoint: 'propVertex',
        buffers: [{
          arrayStride: 28,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: propModule,
        entryPoint: 'propFragment',
        targets: [{ format: this.format, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil,
    });

    this.linePipeline = this.device.createRenderPipeline({
      label: 'map lines pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.commonLayout, this.lineLayout] }),
      vertex: { module: lineModule, entryPoint: 'lineVertex' },
      fragment: { module: lineModule, entryPoint: 'lineFragment', targets: [{ format: this.format, blend: alphaBlend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
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

  private async createMaterialTexture(): Promise<GPUTexture> {
    const size = 512;
    const mipLevelCount = Math.floor(Math.log2(size)) + 1;
    const texture = this.device.createTexture({
      label: 'terrain material array',
      size: [size, size, MATERIAL_NAMES.length],
      format: 'rgba8unorm-srgb',
      mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    for (let layer = 0; layer < MATERIAL_NAMES.length; layer += 1) {
      let source: ImageBitmap;
      try {
        const response = await fetch(`/textures/${MATERIAL_NAMES[layer]}.png`);
        if (!response.ok) throw new Error(String(response.status));
        source = await createImageBitmap(await response.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
      } catch {
        source = await this.createFallbackMaterial(size, FALLBACK_COLORS[layer], layer);
      }
      this.device.queue.copyExternalImageToTexture({ source }, { texture, origin: [0, 0, layer] }, [size, size]);
      source.close();
    }
    this.generateMipmaps(texture, size, MATERIAL_NAMES.length, mipLevelCount);
    return texture;
  }

  private generateMipmaps(texture: GPUTexture, size: number, layers: number, mipLevelCount: number): void {
    const module = this.device.createShaderModule({ label: 'material mipmap shader', code: /* wgsl */ `
      @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
      @group(0) @binding(1) var sourceSampler: sampler;

      struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f };

      @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Output {
        let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        var output: Output;
        output.position = vec4f(positions[index], 0.0, 1.0);
        output.uv = output.position.xy * vec2f(0.5, -0.5) + 0.5;
        return output;
      }

      @fragment fn fragmentMain(input: Output) -> @location(0) vec4f {
        return textureSample(sourceTexture, sourceSampler, input.uv);
      }
    ` });
    const pipeline = this.device.createRenderPipeline({
      label: 'material mipmap pipeline',
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm-srgb' }] },
      primitive: { topology: 'triangle-list' },
    });
    const sampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const encoder = this.device.createCommandEncoder({ label: 'generate material mipmaps' });
    for (let layer = 0; layer < layers; layer += 1) {
      for (let mip = 1; mip < mipLevelCount; mip += 1) {
        const bindGroup = this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: texture.createView({ dimension: '2d', baseMipLevel: mip - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }) },
            { binding: 1, resource: sampler },
          ],
        });
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }),
            loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
          }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
      }
    }
    this.device.queue.submit([encoder.finish()]);
    void size;
  }

  private async createFallbackMaterial(size: number, color: string, seed: number): Promise<ImageBitmap> {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
    const image = context.getImageData(0, 0, size, size);
    let state = (seed + 1) * 0x9e3779b1;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        const noise = ((state >>> 0) / 0xffffffff - 0.5) * 24;
        const index = (y * size + x) * 4;
        image.data[index] = clamp(image.data[index] + noise, 0, 255);
        image.data[index + 1] = clamp(image.data[index + 1] + noise, 0, 255);
        image.data[index + 2] = clamp(image.data[index + 2] + noise, 0, 255);
      }
    }
    context.putImageData(image, 0, 0);
    return createImageBitmap(canvas);
  }

  private createTerrainMesh(resolution: number): Mesh {
    const vertices = new Float32Array(resolution * resolution * 2);
    let cursor = 0;
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        vertices[cursor++] = x / (resolution - 1);
        vertices[cursor++] = y / (resolution - 1);
      }
    }
    const indices = new Uint16Array((resolution - 1) * (resolution - 1) * 6);
    cursor = 0;
    for (let y = 0; y < resolution - 1; y += 1) {
      for (let x = 0; x < resolution - 1; x += 1) {
        const a = y * resolution + x;
        const b = a + 1;
        const c = a + resolution;
        const d = c + 1;
        indices.set([a, c, b, b, c, d], cursor);
        cursor += 6;
      }
    }
    return this.uploadMesh('terrain grid', vertices, indices);
  }

  private createTreeMesh(): Mesh {
    const builder = new MeshBuilder();
    builder.addBox(-0.55, 0, -0.55, 0.55, 4.1, 0.55, 0);
    builder.addCone(0, 3.0, 0, 3.5, 11.5, 9, 1);
    builder.addCone(0, 6.2, 0, 2.8, 13.3, 9, 1);
    return this.uploadMesh('tree mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
  }

  private createBuildingMesh(): Mesh {
    const builder = new MeshBuilder();
    builder.addBox(-0.5, 0, -0.5, 0.5, 1, 0.5, 0);
    builder.addGableRoof(-0.56, 1, -0.56, 0.56, 1.24, 0.56, 1);
    builder.addBox(-0.68, 0, -0.38, 0.68, 0.42, 0.38, 2, 2);
    builder.addBox(-0.18, 1, -0.18, 0.18, 1.52, 0.18, 3, 3);
    builder.addHipRoof(0, 1, 0, 0.62, 1.24, 4);
    builder.addBox(-0.54, 1, -0.54, 0.54, 1.055, 0.54, 5, 5);
    return this.uploadMesh('building mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
  }

  private createLampMesh(): Mesh {
    const builder = new MeshBuilder();
    builder.addBox(-0.07, 0, -0.07, 0.07, 3.2, 0.07, 0);
    builder.addBox(-0.10, 3.0, -0.10, 0.10, 3.42, 0.10, 0);
    builder.addBox(-0.18, 3.38, -0.18, 0.18, 3.57, 0.18, 1, 1);
    return this.uploadMesh('road lamp mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
  }

  private createBarrierMesh(): Mesh {
    const builder = new MeshBuilder();
    for (const x of [-0.46, 0, 0.46]) builder.addBox(x - 0.025, 0, -0.07, x + 0.025, 0.86, 0.07, 0);
    builder.addBox(-0.5, 0.58, -0.055, 0.5, 0.72, 0.055, 1, 1);
    return this.uploadMesh('road barrier mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
  }

  private createSignMesh(): Mesh {
    const builder = new MeshBuilder();
    builder.addBox(-0.045, 0, -0.045, 0.045, 1.55, 0.045, 0);
    builder.addBox(-0.42, 1.08, -0.055, 0.42, 1.52, 0.055, 1, 1);
    return this.uploadMesh('road sign mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
  }

  private createShadowMesh(): Mesh {
    const builder = new MeshBuilder();
    builder.addPlane(9);
    return this.uploadMesh('contact shadow mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
  }

  private uploadMesh(label: string, vertices: Float32Array, indices: Uint16Array): Mesh {
    const vertex = this.device.createBuffer({ label: `${label} vertices`, size: align4(vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const index = this.device.createBuffer({ label: `${label} indices`, size: align4(indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vertex, 0, vertices.buffer as ArrayBuffer, vertices.byteOffset, vertices.byteLength);
    this.device.queue.writeBuffer(index, 0, indices.buffer as ArrayBuffer, indices.byteOffset, indices.byteLength);
    return { vertex, index, indexCount: indices.length };
  }

  private uploadRiverMesh(vertexData: ArrayBuffer, indexData: ArrayBuffer, indexCount: number): Mesh {
    const vertex = this.device.createBuffer({ label: 'river network vertices', size: align4(vertexData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const index = this.device.createBuffer({ label: 'river network indices', size: align4(indexData.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vertex, 0, vertexData);
    this.device.queue.writeBuffer(index, 0, indexData);
    return { vertex, index, indexCount };
  }

  private uploadIndexedMesh(label: string, vertexData: ArrayBuffer, indexData: ArrayBuffer, indexCount: number): Mesh {
    const vertex = this.device.createBuffer({ label: `${label} vertices`, size: align4(vertexData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const index = this.device.createBuffer({ label: `${label} indices`, size: align4(indexData.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vertex, 0, vertexData);
    this.device.queue.writeBuffer(index, 0, indexData);
    return { vertex, index, indexCount };
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

    pass.setPipeline(this.riverPipeline);
    pass.setVertexBuffer(0, this.riverMesh.vertex);
    pass.setIndexBuffer(this.riverMesh.index, 'uint32');
    pass.drawIndexed(this.riverMesh.indexCount, 3);

    pass.setPipeline(this.infrastructurePipeline);
    pass.setVertexBuffer(0, this.roadMesh.vertex);
    pass.setIndexBuffer(this.roadMesh.index, 'uint32');
    this.drawChunkedInfrastructure(pass, this.roadMesh, this.manifest.infrastructureChunks.roads);
    pass.setVertexBuffer(0, this.bridgeMesh.vertex);
    pass.setIndexBuffer(this.bridgeMesh.index, 'uint32');
    this.drawChunkedInfrastructure(pass, this.bridgeMesh, this.manifest.infrastructureChunks.bridges);

    pass.setPipeline(this.propPipeline);
    this.drawMeshInstances(pass, this.shadowMesh, this.trees);
    this.drawMeshInstances(pass, this.shadowMesh, this.buildings);
    this.drawMeshInstances(pass, this.treeMesh, this.trees);
    this.drawMeshInstances(pass, this.buildingMesh, this.buildings);
    this.drawMeshInstances(pass, this.lampMesh, this.lamps);
    this.drawMeshInstances(pass, this.barrierMesh, this.barriers);
    this.drawMeshInstances(pass, this.signMesh, this.signs);

    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(1, this.borders.bindGroup);
    pass.draw(6, this.borders.count * 3);
    if (this.showConnections && this.connections) {
      pass.setBindGroup(1, this.connections.bindGroup);
      pass.draw(6, this.connections.count * 3);
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

  private drawChunkedInfrastructure(pass: GPURenderPassEncoder, mesh: Mesh, ranges: Array<{ firstIndex: number; indexCount: number }>): void {
    if (this.camera.distance >= 4_000) return;
    const chunksX = this.manifest.infrastructureChunks.chunksX;
    const chunksY = this.manifest.infrastructureChunks.chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const radius = clamp(this.camera.distance * 1.48 + 720, 940, 4_300);
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
      roads: this.manifest.counts.logicalRoutes,
      bridges: this.manifest.counts.bridges,
      debugView: this.debugView,
    });
  }
}

const alphaBlend: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

class MeshBuilder {
  vertices: number[] = [];
  indices: number[] = [];

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, sideMaterial: number, topMaterial = sideMaterial): void {
    const faces: Array<[number[], number[], number]> = [
      [[minX,minY,maxZ, maxX,minY,maxZ, maxX,maxY,maxZ, minX,maxY,maxZ], [0,0,1], sideMaterial],
      [[maxX,minY,minZ, minX,minY,minZ, minX,maxY,minZ, maxX,maxY,minZ], [0,0,-1], sideMaterial],
      [[maxX,minY,maxZ, maxX,minY,minZ, maxX,maxY,minZ, maxX,maxY,maxZ], [1,0,0], sideMaterial],
      [[minX,minY,minZ, minX,minY,maxZ, minX,maxY,maxZ, minX,maxY,minZ], [-1,0,0], sideMaterial],
      [[minX,maxY,maxZ, maxX,maxY,maxZ, maxX,maxY,minZ, minX,maxY,minZ], [0,1,0], topMaterial],
      [[minX,minY,minZ, maxX,minY,minZ, maxX,minY,maxZ, minX,minY,maxZ], [0,-1,0], sideMaterial],
    ];
    for (const [positions, normal, material] of faces) {
      const start = this.vertices.length / 7;
      for (let vertex = 0; vertex < 4; vertex += 1) {
        this.vertices.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], normal[0], normal[1], normal[2], material);
      }
      this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }

  addCone(x: number, baseY: number, z: number, radius: number, tipY: number, sides: number, material: number): void {
    const tipStart = this.vertices.length / 7;
    for (let side = 0; side < sides; side += 1) {
      const angleA = side / sides * Math.PI * 2;
      const angleB = (side + 1) / sides * Math.PI * 2;
      const mid = (angleA + angleB) * 0.5;
      const normal = [Math.sin(mid) * 0.86, 0.5, Math.cos(mid) * 0.86];
      const start = this.vertices.length / 7;
      this.vertices.push(x, tipY, z, ...normal, material);
      this.vertices.push(x + Math.sin(angleA) * radius, baseY, z + Math.cos(angleA) * radius, ...normal, material);
      this.vertices.push(x + Math.sin(angleB) * radius, baseY, z + Math.cos(angleB) * radius, ...normal, material);
      this.indices.push(start, start + 1, start + 2);
    }
    void tipStart;
  }

  addGableRoof(minX: number, baseY: number, minZ: number, maxX: number, ridgeY: number, maxZ: number, material: number): void {
    const halfWidth = Math.max(0.001, (maxX - minX) * 0.5);
    const rise = ridgeY - baseY;
    const slopeLength = Math.hypot(halfWidth, rise);
    const faces: Array<[number[], number[]]> = [
      [[minX,baseY,minZ, minX,baseY,maxZ, 0,ridgeY,maxZ, 0,ridgeY,minZ], [-rise / slopeLength, halfWidth / slopeLength, 0]],
      [[maxX,baseY,maxZ, maxX,baseY,minZ, 0,ridgeY,minZ, 0,ridgeY,maxZ], [rise / slopeLength, halfWidth / slopeLength, 0]],
    ];
    for (const [positions, normal] of faces) {
      const start = this.vertices.length / 7;
      for (let vertex = 0; vertex < 4; vertex += 1) this.vertices.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], ...normal, material);
      this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    for (const [positions, normal] of [
      [[minX,baseY,minZ, maxX,baseY,minZ, 0,ridgeY,minZ], [0,0,-1]],
      [[maxX,baseY,maxZ, minX,baseY,maxZ, 0,ridgeY,maxZ], [0,0,1]],
    ] as Array<[number[], number[]]>) {
      const start = this.vertices.length / 7;
      for (let vertex = 0; vertex < 3; vertex += 1) this.vertices.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], ...normal, material);
      this.indices.push(start, start + 1, start + 2);
    }
  }

  addHipRoof(x: number, baseY: number, z: number, radius: number, tipY: number, material: number): void {
    const corners = [[-radius,-radius], [radius,-radius], [radius,radius], [-radius,radius]];
    for (let side = 0; side < 4; side += 1) {
      const a = corners[side];
      const b = corners[(side + 1) % 4];
      const midX = (a[0] + b[0]) * 0.5;
      const midZ = (a[1] + b[1]) * 0.5;
      const length = Math.max(0.001, Math.hypot(midX, tipY - baseY, midZ));
      const normal = [-midX / length, radius / length, -midZ / length];
      const start = this.vertices.length / 7;
      this.vertices.push(
        x + a[0], baseY, z + a[1], ...normal, material,
        x + b[0], baseY, z + b[1], ...normal, material,
        x, tipY, z, ...normal, material,
      );
      this.indices.push(start, start + 2, start + 1);
    }
  }

  addPlane(material: number): void {
    const start = this.vertices.length / 7;
    this.vertices.push(
      -1, 0, -1, 0, 1, 0, material,
      -1, 0, 1, 0, 1, 0, material,
      1, 0, -1, 0, 1, 0, material,
      1, 0, 1, 0, 1, 0, material,
    );
    this.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
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
