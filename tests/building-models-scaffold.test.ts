import { describe, expect, it } from 'vitest';
import {
  BUILDING_MODEL_MANIFEST, hasBuildingModels, resolveBuildingModelUrl,
} from '../src/graphics/building-models';

// Pins the scaffold contract for the deferred 3D-buildings pass: until the
// art drop lands, the manifest is empty and every id falls back to the
// procedural prop box. The follow-up pass replaces the manifest, not the API.
describe('building-models scaffold', () => {
  it('ships empty and reports no models available', () => {
    expect(Object.keys(BUILDING_MODEL_MANIFEST)).toHaveLength(0);
    expect(hasBuildingModels()).toBe(false);
  });

  it('resolves an unknown id to null so the renderer keeps the procedural box', () => {
    expect(resolveBuildingModelUrl('barracks')).toBeNull();
    expect(resolveBuildingModelUrl('tank-plant')).toBeNull();
  });
});
