#!/usr/bin/env node
/**
 * Browser playtest driver: starts the Vite dev server, opens the game in
 * headless Chromium (Playwright if available, else native Chromium CDP), plays
 * a key/click script and saves screenshots + a JSON report.
 *
 *   node tools/playtest/browser.mjs <script.json> [--out DIR] [--mobile]
 *   node tools/playtest/browser.mjs smoke        (built-in quick look at menu + 10 s of city driving)
 *
 * Script JSON: { "url": "?mode=city&seed=1337", "steps": [
 *   { "click": "button:has-text('FREE ROAM')" }, // Playwright or :has-text() selector
 *   { "press": "Enter" },                       // tap a key
 *   { "hold": ["KeyW","KeyD"], "ms": 1500 },    // hold keys (KeyboardEvent.code names) for ms
 *   { "wait": 500 },
 *   { "shot": "name" },                         // screenshot -> DIR/name.png
 *   { "tap": "#some-touch-button", "ms": 800 }  // press-and-hold a pointer on an element (mobile)
 * ] }
 * Report (DIR/report.json): console errors, page errors, avg FPS, HUD text samples.
 */
import { createServer } from 'vite';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const target = args[0] ?? 'smoke';
const out = path.resolve(flag('out', path.join(root, 'tools/playtest/out', path.basename(target, '.json'))));
mkdirSync(out, { recursive: true });

const SMOKE = {
  url: '?mode=city&seed=1337&low',
  steps: [
    { wait: 1500 }, { shot: '00-menu' },
    { click: 'button.go-btn.play' }, { wait: 600 }, { shot: '01-car-select' },
    { click: 'button.car-select-go' }, { wait: 800 }, { shot: '02-start' },
    { hold: ['KeyW'], ms: 3000 }, { shot: '03-accel' },
    { hold: ['KeyW', 'KeyD'], ms: 1200 }, { shot: '04-turn' },
    { hold: ['KeyE', 'KeyA'], ms: 1200 }, { shot: '05-drift' },
    { hold: ['KeyW'], ms: 2500 }, { shot: '06-end' },
  ],
};
const script = target === 'smoke' ? SMOKE : JSON.parse(readFileSync(target, 'utf8'));
const mobile = args.includes('--mobile') || script.mobile;

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    try {
      const globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      return require(path.join(globalRoot, 'playwright'));
    } catch {
      return null;
    }
  }
}

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    try {
      const p = execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch {
      /* ignore missing binary */
    }
  }
  return null;
}

const KEY_DEFS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  ' ': { key: ' ', code: 'Space', vk: 32 },
  ShiftLeft: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
  ShiftRight: { key: 'Shift', code: 'ShiftRight', vk: 16 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
};
function keyDef(name) {
  if (KEY_DEFS[name]) return KEY_DEFS[name];
  if (/^Key[A-Z]$/.test(name)) {
    const ch = name.slice(3).toLowerCase();
    return { key: ch, code: name, vk: name.charCodeAt(3) };
  }
  if (/^Digit[0-9]$/.test(name)) {
    const ch = name.slice(5);
    return { key: ch, code: name, vk: name.charCodeAt(5) };
  }
  if (name.length === 1 && /[a-zA-Z]/.test(name)) {
    const up = name.toUpperCase();
    return { key: name.toLowerCase(), code: `Key${up}`, vk: up.charCodeAt(0) };
  }
  return { key: name, code: name, vk: 0 };
}

async function runPlaywright(pw, fullUrl, report) {
  const { chromium, devices } = pw;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const ctx = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') report.consoleErrors.push(`${m.type()}: ${m.text()}`.slice(0, 300));
    });
    page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 300)));
    await page.addInitScript(() => {
      window.__frames = 0;
      const loop = () => {
        window.__frames++;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.goto(fullUrl, { waitUntil: 'load' });
    const t0 = Date.now();
    const hudText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400);
    for (const s of script.steps) {
      try {
        if (s.click) await page.click(s.click, { timeout: 3000, force: true });
        else if (s.press) await page.keyboard.press(s.press);
        else if (s.hold) {
          for (const k of s.hold) await page.keyboard.down(k);
          await page.waitForTimeout(s.ms ?? 1000);
          for (const k of s.hold) await page.keyboard.up(k);
        } else if (s.tap) {
          const box = await page.locator(s.tap).first().boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(s.ms ?? 500);
            await page.mouse.up();
          }
        } else if (s.wait) await page.waitForTimeout(s.wait);
        else if (s.shot) {
          const f = path.join(out, `${s.shot}.png`);
          await page.screenshot({ path: f });
          report.shots.push(f);
          report.hud.push({ shot: s.shot, text: await hudText() });
        }
      } catch (e) {
        report.pageErrors.push(`step ${JSON.stringify(s)} failed: ${String(e).slice(0, 200)}`);
      }
    }
    const frames = await page.evaluate(() => window.__frames);
    report.fps = +(frames / ((Date.now() - t0) / 1000)).toFixed(1);
    report.perf = await page.evaluate(() => window.__KT3D_PERF__ ?? null);
  } finally {
    await browser.close();
  }
}

async function runCdp(chromePath, fullUrl, report) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'kt3d-cdp-'));
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  const proc = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let ws;
  try {
    const wsBase = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out launching Chromium: ${stderr.slice(-400)}`)), 10000);
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Chromium exited (${code}): ${stderr.slice(-400)}`));
      });
    });

    const port = new URL(wsBase).port;
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    const pageTarget = targets.find((t) => t.type === 'page') ?? targets[0];
    if (!pageTarget?.webSocketDebuggerUrl) throw new Error('No page target exposed by Chromium CDP');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();
    const on = (method, fn) => {
      let arr = listeners.get(method);
      if (!arr) listeners.set(method, (arr = []));
      arr.push(fn);
    };
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const arr = listeners.get(msg.method);
        if (arr) for (const fn of arr) fn(msg.params ?? {});
      }
    });
    const cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalFn = async (expr) => {
      const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval error');
      }
      return res.result?.value;
    };

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Log.enable');

    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        const txt = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        report.consoleErrors.push(`${p.type}: ${txt}`.slice(0, 300));
      }
    });
    on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      report.pageErrors.push(String(d?.exception?.description || d?.text || 'Page exception').slice(0, 300));
    });
    on('Log.entryAdded', (p) => {
      const e = p.entry;
      if (e && (e.level === 'error' || e.level === 'warning')) {
        report.consoleErrors.push(`${e.level}: ${e.text}${e.url ? ` (${e.url})` : ''}`.slice(0, 300));
      }
    });

    if (mobile) {
      await cdp('Emulation.setDeviceMetricsOverride', {
        width: 412,
        height: 915,
        deviceScaleFactor: 2.625,
        mobile: true,
        screenWidth: 412,
        screenHeight: 915,
      });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
    } else {
      await cdp('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }

    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__frames = 0; const __loop = () => { window.__frames++; requestAnimationFrame(__loop); }; requestAnimationFrame(__loop);`,
    });

    let loaded = false;
    on('Page.loadEventFired', () => { loaded = true; });
    await cdp('Page.navigate', { url: fullUrl });
    const deadline = Date.now() + 15000;
    while (!loaded && Date.now() < deadline) await sleep(50);

    const findRect = async (selector, timeoutMs = 3000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const box = await evalFn(`(() => {
          const raw = ${JSON.stringify(selector)};
          const m = raw.match(/^(.*?):has-text\\((['"])(.*?)\\2\\)(.*)$/);
          let el = null;
          if (m) {
            const base = (m[1] || '*').trim() || '*';
            const needle = m[3];
            for (const cand of document.querySelectorAll(base)) {
              const s = getComputedStyle(cand);
              if (s.display === 'none' || s.visibility === 'hidden') continue;
              const cr = cand.getBoundingClientRect();
              if (cr.width <= 0 || cr.height <= 0) continue;
              if ((cand.innerText || cand.textContent || '').includes(needle)) { el = cand; break; }
            }
          } else {
            const cand = document.querySelector(raw);
            if (cand) {
              const s = getComputedStyle(cand);
              if (s.display !== 'none' && s.visibility !== 'hidden') el = cand;
            }
          }
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return null;
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        if (box) return box;
        await sleep(50);
      }
      throw new Error(`Selector not found or hidden: ${selector}`);
    };

    const dispatchKey = (type, name) => {
      const k = keyDef(name);
      return cdp('Input.dispatchKeyEvent', {
        type,
        key: k.key,
        code: k.code,
        windowsVirtualKeyCode: k.vk,
        nativeVirtualKeyCode: k.vk,
      });
    };

    const t0 = Date.now();
    const hudText = async () => String(await evalFn(`(document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)`));

    for (const s of script.steps) {
      try {
        if (s.click) {
          const box = await findRect(s.click);
          await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
          await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        } else if (s.press) {
          await dispatchKey('rawKeyDown', s.press);
          await dispatchKey('keyUp', s.press);
        } else if (s.hold) {
          for (const k of s.hold) await dispatchKey('rawKeyDown', k);
          await sleep(s.ms ?? 1000);
          for (const k of s.hold) await dispatchKey('keyUp', k);
        } else if (s.tap) {
          const box = await findRect(s.tap);
          await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
          await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          await sleep(s.ms ?? 500);
          await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        } else if (s.wait) {
          await sleep(s.wait);
        } else if (s.shot) {
          const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
          const f = path.join(out, `${s.shot}.png`);
          writeFileSync(f, Buffer.from(data, 'base64'));
          report.shots.push(f);
          report.hud.push({ shot: s.shot, text: await hudText() });
        }
      } catch (e) {
        report.pageErrors.push(`step ${JSON.stringify(s)} failed: ${String(e).slice(0, 200)}`);
      }
    }
    const frames = Number(await evalFn('window.__frames || 0'));
    report.fps = +(frames / Math.max(0.05, (Date.now() - t0) / 1000)).toFixed(1);
    report.perf = await evalFn('window.__KT3D_PERF__ ?? null');
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill();
    await Promise.race([exited, sleep(400)]);
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* ignore */ }
  }
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 5199 + Math.floor(Math.random() * 300), strictPort: false, host: '127.0.0.1', watch: { ignored: ['**/playtests/**', '**/tools/playtest/**'] } },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const report = { url: base + (script.url ?? ''), consoleErrors: [], pageErrors: [], shots: [], hud: [], fps: null, perf: null };

try {
  const pw = loadPlaywright();
  if (pw) {
    await runPlaywright(pw, report.url, report);
  } else {
    const chromePath = findChromium();
    if (!chromePath) {
      console.error('Neither Playwright nor system Chromium found. Install Playwright or Chromium to run browser.mjs.');
      process.exit(1);
    }
    await runCdp(chromePath, report.url, report);
  }
  report.note = 'FPS is headless software-GL (SwiftShader); treat as relative only.';
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (
    report.pageErrors.length > 0 ||
    report.consoleErrors.some((e) => e.startsWith('error:') || e.startsWith('log.error'))
  ) {
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
