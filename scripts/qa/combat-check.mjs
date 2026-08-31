/**
 * Foreground visual QA for the combat / HUD pass. Reuses launchCheckPage()
 * (headed real Chrome + WebGPU on win32), drives Continue -> in-game -> select
 * a friendly army -> aim an attack, and screenshots each stage into artifacts/.
 *
 *   node scripts/qa/combat-check.mjs [url]
 *
 * Standalone on purpose: visual-check.mjs carries hard world-validation
 * assertions that would fail this run for unrelated reasons.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCheckPage } from './browser.mjs';

const out = fileURLToPath(new URL('../../artifacts/', import.meta.url));
await mkdir(out, { recursive: true });
const shot = (name) => ({ path: path.join(out, name) });

const { browser, page, errors } = await launchCheckPage();
const log = (...a) => console.log('[combat-check]', ...a);
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';

try {
  // Isolated QA account (Playwright profile is already isolated). No country
  // assignment, so this drives the real New Campaign flow and never touches
  // the user's Greece save.
  const auth = await fetch('http://127.0.0.1:3001/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ username: `qa-combat-${Date.now()}`, password: `qa-${Date.now()}-pw` }),
  }).then((r) => (r.ok ? r : fetch('http://127.0.0.1:3001/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ username: 'qa-combat', password: 'qa-combat-pw-9137' }),
  })));
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  const [name, value] = cookie.split('=');
  await page.context().addCookies([
    { name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  log('authed as QA account; cookie set');

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);
  await page.screenshot(shot('cc-00-menu.png'));

  // New Campaign -> dossier -> Begin Operation -> pick first nation -> Confirm.
  await page.evaluate(() => document.getElementById('ifm-new-campaign')?.click());
  await page.waitForTimeout(1_200);
  await page.evaluate(() => document.getElementById('ifm-begin-operation')?.click());
  await page.waitForTimeout(900);
  await page.screenshot(shot('cc-00b-nation-picker.png'));
  await page.evaluate(() => {
    document.querySelector('#ifm-country-grid .ifm__country:not(.is-unavailable)')?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('ifm-confirm-nation')?.click());

  await page.waitForFunction(
    () => !!window.__ironfrontsSession && document.getElementById('loading')?.hasAttribute('hidden'),
    null, { timeout: 60_000 },
  );
  await page.waitForTimeout(1_500);
  await page.screenshot(shot('cc-01-ingame.png'));

  const overview = await page.evaluate(() => {
    const s = window.__ironfrontsSession;
    const armies = Object.values(s.state.armies);
    return {
      tick: s.state.simulationTick,
      total: armies.length,
      own: armies.filter((a) => a.own).length,
      visibleEnemies: armies.filter((a) => !a.own && a.contact === 'visible').length,
      contactEnemies: armies.filter((a) => !a.own && a.contact === 'contact').length,
      nowPlaying: document.getElementById('now-playing-title')?.textContent ?? null,
      nowPlayingShown: !document.getElementById('now-playing')?.hidden,
    };
  });
  log('overview', JSON.stringify(overview));

  // Focus a friendly army, then screen-project it and click it to select.
  const picked = await page.evaluate(() => {
    const s = window.__ironfrontsSession;
    const r = window.__ironfrontsRenderer;
    const mine = Object.values(s.state.armies).find((a) => a.own && a.status !== 'engaged');
    if (!mine) return null;
    r.focus(mine.x, mine.z, 700);
    return { id: mine.id, x: mine.x, z: mine.z };
  });
  log('friendly army', JSON.stringify(picked));
  await page.waitForTimeout(1_200);
  await page.screenshot(shot('cc-02-focus-friendly.png'));

  // Click the friendly army at screen-centre (renderer.focus centres it).
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(700);
  const panel = await page.evaluate(() => {
    const el = document.querySelector('.ifg-army-panel');
    return { armyPanelShown: el ? !el.hidden : false, cursor: document.getElementById('world')?.style.cursor ?? '' };
  });
  log('after friendly click', JSON.stringify(panel));
  await page.screenshot(shot('cc-03-army-selected.png'));

  // Enter attack targeting (A), move the cursor over a visible enemy, screenshot the cursor.
  const enemy = await page.evaluate(() => {
    const s = window.__ironfrontsSession;
    const vis = Object.values(s.state.armies).find((a) => !a.own && a.contact === 'visible');
    const con = Object.values(s.state.armies).find((a) => !a.own && a.contact === 'contact');
    return {
      visible: vis ? { x: vis.x, z: vis.z } : null,
      contact: con ? { x: con.x, z: con.z } : null,
      selected: window.__ironfrontsRenderer ? true : false,
    };
  });
  log('enemy targets', JSON.stringify(enemy));

  if (enemy.visible) {
    // Re-select the friendly army (a prior click may have picked the enemy),
    // arm attack targeting with the new 'a' hotkey, frame the enemy, screenshot
    // the cursor, then click to issue — capturing the reticle + toast.
    await page.evaluate((id) => {
      const r = window.__ironfrontsRenderer;
      const a = window.__ironfrontsSession.state.armies[id];
      r.focus(a.x, a.z, 650);
    }, picked.id);
    await page.waitForTimeout(700);
    await page.mouse.click(vp.width / 2, vp.height / 2); // select friendly
    await page.waitForTimeout(300);
    await page.keyboard.press('a'); // arm attack targeting
    await page.waitForTimeout(200);
    await page.evaluate(({ x, z }) => window.__ironfrontsRenderer.focus(x, z, 650), enemy.visible);
    await page.waitForTimeout(900);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(200);
    const cur = await page.evaluate(() => document.getElementById('world')?.style.cursor ?? '');
    log('cursor over VISIBLE enemy:', cur);
    await page.screenshot(shot('cc-04-attack-cursor-visible.png'));

    await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(90);
    await page.screenshot(shot('cc-05-attack-issued.png'));
    await page.waitForTimeout(1_100);
    const post = await page.evaluate((id) => {
      const a = window.__ironfrontsSession.state.armies[id];
      const toast = [...document.querySelectorAll('.ifg-notify__item')].map((n) => n.textContent);
      return { status: a?.status, moveIntent: a?.moveIntent, toasts: toast };
    }, picked.id);
    log('after attack issued:', JSON.stringify(post));
    await page.screenshot(shot('cc-06-after-attack.png'));
  }
  if (enemy.contact) {
    await page.evaluate((id) => {
      const r = window.__ironfrontsRenderer;
      const a = window.__ironfrontsSession.state.armies[id];
      r.focus(a.x, a.z, 650);
    }, picked.id);
    await page.waitForTimeout(700);
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(300);
    await page.keyboard.press('a');
    await page.waitForTimeout(200);
    await page.evaluate(({ x, z }) => window.__ironfrontsRenderer.focus(x, z, 420), enemy.contact);
    await page.waitForTimeout(900);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(200);
    const probe = await page.evaluate(() => {
      const r = window.__ironfrontsRenderer;
      const s = window.__ironfrontsSession;
      const id = r.pickArmyAt(window.innerWidth / 2, window.innerHeight / 2);
      const a = id ? s.state.armies[id] : null;
      return {
        cursor: document.getElementById('world')?.style.cursor ?? '',
        pickedId: id,
        pickedContact: a ? a.contact : null,
        pickedOwn: a ? a.own : null,
      };
    });
    // Correct outcome: either the pick under the cursor is a contact-only enemy
    // AND the cursor is not the attack cursor, or the pick is a *visible* enemy
    // (the attack cursor is then legitimate).
    log('contact-only probe:', JSON.stringify(probe));
    const leak = probe.pickedContact === 'contact' && probe.cursor.includes('action-attack');
    log(leak ? 'FAIL: attack cursor over a contact-only target (fog leak)' : 'OK: no attack affordance for contact-only');
    if (leak) errors.push('fog: attack cursor shown for a contact-only target');
    await page.screenshot(shot('cc-07-cursor-contact-only.png'));
  }

  // Building scale + coastline: park over the urban showcase, close in.
  await page.evaluate(async () => {
    const r = window.__ironfrontsRenderer;
    const m = await fetch('/world/world.json').then((x) => x.json());
    r.focus(m.showcases.urban[0], m.showcases.urban[1], 360);
  });
  await page.waitForTimeout(1_100);
  await page.screenshot(shot('cc-08-buildings-close.png'));

  log('console errors:', errors.length ? errors.join(' | ') : 'none');
} catch (err) {
  console.error('[combat-check] FAILED:', err.message);
  await page.screenshot(shot('cc-99-failure.png')).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
