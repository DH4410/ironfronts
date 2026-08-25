import { commonWgsl } from './common';

export const POLITICAL_OVERVIEW_START_ALTITUDE = 3_000;
export const POLITICAL_OVERVIEW_FULL_ALTITUDE = 6_500;
export const POLITICAL_CLOSE_TINT_STRENGTH = 0.1;
export const POLITICAL_OVERVIEW_MAX_STRENGTH = 0.82;
export const POLITICAL_MAP_TINT_STRENGTH = 0.85;

export const terrainShader = commonWgsl + /* wgsl */ `
struct TerrainVertexInput {
  @location(0) grid: vec2f,
  @location(1) skirt: f32,
};

struct TerrainVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) mapUv: vec2f,
  @location(2) chunkUv: vec2f,
};

@vertex
fn terrainVertex(input: TerrainVertexInput, @builtin(instance_index) instanceIndex: u32) -> TerrainVertexOutput {
  let chunksX = u32(uniforms.terrainInfo.x);
  let chunksY = u32(uniforms.terrainInfo.y);
  let chunksPerWorld = chunksX * chunksY;
  let visibleChunk = visibleTerrainChunks[instanceIndex];
  let copyIndex = visibleChunk / chunksPerWorld;
  let chunkIndex = visibleChunk % chunksPerWorld;
  let chunkX = chunkIndex % chunksX;
  let chunkY = chunkIndex / chunksX;
  let mapUv = vec2f(
    (f32(chunkX) + input.grid.x) / f32(chunksX),
    (f32(chunkY) + input.grid.y) / f32(chunksY)
  );
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let worldPosition = vec3f(
    mapUv.x * uniforms.map.x + copyOffset,
    heightAt(mapUv) - input.skirt * 36.0,
    mapUv.y * uniforms.map.y
  );
  var output: TerrainVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.mapUv = mapUv;
  output.chunkUv = input.grid;
  return output;
}

fn sampleMaterial(layer: i32, worldPosition: vec3f, scale: f32) -> vec3f {
  let rawUvA = worldPosition.xz / scale;
  let rawUvB = (worldPosition.xz + vec2f(worldPosition.z * 0.17, worldPosition.x * -0.11)) / (scale * 3.71);
  let tileA = fract(rawUvA * 0.5) * 2.0;
  let tileB = fract(rawUvB * 0.5) * 2.0;
  let uvA = 1.0 - abs(tileA - 1.0);
  let uvB = 1.0 - abs(tileB - 1.0);
  let lod = clamp(log2(max(1.0, uniforms.interaction.y / 430.0)), 0.0, 8.0);
  let detail = textureSampleLevel(materialTexture, materialSampler, uvA, layer, lod).rgb;
  let broadDetail = textureSampleLevel(materialTexture, materialSampler, uvB, layer, max(0.0, lod - 0.7)).rgb;
  return mix(detail, broadDetail, 0.18);
}

@fragment
fn terrainFragment(input: TerrainVertexOutput) -> @location(0) vec4f {
  let bankField = bankFieldAt(input.mapUv);
  if (bankField.r <= 0.5) { discard; }
  let navigation = navigationAt(input.mapUv);
  let riverField = navigation.ba;
  if (riverField.r > 0.45 || riverField.g > 0.45) { discard; }

  let surface = surfaceAt(input.mapUv);
  let terrain = surface.r;
  let biome = surface.g;
  let variation = f32(surface.b) / 255.0;
  let normal = terrainNormal(input.mapUv);
  let slope = 1.0 - normal.y;
  let elevation = input.worldPosition.y;
  let bakedSurface = textureSample(terrainAlbedoTexture, materialSampler, wrappedUv(input.mapUv));
  var baseColor = bakedSurface.rgb;
  if (uniforms.interaction.y < 4500.0) {
    baseColor = sampleMaterial(0, input.worldPosition, 92.0);
    if (biome == 1u || biome == 7u) {
      baseColor = sampleMaterial(2, input.worldPosition, 76.0);
    } else if (biome == 2u && terrain != 3u) {
      baseColor = mix(sampleMaterial(0, input.worldPosition, 90.0), sampleMaterial(1, input.worldPosition, 74.0), 0.48);
    } else if (biome == 6u || biome == 8u) {
      baseColor = mix(sampleMaterial(5, input.worldPosition, 86.0), sampleMaterial(4, input.worldPosition, 68.0), slope * 2.0);
    }

    if (terrain == 1u) {
      baseColor = mix(baseColor, sampleMaterial(4, input.worldPosition, 65.0), clamp(slope * 3.4 + 0.12, 0.0, 0.7));
    } else if (terrain == 2u) {
      let rock = sampleMaterial(4, input.worldPosition, 58.0);
      let snow = sampleMaterial(5, input.worldPosition, 80.0);
      let snowAmount = smoothstep(120.0, 205.0, elevation) * smoothstep(0.58, 0.92, normal.y);
      baseColor = mix(rock, snow, snowAmount);
    } else if (terrain == 3u) {
      baseColor = sampleMaterial(3, input.worldPosition, 70.0);
    } else if (terrain == 4u) {
      baseColor = mix(sampleMaterial(6, input.worldPosition, 54.0), sampleMaterial(1, input.worldPosition, 68.0), 0.22);
    }

    let shoreline = bankField.g * smoothstep(0.50, 0.72, bankField.r);
    let beachElevation = 1.0 - smoothstep(5.0, 10.0, elevation);
    baseColor = mix(baseColor, sampleMaterial(7, input.worldPosition, 52.0), shoreline * beachElevation * 0.92);
    baseColor = mix(baseColor, bakedSurface.rgb, smoothstep(3000.0, 4500.0, uniforms.interaction.y));
  }
  if (terrain == 3u) {
    let forestDistance = distance(uniforms.camera.xyz, input.worldPosition);
    let canopySignal = vec3f(0.115, 0.31, 0.14) * (0.86 + variation * 0.24);
    baseColor = mix(baseColor, canopySignal, smoothstep(1750.0, 3150.0, forestDistance) * 0.78);
  }

  if (uniforms.interaction.z > 0.5 && uniforms.map.w < 0.5) {
    let politicalColor = politicalColorAt(input.mapUv);
    if (politicalColor.a > 0.5) {
      let terrainLuminance = dot(baseColor, vec3f(0.24, 0.68, 0.08));
      let coloredSurface = politicalColor.rgb * (0.62 + terrainLuminance * 0.70);
      let overview = smoothstep(
        ${POLITICAL_OVERVIEW_START_ALTITUDE.toFixed(1)},
        ${POLITICAL_OVERVIEW_FULL_ALTITUDE.toFixed(1)},
        uniforms.camera.y
      );
      let balancedStrength = mix(
        ${POLITICAL_CLOSE_TINT_STRENGTH.toFixed(2)},
        ${POLITICAL_OVERVIEW_MAX_STRENGTH.toFixed(2)},
        overview
      );
      let overlayStrength = select(
        balancedStrength,
        ${POLITICAL_MAP_TINT_STRENGTH.toFixed(2)},
        uniforms.interaction.z > 1.5
      );
      baseColor = mix(baseColor, coloredSurface, overlayStrength);
    }
  }

  let roadData = navigation.rg;
  let roadDistance = distance(uniforms.camera.xyz, input.worldPosition);
  let rangeVisibility = 1.0 - smoothstep(4000.0, 4800.0, roadDistance);
  let strategicBlend = mix(0.22, 1.0, smoothstep(1500.0, 3300.0, roadDistance));
  let roadCore = roadData.r * rangeVisibility * strategicBlend;
  let roadShoulder = max(0.0, roadData.g - roadData.r * 0.72) * rangeVisibility * 0.48;
  let aggregate = 0.88 + 0.12 * sin(input.worldPosition.x * 0.91 + sin(input.worldPosition.z * 1.37));
  let roadColor = vec3f(0.29, 0.235, 0.15) * aggregate;
  baseColor = mix(baseColor, mix(baseColor, roadColor, 0.48), roadShoulder);
  baseColor = mix(baseColor, roadColor, roadCore * 0.66);
  baseColor *= bakedSurface.a;

  baseColor *= 0.92 + variation * 0.14;
  let sunDirection = normalize(uniforms.sunTime.xyz);
  let diffuse = max(dot(normal, sunDirection), 0.0);
  let hemi = 0.46 + normal.y * 0.22;
  var lit = baseColor * (hemi + diffuse * 0.62);
  lit += vec3f(0.12, 0.15, 0.13) * pow(max(dot(normal, normalize(sunDirection + normalize(uniforms.camera.xyz - input.worldPosition))), 0.0), 24.0) * 0.08;

  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 1u) {
    let h = elevation / max(1.0, uniforms.map.z);
    lit = vec3f(h);
  } else if (debugMode == 2u) {
    let palette = array<vec3f, 5>(
      vec3f(0.40, 0.68, 0.32), vec3f(0.67, 0.58, 0.31), vec3f(0.58, 0.57, 0.55),
      vec3f(0.12, 0.42, 0.20), vec3f(0.53, 0.48, 0.43)
    );
    lit = palette[min(terrain, 4u)];
  } else if (debugMode == 3u) {
    lit = hashColor(provinceAt(input.mapUv));
  } else if (debugMode == 4u) {
    lit = normal * 0.5 + 0.5;
  } else if (debugMode == 5u) {
    let steepness = clamp((1.0 - normal.y) * 7.5, 0.0, 1.0);
    lit = mix(vec3f(0.08, 0.31, 0.22), vec3f(0.96, 0.22, 0.08), smoothstep(0.08, 0.82, steepness));
  } else if (debugMode == 6u) {
    let channels = navigation.ba;
    lit = vec3f(0.025, 0.035, 0.038);
    lit = mix(lit, vec3f(0.04, 0.88, 0.98), channels.r);
    lit = mix(lit, vec3f(0.18, 0.48, 0.98), channels.g * (1.0 - channels.r));
  } else if (debugMode == 7u) {
    let coast = landAt(input.mapUv);
    lit = mix(vec3f(0.74, 0.42, 0.16), vec3f(0.16, 0.62, 0.30), smoothstep(0.52, 0.96, coast));
  } else if (debugMode == 8u) {
    let footprint = max(roadData.r, roadData.g * 0.62);
    lit = mix(vec3f(0.025, 0.03, 0.032), mix(vec3f(0.94, 0.62, 0.10), vec3f(0.95, 0.18, 0.08), roadData.r), footprint);
  } else if (debugMode == 9u) {
    let channels = navigation.ba;
    let roadSignal = max(roadData.r, roadData.g * 0.45);
    lit = vec3f(0.15, 0.17, 0.16);
    lit = mix(lit, vec3f(0.96, 0.61, 0.12), roadSignal);
    lit = mix(lit, vec3f(0.02, 0.77, 0.96), channels.r);
    lit = mix(lit, vec3f(0.18, 0.48, 0.98), channels.g * (1.0 - channels.r));
  }

  if (uniforms.terrainInfo.w > 0.5) {
    let grid = min(abs(fract(input.chunkUv.x * 32.0) - 0.5), abs(fract(input.chunkUv.y * 32.0) - 0.5));
    lit = mix(vec3f(0.06, 0.11, 0.1), lit, smoothstep(0.005, 0.035, grid));
  }

  let distanceToCamera = distance(uniforms.camera.xyz, input.worldPosition);
  let fog = smoothstep(3600.0, 11500.0, distanceToCamera);
  let fogColor = vec3f(0.58, 0.69, 0.72);
  let distanceFogged = mix(lit, fogColor, fog * 0.39);
  return vec4f(mix(distanceFogged, worldFogColor(), horizontalWorldFog(input.worldPosition.x)), 1.0);
}
`;
