import './styles.css';
import '@fontsource/bitter/latin-ext-800.css';
import '@fontsource/special-elite/latin-ext-400.css';
import '@fontsource/cinzel-decorative/latin-ext-700.css';
import { AudioManager } from './audio/audio-manager';
import { MusicDirector } from './audio/music-director';
import { TRACK_BY_ID, trackSources } from './audio/music-catalog';
import { loadQuality, saveQuality } from './graphics/quality';
import { mountMenu } from './menu/menu';
import { mountGameUi, type GameUiActions } from './ui/game-ui';
import { createInitialState, createUiStore, type GameNotification } from './ui/ui-state';
import { DEMO_ARMY } from './ui/army';
import { iconMarkup } from './ui/icons';
import type { ProvinceResources } from './resource-nodes';
import type { WorldRenderer, MapMode, TimeOfDayState } from './renderer';
import { parseClock } from './time-of-day';
import type { CountryRecord, DiplomacyState, DiplomaticRelation, FrameStats, HoverInfo } from './types';
import { LOADING_QUOTES } from './loadingQuotes';

const canvas = required<HTMLCanvasElement>('world');
const countryLabels = required<HTMLCanvasElement>('country-labels');
const loading = required<HTMLElement>('loading');
const loadingStage = required<HTMLElement>('loading-stage');
const loadingValue = required<HTMLElement>('loading-value');
const loadingBar = required<HTMLElement>('loading-bar');
const loadingKind = required<HTMLElement>('loading-kind');
const loadingQuoteText = required<HTMLElement>('loading-quote-text');
const loadingQuoteSource = required<HTMLElement>('loading-quote-source');
const tooltip = required<HTMLElement>('tooltip');
const tooltipName = required<HTMLElement>('tooltip-name');
const tooltipTerrain = required<HTMLElement>('tooltip-terrain');
const tooltipResources = required<HTMLElement>('tooltip-resources');
const debugToggle = required<HTMLButtonElement>('debug-toggle');
const diagnostics = required<HTMLElement>('diagnostics');
const diagnosticsStats = required<HTMLElement>('diagnostics-stats');
const diagnosticsPerformance = required<HTMLElement>('diagnostics-performance');
const debugTime = required<HTMLInputElement>('debug-time');
const debugTimeState = required<HTMLOutputElement>('debug-time-state');
const debugTimeMultiplier = required<HTMLInputElement>('debug-time-multiplier');
const debugTimePresets = [...document.querySelectorAll<HTMLButtonElement>('[data-debug-time]')];
const debugRain = required<HTMLInputElement>('debug-rain');
const debugThunder = required<HTMLButtonElement>('debug-thunder');
const debugView = required<HTMLSelectElement>('debug-view');
const debugConnections = required<HTMLInputElement>('debug-connections');
const debugRivers = required<HTMLInputElement>('debug-rivers');
const debugWireframe = required<HTMLInputElement>('debug-wireframe');
const debugBorders = required<HTMLInputElement>('debug-borders');
const debugCountries = required<HTMLInputElement>('debug-countries');
const debugRoads = required<HTMLInputElement>('debug-roads');
const debugHidden = required<HTMLInputElement>('debug-hidden');
const debugWaterways = required<HTMLInputElement>('debug-waterways');
const debugProps = required<HTMLInputElement>('debug-props');
const debugDescription = required<HTMLElement>('debug-description');
const debugLegend = required<HTMLElement>('debug-legend');
const debugTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-debug-tab]')];
const debugPanels = [...document.querySelectorAll<HTMLElement>('[data-debug-panel]')];
const debugPlayerCountry = required<HTMLElement>('debug-player-country');
const debugCountryFlag = required<HTMLElement>('debug-country-flag');
const debugPlayerForm = required<HTMLFormElement>('debug-player-form');
const debugPlayerInput = required<HTMLInputElement>('debug-player-input');
const debugWarForm = required<HTMLFormElement>('debug-war-form');
const debugWarInput = required<HTMLInputElement>('debug-at-war');
const debugAlliedForm = required<HTMLFormElement>('debug-allied-form');
const debugAlliedInput = required<HTMLInputElement>('debug-allied');
const debugWarList = required<HTMLElement>('debug-war-list');
const debugAlliedList = required<HTMLElement>('debug-allied-list');
const debugDiplomacyStatus = required<HTMLElement>('debug-diplomacy-status');
const debugCountryNames = required<HTMLDataListElement>('debug-country-names');
const mapModes = required<HTMLFieldSetElement>('map-modes');
const mapModeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="map-mode"]')];
const unsupported = required<HTMLElement>('unsupported');
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const urlParams = new URLSearchParams(window.location.search);
// Debug / world-inspector affordances are opt-in only: ?debug (or the
// ?benchmark automation hook). They are NOT auto-enabled by the dev server, so
// `npm run dev` shows the real player experience by default.
const debugEnabled = urlParams.has('debug') || urlParams.has('benchmark');

// The single typed channel between renderer/game systems and the player HUD.
const uiStore = createUiStore(createInitialState({ quality: loadQuality(), debugEnabled }));

const audio = new AudioManager(safeLocalStorage());
const music = new MusicDirector(audio);
const firstMenuTrack = TRACK_BY_ID.get('honor-bound');
audio.prime(firstMenuTrack ? trackSources(firstMenuTrack).slice(0, 1) : []);
audio.installLifecycle();

// Try to start the lobby soundtrack immediately when the page opens. Browsers
// may still block audible autoplay, so the first user gesture retries only if
// playback did not actually begin.
void music.setState('menu');

let autoplayRetryDone = false;
const retryMenuMusicAfterAutoplayBlock = (): void => {
  if (autoplayRetryDone || audio.isMusicPlaying()) return;
  autoplayRetryDone = true;
  void music.setState('menu', { force: true });
};
document.addEventListener('pointerdown', retryMenuMusicAfterAutoplayBlock, { capture: true, once: true });
document.addEventListener('keydown', retryMenuMusicAfterAutoplayBlock, { capture: true, once: true });

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    music.stop(0.05);
    audio.dispose();
  }
});

let rendererStarted = false;
let activeRenderer: WorldRenderer | undefined;
mountMenu({
  audio,
  onLaunch: () => {
    if (rendererStarted) return;
    rendererStarted = true;
    void music.setState('opening');

    // The lobby is deliberately lightweight. The world canvas, loading scene,
    // renderer module graph, WebGPU device and world assets are all deferred
    // until the player actually commits to an operation.
    if (!navigator.gpu) {
      loading.hidden = true;
      canvas.hidden = true;
      unsupported.hidden = false;
    } else {
      canvas.hidden = false;
      loading.hidden = false;
      loadingStage.textContent = 'Loading renderer';
      loadingValue.textContent = '0%';
      loadingBar.style.width = '0%';
      debugToggle.hidden = !debugEnabled;
      // The legacy MAP OVERLAY fieldset stays in the DOM (main.ts reads its
      // radios) but is superseded by the in-game map-mode toolbar.
      mapModes.hidden = true;
      uiStore.patch({ phase: 'loading' });
      void start();
    }
  },
  // In the lobby this only persists; once the renderer exists it applies live.
  onGraphicsQuality: (level) => activeRenderer?.setQuality(level),
});

function startLoadingQuotes(): () => void {
  const order = LOADING_QUOTES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let index = 0;
  const show = () => {
    const quote = LOADING_QUOTES[order[index % order.length]];
    loadingKind.textContent = quote.kind;
    loadingQuoteText.textContent = quote.text;
    loadingQuoteSource.textContent = quote.source;
    index += 1;
  };
  show();
  const timer = window.setInterval(show, 6000);
  return () => window.clearInterval(timer);
}

async function start(): Promise<void> {
  const stopQuotes = startLoadingQuotes();

  // Keep the complete renderer/world module graph out of the lobby bundle.
  // This import is the first point at which world rendering code is loaded.
  const { WorldRenderer } = await import('./renderer');
  const renderer = new WorldRenderer(canvas, countryLabels, loadQuality());
  activeRenderer = renderer;
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) renderer.dispose();
  });
  if (import.meta.env.DEV || debugEnabled) {
    // Invisible automation handle (QA capture / perf scripts). Not a player-
    // facing affordance.
    (window as Window & { __ironfrontsRenderer?: WorldRenderer }).__ironfrontsRenderer = renderer;
  }
  renderer.onHover = (info, x, y) =>
    updateTooltip(info, x, y, info ? renderer.getProvinceResources(info.id) : null);

  // ---- Player HUD: typed state in, typed actions out -----------------
  const setMapModeUnified = (mode: MapMode): void => {
    const input = mapModeInputs.find((candidate) => candidate.value === mode);
    if (input && !input.checked) input.checked = true;
    renderer.setMapMode(mode);
    uiStore.patch({ mapMode: mode });
  };
  const gameUiActions: GameUiActions = {
    setMapMode: (mode) => setMapModeUnified(mode as MapMode),
    clearSelection: () => renderer.clearProvinceSelection(),
    setQuality: (level) => {
      renderer.setQuality(level);
      saveQuality(level);
      uiStore.patch({ quality: level, effectiveRenderScale: renderer.effectiveRenderScale });
    },
    navSelect: () => { /* No player-facing system is implemented yet. */ },
    dismissNotification: (id) => uiStore.patch({
      notifications: uiStore.get().notifications.filter((entry) => entry.id !== id),
    }),
    togglePause: (open) => uiStore.patch({ paused: open }),
    toggleResourceOverlay: (on) => {
      renderer.setResourceOverlay(on);
      uiStore.patch({ resourceOverlay: on });
    },
    returnToMenu: () => { /* Disabled in the UI until a safe menu-return path exists. */ },
    openDebugInspector: () => {
      if (debugEnabled) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', key: 'F3' }));
    },
  };
  const gameUi = mountGameUi(uiStore, gameUiActions);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) gameUi.destroy();
  });

  let oceanAudible = false;
  // The resource overlay is a GPU instanced layer inside the renderer now, so
  // this slow-cadence callback only drives audio + the debug readout. No
  // per-frame projection, no DOM marker writes.
  renderer.onStats = (stats) => {
    const shouldHearOcean = stats.targetProvince === null && stats.distance < 2_800;
    if (shouldHearOcean !== oceanAudible) {
      oceanAudible = shouldHearOcean;
      void audio.setOceanEnabled(oceanAudible);
    }
    if (!diagnostics.hidden) updateDiagnostics(stats);
  };
  renderer.onDiplomacyChange = (state) => {
    renderDiplomacyState(renderer, state);
    uiStore.patch({ playerCountry: { name: state.player.name, color: state.player.color } });
    if (state.enemies.length > 0 && music.getState() !== 'victory') {
      void music.setState('war');
    } else if (state.enemies.length === 0 && music.getState() === 'war') {
      void music.setState('peace');
    }
  };
  renderer.onProvinceCaptured = (provinceId, previousCountry, player) => {
    setDiplomacyStatus(`Province ${provinceId} taken from ${previousCountry.name} by ${player.name}.`);
  };
  renderer.onProvinceSelected = (info) => {
    uiStore.patch({
      selectedProvince: info
        ? {
            id: info.id,
            name: info.name,
            owner: info.country,
            ownerColor: info.countryColor,
            terrain: info.terrain,
            resources: renderer.getProvinceResources(info.id),
          }
        : null,
    });
  };
  renderer.onTimeOfDayChange = (state) => {
    updateTimeControls(state);
    uiStore.patch({ clock: { label: `${capitalize(state.stage)} · ${state.clock}`, phase: state.stage } });
  };

  debugTime.addEventListener('change', () => {
    const hour = parseClock(debugTime.value);
    if (hour !== undefined) renderer.setTimeOfDay(hour);
  });
  for (const preset of debugTimePresets) {
    preset.addEventListener('click', () => renderer.setTimeOfDay(Number(preset.dataset.debugTime)));
  }
  const applyTimeMultiplier = () => {
    if (debugTimeMultiplier.value === '') return;
    const multiplier = renderer.setTimeMultiplier(Number(debugTimeMultiplier.value));
    debugTimeMultiplier.value = multiplier.toFixed(1);
  };
  debugTimeMultiplier.addEventListener('change', applyTimeMultiplier);
  debugTimeMultiplier.addEventListener('blur', applyTimeMultiplier);
  debugRain.addEventListener('change', () => {
    renderer.setRainEnabled(debugRain.checked);
    void audio.setRainEnabled(debugRain.checked);
    uiStore.patch({ weather: { raining: debugRain.checked, label: debugRain.checked ? 'Rain' : 'Clear' } });
  });
  debugThunder.addEventListener('click', () => {
    void audio.playThunder();
  });

  for (const tab of debugTabs) {
    tab.addEventListener('click', () => {
      const selected = tab.dataset.debugTab;
      for (const candidate of debugTabs) candidate.setAttribute('aria-selected', String(candidate === tab));
      for (const panel of debugPanels) panel.hidden = panel.dataset.debugPanel !== selected;
    });
  }

  debugPlayerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const country = renderer.setPlayerCountryByName(debugPlayerInput.value);
    if (!country) {
      setDiplomacyStatus(`No country exactly matches “${debugPlayerInput.value.trim()}”.`, true);
      return;
    }
    debugPlayerInput.value = '';
    setDiplomacyStatus(`Country flag switched to ${country.name}. Diplomatic placeholders were cleared.`);
  });

  const bindRelationForm = (
    form: HTMLFormElement,
    input: HTMLInputElement,
    relation: Exclude<DiplomaticRelation, 'neutral'>,
  ) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const country = renderer.setDiplomaticRelationByName(input.value, relation);
      if (!country) {
        setDiplomacyStatus(`“${input.value.trim()}” is unknown or is your current country.`, true);
        return;
      }
      input.value = '';
      setDiplomacyStatus(relation === 'war'
        ? `${country.name} is now at war with you. Click its provinces to take them.`
        : `${country.name} is now allied with you.`);
    });
  };
  bindRelationForm(debugWarForm, debugWarInput, 'war');
  bindRelationForm(debugAlliedForm, debugAlliedInput, 'allied');

  const applyDebugView = () => {
    const mode = Number(debugView.value);
    renderer.setDebugView(mode);
    updateDebugHelp(mode);
  };
  const applyMapMode = () => {
    const selected = mapModeInputs.find((input) => input.checked)?.value;
    if (selected && isMapMode(selected)) setMapModeUnified(selected);
  };
  const toggleDiagnostics = () => {
    diagnostics.hidden = !diagnostics.hidden;
    debugToggle.setAttribute('aria-expanded', String(!diagnostics.hidden));
  };
  debugToggle.addEventListener('click', toggleDiagnostics);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'F3') {
      if (!debugEnabled) return;
      event.preventDefault();
      toggleDiagnostics();
      return;
    }
    if (diagnostics.hidden || (event.code !== 'BracketLeft' && event.code !== 'BracketRight')) return;
    event.preventDefault();
    const direction = event.code === 'BracketRight' ? 1 : -1;
    const count = debugView.options.length;
    debugView.selectedIndex = (debugView.selectedIndex + direction + count) % count;
    applyDebugView();
  });
  for (const input of mapModeInputs) input.addEventListener('change', applyMapMode);
  applyMapMode();
  debugView.addEventListener('change', applyDebugView);
  debugWireframe.addEventListener('change', () => renderer.setWireframe(debugWireframe.checked));
  debugCountries.addEventListener('change', () => renderer.setCountryOverlayVisible(debugCountries.checked));
  debugBorders.addEventListener('change', () => renderer.setBordersVisible(debugBorders.checked));
  debugRoads.addEventListener('change', () => renderer.setRoadsVisible(debugRoads.checked));
  debugHidden.addEventListener('change', () => renderer.setHiddenConnectionsVisible(debugHidden.checked));
  debugWaterways.addEventListener('change', () => renderer.setWaterwaysVisible(debugWaterways.checked));
  debugProps.addEventListener('change', () => renderer.setPropsVisible(debugProps.checked));
  debugConnections.addEventListener('change', async () => {
    debugConnections.disabled = true;
    try {
      await renderer.setConnectionsVisible(debugConnections.checked);
    } finally {
      debugConnections.disabled = false;
    }
  });
  debugRivers.addEventListener('change', async () => {
    debugRivers.disabled = true;
    try {
      await renderer.setWaterwayNetworkVisible(debugRivers.checked);
    } finally {
      debugRivers.disabled = false;
    }
  });
  try {
    await renderer.initialize((stage, progress) => {
      const percentage = Math.round(progress * 100);
      loadingStage.textContent = stage;
      loadingValue.textContent = `${percentage}%`;
      loadingBar.style.width = `${percentage}%`;
    });
    debugCountryNames.replaceChildren(...renderer.getCountries()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((country) => {
        const option = document.createElement('option');
        option.value = country.name;
        return option;
      }));
    applyDebugView();
    void audio.setWindEnabled(true);
    loading.classList.add('is-done');
    stopQuotes();
    window.setTimeout(() => { loading.hidden = true; }, 500);
    renderer.start();

    // Hand the HUD its opening state from real renderer/game values.
    const clock = renderer.getTimeOfDay();
    uiStore.patch({
      phase: 'in-game',
      clock: { label: `${capitalize(clock.stage)} · ${clock.clock}`, phase: clock.stage },
      quality: renderer.graphicsQuality,
      effectiveRenderScale: renderer.effectiveRenderScale,
      weather: { raining: renderer.isRainEnabled(), label: renderer.isRainEnabled() ? 'Rain' : 'Clear' },
    });
    if (debugEnabled) {
      // Dev-only fixtures so screenshots / component tests have content. Never
      // shown in production gameplay.
      uiStore.patch({ notifications: DEMO_NOTIFICATIONS, selectedArmy: DEMO_ARMY });
    }
  } catch (error) {
    stopQuotes();
    void audio.setWindEnabled(false);
    void audio.setOceanEnabled(false);
    console.error(error);
    loading.hidden = true;
    unsupported.hidden = false;
    const title = unsupported.querySelector('h1');
    const message = unsupported.querySelector('p:last-child');
    if (title) title.textContent = 'The world could not be rendered.';
    if (message) message.textContent = error instanceof Error ? error.message : String(error);
  }
}

function updateTimeControls(state: TimeOfDayState): void {
  debugTimeState.textContent = `${state.stage} · ${state.clock}`;
  if (document.activeElement !== debugTime) debugTime.value = state.clock;
  if (document.activeElement !== debugTimeMultiplier) debugTimeMultiplier.value = state.multiplier.toFixed(1);
}

function renderDiplomacyState(renderer: WorldRenderer, state: DiplomacyState): void {
  debugPlayerCountry.textContent = state.player.name;
  debugCountryFlag.style.setProperty('--player-country-color', state.player.color);
  renderRelationList(renderer, debugWarList, state.enemies, 'No wars');
  renderRelationList(renderer, debugAlliedList, state.allies, 'No allies');
}

function renderRelationList(
  renderer: WorldRenderer,
  container: HTMLElement,
  countries: CountryRecord[],
  emptyLabel: string,
): void {
  if (!countries.length) {
    const empty = document.createElement('span');
    empty.className = 'relation-list__empty';
    empty.textContent = emptyLabel;
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...countries.map((country) => {
    const chip = document.createElement('span');
    chip.className = 'relation-chip';
    chip.append(country.name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = `Remove ${country.name}`;
    remove.setAttribute('aria-label', `Remove ${country.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      renderer.clearDiplomaticRelation(country.id);
      setDiplomacyStatus(`${country.name} is neutral again.`);
    });
    chip.append(remove);
    return chip;
  }));
}

function setDiplomacyStatus(message: string, error = false): void {
  debugDiplomacyStatus.textContent = message;
  debugDiplomacyStatus.classList.toggle('is-error', error);
}

// Deposit abundance, not production/day. Icon art only, at most three chips,
// row hidden when the province holds nothing.
const RESOURCE_TOOLTIP_CHIPS = [
  ['stone', 'node-stone'], ['metal', 'node-metal'], ['oil', 'node-oil'],
] as const;

function updateTooltip(
  info: HoverInfo | null, x: number, y: number, resources: ProvinceResources | null,
): void {
  if (!info) {
    tooltip.hidden = true;
    return;
  }
  tooltipName.textContent = info.name;
  tooltipTerrain.textContent = `${info.country} · ${info.terrain}`;
  const chips = resources
    ? RESOURCE_TOOLTIP_CHIPS
        .filter(([key]) => resources[key] > 0)
        .map(([key, icon]) =>
          `<span class="tooltip-rchip">${iconMarkup(icon)}${compactNumber.format(resources[key])}</span>`)
    : [];
  tooltipResources.hidden = chips.length === 0;
  tooltipResources.innerHTML = chips.join('');
  tooltip.style.setProperty('--country-color', info.countryColor);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.hidden = false;
}

function updateDiagnostics(stats: FrameStats): void {
  diagnosticsStats.textContent = [
    `${stats.fps.toFixed(0).padStart(3)} FPS  ${stats.frameMs.toFixed(1).padStart(5)} ms`,
    `map  ${stats.camera[0].toFixed(0).padStart(5)}, ${stats.camera[1].toFixed(0).padStart(4)}`,
    `alt  ${stats.camera[2].toFixed(0).padStart(5)}   zoom ${stats.distance.toFixed(0)}`,
    `target    ${stats.targetProvince ?? 'water'} @ ${stats.targetElevation.toFixed(2)}`,
    `province  ${stats.hoveredProvince ?? '—'}`,
    activeRenderer
      ? `graphics  ${activeRenderer.graphicsQuality} @ ${activeRenderer.effectiveRenderScale.toFixed(2)}x  ${canvas.width}x${canvas.height}`
      : 'graphics  —',
    `trees     ${stats.trees.toLocaleString()}`,
    `buildings ${stats.buildings.toLocaleString()}`,
    `roads     ${stats.emittedRoads.toLocaleString()} + ${stats.hiddenRoads} dotted`,
    `rivers    ${stats.riverSystems} systems / ${stats.riverSegments} edges`,
    `canals    ${stats.canalSegments} edges`,
    `borders   ${stats.borderEdges.toLocaleString()}`,
  ].join('\n');

  const timing = stats.performance;
  const phaseRanking = Object.entries(timing.phases)
    .sort(([, a], [, b]) => b.average - a.average)
    .slice(0, 3)
    .map(([name, values]) => `${name} ${values.average.toFixed(2)}`)
    .join('  ');
  const geometryRanking = Object.entries(timing.workload.trianglesByCategory)
    .filter(([, triangles]) => triangles > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, triangles]) => `${name} ${formatCompact(triangles)}`)
    .join('  ');
  const browserPerformance = performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  };
  const memory = browserPerformance.memory;
  diagnosticsPerformance.textContent = [
    `frame  avg ${timing.frame.average.toFixed(2)}  p95 ${timing.frame.p95.toFixed(2)}  max ${timing.frame.maximum.toFixed(1)} ms`,
    `CPU    avg ${timing.mainThread.average.toFixed(2)}  p95 ${timing.mainThread.p95.toFixed(2)} ms`,
    timing.gpu
      ? `GPU    avg ${timing.gpu.average.toFixed(2)}  p95 ${timing.gpu.p95.toFixed(2)} ms  n=${timing.gpuSampleCount}`
      : `GPU    timestamp ${timing.gpuTimingSupported ? 'warming up' : 'unavailable'}`,
    `hot CPU  ${phaseRanking || 'collecting samples'}`,
    `draws  ${timing.workload.drawCalls}   instances ${formatCompact(timing.workload.instances)}`,
    `tris   ${formatCompact(timing.workload.triangles)}   labels ${timing.workload.labels}`,
    `hot geo  ${geometryRanking || 'none'}`,
    `chunks terrain ${timing.workload.visibleChunks.terrain}  trees ${timing.workload.visibleChunks.trees}  buildings ${timing.workload.visibleChunks.buildings}`,
    `chunks road ${timing.workload.visibleChunks.roads}  river ${timing.workload.visibleChunks.waterways}  border ${timing.workload.visibleChunks.borders}  links ${timing.workload.visibleChunks.hiddenLinks}`,
    `LOD terrain ${timing.workload.lodInstances.terrain.join('/')}  trees ${timing.workload.lodInstances.trees.join('/')}  buildings ${timing.workload.lodInstances.buildings.join('/')}`,
    memory ? `JS heap ${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}` : 'JS heap unavailable',
  ].join('\n');
}

function formatCompact(value: number): string {
  return compactNumber.format(value);
}

function formatBytes(value: number): string {
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

const DEBUG_HELP: Record<number, { description: string; legend: Array<[string, string]> }> = {
  0: { description: 'Normal rendered world.', legend: [] },
  1: { description: 'Normalized final terrain elevation after topology conditioning.', legend: [['low', '#151b1d'], ['high', '#f2f2ee']] },
  2: { description: 'Authored terrain classes used by topography and placement.', legend: [['plain', '#65ad52'], ['hill', '#ab943f'], ['mountain', '#94918c'], ['forest', '#1f6b33']] },
  3: { description: 'Deterministic color per province for geometry and adjacency inspection.', legend: [['province', '#c880d4']] },
  4: { description: 'Final heightfield normals; abrupt color changes reveal terrain discontinuities.', legend: [['normal XYZ', '#8ab9dc']] },
  5: { description: 'Terrain steepness heatmap for finding cliffs, harsh passes, and topology artifacts.', legend: [['gentle', '#145038'], ['steep', '#f43814']] },
  6: { description: 'Waterway overlay mask used for draped rivers, placement clearance, and border routing.', legend: [['river', '#05efff'], ['canal', '#f9b71a']] },
  7: { description: 'Static land/coast classification and open-water depth.', legend: [['land', '#299e4c'], ['coast', '#bd6b29'], ['deep water', '#041c47']] },
  8: { description: 'Full dirt-road core and verge footprint independent of nearby 3D geometry.', legend: [['verge', '#ef9e1a'], ['core', '#f22e14']] },
  9: { description: 'Navigation composite for comparing roads, static water, rivers, and canals.', legend: [['road', '#f59c1e'], ['river', '#05c7f9'], ['canal', '#c46bf5'], ['ocean/lake', '#062e66']] },
};

function updateDebugHelp(mode: number): void {
  const help = DEBUG_HELP[mode] ?? DEBUG_HELP[0];
  debugDescription.textContent = help.description;
  debugLegend.replaceChildren(...help.legend.map(([label, color]) => {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.setProperty('--legend', color);
    item.append(swatch, label);
    return item;
  }));
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function isMapMode(value: string): value is MapMode {
  return value === 'political' || value === 'diplomacy' || value === 'clear' || value === 'balanced';
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

const DEMO_NOTIFICATIONS: readonly GameNotification[] = [
  { id: 'demo-info', kind: 'information', title: 'Operation underway', body: 'Command HUD preview build.', at: 0 },
  { id: 'demo-diplo', kind: 'diplomacy', title: 'Diplomatic channel open', body: 'Placeholder event fixture.', at: 0 },
  { id: 'demo-warn', kind: 'warning', title: 'Supply line exposed', at: 0 },
];
