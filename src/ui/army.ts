/**
 * Army / unit UI components: the map counter and the selected-stack readout.
 *
 * These render the fog-aware `ArmyStackView` projection that `main.ts` builds
 * from authoritative GameState (see `game/player-view.ts`) — an unidentified
 * contact shows a '?' counter and a strength-unknown readout. `DEMO_ARMY` is a
 * dev / `?debug` fixture only, gated by the caller.
 */

import { iconMarkup } from './icons';
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
  moveOrder: null,
};
