import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const notifications = readFileSync(path.join(root, 'src/ui/notifications.ts'), 'utf8');

describe('attack-order feedback', () => {
  it('shows the attack cursor only for a fully identified enemy, never a contact-only blip', () => {
    const fn = main.slice(main.indexOf('const updateWorldCursor ='), main.indexOf('canvas.addEventListener(\'pointermove\''));
    // The strikable test is gated on visible contact, matching the server's
    // "a direct strike needs an identified target" rule.
    expect(fn).toMatch(/hovered\.contact === 'visible'/);
    expect(fn).toContain('action-attack.png');
    expect(fn).toContain('cursor-no.png');
  });

  it('acknowledges an accepted attack click immediately, without waiting for combat', () => {
    const start = main.indexOf("targetingMode === 'attack' && selectedArmyId");
    const branch = main.slice(start, main.indexOf("targetingMode === 'retreat'", start));
    expect(branch).toContain('flashAttackTarget(clientX, clientY)');
    expect(branch).toMatch(/pushNotification\('information', 'Attack order issued'/);
    expect(branch).toContain("audio.playUiCue('confirm')");
  });

  it('rate-limits the under-attack alert so simultaneous battles cannot stack it', () => {
    const fn = main.slice(main.indexOf('function maybePlayCombatAlert'), main.indexOf('function drainSessionEvents'));
    expect(fn).toMatch(/now - lastCombatAlertAt < 3_000/);
    expect(fn).toContain('audio.playCombatAlert()');
  });

  it('locates an "under attack" toast on a friendly engaged stack for click-to-focus', () => {
    const block = main.slice(main.indexOf("if (ev.kind === 'engaged')"));
    expect(block.slice(0, 700)).toMatch(/a\.own && a\.status === 'engaged'/);
    expect(block.slice(0, 700)).toMatch(/focus: \{ x: spot\.x, z: spot\.z \}/);
    expect(block.slice(0, 700)).toContain('maybePlayCombatAlert()');
  });
});

describe('locatable notification', () => {
  it('a toast with a focus point is clickable and re-centres the camera', () => {
    expect(notifications).toContain('focusWorld?: (x: number, z: number) => void');
    expect(notifications).toContain("item.classList.add('is-locatable')");
    expect(notifications).toContain('focusWorld(x, z)');
    // The dedicated "under attack" icon is used for a located combat alert.
    expect(notifications).toMatch(/notification\.kind === 'combat' && notification\.focus \? 'note-attacked'/);
  });
});
