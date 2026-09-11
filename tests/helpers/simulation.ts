import { buildLandGraph } from '../../src/game/movement/graph';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';
import { emptyStockpile, GAME_STATE_VERSION } from '../../src/game/game-state';
import { INITIAL_GAME_EPOCH_MS } from '../../src/game/time';
import type { SimContext } from '../../src/game/sim-context';

export function army(id = 'a', ownerCountryId = 1, x = 100, z = 100, graphNodeId = 0, type = 'infantry', count = 3): ArmyStack {
  return { id, ownerCountryId, name:id, x,z,graphNodeId,units:[makeGroup(type,count)],status:'idle',order:null,extractingNodeId:null };
}
export function fixture(): SimContext {
  const connections = new Float32Array([100,100,300,100,1,0,0,0, 100,100,100,300,1,0,0,0, 300,100,500,100,1,0,0,0]);
  const graph = buildLandGraph(connections,2000,1000);
  return {
    graph,
    world: { width:2000,height:1000,provinces:[[10,100,100],[11,300,100],[12,100,300],[13,500,100]].map(([id,x,z]) => ({id,center:[x,z],urban:true,terrainId:0,population:1000,coastal:false})),
      countries:[1,2,3].map(id=>({id,name:String(id),color:'#fff',capitalProvinceId:10})),
      provinceOwner:()=>1,provinceAt:()=>10,terrainClassAt:()=>0,connections,resourceNodes:[] },
    state: { version:GAME_STATE_VERSION,seed:1,scenarioId:'OP-1939-01',mode:'campaign',fogOfWar:false,economyEnabled:false,
      clock:{gameTimeHours:0,startDate:'1 Sep 1939',initialEpochMs:INITIAL_GAME_EPOCH_MS,generation:0},simulationTick:1,
      countries:Object.fromEntries([1,2,3].map(id=>[id,{id,name:String(id),color:'#fff',controller:'player',stockpile:emptyStockpile(),income:emptyStockpile(),industryCapacity:1}])),
      provinceOwners:{10:1,11:1,12:1,13:1},provinceBuildings:{10:{barracks:1,tankPlant:0,ordnance:0,missileSite:0}},
      productionQueues:{},constructionQueues:{},rallyPoints:{},armies:{},resourceNodes:{},relations:{},battles:{},battleFronts:{},
      nextArmyId:10,nextBattleId:1,nextFrontId:1,nextOrderId:1,nextEventId:1 },
  };
}
