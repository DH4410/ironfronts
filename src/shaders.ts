import { commonWgsl } from './shaders/common';
export { commonWgsl } from './shaders/common';
export { infrastructureShader } from './shaders/infrastructure';
export { waterwayShader } from './shaders/waterways';

export const terrainShader = commonWgsl + /* wgsl */ `
struct TerrainVertexInput {
  @location(0) grid: vec2f,
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
  let copyIndex = instanceIndex / chunksPerWorld;
  let chunkIndex = instanceIndex % chunksPerWorld;
  let chunkX = chunkIndex % chunksX;
  let chunkY = chunkIndex / chunksX;
  let mapUv = vec2f(
    (f32(chunkX) + input.grid.x) / f32(chunksX),
    (f32(chunkY) + input.grid.y) / f32(chunksY)
  );
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let worldPosition = vec3f(
    mapUv.x * uniforms.map.x + copyOffset,
    heightAt(mapUv),
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
  let provinceId = provinceAt(input.mapUv);
  // Movement rivers carry an explicit ribbon clip mask. Visual-only rivers
  // remain generic water, but their second mask channel expands only narrow
  // province-zero channels so coarse terrain cannot bridge over them.
  let riverField = waterwayFieldAt(input.mapUv);
  if (landAt(input.mapUv) <= 0.5 || riverField.r > 0.45 || riverField.g > 0.45) { discard; }

  let surface = surfaceAt(input.mapUv);
  let terrain = surface.r;
  let biome = surface.g;
  let variation = f32(surface.b) / 255.0;
  let normal = terrainNormal(input.mapUv);
  let slope = 1.0 - normal.y;
  let elevation = input.worldPosition.y;

  var baseColor = sampleMaterial(0, input.worldPosition, 92.0);
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
    let forestDistance = distance(uniforms.camera.xyz, input.worldPosition);
    let canopySignal = vec3f(0.115, 0.31, 0.14) * (0.86 + variation * 0.24);
    baseColor = mix(baseColor, canopySignal, smoothstep(1750.0, 3150.0, forestDistance) * 0.78);
  } else if (terrain == 4u) {
    baseColor = mix(sampleMaterial(6, input.worldPosition, 54.0), sampleMaterial(1, input.worldPosition, 68.0), 0.22);
  }

  // Beaches follow the actual land/water boundary. Low inland terrain is not
  // coastal and must retain its biome material (the old elevation-only test
  // turned most of Africa and Iberia into sand).
  let shoreline = bankAt(input.mapUv) * smoothstep(0.50, 0.72, landAt(input.mapUv));
  let beachElevation = 1.0 - smoothstep(5.0, 10.0, elevation);
  baseColor = mix(baseColor, sampleMaterial(7, input.worldPosition, 52.0), shoreline * beachElevation * 0.92);


  let roadData = roadAt(input.mapUv);
  let roadDistance = distance(uniforms.camera.xyz, input.worldPosition);
  let rangeVisibility = 1.0 - smoothstep(4000.0, 4800.0, roadDistance);
  let strategicBlend = mix(0.22, 1.0, smoothstep(1500.0, 3300.0, roadDistance));
  let roadCore = roadData.r * rangeVisibility * strategicBlend;
  let roadShoulder = max(0.0, roadData.g - roadData.r * 0.72) * rangeVisibility * 0.48;
  let aggregate = 0.88 + 0.12 * sin(input.worldPosition.x * 0.91 + sin(input.worldPosition.z * 1.37));
  let roadColor = vec3f(0.29, 0.235, 0.15) * aggregate;
  baseColor = mix(baseColor, mix(baseColor, roadColor, 0.48), roadShoulder);
  baseColor = mix(baseColor, roadColor, roadCore * 0.66);

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
    lit = hashColor(provinceId);
  } else if (debugMode == 4u) {
    lit = normal * 0.5 + 0.5;
  } else if (debugMode == 5u) {
    let steepness = clamp((1.0 - normal.y) * 7.5, 0.0, 1.0);
    lit = mix(vec3f(0.08, 0.31, 0.22), vec3f(0.96, 0.22, 0.08), smoothstep(0.08, 0.82, steepness));
  } else if (debugMode == 6u) {
    let channels = waterwayFieldAt(input.mapUv);
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
    let channels = waterwayFieldAt(input.mapUv);
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
  return vec4f(mix(lit, fogColor, fog * 0.78), 1.0);
}
`;

export const waterShader = commonWgsl + /* wgsl */ `
struct WaterVertexInput {
  @location(0) grid: vec2f,
};

struct WaterVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) mapUv: vec2f,
};

@vertex
fn waterVertex(input: WaterVertexInput, @builtin(instance_index) instanceIndex: u32) -> WaterVertexOutput {
  let chunksX = u32(uniforms.terrainInfo.x);
  let chunksY = u32(uniforms.terrainInfo.y);
  let chunksPerWorld = chunksX * chunksY;
  let copyIndex = instanceIndex / chunksPerWorld;
  let chunkIndex = instanceIndex % chunksPerWorld;
  let chunkX = chunkIndex % chunksX;
  let chunkY = chunkIndex / chunksX;
  let uv = vec2f((f32(chunkX) + input.grid.x) / f32(chunksX), (f32(chunkY) + input.grid.y) / f32(chunksY));
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let xz = vec2f(uv.x * uniforms.map.x + copyOffset, uv.y * uniforms.map.y);
  let time = uniforms.sunTime.w;
  let openWater = 1.0 - bankAt(uv);
  let windWarp = valueNoise(xz / 920.0 + vec2f(time * 0.006, -time * 0.004)) - 0.5;
  let directionA = normalize(vec2f(0.88 + windWarp * 0.42, 0.47 - windWarp * 0.28));
  let directionB = normalize(vec2f(-0.31 + windWarp * 0.22, 0.95));
  let packet = 0.68 + valueNoise(xz / 310.0 - vec2f(time * 0.018, time * 0.011)) * 0.42;
  let waveHeight = (sin(dot(xz, directionA) * 0.014 + time * (0.47 + windWarp * 0.08)) * 0.42
    + sin(dot(xz, directionB) * 0.026 - time * 0.39 + windWarp * 2.1) * 0.24
    + sin(dot(xz, normalize(directionA + directionB * 0.37)) * 0.061 + time * 0.83) * 0.08)
    * packet * mix(0.09, 1.0, openWater);
  let worldPosition = vec3f(uv.x * uniforms.map.x + copyOffset, 0.35 + waveHeight, uv.y * uniforms.map.y);
  var output: WaterVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.mapUv = uv;
  return output;
}

@fragment
fn waterFragment(input: WaterVertexOutput) -> @location(0) vec4f {
  let riverField = waterwayFieldAt(input.mapUv);
  if (riverField.r > 0.45) { discard; }
  if (landAt(input.mapUv) >= 0.5 && riverField.g <= 0.45) { discard; }
  let visualRiver = smoothstep(0.18, 0.72, riverField.g);
  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 6u) {
    return vec4f(mix(vec3f(0.012, 0.025, 0.032), vec3f(0.18, 0.48, 0.98), visualRiver), 1.0);
  }
  if (debugMode == 7u) {
    let depthDebug = mix(waterDepthAt(input.mapUv), 0.08, visualRiver);
    return vec4f(mix(vec3f(0.16, 0.66, 0.82), vec3f(0.015, 0.11, 0.28), depthDebug), 1.0);
  }
  if (debugMode == 9u) {
    return vec4f(mix(vec3f(0.025, 0.12, 0.25), vec3f(0.18, 0.48, 0.98), visualRiver), 1.0);
  }
  let time = uniforms.sunTime.w;
  let world = input.worldPosition.xz;
  let warp = vec2f(valueNoise(world / 175.0 + vec2f(time * 0.025, -time * 0.017)),
    valueNoise(world / 243.0 + vec2f(-time * 0.013, time * 0.021))) - 0.5;
  let waveA = sin(dot(world + warp * 36.0, normalize(vec2f(0.86, 0.51))) * 0.019 + time * 0.53);
  let waveB = sin(dot(world - warp * 24.0, normalize(vec2f(-0.28, 0.96))) * 0.034 - time * 0.41);
  let rippleNoise = valueNoise(world / 19.0 + warp * 1.7 + vec2f(time * 0.11, -time * 0.07));
  let ripple = rippleNoise * 2.0 - 1.0;
  let normal = normalize(vec3f((waveA * 0.78 + waveB * 0.41 + ripple * 0.22) * 0.105, 1.0,
    (waveA * 0.38 - waveB * 0.82 + ripple * 0.19) * 0.09));
  let viewDirection = normalize(uniforms.camera.xyz - input.worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.5);
  let sun = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 112.0);
  let depth = mix(waterDepthAt(input.mapUv), 0.08, visualRiver);
  let shelf = smoothstep(0.0, 0.44, depth);
  let shallow = vec3f(0.12, 0.48, 0.52);
  let deep = vec3f(0.025, 0.16, 0.255);
  var color = mix(shallow, deep, shelf);
  color = mix(color, vec3f(0.40, 0.60, 0.63), fresnel * 0.64);
  let foamBreak = valueNoise(world / 11.0 + warp * 2.4 + vec2f(time * 0.15, -time * 0.09));
  let foam = bankAt(input.mapUv) * (1.0 - visualRiver * 0.80) * smoothstep(0.54, 0.82, foamBreak + waveA * 0.12);
  color = mix(color, vec3f(0.73, 0.82, 0.77), foam * 0.52);
  color += vec3f(1.0, 0.86, 0.61) * sun * (0.34 + ripple * 0.05);
  let fog = smoothstep(4000.0, 12000.0, distance(uniforms.camera.xyz, input.worldPosition));
  return vec4f(mix(color, vec3f(0.58, 0.69, 0.72), fog * 0.8), 0.97);
}
`;

export const propShader = commonWgsl + /* wgsl */ `
struct InstanceRecord { a: vec4f, b: vec4f };
struct InstanceParams { count: u32, kind: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> instances: array<InstanceRecord>;
@group(1) @binding(1) var<uniform> instanceParams: InstanceParams;

struct PropVertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) materialPart: f32,
};

struct PropVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) visibility: f32,
  @location(4) opacity: f32,
  @location(5) materialUv: vec2f,
  @location(6) treeMaterialLayer: f32,
};

fn rotateY(value: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(value.x * c - value.z * s, value.y, value.x * s + value.z * c);
}

fn treePartCenter(variant: u32, part: u32) -> vec3f {
  if (part == 0u) { return vec3f(0.0); }
  if (variant == 0u) {
    if (part == 1u) { return vec3f(-1.55, 6.55, 0.15); }
    if (part == 2u) { return vec3f(1.40, 6.85, -0.45); }
    return vec3f(0.0, 8.25, 0.20);
  }
  if (variant == 1u) {
    if (part == 1u) { return vec3f(0.0, 6.25, 0.0); }
    if (part == 2u) { return vec3f(-0.22, 8.05, 0.18); }
    return vec3f(0.18, 9.65, -0.12);
  }
  if (variant == 2u) {
    if (part == 4u) { return vec3f(0.0, 5.0, 0.0); }
    if (part == 5u) { return vec3f(0.0, 7.35, 0.0); }
    return vec3f(0.0, 9.45, 0.0);
  }
  if (variant == 3u) {
    if (part == 1u) { return vec3f(-2.05, 6.15, 0.15); }
    if (part == 2u) { return vec3f(1.90, 6.35, -0.40); }
    return vec3f(0.0, 7.05, 0.45);
  }
  if (part == 1u) { return vec3f(-0.62, 4.45, 0.10); }
  if (part == 2u) { return vec3f(0.68, 5.05, -0.12); }
  return vec3f(0.0, 5.55, 0.20);
}

fn treePartScale(variant: u32, part: u32) -> vec3f {
  if (part == 0u) {
    if (variant == 0u) { return vec3f(0.62, 4.55, 0.62); }
    if (variant == 1u) { return vec3f(0.48, 5.45, 0.48); }
    if (variant == 2u) { return vec3f(0.50, 5.80, 0.50); }
    if (variant == 3u) { return vec3f(0.72, 4.05, 0.72); }
    return vec3f(0.36, 3.25, 0.36);
  }
  if (variant == 0u) {
    if (part == 1u) { return vec3f(2.45, 2.55, 2.25); }
    if (part == 2u) { return vec3f(2.30, 2.40, 2.15); }
    return vec3f(2.70, 2.65, 2.45);
  }
  if (variant == 1u) {
    if (part == 1u) { return vec3f(1.75, 2.55, 1.65); }
    if (part == 2u) { return vec3f(1.62, 2.45, 1.55); }
    return vec3f(1.42, 2.10, 1.38);
  }
  if (variant == 2u) {
    if (part == 4u) { return vec3f(3.15, 3.00, 3.15); }
    if (part == 5u) { return vec3f(2.55, 2.75, 2.55); }
    return vec3f(1.85, 2.45, 1.85);
  }
  if (variant == 3u) {
    if (part == 1u) { return vec3f(3.05, 1.55, 2.40); }
    if (part == 2u) { return vec3f(2.95, 1.65, 2.45); }
    return vec3f(3.25, 1.75, 2.65);
  }
  if (part == 1u) { return vec3f(1.25, 1.42, 1.18); }
  if (part == 2u) { return vec3f(1.42, 1.55, 1.32); }
  return vec3f(1.05, 1.20, 1.00);
}

fn treePartVisible(variant: u32, part: u32) -> bool {
  if (part == 0u) { return true; }
  if (variant == 2u) { return part >= 4u; }
  if (part >= 4u) { return false; }
  return variant != 4u || part < 3u;
}

fn treeMaterialUv(position: vec3f, normal: vec3f, bark: bool) -> vec2f {
  let absoluteNormal = abs(normal);
  if (bark) {
    if (absoluteNormal.y > 0.75) { return position.xz + 0.5; }
    let across = select(position.x, position.z, absoluteNormal.x > absoluteNormal.z);
    return vec2f(across + 0.5, position.y * 2.0);
  }
  if (absoluteNormal.y > absoluteNormal.x && absoluteNormal.y > absoluteNormal.z) {
    return position.xz * 0.55 + 0.5;
  }
  if (absoluteNormal.x > absoluteNormal.z) { return position.zy * 0.55 + 0.5; }
  return position.xy * 0.55 + 0.5;
}

@vertex
fn propVertex(input: PropVertexInput, @builtin(instance_index) instanceIndex: u32) -> PropVertexOutput {
  let count = instanceParams.count;
  let copyIndex = instanceIndex / count;
  let record = instances[instanceIndex % count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let mapUv = vec2f(record.a.x / uniforms.map.x, record.a.y / uniforms.map.y);
  let ground = heightAt(mapUv);
  var local = input.position;
  var color = vec3f(0.28, 0.36, 0.22);
  var angle = 0.0;
  var transformedNormal = input.normal;
  var opacity = 1.0;
  var materialUv = vec2f(0.0);
  var treeMaterialLayer = -1.0;

  if (input.materialPart > 8.5) {
    angle = select(record.b.y, record.b.x, instanceParams.kind == 0u);
    if (instanceParams.kind == 0u) {
      local = vec3f(local.x * record.a.z * 4.1, 0.32, local.z * record.a.z * 4.1);
    } else {
      local = vec3f(local.x * record.a.z * 0.94, 0.32, local.z * record.b.x * 0.94);
    }
    color = vec3f(0.035, 0.047, 0.042);
    transformedNormal = vec3f(0.0, 1.0, 0.0);
    opacity = 0.20;
  } else if (instanceParams.kind == 0u) {
    let variant = min(u32(record.a.w + 0.5), 4u);
    let part = u32(input.materialPart + 0.5);
    let partScale = treePartScale(variant, part);
    local = (local * partScale + treePartCenter(variant, part)) * record.a.z;
    angle = record.b.x;
    transformedNormal = rotateY(normalize(input.normal / max(partScale, vec3f(0.001))), angle);
    opacity = select(0.0, 1.0, treePartVisible(variant, part));
    color = vec3f(record.b.y);
    materialUv = treeMaterialUv(input.position, input.normal, part == 0u);
    treeMaterialLayer = select(clamp(record.b.w, 0.0, 1.0), 2.0, part == 0u);
  } else if (instanceParams.kind == 1u) {
    let archetype = u32(record.b.w + 0.5);
    let palette = u32(floor(record.b.z));
    let tint = fract(record.b.z);
    if (input.materialPart > 1.5 && input.materialPart < 2.5 && archetype != 3u) { opacity = 0.0; }
    if (input.materialPart > 2.5 && input.materialPart < 3.5 && archetype != 4u) { opacity = 0.0; }
    if (input.materialPart > 3.5 && input.materialPart < 4.5 && archetype != 1u) { opacity = 0.0; }
    if (input.materialPart > 4.5 && input.materialPart < 5.5 && archetype != 2u) { opacity = 0.0; }
    if (input.materialPart > 0.5 && input.materialPart < 1.5 && (archetype == 1u || archetype == 2u)) { opacity = 0.0; }
    if (archetype == 2u && input.materialPart > 0.5 && input.materialPart < 1.5) {
      local.y = 1.0 + (local.y - 1.0) * 0.16;
    } else if (archetype == 3u && input.materialPart > 0.5 && input.materialPart < 1.5) {
      local.y = 1.0 + (local.y - 1.0) * 0.42;
    }
    local *= vec3f(record.a.z, record.a.w, record.b.x);
    angle = record.b.y;
    transformedNormal = rotateY(input.normal, angle);
    let wallPalette = array<vec3f, 4>(
      vec3f(0.47, 0.44, 0.38), vec3f(0.67, 0.57, 0.43),
      vec3f(0.64, 0.59, 0.49), vec3f(0.43, 0.45, 0.43)
    );
    color = wallPalette[min(palette, 3u)] * (0.82 + tint * 0.22);
    if ((input.materialPart > 0.5 && input.materialPart < 1.5) || (input.materialPart > 3.5 && input.materialPart < 5.5)) {
      let roofPalette = array<vec3f, 4>(vec3f(0.25, 0.18, 0.14), vec3f(0.44, 0.31, 0.20), vec3f(0.39, 0.25, 0.18), vec3f(0.22, 0.25, 0.25));
      color = roofPalette[min(palette, 3u)] * (0.86 + tint * 0.12);
    } else if (input.materialPart > 1.5) {
      color = select(vec3f(0.31, 0.32, 0.30), vec3f(0.47, 0.43, 0.35), archetype == 4u);
    }
  } else {
    local *= vec3f(record.a.z, record.a.w, record.b.x);
    angle = record.b.y;
    transformedNormal = rotateY(input.normal, angle);
    if (instanceParams.kind == 2u) {
      color = select(vec3f(0.15, 0.17, 0.16), vec3f(1.0, 0.72, 0.34), input.materialPart > 0.5);
    } else if (instanceParams.kind == 3u) {
      color = select(vec3f(0.25, 0.22, 0.17), vec3f(0.29, 0.31, 0.30), record.b.w < 0.5);
    } else {
      color = select(vec3f(0.24, 0.27, 0.25), vec3f(0.72, 0.62, 0.39), input.materialPart > 0.5);
    }
  }

  local = rotateY(local, angle);
  let worldPosition = vec3f(record.a.x + copyOffset + local.x, ground + local.y, record.a.y + local.z);
  let maximumDistance = select(select(1900.0, 2600.0, instanceParams.kind == 1u), 3200.0, instanceParams.kind == 0u);
  let visibility = 1.0 - smoothstep(maximumDistance * 0.75, maximumDistance, distance(uniforms.camera.xyz, worldPosition));
  var output: PropVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.normal = transformedNormal;
  output.color = color;
  output.visibility = visibility;
  output.opacity = opacity;
  output.materialUv = materialUv;
  output.treeMaterialLayer = treeMaterialLayer;
  return output;
}

@fragment
fn propFragment(input: PropVertexOutput) -> @location(0) vec4f {
  if (input.visibility < 0.03 || input.opacity < 0.03) { discard; }
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, normalize(uniforms.sunTime.xyz)), 0.0);
  let light = 0.42 + normal.y * 0.18 + diffuse * 0.62;
  var albedo = input.color;
  if (input.treeMaterialLayer > -0.5) {
    let materialLod = clamp(log2(max(1.0, distance(uniforms.camera.xyz, input.worldPosition) / 360.0)), 0.0, 8.0);
    var treeMaterial = textureSampleLevel(treeMaterialTexture, materialSampler, input.materialUv, i32(input.treeMaterialLayer + 0.5), materialLod).rgb;
    if (input.treeMaterialLayer < 0.5) {
      treeMaterial = mix(treeMaterial, vec3f(0.20, 0.38, 0.11), 0.32);
    } else if (input.treeMaterialLayer < 1.5) {
      treeMaterial = mix(treeMaterial, vec3f(0.09, 0.24, 0.12), 0.38);
    }
    albedo *= treeMaterial;
  }
  let distanceToCamera = distance(uniforms.camera.xyz, input.worldPosition);
  let fog = smoothstep(3100.0, 9200.0, distanceToCamera);
  let color = mix(albedo * light, vec3f(0.58, 0.69, 0.72), fog * 0.78);
  return vec4f(color, input.visibility * input.opacity);
}
`;

export const lineShader = commonWgsl + /* wgsl */ `
struct LineRecord { a: vec4f, b: vec4f };
struct LineParams { count: u32, mode: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> lines: array<LineRecord>;
@group(1) @binding(1) var<uniform> lineParams: LineParams;

struct LineOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn lineVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> LineOutput {
  let copyIndex = instanceIndex / lineParams.count;
  let line = lines[instanceIndex % lineParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let uv0 = vec2f(line.a.x / uniforms.map.x, line.a.y / uniforms.map.y);
  let uv1 = vec2f(line.a.z / uniforms.map.x, line.a.w / uniforms.map.y);
  var height0 = heightAt(uv0) + 1.8;
  var height1 = heightAt(uv1) + 1.8;
  if (lineParams.mode == 1u && line.b.x < 0.5) {
    height0 = 1.7;
    height1 = 1.7;
  } else if (lineParams.mode == 2u) {
    height0 = line.b.x + 2.35;
    height1 = line.b.y + 2.35;
  }
  let world0 = vec3f(line.a.x + copyOffset, height0, line.a.y);
  let world1 = vec3f(line.a.z + copyOffset, height1, line.a.w);
  let clip0 = uniforms.viewProjection * vec4f(world0, 1.0);
  let clip1 = uniforms.viewProjection * vec4f(world1, 1.0);
  let ndc0 = clip0.xy / clip0.w;
  let ndc1 = clip1.xy / clip1.w;
  let direction = normalize(ndc1 - ndc0 + vec2f(0.000001, 0.0));
  let normal = vec2f(-direction.y, direction.x);

  let endpoint = array<u32, 6>(0u, 1u, 0u, 0u, 1u, 1u)[vertexIndex];
  let side = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0)[vertexIndex];
  let hoverId = uniforms.interaction.x;
  let hovered = hoverId > 0.5 && (abs(line.b.x - hoverId) < 0.5 || abs(line.b.y - hoverId) < 0.5);
  let nearFactor = 1.0 - smoothstep(700.0, 8200.0, uniforms.interaction.y);
  var widthPixels = 0.72 + nearFactor * 0.8;
  var color = vec4f(0.055, 0.085, 0.077, 0.15 + nearFactor * 0.40);
  if (line.b.z < 0.5) { color.a *= 0.46; }
  if (hovered) {
    widthPixels = 2.8;
    color = vec4f(0.96, 0.78, 0.35, 0.96);
  }
  if (lineParams.mode == 1u) {
    widthPixels = 1.1;
    color = select(vec4f(0.19, 0.64, 0.78, 0.68), vec4f(0.80, 0.67, 0.25, 0.72), line.b.x > 0.5);
  } else if (lineParams.mode == 2u) {
    widthPixels = 2.1 + nearFactor * 0.75;
    color = select(vec4f(0.05, 0.91, 1.0, 0.94), vec4f(0.98, 0.71, 0.12, 0.96), line.b.z > 0.5);
  }

  let clip = select(clip0, clip1, endpoint == 1u);
  let pixelOffset = normal * side * widthPixels * 2.0 / uniforms.viewport.xy;
  var output: LineOutput;
  output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
  output.color = color;
  return output;
}

@fragment
fn lineFragment(input: LineOutput) -> @location(0) vec4f {
  return input.color;
}
`;
