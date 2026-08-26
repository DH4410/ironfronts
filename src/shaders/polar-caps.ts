import { commonWgsl } from './common';

export const polarCapShader = commonWgsl + /* wgsl */ `
const POLAR_CAP_DEPTH = 2400.0;
const TAU = 6.28318530718;

struct PolarCapInput {
  @location(0) grid: vec2f,
  @location(1) skirt: f32,
};

struct PolarCapOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) mapX: f32,
  @location(2) progress: f32,
  @location(3) @interpolate(flat) side: f32,
};

fn polarField(mapX: f32, progress: f32, side: f32) -> f32 {
  // Circular coordinates make the procedural cap periodic across the
  // horizontal world seam while giving north and south distinct coastlines.
  let angle = mapX / uniforms.map.x * TAU;
  let circle = vec2f(cos(angle), sin(angle));
  let broad = valueNoise(circle * 2.15 + vec2f(progress * 1.75 + side * 7.3, progress * -1.25));
  let medium = valueNoise(circle * 5.4 + vec2f(progress * -3.8, progress * 4.6 + side * 5.1));
  let channel = valueNoise(circle * 8.7 + vec2f(progress * 6.3 + side * 2.9, progress * 3.1));
  let channelCut = smoothstep(0.68, 0.88, channel) * 0.23;
  return broad * 0.66 + medium * 0.34 - channelCut;
}

fn polarIceAmount(mapX: f32, progress: f32, side: f32) -> f32 {
  // The map-facing edge begins as broken shelf and pack ice, then consolidates
  // into a continent-like mass while broad water channels remain visible.
  let shelfGrowth = smoothstep(0.025, 0.32, progress);
  let threshold = mix(0.67, 0.43, shelfGrowth) + smoothstep(0.88, 1.0, progress) * 0.05;
  let shelf = smoothstep(threshold - 0.045, threshold + 0.045, polarField(mapX, progress, side));
  // A guaranteed open-ocean belt separates the generated shelf from the real
  // map, so no procedural ice can be clipped by the gameplay-world boundary.
  return shelf * smoothstep(0.09, 0.18, progress);
}

@vertex
fn polarCapVertex(input: PolarCapInput, @builtin(instance_index) instanceIndex: u32) -> PolarCapOutput {
  let copyIndex = instanceIndex % 3u;
  let sideIndex = instanceIndex / 3u;
  let side = f32(sideIndex);
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let mapX = input.grid.x * uniforms.map.x;
  let worldX = mapX + copyOffset;
  let direction = select(-1.0, 1.0, sideIndex == 1u);
  let boundaryZ = select(0.0, uniforms.map.y, sideIndex == 1u);
  // Eight units of water-only overlap sit beneath the real ocean surface and
  // prevent a raster crack between independently tessellated meshes.
  let worldZ = boundaryZ + direction * (input.grid.y * POLAR_CAP_DEPTH - 8.0);
  let ice = polarIceAmount(mapX, input.grid.y, side);
  let reliefNoise = valueNoise(vec2f(mapX / 185.0 + side * 17.0, input.grid.y * 21.0));
  let iceHeight = 2.2 + ice * (6.0 + reliefNoise * 13.0) * smoothstep(0.02, 0.22, input.grid.y);
  let boundaryUv = vec2f(input.grid.x, select(0.0, 0.999999, sideIndex == 1u));
  let deepWaterBlend = smoothstep(0.0, 0.12, input.grid.y);
  let openWater = mix(1.0 - bankAt(boundaryUv), 1.0, deepWaterBlend);
  let waterHeight = 0.35 + oceanWaveHeight(vec2f(worldX, worldZ), openWater);
  let worldY = mix(waterHeight, iceHeight, ice);
  let worldPosition = vec3f(worldX, worldY, worldZ);

  var output: PolarCapOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.mapX = mapX;
  output.progress = input.grid.y;
  output.side = side;
  return output;
}

@fragment
fn polarCapFragment(input: PolarCapOutput) -> @location(0) vec4f {
  let ice = polarIceAmount(input.mapX, input.progress, input.side);
  let boundaryUv = vec2f(input.mapX / uniforms.map.x, select(0.0, 0.999999, input.side > 0.5));
  let deepWaterBlend = smoothstep(0.0, 0.12, input.progress);
  let waterDepth = mix(waterDepthAt(boundaryUv), 1.0, deepWaterBlend);
  let shoreline = mix(bankAt(boundaryUv), 0.0, deepWaterBlend);
  let water = oceanSurfaceColor(input.worldPosition, waterDepth, shoreline, 0.0);

  let iceGrain = valueNoise(input.worldPosition.xz / 31.0 + vec2f(input.side * 11.0, 0.0));
  let broadIce = valueNoise(input.worldPosition.xz / 230.0 + vec2f(0.0, input.side * 9.0));
  let crevasse = smoothstep(0.70, 0.91, valueNoise(input.worldPosition.xz / 16.0));
  var iceColor = mix(vec3f(0.57, 0.72, 0.76), vec3f(0.88, 0.93, 0.92), broadIce * 0.72 + iceGrain * 0.18);
  iceColor = mix(iceColor, vec3f(0.32, 0.54, 0.63), crevasse * 0.28);
  let iceLight = surfaceLight(vec3f(0.0, 1.0, 0.0));
  var color = mix(water, iceColor * iceLight, ice);
  color = mix(color, color * vec3f(0.74, 0.80, 0.83), uniforms.sky.w * 0.30);

  color = applyOceanDistanceFog(color, input.worldPosition);
  let polarFog = smoothstep(0.62, 0.995, input.progress);
  let worldFog = 1.0 - (1.0 - polarFog) * (1.0 - horizontalWorldFog(input.worldPosition.x));
  return vec4f(mix(color, worldFogColor(), worldFog), 1.0);
}
`;
