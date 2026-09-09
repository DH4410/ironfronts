/**
 * Simple defensive AI v1 ("IMPORTANT AI RULE").
 *
 * AI-controlled countries go through the SAME `applyCommand` boundary the player
 * does (with their own countryId) — never direct state edits.
 * v1 goals: keep producing cheap infantry, work owned resource nodes, garrison
 * cities, hit an obviously weaker adjacent enemy stack, and — once it has troops
 * to spare — march one column at an enemy capital so wars actually threaten the
 * player. Nothing clever.
 */

import type { SimContext } from '../sim-context';
import { applyCommand } from '../commands';
import { producibleUnits } from '../production';
import { canExtract, stackUnitCount } from '../units/army';
import { relationOf } from '../game-state';
import { wrappedDistance } from '../geometry';

export function stepAi(session: SimContext, _dtHours: number): void {
  const state = session.state;
  const aiCountries = Object.values(state.countries).filter((c) => c.controller === 'ai');
  if (aiCountries.length === 0) return;

  for (const country of aiCountries) {
    const armies = Object.values(state.armies).filter((a) => a.ownerCountryId === country.id);
    const ownProvinces = Object.entries(state.provinceOwners)
      .filter(([, owner]) => owner === country.id)
      .map(([id]) => Number(id));

    // 1. Produce a cheap defender if we can afford it and a barracks exists.
    for (const provinceId of ownProvinces) {
      if (!producibleUnits(session, provinceId, country.id).includes('infantry')) continue;
      const queued = state.productionQueues[provinceId]?.length ?? 0;
      if (queued >= 2) continue;
      if (country.stockpile.manpower > 120 && country.stockpile.funds > 80) {
        applyCommand(session, {
          type: 'produce', countryId: country.id, provinceId, unitTypeId: 'infantry',
        });
      }
      break; // one order per pass keeps it slow
    }

    // 2. Idle stacks with miners: work the nearest controlled deposit.
    for (const army of armies) {
      if (army.order || army.status === 'engaged' || army.extractingNodeId !== null) continue;
      if (!canExtract(army)) continue;
      const node = Object.values(state.resourceNodes).find(
        (n) => n.controllerCountryId === country.id && n.remaining > 0 && n.accessNodeId >= 0
          && n.status !== 'extracting',
      );
      if (!node) continue;
      if (army.graphNodeId === node.accessNodeId) {
        applyCommand(session, { type: 'extract', countryId: country.id, armyId: army.id });
      } else {
        applyCommand(session, {
          type: 'moveArmy', countryId: country.id, armyId: army.id, x: node.x, z: node.z,
        });
      }
      break;
    }

    // 3. If at war and a distinctly weaker enemy stack sits on our doorstep,
    //    send our strongest idle stack to hit it. Otherwise hold.
    const atWar = Object.values(state.countries).some(
      (o) => o.id !== country.id && relationOf(state, country.id, o.id) === 'war',
    );
    if (!atWar) continue;
    const strongest = armies
      .filter((a) => !a.order && a.status !== 'engaged' && a.extractingNodeId === null)
      .sort((a, b) => stackUnitCount(b) - stackUnitCount(a))[0];
    if (!strongest) continue;
    const myStrength = stackUnitCount(strongest);
    const target = Object.values(state.armies)
      .filter((e) => relationOf(state, e.ownerCountryId, country.id) === 'war')
      .filter((e) => stackUnitCount(e) * 1.4 < myStrength)
      .map((e) => ({ e, d: wrappedDistance(strongest.x, strongest.z, e.x, e.z, session.world.width) }))
      .filter((x) => x.d < 900)
      .sort((a, b) => a.d - b.d)[0];
    if (target) {
      applyCommand(session, {
        type: 'attackArmy', countryId: country.id, armyId: strongest.id,
        target: { kind: 'army', armyId: target.e.id },
      });
      continue;
    }

    // 4. Offensive push. Only once the country can spare a column (>= 3 stacks,
    //    so two stay home) send its strongest idle stack at the nearest hostile
    //    province, preferring an enemy capital. attackArmy on a province is a
    //    standing order, so this fires once per free stack, not every pass.
    if (armies.length < 3) continue;
    const spearhead = armies
      .filter((a) => !a.order && a.status !== 'engaged' && a.extractingNodeId === null)
      .sort((a, b) => stackUnitCount(b) - stackUnitCount(a))[0];
    if (!spearhead || stackUnitCount(spearhead) < 4) continue;

    const enemyIds = new Set(
      Object.values(state.countries)
        .filter((o) => o.id !== country.id && relationOf(state, country.id, o.id) === 'war')
        .map((o) => o.id),
    );
    const enemyCapitals = new Set(
      [...enemyIds]
        .map((id) => session.world.countries.find((c) => c.id === id)?.capitalProvinceId)
        .filter((id): id is number => id !== undefined),
    );
    const objective = session.world.provinces
      .filter((p) => enemyIds.has(state.provinceOwners[p.id] ?? 0))
      .map((p) => ({
        p,
        d: wrappedDistance(spearhead.x, spearhead.z, p.center[0], p.center[1], session.world.width)
          * (enemyCapitals.has(p.id) ? 0.6 : 1),
      }))
      .sort((a, b) => a.d - b.d)[0];
    if (objective) {
      applyCommand(session, {
        type: 'attackArmy', countryId: country.id, armyId: spearhead.id,
        target: {
          kind: 'province', provinceId: objective.p.id,
          x: objective.p.center[0], z: objective.p.center[1],
        },
      });
    }
  }
}
