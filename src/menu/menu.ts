import './menu.css';
import { phase, runChoreo, smooth } from './choreo';

export interface MenuHandlers {
  /** Called once the player commits to entering the world (campaign, continue, or sandbox). */
  onLaunch: () => void;
}

const OPEN_DURATION = 1600;

interface Rect { left: number; top: number; width: number; height: number }

const ZERO_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

export function mountMenu(handlers: MenuHandlers): void {
  const root = requiredId<HTMLElement>('menu-root');
  const brand = document.querySelector<HTMLElement>('.brand');
  const main = requiredId<HTMLElement>('ifm-main');
  const stage = requiredId<HTMLElement>('ifm-stage');

  const panel = document.createElement('div');
  panel.className = 'ifm__panel';
  panel.innerHTML = '<div class="ifm__panel-stack"></div><div class="ifm__panel-paper"></div><div class="ifm__panel-cover"></div>';
  stage.appendChild(panel);
  const panelStack = requiredChild<HTMLElement>(panel, '.ifm__panel-stack');
  const panelPaper = requiredChild<HTMLElement>(panel, '.ifm__panel-paper');
  const panelCover = requiredChild<HTMLElement>(panel, '.ifm__panel-cover');

  let busy = false;
  let openCard: HTMLButtonElement | null = null;
  let openScreen: string | null = null;
  let transitionSource: Rect = ZERO_RECT;
  let transitionTarget: Rect = ZERO_RECT;
  let transitionPage: HTMLElement | null = null;

  function rectOf(el: Element): Rect {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /** One update() drives every sub-motion from the same t (0=closed card, 1=open file). */
  function update(t: number): void {
    const moveT = smooth(phase(t, 0, 0.55));
    const hingeT = smooth(phase(t, 0.35, 0.75));
    const revealT = smooth(phase(t, 0.65, 1));
    const rect: Rect = {
      left: transitionSource.left + (transitionTarget.left - transitionSource.left) * moveT,
      top: transitionSource.top + (transitionTarget.top - transitionSource.top) * moveT,
      width: transitionSource.width + (transitionTarget.width - transitionSource.width) * moveT,
      height: transitionSource.height + (transitionTarget.height - transitionSource.height) * moveT,
    };
    const arc = Math.sin(Math.PI * moveT) * Math.min(48, transitionSource.height * 0.12);
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top - arc}px`;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panelStack.style.opacity = String(1 - hingeT * 0.7);
    panelCover.style.transform = `rotateY(${-104 * hingeT}deg)`;
    panelCover.style.opacity = String(1 - hingeT * 0.92);
    panelPaper.style.transform = `scale(${0.96 + 0.04 * revealT})`;
    // Crossfade: the panel's plain paper face hands off to the real subpage
    // content over the same reveal window, so nothing just sits static.
    panelPaper.style.opacity = String(1 - revealT);
    if (transitionPage) transitionPage.style.opacity = String(revealT);
  }

  async function playTransition(card: HTMLButtonElement, fileEl: HTMLElement, page: HTMLElement, direction: 1 | -1): Promise<void> {
    transitionSource = rectOf(card);
    transitionTarget = rectOf(fileEl);
    transitionPage = page;
    card.classList.add('is-source');
    stage.hidden = false;
    await runChoreo(OPEN_DURATION, direction, update);
    stage.hidden = true;
    card.classList.remove('is-source');
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
    openCard = card;
    openScreen = name;

    page.hidden = false;
    page.style.opacity = '0';
    page.style.pointerEvents = 'none';
    await playTransition(card, fileEl, page, 1);
    page.style.opacity = '';
    page.style.pointerEvents = '';
    main.style.pointerEvents = 'none';
    document.body.classList.add('ifm-subpage-open');
    busy = false;
  }

  async function closeDossier(): Promise<void> {
    if (busy || !openScreen || !openCard) return;
    const name = openScreen;
    const card = openCard;
    const page = document.getElementById(`ifm-${name}`);
    const fileEl = page?.querySelector<HTMLElement>('.ifm__file');
    if (!page || !fileEl) return;

    busy = true;
    page.style.pointerEvents = 'none';
    await playTransition(card, fileEl, page, -1);
    page.hidden = true;
    page.style.opacity = '';
    page.style.pointerEvents = '';
    main.style.pointerEvents = '';
    document.body.classList.remove('ifm-subpage-open');
    openCard = null;
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

  root.querySelectorAll<HTMLButtonElement>('.ifm__row').forEach((row) => {
    row.addEventListener('click', () => {
      const list = row.parentElement;
      list?.querySelectorAll('.ifm__row').forEach((sibling) => sibling.classList.remove('is-selected'));
      row.classList.add('is-selected');
    });
  });

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
