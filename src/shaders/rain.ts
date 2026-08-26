import { commonWgsl } from './common';

export const rainShader = commonWgsl + /* wgsl */ `
struct RainOutput {
  @builtin(position) position: vec4f,
  @location(0) effectUv: vec2f,
  @location(1) opacity: f32,
  @location(2) depthFade: f32,
  @location(3) impactAge: f32,
  @location(4) @interpolate(flat) effectKind: f32,
  @location(5) @interpolate(flat) landSurface: f32,
};

@vertex
fn rainVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> RainOutput {
  let particleCount = min(1400u, max(400u, u32(ceil(uniforms.viewport.x * uniforms.viewport.y / 2200.0))));
  let gridWidth = u32(ceil(sqrt(f32(particleCount))));
  let gridPosition = vec2f(f32(instanceIndex % gridWidth), f32(instanceIndex / gridWidth));
  let id = f32(instanceIndex);
  let seedX = noiseHash(vec2f(id * 0.7549 + 13.1, id * 0.173 + 7.7));
  let seedZ = noiseHash(vec2f(id * 0.317 + 31.7, id * 0.911 + 2.3));
  let seedFall = noiseHash(vec2f(id * 0.127 + 5.9, id * 0.619 + 19.1));
  let seedShape = noiseHash(vec2f(id * 0.431 + 3.4, id * 0.267 + 41.3));

  let farHomogeneous = uniforms.inverseViewProjection * vec4f(0.0, 0.0, 1.0, 1.0);
  let farWorld = farHomogeneous.xyz / farHomogeneous.w;
  let viewDirection = normalize(farWorld - uniforms.camera.xyz);
  let horizontalForward = normalize(viewDirection.xz + vec2f(0.00001, 0.0));
  let fieldRadius = clamp(uniforms.camera.y * 0.58, 190.0, 4300.0);
  let fieldCenter = uniforms.camera.xz + horizontalForward * fieldRadius * 0.30;
  let cellSpacing = fieldRadius * 2.0 / f32(gridWidth);
  let originCell = floor((fieldCenter - vec2f(fieldRadius)) / cellSpacing);
  let worldCell = originCell + gridPosition;
  let worldXZ = (worldCell + vec2f(seedX, seedZ)) * cellSpacing;
  let mapUv = worldXZ / uniforms.map.xy;
  let ground = heightAt(mapUv);

  // Keep precipitation distributed through the visible atmosphere instead of
  // leaving a thin, unreadable sheet near the ground at strategic altitude.
  let columnHeight = clamp(uniforms.camera.y * 0.90, 125.0, 6000.0);
  let speed = mix(145.0, 245.0, seedShape);
  let fall = 1.0 - fract(seedFall + uniforms.sunTime.w * speed / columnHeight);
  let dropBottom = ground + fall * columnHeight;
  // A streak represents motion blur rather than the physical drop itself.
  // Scale that exposure length with altitude so it retains a legible screen
  // footprint while its endpoints and occlusion remain genuinely world-space.
  let strategicLengthScale = clamp(uniforms.camera.y / 275.0, 1.0, 12.0);
  let streakLength = mix(7.0, 15.0, seedShape) * strategicLengthScale;
  let wind = vec2f(-0.16, 0.055) * streakLength;
  let topWorld = vec3f(worldXZ.x - wind.x, dropBottom + streakLength, worldXZ.y - wind.y);
  let bottomWorld = vec3f(worldXZ.x, dropBottom, worldXZ.y);
  let topClip = uniforms.viewProjection * vec4f(topWorld, 1.0);
  let bottomClip = uniforms.viewProjection * vec4f(bottomWorld, 1.0);

  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let impact = instanceIndex % 9u == 0u;
  let cameraDistance = distance(uniforms.camera.xz, worldXZ);
  let rangeVisibility = 1.0 - smoothstep(fieldRadius * 0.72, fieldRadius * 1.06, cameraDistance);
  let strategicReadability = mix(1.0, 1.28, smoothstep(300.0, 5200.0, uniforms.camera.y));

  var output: RainOutput;
  output.effectUv = corner;
  output.impactAge = 0.0;
  output.effectKind = select(0.0, 1.0, impact);
  output.landSurface = 1.0;

  if (impact) {
    let impactAge = clamp(1.0 - fall / 0.16, 0.0, 1.0);
    let impactSize = mix(0.55, 2.7, impactAge);
    let impactPosition = vec3f(
      worldXZ.x + corner.x * impactSize,
      ground + 0.48,
      worldXZ.y + corner.y * impactSize
    );
    output.position = uniforms.viewProjection * vec4f(impactPosition, 1.0);
    output.opacity = uniforms.sky.w * rangeVisibility
      * (1.0 - smoothstep(1250.0, 2750.0, uniforms.camera.y))
      * select(0.0, 1.0, impactAge > 0.0);
    output.depthFade = 1.0;
    output.impactAge = impactAge;
    output.landSurface = landAt(mapUv);
  } else {
    let topNdc = topClip.xy / topClip.w;
    let bottomNdc = bottomClip.xy / bottomClip.w;
    let projectedDirection = normalize(bottomNdc - topNdc + vec2f(0.000001, 0.0));
    let screenNormal = vec2f(-projectedDirection.y, projectedDirection.x);
    let endpoint = select(0.0, 1.0, corner.y > 0.0);
    let clip = mix(topClip, bottomClip, endpoint);
    let widthPixels = mix(0.45, 0.88, seedShape);
    let pixelOffset = screenNormal * corner.x * widthPixels * 2.0 / uniforms.viewport.xy;
    output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
    output.opacity = uniforms.sky.w * strategicReadability * rangeVisibility
      * smoothstep(0.015, 0.075, fall) * mix(0.30, 0.54, seedShape);
    output.depthFade = mix(1.0, 0.72, clamp(cameraDistance / fieldRadius, 0.0, 1.0));
  }
  return output;
}

@fragment
fn rainFragment(input: RainOutput) -> @location(0) vec4f {
  let rainColor = mix(vec3f(0.56, 0.64, 0.70), vec3f(0.79, 0.85, 0.86), uniforms.lighting.x);
  if (input.effectKind < 0.5) {
    let across = 1.0 - smoothstep(0.30, 1.0, abs(input.effectUv.x));
    let along = 1.0 - smoothstep(0.72, 1.0, abs(input.effectUv.y));
    let alpha = across * along * input.opacity;
    if (alpha < 0.008) { discard; }
    return vec4f(rainColor * input.depthFade, alpha);
  }

  let radius = length(input.effectUv);
  let ringRadius = mix(0.18, 0.78, input.impactAge);
  let ring = 1.0 - smoothstep(0.07, 0.17, abs(radius - ringRadius));
  let centerKick = (1.0 - smoothstep(0.0, 0.22, radius)) * (1.0 - input.impactAge);
  let alpha = (ring * 0.58 + centerKick) * input.opacity * (1.0 - input.impactAge * 0.34);
  if (alpha < 0.008) { discard; }
  let waterImpact = vec3f(0.50, 0.69, 0.78);
  let landImpact = vec3f(0.72, 0.76, 0.72);
  return vec4f(mix(waterImpact, landImpact, smoothstep(0.42, 0.62, input.landSurface)), alpha);
}
`;
