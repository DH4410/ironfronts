import { commonWgsl } from './common';

export const COUNTRY_LABEL_FADE_START_ALTITUDE = 600;
export const COUNTRY_LABEL_FADE_END_ALTITUDE = 250;

export const countryLabelShader = commonWgsl + /* wgsl */ `
struct CountryLabelGlyph { a: vec4f, b: vec4f, c: vec4f };
struct CountryLabelParams { glyphCount: u32, worldCopyCount: u32, unused: vec2u };
@group(1) @binding(0) var<storage, read> countryLabelGlyphs: array<CountryLabelGlyph>;
@group(1) @binding(1) var countryLabelAtlas: texture_2d<f32>;
@group(1) @binding(2) var countryLabelSampler: sampler;
@group(1) @binding(3) var<uniform> countryLabelParams: CountryLabelParams;

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
  let glyphIndex = instanceIndex % countryLabelParams.glyphCount;
  let copyIndex = instanceIndex / countryLabelParams.glyphCount;
  let glyph = countryLabelGlyphs[glyphIndex];
  let corners = array<vec2f, 6>(
    vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
    vec2f(-0.5, 0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
  );
  let corner = corners[vertexIndex];
  let local = corner * glyph.b.xy;
  let tangent = glyph.a.zw;
  let crossAxis = vec2f(-tangent.y, tangent.x);
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let worldXZ = glyph.a.xy + tangent * local.x + crossAxis * local.y + vec2f(copyOffset, 0.0);
  let worldPosition = vec3f(worldXZ.x, glyph.c.z, worldXZ.y);
  var output: CountryLabelOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.uv = mix(glyph.b.zw, glyph.c.xy, corner + vec2f(0.5));
  let altitudeVisibility = smoothstep(
    ${COUNTRY_LABEL_FADE_END_ALTITUDE.toFixed(1)},
    ${COUNTRY_LABEL_FADE_START_ALTITUDE.toFixed(1)},
    uniforms.camera.y
  );
  output.fogVisibility = (1.0 - horizontalWorldFog(worldXZ.x)) * altitudeVisibility;
  return output;
}

@fragment
fn countryLabelFragment(input: CountryLabelOutput) -> @location(0) vec4f {
  let sampled = textureSample(countryLabelAtlas, countryLabelSampler, input.uv);
  let readableInk = mix(sampled.rgb, vec3f(0.91, 0.91, 0.83), uniforms.lighting.z * 0.42);
  let color = vec4f(readableInk, sampled.a * input.fogVisibility);
  if (color.a < 0.01) { discard; }
  return color;
}
`;
