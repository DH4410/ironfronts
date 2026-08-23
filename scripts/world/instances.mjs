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
    const supportsTrees = isForest || visual === 'Jungle' || visual === 'Boreal';

    if (supportsTrees) {
      const density = isForest ? 1 : 0.35;
      const target = clamp(Math.round(area / 11 * density), 5, isForest ? 90 : 36);
      let placed = 0;
      for (let attempt = 0; attempt < target * 14 && placed < target; attempt += 1) {
        const x = minX + (maxX - minX) * rng();
        const y = minY + (maxY - minY) * rng();
        if (pointProvince(provinceIds, x, y) !== encodedId) continue;
        const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH
          + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
        if (roadClearance[roadIndex] > 20) continue;
        const treeType = visual === 'Jungle' ? 2 : visual === 'Boreal' || visual === 'Tundra' ? 1 : 0;
        trees.push(x, y, 0.72 + rng() * 0.72, treeType, rng() * Math.PI * 2, 0.82 + rng() * 0.28, encodedId, 0);
        placed += 1;
      }
    }

    if (province.terrain_type_id !== 14) continue;
    const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
    const target = clamp(Math.round((populationScale - 3) * 17), 12, 54);
    const plan = cityPlans.get(province.province_id);
    const radius = plan?.radius ?? clamp(Math.sqrt(Math.max(30, area)) * 1.9, 9, 38);
    const placedBuildings = [];
    for (let attempt = 0, placed = 0; attempt < target * 56 && placed < target; attempt += 1) {
      const street = plan?.streets[Math.floor(rng() * plan.streets.length)];
      let angle;
      let x;
      let y;
      let distance;
      if (street) {
        const t = 0.08 + rng() * 0.84;
        const dx = street.x2 - street.x1;
        const dy = street.z2 - street.z1;
        angle = Math.atan2(dy, dx);
        const side = rng() < 0.5 ? -1 : 1;
        const setback = 4.4 + rng() * Math.max(5.2, radius * 0.34);
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
      let archetype;
      if (placed === 0 && populationScale > 5.35) archetype = 4;
      else if (rng() < 0.10) archetype = 3;
      else if (visual === 'Desert' || visual === 'Sand Dunes' || visual === 'Mediterranean') archetype = rng() < 0.72 ? 2 : 1;
      else archetype = rng() < 0.46 ? 0 : rng() < 0.72 ? 1 : 2;
      const sx = archetype === 3 ? 5.4 + rng() * 5.2 : 2.8 + rng() * 4.2;
      const sz = archetype === 3 ? 4.8 + rng() * 5.8 : 2.8 + rng() * 4.4;
      if (placedBuildings.some((other) => Math.hypot(other.x - x, other.y - y) < (other.radius + Math.max(sx, sz)) * 0.34)) continue;
      let sy = 4.2 + rng() * 7.5 + Math.max(0, centerBias) * Math.max(0, populationScale - 4) * 3.6;
      if (archetype === 4) sy *= 1.55;
      if (archetype === 3) sy *= 0.68;
      const palette = visual === 'Desert' || visual === 'Sand Dunes' ? 1 : visual === 'Mediterranean' ? 2 : visual === 'Boreal' || visual === 'Tundra' ? 3 : 0;
      buildings.push(x, y, sx, sy, sz, angle + (rng() - 0.5) * 0.08, palette + 0.72 + rng() * 0.24, archetype);
      placedBuildings.push({ x, y, radius: Math.max(sx, sz) });
      placed += 1;
    }
  }

  return { trees: new Float32Array(trees), buildings: new Float32Array(buildings) };
}
