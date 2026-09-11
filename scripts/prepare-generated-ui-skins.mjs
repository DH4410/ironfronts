import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const TRANSPARENT_THRESHOLD = 8;
const EDGE_PADDING = 2;

function parseEntry(value) {
  const equals = value.indexOf('=');
  const at = value.lastIndexOf('@');
  if (equals < 1 || at <= equals + 1) {
    throw new Error(`Expected name=input.png@WIDTHxHEIGHT, received: ${value}`);
  }
  const name = value.slice(0, equals);
  const dimensions = /^(\d+)x(\d+)$/.exec(value.slice(at + 1));
  if (!/^[a-z0-9-]+$/.test(name) || !dimensions) {
    throw new Error(`Invalid output name or dimensions: ${value}`);
  }
  return {
    name,
    inputPath: value.slice(equals + 1, at),
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
  };
}

const arguments_ = process.argv.slice(2);
const outputOption = arguments_.find((value) => value.startsWith('--output-dir='));
const despillRedEdges = arguments_.includes('--despill-red-edges');
const OUTPUT_DIRECTORY = path.resolve(outputOption?.slice('--output-dir='.length) || 'src/ui/assets/skins');
const entries = arguments_
  .filter((value) => !value.startsWith('--'))
  .map(parseEntry);
if (!entries.length) {
  throw new Error('Usage: node scripts/prepare-generated-ui-skins.mjs [--output-dir=path] [--despill-red-edges] name=input.png@WIDTHxHEIGHT [...]');
}

function alphaBounds(source) {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.data[(y * source.width + x) * 4 + 3] < TRANSPARENT_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Generated skin has no visible pixels.');
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
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

function resizePremultiplied(source, bounds, targetWidth, targetHeight) {
  const horizontal = new Float32Array(targetWidth * bounds.height * 4);
  const scaleX = bounds.width / targetWidth;
  const filterScaleX = Math.max(1, scaleX);
  const supportX = 3 * filterScaleX;

  for (let x = 0; x < targetWidth; x += 1) {
    const centerX = bounds.minX + (x + 0.5) * scaleX - 0.5;
    const startX = Math.max(bounds.minX, Math.floor(centerX - supportX));
    const endX = Math.min(bounds.minX + bounds.width - 1, Math.ceil(centerX + supportX));
    for (let y = 0; y < bounds.height; y += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let weightTotal = 0;
      for (let sourceX = startX; sourceX <= endX; sourceX += 1) {
        const weight = lanczos((centerX - sourceX) / filterScaleX);
        if (weight === 0) continue;
        const sourceOffset = ((bounds.minY + y) * source.width + sourceX) * 4;
        const sourceAlpha = source.data[sourceOffset + 3] / 255;
        red += source.data[sourceOffset] / 255 * sourceAlpha * weight;
        green += source.data[sourceOffset + 1] / 255 * sourceAlpha * weight;
        blue += source.data[sourceOffset + 2] / 255 * sourceAlpha * weight;
        alpha += sourceAlpha * weight;
        weightTotal += weight;
      }
      const targetOffset = (y * targetWidth + x) * 4;
      const divisor = Math.abs(weightTotal) > 1e-7 ? weightTotal : 1;
      horizontal[targetOffset] = red / divisor;
      horizontal[targetOffset + 1] = green / divisor;
      horizontal[targetOffset + 2] = blue / divisor;
      horizontal[targetOffset + 3] = alpha / divisor;
    }
  }

  const result = new PNG({ width: targetWidth, height: targetHeight });
  const scaleY = bounds.height / targetHeight;
  const filterScaleY = Math.max(1, scaleY);
  const supportY = 3 * filterScaleY;
  for (let y = 0; y < targetHeight; y += 1) {
    const centerY = (y + 0.5) * scaleY - 0.5;
    const startY = Math.max(0, Math.floor(centerY - supportY));
    const endY = Math.min(bounds.height - 1, Math.ceil(centerY + supportY));
    for (let x = 0; x < targetWidth; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let weightTotal = 0;
      for (let sourceY = startY; sourceY <= endY; sourceY += 1) {
        const weight = lanczos((centerY - sourceY) / filterScaleY);
        if (weight === 0) continue;
        const sourceOffset = (sourceY * targetWidth + x) * 4;
        red += horizontal[sourceOffset] * weight;
        green += horizontal[sourceOffset + 1] * weight;
        blue += horizontal[sourceOffset + 2] * weight;
        alpha += horizontal[sourceOffset + 3] * weight;
        weightTotal += weight;
      }
      const divisor = Math.abs(weightTotal) > 1e-7 ? weightTotal : 1;
      const resolvedAlpha = Math.max(0, Math.min(1, alpha / divisor));
      const targetOffset = (y * targetWidth + x) * 4;
      result.data[targetOffset] = resolvedAlpha > 1e-5
        ? Math.round(Math.max(0, Math.min(1, red / divisor / resolvedAlpha)) * 255) : 0;
      result.data[targetOffset + 1] = resolvedAlpha > 1e-5
        ? Math.round(Math.max(0, Math.min(1, green / divisor / resolvedAlpha)) * 255) : 0;
      result.data[targetOffset + 2] = resolvedAlpha > 1e-5
        ? Math.round(Math.max(0, Math.min(1, blue / divisor / resolvedAlpha)) * 255) : 0;
      result.data[targetOffset + 3] = Math.round(resolvedAlpha * 255);
    }
  }
  return result;
}

function renderSkin(source, width, height) {
  const bounds = alphaBounds(source);
  const availableWidth = width - EDGE_PADDING * 2;
  const availableHeight = height - EDGE_PADDING * 2;
  const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  const drawWidth = Math.max(1, Math.round(bounds.width * scale));
  const drawHeight = Math.max(1, Math.round(bounds.height * scale));
  const resized = resizePremultiplied(source, bounds, drawWidth, drawHeight);
  const result = new PNG({ width, height });
  const left = Math.floor((width - drawWidth) / 2);
  const top = Math.floor((height - drawHeight) / 2);
  for (let y = 0; y < drawHeight; y += 1) {
    const sourceStart = y * drawWidth * 4;
    const targetStart = ((top + y) * width + left) * 4;
    resized.data.copy(result.data, targetStart, sourceStart, sourceStart + drawWidth * 4);
  }
  return result;
}

function removeRedEdgeMatte(image) {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    if (alpha === 0 || alpha >= 250) continue;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    if (red < 80 || red <= green * 1.35 || red <= blue * 1.5) continue;
    image.data[offset] = Math.round(Math.min(red, Math.max(green, blue) * 1.08));
  }
}

function enclosedSilhouetteMask(source) {
  const outside = new Uint8Array(source.width * source.height);
  const queue = new Int32Array(outside.length);
  let head = 0;
  let tail = 0;
  const enqueue = (x, y) => {
    const pixel = y * source.width + x;
    if (outside[pixel] || source.data[pixel * 4 + 3] >= TRANSPARENT_THRESHOLD) return;
    outside[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < source.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, source.height - 1);
  }
  for (let y = 0; y < source.height; y += 1) {
    enqueue(0, y);
    enqueue(source.width - 1, y);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % source.width;
    const y = Math.floor(pixel / source.width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < source.width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < source.height) enqueue(x, y + 1);
  }
  const mask = new PNG({ width: source.width, height: source.height });
  for (let pixel = 0; pixel < outside.length; pixel += 1) {
    const offset = pixel * 4;
    mask.data[offset] = 255;
    mask.data[offset + 1] = 255;
    mask.data[offset + 2] = 255;
    mask.data[offset + 3] = outside[pixel] ? 0 : 255;
  }
  return mask;
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
for (const entry of entries) {
  const source = PNG.sync.read(await readFile(entry.inputPath));
  const output = renderSkin(source, entry.width, entry.height);
  if (despillRedEdges) removeRedEdgeMatte(output);
  const outputPath = path.join(OUTPUT_DIRECTORY, `${entry.name}.png`);
  await writeFile(outputPath, PNG.sync.write(output, { colorType: 6 }));
  console.log(`${outputPath}: ${entry.width}x${entry.height}`);
  if (entry.name === 'army-unit-card-frame') {
    const maskPath = path.join(OUTPUT_DIRECTORY, 'army-unit-card-mask.png');
    const mask = enclosedSilhouetteMask(output);
    await writeFile(maskPath, PNG.sync.write(mask, { colorType: 6 }));
    console.log(`${maskPath}: ${entry.width}x${entry.height}`);
  }
}
