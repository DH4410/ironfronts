/**
 * Authoritative army-stack data model (§11).
 *
 * Plain data (part of `GameState`). Units are tracked as GROUPS
 * (typeId + count + pooled hp), never as individual soldiers (§11). One stack
 * renders as one map marker (§12); the strongest group drives its portrait
 * (§10).
 */

import type { UnitType } from './unit-types';
import { unitType } from './unit-catalog';

export type ArmyStatus =
  | 'idle'
  | 'moving'
  | 'extracting'
  | 'engaged'
  | 'retreating';

export interface UnitGroup {
  readonly typeId: string;
  count: number;
  /** Pooled hit points for the whole group (0 .. count * maxHp). */
  hp: number;
  /** Reserved for later; 0 for now (§11 experience?). */
  experience: number;
}

export interface MoveOrder {
  /** Ordered land movement-graph node ids still to traverse (current target first). */
  readonly path: number[];
  /** World-space destination (the last node's position), for marker/HUD. */
  readonly destX: number;
  readonly destZ: number;
  /** 'move' = cream route, 'attack' = red route (§18). */
  readonly intent: 'move' | 'attack';
  /** Progress along the edge to `path[0]`, world units. */
  edgeProgress: number;
}

export interface ArmyStack {
  readonly id: string;
  ownerCountryId: number;
  name: string;
  /** World-space position (world units, X wraps). */
  x: number;
  z: number;
  /** Land movement-graph node the stack is currently at / leaving. */
  graphNodeId: number;
  units: UnitGroup[];
  status: ArmyStatus;
  order: MoveOrder | null;
  /** Resource node id this stack is extracting, or null (§23). */
  extractingNodeId: number | null;
}

export function groupMaxHp(group: UnitGroup): number {
  return group.count * unitType(group.typeId).maxHp;
}

export function stackUnitCount(stack: ArmyStack): number {
  let total = 0;
  for (const group of stack.units) total += group.count;
  return total;
}

export function stackHp(stack: ArmyStack): number {
  let total = 0;
  for (const group of stack.units) total += group.hp;
  return total;
}

export function stackMaxHp(stack: ArmyStack): number {
  let total = 0;
  for (const group of stack.units) total += groupMaxHp(group);
  return total;
}

/** 0..1 overall condition. */
export function stackHealthFraction(stack: ArmyStack): number {
  const max = stackMaxHp(stack);
  return max > 0 ? stackHp(stack) / max : 0;
}

/**
 * The representative unit for the map marker (§10): highest `stackPriority`,
 * ties broken by larger group count then unit id for determinism.
 */
export function strongestGroup(stack: ArmyStack): UnitGroup | null {
  let best: UnitGroup | null = null;
  let bestType: UnitType | null = null;
  for (const group of stack.units) {
    if (group.count <= 0) continue;
    const type = unitType(group.typeId);
    if (
      !best || !bestType ||
      type.stackPriority > bestType.stackPriority ||
      (type.stackPriority === bestType.stackPriority && group.count > best.count) ||
      (type.stackPriority === bestType.stackPriority && group.count === best.count &&
        type.id < bestType.id)
    ) {
      best = group;
      bestType = type;
    }
  }
  return best;
}

/** Stack speed is set by its slowest unit (§16). Empty stack -> 0. */
export function stackBaseSpeed(stack: ArmyStack): number {
  let slowest = Infinity;
  for (const group of stack.units) {
    if (group.count <= 0) continue;
    slowest = Math.min(slowest, unitType(group.typeId).speed);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/** Total per-game-hour extraction capacity of the stack (§23, §24). */
export function stackExtractionRate(stack: ArmyStack): number {
  let rate = 0;
  for (const group of stack.units) {
    rate += group.count * unitType(group.typeId).extractionRate;
  }
  return rate;
}

export function canExtract(stack: ArmyStack): boolean {
  return stackExtractionRate(stack) > 0;
}

/**
 * Merge `source` groups into `target` in place (§12). Same typeId groups pool
 * their count and hp; new types are appended. `source.units` is emptied.
 */
export function mergeStacks(target: ArmyStack, source: ArmyStack): void {
  for (const incoming of source.units) {
    if (incoming.count <= 0) continue;
    const existing = target.units.find((group) => group.typeId === incoming.typeId);
    if (existing) {
      existing.count += incoming.count;
      existing.hp += incoming.hp;
      existing.experience = Math.max(existing.experience, incoming.experience);
    } else {
      target.units.push({ ...incoming });
    }
  }
  source.units = [];
}

export function makeGroup(typeId: string, count: number, hpFraction = 1): UnitGroup {
  return {
    typeId,
    count,
    hp: count * unitType(typeId).maxHp * hpFraction,
    experience: 0,
  };
}
