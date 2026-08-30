import { commonWgsl } from './common';

/**
 * World-space instanced army-stack markers.
 *
 * One `pass.draw(6, N)` — every stack marker is projected on the GPU from its
 * world position each frame, so markers track terrain while panning with no
 * per-frame CPU/DOM cost. The CPU only re-uploads the instance buffer when the
 * authoritative army set changes (spawn / move / merge / visibility), not per
 * frame.
 *
 * ArmyMarker.a = (worldX, worldZ, packedRGB, state)
 *   packedRGB: country colour, r*65536 + g*256 + b (0..255 each)
 *   state: 1 = visible (full), 2 = contact (enemy seen, composition unknown)
 *          hidden stacks are simply not emitted (fog is resolved CPU-side)
 * ArmyMarker.b = (unitCount, health01, selected, reserved)
 *
 * The counter shows a strategic army symbol: a rounded plaque in the owner's
 * colour, the unit count (1–2 digits) or a "?" for an unidentified contact, a
 * condition bar, and a selection ring. Not a literal tank driving on the map.
 */
export const armyMarkerShader = commonWgsl + /* wgsl */ `
struct ArmyMarker { a: vec4f, b: vec4f };
struct ArmyParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyMarkers: array<ArmyMarker>;
@group(1) @binding(1) var<uniform> armyParams: ArmyParams;

struct ArmyOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) rgb: vec3f,
  @location(2) @interpolate(flat) state: f32,
  @location(3) @interpolate(flat) count: f32,
  @location(4) @interpolate(flat) health: f32,
  @location(5) @interpolate(flat) selected: f32,
  @location(6) alpha: f32,
  @location(7) @interpolate(flat) kind: f32,
};

fn unpackRgb(packed: f32) -> vec3f {
  let v = u32(packed + 0.5);
  let r = f32((v >> 16u) & 255u) / 255.0;
  let g = f32((v >> 8u) & 255u) / 255.0;
  let b = f32(v & 255u) / 255.0;
  return vec3f(r, g, b);
}

@vertex
fn armyMarkerVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> ArmyOut {
  let copyIndex = instanceIndex / armyParams.count;
  let marker = armyMarkers[instanceIndex % armyParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  let worldXZ = vec2f(marker.a.x, marker.a.y);
  let uv = worldXZ / uniforms.map.xy;
  let ground = heightAt(uv);
  let rangeMarker = marker.a.w > 2.5;
  let rangeOffset = select(vec2f(0.0), corner * marker.b.x, rangeMarker);
  let rangeXZ = worldXZ + rangeOffset;
  let rangeUv = rangeXZ / uniforms.map.xy;
  let worldPos = vec3f(
    rangeXZ.x + copyOffset,
    select(ground + 4.0, heightAt(rangeUv) + 2.0, rangeMarker),
    rangeXZ.y,
  );
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);

  let zoom = uniforms.interaction.y;
  let contact = marker.a.w > 1.5;
  let closeFade = select(smoothstep(1400.0, 1800.0, zoom), 1.0, contact);
  let rangeFade = closeFade * (1.0 - smoothstep(4400.0, 5000.0, zoom));
  let zoomScale = mix(0.8, 1.25, smoothstep(4600.0, 900.0, zoom));
  // Plaque is a touch wider than tall.
  let half = vec2f(26.0, 15.0) * zoomScale;

  var output: ArmyOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.state = marker.a.w;
  output.count = marker.b.x;
  output.health = clamp(marker.b.y, 0.0, 1.0);
  output.selected = marker.b.z;
  output.kind = marker.b.w;
  output.alpha = rangeFade * (1.0 - horizontalWorldFog(worldPos.x));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  let pixelOffset = corner * half * 2.0 / uniforms.viewport.xy;
  output.position = select(clip + vec4f(pixelOffset * clip.w, 0.0, 0.0), clip, rangeMarker);
  return output;
}

// 3x5 bitmap digits 0-9 and '?' (index 10). Bit 0 = top-left, row-major.
fn glyphBit(glyph: i32, col: i32, row: i32) -> f32 {
  if (col < 0 || col > 2 || row < 0 || row > 4) { return 0.0; }
  // 3x5 masks, bit = row*3 + col, bit 0 = top-left.
  var mask = 0u;
  switch (glyph) {
    case 0:  { mask = 0x7B6Fu; }   // XXX X.X X.X X.X XXX
    case 1:  { mask = 0x2492u; }   // .X. .X. .X. .X. .X.
    case 2:  { mask = 0x73E7u; }   // XXX ..X XXX X.. XXX
    case 3:  { mask = 0x79E7u; }   // XXX ..X XXX ..X XXX
    case 4:  { mask = 0x49EDu; }   // X.X X.X XXX ..X ..X
    case 5:  { mask = 0x79CFu; }   // XXX X.. XXX ..X XXX
    case 6:  { mask = 0x7BCFu; }   // XXX X.. XXX X.X XXX
    case 7:  { mask = 0x24A7u; }   // XXX ..X .X. .X. .X.
    case 8:  { mask = 0x7BEFu; }   // XXX X.X XXX X.X XXX
    case 9:  { mask = 0x79EFu; }   // XXX X.X XXX ..X XXX
    default: { mask = 0x21A7u; }   // ? : XXX ..X .XX ... .X.
  }
  let bit = u32(row * 3 + col);
  return select(0.0, 1.0, (mask & (1u << bit)) != 0u);
}

// Coverage of one glyph rendered into the box spanning [-w,w] x [-h,h] in uv.
fn glyphCoverage(glyph: i32, p: vec2f, boxW: f32, boxH: f32, offsetX: f32) -> f32 {
  let local = vec2f((p.x - offsetX) / boxW, p.y / boxH); // -1..1
  if (abs(local.x) > 1.0 || abs(local.y) > 1.0) { return 0.0; }
  let col = i32(floor((local.x * 0.5 + 0.5) * 3.0));
  let row = i32(floor((0.5 - local.y * 0.5) * 5.0));
  return glyphBit(glyph, col, row);
}

fn roundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn markerSegmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn dominantIcon(kind: i32, p: vec2f) -> f32 {
  let q = (p - vec2f(-0.46, 0.06)) / vec2f(0.38, 0.62);
  if (kind == 0) {
    let head = 1.0 - smoothstep(0.20, 0.26, length(q - vec2f(0.0, 0.52)));
    let body = 1.0 - smoothstep(0.09, 0.15, markerSegmentDistance(q, vec2f(0.0, 0.30), vec2f(0.0, -0.35)));
    let limbs = 1.0 - smoothstep(0.08, 0.14, min(
      markerSegmentDistance(q, vec2f(0.0, 0.10), vec2f(-0.42, -0.05)),
      markerSegmentDistance(q, vec2f(0.0, -0.30), vec2f(0.35, -0.82)),
    ));
    return max(head, max(body, limbs));
  }
  if (kind == 1 || kind == 2) {
    let hull = step(abs(q.x), 0.82) * step(abs(q.y + 0.18), 0.34);
    let turret = step(abs(q.x), 0.42) * step(abs(q.y - 0.30), 0.26);
    let barrel = step(abs(q.x), 0.10) * step(q.y, 0.95) * step(0.48, q.y);
    return max(hull, max(turret, barrel));
  }
  if (kind == 2) {
    let body = step(abs(q.x), 0.78) * step(abs(q.y + 0.10), 0.38);
    let cabin = step(abs(q.x), 0.50) * step(abs(q.y - 0.38), 0.22);
    let wheels = 1.0 - smoothstep(0.18, 0.25, min(length(q - vec2f(-0.50, -0.58)), length(q - vec2f(0.50, -0.58))));
    return max(body, max(cabin, wheels));
  }
  let cannon = 1.0 - smoothstep(0.09, 0.15, markerSegmentDistance(q, vec2f(-0.52, -0.55), vec2f(0.55, 0.62)));
  let wheel = 1.0 - smoothstep(0.27, 0.34, length(q - vec2f(-0.30, -0.48)));
  return max(cannon, wheel);
}

@fragment
fn armyMarkerFragment(input: ArmyOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv; // -1..1 across the plaque
  if (input.state > 2.5) {
    let radius = length(uv);
    let angle = atan2(uv.y, uv.x);
    let dash = step(0.42, fract((angle + 3.14159265) * 7.0));
    let ring = (1.0 - smoothstep(0.018, 0.035, abs(radius - 0.985))) * dash;
    if (ring < 0.02) { discard; }
    return vec4f(vec3f(0.94, 0.82, 0.48), ring * 0.78);
  }

  let contact = input.state > 1.5;
  let bodyCol = select(input.rgb, vec3f(0.44, 0.44, 0.42), contact);
  let ink = vec3f(0.06, 0.07, 0.05);

  // Plaque body.
  let sd = roundedBox(uv, vec2f(0.9, 0.86), 0.26);
  let inside = 1.0 - smoothstep(-0.03, 0.03, sd);
  let outline = (1.0 - smoothstep(-0.03, 0.03, sd - 0.20)) - inside;
  if (inside + outline < 0.02 && input.selected < 0.5) { discard; }

  // Body: country colour with a strong dark vignette toward the centre so a
  // pale nation colour still gives the digit contrast.
  let centreDist = length(uv * vec2f(1.0, 1.15));
  let core = mix(bodyCol * 0.34, bodyCol, smoothstep(0.15, 0.95, centreDist));
  var rgb = mix(core, bodyCol, inside);
  rgb = mix(rgb, ink, clamp(outline * 1.3, 0.0, 1.0));
  rgb *= mix(1.1, 0.82, uv.y * 0.5 + 0.5); // top-lit relief

  // Digits / contact mark, centred, upper-middle.
  var glyphC = 0.0;
  if (contact) {
    glyphC = glyphCoverage(10, uv - vec2f(0.0, 0.05), 0.34, 0.58, 0.0);
  } else {
    let n = i32(clamp(input.count + 0.5, 1.0, 99.0));
    if (n < 10) {
      glyphC = glyphCoverage(n, uv - vec2f(0.0, 0.05), 0.34, 0.60, 0.34);
    } else {
      let tens = n / 10;
      let ones = n % 10;
      glyphC += glyphCoverage(tens, uv - vec2f(0.0, 0.05), 0.28, 0.56, 0.10);
      glyphC += glyphCoverage(ones, uv - vec2f(0.0, 0.05), 0.28, 0.56, 0.56);
    }
  }
  let iconC = select(dominantIcon(i32(input.kind + 0.5), uv), 0.0, contact);
  rgb = mix(rgb, vec3f(0.94, 0.92, 0.82), clamp(iconC, 0.0, 1.0) * inside);
  rgb = mix(rgb, vec3f(0.99, 0.98, 0.93), clamp(glyphC, 0.0, 1.0) * inside);

  // Condition bar along the bottom inner edge.
  let barY = -0.66;
  let inBarBand = step(abs(uv.y - barY), 0.09) * step(abs(uv.x), 0.74) * inside;
  let filled = step(uv.x, -0.74 + 1.48 * input.health);
  let barCol = mix(vec3f(0.86, 0.24, 0.16), vec3f(0.42, 0.78, 0.34), input.health);
  rgb = mix(rgb, vec3f(0.05, 0.05, 0.05), inBarBand * (1.0 - filled) * 0.8);
  rgb = mix(rgb, barCol, inBarBand * filled);

  // Selection ring just outside the plaque.
  var coverage = clamp(inside + outline, 0.0, 1.0);
  if (input.selected > 0.5) {
    let ring = (1.0 - smoothstep(0.0, 0.05, abs(sd + 0.06)));
    rgb = mix(rgb, vec3f(1.0, 0.92, 0.55), ring);
    coverage = max(coverage, ring);
  }

  return vec4f(rgb, coverage * 0.98 * input.alpha);
}
`;
