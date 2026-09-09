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
 * ArmyMarker.b = (unitCount, health01, flags, compositionRowCount)
 *   flags: bit 0 selected, bit 1 engaged / under fire
 * ArmyMarker.countsA/countsB = counts for up to six exact composition rows
 * ArmyMarker.kindsA/kindsB = kinds for those rows (0 infantry, 1 engineer,
 *   2 armoured car, 3 light tank, 4 medium tank, 5 artillery; 6 unused)
 * ArmyMarker.motion = (nextWaypointX, nextWaypointZ, remainingSeconds, sampleTime)
 *
 * The counter shows a painted strategic plaque with the two largest exact unit
 * categories and their counts, or a "?" for an unidentified contact, plus its
 * condition and selection state. At close zoom a two-column field roster
 * expands the summary to all six exact icon-and-amount entries.
 */
export const armyMarkerShader = commonWgsl + /* wgsl */ `
struct ArmyMarker {
  a: vec4f,
  b: vec4f,
  countsA: vec4f,
  countsB: vec4f,
  kindsA: vec4f,
  kindsB: vec4f,
  motion: vec4f,
};
struct ArmyParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyMarkers: array<ArmyMarker>;
@group(1) @binding(1) var<uniform> armyParams: ArmyParams;
@group(0) @binding(14) var armyMarkerPlate: texture_2d<f32>;
@group(0) @binding(15) var armyMarkerPlateSampler: sampler;
@group(0) @binding(16) var armyUnitSilhouettes: texture_2d<f32>;

struct ArmyOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) rgb: vec3f,
  @location(2) @interpolate(flat) state: f32,
  @location(3) @interpolate(flat) count: f32,
  @location(4) @interpolate(flat) health: f32,
  @location(5) @interpolate(flat) selected: f32,
  @location(6) alpha: f32,
  @location(7) @interpolate(flat) rows: f32,
  @location(8) @interpolate(flat) engaged: f32,
  @location(9) @interpolate(flat) countsA: vec4f,
  @location(10) @interpolate(flat) countsB: vec4f,
  @location(11) @interpolate(flat) kindsA: vec4f,
  @location(12) @interpolate(flat) kindsB: vec4f,
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
    clamp((uniforms.sunTime.w - marker.motion.w) / max(marker.motion.z, 0.0001), 0.0, 1.0),
    marker.motion.z > 0.0,
  );
  return mix(marker.a.xy, marker.motion.xy, travel);
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
  // viewport.z (render-scale) keeps the on-screen size constant across
  // graphics presets so it never balloons at low quality.
  let half = vec2f(34.0, 20.0) * zoomScale * uniforms.viewport.z;

  var output: ArmyOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.state = marker.a.w;
  output.count = marker.b.x;
  output.health = clamp(marker.b.y, 0.0, 1.0);
  let markerFlags = u32(marker.b.z + 0.5);
  output.selected = f32(markerFlags & 1u);
  output.engaged = f32((markerFlags >> 1u) & 1u);
  output.rows = marker.b.w;
  output.countsA = marker.countsA;
  output.countsB = marker.countsB;
  output.kindsA = marker.kindsA;
  output.kindsB = marker.kindsB;
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

fn unitKindIcon(kind: i32, q: vec2f) -> f32 {
  if (kind < 0 || kind > 5 || abs(q.x) > 1.0 || abs(q.y) > 1.0) { return 0.0; }
  // Stay half a source texel inside each 96 px cell so linear filtering never
  // leaks a neighbouring unit into the current silhouette.
  let cellUv = clamp(q * vec2f(0.5, -0.5) + vec2f(0.5), vec2f(0.5 / 96.0), vec2f(95.5 / 96.0));
  let atlasUv = vec2f(
    (f32(kind) + cellUv.x) / 6.0,
    cellUv.y,
  );
  return textureSampleLevel(armyUnitSilhouettes, armyMarkerPlateSampler, atlasUv, 0.0).a;
}

struct CompositionOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) rgb: vec3f,
  @location(2) @interpolate(flat) countsA: vec4f,
  @location(3) @interpolate(flat) countsB: vec4f,
  @location(4) @interpolate(flat) kindsA: vec4f,
  @location(5) @interpolate(flat) kindsB: vec4f,
  @location(6) @interpolate(flat) health: f32,
  @location(7) @interpolate(flat) selected: f32,
  @location(8) alpha: f32,
};

fn compositionRowCount(countsA: vec4f, countsB: vec4f) -> f32 {
  return max(1.0,
    step(0.5, countsA.x) + step(0.5, countsA.y) + step(0.5, countsA.z) + step(0.5, countsA.w)
    + step(0.5, countsB.x) + step(0.5, countsB.y));
}

fn compositionValue(first: vec4f, second: vec4f, index: u32) -> f32 {
  if (index < 4u) { return first[index]; }
  return second[index - 4u];
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
  let rows = compositionRowCount(marker.countsA, marker.countsB);
  let gridRows = ceil(rows * 0.5);
  let half = vec2f(42.0, 8.0 + gridRows * 10.0) * uniforms.viewport.z;
  let pixelCenter = vec2f(51.0, 2.0) * uniforms.viewport.z;

  var output: CompositionOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.countsA = marker.countsA;
  output.countsB = marker.countsB;
  output.kindsA = marker.kindsA;
  output.kindsB = marker.kindsB;
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

  let entries = u32(compositionRowCount(input.countsA, input.countsB));
  let rows = (entries + 1u) / 2u;
  let rowSpan = 1.26 / f32(rows);
  for (var index = 0u; index < 6u; index += 1u) {
    if (index >= entries) { break; }
    let amount = i32(clamp(compositionValue(input.countsA, input.countsB, index) + 0.5, 1.0, 999.0));
    let kind = i32(compositionValue(input.kindsA, input.kindsB, index) + 0.5);
    let column = index % 2u;
    let row = index / 2u;
    let centerX = select(-0.45, 0.45, column == 1u);
    let centerY = 0.68 - (f32(row) + 0.5) * rowSpan;
    let cellUv = vec2f((uv.x - centerX) / 0.43, (uv.y - centerY) / (rowSpan * 0.44));
    let icon = unitKindIcon(kind, vec2f((cellUv.x + 0.52) / 0.27, cellUv.y / 0.78));
    var digits = 0.0;
    if (amount < 10) {
      digits = glyphCoverage(amount, cellUv, 0.13, 0.58, 0.46);
    } else if (amount < 100) {
      digits = glyphCoverage(amount / 10, cellUv, 0.11, 0.56, 0.30)
        + glyphCoverage(amount % 10, cellUv, 0.11, 0.56, 0.64);
    } else {
      digits = glyphCoverage(amount / 100, cellUv, 0.085, 0.52, 0.18)
        + glyphCoverage((amount / 10) % 10, cellUv, 0.085, 0.52, 0.46)
        + glyphCoverage(amount % 10, cellUv, 0.085, 0.52, 0.74);
    }
    rgb = mix(rgb, vec3f(0.94, 0.92, 0.82), clamp(icon, 0.0, 1.0) * inside);
    rgb = mix(rgb, vec3f(0.99, 0.98, 0.93), clamp(digits, 0.0, 1.0) * inside);
    if (column == 0u && row + 1u < rows) {
      let separatorY = centerY - rowSpan * 0.5;
      let separator = step(abs(uv.y - separatorY), 0.012) * step(abs(uv.x), 0.78) * inside;
      rgb = mix(rgb, ink, separator * 0.46);
    }
  }
  let columnRule = step(abs(uv.x), 0.012) * step(-0.58, uv.y) * step(uv.y, 0.70) * inside;
  rgb = mix(rgb, ink, columnRule * 0.46);

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
  // textureSampleLevel (not textureSample): this fragment has already taken
  // conditional discards/returns above, so implicit-derivative sampling is not
  // in uniform control flow. The plate is a fixed-size HUD sprite — LOD 0 is fine.
  let plate = textureSampleLevel(armyMarkerPlate, armyMarkerPlateSampler, plateUv, 0.0);
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

  // Like Call of War's compact counters, the main plaque combines the two
  // largest unit types with their own amounts. At close range the companion
  // manifest expands this to all six exact categories.
  var liveMarks = 0.0;
  if (contact) {
    liveMarks = glyphCoverage(10, uv - vec2f(0.0, 0.12), 0.22, 0.49, 0.30);
  } else {
    let shownRows = min(2u, u32(input.rows + 0.5));
    for (var index = 0u; index < 2u; index += 1u) {
      if (index >= shownRows) { break; }
      let centerY = select(0.10, 0.36 - f32(index) * 0.52, shownRows > 1u);
      let rowUv = vec2f(uv.x, (uv.y - centerY) / 0.25);
      let amount = i32(clamp(compositionValue(input.countsA, input.countsB, index) + 0.5, 1.0, 999.0));
      let kind = i32(compositionValue(input.kindsA, input.kindsB, index) + 0.5);
      let icon = unitKindIcon(kind, vec2f((rowUv.x + 0.53) / 0.25, rowUv.y / 0.82));
      var digits = 0.0;
      if (amount < 10) {
        digits = glyphCoverage(amount, rowUv, 0.14, 0.64, 0.40);
      } else if (amount < 100) {
        digits = glyphCoverage(amount / 10, rowUv, 0.11, 0.62, 0.25)
          + glyphCoverage(amount % 10, rowUv, 0.11, 0.62, 0.58);
      } else {
        digits = glyphCoverage(amount / 100, rowUv, 0.085, 0.58, 0.16)
          + glyphCoverage((amount / 10) % 10, rowUv, 0.085, 0.58, 0.40)
          + glyphCoverage(amount % 10, rowUv, 0.085, 0.58, 0.64);
      }
      liveMarks = max(liveMarks, clamp(icon + digits, 0.0, 1.0));
    }
    if (shownRows > 1u) {
      let separator = step(abs(uv.y - 0.10), 0.015) * step(abs(uv.x), 0.70) * plateCoverage;
      rgb = mix(rgb, vec3f(0.035), separator * 0.48);
    }
  }
  let liveInk = vec3f(0.98, 0.97, 0.89);
  rgb = mix(rgb, vec3f(0.025), liveMarks * plateCoverage * 0.58);
  rgb = mix(rgb, liveInk, liveMarks * plateCoverage);

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
