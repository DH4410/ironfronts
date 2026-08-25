import { commonWgsl } from './common';

export const lineShader = commonWgsl + /* wgsl */ `
struct LineRecord { a: vec4f, b: vec4f };
struct LineParams { count: u32, mode: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> lines: array<LineRecord>;
@group(1) @binding(1) var<uniform> lineParams: LineParams;

struct LineOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) fogVisibility: f32,
};

@vertex
fn lineVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> LineOutput {
  let copyIndex = instanceIndex / lineParams.count;
  let line = lines[instanceIndex % lineParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let uv0 = vec2f(line.a.x / uniforms.map.x, line.a.y / uniforms.map.y);
  let uv1 = vec2f(line.a.z / uniforms.map.x, line.a.w / uniforms.map.y);
  var height0 = 0.0;
  var height1 = 0.0;
  if (lineParams.mode == 0u) {
    height0 = abs(line.b.z) + 0.8;
    height1 = line.b.w + 1.8;
  } else if (lineParams.mode == 1u) {
    height0 = heightAt(uv0) + 1.8;
    height1 = heightAt(uv1) + 1.8;
    if (line.b.x < 0.5) {
      height0 = 1.7;
      height1 = 1.7;
    }
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
  if (line.b.y < 0.5) { color.a *= 0.46; }
  if (lineParams.mode == 0u) {
    let provinceBordersVisible = (lineParams.enabled & 1u) != 0u;
    let countryBordersVisible = (lineParams.enabled & 2u) != 0u;
    let countryBoundary = line.b.z < 0.0;
    if (countryBoundary && countryBordersVisible) {
      widthPixels = 2.65 - nearFactor * 0.58;
      color = vec4f(0.052, 0.067, 0.059, select(0.48, 0.72, line.b.y > 0.5));
    } else if (!provinceBordersVisible) {
      color.a = 0.0;
    }
    if (hovered && (provinceBordersVisible || countryBordersVisible)) {
      widthPixels = max(widthPixels, 2.8);
      color = vec4f(0.96, 0.78, 0.35, 0.96);
    }
  } else if (lineParams.mode == 1u) {
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
  output.fogVisibility = 1.0 - horizontalWorldFog(select(world0.x, world1.x, endpoint == 1u));
  return output;
}

@fragment
fn lineFragment(input: LineOutput) -> @location(0) vec4f {
  let color = vec4f(input.color.rgb, input.color.a * input.fogVisibility);
  if (color.a < 0.002) { discard; }
  return color;
}
`;
