/**
 * The single validated mutation boundary for gameplay.
 *
 *   PLAYER  ─┐
 *   SIMPLE AI ├─▶ applyCommand(ctx, { type, countryId, … }) ─▶ authoritative state
 *   SERVER  ─┘
 *
 * Every command carries the acting `countryId`. `applyCommand` checks it against
 * authoritative ownership before dispatching to the per-system `issue*` /
 * `queueUnit` helpers, which own the rest of the rules (path legality, cost,
 * building, deposit control). No caller — not the HUD, not the AI, not a future
 * network server — edits `army.position`, a stockpile, or a queue directly.
 *
 * Pure over `SimContext`: no renderer, no DOM, runnable in Node.
 */

import type { SimContext } from './sim-context';
import { issueMoveOrder, issueStop } from './units/movement';
import { issueExtract } from './extraction';
import { queueUnit } from './production';
import { queueBuilding } from './construction';
import type { BuildingId } from './units/unit-types';

export interface MoveArmyCommand {
  readonly type: 'moveArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly x: number;
  readonly z: number;
}
export interface AttackCommand {
  readonly type: 'attackArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly x: number;
  readonly z: number;
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
  /** null clears the rally point. */
  readonly target: { readonly x: number; readonly z: number } | null;
}

/** Every mutation the player or AI can request today. */
export type GameCommand =
  | MoveArmyCommand
  | AttackCommand
  | StopArmyCommand
  | ExtractCommand
  | ProduceCommand
  | BuildCommand
  | RallyCommand;

export type GameCommandType = GameCommand['type'];

export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** Set by `produce` on success. */
  readonly orderId?: string;
  /** Set by move/attack on success — path length. */
  readonly nodes?: number;
}

function controlsArmy(ctx: SimContext, countryId: number, armyId: string): boolean {
  return ctx.state.armies[armyId]?.ownerCountryId === countryId;
}

export function applyCommand(ctx: SimContext, command: GameCommand): CommandResult {
  switch (command.type) {
    case 'moveArmy':
    case 'attackArmy': {
      if (!controlsArmy(ctx, command.countryId, command.armyId)) {
        return { ok: false, reason: 'Not your army.' };
      }
      return issueMoveOrder(
        ctx, command.armyId, command.x, command.z,
        command.type === 'attackArmy' ? 'attack' : 'move',
      );
    }
    case 'stopArmy': {
      if (!controlsArmy(ctx, command.countryId, command.armyId)) {
        return { ok: false, reason: 'Not your army.' };
      }
      return { ok: issueStop(ctx, command.armyId) };
    }
    case 'extract': {
      if (!controlsArmy(ctx, command.countryId, command.armyId)) {
        return { ok: false, reason: 'Not your army.' };
      }
      return issueExtract(ctx, command.armyId);
    }
    case 'produce': {
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      return queueUnit(ctx, command.provinceId, command.unitTypeId, command.countryId);
    }
    case 'build': {
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      return queueBuilding(ctx, command.provinceId, command.buildingId, command.countryId);
    }
    case 'setRally': {
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      if (command.target) {
        ctx.state.rallyPoints[command.provinceId] = { x: command.target.x, z: command.target.z };
      } else {
        delete ctx.state.rallyPoints[command.provinceId];
      }
      return { ok: true };
    }
    default: {
      const exhaustive: never = command;
      return { ok: false, reason: `Unknown command ${(exhaustive as GameCommand).type}` };
    }
  }
}
