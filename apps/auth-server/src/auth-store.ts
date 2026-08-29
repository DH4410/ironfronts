import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);

export interface Account { id: string; username: string; normalizedUsername: string; passwordHash: string; passwordSalt: string }
interface Session { accountId: string; expiresAt: number }

export class AuthStore {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, Session>();
  private readonly pendingRegistrations = new Set<string>();

  async register(username: string, password: string): Promise<Account> {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    if (this.accounts.has(normalizedUsername) || this.pendingRegistrations.has(normalizedUsername)) {
      throw new Error('Username is already registered.');
    }
    this.pendingRegistrations.add(normalizedUsername);
    try {
      const salt = randomBytes(16).toString('base64url');
      const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString('base64url');
      const account = { id: randomUUID(), username: username.trim(), normalizedUsername, passwordHash, passwordSalt: salt };
      this.accounts.set(normalizedUsername, account);
      return account;
    } finally {
      this.pendingRegistrations.delete(normalizedUsername);
    }
  }

  async authenticate(username: string, password: string): Promise<Account | null> {
    const normalized = username.trim().toLocaleLowerCase('en-US');
    const account = this.accounts.get(normalized);
    if (!account) {
      await scrypt(password, 'invalid-account-timing-salt', 64);
      return null;
    }
    const supplied = await scrypt(password, account.passwordSalt, 64) as Buffer;
    const expected = Buffer.from(account.passwordHash, 'base64url');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? account : null;
  }

  createSession(accountId: string, ttlMs: number): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + ttlMs;
    this.sessions.set(hashToken(token), { accountId, expiresAt });
    return { token, expiresAt };
  }

  sessionAccount(token: string | undefined): Account | null {
    if (!token) return null;
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }
    return [...this.accounts.values()].find((account) => account.id === session.accountId) ?? null;
  }

  revoke(token: string | undefined): void { if (token) this.sessions.delete(hashToken(token)); }
  cleanup(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
  }
}

function hashToken(token: string): string { return createHash('sha256').update(token).digest('base64url'); }
function normalizeUsername(username: string): string {
  const trimmed = username.trim();
  if (!/^[\p{L}\p{N}_ .-]{3,32}$/u.test(trimmed)) throw new Error('Username must be 3–32 characters.');
  return trimmed.toLocaleLowerCase('en-US');
}
function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 256) throw new Error('Password must be 8–256 characters.');
}
