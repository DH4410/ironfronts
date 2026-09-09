/** Strategic strike: a one-shot, war-triggering province wipe. */

import type { SimContext } from './sim-context';
import { destroyArmy } from './combat';
import { relationOf, setRelation } from './game-state';
import { wrappedDistance } from './geometry';
import type { CommandResult, StrikeCommand } from './commands/types';

/**
 * Game-hours to accrue one warhead per Ordnance Workshop level a country holds.
 * ~18 game-days at level 1 — deliberately rare; two workshops halve the wait.
 */
const HOURS_PER_WARHEAD = 18 * 24;
/** Hard cap on stockpiled warheads so a runaway leader cannot hoard. */
const MAX_WARHEADS = 3;
/**
 * World-space blast radius for stack destruction around the impact point.
 * Median province max-span is ~120 units, so this covers a typical province
 * from its centre while bounding the handful of very large provinces.
 */
const BLAST_RADIUS = 95;
/**
 * Game-hours a struck province stays devastated. During this window its
 * administration is too shattered to contest a capture, so a weak city really
 * does fall the moment a stack walks in after the strike. ~6 game-days.
 */
const DEVASTATION_HOURS = 6 * 24;
/**
 * World-space reach of a Missile Site. A strike must land within this distance
 * of one of the launching country's own Missile Sites — the CoW-style "build
 * the launcher where you want coverage" constraint. World width is ~13.5k, so
 * one well-placed site covers a large theatre without being global.
 */
const MISSILE_RANGE = 3200;

/** Passive warhead accrual — one slow pass per tick, driven by Missile Sites
 *  and (at the same rate) legacy Ordnance Workshops. */
export function stepWarheads(ctx: SimContext, dtHours: number): void {
  if (dtHours <= 0) return;
  // Drop devastation entries whose window has passed so the save stays sparse.
  const devastation = ctx.state.provinceDevastation;
  if (devastation) {
    const nowHours = ctx.state.clock.gameTimeHours;
    for (const key of Object.keys(devastation)) {
      if (devastation[Number(key)] <= nowHours) delete devastation[Number(key)];
    }
  }
  const levelsByCountry = new Map<number, number>();
  for (const [provinceIdRaw, buildings] of Object.entries(ctx.state.provinceBuildings)) {
    const levels = (buildings.ordnance ?? 0) + (buildings.missileSite ?? 0);
    if (!levels) continue;
    const owner = ctx.state.provinceOwners[Number(provinceIdRaw)];
    if (!owner) continue;
    levelsByCountry.set(owner, (levelsByCountry.get(owner) ?? 0) + levels);
  }
  for (const [countryId, levels] of levelsByCountry) {
    const country = ctx.state.countries[countryId];
    if (!country) continue;
    const gained = (levels * dtHours) / HOURS_PER_WARHEAD;
    country.warheads = Math.min(MAX_WARHEADS, (country.warheads ?? 0) + gained);
  }
}

export function issueStrike(ctx: SimContext, command: StrikeCommand): CommandResult {
  const { countryId, provinceId, x, z } = command;
  const country = ctx.state.countries[countryId];
  if (!country) return { ok: false, reason: 'Unknown country.' };
  if ((country.warheads ?? 0) < 1) return { ok: false, reason: 'No warhead is ready.' };

  const province = ctx.world.provinces.find((item) => item.id === provinceId);
  if (!province) return { ok: false, reason: 'No such province.' };
  if (ctx.world.provinceAt(x, z) !== provinceId) {
    return { ok: false, reason: 'Aim point is outside that province.' };
  }
  const owner = ctx.state.provinceOwners[provinceId] ?? 0;
  if (owner === countryId) return { ok: false, reason: 'That is your own province.' };

  // The aim point must sit within reach of one of the country's Missile Sites.
  const sites: Array<readonly [number, number]> = [];
  for (const [siteProvinceRaw, buildings] of Object.entries(ctx.state.provinceBuildings)) {
    if (!buildings.missileSite) continue;
    if (ctx.state.provinceOwners[Number(siteProvinceRaw)] !== countryId) continue;
    const p = ctx.world.provinces.find((q) => q.id === Number(siteProvinceRaw));
    if (p) sites.push([p.center[0], p.center[1]]);
  }
  if (sites.length === 0) {
    return { ok: false, reason: 'Build a Missile Site to launch strikes.' };
  }
  const inRange = sites.some(
    ([sx, sz]) => wrappedDistance(sx, sz, x, z, ctx.world.width) <= MISSILE_RANGE,
  );
  if (!inRange) return { ok: false, reason: 'Target is beyond Missile Site range.' };

  country.warheads = (country.warheads ?? 0) - 1;

  // A strike is an act of war; the target may already be hostile.
  if (owner && relationOf(ctx.state, countryId, owner) !== 'war') {
    setRelation(ctx.state, countryId, owner, 'war');
  }

  // Every stack within the blast radius is gone, regardless of owner.
  for (const army of Object.values(ctx.state.armies)) {
    if (wrappedDistance(army.x, army.z, x, z, ctx.world.width) <= BLAST_RADIUS) {
      destroyArmy(ctx, army.id);
    }
  }

  // The province's industry is levelled — one tier off every building it holds.
  const buildings = ctx.state.provinceBuildings[provinceId];
  if (buildings) {
    buildings.barracks = Math.max(0, buildings.barracks - 1);
    buildings.tankPlant = Math.max(0, buildings.tankPlant - 1);
    buildings.ordnance = Math.max(0, buildings.ordnance - 1);
  }
  delete ctx.state.constructionQueues[provinceId];
  delete ctx.state.productionQueues[provinceId];

  // Shatter the province's ability to resist for a while — see stepCapture.
  (ctx.state.provinceDevastation ??= {})[provinceId] =
    ctx.state.clock.gameTimeHours + DEVASTATION_HOURS;

  return { ok: true, strike: { attacker: countryId, defender: owner, provinceId, x, z } };
}
