#!/usr/bin/env node
/**
 * Browser playtest driver: starts the Vite dev server, opens the game in
 * headless Chromium, plays a key script and saves screenshots + a report.
 *
 *   node tools/playtest/browser.mjs <script.json> [--out DIR] [--mobile]
 *   node tools/playtest/browser.mjs smoke        (built-in quick look at menu + 10 s of city driving)
 *
 * Script JSON: { "url": "?mode=city&seed=1337", "steps": [
 *   { "click": "button:has-text('FREE ROAM')" }, // Playwright selector
 *   { "press": "Enter" },                       // tap a key
 *   { "hold": ["KeyW","KeyD"], "ms": 1500 },    // hold keys (KeyboardEvent.code names) for ms
 *   { "wait": 500 },
 *   { "shot": "name" },                          // screenshot -> DIR/name.png
 *   { "tap": "#some-touch-button", "ms": 800 }   // press-and-hold a pointer on an element (mobile)
 * ] }
 * Report (DIR/report.json): console errors, page errors, avg FPS, HUD text samples.
 */
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Playwright is preinstalled globally in the cloud sandbox; locally `npm i -D playwright`.
const require = createRequire(import.meta.url);
const { chromium, devices } = (() => { try { return require('playwright'); } catch { return require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const target = args[0] ?? 'smoke';
const out = path.resolve(flag('out', path.join(root, 'tools/playtest/out', path.basename(target, '.json'))));
mkdirSync(out, { recursive: true });

const SMOKE = {
  url: '?mode=city&seed=1337&low',
  steps: [
    { wait: 1500 }, { shot: '00-menu' },
    { click: 'button:has-text("FREE ROAM")' }, { wait: 800 }, { shot: '01-start' },
    { hold: ['KeyW'], ms: 3000 }, { shot: '02-accel' },
    { hold: ['KeyW', 'KeyD'], ms: 1200 }, { shot: '03-turn' },
    { hold: ['KeyE', 'KeyA'], ms: 1200 }, { shot: '04-drift' },
    { hold: ['KeyW'], ms: 2500 }, { shot: '05-end' },
  ],
};
const script = target === 'smoke' ? SMOKE : JSON.parse(readFileSync(target, 'utf8'));
const mobile = args.includes('--mobile') || script.mobile;

const server = await createServer({ root, logLevel: 'error', server: { port: 5199 + Math.floor(Math.random() * 300), strictPort: false, host: '127.0.0.1', watch: { ignored: ['**/playtests/**', '**/tools/playtest/**'] } } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const report = { url: base + (script.url ?? ''), consoleErrors: [], pageErrors: [], shots: [], hud: [], fps: null };
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.consoleErrors.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 300)));
await page.addInitScript(() => {
  window.__frames = 0;
  const loop = () => { window.__frames++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
await page.goto(report.url, { waitUntil: 'load' });
const t0 = Date.now();
const hudText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400);
for (const s of script.steps) {
  try {
    if (s.click) await page.click(s.click, { timeout: 3000, force: true }); // menu buttons pulse, so skip the stability wait
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.hold) {
      for (const k of s.hold) await page.keyboard.down(k);
      await page.waitForTimeout(s.ms ?? 1000);
      for (const k of s.hold) await page.keyboard.up(k);
    } else if (s.tap) {
      const box = await page.locator(s.tap).first().boundingBox();
      if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(s.ms ?? 500); await page.mouse.up(); }
    } else if (s.wait) await page.waitForTimeout(s.wait);
    else if (s.shot) {
      const f = path.join(out, `${s.shot}.png`);
      await page.screenshot({ path: f });
      report.shots.push(f);
      report.hud.push({ shot: s.shot, text: await hudText() });
    }
  } catch (e) { report.pageErrors.push(`step ${JSON.stringify(s)} failed: ${String(e).slice(0, 200)}`); }
}
const frames = await page.evaluate(() => window.__frames);
report.fps = +(frames / ((Date.now() - t0) / 1000)).toFixed(1);
report.note = 'FPS is headless software-GL (SwiftShader); treat as relative only.';
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
await server.close();
