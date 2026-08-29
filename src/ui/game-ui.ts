/**
 * In-game strategic command UI (v2).
 *
 * Builds the player HUD once, then updates cached nodes from a single
 * coalesced `render(state)` driven by `UiStore` subscription. No animation
 * loop, no `getBoundingClientRect` in rAF, no MutationObserver, no
 * Unicode/emoji icons. Map/renderer effects go through typed `GameUiActions`.
 *
 * The on-map resource / junction markers are a GPU instanced layer inside the
 * renderer — this module never projects or positions them.
 */

import './game-ui.css';
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel } from '../graphics/quality';
import { createArmyCounter, describeArmy } from './army';
import { createFlag } from './flags';
import { createIcon, type IconName } from './icons';
import type {
  GameNotification, MapMode, NavId, NotificationKind, ProvinceResourceTotals, StrategicUiState, UiStore,
} from './ui-state';

export interface GameUiActions {
  setMapMode(mode: MapMode): void;
  clearSelection(): void;
  setQuality(level: QualityLevel): void;
  navSelect(id: NavId): void;
  dismissNotification(id: string): void;
  togglePause(open: boolean): void;
  toggleResourceOverlay(on: boolean): void;
  returnToMenu(): void;
  openDebugInspector(): void;
  focusSelected?: () => void;
  /** Selected-army orders. 'deselect' clears the selection. */
  armyCommand(command: 'move' | 'stop' | 'extract' | 'deselect'): void;
  /** Queue a unit in the selected (own) province. */
  produceUnit(provinceId: number, unitTypeId: string): void;
  /** Start a building in the selected (own, urban) province. */
  buildStructure(provinceId: number, buildingId: string): void;
  /** Arm map-click placement of a production city's rally point, or clear it. */
  rallyPoint(provinceId: number, action: 'arm' | 'clear'): void;
}

export interface GameUiHandle {
  destroy(): void;
}

const MAP_MODES: ReadonlyArray<{ mode: MapMode; label: string; icon: IconName }> = [
  { mode: 'balanced', label: 'Strategic', icon: 'mode-strategic' },
  { mode: 'political', label: 'Political', icon: 'mode-political' },
  { mode: 'diplomacy', label: 'Diplomacy', icon: 'mode-diplomacy' },
  { mode: 'clear', label: 'Terrain', icon: 'mode-terrain' },
];

// Only near-term-meaningful sections. A finished game should not advertise a
// wall of unavailable systems; the rest arrive with their subsystems.
const DOCK_SECTIONS: ReadonlyArray<{ id: NavId; label: string; icon: IconName }> = [
  { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy' },
  { id: 'economy', label: 'Economy', icon: 'economy' },
  { id: 'events', label: 'Objectives', icon: 'objectives' },
];

const NOTE_ICON: Record<NotificationKind, IconName> = {
  warning: 'note-warning',
  combat: 'note-combat',
  completed: 'note-completed',
  diplomacy: 'note-diplomacy',
  information: 'note-information',
};

const RESOURCE_CHIPS: ReadonlyArray<{ key: keyof ProvinceResourceTotals; label: string; icon: IconName }> = [
  { key: 'stone', label: 'Stone', icon: 'node-stone' },
  { key: 'metal', label: 'Metal', icon: 'node-metal' },
  { key: 'oil', label: 'Oil', icon: 'node-oil' },
];

const PROVINCE_ACTIONS = ['Build', 'Produce', 'Rally', 'Inspect'] as const;
const RESERVED_FIELDS = ['Morale', 'Population', 'Supply', 'Victory pts'] as const;

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

  // ---------------- top strategic bar ----------------
  const topbar = el('header', 'ifg-topbar');
  topbar.setAttribute('aria-label', 'Strategic command bar');

  const countryBlock = el('div', 'ifg-topbar__country');
  let flagHost = el('span', 'ifg-topbar__flag');
  const countryName = el('strong', 'ifg-topbar__country-name', 'Unassigned Command');
  countryBlock.append(flagHost, countryName);

  const resourceStrip = el('div', 'ifg-topbar__resources');
  resourceStrip.setAttribute('role', 'group');
  resourceStrip.setAttribute('aria-label', 'National resources');
  const resourceIcon: Partial<Record<string, IconName>> = {
    money: 'funds', manpower: 'manpower', food: 'food',
    stone: 'node-stone', metal: 'metal', oil: 'oil',
  };

  const clockBlock = el('div', 'ifg-topbar__clock');
  const clockValue = el('b', undefined, '--');
  clockBlock.append(clockValue);

  const weatherChip = el('span', 'ifg-topbar__weather');
  weatherChip.title = 'Weather';
  weatherChip.append(createIcon('weather-clear'));

  const systemButton = el('button', 'ifg-topbar__system');
  systemButton.type = 'button';
  systemButton.title = 'System menu';
  systemButton.setAttribute('aria-label', 'Open system menu');
  systemButton.append(createIcon('system'));
  systemButton.addEventListener('click', () => actions.togglePause(!store.get().paused));

  topbar.append(countryBlock, resourceStrip, clockBlock, weatherChip, systemButton);

  // ---------------- floating command dock (top-left, short) ----------------
  const dock = el('nav', 'ifg-dock');
  dock.setAttribute('aria-label', 'Command');

  const overlayToggle = el('button', 'ifg-dock__btn ifg-dock__btn--primary');
  overlayToggle.type = 'button';
  overlayToggle.title = 'Resource deposits';
  overlayToggle.setAttribute('aria-label', 'Toggle resource deposits');
  overlayToggle.append(createIcon('resource-overlay'), el('span', 'ifg-dock__tip', 'Resources'));
  overlayToggle.addEventListener('click', () => actions.toggleResourceOverlay(!store.get().resourceOverlay));

  const expandBtn = el('button', 'ifg-dock__btn ifg-dock__expand');
  expandBtn.type = 'button';
  expandBtn.title = 'More';
  expandBtn.setAttribute('aria-expanded', 'false');
  expandBtn.append(createIcon('expand'));

  const dockMore = el('div', 'ifg-dock__more');
  dockMore.hidden = true;
  for (const section of DOCK_SECTIONS) {
    const b = el('button', 'ifg-dock__btn');
    b.type = 'button';
    b.disabled = true;
    b.dataset.nav = section.id;
    b.title = `${section.label} — not available yet`;
    b.setAttribute('aria-label', `${section.label} (not available yet)`);
    b.append(createIcon(section.icon), el('span', 'ifg-dock__tip', section.label));
    b.addEventListener('click', () => actions.navSelect(section.id));
    dockMore.append(b);
  }
  expandBtn.addEventListener('click', () => {
    const open = dockMore.hidden;
    dockMore.hidden = !open;
    expandBtn.setAttribute('aria-expanded', String(open));
    expandBtn.classList.toggle('is-open', open);
  });
  dock.append(overlayToggle, dockMore, expandBtn);

  // ---------------- map-mode cluster (top-right) ----------------
  const modeCluster = el('div', 'ifg-modes');
  modeCluster.setAttribute('role', 'group');
  modeCluster.setAttribute('aria-label', 'Map mode');
  const modeButtons = new Map<MapMode, HTMLButtonElement>();
  for (const { mode, label, icon } of MAP_MODES) {
    const button = el('button', 'ifg-modes__item');
    button.type = 'button';
    button.dataset.mode = mode;
    button.title = label;
    button.append(createIcon(icon), el('span', 'ifg-modes__label', label));
    button.addEventListener('click', () => actions.setMapMode(mode));
    modeButtons.set(mode, button);
    modeCluster.append(button);
  }
  const inspectorButton = el('button', 'ifg-modes__inspector', 'F3');
  inspectorButton.type = 'button';
  inspectorButton.title = 'World inspector';
  inspectorButton.hidden = true;
  inspectorButton.addEventListener('click', () => actions.openDebugInspector());
  modeCluster.append(inspectorButton);

  // ---------------- notifications ----------------
  const notifyStack = el('div', 'ifg-notify');
  notifyStack.setAttribute('aria-live', 'polite');
  notifyStack.setAttribute('aria-label', 'Events');

  // ---------------- selected province card (compact, bottom-left) ----------------
  const provinceCard = el('section', 'ifg-card ifg-card--province');
  provinceCard.hidden = true;
  provinceCard.setAttribute('aria-live', 'polite');

  const pvName = el('strong', 'ifg-card__title', '');
  const pvSub = el('span', 'ifg-card__sub', '');
  const pvClose = el('button', 'ifg-card__close');
  pvClose.type = 'button';
  pvClose.title = 'Clear selection';
  pvClose.setAttribute('aria-label', 'Clear selection');
  pvClose.append(createIcon('close'));
  pvClose.addEventListener('click', () => actions.clearSelection());

  const pvFlagHost = el('span', 'ifg-card__flag');
  const pvHead = el('header', 'ifg-card__head');
  const pvHeadText = el('span', 'ifg-card__headtext');
  pvHeadText.append(pvName, pvSub);

  const pvFocusBtn = el('button', 'ifg-card__iconbtn');
  pvFocusBtn.type = 'button';
  pvFocusBtn.title = 'Centre map on province';
  pvFocusBtn.setAttribute('aria-label', 'Centre map on province');
  pvFocusBtn.append(createIcon('focus'));
  if (actions.focusSelected) {
    pvFocusBtn.addEventListener('click', () => actions.focusSelected?.());
  } else {
    pvFocusBtn.disabled = true;
    pvFocusBtn.title = 'Centre map — not available yet';
  }
  pvHead.append(pvFlagHost, pvHeadText, pvFocusBtn, pvClose);

  const pvGrid = el('div', 'ifg-card__grid');
  for (const label of RESERVED_FIELDS) {
    pvGrid.append(el('span', 'ifg-field is-pending',
      `<small>${label}</small><b>--</b>`));
  }

  // RESOURCES — deposit abundance in the province (not production/day). Hidden
  // when the province holds no known deposits, or (under fog) for foreign land.
  const pvResources = el('div', 'ifg-card__resources');
  pvResources.hidden = true;
  pvResources.append(el('small', 'ifg-card__restitle', 'Deposits'));
  const pvResChips = el('div', 'ifg-card__reschips');
  const pvResChipByKey = new Map<keyof ProvinceResourceTotals, { chip: HTMLElement; value: HTMLElement }>();
  for (const { key, label, icon } of RESOURCE_CHIPS) {
    const chip = el('span', 'ifg-rchip');
    chip.title = `${label} deposits (strategic abundance)`;
    chip.append(createIcon(icon, 'ifg-rchip__icon'));
    const value = el('b', 'ifg-rchip__value', '0');
    chip.append(value);
    pvResChipByKey.set(key, { chip, value });
    pvResChips.append(chip);
  }
  const pvCoastalChip = el('span', 'ifg-rchip ifg-rchip--coastal');
  pvCoastalChip.title = 'Sea access';
  pvCoastalChip.append(createIcon('resource-water', 'ifg-rchip__icon'), el('b', 'ifg-rchip__value', 'Coast'));
  pvCoastalChip.hidden = true;
  pvResChips.append(pvCoastalChip);
  pvResources.append(pvResChips);
  const pvResStatus = el('small', 'ifg-card__resstatus');
  pvResStatus.hidden = true;
  pvResources.append(pvResStatus);

  // PRODUCE — real unit queue for an owned province with the right building.
  const pvProduce = el('div', 'ifg-card__resources');
  pvProduce.hidden = true;
  pvProduce.append(el('small', 'ifg-card__restitle', 'Produce'));
  const pvProduceList = el('div', 'ifg-card__prodlist');
  pvProduce.append(pvProduceList);
  const pvQueue = el('small', 'ifg-card__resstatus');
  pvQueue.hidden = true;
  pvProduce.append(pvQueue);
  const pvRally = el('div', 'ifg-card__actions');
  pvRally.hidden = true;
  const pvRallyBtn = el('button', 'ifg-card__act');
  pvRallyBtn.type = 'button';
  const pvRallyClear = el('button', 'ifg-card__act');
  pvRallyClear.type = 'button';
  pvRallyClear.textContent = 'Clear rally';
  pvRally.append(pvRallyBtn, pvRallyClear);
  pvProduce.append(pvRally);

  // BUILD — construct a production building in an owned urban province.
  const pvBuild = el('div', 'ifg-card__resources');
  pvBuild.hidden = true;
  pvBuild.append(el('small', 'ifg-card__restitle', 'Build'));
  const pvBuildList = el('div', 'ifg-card__prodlist');
  pvBuild.append(pvBuildList);
  const pvConstruction = el('small', 'ifg-card__resstatus');
  pvConstruction.hidden = true;
  pvBuild.append(pvConstruction);

  const pvActions = el('div', 'ifg-card__actions');
  for (const label of PROVINCE_ACTIONS) {
    if (label === 'Produce' || label === 'Build') continue; // real panels above
    const b = el('button', 'ifg-card__act');
    b.type = 'button';
    b.textContent = label;
    b.disabled = true;
    b.title = `${label} — not available yet`;
    pvActions.append(b);
  }
  provinceCard.append(pvHead, pvGrid, pvResources, pvProduce, pvBuild, pvActions);

  // ---------------- army card (dev fixture only) ----------------
  const armyCard = el('section', 'ifg-card ifg-card--army');
  armyCard.hidden = true;

  // ---------------- pause / system overlay ----------------
  const overlay = el('div', 'ifg-overlay');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'System menu');
  const overlayCard = el('div', 'ifg-overlay__card');
  overlayCard.innerHTML =
    '<header class="ifg-overlay__head"><small>Command</small><h2>Operations Paused</h2></header>';

  const resumeButton = el('button', 'ifg-overlay__primary', 'Resume');
  resumeButton.type = 'button';
  resumeButton.addEventListener('click', () => actions.togglePause(false));

  const qualityGroup = el('div', 'ifg-overlay__group');
  qualityGroup.setAttribute('role', 'group');
  qualityGroup.setAttribute('aria-label', 'Graphics quality');
  qualityGroup.append(el('small', undefined, 'Graphics quality'));
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
  for (const [label, title] of [
    ['More settings (main menu)', 'Full settings live in the main menu for now'],
    ['Save', 'Saving is not available yet'],
    ['Return to Main Menu', 'Returning to the menu mid-operation is not available yet'],
  ] as const) {
    const b = el('button', 'ifg-overlay__link', label);
    b.type = 'button';
    b.disabled = true;
    b.title = title;
    if (label.startsWith('Return')) b.addEventListener('click', () => actions.returnToMenu());
    secondary.append(b);
  }
  const diagLine = el('p', 'ifg-overlay__diag', '');
  overlayCard.append(resumeButton, qualityGroup, secondary, diagLine);
  overlay.append(overlayCard);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) actions.togglePause(false);
  });

  root.append(topbar, dock, modeCluster, notifyStack, provinceCard, armyCard, overlay);
  document.body.append(root);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && store.get().phase === 'in-game') {
      actions.togglePause(!store.get().paused);
    }
  };
  window.addEventListener('keydown', onKey);

  // ---------------- render (store-coalesced) ----------------
  // Cache keys so a patch that did not change a given slice does no DOM work
  // (the clock patches on every in-game minute; nothing below it should churn).
  let resourceSlots = '';
  let notifyKey = '';
  let armyKey = '';
  let flagKey = '';
  let weatherKey = '';
  let pvFlagKey = '';
  let pvResourceKey = '';

  const render = (state: StrategicUiState): void => {
    root.hidden = state.phase !== 'in-game';
    root.dataset.phase = state.phase;
    inspectorButton.hidden = !state.debugEnabled;

    // `.brand { display:flex }` beats [hidden]; override inline, re-asserted so
    // it outlasts the menu launch transition.
    const brand = document.querySelector<HTMLElement>('.brand');
    if (brand) brand.style.display = state.phase === 'in-game' ? 'none' : '';

    // Country identity — real flag, colour standard only as fallback.
    const pc = state.playerCountry;
    countryName.textContent = pc ? pc.name : 'Unassigned Command';
    const nextFlagKey = `${pc?.name ?? ''}|${pc?.color ?? ''}`;
    if (nextFlagKey !== flagKey) {
      flagKey = nextFlagKey;
      const nextFlag = createFlag(pc?.name ?? null, pc?.color ?? '#8a8f88', 'command');
      flagHost.replaceWith(nextFlag);
      nextFlag.classList.add('ifg-topbar__flag');
      flagHost = nextFlag;
    }

    // Resources — icon + value chips.
    const slots = state.resources.map((r) => r.id).join(',');
    if (slots !== resourceSlots) {
      resourceStrip.replaceChildren(...state.resources.map((line) => {
        const chip = el('span', 'ifg-res');
        chip.dataset.res = line.id;
        const ic = resourceIcon[line.id];
        if (ic) chip.append(createIcon(ic, 'ifg-res__icon'));
        chip.append(el('b', 'ifg-res__value', ''));
        return chip;
      }));
      resourceSlots = slots;
    }
    for (const line of state.resources) {
      const chip = resourceStrip.querySelector<HTMLElement>(`[data-res="${line.id}"]`);
      if (!chip) continue;
      const pending = line.value === null;
      chip.classList.toggle('is-pending', pending);
      chip.classList.toggle('is-demo', Boolean(line.demo));
      chip.querySelector('.ifg-res__value')!.textContent =
        pending ? '--' : numberFormat.format(line.value as number);
      chip.title = pending
        ? `${line.label} — economy not implemented yet`
        : `${line.label}${line.demo ? ' (demo)' : ''}`;
    }

    // Clock + weather.
    clockValue.textContent = state.clock?.label ?? '--';
    const nextWeatherKey = `${state.weather.raining}|${state.weather.label}`;
    if (nextWeatherKey !== weatherKey) {
      weatherKey = nextWeatherKey;
      weatherChip.replaceChildren(createIcon(state.weather.raining ? 'weather-rain' : 'weather-clear'));
      weatherChip.title = `Weather — ${state.weather.label}`;
      weatherChip.classList.toggle('is-rain', state.weather.raining);
    }

    // Map modes.
    for (const [mode, button] of modeButtons) {
      const active = mode === state.mapMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    // Resource overlay toggle state.
    overlayToggle.classList.toggle('is-on', state.resourceOverlay);
    overlayToggle.setAttribute('aria-pressed', String(state.resourceOverlay));

    // Selected province card.
    const province = state.selectedProvince;
    const army = state.selectedArmy;
    provinceCard.hidden = !province;
    if (province) {
      const ownTag = province.isOwn === true ? ' · Your territory'
        : province.isOwn === false ? ' · Foreign' : '';
      pvName.textContent = province.name;
      pvSub.textContent = `${province.owner} · ${province.terrain}${ownTag}`;
      provinceCard.classList.toggle('is-foreign', province.isOwn === false);
      // Command actions only make sense on land the player controls.
      pvActions.hidden = province.isOwn === false;
      const nextPvFlagKey = `${province.owner}|${province.ownerColor}`;
      if (nextPvFlagKey !== pvFlagKey) {
        pvFlagKey = nextPvFlagKey;
        pvFlagHost.replaceChildren(createFlag(province.owner, province.ownerColor, 'inline'));
      }
      const res = province.resources;
      const dep = province.deposits ?? null;
      const nextPvResourceKey = [
        res ? `${res.stone}/${res.metal}/${res.oil}` : '-',
        province.coastal ? 'c' : '',
        dep ? `${dep.controlled ? 'C' : ''}${dep.extracting ? 'E' : ''}` : '',
        province.isOwn,
        (province.producible ?? []).map((u) => u.id).join(','),
        (province.queue ?? []).join(','),
        (province.buildable ?? []).map((b) => b.id).join(','),
        (province.construction ?? []).join(','),
        province.rally ? `${Math.round(province.rally.x)},${Math.round(province.rally.z)}` : '-',
        province.awaitingRallyTarget ? 'arm' : '',
      ].join('|');
      if (nextPvResourceKey !== pvResourceKey) {
        pvResourceKey = nextPvResourceKey;
        const hasDeposits = Boolean(res && (res.stone > 0 || res.metal > 0 || res.oil > 0));
        pvResources.hidden = !hasDeposits && !province.coastal;
        if (res) {
          for (const { key } of RESOURCE_CHIPS) {
            const slot = pvResChipByKey.get(key)!;
            const amount = res[key];
            slot.chip.hidden = amount <= 0;
            slot.value.textContent = numberFormat.format(amount);
          }
        } else {
          for (const { key } of RESOURCE_CHIPS) pvResChipByKey.get(key)!.chip.hidden = true;
        }
        pvCoastalChip.hidden = province.coastal !== true;

        // PRODUCE panel.
        const prod = province.producible ?? [];
        pvProduce.hidden = !(province.isOwn && prod.length > 0);
        if (province.isOwn && prod.length > 0) {
          pvProduceList.replaceChildren(...prod.map((u) => {
            const b = el('button', 'ifg-card__act');
            b.type = 'button';
            b.textContent = u.name;
            b.title = u.costLabel;
            b.addEventListener('click', () => actions.produceUnit(province.id, u.id));
            return b;
          }));
          const q = province.queue ?? [];
          pvQueue.hidden = q.length === 0;
          pvQueue.textContent = q.length ? `Queue: ${q.join(', ')}` : '';

          // Rally point: where finished units march. Placed by a map click.
          pvRally.hidden = false;
          pvRallyBtn.textContent = province.awaitingRallyTarget
            ? 'Click map…'
            : province.rally ? 'Move rally' : 'Set rally point';
          pvRallyBtn.classList.toggle('is-active', province.awaitingRallyTarget === true);
          pvRallyBtn.onclick = () => actions.rallyPoint(province.id, 'arm');
          pvRallyClear.hidden = !province.rally;
          pvRallyClear.onclick = () => actions.rallyPoint(province.id, 'clear');
        } else {
          pvRally.hidden = true;
        }

        // BUILD panel — offered buildings and anything under construction.
        const buildable = province.buildable ?? [];
        const construction = province.construction ?? [];
        pvBuild.hidden = !province.isOwn || (buildable.length === 0 && construction.length === 0);
        if (!pvBuild.hidden) {
          pvBuildList.replaceChildren(...buildable.map((b) => {
            const btn = el('button', 'ifg-card__act');
            btn.type = 'button';
            btn.textContent = b.name;
            btn.title = b.costLabel;
            btn.addEventListener('click', () => actions.buildStructure(province.id, b.id));
            return btn;
          }));
          pvConstruction.hidden = construction.length === 0;
          pvConstruction.textContent = construction.length
            ? `Under construction: ${construction.join(', ')}` : '';
        }

        if (dep && hasDeposits) {
          pvResStatus.hidden = false;
          pvResStatus.textContent = dep.extracting
            ? 'Extraction under way'
            : dep.controlled ? 'Controlled — secure with an army to extract' : 'Uncontrolled';
          pvResStatus.classList.toggle('is-active', dep.extracting);
        } else {
          pvResStatus.hidden = true;
        }
      }
    }

    // Army card — shown whenever a stack is selected (province takes priority).
    const showArmy = Boolean(army) && !province;
    armyCard.hidden = !showArmy;
    const groupsKey = army?.groups?.map((g) => `${g.label}${g.count}${g.health.toFixed(2)}`).join('|') ?? '';
    const nextArmyKey = showArmy && army
      ? `${army.id}|${army.combat}|${army.selected}|${groupsKey}|${army.awaitingMoveTarget}|${army.canExtract}|${army.identified}`
      : '';
    if (nextArmyKey !== armyKey) {
      armyKey = nextArmyKey;
      if (showArmy && army) {
        const head = el('header', 'ifg-card__head');
        head.append(el('strong', 'ifg-card__title', army.name));
        const close = el('button', 'ifg-card__close');
        close.type = 'button';
        close.append(createIcon('close'));
        close.addEventListener('click', () => actions.armyCommand('deselect'));
        head.append(close);

        const grid = el('div', 'ifg-card__grid');
        for (const [label, value] of describeArmy(army)) {
          grid.append(el('span', 'ifg-field', `<small>${label}</small><b>${value}</b>`));
        }

        const children: HTMLElement[] = [head, createArmyCounter(army), grid];

        if (army.groups && army.groups.length > 0) {
          const comp = el('div', 'ifg-card__resources');
          comp.append(el('small', 'ifg-card__restitle', 'Composition'));
          const row = el('div', 'ifg-card__reschips');
          for (const g of army.groups) {
            const chip = el('span', 'ifg-rchip');
            chip.title = `${g.label} — ${Math.round(g.health * 100)}% strength`;
            chip.append(el('b', 'ifg-rchip__value', `${g.label} ×${g.count}`));
            row.append(chip);
          }
          comp.append(row);
          children.push(comp);
        }

        if (army.own) {
          const cmd = el('div', 'ifg-card__actions');
          const mk = (label: string, key: 'move' | 'stop' | 'extract', enabled: boolean, active = false) => {
            const b = el('button', 'ifg-card__act');
            b.type = 'button';
            b.textContent = label;
            b.disabled = !enabled;
            b.classList.toggle('is-active', active);
            if (enabled) b.addEventListener('click', () => actions.armyCommand(key));
            return b;
          };
          cmd.append(
            mk(army.awaitingMoveTarget ? 'Click map…' : 'Move', 'move', true, army.awaitingMoveTarget === true),
            mk('Stop', 'stop', army.combat !== 'idle' || army.awaitingMoveTarget === true),
            mk('Extract', 'extract', army.canExtract === true),
          );
          children.push(cmd);
        }

        armyCard.replaceChildren(...children);
      }
    }

    // Notifications.
    const nextNotifyKey = state.notifications.map((n) => n.id).join(',');
    if (nextNotifyKey !== notifyKey) {
      notifyStack.replaceChildren(...state.notifications.map((n) => buildNotification(n, actions)));
      notifyKey = nextNotifyKey;
    }

    // Pause overlay.
    overlay.hidden = !state.paused;
    for (const [level, button] of qualityButtons) {
      const active = level === state.quality;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
    qualityBlurb.textContent = QUALITY_PRESETS[state.quality].blurb;
    diagLine.textContent =
      `Effective render scale ${state.effectiveRenderScale.toFixed(2)}x · ${state.quality.toUpperCase()}`;
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
  const icon = createIcon(NOTE_ICON[n.kind], 'ifg-notify__icon');
  const body = el('div', 'ifg-notify__body');
  body.append(el('strong', undefined, n.title));
  if (n.body) body.append(el('span', undefined, n.body));
  const dismiss = el('button', 'ifg-notify__dismiss');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.append(createIcon('close'));
  dismiss.addEventListener('click', () => actions.dismissNotification(n.id));
  item.append(icon, body, dismiss);
  return item;
}
