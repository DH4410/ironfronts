import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTING_CACHE_VERSION } from './common.mjs';
import { adaptRoute } from './road-routing.mjs';

function routeCachePath(routes, heights, landField) {
  const digest = createHash('sha256')
    .update(ROUTING_CACHE_VERSION)
    .update(JSON.stringify(routes.map((route) => [route.start, route.end, route.points])))
    .update(Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength))
    .update(Buffer.from(landField.buffer, landField.byteOffset, landField.byteLength))
    .digest('hex').slice(0, 20);
  const directory = path.resolve('artifacts', 'road-cache');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${ROUTING_CACHE_VERSION}-${digest}.json`);
}

export function adaptRoutesWithCache(routes, context) {
  const cachePath = routeCachePath(routes, context.heights, context.landField);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (cached.version === ROUTING_CACHE_VERSION && cached.routes.length === routes.length) {
        for (let index = 0; index < routes.length; index += 1) routes[index].points = cached.routes[index];
        console.log(`Reused terrain-draped road cache ${path.basename(cachePath)}`);
        return;
      }
    } catch (error) {
      console.warn(`Ignoring unreadable road routing cache: ${error.message}`);
    }
  }
  for (const route of routes) adaptRoute(route, context);
  writeFileSync(cachePath, JSON.stringify({ version: ROUTING_CACHE_VERSION, routes: routes.map((route) => route.points) }));
  console.log(`Stored terrain-draped road cache ${path.basename(cachePath)}`);
}
