import {
  AUDIT_VERSION, CUT_FILL_LIMITS, LEVEL_WIDTHS, MAX_AUDIT_PASSES, MAX_GRADES, ROLE_WIDTH_SCALE,
  TUNNEL_MAX_LENGTHS, clamp, intervalAt, routeRoadWidth, sampleHeight, sampleScalar, smoothstep, unwrapNear, wrap,
} from './common.mjs';

export function reinciseProtectedHydrology(heights, landField, riverMask, riverCoreMask, riverBed) {
  for (let index = 0; index < heights.length; index += 1) {
    if (!landField[index] || riverCoreMask[index] < 0.055) continue;
    const channel = smoothstep(0.055, 0.68, riverCoreMask[index]);
    const bedTarget = Number.isFinite(riverBed[index]) ? riverBed[index] - 0.38 : heights[index] - 0.7;
    heights[index] += (Math.min(heights[index], bedTarget) - heights[index]) * channel;
    heights[index] = Math.max(0.62, heights[index]);
  }
}
export function escalateTerrainConflicts(routes, context) {
  const { heights, riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  let addedTunnels = 0;
  let loweredViaducts = 0;
  for (const route of routes) {
    const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
    const halfWidth = routeRoadWidth(route) * 0.5;
    const candidates = [];
    for (let index = 1; index + 1 < route.points.length; index += 1) {
      if ((route.bridges ?? []).some((interval) => index >= interval.start && index <= interval.end)
        || (route.tunnels ?? []).some((interval) => index >= interval.start && index <= interval.end)) continue;
      const point = route.points[index], previous = route.points[index - 1], next = route.points[index + 1];
      const dx = unwrapNear(next.x, previous.x, worldWidth) - previous.x, dz = next.z - previous.z;
      const length = Math.max(0.001, Math.hypot(dx, dz)), nx = -dz / length, nz = dx / length;
      const centerTerrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z);
      const leftTerrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x + nx * halfWidth, point.z + nz * halfWidth);
      const rightTerrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x - nx * halfWidth, point.z - nz * halfWidth);
      const crossTerrain = Math.max(centerTerrain, leftTerrain, rightTerrain);
      const lowestTerrain = Math.min(centerTerrain, leftTerrain, rightTerrain);
      if (route.profile[index] - centerTerrain > 18) {
        route.profile[index] = centerTerrain + 8;
        loweredViaducts += 1;
      }
      const dry = sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z) < 0.10;
      if (!route.localStreet && !route.gateway && dry
        && (crossTerrain - route.profile[index] > CUT_FILL_LIMITS[levelIndex] * 0.72
          || route.profile[index] - lowestTerrain > 18)) candidates.push(index);
    }
    if (!route.localStreet && !route.gateway) {
      for (let index = 0; index + 1 < route.points.length; index += 1) {
        if (intervalAt(route, index, 'bridges') || intervalAt(route, index, 'tunnels')) continue;
        const a = route.points[index], b = route.points[index + 1], bx = unwrapNear(b.x, a.x, worldWidth);
        const x = (a.x + bx) * 0.5, z = (a.z + b.z) * 0.5;
        const dx = bx - a.x, dz = b.z - a.z, length = Math.max(0.001, Math.hypot(dx, dz));
        const nx = -dz / length, nz = dx / length;
        const profile = (route.profile[index] + route.profile[index + 1]) * 0.5;
        const lowest = Math.min(
          sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z),
          sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x + nx * halfWidth, z + nz * halfWidth),
          sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x - nx * halfWidth, z - nz * halfWidth));
        if (profile - lowest > 18 && sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z) < 0.10) {
          candidates.push(index, index + 1);
        }
      }
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => a - b);
    const groups = [];
    for (const index of [...new Set(candidates)]) {
      const previous = groups.at(-1);
      if (previous && index <= previous.end + 1) previous.end = index;
      else groups.push({ start: index, end: index });
    }
    for (const group of groups) {
      const start = Math.max(0, group.start - 1), end = Math.min(route.points.length - 1, group.end + 1);
      let cursor = start;
      while (cursor < end) {
        let finish = cursor;
        let length = 0;
        const maximumLength = TUNNEL_MAX_LENGTHS[levelIndex] * 0.92;
        while (finish < end) {
          const step = Math.hypot(unwrapNear(route.points[finish + 1].x, route.points[finish].x, worldWidth) - route.points[finish].x,
            route.points[finish + 1].z - route.points[finish].z);
          if (length + step > maximumLength && finish > cursor) break;
          length += step;
          finish += 1;
        }
        if (length >= 9 && finish > cursor + 1) {
          route.tunnels.push({ start: cursor, end: finish, length });
          for (let index = cursor + 1; index < finish; index += 1) {
            const t = (index - cursor) / Math.max(1, finish - cursor);
            route.profile[index] = route.profile[cursor] * (1 - t) + route.profile[finish] * t;
          }
          addedTunnels += 1;
        }
        cursor = finish;
      }
    }
    route.tunnels.sort((a, b) => a.start - b.start);
    const mergedTunnels = [];
    for (const tunnel of route.tunnels) {
      const expanded = { ...tunnel, start: Math.max(0, tunnel.start - 1), end: Math.min(route.points.length - 1, tunnel.end + 1) };
      const previous = mergedTunnels.at(-1);
      if (previous && expanded.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, expanded.end);
      } else mergedTunnels.push(expanded);
    }
    for (const tunnel of mergedTunnels) {
      let length = 0;
      for (let index = tunnel.start; index < tunnel.end; index += 1) length += Math.hypot(
        unwrapNear(route.points[index + 1].x, route.points[index].x, worldWidth) - route.points[index].x,
        route.points[index + 1].z - route.points[index].z);
      tunnel.length = length;
    }
    route.tunnels = mergedTunnels;
  }
  return { addedTunnels, loweredViaducts };
}

export function gradeTerrain(routes, heights, riverMask, width, height, worldWidth, worldHeight) {
  const targets = new Float32Array(heights.length);
  const weights = new Float32Array(heights.length);
  for (const route of routes) {
    const bridgeSample = new Uint8Array(route.points.length);
    for (const bridge of route.bridges) for (let index = bridge.start + 1; index < bridge.end; index += 1) bridgeSample[index] = 1;
    const natural = route.points.map((point) => sampleHeight(heights, width, height, worldWidth, worldHeight, point.x, point.z));
    const profile = [...natural];
    const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
    const maximumGrade = MAX_GRADES[levelIndex];
    const cutFillLimit = CUT_FILL_LIMITS[levelIndex];
    for (let pass = 0; pass < 10; pass += 1) {
      const source = [...profile];
      for (let index = 1; index + 1 < profile.length; index += 1) {
        profile[index] = source[index] * 0.54 + (source[index - 1] + source[index + 1]) * 0.23;
      }
    }
    for (let pass = 0; pass < 8; pass += 1) {
      for (let index = 1; index < profile.length; index += 1) {
        const previous = route.points[index - 1], current = route.points[index];
        const run = Math.max(0.001, Math.hypot(unwrapNear(current.x, previous.x, worldWidth) - previous.x, current.z - previous.z));
        profile[index] = clamp(profile[index], profile[index - 1] - maximumGrade * run, profile[index - 1] + maximumGrade * run);
      }
      for (let index = profile.length - 2; index >= 0; index -= 1) {
        const next = route.points[index + 1], current = route.points[index];
        const run = Math.max(0.001, Math.hypot(unwrapNear(next.x, current.x, worldWidth) - current.x, next.z - current.z));
        profile[index] = clamp(profile[index], profile[index + 1] - maximumGrade * run, profile[index + 1] + maximumGrade * run);
      }
    }

    route.tunnels = [];
    if (route.infrastructureLevel >= 2 && !route.localStreet && !route.gateway) {
      let cursor = 1;
      while (cursor + 1 < profile.length) {
        const requiresTunnel = natural[cursor] - profile[cursor] > cutFillLimit * 1.12 && riverMask[clamp(Math.floor(route.points[cursor].z / worldHeight * height), 0, height - 1) * width
          + wrap(Math.floor(route.points[cursor].x / worldWidth * width), width)] < 0.12;
        if (!requiresTunnel) { cursor += 1; continue; }
        let end = cursor;
        while (end + 1 < profile.length - 1 && natural[end + 1] - profile[end + 1] > cutFillLimit * 0.72) end += 1;
        const start = Math.max(0, cursor - 1);
        const finish = Math.min(profile.length - 1, end + 1);
        let length = 0;
        for (let index = start; index < finish; index += 1) length += Math.hypot(
          unwrapNear(route.points[index + 1].x, route.points[index].x, worldWidth) - route.points[index].x,
          route.points[index + 1].z - route.points[index].z);
        const maximumLength = TUNNEL_MAX_LENGTHS[levelIndex];
        const dryPortals = route.points.slice(start, finish + 1).every((point) => sampleScalar(riverMask, width, height, worldWidth, worldHeight, point.x, point.z) < 0.12);
        if (length >= 9 && length <= maximumLength && dryPortals) {
          route.tunnels.push({ start, end: finish, length });
          for (let index = start + 1; index < finish; index += 1) {
            const t = (index - start) / (finish - start);
            profile[index] = profile[start] * (1 - t) + profile[finish] * t;
          }
        }
        cursor = end + 1;
      }
    }
    route.profile = profile;
    const roadWidth = route.plaza ? 3.1 : route.localStreet ? Math.max(1.25, LEVEL_WIDTHS[levelIndex] * 0.62)
      : LEVEL_WIDTHS[levelIndex] * ROLE_WIDTH_SCALE[route.corridorRole];
    const halfWidth = roadWidth * 0.5;
    const radiusWorld = halfWidth + (route.infrastructureLevel === 1 ? 3.2 : 5.2);
    const radiusX = Math.max(1, Math.ceil(radiusWorld / worldWidth * width));
    const radiusZ = Math.max(1, Math.ceil(radiusWorld / worldHeight * height));
    for (let sample = 0; sample < route.points.length; sample += 1) {
      if (bridgeSample[sample] || route.tunnels.some((tunnel) => sample > tunnel.start && sample < tunnel.end)) continue;
      const point = route.points[sample];
      const cx = Math.round(wrap(point.x, worldWidth) / worldWidth * width);
      const cz = Math.round(point.z / worldHeight * height);
      for (let oz = -radiusZ; oz <= radiusZ; oz += 1) {
        const pz = cz + oz;
        if (pz < 0 || pz >= height) continue;
        for (let ox = -radiusX; ox <= radiusX; ox += 1) {
          const px = wrap(cx + ox, width);
          const distance = Math.hypot(ox / radiusX, oz / radiusZ);
          if (distance > 1) continue;
          const index = pz * width + px;
          if (riverMask[index] > 0.16) continue;
          const weight = (1 - smoothstep(0.22, 1, distance)) * (route.infrastructureLevel === 1 ? 0.30 : route.localStreet ? 0.42 : 0.68);
          const boundedTarget = clamp(profile[sample], heights[index] - cutFillLimit, heights[index] + cutFillLimit);
          targets[index] += boundedTarget * weight;
          weights[index] += weight;
        }
      }
    }
  }
  for (let index = 0; index < heights.length; index += 1) {
    if (!weights[index]) continue;
    const target = targets[index] / weights[index];
    heights[index] += (target - heights[index]) * clamp(weights[index], 0, 0.78);
  }
}

export function runInfrastructureAuditAndRepair(routes, context, engineeringWidth, engineeringHeight) {
  const started = performance.now();
  const { heights, landField, riverMask, riverCoreMask, riverBed, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  const engineeringField = new Uint8Array(engineeringWidth * engineeringHeight * 4);
  for (let index = 0; index < engineeringWidth * engineeringHeight; index += 1) engineeringField[index * 4] = 128;
  const repairedSites = [];
  let initialViolations = 0;
  let previousViolations = Number.POSITIVE_INFINITY;
  let appliedRepairs = 0;
  let passes = 0;

  const markEngineering = (x, z, delta, support, drainage, risk) => {
    const px = wrap(Math.floor(wrap(x, worldWidth) / worldWidth * engineeringWidth), engineeringWidth);
    const pz = clamp(Math.floor(z / worldHeight * engineeringHeight), 0, engineeringHeight - 1);
    const offset = (pz * engineeringWidth + px) * 4;
    engineeringField[offset] = clamp(Math.round(128 + delta * 20), 0, 255);
    engineeringField[offset + 1] = Math.max(engineeringField[offset + 1], Math.round(clamp(support, 0, 1) * 255));
    engineeringField[offset + 2] = Math.max(engineeringField[offset + 2], Math.round(clamp(drainage, 0, 1) * 255));
    engineeringField[offset + 3] = Math.max(engineeringField[offset + 3], Math.round(clamp(risk, 0, 1) * 255));
  };

  for (let pass = 0; pass < MAX_AUDIT_PASSES; pass += 1) {
    passes = pass + 1;
    // Re-seat the vertical solution toward the latest terrain before auditing,
    // then project it back into the level-specific grade envelope.
    for (const route of routes) {
      if (route.suppressed) continue;
      const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
      const maximumGrade = MAX_GRADES[levelIndex];
      const limit = CUT_FILL_LIMITS[levelIndex];
      for (let index = 1; index + 1 < route.points.length; index += 1) {
        const structured = (route.bridges ?? []).some((interval) => index > interval.start && index < interval.end)
          || (route.tunnels ?? []).some((interval) => index > interval.start && index < interval.end);
        if (structured) continue;
        const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, route.points[index].x, route.points[index].z);
        const seated = clamp(terrain, route.profile[index] - limit, route.profile[index] + limit);
        route.profile[index] += (seated - route.profile[index]) * 0.32;
      }
      for (let projection = 0; projection < 3; projection += 1) {
        for (let index = 1; index < route.profile.length; index += 1) {
          const run = Math.max(0.001, Math.hypot(unwrapNear(route.points[index].x, route.points[index - 1].x, worldWidth) - route.points[index - 1].x,
            route.points[index].z - route.points[index - 1].z));
          route.profile[index] = clamp(route.profile[index], route.profile[index - 1] - maximumGrade * run, route.profile[index - 1] + maximumGrade * run);
        }
        for (let index = route.profile.length - 2; index >= 0; index -= 1) {
          const run = Math.max(0.001, Math.hypot(unwrapNear(route.points[index + 1].x, route.points[index].x, worldWidth) - route.points[index].x,
            route.points[index + 1].z - route.points[index].z));
          route.profile[index] = clamp(route.profile[index], route.profile[index + 1] - maximumGrade * run, route.profile[index + 1] + maximumGrade * run);
        }
      }
      for (let index = 0; index < route.profile.length; index += 1) {
        const structured = (route.bridges ?? []).some((interval) => index > interval.start && index < interval.end)
          || (route.tunnels ?? []).some((interval) => index > interval.start && index < interval.end);
        if (structured) continue;
        const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, route.points[index].x, route.points[index].z);
        route.profile[index] = Math.min(route.profile[index], terrain + 12);
      }
    }
    const targets = new Float64Array(heights.length);
    const weights = new Float32Array(heights.length);
    let violations = 0;
    let maximumPenetration = 0;
    let maximumUnsupported = 0;
    const passSites = [];

    for (const route of routes) {
      if (route.suppressed) continue;
      const halfWidth = routeRoadWidth(route) * 0.5;
      const lift = route.infrastructureLevel === 1 ? 0.055 : 0.10;
      const levelIndex = clamp(route.infrastructureLevel - 1, 0, 4);
      const cutFillLimit = CUT_FILL_LIMITS[levelIndex];
      for (let index = 0; index + 1 < route.points.length; index += 1) {
        if (route.sharedSegmentOwners?.[index] >= 0 || intervalAt(route, index, 'bridges') || intervalAt(route, index, 'tunnels')) continue;
        const a = route.points[index], b = route.points[index + 1];
        const bx = unwrapNear(b.x, a.x, worldWidth);
        const dx = bx - a.x, dz = b.z - a.z;
        const segmentLength = Math.max(0.001, Math.hypot(dx, dz));
        const nx = -dz / segmentLength, nz = dx / segmentLength;
        const auditStep = pass < 4 ? 4.0 : pass < 8 ? 2.0 : 1.0;
        const steps = Math.max(1, Math.ceil(segmentLength / auditStep));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const x = wrap(a.x + dx * t, worldWidth), z = a.z + dz * t;
          const roadBase = route.profile[index] * (1 - t) + route.profile[index + 1] * t;
          const roadTop = roadBase + lift;
          const water = sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z) > 0.10;
          if (water) {
            violations += 1;
            passSites.push({ type: 'unbridged-water', routeId: route.id, x, z, severity: 1 });
            markEngineering(x, z, 0, 0, 1, 1);
            continue;
          }
          for (const lateral of [-halfWidth, 0, halfWidth]) {
            const sampleX = wrap(x + nx * lateral, worldWidth), sampleZ = z + nz * lateral;
            const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, sampleX, sampleZ);
            const penetration = terrain - (roadTop - 0.03);
            const unsupported = roadTop - terrain - 0.35;
            if (penetration <= 0 && unsupported <= 0) continue;
            violations += 1;
            maximumPenetration = Math.max(maximumPenetration, penetration);
            maximumUnsupported = Math.max(maximumUnsupported, unsupported);
            const desiredTerrain = roadBase;
            const fx = wrap(Math.round(sampleX / worldWidth * fieldWidth), fieldWidth);
            const fz = clamp(Math.round(sampleZ / worldHeight * fieldHeight), 0, fieldHeight - 1);
            const radius = Math.max(1, Math.ceil((halfWidth + 3.0) / worldWidth * fieldWidth));
            for (let oz = -radius; oz <= radius; oz += 1) {
              const pz = fz + oz;
              if (pz < 0 || pz >= fieldHeight) continue;
              for (let ox = -radius; ox <= radius; ox += 1) {
                if (Math.hypot(ox, oz) > radius + 0.25) continue;
                const px = wrap(fx + ox, fieldWidth);
                const fieldIndex = pz * fieldWidth + px;
                if (!landField[fieldIndex] || riverCoreMask[fieldIndex] > 0.055) continue;
                const weight = 1 / (1 + Math.hypot(ox, oz));
                const boundedTarget = clamp(desiredTerrain, heights[fieldIndex] - cutFillLimit, heights[fieldIndex] + cutFillLimit);
                targets[fieldIndex] += boundedTarget * weight;
                weights[fieldIndex] += weight;
              }
            }
            const delta = desiredTerrain - terrain;
            markEngineering(sampleX, sampleZ, delta, unsupported > 0 ? clamp(unsupported / 3, 0, 1) : 0,
              sampleScalar(riverMask, fieldWidth, fieldHeight, worldWidth, worldHeight, sampleX, sampleZ),
              clamp(Math.max(penetration, unsupported) / 2, 0, 1));
            if (passSites.length < 256) passSites.push({ type: penetration > unsupported ? 'buried-road' : 'unsupported-road', routeId: route.id,
              x: sampleX, z: sampleZ, severity: Math.max(penetration, unsupported) });
          }
        }
      }
    }
    if (pass === 0) initialViolations = violations;
    if (!violations) {
      previousViolations = 0;
      break;
    }
    let changed = 0;
    for (let index = 0; index < heights.length; index += 1) {
      if (!weights[index]) continue;
      const target = targets[index] / weights[index];
      const delta = target - heights[index];
      if (Math.abs(delta) < 0.002) continue;
      heights[index] += delta * 0.92;
      changed += 1;
    }
    appliedRepairs += changed;
    repairedSites.push(...passSites.slice(0, Math.max(0, 512 - repairedSites.length)));
    reinciseProtectedHydrology(heights, landField, riverMask, riverCoreMask, riverBed);
    if (pass === 3 || pass === 7 || pass === 10) escalateTerrainConflicts(routes, context);
    if (!changed || violations >= previousViolations && pass >= 4) {
      // The final seating pass may move the center profile toward terrain when
      // bounded grading alone cannot converge (typically conflicting mountain approaches).
      for (const route of routes) {
        if (route.suppressed) continue;
        for (let index = 1; index + 1 < route.points.length; index += 1) {
          if (intervalAt(route, index, 'bridges') || intervalAt(route, index, 'tunnels')) continue;
          const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, route.points[index].x, route.points[index].z);
          const limit = CUT_FILL_LIMITS[clamp(route.infrastructureLevel - 1, 0, 4)];
          route.profile[index] = clamp(route.profile[index], terrain - limit, terrain + limit);
        }
      }
    }
    previousViolations = violations;
  }

  // The late seating pass can expose a final cliff-edge conflict. Escalate it
  // before the exact audit so every resulting tunnel interval is omitted from
  // ordinary-road geometry rather than surfacing as a buried/flying ribbon.
  escalateTerrainConflicts(routes, context);

  // Visual-only city streets may be omitted when a city center sits directly
  // on an extreme cliff or channel. They do not carry movement connectivity;
  // emitting a flying local street is strictly worse than omitting that accent.
  const suppressedLocalStreets = [];
  for (const route of routes) {
    if (!route.localStreet || route.suppressed) continue;
    const halfWidth = routeRoadWidth(route) * 0.5;
    const lift = route.infrastructureLevel === 1 ? 0.055 : 0.10;
    let worst = 0;
    for (let index = 0; index + 1 < route.points.length && worst <= 1; index += 1) {
      if (intervalAt(route, index, 'bridges') || intervalAt(route, index, 'tunnels')) continue;
      const a = route.points[index], b = route.points[index + 1];
      const bx = unwrapNear(b.x, a.x, worldWidth), dx = bx - a.x, dz = b.z - a.z;
      const length = Math.max(0.001, Math.hypot(dx, dz)), nx = -dz / length, nz = dx / length;
      const steps = Math.max(1, Math.ceil(length));
      for (let step = 0; step <= steps && worst <= 1; step += 1) {
        const t = step / steps, x = wrap(a.x + dx * t, worldWidth), z = a.z + dz * t;
        if (sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z) > 0.10) { worst = 2; break; }
        const top = route.profile[index] * (1 - t) + route.profile[index + 1] * t + lift;
        for (const lateral of [-halfWidth, 0, halfWidth]) {
          const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x + nx * lateral, z + nz * lateral);
          worst = Math.max(worst, terrain - (top - 0.03), top - terrain - 0.35);
        }
      }
    }
    if (worst > 1) {
      route.suppressed = true;
      suppressedLocalStreets.push({ type: 'omitted-local-street', routeId: route.id, x: route.points[0].x, z: route.points[0].z, severity: worst });
    }
  }

  // Exact final audit of every emitted ordinary-road cross-section.
  const severe = [];
  let maximumPenetration = 0, maximumUnsupported = 0, unbridgedWater = 0;
  let worstPenetration, worstUnsupported;
  for (const route of routes) {
    if (route.suppressed) continue;
    const halfWidth = routeRoadWidth(route) * 0.5;
    const lift = route.infrastructureLevel === 1 ? 0.055 : 0.10;
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      if (route.sharedSegmentOwners?.[index] >= 0 || intervalAt(route, index, 'bridges') || intervalAt(route, index, 'tunnels')) continue;
      const a = route.points[index], b = route.points[index + 1];
      const bx = unwrapNear(b.x, a.x, worldWidth), dx = bx - a.x, dz = b.z - a.z;
      const length = Math.max(0.001, Math.hypot(dx, dz)), nx = -dz / length, nz = dx / length;
      const steps = Math.max(1, Math.ceil(length));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps, x = wrap(a.x + dx * t, worldWidth), z = a.z + dz * t;
        if (sampleScalar(riverCoreMask, fieldWidth, fieldHeight, worldWidth, worldHeight, x, z) > 0.10) {
          unbridgedWater += 1;
          if (severe.length < 128) severe.push({ type: 'unbridged-water', routeId: route.id, x, z });
        }
        const top = route.profile[index] * (1 - t) + route.profile[index + 1] * t + lift;
        for (const lateral of [-halfWidth, 0, halfWidth]) {
          const terrain = sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, x + nx * lateral, z + nz * lateral);
          const penetration = terrain - (top - 0.03);
          const unsupported = top - terrain - 0.35;
          if (penetration > maximumPenetration) {
            maximumPenetration = penetration;
            worstPenetration = { routeId: route.id, x: x + nx * lateral, z: z + nz * lateral };
          }
          if (unsupported > maximumUnsupported) {
            maximumUnsupported = unsupported;
            worstUnsupported = { routeId: route.id, x: x + nx * lateral, z: z + nz * lateral };
          }
        }
      }
    }
  }
  if (maximumPenetration > 0.035) severe.push({ type: 'terrain-penetration', severity: maximumPenetration });
  if (maximumUnsupported > 0.36) severe.push({ type: 'unsupported-road', severity: maximumUnsupported });
  const report = {
    version: AUDIT_VERSION,
    converged: severe.length === 0,
    passes,
    timingsMs: { auditRepair: Math.round((performance.now() - started) * 10) / 10 },
    violations: { initial: initialViolations, final: severe.length, unbridgedWater, maximumPenetration, maximumUnsupported,
      worstPenetration, worstUnsupported },
    repairs: { terrainCells: appliedRepairs, sharedSegments: 0, sharedLength: 0 },
    repairedSites,
    severe,
    warnings: suppressedLocalStreets,
  };
  return { engineeringField, report };
}
