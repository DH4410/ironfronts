/**
 * `GameSession` — the authoritative owner of gameplay state (§1).
 *
 * The renderer and HUD read a projection of `session.state` and cache a
 * GPU / DOM representation; they never mutate it and are never the source of
 * truth. `main.ts` drives `tick(dtHours)` from a fixed-step accumulator at a
 * lower rate than the render frame (§46).
 *
 * Phase A implements the clock and the passive economy. Movement, extraction,
 * production, combat and capture are added by later phases as additional
 * `tick` systems; their hooks are marked below.
 */

import type { GameState } from './game-state';
import { cloneGameState, relationOf, serializeGameState, setRelation } from './game-state';
import type { LandGraph } from './movement/graph';
import type { ScenarioSelection } from './scenario';
import { scenarioById } from './scenario-catalog';
import { initGameState, type InitResult } from './scenario-init';
import type { WorldData } from './world-data';
import { applyIncome, recomputeIncome } from './economy';

/** Longest game-time step a single `tick` will integrate; larger dt is clamped
 *  so a stall can't teleport armies through provinces (§46). */
const MAX_TICK_HOURS = 1.5;
/** Income is recomputed on this game-hour cadence, not every tick (§48). */
const INCOME_RECOMPUTE_INTERVAL = 1;

export class GameSession {
  readonly state: GameState;
  readonly graph: LandGraph;
  readonly world: WorldData;
  readonly diagnostics: InitResult['diagnostics'];

  private incomeClock = 0;

  private constructor(init: InitResult, world: WorldData) {
    this.state = init.state;
    this.graph = init.graph;
    this.world = world;
    this.diagnostics = init.diagnostics;
    recomputeIncome(this.state, this.world);
  }

  static create(selection: ScenarioSelection, world: WorldData): GameSession {
    const scenario = scenarioById(selection.scenarioId);
    return new GameSession(initGameState(selection, scenario, world), world);
  }

  get playerCountryId(): number {
    return this.state.playerCountryId;
  }

  get gameTimeHours(): number {
    return this.state.clock.gameTimeHours;
  }

  /** Advance the simulation by `dtHours` of game time (§46). Safe to call with
   *  a large dt (e.g. after a stall) — it is clamped and sub-stepped. */
  tick(dtHours: number): void {
    if (!(dtHours > 0)) return;
    let remaining = dtHours;
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_TICK_HOURS);
      this.step(step);
      remaining -= step;
    }
  }

  private step(dtHours: number): void {
    this.state.clock.gameTimeHours += dtHours;

    // --- economy (§26) -------------------------------------------------
    if (this.state.economyEnabled) {
      this.incomeClock += dtHours;
      if (this.incomeClock >= INCOME_RECOMPUTE_INTERVAL) {
        recomputeIncome(this.state, this.world);
        this.incomeClock = 0;
      }
      applyIncome(this.state, dtHours);
    }

    // --- later phases ------------------------------------------------
    // Phase E: movement.step(this, dtHours)
    // Phase F: extraction.step(this, dtHours)
    // Phase G: production.step(this, dtHours)
    // Phase H: combat.step(this, dtHours); capture.step(this)
    // Phase B: visibility recompute (event-driven / throttled)
  }

  /** §34: only the player's own entities accept commands. */
  ownsArmy(armyId: string): boolean {
    return this.state.armies[armyId]?.ownerCountryId === this.state.playerCountryId;
  }

  ownsProvince(provinceId: number): boolean {
    return this.state.provinceOwners[provinceId] === this.state.playerCountryId;
  }

  /**
   * Player-facing summary of a province, fog-aware (§5, §27). Deposit detail is
   * withheld for provinces the player does not own while fog of war is active.
   */
  describeProvince(provinceId: number): {
    ownerId: number;
    ownerName: string;
    ownerColor: string;
    isOwn: boolean;
    resources: { stone: number; metal: number; oil: number } | null;
    controlled: boolean;
    extracting: boolean;
  } {
    const ownerId = this.state.provinceOwners[provinceId] ?? 0;
    const owner = this.state.countries[ownerId];
    const isOwn = ownerId === this.state.playerCountryId;
    const detailVisible = isOwn || !this.state.fogOfWar;

    let resources: { stone: number; metal: number; oil: number } | null = null;
    let controlled = false;
    let extracting = false;
    if (detailVisible) {
      const totals = { stone: 0, metal: 0, oil: 0 };
      let any = false;
      for (const node of Object.values(this.state.resourceNodes)) {
        if (node.provinceId !== provinceId) continue;
        any = true;
        totals[node.kind] += node.remaining;
        if (node.controllerCountryId === ownerId) controlled = true;
        if (node.status === 'extracting') extracting = true;
      }
      resources = any ? totals : null;
    }

    return {
      ownerId,
      ownerName: owner?.name ?? `Country ${ownerId}`,
      ownerColor: owner?.color ?? '#888888',
      isOwn,
      resources,
      controlled,
      extracting,
    };
  }

  isAtWar(a: number, b: number): boolean {
    return relationOf(this.state, a, b) === 'war';
  }

  /** §40: entering / capturing foreign land forces war if not already. */
  declareWar(a: number, b: number): void {
    setRelation(this.state, a, b, 'war');
  }

  serialize(): string {
    return serializeGameState(this.state);
  }

  /** Deep structural clone of the current state (proves §47 serializability). */
  snapshot(): GameState {
    return cloneGameState(this.state);
  }
}
