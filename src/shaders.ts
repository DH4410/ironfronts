export const commonWgsl = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4f,
  inverseViewProjection: mat4x4f,
  camera: vec4f,
  sunTime: vec4f,
  viewport: vec4f,
  map: vec4f,
  interaction: vec4f,
  terrainInfo: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var heightTexture: texture_2d<f32>;
@group(0) @binding(2) var surfaceTexture: texture_2d<u32>;
@group(0) @binding(3) var provinceTexture: texture_2d<u32>;
@group(0) @binding(4) var materialTexture: texture_2d_array<f32>;
@group(0) @binding(5) var materialSampler: sampler;
@group(0) @binding(6) var coastTexture: texture_2d<f32>;
@group(0) @binding(7) var roadTexture: texture_2d<f32>;
@group(0) @binding(8) var waterwayTexture: texture_2d<f32>;

fn wrappedUv(uv: vec2f) -> vec2f {
  return vec2f(fract(uv.x + 1.0), clamp(uv.y, 0.0, 0.999999));
}

fn heightAt(uvInput: vec2f) -> f32 {
  let uv = wrappedUv(uvInput);
  let dimensions = vec2i(textureDimensions(heightTexture));
  let position = uv * vec2f(dimensions) - vec2f(0.5);
  let base = vec2i(floor(position));
  let blend = fract(position);
  let x0 = ((base.x % dimensions.x) + dimensions.x) % dimensions.x;
  let x1 = (x0 + 1) % dimensions.x;
  let y0 = clamp(base.y, 0, dimensions.y - 1);
  let y1 = clamp(base.y + 1, 0, dimensions.y - 1);
  let top = mix(textureLoad(heightTexture, vec2i(x0, y0), 0).r, textureLoad(heightTexture, vec2i(x1, y0), 0).r, blend.x);
  let bottom = mix(textureLoad(heightTexture, vec2i(x0, y1), 0).r, textureLoad(heightTexture, vec2i(x1, y1), 0).r, blend.x);
  return mix(top, bottom, blend.y);
}

fn provinceAt(uvInput: vec2f) -> u32 {
  let uv = wrappedUv(uvInput);
  let dimensions = textureDimensions(provinceTexture);
  let coordinate = vec2i(
    min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))),
    min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y)))
  );
  return textureLoad(provinceTexture, coordinate, 0).r;
}

fn surfaceAt(uvInput: vec2f) -> vec4u {
  let uv = wrappedUv(uvInput);
  let dimensions = textureDimensions(surfaceTexture);
  let coordinate = vec2i(
    min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))),
    min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y)))
  );
  return textureLoad(surfaceTexture, coordinate, 0);
}

fn waterDepthAt(uvInput: vec2f) -> f32 {
  let uv = wrappedUv(uvInput);
  let dimensions = vec2i(textureDimensions(surfaceTexture));
  let position = uv * vec2f(dimensions) - vec2f(0.5);
  let base = vec2i(floor(position));
  let blend = fract(position);
  let x0 = ((base.x % dimensions.x) + dimensions.x) % dimensions.x;
  let x1 = (x0 + 1) % dimensions.x;
  let y0 = clamp(base.y, 0, dimensions.y - 1);
  let y1 = clamp(base.y + 1, 0, dimensions.y - 1);
  let top = mix(f32(textureLoad(surfaceTexture, vec2i(x0, y0), 0).b), f32(textureLoad(surfaceTexture, vec2i(x1, y0), 0).b), blend.x);
  let bottom = mix(f32(textureLoad(surfaceTexture, vec2i(x0, y1), 0).b), f32(textureLoad(surfaceTexture, vec2i(x1, y1), 0).b), blend.x);
  return mix(top, bottom, blend.y) / 255.0;
}

fn landAt(uvInput: vec2f) -> f32 {
  return textureSampleLevel(coastTexture, materialSampler, wrappedUv(uvInput), 0.0).r;
}

fn roadAt(uvInput: vec2f) -> vec4f {
  return textureSampleLevel(roadTexture, materialSampler, wrappedUv(uvInput), 0.0);
}

fn waterwayAt(uvInput: vec2f) -> f32 {
  return textureSampleLevel(waterwayTexture, materialSampler, wrappedUv(uvInput), 0.0).r;
}

fn terrainNormal(uv: vec2f) -> vec3f {
  let dimensions = vec2f(textureDimensions(heightTexture));
  let texel = 1.0 / dimensions;
  let left = heightAt(uv - vec2f(texel.x, 0.0));
  let right = heightAt(uv + vec2f(texel.x, 0.0));
  let up = heightAt(uv - vec2f(0.0, texel.y));
  let down = heightAt(uv + vec2f(0.0, texel.y));
  let stepX = uniforms.map.x / dimensions.x;
  let stepZ = uniforms.map.y / dimensions.y;
  return normalize(vec3f((left - right) / (stepX * 2.0), 1.0, (up - down) / (stepZ * 2.0)));
}

fn hashColor(id: u32) -> vec3f {
  let n = f32((id * 1664525u + 1013904223u) & 1023u) / 1023.0;
  return 0.32 + 0.56 * vec3f(fract(n * 1.71), fract(n * 2.37 + 0.21), fract(n * 3.13 + 0.47));
}
`;

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
  if (landAt(input.mapUv) < 0.5) { discard; }
  let provinceId = provinceAt(input.mapUv);

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
  let shoreline = 1.0 - smoothstep(0.78, 0.995, landAt(input.mapUv));
  let beachElevation = 1.0 - smoothstep(5.0, 10.0, elevation);
  baseColor = mix(baseColor, sampleMaterial(7, input.worldPosition, 52.0), shoreline * beachElevation * 0.92);


  let roadData = roadAt(input.mapUv);
  let roadLevel = u32(clamp(round(roadData.b * 5.0), 0.0, 5.0));
  let roadMeta = u32(round(roadData.a * 255.0));
  let roadRole = roadMeta & 3u;
  let roadMaterial = (roadMeta >> 3u) & 7u;
  let roadDistance = distance(uniforms.camera.xyz, input.worldPosition);
  var roadRange = select(select(4800.0, 8000.0, roadLevel >= 2u), 16000.0, roadLevel >= 3u);
  roadRange += f32(roadRole) * 420.0;
  let rangeVisibility = 1.0 - smoothstep(roadRange * 0.82, roadRange, roadDistance);
  let strategicBlend = mix(0.22, 1.0, smoothstep(1500.0, 3300.0, roadDistance));
  let roadCore = roadData.r * rangeVisibility * strategicBlend;
  let roadShoulder = max(0.0, roadData.g - roadData.r * 0.72) * rangeVisibility * 0.48;
  let aggregate = 0.88 + 0.12 * sin(input.worldPosition.x * 0.91 + sin(input.worldPosition.z * 1.37));
  let fieldRoadColors = array<vec3f, 6>(
    vec3f(0.29, 0.235, 0.15), vec3f(0.39, 0.36, 0.30), vec3f(0.30, 0.22, 0.14),
    vec3f(0.34, 0.35, 0.34), vec3f(0.28, 0.29, 0.29), vec3f(0.20, 0.215, 0.22)
  );
  let roadColor = fieldRoadColors[min(roadMaterial, 5u)] * aggregate;
  baseColor = mix(baseColor, mix(baseColor, roadColor, 0.48), roadShoulder);
  baseColor = mix(baseColor, roadColor, roadCore * select(0.66, 0.84, roadLevel >= 2u));

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
    let levelPalette = array<vec3f, 6>(vec3f(0.02), vec3f(0.45, 0.30, 0.16), vec3f(0.69, 0.56, 0.28),
      vec3f(0.78, 0.72, 0.50), vec3f(0.78, 0.50, 0.28), vec3f(0.92, 0.80, 0.38));
    lit = mix(vec3f(0.025), levelPalette[roadLevel], max(roadData.r, roadData.g * 0.42));
  } else if (debugMode == 6u) {
    let rolePalette = array<vec3f, 4>(vec3f(0.34, 0.45, 0.26), vec3f(0.34, 0.62, 0.76), vec3f(0.92, 0.64, 0.20), vec3f(0.78, 0.38, 0.68));
    lit = mix(vec3f(0.025), rolePalette[min(roadRole, 3u)], max(roadData.r, roadData.g * 0.35));
  } else if (debugMode == 7u) {
    lit = mix(vec3f(0.025), fieldRoadColors[min(roadMaterial, 5u)], max(roadData.r, roadData.g * 0.35));
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
  let shorelineDamping = smoothstep(0.008, 0.19, waterDepthAt(uv));
  let waveHeight = (sin(dot(xz, vec2f(0.018, 0.011)) + time * 0.58) * 0.48
    + sin(dot(xz, vec2f(-0.009, 0.024)) - time * 0.43) * 0.31
    + cos(dot(xz, vec2f(0.041, -0.016)) + time * 0.82) * 0.12) * (0.16 + shorelineDamping * 0.84);
  let worldPosition = vec3f(uv.x * uniforms.map.x + copyOffset, 0.35 + waveHeight, uv.y * uniforms.map.y);
  var output: WaterVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.mapUv = uv;
  return output;
}

@fragment
fn waterFragment(input: WaterVertexOutput) -> @location(0) vec4f {
  if (landAt(input.mapUv) >= 0.5 || waterwayAt(input.mapUv) > 0.08) { discard; }
  let time = uniforms.sunTime.w;
  let waveA = sin(input.worldPosition.x * 0.018 + input.worldPosition.z * 0.011 + time * 0.58);
  let waveB = cos(input.worldPosition.x * -0.009 + input.worldPosition.z * 0.024 - time * 0.43);
  let ripple = sin(input.worldPosition.x * 0.071 - input.worldPosition.z * 0.052 + time * 1.17);
  let normal = normalize(vec3f((waveA + waveB * 0.6 + ripple * 0.16) * 0.105, 1.0, (waveA * 0.55 - waveB + ripple * 0.12) * 0.09));
  let viewDirection = normalize(uniforms.camera.xyz - input.worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.5);
  let sun = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 112.0);
  let depth = waterDepthAt(input.mapUv);
  let shelf = smoothstep(0.0, 0.44, depth);
  let shallow = vec3f(0.12, 0.48, 0.52);
  let deep = vec3f(0.025, 0.16, 0.255);
  var color = mix(shallow, deep, shelf);
  color = mix(color, vec3f(0.40, 0.60, 0.63), fresnel * 0.64);
  let foam = (1.0 - smoothstep(0.025, 0.14, depth)) * smoothstep(0.18, 0.88, waveA * 0.5 + 0.5 + ripple * 0.12);
  color = mix(color, vec3f(0.73, 0.82, 0.77), foam * 0.52);
  color += vec3f(1.0, 0.86, 0.61) * sun * (0.34 + ripple * 0.05);
  let fog = smoothstep(4000.0, 12000.0, distance(uniforms.camera.xyz, input.worldPosition));
  return vec4f(mix(color, vec3f(0.58, 0.69, 0.72), fog * 0.8), 0.97);
}
`;

export const waterwayShader = commonWgsl + /* wgsl */ `
struct WaterwayInput {
  @location(0) position: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) kind: f32,
  @location(4) waterwayId: f32,
};

struct WaterwayOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) @interpolate(flat) kind: f32,
  @location(4) visibility: f32,
};

@vertex
fn waterwayVertex(input: WaterwayInput, @builtin(instance_index) instanceIndex: u32) -> WaterwayOutput {
  let copyOffset = f32(i32(instanceIndex) - 1) * uniforms.map.x;
  let worldPosition = input.position + vec3f(copyOffset, 0.0, 0.0);
  var output: WaterwayOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.waterUv = input.waterUv;
  output.edgeFactor = input.edgeFactor;
  output.kind = input.kind;
  output.visibility = 1.0 - smoothstep(7600.0, 9200.0, distance(uniforms.camera.xyz, worldPosition));
  return output;
}

@fragment
fn waterwayFragment(input: WaterwayOutput) -> @location(0) vec4f {
  if (input.visibility < 0.02) { discard; }
  let canal = input.kind > 0.5;
  let grain = fract(sin(dot(floor(input.worldPosition.xz * 0.72), vec2f(12.9898, 78.233))) * 43758.5453);
  let broad = sin(input.worldPosition.x * 0.041 + input.worldPosition.z * 0.029) * 0.5 + 0.5;
  let riverDeep = vec3f(0.035, 0.225, 0.285);
  let riverShallow = vec3f(0.14, 0.48, 0.50);
  let oceanDeep = vec3f(0.022, 0.145, 0.235);
  let oceanShallow = vec3f(0.10, 0.39, 0.46);
  var color = select(mix(riverDeep, riverShallow, input.edgeFactor * 0.76),
    mix(oceanDeep, oceanShallow, input.edgeFactor * 0.58), canal);
  color *= 0.94 + grain * 0.045 + broad * 0.035;
  let normal = normalize(vec3f((broad - 0.5) * 0.035, 1.0, (grain - 0.5) * 0.025));
  let viewDirection = normalize(uniforms.camera.xyz - input.worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.2);
  let sun = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 128.0);
  color = mix(color, vec3f(0.39, 0.59, 0.62), fresnel * 0.42);
  color += vec3f(1.0, 0.84, 0.58) * sun * 0.28;
  let fog = smoothstep(4000.0, 12000.0, distance(uniforms.camera.xyz, input.worldPosition));
  return vec4f(mix(color, vec3f(0.58, 0.69, 0.72), fog * 0.80), input.visibility * 0.985);
}
`;

export const infrastructureShader = commonWgsl + /* wgsl */ `
struct InfrastructureInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) roadUv: vec2f,
  @location(3) level: f32,
  @location(4) role: f32,
  @location(5) surfaceMaterial: f32,
  @location(6) structureMaterial: f32,
  @location(7) corridorId: f32,
};

struct InfrastructureOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) roadUv: vec2f,
  @location(3) @interpolate(flat) level: f32,
  @location(4) @interpolate(flat) role: f32,
  @location(5) @interpolate(flat) surfaceMaterial: f32,
  @location(6) @interpolate(flat) structureMaterial: f32,
  @location(7) visibility: f32,
};

@vertex
fn infrastructureVertex(input: InfrastructureInput, @builtin(instance_index) instanceIndex: u32) -> InfrastructureOutput {
  let copyOffset = f32(i32(instanceIndex) - 1) * uniforms.map.x;
  let worldPosition = input.position + vec3f(copyOffset, 0.0, 0.0);
  let cameraDistance = distance(uniforms.camera.xyz, worldPosition);
  var output: InfrastructureOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.normal = input.normal;
  output.roadUv = input.roadUv;
  output.level = input.level;
  output.role = input.role;
  output.surfaceMaterial = input.surfaceMaterial;
  output.structureMaterial = input.structureMaterial;
  var geometryEnd = select(select(2200.0, 3200.0, input.level > 1.5), 4000.0, input.level > 2.5);
  geometryEnd += input.role * 120.0;
  if (input.structureMaterial > 10.5 && input.structureMaterial < 12.5) {
    geometryEnd = select(8000.0, 16000.0, input.level > 2.5);
  }
  output.visibility = 1.0 - smoothstep(geometryEnd - 650.0, geometryEnd, cameraDistance);
  return output;
}

@fragment
fn infrastructureFragment(input: InfrastructureOutput) -> @location(0) vec4f {
  if (input.visibility < 0.025) { discard; }
  let surface = u32(input.surfaceMaterial + 0.5);
  let structure = u32(input.structureMaterial + 0.5);
  let mapUv = input.worldPosition.xz / uniforms.map.xy;
  if (structure <= 7u && landAt(mapUv) < 0.52) { discard; }
  if (structure == 12u && fract(input.roadUv.x / 6.4) > 0.40) { discard; }
  let grit = fract(sin(dot(floor(input.worldPosition.xz * 2.2), vec2f(12.9898, 78.233))) * 43758.5453);
  let broadWear = sin(input.roadUv.x * 0.78 + sin(input.roadUv.x * 0.17) * 0.7) * 0.5 + 0.5;
  var color = vec3f(0.34, 0.35, 0.34);
  if (structure == 0u) {
    if (surface == 0u) {
      let rutA = 1.0 - smoothstep(0.045, 0.12, abs(input.roadUv.y - 0.43));
      let rutB = 1.0 - smoothstep(0.045, 0.12, abs(input.roadUv.y - 0.57));
      color = mix(vec3f(0.36, 0.285, 0.17), vec3f(0.245, 0.19, 0.115), max(rutA, rutB) * 0.55) * (0.90 + grit * 0.16);
    } else if (surface == 1u) {
      color = mix(vec3f(0.35, 0.33, 0.28), vec3f(0.52, 0.48, 0.39), grit * 0.46);
    } else if (surface == 2u) {
      let plank = smoothstep(0.72, 0.92, fract(input.roadUv.x * 4.8));
      color = mix(vec3f(0.26, 0.18, 0.105), vec3f(0.42, 0.30, 0.16), plank * 0.52 + grit * 0.12);
    } else if (surface == 3u) {
      color = mix(vec3f(0.34, 0.345, 0.33), vec3f(0.48, 0.47, 0.42), grit * 0.42) * (0.94 + broadWear * 0.05);
    } else if (surface == 4u) {
      color = mix(vec3f(0.255, 0.27, 0.275), vec3f(0.39, 0.405, 0.40), grit * 0.30);
    } else {
      color = vec3f(0.175, 0.19, 0.195) * (0.90 + grit * 0.16);
    }
  } else if (structure == 6u) {
    color = mix(vec3f(0.30, 0.255, 0.18), vec3f(0.42, 0.38, 0.28), grit * 0.36);
  } else if (structure == 7u) {
    color = mix(vec3f(0.30, 0.29, 0.265), vec3f(0.46, 0.44, 0.39), grit * 0.48);
  } else if (structure == 8u) {
    color = select(vec3f(0.37, 0.38, 0.365), vec3f(0.34, 0.285, 0.19), surface <= 2u);
  } else if (structure == 9u) {
    color = mix(vec3f(0.35, 0.34, 0.31), vec3f(0.53, 0.50, 0.43), grit * 0.48);
  } else if (structure == 10u) {
    color = vec3f(0.16, 0.18, 0.18) * (0.86 + grit * 0.18);
  } else if (structure == 11u) {
    color = vec3f(0.91, 0.76, 0.38) * (0.92 + grit * 0.08);
  } else if (structure == 12u) {
    color = vec3f(0.96, 0.73, 0.25) * (0.94 + grit * 0.06);
  } else {
    color = vec3f(0.055, 0.065, 0.062);
  }
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, normalize(uniforms.sunTime.xyz)), 0.0);
  let light = 0.48 + normal.y * 0.16 + diffuse * 0.58;
  let fog = smoothstep(3500.0, 11000.0, distance(uniforms.camera.xyz, input.worldPosition));
  color = mix(color * light, vec3f(0.58, 0.69, 0.72), fog * 0.78);
  return vec4f(color, input.visibility);
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
};

fn rotateY(value: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(value.x * c - value.z * s, value.y, value.x * s + value.z * c);
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
    local *= record.a.z;
    angle = record.b.x;
    transformedNormal = rotateY(input.normal, angle);
    if (input.materialPart < 0.5) {
      color = vec3f(0.25, 0.19, 0.12) * record.b.y;
    } else if (record.a.w < 0.5) {
      color = vec3f(0.19, 0.39, 0.19) * record.b.y;
    } else if (record.a.w < 1.5) {
      color = vec3f(0.15, 0.31, 0.23) * record.b.y;
    } else {
      color = vec3f(0.18, 0.43, 0.24) * record.b.y;
    }
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
  return output;
}

@fragment
fn propFragment(input: PropVertexOutput) -> @location(0) vec4f {
  if (input.visibility < 0.03 || input.opacity < 0.03) { discard; }
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, normalize(uniforms.sunTime.xyz)), 0.0);
  let light = 0.42 + normal.y * 0.18 + diffuse * 0.62;
  let distanceToCamera = distance(uniforms.camera.xyz, input.worldPosition);
  let fog = smoothstep(3100.0, 9200.0, distanceToCamera);
  let color = mix(input.color * light, vec3f(0.58, 0.69, 0.72), fog * 0.78);
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
