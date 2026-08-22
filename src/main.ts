import './styles.css';
import { WorldRenderer } from './renderer';
import type { FrameStats, HoverInfo } from './types';

const canvas = required<HTMLCanvasElement>('world');
const loading = required<HTMLElement>('loading');
const loadingStage = required<HTMLElement>('loading-stage');
const loadingValue = required<HTMLElement>('loading-value');
const loadingBar = required<HTMLElement>('loading-bar');
const tooltip = required<HTMLElement>('tooltip');
const tooltipName = required<HTMLElement>('tooltip-name');
const tooltipTerrain = required<HTMLElement>('tooltip-terrain');
const diagnostics = required<HTMLElement>('diagnostics');
const diagnosticsStats = required<HTMLElement>('diagnostics-stats');
const debugView = required<HTMLSelectElement>('debug-view');
const debugConnections = required<HTMLInputElement>('debug-connections');
const debugWireframe = required<HTMLInputElement>('debug-wireframe');
const unsupported = required<HTMLElement>('unsupported');

if (!navigator.gpu) {
  loading.hidden = true;
  unsupported.hidden = false;
} else {
  void start();
}

async function start(): Promise<void> {
  const renderer = new WorldRenderer(canvas);
  renderer.onHover = updateTooltip;
  renderer.onStats = updateDiagnostics;

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'F3') return;
    event.preventDefault();
    diagnostics.hidden = !diagnostics.hidden;
  });
  debugView.addEventListener('change', () => renderer.setDebugView(Number(debugView.value)));
  debugWireframe.addEventListener('change', () => renderer.setWireframe(debugWireframe.checked));
  debugConnections.addEventListener('change', async () => {
    debugConnections.disabled = true;
    try {
      await renderer.setConnectionsVisible(debugConnections.checked);
    } finally {
      debugConnections.disabled = false;
    }
  });

  try {
    await renderer.initialize((stage, progress) => {
      const percentage = Math.round(progress * 100);
      loadingStage.textContent = stage;
      loadingValue.textContent = `${percentage}%`;
      loadingBar.style.width = `${percentage}%`;
    });
    loading.classList.add('is-done');
    window.setTimeout(() => { loading.hidden = true; }, 500);
    renderer.start();
  } catch (error) {
    console.error(error);
    loading.hidden = true;
    unsupported.hidden = false;
    const title = unsupported.querySelector('h1');
    const message = unsupported.querySelector('p:last-child');
    if (title) title.textContent = 'The world could not be rendered.';
    if (message) message.textContent = error instanceof Error ? error.message : String(error);
  }
}

function updateTooltip(info: HoverInfo | null, x: number, y: number): void {
  if (!info) {
    tooltip.hidden = true;
    return;
  }
  tooltipName.textContent = info.name;
  tooltipTerrain.textContent = info.terrain;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.hidden = false;
}

function updateDiagnostics(stats: FrameStats): void {
  diagnosticsStats.textContent = [
    `${stats.fps.toFixed(0).padStart(3)} FPS  ${stats.frameMs.toFixed(1).padStart(5)} ms`,
    `map  ${stats.camera[0].toFixed(0).padStart(5)}, ${stats.camera[1].toFixed(0).padStart(4)}`,
    `alt  ${stats.camera[2].toFixed(0).padStart(5)}   zoom ${stats.distance.toFixed(0)}`,
    `province  ${stats.hoveredProvince ?? '—'}`,
    `trees     ${stats.trees.toLocaleString()}`,
    `buildings ${stats.buildings.toLocaleString()}`,
    `borders   ${stats.borderEdges.toLocaleString()}`,
  ].join('\n');
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}
