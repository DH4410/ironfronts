/**
 * Country flag registry.
 *
 * Keyed by the in-game country name. Ironfronts is a September 1939 scenario, so
 * entries point at historically appropriate art for that date, not modern flags:
 *  - Sovereign belligerents get their 1939 flag (the Kingdom of Italy, the
 *    1935-1945 German flag, imperial Persia's Lion and Sun, and so on).
 *  - Real colonies / mandates resolve to the flag of the power that actually
 *    administered them in 1939 (French, British, Belgian, Portuguese, Italian).
 *  - Regional gameplay subdivisions resolve to the flag of their historical
 *    sovereign or administering power. They are not presented as independent
 *    national flags, but they always have a recognisable flag chit.
 *
 * Provenance and licensing for every vendored file: docs/flags.md.
 */

import { COUNTRY_FLAG } from '../../scripts/flag-registry.mjs';

const flagUrls = import.meta.glob('./assets/flags/*.svg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/**
 * In-game country name -> flag asset stem in ./assets/flags/<stem>.svg.
 *
 * A bare ISO code is a locally vendored flag-icons file (MIT). A dated /
 * descriptive stem is a period flag vendored from Wikimedia Commons (all
 * PD-old) specifically for this scenario — see docs/flags.md.
 */
export { COUNTRY_FLAG } from '../../scripts/flag-registry.mjs';

export function resolveFlagUrl(country: string | null | undefined): string | null {
  if (!country) return null;
  const stem = COUNTRY_FLAG[country];
  if (!stem) return null;
  return flagUrls[`./assets/flags/${stem}.svg`] ?? null;
}

export function hasFlag(country: string | null | undefined): boolean {
  return resolveFlagUrl(country) !== null;
}

/**
 * Flag chit. A real flag when art exists for `country`, otherwise a colour
 * standard tinted with `color`. `variant` tunes the size/treatment for where
 * it sits (top bar vs. an inline province owner line).
 */
export function createFlag(
  country: string | null,
  color: string,
  variant: 'command' | 'inline' = 'inline',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ifg-flag';
  el.dataset.variant = variant;
  el.setAttribute('aria-hidden', 'true');
  const url = resolveFlagUrl(country);
  if (url) {
    el.dataset.kind = 'flag';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
  } else {
    el.dataset.kind = 'standard';
    el.style.setProperty('--standard', color || '#8a8f88');
  }
  return el;
}
