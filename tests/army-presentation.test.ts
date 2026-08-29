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
      infantry: { attack: 8, defense: 6 },
      artillery: { attack: 26, defense: 3 },
    };
    const groups = [
      { typeId: 'infantry', count: 4 },
      { typeId: 'artillery', count: 2 },
    ];
    expect(aggregateTroopStat(groups, 'attack', (id) => catalog[id])).toBe(84);
    expect(aggregateTroopStat(groups, 'defense', (id) => catalog[id])).toBe(30);
    expect(aggregateTroopStat(undefined, 'attack', (id) => catalog[id])).toBeUndefined();
  });
});
