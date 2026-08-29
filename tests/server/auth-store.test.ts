import { describe, expect, it } from 'vitest';
import { AuthStore } from '../../apps/auth-server/src/auth-store';

describe('memory authentication store', () => {
  it('hashes passwords, treats usernames case-insensitively, and authenticates', async () => {
    const store = new AuthStore();
    const account = await store.register('FieldMarshal', 'correct horse battery');
    expect(account.passwordHash).not.toContain('correct horse battery');
    expect(account.passwordSalt.length).toBeGreaterThan(10);
    await expect(store.register('fieldmarshal', 'another password')).rejects.toThrow(/already/i);
    expect((await store.authenticate('FIELDMARSHAL', 'correct horse battery'))?.id).toBe(account.id);
    expect(await store.authenticate('FieldMarshal', 'wrong password')).toBeNull();
  });

  it('creates opaque revocable sessions and expires them', async () => {
    const store = new AuthStore();
    const account = await store.register('Commander', 'eight-letters');
    const active = store.createSession(account.id, 10_000);
    expect(store.sessionAccount(active.token)?.id).toBe(account.id);
    store.revoke(active.token);
    expect(store.sessionAccount(active.token)).toBeNull();
    const expired = store.createSession(account.id, -1);
    expect(store.sessionAccount(expired.token)).toBeNull();
  });

  it('allows only one winner in a case-insensitive registration race', async () => {
    const store = new AuthStore();
    const outcomes = await Promise.allSettled([
      store.register('RaceUser', 'first-password'),
      store.register('raceuser', 'second-password'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });
});
