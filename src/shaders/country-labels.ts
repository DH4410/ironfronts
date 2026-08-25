import { commonWgsl } from './common';

export const countryLabelShader = commonWgsl + /* wgsl */ `
struct CountryLabelRecord { a: vec4f, b: vec4f, c: vec4f };
@group(1) @binding(0) var<storage, read> countryLabels: array<CountryLabelRecord>;
@group(1) @binding(1) var countryLabelAtlas: texture_2d<f32>;
@group(1) @binding(2) var countryLabelSampler: sampler;

struct CountryLabelOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) fogVisibility: f32,
};

@vertex
fn countryLabelVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> CountryLabelOutput {
  let label = countryLabels[instanceIndex];
  let corners = array<vec2f, 6>(
    vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
    vec2f(-0.5, 0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
  );
  let corner = corners[vertexIndex];
  let local = corner * label.a.zw;
  let rotated = vec2f(
    local.x * label.b.x - local.y * label.b.y,
    local.x * label.b.y + local.y * label.b.x,
  );
  let screen = label.a.xy + rotated;
  let ndc = vec2f(screen.x * uniforms.viewport.z * 2.0 - 1.0, 1.0 - screen.y * uniforms.viewport.w * 2.0);
  var output: CountryLabelOutput;
  output.position = vec4f(ndc, 0.0, 1.0);
  output.uv = mix(label.b.zw, label.c.xy, corner + vec2f(0.5));
  output.fogVisibility = 1.0 - horizontalWorldFog(label.c.z);
  return output;
}

@fragment
fn countryLabelFragment(input: CountryLabelOutput) -> @location(0) vec4f {
  let sampled = textureSample(countryLabelAtlas, countryLabelSampler, input.uv);
  let color = vec4f(sampled.rgb, sampled.a * input.fogVisibility);
  if (color.a < 0.01) { discard; }
  return color;
}
`;
