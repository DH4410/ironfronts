import { describe, expect, it } from 'vitest';
import { groupQueueItems } from '../src/ui/queue-presentation';
import type { QueueItem } from '../src/ui/ui-state';

const active = (id: string, progress = 0.4): QueueItem => ({
  id, label: id, active: true, progress, etaSeconds: 30,
});

const queued = (id: string): QueueItem => ({
  id, label: id, active: false, progress: 0, etaSeconds: 0,
});

describe('queue presentation groups', () => {
  it('collapses consecutive matching orders into a batch count', () => {
    expect(groupQueueItems([active('infantry'), queued('infantry'), queued('infantry')]))
      .toEqual([{ ...active('infantry'), key: 'infantry:0', count: 3 }]);
  });

  it('keeps separated runs as distinct stable queue slots', () => {
    const groups = groupQueueItems([
      active('infantry'), queued('tank'), queued('infantry'), queued('infantry'),
    ]);
    expect(groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'infantry:0', count: 1 },
      { key: 'tank:0', count: 1 },
      { key: 'infantry:1', count: 2 },
    ]);
  });

  it('retains the active order progress when its queued copies become a batch', () => {
    const [group] = groupQueueItems([active('engineer', 0.72), queued('engineer')]);
    expect(group).toMatchObject({ active: true, progress: 0.72, count: 2 });
  });
});
