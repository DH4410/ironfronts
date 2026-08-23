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
  let coordinate = vec2i(min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))), min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y))));
  return textureLoad(provinceTexture, coordinate, 0).r;
}

fn surfaceAt(uvInput: vec2f) -> vec4u {
  let uv = wrappedUv(uvInput);
  let dimensions = textureDimensions(surfaceTexture);
  let coordinate = vec2i(min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))), min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y))));
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

fn landAt(uvInput: vec2f) -> f32 { return textureSampleLevel(coastTexture, materialSampler, wrappedUv(uvInput), 0.0).r; }
fn roadAt(uvInput: vec2f) -> vec2f { return textureSampleLevel(roadTexture, materialSampler, wrappedUv(uvInput), 0.0).rg; }
fn waterwayAt(uvInput: vec2f) -> f32 { return textureSampleLevel(waterwayTexture, materialSampler, wrappedUv(uvInput), 0.0).r; }

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
