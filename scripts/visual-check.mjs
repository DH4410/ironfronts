import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.IRONFRONTS_BROWSER ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDirectory = fileURLToPath(new URL('../artifacts/', import.meta.url));
const headless = process.env.IRONFRONTS_HEADLESS !== 'false';
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless,
  args: headless ? [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
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
  message: document.querySelector('#unsupported p:last-child')?.textContent ?? '',
}));
await page.screenshot({ path: path.join(outputDirectory, 'overview.png') });

if (!status.unsupported) {
  // Central Africa gives the close pass forests, topography, and several major rivers.
  await page.mouse.move(900, 625);
  await page.mouse.wheel(0, -3_700);
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: path.join(outputDirectory, 'terrain-close.png') });
  await page.keyboard.press('F3');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDirectory, 'diagnostics.png') });
}

console.log(JSON.stringify({ ...status, errors }, null, 2));
await browser.close();
if (status.unsupported) process.exitCode = 1;
