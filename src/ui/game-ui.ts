/**
 * In-game strategic command UI (v2).
 *
 * Builds the player HUD once, then updates cached text nodes from a single
 * coalesced `render(state)` driven by `UiStore` subscription. No animation
 * loop, no `getBoundingClientRect` in rAF, no MutationObserver. All map /
 * renderer effects go through the typed `GameUiActions` the host wires to the
 * renderer.
 */

import './game-ui.css';
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel } from '../graphics/quality';
import { createArmyCounter, describeArmy } from './army';
import type {
  GameNotification, MapMode, NavId, NotificationKind, StrategicUiState, UiStore,
} from './ui-state';

export interface GameUiActions {
  setMapMode(mode: MapMode): void;
  clearSelection(): void;
  setQuality(level: QualityLevel): void;
  navSelect(id: NavId): void;
  dismissNotification(id: string): void;
  /** Open (true) / close (false) the pause overlay. */
  togglePause(open: boolean): void;
  /** Currently disabled in the UI; wired for when a menu return path is safe. */
  returnToMenu(): void;
  openDebugInspector(): void;
  /** Fired when the "Centre map" action would run — not yet supported. */
  focusSelected?: () => void;
}

export interface GameUiHandle {
  destroy(): void;
}

interface NavEntry { id: NavId; label: string; glyph: string; }

const NAV_ENTRIES: readonly NavEntry[] = [
  { id: 'armies', label: 'Armies', glyph: '⚔' },
  { id: 'provinces', label: 'Provinces', glyph: '◉' },
  { id: 'production', label: 'Production', glyph: '⚙' },
  { id: 'research', label: 'Research', glyph: '☷' },
  { id: 'diplomacy', label: 'Diplomacy', glyph: '✍' },
  { id: 'economy', label: 'Economy', glyph: '▰' },
  { id: 'intelligence', label: 'Intelligence', glyph: '◈' },
  { id: 'events', label: 'Events', glyph: '✉' },
];

const MAP_MODES: ReadonlyArray<{ mode: MapMode; label: string; glyph: string }> = [
  { mode: 'balanced', label: 'Strategic', glyph: '◆' },
  { mode: 'political', label: 'Political', glyph: '▣' },
  { mode: 'diplomacy', label: 'Diplomacy', glyph: '✥' },
  { mode: 'clear', label: 'Terrain', glyph: '▲' },
];

const NOTIFICATION_GLYPH: Record<NotificationKind, string> = {
  warning: '⚠',
  combat: '⚔',
  completed: '✔',
  diplomacy: '✍',
  information: 'ℹ',
};

const PROVINCE_ACTIONS = ['Build', 'Produce', 'Rally', 'Inspect'] as const;

const numberFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function mountGameUi(store: UiStore, actions: GameUiActions): GameUiHandle {
  const root = el('div', 'ifg');
  root.hidden = true;

  // ---- Top strategic bar -------------------------------------------------
  const topbar = el('header', 'ifg-topbar');
  topbar.setAttribute('aria-label', 'Strategic command bar');

  const countryBlock = el('div', 'ifg-topbar__country');
  const flagSwatch = el('i', 'ifg-topbar__flag');
  flagSwatch.setAttribute('aria-hidden', 'true');
  const countryName = el('strong', 'ifg-topbar__country-name', 'Unassigned Command');
  const countryText = el('span', 'ifg-topbar__country-text', '<small>COMMAND</small>');
  countryText.append(countryName);
  countryBlock.append(flagSwatch, countryText);

  const resourceStrip = el('div', 'ifg-topbar__resources');
  resourceStrip.setAttribute('role', 'group');
  resourceStrip.setAttribute('aria-label', 'National resources');

  const clockBlock = el('div', 'ifg-topbar__clock');
  const clockValue = el('b', 'ifg-topbar__clock-value', '--');
  const clockPhase = el('small', 'ifg-topbar__clock-phase', 'Awaiting orders');
  clockBlock.append(clockPhase, clockValue);

  const weatherBadge = el('button', 'ifg-topbar__weather', '<i aria-hidden="true">☀</i><span>Clear</span>');
  weatherBadge.type = 'button';
  weatherBadge.title = 'Weather';
  weatherBadge.disabled = true;

  const pauseButton = el('button', 'ifg-topbar__system', '<i aria-hidden="true">≡</i>');
  pauseButton.type = 'button';
  pauseButton.title = 'System menu';
  pauseButton.setAttribute('aria-label', 'Open system menu');
  pauseButton.addEventListener('click', () => actions.togglePause(!store.get().paused));

  topbar.append(countryBlock, resourceStrip, clockBlock, weatherBadge, pauseButton);

  // ---- Left navigation rail -------------------------------------------------
  const rail = el('nav', 'ifg-rail');
  rail.setAttribute('aria-label', 'Command sections');
  const navButtons = new Map<NavId, HTMLButtonElement>();
  for (const entry of NAV_ENTRIES) {
    const button = el('button', 'ifg-rail__item');
    button.type = 'button';
    button.dataset.nav = entry.id;
    button.disabled = true;
    button.title = `${entry.label} — not available yet`;
    button.setAttribute('aria-label', `${entry.label} (not available yet)`);
    button.innerHTML = `<span class="ifg-rail__glyph" aria-hidden="true">${entry.glyph}</span><span class="ifg-rail__tip">${entry.label}</span>`;
    button.addEventListener('click', () => actions.navSelect(entry.id));
    navButtons.set(entry.id, button);
    rail.append(button);
  }

  // ---- Map-mode toolbar (top-right, over map) -----------------------------
  const modeBar = el('div', 'ifg-modes');
  modeBar.setAttribute('role', 'group');
  modeBar.setAttribute('aria-label', 'Map mode');
  const modeButtons = new Map<MapMode, HTMLButtonElement>();
  for (const { mode, label, glyph } of MAP_MODES) {
    const button = el('button', 'ifg-modes__item');
    button.type = 'button';
    button.dataset.mode = mode;
    button.title = label;
    button.innerHTML = `<span aria-hidden="true">${glyph}</span><span class="ifg-modes__label">${label}</span>`;
    button.addEventListener('click', () => actions.setMapMode(mode));
    modeButtons.set(mode, button);
    modeBar.append(button);
  }

  const inspectorButton = el('button', 'ifg-modes__inspector', 'F3');
  inspectorButton.type = 'button';
  inspectorButton.title = 'World inspector';
  inspectorButton.addEventListener('click', () => actions.openDebugInspector());
  modeBar.append(inspectorButton);

  // ---- Notifications (top-right, below map modes) ------------------------
  const notifyStack = el('div', 'ifg-notify');
  notifyStack.setAttribute('aria-live', 'polite');
  notifyStack.setAttribute('aria-label', 'Events');

  // ---- Selected context panel (bottom) --------------------------------
  const context = el('section', 'ifg-context');
  context.setAttribute('aria-live', 'polite');
  const contextEmpty = el('p', 'ifg-context__empty', 'Select a province to open its field report.');

  const provincePanel = el('div', 'ifg-context__province');
  provincePanel.hidden = true;
  const pvName = el('strong', 'ifg-context__title', '');
  const pvClose = el('button', 'ifg-context__close', '×');
  pvClose.type = 'button';
  pvClose.title = 'Clear selection';
  pvClose.setAttribute('aria-label', 'Clear selection');
  pvClose.addEventListener('click', () => actions.clearSelection());
  const pvFocus = el('button', 'ifg-context__focus', 'Centre map');
  pvFocus.type = 'button';
  if (actions.focusSelected) {
    pvFocus.addEventListener('click', () => actions.focusSelected?.());
  } else {
    pvFocus.disabled = true;
    pvFocus.title = 'Centre map — not available yet';
  }

  const pvOwner = el('b', 'ifg-field__value', '—');
  const pvTerrain = el('b', 'ifg-field__value', '—');
  const pvOwnerSwatch = el('i', 'ifg-field__swatch');
  pvOwnerSwatch.setAttribute('aria-hidden', 'true');
  const ownerField = el('span', 'ifg-field');
  ownerField.append(el('small', undefined, 'CONTROL'), pvOwnerSwatch, pvOwner);
  const terrainField = el('span', 'ifg-field');
  terrainField.append(el('small', undefined, 'TERRAIN'), pvTerrain);
  const pvGrid = el('div', 'ifg-context__grid');
  pvGrid.append(ownerField, terrainField);
  // Reserved rows for systems that do not exist yet.
  const pvReserved = el('div', 'ifg-context__reserved');
  for (const label of ['Morale', 'Population', 'Supply', 'Victory pts']) {
    pvReserved.append(el('span', 'ifg-field is-pending',
      `<small>${label.toUpperCase()}</small><b class="ifg-field__value">--</b>`));
  }
  const pvActions = el('div', 'ifg-context__actions');
  for (const label of PROVINCE_ACTIONS) {
    const button = el('button', 'ifg-context__action');
    button.type = 'button';
    button.textContent = label;
    button.disabled = true;
    button.title = `${label} — not available yet`;
    pvActions.append(button);
  }
  const pvHead = el('div', 'ifg-context__head');
  pvHead.append(el('small', undefined, 'FIELD REPORT'), pvName, pvFocus, pvClose);
  provincePanel.append(pvHead, pvGrid, pvReserved, pvActions);

  const armyPanel = el('div', 'ifg-context__army');
  armyPanel.hidden = true;
  context.append(contextEmpty, provincePanel, armyPanel);

  // ---- Pause / system overlay ------------------------------------------
  const overlay = el('div', 'ifg-overlay');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'System menu');
  const overlayCard = el('div', 'ifg-overlay__card');
  overlayCard.innerHTML = '<header class="ifg-overlay__head"><small>Command</small><h2>Operations Paused</h2></header>';

  const resumeButton = el('button', 'ifg-overlay__primary', 'Resume');
  resumeButton.type = 'button';
  resumeButton.addEventListener('click', () => actions.togglePause(false));

  const qualityGroup = el('div', 'ifg-overlay__quality');
  qualityGroup.setAttribute('role', 'group');
  qualityGroup.setAttribute('aria-label', 'Graphics quality');
  qualityGroup.append(el('small', undefined, 'GRAPHICS QUALITY'));
  const qualitySeg = el('div', 'ifg-seg');
  const qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  for (const level of QUALITY_LEVELS) {
    const button = el('button', 'ifg-seg__item');
    button.type = 'button';
    button.dataset.quality = level;
    button.textContent = QUALITY_PRESETS[level].label;
    button.addEventListener('click', () => actions.setQuality(level));
    qualityButtons.set(level, button);
    qualitySeg.append(button);
  }
  const qualityBlurb = el('p', 'ifg-overlay__blurb', '');
  qualityGroup.append(qualitySeg, qualityBlurb);

  const secondary = el('div', 'ifg-overlay__secondary');
  const settingsNote = el('button', 'ifg-overlay__link', 'More settings (main menu)');
  settingsNote.type = 'button';
  settingsNote.disabled = true;
  settingsNote.title = 'Full settings live in the main menu for now';
  const saveButton = el('button', 'ifg-overlay__link', 'Save');
  saveButton.type = 'button';
  saveButton.disabled = true;
  saveButton.title = 'Saving is not available yet';
  const menuButton = el('button', 'ifg-overlay__link', 'Return to Main Menu');
  menuButton.type = 'button';
  menuButton.disabled = true;
  menuButton.title = 'Returning to the menu mid-operation is not available yet';
  menuButton.addEventListener('click', () => actions.returnToMenu());
  secondary.append(settingsNote, saveButton, menuButton);

  const renderScaleLine = el('p', 'ifg-overlay__diag', '');
  overlayCard.append(resumeButton, qualityGroup, secondary, renderScaleLine);
  overlay.append(overlayCard);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) actions.togglePause(false);
  });

  root.append(topbar, rail, modeBar, notifyStack, context, overlay);
  document.body.append(root);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && store.get().phase === 'in-game') {
      actions.togglePause(!store.get().paused);
    }
  };
  window.addEventListener('keydown', onKey);

  // ---- Render (coalesced by the store) ---------------------------------
  const renderedResourceIds: string[] = [];
  let renderedNotificationIds = '';

  const render = (state: StrategicUiState): void => {
    root.hidden = state.phase !== 'in-game';
    root.dataset.phase = state.phase;
    inspectorButton.hidden = !state.debugEnabled;
    // The lobby reveals the "WORLD RENDERER" brand mark on launch; in-game the
    // command UI owns the presentation. `.brand { display:flex }` beats the
    // [hidden] attribute, so override inline. Re-asserted every render so it
    // outlasts the menu launch transition.
    const brand = document.querySelector<HTMLElement>('.brand');
    if (brand) brand.style.display = state.phase === 'in-game' ? 'none' : '';

    // Country
    if (state.playerCountry) {
      countryName.textContent = state.playerCountry.name;
      flagSwatch.style.setProperty('--flag', state.playerCountry.color);
    } else {
      countryName.textContent = 'Unassigned Command';
      flagSwatch.style.removeProperty('--flag');
    }

    // Resources (stable slots; null -> disabled "--")
    const ids = state.resources.map((r) => r.id).join(',');
    if (ids !== renderedResourceIds.join(',')) {
      resourceStrip.replaceChildren(...state.resources.map((line) => {
        const cell = el('span', 'ifg-res');
        cell.dataset.res = line.id;
        cell.append(
          el('small', 'ifg-res__label', line.label),
          el('b', 'ifg-res__value', ''),
        );
        return cell;
      }));
      renderedResourceIds.splice(0, renderedResourceIds.length, ...state.resources.map((r) => r.id));
    }
    for (const line of state.resources) {
      const cell = resourceStrip.querySelector<HTMLElement>(`[data-res="${line.id}"]`);
      if (!cell) continue;
      const value = cell.querySelector('.ifg-res__value')!;
      const pending = line.value === null;
      cell.classList.toggle('is-pending', pending);
      cell.classList.toggle('is-demo', Boolean(line.demo));
      value.textContent = pending ? '--' : numberFormat.format(line.value as number);
      cell.title = pending
        ? `${line.label}: economy system not implemented yet`
        : `${line.label}${line.demo ? ' (demo value)' : ''}`;
    }

    // Clock + weather
    clockValue.textContent = state.clock?.label ?? '--';
    clockPhase.textContent = state.clock ? 'World time' : 'Awaiting orders';
    weatherBadge.querySelector('span')!.textContent = state.weather.label;
    weatherBadge.querySelector('i')!.textContent = state.weather.raining ? '☂' : '☀';
    weatherBadge.classList.toggle('is-rain', state.weather.raining);

    // Map modes
    for (const [mode, button] of modeButtons) {
      button.classList.toggle('is-active', mode === state.mapMode);
      button.setAttribute('aria-pressed', String(mode === state.mapMode));
    }

    // Selected context
    const { selectedProvince: province, selectedArmy: army } = state;
    // Province selection takes the context slot; the army component shows only
    // when nothing else is selected.
    const showArmy = Boolean(army) && !province;
    contextEmpty.hidden = Boolean(province) || showArmy;
    provincePanel.hidden = !province;
    context.classList.toggle('is-open', Boolean(province) || showArmy);
    if (province) {
      pvName.textContent = province.name;
      pvOwner.textContent = province.owner;
      pvOwnerSwatch.style.setProperty('--swatch', province.ownerColor);
      pvTerrain.textContent = province.terrain;
    }
    armyPanel.hidden = !showArmy;
    if (showArmy && army) {
      armyPanel.replaceChildren(
        (() => { const h = el('div', 'ifg-context__head'); h.append(el('small', undefined, 'FIELD FORCE')); h.append(el('strong', 'ifg-context__title', army.name)); return h; })(),
        createArmyCounter(army),
        (() => {
          const grid = el('div', 'ifg-context__grid');
          for (const [label, value] of describeArmy(army)) {
            grid.append(el('span', 'ifg-field', `<small>${label.toUpperCase()}</small><b class="ifg-field__value">${value}</b>`));
          }
          return grid;
        })(),
      );
    }

    // Notifications
    const notifyKey = state.notifications.map((n) => n.id).join(',');
    if (notifyKey !== renderedNotificationIds) {
      notifyStack.replaceChildren(...state.notifications.map((n) => buildNotification(n, actions)));
      renderedNotificationIds = notifyKey;
    }

    // Pause overlay
    overlay.hidden = !state.paused;
    for (const [level, button] of qualityButtons) {
      const active = level === state.quality;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
    qualityBlurb.textContent = QUALITY_PRESETS[state.quality].blurb;
    renderScaleLine.textContent =
      `Effective render scale ${state.effectiveRenderScale.toFixed(2)}x  ·  ${state.quality.toUpperCase()}`;
  };

  render(store.get());
  const unsubscribe = store.subscribe(render);

  return {
    destroy() {
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}

function buildNotification(n: GameNotification, actions: GameUiActions): HTMLElement {
  const item = el('article', 'ifg-notify__item');
  item.dataset.kind = n.kind;
  item.innerHTML = `
    <span class="ifg-notify__glyph" aria-hidden="true">${NOTIFICATION_GLYPH[n.kind]}</span>
    <div class="ifg-notify__body">
      <strong>${escapeHtml(n.title)}</strong>
      ${n.body ? `<span>${escapeHtml(n.body)}</span>` : ''}
    </div>
    <button type="button" class="ifg-notify__dismiss" aria-label="Dismiss">×</button>
  `;
  item.querySelector('.ifg-notify__dismiss')!.addEventListener('click', () => actions.dismissNotification(n.id));
  return item;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
