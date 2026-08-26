import { ID_HEIGHT, ID_WIDTH, SEED, WORLD_HEIGHT, WORLD_WIDTH } from './config.mjs';
import { clamp, wrap } from './raster.mjs';

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function pointProvince(ids, x, y) {
  const px = wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
  const py = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1);
  return ids[py * ID_WIDTH + px];
}

function buildingFootprintFitsProvince(ids, encodedId, x, y, sx, sz, angle) {
  // A center-point check is not enough near coastlines: a building can be
  // anchored on land while most of its rotated footprint hangs over water.
  // Sample the padded corners and edge midpoints so settlements stay inland.
  const halfX = sx * 0.62 + 1.6;
  const halfZ = sz * 0.62 + 1.6;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const samples = [
    [0, 0],
    [-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ],
    [-halfX, 0], [halfX, 0], [0, -halfZ], [0, halfZ],
  ];
  return samples.every(([localX, localZ]) => {
    const sampleX = x + localX * cosine - localZ * sine;
    const sampleY = y + localX * sine + localZ * cosine;
    return pointProvince(ids, sampleX, sampleY) === encodedId;
  });
}

function pickTreeVariant(rng, visual, isPlain) {
  const roll = rng();
  if (isPlain) {
    if (visual === 'Boreal') return roll < 0.58 ? 2 : roll < 0.80 ? 1 : 4;
    return roll < 0.42 ? 0 : roll < 0.68 ? 1 : roll < 0.86 ? 4 : 3;
  }
  if (visual === 'Jungle') return roll < 0.44 ? 3 : roll < 0.70 ? 0 : roll < 0.88 ? 1 : 4;
  if (visual === 'Boreal' || visual === 'Tundra') return roll < 0.68 ? 2 : roll < 0.84 ? 1 : roll < 0.94 ? 4 : 0;
  return roll < 0.36 ? 0 : roll < 0.56 ? 1 : roll < 0.72 ? 2 : roll < 0.87 ? 3 : 4;
}

function pickTreePalette(rng, visual, isPlain) {
  if (isPlain) return 0;
  if (visual === 'Boreal' || visual === 'Tundra') return rng() < 0.76 ? 1 : 0;
  if (visual === 'Jungle') return rng() < 0.56 ? 1 : 0;
  return rng() < 0.48 ? 1 : 0;
}

export function buildInstances(provinces, geometryById, provinceIds, areaCounts, roadClearance, cityPlans) {
  const trees = [];
  const buildings = [];

  for (const province of provinces) {
    const geometry = geometryById.get(province.province_id);
    if (!geometry) continue;
    const allPoints = geometry.components.flat();
    const minX = Math.min(...allPoints.map((point) => point[0]));
    const maxX = Math.max(...allPoints.map((point) => point[0]));
    const minY = Math.min(...allPoints.map((point) => point[1]));
    const maxY = Math.max(...allPoints.map((point) => point[1]));
    const rng = makeRng(SEED ^ Math.imul(province.province_id + 1, 0x9e3779b1));
    const encodedId = province.province_id + 1;
    const area = areaCounts[encodedId] ?? 0;
    const visual = province.visual_terrain_tag ?? '';
    const isForest = province.terrain_type_id === 13;
    const isPlain = province.terrain_type_id === 10;
    const supportsPlainTrees = isPlain && visual !== 'Desert' && visual !== 'Sand Dunes' && visual !== 'Tundra';
    const supportsTrees = isForest || visual === 'Jungle' || visual === 'Boreal' || supportsPlainTrees;

    if (supportsTrees) {
      const target = isPlain
        ? clamp(Math.round(area / 95), 0, 12)
        : clamp(Math.round(area / 11 * (isForest ? 1 : 0.35)), 5, isForest ? 90 : 36);
      let placed = 0;
      for (let attempt = 0; attempt < target * 14 && placed < target; attempt += 1) {
        const x = minX + (maxX - minX) * rng();
        const y = minY + (maxY - minY) * rng();
        if (pointProvince(provinceIds, x, y) !== encodedId) continue;
        const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH
          + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
        if (roadClearance[roadIndex] > 20) continue;
        const variant = pickTreeVariant(rng, visual, isPlain);
        const palette = pickTreePalette(rng, visual, isPlain);
        trees.push(x, y, 0.72 + rng() * 0.72, variant, rng() * Math.PI * 2, 0.82 + rng() * 0.28, encodedId, palette);
        placed += 1;
      }
    }

    if (province.terrain_type_id !== 14) continue;
    const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
    // The old fixed minimum of 12 made tiny island settlements as dense as
    // continental cities. Cap visual density by both population and land area.
    const populationTarget = clamp(Math.round((populationScale - 3) * 8), 3, 24);
    const areaCapacity = clamp(Math.round(area / 80), 2, 24);
    const target = Math.min(populationTarget, areaCapacity);
    const plan = cityPlans.get(province.province_id);
    const radius = plan?.radius ?? clamp(Math.sqrt(Math.max(30, area)) * 1.75, 8, 32);
    const placedBuildings = [];
    for (let attempt = 0, placed = 0; attempt < target * 72 && placed < target; attempt += 1) {
      const street = plan?.streets[Math.floor(rng() * plan.streets.length)];
      let angle;
      let x;
      let y;
      let distance;
      if (street) {
        const t = 0.10 + rng() * 0.80;
        const dx = street.x2 - street.x1;
        const dy = street.z2 - street.z1;
        angle = Math.atan2(dy, dx);
        const side = rng() < 0.5 ? -1 : 1;
        const setback = 4.8 + rng() * Math.max(4.6, radius * 0.24);
        x = street.x1 + dx * t - Math.sin(angle) * side * setback;
        y = street.z1 + dy * t + Math.cos(angle) * side * setback;
        distance = Math.hypot(x - province.center_x, y - province.center_y);
      } else {
        angle = rng() * Math.PI * 2;
        distance = Math.sqrt(rng()) * radius;
        x = province.center_x + Math.cos(angle) * distance;
        y = province.center_y + Math.sin(angle) * distance * 0.72;
      }
      if (pointProvince(provinceIds, x, y) !== encodedId) continue;
      const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH
        + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
      if (roadClearance[roadIndex] > 178) continue;
      const centerBias = 1 - distance / radius;

      // Keep the current city pass to the three compact sourced house forms.
      // The taller archetypes read as spiky miniature skylines at map scale.
      let archetype;
      if (placed === 0 && populationScale > 5.55) archetype = 2;
      else if (visual === 'Desert' || visual === 'Sand Dunes' || visual === 'Mediterranean') archetype = rng() < 0.62 ? 2 : 1;
      else {
        const roll = rng();
        archetype = roll < 0.44 ? 0 : roll < 0.74 ? 1 : 2;
      }

      const sx = 3.0 + rng() * 2.8;
      const sz = 3.0 + rng() * 2.8;
      const finalAngle = angle + (rng() - 0.5) * 0.08;
      if (!buildingFootprintFitsProvince(provinceIds, encodedId, x, y, sx, sz, finalAngle)) continue;
      if (placedBuildings.some((other) => Math.hypot(other.x - x, other.y - y)
        < (other.radius + Math.max(sx, sz)) * 0.72)) continue;

      const sy = 3.6 + rng() * 4.0
        + Math.max(0, centerBias) * Math.max(0, populationScale - 4) * 1.6;
      const palette = visual === 'Desert' || visual === 'Sand Dunes' ? 1
        : visual === 'Mediterranean' ? 2
          : visual === 'Boreal' || visual === 'Tundra' ? 3 : 0;
      buildings.push(x, y, sx, sy, sz, finalAngle, palette + 0.72 + rng() * 0.24, archetype);
      placedBuildings.push({ x, y, radius: Math.max(sx, sz) });
      placed += 1;
    }
  }

  return { trees: new Float32Array(trees), buildings: new Float32Array(buildings) };
}
