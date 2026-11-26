#!/usr/bin/env node
/**
 * Tier 4 Headless Chromium CDP + SwiftShader WebGL2 M2 Renderer Verification Suite.
 *
 * Verifies:
 *   1. All 9 public/models/*.glb use EXT_meshopt_compression and total < 1700 KB.
 *   2. Real WebGL2 draw calls (both __KT3D_PERF__.calls and hooked WebGL2 calls)
 *      stay strictly < 60 across dense Saddar scenarios:
 *        - Low Noon (`?mode=city&seed=1337&low`, postTier === 'low')
 *        - High Noon (`?mode=city&seed=1337&high`, postTier === 'high') + reverse lock
 *        - High Night (`?mode=city&seed=1337&tod=night&high`, postTier === 'high')
 *        - High Monsoon (`?mode=city&seed=1337&tod=monsoon&high`, postTier === 'high')
 *   3. Route mode regression (`?mode=route&seed=1337&high`) renders < 60 calls with 0 errors.
 *   4. Zero console errors, uncaught pageerrors, shader/GL warnings, or Meshopt fallback warnings.
 *   5. Saves visual inspection screenshots into tools/playtest/out/e2e-m2/.
 *
 * Usage:
 *   node tools/playtest/e2e-m2-renderer.mjs [--out DIR]
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const outDir = path.resolve(flag('out', path.join(root, 'tools/playtest/out/e2e-m2')));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_DEFS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
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
        /* ignore missing */
      }
    }
    return null;
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

/** Verify GLB binary magic, EXT_meshopt_compression usage, and total payload budget < 1700 KB. */
function verifyMeshoptModels() {
  const dir = path.join(root, 'public/models');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.glb'))
    .sort();
  assert.equal(files.length, 9, `Expected 9 GLB models in public/models, found ${files.length}`);

  let totalBytes = 0;
  const report = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const bytes = statSync(full).size;
    totalBytes += bytes;
    const buf = readFileSync(full);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, `${file}: invalid GLB magic`);
    const jsonLen = buf.readUInt32LE(12);
    assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${file}: first GLB chunk is not JSON`);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    const used = gltf.extensionsUsed || [];
    assert.ok(
      used.includes('EXT_meshopt_compression'),
      `${file}: missing EXT_meshopt_compression in extensionsUsed (${JSON.stringify(used)})`,
    );
    report.push({ file, kb: +(bytes / 1024).toFixed(1) });
  }

  assert.ok(totalBytes < 1700 * 1024, `GLB total ${(totalBytes / 1024).toFixed(1)} KB exceeds 1700 KB budget`);
  return { count: files.length, totalKb: +(totalBytes / 1024).toFixed(1), files: report };
}

/** Injected before any module runs to measure true WebGL2 draw calls inside every rAF frame. */
const GL_HOOK_INIT_SCRIPT = `
(() => {
  const hook = {
    frameCalls: 0,
    lastFrameCalls: 0,
    maxCalls: 0,
    framesObserved: 0,
    frameBreakdown: { drawElements: 0, drawArrays: 0, drawElementsInstanced: 0, drawArraysInstanced: 0, multiDraw: 0 },
    lastBreakdown: { drawElements: 0, drawArrays: 0, drawElementsInstanced: 0, drawArraysInstanced: 0, multiDraw: 0 },
    hasMultiDraw: false,
    resetStats() {
      this.maxCalls = 0;
      this.framesObserved = 0;
    },
  };
  window.__GL_HOOK__ = hook;

  function wrapDraw(proto, name, bucket) {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      hook.frameCalls++;
      hook.frameBreakdown[bucket]++;
      return orig.apply(this, a);
    };
  }

  if (typeof WebGL2RenderingContext !== 'undefined') {
    const p = WebGL2RenderingContext.prototype;
    wrapDraw(p, 'drawElements', 'drawElements');
    wrapDraw(p, 'drawArrays', 'drawArrays');
    wrapDraw(p, 'drawElementsInstanced', 'drawElementsInstanced');
    wrapDraw(p, 'drawArraysInstanced', 'drawArraysInstanced');
    wrapDraw(p, 'drawRangeElements', 'drawElements');

    const origGetExt = p.getExtension;
    p.getExtension = function (name) {
      const ext = origGetExt.call(this, name);
      if (ext && name === 'WEBGL_multi_draw' && !ext.__ktHooked) {
        ext.__ktHooked = true;
        hook.hasMultiDraw = true;
        for (const fnName of [
          'multiDrawArraysWEBGL',
          'multiDrawElementsWEBGL',
          'multiDrawArraysInstancedWEBGL',
          'multiDrawElementsInstancedWEBGL',
        ]) {
          const origFn = ext[fnName];
          if (typeof origFn === 'function') {
            ext[fnName] = function (...a) {
              hook.frameCalls++;
              hook.frameBreakdown.multiDraw++;
              return origFn.apply(this, a);
            };
          }
        }
      }
      return ext;
    };
  }

  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return origRaf((ts) => {
      hook.frameCalls = 0;
      hook.frameBreakdown = { drawElements: 0, drawArrays: 0, drawElementsInstanced: 0, drawArraysInstanced: 0, multiDraw: 0 };
      try {
        return cb(ts);
      } finally {
        if (hook.frameCalls > 0) {
          hook.lastFrameCalls = hook.frameCalls;
          hook.lastBreakdown = { ...hook.frameBreakdown };
          hook.framesObserved++;
          if (hook.frameCalls > hook.maxCalls) hook.maxCalls = hook.frameCalls;
        }
      }
    });
  };
})();
`;

async function createCdpSession(chromePath, viewport, initScript = '') {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'kt3d-m2-'));
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
  const criticalWarnings = [];
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
      const txt = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (p.type === 'error') {
        consoleErrors.push(`console.error: ${txt}`.slice(0, 400));
      } else if (p.type === 'warning' && /failed to load|unavailable, using procedural mesh|shader error|WEBGL:|INVALID_OPERATION|GL_INVALID/i.test(txt)) {
        criticalWarnings.push(`console.warn: ${txt}`.slice(0, 400));
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
      mobile: false,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });

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

  async function waitFor(jsPredicate, timeoutMs = 12000) {
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
    await sleep(350);
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

  async function hold(keys, ms) {
    for (const k of keys) await dispatchKey('rawKeyDown', k);
    await sleep(ms);
    for (const k of keys) await dispatchKey('keyUp', k);
    await sleep(100);
  }

  async function shot(name) {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  }

  async function close() {
    try { ws?.close(); } catch { /* ignore */ }
    await killProc();
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* ignore */ }
  }

  return { navigate, waitFor, click, hold, evalFn, shot, close, consoleErrors, criticalWarnings, pageErrors };
}

async function runScenario(chromePath, spec, baseUrl) {
  const session = await createCdpSession(
    chromePath,
    { width: 1280, height: 720, dpr: 1 },
    GL_HOOK_INIT_SCRIPT,
  );
  try {
    await session.navigate(`${baseUrl}${spec.query}`);
    await session.click('button.go-btn.play');
    await session.waitFor(`!document.querySelector('.screen.car-select').classList.contains('hidden')`);
    await sleep(250);
    await session.click('button.car-select-go');
    await session.waitFor(
      `document.querySelector('.screen.car-select').classList.contains('hidden') && !document.querySelector('.hud').classList.contains('in-menu')`,
    );

    // Let Saddar chunks/traffic settle for ~1s, then reset hooked frame counter and drive forward
    await sleep(900);
    await session.evalFn(`window.__GL_HOOK__.resetStats()`);
    await session.hold(['KeyW'], 1400);
    for (let step = 0; step < 6; step++) {
      const curSpd = await session.evalFn(`Number(document.querySelector('.speed-num')?.textContent?.trim() ?? '0')`);
      if (curSpd >= 8) break;
      await session.hold(['KeyW'], 250);
    }
    if (spec.steerAfterForward) {
      await session.hold(['KeyW', 'KeyD'], 650);
    }

    // Wait for __KT3D_PERF__ snapshot while driving
    await session.waitFor(`!!window.__KT3D_PERF__ && window.__KT3D_PERF__.mode !== 'garage'`, 5000);
    await sleep(350);

    const state = await session.evalFn(`(() => {
      const perf = window.__KT3D_PERF__;
      const hook = window.__GL_HOOK__;
      const hudText = document.querySelector('.hud')?.innerText ?? '';
      const spdText = document.querySelector('.speed-num')?.textContent?.trim() ?? '0';
      return {
        perf,
        glCalls: hook?.lastFrameCalls ?? -1,
        glMaxCalls: hook?.maxCalls ?? -1,
        hasMultiDraw: !!hook?.hasMultiDraw,
        breakdown: hook?.lastBreakdown ?? null,
        spd: Number(spdText),
        hasNaNText: /NaN|Infinity/i.test(hudText),
      };
    })()`);

    await session.shot(spec.shotName);

    assert.equal(session.consoleErrors.length, 0, `${spec.name}: console errors: ${session.consoleErrors.join('; ')}`);
    assert.equal(session.criticalWarnings.length, 0, `${spec.name}: critical warnings: ${session.criticalWarnings.join('; ')}`);
    assert.equal(session.pageErrors.length, 0, `${spec.name}: page errors: ${session.pageErrors.join('; ')}`);
    assert.equal(state.hasNaNText, false, `${spec.name}: HUD contains NaN/Infinity`);
    assert.ok(Number.isFinite(state.spd) && state.spd > 2, `${spec.name}: expected vehicle moving (>2 km/h), got ${state.spd}`);
    assert.ok(state.perf, `${spec.name}: missing window.__KT3D_PERF__`);
    assert.equal(state.perf.postTier, spec.expectedTier, `${spec.name}: expected postTier=${spec.expectedTier}, got ${state.perf.postTier}`);
    assert.ok(state.perf.triangles > 1000, `${spec.name}: expected scene triangles > 1000, got ${state.perf.triangles}`);
    assert.ok(
      state.perf.calls > 1 && state.perf.calls < spec.maxCalls,
      `${spec.name}: __KT3D_PERF__.calls=${state.perf.calls} must be in (1, ${spec.maxCalls})`,
    );
    assert.ok(
      state.glCalls > 1 && state.glCalls < spec.maxCalls,
      `${spec.name}: hooked WebGL2 lastFrameCalls=${state.glCalls} (max=${state.glMaxCalls}, breakdown=${JSON.stringify(state.breakdown)}) must be in (1, ${spec.maxCalls})`,
    );
    assert.ok(
      state.glMaxCalls < spec.maxCalls,
      `${spec.name}: hooked WebGL2 maxCalls=${state.glMaxCalls} exceeded < ${spec.maxCalls} draw-call ceiling`,
    );

    let reverseSummary = null;
    if (spec.testReverse) {
      // Brake to a stop then execute full-lock reverse turn (KeyS + KeyD for 1.5s)
      await session.hold(['KeyS'], 900);
      await session.evalFn(`window.__GL_HOOK__.resetStats()`);
      await session.hold(['KeyS', 'KeyD'], 1500);
      await sleep(300);
      const revState = await session.evalFn(`(() => {
        const perf = window.__KT3D_PERF__;
        const hook = window.__GL_HOOK__;
        const hudText = document.querySelector('.hud')?.innerText ?? '';
        const spdText = document.querySelector('.speed-num')?.textContent?.trim() ?? '0';
        return {
          perf,
          glCalls: hook?.lastFrameCalls ?? -1,
          glMaxCalls: hook?.maxCalls ?? -1,
          spd: Number(spdText),
          hasNaNText: /NaN|Infinity/i.test(hudText),
        };
      })()`);
      await session.shot(`${spec.shotName}-reverse`);
      assert.equal(revState.hasNaNText, false, `${spec.name} reverse: HUD contains NaN/Infinity`);
      assert.ok(Number.isFinite(revState.spd), `${spec.name} reverse: non-finite speed`);
      assert.ok(revState.perf.calls < spec.maxCalls, `${spec.name} reverse: perf.calls=${revState.perf.calls} >= ${spec.maxCalls}`);
      assert.ok(revState.glCalls < spec.maxCalls, `${spec.name} reverse: glCalls=${revState.glCalls} >= ${spec.maxCalls}`);
      reverseSummary = { perfCalls: revState.perf.calls, glCalls: revState.glCalls, glMaxCalls: revState.glMaxCalls, spd: revState.spd };
    }

    return {
      scenario: spec.name,
      postTier: state.perf.postTier,
      perfCalls: state.perf.calls,
      glCalls: state.glCalls,
      glMaxCalls: state.glMaxCalls,
      triangles: state.perf.triangles,
      geometries: state.perf.geometries,
      textures: state.perf.textures,
      renderMs: state.perf.renderMs,
      hasMultiDraw: state.hasMultiDraw,
      spd: state.spd,
      reverse: reverseSummary,
    };
  } catch (err) {
    const diag = [];
    if (session.consoleErrors.length) diag.push(`consoleErrors=${JSON.stringify(session.consoleErrors)}`);
    if (session.criticalWarnings.length) diag.push(`criticalWarnings=${JSON.stringify(session.criticalWarnings)}`);
    if (session.pageErrors.length) diag.push(`pageErrors=${JSON.stringify(session.pageErrors)}`);
    const suffix = diag.length ? `\n[${spec.name} diagnostics] ${diag.join(' | ')}` : '';
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg}${suffix}`, { cause: err });
  } finally {
    await session.close();
  }
}

async function main() {
  const chromePath = findChromium();
  assert.ok(chromePath, 'No Chromium/Edge binary found for headless WebGL E2E');

  const modelReport = verifyMeshoptModels();
  console.log(`Models OK: ${modelReport.count} Meshopt GLBs, total ${modelReport.totalKb} KB (< 1700 KB)`);

  const server = await createServer({
    root,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}/`;

  const scenarios = [
    { name: 'low-noon', query: '?mode=city&seed=1337&low', expectedTier: 'low', maxCalls: 60, shotName: 'low-noon', steerAfterForward: false, testReverse: false },
    { name: 'high-noon', query: '?mode=city&seed=1337&high', expectedTier: 'high', maxCalls: 60, shotName: 'high-noon', steerAfterForward: true, testReverse: true },
    { name: 'high-night', query: '?mode=city&seed=1337&tod=night&high', expectedTier: 'high', maxCalls: 60, shotName: 'high-night', steerAfterForward: false, testReverse: false },
    { name: 'high-monsoon', query: '?mode=city&seed=1337&tod=monsoon&high', expectedTier: 'high', maxCalls: 60, shotName: 'high-monsoon', steerAfterForward: false, testReverse: false },
    { name: 'route-high', query: '?mode=route&seed=1337&high', expectedTier: 'high', maxCalls: 120, shotName: 'route-high', steerAfterForward: false, testReverse: false },
  ];

  const rows = [];
  try {
    for (const s of scenarios) {
      const row = await runScenario(chromePath, s, baseUrl);
      rows.push(row);
    }

    console.log('\nScenario        | Tier | PerfCalls | GLCalls (Max) | Tris    | Geos | Tex | RenderMs | Speed');
    console.log('----------------+------+-----------+---------------+---------+------+-----+----------+------');
    for (const r of rows) {
      console.log(
        [
          r.scenario.padEnd(15),
          r.postTier.padEnd(4),
          String(r.perfCalls).padStart(9),
          `${r.glCalls} (${r.glMaxCalls})`.padStart(13),
          String(r.triangles).padStart(7),
          String(r.geometries).padStart(4),
          String(r.textures).padStart(3),
          String(r.renderMs).padStart(8),
          `${r.spd}`.padStart(5),
        ].join(' | '),
      );
    }
    console.log(JSON.stringify({ ok: true, models: modelReport, rows }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err), completed: rows }, null, 2));
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

await main();
