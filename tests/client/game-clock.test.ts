import { describe, expect, it } from 'vitest';
import { InterpolatedGameClock } from '../../src/client/game-clock';
import { AuthoritativeGameClock } from '../../apps/game-server/src/game-clock';
import { fixture } from '../helpers/simulation';

describe('separate simulation and visual clocks', () => {
  it('keeps visual time independent and persistent across real elapsed time', () => {
    const c=fixture(); const clock=new AuthoritativeGameClock(() => c.state);
    c.state.clock.gameTimeHours=2;
    expect(clock.snapshot(123).gameEpochMs).toBe(c.state.clock.initialEpochMs!);
    clock.setEpoch(Date.UTC(1940,0,1), 1_000);
    expect(clock.snapshot(2_500).gameEpochMs).toBe(Date.UTC(1940,0,1)+1_500);
    expect(c.state.clock.gameTimeHours).toBe(2);
    expect(clock.snapshot(2_500).generation).toBe(1);
    clock.linkTimezone('America/New_York', 3_000);
    expect(clock.snapshot(9_000)).toMatchObject({gameEpochMs:9_000,utcOffsetMinutes:-300,timezoneLinked:true,timeZone:'America/New_York'});
  });
  it('interpolates visual time at 1x while campaign day comes from simulation', () => {
    let now=0; const clock=new InterpolatedGameClock(() => now);
    const epoch=Date.UTC(1939,8,1,21,59,59);
    const sync={gameStartedAtEpochMs:epoch,gameEpochMs:epoch,serverEpochMs:0,speed:1,generation:0,utcOffsetMinutes:120,campaignElapsedSeconds:86_400,timezoneLinked:false};
    clock.synchronize(sync); now=1000;
    expect(clock.read()).toMatchObject({day:2,hour:0,minute:0,second:0});
    clock.synchronize({...sync,gameEpochMs:epoch+1000}); now=2000;
    expect(clock.read().second).toBe(1);
  });
  it('bounds prediction when updates stop and freezes on disconnect', () => {
    let now=0; const clock=new InterpolatedGameClock(() => now);
    clock.synchronize({gameStartedAtEpochMs:0,gameEpochMs:0,serverEpochMs:0,speed:1,generation:0,utcOffsetMinutes:120,campaignElapsedSeconds:0,timezoneLinked:false});
    now=10000; expect(clock.readEpochMs()).toBe(1500);
    clock.freeze(); now=20000; expect(clock.readEpochMs()).toBe(1500);
  });
});
