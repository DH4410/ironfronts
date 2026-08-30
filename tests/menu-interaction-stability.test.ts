import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const menu = readFileSync(path.join(root, 'src/menu/menu.ts'), 'utf8');
const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');

describe('menu interaction stability', () => {
  it('keeps dossier animation compositor-only', () => {
    const start = menu.indexOf('function update(t: number)');
    const end = menu.indexOf('async function playTransition', start);
    const update = menu.slice(start, end);

    expect(update).toContain('translate3d');
    expect(update).not.toContain('backgroundPosition');
    expect(update).not.toContain('style.filter');
  });

  it('does not install a second menu pointerdown audio unlock handler', () => {
    expect(menu).not.toContain("root.addEventListener('pointerdown'");
  });

  it('serializes concurrent AudioContext activation attempts', () => {
    expect(audio).toContain('private unlockInFlight?: Promise<boolean>');
    expect(audio).toContain('if (this.unlockInFlight) return this.unlockInFlight');
  });

  it('does not activate audio from passive hover before unlock', () => {
    expect(audio).toContain("if (cue === 'hover' && !this.unlocked) return");
  });

  it('drives menu-card inertness from a class, not a strandable inline style', () => {
    // The old code set `main.style.pointerEvents = 'none'` in a transition
    // finally block and relied on close to undo it — a stuck transition left
    // the menu dead. State is now a class toggled with `openScreen`.
    expect(menu).not.toContain("main.style.pointerEvents");
    expect(menu).toContain("root.classList.add('is-dossier-open')");
    expect(menu).toContain("root.classList.remove('is-dossier-open')");
    const css = readFileSync(path.join(root, 'src/menu/menu.css'), 'utf8');
    expect(css).toContain('.ifm.is-dossier-open .ifm__screen { pointer-events: none; }');
  });

  it('provides a hard reset to the main screen for an abandoned launch', () => {
    const start = menu.indexOf('function resetToMainScreen()');
    const end = menu.indexOf('\n  }', start);
    const reset = menu.slice(start, end);
    expect(reset).toContain('busy = false');
    expect(reset).toContain("root.classList.remove('is-dossier-open', 'is-transitioning')");
    expect(reset).toContain("main.style.transform = ''");
    // launch() calls it when onLaunch rejects (Return to Command).
    const launchBody = menu.slice(menu.indexOf('async function launch('), menu.indexOf('async function deploy('));
    expect(launchBody).toContain('catch (error)');
    expect(launchBody).toContain('resetToMainScreen();');
  });

  it('will not start a launch while a menu transition is animating', () => {
    const start = menu.indexOf('async function deploy(');
    const end = menu.indexOf('\n  }', start);
    expect(menu.slice(start, end)).toContain('if (busy) return');
  });
});
