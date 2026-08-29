export interface ArmyGroupStatSource {
  readonly typeId: string;
  readonly count: number;
}

export function aggregateTroopStat(
  groups: readonly ArmyGroupStatSource[] | undefined,
  field: 'attack' | 'defense',
  unit: (typeId: string) => Record<string, unknown>,
): number | undefined {
  if (!groups) return undefined;
  return groups.reduce((total, group) => total + Number(unit(group.typeId)[field] ?? 0) * group.count, 0);
}

export function armyActivityLabel(status: string, awaitingMoveTarget: boolean, own: boolean): string {
  if (awaitingMoveTarget && own) return 'Awaiting destination';
  if (status === 'moving') return 'Moving to destination';
  if (status === 'engaged') return 'Engaged in combat';
  if (status === 'retreating') return 'Withdrawing';
  if (status === 'extracting') return 'Extracting resources';
  if (status === 'idle') return 'Holding position';
  return status.replace(/(^|[-_ ])\w/g, (letter) => letter.toUpperCase());
}
