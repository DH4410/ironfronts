/** Authoritative v2 gameplay command boundary and ownership gate. */

import type { SimContext } from './sim-context';
import { issueMoveOrder, issueStop } from './units/movement';
import { issueManualRetreat } from './combat';
import { issueExtract } from './extraction';
import { queueUnit } from './production';
import { queueBuilding } from './construction';
import { issueAttack } from './commands/attack';
import { issueSplit } from './commands/split';
import { issueStrike } from './strike';
import { nearestNode } from './movement/graph';
import {
  declareWar, endAlliance, proposeDiplomacy, respondDiplomacy, sendDiplomaticMessage,
} from './diplomacy';
import type { CommandResult, GameCommand } from './commands/types';

export type {
  AttackCommand, AttackTarget, BuildCommand, CommandResult, ExtractCommand,
  GameCommand, GameCommandType, MoveArmyCommand, ProduceCommand, RallyCommand,
  RetreatArmyCommand, SplitArmyCommand, StopArmyCommand, DeclareWarCommand,
  EndAllianceCommand, ProposeDiplomacyCommand, RespondDiplomacyCommand,
  SendDiplomaticMessageCommand, StrikeCommand,
} from './commands/types';

function controlsArmy(ctx: SimContext, countryId: number, armyId: string): boolean {
  return ctx.state.armies[armyId]?.ownerCountryId === countryId;
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
      return issueAttack(ctx, command);
    case 'retreatArmy':
      return issueManualRetreat(ctx, command.armyId, command.x, command.z);
    case 'splitArmy':
      return issueSplit(ctx, command);
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
    case 'setRally': {
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      if (command.target) {
        // Reject a rally the produced unit could never march to — otherwise it
        // spawns and silently ignores the order. Same reachability test the
        // spawn uses: the province's node and the rally node must share a
        // road-graph component.
        const province = ctx.world.provinces.find((p) => p.id === command.provinceId);
        const spawnNode = province
          ? nearestNode(ctx.graph, province.center[0], province.center[1]) : -1;
        const rallyNode = nearestNode(ctx.graph, command.target.x, command.target.z);
        if (spawnNode < 0 || rallyNode < 0
          || ctx.graph.component[spawnNode] !== ctx.graph.component[rallyNode]) {
          return { ok: false, reason: 'No land route from this province to that rally point.' };
        }
        ctx.state.rallyPoints[command.provinceId] = { ...command.target };
      } else {
        delete ctx.state.rallyPoints[command.provinceId];
      }
      return { ok: true };
    }
    case 'sendDiplomaticMessage':
      return sendDiplomaticMessage(ctx.state, command.countryId, command.targetCountryId, command.body);
    case 'proposeDiplomacy':
      return proposeDiplomacy(ctx.state, command.countryId, command.targetCountryId, command.proposal);
    case 'respondDiplomacy':
      return respondDiplomacy(ctx.state, command.countryId, command.proposalId, command.accept);
    case 'declareWar':
      return declareWar(ctx.state, command.countryId, command.targetCountryId);
    case 'endAlliance':
      return endAlliance(ctx.state, command.countryId, command.targetCountryId);
    case 'strike':
      return issueStrike(ctx, command);
  }
}
