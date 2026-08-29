import './menu.css';
import { phase, runChoreo, smooth } from './choreo';
import {
  isQualityLevel, loadQuality, QUALITY_PRESETS, saveQuality, type QualityLevel,
} from '../graphics/quality';

export interface MenuHandlers {
  /** Called once the player commits to entering the world (campaign, continue, or sandbox). */
  onLaunch: () => void;
  /**
   * Fired when the player changes the graphics-quality preset in Settings.
   * In the lobby this only persists the choice; once a WorldRenderer exists
   * (after launch) main.ts forwards it to renderer.setQuality.
   */
  onGraphicsQuality?: (level: QualityLevel) => void;
}

const OPEN_DURATION = 1250;

/** Natural aspect (height/width) of public/menu/desk-scene.jpg, for computing its cover-fit pixel size. */
const MAP_ASPECT = 2620 / 2402;

export function mountMenu(handlers: MenuHandlers): void {
  const root = requiredId<HTMLElement>('menu-root');
  const brand = document.querySelector<HTMLElement>('.brand');
  const main = requiredId<HTMLElement>('ifm-main');
  const map = requiredChild<HTMLElement>(root, '.ifm__map');

  let busy = false;
  let openScreen: string | null = null;
  let transitionPage: HTMLElement | null = null;
  let riseDistance = 0;

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
    const fileEl = page?.querySelector<HTMLElement>('.ifm__file');
    if (!page || !fileEl) return;

    busy = true;
    openScreen = name;

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
    const fileEl = page?.querySelector<HTMLElement>('.ifm__file');
    if (!page || !fileEl) return;

    busy = true;
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
      if (row.dataset.objective) updateBriefing(row);
    });
  });

  // Graphics quality selector. Reads/persists the choice locally and only
  // notifies handlers - it never initializes the world renderer from the lobby.
  const graphicsGroup = document.getElementById('ifm-graphics-quality');
  const graphicsBlurb = document.getElementById('ifm-graphics-blurb');
  if (graphicsGroup) {
    const buttons = [...graphicsGroup.querySelectorAll<HTMLButtonElement>('[data-graphics-quality]')];
    const paint = (level: QualityLevel): void => {
      for (const button of buttons) {
        const active = button.dataset.graphicsQuality === level;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('is-selected', active);
      }
      if (graphicsBlurb) graphicsBlurb.textContent = QUALITY_PRESETS[level].blurb;
    };
    paint(loadQuality());
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const level = button.dataset.graphicsQuality;
        if (!isQualityLevel(level)) return;
        saveQuality(level);
        paint(level);
        handlers.onGraphicsQuality?.(level);
      });
    }
  }

  function launch(): void {
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
