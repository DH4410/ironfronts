type LocatedCombatEvent = {
  readonly x: number;
  readonly z: number;
  readonly attacker: number;
  readonly defender: number;
};

export type CombatEvent =
  | LocatedCombatEvent & { readonly kind: 'engaged' | 'combatPulse' | 'retreat' | 'battleEnded'; readonly battleId: string; readonly frontId: string }
  | LocatedCombatEvent & { readonly kind: 'reinforced'; readonly battleId: string; readonly frontId: string; readonly armyId: string }
  | LocatedCombatEvent & { readonly kind: 'destroyed'; readonly armyId: string; readonly battleId?: string; readonly frontId?: string }
  | LocatedCombatEvent & { readonly kind: 'bombardment'; readonly armyId: string; readonly targetArmyId: string }
  | LocatedCombatEvent & { readonly kind: 'strike'; readonly provinceId: number };

