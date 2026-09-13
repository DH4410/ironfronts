import { commonWgsl } from './common';

/**
 * Skinned tank model. No texture — the source asset ships baked vertex
 * colors and no UVs, so shading is vertex-color x owner-tint x directional
 * light, the same law the procedural army models use (unpackModelRgb *
 * part.shade) rather than infantry's texture-dominant look.
 */
export const tankModelShader = commonWgsl + /* wgsl */ `
struct ArmyModel { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
struct ArmyModelParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyModels: array<ArmyModel>;
@group(1) @binding(1) var<uniform> armyModelParams: ArmyModelParams;

struct TankAnimationParams {
  clips: array<vec4u, 3>,
  jointCount: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};
@group(2) @binding(0) var<storage, read> tankAnimationFrames: array<mat4x4f>;
@group(2) @binding(1) var<uniform> tankAnimationParams: TankAnimationParams;

fn unpackTankRgb(packed: f32) -> vec3f {
  let value = u32(packed + 0.5);
  return vec3f(f32((value >> 16u) & 255u), f32((value >> 8u) & 255u), f32(value & 255u)) / 255.0;
}

struct TankOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) vertexColor: vec3f,
  @location(2) ownerColor: vec3f,
  @location(3) alpha: f32,
  @location(4) @interpolate(flat) selected: f32,
};

@vertex
fn tankModelVertex(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) joints: vec4u,
  @location(4) weights: vec4f,
  @builtin(instance_index) instanceIndex: u32,
) -> TankOut {
  let copyIndex = instanceIndex / armyModelParams.count;
  let model = armyModels[instanceIndex % armyModelParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let flags = u32(model.b.z + 0.5);
  let moving = (flags & 2u) != 0u;
  let retreating = (flags & 4u) != 0u;
  // 0 idle (held Forward frame), 1 Forward loop, 2 Backwards loop — see
  // tank-model.ts; turning clips are baked into the asset but not wired here.
  var state = 0u;
  if (retreating) {
    state = 2u;
  } else if (moving) {
    state = 1u;
  }
  let clip = tankAnimationParams.clips[state];
  // Distance-phased tracks: the tread cycle advances with ground covered, not
  // wall-clock time, so links plant on the road like the infantry gait does —
  // matching the standing "animation reflects the distance actually walked"
  // requirement. TRACK_PITCH is tuned to this rig's ~20-frame cycle.
  let travel = select(0.0, clamp((uniforms.sunTime.w - model.d.w) / max(model.d.z, 0.0001), 0.0, 1.0), model.d.z > 0.0);
  let TRACK_PITCH = 4.0;
  let cycles = clamp(distance(model.d.xy, model.a.xy) / TRACK_PITCH, 1.0, 60.0);
  let phase = fract(sin(dot(model.a.xy, vec2f(0.01371, 0.01993))) * 43758.5453);
  let frame = u32(floor((travel * cycles + phase) * f32(clip.y))) % max(1u, clip.y);
  let palette = (clip.x + frame) * tankAnimationParams.jointCount;
  let skin = tankAnimationFrames[palette + joints.x] * weights.x
    + tankAnimationFrames[palette + joints.y] * weights.y
    + tankAnimationFrames[palette + joints.z] * weights.z
    + tankAnimationFrames[palette + joints.w] * weights.w;
  let skinnedPosition = skin * vec4f(position, 1.0);
  let skinnedNormal = normalize((skin * vec4f(normal, 0.0)).xyz);

  let motion = smoothstep(0.0, 1.0, (uniforms.sunTime.w - model.c.z) / 0.42);
  var headingDelta = model.b.w - model.c.w;
  headingDelta -= 6.2831853 * round(headingDelta / 6.2831853);
  let heading = model.c.w + headingDelta * motion;
  let cosine = cos(heading);
  let sine = sin(heading);
  // Matches the procedural light/heavy armor halfSize scale (~1.1-1.3 units)
  // at strategic zoom; the source rig is ~15 units long.
  let scale = 0.22;
  // glTF forward is +Z; map heading zero points north (-Z).
  let local = vec3f(skinnedPosition.x, skinnedPosition.y, -skinnedPosition.z) * scale;
  let localNormal = vec3f(skinnedNormal.x, skinnedNormal.y, -skinnedNormal.z);
  let rotated = vec3f(local.x * cosine - local.z * sine, local.y, local.x * sine + local.z * cosine);
  let rotatedNormal = normalize(vec3f(
    localNormal.x * cosine - localNormal.z * sine,
    localNormal.y,
    localNormal.x * sine + localNormal.z * cosine,
  ));
  let centerXZ = mix(model.a.xy, model.d.xy, travel) + vec2f(copyOffset, 0.0);
  let ground = heightAt(centerXZ / uniforms.map.xy);
  let worldPosition = vec3f(centerXZ.x + rotated.x, ground + rotated.y + 0.05, centerXZ.y + rotated.z);
  var output: TankOut;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.normal = rotatedNormal;
  output.vertexColor = color.rgb;
  output.ownerColor = unpackTankRgb(model.a.z);
  output.alpha = (1.0 - smoothstep(1500.0, 1900.0, uniforms.interaction.y))
    * (1.0 - horizontalWorldFog(worldPosition.x));
  output.selected = f32(flags & 1u);
  return output;
}

@fragment
fn tankModelFragment(input: TankOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let light = 0.34 + max(dot(normalize(input.normal), normalize(vec3f(-0.45, 0.82, -0.34))), 0.0) * 0.66;
  var color = input.ownerColor * input.vertexColor * light;
  if (input.selected > 0.5) { color = mix(color, vec3f(1.0, 0.84, 0.40), 0.24); }
  return vec4f(color, input.alpha);
}
`;
