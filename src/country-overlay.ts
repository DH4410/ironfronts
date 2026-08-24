import type { CountryRecord } from './types';

interface CountryAnchor {
  countryId: number;
  x: number;
  z: number;
  axisX: number;
  axisZ: number;
  span: number;
  crossSpan: number;
}

export interface CountryOwnershipChange {
  provinceId: number;
  previousCountryId: number;
  countryId: number;
}

const LABEL_FONT_FAMILY = '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif';
const LABEL_FONT_WEIGHT = 700;
const LABEL_LETTER_SPACING = 0.1;
const MEASUREMENT_SIZE = 20;

export function buildCountryColorBuffer(countries: CountryRecord[]): Float32Array {
  const maximumId = Math.max(0, ...countries.map((country) => country.id));
  const colors = new Float32Array((maximumId + 1) * 4);
  for (const country of countries) {
    const [red, green, blue] = parseHexColor(country.color);
    const offset = country.id * 4;
    colors[offset] = red;
    colors[offset + 1] = green;
    colors[offset + 2] = blue;
    colors[offset + 3] = 1;
  }
  return colors;
}

export class CountryLabelLayer {
  private readonly elements = new Map<number, HTMLSpanElement>();
  private readonly countryById = new Map<number, CountryRecord>();
  private readonly measuredLabelWidths = new Map<number, number>();
  private readonly measurementContext: CanvasRenderingContext2D;
  private readonly neighbors: number[][];
  private readonly provincesByCountry = new Map<number, Set<number>>();
  private readonly anchors = new Map<number, CountryAnchor>();
  private readonly visitMarks: Uint32Array;
  private visitEpoch = 0;
  private visible = true;

  constructor(
    private readonly container: HTMLElement,
    countries: CountryRecord[],
    private readonly owners: Uint32Array,
    adjacencyPairs: Uint32Array,
    private readonly labelData: Float32Array,
    private readonly worldWidth: number,
  ) {
    const measurementContext = document.createElement('canvas').getContext('2d');
    if (!measurementContext) throw new Error('Country labels require a 2D canvas context');
    this.measurementContext = measurementContext;
    this.visitMarks = new Uint32Array(owners.length);
    this.neighbors = Array.from({ length: owners.length }, () => [] as number[]);
    for (let index = 0; index + 1 < adjacencyPairs.length; index += 2) {
      const a = adjacencyPairs[index];
      const b = adjacencyPairs[index + 1];
      if (a >= owners.length || b >= owners.length) continue;
      this.neighbors[a].push(b);
      this.neighbors[b].push(a);
    }
    const fragment = document.createDocumentFragment();
    for (const country of countries) {
      this.countryById.set(country.id, country);
      const element = document.createElement('span');
      element.className = 'country-label';
      element.textContent = country.name.toLocaleUpperCase();
      element.dataset.countryId = String(country.id);
      element.style.setProperty('--country-color', country.color);
      this.elements.set(country.id, element);
      this.measuredLabelWidths.set(country.id, this.measureTextWidth(element.textContent, MEASUREMENT_SIZE));
      fragment.append(element);
    }
    for (let province = 1; province < owners.length; province += 1) {
      const countryId = owners[province];
      if (!countryId) continue;
      let provinces = this.provincesByCountry.get(countryId);
      if (!provinces) {
        provinces = new Set<number>();
        this.provincesByCountry.set(countryId, provinces);
      }
      provinces.add(province);
    }
    container.replaceChildren(fragment);
    this.rebuildCountries(this.countryById.keys());
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.hidden = !visible;
  }

  refreshOwnership(changes: CountryOwnershipChange[]): void {
    const affectedCountries = new Set<number>();
    for (const change of changes) {
      if (change.previousCountryId === change.countryId) continue;
      this.provincesByCountry.get(change.previousCountryId)?.delete(change.provinceId);
      let provinces = this.provincesByCountry.get(change.countryId);
      if (!provinces) {
        provinces = new Set<number>();
        this.provincesByCountry.set(change.countryId, provinces);
      }
      provinces.add(change.provinceId);
      affectedCountries.add(change.previousCountryId);
      affectedCountries.add(change.countryId);
    }
    this.rebuildCountries(affectedCountries);
  }

  update(
    viewProjection: ArrayLike<number>,
    width: number,
    height: number,
    sampleHeight: (x: number, z: number) => number,
  ): number {
    if (!this.visible || width <= 1 || height <= 1) return 0;
    let visibleLabels = 0;
    for (const element of this.elements.values()) element.hidden = true;

    for (const anchor of this.anchors.values()) {
      const country = this.countryById.get(anchor.countryId);
      const element = this.elements.get(anchor.countryId);
      if (!country || !element) continue;
      const center = this.projectBestCopy(anchor.x, sampleHeight(anchor.x, anchor.z) + 7, anchor.z, viewProjection, width, height);
      if (!center) continue;
      const halfSpan = anchor.span * 0.46;
      const left = projectPoint(
        center.worldX - anchor.axisX * halfSpan,
        center.worldY,
        anchor.z - anchor.axisZ * halfSpan,
        viewProjection, width, height,
      );
      const right = projectPoint(
        center.worldX + anchor.axisX * halfSpan,
        center.worldY,
        anchor.z + anchor.axisZ * halfSpan,
        viewProjection, width, height,
      );
      if (!left || !right) continue;
      const screenSpan = Math.hypot(right.x - left.x, right.y - left.y);
      const crossAxisX = -anchor.axisZ;
      const crossAxisZ = anchor.axisX;
      const halfCrossSpan = anchor.crossSpan * 0.42;
      const crossStart = projectPoint(
        center.worldX - crossAxisX * halfCrossSpan,
        center.worldY,
        anchor.z - crossAxisZ * halfCrossSpan,
        viewProjection, width, height,
      );
      const crossEnd = projectPoint(
        center.worldX + crossAxisX * halfCrossSpan,
        center.worldY,
        anchor.z + crossAxisZ * halfCrossSpan,
        viewProjection, width, height,
      );
      if (!crossStart || !crossEnd) continue;
      const screenCrossSpan = Math.hypot(crossEnd.x - crossStart.x, crossEnd.y - crossStart.y);
      // Keep a generous inset because the component bounds approximate an
      // irregular country with province-center discs rather than its outline.
      const availableWidth = screenSpan * 0.7;
      const availableHeight = screenCrossSpan * 0.5;
      const measuredWidth = this.measuredLabelWidths.get(country.id) ?? 1;
      const widthLimitedSize = MEASUREMENT_SIZE * availableWidth / Math.max(1, measuredWidth);
      const heightLimitedSize = availableHeight / 1.05;
      const fontSize = Math.min(widthLimitedSize, heightLimitedSize);
      if (!Number.isFinite(fontSize) || fontSize <= 0) continue;
      let angle = Math.atan2(right.y - left.y, right.x - left.x);
      while (angle > Math.PI * 0.5) angle -= Math.PI;
      while (angle < -Math.PI * 0.5) angle += Math.PI;
      element.hidden = false;
      visibleLabels += 1;
      element.style.fontSize = `${fontSize}px`;
      element.style.transform = `translate(${center.x.toFixed(1)}px, ${center.y.toFixed(1)}px) translate(-50%, -50%) rotate(${angle.toFixed(4)}rad)`;
    }
    return visibleLabels;
  }

  private measureTextWidth(label: string, fontSize: number): number {
    this.measurementContext.font = `${LABEL_FONT_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`;
    return this.measurementContext.measureText(label).width
      + Math.max(0, label.length - 1) * fontSize * LABEL_LETTER_SPACING;
  }

  private rebuildCountries(countryIds: Iterable<number>): void {
    for (const countryId of countryIds) this.rebuildCountry(countryId);
  }

  private rebuildCountry(countryId: number): void {
    if (!countryId) return;
    const provinces = this.provincesByCountry.get(countryId);
    if (!provinces?.size) {
      this.anchors.delete(countryId);
      const element = this.elements.get(countryId);
      if (element) element.hidden = true;
      return;
    }
    this.visitEpoch = (this.visitEpoch + 1) >>> 0;
    if (this.visitEpoch === 0) {
      this.visitMarks.fill(0);
      this.visitEpoch = 1;
    }
    let largestComponent: number[] = [];
    let largestArea = -Infinity;
    for (const start of provinces) {
      if (this.visitMarks[start] === this.visitEpoch) continue;
      const component: number[] = [];
      let area = 0;
      const stack = [start];
      this.visitMarks[start] = this.visitEpoch;
      while (stack.length) {
        const province = stack.pop() as number;
        component.push(province);
        area += this.labelData[province * 3 + 2];
        for (const neighbor of this.neighbors[province]) {
          if (this.visitMarks[neighbor] !== this.visitEpoch && this.owners[neighbor] === countryId) {
            this.visitMarks[neighbor] = this.visitEpoch;
            stack.push(neighbor);
          }
        }
      }
      if (area > largestArea) {
        largestArea = area;
        largestComponent = component;
      }
    }
    const anchor = this.createAnchor(countryId, largestComponent);
    if (anchor) this.anchors.set(countryId, anchor);
    else this.anchors.delete(countryId);
  }

  private createAnchor(countryId: number, component: number[]): CountryAnchor | null {
    if (!component.length) return null;
    const referenceX = this.labelData[component[0] * 3];
    let totalWeight = 0;
    let meanX = 0;
    let meanZ = 0;
    const points: Array<{ province: number; x: number; z: number; weight: number; radius: number }> = [];
    for (const province of component) {
      const offset = province * 3;
      let x = this.labelData[offset];
      const z = this.labelData[offset + 1];
      const weight = Math.max(1, this.labelData[offset + 2]);
      x = unwrapNear(x, referenceX, this.worldWidth);
      const radius = Math.sqrt(weight / Math.PI) * (this.worldWidth / 4_096) * 0.72;
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
      x: wrap(anchorPoint.x, this.worldWidth),
      z: anchorPoint.z,
      axisX,
      axisZ,
      span: centeredSpan,
      crossSpan: centeredCrossSpan,
    };
  }

  private projectBestCopy(
    x: number,
    y: number,
    z: number,
    matrix: ArrayLike<number>,
    width: number,
    height: number,
  ): { x: number; y: number; worldX: number; worldY: number } | null {
    let best: { x: number; y: number; worldX: number; worldY: number; score: number } | null = null;
    for (const offset of [-this.worldWidth, 0, this.worldWidth]) {
      const worldX = x + offset;
      const projected = projectPoint(worldX, y, z, matrix, width, height);
      if (!projected) continue;
      const outsideX = Math.max(0, -projected.x, projected.x - width);
      const outsideY = Math.max(0, -projected.y, projected.y - height);
      const score = outsideX * outsideX + outsideY * outsideY
        + Math.hypot(projected.x - width * 0.5, projected.y - height * 0.5) * 0.001;
      if (!best || score < best.score) best = { ...projected, worldX, worldY: y, score };
    }
    return best;
  }
}

function projectPoint(
  x: number,
  y: number,
  z: number,
  matrix: ArrayLike<number>,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (clipW <= 0.001) return null;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  if (ndcX < -1.35 || ndcX > 1.35 || ndcY < -1.35 || ndcY > 1.35) return null;
  return { x: (ndcX * 0.5 + 0.5) * width, y: (0.5 - ndcY * 0.5) * height };
}

function parseHexColor(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return [0.45, 0.52, 0.48];
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
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
