import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.IRONFRONTS_BROWSER ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDirectory = fileURLToPath(new URL('../artifacts/', import.meta.url));
// Chrome's Windows headless backend does not expose the machine's WebGPU
// adapter reliably. Default to a short-lived headed window on Windows; CI can
// still opt into headless mode explicitly.
const headless = process.env.IRONFRONTS_HEADLESS
  ? process.env.IRONFRONTS_HEADLESS !== 'false'
  : process.platform !== 'win32';
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless,
  args: headless ? [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--disable-vulkan-surface',
  ] : ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

await page.goto(process.argv[2] ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('#loading')?.hasAttribute('hidden') || !document.querySelector('#unsupported')?.hasAttribute('hidden'), null, { timeout: 30_000 });
await page.waitForTimeout(1_000);
const status = await page.evaluate(() => ({
  webgpu: Boolean(navigator.gpu),
  unsupported: !(document.querySelector('#unsupported')?.hasAttribute('hidden') ?? true),
  message: !(document.querySelector('#unsupported')?.hasAttribute('hidden') ?? true)
    ? document.querySelector('#unsupported p:last-child')?.textContent ?? ''
    : '',
}));
const validation = await page.evaluate(async () => {
  const manifest = await fetch('/world/world.json').then((response) => response.json());
  const report = await fetch('/world/world-generation-report.json').then((response) => response.json());
  const counts = manifest.counts;
  return {
    maximumHeight: report.topography.maximumHeight,
    maximumSlopeStep: report.topography.maximumSlopeStep,
    capViolations: report.topography.capViolations,
    hiddenRoads: report.roads.hiddenRoadCount,
    steepRoads: counts.steepRoads,
    steepEmittedRoads: counts.steepEmittedRoads,
    riverSystems: counts.riverSystems,
    riverSegments: counts.riverSegments,
    canalSystems: counts.canalSystems,
  };
});
if (validation.maximumHeight > 50.5) errors.push(`validation: maximum elevation ${validation.maximumHeight.toFixed(3)} exceeds 50.5`);
if (validation.maximumSlopeStep > 2.01) errors.push(`validation: terrain step ${validation.maximumSlopeStep.toFixed(3)} exceeds 2.01`);
if (validation.capViolations !== 0) errors.push(`validation: ${validation.capViolations} terrain samples exceed their local cap`);
if (validation.steepEmittedRoads <= 0) errors.push('validation: no incline-warning roads were emitted');
if (validation.riverSystems !== 24 || validation.riverSegments !== 527) errors.push('validation: authoritative river graph is incomplete');
if (validation.canalSystems !== 2) errors.push('validation: Kiel and Suez canal surfaces are incomplete');
await page.screenshot({ path: path.join(outputDirectory, 'overview.png') });

if (!status.unsupported) {
  // Start with a close landscape pass before deterministic showcase captures.
  await page.mouse.move(900, 625);
  await page.mouse.wheel(0, -3_700);
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: path.join(outputDirectory, 'terrain-close.png') });
  await page.keyboard.press('F3');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDirectory, 'diagnostics.png') });

  const captureShowcase = async (key, filename, distance) => {
    await page.evaluate(async ({ key, distance }) => {
      const manifest = await fetch('/world/world.json').then((response) => response.json());
      const renderer = window.__ironfrontsRenderer;
      const point = manifest.showcases[key];
      renderer?.focus(point[0], point[1], distance);
    }, { key, distance });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputDirectory, filename) });
  };
  const capturePoint = async (point, filename, distance) => {
    await page.evaluate(({ point, distance }) => window.__ironfrontsRenderer?.focus(point[0], point[1], distance), { point, distance });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputDirectory, filename) });
  };
  await page.keyboard.press('F3');
  await captureShowcase('urban', 'roads-urban.png', 410);
  await captureShowcase('mountain', 'roads-mountain.png', 480);
  await captureShowcase('steepRoad', 'roads-steep.png', 360);
  await captureShowcase('liangshan', 'roads-liangshan.png', 520);
  await captureShowcase('dirtRoad', 'roads-dirt.png', 300);
  await captureShowcase('hiddenConnection', 'roads-hidden-connection.png', 340);
  await captureShowcase('europe', 'terrain-europe.png', 620);
  await capturePoint([5_822, 2_564], 'terrain-iberia.png', 520);
  await capturePoint([6_520, 3_931], 'terrain-africa.png', 620);
  await captureShowcase('lakeRoad', 'roads-lake.png', 380);
  await captureShowcase('river', 'waterways-river.png', 420);
  await captureShowcase('riverMouth', 'waterways-mouth.png', 460);
  await captureShowcase('kielCanal', 'waterways-kiel-canal.png', 240);
  await captureShowcase('suezCanal', 'waterways-suez-canal.png', 320);
  await page.evaluate(async () => {
    await window.__ironfrontsRenderer?.setWaterwayNetworkVisible(true);
    window.__ironfrontsRenderer?.setDebugView(6);
  });
  await captureShowcase('river', 'diagnostics-river-network.png', 520);
  await page.evaluate(() => window.__ironfrontsRenderer?.setWaterwayNetworkVisible(false));
  await page.evaluate(() => window.__ironfrontsRenderer?.setDebugView(5));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDirectory, 'terrain-slope.png') });
  await page.evaluate(() => window.__ironfrontsRenderer?.setDebugView(8));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDirectory, 'roads-footprint.png') });
  await page.evaluate(() => window.__ironfrontsRenderer?.setDebugView(9));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDirectory, 'navigation-composite.png') });
}

const report = { ...status, headless, validation, errors };
await writeFile(path.join(outputDirectory, 'visual-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (status.unsupported || errors.length) process.exitCode = 1;
