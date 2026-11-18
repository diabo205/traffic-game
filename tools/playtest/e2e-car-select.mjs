#!/usr/bin/env node
/**
 * Tier 4 Real-World Headless Chromium CDP + SwiftShader WebGL E2E Suite
 * covering the NFS Heat-inspired Car Selection screen & two-step flow.
 *
 *   node tools/playtest/e2e-car-select.mjs [--out DIR]
 *
 * Exits with code 1 on ANY failed assertion, console error, or uncaught pageerror.
 */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const outDir = path.resolve(flag('out', path.join(root, 'tools/playtest/out/e2e-car-select')));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_DEFS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  NumpadEnter: { key: 'Enter', code: 'NumpadEnter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Space: { key: ' ', code: 'Space', vk: 32 },
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
  return { key: name, code: name, vk: 0 };
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
      /* ignore missing */
    }
  }
  return null;
}

async function createCdpSession(chromePath, viewport, initScript = '') {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'kt3d-e2e-'));
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

  async function navigate(url) {
    loaded = false;
    await cdp('Page.navigate', { url });
    const deadline = Date.now() + 20000;
    while (!loaded && Date.now() < deadline) await sleep(50);
    // Wait for #loading removal & initial Game.create() ready state
    await waitFor(`(() => !document.querySelector('#loading') && !!document.querySelector('.screen.start'))()`, 15000);
    await sleep(350);
  }

  async function reload() {
    loaded = false;
    await cdp('Page.reload', { ignoreCache: false });
    const deadline = Date.now() + 20000;
    while (!loaded && Date.now() < deadline) await sleep(50);
    await waitFor(`(() => !document.querySelector('#loading') && !!document.querySelector('.screen.start'))()`, 15000);
    await sleep(350);
  }

  async function waitFor(jsPredicate, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const ok = await evalFn(jsPredicate);
        if (ok) return ok;
      } catch {
        /* retry until timeout */
      }
      await sleep(50);
    }
    throw new Error(`waitFor timed out (${timeoutMs}ms): ${jsPredicate}`);
  }

  async function click(selector) {
    const box = await waitFor(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`, 5000);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(120);
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
    await sleep(140);
  }

  async function hold(keys, ms) {
    for (const k of keys) await dispatchKey('rawKeyDown', k);
    await sleep(ms);
    for (const k of keys) await dispatchKey('keyUp', k);
    await sleep(80);
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

  return {
    navigate,
    reload,
    evalFn,
    waitFor,
    click,
    press,
    hold,
    shot,
    consoleErrors,
    pageErrors,
    close,
  };
}

async function readCarPanelState(page) {
  return page.evalFn(`(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, display: s.display, visibility: s.visibility, opacity: Number(s.opacity) };
    };
    const carSelect = q('.screen.car-select');
    const start = q('.screen.start');
    const pause = q('.screen.pause');
    const hud = q('.hud');
    const canvas = q('#app canvas');
    const stats = {};
    for (const key of ['power', 'highSpeed', 'acceleration', 'nitrous']) {
      const row = q('.car-stat[data-stat="' + key + '"]');
      const fill = row?.querySelector('.car-stat-fill');
      const val = row?.querySelector('.car-stat-val');
      stats[key] = {
        exists: !!row,
        fillWidth: fill ? fill.style.width || getComputedStyle(fill).width : null,
        valText: val ? val.textContent.trim() : null,
      };
    }
    const dot = q('.handling-dot');
    const segs = qa('.custom-rating .seg');
    return {
      startHidden: start?.classList.contains('hidden') ?? null,
      carSelectHidden: carSelect?.classList.contains('hidden') ?? null,
      carSelectBg: carSelect ? getComputedStyle(carSelect).backgroundColor : null,
      pauseHidden: pause?.classList.contains('hidden') ?? null,
      hudInMenu: hud?.classList.contains('in-menu') ?? null,
      garageStripExists: !!q('.garage-strip'),
      canvasRect: rect(canvas),
      panelRect: rect(q('.car-panel')),
      brand: q('.car-brand')?.textContent?.trim() ?? null,
      model: q('.car-model')?.textContent?.trim() ?? null,
      perfRating: q('.car-perf-rating')?.textContent?.trim() ?? null,
      stats,
      handlingDiamondExists: !!q('.handling-diamond'),
      handlingDotStyle: dot ? { left: dot.style.left, top: dot.style.top, transform: dot.style.transform } : null,
      customSegCount: segs.length,
      customRatingVal: q('.custom-rating-val')?.textContent?.trim() ?? null,
      tagAnchorRect: rect(q('.car-tag-anchor')),
      tagName: q('.car-tag-name')?.textContent?.trim() ?? null,
      gearBadgeExists: !!q('.car-gear-badge'),
      arrowPrevExists: !!q('button.car-arrow.prev'),
      arrowNextExists: !!q('button.car-arrow.next'),
      adjBadgeRect: rect(q('button.car-adj-badge')),
      actionsRect: rect(q('.car-actions')),
      goText: q('button.car-select-go')?.textContent?.trim() ?? null,
      goDisabled: q('button.car-select-go')?.disabled ?? null,
      goLockedClass: q('button.car-select-go')?.classList.contains('locked') ?? null,
      backExists: !!q('button.car-select-back'),
      integLabel: q('.integ-label')?.textContent?.trim() ?? null,
      speedNum: Number(q('.speed-num')?.textContent?.trim() ?? '0'),
      localStorage: {
        bank: localStorage.getItem('kt3d.bank'),
        veh: localStorage.getItem('kt3d.veh'),
        tod: localStorage.getItem('kt3d.tod'),
        mode: localStorage.getItem('kt3d.mode'),
      },
    };
  })()`);
}

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function parseBgAlpha(bg) {
  if (!bg || bg === 'transparent') return 0;
  const rgba = bg.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i);
  if (rgba) return Number(rgba[1]);
  if (/^rgb\(/i.test(bg)) return 1;
  return NaN;
}

async function cycleUntil(page, predicate, maxSteps = 6, label = 'target vehicle') {
  for (let step = 0; step <= maxSteps; step++) {
    const st = await readCarPanelState(page);
    if (predicate(st)) return st;
    if (step < maxSteps) {
      await page.click('button.car-arrow.next');
      await sleep(180);
    }
  }
  assert.fail(`cycleUntil exceeded ${maxSteps} steps waiting for ${label}`);
}

function assertInViewport(rect, vw, vh, label) {
  assert.ok(rect && rect.width > 0 && rect.height > 0, `${label} must have positive size`);
  assert.notEqual(rect.display, 'none', `${label} must not be display:none`);
  assert.notEqual(rect.visibility, 'hidden', `${label} must not be visibility:hidden`);
  assert.ok(rect.opacity > 0, `${label} must have opacity > 0, got ${rect.opacity}`);
  assert.ok(rect.left >= -1 && rect.top >= -1, `${label} clipped top/left: ${JSON.stringify(rect)}`);
  assert.ok(rect.right <= vw + 1 && rect.bottom <= vh + 1, `${label} overflows ${vw}x${vh}: ${JSON.stringify(rect)}`);
}

async function runJourney(name, chromePath, viewport, initScript, url, fn) {
  const page = await createCdpSession(chromePath, viewport, initScript);
  try {
    await page.navigate(url);
    await fn(page);
    assert.deepEqual(page.consoleErrors, [], `${name} had console errors: ${page.consoleErrors.join('; ')}`);
    assert.deepEqual(page.pageErrors, [], `${name} had uncaught pageErrors: ${page.pageErrors.join('; ')}`);
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
  assert.ok(chromePath, 'Chromium binary not found for E2E verification');

  const server = await createServer({
    root,
    logLevel: 'error',
    server: {
      port: 5399 + Math.floor(Math.random() * 300),
      strictPort: false,
      host: '127.0.0.1',
      watch: { ignored: ['**/playtests/**', '**/tools/playtest/**'] },
    },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  const results = [];

  try {
    // Journey 1: Two-Step Transition & NFS Heat UI Completeness (1280x720)
    results.push(
      await runJourney(
        'J1_two_step_and_nfs_heat_ui',
        chromePath,
        { width: 1280, height: 720 },
        `localStorage.setItem('kt3d.bank', '2000'); localStorage.setItem('kt3d.veh', 'alto');`,
        `${baseUrl}?mode=city&seed=1337&low`,
        async (page) => {
          let s = await readCarPanelState(page);
          assert.equal(s.startHidden, false, 'Start screen must be visible on boot');
          assert.equal(s.carSelectHidden, true, 'Car select must be hidden on boot');
          assert.equal(s.garageStripExists, false, 'Legacy .garage-strip must be removed from Start screen');

          await page.click('button.cond-strip[data-tod="monsoon"]');
          await page.click('button.go-btn.play');
          await page.waitFor(`document.querySelector('.screen.car-select') && !document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(400);

          s = await readCarPanelState(page);
          assert.equal(s.startHidden, true, 'Start screen must hide when Car Select opens');
          assert.equal(s.carSelectHidden, false, 'Car Select screen must be visible');
          const bgAlpha = parseBgAlpha(s.carSelectBg);
          assert.ok(
            Number.isFinite(bgAlpha) && bgAlpha < 0.5,
            `Car Select background must be transparent/translucent (alpha < 0.5) over WebGL canvas, got ${s.carSelectBg}`,
          );
          assert.ok(s.canvasRect && s.canvasRect.width >= 1200 && s.canvasRect.height >= 700, 'WebGL canvas must fill viewport');

          assert.ok(s.brand && s.model && Number(s.perfRating) > 0, 'Brand, model, and positive perfRating required');
          for (const key of ['power', 'highSpeed', 'acceleration', 'nitrous']) {
            assert.equal(s.stats[key].exists, true, `Missing stat row ${key}`);
            assert.ok(
              s.stats[key].fillWidth && parseFloat(s.stats[key].fillWidth) > 0,
              `Stat ${key} .car-stat-fill must have valid positive width, got ${s.stats[key].fillWidth}`,
            );
            assert.ok(/^\d+(\.\d)?$/.test(s.stats[key].valText), `Stat ${key} valText invalid: ${s.stats[key].valText}`);
          }
          assert.equal(s.handlingDiamondExists, true);
          assert.ok(s.handlingDotStyle, '.handling-dot must exist');
          assert.equal(s.customSegCount, 10, 'Expected 10 customization segments');
          assert.ok(/^\d+\/10$/.test(s.customRatingVal), `Invalid custom rating label: ${s.customRatingVal}`);
          assert.ok(s.tagName && s.gearBadgeExists && s.arrowPrevExists && s.arrowNextExists);
          assertInViewport(s.panelRect, 1280, 720, 'desktop .car-panel');
          assertInViewport(s.actionsRect, 1280, 720, 'desktop .car-actions');
          assertInViewport(s.tagAnchorRect, 1280, 720, 'desktop .car-tag-anchor');
          assertInViewport(s.adjBadgeRect, 1280, 720, 'desktop button.car-adj-badge');
          assert.equal(
            rectsOverlap(s.panelRect, s.actionsRect),
            false,
            `desktop: .car-panel overlaps .car-actions (${JSON.stringify(s.panelRect)} vs ${JSON.stringify(s.actionsRect)})`,
          );
          assert.equal(
            rectsOverlap(s.panelRect, s.tagAnchorRect),
            false,
            `desktop: .car-panel overlaps .car-tag-anchor (${JSON.stringify(s.panelRect)} vs ${JSON.stringify(s.tagAnchorRect)})`,
          );
          assert.ok(s.backExists && s.goText.includes('SELECT'));
          await page.shot('01-desktop-car-select');
        },
      ),
    );

    // Journey 2: Full Roster Cycling, Wraparound, 3D Projection & Adjacent Pin (kt3d.bank = 2000)
    results.push(
      await runJourney(
        'J2_roster_cycling_wraparound_and_adj_pin',
        chromePath,
        { width: 1280, height: 720 },
        `localStorage.setItem('kt3d.bank', '2000'); localStorage.setItem('kt3d.veh', 'alto');`,
        `${baseUrl}?mode=city&seed=1337&low`,
        async (page) => {
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(400);

          const seen = [];
          const statSnapshots = new Set();
          const dotSnapshots = new Set();
          const initial = await readCarPanelState(page);
          seen.push(`${initial.brand}|${initial.model}|${initial.perfRating}|${initial.tagName}`);
          statSnapshots.add(JSON.stringify(initial.stats));
          dotSnapshots.add(JSON.stringify(initial.handlingDotStyle));

          for (let i = 0; i < 5; i++) {
            await page.click('button.car-arrow.next');
            await sleep(220);
            const st = await readCarPanelState(page);
            assertInViewport(st.tagAnchorRect, 1280, 720, `tagAnchor step ${i + 1}`);
            assertInViewport(st.adjBadgeRect, 1280, 720, `adjBadge step ${i + 1}`);
            const key = `${st.brand}|${st.model}|${st.perfRating}|${st.tagName}`;
            if (i < 4) {
              assert.ok(!seen.includes(key), `Duplicate vehicle before completing 5-step cycle: ${key}`);
              seen.push(key);
              statSnapshots.add(JSON.stringify(st.stats));
              dotSnapshots.add(JSON.stringify(st.handlingDotStyle));
            } else {
              assert.equal(key, seen[0], '5th next click must wrap back to initial vehicle');
            }
          }
          assert.equal(seen.length, 5, 'Should cycle through all 5 distinct vehicles');
          assert.equal(statSnapshots.size, 5, 'Each vehicle must update .car-stat-fill / .car-stat-val');
          assert.ok(dotSnapshots.size >= 4, `Expected .handling-dot position to update across vehicles, saw ${dotSnapshots.size}`);

          // Backward wraparound + keyboard ArrowLeft / ArrowRight / KeyA / KeyD
          await page.click('button.car-arrow.prev');
          await sleep(220);
          const wrappedBack = await readCarPanelState(page);
          assert.equal(`${wrappedBack.brand}|${wrappedBack.model}|${wrappedBack.perfRating}|${wrappedBack.tagName}`, seen[4]);

          await page.press('ArrowRight');
          await sleep(200);
          let kb = await readCarPanelState(page);
          assert.equal(`${kb.brand}|${kb.model}|${kb.perfRating}|${kb.tagName}`, seen[0]);

          await page.press('KeyD');
          await sleep(200);
          kb = await readCarPanelState(page);
          assert.equal(`${kb.brand}|${kb.model}|${kb.perfRating}|${kb.tagName}`, seen[1]);

          await page.press('KeyA');
          await sleep(200);
          kb = await readCarPanelState(page);
          assert.equal(`${kb.brand}|${kb.model}|${kb.perfRating}|${kb.tagName}`, seen[0]);

          // Click adjacent car pin -> jumps to adjacent vehicle (different from current)
          const beforeAdj = await readCarPanelState(page);
          await page.click('button.car-adj-badge');
          await sleep(300);
          const afterAdj = await readCarPanelState(page);
          assert.notEqual(afterAdj.tagName, beforeAdj.tagName, 'Clicking adjacent car pin must jump to adjacent car');
        },
      ),
    );

    // Journey 3: Locked Vehicle Rejection (bank=0) & Unlocked Launch + Driving
    results.push(
      await runJourney(
        'J3_locked_rejection_and_unlocked_launch',
        chromePath,
        { width: 1280, height: 720 },
        `localStorage.setItem('kt3d.bank', '0'); localStorage.setItem('kt3d.veh', 'alto');`,
        `${baseUrl}?mode=city&seed=1337&low`,
        async (page) => {
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(350);

          // Cycle until we hit locked vehicles (rickshaw/suv/minibus)
          let lockedHits = 0;
          for (let i = 0; i < 5; i++) {
            await page.click('button.car-arrow.next');
            await sleep(200);
            const st = await readCarPanelState(page);
            if (/LOCKED/i.test(st.goText)) {
              lockedHits++;
              assert.ok(/\d+/.test(st.goText), `Locked button should show cost: ${st.goText}`);
              // Attempt both click and Enter -> must NOT launch gameplay
              await page.click('button.car-select-go');
              await page.press('Enter');
              await sleep(180);
              const afterAttempt = await readCarPanelState(page);
              assert.equal(afterAttempt.carSelectHidden, false, 'Locked vehicle must NOT leave Car Select');
              assert.equal(afterAttempt.hudInMenu, true, 'Locked vehicle must remain in menu');
            }
          }
          assert.equal(lockedHits, 3, `Expected 3 locked vehicles at bank=0, saw ${lockedHits}`);

          // Cycle to unlocked coupe (index 1 from alto)
          const chosen = await cycleUntil(
            page,
            (st) => !/LOCKED/i.test(st.goText) && /mustang|coupe/i.test(`${st.model} ${st.tagName}`),
            6,
            'unlocked coupe',
          );
          await page.click('button.car-select-go');
          await page.waitFor(`document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`);
          await page.hold(['KeyW'], 1800);
          const driving = await readCarPanelState(page);
          assert.ok(driving.speedNum > 0, `Expected speed > 0 after accelerating, got ${driving.speedNum}`);
          assert.ok(
            driving.integLabel && /mustang|coupe/i.test(driving.integLabel),
            `Integrity label must match chosen coupe (MUSTANG), got ${driving.integLabel}`,
          );
          assert.notEqual(chosen.tagName, '');
          await page.shot('02-coupe-driving');
        },
      ),
    );

    // Journey 4: Back Navigation, No Pause Key-Leak, Daily Flow & localStorage Persistence
    results.push(
      await runJourney(
        'J4_back_keyleak_daily_and_persistence',
        chromePath,
        { width: 1280, height: 720 },
        `if (!localStorage.getItem('kt3d.e2e_init')) { localStorage.setItem('kt3d.e2e_init', '1'); localStorage.setItem('kt3d.bank', '2000'); localStorage.setItem('kt3d.veh', 'alto'); localStorage.setItem('kt3d.tod', 'noon'); }`,
        `${baseUrl}?mode=city&seed=1337&low`,
        async (page) => {
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(250);

          // Press Escape -> returns to Start Screen, Pause Screen must NOT open
          await page.press('Escape');
          await page.waitFor(`!document.querySelector('.screen.start').classList.contains('hidden') && document.querySelector('.screen.car-select').classList.contains('hidden')`);
          let st = await readCarPanelState(page);
          assert.equal(st.pauseHidden, true, 'Escape on Car Select must NOT leak into Pause screen');

          // Enter via DAILY -> opens Car Select
          await page.click('button.daily-btn');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await page.click('button.car-select-back');
          await page.waitFor(`!document.querySelector('.screen.start').classList.contains('hidden')`);

          // Pick NIGHT + coupe, launch, then reload -> verify persistence
          await page.click('button.cond-strip[data-tod="night"]');
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await cycleUntil(
            page,
            (cur) => /mustang|coupe/i.test(`${cur.model} ${cur.tagName}`),
            6,
            'coupe',
          );
          await page.click('button.car-select-go');
          await page.waitFor(`document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(200);

          await page.reload();
          st = await readCarPanelState(page);
          assert.equal(st.localStorage.veh, 'coupe', 'kt3d.veh must persist as coupe');
          assert.equal(st.localStorage.tod, 'night', 'kt3d.tod must persist as night');
          const nightChosen = await page.evalFn(`document.querySelector('button.cond-strip[data-tod="night"]')?.classList.contains('chosen')`);
          assert.equal(nightChosen, true, 'Night strip should remain chosen after reload');
        },
      ),
    );

    // Journey 5: Pause -> Quit to Menu & Mode × Weather Launch (route + sunset + suv)
    results.push(
      await runJourney(
        'J5_pause_quit_and_route_sunset_suv',
        chromePath,
        { width: 1280, height: 720 },
        `localStorage.setItem('kt3d.bank', '2000'); localStorage.setItem('kt3d.veh', 'alto');`,
        `${baseUrl}?seed=1337&low`,
        async (page) => {
          await page.click('button.tile[title="Route run to Clifton"]');
          await page.click('button.cond-strip[data-tod="sunset"]');
          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(300);

          await cycleUntil(
            page,
            (cur) => /hilux|suv|4x4/i.test(`${cur.model} ${cur.tagName}`),
            6,
            'suv',
          );
          await page.click('button.car-select-go');
          await page.waitFor(`document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`);
          await page.hold(['KeyW'], 1500);

          const driving = await readCarPanelState(page);
          assert.ok(driving.speedNum > 0, `SUV in route mode must accelerate, got ${driving.speedNum}`);
          assert.ok(
            driving.integLabel && /hilux|suv/i.test(driving.integLabel),
            `Integrity label must match chosen SUV (HILUX), got ${driving.integLabel}`,
          );

          await page.press('Escape');
          await page.waitFor(`!document.querySelector('.screen.pause').classList.contains('hidden')`);

          await page.evalFn(`(() => {
            const btns = [...document.querySelectorAll('.screen.pause button.card-btn')];
            const quit = btns.find((b) => (b.textContent || '').includes('QUIT TO MENU'));
            if (!quit) throw new Error('QUIT TO MENU button not found');
            quit.click();
          })()`);
          await page.waitFor(`!document.querySelector('.screen.start').classList.contains('hidden') && document.querySelector('.screen.pause').classList.contains('hidden')`);
          const afterQuit = await readCarPanelState(page);
          assert.equal(afterQuit.carSelectHidden, true, 'Quit to menu must land on Start, not Car Select');
        },
      ),
    );

    // Journey 6: Responsive Mobile Viewports (412x915 Portrait & 844x390 Landscape)
    for (const vp of [
      { label: 'mobile_portrait_412x915', width: 412, height: 915, dpr: 2.625, mobile: true, touch: true },
      { label: 'mobile_landscape_844x390', width: 844, height: 390, dpr: 2, mobile: true, touch: true },
    ]) {
      results.push(
        await runJourney(
          `J6_${vp.label}`,
          chromePath,
          vp,
          `localStorage.setItem('kt3d.bank', '2000'); localStorage.setItem('kt3d.veh', 'coupe');`,
          `${baseUrl}?mode=city&seed=1337&low`,
          async (page) => {
            await page.click('button.go-btn.play');
            await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
            await sleep(450);

            const st = await readCarPanelState(page);
            assertInViewport(st.panelRect, vp.width, vp.height, `${vp.label} .car-panel`);
            assertInViewport(st.tagAnchorRect, vp.width, vp.height, `${vp.label} .car-tag-anchor`);
            assertInViewport(st.actionsRect, vp.width, vp.height, `${vp.label} .car-actions`);
            if (
              st.adjBadgeRect &&
              st.adjBadgeRect.width > 0 &&
              st.adjBadgeRect.display !== 'none' &&
              st.adjBadgeRect.visibility !== 'hidden' &&
              st.adjBadgeRect.opacity > 0
            ) {
              assertInViewport(st.adjBadgeRect, vp.width, vp.height, `${vp.label} button.car-adj-badge`);
              assert.equal(
                rectsOverlap(st.adjBadgeRect, st.panelRect),
                false,
                `${vp.label}: button.car-adj-badge overlaps .car-panel (${JSON.stringify(st.adjBadgeRect)} vs ${JSON.stringify(st.panelRect)})`,
              );
              assert.equal(
                rectsOverlap(st.adjBadgeRect, st.actionsRect),
                false,
                `${vp.label}: button.car-adj-badge overlaps .car-actions (${JSON.stringify(st.adjBadgeRect)} vs ${JSON.stringify(st.actionsRect)})`,
              );
            }
            assert.equal(
              rectsOverlap(st.panelRect, st.actionsRect),
              false,
              `${vp.label}: .car-panel overlaps .car-actions (${JSON.stringify(st.panelRect)} vs ${JSON.stringify(st.actionsRect)})`,
            );
            assert.equal(
              rectsOverlap(st.panelRect, st.tagAnchorRect),
              false,
              `${vp.label}: .car-panel overlaps .car-tag-anchor (${JSON.stringify(st.panelRect)} vs ${JSON.stringify(st.tagAnchorRect)})`,
            );
            await page.shot(`03-${vp.label}`);
          },
        ),
      );
    }

    // Journey 7: Corrupted localStorage Fallback (1280x720)
    results.push(
      await runJourney(
        'J7_corrupted_localStorage_fallback',
        chromePath,
        { width: 1280, height: 720 },
        `localStorage.setItem('kt3d.veh', 'bogus_car'); localStorage.setItem('kt3d.bank', 'not-a-number'); localStorage.setItem('kt3d.tod', 'blizzard'); localStorage.setItem('kt3d.mode', 'orbit');`,
        `${baseUrl}?seed=1337&low`,
        async (page) => {
          const boot = await readCarPanelState(page);
          assert.equal(boot.startHidden, false, 'Start screen must boot cleanly despite corrupted localStorage');
          const todValid = await page.evalFn(
            `['noon','sunset','night','monsoon'].some((t) => document.querySelector('button.cond-strip[data-tod="' + t + '"]')?.classList.contains('chosen'))`,
          );
          assert.equal(todValid, true, 'Invalid kt3d.tod must fall back to a valid time of day');

          await page.click('button.go-btn.play');
          await page.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
          await sleep(300);

          const st = await readCarPanelState(page);
          assert.ok(
            /alto|mustang|coupe/i.test(`${st.model} ${st.tagName}`),
            `Invalid kt3d.veh must fall back to a valid starter vehicle (alto/coupe), got ${st.model} (${st.tagName})`,
          );
          assert.ok(
            st.goText.includes('SELECT') && !/LOCKED/i.test(st.goText) && st.goDisabled === false,
            `Starter fallback vehicle must be unlocked with SELECT button, got ${st.goText} (disabled=${st.goDisabled})`,
          );

          // Invalid bank ('not-a-number') must fall back safely to 0 so locked vehicles like minibus remain locked
          const minibusSt = await cycleUntil(
            page,
            (cur) => /w-11|minibus/i.test(`${cur.brand} ${cur.model} ${cur.tagName}`),
            6,
            'minibus',
          );
          assert.ok(
            /LOCKED/i.test(minibusSt.goText) && minibusSt.goLockedClass === true && minibusSt.goDisabled === true,
            `With corrupted bank defaulting to 0, minibus must remain locked, got ${minibusSt.goText}`,
          );

          // Cycle back to unlocked starter and launch cleanly
          await cycleUntil(
            page,
            (cur) => !/LOCKED/i.test(cur.goText) && /alto|mustang|coupe/i.test(`${cur.model} ${cur.tagName}`),
            6,
            'unlocked starter vehicle',
          );
          await page.click('button.car-select-go');
          await page.waitFor(`document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`);
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
