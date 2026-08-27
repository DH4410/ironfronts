import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCheckPage } from './qa/browser.mjs';

const outputDirectory = fileURLToPath(new URL('../artifacts/review-ui/', import.meta.url));
await mkdir(outputDirectory, { recursive: true });
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const { browser, page, errors, headless } = await launchCheckPage({ width: 1600, height: 1000 });

const capture = async (name) => {
  await page.screenshot({ path: path.join(outputDirectory, name) });
};

const report = {
  baseUrl,
  headless,
  webgpu: false,
  unsupported: false,
  menu: {},
  world: {},
  drag: {},
  errors,
};

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#menu-root', { state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(900);
  await capture('01-lobby.png');

  report.menu.lobbyVisible = await page.isVisible('#menu-root');
  report.menu.worldCanvasDormant = await page.evaluate(() => document.querySelector('#world')?.hasAttribute('hidden') ?? false);

  await page.click('[data-open="campaign"]');
  await page.waitForFunction(() => !document.querySelector('#ifm-campaign')?.hasAttribute('hidden'));
  await page.waitForTimeout(900);
  await capture('02-campaign.png');

  await page.click('[data-op="OP-1941-22"]');
  await page.waitForTimeout(180);
  report.menu.selectedOperation = await page.textContent('#ifm-briefing-theater');
  await capture('03-campaign-selected.png');

  await page.click('#ifm-campaign [data-back]');
  await page.waitForFunction(() => document.querySelector('#ifm-campaign')?.hasAttribute('hidden'));
  await page.waitForTimeout(200);

  await page.click('[data-open="settings"]');
  await page.waitForFunction(() => !document.querySelector('#ifm-settings')?.hasAttribute('hidden'));
  await page.waitForTimeout(900);
  await capture('04-settings.png');

  await page.click('#ifm-settings [data-back]');
  await page.waitForFunction(() => document.querySelector('#ifm-settings')?.hasAttribute('hidden'));

  await page.click('[data-open="campaign"]');
  await page.waitForFunction(() => !document.querySelector('#ifm-campaign')?.hasAttribute('hidden'));
  await page.waitForTimeout(850);
  await page.click('#ifm-start-operation');

  await page.waitForFunction(() => document.querySelector('#menu-root')?.hasAttribute('hidden'), null, { timeout: 10_000 });
  await page.waitForTimeout(250);
  await capture('05-loading.png');

  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const unsupported = document.querySelector('#unsupported');
    return loading?.hasAttribute('hidden') || !unsupported?.hasAttribute('hidden');
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(900);

  const status = await page.evaluate(() => ({
    webgpu: Boolean(navigator.gpu),
    unsupported: !(document.querySelector('#unsupported')?.hasAttribute('hidden') ?? true),
  }));
  report.webgpu = status.webgpu;
  report.unsupported = status.unsupported;

  if (!status.unsupported) {
    await page.waitForFunction(() => Boolean(window.__ironfrontsRenderer), null, { timeout: 10_000 });
    await capture('06-world-overview.png');

    const world = await page.evaluate(async () => {
      const manifest = await fetch('/world/world.json').then((response) => response.json());
      return {
        width: manifest.world.width,
        height: manifest.world.height,
        showcases: manifest.showcases,
      };
    });

    const focus = async (point, distance, filename) => {
      await page.evaluate(({ point, distance }) => {
        window.__ironfrontsRenderer?.focus(point[0], point[1], distance);
      }, { point, distance });
      await page.waitForTimeout(850);
      await capture(filename);
    };

    await focus(world.showcases.europe, 620, '07-europe.png');
    await focus(world.showcases.urban, 410, '08-urban.png');
    await focus(world.showcases.riverMouth, 460, '09-river-mouth.png');
    await focus(world.showcases.mountain, 480, '10-mountain.png');
    await focus([world.width * 0.5, 24], 7000, '11-polar-overview.png');

    await focus(world.showcases.europe, 1200, '12-before-drag.png');
    const before = await page.evaluate(() => {
      const target = window.__ironfrontsRenderer?.camera.target;
      return target ? [target[0], target[1], target[2]] : null;
    });
    await page.mouse.move(800, 500);
    await page.mouse.down();
    await page.mouse.move(800, 700, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => {
      const target = window.__ironfrontsRenderer?.camera.target;
      return target ? [target[0], target[1], target[2]] : null;
    });
    report.drag = { before, after, movedDownNaturally: Boolean(before && after && after[2] < before[2]) };
    await capture('13-after-drag.png');

    report.world.rendererStarted = true;
    report.world.countryLabels = await page.evaluate(() =>
      window.__ironfrontsRenderer?.getPerformanceSnapshot().workload.labels ?? 0);
  }
} catch (error) {
  errors.push(`review-script: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await writeFile(path.join(outputDirectory, 'review-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (errors.length || report.unsupported || !report.menu.lobbyVisible) process.exitCode = 1;
