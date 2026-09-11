import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const TILE_SIZE = 96;
const PADDING = 7;
const INK = [246, 241, 218];

const entries = process.argv.slice(2).map((entry) => {
  const separator = entry.indexOf('=');
  if (separator < 1) throw new Error(`Expected name=input.png, received: ${entry}`);
  return { name: entry.slice(0, separator), inputPath: entry.slice(separator + 1) };
});
if (!entries.length) {
  throw new Error('Usage: node scripts/prepare-army-marker-silhouettes.mjs name=input.png [...]');
}

const outputDirectory = path.resolve('src/ui/assets/icons/ironfronts');
const atlasPath = path.resolve('src/ui/assets/army-unit-silhouettes.png');

function generatedCheckerMask(source) {
  const mask = new Uint8Array(source.width * source.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const r = source.data[offset];
    const g = source.data[offset + 1];
    const b = source.data[offset + 2];
    // The generated subjects use warm bone paint and charcoal line work. The
    // fake transparency checker is neutral grey, so chroma cleanly separates
    // the subject without copying the checker into the runtime sprite.
    const warmPaint = r > 135 && r - b > 8 && g - b > 4;
    const charcoal = r < 68 && g < 68 && b < 68;
    mask[pixel] = warmPaint || charcoal ? 255 : 0;
  }
  return mask;
}

function alphaMask(source) {
  const mask = new Uint8Array(source.width * source.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = source.data[pixel * 4 + 3];
  return mask;
}

function hasUsefulAlpha(source) {
  let transparentPixels = 0;
  for (let offset = 3; offset < source.data.length; offset += 4) {
    if (source.data[offset] < 250) transparentPixels += 1;
  }
  return transparentPixels > source.width * source.height * 0.05;
}

function keepSubjectComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const keep = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || mask[start] < 16) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    const pixels = [];
    while (head < tail) {
      const pixel = queue[head++];
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const neighbours = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (let direction = 0; direction < 4; direction += 1) {
        if ((direction === 0 && x === 0) || (direction === 1 && x === width - 1)
          || (direction === 2 && y === 0) || (direction === 3 && y === height - 1)) continue;
        const next = neighbours[direction];
        if (!visited[next] && mask[next] >= 16) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push(pixels);
  }
  components.sort((a, b) => b.length - a.length);
  const minimum = Math.max(48, (components[0]?.length ?? 0) * 0.004);
  for (const component of components) {
    if (component.length < minimum) break;
    for (const pixel of component) keep[pixel] = mask[pixel];
  }
  return keep;
}

function boundsForMask(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] < 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('No silhouette subject found.');
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function sinc(value) {
  if (Math.abs(value) < 1e-7) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

function lanczos(value, radius = 3) {
  const absolute = Math.abs(value);
  return absolute < radius ? sinc(value) * sinc(value / radius) : 0;
}

function sampleLanczos(mask, width, height, x, y, supportX, supportY) {
  const radiusX = Math.max(3, supportX * 3);
  const radiusY = Math.max(3, supportY * 3);
  const x0 = Math.floor(x - radiusX);
  const x1 = Math.ceil(x + radiusX);
  const y0 = Math.floor(y - radiusY);
  const y1 = Math.ceil(y + radiusY);
  let weighted = 0;
  let weights = 0;
  for (let sourceY = y0; sourceY <= y1; sourceY += 1) {
    if (sourceY < 0 || sourceY >= height) continue;
    const wy = lanczos((y - sourceY) / supportY);
    if (wy === 0) continue;
    for (let sourceX = x0; sourceX <= x1; sourceX += 1) {
      if (sourceX < 0 || sourceX >= width) continue;
      const wx = lanczos((x - sourceX) / supportX);
      const weight = wx * wy;
      weighted += mask[sourceY * width + sourceX] * weight;
      weights += weight;
    }
  }
  return weights === 0 ? 0 : Math.max(0, Math.min(255, Math.round(weighted / weights)));
}

function renderTile(mask, sourceWidth, sourceHeight, bounds) {
  const result = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  const available = TILE_SIZE - PADDING * 2;
  const scale = Math.min(available / bounds.width, available / bounds.height);
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  const left = (TILE_SIZE - drawWidth) / 2;
  const top = (TILE_SIZE - drawHeight) / 2;
  const support = Math.max(1, 1 / scale);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const offset = (y * TILE_SIZE + x) * 4;
      const inside = x + 0.5 >= left && x + 0.5 <= left + drawWidth
        && y + 0.5 >= top && y + 0.5 <= top + drawHeight;
      const sourceX = bounds.minX + (x + 0.5 - left) / scale - 0.5;
      const sourceY = bounds.minY + (y + 0.5 - top) / scale - 0.5;
      const alpha = inside
        ? sampleLanczos(mask, sourceWidth, sourceHeight, sourceX, sourceY, support, support)
        : 0;
      result.data[offset] = INK[0];
      result.data[offset + 1] = INK[1];
      result.data[offset + 2] = INK[2];
      result.data[offset + 3] = alpha;
    }
  }
  return result;
}

await mkdir(outputDirectory, { recursive: true });
const tiles = [];
for (const entry of entries) {
  const source = PNG.sync.read(await readFile(entry.inputPath));
  const rawMask = hasUsefulAlpha(source) ? alphaMask(source) : generatedCheckerMask(source);
  const mask = keepSubjectComponents(rawMask, source.width, source.height);
  const bounds = boundsForMask(mask, source.width, source.height);
  const tile = renderTile(mask, source.width, source.height, bounds);
  const outputPath = path.join(outputDirectory, `marker-${entry.name}.png`);
  await writeFile(outputPath, PNG.sync.write(tile, { colorType: 6 }));
  tiles.push(tile);
  console.log(`${outputPath}: ${TILE_SIZE}x${TILE_SIZE}`);
}

const atlas = new PNG({ width: TILE_SIZE * tiles.length, height: TILE_SIZE });
for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
  const tile = tiles[tileIndex];
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const sourceStart = y * TILE_SIZE * 4;
    const targetStart = (y * atlas.width + tileIndex * TILE_SIZE) * 4;
    tile.data.copy(atlas.data, targetStart, sourceStart, sourceStart + TILE_SIZE * 4);
  }
}
await mkdir(path.dirname(atlasPath), { recursive: true });
await writeFile(atlasPath, PNG.sync.write(atlas, { colorType: 6 }));
console.log(`${atlasPath}: ${atlas.width}x${atlas.height}`);
