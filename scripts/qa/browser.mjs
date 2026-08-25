import { chromium } from 'playwright-core';

export async function launchCheckPage(viewport = { width: 1600, height: 1000 }) {
  const executablePath = process.env.IRONFRONTS_BROWSER ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const headless = process.env.IRONFRONTS_HEADLESS
    ? process.env.IRONFRONTS_HEADLESS !== 'false'
    : process.platform !== 'win32';
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
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  return { browser, page, errors, headless };
}
