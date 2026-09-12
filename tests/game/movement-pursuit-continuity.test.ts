import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { issueMoveOrder } from '../../src/game/movement/orders';
import { stepMovement } from '../../src/game/units/movement';
import { stackBaseSpeed } from '../../src/game/units/army';
import { STRATEGIC_MOVEMENT_SCALE, ROAD_BONUS } from '../../src/game/movement/speed';
import { wrappedDistance } from '../../src/game/geometry';

/**
 * Reproduces the handoff's "attack orders repeatedly repath, causing
 * stop-start movement" concern directly against the authoritative simulation
 * (not the client interpolator, which was investigated separately and found
 * to already handle ordinary repaths smoothly). If pursuit repathing ever let
 * the chaser's own x/z teleport beyond what one tick's speed budget allows,
 * that would be a real, simulation-level stutter source worth fixing. If it
 * never does — as these assertions confirm — the chaser's motion is
 * physically continuous even under constant target relocation, and any
 * visible stutter is a client-side rendering/timing concern, not a logic bug
 * here.
 */
describe('pursuit repathing does not teleport the chasing army', () => {
  it('stays within one tick\'s speed budget even when the target relocates every tick', () => {
    const ctx = fixture();
    ctx.state.armies = {
      chaser: army('chaser', 1, 100, 100, 0, 'infantry', 3),
      target: army('target', 2, 500, 100, 3, 'infantry', 3),
    };
    const dtHours = 0.1;
    const maxBudget = stackBaseSpeed(ctx.state.armies.chaser) * dtHours
      * STRATEGIC_MOVEMENT_SCALE * ROAD_BONUS * 1.05; // small slack for rounding

    const result = issueMoveOrder(
      ctx, 'chaser', 500, 100, 'attack',
      { kind: 'army', armyId: 'target', lastKnownX: 500, lastKnownZ: 100 },
    );
    expect(result.ok).toBe(true);

    // Bounce the "visible" target between two distant nodes every tick, the
    // worst case for forcing a fresh full repath (pursuitChanged) as often as
    // physically possible.
    const bounceNodes: Array<[number, number]> = [[100, 300], [500, 100]];
    let previous = { x: ctx.state.armies.chaser.x, z: ctx.state.armies.chaser.z };
    for (let tick = 0; tick < 40; tick += 1) {
      const [tx, tz] = bounceNodes[tick % bounceNodes.length];
      ctx.state.armies.target.x = tx;
      ctx.state.armies.target.z = tz;
      ctx.state.armies.target.graphNodeId = tx === 100 ? 2 : 3;
      stepMovement(ctx, dtHours);
      const chaser = ctx.state.armies.chaser;
      if (!chaser) break; // arrived/merged — fine, just stop checking
      const moved = wrappedDistance(previous.x, previous.z, chaser.x, chaser.z, ctx.world.width);
      expect(moved).toBeLessThanOrEqual(maxBudget);
      previous = { x: chaser.x, z: chaser.z };
    }
  });
});
