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
@group(0) @binding(6) var riverTexture: texture_2d<f32>;
@group(0) @binding(7) var coastTexture: texture_2d<f32>;
@group(0) @binding(8) var roadTexture: texture_2d<f32>;

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

fn riverAt(uvInput: vec2f) -> vec4f {
  let uv = wrappedUv(uvInput);
  return textureSampleLevel(riverTexture, materialSampler, uv, 0.0);
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

  if (elevation < 12.0) {
    baseColor = mix(sampleMaterial(7, input.worldPosition, 52.0), baseColor, smoothstep(5.0, 12.0, elevation));
  }


  let riverData = riverAt(input.mapUv);
  let river = riverData.r;
  let wetBank = smoothstep(0.015, 0.62, river) * (1.0 - smoothstep(0.68, 0.99, river));
  baseColor = mix(baseColor, baseColor * vec3f(0.46, 0.57, 0.51), wetBank * 0.68);

  let roadData = roadAt(input.mapUv);
  let roadClass = select(select(0.0, 1.0, roadData.b > 0.42), 2.0, roadData.b > 0.80);
  let roadDistance = distance(uniforms.camera.xyz, input.worldPosition);
  let roadRange = select(select(4200.0, 7000.0, roadClass > 0.5), 16000.0, roadClass > 1.5);
  let rangeVisibility = 1.0 - smoothstep(roadRange * 0.82, roadRange, roadDistance);
  let strategicBlend = mix(0.22, 1.0, smoothstep(1500.0, 3300.0, roadDistance));
  let roadCore = roadData.r * rangeVisibility * strategicBlend * (1.0 - smoothstep(0.12, 0.42, river));
  let roadShoulder = max(0.0, roadData.g - roadData.r * 0.72) * rangeVisibility * 0.48;
  let aggregate = 0.88 + 0.12 * sin(input.worldPosition.x * 0.91 + sin(input.worldPosition.z * 1.37));
  baseColor = mix(baseColor, vec3f(0.29, 0.285, 0.27) * aggregate, roadShoulder);
  baseColor = mix(baseColor, vec3f(0.34, 0.35, 0.34) * aggregate, roadCore * 0.84);

  baseColor *= 0.92 + variation * 0.14;
  let sunDirection = normalize(uniforms.sunTime.xyz);
  let diffuse = max(dot(normal, sunDirection), 0.0);
  let hemi = 0.46 + normal.y * 0.22;
  var lit = baseColor * (hemi + diffuse * 0.62);
  lit += vec3f(0.12, 0.15, 0.13) * pow(max(dot(normal, normalize(sunDirection + normalize(uniforms.camera.xyz - input.worldPosition))), 0.0), 24.0) * 0.08;

  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 0u) {
    let riverCore = smoothstep(0.34, 0.72, river);
    let flow = normalize(riverData.gb * 2.0 - 1.0 + vec2f(0.0001, 0.0));
    let flowWave = sin(dot(input.worldPosition.xz, flow) * 0.16 - uniforms.sunTime.w * 2.1);
    var riverWater = mix(vec3f(0.045, 0.245, 0.30), vec3f(0.13, 0.39, 0.43), flowWave * 0.5 + 0.5);
    let glint = pow(max(dot(reflect(-sunDirection, normal), normalize(uniforms.camera.xyz - input.worldPosition)), 0.0), 48.0);
    riverWater += vec3f(0.88, 0.81, 0.63) * glint * 0.24;
    lit = mix(lit, riverWater, riverCore * 0.94);
  } else if (debugMode == 1u) {
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
    lit = mix(vec3f(0.025), array<vec3f, 3>(vec3f(0.45, 0.38, 0.25), vec3f(0.74, 0.62, 0.30), vec3f(0.94, 0.80, 0.40))[u32(roadClass)], max(roadData.r, roadData.g * 0.42));
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
  if (landAt(input.mapUv) >= 0.5) { discard; }
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

export const riverShader = commonWgsl + /* wgsl */ `
struct RiverVertexInput {
  @location(0) center: vec2f,
  @location(1) offset: vec2f,
  @location(2) bed: f32,
  @location(3) strength: f32,
  @location(4) steepness: f32,
  @location(5) edge: f32,
};

struct RiverOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) edge: f32,
  @location(2) strength: f32,
  @location(3) steepness: f32,
  @location(4) mapUv: vec2f,
};

@vertex
fn riverVertex(input: RiverVertexInput, @builtin(instance_index) instanceIndex: u32) -> RiverOutput {
  let copyOffset = f32(i32(instanceIndex) - 1) * uniforms.map.x;
  let centerWorld = vec3f(input.center.x + copyOffset, input.bed + 0.38, input.center.y);
  let cameraDistance = distance(uniforms.camera.xyz, centerWorld);
  let strategyScale = 1.0 + smoothstep(1500.0, 6800.0, cameraDistance) * 0.72;
  let worldPosition = centerWorld + vec3f(input.offset.x * strategyScale, 0.0, input.offset.y * strategyScale);
  var output: RiverOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.edge = input.edge;
  output.strength = input.strength;
  output.steepness = input.steepness;
  output.mapUv = vec2f((input.center.x + input.offset.x * strategyScale) / uniforms.map.x, (input.center.y + input.offset.y * strategyScale) / uniforms.map.y);
  return output;
}

@fragment
fn riverFragment(input: RiverOutput) -> @location(0) vec4f {
  let coverage = 1.0 - smoothstep(0.72, 1.0, input.edge);
  let time = uniforms.sunTime.w;
  let flowDirection = normalize(riverAt(input.mapUv).gb * 2.0 - 1.0 + vec2f(0.0001, 0.0));
  let crossDirection = vec2f(-flowDirection.y, flowDirection.x);
  let along = dot(input.worldPosition.xz, flowDirection);
  let across = dot(input.worldPosition.xz, crossDirection);
  let flowRipple = sin(along * 0.16 - time * (2.5 + input.steepness * 3.1) + sin(across * 0.045) * 0.52);
  let fineStreak = sin(along * 0.34 - time * 4.2 + sin(across * 0.095) * 0.38);
  let crossRipple = sin(across * 0.072 + along * 0.018 - time * 0.46);
  let surfaceSlope = flowDirection * (flowRipple * 0.052 + fineStreak * 0.018) + crossDirection * crossRipple * 0.024;
  let normal = normalize(vec3f(-surfaceSlope.x, 1.0, -surfaceSlope.y));
  let viewDirection = normalize(uniforms.camera.xyz - input.worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
  let sparkle = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 74.0);
  var color = mix(vec3f(0.055, 0.245, 0.29), vec3f(0.22, 0.50, 0.53), fresnel * 0.68);
  color += vec3f(0.92, 0.84, 0.63) * sparkle * 0.38;
  let bankFoam = smoothstep(0.58, 0.96, input.edge) * (0.42 + fineStreak * 0.13);
  color = mix(color, vec3f(0.65, 0.75, 0.69), bankFoam * 0.34);
  let rapidFoam = input.steepness * smoothstep(0.05, 0.76, fineStreak) * (0.34 + flowRipple * 0.10);
  color = mix(color, vec3f(0.78, 0.84, 0.79), rapidFoam * 0.72);
  let fog = smoothstep(3600.0, 11000.0, distance(uniforms.camera.xyz, input.worldPosition));
  let receivingWaterFade = smoothstep(0.03, 0.62, landAt(input.mapUv));
  return vec4f(mix(color, vec3f(0.58, 0.69, 0.72), fog * 0.78), coverage * receivingWaterFade * (0.90 + input.strength * 0.08));
}
`;

export const infrastructureShader = commonWgsl + /* wgsl */ `
struct InfrastructureInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) roadUv: vec2f,
  @location(3) roadClass: f32,
  @location(4) material: f32,
};

struct InfrastructureOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) roadUv: vec2f,
  @location(3) @interpolate(flat) roadClass: f32,
  @location(4) @interpolate(flat) material: f32,
  @location(5) visibility: f32,
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
  output.roadClass = input.roadClass;
  output.material = input.material;
  output.visibility = 1.0 - smoothstep(2200.0, 4000.0, cameraDistance);
  return output;
}

@fragment
fn infrastructureFragment(input: InfrastructureOutput) -> @location(0) vec4f {
  if (input.visibility < 0.025) { discard; }
  let material = u32(input.material + 0.5);
  let mapUv = input.worldPosition.xz / uniforms.map.xy;
  if (material <= 2u && landAt(mapUv) < 0.52) { discard; }
  let grit = fract(sin(dot(floor(input.worldPosition.xz * 2.2), vec2f(12.9898, 78.233))) * 43758.5453);
  let broadWear = sin(input.roadUv.x * 0.78 + sin(input.roadUv.x * 0.17) * 0.7) * 0.5 + 0.5;
  var color = vec3f(0.34, 0.35, 0.34) * (0.86 + grit * 0.20);
  if (material == 0u) {
    let wheelWear = smoothstep(0.05, 0.20, abs(input.roadUv.y - 0.46)) * (1.0 - smoothstep(0.20, 0.34, abs(input.roadUv.y - 0.46)));
    color *= 0.91 + broadWear * 0.07 + wheelWear * 0.04;
  } else if (material == 1u) {
    color = mix(vec3f(0.31, 0.29, 0.25), vec3f(0.46, 0.42, 0.34), grit * 0.42);
  } else if (material == 2u) {
    color = mix(vec3f(0.25, 0.235, 0.20), vec3f(0.36, 0.33, 0.26), grit);
  } else if (material == 3u) {
    color = mix(vec3f(0.38, 0.37, 0.34), vec3f(0.53, 0.50, 0.43), grit * 0.55);
  } else if (material == 4u) {
    color = mix(vec3f(0.29, 0.31, 0.31), vec3f(0.43, 0.45, 0.43), grit * 0.35);
  } else if (material == 5u) {
    color = vec3f(0.16, 0.18, 0.17) * (0.86 + grit * 0.18);
  } else {
    color = vec3f(0.35, 0.36, 0.35) * (0.87 + grit * 0.18 + broadWear * 0.05);
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
