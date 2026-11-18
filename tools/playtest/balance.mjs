#!/usr/bin/env node
/**
 * Multi-seed statistical balance & invariant harness (adapted from AI Thrones'
 * overnight bot-tuning loop). Runs smart Route Run and Free Roam bots across
 * N seeds in seconds, compares against target lines, and flags outlier seeds.
 *
 *   node tools/playtest/balance.mjs [--seeds 20] [--mode both|route|city] [--vehicle alto] [--json] [--check]
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCityBot, createRouteBot } from './bot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);

const SEEDS_COUNT = Math.max(1, Number(flag('seeds', 20)));
const MODE = flag('mode', 'both'); // route | city | both
const VEHICLE = flag('vehicle', 'alto');
const JSON_OUT = has('json');
const CHECK = has('check');

const BASE_SEEDS = Array.from({ length: SEEDS_COUNT }, (_, i) => 1001 + i * 137);

function runRouteSeed(World, road, seed, vehicle) {
  const world = new World(seed, 0, vehicle);
  const bot = createRouteBot(road);
  world.start();
  world.drainEvents();

  const p = world.player;
  const maxTicks = 220 * 60;
  let nanOrInf = false;
  let teleports = 0;
  let stuckTicks = 0;
  let longestStuckS = 0;
  let lastX = p.x;
  let lastZ = p.z;
  const zoneCrashes = [0, 0, 0];
  const zoneMaxZ = [0, 0, 0];

  for (let t = 0; t < maxTicks && world.phase === 'running'; t++) {
    const input = bot(world);
    world.step(input);
    const evs = world.drainEvents();
    const zi = road.zoneIndexAt(p.z);
    zoneMaxZ[zi] = Math.max(zoneMaxZ[zi], p.z);

    for (const e of evs) {
      if (e.type === 'crash') zoneCrashes[zi]++;
    }
    if (!Number.isFinite(p.x + p.z + p.speed + p.heading)) {
      nanOrInf = true;
      break;
    }
    if (Math.hypot(p.x - lastX, p.z - lastZ) > 3.5) teleports++;
    lastX = p.x;
    lastZ = p.z;

    if (Math.abs(p.speed) < 1.0 && t > 30) {
      stuckTicks++;
      longestStuckS = Math.max(longestStuckS, stuckTicks / 60);
    } else {
      stuckTicks = 0;
    }
  }

  return {
    seed,
    phase: world.phase,
    reason: world.level.reason,
    won: world.phase === 'complete',
    progress: +world.level.progress.toFixed(3),
    timeS: +(world.tick / 60).toFixed(1),
    hp: +p.integrity.toFixed(1),
    crashes: world.level.stats.crashes,
    zoneCrashes,
    finalZone: road.zoneIndexAt(p.z),
    finalZ: +p.z.toFixed(1),
    longestStuckS: +longestStuckS.toFixed(2),
    nanOrInf,
    teleports,
  };
}

function runCitySeed(CityWorld, seed, vehicle) {
  const world = new CityWorld(seed, vehicle);
  const bot = createCityBot();
  world.start();
  world.drainEvents();

  const p = world.player;
  const maxTicks = 240 * 60;
  let nanOrInf = false;
  let teleports = 0;
  let stuckTicks = 0;
  let longestStuckS = 0;
  let tows = 0;
  let pickups = 0;
  let dropoffs = 0;
  let shiftOver = false;
  let lastX = p.x;
  let lastZ = p.z;

  for (let t = 0; t < maxTicks && world.phase === 'running' && !shiftOver; t++) {
    const input = bot(world);
    world.step(input);
    const evs = world.drainEvents();
    for (const e of evs) {
      if (e.type === 'towed') tows++;
      if (e.type === 'pickup') pickups++;
      if (e.type === 'dropoff') dropoffs++;
      if (e.type === 'shiftOver') shiftOver = true;
    }
    if (!Number.isFinite(p.x + p.z + p.speed + p.heading)) {
      nanOrInf = true;
      break;
    }
    if (Math.hypot(p.x - lastX, p.z - lastZ) > 3.5 && !evs.some((e) => e.type === 'towed')) {
      teleports++;
    }
    lastX = p.x;
    lastZ = p.z;

    const boardingOrAlighting = (world.fares.fare && world.fares.fare.alight > 0) ||
      world.fares.waiting.some((w) => w.board > 0);
    if (Math.abs(p.speed) < 0.85 && !boardingOrAlighting && t > 45) {
      stuckTicks++;
      longestStuckS = Math.max(longestStuckS, stuckTicks / 60);
    } else {
      stuckTicks = 0;
    }
  }

  return {
    seed,
    shiftOver,
    timeS: +(world.tick / 60).toFixed(1),
    fares: world.fares.shiftFares || world.fares.totalFares,
    pickups,
    dropoffs,
    money: world.fares.money,
    stuntScore: world.stunts.score,
    crashes: world.level.stats.crashes,
    tows,
    longestStuckS: +longestStuckS.toFixed(2),
    nanOrInf,
    teleports,
  };
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function pct(num, den) {
  return den ? Math.round((num / den) * 100) : 0;
}

function summarizeRoute(runs) {
  const wins = runs.filter((r) => r.won);
  const wrecked = runs.filter((r) => r.reason === 'wrecked');
  const timedOut = runs.filter((r) => r.reason === 'time');
  const nans = runs.filter((r) => r.nanOrInf).length;
  const teleports = runs.reduce((a, r) => a + r.teleports, 0);

  const zoneNames = ['Saddar (0-1.1km)', 'Lyari (1.1-2.9km)', 'Clifton (2.9-4.2km)'];
  const zoneReached = [0, 1, 2].map((zi) => runs.filter((r) => r.finalZone >= zi).length);
  const zoneAvgCrashes = [0, 1, 2].map((zi) => +avg(runs.map((r) => r.zoneCrashes[zi])).toFixed(2));

  const targets = [
    { name: 'Zero NaN/Inf', actual: nans, target: '0', pass: nans === 0 },
    { name: 'Zero teleports', actual: teleports, target: '0', pass: teleports === 0 },
    { name: 'Bot win rate', actual: `${pct(wins.length, runs.length)}%`, target: '>= 70%', pass: pct(wins.length, runs.length) >= 70 },
    { name: 'Avg HP on win', actual: wins.length ? `${avg(wins.map((r) => r.hp)).toFixed(1)}` : 'n/a', target: '>= 25', pass: wins.length > 0 && avg(wins.map((r) => r.hp)) >= 25 },
  ];

  const outliers = [...runs]
    .sort((a, b) => (a.won !== b.won ? (a.won ? 1 : -1) : a.progress - b.progress || a.hp - b.hp))
    .slice(0, 3);

  return {
    seeds: runs.length,
    wins: wins.length,
    winRatePct: pct(wins.length, runs.length),
    wrecked: wrecked.length,
    timedOut: timedOut.length,
    avgProgress: +avg(runs.map((r) => r.progress)).toFixed(3),
    avgWinTimeS: wins.length ? +avg(wins.map((r) => r.timeS)).toFixed(1) : null,
    avgWinHp: wins.length ? +avg(wins.map((r) => r.hp)).toFixed(1) : null,
    avgCrashes: +avg(runs.map((r) => r.crashes)).toFixed(2),
    zones: zoneNames.map((name, i) => ({
      name,
      reachedPct: pct(zoneReached[i], runs.length),
      avgCrashes: zoneAvgCrashes[i],
    })),
    targets,
    outliers,
  };
}

function summarizeCity(runs) {
  const nans = runs.filter((r) => r.nanOrInf).length;
  const teleports = runs.reduce((a, r) => a + r.teleports, 0);
  const completed3Plus = runs.filter((r) => r.fares >= 3).length;
  const avgFares = +avg(runs.map((r) => r.fares)).toFixed(2);
  const avgMoney = Math.round(avg(runs.map((r) => r.money)));
  const maxStuck = Math.max(...runs.map((r) => r.longestStuckS));

  const targets = [
    { name: 'Zero NaN/Inf', actual: nans, target: '0', pass: nans === 0 },
    { name: 'Zero teleports', actual: teleports, target: '0', pass: teleports === 0 },
    { name: 'Shifts with >=3 fares', actual: `${pct(completed3Plus, runs.length)}%`, target: '>= 80%', pass: pct(completed3Plus, runs.length) >= 80 },
    { name: 'Max stuck time', actual: `${maxStuck}s`, target: '<= 4.0s', pass: maxStuck <= 4.0 },
  ];

  const outliers = [...runs]
    .sort((a, b) => a.fares - b.fares || a.money - b.money)
    .slice(0, 3);

  return {
    seeds: runs.length,
    avgFares,
    minFares: Math.min(...runs.map((r) => r.fares)),
    maxFares: Math.max(...runs.map((r) => r.fares)),
    avgMoney,
    avgTows: +avg(runs.map((r) => r.tows)).toFixed(2),
    avgCrashes: +avg(runs.map((r) => r.crashes)).toFixed(2),
    maxStuckS: maxStuck,
    targets,
    outliers,
  };
}

function printSummary(report) {
  const badge = (ok) => (ok ? 'PASS' : 'FAIL');
  console.log(`\n=== Karachi Traffic 3D — Multi-Seed Balance Report (${report.seeds} seeds, vehicle=${report.vehicle}) ===`);

  if (report.route) {
    const r = report.route;
    console.log(`\n[ROUTE RUN] Wins: ${r.wins}/${r.seeds} (${r.winRatePct}%) | Wrecked: ${r.wrecked} | Timeout: ${r.timedOut} | Avg progress: ${(r.avgProgress * 100).toFixed(1)}% | Avg crashes: ${r.avgCrashes}`);
    if (r.avgWinTimeS !== null) console.log(`            Avg win time: ${r.avgWinTimeS}s | Avg win HP: ${r.avgWinHp}`);
    console.log('  Zones:');
    for (const z of r.zones) console.log(`    - ${z.name.padEnd(22)} reached: ${String(z.reachedPct).padStart(3)}% | avg crashes: ${z.avgCrashes}`);
    console.log('  Target Lines:');
    for (const t of r.targets) console.log(`    [${badge(t.pass)}] ${t.name.padEnd(24)} actual=${String(t.actual).padEnd(8)} target=${t.target}`);
    console.log('  Worst Seeds:');
    for (const o of r.outliers) {
      console.log(`    - seed ${o.seed}: phase=${o.phase} (${o.reason ?? 'ok'}) progress=${(o.progress * 100).toFixed(0)}% hp=${o.hp} crashes=${o.crashes} -> node tools/playtest/sim.mjs route-bot --seed ${o.seed}`);
    }
  }

  if (report.city) {
    const c = report.city;
    console.log(`\n[FREE ROAM] Avg fares/shift: ${c.avgFares} (min ${c.minFares}, max ${c.maxFares}) | Avg earnings: Rs ${c.avgMoney} | Avg crashes: ${c.avgCrashes} | Avg tows: ${c.avgTows}`);
    console.log('  Target Lines:');
    for (const t of c.targets) console.log(`    [${badge(t.pass)}] ${t.name.padEnd(24)} actual=${String(t.actual).padEnd(8)} target=${t.target}`);
    console.log('  Worst Seeds:');
    for (const o of c.outliers) {
      console.log(`    - seed ${o.seed}: fares=${o.fares} money=Rs${o.money} tows=${o.tows} maxStuck=${o.longestStuckS}s -> node tools/playtest/sim.mjs city-bot --seed ${o.seed}`);
    }
  }
  console.log('');
}

async function main() {
  const server = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const { World } = await server.ssrLoadModule('/src/sim/World.ts');
    const { CityWorld } = await server.ssrLoadModule('/src/sim/city/CityWorld.ts');
    const road = await server.ssrLoadModule('/src/sim/road.ts');

    const report = { seeds: SEEDS_COUNT, vehicle: VEHICLE };
    let allPass = true;

    if (MODE === 'both' || MODE === 'route') {
      const runs = BASE_SEEDS.map((s) => runRouteSeed(World, road, s, VEHICLE));
      report.route = summarizeRoute(runs);
      if (report.route.targets.some((t) => !t.pass)) allPass = false;
    }

    if (MODE === 'both' || MODE === 'city') {
      const runs = BASE_SEEDS.map((s) => runCitySeed(CityWorld, s, VEHICLE));
      report.city = summarizeCity(runs);
      if (report.city.targets.some((t) => !t.pass)) allPass = false;
    }

    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    else printSummary(report);

    if (CHECK && !allPass) process.exitCode = 1;
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
