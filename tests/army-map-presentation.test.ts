import { describe, expect, it } from 'vitest';
import {
  buildArmyCompositionRows, buildArmyFormation, dominantVisualKind, visualKindForUnit,
} from '../src/army-map-presentation';

describe('army map presentation LOD data', () => {
  it('maps rule-level troop types onto four distinct map models', () => {
    expect(visualKindForUnit('infantry')).toBe(0);
    expect(visualKindForUnit('engineer')).toBe(0);
    expect(visualKindForUnit('light-tank')).toBe(1);
    expect(visualKindForUnit('armored-car')).toBe(1);
    expect(visualKindForUnit('medium-tank')).toBe(2);
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
      { kind: 1, count: 7, health: 5.5 / 7 },
      { kind: 1, count: 7, health: 5.5 / 7 },
      { kind: 2, count: 1, health: 0.5 },
    ]);
    expect(dominantVisualKind(formation)).toBe(1);
  });

  it('uses at most four slots, guarantees each present category, and respects tiny armies', () => {
    expect(buildArmyFormation([
      { typeId: 'infantry', count: 1, health: 1 },
      { typeId: 'artillery', count: 1, health: 1 },
    ])).toHaveLength(2);
    const mixed = buildArmyFormation([
      { typeId: 'infantry', count: 7, health: 1 },
      { typeId: 'armored-car', count: 2, health: 1 },
      { typeId: 'medium-tank', count: 1, health: 1 },
      { typeId: 'artillery', count: 1, health: 1 },
    ]);
    expect(mixed).toHaveLength(4);
    expect(new Set(mixed.map((slot) => slot.kind))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('builds one close-marker row per visual kind with its combined amount', () => {
    expect(buildArmyCompositionRows([
      { typeId: 'infantry', count: 3, health: 1 },
      { typeId: 'engineer', count: 2, health: 0.5 },
      { typeId: 'armored-car', count: 4, health: 0.75 },
      { typeId: 'light-tank', count: 1, health: 1 },
      { typeId: 'medium-tank', count: 2, health: 0.25 },
      { typeId: 'artillery', count: 6, health: 0.5 },
    ])).toEqual([
      { kind: 0, count: 5, health: 0.8 },
      { kind: 1, count: 5, health: 0.8 },
      { kind: 2, count: 2, health: 0.25 },
      { kind: 3, count: 6, health: 0.5 },
    ]);
  });
});
