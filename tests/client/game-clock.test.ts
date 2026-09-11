import { describe, expect, it } from 'vitest';
import { InterpolatedGameClock } from '../../src/client/game-clock';
import { AuthoritativeGameClock } from '../../apps/game-server/src/game-clock';
import { fixture } from '../helpers/simulation';

describe('one authoritative timeline', () => {
  it('derives civil time from elapsed simulation and supports a debug reset', () => {
    const c=fixture(); const clock=new AuthoritativeGameClock(() => c.state);
    c.state.clock.gameTimeHours=2;
    expect(clock.snapshot(123).gameEpochMs).toBe(c.state.clock.initialEpochMs!+7_200_000);
    clock.setEpoch(Date.UTC(1940,0,1));
    expect(clock.snapshot().gameEpochMs).toBe(Date.UTC(1940,0,1));
    expect(c.state.clock.gameTimeHours).toBe(2);
    expect(clock.snapshot().generation).toBe(1);
  });
  it('interpolates speed, pause, midnight and explicit time changes', () => {
    let now=0; const clock=new InterpolatedGameClock(() => now);
    const epoch=Date.UTC(1939,8,1,21,59,59);
    const sync={gameStartedAtEpochMs:epoch,gameEpochMs:epoch,serverEpochMs:0,speed:1,generation:0,utcOffsetMinutes:120};
    clock.synchronize(sync); now=1000;
    expect(clock.read()).toMatchObject({day:2,hour:0,minute:0,second:0});
    clock.synchronize({...sync,gameEpochMs:epoch+1000,speed:0}); now=2000;
    expect(clock.read().second).toBe(0);
    clock.synchronize({...sync,gameEpochMs:epoch+1000,speed:4,generation:1}); now=2250;
    expect(clock.read().second).toBe(1);
  });
  it('bounds prediction when updates stop and freezes on disconnect', () => {
    let now=0; const clock=new InterpolatedGameClock(() => now);
    clock.synchronize({gameStartedAtEpochMs:0,gameEpochMs:0,serverEpochMs:0,speed:1,generation:0,utcOffsetMinutes:120});
    now=10000; expect(clock.readEpochMs()).toBe(1500);
    clock.freeze(); now=20000; expect(clock.readEpochMs()).toBe(1500);
  });
});
