export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function wrap(value, size) {
  return ((value % size) + size) % size;
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function blurField(source, width, height, radius, passes = 1) {
  let input = source;
  let output = new Float32Array(source.length);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) sum += input[row + wrap(x, width)];
      for (let x = 0; x < width; x += 1) {
        output[row + x] = sum / (radius * 2 + 1);
        sum -= input[row + wrap(x - radius, width)];
        sum += input[row + wrap(x + radius + 1, width)];
      }
    }
    [input, output] = [output, input];

    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) sum += input[clamp(y, 0, height - 1) * width + x];
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = sum / (radius * 2 + 1);
        sum -= input[clamp(y - radius, 0, height - 1) * width + x];
        sum += input[clamp(y + radius + 1, 0, height - 1) * width + x];
      }
    }
    [input, output] = [output, input];
  }
  return input;
}

export function distanceToValue(field, width, height, target) {
  const distance = new Float32Array(field.length);
  distance.fill(1e6);
  for (let index = 0; index < field.length; index += 1) {
    if (field[index] === target) distance[index] = 0;
  }
  const diagonal = Math.SQRT2;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        distance[index] = Math.min(
          distance[index],
          distance[y * width + wrap(x - 1, width)] + 1,
          y > 0 ? distance[(y - 1) * width + x] + 1 : 1e6,
          y > 0 ? distance[(y - 1) * width + wrap(x - 1, width)] + diagonal : 1e6,
          y > 0 ? distance[(y - 1) * width + wrap(x + 1, width)] + diagonal : 1e6,
        );
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x;
        distance[index] = Math.min(
          distance[index],
          distance[y * width + wrap(x + 1, width)] + 1,
          y + 1 < height ? distance[(y + 1) * width + x] + 1 : 1e6,
          y + 1 < height ? distance[(y + 1) * width + wrap(x - 1, width)] + diagonal : 1e6,
          y + 1 < height ? distance[(y + 1) * width + wrap(x + 1, width)] + diagonal : 1e6,
        );
      }
    }
  }
  return distance;
}

