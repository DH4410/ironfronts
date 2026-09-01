import { commonWgsl } from './common';

/**
 * World-space instanced combat effects, fed by CombatEffectPool.collect().
 *
 * One `pass.draw(6, N)` billboarded quad per effect. The CPU packs 8 floats
 * per instance:
 *   a = (worldX, worldZ, kind, age01)
 *   b = (seed, scale, intensity, dir)   dir in radians, -999 = none
 *
 * kind: 0 muzzle flash, 1 tracer, 2 projectile, 3 impact, 4 dust, 5 smoke,
 *       6 explosion, 7 target flash, 8 battle marker (age01 = pulse phase).
 *
 * Alpha-blended (same as every other overlay pipeline) — "heat" comes from
 * bright cores and soft edges, not additive accumulation, so an effect over
 * bright terrain still reads and a dense cluster never blows out to white.
 */
export const combatEffectShader = commonWgsl + /* wgsl */ `
struct Effect { a: vec4f, b: vec4f };
struct EffectParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> effects: array<Effect>;
@group(1) @binding(1) var<uniform> effectParams: EffectParams;

struct EffectOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: f32,
  @location(2) @interpolate(flat) age: f32,
  @location(3) @interpolate(flat) seed: f32,
  @location(4) @interpolate(flat) intensity: f32,
  @location(5) @interpolate(flat) dir: f32,
  @location(6) alpha: f32,
};

// Base half-size in pixels for a kind before the per-instance scale + zoom.
fn effectPixelSize(kind: i32) -> f32 {
  switch (kind) {
    case 0: { return 16.0; }   // muzzle flash
    case 1: { return 22.0; }   // tracer
    case 2: { return 7.0; }    // projectile
    case 3: { return 24.0; }   // impact
    case 4: { return 34.0; }   // dust
    case 5: { return 44.0; }   // smoke
    case 6: { return 52.0; }   // explosion
    case 7: { return 30.0; }   // target flash
    default: { return 32.0; }  // battle marker
  }
}

@vertex
fn combatEffectVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> EffectOut {
  let copyIndex = instanceIndex / effectParams.count;
  let effect = effects[instanceIndex % effectParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  let kind = i32(effect.a.z + 0.5);
  let age = clamp(effect.a.w, 0.0, 1.0);
  let dir = effect.b.w;

  // Projectiles / tracers travel from the spawn point along dir over their life.
  var worldXZ = vec2f(effect.a.x, effect.a.y);
  if ((kind == 2 || kind == 1) && dir > -900.0) {
    let travel = select(150.0, 60.0, kind == 1) * age;
    worldXZ += vec2f(cos(dir), sin(dir)) * travel;
  }
  let uvGround = worldXZ / uniforms.map.xy;
  let ground = heightAt(uvGround);
  let rise = select(0.0, age * 26.0, kind == 4 || kind == 5); // dust / smoke drift up
  let worldPos = vec3f(worldXZ.x + copyOffset, ground + 6.0 + rise, worldXZ.y);
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);

  // Grow with age for the puff kinds, snap-then-shrink for the flash kinds.
  var sizeAge = 1.0;
  if (kind == 3 || kind == 6) { sizeAge = mix(0.35, 1.35, sqrt(age)); }
  else if (kind == 4 || kind == 5) { sizeAge = mix(0.5, 1.5, age); }
  else if (kind == 0) { sizeAge = mix(1.2, 0.4, age); }
  else if (kind == 7) { sizeAge = mix(1.6, 0.7, age); }
  else if (kind == 8) { sizeAge = 1.0 + 0.12 * sin(effect.a.w * 6.2831853); }

  let zoom = uniforms.interaction.y;
  let zoomScale = mix(0.7, 1.35, smoothstep(4600.0, 700.0, zoom));
  // viewport.z (backing-store scale) keeps effects a constant CSS size across
  // graphics presets — otherwise a lower render scale inflates them on screen.
  let half = effectPixelSize(kind) * max(0.15, effect.b.y) * sizeAge * zoomScale * uniforms.viewport.z;

  // Fade: transients fade over their life; the battle marker holds (its pulse
  // is size + fragment glow). Everything fades out past strategic zoom.
  let lifeFade = select(1.0 - smoothstep(0.55, 1.0, age), 0.85 + 0.15 * sin(effect.a.w * 6.2831853), kind == 8);
  let zoomFade = 1.0 - smoothstep(4400.0, 5000.0, zoom);

  var output: EffectOut;
  output.uv = corner;
  output.kind = effect.a.z;
  output.age = age;
  output.seed = effect.b.x;
  output.intensity = clamp(effect.b.z, 0.0, 4.0);
  output.dir = dir;
  output.alpha = lifeFade * zoomFade * (1.0 - horizontalWorldFog(worldPos.x));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  let pixelOffset = corner * half * 2.0 / uniforms.viewport.xy;
  output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
  return output;
}

fn softDisc(uv: vec2f, edge: f32) -> f32 {
  return 1.0 - smoothstep(edge, 1.0, length(uv));
}

fn ring(uv: vec2f, radius: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(width, width * 2.4, abs(length(uv) - radius));
}

@fragment
fn combatEffectFragment(input: EffectOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv;
  let kind = i32(input.kind + 0.5);
  let r = length(uv);
  if (r > 1.02 && kind != 1) { discard; }

  var rgb = vec3f(0.0);
  var a = 0.0;

  if (kind == 0) {                        // muzzle flash — hot star
    let core = softDisc(uv, 0.0) * 1.2;
    let spikes = pow(max(0.0, 1.0 - abs(uv.x) * 6.0), 2.0) + pow(max(0.0, 1.0 - abs(uv.y) * 6.0), 2.0);
    let f = clamp(core + spikes * 0.5, 0.0, 1.0);
    rgb = mix(vec3f(1.0, 0.86, 0.45), vec3f(1.0, 1.0, 0.95), core);
    a = f;
  } else if (kind == 1) {                 // tracer — streak along local x
    let d = abs(uv.y) + max(0.0, abs(uv.x) - 0.85) * 4.0;
    a = clamp(1.0 - d * 3.0, 0.0, 1.0) * (0.6 + 0.4 * input.seed);
    rgb = vec3f(1.0, 0.82, 0.42);
  } else if (kind == 2) {                 // projectile — bright dot + tail
    a = softDisc(uv * 1.4, 0.0);
    rgb = vec3f(1.0, 0.9, 0.7);
  } else if (kind == 3) {                 // impact — expanding ring + spark
    a = clamp(ring(uv, 0.7, 0.06) + softDisc(uv * 3.0, 0.0) * 0.7, 0.0, 1.0);
    rgb = vec3f(0.95, 0.93, 0.86);
  } else if (kind == 4) {                 // dust — soft brown puff, billowing
    let n = valueNoise(uv * 3.0 + input.seed * 40.0) * 0.7
          + valueNoise(uv * 6.5 - input.seed * 12.0) * 0.3;
    a = softDisc(uv, 0.1) * (0.35 + 0.55 * n) * 0.72;
    rgb = mix(vec3f(0.52, 0.43, 0.31), vec3f(0.70, 0.62, 0.50), n);
  } else if (kind == 5) {                 // smoke — dark grey puff, curling up
    let n = valueNoise(uv * 2.4 + input.seed * 27.0 + vec2f(input.age * 1.5, -input.age * 2.0)) * 0.7
          + valueNoise(uv * 5.0 + input.seed * 9.0 - vec2f(0.0, input.age * 3.0)) * 0.3;
    a = softDisc(uv, 0.05) * (0.30 + 0.55 * n) * 0.64;
    rgb = mix(vec3f(0.12, 0.12, 0.13), vec3f(0.32, 0.31, 0.29), n);
  } else if (kind == 6) {
    // Explosion, composited bottom-up: ground dust skirt -> rolling smoke that
    // lifts and greys as it ages -> orange fireball with a white-hot core that
    // is spent by ~60% life -> a scatter of bright embers fading to red. Reads
    // as a battlefield burst rather than an expanding coloured disc.
    let rise = vec2f(0.0, -input.age * 0.55);
    let turb = valueNoise(uv * 2.3 + rise * 3.0 + input.seed * 51.0)
             + valueNoise(uv * 5.1 - rise * 2.0 + input.seed * 17.0) * 0.5;
    let billow = clamp(turb / 1.5, 0.0, 1.0);
    let rr = length(uv * vec2f(1.0, 1.12) - rise);

    let fireLife = 1.0 - smoothstep(0.0, 0.55, input.age);
    let fireBody = (1.0 - smoothstep(0.12, 0.78 + billow * 0.25, rr)) * fireLife;
    let hotCore = (1.0 - smoothstep(0.0, 0.30, rr)) * fireLife;
    let fireCol = mix(vec3f(1.0, 0.45, 0.12), vec3f(1.0, 0.93, 0.66), hotCore);

    let smokeLife = smoothstep(0.06, 0.5, input.age) * (1.0 - smoothstep(0.72, 1.0, input.age));
    let smokeBody = (1.0 - smoothstep(0.15, 0.95, rr)) * (0.35 + 0.65 * billow) * smokeLife;
    let smokeCol = mix(vec3f(0.16, 0.15, 0.15), vec3f(0.40, 0.35, 0.30), billow);

    let dustLife = 1.0 - smoothstep(0.0, 0.4, input.age);
    let ground = uv.y + 0.35;
    let dust = (1.0 - smoothstep(0.2, 1.0, length(vec2f(uv.x * 0.7, ground * 2.4))))
             * step(ground, 0.35) * dustLife * (0.4 + 0.5 * billow);

    let emberField = valueNoise(uv * 9.0 + input.seed * 120.0);
    let ember = smoothstep(0.86, 0.98, emberField)
              * (1.0 - smoothstep(0.2, 0.95, input.age)) * step(0.25, rr);
    let emberCol = mix(vec3f(1.0, 0.8, 0.3), vec3f(0.9, 0.25, 0.1), input.age);

    var col = vec3f(0.52, 0.44, 0.34);
    var cov = dust;
    col = mix(col, smokeCol, smokeBody);
    cov = max(cov, smokeBody);
    col = mix(col, fireCol, fireBody);
    cov = max(cov, fireBody * 1.1);
    col += emberCol * ember * 1.3;
    cov = clamp(max(cov, ember), 0.0, 1.0);
    rgb = clamp(col, vec3f(0.0), vec3f(1.0));
    a = cov;
  } else if (kind == 7) {                 // target flash — red reticle
    let cross = max(
      step(abs(uv.x), 0.06) * step(abs(uv.y), 0.85),
      step(abs(uv.y), 0.06) * step(abs(uv.x), 0.85),
    );
    a = clamp(ring(uv, 0.78, 0.05) + cross, 0.0, 1.0);
    rgb = vec3f(0.95, 0.28, 0.20);
  } else {                                // battle marker — pulsing spark burst, not a cross/X
    // A giant crossed-blades "X" read as a cartoon cancel icon at a glance;
    // a compact radiating burst plus a breathing ring reads as "fighting
    // here" without borrowing another symbol's meaning.
    let core = softDisc(uv * 2.6, 0.0);
    let spikes = pow(max(0.0, 1.0 - abs(uv.x) * 2.2), 3.0) + pow(max(0.0, 1.0 - abs(uv.y) * 2.2), 3.0);
    let burst = clamp(core * 0.9 + spikes * 0.35, 0.0, 1.0);
    let pulse = ring(uv, 0.58 + 0.3 * input.age, 0.045) * (1.0 - input.age * 0.6);
    rgb = mix(vec3f(1.0, 0.8, 0.4), vec3f(0.93, 0.34, 0.2), clamp(burst * 0.5 + pulse * 0.6, 0.0, 1.0));
    a = clamp(burst * 0.8 + pulse * 0.75, 0.0, 1.0);
  }

  let out = clamp(a * input.alpha * (0.7 + 0.3 * input.intensity), 0.0, 1.0);
  if (out < 0.01) { discard; }
  return vec4f(rgb, out);
}
`;
