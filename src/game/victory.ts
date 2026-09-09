/** Campaign win / loss evaluation — conquest of capitals. */

import type { GameOutcome } from './game-state';
import type { SimContext } from './sim-context';

function playerCountryId(ctx: SimContext): number | null {
  const player = Object.values(ctx.state.countries).find((c) => c.controller === 'player');
  return player?.id ?? null;
}

function capitalOf(ctx: SimContext, countryId: number): number | null {
  return ctx.world.countries.find((c) => c.id === countryId)?.capitalProvinceId ?? null;
}

function ownsAnyProvince(ctx: SimContext, countryId: number): boolean {
  return Object.values(ctx.state.provinceOwners).some((owner) => owner === countryId);
}

function holdsOwnCapital(ctx: SimContext, countryId: number): boolean {
  const capital = capitalOf(ctx, countryId);
  // A country with no defined capital can only be beaten by total conquest.
  return capital === null || ctx.state.provinceOwners[capital] === countryId;
}

/**
 * Decide the campaign, once. Returns the freshly-set outcome on the tick it is
 * decided, otherwise `null`. Idempotent — a set `state.outcome` is never
 * overwritten.
 *
 * Defeat: the player has lost their capital, or holds no territory at all.
 * Victory: the player still stands and every country they are at war with has
 * lost its capital or been wiped out. (With no wars there is nothing to win.)
 */
export function stepVictory(ctx: SimContext): GameOutcome | null {
  if (ctx.state.outcome) return null;
  const player = playerCountryId(ctx);
  if (player === null) return null;

  const playerAlive = ownsAnyProvince(ctx, player);
  if (!playerAlive) return finish(ctx, 'defeat', 'Your nation has been overrun.');
  if (!holdsOwnCapital(ctx, player)) return finish(ctx, 'defeat', 'Your capital has fallen.');

  const hostiles = new Set<number>();
  for (const [key, relation] of Object.entries(ctx.state.relations)) {
    if (relation !== 'war') continue;
    const [a, b] = key.split(':').map(Number);
    if (a === player) hostiles.add(b);
    else if (b === player) hostiles.add(a);
  }
  if (hostiles.size === 0) return null;

  for (const hostile of hostiles) {
    if (ownsAnyProvince(ctx, hostile) && holdsOwnCapital(ctx, hostile)) return null;
  }
  return finish(ctx, 'victory', 'Every hostile capital has fallen.');
}

function finish(ctx: SimContext, result: 'victory' | 'defeat', reason: string): GameOutcome {
  const outcome: GameOutcome = { result, reason, atGameHours: ctx.state.clock.gameTimeHours };
  ctx.state.outcome = outcome;
  return outcome;
}
