import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/prepare-army-marker-plate.mjs <input.png> <output.png>');
}

const source = PNG.sync.read(await readFile(inputPath));

function looksLikePlate(r, g, b, a) {
  if (a < 250) return false;
  const brightest = Math.max(r, g, b);
  const darkest = Math.min(r, g, b);
  // Image generators sometimes render a gray transparency checkerboard into
  // the bitmap. The counter itself is dark gunmetal or chromatic green/brass.
  return brightest < 130 || brightest - darkest > 22;
}

let minX = source.width;
let minY = source.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
    const offset = (y * source.width + x) * 4;
    if (!looksLikePlate(
      source.data[offset], source.data[offset + 1], source.data[offset + 2], source.data[offset + 3],
    )) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
}
if (maxX < minX || maxY < minY) throw new Error('Could not locate the marker plate.');

const cropWidth = maxX - minX + 1;
const cropHeight = maxY - minY + 1;
const targetWidth = 512;
const targetHeight = Math.max(1, Math.round(targetWidth * cropHeight / cropWidth));
const result = new PNG({ width: targetWidth, height: targetHeight });

function sample(channel, x, y) {
  const sourceX = minX + Math.min(cropWidth - 1, Math.max(0, x));
  const sourceY = minY + Math.min(cropHeight - 1, Math.max(0, y));
  return source.data[(sourceY * source.width + sourceX) * 4 + channel];
}

function bilinear(channel, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cropWidth - 1, x0 + 1);
  const y1 = Math.min(cropHeight - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = sample(channel, x0, y0) * (1 - tx) + sample(channel, x1, y0) * tx;
  const bottom = sample(channel, x0, y1) * (1 - tx) + sample(channel, x1, y1) * tx;
  return Math.round(top * (1 - ty) + bottom * ty);
}

function roundedRectAlpha(x, y) {
  const radius = targetHeight * 0.115;
  const halfWidth = (targetWidth - 1) / 2;
  const halfHeight = (targetHeight - 1) / 2;
  const dx = Math.max(Math.abs(x - halfWidth) - (halfWidth - radius), 0);
  const dy = Math.max(Math.abs(y - halfHeight) - (halfHeight - radius), 0);
  const signedDistance = Math.hypot(dx, dy) - radius;
  return Math.max(0, Math.min(1, 0.5 - signedDistance));
}

for (let y = 0; y < targetHeight; y += 1) {
  for (let x = 0; x < targetWidth; x += 1) {
    const sourceX = (x + 0.5) / targetWidth * cropWidth - 0.5;
    const sourceY = (y + 0.5) / targetHeight * cropHeight - 0.5;
    const offset = (y * targetWidth + x) * 4;
    result.data[offset] = bilinear(0, sourceX, sourceY);
    result.data[offset + 1] = bilinear(1, sourceX, sourceY);
    result.data[offset + 2] = bilinear(2, sourceX, sourceY);
    result.data[offset + 3] = Math.round(255 * roundedRectAlpha(x, y));
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, PNG.sync.write(result, { colorType: 6 }));
console.log(`${outputPath}: ${targetWidth}x${targetHeight}`);
