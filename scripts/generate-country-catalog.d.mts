import type { CatalogCountry } from '../src/game/data/countries.generated';

/** Derive catalogue rows from parsed world.json + province-owners.u32. */
export function deriveCatalogCountries(
  worldJson: unknown,
  ownersU32: Uint32Array,
  provinceDetailsJson: unknown,
  surfaceRgba8: Uint8Array,
): CatalogCountry[];

/** Render the full `countries.generated.ts` module text from rows. */
export function renderCatalogModule(rows: readonly CatalogCountry[]): string;

/** Regenerate and write the module; returns the written text. */
export function generate(): Promise<string>;

export const FLAG_CODES: Readonly<Record<string, string>>;
