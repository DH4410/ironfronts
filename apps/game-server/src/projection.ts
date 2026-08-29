import {
  computeArmyVisibility, projectArmyView, visibleResourceNodes,
  type GameState, type WorldData,
} from '@ironfronts/game-core';
import type { PlayerProjection, ProjectionDelta, PublicCountry } from '@ironfronts/protocol';

export function projectFor(state: GameState, world: WorldData, viewerCountryId: number): PlayerProjection {
  const countries: Record<number, PublicCountry> = {};
  for (const country of Object.values(state.countries)) {
    countries[country.id] = {
      id: country.id,
      name: country.name,
      color: country.color,
      controller: country.controller,
      alive: Object.values(state.provinceOwners).some((owner) => owner === country.id),
    };
  }
  const ownProvince = (id: string): boolean => state.provinceOwners[Number(id)] === viewerCountryId;
  const privateMap = <T>(source: Record<number, T>): Record<number, T> => Object.fromEntries(
    Object.entries(source).filter(([id]) => ownProvince(id)),
  ) as Record<number, T>;
  const visibility = computeArmyVisibility(state, world, viewerCountryId);
  const armies = Object.fromEntries(Object.keys(state.armies).flatMap((armyId) => {
    const army = projectArmyView(state, world, viewerCountryId, armyId, visibility);
    return army ? [[army.id, army]] : [];
  }));
  const resourceNodes = Object.fromEntries(
    visibleResourceNodes(state, world, viewerCountryId).map((node) => [node.id, node]),
  );
  const own = state.countries[viewerCountryId];
  const owned = world.provinces.filter((province) => state.provinceOwners[province.id] === viewerCountryId);
  const capitalId = world.countries.find((country) => country.id === viewerCountryId)?.capitalProvinceId;
  const capital = world.provinces.find((province) => province.id === capitalId) ?? owned[0];
  return {
    gameTimeHours: state.clock.gameTimeHours,
    viewerCountryId,
    startCamera: capital
      ? { x: capital.center[0], z: capital.center[1], distance: Math.min(3_200, Math.max(900, Math.sqrt(owned.length) * 180)) }
      : { x: world.width / 2, z: world.height / 2, distance: 3_000 },
    countries,
    provinceOwners: { ...state.provinceOwners },
    provinceBuildings: privateMap(state.provinceBuildings),
    productionQueues: privateMap(state.productionQueues),
    constructionQueues: privateMap(state.constructionQueues),
    rallyPoints: privateMap(state.rallyPoints),
    armies,
    resourceNodes,
    ownCountry: own ? {
      id: own.id, name: own.name, color: own.color, controller: own.controller,
      stockpile: { ...own.stockpile }, income: { ...own.income }, industryCapacity: own.industryCapacity,
    } : null,
    relations: { ...state.relations },
  };
}

const COLLECTIONS = [
  'countries', 'provinceOwners', 'provinceBuildings', 'productionQueues',
  'constructionQueues', 'rallyPoints', 'armies', 'resourceNodes', 'relations',
] as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffProjection(previous: PlayerProjection, next: PlayerProjection): ProjectionDelta | null {
  const delta: ProjectionDelta = { changed: {}, upserts: {}, removals: {}, redactions: [] };
  if (previous.gameTimeHours !== next.gameTimeHours) delta.changed.gameTimeHours = next.gameTimeHours;
  if (!same(previous.ownCountry, next.ownCountry)) delta.changed.ownCountry = next.ownCountry;
  for (const key of COLLECTIONS) {
    const before = previous[key] as Record<string, unknown>;
    const after = next[key] as Record<string, unknown>;
    const upserts: Record<string, unknown> = {};
    const removals: string[] = [];
    for (const [id, value] of Object.entries(after)) {
      if (!(id in before) || !same(before[id], value)) upserts[id] = value;
    }
    for (const id of Object.keys(before)) {
      if (!(id in after)) {
        removals.push(id);
        if (key === 'armies' || key === 'resourceNodes') delta.redactions.push(`${key}.${id}`);
      }
    }
    if (Object.keys(upserts).length) delta.upserts[key] = upserts;
    if (removals.length) delta.removals[key] = removals;
  }
  return Object.keys(delta.changed).length || Object.keys(delta.upserts).length || Object.keys(delta.removals).length
    ? delta : null;
}
