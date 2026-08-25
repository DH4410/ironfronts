import type { CountryRecord } from './types';
import { CountryLabelAtlas, LABEL_MEASUREMENT_SIZE } from './country-labels/atlas';
import { projectBestWorldCopy, projectPoint } from './country-labels/projection';
import { createCountryAnchor, type CountryAnchor } from './country-labels/topology';

export { buildCountryColorBuffer } from './country-labels/colors';

interface RenderedCountryLabel {
  country: CountryRecord;
  x: number;
  y: number;
  worldX: number;
  angle: number;
  fontSize: number;
}

export interface CountryOwnershipChange {
  provinceId: number;
  previousCountryId: number;
  countryId: number;
}

const LABEL_INSTANCE_STRIDE = 12;
const MAX_LABEL_CSS_FONT_SIZE = 96;

export class CountryLabelLayer {
  private readonly countryById = new Map<number, CountryRecord>();
  private readonly atlas: CountryLabelAtlas;
  readonly atlasCanvas: HTMLCanvasElement;
  private readonly neighbors: number[][];
  private readonly provincesByCountry = new Map<number, Set<number>>();
  private readonly anchors = new Map<number, CountryAnchor>();
  private readonly visitMarks: Uint32Array;
  private visitEpoch = 0;
  private visible = true;
  private dirty = true;
  private lastCameraRevision = -1;
  private lastWidth = 0;
  private lastHeight = 0;
  private visibleCount = 0;
  private instanceData = new Float32Array(0);
  private instanceRevision = 0;

  constructor(
    canvas: HTMLCanvasElement,
    countries: CountryRecord[],
    private readonly owners: Uint32Array,
    adjacencyPairs: Uint32Array,
    private readonly labelData: Float32Array,
    private readonly worldWidth: number,
  ) {
    // This element used to be a full-screen transparent 2D canvas. Even when
    // its contents were cached, Chromium had to composite it over WebGPU on
    // every frame. Keep it hidden and use a detached canvas only once to build
    // the texture atlas consumed by the WebGPU label pipeline.
    canvas.hidden = true;
    this.atlas = new CountryLabelAtlas(countries);
    this.atlasCanvas = this.atlas.canvas;
    this.visitMarks = new Uint32Array(owners.length);
    this.neighbors = Array.from({ length: owners.length }, () => [] as number[]);
    for (let index = 0; index + 1 < adjacencyPairs.length; index += 2) {
      const a = adjacencyPairs[index];
      const b = adjacencyPairs[index + 1];
      if (a >= owners.length || b >= owners.length) continue;
      this.neighbors[a].push(b);
      this.neighbors[b].push(a);
    }
    for (const country of countries) {
      this.countryById.set(country.id, country);
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
    this.rebuildCountries(this.countryById.keys());
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.dirty = true;
    if (!visible) {
      this.visibleCount = 0;
      this.instanceData = new Float32Array(0);
      this.instanceRevision += 1;
    }
  }

  get renderData(): Float32Array { return this.instanceData; }

  get renderRevision(): number { return this.instanceRevision; }

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
    if (affectedCountries.size) this.dirty = true;
  }

  update(
    viewProjection: ArrayLike<number>,
    width: number,
    height: number,
    sampleHeight: (x: number, z: number) => number,
    cameraRevision = -1,
  ): number {
    if (!this.visible || width <= 1 || height <= 1) return 0;
    if (!this.dirty
      && cameraRevision === this.lastCameraRevision
      && width === this.lastWidth
      && height === this.lastHeight) return this.visibleCount;

    const renderedLabels: RenderedCountryLabel[] = [];

    for (const anchor of this.anchors.values()) {
      const country = this.countryById.get(anchor.countryId);
      if (!country) continue;
      const center = projectBestWorldCopy(
        anchor.x,
        sampleHeight(anchor.x, anchor.z) + 7,
        anchor.z,
        this.worldWidth,
        viewProjection,
        width,
        height,
      );
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
      const measuredWidth = this.atlas.getMeasuredWidth(country.id);
      const widthLimitedSize = LABEL_MEASUREMENT_SIZE * availableWidth / Math.max(1, measuredWidth);
      const heightLimitedSize = availableHeight / 1.05;
      const maximumFontSize = MAX_LABEL_CSS_FONT_SIZE * Math.min(window.devicePixelRatio || 1, 2);
      const fontSize = Math.min(widthLimitedSize, heightLimitedSize, maximumFontSize);
      if (!Number.isFinite(fontSize) || fontSize <= 0) continue;
      let angle = Math.atan2(right.y - left.y, right.x - left.x);
      while (angle > Math.PI * 0.5) angle -= Math.PI;
      while (angle < -Math.PI * 0.5) angle += Math.PI;
      renderedLabels.push({ country, x: center.x, y: center.y, worldX: center.worldX, angle, fontSize });
    }
    this.buildInstances(renderedLabels);
    this.lastCameraRevision = cameraRevision;
    this.lastWidth = width;
    this.lastHeight = height;
    this.visibleCount = renderedLabels.length;
    this.dirty = false;
    return this.visibleCount;
  }

  private buildInstances(labels: RenderedCountryLabel[]): void {
    const data = new Float32Array(labels.length * LABEL_INSTANCE_STRIDE);
    let cursor = 0;
    for (const label of labels) {
      const atlas = this.atlas.getEntry(label.country.id);
      if (!atlas) continue;
      const scale = label.fontSize / LABEL_MEASUREMENT_SIZE;
      data.set([
        label.x, label.y,
        atlas.widthAtMeasurementSize * scale,
        atlas.heightAtMeasurementSize * scale,
        Math.cos(label.angle), Math.sin(label.angle), atlas.u0, atlas.v0,
        atlas.u1, atlas.v1, label.worldX, 0,
      ], cursor);
      cursor += LABEL_INSTANCE_STRIDE;
    }
    this.instanceData = cursor === data.length ? data : data.slice(0, cursor);
    this.instanceRevision += 1;
  }

  private rebuildCountries(countryIds: Iterable<number>): void {
    for (const countryId of countryIds) this.rebuildCountry(countryId);
  }

  private rebuildCountry(countryId: number): void {
    if (!countryId) return;
    const provinces = this.provincesByCountry.get(countryId);
    if (!provinces?.size) {
      this.anchors.delete(countryId);
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
    const anchor = createCountryAnchor(countryId, largestComponent, this.labelData, this.worldWidth);
    if (anchor) this.anchors.set(countryId, anchor);
    else this.anchors.delete(countryId);
  }
}
