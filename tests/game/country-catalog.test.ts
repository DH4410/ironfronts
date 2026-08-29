import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deriveCatalogCountries, renderCatalogModule,
} from '../../scripts/generate-country-catalog.mjs';
import { CATALOG_COUNTRIES } from '../../src/game/data/countries.generated';

const ROOT = path.resolve(__dirname, '../..');

async function loadCatalogInputs() {
  const [worldText, ownerBuffer, provinceDetailsText, surface] = await Promise.all([
    readFile(path.join(ROOT, 'public/world/world.json'), 'utf8'),
    readFile(path.join(ROOT, 'public/world/province-owners.u32')),
    readFile(path.join(ROOT, 'public/world/province-details.json'), 'utf8'),
    readFile(path.join(ROOT, 'public/world/surface.rgba8')),
  ]);
  const owners = new Uint32Array(
    ownerBuffer.buffer, ownerBuffer.byteOffset,
    ownerBuffer.byteLength / Uint32Array.BYTES_PER_ELEMENT,
  );
  return {
    world: JSON.parse(worldText),
    owners,
    provinceDetails: JSON.parse(provinceDetailsText),
    surface,
  };
}

/**
 * Guardrail 1: the committed catalogue must be a faithful, reproducible cache
 * of the authoritative world output. If the world seed, political data, or
 * game-start city layout changes, this fails. The fix is
 * `node scripts/generate-country-catalog.mjs`
 * — never a hand edit.
 */
describe('country catalogue drift', () => {
  it('matches a fresh derivation from public/world output', async () => {
    const input = await loadCatalogInputs();
    const fresh = deriveCatalogCountries(
      input.world, input.owners, input.provinceDetails, input.surface,
    );

    expect(fresh).toEqual([...CATALOG_COUNTRIES]);
  });

  it('re-renders byte-identical to the committed module', async () => {
    const input = await loadCatalogInputs();
    const rendered = renderCatalogModule(deriveCatalogCountries(
      input.world, input.owners, input.provinceDetails, input.surface,
    ));
    const committed = await readFile(
      path.join(ROOT, 'src/game/data/countries.generated.ts'), 'utf8',
    );
    expect(rendered).toBe(committed);
  });

  it('every catalogue country has territory and a plausible record', () => {
    for (const country of CATALOG_COUNTRIES) {
      expect(country.provinceCount).toBeGreaterThan(0);
      expect(country.cityCount).toBeGreaterThanOrEqual(0);
      expect(country.cityCount).toBeLessThanOrEqual(country.provinceCount);
      expect(country.name.length).toBeGreaterThan(0);
      expect(country.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
