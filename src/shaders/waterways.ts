import { commonWgsl } from './common';

export const waterwayShader = commonWgsl + /* wgsl */ `
struct WaterwayInput {
  @location(0) position: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) kind: f32,
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
  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 6u) {
    return select(vec4f(0.02, 0.94, 1.0, 1.0), vec4f(0.98, 0.72, 0.10, 1.0), canal);
  }
  if (debugMode == 9u) {
    return select(vec4f(0.02, 0.78, 0.98, 1.0), vec4f(0.77, 0.42, 0.96, 1.0), canal);
  }
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
