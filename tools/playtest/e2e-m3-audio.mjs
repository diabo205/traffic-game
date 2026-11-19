#!/usr/bin/env node
/**
 * Tier 4 Headless Chromium CDP + SwiftShader AudioWorklet & Spatial DSP E2E Suite (M3).
 *
 * Verifies all 3 runtime audio paths with zero console errors or uncaught page errors:
 *   - Path A: Vite http://127.0.0.1 origin -> AudioWorklet Blob processor active (`backend === 'worklet'`,
 *             `workletReady === true`), 4-station Karachi FM cycling (`dhol -> lyari -> clifton -> off -> dhol`),
 *             spatial Doppler traffic voices (`activeDopplerVoices > 0`), < 60 GL calls, Escape pause/resume,
 *             and `?horn=pak-melody` selection.
 *   - Path B: Forced fallback (`?audioFallback=1&horn=air-horn`) -> `backend === 'fallback'`, `unlocked === true`.
 *   - Path C: Standalone single-file HTML (`file:///.../dist/Karachi%20Traffic%203D.html`) built by `npm run pack`.
 *
 * Usage:
 *   node tools/playtest/e2e-m3-audio.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packedHtmlPath = path.join(root, 'dist/Karachi Traffic 3D.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_DEFS = {
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  KeyW: { key: 'w', code: 'KeyW', vk: 87 },
  KeyR: { key: 'r', code: 'KeyR', vk: 82 },
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

async function createCdpSession(chromePath) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'kt3d-m3-'));
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
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1280,
      screenHeight: 720,
    });
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

  async function waitFor(jsPredicate, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const ok = await evalFn(jsPredicate);
        if (ok) return ok;
      } catch {
        /* retry */
      }
      await sleep(60);
    }
    throw new Error(`waitFor timed out (${timeoutMs}ms): ${jsPredicate}`);
  }

  async function navigate(url) {
    loaded = false;
    await cdp('Page.navigate', { url });
    const deadline = Date.now() + 25000;
    while (!loaded && Date.now() < deadline) await sleep(50);
    await waitFor(`(() => !document.querySelector('#loading') && !!document.querySelector('.screen.start'))()`, 20000);
    await sleep(300);
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
    })()`, 6000);
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
    await sleep(160);
  }

  async function hold(keys, ms) {
    for (const k of keys) await dispatchKey('rawKeyDown', k);
    await sleep(ms);
    for (const k of keys) await dispatchKey('keyUp', k);
    await sleep(80);
  }

  async function close() {
    try { ws?.close(); } catch { /* ignore */ }
    await killProc();
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* ignore */ }
  }

  return { navigate, waitFor, click, press, hold, dispatchKey, evalFn, close, consoleErrors, pageErrors };
}

async function enterSaddarAndUnlockAudio(session, url) {
  await session.navigate(url);
  await session.click('button.go-btn.play');
  await session.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
  await sleep(250);
  await session.click('button.car-select-go');
  await session.waitFor(
    `document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`,
  );
  await session.waitFor(`!!window.__KT3D_AUDIO__ && window.__KT3D_AUDIO__.unlocked === true`, 10000);
}

async function main() {
  const chromePath = findChromium();
  assert.ok(chromePath, 'No Chromium/Edge binary found for headless E2E');
  assert.ok(existsSync(packedHtmlPath), `Missing standalone packed HTML at ${packedHtmlPath}; run npm run pack first`);

  const server = await createServer({
    root,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;

  const report = {};

  try {
    // ---- Path A: Vite Secure Origin -> AudioWorklet Active + 4 FM Stations + Doppler + Pause/Resume ----
    {
      const s = await createCdpSession(chromePath);
      try {
        await enterSaddarAndUnlockAudio(s, `${baseUrl}?mode=city&seed=1337&high&horn=pak-melody`);
        await s.waitFor(`window.__KT3D_AUDIO__.backend === 'worklet' && window.__KT3D_AUDIO__.workletReady === true`, 10000);

        const initial = await s.evalFn(`window.__KT3D_AUDIO__`);
        assert.equal(initial.radioStation, 'dhol');
        assert.equal(initial.hornId, 'pak-melody');

        // Cycle through all 4 radio stations: dhol -> lyari -> clifton -> off -> dhol
        const stationsObserved = [initial.radioStation];
        for (const expected of ['lyari', 'clifton', 'off', 'dhol']) {
          await s.press('KeyR');
          await s.waitFor(`window.__KT3D_AUDIO__.radioStation === ${JSON.stringify(expected)}`, 4000);
          stationsObserved.push(expected);
        }

        // Drive forward in Saddar holding horn & observing Doppler spatial voices
        let maxDopplerVoices = 0;
        let maxSpd = 0;
        await s.dispatchKey('rawKeyDown', 'KeyW');
        await s.dispatchKey('rawKeyDown', 'Space');
        for (let step = 0; step < 26; step++) {
          await sleep(140);
          if (step === 6) await s.dispatchKey('keyUp', 'Space');
          const snap = await s.evalFn(`({
            a: window.__KT3D_AUDIO__,
            spd: Number(document.querySelector('.speed-num')?.textContent?.trim() ?? '0')
          })`);
          if (snap.a.activeDopplerVoices > maxDopplerVoices) maxDopplerVoices = snap.a.activeDopplerVoices;
          if (snap.spd > maxSpd) maxSpd = snap.spd;
          if (maxDopplerVoices > 0 && maxSpd >= 8 && step >= 12) break;
        }
        await s.dispatchKey('keyUp', 'KeyW');

        assert.ok(maxSpd > 2, `Path A: expected speed > 2 km/h, got ${maxSpd}`);
        assert.ok(maxDopplerVoices > 0, `Path A: expected activeDopplerVoices > 0 in Saddar traffic, got ${maxDopplerVoices}`);

        const perf = await s.evalFn(`window.__KT3D_PERF__`);
        assert.ok(perf && perf.calls > 1 && perf.calls < 60, `Path A: expected Saddar draw calls < 60, got ${perf?.calls}`);

        // Pause -> AudioContext suspended; Resume -> running
        await s.press('Escape');
        await s.waitFor(`window.__KT3D_AUDIO__.contextState === 'suspended'`, 5000);
        await s.press('Escape');
        await s.waitFor(`window.__KT3D_AUDIO__.contextState === 'running'`, 5000);

        assert.equal(s.consoleErrors.length, 0, `Path A console errors: ${s.consoleErrors.join('; ')}`);
        assert.equal(s.pageErrors.length, 0, `Path A page errors: ${s.pageErrors.join('; ')}`);

        report.pathA = {
          backend: initial.backend,
          workletReady: initial.workletReady,
          hornId: initial.hornId,
          stationsObserved,
          maxDopplerVoices,
          maxSpd,
          perfCalls: perf.calls,
        };
      } finally {
        await s.close();
      }
    }

    // ---- Path B: Forced Web Audio Fallback (?audioFallback=1&horn=air-horn) ----
    {
      const s = await createCdpSession(chromePath);
      try {
        await enterSaddarAndUnlockAudio(s, `${baseUrl}?mode=city&seed=1337&high&audioFallback=1&horn=air-horn`);
        const st = await s.evalFn(`window.__KT3D_AUDIO__`);
        assert.equal(st.unlocked, true);
        assert.equal(st.backend, 'fallback');
        assert.equal(st.workletReady, false);
        assert.equal(st.hornId, 'air-horn');

        await s.hold(['KeyW', 'Space'], 900);
        await s.press('KeyR');
        await s.waitFor(`window.__KT3D_AUDIO__.radioStation === 'lyari'`, 4000);

        assert.equal(s.consoleErrors.length, 0, `Path B console errors: ${s.consoleErrors.join('; ')}`);
        assert.equal(s.pageErrors.length, 0, `Path B page errors: ${s.pageErrors.join('; ')}`);

        report.pathB = { backend: st.backend, hornId: st.hornId, radioStation: 'lyari', unlocked: st.unlocked };
      } finally {
        await s.close();
      }
    }

    // ---- Path C: Real Standalone Packed file:// Bundle ----
    {
      const s = await createCdpSession(chromePath);
      try {
        const fileUrl = `${pathToFileURL(packedHtmlPath).href}?mode=city&seed=1337&low`;
        await enterSaddarAndUnlockAudio(s, fileUrl);
        await s.press('KeyR');
        await s.waitFor(`window.__KT3D_AUDIO__.radioStation === 'lyari'`, 4000);
        await s.hold(['KeyW', 'Space'], 1400);
        const snap = await s.evalFn(`({
          audio: window.__KT3D_AUDIO__,
          spd: Number(document.querySelector('.speed-num')?.textContent?.trim() ?? '0')
        })`);
        assert.equal(snap.audio.unlocked, true);
        assert.equal(snap.audio.backend, 'fallback', `Expected file:// single-file backend 'fallback', got ${snap.audio.backend}`);
        assert.ok(Number.isFinite(snap.spd) && snap.spd > 2, `Path C: expected movement > 2 km/h, got ${snap.spd}`);

        assert.equal(s.consoleErrors.length, 0, `Path C console errors: ${s.consoleErrors.join('; ')}`);
        assert.equal(s.pageErrors.length, 0, `Path C page errors: ${s.pageErrors.join('; ')}`);

        report.pathC = {
          fileUrl: 'dist/Karachi Traffic 3D.html',
          backend: snap.audio.backend,
          unlocked: snap.audio.unlocked,
          radioStation: snap.audio.radioStation,
          spd: snap.spd,
        };
      } finally {
        await s.close();
      }
    }

    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err), completed: report }, null, 2));
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

await main();
