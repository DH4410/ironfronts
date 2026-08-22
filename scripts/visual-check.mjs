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
    oceanRoadSamples: counts.oceanRoadSamples,
    maximumHeight: report.topography.maximumHeight,
    maximumSlopeStep: report.topography.maximumSlopeStep,
    capViolations: report.topography.capViolations,
    hiddenRoads: report.roads.hiddenCorridors,
  };
});
if (validation.oceanRoadSamples !== 0) errors.push(`validation: ${validation.oceanRoadSamples} road samples enter ocean/lakes`);
if (validation.maximumHeight > 50.5) errors.push(`validation: maximum elevation ${validation.maximumHeight.toFixed(3)} exceeds 50.5`);
if (validation.maximumSlopeStep > 2.01) errors.push(`validation: terrain step ${validation.maximumSlopeStep.toFixed(3)} exceeds 2.01`);
if (validation.capViolations !== 0) errors.push(`validation: ${validation.capViolations} terrain samples exceed their local cap`);
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
  await page.keyboard.press('F3');
  await captureShowcase('urban', 'roads-urban.png', 410);
  await captureShowcase('mountain', 'roads-mountain.png', 480);
  await captureShowcase('steepRoad', 'roads-steep.png', 360);
  await captureShowcase('liangshan', 'roads-liangshan.png', 520);
  await captureShowcase('timber', 'roads-timber.png', 300);
  await captureShowcase('europe', 'terrain-europe.png', 620);
  await captureShowcase('lakeRoad', 'roads-lake.png', 380);
  await page.evaluate(() => window.__ironfrontsRenderer?.setDebugView(5));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDirectory, 'roads-levels.png') });
  await page.evaluate(() => window.__ironfrontsRenderer?.setDebugView(6));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDirectory, 'roads-roles.png') });
  await page.evaluate(() => window.__ironfrontsRenderer?.setDebugView(7));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDirectory, 'roads-surfaces.png') });
}

const report = { ...status, headless, validation, errors };
await writeFile(path.join(outputDirectory, 'visual-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (status.unsupported || errors.length) process.exitCode = 1;
