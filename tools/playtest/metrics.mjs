#!/usr/bin/env node
/**
 * Cross-platform one-line feel metrics for every built-in probe.
 *   node tools/playtest/metrics.mjs [seed]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const simScript = path.join(root, 'tools/playtest/sim.mjs');
const seed = process.argv[2] ?? '1337';

const listOut = execFileSync(process.execPath, [simScript, 'list'], { cwd: root, encoding: 'utf8' });
const scenarios = listOut
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/)[0])
  .filter(Boolean);

for (const s of scenarios) {
  const raw = execFileSync(process.execPath, [simScript, s, '--seed', String(seed)], { cwd: root, encoding: 'utf8' });
  const o = JSON.parse(raw);
  const m = o.metrics;
  const f = o.final;
  console.log(
    [
      o.scenario.padEnd(16),
      `t50=${m.t50}`,
      `top=${m.topKmh}`,
      `stop=${m.stopDistM}m`,
      `wall=${m.longestWallContactS}s`,
      `wallLoss=${m.speedLostOnWallPct}%`,
      `stuck=${m.longestStuckS}s`,
      `hp=${f.hp}`,
      `crashes=${f.crashes}`,
      `nan=${m.nanOrInf}`,
    ].join(' '),
  );
}
