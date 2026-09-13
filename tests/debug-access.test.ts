import { describe, expect, it } from 'vitest';
import { setDebugHandles } from '../src/client/debug-access';

describe('authenticated debug handles', () => {
  it('keeps full-state and renderer handles absent without entitlement', () => {
    const target: Record<string, unknown> = {};
    setDebugHandles(target, false, { renderer: {}, combatEffects: {}, session: {} });
    expect(target).toEqual({});
  });

  it('installs entitled handles and removes them when access is revoked', () => {
    const renderer = {};
    const combatEffects = {};
    const session = {};
    const target: Record<string, unknown> = {};
    setDebugHandles(target, true, { renderer, combatEffects, session });
    expect(target).toMatchObject({
      __ironfrontsRenderer: renderer,
      __ironfrontsCombatEffects: combatEffects,
      __ironfrontsSession: session,
    });
    setDebugHandles(target, false, {});
    expect(target).toEqual({});
  });
});
