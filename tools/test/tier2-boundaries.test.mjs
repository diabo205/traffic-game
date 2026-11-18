import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  createInputHarness,
  createMockGamepad,
  loadSimModules,
  makeInput,
  repoRoot,
} from './helpers.mjs';

const EXPECTED_VEHICLES = ['alto', 'coupe', 'rickshaw', 'suv', 'minibus'];

let mods;

before(async () => {
  mods = await loadSimModules();
});

after(async () => {
  await mods?.close();
});

function cyclicStep(list, index, delta) {
  const n = list.length;
  return (((index + delta) % n) + n) % n;
}

describe('Tier 2 — Boundary & Edge-Case Tests', () => {
  describe('A. Wraparound & Cyclic Indexing Boundaries across 5 Vehicles', () => {
    it('wraps backward from index 0 to index 4 (minibus)', () => {
      const { PLAYER_VEHICLES } = mods.playerCar;
      assert.equal(PLAYER_VEHICLES.length, 5);
      const next = cyclicStep(PLAYER_VEHICLES, 0, -1);
      assert.equal(next, 4);
      assert.equal(PLAYER_VEHICLES[next], 'minibus');
    });

    it('wraps forward from index 4 to index 0 (alto)', () => {
      const { PLAYER_VEHICLES } = mods.playerCar;
      const next = cyclicStep(PLAYER_VEHICLES, 4, 1);
      assert.equal(next, 0);
      assert.equal(PLAYER_VEHICLES[next], 'alto');
    });

    it('computes adjacent vehicle cleanly for every index including wraparound', () => {
      const { PLAYER_VEHICLES } = mods.playerCar;
      for (let i = 0; i < PLAYER_VEHICLES.length; i++) {
        const adj = PLAYER_VEHICLES[cyclicStep(PLAYER_VEHICLES, i, 1)];
        assert.notEqual(adj, PLAYER_VEHICLES[i], 'Adjacent vehicle must differ from active vehicle');
        assert.ok(PLAYER_VEHICLES.includes(adj));
      }
    });

    it('returns to exact starting vehicle after +5 and -5 full cycles', () => {
      const { PLAYER_VEHICLES } = mods.playerCar;
      for (let start = 0; start < PLAYER_VEHICLES.length; start++) {
        let idx = start;
        for (let k = 0; k < 5; k++) idx = cyclicStep(PLAYER_VEHICLES, idx, 1);
        assert.equal(idx, start, '+5 cycle must return to start');
        for (let k = 0; k < 5; k++) idx = cyclicStep(PLAYER_VEHICLES, idx, -1);
        assert.equal(idx, start, '-5 cycle must return to start');
      }
    });

    it('handles multi-step jumps (+12, -13) cleanly without out-of-bounds undefined', () => {
      const { PLAYER_VEHICLES } = mods.playerCar;
      assert.equal(PLAYER_VEHICLES[cyclicStep(PLAYER_VEHICLES, 1, 12)], PLAYER_VEHICLES[3]);
      assert.equal(PLAYER_VEHICLES[cyclicStep(PLAYER_VEHICLES, 1, -13)], PLAYER_VEHICLES[3]);
    });
  });

  describe('B. Unlock / Lock Bank Boundary Checks', () => {
    it('keeps alto and coupe unlocked at bank = 0 while locking rickshaw, suv, minibus', () => {
      const { VEHICLE_COST, PLAYER_VEHICLES } = mods.playerCar;
      const bank = 0;
      const unlocked = PLAYER_VEHICLES.filter((v) => bank >= VEHICLE_COST[v]);
      const locked = PLAYER_VEHICLES.filter((v) => bank < VEHICLE_COST[v]);
      assert.deepEqual(unlocked, ['alto', 'coupe']);
      assert.deepEqual(locked, ['rickshaw', 'suv', 'minibus']);
    });

    it('locks rickshaw at bank = 399 and unlocks at exact threshold bank = 400', () => {
      const { VEHICLE_COST } = mods.playerCar;
      assert.equal(399 >= VEHICLE_COST.rickshaw, false);
      assert.equal(400 >= VEHICLE_COST.rickshaw, true);
    });

    it('locks suv at bank = 799 and unlocks at exact threshold bank = 800', () => {
      const { VEHICLE_COST } = mods.playerCar;
      assert.equal(799 >= VEHICLE_COST.suv, false);
      assert.equal(800 >= VEHICLE_COST.suv, true);
    });

    it('locks minibus at bank = 1199 and unlocks at exact threshold bank = 1200', () => {
      const { VEHICLE_COST } = mods.playerCar;
      assert.equal(1199 >= VEHICLE_COST.minibus, false);
      assert.equal(1200 >= VEHICLE_COST.minibus, true);
    });

    it('unlocks all 5 vehicles at bank >= 1200 with non-negative integer costs', () => {
      const { VEHICLE_COST, PLAYER_VEHICLES } = mods.playerCar;
      for (const v of PLAYER_VEHICLES) {
        assert.ok(Number.isInteger(VEHICLE_COST[v]) && VEHICLE_COST[v] >= 0);
        assert.equal(1200 >= VEHICLE_COST[v], true);
      }
    });
  });

  describe('C. Rapid Vehicle Instantiation & State Isolation', () => {
    it('instantiates all 5 vehicles cleanly in World with zero state leaks', () => {
      const { World } = mods.worldMod;
      const { VEHICLE_SPECS } = mods.playerCar;
      for (const v of EXPECTED_VEHICLES) {
        const w = new World(1337, 0, v);
        assert.equal(w.player.vehicle, v);
        assert.equal(w.player.spec.label, VEHICLE_SPECS[v].label);
        assert.equal(w.player.speed, 0);
        assert.equal(w.player.integrity, 100);
        assert.equal(w.phase, 'ready');
        w.start();
        w.step(makeInput({ throttle: 1 }));
        assert.ok(Number.isFinite(w.player.speed) && w.player.speed > 0);
      }
    });

    it('instantiates all 5 vehicles cleanly in CityWorld with zero state leaks', () => {
      const { CityWorld } = mods.cityWorldMod;
      const { VEHICLE_SPECS } = mods.playerCar;
      for (const v of EXPECTED_VEHICLES) {
        const w = new CityWorld(1337, v);
        assert.equal(w.player.vehicle, v);
        assert.equal(w.player.spec.label, VEHICLE_SPECS[v].label);
        assert.equal(w.player.speed, 0);
        assert.equal(w.player.integrity, 100);
        assert.equal(w.phase, 'ready');
        w.start();
        w.step(makeInput({ throttle: 1 }));
        assert.ok(Number.isFinite(w.player.speed) && w.player.speed > 0);
      }
    });

    it('switches PlayerCar.setVehicle rapidly across all 5 rides without carrying stale spec', () => {
      const { PlayerCar, VEHICLE_SPECS } = mods.playerCar;
      const p = new PlayerCar();
      for (let round = 0; round < 3; round++) {
        for (const v of EXPECTED_VEHICLES) {
          p.setVehicle(v);
          assert.equal(p.vehicle, v);
          assert.strictEqual(p.spec, VEHICLE_SPECS[v]);
        }
      }
    });

    it('does not leak boostTime, drift, or damage when swapping to a fresh World instance', () => {
      const { World } = mods.worldMod;
      const w1 = new World(99, 1200, 'coupe');
      w1.start();
      for (let t = 0; t < 46; t++) w1.step(makeInput({ throttle: 1, brake: 1 }));
      w1.step(makeInput({ throttle: 1, brake: 0 }));
      w1.player.integrity = 35;
      assert.ok(w1.player.boostTime > 0);

      const w2 = new World(99, 0, 'suv');
      assert.equal(w2.player.boostTime, 0);
      assert.equal(w2.player.boostCooldown, 0);
      assert.equal(w2.player.drift, 0);
      assert.equal(w2.player.integrity, 100);
    });

    it('keeps World frozen while phase === ready even under full throttle inputs', () => {
      const { World } = mods.worldMod;
      for (const v of EXPECTED_VEHICLES) {
        const w = new World(101, 0, v);
        const startZ = w.player.z;
        for (let t = 0; t < 30; t++) w.step(makeInput({ throttle: 1, steer: 1, horn: true }));
        assert.equal(w.phase, 'ready');
        assert.equal(w.player.speed, 0);
        assert.equal(w.player.z, startZ);
      }
    });
  });

  describe('D. InputManager Key-Leak & Edge-Trigger Boundaries', () => {
    it('ignores keydown repeat events (e.repeat = true) for nav, confirm, and back', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.pressKey('ArrowRight', { repeat: true });
        h.pressKey('ArrowLeft', { repeat: true });
        h.pressKey('Enter', { repeat: true });
        h.pressKey('Escape', { repeat: true });
        h.pressKey('Backspace', { repeat: true });
        assert.equal(h.input.consumeMenuNav(), 0);
        assert.equal(h.input.consumeConfirm(), false);
        assert.equal(h.input.consumeBack(), false);
      } finally {
        h.restore();
      }
    });

    it('clears queued edge flags strictly after one consume call', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.tapKey('ArrowRight');
        assert.equal(h.input.consumeMenuNav(), 1);
        assert.equal(h.input.consumeMenuNav(), 0);

        h.tapKey('Enter');
        assert.equal(h.input.consumeConfirm(), true);
        assert.equal(h.input.consumeConfirm(), false);

        h.tapKey('Backspace');
        assert.equal(h.input.consumeBack(), true);
        assert.equal(h.input.consumeBack(), false);
      } finally {
        h.restore();
      }
    });

    it('clears held keys on window blur so driving steer/throttle never stick after menu transitions', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.pressKey('KeyD');
        h.pressKey('KeyW');
        let frame = h.input.sample(1 / 60);
        assert.ok(frame.throttle === 1 && frame.steer > 0);
        h.blur();
        for (let i = 0; i < 20; i++) frame = h.input.sample(1 / 60);
        assert.equal(frame.throttle, 0);
        assert.equal(frame.steer, 0);
      } finally {
        h.restore();
      }
    });

    it('prevents held ArrowRight/KeyD after release from leaving permanent steer offset', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.pressKey('ArrowRight');
        assert.equal(h.input.consumeMenuNav(), 1);
        h.releaseKey('ArrowRight');
        const firstFrame = h.input.sample(1 / 60);
        assert.equal(firstFrame.steer, 0, 'Immediate first sample after ArrowRight release must have steer === 0');

        // Also verify held KeyD decays cleanly to 0 after release without sticking
        h.pressKey('KeyD');
        for (let i = 0; i < 10; i++) h.input.sample(1 / 60);
        h.releaseKey('KeyD');
        let frame;
        for (let i = 0; i < 15; i++) frame = h.input.sample(1 / 60);
        assert.equal(frame.steer, 0);
      } finally {
        h.restore();
      }
    });

    it('does not re-trigger Gamepad nav/confirm/back continuously while button remains held', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.setGamepad(createMockGamepad({ buttons: { 0: true, 1: true, 14: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeConfirm(), true);
        assert.equal(h.input.consumeBack(), true);
        assert.equal(h.input.consumeMenuNav(), -1);

        // Next 10 frames with same buttons still held -> must return false / 0
        for (let i = 0; i < 10; i++) {
          h.input.sample(1 / 60);
          assert.equal(h.input.consumeConfirm(), false);
          assert.equal(h.input.consumeBack(), false);
          assert.equal(h.input.consumeMenuNav(), 0);
        }
      } finally {
        h.restore();
      }
    });
  });

  describe('E. Extreme Physics Corner Cases for All 5 Vehicles', () => {
    for (const v of EXPECTED_VEHICLES) {
      it(`keeps ${v} finite and bounded under sustained full throttle + boost + hard steering on shoulder & water`, () => {
        const { World } = mods.worldMod;
        const { road } = mods;
        const w = new World(2026, 1200, v);
        w.weather = 'monsoon';
        w.start();
        // Force a launch boost first
        for (let t = 0; t < 46; t++) w.step(makeInput({ throttle: 1, brake: 1 }));
        w.step(makeInput({ throttle: 1, brake: 0 }));

        // Drive hard left onto shoulder + puddles while oscillating hard steer and drifting
        for (let t = 0; t < 60 * 6; t++) {
          const r = road.sampleRoad(w.player.z);
          if (t === 30) w.player.x = r.left - r.shoulder * 0.6;
          const steer = t % 40 < 20 ? -1 : 1;
          const handbrake = t % 90 > 60 ? 1 : 0;
          w.step(makeInput({ throttle: 1, brake: handbrake, steer }));
          const p = w.player;
          assert.ok(
            Number.isFinite(p.x) &&
              Number.isFinite(p.z) &&
              Number.isFinite(p.y) &&
              Number.isFinite(p.speed) &&
              Number.isFinite(p.heading) &&
              Number.isFinite(p.travel) &&
              Number.isFinite(p.yawRate),
            `${v} produced non-finite state at tick ${t}`,
          );
          assert.ok(Math.abs(p.speed) < 80, `${v} speed exploded to ${p.speed}`);
        }
      });
    }
  });

  describe('F. Asset & Precache / Pack Boundary Checks', () => {
    it('has all 5 playable .glb models present and non-empty in public/models/', () => {
      for (const v of EXPECTED_VEHICLES) {
        const p = path.join(repoRoot, 'public/models', `${v}.glb`);
        assert.ok(existsSync(p), `Missing model file public/models/${v}.glb`);
        assert.ok(statSync(p).size > 1024, `Model file public/models/${v}.glb unexpectedly tiny`);
      }
    });

    it('includes coupe.glb and suv.glb in vite.config.ts PWA staticAssets precache', () => {
      const cfg = readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
      for (const v of EXPECTED_VEHICLES) {
        assert.ok(cfg.includes(`./models/${v}.glb`), `vite.config.ts missing ./models/${v}.glb precache`);
      }
    });

    it('includes all 5 playable models in tools/pack_html.mjs MODEL_NAMES and fetchShim regex', () => {
      const pack = readFileSync(path.join(repoRoot, 'tools/pack_html.mjs'), 'utf8');
      for (const v of EXPECTED_VEHICLES) {
        assert.ok(pack.includes(`'${v}'`), `pack_html.mjs MODEL_NAMES missing '${v}'`);
        const hasExplicitRegex = new RegExp(`models\\\\/\\([^)]*\\b${v}\\b[^)]*\\)\\\\\\.glb`).test(pack);
        const hasInterpolatedRegex = /models\\\/\$\{MODEL_NAMES\.join\(['"]\|['"]\)\}\\\.glb/.test(pack) ||
          pack.includes("models\\\\/(${MODEL_NAMES.join('|')})\\\\.glb");
        assert.ok(
          hasExplicitRegex || hasInterpolatedRegex,
          `pack_html.mjs fetchShim regex missing ${v}`,
        );
      }
    });
  });
});
