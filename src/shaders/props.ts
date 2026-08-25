import { commonWgsl } from './common';

export const propShader = commonWgsl + /* wgsl */ `
struct InstanceRecord { a: vec4f, b: vec4f };
struct InstanceParams { count: u32, kind: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> instances: array<InstanceRecord>;
@group(1) @binding(1) var<uniform> instanceParams: InstanceParams;
@group(1) @binding(2) var<storage, read> visibleInstances: array<u32>;

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
  let visibleInstance = visibleInstances[instanceIndex];
  let copyIndex = visibleInstance / count;
  let record = instances[visibleInstance % count];
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

  if (instanceParams.kind == 0u) {
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
  let worldFog = horizontalWorldFog(input.worldPosition.x);
  let color = mix(mix(albedo * light, vec3f(0.58, 0.69, 0.72), fog * 0.78), worldFogColor(), worldFog);
  return vec4f(color, input.visibility * input.opacity * (1.0 - worldFog));
}
`;
