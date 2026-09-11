import type {
  CommandPayload, PlayerProjection, PresentationCatalogs, ProjectedArmy,
} from '@ironfronts/protocol';
import { GameConnection } from './game-connection';
import type { GameClockReading } from './game-clock';

type OptimisticMutation = (state: PlayerProjection) => void;
type BuildingId = 'barracks' | 'tankPlant' | 'ordnance';

interface Stockpile { funds: number; manpower: number; food: number; stone: number; metal: number; oil: number }
interface OwnCountry {
  id: number; name: string; color: string; controller: string;
  stockpile: Stockpile; income: Stockpile; industryCapacity: number;
  /** Live per-game-hour extraction rate by kind (stone/metal/oil); 0 when idle. */
  extraction?: { stone: number; metal: number; oil: number };
  /** Ready strategic warheads (whole count). Absent on pre-strike projections. */
  warheads?: number;
}
interface QueueOrder { id: string; unitTypeId: string; buildingId?: BuildingId; progressHours: number; totalHours: number }

export class RemoteGameSession extends EventTarget {
  state: PlayerProjection;
  readonly catalogs: PresentationCatalogs;
  readonly pendingCompletions: Array<{ provinceId: number; unitTypeId: string }> = [];
  readonly pendingBuildings: Array<{ provinceId: number; buildingId: BuildingId }> = [];
  readonly pendingCombat: Array<{
    attacker: number; defender: number;
    kind: 'engaged' | 'reinforced' | 'combatPulse' | 'retreat' | 'destroyed'
      | 'bombardment' | 'battleEnded' | 'strike';
    /** Strategic-strike impact point, world-space. Only on 'strike'. */
    x?: number; z?: number; provinceId?: number;
  }> = [];
  readonly pendingCaptures: Array<{ provinceId: number; fromCountryId: number; toCountryId: number }> = [];
  private readonly optimistic = new Map<string, OptimisticMutation>();
  private readonly acknowledged = new Set<string>();

  constructor(
    private readonly connection: GameConnection,
    private readonly commandFailed: (reason: string) => void,
  ) {
    super();
    this.state = structuredClone(connection.state);
    this.catalogs = connection.catalogs;
    connection.addEventListener('state', () => {
      for (const id of this.acknowledged) this.optimistic.delete(id);
      this.acknowledged.clear();
      this.rebuild();
    });
    connection.addEventListener('game-event', (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const kind = String(detail.kind ?? '');
      if (kind === 'unitCompleted') {
        this.pendingCompletions.push({
          provinceId: Number(detail.provinceId), unitTypeId: String(detail.unitTypeId),
        });
      } else if (kind === 'buildingCompleted') {
        this.pendingBuildings.push({
          provinceId: Number(detail.provinceId), buildingId: String(detail.buildingId) as BuildingId,
        });
      } else if (kind === 'capture') {
        this.pendingCaptures.push({
          provinceId: Number(detail.provinceId),
          fromCountryId: Number(detail.fromCountryId),
          toCountryId: Number(detail.toCountryId),
        });
      } else if ([
        'engaged', 'reinforced', 'combatPulse', 'retreat', 'destroyed', 'bombardment',
        'battleEnded', 'strike',
      ].includes(kind)) {
        this.pendingCombat.push({
          kind: kind as (typeof this.pendingCombat)[number]['kind'],
          attacker: Number(detail.attacker),
          defender: Number(detail.defender),
          ...(kind === 'strike' ? {
            x: Number(detail.x), z: Number(detail.z), provinceId: Number(detail.provinceId),
          } : {}),
        });
      }
    });
  }

  get playerCountryId(): number { return this.state.viewerCountryId; }
  get ownCountry(): OwnCountry { return this.state.ownCountry as unknown as OwnCountry; }
  readClock(): GameClockReading { return this.connection.readClock(); }

  /** Dev/test only. See GameConnection.setDevSimSpeed. */
  get devSimSpeed(): number { return this.connection.devSimSpeed; }
  get devSimSpeedEnabled(): boolean { return this.connection.devSimSpeedEnabled; }
  setDevSimSpeed(multiplier: number): void { this.connection.setDevSimSpeed(multiplier); }

  /** Dev/test only. See GameConnection.setDevEnvironment. */
  get devTimeOfDayHours(): number | null { return this.connection.devTimeOfDayHours; }
  get devRaining(): boolean { return this.connection.devRaining; }
  get devEnvironmentEnabled(): boolean { return this.connection.devEnvironmentEnabled; }
  setDevEnvironment(next: { timeOfDayHours?: number; raining?: boolean }): void {
    this.connection.setDevEnvironment(next);
  }

  unit(typeId: string): Record<string, unknown> | undefined {
    return this.catalogs.units.find((unit) => unit.id === typeId);
  }
  building(id: BuildingId): Record<string, unknown> | undefined {
    return this.catalogs.buildings.find((building) => building.id === id);
  }

  private rebuild(): void {
    this.state = structuredClone(this.connection.state);
    for (const mutation of this.optimistic.values()) mutation(this.state);
    this.dispatchEvent(new Event('change'));
  }

  private send(
    command: CommandPayload, mutation: OptimisticMutation, onAccepted?: () => void,
  ): { ok: true } {
    let id = '';
    id = this.connection.command(command, (ok, reason, requiredWarCountryIds) => {
      if (ok) {
        this.acknowledged.add(id);
        // Server has accepted the order (after any war confirmation) but combat
        // has not started — the right moment to acknowledge the click.
        onAccepted?.();
      } else if (requiredWarCountryIds?.length) {
        this.optimistic.delete(id);
        this.rebuild();
        let answered = false;
        const respond = (confirmed: boolean): void => {
          if (answered) return;
          answered = true;
          if (!confirmed) return;
          const confirmedCommand = {
            ...command, confirmedWarCountryIds: [...requiredWarCountryIds],
          } as CommandPayload;
          this.send(confirmedCommand, mutation, onAccepted);
        };
        this.dispatchEvent(new CustomEvent('war-confirmation', {
          detail: { countryIds: [...requiredWarCountryIds], respond },
        }));
      } else {
        this.optimistic.delete(id);
        this.rebuild();
        this.commandFailed(reason ?? 'Command failed.');
      }
    });
    this.optimistic.set(id, mutation);
    this.rebuild();
    return { ok: true };
  }

  /**
   * Diplomacy is authoritative and never painted optimistically: another
   * player may answer or change the relation at the same time. The optional
   * callback only releases local UI busy state; rejected commands still flow
   * through the session's shared commandFailed notification path.
   */
  private sendDiplomacyCommand(
    command: CommandPayload, onResult?: (ok: boolean) => void,
  ): { ok: true } {
    this.connection.command(command, (ok, reason) => {
      if (!ok) this.commandFailed(reason ?? 'Diplomacy command failed.');
      onResult?.(ok);
    });
    return { ok: true };
  }

  sendDiplomaticMessage(targetCountryId: number, body: string, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({
      type: 'sendDiplomaticMessage', targetCountryId, body,
    }, onResult);
  }

  proposeDiplomacy(
    targetCountryId: number, proposal: 'alliance' | 'peace', onResult?: (ok: boolean) => void,
  ) {
    return this.sendDiplomacyCommand({
      type: 'proposeDiplomacy', targetCountryId, proposal,
    }, onResult);
  }

  respondDiplomacy(proposalId: string, accept: boolean, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({
      type: 'respondDiplomacy', proposalId, accept,
    }, onResult);
  }

  declareWar(targetCountryId: number, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({ type: 'declareWar', targetCountryId }, onResult);
  }

  endAlliance(targetCountryId: number, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({ type: 'endAlliance', targetCountryId }, onResult);
  }

  ownsArmy(armyId: string): boolean { return this.state.armies[armyId]?.own ?? false; }
  ownsProvince(provinceId: number): boolean { return this.state.provinceOwners[provinceId] === this.playerCountryId; }

  orderMove(armyId: string, x: number, z: number, intent: 'move' | 'attack' = 'move') {
    if (!this.ownsArmy(armyId)) return { ok: false, reason: 'Not your army.' } as const;
    if (intent === 'attack') return { ok: false, reason: 'Choose an attack target.' } as const;
    return this.send({ type: 'moveArmy', armyId, x, z }, (state) => {
      const army = state.armies[armyId];
      if (army) { army.moveOrder = { x, z }; army.status = 'moving'; }
    });
  }
  orderAttackProvince(
    armyId: string, provinceId: number, x: number, z: number, onAccepted?: () => void,
  ) {
    if (!this.ownsArmy(armyId)) return { ok: false, reason: 'Not your army.' } as const;
    return this.send({ type: 'attackArmy', armyId, target: { kind: 'province', provinceId, x, z } }, (state) => {
      const army = state.armies[armyId];
      if (army) { army.status = 'moving'; army.moveIntent = 'attack'; }
    }, onAccepted);
  }
  /**
   * Strategic strike on an enemy province. Country-level order (no army), never
   * painted optimistically — the server consumes the warhead and declares war.
   */
  orderStrike(provinceId: number, x: number, z: number, onAccepted?: () => void) {
    if ((this.ownCountry.warheads ?? 0) < 1) {
      return { ok: false, reason: 'No warhead is ready.' } as const;
    }
    return this.send({ type: 'strike', provinceId, x, z }, () => undefined, onAccepted);
  }
  orderAttackArmy(armyId: string, targetArmyId: string, onAccepted?: () => void) {
    if (!this.ownsArmy(armyId)) return { ok: false, reason: 'Not your army.' } as const;
    return this.send({ type: 'attackArmy', armyId, target: { kind: 'army', armyId: targetArmyId } }, (state) => {
      const army = state.armies[armyId];
      if (army) { army.status = 'moving'; army.moveIntent = 'attack'; }
    }, onAccepted);
  }
  orderRetreat(armyId: string, x: number, z: number) {
    if (!this.ownsArmy(armyId)) return { ok: false, reason: 'Not your army.' } as const;
    return this.send({ type: 'retreatArmy', armyId, x, z }, (state) => {
      const army = state.armies[armyId];
      if (army) army.status = 'retreating';
    });
  }
  orderSplit(
    armyId: string, groups: readonly { typeId: string; count: number }[], x: number, z: number,
  ) {
    if (!this.ownsArmy(armyId)) return { ok: false, reason: 'Not your army.' } as const;
    return this.send({ type: 'splitArmy', armyId, groups: [...groups], x, z }, () => undefined);
  }
  orderStop(armyId: string) {
    if (!this.ownsArmy(armyId)) return false;
    this.send({ type: 'stopArmy', armyId }, (state) => {
      const army = state.armies[armyId];
      if (army) { army.moveOrder = null; army.status = 'idle'; }
    });
    return true;
  }
  orderExtract(armyId: string) {
    if (!this.ownsArmy(armyId)) return { ok: false, reason: 'Not your army.' } as const;
    return this.send({ type: 'extract', armyId }, (state) => {
      const army = state.armies[armyId];
      if (army) army.status = 'extracting';
    });
  }
  produce(provinceId: number, unitTypeId: string) {
    if (!this.ownsProvince(provinceId)) return { ok: false, reason: 'Not your province.' } as const;
    const tempId = `optimistic-${Date.now()}`;
    return this.send({ type: 'produce', provinceId, unitTypeId }, (state) => {
      ((state.productionQueues[provinceId] ??= []) as QueueOrder[]).push({ id: tempId, unitTypeId, progressHours: 0, totalHours: Number(this.unit(unitTypeId)?.buildTimeHours ?? 1) / 4 });
      this.deduct(state, this.unit(unitTypeId)?.cost);
    });
  }
  build(provinceId: number, buildingId: BuildingId, onAccepted?: () => void) {
    if (!this.ownsProvince(provinceId)) return { ok: false, reason: 'Not your province.' } as const;
    const tempId = `optimistic-${Date.now()}`;
    return this.send({ type: 'build', provinceId, buildingId }, (state) => {
      ((state.constructionQueues[provinceId] ??= []) as QueueOrder[]).push({ id: tempId, unitTypeId: '', buildingId, progressHours: 0, totalHours: Number(this.building(buildingId)?.buildTimeHours ?? 1) / 4 });
      this.deduct(state, this.building(buildingId)?.cost);
    }, onAccepted);
  }
  setRally(provinceId: number, x: number, z: number) {
    return this.send({ type: 'setRally', provinceId, target: { x, z } }, (state) => { state.rallyPoints[provinceId] = { x, z }; });
  }
  clearRally(provinceId: number) {
    return this.send({ type: 'setRally', provinceId, target: null }, (state) => { delete state.rallyPoints[provinceId]; });
  }
  rallyPoint(provinceId: number): { x: number; z: number; route?: Array<{ x: number; z: number }> } | null {
    return this.state.rallyPoints[provinceId] ?? null;
  }

  private deduct(state: PlayerProjection, cost: unknown): void {
    if (!state.ownCountry || !cost || typeof cost !== 'object') return;
    const stockpile = (state.ownCountry as unknown as OwnCountry).stockpile;
    for (const [key, amount] of Object.entries(cost)) {
      if (key in stockpile && typeof amount === 'number') stockpile[key as keyof Stockpile] -= amount;
    }
  }

  producible(provinceId: number): string[] {
    if (!this.ownsProvince(provinceId)) return [];
    const buildings = this.state.provinceBuildings[provinceId];
    if (!buildings) return [];
    return this.catalogs.units.filter((unit) => {
      const requirement = unit.requiredBuilding as BuildingId;
      return buildings[requirement] > 0;
    }).map((unit) => String(unit.id));
  }
  buildable(provinceId: number): Array<{ id: BuildingId; affordable: boolean }> {
    if (!this.ownsProvince(provinceId)) return [];
    const current = this.state.provinceBuildings[provinceId]
      ?? { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 0 };
    const queued = this.state.constructionQueues[provinceId] as QueueOrder[] | undefined;
    return (['barracks', 'tankPlant', 'ordnance', 'missileSite'] as BuildingId[])
      .filter((id) => current[id] < 1 && !queued?.some((order) => order.buildingId === id))
      .map((id) => ({ id, affordable: this.affordable(this.building(id)?.cost) }));
  }
  private affordable(cost: unknown): boolean {
    if (!cost || typeof cost !== 'object') return true;
    return Object.entries(cost).every(([key, amount]) =>
      typeof amount !== 'number' || (this.ownCountry.stockpile[key as keyof Stockpile] ?? 0) >= amount);
  }
  /**
   * The deposit this army could start extracting right now, or null. Mirrors the
   * server's `issueExtract` rule so the HUD never offers Extract where the order
   * will be refused: the stack must be idle, on a controlled non-empty deposit's
   * access node, and carry an extraction-capable unit.
   */
  extractableNodeAt(armyId: string): number | null {
    const army = this.state.armies[armyId];
    if (!army || !army.own || army.graphNodeId === undefined) return null;
    if (army.moveOrder || army.status === 'moving' || army.status === 'engaged'
      || army.status === 'retreating') return null;
    const canExtract = (army.composition?.groups ?? []).some((group) => {
      const rate = Number(
        (this.unit(group.typeId) as { extractionRate?: number } | undefined)?.extractionRate ?? 0,
      );
      return rate > 0;
    });
    if (!canExtract) return null;
    const node = Object.values(this.state.resourceNodes).find((value) => {
      const n = value as { accessNodeId?: number; remaining?: number; controllerCountryId?: number };
      return n.accessNodeId === army.graphNodeId
        && (n.remaining ?? 0) > 0
        && n.controllerCountryId === this.playerCountryId;
    }) as { id?: number } | undefined;
    return node?.id ?? null;
  }
  army(armyId: string): ProjectedArmy | null { return this.state.armies[armyId] ?? null; }
  describeProvince(provinceId: number) {
    const ownerId = this.state.provinceOwners[provinceId] ?? 0;
    const owner = this.state.countries[ownerId];
    const isOwn = ownerId === this.playerCountryId;
    const totals = { stone: 0, metal: 0, oil: 0 };
    let any = false;
    let controlled = false;
    let extracting = false;
    for (const value of Object.values(this.state.resourceNodes)) {
      const node = value as { provinceId: number; kind: keyof typeof totals; remaining: number; controllerCountryId: number; status: string };
      if (node.provinceId !== provinceId) continue;
      any = true; totals[node.kind] += node.remaining;
      controlled ||= node.controllerCountryId === ownerId;
      extracting ||= node.status === 'extracting';
    }
    return { ownerId, ownerName: owner?.name ?? `Country ${ownerId}`, ownerColor: owner?.color ?? '#888888', isOwn, resources: any ? totals : null, controlled, extracting };
  }
}
