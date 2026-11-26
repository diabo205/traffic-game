#!/usr/bin/env node
/**
 * Tier 4 Headless Chromium CDP + SwiftShader M4 Verification Suite:
 *   - NFS Heat Garage Upgrade Bay (`STATS | UPGRADES | STYLE` accessible tabs)
 *   - Native `RACE <-> DRIFT` handling bias slider + live diamond dot shift
 *   - 3D Paint / Livery (`truck-art`) / Underglow (`cyan`) + Horn preview (`pak-melody`)
 *   - `localStorage` persistence + permanent unlock state across reload
 *   - Mobile-first Taxi HUD (`.hud-radio-pill` click cycle, armored `115/115` HP, zero overlap)
 *   - Zero DOM overlap across `1280x720`, `412x915` portrait mobile, and `844x390` landscape mobile
 *   - Corrupted M4 `localStorage` resilience
 *
 * Usage:
 *   node tools/playtest/e2e-m4-garage-hud.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'tools/playtest/out/e2e-m4');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_DEFS = {
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  KeyW: { key: 'w', code: 'KeyW', vk: 87 },
};

function keyDef(name) {
  if (KEY_DEFS[name]) return KEY_DEFS[name];
  if (/^Key[A-Z]$/.test(name)) {
    const ch = name.slice(3).toLowerCase();
    return { key: ch, code: name, vk: name.charCodeAt(3) };
  }
  return { key: name, code: name, vk: 0 };
}

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  if (process.platform === 'win32') {
    for (const name of ['chrome', 'msedge']) {
      try {
        const p = execFileSync('where', [name], { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .split(/\r?\n/)[0]
          ?.trim();
        if (p && existsSync(p)) return p;
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    try {
      const p = execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function createCdpSession(chromePath, viewport, initScript = '') {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'kt3d-m4-'));
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

  async function killProc() {
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    await Promise.race([exited, sleep(300)]);
    if (proc.exitCode === null && proc.signalCode === null) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      await Promise.race([exited, sleep(300)]);
    }
  }

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const consoleErrors = [];
  const pageErrors = [];

  const on = (method, fn) => {
    let arr = listeners.get(method);
    if (!arr) listeners.set(method, (arr = []));
    arr.push(fn);
  };

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

  try {
    const wsBase = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out launching Chromium: ${stderr.slice(-400)}`)), 12000);
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

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Log.enable');

    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        const txt = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        consoleErrors.push(`console.error: ${txt}`.slice(0, 400));
      }
    });
    on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      pageErrors.push(String(d?.exception?.description || d?.text || 'Page exception').slice(0, 400));
    });
    on('Log.entryAdded', (p) => {
      const e = p.entry;
      if (e && e.level === 'error') {
        consoleErrors.push(`log.error: ${e.text}${e.url ? ` (${e.url})` : ''}`.slice(0, 400));
      }
    });

    await cdp('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dpr ?? 1,
      mobile: Boolean(viewport.mobile),
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    if (viewport.touch) {
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
    }
    if (initScript) {
      await cdp('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
    }
  } catch (err) {
    try { ws?.close(); } catch { /* ignore */ }
    await killProc();
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* ignore */ }
    throw err;
  }

  let loaded = false;
  on('Page.loadEventFired', () => {
    loaded = true;
  });

  async function waitFor(jsPredicate, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const ok = await evalFn(jsPredicate);
        if (ok) return ok;
      } catch {
        /* retry */
      }
      await sleep(50);
    }
    throw new Error(`waitFor timed out (${timeoutMs}ms): ${jsPredicate}`);
  }

  async function navigate(url) {
    loaded = false;
    await cdp('Page.navigate', { url });
    const deadline = Date.now() + 20000;
    while (!loaded && Date.now() < deadline) await sleep(50);
    await waitFor(`(() => !document.querySelector('#loading') && !!document.querySelector('.screen.start'))()`, 15000);
    await sleep(320);
  }

  async function reload() {
    loaded = false;
    await cdp('Page.reload', { ignoreCache: false });
    const deadline = Date.now() + 20000;
    while (!loaded && Date.now() < deadline) await sleep(50);
    await waitFor(`(() => !document.querySelector('#loading') && !!document.querySelector('.screen.start'))()`, 15000);
    await sleep(320);
  }

  async function click(selector) {
    const box = await waitFor(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`, 6000);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(140);
  }

  async function dispatchKey(type, name) {
    const k = keyDef(name);
    return cdp('Input.dispatchKeyEvent', {
      type,
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
    });
  }

  async function press(name) {
    await dispatchKey('rawKeyDown', name);
    await dispatchKey('keyUp', name);
    await sleep(150);
  }

  async function hold(keys, ms) {
    for (const k of keys) await dispatchKey('rawKeyDown', k);
    await sleep(ms);
    for (const k of keys) await dispatchKey('keyUp', k);
    await sleep(90);
  }

  async function shot(name) {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  async function close() {
    try { ws?.close(); } catch { /* ignore */ }
    await killProc();
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* ignore */ }
  }

  return { navigate, reload, evalFn, waitFor, click, press, hold, shot, consoleErrors, pageErrors, close };
}

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function assertInViewport(rect, vw, vh, label) {
  assert.ok(rect && rect.width > 0 && rect.height > 0, `${label} must have positive size: ${JSON.stringify(rect)}`);
  assert.ok(rect.left >= -1 && rect.top >= -1, `${label} clipped top/left: ${JSON.stringify(rect)}`);
  assert.ok(rect.right <= vw + 1 && rect.bottom <= vh + 1, `${label} overflows ${vw}x${vh}: ${JSON.stringify(rect)}`);
}

async function readGarageLayout(page) {
  return page.evalFn(`(() => {
    const rect = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) <= 0) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const dot = document.querySelector('.handling-dot');
    return {
      panel: rect('.car-panel'),
      actions: rect('.car-actions'),
      tagAnchor: rect('.car-tag-anchor'),
      adjBadge: rect('button.car-adj-badge'),
      perfRating: Number(document.querySelector('.car-perf-rating')?.textContent?.trim() ?? '0'),
      customVal: document.querySelector('.custom-rating-val')?.textContent?.trim() ?? '',
      bankVal: document.querySelector('.car-bank-val')?.textContent?.trim() ?? '',
      buildBadge: document.querySelector('.car-build-badge')?.textContent?.trim() ?? '',
      dotLeft: dot ? parseFloat(dot.style.left || '50') : 50,
      goText: document.querySelector('button.car-select-go')?.textContent?.trim() ?? '',
      goDisabled: document.querySelector('button.car-select-go')?.disabled ?? false,
      activeTab: document.querySelector('.car-tab[aria-selected="true"]')?.getAttribute('data-tab') ?? null,
      sliderDisabled: document.querySelector('#handling-bias-slider')?.disabled ?? true,
      biasValText: document.querySelector('.bias-val')?.textContent?.trim() ?? '',
      sliderValueText: document.querySelector('#handling-bias-slider')?.getAttribute('aria-valuetext') ?? '',
      scrollOverflow: (() => {
        const p = document.querySelector('.car-panel');
        return p ? p.scrollWidth > p.clientWidth + 2 : false;
      })(),
    };
  })()`);
}

function assertGarageNoOverlap(layout, vw, vh, label) {
  assertInViewport(layout.panel, vw, vh, `${label} .car-panel`);
  assertInViewport(layout.actions, vw, vh, `${label} .car-actions`);
  assertInViewport(layout.tagAnchor, vw, vh, `${label} .car-tag-anchor`);
  assert.equal(rectsOverlap(layout.panel, layout.actions), false, `${label}: .car-panel overlaps .car-actions`);
  assert.equal(rectsOverlap(layout.panel, layout.tagAnchor), false, `${label}: .car-panel overlaps .car-tag-anchor`);
  assert.equal(layout.scrollOverflow, false, `${label}: horizontal scroll overflow inside .car-panel`);
  if (layout.adjBadge) {
    assertInViewport(layout.adjBadge, vw, vh, `${label} .car-adj-badge`);
    assert.equal(rectsOverlap(layout.panel, layout.adjBadge), false, `${label}: .car-panel overlaps .car-adj-badge`);
    assert.equal(rectsOverlap(layout.actions, layout.adjBadge), false, `${label}: .car-actions overlaps .car-adj-badge`);
  }
}

async function readHudLayout(page) {
  return page.evalFn(`(() => {
    const rect = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) <= 0) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      tlTop: rect('.tl-top'),
      integ: rect('.integrity'),
      minimap: rect('.minimap'),
      tc: rect('.hud-tc'),
      tr: rect('.hud-tr'),
      radioPill: rect('.hud-radio-pill'),
      right: rect('.hud-right'),
      steerBtns: rect('.touch-left'),
      touchRight: rect('.touch-right'),
      integText: document.querySelector('.integ-text')?.textContent?.trim() ?? '',
      radioLabel: document.querySelector('.hud-radio-label')?.textContent?.trim() ?? '',
      speedNum: Number(document.querySelector('.speed-num')?.textContent?.trim() ?? '0'),
    };
  })()`);
}

function assertHudNoOverlap(hud, vw, vh, label) {
  assertInViewport(hud.tlTop, vw, vh, `${label} .tl-top`);
  assertInViewport(hud.integ, vw, vh, `${label} .integrity`);
  assertInViewport(hud.minimap, vw, vh, `${label} .minimap`);
  assertInViewport(hud.tc, vw, vh, `${label} .hud-tc`);
  assertInViewport(hud.tr, vw, vh, `${label} .hud-tr`);
  assertInViewport(hud.radioPill, vw, vh, `${label} .hud-radio-pill`);
  for (const [k, box] of [['tlTop', hud.tlTop], ['integ', hud.integ], ['minimap', hud.minimap]]) {
    assert.equal(rectsOverlap(box, hud.tc), false, `${label}: ${k} overlaps .hud-tc (${JSON.stringify(box)} vs ${JSON.stringify(hud.tc)})`);
    assert.equal(rectsOverlap(box, hud.tr), false, `${label}: ${k} overlaps .hud-tr`);
    if (hud.steerBtns) {
      assert.equal(rectsOverlap(box, hud.steerBtns), false, `${label}: ${k} overlaps .touch-left`);
    }
  }
  assert.equal(rectsOverlap(hud.tc, hud.tr), false, `${label}: .hud-tc overlaps .hud-tr (${JSON.stringify(hud.tc)} vs ${JSON.stringify(hud.tr)})`);
  if (hud.right) {
    assertInViewport(hud.right, vw, vh, `${label} .hud-right`);
    assert.equal(rectsOverlap(hud.tr, hud.right), false, `${label}: .hud-tr overlaps .hud-right`);
    if (hud.touchRight) {
      assert.equal(rectsOverlap(hud.right, hud.touchRight), false, `${label}: .hud-right overlaps .touch-right`);
    }
  }
  if (hud.steerBtns) {
    assertInViewport(hud.steerBtns, vw, vh, `${label} .touch-left`);
  }
  if (hud.touchRight) {
    assertInViewport(hud.touchRight, vw, vh, `${label} .touch-right`);
    assert.equal(rectsOverlap(hud.tr, hud.touchRight), false, `${label}: .hud-tr overlaps .touch-right`);
  }
}

async function runJourney(name, chromePath, viewport, initScript, url, fn) {
  const page = await createCdpSession(chromePath, viewport, initScript);
  try {
    await page.navigate(url);
    await fn(page);
    assert.deepEqual(page.consoleErrors, [], `${name} consoleErrors: ${page.consoleErrors.join('; ')}`);
    assert.deepEqual(page.pageErrors, [], `${name} pageErrors: ${page.pageErrors.join('; ')}`);
    return { name, status: 'PASS' };
  } catch (err) {
    try { await page.shot(`FAIL-${name.replace(/[^a-z0-9_-]+/gi, '_')}`); } catch { /* ignore */ }
    throw err;
  } finally {
    await page.close();
  }
}

async function main() {
  const chromePath = findChromium();
  assert.ok(chromePath, 'Chromium binary not found for M4 E2E');

  const server = await createServer({
    root,
    logLevel: 'error',
    server: {
      port: 5499 + Math.floor(Math.random() * 300),
      strictPort: false,
      host: '127.0.0.1',
      watch: { ignored: ['**/playtests/**', '**/tools/playtest/**'] },
    },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  const results = [];

  try {
    // 1. Desktop 1280x720: Upgrades, Slider, Style Cosmetics, Horn Preview, Reload Persistence, Saddar HUD
    results.push(
      await runJourney(
        'M4_desktop_upgrades_style_persistence_hud',
        chromePath,
        { width: 1280, height: 720 },
        `if (!localStorage.getItem('kt3d.m4_init')) { localStorage.setItem('kt3d.m4_init', '1'); localStorage.setItem('kt3d.bank', '2500'); localStorage.setItem('kt3d.veh', 'alto'); localStorage.setItem('kt3d.tod', 'night'); }`,
        `${baseUrl}?mode=city&seed=1337&low`,
        async (page) => {
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(350);

          const initial = await readGarageLayout(page);
          assert.equal(initial.activeTab, 'stats');
          assert.equal(initial.perfRating, 118);
          assert.equal(initial.bankVal, 'RS 2,500');
          const stockDotLeft = initial.dotLeft;
          assertGarageNoOverlap(initial, 1280, 720, 'desktop-stats');

          // Keyboard ArrowRight switches accessible tablist to UPGRADES
          await page.evalFn(`document.querySelector('#garage-tab-stats').focus()`);
          await page.press('ArrowRight');
          await page.waitFor(`document.querySelector('#garage-tab-perf').getAttribute('aria-selected') === 'true'`);

          const beforePerf = await readGarageLayout(page);
          assert.equal(beforePerf.sliderDisabled, true, 'Handling slider must start disabled before Handling Tier 1');

          // Buy Engine 1, Handling 1, Armor 1
          await page.click('.upg-buy-btn[data-track="engine"]');
          await page.click('.upg-buy-btn[data-track="handling"]');
          await page.click('.upg-buy-btn[data-track="armor"]');
          await sleep(160);

          // Unlock & set handling bias slider to +0.8 (DRIFT 80%)
          await page.evalFn(`(() => {
            const sl = document.querySelector('#handling-bias-slider');
            if (!sl || sl.disabled) throw new Error('Expected #handling-bias-slider to be enabled');
            sl.value = '0.8';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          await sleep(120);

          const afterUpgrades = await readGarageLayout(page);
          assert.ok(afterUpgrades.perfRating > initial.perfRating, `Expected perfRating > ${initial.perfRating}, got ${afterUpgrades.perfRating}`);
          assert.equal(afterUpgrades.sliderDisabled, false);
          assert.equal(afterUpgrades.biasValText, 'DRIFT 80%');
          assert.equal(afterUpgrades.sliderValueText, 'DRIFT 80%');
          assert.ok(afterUpgrades.dotLeft > stockDotLeft + 10, `Expected handling dot to shift right from ${stockDotLeft} -> ${afterUpgrades.dotLeft}`);
          assertGarageNoOverlap(afterUpgrades, 1280, 720, 'desktop-upgrades');
          await page.shot('01-desktop-upgrades');

          // Switch to STYLE tab & purchase/equip paint, truck-art livery, cyan underglow & pak-melody horn
          await page.click('#garage-tab-style');
          await page.waitFor(`document.querySelector('#garage-tab-style').getAttribute('aria-selected') === 'true'`);
          await page.click('[data-slot="paint"][data-id="sindh-crimson"]');
          await page.click('[data-slot="livery"][data-id="truck-art"]');
          await page.click('[data-slot="underglow"][data-id="cyan"]');
          await page.click('.horn-preview-btn[data-horn="pak-melody"]');
          await page.click('[data-slot="horn"][data-id="pak-melody"]');
          await sleep(220);

          const afterStyle = await readGarageLayout(page);
          assert.equal(afterStyle.customVal, '10/10', `Expected customized Alto rating 10/10, got ${afterStyle.customVal}`);
          assertGarageNoOverlap(afterStyle, 1280, 720, 'desktop-style');
          await page.shot('02-desktop-style-truckart');

          // Verify localStorage persistence across full reload (even after bank dropped below 1200!)
          await page.reload();
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(300);

          const reloaded = await readGarageLayout(page);
          assert.equal(reloaded.perfRating, afterUpgrades.perfRating, 'perfRating must persist across reload');
          assert.equal(reloaded.customVal, '10/10', 'customRating must persist across reload');
          assert.equal(reloaded.dotLeft, afterUpgrades.dotLeft, 'handlingBias dot must persist across reload');

          // Verify spending Rs on upgrades did NOT re-lock minibus (which was unlocked at 2500)!
          const bankNum = await page.evalFn(`Number(localStorage.getItem('kt3d.bank'))`);
          assert.ok(bankNum < 1200, `Expected remaining bank < 1200 after purchases, got ${bankNum}`);
          let minibusState = null;
          for (let i = 0; i < 5; i++) {
            await page.click('button.car-arrow.next');
            await sleep(180);
            const brand = await page.evalFn(`document.querySelector('.car-brand')?.textContent?.trim()`);
            if (brand && /w-11|bus|karachi/i.test(`${brand} ${await page.evalFn(`document.querySelector('.car-model')?.textContent?.trim()`)}`)) {
              minibusState = await readGarageLayout(page);
              break;
            }
          }
          assert.ok(minibusState, 'Should find minibus when cycling');
          assert.equal(minibusState.goDisabled, false, `Minibus must remain unlocked after spending bank (${minibusState.goText})`);

          // Cycle back to Alto and launch Saddar
          for (let i = 0; i < 5; i++) {
            await page.click('button.car-arrow.next');
            await sleep(160);
            const m = await page.evalFn(`document.querySelector('.car-model')?.textContent?.trim()`);
            if (m && /alto/i.test(m)) break;
          }
          await page.click('button.car-select-go');
          await page.waitFor(
            `document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`,
          );
          await page.waitFor(`window.__KT3D_AUDIO__?.unlocked === true`, 10000);

          await page.hold(['KeyW'], 1100);
          const hudBefore = await readHudLayout(page);
          assert.equal(hudBefore.integText, '115/115', `Expected armored maxIntegrity 115/115 HP, got ${hudBefore.integText}`);
          assert.ok(hudBefore.speedNum > 2, `Expected speed > 2 km/h, got ${hudBefore.speedNum}`);
          assert.equal(hudBefore.radioLabel, 'FM 101 DHOL');
          const hornId = await page.evalFn(`window.__KT3D_AUDIO__.hornId`);
          assert.equal(hornId, 'pak-melody');

          // Click .hud-radio-pill to cycle station live
          await page.click('.hud-radio-pill');
          await page.waitFor(`window.__KT3D_AUDIO__.radioStation === 'lyari'`, 4000);
          const hudAfterRadio = await readHudLayout(page);
          assert.equal(hudAfterRadio.radioLabel, 'FM 104 LYARI');
          assertHudNoOverlap(hudAfterRadio, 1280, 720, 'desktop-saddar-hud');
          await page.shot('05-desktop-saddar-hud');
        },
      ),
    );

    // 2. Mobile Portrait (412x915) & Mobile Landscape (844x390) Garage + HUD
    const mobileBuildInit = `
      localStorage.setItem('kt3d.bank', '2500');
      localStorage.setItem('kt3d.veh', 'alto');
      localStorage.setItem('kt3d.tod', 'night');
      localStorage.setItem('kt3d.builds.v2', JSON.stringify({
        alto: { engine: 1, nitrous: 1, handling: 1, armor: 1, handlingBias: 0.6, paint: 'sindh-crimson', livery: 'truck-art', underglow: 'cyan', horn: 'pak-melody' }
      }));
    `;
    for (const vp of [
      { label: 'mobile_portrait', width: 412, height: 915, dpr: 2.625, mobile: true, touch: true, garageShot: '03-mobile-portrait-garage', hudShot: '06-mobile-portrait-hud', tab: '#garage-tab-perf' },
      { label: 'mobile_landscape', width: 844, height: 390, dpr: 2, mobile: true, touch: true, garageShot: '04-mobile-landscape-garage', hudShot: '07-mobile-landscape-hud', tab: '#garage-tab-style' },
    ]) {
      results.push(
        await runJourney(
          `M4_${vp.label}`,
          chromePath,
          vp,
          mobileBuildInit,
          `${baseUrl}?mode=city&seed=1337&low`,
          async (page) => {
            await page.click('button.go-btn.play');
            await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
            await sleep(380);

            const gStats = await readGarageLayout(page);
            assertGarageNoOverlap(gStats, vp.width, vp.height, `${vp.label}-stats`);

            await page.click(vp.tab);
            await sleep(180);
            const gTab = await readGarageLayout(page);
            assertGarageNoOverlap(gTab, vp.width, vp.height, `${vp.label}-tab`);
            await page.shot(vp.garageShot);

            await page.click('button.car-select-go');
            await page.waitFor(
              `document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`,
            );
            await sleep(300);

            await page.click('.hud-radio-pill');
            await page.waitFor(`window.__KT3D_AUDIO__.radioStation === 'lyari'`, 4000);
            const hud = await readHudLayout(page);
            assert.equal(hud.integText, '115/115');
            assert.equal(hud.radioLabel, 'FM 104 LYARI');
            assertHudNoOverlap(hud, vp.width, vp.height, `${vp.label}-hud`);
            await page.shot(vp.hudShot);
          },
        ),
      );
    }

    // 3. Corrupted M4 localStorage Resilience
    results.push(
      await runJourney(
        'M4_corrupted_storage_fallback',
        chromePath,
        { width: 1280, height: 720 },
        `
          localStorage.setItem('kt3d.bank', 'NaN');
          localStorage.setItem('kt3d.veh', 'unknown_ride');
          localStorage.setItem('kt3d.builds.v2', '{broken-json');
          localStorage.setItem('kt3d.owned.v2', '{"paint":["fake",123]}');
          localStorage.setItem('kt3d.unlocked.v2', '"oops"');
        `,
        `${baseUrl}?mode=city&seed=1337&low`,
        async (page) => {
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(280);
          const st = await readGarageLayout(page);
          assert.equal(st.bankVal, 'RS 0');
          assert.equal(st.perfRating, 118);
          await page.click('#garage-tab-perf');
          await sleep(120);
          const perf = await readGarageLayout(page);
          assert.equal(perf.sliderDisabled, true);
        },
      ),
    );

    console.log(JSON.stringify({ ok: true, passed: results.length, results }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err), completed: results }, null, 2));
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

await main();
