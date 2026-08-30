/** Authoritative v2 gameplay command boundary. */

import type { SimContext } from './sim-context';
import { issueMoveOrder, issueStop } from './units/movement';
import { issueManualRetreat } from './combat';
import { issueExtract } from './extraction';
import { queueUnit } from './production';
import { queueBuilding } from './construction';
import type { BuildingId } from './units/unit-types';
import { unitType } from './units/unit-catalog';
import {
  canExtract, ensureArmyRuntimeState, stackUnitCount, type ArmyStack, type UnitGroup,
} from './units/army';
import { computeArmyVisibility } from './visibility';
import { relationOf, setRelation } from './game-state';
import { wrappedDistance } from './geometry';
import { nearestNode } from './movement/graph';
import { findPath, pathLength } from './movement/pathfind';

export interface MoveArmyCommand {
  readonly type: 'moveArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly x: number;
  readonly z: number;
  readonly confirmedWarCountryIds?: readonly number[];
}
export type AttackTarget =
  | { readonly kind: 'province'; readonly provinceId: number }
  | { readonly kind: 'army'; readonly armyId: string };
export interface AttackCommand {
  readonly type: 'attackArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly target: AttackTarget;
  readonly confirmedWarCountryIds?: readonly number[];
}
export interface RetreatArmyCommand {
  readonly type: 'retreatArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly firstNodeId: number;
}
export interface SplitArmyCommand {
  readonly type: 'splitArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly groups: readonly { readonly typeId: string; readonly count: number }[];
  readonly x: number;
  readonly z: number;
  readonly confirmedWarCountryIds?: readonly number[];
}
export interface StopArmyCommand {
  readonly type: 'stopArmy';
  readonly countryId: number;
  readonly armyId: string;
}
export interface ExtractCommand {
  readonly type: 'extract';
  readonly countryId: number;
  readonly armyId: string;
}
export interface ProduceCommand {
  readonly type: 'produce';
  readonly countryId: number;
  readonly provinceId: number;
  readonly unitTypeId: string;
}
export interface BuildCommand {
  readonly type: 'build';
  readonly countryId: number;
  readonly provinceId: number;
  readonly buildingId: BuildingId;
}
export interface RallyCommand {
  readonly type: 'setRally';
  readonly countryId: number;
  readonly provinceId: number;
  readonly target: { readonly x: number; readonly z: number } | null;
}

export type GameCommand =
  | MoveArmyCommand | AttackCommand | RetreatArmyCommand | SplitArmyCommand
  | StopArmyCommand | ExtractCommand | ProduceCommand | BuildCommand | RallyCommand;
export type GameCommandType = GameCommand['type'];

export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly orderId?: string;
  readonly armyId?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
}

function controlsArmy(ctx: SimContext, countryId: number, armyId: string): boolean {
  return ctx.state.armies[armyId]?.ownerCountryId === countryId;
}

function attack(ctx: SimContext, command: AttackCommand): CommandResult {
  const army = ctx.state.armies[command.armyId];
  ensureArmyRuntimeState(army);
  const artilleryOnly = army.units.length > 0
    && army.units.every((group) => unitType(group.typeId).category === 'artillery');
  if (command.target.kind === 'province') {
    if (artilleryOnly) {
      return { ok: false, reason: 'Artillery-only armies must select an enemy currently in range.' };
    }
    const provinceId = command.target.provinceId;
    const province = ctx.world.provinces.find((item) => item.id === provinceId);
    if (!province) return { ok: false, reason: 'No such province.' };
    return issueMoveOrder(
      ctx, army.id, province.center[0], province.center[1], 'attack',
      { kind: 'province', provinceId: province.id }, command.confirmedWarCountryIds,
      [ctx.state.provinceOwners[province.id] ?? 0],
    );
  }

  const target = ctx.state.armies[command.target.armyId];
  if (!target) return { ok: false, reason: 'No such target army.' };
  const contact = computeArmyVisibility(ctx.state, ctx.world, army.ownerCountryId).get(target.id);
  if (contact === 'hidden') return { ok: false, reason: 'Target is no longer detected.' };
  const required = relationOf(ctx.state, army.ownerCountryId, target.ownerCountryId) === 'war'
    ? [] : [target.ownerCountryId];
  if (required.some((id) => !command.confirmedWarCountryIds?.includes(id))) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: required };
  }
  if (artilleryOnly) {
    if (army.status !== 'idle' && army.status !== 'extracting') {
      return { ok: false, reason: 'Artillery must be stationary.' };
    }
    const range = Math.max(...army.units.map((group) => unitType(group.typeId).engagementRange));
    if (wrappedDistance(army.x, army.z, target.x, target.z, ctx.world.width) > range) {
      return { ok: false, reason: 'Target is outside artillery range.' };
    }
    for (const id of required) setRelation(ctx.state, army.ownerCountryId, id, 'war');
    army.artillery!.targetArmyId = target.id;
    army.artillery!.manualTarget = true;
    return { ok: true };
  }
  return issueMoveOrder(
    ctx, army.id, target.x, target.z, 'attack',
    { kind: 'army', armyId: target.id, lastKnownX: target.x, lastKnownZ: target.z },
    command.confirmedWarCountryIds, [target.ownerCountryId],
  );
}

function requestedGroups(parent: ArmyStack, requested: SplitArmyCommand['groups']): UnitGroup[] | string {
  const byType = new Map<string, number>();
  for (const item of requested) {
    if (!Number.isInteger(item.count) || item.count < 0) return 'Split counts must be whole numbers.';
    byType.set(item.typeId, (byType.get(item.typeId) ?? 0) + item.count);
  }
  const groups: UnitGroup[] = [];
  for (const [typeId, count] of byType) {
    if (count === 0) continue;
    const source = parent.units.find((group) => group.typeId === typeId);
    if (!source || count > source.count) return 'Split exceeds the available units.';
    groups.push({
      typeId, count, hp: source.hp * count / source.count, experience: source.experience,
    });
  }
  const detached = groups.reduce((sum, group) => sum + group.count, 0);
  if (detached < 1 || detached >= stackUnitCount(parent)) {
    return 'The parent and detachment must each retain at least one unit.';
  }
  return groups;
}

function split(ctx: SimContext, command: SplitArmyCommand): CommandResult {
  const parent = ctx.state.armies[command.armyId];
  ensureArmyRuntimeState(parent);
  if (parent.status === 'engaged' || parent.status === 'retreating') {
    return { ok: false, reason: 'Cannot split during close combat or retreat.' };
  }
  const groups = requestedGroups(parent, command.groups);
  if (typeof groups === 'string') return { ok: false, reason: groups };
  const id = `army-${ctx.state.nextArmyId}`;
  const child: ArmyStack = {
    id,
    ownerCountryId: parent.ownerCountryId,
    name: `${parent.name} Detachment`,
    x: parent.x,
    z: parent.z,
    graphNodeId: parent.graphNodeId,
    lastGraphNodeId: parent.lastGraphNodeId ?? null,
    units: groups,
    status: 'idle',
    order: null,
    extractingNodeId: null,
    suspendedOrder: null,
    battleFrontIds: [],
    retreat: null,
    artillery: { targetArmyId: null, manualTarget: false, nextVolleyTick: 0 },
  };
  const originalNodeId = parent.graphNodeId;
  const nextEdgeNodeId = parent.order?.path[0];
  let routedFromNextEdge = false;
  if (nextEdgeNodeId !== undefined) {
    const component = ctx.graph.component[originalNodeId] ?? -1;
    const goal = nearestNode(ctx.graph, command.x, command.z, 600, component);
    const previousPath = goal >= 0 ? findPath(ctx.graph, originalNodeId, goal) : null;
    const nextPath = goal >= 0 ? findPath(ctx.graph, nextEdgeNodeId, goal) : null;
    const previousCost = previousPath
      ? wrappedDistance(parent.x, parent.z, ctx.graph.nodeX[originalNodeId], ctx.graph.nodeZ[originalNodeId], ctx.world.width)
        + pathLength(ctx.graph, previousPath)
      : Infinity;
    const nextCost = nextPath
      ? wrappedDistance(parent.x, parent.z, ctx.graph.nodeX[nextEdgeNodeId], ctx.graph.nodeZ[nextEdgeNodeId], ctx.world.width)
        + pathLength(ctx.graph, nextPath)
      : Infinity;
    if (nextCost < previousCost) {
      child.graphNodeId = nextEdgeNodeId;
      child.lastGraphNodeId = originalNodeId;
      routedFromNextEdge = true;
    }
  }
  ctx.state.armies[id] = child;
  const route = issueMoveOrder(
    ctx, id, command.x, command.z, 'move',
    { kind: 'position', x: command.x, z: command.z }, command.confirmedWarCountryIds,
    [ctx.state.provinceOwners[ctx.world.provinceAt(command.x, command.z)] ?? 0],
  );
  if (!route.ok) {
    delete ctx.state.armies[id];
    return route;
  }
  if (routedFromNextEdge && child.order) {
    child.order.path.unshift(child.graphNodeId);
    child.graphNodeId = originalNodeId;
  }

  for (const detached of groups) {
    const source = parent.units.find((group) => group.typeId === detached.typeId)!;
    source.count -= detached.count;
    source.hp -= detached.hp;
  }
  parent.units = parent.units.filter((group) => group.count > 0 && group.hp > 0);
  if (parent.status === 'extracting' && !canExtract(parent)) {
    const node = parent.extractingNodeId === null
      ? undefined : ctx.state.resourceNodes[parent.extractingNodeId];
    if (node?.extractorArmyId === parent.id) {
      node.extractorArmyId = null;
      node.status = node.remaining > 0 ? 'idle' : 'exhausted';
    }
    parent.extractingNodeId = null;
    parent.status = 'idle';
  }
  ctx.state.nextArmyId += 1;
  return { ...route, armyId: id };
}

export function applyCommand(ctx: SimContext, command: GameCommand): CommandResult {
  if ('armyId' in command && !controlsArmy(ctx, command.countryId, command.armyId)) {
    return { ok: false, reason: 'Not your army.' };
  }
  switch (command.type) {
    case 'moveArmy':
      return issueMoveOrder(
        ctx, command.armyId, command.x, command.z, 'move',
        { kind: 'position', x: command.x, z: command.z }, command.confirmedWarCountryIds,
        [ctx.state.provinceOwners[ctx.world.provinceAt(command.x, command.z)] ?? 0],
      );
    case 'attackArmy':
      return attack(ctx, command);
    case 'retreatArmy':
      return issueManualRetreat(ctx, command.armyId, command.firstNodeId);
    case 'splitArmy':
      return split(ctx, command);
    case 'stopArmy':
      return issueStop(ctx, command.armyId)
        ? { ok: true } : { ok: false, reason: 'Army cannot stop now.' };
    case 'extract':
      return issueExtract(ctx, command.armyId);
    case 'produce':
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      return queueUnit(ctx, command.provinceId, command.unitTypeId, command.countryId);
    case 'build':
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      return queueBuilding(ctx, command.provinceId, command.buildingId, command.countryId);
    case 'setRally':
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      if (command.target) {
        ctx.state.rallyPoints[command.provinceId] = { ...command.target };
      } else {
        delete ctx.state.rallyPoints[command.provinceId];
      }
      return { ok: true };
  }
}
