/**
 * Unit portrait cards.
 *
 * Original WW2-style vector portraits authored for Ironfronts (not scraped
 * game art). The card layout and "one image, minimal name, details on hover"
 * presentation is inspired by Call of War's unit list; the drawings are our
 * own, faction-neutral field-grey / steel, and inlined as SVG so they scale
 * crisply and inherit the panel background.
 *
 * Keyed by the six real roster ids in `game/units/unit-catalog.ts`, with a
 * generic fallback — deliberately no portraits for unit families the roster
 * cannot build yet (militia, motorised, mechanised, paratroopers …), so the
 * panel never advertises a unit that does not exist.
 */

const raw = import.meta.glob('./assets/units/*.svg', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;

const portrait = (stem: string): string => raw[`./assets/units/${stem}.svg`];

const PORTRAIT_BY_TYPE: Readonly<Record<string, string>> = {
  infantry: portrait('infantry'),
  engineer: portrait('engineer'),
  'armored-car': portrait('armored-car'),
  'light-tank': portrait('light-tank'),
  'medium-tank': portrait('medium-tank'),
  artillery: portrait('artillery'),
};

/** One-line role note per unit family, shown in the portrait-card tooltip. */
export const UNIT_ROLE_NOTE: Readonly<Record<string, string>> = {
  infantry: 'Cheap line infantry — slow, cheap to replace, holds ground and digs in.',
  engineer: 'Pioneers — weak in a fight, fastest at working a resource deposit.',
  'armored-car': 'Fast recon — wide view range, light gun, screens the advance.',
  'light-tank': 'Fast armour — strong against infantry and light targets, mid cost.',
  'medium-tank': 'Frontline armour — expensive, slower, heavy hitter against anything.',
  artillery: 'Ranged support — fires without closing, fragile if caught in the open.',
};

export function unitPortraitMarkup(typeId: string): string {
  return PORTRAIT_BY_TYPE[typeId] ?? portrait('_fallback');
}

/** A framed portrait element for a composition card. */
export function createUnitPortrait(typeId: string, label: string): HTMLElement {
  const frame = document.createElement('span');
  frame.className = 'ifg-army-unit__portrait';
  frame.setAttribute('role', 'img');
  frame.setAttribute('aria-label', label);
  frame.innerHTML = unitPortraitMarkup(typeId);
  return frame;
}
