import type { CountryRecord } from '../types';

export interface CountryLabelAtlasEntry {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  widthAtMeasurementSize: number;
  heightAtMeasurementSize: number;
}

export const LABEL_MEASUREMENT_SIZE = 20;

const LABEL_FONT_FAMILY = '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif';
const LABEL_FONT_WEIGHT = 700;
const LABEL_LETTER_SPACING = 0.1;
const ATLAS_FONT_SIZE = 64;
const ATLAS_WIDTH = 2048;
const ATLAS_PADDING = 10;

export class CountryLabelAtlas {
  readonly canvas: HTMLCanvasElement;
  private readonly entries = new Map<number, CountryLabelAtlasEntry>();
  private readonly measuredWidths = new Map<number, number>();
  private readonly context: CanvasRenderingContext2D;

  constructor(countries: CountryRecord[]) {
    this.canvas = document.createElement('canvas');
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Country labels require a 2D canvas context');
    this.context = context;
    for (const country of countries) {
      this.measuredWidths.set(
        country.id,
        this.measureTextWidth(country.name.toLocaleUpperCase(), LABEL_MEASUREMENT_SIZE),
      );
    }
    this.build(countries);
  }

  getEntry(countryId: number): CountryLabelAtlasEntry | undefined {
    return this.entries.get(countryId);
  }

  getMeasuredWidth(countryId: number): number {
    return this.measuredWidths.get(countryId) ?? 1;
  }

  private measureTextWidth(label: string, fontSize: number): number {
    this.context.font = `${LABEL_FONT_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`;
    return this.context.measureText(label).width
      + Math.max(0, label.length - 1) * fontSize * LABEL_LETTER_SPACING;
  }

  private build(countries: CountryRecord[]): void {
    const placements: Array<{ country: CountryRecord; x: number; y: number; width: number; height: number }> = [];
    this.context.font = `${LABEL_FONT_WEIGHT} ${ATLAS_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
    (this.context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${ATLAS_FONT_SIZE * LABEL_LETTER_SPACING}px`;
    let x = ATLAS_PADDING;
    let y = ATLAS_PADDING;
    let rowHeight = 0;
    for (const country of countries) {
      const textWidth = Math.ceil(this.measureTextWidth(country.name.toLocaleUpperCase(), ATLAS_FONT_SIZE));
      const width = textWidth + ATLAS_PADDING * 2;
      const height = Math.ceil(ATLAS_FONT_SIZE * 1.45) + ATLAS_PADDING * 2;
      if (x + width + ATLAS_PADDING > ATLAS_WIDTH) {
        x = ATLAS_PADDING;
        y += rowHeight;
        rowHeight = 0;
      }
      placements.push({ country, x, y, width, height });
      x += width;
      rowHeight = Math.max(rowHeight, height);
    }
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = nextPowerOfTwo(Math.max(1, y + rowHeight + ATLAS_PADDING));
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Country label atlas context was lost');
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.miterLimit = 2;
    context.font = `${LABEL_FONT_WEIGHT} ${ATLAS_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${ATLAS_FONT_SIZE * LABEL_LETTER_SPACING}px`;
    context.lineWidth = ATLAS_FONT_SIZE * 0.09;
    context.fillStyle = 'rgba(249, 242, 211, 0.95)';
    context.strokeStyle = 'rgba(8, 15, 14, 0.9)';
    for (const placement of placements) {
      const centerX = placement.x + placement.width * 0.5;
      const centerY = placement.y + placement.height * 0.5;
      const text = placement.country.name.toLocaleUpperCase();
      context.strokeText(text, centerX, centerY);
      context.fillText(text, centerX, centerY);
      this.entries.set(placement.country.id, {
        u0: placement.x / this.canvas.width,
        v0: placement.y / this.canvas.height,
        u1: (placement.x + placement.width) / this.canvas.width,
        v1: (placement.y + placement.height) / this.canvas.height,
        widthAtMeasurementSize: placement.width * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE,
        heightAtMeasurementSize: placement.height * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE,
      });
    }
  }
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}
