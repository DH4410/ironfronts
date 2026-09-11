import type {
  CommandPayload, PlayerProjection, PresentationCatalogs, ProjectedArmy,
} from '@ironfronts/protocol';
import { GameConnection } from './game-connection';
import type { GameClockReading } from './game-clock';

type BuildingId = 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite';

interface Stockpile { funds: number; manpower: number; food: number; stone: number; metal: number; oil: number }
interface OwnCountry {
  id: number; name: string; color: string; controller: string;
  stockpile: Stockpile; income: Stockpile; industryCapacity: number;
  /** Live per-game-hour extraction rate by kind (stone/metal/oil); 0 when idle. */
  extraction?: { stone: number; metal: number; oil: number };
  /** Ready strategic warheads (whole count). Absent on pre-strike projections. */
  warheads?: number;
}
export class RemoteGameSession extends EventTarget {
  state: PlayerProjection;
  get catalogs(): PresentationCatalogs { return this.connection.catalogs; }
  readonly pendingCompletions: Array<{ provinceId: number; unitTypeId: string }> = [];
  readonly pendingBuildings: Array<{ provinceId: number; buildingId: BuildingId }> = [];
  readonly pendingCombat: Array<{
    attacker: number; defender: number;
    kind: 'engaged' | 'reinforced' | 'combatPulse' | 'retreat' | 'destroyed'
      | 'bombardment' | 'battleEnded' | 'strike';
    armyId?: string; targetArmyId?: string; battleId?: string; frontId?: string; x?: number; z?: number;
    provinceId?: number;
  }> = [];
  readonly pendingCaptures: Array<{ provinceId: number; fromCountryId: number; toCountryId: number }> = [];
  readonly pendingCommands = new Map<string, { command: CommandPayload; appliedRevision?: number }>();
  private readonly listeners = new AbortController();

  constructor(
    private readonly connection: GameConnection,
    private readonly commandFailed: (reason: string) => void,
  ) {
    super();
    this.state = structuredClone(connection.state);
    connection.addEventListener('state', () => this.rebuild(), { signal: this.listeners.signal });
    connection.addEventListener('connection-status', () => this.dispatchEvent(new Event('change')), { signal: this.listeners.signal });
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
          armyId: detail.armyId as string | undefined, targetArmyId: detail.targetArmyId as string | undefined,
          battleId: detail.battleId as string | undefined, frontId: detail.frontId as string | undefined,
          x: detail.x as number | undefined, z: detail.z as number | undefined,
          provinceId: detail.provinceId as number | undefined,
        });
      }
    }, { signal: this.listeners.signal });
  }

  get playerCountryId(): number { return this.state.viewerCountryId; }
  get ownCountry(): OwnCountry { return this.state.ownCountry as unknown as OwnCountry; }
  readEpochMs(): number { return this.connection.readEpochMs(); }
  readClock(): GameClockReading { return this.connection.readClock(); }

  /**
   * Live headcount of every unit in the player's own army stacks (infantry,
   * tanks, everything with a unit count) — a real military total, not the
   * flavor "national population" figure shown pre-game. Recomputed from the
   * current projection each read, so it stays correct as armies are built,
   * merged, split or destroyed.
   */
  get armySize(): number {
    let total = 0;
    for (const army of Object.values(this.state.armies)) {
      if (army.own && army.composition) total += army.composition.unitCount;
    }
    return total;
  }

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
    this.state = this.connection.state;
    for (const [id, pending] of this.pendingCommands) {
      if (pending.appliedRevision !== undefined && this.connection.revision >= pending.appliedRevision) this.pendingCommands.delete(id);
    }
    this.dispatchEvent(new Event('change'));
  }

  private send(
    command: CommandPayload, onAccepted?: () => void,
  ): { ok: boolean; reason?: string } {
    let id = '';
    id = this.connection.command(command, (ok, reason, requiredWarCountryIds, appliedRevision) => {
      if (ok) {
        const pending = this.pendingCommands.get(id);
        if (pending) pending.appliedRevision = appliedRevision ?? this.connection.revision;
        this.rebuild();
        // Server has accepted the order (after any war confirmation) but combat
        // has not started — the right moment to acknowledge the click.
        onAccepted?.();
      } else if (requiredWarCountryIds?.length) {
        this.pendingCommands.delete(id);
        this.rebuild();
        let answered = false;
        const respond = (confirmed: boolean): void => {
          if (answered) return;
          answered = true;
          if (!confirmed) return;
          const confirmedCommand = {
            ...command, confirmedWarCountryIds: [...new Set([...('confirmedWarCountryIds' in command ? command.confirmedWarCountryIds ?? [] : []), ...requiredWarCountryIds])],
          } as CommandPayload;
          this.send(confirmedCommand, onAccepted);
        };
        this.dispatchEvent(new CustomEvent('war-confirmation', {
          detail: { countryIds: [...requiredWarCountryIds], respond },
        }));
      } else {
        this.pendingCommands.delete(id);
        this.rebuild();
        this.commandFailed(reason ?? 'Command failed.');
      }
    });
    this.pendingCommands.set(id, { command });
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

  get fresh(): boolean { return this.connection.fresh; }
  get baselineGeneration(): number { return this.connection.baselineGeneration; }
  serverNow(): number { return this.connection.serverNow(); }
  get devMovementSpeed(): number { return this.connection.devMovementSpeed; }
  setDevMovementSpeed(multiplier: number): void { this.connection.setDevMovementSpeed(multiplier); }
  setDevClock(epochMs: number): void { this.connection.setDevClock(epochMs); }
  dispose(): void { this.listeners.abort(); this.pendingCommands.clear(); }
  pendingForArmy(armyId: string): boolean { return [...this.pendingCommands.values()].some(({ command }) => 'armyId' in command && command.armyId === armyId); }
  pendingForProvince(provinceId: number): boolean {
    return [...this.pendingCommands.values()].some(({ command }) =>
      'provinceId' in command && command.provinceId === provinceId);
  }

  orderMove(armyId: string, x: number, z: number, intent: 'move' | 'attack' = 'move') {
    if (intent === 'attack') return { ok: false, reason: 'Choose an attack target.' };
    return this.send({ type: 'moveArmy', armyId, x, z });
  }
  orderAttackProvince(armyId: string, provinceId: number, x: number, z: number, onAccepted?: () => void) {
    return this.send({ type: 'attackArmy', armyId, target: { kind: 'province', provinceId, x, z } }, onAccepted);
  }
  /**
   * Strategic strike on an enemy province. Country-level order (no army), never
   * painted optimistically — the server consumes the warhead and declares war.
   */
  orderStrike(provinceId: number, x: number, z: number, onAccepted?: () => void) {
    if ((this.ownCountry.warheads ?? 0) < 1) {
      return { ok: false, reason: 'No warhead is ready.' } as const;
    }
    return this.send({ type: 'strike', provinceId, x, z }, onAccepted);
  }
  orderAttackArmy(armyId: string, targetArmyId: string, onAccepted?: () => void) {
    return this.send({ type: 'attackArmy', armyId, target: { kind: 'army', armyId: targetArmyId } }, onAccepted);
  }
  orderRetreat(armyId: string, x: number, z: number) { return this.send({ type: 'retreatArmy', armyId, x, z }); }
  orderSplit(armyId: string, groups: readonly { typeId: string; count: number }[], x: number, z: number) {
    return this.send({ type: 'splitArmy', armyId, groups: [...groups], x, z });
  }
  orderStop(armyId: string): boolean { this.send({ type: 'stopArmy', armyId }); return true; }
  orderExtract(armyId: string) { return this.send({ type: 'extract', armyId }); }
  produce(provinceId: number, unitTypeId: string) { return this.send({ type: 'produce', provinceId, unitTypeId }); }
  build(provinceId: number, buildingId: BuildingId, onAccepted?: () => void) {
    return this.send({ type: 'build', provinceId, buildingId }, onAccepted);
  }
  setRally(provinceId: number, x: number, z: number) { return this.send({ type: 'setRally', provinceId, target: { x, z } }); }
  clearRally(provinceId: number) { return this.send({ type: 'setRally', provinceId, target: null }); }
  rallyPoint(provinceId: number): { x: number; z: number; route?: Array<{ x: number; z: number }> } | null {
    return this.state.rallyPoints[provinceId] ?? null;
  }

  productionOptions(provinceId: number) { return this.state.provinceActions[provinceId]?.production ?? []; }
  buildable(provinceId: number): Array<{ id: BuildingId; affordable: boolean }> {
    return (this.state.provinceActions[provinceId]?.construction ?? [])
      .filter((option) => option.available)
      .map((option) => ({ id: option.buildingId, affordable: option.affordable }));
  }
  canSetRally(provinceId: number): boolean { return this.state.provinceActions[provinceId]?.canSetRally ?? false; }
  extractableNodeAt(armyId: string): number | null {
    const action = this.state.armies[armyId]?.actions;
    return action?.canExtract ? action.extractableNodeId : null;
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
