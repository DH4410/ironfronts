/**
 * Country flag registry.
 *
 * Keyed by the in-game country name. Only the recognisable sovereign nations
 * have vendored art (flag-icons, MIT — see docs/ASSET_CREDITS.md); every other
 * country (US states, Brazilian regions, Russian oblasts, Chinese cliques,
 * colonial holdings…) resolves to `null` and renders a colour *standard*, an
 * intentional fallback rather than a broken flag.
 *
 * These are modern flags as a first pass. To ship 1939-era or scenario flags,
 * re-point entries here or add a scenario overlay — no component changes.
 */

const flagUrls = import.meta.glob('./assets/flags/*.svg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** In-game country name -> ISO 3166-1 alpha-2 (flag-icons filename). */
const COUNTRY_ISO: Record<string, string> = {
  Spain: 'es',
  France: 'fr',
  Germany: 'de',
  Italy: 'it',
  Poland: 'pl',
  'United Kingdom': 'gb',
  Portugal: 'pt',
  Belgium: 'be',
  Netherlands: 'nl',
  Luxembourg: 'lu',
  Switzerland: 'ch',
  Austria: 'at',
  Denmark: 'dk',
  Norway: 'no',
  Sweden: 'se',
  Finland: 'fi',
  Ireland: 'ie',
  Iceland: 'is',
  Greece: 'gr',
  Bulgaria: 'bg',
  Romania: 'ro',
  Czechoslovakia: 'cz',
  Turkey: 'tr',
  Japan: 'jp',
  Egypt: 'eg',
  Ethiopia: 'et',
  Persia: 'ir',
  'Saudi Arabia': 'sa',
  'New Zealand': 'nz',
  'South Africa': 'za',
};

export function resolveFlagUrl(country: string | null | undefined): string | null {
  if (!country) return null;
  const iso = COUNTRY_ISO[country];
  if (!iso) return null;
  return flagUrls[`./assets/flags/${iso}.svg`] ?? null;
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
