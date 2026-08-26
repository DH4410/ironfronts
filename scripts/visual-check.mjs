import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCheckPage } from './qa/browser.mjs';
import { writeJsonReport } from './qa/reports.mjs';

const outputDirectory = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(outputDirectory, { recursive: true });

const { browser, page, errors, headless } = await launchCheckPage();

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
    countries: counts.countries,
  };
});
if (validation.maximumHeight > 60.5) errors.push(`validation: maximum elevation ${validation.maximumHeight.toFixed(3)} exceeds 60.5`);
if (validation.maximumSlopeStep > 2.01) errors.push(`validation: terrain step ${validation.maximumSlopeStep.toFixed(3)} exceeds 2.01`);
if (validation.capViolations !== 0) errors.push(`validation: ${validation.capViolations} terrain samples exceed their local cap`);
if (validation.steepEmittedRoads <= 0) errors.push('validation: no incline-warning roads were emitted');
if (validation.riverSystems !== 24 || validation.riverSegments !== 527) errors.push('validation: authoritative river graph is incomplete');
if (validation.canalSystems !== 2) errors.push('validation: Kiel and Suez canal surfaces are incomplete');
if (validation.countries !== 200) errors.push(`validation: expected 200 countries, found ${validation.countries}`);
await page.screenshot({ path: path.join(outputDirectory, 'overview.png') });

if (!status.unsupported) {
  validation.visibleCountryLabels = await page.evaluate(() =>
    window.__ironfrontsRenderer?.getPerformanceSnapshot().workload.labels ?? 0);
  if (validation.visibleCountryLabels <= 0) errors.push('validation: no country labels are visible at world zoom');
  await page.evaluate(() => window.__ironfrontsRenderer?.setCountryOverlayVisible(false));
  await page.waitForTimeout(120);
  validation.countryToggleHidesLabels = await page.evaluate(() =>
    (window.__ironfrontsRenderer?.getPerformanceSnapshot().workload.labels ?? -1) === 0);
  if (!validation.countryToggleHidesLabels) errors.push('validation: country overlay toggle did not hide labels');
  await page.evaluate(() => window.__ironfrontsRenderer?.setCountryOverlayVisible(true));
  await page.evaluate(() => {
    const renderer = window.__ironfrontsRenderer;
    renderer?.setProvinceOwner(0, 1);
    renderer?.setProvinceOwner(0, 24);
  });
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
  const captureCamera = async (point, filename, distance, yaw, pitch) => {
    await page.evaluate(({ point, distance, yaw, pitch }) => {
      window.__ironfrontsRenderer?.focus(point[0], point[1], distance, yaw, pitch);
    }, { point, distance, yaw, pitch });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outputDirectory, filename) });
  };

  await page.keyboard.press('F3');
  // Camera/chunk regressions: both horizontal seams must render their adjacent
  // world at the shallowest pitch, and a camera placed directly over a chunk
  // corner must not cull a chunk merely because its center is behind the near
  // plane.
  const world = await page.evaluate(async () => {
    const manifest = await fetch('/world/world.json').then((response) => response.json());
    return {
      width: manifest.world.width,
      height: manifest.world.height,
      chunksX: manifest.terrain.chunksX,
      chunksY: manifest.terrain.chunksY,
    };
  });
  await captureCamera([24, world.height * 0.5], 'camera-seam-west-tilted.png', 1_800, 1.18, 0.43);
  await captureCamera([world.width - 24, world.height * 0.5], 'camera-seam-east-tilted.png', 1_800, -1.18, 0.43);
  await captureCamera([24, world.height * 0.5], 'camera-horizontal-edge-fog-west.png', 9_000, 1.57, 0.43);
  await captureCamera([world.width - 24, world.height * 0.5], 'camera-horizontal-edge-fog-east.png', 9_000, -1.57, 0.43);
  await captureCamera([world.width * 0.5, 24], 'polar-cap-north.png', 2_400, 0, 0.56);
  await captureCamera([world.width * 0.5, world.height - 24], 'polar-cap-south.png', 2_400, Math.PI, 0.56);
  await captureCamera([world.width * 0.5, 24], 'polar-cap-north-overview.png', 7_000, 0, 0.72);
  const chunkCorner = [world.width * 17 / world.chunksX, world.height * 9 / world.chunksY];
  await captureCamera(chunkCorner, 'camera-max-zoom-chunk-corner-a.png', 180, -0.78, 1.23);
  await captureCamera(chunkCorner, 'camera-max-zoom-chunk-corner-b.png', 180, 2.36, 1.23);
  validation.cameraRegressionCaptures = 9;

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
  validation.riverAnimationChanged = false;
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
await writeJsonReport(outputDirectory, 'visual-report.json', report);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (status.unsupported || errors.length) process.exitCode = 1;
