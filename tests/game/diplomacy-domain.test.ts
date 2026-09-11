import { describe, expect, it } from 'vitest';
import { applyCommand, type CommandResult, type GameCommand } from '../../src/game/commands';
import {
  MAX_DIPLOMACY_MESSAGES_PER_PAIR, MAX_DIPLOMACY_PROPOSALS_PER_PAIR,
} from '../../src/game/diplomacy';
import { GAME_STATE_VERSION, emptyStockpile, relationOf, type GameState } from '../../src/game/game-state';
import type { SimContext } from '../../src/game/sim-context';

function state(): GameState {
  const country = (id: number, controller: 'player' | 'ai' = 'player') => ({
    id, name: `Country ${id}`, color: '#fff', controller,
    stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1,
  });
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: { 1: country(1), 2: country(2), 3: country(3, 'ai'), 4: country(4) },
    provinceOwners: { 10: 1, 20: 2, 30: 3 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {}, battles: {}, battleFronts: {}, resourceNodes: {}, relations: {},
    diplomacyMessages: {}, diplomacyProposals: {}, nextDiplomacyId: 1,
    nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

function commandState(): { state: GameState; command: (command: GameCommand) => CommandResult } {
  const gameState = state();
  const context = { state: gameState } as unknown as SimContext;
  return { state: gameState, command: (command) => applyCommand(context, command) };
}

describe('authoritative diplomacy domain', () => {
  it('stores trimmed player-to-player messages and rejects invalid recipients and bodies', () => {
    const c = commandState();
    expect(c.command({
      type: 'sendDiplomaticMessage', countryId: 1, targetCountryId: 2, body: '  Hold the line.  ',
    }).ok).toBe(true);
    expect(Object.values(c.state.diplomacyMessages ?? {})).toMatchObject([{
      fromCountryId: 1, toCountryId: 2, body: 'Hold the line.', sentAtTick: 0,
    }]);
    expect(c.command({
      type: 'sendDiplomaticMessage', countryId: 1, targetCountryId: 2, body: '   ',
    }).ok).toBe(false);
    expect(c.command({
      type: 'sendDiplomaticMessage', countryId: 1, targetCountryId: 2, body: 'x'.repeat(501),
    }).ok).toBe(false);
    expect(c.command({
      type: 'sendDiplomaticMessage', countryId: 1, targetCountryId: 3, body: 'AI target',
    }).ok).toBe(false);
    expect(c.command({
      type: 'sendDiplomaticMessage', countryId: 1, targetCountryId: 4, body: 'Dead target',
    }).ok).toBe(false);
    expect(c.command({
      type: 'sendDiplomaticMessage', countryId: 1, targetCountryId: 1, body: 'Self target',
    }).ok).toBe(false);
  });

  it('caps message history at the latest 50 records per unordered pair', () => {
    const c = commandState();
    for (let index = 0; index < MAX_DIPLOMACY_MESSAGES_PER_PAIR + 2; index += 1) {
      c.state.simulationTick = index;
      expect(c.command({
        type: 'sendDiplomaticMessage', countryId: index % 2 ? 2 : 1,
        targetCountryId: index % 2 ? 1 : 2, body: `message ${index}`,
      }).ok).toBe(true);
    }
    const messages = Object.values(c.state.diplomacyMessages ?? {});
    expect(messages).toHaveLength(MAX_DIPLOMACY_MESSAGES_PER_PAIR);
    expect(messages.map((message) => message.body)).not.toContain('message 0');
    expect(messages.map((message) => message.body)).not.toContain('message 1');
  });

  it('accepts alliance and peace proposals only by their recipients', () => {
    const c = commandState();
    expect(c.command({
      type: 'proposeDiplomacy', countryId: 1, targetCountryId: 2, proposal: 'alliance',
    }).ok).toBe(true);
    const alliance = Object.values(c.state.diplomacyProposals ?? {})[0];
    expect(c.command({
      type: 'proposeDiplomacy', countryId: 2, targetCountryId: 1, proposal: 'alliance',
    }).ok).toBe(false);
    expect(c.command({
      type: 'respondDiplomacy', countryId: 1, proposalId: alliance.id, accept: true,
    }).ok).toBe(false);
    c.state.simulationTick = 7;
    expect(c.command({
      type: 'respondDiplomacy', countryId: 2, proposalId: alliance.id, accept: true,
    }).ok).toBe(true);
    expect(alliance).toMatchObject({ status: 'accepted', resolvedAtTick: 7 });
    expect(relationOf(c.state, 1, 2)).toBe('allied');

    expect(c.command({ type: 'endAlliance', countryId: 1, targetCountryId: 2 }).ok).toBe(true);
    expect(relationOf(c.state, 1, 2)).toBe('peace');
    expect(c.command({ type: 'declareWar', countryId: 1, targetCountryId: 2 }).ok).toBe(true);
    expect(c.command({
      type: 'proposeDiplomacy', countryId: 2, targetCountryId: 1, proposal: 'peace',
    }).ok).toBe(true);
    const peace = Object.values(c.state.diplomacyProposals ?? {}).find((proposal) => proposal.kind === 'peace')!;
    expect(c.command({
      type: 'respondDiplomacy', countryId: 1, proposalId: peace.id, accept: true,
    }).ok).toBe(true);
    expect(relationOf(c.state, 1, 2)).toBe('peace');
  });

  it('declaring war withdraws all pending proposals for the pair', () => {
    const c = commandState();
    expect(c.command({ type: 'declareWar', countryId: 1, targetCountryId: 2 }).ok).toBe(true);
    expect(c.command({
      type: 'proposeDiplomacy', countryId: 1, targetCountryId: 2, proposal: 'peace',
    }).ok).toBe(true);
    const proposal = Object.values(c.state.diplomacyProposals ?? {})[0];
    c.state.simulationTick = 9;
    expect(c.command({ type: 'declareWar', countryId: 2, targetCountryId: 1 }).ok).toBe(true);
    expect(proposal).toMatchObject({ status: 'withdrawn', resolvedAtTick: 9 });
    expect(relationOf(c.state, 1, 2)).toBe('war');
  });

  it('bounds resolved proposal history while retaining transitions', () => {
    const c = commandState();
    for (let index = 0; index < MAX_DIPLOMACY_PROPOSALS_PER_PAIR + 2; index += 1) {
      c.state.simulationTick = index * 2;
      expect(c.command({
        type: 'proposeDiplomacy', countryId: 1, targetCountryId: 2, proposal: 'alliance',
      }).ok).toBe(true);
      const pending = Object.values(c.state.diplomacyProposals ?? {})
        .find((proposal) => proposal.status === 'pending')!;
      expect(c.command({
        type: 'respondDiplomacy', countryId: 2, proposalId: pending.id, accept: true,
      }).ok).toBe(true);
      expect(c.command({ type: 'endAlliance', countryId: 1, targetCountryId: 2 }).ok).toBe(true);
    }
    expect(Object.values(c.state.diplomacyProposals ?? {}))
      .toHaveLength(MAX_DIPLOMACY_PROPOSALS_PER_PAIR);
  });
});
