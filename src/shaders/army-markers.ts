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
 * ArmyMarker.b = (unitCount, health01, flags, dominantKind)
 *   flags: bit 0 selected, bit 1 engaged / under fire
 * ArmyMarker.c = counts for up to four close-range composition rows
 * ArmyMarker.d = visual kinds for those rows (0 infantry, 1 light armor,
 *                2 medium armor, 3 artillery; 4 means unused)
 * ArmyMarker.e = (nextWaypointX, nextWaypointZ, remainingSeconds, sampleTime)
 *
 * The counter shows a strategic army symbol: a rounded plaque in the owner's
 * colour, the unit count (1–2 digits) or a "?" for an unidentified contact, a
 * condition bar, and a selection ring. At close zoom a second plaque replaces
 * that summary with up to four icon-and-amount rows.
 */
export const armyMarkerShader = commonWgsl + /* wgsl */ `
struct ArmyMarker { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f };
struct ArmyParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyMarkers: array<ArmyMarker>;
@group(1) @binding(1) var<uniform> armyParams: ArmyParams;
@group(0) @binding(14) var armyMarkerPlate: texture_2d<f32>;
@group(0) @binding(15) var armyMarkerPlateSampler: sampler;

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
  @location(8) @interpolate(flat) engaged: f32,
};

fn unpackRgb(packed: f32) -> vec3f {
  let v = u32(packed + 0.5);
  let r = f32((v >> 16u) & 255u) / 255.0;
  let g = f32((v >> 8u) & 255u) / 255.0;
  let b = f32(v & 255u) / 255.0;
  return vec3f(r, g, b);
}

fn markerWorldPosition(marker: ArmyMarker) -> vec2f {
  let travel = select(
    0.0,
    clamp((uniforms.sunTime.w - marker.e.w) / max(marker.e.z, 0.0001), 0.0, 1.0),
    marker.e.z > 0.0,
  );
  return mix(marker.a.xy, marker.e.xy, travel);
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

  let worldXZ = markerWorldPosition(marker);
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
  // Large enough to read as a two-compartment military counter at map zoom.
  let half = vec2f(34.0, 20.0) * zoomScale;

  var output: ArmyOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.state = marker.a.w;
  output.count = marker.b.x;
  output.health = clamp(marker.b.y, 0.0, 1.0);
  let markerFlags = u32(marker.b.z + 0.5);
  output.selected = f32(markerFlags & 1u);
  output.engaged = f32((markerFlags >> 1u) & 1u);
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

fn unitKindIcon(kind: i32, q: vec2f) -> f32 {
  if (kind == 0) {
    let head = 1.0 - smoothstep(0.20, 0.26, length(q - vec2f(0.0, 0.52)));
    let body = 1.0 - smoothstep(0.09, 0.15, markerSegmentDistance(q, vec2f(0.0, 0.30), vec2f(0.0, -0.35)));
    let limbs = 1.0 - smoothstep(0.08, 0.14, min(
      markerSegmentDistance(q, vec2f(0.0, 0.10), vec2f(-0.42, -0.05)),
      markerSegmentDistance(q, vec2f(0.0, -0.30), vec2f(0.35, -0.82)),
    ));
    return max(head, max(body, limbs));
  }
  if (kind == 1) {
    let hull = step(abs(q.x), 0.78) * step(abs(q.y + 0.18), 0.30);
    let turret = step(abs(q.x), 0.42) * step(abs(q.y - 0.30), 0.26);
    let barrel = step(abs(q.x), 0.10) * step(q.y, 0.95) * step(0.48, q.y);
    return max(hull, max(turret, barrel));
  }
  if (kind == 2) {
    let hull = step(abs(q.x), 0.90) * step(abs(q.y + 0.20), 0.38);
    let turret = step(abs(q.x), 0.50) * step(abs(q.y - 0.30), 0.28);
    let barrel = step(abs(q.x), 0.11) * step(q.y, 1.0) * step(0.48, q.y);
    let tracks = step(abs(q.x), 0.98) * step(abs(q.y + 0.58), 0.10);
    return max(max(hull, tracks), max(turret, barrel));
  }
  let cannon = 1.0 - smoothstep(0.09, 0.15, markerSegmentDistance(q, vec2f(-0.52, -0.55), vec2f(0.55, 0.62)));
  let wheel = 1.0 - smoothstep(0.27, 0.34, length(q - vec2f(-0.30, -0.48)));
  return max(cannon, wheel);
}

fn dominantIcon(kind: i32, p: vec2f) -> f32 {
  return unitKindIcon(kind, (p - vec2f(-0.52, 0.12)) / vec2f(0.28, 0.47));
}

struct CompositionOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) rgb: vec3f,
  @location(2) @interpolate(flat) counts: vec4f,
  @location(3) @interpolate(flat) kinds: vec4f,
  @location(4) @interpolate(flat) health: f32,
  @location(5) @interpolate(flat) selected: f32,
  @location(6) alpha: f32,
};

fn compositionRowCount(counts: vec4f) -> f32 {
  return max(1.0,
    step(0.5, counts.x) + step(0.5, counts.y) + step(0.5, counts.z) + step(0.5, counts.w));
}

@vertex
fn armyCompositionVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> CompositionOut {
  let copyIndex = instanceIndex / armyParams.count;
  let marker = armyMarkers[instanceIndex % armyParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let markerXZ = markerWorldPosition(marker);
  let worldXZ = vec2f(markerXZ.x + copyOffset, markerXZ.y);
  let worldPos = vec3f(worldXZ.x, heightAt(markerXZ / uniforms.map.xy) + 17.0, worldXZ.y);
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);
  let rows = compositionRowCount(marker.c);
  let half = vec2f(29.0, 6.0 + rows * 7.5);
  let pixelCenter = vec2f(38.0, 2.0);

  var output: CompositionOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.counts = marker.c;
  output.kinds = marker.d;
  output.health = clamp(marker.b.y, 0.0, 1.0);
  output.selected = f32(u32(marker.b.z + 0.5) & 1u);
  let identified = marker.a.w < 1.5;
  output.alpha = select(0.0, 1.0 - smoothstep(1400.0, 1800.0, uniforms.interaction.y), identified)
    * (1.0 - horizontalWorldFog(worldPos.x));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  let pixelOffset = (pixelCenter + corner * half) * 2.0 / uniforms.viewport.xy;
  output.position = clip + vec4f(pixelOffset * clip.w, -0.0003 * clip.w, 0.0);
  return output;
}

@fragment
fn armyCompositionFragment(input: CompositionOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv;
  let sd = roundedBox(uv, vec2f(0.90, 0.90), 0.18);
  let inside = 1.0 - smoothstep(-0.025, 0.025, sd);
  let outline = (1.0 - smoothstep(-0.025, 0.025, sd - 0.16)) - inside;
  if (inside + outline < 0.02 && input.selected < 0.5) { discard; }

  let ink = vec3f(0.055, 0.065, 0.05);
  let centreDist = length(uv * vec2f(0.82, 1.0));
  let core = mix(input.rgb * 0.30, input.rgb * 0.88, smoothstep(0.12, 1.0, centreDist));
  var rgb = mix(core, ink, clamp(outline * 1.35, 0.0, 1.0));
  rgb *= mix(1.08, 0.84, uv.y * 0.5 + 0.5);

  let rows = i32(compositionRowCount(input.counts));
  let rowSpan = 1.40 / f32(rows);
  for (var index = 0; index < 4; index += 1) {
    if (index >= rows) { break; }
    let amount = i32(clamp(input.counts[index] + 0.5, 1.0, 999.0));
    let kind = i32(input.kinds[index] + 0.5);
    let centerY = 0.70 - (f32(index) + 0.5) * rowSpan;
    let rowUv = vec2f(uv.x, (uv.y - centerY) / (rowSpan * 0.44));
    let icon = unitKindIcon(kind, vec2f((rowUv.x + 0.48) / 0.27, rowUv.y / 0.78));
    var digits = 0.0;
    if (amount < 10) {
      digits = glyphCoverage(amount, rowUv, 0.13, 0.58, 0.48);
    } else if (amount < 100) {
      digits = glyphCoverage(amount / 10, rowUv, 0.12, 0.56, 0.34)
        + glyphCoverage(amount % 10, rowUv, 0.12, 0.56, 0.65);
    } else {
      digits = glyphCoverage(amount / 100, rowUv, 0.10, 0.54, 0.20)
        + glyphCoverage((amount / 10) % 10, rowUv, 0.10, 0.54, 0.48)
        + glyphCoverage(amount % 10, rowUv, 0.10, 0.54, 0.76);
    }
    rgb = mix(rgb, vec3f(0.94, 0.92, 0.82), clamp(icon, 0.0, 1.0) * inside);
    rgb = mix(rgb, vec3f(0.99, 0.98, 0.93), clamp(digits, 0.0, 1.0) * inside);
    if (index + 1 < rows) {
      let separatorY = centerY - rowSpan * 0.5;
      let separator = step(abs(uv.y - separatorY), 0.012) * step(abs(uv.x), 0.72) * inside;
      rgb = mix(rgb, ink, separator * 0.46);
    }
  }

  let barY = -0.76;
  let inBarBand = step(abs(uv.y - barY), 0.055) * step(abs(uv.x), 0.72) * inside;
  let filled = step(uv.x, -0.72 + 1.44 * input.health);
  let barCol = mix(vec3f(0.86, 0.24, 0.16), vec3f(0.42, 0.78, 0.34), input.health);
  rgb = mix(rgb, vec3f(0.05), inBarBand * (1.0 - filled) * 0.82);
  rgb = mix(rgb, barCol, inBarBand * filled);

  var coverage = clamp(inside + outline, 0.0, 1.0);
  if (input.selected > 0.5) {
    let ring = 1.0 - smoothstep(0.0, 0.045, abs(sd + 0.055));
    rgb = mix(rgb, vec3f(1.0, 0.92, 0.55), ring);
    coverage = max(coverage, ring);
  }
  return vec4f(rgb, coverage * 0.98 * input.alpha);
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
  let bodyCol = select(input.rgb, vec3f(0.42), contact);
  let plateUv = vec2f(uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5);
  let plate = textureSample(armyMarkerPlate, armyMarkerPlateSampler, plateUv);
  let plateSd = roundedBox(uv, vec2f(0.96, 0.90), 0.18);
  let plateShape = 1.0 - smoothstep(-0.025, 0.025, plateSd);
  let plateCoverage = plate.a * plateShape;
  if (plateCoverage < 0.02 && input.selected < 0.5) { discard; }

  // The painted texture provides the physical counter. Country colour is an
  // inset signal rather than the entire background, so pale flags cannot wash
  // out the live white silhouette and count.
  var rgb = plate.rgb * 0.86;
  let iconBay = step(uv.x, -0.12) * step(-0.57, uv.y) * step(uv.y, 0.65) * plateCoverage;
  rgb = mix(rgb, mix(rgb, bodyCol * 0.82, 0.52), iconBay * 0.72);
  let ownerEdge = step(uv.x, -0.86) * step(abs(uv.y), 0.68) * plateCoverage;
  rgb = mix(rgb, bodyCol * 1.22, ownerEdge * 0.88);
  if (contact) {
    let gray = dot(rgb, vec3f(0.299, 0.587, 0.114));
    rgb = mix(rgb, vec3f(gray), 0.78);
  }

  // The number owns the right bay. Three-digit stacks remain readable instead
  // of silently clamping to 99.
  var glyphC = 0.0;
  let glyphUv = uv - vec2f(0.0, 0.12);
  if (contact) {
    glyphC = glyphCoverage(10, glyphUv, 0.22, 0.49, 0.36);
  } else {
    let n = i32(clamp(input.count + 0.5, 1.0, 999.0));
    if (n < 10) {
      glyphC = glyphCoverage(n, glyphUv, 0.22, 0.49, 0.36);
    } else if (n < 100) {
      glyphC = glyphCoverage(n / 10, glyphUv, 0.17, 0.47, 0.13)
        + glyphCoverage(n % 10, glyphUv, 0.17, 0.47, 0.58);
    } else {
      glyphC = glyphCoverage(n / 100, glyphUv, 0.13, 0.44, 0.02)
        + glyphCoverage((n / 10) % 10, glyphUv, 0.13, 0.44, 0.36)
        + glyphCoverage(n % 10, glyphUv, 0.13, 0.44, 0.70);
    }
  }
  let iconC = select(dominantIcon(i32(input.kind + 0.5), uv), 0.0, contact);
  let liveInk = vec3f(0.98, 0.97, 0.89);
  rgb = mix(rgb, vec3f(0.025), clamp(iconC + glyphC, 0.0, 1.0) * plateCoverage * 0.58);
  rgb = mix(rgb, liveInk, clamp(iconC + glyphC, 0.0, 1.0) * plateCoverage);

  // A thick, threshold-coloured condition strip fills the plate's recessed
  // channel. Unknown contacts keep a neutral channel instead of implying 0 HP.
  let barY = -0.69;
  let inBarBand = step(abs(uv.y - barY), 0.095) * step(abs(uv.x), 0.72) * plateCoverage;
  let filled = step(uv.x, -0.72 + 1.44 * input.health);
  var barCol = mix(vec3f(0.73, 0.19, 0.14), vec3f(0.76, 0.49, 0.16), step(0.34, input.health));
  barCol = mix(barCol, vec3f(0.37, 0.68, 0.28), step(0.67, input.health));
  rgb = mix(rgb, vec3f(0.025), inBarBand * 0.90);
  rgb = mix(rgb, barCol, inBarBand * filled * select(1.0, 0.0, contact));
  rgb = mix(rgb, vec3f(0.34), inBarBand * select(0.0, 0.72, contact));

  // Engaged stacks carry a static red command tab: unmistakable without
  // adding another animated effect to an already active battle.
  let engagedTab = step(0.67, uv.x) * step(0.52, uv.y) * plateCoverage * input.engaged;
  rgb = mix(rgb, vec3f(0.76, 0.18, 0.12), engagedTab * 0.92);

  var coverage = plateCoverage;
  if (input.selected > 0.5) {
    let ring = 1.0 - smoothstep(0.0, 0.045, abs(plateSd + 0.045));
    rgb = mix(rgb, vec3f(1.0, 0.92, 0.55), ring);
    coverage = max(coverage, ring);
  }

  return vec4f(rgb, coverage * 0.98 * input.alpha);
}
`;
