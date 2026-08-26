import { commonWgsl } from './common';

export const waterwayShader = commonWgsl + /* wgsl */ `
struct WaterwayInput {
  @location(0) position: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) kind: f32,
  @location(4) flow: vec2f,
  @location(5) speed: f32,
};

struct WaterwayOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) @interpolate(flat) kind: f32,
  @location(4) visibility: f32,
  @location(5) flow: vec2f,
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
  output.flow = input.flow;
  output.visibility = 1.0 - smoothstep(7600.0, 9200.0, distance(uniforms.camera.xyz, worldPosition));
  return output;
}

@fragment
fn waterwayFragment(input: WaterwayOutput) -> @location(0) vec4f {
  let longitudinalVariation = fwidth(input.waterUv.x);
  if (input.visibility < 0.02) { discard; }
  let mapUv = input.worldPosition.xz / uniforms.map.xy;
  // Once an authored channel has entered broad static water, the ocean/lake
  // pass owns the surface. This removes distant source-graph tails while the
  // near-bank overlap still hides any seam at the mouth.
  if (landAt(mapUv) < 0.5 && bankAt(mapUv) < 0.035) { discard; }
  let canal = input.kind > 0.5;
  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 6u) {
    let worldFog = horizontalWorldFog(input.worldPosition.x);
    return select(vec4f(0.02, 0.94, 1.0, 1.0 - worldFog), vec4f(0.98, 0.72, 0.10, 1.0 - worldFog), canal);
  }
  if (debugMode == 9u) {
    let worldFog = horizontalWorldFog(input.worldPosition.x);
    return select(vec4f(0.02, 0.78, 0.98, 1.0 - worldFog), vec4f(0.77, 0.42, 0.96, 1.0 - worldFog), canal);
  }
  let flow = normalize(input.flow + vec2f(0.00001, 0.0));
  let across = vec2f(-flow.y, flow.x);
  let screenDx = dpdx(input.worldPosition);
  let screenDy = dpdy(input.worldPosition);
  var normal = normalize(cross(screenDy, screenDx));
  if (normal.y < 0.0) { normal = -normal; }
  let depth = 0.08;
  let shelf = smoothstep(0.0, 0.44, depth);
  let coastShallow = vec3f(0.12, 0.48, 0.52);
  let coastDeep = vec3f(0.025, 0.16, 0.255);
  var color = mix(coastShallow, coastDeep, shelf);
  let viewDirection = normalize(uniforms.camera.xyz - input.worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.5);
  let sun = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 112.0);
  color = mix(color, vec3f(0.40, 0.60, 0.63), fresnel * 0.64);
  let foamBreak = valueNoise(input.worldPosition.xz / 11.0);
  let foam = input.edgeFactor * smoothstep(0.54, 0.82, foamBreak);
  color = mix(color, vec3f(0.73, 0.82, 0.77), foam * 0.52);
  color += vec3f(1.0, 0.86, 0.61) * sun * 0.34;

  // River political borders belong to the supplied centerline, not either
  // bank. Sampling beyond both banks makes the line ownership-driven without
  // adding another mutable geometry buffer. Canals and open water never enter
  // this path, and constant-waterUv node caps are excluded with fwidth.
  if (!canal && uniforms.interaction.w > 0.5 && longitudinalVariation > 0.000001) {
    let bankSampleDistance = 14.0;
    let leftCountry = politicalColorAt((input.worldPosition.xz + across * bankSampleDistance) / uniforms.map.xy);
    let rightCountry = politicalColorAt((input.worldPosition.xz - across * bankSampleDistance) / uniforms.map.xy);
    let countriesDiffer = leftCountry.a > 0.0 && rightCountry.a > 0.0
      && abs(leftCountry.a - rightCountry.a) > 0.001;
    let dashVisible = fract(input.waterUv.x) < 0.54;
    if (countriesDiffer && dashVisible) {
      let centerDistance = abs(input.waterUv.y - 0.5);
      let casing = 1.0 - smoothstep(0.075, 0.13, centerDistance);
      let center = 1.0 - smoothstep(0.025, 0.065, centerDistance);
      color = mix(color, vec3f(0.035, 0.047, 0.043), casing * 0.90);
      color = mix(color, vec3f(0.77, 0.71, 0.57), center * 0.86);
    }
  }
  let fog = smoothstep(4000.0, 12000.0, distance(uniforms.camera.xyz, input.worldPosition));
  let worldFog = horizontalWorldFog(input.worldPosition.x);
  let foggedColor = mix(mix(color, vec3f(0.58, 0.69, 0.72), fog * 0.40), worldFogColor(), worldFog);
  return vec4f(foggedColor, input.visibility * 0.985 * (1.0 - worldFog));
}
`;
