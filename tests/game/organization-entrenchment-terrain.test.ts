import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { setRelation } from '../../src/game/game-state';
import { stepCombat } from '../../src/game/combat';
import {
  organizationEffectiveness, regenOrganization, drainOrganizationFromCombat,
} from '../../src/game/combat/organization';
import { stepEntrenchment, entrenchmentDamageMultiplier } from '../../src/game/combat/entrenchment';
import { terrainDefenseMultiplier } from '../../src/game/combat/terrain';
import { TERRAIN_CLASS } from '../../src/game/world-data';
import { ORGANIZATION_MAX, ENTRENCHMENT_MAX, MIN_ORGANIZATION_EFFECTIVENESS } from '../../src/game/combat/constants';

describe('organizationEffectiveness', () => {
  it('is 1 at full organization and the configured floor at zero', () => {
    expect(organizationEffectiveness(ORGANIZATION_MAX)).toBe(1);
    expect(organizationEffectiveness(0)).toBeCloseTo(MIN_ORGANIZATION_EFFECTIVENESS);
  });
});

describe('regenOrganization', () => {
  it('recovers a non-engaged army but leaves an engaged one untouched', () => {
    const ctx = fixture();
    ctx.state.armies = {
      resting: { ...army('resting', 1), status: 'idle', organization: 50 },
      fighting: { ...army('fighting', 1), status: 'engaged', organization: 50 },
    };
    regenOrganization(ctx, 2);
    expect(ctx.state.armies.resting.organization!).toBeGreaterThan(50);
    expect(ctx.state.armies.fighting.organization).toBe(50);
  });

  it('never exceeds the maximum', () => {
    const ctx = fixture();
    ctx.state.armies = { a: { ...army('a', 1), status: 'idle', organization: 99 } };
    regenOrganization(ctx, 100);
    expect(ctx.state.armies.a.organization).toBe(ORGANIZATION_MAX);
  });
});

describe('drainOrganizationFromCombat', () => {
  it('drains a merely-engaged army a little (the stress of the fight), a bloodied one more', () => {
    const ctx = fixture();
    const hurt = { ...army('hurt', 1), status: 'engaged' as const, organization: 100 };
    const untouched = { ...army('untouched', 2), status: 'engaged' as const, organization: 100 };
    const resting = { ...army('resting', 3), status: 'idle' as const, organization: 100 };
    ctx.state.armies = { hurt, untouched, resting };
    const pending = new Map([
      ['hurt\0infantry', { army: hurt, group: hurt.units[0], amount: hurt.units[0].hp * 0.5 }],
    ]);
    drainOrganizationFromCombat(ctx, pending, 1);
    expect(ctx.state.armies.hurt.organization!).toBeLessThan(ctx.state.armies.untouched.organization!);
    expect(ctx.state.armies.untouched.organization!).toBeLessThan(100);
    // Not currently in a front at all: untouched by combat drain.
    expect(ctx.state.armies.resting.organization).toBe(100);
  });
});

describe('stepEntrenchment', () => {
  it('grows while idle, freezes while engaged, clears once moving', () => {
    const ctx = fixture();
    ctx.state.armies = {
      dugIn: { ...army('dugIn', 1), status: 'idle', entrenchment: 0 },
      holding: { ...army('holding', 1), status: 'engaged', entrenchment: 40 },
      marching: { ...army('marching', 1), status: 'moving', entrenchment: 40 },
    };
    stepEntrenchment(ctx, 1);
    expect(ctx.state.armies.dugIn.entrenchment!).toBeGreaterThan(0);
    expect(ctx.state.armies.holding.entrenchment).toBe(40);
    expect(ctx.state.armies.marching.entrenchment).toBe(0);
  });

  it('never exceeds the maximum', () => {
    const ctx = fixture();
    ctx.state.armies = { a: { ...army('a', 1), status: 'idle', entrenchment: 99 } };
    stepEntrenchment(ctx, 1000);
    expect(ctx.state.armies.a.entrenchment).toBe(ENTRENCHMENT_MAX);
  });
});

describe('entrenchmentDamageMultiplier', () => {
  it('is 1 at zero entrenchment and reduced (but never zero) at the cap', () => {
    expect(entrenchmentDamageMultiplier(0)).toBe(1);
    const atMax = entrenchmentDamageMultiplier(ENTRENCHMENT_MAX);
    expect(atMax).toBeLessThan(1);
    expect(atMax).toBeGreaterThan(0);
  });
});

describe('terrainDefenseMultiplier', () => {
  it('gives no bonus on plains and a real bonus on mountains', () => {
    const world = fixture().world;
    const plain = terrainDefenseMultiplier({ ...world, terrainClassAt: () => TERRAIN_CLASS.plain }, 0, 0);
    const mountain = terrainDefenseMultiplier({ ...world, terrainClassAt: () => TERRAIN_CLASS.mountain }, 0, 0);
    expect(plain).toBe(1);
    expect(mountain).toBeLessThan(plain);
  });
});

describe('organization integration: retreat before annihilation', () => {
  it('a long siege can break a defender\'s organization well before its HP pool is spent', () => {
    const ctx = fixture();
    // A large, entrenched-free garrison defends against a somewhat larger
    // besieging force for a long, continuous siege (game-days, not hours).
    ctx.state.armies = {
      garrison: army('garrison', 1, 100, 100, 0, 'infantry', 40),
      besieger: army('besieger', 2, 100, 100, 0, 'infantry', 60),
    };
    ctx.state.provinceOwners = { 10: 1, 11: 0, 12: 0, 13: 0 };
    setRelation(ctx.state, 1, 2, 'war');
    let sawOrganizationDrop = false;
    for (let hour = 0; hour < 200; hour += 1) {
      ctx.state.simulationTick += 1;
      stepCombat(ctx, 1);
      const garrison = ctx.state.armies.garrison;
      if (!garrison) break; // destroyed outright — still a valid outcome, just not what we're checking here
      if ((garrison.organization ?? 100) < 90) { sawOrganizationDrop = true; break; }
    }
    expect(sawOrganizationDrop).toBe(true);
  });
});
