import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { create, globals } from 'webgpu';
import { infrastructureShader, lineShader, propShader, terrainShader, waterShader, waterwayShader } from '../src/shaders';

describe('WGSL programs', () => {
  it('limits beach material to the actual shoreline mask', () => {
    expect(terrainShader).toContain('let shoreline = bankAt(input.mapUv)');
    expect(terrainShader).toContain('landAt(input.mapUv)');
    expect(terrainShader).not.toContain('if (elevation < 12.0)');
  });

  it('clips terrain around widened visual-only channels without replacing movement-river ribbons', () => {
    expect(terrainShader).toContain('riverField.r > 0.45 || riverField.g > 0.45');
    expect(waterShader).toContain('if (riverField.r > 0.45)');
    expect(waterShader).toContain('landAt(input.mapUv) >= 0.5 && riverField.g <= 0.45');
    expect(terrainShader).toContain('bankAt(input.mapUv)');
    expect(waterShader).toContain('mix(waterDepthAt(input.mapUv), 0.08, visualRiver)');
    expect(waterShader).toContain('(1.0 - visualRiver * 0.80)');
    expect(waterShader).not.toContain('if (provinceAt(input.mapUv)');
  });

  it('renders suppressed-road geometry as floating dotted connectors', () => {
    expect(infrastructureShader).toContain('dotted && fract(input.roadUv.x / 6.4) > 0.40');
    expect(infrastructureShader).toContain('vec3f(0.96, 0.73, 0.25)');
    expect(infrastructureShader).not.toContain('infrastructureLevel');
    expect(infrastructureShader).not.toContain('corridorId');
  });

  it('advects supplied waterways along dense flow vectors and gives canals the ocean palette', () => {
    expect(waterwayShader).toContain('uniforms.sunTime.w');
    expect(waterwayShader).toContain('let flow = normalize(input.flow');
    expect(waterwayShader).toContain('brokenStreak');
    expect(waterwayShader).toContain('let canal = input.kind > 0.5');
    expect(waterwayShader).toContain('oceanDeep');
    expect(terrainShader).toContain('riverField.r > 0.45');
    expect(terrainShader).toContain('riverField.g > 0.45');
    expect(terrainShader).toContain('debugMode == 6u');
    expect(terrainShader).toContain('debugMode == 9u');
    expect(lineShader).toContain('lineParams.mode == 2u');
  });

  it.each([
    ['terrain', terrainShader, ['terrainVertex'], ['terrainFragment']],
    ['water', waterShader, ['waterVertex'], ['waterFragment']],
    ['waterways', waterwayShader, ['waterwayVertex'], ['waterwayFragment']],
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
      ['terrain', terrainShader], ['water', waterShader], ['waterways', waterwayShader], ['infrastructure', infrastructureShader], ['props', propShader], ['lines', lineShader],
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
      { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const layer = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ] });
    const depthStencil: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('infrastructure')!, entryPoint: 'infrastructureVertex', buffers: [{ arrayStride: 36, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' },
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
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('waterways')!, entryPoint: 'waterwayVertex', buffers: [{ arrayStride: 40, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' },
        { shaderLocation: 2, offset: 20, format: 'float32' }, { shaderLocation: 3, offset: 24, format: 'float32' },
        { shaderLocation: 4, offset: 28, format: 'float32x2' }, { shaderLocation: 5, offset: 36, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('waterways')!, entryPoint: 'waterwayFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
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
