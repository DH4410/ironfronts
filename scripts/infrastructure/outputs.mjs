import { ROAD_WIDTH, smoothstep, unwrapNear, wrap } from './common.mjs';

export function rasterRoadField(routes, width, height, worldWidth, worldHeight, landField, landWidth, landHeight) {
  const field = new Uint8Array(width * height * 2);
  const clearance = new Uint8Array(width * height);
  const shoulderWorld = ROAD_WIDTH + 0.45;
  for (const route of routes) {
    if (route.suppressed) continue;
    for (const point of route.points) {
      const fx = wrap(point.x, worldWidth) / worldWidth * width;
      const fz = point.z / worldHeight * height;
      const coreX = Math.max(0.32, ROAD_WIDTH * 0.5 / worldWidth * width);
      const coreZ = Math.max(0.32, ROAD_WIDTH * 0.5 / worldHeight * height);
      const shoulderX = Math.max(0.58, shoulderWorld * 0.5 / worldWidth * width);
      const shoulderZ = Math.max(0.58, shoulderWorld * 0.5 / worldHeight * height);
      const reachX = Math.ceil(shoulderX + 1.5);
      const reachZ = Math.ceil(shoulderZ + 1.5);
      for (let oz = -reachZ; oz <= reachZ; oz += 1) {
        const pz = Math.round(fz) + oz;
        if (pz < 0 || pz >= height) continue;
        for (let ox = -reachX; ox <= reachX; ox += 1) {
          const px = wrap(Math.round(fx) + ox, width);
          const dx = Math.round(fx) + ox - fx;
          const dz = pz - fz;
          const coreDistance = Math.hypot(dx / coreX, dz / coreZ);
          const shoulderDistance = Math.hypot(dx / shoulderX, dz / shoulderZ);
          if (shoulderDistance > 1.35) continue;
          const index = pz * width + px;
          const offset = index * 2;
          field[offset] = Math.max(field[offset], Math.round((1 - smoothstep(0.56, 1.12, coreDistance)) * 255 * 0.48));
          field[offset + 1] = Math.max(field[offset + 1], Math.round((1 - smoothstep(0.72, 1.25, shoulderDistance)) * 255));
          clearance[index] = Math.max(clearance[index], Math.round((1 - smoothstep(0.82, 1.3, shoulderDistance)) * 255));
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    const landY = Math.min(landHeight - 1, Math.floor((y + 0.5) / height * landHeight));
    for (let x = 0; x < width; x += 1) {
      const landX = Math.min(landWidth - 1, Math.floor((x + 0.5) / width * landWidth));
      if (landField[landY * landWidth + landX] >= 0.5) continue;
      field.fill(0, (y * width + x) * 2, (y * width + x) * 2 + 2);
      clearance[y * width + x] = 0;
    }
  }
  return { field, clearance };
}

export function buildFurniture(routes, cityPlans, worldWidth) {
  const lamps = [];
  const barriers = [];
  const signs = [];
  const push = (list, x, z, sx, sy, sz, angle, tint, style = 0) => list.push(wrap(x, worldWidth), z, sx, sy, sz, angle, tint, style);
  for (const [, plan] of cityPlans) {
    let counter = 0;
    for (const street of plan.streets.slice(0, 2)) {
      const dx = street.x2 - street.x1;
      const dz = street.z2 - street.z1;
      const length = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      const spacing = 21 + (counter % 3) * 3;
      for (let distance = spacing * 0.55; distance < length; distance += spacing) {
        const t = distance / length;
        const side = counter++ % 2 ? 1 : -1;
        const rx = -Math.sin(angle);
        const rz = Math.cos(angle);
        push(lamps, street.x1 + dx * t + rx * side * 2.2, street.z1 + dz * t + rz * side * 2.2, 1, 1, 1, angle, 0.86);
      }
    }
    if ((Math.floor(plan.center[0] * 13 + plan.center[1] * 7) & 3) === 0) {
      push(signs, plan.center[0] + plan.perpendicular.dx * 4, plan.center[1] + plan.perpendicular.dz * 4,
        1, 1, 1, Math.atan2(plan.primary.dz, plan.primary.dx), 0.9);
    }
  }
  for (const route of routes) {
    if (route.suppressed) continue;
    for (let index = 4; index + 4 < route.points.length; index += 18) {
      const deterministic = Math.abs(Math.sin(route.id * 91.17 + index * 13.7));
      if (deterministic <= 0.95) continue;
      const point = route.points[index];
      const previous = route.points[index - 2];
      const next = route.points[index + 2];
      const angle = Math.atan2(next.z - previous.z, unwrapNear(next.x, previous.x, worldWidth) - previous.x);
      const side = deterministic > 0.965 ? 1 : -1;
      const offset = (ROAD_WIDTH * 0.5 + 1.6) * side;
      push(barriers, point.x - Math.sin(angle) * offset, point.z + Math.cos(angle) * offset, 7.5, 0.9, 0.12, angle, 0.68, 1);
    }
  }
  return { lamps: new Float32Array(lamps), barriers: new Float32Array(barriers), signs: new Float32Array(signs) };
}
