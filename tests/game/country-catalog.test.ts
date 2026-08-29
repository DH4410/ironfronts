import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deriveCatalogCountries, renderCatalogModule,
} from '../../scripts/generate-country-catalog.mjs';
import { CATALOG_COUNTRIES } from '../../src/game/data/countries.generated';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Guardrail 1: the committed catalogue must be a faithful, reproducible cache
 * of the authoritative world output. If the world seed / political data
 * changes, this fails and the fix is `node scripts/generate-country-catalog.mjs`
 * — never a hand edit.
 */
describe('country catalogue drift', () => {
  it('matches a fresh derivation from public/world output', async () => {
    const worldJson = JSON.parse(
      await readFile(path.join(ROOT, 'public/world/world.json'), 'utf8'),
    );
    const owners = new Uint32Array(
      (await readFile(path.join(ROOT, 'public/world/province-owners.u32'))).buffer,
    );
    const fresh = deriveCatalogCountries(worldJson, owners);

    expect(fresh).toEqual([...CATALOG_COUNTRIES]);
  });

  it('re-renders byte-identical to the committed module', async () => {
    const worldJson = JSON.parse(
      await readFile(path.join(ROOT, 'public/world/world.json'), 'utf8'),
    );
    const owners = new Uint32Array(
      (await readFile(path.join(ROOT, 'public/world/province-owners.u32'))).buffer,
    );
    const rendered = renderCatalogModule(deriveCatalogCountries(worldJson, owners));
    const committed = await readFile(
      path.join(ROOT, 'src/game/data/countries.generated.ts'), 'utf8',
    );
    expect(rendered).toBe(committed);
  });

  it('every catalogue country has territory and a plausible record', () => {
    for (const country of CATALOG_COUNTRIES) {
      expect(country.provinceCount).toBeGreaterThan(0);
      expect(country.name.length).toBeGreaterThan(0);
      expect(country.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
