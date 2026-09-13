const FAMILY_HUES = [28, 72, 126, 174, 222, 310];
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

/** Assigns stable muted colors while keeping adjacent countries in different hue families. */
export function buildPoliticalPalette(countries, provinceOwners, provinceAdjacency, seed) {
  const countryIds = countries.map((country) => country.country_id).sort((a, b) => a - b);
  const neighbors = new Map(countryIds.map((countryId) => [countryId, new Set()]));
  for (let offset = 0; offset + 1 < provinceAdjacency.length; offset += 2) {
    const countryA = provinceOwners[provinceAdjacency[offset]];
    const countryB = provinceOwners[provinceAdjacency[offset + 1]];
    if (!countryA || !countryB || countryA === countryB) continue;
    neighbors.get(countryA)?.add(countryB);
    neighbors.get(countryB)?.add(countryA);
  }

  const families = colorGraph(countryIds, neighbors, seed);
  const candidates = FAMILY_HUES.map((hue, family) => buildFamilyCandidates(hue, family, seed));
  const usedTones = FAMILY_HUES.map(() => []);
  const palette = new Map();
  for (const countryId of countryIds) {
    const family = families.get(countryId);
    if (family === undefined) throw new Error(`Country ${countryId} has no political color family`);
    const tone = selectMostDistinctTone(candidates[family], usedTones[family], countryId, seed);
    usedTones[family].push(tone.lab);
    palette.set(countryId, { color: tone.hex, colorFamily: family });
  }

  const uniqueColors = new Set([...palette.values()].map(({ color }) => color));
  if (uniqueColors.size !== palette.size) throw new Error('Political palette contains duplicate colors');
  for (const [countryId, adjacent] of neighbors) {
    for (const neighborId of adjacent) {
      if (families.get(countryId) === families.get(neighborId)) {
        throw new Error(`Adjacent countries ${countryId} and ${neighborId} share a color family`);
      }
    }
  }
  return palette;
}

function colorGraph(countryIds, neighbors, seed) {
  const assignments = new Map();
  const familyUsage = new Uint16Array(FAMILY_HUES.length);
  while (assignments.size < countryIds.length) {
    const unassigned = countryIds.filter((countryId) => !assignments.has(countryId));
    unassigned.sort((countryA, countryB) => {
      const saturationDifference = saturation(countryB, neighbors, assignments)
        - saturation(countryA, neighbors, assignments);
      if (saturationDifference) return saturationDifference;
      const degreeDifference = (neighbors.get(countryB)?.size ?? 0) - (neighbors.get(countryA)?.size ?? 0);
      if (degreeDifference) return degreeDifference;
      return hash(countryA, seed) - hash(countryB, seed);
    });
    const countryId = unassigned[0];
    const blocked = new Set([...(neighbors.get(countryId) ?? [])]
      .map((neighborId) => assignments.get(neighborId))
      .filter((family) => family !== undefined));
    const available = FAMILY_HUES.map((_, family) => family).filter((family) => !blocked.has(family));
    if (!available.length) throw new Error(`Six muted color families cannot color country ${countryId}`);
    available.sort((familyA, familyB) => familyUsage[familyA] - familyUsage[familyB]
      || hash(countryId ^ (familyA * 0x9e37), seed) - hash(countryId ^ (familyB * 0x9e37), seed));
    const family = available[0];
    assignments.set(countryId, family);
    familyUsage[family] += 1;
  }
  return assignments;
}

function saturation(countryId, neighbors, assignments) {
  return new Set([...(neighbors.get(countryId) ?? [])]
    .map((neighborId) => assignments.get(neighborId))
    .filter((family) => family !== undefined)).size;
}

function buildFamilyCandidates(baseHue, family, seed) {
  return Array.from({ length: 64 }, (_, index) => {
    const phase = hash(family * 131 + index, seed) / 0xffffffff;
    // Strategy-map ownership should read clearly without repainting the terrain
    // in bright poster colors. Keep the families distinct but low-chroma.
    const lightness = 0.58 + fract(index * GOLDEN_RATIO_CONJUGATE + phase * 0.17) * 0.10;
    const chroma = 0.024 + fract(index * 0.414213562373095 + phase * 0.23) * 0.024;
    const hue = baseHue + (fract(index * 0.7320508075688772 + phase) - 0.5) * 16;
    const radians = hue * Math.PI / 180;
    const lab = [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
    return { lab, hex: oklabToHex(lab) };
  });
}

function selectMostDistinctTone(candidates, used, countryId, seed) {
  const unused = candidates.filter((candidate) => !used.includes(candidate.lab));
  if (!unused.length) throw new Error('A political color family exhausted its tone candidates');
  if (!used.length) return unused[hash(countryId, seed) % unused.length];
  return unused.reduce((best, candidate) => {
    const distance = Math.min(...used.map((lab) => squaredDistance(candidate.lab, lab)));
    const bestDistance = Math.min(...used.map((lab) => squaredDistance(best.lab, lab)));
    return distance > bestDistance ? candidate : best;
  });
}

function oklabToHex([lightness, a, b]) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear.map((channel) => Math.round(linearToSrgb(channel) * 255)
    .toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function linearToSrgb(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function squaredDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function hash(value, seed) {
  let result = Math.imul(value ^ seed, 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
}

function fract(value) {
  return value - Math.floor(value);
}
