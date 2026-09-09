import type { CountryRecord, DiplomaticRelation } from './types';

// Neutral land sits well above the ~0.34 luminance of hostile red so "nobody
// you're fighting" reads as inert pale stone, never as a dim enemy province.
const NEUTRAL_GREY_MIN = 0.55;
const NEUTRAL_GREY_RANGE = 0.08;

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
    // Four maximally separable hues: your land = bright gold, enemies = deep
    // saturated crimson, allies = clear royal blue, neutrals = pale stone.
    if (isPlayer) color = [0.92, 0.73, 0.20];
    else if (relation === 'war') color = [0.78, 0.13, 0.11];
    else if (relation === 'allied') color = [0.20, 0.50, 0.82];
    else {
      const variation = ((country.id * 47) % 101) / 100;
      const grey = NEUTRAL_GREY_MIN + variation * NEUTRAL_GREY_RANGE;
      color = [grey * 0.985, grey, grey * 0.995];
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
