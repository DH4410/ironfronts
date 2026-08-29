/**
 * Deterministic scenario initialisation (§30, §36, §37).
 *
 * Pure: `(selection, scenario, world) -> GameState`. Same inputs always produce
 * the same starting game — starting buildings, armies and stockpiles are seeded
 * from `world` + the scenario id, never random per run.
 *
 * Phase A builds the static starting state. The per-tick systems (movement,
 * extraction, production, combat) live in `game-session.ts` and later phases;
 * this file only lays out turn 0.
 */

import type { ScenarioDef, ScenarioSelection } from './scenario';
import type { WorldData, WorldProvince } from './world-data';
import type {
  CountryState, GameState, ProductionOrder, ProvinceBuildings, ResourceNodeState,
} from './game-state';
import { GAME_STATE_VERSION, emptyStockpile } from './game-state';
import type { ArmyStack, UnitGroup } from './units/army';
import { makeGroup } from './units/army';
import { buildLandGraph, nearestNode, type LandGraph } from './movement/graph';
import { mulberry32, hashString } from './rng';
import { wrappedDistance } from './geometry';

/** Starting stockpile for a campaign player country (§37 step 6). */
const PLAYER_START_STOCKPILE = {
  funds: 2_000, manpower: 1_500, food: 800, stone: 300, metal: 400, oil: 250,
};
const AI_START_STOCKPILE = {
  funds: 1_200, manpower: 1_000, food: 600, stone: 200, metal: 250, oil: 150,
};
const SANDBOX_STOCKPILE = {
  funds: 99_999, manpower: 99_999, food: 99_999, stone: 99_999, metal: 99_999, oil: 99_999,
};

/** Resource-node access snapping tolerance (§20). Beyond this the node is
 *  flagged unreachable (accessNodeId -1) rather than snapped to a far road. */
const ACCESS_SNAP_MAX = 260;

/** Curated starting order of battle for the player's capital region (§36). */
const PLAYER_CAPITAL_ARMY: Array<{ typeId: string; count: number }> = [
  { typeId: 'infantry', count: 4 },
  { typeId: 'engineer', count: 2 },
];
const PLAYER_CITY_ARMY: Array<{ typeId: string; count: number }> = [
  { typeId: 'infantry', count: 2 },
  { typeId: 'armored-car', count: 1 },
];
const AI_CITY_ARMY: Array<{ typeId: string; count: number }> = [
  { typeId: 'infantry', count: 3 },
];

export interface InitResult {
  readonly state: GameState;
  /** Kept out of GameState (rebuilt on load); systems read it from the session. */
  readonly graph: LandGraph;
  /** Diagnostics for the §68 report / tests. */
  readonly diagnostics: {
    readonly playerComponent: number;
    readonly playerProvinces: number;
    readonly playerUrbanProvinces: number;
    readonly reachableResourceNodes: number;
    readonly unreachableResourceNodes: number;
    readonly playerArmies: number;
    readonly totalArmies: number;
    readonly startCamera: { readonly x: number; readonly z: number };
  };
}

function provincesByOwner(world: WorldData): Map<number, WorldProvince[]> {
  const byOwner = new Map<number, WorldProvince[]>();
  for (const province of world.provinces) {
    const owner = world.provinceOwner(province.id);
    if (!owner) continue;
    (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(province);
  }
  return byOwner;
}

function makeCountryState(
  world: WorldData, countryId: number, isPlayer: boolean, sandbox: boolean,
): CountryState {
  const record = world.countries.find((country) => country.id === countryId);
  const stockpile = sandbox
    ? { ...SANDBOX_STOCKPILE }
    : { ...(isPlayer ? PLAYER_START_STOCKPILE : AI_START_STOCKPILE) };
  return {
    id: countryId,
    name: record?.name ?? `Country ${countryId}`,
    color: record?.color ?? '#888888',
    stockpile,
    income: emptyStockpile(),
    industryCapacity: isPlayer ? 10 : 6,
    isPlayer,
  };
}

/** Deterministically choose which urban provinces get which starting building
 *  (§30): capital always gets a barracks + tank plant; the next cities get one
 *  building each, cycling barracks -> ordnance -> barracks so the player has a
 *  real choice about what to expand. */
function assignStartingBuildings(
  cities: WorldProvince[], capitalId: number,
): Map<number, ProvinceBuildings> {
  const out = new Map<number, ProvinceBuildings>();
  const ordered = [...cities].sort((a, b) => b.population - a.population);
  ordered.forEach((province, index) => {
    const buildings: ProvinceBuildings = { barracks: 0, tankPlant: 0, ordnance: 0 };
    if (province.id === capitalId) {
      buildings.barracks = 1;
      buildings.tankPlant = 1;
    } else if (index === 1) {
      buildings.barracks = 1;
    } else if (index === 2) {
      buildings.ordnance = 1;
    } else if (index === 3) {
      buildings.barracks = 1;
    } else {
      return;
    }
    out.set(province.id, buildings);
  });
  return out;
}

function spawnArmy(
  id: string, ownerCountryId: number, name: string, province: WorldProvince,
  graph: LandGraph, component: number,
  composition: Array<{ typeId: string; count: number }>,
): ArmyStack | null {
  const nodeId = nearestNode(
    graph, province.center[0], province.center[1], 400, component,
  );
  if (nodeId < 0) return null;
  const units: UnitGroup[] = composition.map((entry) => makeGroup(entry.typeId, entry.count));
  return {
    id,
    ownerCountryId,
    name,
    x: graph.nodeX[nodeId],
    z: graph.nodeZ[nodeId],
    graphNodeId: nodeId,
    units,
    status: 'idle',
    order: null,
    extractingNodeId: null,
  };
}

export function initGameState(
  selection: ScenarioSelection,
  scenario: ScenarioDef,
  world: WorldData,
): InitResult {
  const sandbox = scenario.mode === 'sandbox';
  const seed = hashString(`${scenario.id}|${selection.playerCountryId}`);
  const random = mulberry32(seed);

  const graph = buildLandGraph(world.connections, world.width, world.height);

  // ---- countries ---------------------------------------------------------
  const byOwner = provincesByOwner(world);
  const countries: Record<number, CountryState> = {};
  for (const countryId of byOwner.keys()) {
    countries[countryId] = makeCountryState(
      world, countryId, countryId === selection.playerCountryId, sandbox,
    );
  }
  if (!countries[selection.playerCountryId]) {
    // Player country has no territory in this world — caller should have
    // validated, but fail loud rather than produce a broken game.
    throw new Error(
      `Player country ${selection.playerCountryId} has no provinces in this world.`,
    );
  }

  // ---- province ownership (dense) --------------------------------------
  const provinceOwners: Record<number, number> = {};
  for (const province of world.provinces) {
    provinceOwners[province.id] = world.provinceOwner(province.id);
  }

  // ---- player component (the reachable mainland for this player) -------
  const playerProvinces = byOwner.get(selection.playerCountryId) ?? [];
  const capital = world.countries.find(
    (country) => country.id === selection.playerCountryId,
  )?.capitalProvinceId ?? playerProvinces[0]?.id ?? -1;
  const capitalProvince = world.provinces.find((province) => province.id === capital)
    ?? playerProvinces[0];
  const componentVotes = new Map<number, number>();
  for (const province of playerProvinces) {
    const node = nearestNode(graph, province.center[0], province.center[1], 400);
    if (node < 0) continue;
    const comp = graph.component[node];
    componentVotes.set(comp, (componentVotes.get(comp) ?? 0) + 1);
  }
  let playerComponent = -1;
  let bestVotes = -1;
  for (const [comp, votes] of componentVotes) {
    if (votes > bestVotes) { bestVotes = votes; playerComponent = comp; }
  }

  // ---- starting buildings (player + a few AI, urban only) -------------
  const provinceBuildings: Record<number, ProvinceBuildings> = {};
  const playerCities = playerProvinces.filter((province) => province.urban);
  for (const [provinceId, buildings] of assignStartingBuildings(playerCities, capital)) {
    provinceBuildings[provinceId] = buildings;
  }
  for (const [ownerId, provinces] of byOwner) {
    if (ownerId === selection.playerCountryId) continue;
    const cities = provinces.filter((province) => province.urban)
      .sort((a, b) => b.population - a.population);
    if (cities[0]) provinceBuildings[cities[0].id] = { barracks: 1, tankPlant: 0, ordnance: 0 };
  }

  // ---- resource nodes: access-node snapping + initial control --------
  const resourceNodes: Record<number, ResourceNodeState> = {};
  let reachable = 0;
  let unreachable = 0;
  for (const node of world.resourceNodes) {
    const accessNodeId = nearestNode(graph, node.x, node.z, ACCESS_SNAP_MAX);
    if (accessNodeId >= 0) reachable += 1; else unreachable += 1;
    const provinceId = nearestProvinceId(world, node.x, node.z);
    resourceNodes[node.id] = {
      id: node.id,
      kind: node.kind,
      x: node.x,
      z: node.z,
      remaining: node.amount,
      initialAmount: node.amount,
      controllerCountryId: provinceId >= 0 ? (provinceOwners[provinceId] ?? 0) : 0,
      accessNodeId,
      extractorArmyId: null,
      status: 'idle',
    };
  }

  // ---- starting armies (§36) ----------------------------------------
  const armies: Record<string, ArmyStack> = {};
  let nextArmyId = 1;
  let playerArmies = 0;
  const addArmy = (
    ownerId: number, name: string, province: WorldProvince, component: number,
    composition: Array<{ typeId: string; count: number }>,
  ): void => {
    const army = spawnArmy(
      `army-${nextArmyId}`, ownerId, name, province, graph, component, composition,
    );
    if (!army) return;
    armies[army.id] = army;
    nextArmyId += 1;
    if (ownerId === selection.playerCountryId) playerArmies += 1;
  };

  if (capitalProvince) {
    addArmy(selection.playerCountryId, '1st Army', capitalProvince, playerComponent, PLAYER_CAPITAL_ARMY);
  }
  const playerCityTargets = [...playerCities]
    .filter((province) => province.id !== capital)
    .sort((a, b) => b.population - a.population)
    .slice(0, 3);
  playerCityTargets.forEach((province, index) => {
    addArmy(
      selection.playerCountryId, `${index + 2}${ordinalSuffix(index + 2)} Army`,
      province, playerComponent, PLAYER_CITY_ARMY,
    );
  });

  if (!sandbox) {
    for (const [ownerId, provinces] of byOwner) {
      if (ownerId === selection.playerCountryId) continue;
      const cities = provinces.filter((province) => province.urban)
        .sort((a, b) => b.population - a.population)
        .slice(0, 2);
      const ownerComponent = cities[0]
        ? graph.component[nearestNode(graph, cities[0].center[0], cities[0].center[1], 400)] ?? -1
        : -1;
      cities.forEach((province, index) => {
        addArmy(ownerId, `${province.id} Garrison`, province, ownerComponent,
          index === 0 ? AI_CITY_ARMY : [{ typeId: 'infantry', count: 2 }]);
      });
    }
  }
  void random; // reserved for future jitter in OOB placement

  const productionQueues: Record<number, ProductionOrder[]> = {};

  const state: GameState = {
    version: GAME_STATE_VERSION,
    seed,
    scenarioId: scenario.id,
    mode: scenario.mode,
    playerCountryId: selection.playerCountryId,
    fogOfWar: scenario.fogOfWar && !sandbox,
    economyEnabled: scenario.economyEnabled && !sandbox,
    clock: { gameTimeHours: 0, startDate: selection.startDate },
    countries,
    provinceOwners,
    provinceBuildings,
    productionQueues,
    armies,
    resourceNodes,
    relations: {},
    nextArmyId,
    nextOrderId: 1,
    nextEventId: 1,
  };

  const startCamera = capitalProvince
    ? { x: capitalProvince.center[0], z: capitalProvince.center[1] }
    : { x: world.width / 2, z: world.height / 2 };

  return {
    state,
    graph,
    diagnostics: {
      playerComponent,
      playerProvinces: playerProvinces.length,
      playerUrbanProvinces: playerCities.length,
      reachableResourceNodes: reachable,
      unreachableResourceNodes: unreachable,
      playerArmies,
      totalArmies: Object.keys(armies).length,
      startCamera,
    },
  };
}

function nearestProvinceId(world: WorldData, x: number, z: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (const province of world.provinces) {
    const dist = wrappedDistance(x, z, province.center[0], province.center[1], world.width);
    if (dist < bestDist) { bestDist = dist; best = province.id; }
  }
  return best;
}

function ordinalSuffix(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (value % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
