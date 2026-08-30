import { describe, expect, it } from 'vitest';
import { aggregateTroopStat, armyActivityLabel } from '../src/ui/army-presentation';

describe('selected army presentation', () => {
  it('describes authoritative activities in player-facing language', () => {
    expect(armyActivityLabel('idle', false, true)).toBe('Holding position');
    expect(armyActivityLabel('moving', false, true)).toBe('Moving to destination');
    expect(armyActivityLabel('extracting', false, true)).toBe('Extracting resources');
    expect(armyActivityLabel('engaged', false, true)).toBe('Engaged in combat');
    expect(armyActivityLabel('idle', true, true)).toBe('Awaiting destination');
    expect(armyActivityLabel('idle', true, false)).toBe('Holding position');
  });

  it('aggregates troop attack and defence from the public presentation catalog', () => {
    const catalog: Record<string, Record<string, unknown>> = {
      infantry: {
        attack: { soft: 8, light: 4.4, heavy: 2.4 },
        defense: { soft: 6, light: 3.3, heavy: 1.8 },
      },
      artillery: {
        attack: { soft: 29.9, light: 23.4, heavy: 32.5 },
        defense: { soft: 3, light: 2.7, heavy: 3.75 },
      },
    };
    const groups = [
      { typeId: 'infantry', count: 4 },
      { typeId: 'artillery', count: 2 },
    ];
    expect(aggregateTroopStat(groups, 'attack', (id) => catalog[id])).toEqual({
      soft: 91.8, light: 64.4, heavy: 74.6,
    });
    expect(aggregateTroopStat(groups, 'defense', (id) => catalog[id])).toEqual({
      soft: 30, light: 18.6, heavy: 14.7,
    });
    expect(aggregateTroopStat(undefined, 'attack', (id) => catalog[id])).toBeUndefined();
  });
});
