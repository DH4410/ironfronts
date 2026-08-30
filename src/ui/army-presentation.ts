export interface ArmyGroupStatSource {
  readonly typeId: string;
  readonly count: number;
}

export function aggregateTroopStat(
  groups: readonly ArmyGroupStatSource[] | undefined,
  field: 'attack' | 'defense',
  unit: (typeId: string) => Record<string, unknown>,
): { soft: number; light: number; heavy: number } | undefined {
  if (!groups) return undefined;
  return groups.reduce((total, group) => {
    const profile = unit(group.typeId)[field] as Partial<Record<'soft' | 'light' | 'heavy', number>> | undefined;
    total.soft += Number(profile?.soft ?? 0) * group.count;
    total.light += Number(profile?.light ?? 0) * group.count;
    total.heavy += Number(profile?.heavy ?? 0) * group.count;
    return total;
  }, { soft: 0, light: 0, heavy: 0 });
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
