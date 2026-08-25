import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.IRONFRONTS_BROWSER ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDirectory = fileURLToPath(new URL('../artifacts/', import.meta.url));
const scenarioDuration = Number(process.env.IRONFRONTS_BENCHMARK_MS ?? 2_200);
const warmupDuration = Number(process.env.IRONFRONTS_BENCHMARK_WARMUP_MS ?? 600);
const headless = process.env.IRONFRONTS_HEADLESS
  ? process.env.IRONFRONTS_HEADLESS !== 'false'
  : process.platform !== 'win32';
const targetUrl = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/');
targetUrl.searchParams.set('benchmark', '1');

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
await page.addInitScript(() => {
  window.__ironfrontsLongTasks = [];
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__ironfrontsLongTasks.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch { /* Long-task timing is optional. */ }
  }
});

await page.goto(targetUrl.href, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('#loading')?.hasAttribute('hidden')
  || !document.querySelector('#unsupported')?.hasAttribute('hidden'), null, { timeout: 30_000 });
const unsupported = await page.locator('#unsupported').evaluate((element) => !element.hasAttribute('hidden'));
if (unsupported) {
  errors.push(`WebGPU unavailable: ${await page.locator('#unsupported p:last-child').textContent()}`);
} else {
  await page.waitForFunction(() => Boolean(window.__ironfrontsRenderer?.getPerformanceSnapshot));
}

const system = await page.evaluate(() => {
  const memory = performance.memory;
  const canvas = document.querySelector('#world');
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    renderResolution: canvas ? [canvas.width, canvas.height] : null,
    jsHeapLimitBytes: memory?.jsHeapSizeLimit ?? null,
  };
});

const manifest = unsupported ? null : await page.evaluate(() => fetch('/world/world.json').then((response) => response.json()));
const scenarios = [];

async function setAllLayers(overrides = {}) {
  await page.evaluate((options) => {
    const renderer = window.__ironfrontsRenderer;
    renderer.setPropsVisible(options.props ?? true);
    renderer.setRoadsVisible(options.roads ?? true);
    renderer.setHiddenConnectionsVisible(options.hiddenLinks ?? true);
    renderer.setWaterwaysVisible(options.waterways ?? true);
    renderer.setBordersVisible(options.borders ?? true);
    renderer.setCountryOverlayVisible(options.countries ?? true);
    renderer.setPerformanceLayerVisibility({
      terrain: options.terrain ?? true,
      ocean: options.ocean ?? true,
      trees: options.trees ?? true,
      buildings: options.buildings ?? true,
      roadFurniture: options.roadFurniture ?? true,
    });
  }, overrides);
}

async function focus(point, distance, yaw = -0.48, pitch = 0.82) {
  await page.evaluate(({ point, distance, yaw, pitch }) => {
    window.__ironfrontsRenderer.focus(point[0], point[1], distance, yaw, pitch);
  }, { point, distance, yaw, pitch });
}

async function measure(name, prepare, exercise, duration = scenarioDuration) {
  await prepare();
  await page.waitForTimeout(warmupDuration);
  await page.evaluate(() => {
    window.__ironfrontsLongTasks.length = 0;
    window.__ironfrontsRenderer.resetPerformanceSamples();
  });
  const heapBefore = await readHeap();
  const started = Date.now();
  await exercise(duration);
  const remaining = duration - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  const result = await page.evaluate(() => ({
    timing: window.__ironfrontsRenderer.getPerformanceSnapshot(),
    longTasks: [...window.__ironfrontsLongTasks],
  }));
  const heapAfter = await readHeap();
  scenarios.push({
    name,
    ...result.timing,
    longTasks: {
      count: result.longTasks.length,
      totalMs: sum(result.longTasks),
      maximumMs: Math.max(0, ...result.longTasks),
    },
    heap: heapBefore == null || heapAfter == null ? null : {
      beforeBytes: heapBefore,
      afterBytes: heapAfter,
      deltaBytes: heapAfter - heapBefore,
    },
  });
}

async function readHeap() {
  return page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
}

const idle = async (duration) => page.waitForTimeout(duration);

if (!unsupported && manifest) {
  await measure('world overview idle', async () => {
    await setAllLayers();
    await focus([manifest.world.width * 0.5, manifest.world.height * 0.5], manifest.world.width * 0.66, 0, 0.78);
  }, idle);

  await measure('dense urban close idle', async () => {
    await setAllLayers();
    await focus(manifest.showcases.urban, 360);
  }, idle);

  await measure('Europe regional idle', async () => {
    await setAllLayers();
    await focus(manifest.showcases.europe, 620);
  }, idle);

  await measure('continuous pan', async () => {
    await setAllLayers();
    await focus(manifest.showcases.europe, 760);
  }, async (duration) => {
    const startX = 960;
    const startY = 560;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    const steps = 90;
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      await page.mouse.move(startX - 520 * progress, startY + Math.sin(progress * Math.PI * 4) * 90);
      await page.waitForTimeout(duration / steps);
    }
    await page.mouse.up({ button: 'left' });
  });

  await measure('continuous orbit', async () => {
    await setAllLayers();
    await focus(manifest.showcases.mountain, 520);
  }, async (duration) => {
    const startX = 820;
    const startY = 520;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    const steps = 90;
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      await page.mouse.move(startX + 620 * progress, startY + Math.sin(progress * Math.PI * 2) * 130);
      await page.waitForTimeout(duration / steps);
    }
    await page.mouse.up({ button: 'right' });
  });

  await measure('zoom in and out', async () => {
    await setAllLayers();
    await focus(manifest.showcases.europe, 3_200);
    await page.mouse.move(800, 520);
  }, async (duration) => {
    const steps = 32;
    for (let step = 0; step < steps; step += 1) {
      await page.mouse.wheel(0, step < steps / 2 ? -260 : 260);
      await page.waitForTimeout(duration / steps);
    }
  });

  const ablations = [
    ['layer baseline', {}],
    ['without props', { props: false }],
    ['without trees', { trees: false }],
    ['without buildings', { buildings: false }],
    ['without road furniture', { roadFurniture: false }],
    ['without roads', { roads: false, hiddenLinks: false }],
    ['without waterways', { waterways: false }],
    ['without politics', { borders: false, countries: false }],
    ['without terrain surface', { terrain: false }],
    ['without ocean surface', { ocean: false }],
  ];
  for (const [name, layers] of ablations) {
    await measure(name, async () => {
      await setAllLayers(layers);
      await focus(manifest.showcases.europe, 620);
      await page.dispatchEvent('#world', 'pointerleave');
    }, idle);
  }
  await setAllLayers();
}

const worstScenarios = [...scenarios]
  .filter((scenario) => !scenario.name.startsWith('without ') && scenario.name !== 'layer baseline')
  .sort((a, b) => b.frame.p95 - a.frame.p95)
  .map((scenario) => ({ name: scenario.name, averageFrameMs: scenario.frame.average, p95FrameMs: scenario.frame.p95, averageGpuMs: scenario.gpu?.average ?? null }));
const cpuHotspots = scenarios.flatMap((scenario) => Object.entries(scenario.phases).map(([phase, timing]) => ({
  scenario: scenario.name,
  phase,
  averageMs: timing.average,
  p95Ms: timing.p95,
}))).sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 8);
const baseline = scenarios.find((scenario) => scenario.name === 'layer baseline');
const layerCosts = baseline ? scenarios
  .filter((scenario) => scenario.name.startsWith('without '))
  .map((scenario) => {
    const useGpu = baseline.gpu && scenario.gpu && baseline.gpuSampleCount >= 3 && scenario.gpuSampleCount >= 3;
    const metric = useGpu ? 'GPU' : 'frame interval';
    // A few GPU samples can contain queueing outliers; medians keep the
    // ablation ranking stable without hiding frame-tail data elsewhere.
    const baselineMs = useGpu ? baseline.gpu.median : baseline.frame.median;
    const reducedMs = useGpu ? scenario.gpu.median : scenario.frame.median;
    return { layer: scenario.name.replace('without ', ''), metric, estimatedCostMs: baselineMs - reducedMs };
  })
  .sort((a, b) => b.estimatedCostMs - a.estimatedCostMs) : [];
const report = {
  generatedAt: new Date().toISOString(),
  url: targetUrl.href,
  headless,
  scenarioDuration,
  warmupDuration,
  system,
  summary: { worstScenarios, cpuHotspots, layerCosts },
  scenarios,
  errors,
};
await writeFile(path.join(outputDirectory, 'performance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputDirectory, 'performance-report.md'), renderMarkdown(report));
console.log(renderConsoleSummary(report));
await browser.close();
if (unsupported || errors.length) process.exitCode = 1;

function renderConsoleSummary(report) {
  const lines = ['Ironfronts performance check', ''];
  for (const scenario of report.summary.worstScenarios) {
    lines.push(`${scenario.name.padEnd(26)} avg ${scenario.averageFrameMs.toFixed(2)} ms  p95 ${scenario.p95FrameMs.toFixed(2)} ms${scenario.averageGpuMs == null ? '' : `  GPU ${scenario.averageGpuMs.toFixed(2)} ms`}`);
  }
  lines.push('', 'Main-thread hotspots:');
  for (const hotspot of report.summary.cpuHotspots.slice(0, 5)) {
    lines.push(`${hotspot.phase.padEnd(10)} p95 ${hotspot.p95Ms.toFixed(2)} ms  ${hotspot.scenario}`);
  }
  lines.push('', 'Estimated layer cost:');
  for (const layer of report.summary.layerCosts) lines.push(`${layer.layer.padEnd(12)} ${layer.estimatedCostMs.toFixed(2)} ms (${layer.metric})`);
  if (report.errors.length) lines.push('', ...report.errors);
  return lines.join('\n');
}

function renderMarkdown(report) {
  const lines = [
    '# Ironfronts performance report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Viewport: ${report.system.viewport?.join('x')} CSS pixels; render target: ${report.system.renderResolution?.join('x')}.`,
    '',
    '## Most demanding scenarios',
    '',
    '| Scenario | Average frame | P95 frame | Average GPU |',
    '| --- | ---: | ---: | ---: |',
    ...report.summary.worstScenarios.map((item) => `| ${item.name} | ${item.averageFrameMs.toFixed(2)} ms | ${item.p95FrameMs.toFixed(2)} ms | ${item.averageGpuMs == null ? 'unavailable' : `${item.averageGpuMs.toFixed(2)} ms`} |`),
    '',
    '## Main-thread hotspots',
    '',
    '| Scenario | Phase | Average | P95 |',
    '| --- | --- | ---: | ---: |',
    ...report.summary.cpuHotspots.map((item) => `| ${item.scenario} | ${item.phase} | ${item.averageMs.toFixed(2)} ms | ${item.p95Ms.toFixed(2)} ms |`),
    '',
    '## Estimated layer cost',
    '',
    'A positive value is the measured time saved when that layer was disabled. Small negative values are normal measurement noise.',
    '',
    '| Layer | Estimated cost | Metric |',
    '| --- | ---: | --- |',
    ...report.summary.layerCosts.map((item) => `| ${item.layer} | ${item.estimatedCostMs.toFixed(2)} ms | ${item.metric} |`),
    '',
    '## All scenarios',
    '',
    '| Scenario | Samples | Average | P95 | P99 | CPU | GPU | Draws | Triangles | Long tasks |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.scenarios.map((item) => `| ${item.name} | ${item.sampleCount} | ${item.frame.average.toFixed(2)} | ${item.frame.p95.toFixed(2)} | ${item.frame.p99.toFixed(2)} | ${item.mainThread.average.toFixed(2)} | ${item.gpu ? item.gpu.average.toFixed(2) : '—'} | ${item.workload.drawCalls} | ${item.workload.triangles.toLocaleString('en')} | ${item.longTasks.count} |`),
    '',
    report.errors.length ? `Errors: ${report.errors.join('; ')}` : 'No browser or renderer errors were captured.',
    '',
  ];
  return lines.join('\n');
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
