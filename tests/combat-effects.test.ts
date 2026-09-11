import { describe, expect, it } from 'vitest';
import {
  CombatEffectPool, EFFECT_KIND, EFFECT_STRIDE, compassLabel, effectDensityForDistance,
} from '../src/combat-effects';
import {
  battleClusterKey, combatHuddleOffset, HUDDLE_MAX_PULL, HUDDLE_TARGET_RADIUS, type Point,
} from '../src/combat-huddle';

const CAM = { x: 0, z: 0 };

describe('CombatEffectPool lifecycle', () => {
  it('never exceeds capacity and reuses slots (ring buffer, no growth)', () => {
    const pool = new CombatEffectPool(32);
    for (let i = 0; i < 200; i += 1) pool.spawn(EFFECT_KIND.impact, i, 0, { now: 1_000 });
    expect(pool.liveTransients(1_000)).toBe(32);
    const { floats, count } = pool.collect(1_000, CAM, 100_000);
    expect(count).toBe(32);
    expect(floats.length).toBe(32 * EFFECT_STRIDE);
  });

  it('ages transients out by their lifetime', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.muzzleFlash, 0, 0, { now: 0, lifetimeMs: 100 });
    expect(pool.collect(50, CAM, 1e6).count).toBe(1);
    expect(pool.collect(120, CAM, 1e6).count).toBe(0);
  });

  it('packs age01 as normalised lifetime progress', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.explosion, 10, 20, { now: 0, lifetimeMs: 1_000 });
    const { floats } = pool.collect(250, CAM, 1e6);
    expect(floats[0]).toBe(10);
    expect(floats[1]).toBe(20);
    expect(floats[2]).toBe(EFFECT_KIND.explosion);
    expect(floats[3]).toBeCloseTo(0.25, 5);
  });

  it('distance-culls transients but keeps battle markers', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.impact, 9_000, 0, { now: 0 });
    pool.setBattle('b1', 9_000, 0, 1);
    const { count, floats } = pool.collect(0, CAM, 2_000);
    expect(count).toBe(1); // marker only; the far impact is culled
    expect(floats[2]).toBe(EFFECT_KIND.battleMarker);
  });

  it('writes battle markers first and respects the instance budget', () => {
    const pool = new CombatEffectPool(64);
    pool.setBattle('b1', 0, 0);
    pool.setBattle('b2', 10, 10);
    for (let i = 0; i < 20; i += 1) pool.spawn(EFFECT_KIND.tracer, 0, 0, { now: 0 });
    const { count, floats } = pool.collect(0, CAM, 1e6, 3);
    expect(count).toBe(3);
    expect(floats[2]).toBe(EFFECT_KIND.battleMarker);
    expect(floats[EFFECT_STRIDE + 2]).toBe(EFFECT_KIND.battleMarker);
  });

  it('syncBattles reconciles the live set (adds new, drops ended)', () => {
    const pool = new CombatEffectPool();
    pool.syncBattles([{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 1, z: 1 }]);
    expect(pool.battleCount).toBe(2);
    pool.syncBattles([{ id: 'b', x: 1, z: 1 }, { id: 'c', x: 2, z: 2 }]);
    expect(pool.battleCount).toBe(2);
    const ids = new Set<number>();
    const { floats, count } = pool.collect(0, CAM, 999);
    for (let i = 0; i < count; i += 1) ids.add(floats[i * EFFECT_STRIDE]); // x doubles as a cheap id here
    expect(count).toBe(2);
  });

  it('spawnVolley emits a small, category-appropriate burst (strategic scale)', () => {
    const inf = new CombatEffectPool();
    inf.spawnVolley('infantry', 0, 0, 0, { now: 0 });
    const art = new CombatEffectPool();
    art.spawnVolley('artillery', 0, 0, 0, { now: 0 });
    // A handful, not hundreds.
    expect(inf.liveTransients(0)).toBeGreaterThanOrEqual(4);
    expect(inf.liveTransients(0)).toBeLessThan(16);
    expect(art.liveTransients(0)).toBeLessThan(12);
  });

  it('clear() drops everything', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.impact, 0, 0, { now: 0 });
    pool.setBattle('b', 0, 0);
    pool.clear();
    expect(pool.collect(0, CAM, 999).count).toBe(0);
  });
});

describe('effect LOD + compass helpers', () => {
  it('scales spawn density down with camera distance', () => {
    expect(effectDensityForDistance(1_000)).toBe(1);
    expect(effectDensityForDistance(6_000)).toBe(0);
    const mid = effectDensityForDistance(3_200);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('labels attack bearings like the server (north is -z, east is +x)', () => {
    expect(compassLabel(0, -10)).toBe('N');
    expect(compassLabel(10, 0)).toBe('E');
    expect(compassLabel(0, 10)).toBe('S');
    expect(compassLabel(-10, 0)).toBe('W');
    expect(compassLabel(10, -10)).toBe('NE');
    expect(compassLabel(0, 0)).toBe('');
  });
});

describe('combatHuddleOffset (render-only visual nudge)', () => {
  it('pulls a far-apart stack in toward its shared battle anchor, closing the gap to the target radius', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 100, z: 0 };
    const offset = combatHuddleOffset(self, anchor);
    expect(offset.x).toBeGreaterThan(0); // pulled toward +x, where the anchor is
    expect(offset.z).toBeCloseTo(0);
    // The whole point of the huddle is that the RESULT reads as close, not
    // just that some offset was applied — assert the actual post-offset gap.
    const resultingDist = Math.hypot((self.x + offset.x) - anchor.x, (self.z + offset.z) - anchor.z);
    expect(resultingDist).toBeCloseTo(HUDDLE_TARGET_RADIUS, 5);
  });

  it('does not push an already-close stack away from its anchor', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 10, z: 0 }; // well inside HUDDLE_TARGET_RADIUS
    expect(combatHuddleOffset(self, anchor)).toEqual({ x: 0, z: 0 });
  });

  it('the anchor stack itself (self === anchor) gets no offset', () => {
    const point: Point = { x: 42, z: -17 };
    expect(combatHuddleOffset(point, point)).toEqual({ x: 0, z: 0 });
  });

  it('caps the pull distance so a very far anchor cannot teleport the marker', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 100_000, z: 0 };
    const offset = combatHuddleOffset(self, anchor);
    expect(offset.x).toBeCloseTo(HUDDLE_MAX_PULL, 5);
  });

  it('is a pure function: never mutates the points it reads', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 30, z: 40 };
    const selfSnapshot = { ...self };
    const anchorSnapshot = { ...anchor };
    combatHuddleOffset(self, anchor);
    expect(self).toEqual(selfSnapshot);
    expect(anchor).toEqual(anchorSnapshot);
  });
});

describe('battleClusterKey', () => {
  it('groups nearby stacks (within the same ~70u cell) under one key', () => {
    expect(battleClusterKey(140, 280)).toBe(battleClusterKey(150, 285));
  });

  it('separates stacks in different cells', () => {
    expect(battleClusterKey(0, 0)).not.toBe(battleClusterKey(500, 0));
  });
});
