export interface CountryAnchor {
  countryId: number;
  x: number;
  z: number;
  axisX: number;
  axisZ: number;
  span: number;
  crossSpan: number;
}

export function createCountryAnchor(
  countryId: number,
  component: number[],
  labelData: Float32Array,
  worldWidth: number,
): CountryAnchor | null {
  if (!component.length) return null;
  const referenceX = labelData[component[0] * 3];
  let totalWeight = 0;
  let meanX = 0;
  let meanZ = 0;
  const points: Array<{ province: number; x: number; z: number; weight: number; radius: number }> = [];
  for (const province of component) {
    const offset = province * 3;
    const x = unwrapNear(labelData[offset], referenceX, worldWidth);
    const z = labelData[offset + 1];
    const weight = Math.max(1, labelData[offset + 2]);
    const radius = Math.sqrt(weight / Math.PI) * (worldWidth / 4_096) * 0.72;
    points.push({ province, x, z, weight, radius });
    totalWeight += weight;
    meanX += x * weight;
    meanZ += z * weight;
  }
  meanX /= totalWeight;
  meanZ /= totalWeight;
  let covarianceXX = 0;
  let covarianceXZ = 0;
  let covarianceZZ = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dz = point.z - meanZ;
    covarianceXX += dx * dx * point.weight;
    covarianceXZ += dx * dz * point.weight;
    covarianceZZ += dz * dz * point.weight;
  }
  const angle = Math.abs(covarianceXX) + Math.abs(covarianceZZ) < 0.001
    ? 0
    : 0.5 * Math.atan2(covarianceXZ * 2, covarianceXX - covarianceZZ);
  const axisX = Math.cos(angle);
  const axisZ = Math.sin(angle);
  let minimum = Infinity;
  let maximum = -Infinity;
  let crossMinimum = Infinity;
  let crossMaximum = -Infinity;
  for (const point of points) {
    const projection = point.x * axisX + point.z * axisZ;
    const crossProjection = point.x * -axisZ + point.z * axisX;
    minimum = Math.min(minimum, projection - point.radius);
    maximum = Math.max(maximum, projection + point.radius);
    crossMinimum = Math.min(crossMinimum, crossProjection - point.radius);
    crossMaximum = Math.max(crossMaximum, crossProjection + point.radius);
  }
  const centerProjection = (minimum + maximum) * 0.5;
  const centerCrossProjection = (crossMinimum + crossMaximum) * 0.5;
  const projectionSpan = Math.max(1, maximum - minimum);
  const crossProjectionSpan = Math.max(1, crossMaximum - crossMinimum);
  let anchorPoint = points[0];
  let nearest = Infinity;
  for (const point of points) {
    const projection = point.x * axisX + point.z * axisZ;
    const crossProjection = point.x * -axisZ + point.z * axisX;
    const normalizedMajor = (projection - centerProjection) / projectionSpan;
    const normalizedCross = (crossProjection - centerCrossProjection) / crossProjectionSpan;
    const distance = normalizedMajor * normalizedMajor + normalizedCross * normalizedCross
      - Math.log2(point.weight + 1) * 0.002;
    if (distance < nearest) {
      nearest = distance;
      anchorPoint = point;
    }
  }
  const anchorProjection = anchorPoint.x * axisX + anchorPoint.z * axisZ;
  const anchorCrossProjection = anchorPoint.x * -axisZ + anchorPoint.z * axisX;
  const centeredSpan = Math.min(anchorProjection - minimum, maximum - anchorProjection) * 2;
  const centeredCrossSpan = Math.min(
    anchorCrossProjection - crossMinimum,
    crossMaximum - anchorCrossProjection,
  ) * 2;
  return {
    countryId,
    x: wrap(anchorPoint.x, worldWidth),
    z: anchorPoint.z,
    axisX,
    axisZ,
    span: centeredSpan,
    crossSpan: centeredCrossSpan,
  };
}

function unwrapNear(value: number, reference: number, worldWidth: number): number {
  let result = value;
  while (result - reference > worldWidth * 0.5) result -= worldWidth;
  while (result - reference < -worldWidth * 0.5) result += worldWidth;
  return result;
}

function wrap(value: number, worldWidth: number): number {
  return ((value % worldWidth) + worldWidth) % worldWidth;
}
