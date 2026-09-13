/** Data-driven military construction and renewable-resource development. */
import type { SimContext } from './sim-context';
import type { ConstructionOrder, ProvinceBuildings, ResourceBuildingId, Stockpile } from './game-state';
import type { BuildingId, MilitaryBuildingId } from './units/unit-types';
import { BUILDING_REQUIRED_PHASE } from './phase';
import { RESOURCE_FOR_BUILDING, maximumResourceTier } from './economy/resources';

interface TierRecipe { readonly cost: Partial<Stockpile>; readonly work: number }
interface BuildingDef {
  readonly label: string;
  readonly kind: 'military' | 'resource';
  readonly tiers: readonly TierRecipe[];
  /** Tier-I aliases retained for existing presentation consumers. */
  readonly cost: Partial<Stockpile>;
  readonly buildWork: number;
  readonly buildTimeHours: number;
}
const definition = (label: string, kind: BuildingDef['kind'], tiers: readonly TierRecipe[]): BuildingDef => ({
  label, kind, tiers, cost: tiers[0].cost, buildWork: tiers[0].work, buildTimeHours: tiers[0].work,
});

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  barracks: definition('Barracks', 'military', [{ work: 4, cost: { funds: 700, stone: 180 } }]),
  tankPlant: definition('Tank Plant', 'military', [{ work: 12, cost: { funds: 2200, stone: 400, metal: 300 } }]),
  ordnance: definition('Ordnance Workshop', 'military', [{ work: 12, cost: { funds: 2500, stone: 450, metal: 350 } }]),
  missileSite: definition('Missile Site', 'military', [{ work: 27, cost: { funds: 5000, stone: 900, metal: 900 } }]),
  fields: definition('Fields', 'resource', [
    { work: 4, cost: { funds: 350, stone: 100 } }, { work: 8, cost: { funds: 750, stone: 180 } },
    { work: 12, cost: { funds: 1600, stone: 300 } },
  ]),
  quarry: definition('Quarry', 'resource', [
    { work: 4, cost: { funds: 400, stone: 120 } }, { work: 8, cost: { funds: 850, stone: 220 } },
    { work: 12, cost: { funds: 1800, stone: 400 } },
  ]),
  mine: definition('Mine', 'resource', [
    { work: 4, cost: { funds: 500, stone: 130, metal: 40 } }, { work: 8, cost: { funds: 1050, stone: 250, metal: 100 } },
    { work: 12, cost: { funds: 2200, stone: 450, metal: 220 } },
  ]),
  oilPump: definition('Oil Pump', 'resource', [
    { work: 4, cost: { funds: 600, stone: 140, metal: 60 } }, { work: 8, cost: { funds: 1250, stone: 280, metal: 140 } },
    { work: 12, cost: { funds: 2600, stone: 500, metal: 300 } },
  ]),
};

const EMPTY_BUILDINGS: ProvinceBuildings = { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 0 };
export interface BuildResult { readonly ok: boolean; readonly reason?: string; readonly orderId?: string }
export interface BuildOption { readonly id: BuildingId; readonly affordable: boolean; readonly targetTier: number; readonly reason?: string }

function isUrban(ctx: SimContext, provinceId: number): boolean {
  return ctx.world.provinces.find((province) => province.id === provinceId)?.urban ?? false;
}
function affordable(stockpile: Stockpile, cost: Partial<Stockpile>): boolean {
  return Object.entries(cost).every(([key, value]) => stockpile[key as keyof Stockpile] >= (value ?? 0));
}
function currentTier(ctx: SimContext, provinceId: number, buildingId: BuildingId): number {
  return BUILDINGS[buildingId].kind === 'military'
    ? (ctx.state.provinceBuildings[provinceId] ?? EMPTY_BUILDINGS)[buildingId as MilitaryBuildingId]
    : (ctx.state.provinceEconomies?.[provinceId]?.resourceBuildings[buildingId as ResourceBuildingId] ?? 0);
}
function nextTier(ctx: SimContext, provinceId: number, buildingId: BuildingId): number {
  const queued = (ctx.state.constructionQueues[provinceId] ?? [])
    .filter((order) => order.buildingId === buildingId)
    .reduce((max, order) => Math.max(max, order.targetTier ?? 1), 0);
  return Math.max(currentTier(ctx, provinceId, buildingId), queued) + 1;
}
function eligibility(ctx: SimContext, provinceId: number, buildingId: BuildingId, countryId: number): BuildOption {
  const def = BUILDINGS[buildingId];
  const targetTier = nextTier(ctx, provinceId, buildingId);
  if (ctx.state.provinceOwners[provinceId] !== countryId) return { id: buildingId, targetTier, affordable: false, reason: 'Not your province.' };
  const urban = isUrban(ctx, provinceId);
  if (def.kind === 'military') {
    if (!urban) return { id: buildingId, targetTier, affordable: false, reason: 'Military buildings require an urban province.' };
    if (targetTier > 1) return { id: buildingId, targetTier, affordable: false, reason: 'Already built or queued.' };
    const required = BUILDING_REQUIRED_PHASE[buildingId as MilitaryBuildingId];
    if ((ctx.state.countries[countryId]?.phase ?? 1) < required) return { id: buildingId, targetTier, affordable: false, reason: `Requires phase ${required}.` };
  } else {
    if (urban) return { id: buildingId, targetTier, affordable: false, reason: 'Resource buildings require a rural province.' };
    const record = ctx.state.provinceEconomies?.[provinceId];
    if (!record) return { id: buildingId, targetTier, affordable: false, reason: 'Province economy unavailable.' };
    const resource = RESOURCE_FOR_BUILDING[buildingId as ResourceBuildingId];
    const maxTier = maximumResourceTier(buildingId as ResourceBuildingId, record.resourcePotential[resource]);
    if (targetTier > maxTier) return { id: buildingId, targetTier, affordable: false, reason: `Potential supports Tier ${maxTier}.` };
  }
  const recipe = def.tiers[targetTier - 1];
  const country = ctx.state.countries[countryId];
  const canPay = Boolean(recipe && country && affordable(country.stockpile, recipe.cost));
  return { id: buildingId, targetTier, affordable: canPay, ...(!canPay ? { reason: 'Insufficient resources.' } : {}) };
}

export function buildOptions(ctx: SimContext, provinceId: number, countryId: number): BuildOption[] {
  if (ctx.state.provinceOwners[provinceId] !== countryId) return [];
  return (Object.keys(BUILDINGS) as BuildingId[]).map((id) => eligibility(ctx, provinceId, id, countryId));
}
export function buildableBuildings(ctx: SimContext, provinceId: number, countryId: number): BuildingId[] {
  return buildOptions(ctx, provinceId, countryId).filter((option) => option.affordable && !option.reason).map((option) => option.id);
}
export function costLabel(building: BuildingId, tier = 1): string {
  return Object.entries(BUILDINGS[building].tiers[tier - 1]?.cost ?? {}).map(([key, value]) => `${value} ${key}`).join(' · ');
}

export function queueBuilding(ctx: SimContext, provinceId: number, buildingId: BuildingId, countryId: number): BuildResult {
  const option = eligibility(ctx, provinceId, buildingId, countryId);
  if (option.reason) return { ok: false, reason: option.reason };
  const recipe = BUILDINGS[buildingId].tiers[option.targetTier - 1];
  const country = ctx.state.countries[countryId]!;
  for (const [key, amount] of Object.entries(recipe.cost)) country.stockpile[key as keyof Stockpile] -= amount ?? 0;
  const order: ConstructionOrder = {
    id: `bld-${ctx.state.nextOrderId++}`, buildingId, ownerCountryId: countryId,
    targetTier: option.targetTier, progressWork: 0, totalWork: recipe.work,
    progressHours: 0, totalHours: recipe.work,
  };
  (ctx.state.constructionQueues[provinceId] ??= []).push(order);
  return { ok: true, orderId: order.id };
}

export interface BuildingCompletion { readonly ownerCountryId: number; readonly provinceId: number; readonly buildingId: BuildingId; readonly targetTier?: number }
export function stepConstruction(ctx: SimContext, dtHours: number): BuildingCompletion[] {
  const done: BuildingCompletion[] = [];
  for (const [rawId, queue] of Object.entries(ctx.state.constructionQueues)) {
    const provinceId = Number(rawId);
    while (queue.length && ctx.state.provinceOwners[provinceId] !== queue[0].ownerCountryId) queue.shift();
    let capacity = dtHours * (ctx.state.provinceEconomies?.[provinceId]?.constructionCapacity ?? 1);
    while (queue.length && capacity > 1e-12) {
      const active = queue[0];
      const total = active.totalWork ?? active.totalHours ?? 1;
      const progress = active.progressWork ?? active.progressHours ?? 0;
      const used = Math.min(capacity, Math.max(0, total - progress));
      active.progressWork = progress + used; active.progressHours = active.progressWork; capacity -= used;
      if (active.progressWork + 1e-12 < total) break;
      queue.shift();
      const def = BUILDINGS[active.buildingId as BuildingId];
      if (def.kind === 'military') {
        const buildings = (ctx.state.provinceBuildings[provinceId] ??= { ...EMPTY_BUILDINGS });
        buildings[active.buildingId as MilitaryBuildingId] = 1;
      } else {
        const tiers = ctx.state.provinceEconomies?.[provinceId]?.resourceBuildings;
        if (tiers) tiers[active.buildingId as ResourceBuildingId] = active.targetTier ?? 1;
      }
      done.push({ provinceId, buildingId: active.buildingId as BuildingId, ownerCountryId: active.ownerCountryId,
        ...(def.kind === 'resource' ? { targetTier: active.targetTier } : {}) });
    }
    if (!queue.length) delete ctx.state.constructionQueues[provinceId];
  }
  return done;
}
