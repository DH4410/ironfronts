import './menu.css';
import type { AudioManager, UiAudioCue } from '../audio/audio-manager';
import { phase, runChoreo, smooth } from './choreo';

export interface MenuHandlers {
  /** Called once the player commits to entering the world (campaign, continue, or sandbox). */
  onLaunch: () => void;
  audio?: AudioManager;
}

const OPEN_DURATION = 1250;

/** Natural aspect (height/width) of public/menu/desk-scene.jpg, for computing its cover-fit pixel size. */
const MAP_ASPECT = 2620 / 2402;

export function mountMenu(handlers: MenuHandlers): void {
  const root = requiredId<HTMLElement>('menu-root');
  const brand = document.querySelector<HTMLElement>('.brand');
  const main = requiredId<HTMLElement>('ifm-main');
  const map = requiredChild<HTMLElement>(root, '.ifm__map');
  const masterVolume = document.getElementById('ifm-master-volume') as HTMLInputElement | null;
  const musicVolume = document.getElementById('ifm-music-volume') as HTMLInputElement | null;

  let busy = false;
  let openScreen: string | null = null;
  let transitionPage: HTMLElement | null = null;
  let riseDistance = 0;

  const playCue = (cue: UiAudioCue): void => {
    if (handlers.audio) void handlers.audio.playUiCue(cue);
  };

  if (handlers.audio) {
    root.addEventListener('pointerdown', () => void handlers.audio?.unlock(), { capture: true, once: true });
    if (masterVolume) {
      masterVolume.value = String(Math.round(handlers.audio.getVolume('master') * 100));
      masterVolume.addEventListener('input', () => {
        handlers.audio?.setVolume('master', Number(masterVolume.value) / 100);
      });
    }
    if (musicVolume) {
      musicVolume.value = String(Math.round(handlers.audio.getVolume('music') * 100));
      musicVolume.addEventListener('input', () => {
        handlers.audio?.setVolume('music', Number(musicVolume.value) / 100);
      });
    }

    root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('pointerenter', () => playCue('hover'));
    });
  }

  /**
   * One update() drives every sub-motion from the same t (0=on the menu,
   * 1=dossier open). The desk photo pans down (no extra zoom — the source
   * is already at cover-fit scale, and zooming further just softens it).
   * The logo/cards are measured to move by the exact same pixel amount the
   * backdrop's visible window shifts, so they read as scrolling with the
   * desk rather than drifting at their own independent speed. The dossier
   * page rides the same pan curve, sliding up fully opaque from below the
   * fold so it reads as having been on the desk the whole time rather than
   * fading into place.
   */
  function update(t: number): void {
    const panT = smooth(phase(t, 0, 0.92));

    const box = map.getBoundingClientRect();
    const renderedHeight = box.width * MAP_ASPECT;
    const excess = Math.max(0, renderedHeight - box.height);
    const posY = panT * 62;
    const offsetPx = excess * (posY / 100);

    map.style.backgroundPosition = `center ${posY.toFixed(2)}%`;
    map.style.filter = `brightness(${(.86 + panT * .09).toFixed(3)}) saturate(.92) contrast(1.02)`;

    main.style.transform = `translateY(${(-offsetPx).toFixed(2)}px)`;

    if (transitionPage) {
      transitionPage.style.transform = `translateY(${((1 - panT) * riseDistance).toFixed(2)}px)`;
    }
  }

  async function playTransition(page: HTMLElement, direction: 1 | -1): Promise<void> {
    transitionPage = page;
    page.style.transform = 'none';
    riseDistance = page.getBoundingClientRect().height;
    update(direction === 1 ? 0 : 1);
    await runChoreo(OPEN_DURATION, direction, update);
    transitionPage = null;
  }

  async function openDossier(card: HTMLButtonElement): Promise<void> {
    if (busy) return;
    const name = card.dataset.open;
    if (!name) return;
    const page = document.getElementById(`ifm-${name}`);
    if (!page?.querySelector<HTMLElement>('.ifm__file')) return;

    busy = true;
    openScreen = name;
    playCue('dossier-open');

    page.hidden = false;
    page.style.pointerEvents = 'none';
    await playTransition(page, 1);
    page.style.pointerEvents = '';
    main.style.pointerEvents = 'none';
    busy = false;
  }

  async function closeDossier(): Promise<void> {
    if (busy || !openScreen) return;
    const name = openScreen;
    const page = document.getElementById(`ifm-${name}`);
    if (!page?.querySelector<HTMLElement>('.ifm__file')) return;

    busy = true;
    playCue('dossier-close');
    main.style.pointerEvents = '';
    page.style.pointerEvents = 'none';
    await playTransition(page, -1);
    page.hidden = true;
    page.style.pointerEvents = '';
    openScreen = null;
    busy = false;
  }

  root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((card) => {
    card.addEventListener('click', () => void openDossier(card));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-back]').forEach((button) => {
    button.addEventListener('click', () => void closeDossier());
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void closeDossier();
  });

  const briefing = {
    objective: document.getElementById('ifm-briefing-objective'),
    theater: document.getElementById('ifm-briefing-theater'),
    date: document.getElementById('ifm-briefing-date'),
    duration: document.getElementById('ifm-briefing-duration'),
    risk: document.getElementById('ifm-briefing-risk'),
  };

  /** Campaign's operation rows carry briefing data; other rows have none and are skipped. */
  function updateBriefing(row: HTMLElement): void {
    const { objective, theater, date, duration, risk } = briefing;
    if (!objective || !theater || !date || !duration || !risk) return;
    objective.textContent = row.dataset.objective ?? '';
    theater.textContent = row.dataset.theater ?? '';
    date.textContent = row.dataset.date ?? '';
    duration.textContent = row.dataset.duration ?? '';
    const level = row.dataset.risk ?? 'medium';
    risk.textContent = level.charAt(0).toUpperCase() + level.slice(1);
    risk.className = `is-risk-${level}`;
  }

  root.querySelectorAll<HTMLButtonElement>('.ifm__row').forEach((row) => {
    row.addEventListener('click', () => {
      const list = row.parentElement;
      list?.querySelectorAll('.ifm__row').forEach((sibling) => sibling.classList.remove('is-selected'));
      row.classList.add('is-selected');
      playCue('select');
      if (row.dataset.objective) updateBriefing(row);
    });
  });

  function launch(): void {
    playCue('confirm');
    root.style.transition = 'opacity .5s ease';
    root.style.opacity = '0';
    window.setTimeout(() => {
      root.hidden = true;
      if (brand) brand.hidden = false;
      handlers.onLaunch();
    }, 500);
  }

  document.getElementById('ifm-start-operation')?.addEventListener('click', launch);
  document.getElementById('ifm-resume-operation')?.addEventListener('click', launch);
  document.getElementById('ifm-enter-sandbox')?.addEventListener('click', launch);
  document.getElementById('ifm-apply-settings')?.addEventListener('click', () => playCue('confirm'));
}

function requiredId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing menu element: #${id}`);
  return el as unknown as T;
}

function requiredChild<T extends HTMLElement>(parent: Element, selector: string): T {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`Missing menu element: ${selector}`);
  return el as unknown as T;
}
