import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { create, globals } from 'webgpu';
import { infrastructureShader, lineShader, propShader, terrainShader, waterShader } from '../src/shaders';

describe('WGSL programs', () => {
  it('limits beach material to the actual shoreline mask', () => {
    expect(terrainShader).toContain('shoreline = 1.0 - smoothstep');
    expect(terrainShader).toContain('landAt(input.mapUv)');
    expect(terrainShader).not.toContain('if (elevation < 12.0)');
  });

  it('renders suppressed-road geometry as floating dotted connectors', () => {
    expect(infrastructureShader).toContain('structure == 12u && fract(input.roadUv.x / 6.4) > 0.40');
    expect(infrastructureShader).toContain('vec3f(0.96, 0.73, 0.25)');
  });

  it.each([
    ['terrain', terrainShader, ['terrainVertex'], ['terrainFragment']],
    ['water', waterShader, ['waterVertex'], ['waterFragment']],
    ['infrastructure', infrastructureShader, ['infrastructureVertex'], ['infrastructureFragment']],
    ['props', propShader, ['propVertex'], ['propFragment']],
    ['lines', lineShader, ['lineVertex'], ['lineFragment']],
  ])('parses the %s shader and exposes its render entry points', (_name, source, vertexNames, fragmentNames) => {
    const reflection = new WgslReflect(source);
    expect(reflection.entry.vertex.map((entry) => entry.name)).toEqual(vertexNames);
    expect(reflection.entry.fragment.map((entry) => entry.name)).toEqual(fragmentNames);
    expect(reflection.getBindGroups().length).toBeGreaterThan(0);
  });

  it('passes Dawn WebGPU semantic compilation', async () => {
    Object.assign(globalThis, globals);
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    expect(adapter).not.toBeNull();
    if (!adapter) return;
    const device = await adapter.requestDevice();
    const modules = new Map<string, GPUShaderModule>();
    for (const [label, source] of [
      ['terrain', terrainShader], ['water', waterShader], ['infrastructure', infrastructureShader], ['props', propShader], ['lines', lineShader],
    ] as const) {
      const module = device.createShaderModule({ label, code: source });
      modules.set(label, module);
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === 'error');
      expect(errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)).toEqual([]);
    }

    const common = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const layer = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ] });
    const depthStencil: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('infrastructure')!, entryPoint: 'infrastructureVertex', buffers: [{ arrayStride: 52, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' },
        { shaderLocation: 4, offset: 36, format: 'float32' }, { shaderLocation: 5, offset: 40, format: 'float32' },
        { shaderLocation: 6, offset: 44, format: 'float32' }, { shaderLocation: 7, offset: 48, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('infrastructure')!, entryPoint: 'infrastructureFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('terrain')!, entryPoint: 'terrainVertex', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
      fragment: { module: modules.get('terrain')!, entryPoint: 'terrainFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('water')!, entryPoint: 'waterVertex', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
      fragment: { module: modules.get('water')!, entryPoint: 'waterFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('props')!, entryPoint: 'propVertex', buffers: [{ arrayStride: 28, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('props')!, entryPoint: 'propFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('lines')!, entryPoint: 'lineVertex' },
      fragment: { module: modules.get('lines')!, entryPoint: 'lineFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' }, depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'less-equal' },
    })).resolves.toBeDefined();
    device.destroy();
  });
});
