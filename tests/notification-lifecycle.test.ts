import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_TTL_MS, NOTIFICATION_FALLBACK_TTL_MS, isSticky, autoDismissDelay,
} from '../src/ui/notification-lifecycle';

/**
 * Playtest #17: normal toasts used to sit on screen forever (and the demo
 * fixtures were patched in raw with no timer at all). Each kind now has a
 * deliberate lifetime; action-required kinds stay until dismissed.
 */
describe('notification lifecycle', () => {
  it('auto-dismisses the transient kinds on a sensible ramp', () => {
    expect(autoDismissDelay('information')).toBe(5_000);
    expect(autoDismissDelay('completed')).toBe(6_000);
    expect(autoDismissDelay('diplomacy')).toBe(6_000);
    expect(autoDismissDelay('warning')).toBe(8_000);
    // info < success <= warning
    expect(NOTIFICATION_TTL_MS.information!).toBeLessThan(NOTIFICATION_TTL_MS.completed!);
    expect(NOTIFICATION_TTL_MS.completed!).toBeLessThanOrEqual(NOTIFICATION_TTL_MS.warning!);
  });

  it('keeps action-required (combat) toasts until dismissed', () => {
    expect(isSticky('combat')).toBe(true);
    expect(autoDismissDelay('combat')).toBeNull();
  });

  it('honours an explicit sticky override in both directions', () => {
    expect(isSticky('information', true)).toBe(true);
    expect(autoDismissDelay('information', true)).toBeNull();
    expect(isSticky('combat', false)).toBe(false);
    expect(autoDismissDelay('combat', false)).toBe(NOTIFICATION_FALLBACK_TTL_MS);
  });

  it('the HUD wiring dismisses by id and clears timers on teardown', () => {
    const main = readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    // Manual dismiss goes through the id-based remover, not a title sweep.
    expect(main).toContain('dismissNotification: (id) => removeNotification(id)');
    expect(main).not.toMatch(/entry\.title !== 'Command failed'/);
    // Every scheduled timer is torn down with the session.
    const teardown = main.slice(main.indexOf('const teardownSession'), main.indexOf('const teardownSession') + 300);
    expect(teardown).toContain('clearAllNotificationTimers()');
    // Demo fixtures now flow through the normal lifecycle, not a raw patch.
    expect(main).toContain('for (const demo of DEMO_NOTIFICATIONS) pushNotification(');
    expect(main).not.toContain('notifications: DEMO_NOTIFICATIONS');
  });
});
