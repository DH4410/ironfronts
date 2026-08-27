import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { clamp, wrap } from './raster.mjs';

const MATERIAL_NAMES = [
  'grassland', 'dry-earth', 'desert-sand', 'forest-floor',
  'exposed-rock', 'tundra-snow', 'urban-ground', 'shoreline',
];
const MATERIAL_SIZE = 512;
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

export function buildTerrainNormals({ heights, width, height, worldWidth, worldHeight }) {
  const output = new Uint8Array(width * height * 2);
  const stepX = worldWidth / width;
  const stepZ = worldHeight / height;
  for (let y = 0; y < height; y += 1) {
    const upY = Math.max(0, y - 1);
    const downY = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const left = heights[y * width + wrap(x - 1, width)];
      const right = heights[y * width + wrap(x + 1, width)];
      const up = heights[upY * width + x];
      const down = heights[downY * width + x];
      const nx = (left - right) / (stepX * 2);
      const nz = (up - down) / (stepZ * 2);
      const inverseLength = 1 / Math.hypot(nx, 1, nz);
      const offset = (y * width + x) * 2;
      output[offset] = Math.round(clamp(nx * inverseLength, -1, 1) * 127) & 255;
      output[offset + 1] = Math.round(clamp(nz * inverseLength, -1, 1) * 127) & 255;
    }
  }
  return output;
}

export function buildNavigationField(roads, waterways) {
  if (roads.length !== waterways.length) throw new Error('Road and waterway fields must have matching RG dimensions');
  const output = new Uint8Array(roads.length * 2);
  for (let source = 0, target = 0; source < roads.length; source += 2, target += 4) {
    output[target] = roads[source];
    output[target + 1] = roads[source + 1];
    output[target + 2] = waterways[source];
    output[target + 3] = waterways[source + 1];
  }
  return output;
}

export async function buildBakedTerrainAlbedo({
  textureDirectory, heights, surface, coastField, coastWidth, coastHeight,
  width, height, worldWidth, worldHeight, trees, buildings,
}) {
  const materials = [];
  for (const name of MATERIAL_NAMES) {
    const png = PNG.sync.read(await readFile(path.join(textureDirectory, `${name}.png`)));
    materials.push(resizeMaterialLinear(png, MATERIAL_SIZE));
  }

  const output = new Uint8Array(width * height * 4);
  const base = new Float32Array(3);
  const first = new Float32Array(3);
  const second = new Float32Array(3);
  const sampleA = new Float32Array(3);
  const sampleB = new Float32Array(3);
  const landBank = new Float32Array(2);
  const stepX = worldWidth / width;
  const stepZ = worldHeight / height;

  const sampleMaterial = (layer, worldX, worldZ, scale, target) => {
    const rawAX = worldX / scale;
    const rawAY = worldZ / scale;
    const rawBX = (worldX + worldZ * 0.17) / (scale * 3.71);
    const rawBY = (worldZ - worldX * 0.11) / (scale * 3.71);
    sampleLinear(materials[layer], mirroredUv(rawAX), mirroredUv(rawAY), sampleA);
    sampleLinear(materials[layer], mirroredUv(rawBX), mirroredUv(rawBY), sampleB);
    target[0] = sampleA[0] * 0.82 + sampleB[0] * 0.18;
    target[1] = sampleA[1] * 0.82 + sampleB[1] * 0.18;
    target[2] = sampleA[2] * 0.82 + sampleB[2] * 0.18;
  };

  for (let y = 0; y < height; y += 1) {
    const worldZ = (y + 0.5) / height * worldHeight;
    const upY = Math.max(0, y - 1);
    const downY = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      if (surface[offset + 3] === 0) {
        output[offset + 3] = 255;
        continue;
      }
      const worldX = (x + 0.5) / width * worldWidth;
      const terrain = surface[offset];
      const biome = surface[offset + 1];
      const nx = (heights[y * width + wrap(x - 1, width)] - heights[y * width + wrap(x + 1, width)]) / (stepX * 2);
      const nz = (heights[upY * width + x] - heights[downY * width + x]) / (stepZ * 2);
      const normalY = 1 / Math.hypot(nx, 1, nz);
      const slope = 1 - normalY;
      const elevation = heights[index];

      sampleMaterial(0, worldX, worldZ, 92, base);
      if (biome === 1 || biome === 7) {
        sampleMaterial(2, worldX, worldZ, 76, base);
      } else if (biome === 2 && terrain !== 3) {
        sampleMaterial(0, worldX, worldZ, 90, first);
        sampleMaterial(1, worldX, worldZ, 74, second);
        mixRgb(first, second, 0.48, base);
      } else if (biome === 6 || biome === 8) {
        sampleMaterial(5, worldX, worldZ, 86, first);
        sampleMaterial(4, worldX, worldZ, 68, second);
        mixRgb(first, second, slope * 2, base);
      }

      if (terrain === 1) {
        sampleMaterial(4, worldX, worldZ, 65, first);
        mixRgb(base, first, clamp(slope * 3.4 + 0.12, 0, 0.7), base);
      } else if (terrain === 2) {
        sampleMaterial(4, worldX, worldZ, 58, first);
        sampleMaterial(5, worldX, worldZ, 80, second);
        const snow = smoothstep(120, 205, elevation) * smoothstep(0.58, 0.92, normalY);
        mixRgb(first, second, snow, base);
      } else if (terrain === 3) {
        sampleMaterial(3, worldX, worldZ, 70, base);
      } else if (terrain === 4) {
        sampleMaterial(6, worldX, worldZ, 54, first);
        sampleMaterial(1, worldX, worldZ, 68, second);
        mixRgb(first, second, 0.22, base);
      }

      sampleRgField(coastField, coastWidth, coastHeight, (x + 0.5) / width, (y + 0.5) / height, landBank);
      const shoreline = landBank[1] * smoothstep(0.5, 0.72, landBank[0]);
      // The bank field includes both coasts and river edges. River banks may
      // occur at any elevation, so keep this a restrained material fade rather
      // than limiting it to sea-level terrain.
      const beachAmount = shoreline * 0.72;
      if (beachAmount > 0.001) {
        sampleMaterial(7, worldX, worldZ, 52, first);
        mixRgb(base, first, beachAmount, base);
      }
      output[offset] = linearToSrgbByte(base[0]);
      output[offset + 1] = linearToSrgbByte(base[1]);
      output[offset + 2] = linearToSrgbByte(base[2]);
      output[offset + 3] = 255;
    }
  }

  bakePropAo(output, width, height, worldWidth, worldHeight, trees, buildings);
  const mipLevels = buildSrgbMipChain(output, width, height);
  const byteLength = mipLevels.reduce((sum, level) => sum + level.data.byteLength, 0);
  const data = new Uint8Array(byteLength);
  let cursor = 0;
  for (const level of mipLevels) {
    data.set(level.data, cursor);
    cursor += level.data.byteLength;
  }
  return { data, mipLevelCount: mipLevels.length };
}

function resizeMaterialLinear(png, targetSize) {
  const output = new Float32Array(targetSize * targetSize * 3);
  for (let y = 0; y < targetSize; y += 1) {
    const sourceY = (y + 0.5) / targetSize * png.height - 0.5;
    const y0 = clamp(Math.floor(sourceY), 0, png.height - 1);
    const y1 = clamp(y0 + 1, 0, png.height - 1);
    const fy = sourceY - Math.floor(sourceY);
    for (let x = 0; x < targetSize; x += 1) {
      const sourceX = (x + 0.5) / targetSize * png.width - 0.5;
      const x0 = clamp(Math.floor(sourceX), 0, png.width - 1);
      const x1 = clamp(x0 + 1, 0, png.width - 1);
      const fx = sourceX - Math.floor(sourceX);
      const target = (y * targetSize + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = SRGB_TO_LINEAR[png.data[(y0 * png.width + x0) * 4 + channel]] * (1 - fx)
          + SRGB_TO_LINEAR[png.data[(y0 * png.width + x1) * 4 + channel]] * fx;
        const bottom = SRGB_TO_LINEAR[png.data[(y1 * png.width + x0) * 4 + channel]] * (1 - fx)
          + SRGB_TO_LINEAR[png.data[(y1 * png.width + x1) * 4 + channel]] * fx;
        output[target + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return output;
}

function sampleLinear(texture, u, v, output) {
  const positionX = u * MATERIAL_SIZE - 0.5;
  const positionY = v * MATERIAL_SIZE - 0.5;
  const floorX = Math.floor(positionX);
  const floorY = Math.floor(positionY);
  const x0 = wrap(floorX, MATERIAL_SIZE);
  const x1 = wrap(floorX + 1, MATERIAL_SIZE);
  const y0 = wrap(floorY, MATERIAL_SIZE);
  const y1 = wrap(floorY + 1, MATERIAL_SIZE);
  const fx = positionX - floorX;
  const fy = positionY - floorY;
  for (let channel = 0; channel < 3; channel += 1) {
    const top = texture[(y0 * MATERIAL_SIZE + x0) * 3 + channel] * (1 - fx)
      + texture[(y0 * MATERIAL_SIZE + x1) * 3 + channel] * fx;
    const bottom = texture[(y1 * MATERIAL_SIZE + x0) * 3 + channel] * (1 - fx)
      + texture[(y1 * MATERIAL_SIZE + x1) * 3 + channel] * fx;
    output[channel] = top * (1 - fy) + bottom * fy;
  }
}

function sampleRgField(field, width, height, u, v, result) {
  const positionX = u * width - 0.5;
  const positionY = v * height - 0.5;
  const floorX = Math.floor(positionX);
  const floorY = Math.floor(positionY);
  const x0 = wrap(floorX, width);
  const x1 = wrap(floorX + 1, width);
  const y0 = clamp(floorY, 0, height - 1);
  const y1 = clamp(floorY + 1, 0, height - 1);
  const fx = positionX - floorX;
  const fy = positionY - floorY;
  for (let channel = 0; channel < 2; channel += 1) {
    const top = field[(y0 * width + x0) * 2 + channel] * (1 - fx) + field[(y0 * width + x1) * 2 + channel] * fx;
    const bottom = field[(y1 * width + x0) * 2 + channel] * (1 - fx) + field[(y1 * width + x1) * 2 + channel] * fx;
    result[channel] = (top * (1 - fy) + bottom * fy) / 255;
  }
}

function bakePropAo(output, width, height, worldWidth, worldHeight, trees, buildings) {
  const splat = (worldX, worldZ, radiusX, radiusZ, strength) => {
    const centerX = worldX / worldWidth * width;
    const centerY = worldZ / worldHeight * height;
    const pixelRadiusX = Math.max(1, radiusX / worldWidth * width);
    const pixelRadiusY = Math.max(1, radiusZ / worldHeight * height);
    const minimumX = Math.floor(centerX - pixelRadiusX);
    const maximumX = Math.ceil(centerX + pixelRadiusX);
    const minimumY = Math.max(0, Math.floor(centerY - pixelRadiusY));
    const maximumY = Math.min(height - 1, Math.ceil(centerY + pixelRadiusY));
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const dx = (x + 0.5 - centerX) / pixelRadiusX;
        const dy = (y + 0.5 - centerY) / pixelRadiusY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= 1) continue;
        const wrappedX = wrap(x, width);
        const alphaOffset = (y * width + wrappedX) * 4 + 3;
        const occlusion = strength * (1 - smoothstep(0.15, 1, Math.sqrt(distanceSquared)));
        output[alphaOffset] = Math.min(output[alphaOffset], Math.round((1 - occlusion) * 255));
      }
    }
  };
  // Contact darkening only. Higher strengths baked a hard near-black ring into
  // the terrain albedo around every forest and city that read as scorched
  // ground once terrain shading and canopy tint stacked on top.
  for (let offset = 0; offset < trees.length; offset += 8) {
    const radius = Math.max(6.5, trees[offset + 2] * 5.2);
    splat(trees[offset], trees[offset + 1], radius, radius, 0.13);
  }
  for (let offset = 0; offset < buildings.length; offset += 8) {
    splat(buildings[offset], buildings[offset + 1], Math.max(5, buildings[offset + 2] * 0.72),
      Math.max(5, buildings[offset + 4] * 0.72), 0.17);
  }
}

function buildSrgbMipChain(base, baseWidth, baseHeight) {
  const levels = [{ data: base, width: baseWidth, height: baseHeight }];
  while (levels.at(-1).width > 1 || levels.at(-1).height > 1) {
    const source = levels.at(-1);
    const width = Math.max(1, Math.floor(source.width / 2));
    const height = Math.max(1, Math.floor(source.height / 2));
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          let linear = 0;
          for (let oy = 0; oy < 2; oy += 1) for (let ox = 0; ox < 2; ox += 1) {
            const sx = Math.min(source.width - 1, x * 2 + ox);
            const sy = Math.min(source.height - 1, y * 2 + oy);
            linear += SRGB_TO_LINEAR[source.data[(sy * source.width + sx) * 4 + channel]];
          }
          data[target + channel] = linearToSrgbByte(linear * 0.25);
        }
        let alpha = 0;
        for (let oy = 0; oy < 2; oy += 1) for (let ox = 0; ox < 2; ox += 1) {
          const sx = Math.min(source.width - 1, x * 2 + ox);
          const sy = Math.min(source.height - 1, y * 2 + oy);
          alpha += source.data[(sy * source.width + sx) * 4 + 3];
        }
        data[target + 3] = Math.round(alpha * 0.25);
      }
    }
    levels.push({ data, width, height });
  }
  return levels;
}

function mirroredUv(value) {
  const tile = ((value * 0.5 % 1) + 1) % 1 * 2;
  return 1 - Math.abs(tile - 1);
}

function mixRgb(a, b, amountInput, output) {
  const amount = clamp(amountInput, 0, 1);
  output[0] = a[0] * (1 - amount) + b[0] * amount;
  output[1] = a[1] * (1 - amount) + b[1] * amount;
  output[2] = a[2] * (1 - amount) + b[2] * amount;
}

function smoothstep(minimum, maximum, value) {
  const t = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
}

function linearToSrgbByte(valueInput) {
  const value = clamp(valueInput, 0, 1);
  const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}
