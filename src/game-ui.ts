import './game-ui.css';

type MapMode = 'balanced' | 'political' | 'diplomacy' | 'clear';

interface ProvinceSnapshot {
  name: string;
  country: string;
  terrain: string;
  color: string;
}

const canvas = document.getElementById('world') as HTMLCanvasElement | null;
const tooltip = document.getElementById('tooltip');
const tooltipName = document.getElementById('tooltip-name');
const tooltipTerrain = document.getElementById('tooltip-terrain');
const debugPlayer = document.getElementById('debug-player-country');
const debugFlag = document.getElementById('debug-country-flag');
const debugTime = document.getElementById('debug-time-state');
const debugRain = document.getElementById('debug-rain') as HTMLInputElement | null;
const mapInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="map-mode"]')];

const root = document.createElement('div');
root.className = 'game-hud';
root.innerHTML = `
  <header class="game-hud__topbar" aria-label="Strategic command bar">
    <div class="game-hud__country">
      <i id="hud-country-swatch" class="game-hud__country-swatch" aria-hidden="true"></i>
      <span><small>COMMAND</small><strong id="hud-country-name">Spain</strong></span>
    </div>
    <nav class="game-hud__modes" aria-label="Map mode">
      <button type="button" data-hud-mode="balanced">Strategic</button>
      <button type="button" data-hud-mode="political">Political</button>
      <button type="button" data-hud-mode="diplomacy">Diplomacy</button>
      <button type="button" data-hud-mode="clear">Terrain</button>
    </nav>
    <div class="game-hud__status">
      <span class="game-hud__status-item"><small>WORLD TIME</small><b id="hud-world-time">Morning · 08:00</b></span>
      <span class="game-hud__status-item"><small>WEATHER</small><b id="hud-weather">Clear</b></span>
      <button id="hud-inspector" class="game-hud__inspector" type="button" title="Open world inspector">F3</button>
    </div>
  </header>

  <aside id="hud-province" class="game-hud__province" aria-live="polite">
    <div class="game-hud__province-head">
      <span><small>FIELD REPORT</small><strong id="hud-province-name">No province selected</strong></span>
      <i id="hud-province-color" aria-hidden="true"></i>
    </div>
    <div class="game-hud__province-grid">
      <span><small>CONTROL</small><b id="hud-province-country">—</b></span>
      <span><small>TERRAIN</small><b id="hud-province-terrain">—</b></span>
    </div>
    <p id="hud-province-hint">Click a province to pin its field report.</p>
  </aside>

  <div class="game-hud__controls" aria-hidden="true">
    <span><kbd>LMB</kbd> Pan / Select</span>
    <span><kbd>Wheel</kbd> Zoom</span>
    <span><kbd>RMB</kbd> Rotate</span>
    <span><kbd>F3</kbd> Inspector</span>
  </div>
`;
document.body.append(root);

const hudCountryName = required('hud-country-name');
const hudCountrySwatch = required('hud-country-swatch');
const hudWorldTime = required('hud-world-time');
const hudWeather = required('hud-weather');
const hudProvince = required('hud-province');
const hudProvinceName = required('hud-province-name');
const hudProvinceCountry = required('hud-province-country');
const hudProvinceTerrain = required('hud-province-terrain');
const hudProvinceColor = required('hud-province-color');
const hudProvinceHint = required('hud-province-hint');

let latestHover: ProvinceSnapshot | null = null;
let selected: ProvinceSnapshot | null = null;
let clickStart: { x: number; y: number; pointerId: number } | null = null;

function syncPlayer(): void {
  hudCountryName.textContent = debugPlayer?.textContent?.trim() || 'Unknown command';
  const color = debugFlag?.style.getPropertyValue('--player-country-color').trim();
  if (color) hudCountrySwatch.style.setProperty('--hud-country-color', color);
}

function syncTime(): void {
  hudWorldTime.textContent = debugTime?.textContent?.trim() || '—';
}

function syncWeather(): void {
  hudWeather.textContent = debugRain?.checked ? 'Rain' : 'Clear';
  hudWeather.closest('.game-hud__status-item')?.classList.toggle('is-rain', Boolean(debugRain?.checked));
}

function readHover(): ProvinceSnapshot | null {
  if (!tooltip || tooltip.hidden || !tooltipName || !tooltipTerrain) return null;
  const name = tooltipName.textContent?.trim();
  const detail = tooltipTerrain.textContent?.trim();
  if (!name || !detail) return null;
  const separator = detail.indexOf(' · ');
  const country = separator >= 0 ? detail.slice(0, separator) : detail;
  const terrain = separator >= 0 ? detail.slice(separator + 3) : 'Unknown';
  const color = tooltip.style.getPropertyValue('--country-color').trim() || '#b9aa87';
  return { name, country, terrain, color };
}

function syncHover(): void {
  latestHover = readHover();
  if (selected && latestHover?.name === selected.name) {
    selected = latestHover;
    renderSelected();
  }
}

function renderSelected(): void {
  if (!selected) {
    hudProvince.classList.remove('has-selection');
    hudProvinceName.textContent = 'No province selected';
    hudProvinceCountry.textContent = '—';
    hudProvinceTerrain.textContent = '—';
    hudProvinceHint.textContent = 'Click a province to pin its field report.';
    return;
  }
  hudProvince.classList.add('has-selection');
  hudProvinceName.textContent = selected.name;
  hudProvinceCountry.textContent = selected.country;
  hudProvinceTerrain.textContent = selected.terrain;
  hudProvinceColor.style.setProperty('--hud-province-color', selected.color);
  hudProvinceHint.textContent = 'Hover elsewhere to inspect; click again to change selection.';
}

for (const button of root.querySelectorAll<HTMLButtonElement>('[data-hud-mode]')) {
  button.addEventListener('click', () => {
    const mode = button.dataset.hudMode as MapMode | undefined;
    if (!mode) return;
    const input = mapInputs.find((candidate) => candidate.value === mode);
    if (!input) return;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    syncMapMode();
  });
}

function syncMapMode(): void {
  const active = mapInputs.find((input) => input.checked)?.value;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-hud-mode]')) {
    button.classList.toggle('is-active', button.dataset.hudMode === active);
  }
}

root.querySelector('#hud-inspector')?.addEventListener('click', () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', code: 'F3' }));
});

if (canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) clickStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  });
  window.addEventListener('pointerup', (event) => {
    const start = clickStart;
    clickStart = null;
    if (!start || start.pointerId !== event.pointerId || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    requestAnimationFrame(() => {
      syncHover();
      if (!latestHover) return;
      selected = latestHover;
      renderSelected();
    });
  });
}

if (tooltip) new MutationObserver(syncHover).observe(tooltip, {
  attributes: true,
  attributeFilter: ['hidden', 'style'],
  childList: true,
  subtree: true,
  characterData: true,
});
if (debugPlayer) new MutationObserver(syncPlayer).observe(debugPlayer, { childList: true, subtree: true, characterData: true });
if (debugFlag) new MutationObserver(syncPlayer).observe(debugFlag, { attributes: true, attributeFilter: ['style'] });
if (debugTime) new MutationObserver(syncTime).observe(debugTime, { childList: true, subtree: true, characterData: true });
debugRain?.addEventListener('change', syncWeather);
for (const input of mapInputs) input.addEventListener('change', syncMapMode);

syncPlayer();
syncTime();
syncWeather();
syncMapMode();
renderSelected();

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing game HUD element #${id}`);
  return element;
}
