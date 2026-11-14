#!/usr/bin/env node
/**
 * Headless playtest probe. Runs the real sim (src/sim) through Vite's SSR
 * loader with scripted input and prints telemetry + feel metrics as JSON.
 *
 *   node tools/playtest/sim.mjs <scenario|script.json> [--mode city|route] [--seed N] [--z N] [--trace]
 *   node tools/playtest/sim.mjs list
 *
 * A script is JSON: { "mode": "city", "seed": 1337, "segments": [
 *   { "t": 2.0, "throttle": 1, "brake": 0, "steer": 0, "horn": false, "label": "floor it" }, ... ] }
 * Each segment holds its input for t seconds (sim runs at 60 Hz).
 * "steer" may also be "auto" — a tiny autopilot that steers toward the
 * current road/lane heading (city: follows the street under the car).
 */
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const target = args[0];

const KMH = 3.6;
const seg = (t, o = {}) => ({ t, throttle: 0, brake: 0, steer: 0, horn: false, ...o });

/** Built-in feel probes. Each is a script; metrics are computed for all. */
const SCENARIOS = {
  accel: { mode: 'route', about: 'Full throttle from standstill on the route for 12 s (0-50 / 0-80 km/h, top speed).', segments: [seg(12, { throttle: 1, steer: 'auto' })] },
  'accel-city': { mode: 'city', about: 'Full throttle from standstill in Saddar for 8 s.', segments: [seg(8, { throttle: 1, steer: 'auto' })] },
  brake: { mode: 'route', about: 'Reach ~top speed, then full brake (stopping distance/time).', segments: [seg(10, { throttle: 1, steer: 'auto' }), seg(5, { brake: 1, steer: 'auto' })] },
  coast: { mode: 'route', about: 'Reach speed, then lift off (how fast it bleeds speed).', segments: [seg(8, { throttle: 1, steer: 'auto' }), seg(6, { steer: 'auto' })] },
  'steer-response': { mode: 'city', about: 'At ~50 km/h snap full right for 1.5 s then full left (turn-in latency, yaw).', segments: [seg(4, { throttle: 1, steer: 'auto' }), seg(1.5, { throttle: 1, steer: 1 }), seg(1.5, { throttle: 1, steer: -1 })] },
  'wall-graze': { mode: 'route', about: 'Drive at speed and hold steer into the side barrier for 4 s (does the wall grab you?).', segments: [seg(7, { throttle: 1, steer: 'auto' }), seg(4, { throttle: 1, steer: -0.6 }), seg(3, { throttle: 1, steer: 'auto' })] },
  'wall-graze-city': { mode: 'city', about: 'City: drive and veer into the buildings/kerb line, keep the gas on.', segments: [seg(3, { throttle: 1, steer: 'auto' }), seg(4, { throttle: 1, steer: -0.5 }), seg(3, { throttle: 1, steer: 0.3 })] },
  'wall-escape': { mode: 'city', about: 'Nose into a building, then try to reverse and drive away (recovery time).', segments: [seg(2.5, { throttle: 1, steer: 'auto' }), seg(2.5, { throttle: 1, steer: -1 }), seg(1.5, { brake: 1 }), seg(1.5, { brake: 1, steer: 1 }), seg(3, { throttle: 1, steer: 'auto' })] },
  drift: { mode: 'city', about: 'Gas+brake drift with steer at speed, then power out (drift boost?).', segments: [seg(4, { throttle: 1, steer: 'auto' }), seg(1.6, { throttle: 1, brake: 1, steer: 1 }), seg(2, { throttle: 1, steer: 'auto' })] },
  launch: { mode: 'city', about: 'Hold gas+brake at standstill 0.6 s, release brake (launch boost).', segments: [seg(0.6, { throttle: 1, brake: 1 }), seg(4, { throttle: 1, steer: 'auto' })] },
  'reverse-flip': { mode: 'city', about: 'Drive forward, brake to stop, hold brake (does it reverse cleanly?), then forward again.', segments: [seg(3, { throttle: 1, steer: 'auto' }), seg(3, { brake: 1 }), seg(2, { throttle: 1, steer: 'auto' })] },
  'traffic-run': { mode: 'route', about: 'Full gas down the route with lane autopilot for 60 s — how much traffic/hazards you eat.', segments: [seg(60, { throttle: 1, steer: 'auto' })] },
  'chaos-mash': { mode: 'city', about: 'Random input mashing for 40 s (seeded): looks for NaNs, tunnelling, soft-locks.', chaos: 40, segments: [] },
};

function makeChaos(seconds, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s + 0x6d2b79f5) >>> 0), (((s ^ (s >>> 15)) * (1 | s)) >>> 0) / 4294967296);
  const out = [];
  let t = 0;
  while (t < seconds) {
    const d = 0.05 + rnd() * 0.6;
    out.push(seg(d, { throttle: rnd() < 0.7 ? 1 : 0, brake: rnd() < 0.3 ? 1 : 0, steer: [-1, -0.5, 0, 0.5, 1][Math.floor(rnd() * 5)], horn: rnd() < 0.1 }));
    t += d;
  }
  return out;
}

async function main() {
  if (!target || target === 'list') {
    for (const [k, v] of Object.entries(SCENARIOS)) console.log(`${k.padEnd(16)} [${v.mode}] ${v.about}`);
    return;
  }
  const script = SCENARIOS[target] ? structuredClone(SCENARIOS[target]) : JSON.parse(readFileSync(target, 'utf8'));
  const mode = flag('mode', script.mode ?? 'city');
  const seed = Number(flag('seed', script.seed ?? 1337)) >>> 0;
  if (script.chaos) script.segments = makeChaos(script.chaos, seed ^ 0x9e3779b9);
  script.segments = script.segments.map((s) => seg(s.t, s));

  const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  try {
    const { World } = await server.ssrLoadModule('/src/sim/World.ts');
    const { CityWorld } = await server.ssrLoadModule('/src/sim/city/CityWorld.ts');
    const road = await server.ssrLoadModule('/src/sim/road.ts');
    const world = mode === 'city' ? new CityWorld(seed) : new World(seed, Number(flag('z', script.z ?? 0)));
    const out = run(world, script.segments, mode, road, has('trace'));
    out.scenario = SCENARIOS[target] ? target : path.basename(target);
    out.mode = mode;
    out.seed = seed;
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await server.close();
  }
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function autoSteer(world, mode, road) {
  const p = world.player;
  let want = 0;
  if (mode === 'city') {
    const l = world.map.linkAt(p.x, p.z, p.heading);
    want = l ? l.heading : p.heading;
    // also pull toward the lane centre a bit
    if (l) {
      const lane = world.map.laneOffset?.(l, l.lanes - 1);
      void lane;
    }
  } else {
    const r = road.sampleRoad(p.z);
    const centre = r.left + r.laneWidth * 1.5;
    want = Math.max(-0.3, Math.min(0.3, (centre - p.x) * 0.08));
  }
  return Math.max(-1, Math.min(1, wrap(want - p.heading) * 2.5 - p.yawRate * 0.15));
}

function run(world, segments, mode, road, trace) {
  const DT = 1 / 60;
  const p = world.player;
  world.start();
  world.drainEvents();
  const events = {};
  const eventLog = [];
  const samples = [];
  const m = {
    t50: null, t80: null, topKmh: 0, stopDistM: null, stopTimeS: null,
    wallContactTicks: 0, longestWallContactS: 0, stuckS: 0, longestStuckS: 0,
    speedLostOnWallPct: null, nanOrInf: false, maxYawRate: 0, teleports: 0,
  };
  let t = 0, contact = 0, stuck = 0, brakeStart = null, wallEntrySpeed = null, wallMinSpeed = Infinity;
  let lastX = p.x, lastZ = p.z;
  for (const s of segments) {
    const n = Math.round(s.t * 60);
    for (let i = 0; i < n; i++) {
      const steer = s.steer === 'auto' ? autoSteer(world, mode, road) : s.steer;
      const input = { throttle: s.throttle, brake: s.brake, steer, horn: !!s.horn, dipper: false };
      const v0 = p.speed;
      world.step(input);
      t += DT;
      const evs = world.drainEvents();
      let wallish = false;
      for (const e of evs) {
        events[e.type] = (events[e.type] ?? 0) + 1;
        if (e.type === 'scrape' || (e.type === 'crash' && !('n' in e))) wallish = true;
        if (!['scrape', 'kerb'].includes(e.type) && eventLog.length < 80) eventLog.push({ t: +t.toFixed(2), ...e });
      }
      const kmh = p.speed * KMH;
      if (!Number.isFinite(p.x + p.z + p.speed + p.heading)) m.nanOrInf = true;
      if (Math.hypot(p.x - lastX, p.z - lastZ) > 3 && !evs.some((e) => e.type === 'towed')) m.teleports++;
      lastX = p.x; lastZ = p.z;
      m.topKmh = Math.max(m.topKmh, kmh);
      m.maxYawRate = Math.max(m.maxYawRate, Math.abs(p.yawRate));
      if (m.t50 === null && kmh >= 50) m.t50 = +t.toFixed(2);
      if (m.t80 === null && kmh >= 80) m.t80 = +t.toFixed(2);
      if (s.brake > 0.5 && s.throttle < 0.5 && brakeStart === null && p.speed > 5) brakeStart = { t, x: p.x, z: p.z };
      if (brakeStart && m.stopDistM === null && p.speed <= 0.3) {
        m.stopDistM = +Math.hypot(p.x - brakeStart.x, p.z - brakeStart.z).toFixed(1);
        m.stopTimeS = +(t - brakeStart.t).toFixed(2);
      }
      if (wallish) {
        m.wallContactTicks++; contact++;
        if (wallEntrySpeed === null) wallEntrySpeed = Math.abs(v0);
        wallMinSpeed = Math.min(wallMinSpeed, Math.abs(p.speed));
      } else {
        m.longestWallContactS = Math.max(m.longestWallContactS, contact / 60); contact = 0;
      }
      if (world.phase === "running" && s.throttle > 0.5 && s.brake < 0.5 && Math.abs(p.speed) < 1 && t > 0.5) stuck++;
      else { m.longestStuckS = Math.max(m.longestStuckS, stuck / 60); if (stuck) m.stuckS += stuck / 60; stuck = 0; }
      if (trace ? i % 6 === 0 : i % 30 === 0) {
        samples.push({ t: +t.toFixed(2), label: s.label, kmh: +kmh.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(2), heading: +p.heading.toFixed(3), slip: +wrap(p.heading - p.travel).toFixed(3), steerAngle: +p.steerAngle.toFixed(3), hp: +p.integrity.toFixed(1), boost: +p.boostTime.toFixed(2), drift: +p.drift.toFixed(2), air: p.airborne });
      }
    }
  }
  m.longestWallContactS = +Math.max(m.longestWallContactS, contact / 60).toFixed(2);
  m.longestStuckS = +Math.max(m.longestStuckS, stuck / 60).toFixed(2);
  m.stuckS = +(m.stuckS + stuck / 60).toFixed(2);
  if (wallEntrySpeed !== null && wallEntrySpeed > 1) m.speedLostOnWallPct = +((1 - wallMinSpeed / wallEntrySpeed) * 100).toFixed(0);
  m.topKmh = +m.topKmh.toFixed(1);
  m.maxYawRate = +m.maxYawRate.toFixed(2);
  return {
    durationS: +t.toFixed(2),
    metrics: m,
    final: { kmh: +(p.speed * KMH).toFixed(1), hp: +p.integrity.toFixed(1), crashes: world.level.stats.crashes, phase: world.phase, ...(world.fares ? { money: world.fares.money, score: world.stunts.score } : { progress: +world.level.progress.toFixed(3) }) },
    events,
    eventLog,
    samples,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
