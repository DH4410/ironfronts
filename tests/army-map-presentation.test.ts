import { describe, expect, it } from 'vitest';
import { buildArmyFormation, dominantVisualKind, visualKindForUnit } from '../src/army-map-presentation';

describe('army map presentation LOD data', () => {
  it('maps rule-level troop types onto four distinct map models', () => {
    expect(visualKindForUnit('infantry')).toBe(0);
    expect(visualKindForUnit('engineer')).toBe(0);
    expect(visualKindForUnit('light-tank')).toBe(1);
    expect(visualKindForUnit('medium-tank')).toBe(1);
    expect(visualKindForUnit('armored-car')).toBe(2);
    expect(visualKindForUnit('artillery')).toBe(3);
  });

  it('combines counts and health by visual kind and finds the dominant kind', () => {
    const formation = buildArmyFormation([
      { typeId: 'infantry', count: 3, health: 1 },
      { typeId: 'engineer', count: 1, health: 0.5 },
      { typeId: 'light-tank', count: 2, health: 0.75 },
      { typeId: 'medium-tank', count: 1, health: 0.5 },
      { typeId: 'armored-car', count: 5, health: 0.8 },
    ]);
    expect(formation).toEqual([
      { kind: 0, count: 4, health: 0.875 },
      { kind: 1, count: 3, health: 2 / 3 },
      { kind: 2, count: 5, health: 0.8 },
    ]);
    expect(dominantVisualKind(formation)).toBe(2);
  });
});
