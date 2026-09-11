import { describe, expect, it, beforeAll } from 'vitest';
import { GameSession } from '../../src/game/game-session';
import { buildScenarioSelection } from '../../src/game/scenario-catalog';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import {
  aiMemory, assess, combatStrength, indexArmies, indexProvinces,
} from '../../src/game/ai/assessment';
import { loadWorld, type LoadedWorld } from './load-world';

/**
 * The stubbed AI tests pin individual decisions; this one drives the real
 * `session.step()` on the real world so the whole loop is exercised against
 * genuine geography.
 *
 * The regression it guards: a small nation whose entire army IS its capital
 * garrison used to freeze forever, because no stack could ever be spared. It
 * must now split a field army off and still leave the capital covered.
 */
const SPAIN = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

describe('AI on a live campaign', () => {
  it('mobilises a field army without uncovering its capital', () => {
    const session = GameSession.create(buildScenarioSelection('OP-1939-01', SPAIN), world);
    const ai = session.enableNearbyAi(SPAIN)!;
    session.declareWar(SPAIN, ai);

    // econ-rebalance: unit costs (funds/food) rose sharply, so a minor's
    // garrison grows more slowly than it used to (food income was raised
    // alongside the costs — see economy.ts — but is still the binding
    // resource). Sparing a field detachment — needing a surplus over
    // `requiredGarrison` — takes materially longer than the old 200-tick
    // (300-hour) window; empirically that first happens around tick 500
    // against this scenario's static neighbour threat, so run well past it.
    for (let i = 0; i < 700; i += 1) session.tick(1.5);

    const situation = assess(
      session, aiMemory(session.state), ai, indexArmies(session.state), indexProvinces(session),
    );
    const capital = situation.capital;
    expect(capital).not.toBeNull();

    // It fielded more than the one stack it started the war sitting on.
    const fighting = situation.armies.filter((army) => combatStrength(army) > 0);
    expect(fighting.length).toBeGreaterThan(1);

    // Some of it is away from home doing something about the war...
    expect(fighting.some((army) => army.graphNodeId !== capital!.node)).toBe(true);

    // ...and the capital is still covered against what is bearing down on it.
    const held = capital!.garrison.reduce((sum, army) => sum + combatStrength(army), 0);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeGreaterThanOrEqual(capital!.threatStrength);
  }, 120_000);
});
