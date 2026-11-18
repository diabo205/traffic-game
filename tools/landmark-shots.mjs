#!/usr/bin/env node
/**
 * Screenshots one landmark from several angles via the dev viewer.
 *   node tools/landmark-shots.mjs <kind> [outDir] [--tod night]
 * Writes <outDir>/<kind>-<view>.png (default outDir tools/playtest/out/landmarks).
 */
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const g = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require(path.join(g, 'playwright'));
  }
}
const { chromium } = loadPlaywright();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const kind = args[0] ?? 'st_patricks';
const out = path.resolve(args[1] && !args[1].startsWith('--') ? args[1] : path.join(root, 'tools/playtest/out/landmarks'));
const todIdx = args.indexOf('--tod');
const tod = todIdx >= 0 ? args[todIdx + 1] : 'noon';
const ctx = args.includes('--ctx');
mkdirSync(out, { recursive: true });

const VIEWS = {
  front: { yaw: 0, pitch: 12 },
  front3q: { yaw: 35, pitch: 18 },
  back3q: { yaw: 150, pitch: 22 },
  side: { yaw: -90, pitch: 10 },
  top: { yaw: 20, pitch: 70 },
  street: { yaw: 12, pitch: 2, dist: 30, eye: true },
};

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
for (const [name, v] of Object.entries(VIEWS)) {
  const q = new URLSearchParams({ kind, yaw: String(v.yaw), pitch: String(v.pitch), tod });
  if (v.close) q.set('close', String(v.close));
  if (v.dist) q.set('dist', String(v.dist));
  if (v.eye) q.set('eye', '');
  if (ctx) q.set('ctx', '');
  await page.goto(`http://127.0.0.1:5199/landmark.html?${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const file = path.join(out, `${kind}-${ctx ? 'ctx-' : ''}${tod === 'noon' ? '' : tod + '-'}${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
await server.close();
