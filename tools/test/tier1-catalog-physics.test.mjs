import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInputHarness,
  createMockGamepad,
  loadSimModules,
  makeInput,
  scanSimPurity,
} from './helpers.mjs';

const EXPECTED_VEHICLES = ['alto', 'coupe', 'rickshaw', 'suv', 'minibus'];
const EXPECTED_COSTS = {
  alto: 0,
  coupe: 0,
  rickshaw: 400,
  suv: 800,
  minibus: 1200,
};
const REQUIRED_SPEC_FIELDS = [
  'boostAccel',
  'boostTopSpeedMul',
  'boostCooldown',
  'boostDurationMul',
  'offroadDragMul',
  'offroadTraction',
  'driftSlideKeep',
  'driftYawBoost',
];

let mods;

before(async () => {
  mods = await loadSimModules();
});

after(async () => {
  await mods?.close();
});

function findShoulderPoint(World, road, vehicle) {
  const w = new World(1337, 0, vehicle);
  w.start();
  const r = road.sampleRoad(w.player.z);
  const shoulderCenter = r.left - r.shoulder * 0.5;
  w.player.reset(shoulderCenter, 25, 0, road.elevationAt(25));
  return w;
}

function findCityOffroadPoint(CityWorld, vehicle) {
  const w = new CityWorld(1337, vehicle);
  w.start();
  const b = w.map.bounds;
  for (let x = b.x0 + 40; x < b.x1 - 40; x += 4) {
    for (let z = b.z0 + 40; z < b.z1 - 40; z += 4) {
      if (w.map.isRoad(x, z)) continue;
      const box = {
        x,
        z,
        hw: w.player.spec.halfWidth + 0.8,
        hl: w.player.spec.halfLength + 0.8,
        heading: 0,
      };
      let blocked = false;
      w.map.forEachSolidNear(x, z, 5, (sb) => {
        if (Math.abs(sb.x - x) < sb.hw + box.hw + 1 && Math.abs(sb.z - z) < sb.hl + box.hl + 1) blocked = true;
      });
      let hasPuddle = false;
      w.map.forEachPuddleNear(x, z, 6, () => {
        hasPuddle = true;
      });
      if (!blocked && !hasPuddle && w.map.rampHeight(x, z) === 0) {
        return { x, z };
      }
    }
  }
  throw new Error('Could not locate clear off-road point in Saddar map');
}

describe('Tier 1 — Vehicle Catalog, Showcase Metadata, Physics, Surface, Input & Purity', () => {
  describe('A. Vehicle Catalog & VEHICLE_SHOWCASE Integrity', () => {
    it('exports PLAYER_VEHICLES with exact 5 vehicles in canonical order', () => {
      const { PLAYER_VEHICLES } = mods.playerCar;
      assert.deepEqual([...PLAYER_VEHICLES], EXPECTED_VEHICLES);
    });

    it('exports VEHICLE_COST matching exact economy progression', () => {
      const { VEHICLE_COST, PLAYER_VEHICLES } = mods.playerCar;
      for (const v of PLAYER_VEHICLES) {
        assert.equal(VEHICLE_COST[v], EXPECTED_COSTS[v], `Unexpected cost for ${v}`);
      }
      assert.equal(Object.keys(VEHICLE_COST).length, EXPECTED_VEHICLES.length);
    });

    it('exports VEHICLE_SHOWCASE with complete valid metadata for every vehicle', () => {
      const { VEHICLE_SHOWCASE } = mods.playerCar;
      for (const v of EXPECTED_VEHICLES) {
        const meta = VEHICLE_SHOWCASE[v];
        assert.ok(meta, `Missing VEHICLE_SHOWCASE entry for ${v}`);
        assert.equal(meta.id, v);
        assert.equal(typeof meta.brand, 'string');
        assert.ok(meta.brand.trim().length > 0, `${v} brand must be non-empty`);
        assert.equal(typeof meta.model, 'string');
        assert.ok(meta.model.trim().length > 0, `${v} model must be non-empty`);
        assert.equal(typeof meta.badgeName, 'string');
        assert.ok(meta.badgeName.trim().length > 0, `${v} badgeName must be non-empty`);
        assert.ok(Number.isFinite(meta.perfRating) && meta.perfRating > 0, `${v} perfRating invalid`);
      }
    });

    it('validates showcase stat bars [0..10], handlingGrid [-1..1], customizationRating [1..10], and paintHex', () => {
      const { VEHICLE_SHOWCASE } = mods.playerCar;
      for (const v of EXPECTED_VEHICLES) {
        const meta = VEHICLE_SHOWCASE[v];
        for (const key of ['power', 'highSpeed', 'acceleration', 'nitrous']) {
          const val = meta.stats[key];
          assert.ok(Number.isFinite(val) && val >= 0 && val <= 10, `${v}.stats.${key}=${val} out of [0,10]`);
        }
        assert.ok(
          Number.isFinite(meta.handlingGrid.x) && meta.handlingGrid.x >= -1 && meta.handlingGrid.x <= 1,
          `${v}.handlingGrid.x out of [-1,1]`,
        );
        assert.ok(
          Number.isFinite(meta.handlingGrid.y) && meta.handlingGrid.y >= -1 && meta.handlingGrid.y <= 1,
          `${v}.handlingGrid.y out of [-1,1]`,
        );
        assert.ok(
          Number.isInteger(meta.customizationRating) && meta.customizationRating >= 1 && meta.customizationRating <= 10,
          `${v}.customizationRating=${meta.customizationRating} must be integer in [1,10]`,
        );
        assert.ok(
          Number.isInteger(meta.paintHex) && meta.paintHex >= 0 && meta.paintHex <= 0xffffff,
          `${v}.paintHex=${meta.paintHex} must be valid 24-bit color`,
        );
      }
    });

    it('gives each of the 5 vehicles distinct showcase identity and non-identical stats', () => {
      const { VEHICLE_SHOWCASE } = mods.playerCar;
      const badgeNames = new Set(EXPECTED_VEHICLES.map((v) => VEHICLE_SHOWCASE[v].badgeName));
      const models = new Set(EXPECTED_VEHICLES.map((v) => VEHICLE_SHOWCASE[v].model));
      const fingerprints = new Set(
        EXPECTED_VEHICLES.map((v) => {
          const s = VEHICLE_SHOWCASE[v].stats;
          return `${s.power}|${s.highSpeed}|${s.acceleration}|${s.nitrous}`;
        }),
      );
      assert.equal(badgeNames.size, 5);
      assert.equal(models.size, 5);
      assert.equal(fingerprints.size, 5);
    });
  });

  describe('B. VehicleSpec Physics & Showcase Alignment', () => {
    it('defines all 8 required boost/offroad/drift VehicleSpec fields for every vehicle', () => {
      const { VEHICLE_SPECS } = mods.playerCar;
      for (const v of EXPECTED_VEHICLES) {
        const sp = VEHICLE_SPECS[v];
        assert.ok(sp, `Missing VEHICLE_SPECS for ${v}`);
        for (const field of REQUIRED_SPEC_FIELDS) {
          assert.ok(Number.isFinite(sp[field]) && sp[field] > 0, `${v}.spec.${field}=${sp[field]} must be > 0`);
        }
      }
    });

    it('aligns coupe vs alto showcase power, acceleration, nitrous, highSpeed, and drift leaning', () => {
      const { VEHICLE_SPECS, VEHICLE_SHOWCASE } = mods.playerCar;
      assert.ok(VEHICLE_SPECS.coupe.topSpeedMul > VEHICLE_SPECS.alto.topSpeedMul);
      assert.ok(VEHICLE_SHOWCASE.coupe.stats.highSpeed > VEHICLE_SHOWCASE.alto.stats.highSpeed);
      assert.ok(VEHICLE_SHOWCASE.coupe.stats.power > VEHICLE_SHOWCASE.alto.stats.power);
      assert.ok(VEHICLE_SHOWCASE.coupe.stats.acceleration > VEHICLE_SHOWCASE.alto.stats.acceleration);
      assert.ok(VEHICLE_SHOWCASE.coupe.stats.nitrous > VEHICLE_SHOWCASE.alto.stats.nitrous);
      assert.ok(VEHICLE_SHOWCASE.coupe.perfRating > VEHICLE_SHOWCASE.alto.perfRating);
      assert.ok(
        VEHICLE_SHOWCASE.coupe.handlingGrid.x > VEHICLE_SHOWCASE.suv.handlingGrid.x,
        `coupe handlingGrid.x (${VEHICLE_SHOWCASE.coupe.handlingGrid.x}) should exceed suv (${VEHICLE_SHOWCASE.suv.handlingGrid.x})`,
      );
    });

    it('aligns suv off-road superiority in both physics and handlingGrid', () => {
      const { VEHICLE_SPECS, VEHICLE_SHOWCASE } = mods.playerCar;
      assert.ok(VEHICLE_SPECS.suv.offroadDragMul < VEHICLE_SPECS.coupe.offroadDragMul);
      assert.ok(VEHICLE_SPECS.suv.offroadDragMul < VEHICLE_SPECS.alto.offroadDragMul);
      assert.ok(VEHICLE_SPECS.suv.offroadTraction > VEHICLE_SPECS.coupe.offroadTraction);
      assert.ok(VEHICLE_SPECS.suv.offroadTraction > VEHICLE_SPECS.alto.offroadTraction);
      assert.ok(VEHICLE_SHOWCASE.suv.handlingGrid.y > VEHICLE_SHOWCASE.coupe.handlingGrid.y);
      assert.ok(VEHICLE_SHOWCASE.suv.handlingGrid.y > 0, 'SUV should lean toward OFF-ROAD (+y)');
    });

    it('aligns rickshaw agility/sharp turning and minibus heavy mass/damage resistance', () => {
      const { VEHICLE_SPECS } = mods.playerCar;
      assert.ok(VEHICLE_SPECS.rickshaw.maxSteerLow > VEHICLE_SPECS.alto.maxSteerLow);
      assert.ok(VEHICLE_SPECS.rickshaw.maxSteerLow > VEHICLE_SPECS.minibus.maxSteerLow);
      assert.ok(VEHICLE_SPECS.rickshaw.wheelBase < VEHICLE_SPECS.alto.wheelBase);
      assert.ok(VEHICLE_SPECS.minibus.mass > VEHICLE_SPECS.suv.mass);
      assert.ok(VEHICLE_SPECS.minibus.damageRes < VEHICLE_SPECS.alto.damageRes);
    });

    it('produces distinct measured 0->top acceleration & top speed across vehicles in real World simulation', () => {
      const { World } = mods.worldMod;
      const measureTop = (veh) => {
        const w = new World(42, 1200, veh); // Lyari Expressway straight high-limit zone
        w.start();
        for (let t = 0; t < 60 * 10; t++) w.step(makeInput({ throttle: 1 }));
        return w.player.speed;
      };
      const coupeSpeed = measureTop('coupe');
      const altoSpeed = measureTop('alto');
      const rickshawSpeed = measureTop('rickshaw');
      assert.ok(coupeSpeed > altoSpeed + 1.0, `Expected coupe (${coupeSpeed.toFixed(2)}) > alto (${altoSpeed.toFixed(2)})`);
      assert.ok(altoSpeed > rickshawSpeed + 1.0, `Expected alto (${altoSpeed.toFixed(2)}) > rickshaw (${rickshawSpeed.toFixed(2)})`);
    });
  });

  describe('C. Gameplay Boost / Nitrous Differentiation (World & CityWorld)', () => {
    it('triggers launch boost with isolated boostAccel & per-vehicle boost duration in World', () => {
      const { World, DT } = mods.worldMod;
      const { VEHICLE_SPECS } = mods.playerCar;
      const runLaunch = (veh) => {
        const w = new World(1001, 1200, veh);
        w.start();
        w.drainEvents();
        // Stage launch for 0.75s (46 ticks)
        for (let t = 0; t < 46; t++) w.step(makeInput({ throttle: 1, brake: 1 }));
        // Release brake to fire launch boost (tick 1 from v=0)
        w.step(makeInput({ throttle: 1, brake: 0 }));
        const events = w.drainEvents();
        const boostEvent = events.find((e) => e.type === 'boost' && e.kind === 'launch');
        const initialBoostTime = w.player.boostTime;
        const initialCooldown = w.player.boostCooldown;
        const tick1BoostedSpeed = w.player.speed;
        for (let t = 0; t < 45; t++) w.step(makeInput({ throttle: 1 }));
        return { boostEvent, initialBoostTime, initialCooldown, tick1BoostedSpeed, speedAfter: w.player.speed };
      };
      const runUnboosted = (veh) => {
        const w = new World(1001, 1200, veh);
        w.start();
        w.step(makeInput({ throttle: 1, brake: 0 }));
        const tick1PlainSpeed = w.player.speed;
        for (let t = 0; t < 45; t++) w.step(makeInput({ throttle: 1 }));
        return { tick1PlainSpeed, speedAfter: w.player.speed };
      };
      const coupe = runLaunch('coupe');
      const alto = runLaunch('alto');
      const coupePlain = runUnboosted('coupe');
      const altoPlain = runUnboosted('alto');

      assert.ok(coupe.boostEvent, 'coupe should emit launch boost event');
      assert.ok(alto.boostEvent, 'alto should emit launch boost event');
      assert.ok(coupe.initialBoostTime > 0 && alto.initialBoostTime > 0);
      assert.ok(
        Math.abs(coupe.initialCooldown - VEHICLE_SPECS.coupe.boostCooldown) < 0.05,
        `coupe boostCooldown=${coupe.initialCooldown} should match spec=${VEHICLE_SPECS.coupe.boostCooldown}`,
      );
      // Unconditional per-vehicle duration & boosted speed checks (no spec-guarded skips)
      assert.ok(
        coupe.initialBoostTime > alto.initialBoostTime,
        `coupe boostTime (${coupe.initialBoostTime.toFixed(3)}) must exceed alto (${alto.initialBoostTime.toFixed(3)})`,
      );
      assert.ok(
        coupe.speedAfter > alto.speedAfter,
        `coupe boosted speed (${coupe.speedAfter.toFixed(2)}) must exceed alto (${alto.speedAfter.toFixed(2)})`,
      );

      // Isolate boostAccel from driveAccel via boosted-vs-unboosted delta on tick 1 and after 45 ticks
      const coupeIsolatedBoostAccel = (coupe.tick1BoostedSpeed - coupePlain.tick1PlainSpeed) / DT;
      const altoIsolatedBoostAccel = (alto.tick1BoostedSpeed - altoPlain.tick1PlainSpeed) / DT;
      assert.ok(
        Math.abs(coupeIsolatedBoostAccel - VEHICLE_SPECS.coupe.boostAccel) < 0.05,
        `Isolated coupe boostAccel (${coupeIsolatedBoostAccel.toFixed(3)}) must match spec (${VEHICLE_SPECS.coupe.boostAccel})`,
      );
      assert.ok(
        coupeIsolatedBoostAccel > altoIsolatedBoostAccel + 1.0,
        `Isolated coupe boostAccel (${coupeIsolatedBoostAccel.toFixed(2)}) must exceed alto (${altoIsolatedBoostAccel.toFixed(2)})`,
      );
      const coupeBoostGain = coupe.speedAfter - coupePlain.speedAfter;
      const altoBoostGain = alto.speedAfter - altoPlain.speedAfter;
      assert.ok(
        coupeBoostGain > altoBoostGain,
        `Coupe 45-tick boost gain delta (${coupeBoostGain.toFixed(2)}) must exceed alto (${altoBoostGain.toFixed(2)})`,
      );
    });

    it('triggers drift boost in World and differentiates drift slip between coupe and minibus/suv', () => {
      const { World } = mods.worldMod;
      const measureDrift = (veh) => {
        const w = new World(1001, 1200, veh);
        w.start();
        for (let t = 0; t < 150; t++) w.step(makeInput({ throttle: 1 }));
        w.drainEvents();
        let maxSlip = 0;
        for (let t = 0; t < 45; t++) {
          w.step(makeInput({ throttle: 1, brake: 1, steer: 0.9 }));
          let sl = Math.abs(w.player.heading - w.player.travel);
          if (sl > Math.PI) sl = Math.abs(2 * Math.PI - sl);
          maxSlip = Math.max(maxSlip, sl);
        }
        let sawDriftBoost = false;
        for (let t = 0; t < 15; t++) {
          w.step(makeInput({ throttle: 1, brake: 0, steer: 0 }));
          if (w.drainEvents().some((e) => e.type === 'boost' && e.kind === 'drift')) sawDriftBoost = true;
        }
        return { sawDriftBoost, boostTime: w.player.boostTime, maxSlip };
      };
      const coupe = measureDrift('coupe');
      const suv = measureDrift('suv');
      const minibus = measureDrift('minibus');
      assert.ok(coupe.sawDriftBoost, 'Expected drift boost event after powering out of committed drift');
      assert.ok(coupe.boostTime > 0, 'Expected active boostTime after drift boost');
      assert.ok(
        coupe.maxSlip > suv.maxSlip && coupe.maxSlip > minibus.maxSlip,
        `Coupe drift slip (${coupe.maxSlip.toFixed(4)}) must exceed suv (${suv.maxSlip.toFixed(4)}) and minibus (${minibus.maxSlip.toFixed(4)})`,
      );
    });

    it('triggers dash boost in CityWorld and exceeds unboosted speed', () => {
      const { CityWorld } = mods.cityWorldMod;
      const runDash = (doDash) => {
        const w = new CityWorld(1337, 'coupe');
        w.start();
        for (let t = 0; t < 65; t++) w.step(makeInput({ throttle: 1 }));
        w.drainEvents();
        if (doDash) {
          for (let t = 0; t < 3; t++) w.step(makeInput({ throttle: 0 }));
          w.step(makeInput({ throttle: 1 }));
        }
        const evs = w.drainEvents();
        for (let t = 0; t < 30; t++) w.step(makeInput({ throttle: 1 }));
        return { dashEvent: evs.some((e) => e.type === 'boost' && e.kind === 'dash'), speed: w.player.speed };
      };
      const withDash = runDash(true);
      const steady = runDash(false);
      assert.ok(withDash.dashEvent, 'Expected dash boost event in CityWorld');
      assert.ok(withDash.speed > steady.speed, `Dash speed (${withDash.speed}) should beat steady (${steady.speed})`);
    });

    it('lets boosting exceed nominal top speed proportionally to boostTopSpeedMul (coupe > alto)', () => {
      const { World } = mods.worldMod;
      const { VEHICLE_SPECS } = mods.playerCar;
      const measureBoostedPeak = (veh) => {
        const w = new World(1001, 1200, veh);
        w.start();
        const baseTop = w.topSpeed();
        for (let t = 0; t < 60 * 10; t++) w.step(makeInput({ throttle: 1 }));
        const cruiseSpeed = w.player.speed;
        // Nudge left before drifting right so car stays cleanly inside carriageway without scraping median
        for (let t = 0; t < 30; t++) w.step(makeInput({ throttle: 1, steer: -0.25 }));
        for (let t = 0; t < 42; t++) w.step(makeInput({ throttle: 1, brake: 1, steer: 0.55 }));
        let peakSpeed = 0;
        for (let t = 0; t < 75; t++) {
          w.step(makeInput({ throttle: 1, brake: 0, steer: 0 }));
          if (w.player.boostTime > 0) peakSpeed = Math.max(peakSpeed, w.player.speed);
        }

        // Also test at v = baseTop * 1.10 under active launch boost:
        // If boostTopSpeedMul were lowered to <= 1.05 or 1.10, ratio > 1 would brake instead of accelerate!
        const wHigh = new World(1001, 1200, veh);
        wHigh.start();
        for (let t = 0; t < 46; t++) wHigh.step(makeInput({ throttle: 1, brake: 1 }));
        wHigh.step(makeInput({ throttle: 1, brake: 0 }));
        const boostedTop = baseTop * VEHICLE_SPECS[veh].boostTopSpeedMul;
        wHigh.player.speed = baseTop * 1.10;
        const speedBefore = wHigh.player.speed;
        wHigh.step(makeInput({ throttle: 1, brake: 0 }));
        const speedAfterHigh = wHigh.player.speed;

        // Also check high-speed pull at v = baseTop * 1.29: coupe (1.34) still accelerates while alto (1.28) decelerates
        const wCeil = new World(1001, 1200, veh);
        wCeil.start();
        for (let t = 0; t < 46; t++) wCeil.step(makeInput({ throttle: 1, brake: 1 }));
        wCeil.step(makeInput({ throttle: 1, brake: 0 }));
        wCeil.player.speed = baseTop * 1.29;
        wCeil.step(makeInput({ throttle: 1, brake: 0 }));
        const ceilDelta = wCeil.player.speed - baseTop * 1.29;

        return { baseTop, boostedTop, cruiseSpeed, peakSpeed, speedBefore, speedAfterHigh, ceilDelta };
      };
      const coupe = measureBoostedPeak('coupe');
      const alto = measureBoostedPeak('alto');
      assert.ok(
        coupe.peakSpeed > coupe.cruiseSpeed && coupe.peakSpeed <= coupe.boostedTop + 1.5,
        `Coupe peak boosted speed ${coupe.peakSpeed.toFixed(2)} should exceed cruise ${coupe.cruiseSpeed.toFixed(2)} and stay <= ${(coupe.boostedTop + 1.5).toFixed(2)}`,
      );
      assert.ok(
        coupe.peakSpeed > alto.peakSpeed + 3.0,
        `Coupe boosted peak (${coupe.peakSpeed.toFixed(2)}) must exceed alto (${alto.peakSpeed.toFixed(2)}) by > 3 m/s`,
      );
      assert.ok(
        coupe.speedAfterHigh > coupe.speedBefore,
        `At 1.10x baseTop (${coupe.speedBefore.toFixed(2)}), coupe boost must accelerate -> ${coupe.speedAfterHigh.toFixed(2)}`,
      );
      assert.ok(
        coupe.ceilDelta > 0 && alto.ceilDelta < 0,
        `At 1.29x baseTop, coupe (mul=1.34) must still gain speed (delta=${coupe.ceilDelta.toFixed(4)}) while alto (mul=1.28) tapers down (delta=${alto.ceilDelta.toFixed(4)})`,
      );
    });

    it('enforces per-vehicle boostCooldown between consecutive boosts', () => {
      const { World } = mods.worldMod;
      const w = new World(1001, 1200, 'alto');
      w.start();
      for (let t = 0; t < 46; t++) w.step(makeInput({ throttle: 1, brake: 1 }));
      w.step(makeInput({ throttle: 1, brake: 0 }));
      assert.ok(w.player.boostCooldown > 0, 'Cooldown must engage immediately after boost');
      // Attempt immediate second launch charge right after stopping; cooldown blocks if still > 0
      w.player.speed = 0;
      for (let t = 0; t < 25; t++) w.step(makeInput({ throttle: 1, brake: 1 }));
      w.drainEvents();
      w.step(makeInput({ throttle: 1, brake: 0 }));
      const secondBoost = w.drainEvents().some((e) => e.type === 'boost');
      assert.equal(secondBoost, false, 'Should not fire second boost before boostCooldown expires');
    });
  });

  describe('D. Off-Road Drag & Traction in World and CityWorld', () => {
    it('retains higher speed on World dirt shoulder for suv than coupe and alto', () => {
      const { World } = mods.worldMod;
      const { road } = mods;
      const shoulderCruise = (veh) => {
        const w = findShoulderPoint(World, road, veh);
        for (let t = 0; t < 60 * 5; t++) {
          // Keep car aligned on left shoulder without hitting left wall
          const r = road.sampleRoad(w.player.z);
          const targetX = r.left - r.shoulder * 0.5;
          const steer = Math.max(-0.4, Math.min(0.4, (targetX - w.player.x) * 0.4 - w.player.heading * 1.2));
          w.step(makeInput({ throttle: 1, steer }));
        }
        return w.player.speed / w.topSpeed();
      };
      const suvRatio = shoulderCruise('suv');
      const coupeRatio = shoulderCruise('coupe');
      const altoRatio = shoulderCruise('alto');
      assert.ok(suvRatio > coupeRatio, `SUV shoulder ratio (${suvRatio.toFixed(3)}) must exceed coupe (${coupeRatio.toFixed(3)})`);
      assert.ok(suvRatio > altoRatio, `SUV shoulder ratio (${suvRatio.toFixed(3)}) must exceed alto (${altoRatio.toFixed(3)})`);
    });

    it('applies off-road drag INSIDE CityWorld.applySurface() before PlayerCar.update() (not wiped after update)', () => {
      const { CityWorld } = mods.cityWorldMod;
      const offroadPt = findCityOffroadPoint(CityWorld, 'coupe');

      // Warm up 1 tick at speed=0 off-road so kerbs() already registers onRoad=false without confounding tick 1
      const wOff = new CityWorld(1337, 'coupe');
      wOff.start();
      wOff.player.reset(offroadPt.x, offroadPt.z, 0);
      wOff.step(makeInput({ throttle: 0 }));
      wOff.player.reset(offroadPt.x, offroadPt.z, 0);
      wOff.player.speed = 20;
      wOff.step(makeInput({ throttle: 0 }));
      const offroadSpeedAfterTick1 = wOff.player.speed;

      // Compare single-tick coasting deceleration from speed=20 on road
      const wRoad = new CityWorld(1337, 'coupe');
      wRoad.start();
      wRoad.player.speed = 20;
      wRoad.step(makeInput({ throttle: 0 }));
      const roadSpeedAfterTick1 = wRoad.player.speed;

      assert.ok(
        offroadSpeedAfterTick1 < roadSpeedAfterTick1,
        `Single-tick off-road speed (${offroadSpeedAfterTick1.toFixed(4)}) must be lower than road (${roadSpeedAfterTick1.toFixed(4)})`,
      );
      assert.equal(wOff.player.extraDrag, 0, 'PlayerCar.update() must reset extraDrag after applying surface drag');
      assert.equal(wOff.player.traction, 1, 'PlayerCar.update() must reset traction after tick completes');
    });

    it('retains higher off-road speed and traction for suv than coupe in CityWorld', () => {
      const { CityWorld } = mods.cityWorldMod;
      const offroadPt = findCityOffroadPoint(CityWorld, 'suv');
      const runCityOffroad = (veh) => {
        const w = new CityWorld(1337, veh);
        w.start();
        w.player.reset(offroadPt.x, offroadPt.z, 0);
        for (let t = 0; t < 60; t++) {
          w.player.x = offroadPt.x;
          w.player.z = offroadPt.z;
          w.step(makeInput({ throttle: 1 }));
        }
        return w.player.speed;
      };
      const suvSpeed = runCityOffroad('suv');
      const coupeSpeed = runCityOffroad('coupe');
      assert.ok(suvSpeed > coupeSpeed, `City off-road SUV (${suvSpeed.toFixed(2)}) must exceed coupe (${coupeSpeed.toFixed(2)})`);
    });

    it('reduces lateral slip / maintains higher off-road yaw control for suv vs coupe on shoulder', () => {
      const { World } = mods.worldMod;
      const { road } = mods;
      const testTurn = (veh) => {
        const w = findShoulderPoint(World, road, veh);
        w.player.speed = 16;
        for (let t = 0; t < 15; t++) {
          const r = road.sampleRoad(w.player.z);
          w.player.x = r.left - r.shoulder * 0.5;
          w.step(makeInput({ throttle: 1, steer: 0.6 }));
        }
        return Math.abs(w.player.heading - w.player.travel);
      };
      const suvSlip = testTurn('suv');
      const coupeSlip = testTurn('coupe');
      assert.ok(Number.isFinite(suvSlip) && Number.isFinite(coupeSlip));
      assert.ok(suvSlip <= coupeSlip + 0.05, `SUV offroad slip (${suvSlip.toFixed(3)}) should be <= coupe (${coupeSlip.toFixed(3)})`);
    });

    it('cleans up per-tick surface modifiers at end of tick without permanent drag leak onto asphalt', () => {
      const { World } = mods.worldMod;
      const { road } = mods;
      const w = findShoulderPoint(World, road, 'coupe');
      w.step(makeInput({ throttle: 1 }));
      // Move back onto dry asphalt center lane
      const r = road.sampleRoad(w.player.z);
      w.player.reset(r.left + r.laneWidth * 1.5, w.player.z, 0, road.elevationAt(w.player.z));
      for (let t = 0; t < 60 * 6; t++) w.step(makeInput({ throttle: 1 }));
      assert.ok(w.player.speed >= w.topSpeed() * 0.96, 'Asphalt speed should recover to full topSpeed after leaving shoulder');
    });
  });

  describe('E. InputManager Menu Navigation (Keyboard & Gamepad)', () => {
    it('maps ArrowLeft/ArrowRight and KeyA/KeyD to consumeMenuNav() -1 / +1', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        assert.equal(h.input.consumeMenuNav(), 0);
        h.tapKey('ArrowRight');
        assert.equal(h.input.consumeMenuNav(), 1);
        assert.equal(h.input.consumeMenuNav(), 0);

        h.tapKey('ArrowLeft');
        assert.equal(h.input.consumeMenuNav(), -1);
        assert.equal(h.input.consumeMenuNav(), 0);

        h.tapKey('KeyD');
        assert.equal(h.input.consumeMenuNav(), 1);

        h.tapKey('KeyA');
        assert.equal(h.input.consumeMenuNav(), -1);
      } finally {
        h.restore();
      }
    });

    it('maps Enter/NumpadEnter to consumeConfirm() and Escape/Backspace to consumeBack()', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.tapKey('Enter');
        assert.equal(h.input.consumeConfirm(), true);
        assert.equal(h.input.consumeConfirm(), false);

        h.tapKey('NumpadEnter');
        assert.equal(h.input.consumeConfirm(), true);

        h.tapKey('Escape');
        assert.equal(h.input.consumeBack(), true);
        assert.equal(h.input.consumeBack(), false);

        h.tapKey('Backspace');
        assert.equal(h.input.consumeBack(), true);
        assert.equal(h.input.consumeBack(), false);
      } finally {
        h.restore();
      }
    });

    it('maps Gamepad D-Pad Left/Right (buttons 14/15) to edge-triggered consumeMenuNav()', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.setGamepad(createMockGamepad({ buttons: { 15: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeMenuNav(), 1);
        // Holding D-pad must not re-trigger every frame
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeMenuNav(), 0);

        // Release then press D-pad Left
        h.setGamepad(createMockGamepad({}));
        h.input.sample(1 / 60);
        h.setGamepad(createMockGamepad({ buttons: { 14: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeMenuNav(), -1);
      } finally {
        h.restore();
      }
    });

    it('maps Gamepad A (0) & Start (9) to consumeConfirm() and Gamepad B (1) to consumeBack()', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.setGamepad(createMockGamepad({ buttons: { 0: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeConfirm(), true);

        h.setGamepad(createMockGamepad({}));
        h.input.sample(1 / 60);
        h.setGamepad(createMockGamepad({ buttons: { 1: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeBack(), true);
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeBack(), false);

        h.setGamepad(createMockGamepad({}));
        h.input.sample(1 / 60);
        h.setGamepad(createMockGamepad({ buttons: { 9: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeConfirm(), true);
      } finally {
        h.restore();
      }
    });

    it('supports queueConfirm() programmatic confirmation independently of keyboard', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        assert.equal(h.input.consumeConfirm(), false);
        h.input.queueConfirm();
        assert.equal(h.input.consumeConfirm(), true);
        assert.equal(h.input.consumeConfirm(), false);
      } finally {
        h.restore();
      }
    });
  });

  describe('F. Simulation Purity Invariant (CLAUDE.md)', () => {
    it('contains zero three/DOM/window/document/random/clock violations across all src/sim/ files', () => {
      const { files, violations } = scanSimPurity();
      assert.ok(files.length >= 10, `Expected >=10 sim TS files, found ${files.length}`);
      assert.deepEqual(violations, [], `Sim purity violations: ${JSON.stringify(violations)}`);
    });

    it('keeps PlayerCar and World/CityWorld deterministic across identical seeds & inputs', () => {
      const { World } = mods.worldMod;
      const run = () => {
        const w = new World(7777, 0, 'suv');
        w.start();
        for (let t = 0; t < 180; t++) {
          w.step(makeInput({ throttle: 1, steer: Math.sin(t * 0.05) * 0.4 }));
        }
        return { x: w.player.x, z: w.player.z, speed: w.player.speed, heading: w.player.heading };
      };
      assert.deepEqual(run(), run());
    });
  });
});
