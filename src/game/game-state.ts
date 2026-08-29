/**
 * Authoritative game state (§1, §47).
 *
 * This is PLAIN DATA: no class instances, no DOM nodes, no GPU handles, no
 * functions. Everything here round-trips through JSON. `GameSession` owns a
 * single `GameState` and is the only writer; the renderer and HUD read a
 * projection of it and cache a GPU/DOM representation — they never own it.
 *
 * Keys that map ids -> records use `Record<number, T>` (JSON object) rather
 * than `Map` so `JSON.stringify` works directly.
 */

import type { ArmyStack } from './units/army';

export const GAME_STATE_VERSION = 1;

export type ResourceKey = 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil';

export const RESOURCE_KEYS: readonly ResourceKey[] = [
  'funds', 'manpower', 'food', 'stone', 'metal', 'oil',
];

export type Stockpile = Record<ResourceKey, number>;

export interface CountryState {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  stockpile: Stockpile;
  /** Passive per-game-hour income, recomputed by the economy system (§26). */
  income: Stockpile;
  /** Abstract build-throughput stat, not a stockpile (§25). */
  industryCapacity: number;
  /** True once the country is the human player's (§34). */
  readonly isPlayer: boolean;
}

export interface ProvinceBuildings {
  barracks: number;
  tankPlant: number;
  ordnance: number;
}

export interface ProductionOrder {
  readonly id: string;
  readonly unitTypeId: string;
  /** Game-hours of work already applied. */
  progressHours: number;
  /** Total game-hours required (from the unit type, at this building level). */
  readonly totalHours: number;
}

export type ResourceNodeStatus = 'idle' | 'secured' | 'extracting' | 'exhausted';

export interface ResourceNodeState {
  readonly id: number;
  readonly kind: 'stone' | 'metal' | 'oil';
  readonly x: number;
  readonly z: number;
  remaining: number;
  readonly initialAmount: number;
  /** Country that currently controls the node (province owner by default, §22). */
  controllerCountryId: number;
  /** Nearest reachable land movement-graph node (§20); -1 when unreachable. */
  readonly accessNodeId: number;
  /** Army currently extracting here, or null (§23). */
  extractorArmyId: string | null;
  status: ResourceNodeStatus;
}

export type Relation = 'peace' | 'war';

export interface GameClock {
  /** Monotonic game-time in hours since scenario start. Drives every system. */
  gameTimeHours: number;
  readonly startDate: string;
}

export interface GameState {
  readonly version: number;
  readonly seed: number;
  readonly scenarioId: string;
  readonly mode: 'campaign' | 'sandbox';
  readonly playerCountryId: number;
  readonly fogOfWar: boolean;
  readonly economyEnabled: boolean;

  clock: GameClock;

  /** Every country with territory, keyed by id. */
  countries: Record<number, CountryState>;
  /** Dense: province id -> owning country id (§39 authority). */
  provinceOwners: Record<number, number>;
  /** Sparse: only provinces that have at least one building. */
  provinceBuildings: Record<number, ProvinceBuildings>;
  /** Sparse: province id -> ordered production queue (§32). */
  productionQueues: Record<number, ProductionOrder[]>;

  armies: Record<string, ArmyStack>;
  resourceNodes: Record<number, ResourceNodeState>;

  /** Directed-pair relation key "a:b" with a < b -> 'war' (absent = peace) (§40). */
  relations: Record<string, Relation>;

  nextArmyId: number;
  nextOrderId: number;
  nextEventId: number;
}

export function emptyStockpile(): Stockpile {
  return { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 };
}

export function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function relationOf(state: GameState, a: number, b: number): Relation {
  if (a === b) return 'peace';
  return state.relations[relationKey(a, b)] ?? 'peace';
}

export function setRelation(state: GameState, a: number, b: number, relation: Relation): void {
  if (a === b) return;
  const key = relationKey(a, b);
  if (relation === 'peace') delete state.relations[key];
  else state.relations[key] = relation;
}

/**
 * Serialize to a plain JSON string. Because `GameState` is already plain data
 * this is a thin wrapper, but keeping it explicit documents the §47 contract
 * and gives one place to add a schema/version migration later.
 */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGameState(json: string): GameState {
  const parsed = JSON.parse(json) as GameState;
  if (parsed.version !== GAME_STATE_VERSION) {
    throw new Error(
      `Unsupported game-state version ${parsed.version}; expected ${GAME_STATE_VERSION}.`,
    );
  }
  return parsed;
}

/** Structural deep clone via the JSON round-trip — proves serializability too. */
export function cloneGameState(state: GameState): GameState {
  return deserializeGameState(serializeGameState(state));
}
