import { describe, expect, it } from 'vitest';
import { commandPayloadSchema, GAME_ID, PROTOCOL_VERSION } from '../../packages/protocol/src/index';
import { signGameTicket, verifyGameTicket } from '../../packages/protocol/src/ticket';
import { TicketNonceStore } from '../../apps/game-server/src/ticket-nonces';

const secret = 'a sufficiently long test secret';
const claims = {
  accountId: 'account-1', gameId: GAME_ID, countryId: 7,
  audience: 'game-server' as const, protocolVersion: PROTOCOL_VERSION,
  expiresAt: Date.now() + 30_000, nonce: 'nonce-1',
};

describe('game tickets and command wire schema', () => {
  it('verifies valid signed claims and rejects tampering, expiry, and audience mismatch', () => {
    expect(verifyGameTicket(signGameTicket(claims, secret), secret)).toEqual(claims);
    expect(() => verifyGameTicket(`${signGameTicket(claims, secret)}x`, secret)).toThrow(/signature/i);
    expect(() => verifyGameTicket(signGameTicket({ ...claims, expiresAt: Date.now() - 1 }, secret), secret)).toThrow(/expired/i);
    expect(() => verifyGameTicket(signGameTicket({ ...claims, audience: 'other' as never }, secret), secret)).toThrow(/audience/i);
  });

  it('strips forged ownership fields from network commands', () => {
    const parsed = commandPayloadSchema.parse({ type: 'stopArmy', armyId: 'army-1', countryId: 999 });
    expect(parsed).toEqual({ type: 'stopArmy', armyId: 'army-1' });
    expect('countryId' in parsed).toBe(false);
  });

  it('accepts a ticket nonce once and rejects replay', () => {
    const nonces = new TicketNonceStore();
    expect(nonces.consume('one-time', Date.now() + 10_000)).toBe(true);
    expect(nonces.consume('one-time', Date.now() + 10_000)).toBe(false);
  });
});
