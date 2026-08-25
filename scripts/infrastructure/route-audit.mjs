import { ROAD_WIDTH, sampleHeight, sampleScalar, unwrapNear } from './common.mjs';

export function auditRoute(route, context) {
  const { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  const halfWidth = ROAD_WIDTH * 0.5 + 0.45;
  let maximumGrade = 0;
  for (let index = 0; index + 1 < route.points.length; index += 1) {
    const a = route.points[index];
    const b = route.points[index + 1];
    const bx = unwrapNear(b.x, a.x, worldWidth);
    const dx = bx - a.x;
    const dz = b.z - a.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const steps = Math.max(1, Math.ceil(length));
    let previousHeight;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      for (const lateral of [-halfWidth, 0, halfWidth]) {
        if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight, x + nx * lateral, z + nz * lateral) < 0.5) {
          return { visible: false, reason: 'water', maximumGrade, x, z };
        }
      }
      const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z);
      if (previousHeight !== undefined) maximumGrade = Math.max(maximumGrade,
        Math.abs(terrain - previousHeight) / Math.max(0.001, length / steps));
      previousHeight = terrain;
    }
  }
  return { visible: true, maximumGrade };
}
