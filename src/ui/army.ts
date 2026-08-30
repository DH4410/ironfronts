/**
 * Army / unit UI components: the map counter and the selected-stack readout.
 *
 * These render the fog-aware `ArmyStackView` projection that `main.ts` builds
 * from authoritative GameState (see `game/player-view.ts`) — an unidentified
 * contact shows a '?' counter and a strength-unknown readout. `DEMO_ARMY` is a
 * dev / `?debug` fixture only, gated by the caller.
 */

import { createIcon, iconMarkup } from './icons';
import type { ArmyStackView, CombatStatus } from './ui-state';

export type { ArmyStackView, CombatStatus } from './ui-state';

const COMBAT_LABEL: Record<CombatStatus, string> = {
  idle: 'Holding',
  moving: 'On the march',
  engaged: 'In combat',
  retreating: 'Withdrawing',
};

/**
 * Compact map counter for a stacked force. Original Ironfronts styling: a
 * stamped brass-cornered charcoal chit, not a NATO symbol. Purely presentational
 * — positioning on the map is the caller's job once armies have world coords.
 */
export function createArmyCounter(army: ArmyStackView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ifg-counter';
  el.dataset.combat = army.combat;
  el.classList.toggle('is-selected', army.selected);
  el.style.setProperty('--counter-country', army.countryColor);
  el.setAttribute('role', 'img');
  const unidentified = army.identified === false;
  el.classList.toggle('is-unidentified', unidentified);
  el.setAttribute('aria-label', unidentified
    ? `Unidentified ${army.country} force — strength unknown`
    : `${army.name}: ${army.unitCount} units, ${Math.round(army.strength * 100)}% strength, ${COMBAT_LABEL[army.combat]}`);
  el.innerHTML = `
    <span class="ifg-counter__corner ifg-counter__corner--tl"></span>
    <span class="ifg-counter__corner ifg-counter__corner--br"></span>
    <b class="ifg-counter__count">${unidentified ? '?' : army.unitCount}</b>
    ${iconMarkup('note-combat', 'ifg-counter__glyph')}
    <span class="ifg-counter__bar"><i style="width:${unidentified ? 0 : Math.round(army.health * 100)}%"></i></span>
  `;
  return el;
}

/** Detailed selected-stack readout for the contextual panel. */
export function describeArmy(army: ArmyStackView): Array<[string, string]> {
  if (army.identified === false) {
    // Contact only: we know where it is and whose it is, nothing more.
    return [
      ['Force', 'Unidentified'],
      ['Command', army.country],
      ['Intel', 'Position only — strength unknown'],
    ];
  }
  return [
    ['Force', army.name],
    ['Command', army.country],
    ['Divisions', String(army.unitCount)],
    ['Strength', `${Math.round(army.strength * 100)}%`],
    ['Readiness', `${Math.round(army.health * 100)}%`],
    ['Status', COMBAT_LABEL[army.combat]],
  ];
}

export type ArmyPanelCommand =
  | 'move' | 'attack' | 'retreat' | 'split' | 'stop' | 'extract' | 'deselect'
  | `retreat:${number}`;

const UNIT_GLYPHS: Readonly<Record<string, string>> = {
  infantry: '<circle cx="24" cy="10" r="5"/><path d="M17 42l2-17 5-7 5 7 2 17M12 25l12 5 13-12M29 26l9 16"/>',
  engineer: '<path d="M14 16h20l-2-7H16zM12 19h24M24 19v22M16 41h16M14 28h20"/><path d="M31 23l8 8m0-8-8 8"/>',
  'armored-car': '<path d="M7 31h34l-3-12H18l-7 6zM15 19l5-7h13l5 7M13 31v5h24v-5"/><circle cx="16" cy="37" r="4"/><circle cx="34" cy="37" r="4"/>',
  'light-tank': '<path d="M7 31h35l-4-13H16l-6 6zM17 18l4-7h15v7M28 11V7h11"/><path d="M10 35h30M13 39h24"/><circle cx="17" cy="35" r="3"/><circle cx="33" cy="35" r="3"/>',
  'medium-tank': '<path d="M5 31h39l-4-15H15l-7 8zM16 16l5-8h16v8M29 8V5h15"/><path d="M8 35h34M12 40h26"/><circle cx="15" cy="35" r="3"/><circle cx="25" cy="35" r="3"/><circle cx="35" cy="35" r="3"/>',
  artillery: '<path d="M8 35h27M17 35l8-13 17-9M24 22l9 8M37 10l5 3-3 5"/><circle cx="17" cy="36" r="6"/><circle cx="34" cy="36" r="4"/>',
};

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createUnitGlyph(typeId: string, label: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ifg-army-unit__glyph');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.innerHTML = UNIT_GLYPHS[typeId] ?? '<path d="M8 34h32V14H8zM14 20h20M14 27h20"/>';
  return svg;
}

function appendStat(host: HTMLElement, label: string, value: string): void {
  const stat = node('span', 'ifg-army-stat');
  stat.append(node('small', undefined, label), node('b', undefined, value));
  host.append(stat);
}

/** Populate the large centered selected-army command overlay. */
export function renderSelectedArmyPanel(
  host: HTMLElement,
  army: ArmyStackView,
  onCommand: (command: ArmyPanelCommand) => void,
): void {
  host.style.setProperty('--army-country', army.countryColor);
  host.dataset.combat = army.combat;
  host.setAttribute('aria-label', `${army.name}, ${army.country}`);

  const header = node('header', 'ifg-army-panel__header');
  const identity = node('span', 'ifg-army-panel__identity');
  identity.append(node('strong', undefined, army.name), node('small', undefined, army.country));
  const close = node('button', 'ifg-army-panel__close');
  close.type = 'button';
  close.title = 'Deselect army';
  close.setAttribute('aria-label', 'Deselect army');
  close.append(createIcon('close'));
  close.addEventListener('click', () => onCommand('deselect'));
  header.append(node('span', 'ifg-army-panel__header-spacer'), identity, close);

  const health = node('section', 'ifg-army-panel__health');
  health.append(node('small', 'ifg-army-panel__eyebrow', 'Health'));
  if (army.identified === false) {
    health.append(node('b', 'ifg-army-panel__health-value', '--'), node('span', 'ifg-army-panel__unknown', 'Unknown strength'));
  } else {
    const healthPercent = Math.round(army.health * 100);
    health.append(node('b', 'ifg-army-panel__health-value', `${healthPercent}%`));
    const healthTrack = node('span', 'ifg-army-panel__health-track');
    const healthFill = node('i', 'ifg-army-panel__health-fill');
    healthFill.style.width = `${healthPercent}%`;
    healthTrack.append(healthFill);
    health.append(healthTrack, node('span', 'ifg-army-panel__health-caption', `${healthPercent} / 100 readiness`));
  }

  const commands = node('div', 'ifg-army-panel__commands ifg-army-panel__commands--primary');
  const command = (label: string, key: ArmyPanelCommand, enabled: boolean, active = false): HTMLButtonElement => {
    const button = node('button', 'ifg-army-panel__command', label);
    button.type = 'button';
    button.disabled = !enabled;
    button.classList.toggle('is-active', active);
    if (enabled) button.addEventListener('click', () => onCommand(key));
    return button;
  };
  if (army.own) {
    commands.append(
      command(army.targetingMode === 'move' ? 'Select destination' : 'Move', 'move', army.canMove === true, army.targetingMode === 'move'),
      command(army.targetingMode === 'attack' ? 'Select target' : 'Attack', 'attack', army.canAttack === true, army.targetingMode === 'attack'),
      command(army.targetingMode === 'retreat' ? 'Select exit' : 'Retreat', 'retreat', army.canRetreat === true, army.targetingMode === 'retreat'),
      command(army.targetingMode === 'split' ? 'Select destination' : 'Split', 'split', army.canSplit === true, army.targetingMode === 'split'),
      command('Stop', 'stop', army.canStop === true),
      command('Extract', 'extract', army.canExtract === true),
    );
  }

  const composition = node('section', 'ifg-army-panel__composition');
  composition.append(node('small', 'ifg-army-panel__eyebrow', 'Composition'));
  const unitRow = node('div', 'ifg-army-panel__units');
  if (army.identified === false || !army.groups?.length) {
    unitRow.append(node('span', 'ifg-army-panel__intel', 'Composition unavailable'));
  } else {
    for (const group of army.groups) {
      const unit = node('article', 'ifg-army-unit');
      unit.dataset.unitType = group.typeId;
      unit.title = `${group.label}: ${group.count} troops, ${Math.round(group.health * 100)}% health`;
      const visual = node('span', 'ifg-army-unit__visual');
      visual.append(createUnitGlyph(group.typeId, group.label));
      const details = node('span', 'ifg-army-unit__details');
      details.append(node('strong', undefined, group.label), node('b', undefined, `×${group.count}`));
      const condition = node('span', 'ifg-army-unit__condition');
      const conditionFill = node('i');
      conditionFill.style.width = `${Math.round(group.health * 100)}%`;
      condition.append(conditionFill);
      unit.append(visual, details, condition);
      unitRow.append(unit);
    }
  }
  composition.append(unitRow);

  const report = node('section', 'ifg-army-panel__report');
  const stats = node('div', 'ifg-army-panel__stats');
  stats.append(node('small', 'ifg-army-panel__eyebrow', 'Troop stats'));
  const statGrid = node('div', 'ifg-army-panel__stat-grid');
  if (army.identified === false) {
    appendStat(statGrid, 'Troops', '--');
    appendStat(statGrid, 'Attack', '--');
    appendStat(statGrid, 'Defence', '--');
    appendStat(statGrid, 'Speed', '--');
  } else {
    appendStat(statGrid, 'Troops', String(army.unitCount));
    const profile = (value: typeof army.attack): string => value
      ? `${Math.round(value.soft)} / ${Math.round(value.light)} / ${Math.round(value.heavy)}` : '--';
    appendStat(statGrid, 'Attack S/L/H', profile(army.attack));
    appendStat(statGrid, 'Defence S/L/H', profile(army.defense));
    appendStat(statGrid, 'Speed', army.speed === undefined ? '--' : String(Math.round(army.speed)));
  }
  stats.append(statGrid);

  const activity = node('div', 'ifg-army-panel__activity');
  const remaining = (tick: number): string => {
    const seconds = Math.max(0, Math.ceil((tick - (army.simulationTick ?? 0)) / 10));
    return seconds === 0 ? 'Ready' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  if (army.combat === 'engaged' && army.battleFronts?.length) {
    activity.append(node('small', 'ifg-army-panel__eyebrow', 'Combat overview'));
    for (const front of army.battleFronts) {
      const line = node('article', 'ifg-army-panel__front');
      line.append(
        node('strong', undefined, `${front.role === 'attack' ? 'Attack' : 'Defence'} · direction ${front.directionNodeId}`),
        node('span', undefined, `Friendly ${Math.ceil(front.friendlyHp)} / ${Math.ceil(front.friendlyBaselineHp)} HP · ${remaining(front.friendlyNextVolleyTick)}`),
        node('span', undefined, `Enemy ${Math.ceil(front.enemyHp)} / ${Math.ceil(front.enemyBaselineHp)} HP · ${remaining(front.enemyNextVolleyTick)}`),
        node('small', undefined, front.reinforcementCount ? `${front.reinforcementCount} reinforcing army(s)` : 'No reinforcements'),
      );
      activity.append(line);
    }
    if (army.legalRetreatExits && army.legalRetreatExits.length > 1) {
      const exits = node('div', 'ifg-army-panel__retreat-exits');
      for (const [index, exit] of army.legalRetreatExits.entries()) {
        exits.append(command(`Retreat exit ${index + 1}`, `retreat:${exit.firstNodeId}`, true));
      }
      activity.append(exits);
    }
  } else {
    activity.append(node('small', 'ifg-army-panel__eyebrow', 'Activity'));
    const activityValue = node('strong', 'ifg-army-panel__activity-value', army.activity);
    activityValue.dataset.combat = army.combat;
    activity.append(activityValue);
    if (army.artillery?.targetArmyId) {
      activity.append(node('span', undefined,
        `${army.artillery.manualTarget ? 'Selected' : 'Automatic'} bombardment: ${army.artillery.targetArmyId} · ${remaining(army.artillery.nextVolleyTick)}`));
    }
  }
  report.append(stats, activity);

  const body = node('div', 'ifg-army-panel__body');
  const center = node('div', 'ifg-army-panel__center');
  center.append(commands, composition);
  body.append(health, center, report);
  host.replaceChildren(header, body);
}

/**
 * SVG marker for a movement / attack order arrow. Styling only — it encodes no
 * game rules and is not placed until a movement system supplies path points.
 */
export function createOrderArrow(kind: 'move' | 'attack'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ifg-order-arrow ifg-order-arrow--${kind}`);
  svg.setAttribute('viewBox', '0 0 100 24');
  svg.innerHTML = `
    <defs>
      <marker id="ifg-arrowhead-${kind}" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" />
      </marker>
    </defs>
    <line x1="4" y1="12" x2="86" y2="12" marker-end="url(#ifg-arrowhead-${kind})" />
  `;
  return svg;
}

/** Dev-only demonstration stack for screenshots / component tests. */
export const DEMO_ARMY: ArmyStackView = {
  id: 'demo-1',
  country: 'France',
  countryColor: '#3f6cae',
  name: '1re Armée',
  unitCount: 12,
  strength: 0.82,
  health: 0.67,
  selected: true,
  combat: 'idle',
  activity: 'Holding position',
  moveOrder: null,
  speed: 90,
  attack: { soft: 52, light: 31, heavy: 19 },
  defense: { soft: 44, light: 26, heavy: 14 },
  own: true,
  canExtract: true,
  groups: [
    { typeId: 'infantry', label: 'Infantry', count: 8, health: 0.72 },
    { typeId: 'armored-car', label: 'Armored Car', count: 2, health: 0.61 },
    { typeId: 'artillery', label: 'Artillery', count: 2, health: 0.7 },
  ],
};
