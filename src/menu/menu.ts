import './menu.css';
import { phase, runChoreo, smooth } from './choreo';

export interface MenuHandlers {
  /** Called once the player commits to entering the world (campaign, continue, or sandbox). */
  onLaunch: () => void;
}

const OPEN_DURATION = 1250;

export function mountMenu(handlers: MenuHandlers): void {
  const root = requiredId<HTMLElement>('menu-root');
  const brand = document.querySelector<HTMLElement>('.brand');
  const main = requiredId<HTMLElement>('ifm-main');
  const map = requiredChild<HTMLElement>(root, '.ifm__map');

  let busy = false;
  let openScreen: string | null = null;
  let transitionFile: HTMLElement | null = null;

  /**
   * One update() drives every sub-motion from the same t (0=on the menu,
   * 1=dossier open). Instead of any button or panel stretching, the desk
   * photo itself pans and zooms down — a camera settling onto the map —
   * while the menu racks out of focus behind the document that fades in.
   */
  function update(t: number): void {
    const panT = smooth(phase(t, 0, 0.92));
    const outT = smooth(phase(t, 0, 0.6));
    const inT = smooth(phase(t, 0.4, 1));

    map.style.backgroundPosition = `center ${6 + panT * 56}%`;
    map.style.backgroundSize = `${150 - panT * 30}% auto`;
    map.style.filter = `brightness(${(.86 + panT * .09).toFixed(3)}) saturate(.92) contrast(1.02)`;

    main.style.opacity = String(1 - outT);
    main.style.transform = `translateY(${outT * -24}px)`;
    main.style.filter = `blur(${(outT * 5).toFixed(2)}px)`;

    if (transitionFile) {
      transitionFile.style.opacity = String(inT);
      transitionFile.style.transform = `translateY(${((1 - inT) * 28).toFixed(2)}px)`;
      transitionFile.style.filter = `blur(${((1 - inT) * 5).toFixed(2)}px)`;
    }
  }

  async function playTransition(fileEl: HTMLElement, direction: 1 | -1): Promise<void> {
    transitionFile = fileEl;
    await runChoreo(OPEN_DURATION, direction, update);
    transitionFile = null;
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
    fileEl.style.opacity = '0';
    page.style.pointerEvents = 'none';
    await playTransition(fileEl, 1);
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
    await playTransition(fileEl, -1);
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
