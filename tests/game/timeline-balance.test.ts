import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { setRelation } from '../../src/game/game-state';
import { stepCombat } from '../../src/game/combat';
import { SimulationScheduler } from '../../apps/game-server/src/scheduler';
function duration(a:number,b:number,seconds=1): number {
  const ctx=fixture(); ctx.state.armies={a:army('a',1,100,100,0,'infantry',a), b:army('b',2,100,100,0,'infantry',b)};
  ctx.state.provinceOwners={10:1,11:0,12:0,13:0};
  setRelation(ctx.state,1,2,'war');
  for(let time=seconds;time<50_000;time+=seconds) {
    ctx.state.simulationTick++;
    stepCombat(ctx,seconds/3600);
    if(Object.keys(ctx.state.armies).length<2) return time;
  }
  throw new Error('Battle did not finish');
}
describe('continuous combat balance and accurate scheduling',()=>{
  it('meets infantry duration targets and is stable at a finer step',()=>{
    const duel=duration(1,1), outnumbered=duration(10,1), large=duration(10,10);
    expect(duel).toBeGreaterThan(6900); expect(duel).toBeLessThan(7500);
    expect(outnumbered).toBeLessThan(duel/3); expect(large).toBeGreaterThan(duel*2);
    expect(Math.abs(duration(1,1,0.1)-duel)).toBeLessThan(3);
  },30_000);
  it('retains stall debt and keeps fixed steps at every speed',()=>{
    let now=0; const steps:number[]=[];
    const scheduler=new SimulationScheduler(dt=>steps.push(dt),()=>now,10);
    now=1000; scheduler.pump(32);
    expect(steps).toHaveLength(10); expect(scheduler.pendingSeconds).toBeCloseTo(31);
    while(scheduler.pendingSeconds>0.001) scheduler.pump(0);
    expect(steps).toHaveLength(320); expect(new Set(steps)).toEqual(new Set([0.1/3600]));
    now=2000; scheduler.pump(0); expect(steps).toHaveLength(320);
    now=2500; scheduler.pump(2); expect(steps).toHaveLength(330);
  });
});
