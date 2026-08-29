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
import { stepMovement } from './units/movement';
import { stepExtraction } from './extraction';
import { producibleUnits, stepProduction, type UnitCompletion } from './production';
import { buildableBuildings, stepConstruction, type BuildingCompletion } from './construction';
import { stepCombat, stepCapture, type CaptureEvent } from './combat';
import { stepAi } from './ai/simple-ai';
import { applyCommand as runCommand, type CommandResult, type GameCommand } from './commands';
import { guaranteeStrategicBaseline } from './resource-bootstrap';
import { visibleResourceNodes } from './player-view';
import { wrappedDistance } from './geometry';

/** Longest game-time step a single `tick` will integrate; larger dt is clamped
 *  so a stall can't teleport armies through provinces (§46). */
const MAX_TICK_HOURS = 1.5;
/** Income is recomputed on this game-hour cadence, not every tick (§48). */
const INCOME_RECOMPUTE_INTERVAL = 1;
/** AI re-plans on this game-hour cadence (§56 — cheap, not per tick). */
const AI_INTERVAL = 2;

export class GameSession {
  readonly state: GameState;
  readonly graph: LandGraph;
  readonly world: WorldData;
  readonly diagnostics: InitResult['diagnostics'];

  private incomeClock = 0;
  private aiClock = 0;

  /** Drained by `main.ts` each frame for HUD notifications. */
  readonly pendingCompletions: UnitCompletion[] = [];
  readonly pendingBuildings: BuildingCompletion[] = [];
  readonly pendingCaptures: CaptureEvent[] = [];

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

    // --- gameplay systems, fixed order ------------------------------
    stepMovement(this, dtHours);            // §14
    stepExtraction(this, dtHours);          // §23
    for (const b of stepConstruction(this, dtHours)) this.pendingBuildings.push(b);
    for (const done of stepProduction(this, dtHours)) this.pendingCompletions.push(done); // §28
    stepCombat(this, dtHours);              // §38
    for (const cap of stepCapture(this)) this.pendingCaptures.push(cap); // §39

    // --- simple defensive AI (slow cadence) -----------------------
    this.aiClock += dtHours;
    if (this.aiClock >= AI_INTERVAL) {
      stepAi(this, this.aiClock);
      this.aiClock = 0;
    }
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
    const fullDetail = isOwn || !this.state.fogOfWar;

    // Deposits shown here must match what the map overlay shows: own/sandbox
    // reveal everything in the province; otherwise only deposits the player can
    // actually see (inside friendly vision) count — so the tooltip never
    // contradicts a deposit chip the player is looking at (§ fog).
    const visibleIds = fullDetail
      ? null
      : new Set(visibleResourceNodes(this.state, this.world).map((n) => n.id));

    let resources: { stone: number; metal: number; oil: number } | null = null;
    let controlled = false;
    let extracting = false;
    {
      const totals = { stone: 0, metal: 0, oil: 0 };
      let any = false;
      for (const node of Object.values(this.state.resourceNodes)) {
        if (node.provinceId !== provinceId) continue;
        if (visibleIds && !visibleIds.has(node.id)) continue;
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

  // ---- command boundary (§34, § server-ready) ---------------------
  // Every mutation goes through `applyCommand`, which validates the acting
  // country against authoritative ownership. The AI issues the same commands;
  // a future server receives them. The `order*` / `produce` helpers below just
  // stamp the player's countryId onto a command for the HUD's convenience.

  applyCommand(command: GameCommand): CommandResult {
    return runCommand(this, command);
  }

  orderMove(armyId: string, x: number, z: number, intent: 'move' | 'attack' = 'move') {
    return this.applyCommand({
      type: intent === 'attack' ? 'attackArmy' : 'moveArmy',
      countryId: this.state.playerCountryId, armyId, x, z,
    });
  }

  orderStop(armyId: string): boolean {
    return this.applyCommand({
      type: 'stopArmy', countryId: this.state.playerCountryId, armyId,
    }).ok;
  }

  orderExtract(armyId: string) {
    return this.applyCommand({
      type: 'extract', countryId: this.state.playerCountryId, armyId,
    });
  }

  produce(provinceId: number, unitTypeId: string) {
    return this.applyCommand({
      type: 'produce', countryId: this.state.playerCountryId, provinceId, unitTypeId,
    });
  }

  build(provinceId: number, buildingId: import('./units/unit-types').BuildingId) {
    return this.applyCommand({
      type: 'build', countryId: this.state.playerCountryId, provinceId, buildingId,
    });
  }

  setRally(provinceId: number, x: number, z: number) {
    return this.applyCommand({
      type: 'setRally', countryId: this.state.playerCountryId, provinceId, target: { x, z },
    });
  }

  clearRally(provinceId: number) {
    return this.applyCommand({
      type: 'setRally', countryId: this.state.playerCountryId, provinceId, target: null,
    });
  }

  rallyPoint(provinceId: number): { x: number; z: number } | null {
    return this.state.rallyPoints[provinceId] ?? null;
  }

  producible(provinceId: number): string[] {
    return producibleUnits(this, provinceId, this.state.playerCountryId);
  }

  buildable(provinceId: number) {
    return buildableBuildings(this, provinceId, this.state.playerCountryId);
  }

  /** Resource node whose access point the army is standing on (for the EXTRACT
   *  affordance), or null. */
  extractableNodeAt(armyId: string): number | null {
    const army = this.state.armies[armyId];
    if (!army) return null;
    const node = Object.values(this.state.resourceNodes).find(
      (n) => n.accessNodeId === army.graphNodeId && n.remaining > 0,
    );
    return node ? node.id : null;
  }

  /** Flip the foreign country geographically nearest the player's capital to
   *  'ai' control, so the slice has one active opponent (§56). Returns its id. */
  enableNearbyAi(): number | null {
    const player = this.state.countries[this.state.playerCountryId];
    if (!player) return null;
    const capitalId = this.world.countries.find((c) => c.id === this.state.playerCountryId)
      ?.capitalProvinceId ?? -1;
    const capital = this.world.provinces.find((p) => p.id === capitalId)
      ?? this.world.provinces.find((p) => this.state.provinceOwners[p.id] === player.id);
    if (!capital) return null;

    let best: number | null = null;
    let bestDist = Infinity;
    for (const country of Object.values(this.state.countries)) {
      if (country.id === player.id || country.controller === 'player') continue;
      const home = this.world.provinces.find((p) => this.state.provinceOwners[p.id] === country.id);
      if (!home) continue;
      const d = wrappedDistance(
        capital.center[0], capital.center[1], home.center[0], home.center[1], this.world.width,
      );
      if (d < bestDist) { bestDist = d; best = country.id; }
    }
    if (best !== null) {
      this.state.countries[best].controller = 'ai';
      // The AI opponent now needs an economy too — give it the same strategic
      // baseline the player got at init (idempotent if its natural geography
      // already covers stone + metal).
      guaranteeStrategicBaseline(
        this.state.resourceNodes,
        { world: this.world, graph: this.graph, provinceOwners: this.state.provinceOwners },
        best, this.state.seed,
      );
    }
    return best;
  }

  serialize(): string {
    return serializeGameState(this.state);
  }

  /** Deep structural clone of the current state (proves §47 serializability). */
  snapshot(): GameState {
    return cloneGameState(this.state);
  }
}
