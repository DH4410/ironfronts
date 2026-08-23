import { clamp, unwrapNear } from './common.mjs';

export function buildCityPlans(routes, nodes, provinces, worldWidth) {
  const incoming = new Map();
  for (const route of routes) {
    for (const endpoint of [route.start, route.end]) {
      const node = nodes.get(endpoint);
      if (node?.kind !== 'province_center') continue;
      const atStart = endpoint === route.start;
      const center = atStart ? route.points[0] : route.points.at(-1);
      const neighbor = atStart ? route.points[Math.min(3, route.points.length - 1)] : route.points[Math.max(0, route.points.length - 4)];
      let dx = unwrapNear(neighbor.x, center.x, worldWidth) - center.x;
      let dz = neighbor.z - center.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      dx /= length;
      dz /= length;
      if (!incoming.has(node.location_id)) incoming.set(node.location_id, []);
      incoming.get(node.location_id).push({ dx, dz, population: route.population });
    }
  }
  const plans = new Map();
  for (const province of provinces) {
    if (province.terrain_type_id !== 14) continue;
    const approaches = incoming.get(province.province_id) ?? [];
    approaches.sort((a, b) => b.population - a.population);
    const primary = approaches[0] ?? { dx: 1, dz: 0 };
    const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
    const radius = clamp(17 + (populationScale - 4) * 8, 16, 35);
    const perpendicular = { dx: -primary.dz, dz: primary.dx };
    const streets = [
      { x1: province.center_x - primary.dx * radius, z1: province.center_y - primary.dz * radius,
        x2: province.center_x + primary.dx * radius, z2: province.center_y + primary.dz * radius },
      { x1: province.center_x - perpendicular.dx * radius * 0.78, z1: province.center_y - perpendicular.dz * radius * 0.78,
        x2: province.center_x + perpendicular.dx * radius * 0.78, z2: province.center_y + perpendicular.dz * radius * 0.78 },
    ];
    if (populationScale > 5.15) {
      for (const offset of [-radius * 0.42, radius * 0.42]) {
        streets.push({
          x1: province.center_x + perpendicular.dx * offset - primary.dx * radius * 0.68,
          z1: province.center_y + perpendicular.dz * offset - primary.dz * radius * 0.68,
          x2: province.center_x + perpendicular.dx * offset + primary.dx * radius * 0.68,
          z2: province.center_y + perpendicular.dz * offset + primary.dz * radius * 0.68,
        });
      }
    }
    plans.set(province.province_id, {
      center: [province.center_x, province.center_y], radius, primary, perpendicular, streets, populationScale,
    });
  }
  return plans;
}
