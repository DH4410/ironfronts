import type { CountryRecord, DiplomaticRelation } from './types';

const NEUTRAL_GREY_MIN = 0.38;
const NEUTRAL_GREY_RANGE = 0.09;

export function findCountryByName(countries: readonly CountryRecord[], input: string): CountryRecord | undefined {
  const normalized = input.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return countries.find((country) => country.name.toLocaleLowerCase() === normalized);
}

export function buildDiplomacyColorData(
  countries: readonly CountryRecord[],
  relations: ReadonlyMap<number, DiplomaticRelation>,
  playerCountryId: number,
): Uint8Array {
  const maximumId = countries.reduce((maximum, country) => Math.max(maximum, country.id), 0);
  const data = new Uint8Array((maximumId + 1) * 4);
  for (const country of countries) {
    const offset = country.id * 4;
    const relation = relations.get(country.id) ?? 'neutral';
    let color: readonly [number, number, number];
    const isPlayer = country.id === playerCountryId;
    if (isPlayer) color = [0.86, 0.70, 0.28];
    else if (relation === 'war') color = [0.66, 0.24, 0.21];
    else if (relation === 'allied') color = [0.24, 0.43, 0.65];
    else {
      const variation = ((country.id * 47) % 101) / 100;
      const grey = NEUTRAL_GREY_MIN + variation * NEUTRAL_GREY_RANGE;
      color = [grey * 0.97, grey, grey * 0.99];
    }
    data[offset] = Math.round(color[0] * 255);
    data[offset + 1] = Math.round(color[1] * 255);
    data[offset + 2] = Math.round(color[2] * 255);
    // Alpha encodes the overlay role: 0 neutral, 128 player, 255 relationship.
    // This keeps all lookups in one tiny texture while preserving grey neutrals.
    data[offset + 3] = isPlayer ? 128 : relation === 'neutral' ? 0 : 255;
  }
  return data;
}
