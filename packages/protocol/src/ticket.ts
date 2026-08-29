import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GameTicketClaims } from './index';

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signGameTicket(claims: GameTicketClaims, secret: string): string {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyGameTicket(token: string, secret: string): GameTicketClaims {
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra) throw new Error('Malformed game ticket.');
  const expected = signature(payload, secret);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Invalid game ticket signature.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GameTicketClaims;
  if (claims.audience !== 'game-server') throw new Error('Invalid game ticket audience.');
  if (claims.protocolVersion !== 1) throw new Error('Unsupported protocol version.');
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now()) throw new Error('Game ticket expired.');
  return claims;
}
