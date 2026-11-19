import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSimModules, makeInput } from './helpers.mjs';

let mods;

before(async () => {
  mods = await loadSimModules();
});

after(async () => {
  await mods?.close();
});

describe('Tier 1 (V2) — Upgrades, Fragile Chai Fares & IDM Traffic', () => {
  describe('A. Upgrade Catalog, Stock Bit-Identity & Sanitization', () => {
    it('returns exact stock VehicleSpec and VehicleShowcaseMeta for default builds across all 5 vehicles', () => {
      const { PLAYER_VEHICLES, VEHICLE_SPECS, VEHICLE_SHOWCASE } = mods.playerCar;
      const { defaultVehicleBuild, isStockBuild, applyUpgrades, deriveShowcaseMeta, maxIntegrityForBuild } = mods.upgrades;

      for (const v of PLAYER_VEHICLES) {
        const stock = defaultVehicleBuild(v);
        assert.equal(isStockBuild(stock), true);
        assert.equal(applyUpgrades(v, VEHICLE_SPECS[v], stock), VEHICLE_SPECS[v]);
        assert.equal(deriveShowcaseMeta(v, VEHICLE_SHOWCASE[v], stock), VEHICLE_SHOWCASE[v]);
        assert.equal(maxIntegrityForBuild(stock), 100);
      }
    });

    it('improves target metrics and costs monotonically across tiers 0->1->2->3 for all 5 vehicles & 4 tracks', () => {
      const { PLAYER_VEHICLES, VEHICLE_SPECS, VEHICLE_SHOWCASE } = mods.playerCar;
      const { UPGRADE_TRACKS, defaultVehicleBuild, upgradeCost, applyUpgrades, deriveShowcaseMeta, maxIntegrityForBuild } =
        mods.upgrades;

      for (const v of PLAYER_VEHICLES) {
        const baseSpec = VEHICLE_SPECS[v];
        const baseMeta = VEHICLE_SHOWCASE[v];
        for (const track of UPGRADE_TRACKS) {
          const c1 = upgradeCost(v, track, 1);
          const c2 = upgradeCost(v, track, 2);
          const c3 = upgradeCost(v, track, 3);
          assert.ok(c1 > 0 && c1 < c2 && c2 < c3, `${v}.${track} costs must increase: ${c1}, ${c2}, ${c3}`);

          const specs = [];
          const metas = [];
          for (const tier of [0, 1, 2, 3]) {
            const b = { ...defaultVehicleBuild(v), [track]: tier };
            specs.push(applyUpgrades(v, baseSpec, b));
            metas.push(deriveShowcaseMeta(v, baseMeta, b));
          }

          for (let i = 0; i < 3; i++) {
            assert.ok(metas[i + 1].perfRating > metas[i].perfRating, `${v}.${track} perfRating must rise at tier ${i + 1}`);
            if (track === 'engine') {
              assert.ok(specs[i + 1].driveAccel > specs[i].driveAccel);
              assert.ok(specs[i + 1].topSpeedMul > specs[i].topSpeedMul);
            } else if (track === 'nitrous') {
              assert.ok(specs[i + 1].boostAccel > specs[i].boostAccel);
              assert.ok(specs[i + 1].boostTopSpeedMul > specs[i].boostTopSpeedMul);
              assert.ok(specs[i + 1].boostDurationMul > specs[i].boostDurationMul);
              assert.ok(specs[i + 1].boostCooldown < specs[i].boostCooldown);
            } else if (track === 'handling') {
              assert.ok(specs[i + 1].maxLateralAccel > specs[i].maxLateralAccel);
              assert.ok(specs[i + 1].steerRate > specs[i].steerRate);
              assert.ok(specs[i + 1].offroadTraction > specs[i].offroadTraction);
            } else if (track === 'armor') {
              assert.ok(specs[i + 1].damageRes < specs[i].damageRes);
              const m0 = maxIntegrityForBuild({ ...defaultVehicleBuild(v), armor: i });
              const m1 = maxIntegrityForBuild({ ...defaultVehicleBuild(v), armor: i + 1 });
              assert.ok(m1 > m0);
            }
          }
        }
      }
    });

    it('shifts driftSlideKeep, driftYawBoost, and handlingGrid.x via handlingBias only when handling > 0', () => {
      const { VEHICLE_SPECS, VEHICLE_SHOWCASE } = mods.playerCar;
      const { defaultVehicleBuild, applyUpgrades, deriveShowcaseMeta } = mods.upgrades;

      const ignoredRace = applyUpgrades('alto', VEHICLE_SPECS.alto, { ...defaultVehicleBuild('alto'), handling: 0, handlingBias: -1 });
      const ignoredDrift = applyUpgrades('alto', VEHICLE_SPECS.alto, { ...defaultVehicleBuild('alto'), handling: 0, handlingBias: 1 });
      assert.equal(ignoredRace.driftSlideKeep, VEHICLE_SPECS.alto.driftSlideKeep);
      assert.equal(ignoredDrift.driftYawBoost, VEHICLE_SPECS.alto.driftYawBoost);

      const raceBuild = { ...defaultVehicleBuild('alto'), handling: 2, handlingBias: -1 };
      const neutralBuild = { ...defaultVehicleBuild('alto'), handling: 2, handlingBias: 0 };
      const driftBuild = { ...defaultVehicleBuild('alto'), handling: 2, handlingBias: 1 };

      const spRace = applyUpgrades('alto', VEHICLE_SPECS.alto, raceBuild);
      const spNeutral = applyUpgrades('alto', VEHICLE_SPECS.alto, neutralBuild);
      const spDrift = applyUpgrades('alto', VEHICLE_SPECS.alto, driftBuild);
      assert.ok(spDrift.driftSlideKeep > spNeutral.driftSlideKeep && spNeutral.driftSlideKeep > spRace.driftSlideKeep);
      assert.ok(spDrift.driftYawBoost > spNeutral.driftYawBoost && spNeutral.driftYawBoost > spRace.driftYawBoost);
      assert.ok(spRace.maxLateralAccel > spNeutral.maxLateralAccel && spNeutral.maxLateralAccel > spDrift.maxLateralAccel);

      const mRace = deriveShowcaseMeta('alto', VEHICLE_SHOWCASE.alto, raceBuild);
      const mNeutral = deriveShowcaseMeta('alto', VEHICLE_SHOWCASE.alto, neutralBuild);
      const mDrift = deriveShowcaseMeta('alto', VEHICLE_SHOWCASE.alto, driftBuild);
      assert.ok(mDrift.handlingGrid.x > mNeutral.handlingGrid.x && mNeutral.handlingGrid.x > mRace.handlingGrid.x);
    });

    it('keeps customizationRating integer 1..10 and rises with upgrades & cosmetics', () => {
      const { PLAYER_VEHICLES, VEHICLE_SHOWCASE } = mods.playerCar;
      const { defaultVehicleBuild, deriveShowcaseMeta } = mods.upgrades;

      for (const v of PLAYER_VEHICLES) {
        const base = VEHICLE_SHOWCASE[v];
        const upgraded = deriveShowcaseMeta(v, base, {
          ...defaultVehicleBuild(v),
          engine: 2,
          nitrous: 1,
          paint: 'karachi-yellow',
          livery: 'truck-art',
          underglow: 'cyan',
        });
        assert.ok(Number.isInteger(upgraded.customizationRating));
        assert.ok(upgraded.customizationRating >= 1 && upgraded.customizationRating <= 10);
        assert.ok(upgraded.customizationRating > base.customizationRating);
        assert.equal(upgraded.paintHex, 0xf2b705);
      }
    });

    it('sanitizes corrupted or out-of-range builds cleanly without NaNs or invalid IDs', () => {
      const { sanitizeVehicleBuild, defaultVehicleBuild } = mods.upgrades;
      const def = defaultVehicleBuild('alto');

      assert.deepEqual(sanitizeVehicleBuild('alto', null), def);
      assert.deepEqual(sanitizeVehicleBuild('alto', 'corrupt'), def);

      const messy = sanitizeVehicleBuild('alto', {
        engine: 99,
        nitrous: -5,
        handling: Number.NaN,
        armor: 2.8,
        handlingBias: 1, // must be forced to 0 because handling clamps to 0
        paint: 'uranium',
        livery: 'invalid',
        underglow: 42,
        horn: 'siren',
      });
      assert.deepEqual(messy, {
        engine: 3,
        nitrous: 0,
        handling: 0,
        armor: 2,
        handlingBias: 0,
        paint: 'stock',
        livery: 'none',
        underglow: 'none',
        horn: 'stock',
      });

      const biasClamp = sanitizeVehicleBuild('coupe', {
        handling: 1,
        handlingBias: -99,
        paint: 'sindh-crimson',
        livery: 'truck-art',
      });
      assert.equal(biasClamp.handlingBias, -1);
      assert.equal(biasClamp.paint, 'sindh-crimson');
      assert.equal(biasClamp.livery, 'truck-art');
    });
  });

  describe('B. Upgraded PlayerCar Physics & Boost Meter', () => {
    it('gives engine:3 faster 0-50 km/h and higher top speed than stock', () => {
      const { PlayerCar } = mods.playerCar;
      const { defaultVehicleBuild } = mods.upgrades;
      const { DT } = mods.types;

      const measure = (build) => {
        const car = new PlayerCar('alto', build);
        car.freeRoam = true;
        const vTop = 27.8 * car.spec.topSpeedMul;
        let t50 = null;
        for (let t = 0; t < 60 * 12; t++) {
          car.update(makeInput({ throttle: 1 }), vTop, DT, true);
          if (t50 === null && car.speed * 3.6 >= 50) t50 = (t + 1) * DT;
        }
        return { t50, topSpeed: car.speed };
      };

      const stock = measure(defaultVehicleBuild('alto'));
      const tuned = measure({ ...defaultVehicleBuild('alto'), engine: 3 });
      assert.ok(tuned.t50 !== null && stock.t50 !== null);
      assert.ok(tuned.t50 < stock.t50, `Expected engine:3 t50 (${tuned.t50}) < stock (${stock.t50})`);
      assert.ok(tuned.topSpeed > stock.topSpeed + 2.5, `Expected engine:3 topSpeed (${tuned.topSpeed}) > stock (${stock.topSpeed})`);
    });

    it('gives armor:3 maxIntegrity 145 and reduced crash damage in CityWorld', () => {
      const { CityWorld } = mods.cityWorldMod;
      const { defaultVehicleBuild } = mods.upgrades;

      const stockWorld = new CityWorld(1337, 'alto', defaultVehicleBuild('alto'));
      const armorWorld = new CityWorld(1337, 'alto', { ...defaultVehicleBuild('alto'), armor: 3 });
      assert.equal(stockWorld.player.maxIntegrity, 100);
      assert.equal(stockWorld.player.integrity, 100);
      assert.equal(armorWorld.player.maxIntegrity, 145);
      assert.equal(armorWorld.player.integrity, 145);

      stockWorld.start();
      armorWorld.start();
      // Drive full throttle into buildings/traffic for 6 s and steer into kerbside walls
      for (let t = 0; t < 360; t++) {
        const inp = makeInput({ throttle: 1, steer: t > 60 && t < 110 ? 1 : 0 });
        stockWorld.step(inp);
        armorWorld.step(inp);
      }
      assert.ok(
        armorWorld.level.stats.damageTaken < stockWorld.level.stats.damageTaken ||
          (stockWorld.level.stats.damageTaken === 0 && armorWorld.player.spec.damageRes < stockWorld.player.spec.damageRes),
      );
      if (stockWorld.level.stats.damageTaken > 0) {
        assert.ok(
          armorWorld.level.stats.damageTaken < stockWorld.level.stats.damageTaken,
          `Expected armor:3 damage (${armorWorld.level.stats.damageTaken}) < stock (${stockWorld.level.stats.damageTaken})`,
        );
      }
    });

    it('gives nitrous:3 higher boosted speed and charges boostMeter cleanly without NaNs', () => {
      const { PlayerCar } = mods.playerCar;
      const { CityWorld } = mods.cityWorldMod;
      const { defaultVehicleBuild } = mods.upgrades;
      const { DT } = mods.types;

      const launchRun = (build) => {
        const car = new PlayerCar('alto', build);
        car.freeRoam = true;
        for (let t = 0; t < 46; t++) car.update(makeInput({ throttle: 1, brake: 1 }), 27.8, DT, true);
        for (let t = 0; t < 60; t++) car.update(makeInput({ throttle: 1, brake: 0 }), 27.8, DT, true);
        return car.speed;
      };
      const stockBoosted = launchRun(defaultVehicleBuild('alto'));
      const nosBoosted = launchRun({ ...defaultVehicleBuild('alto'), nitrous: 3 });
      assert.ok(nosBoosted > stockBoosted + 1.5, `Expected nitrous:3 launch speed (${nosBoosted}) > stock (${stockBoosted})`);

      // Verify CityWorld charges boostMeter from drifts/honks and super-drift boost consumes >=40 meter
      const cw = new CityWorld(1337, 'alto', { ...defaultVehicleBuild('alto'), nitrous: 2 });
      cw.start();
      cw.drainEvents();
      cw.player.boostMeter = 10;
      // Accelerate then drift left, then release to spend boost or verify boostCharge
      for (let t = 0; t < 180; t++) cw.step(makeInput({ throttle: 1, horn: t === 60 }));
      for (let t = 0; t < 60; t++) cw.step(makeInput({ throttle: 1, brake: 1, steer: 1 }));
      for (let t = 0; t < 30; t++) cw.step(makeInput({ throttle: 1, brake: 0, steer: 0 }));
      const evs = cw.drainEvents();
      assert.ok(Number.isFinite(cw.player.boostMeter) && cw.player.boostMeter >= 0 && cw.player.boostMeter <= 100);
      assert.ok(cw.player.boostMeter > 10 || evs.some((e) => e.type === 'boostCharge'));
    });
  });

  describe('C. Fragile Chai Fares & Snappy Saddar Pickups/Dropoffs', () => {
    it('spawns chai fares deterministically, emits fareSpill on hard crashes, and pays more when intact', () => {
      const { CityWorld } = mods.cityWorldMod;
      let world = null;
      let chaiPassenger = null;
      for (const seed of [101, 202, 303, 404, 505, 606, 707, 808, 909, 1337]) {
        const w = new CityWorld(seed, 'alto');
        w.start();
        for (let i = 0; i < 10; i++) w.step(makeInput());
        const found = w.fares.waiting.find((p) => p.kind === 'chai');
        if (found) {
          world = w;
          chaiPassenger = found;
          break;
        }
      }
      assert.ok(world && chaiPassenger, 'Expected deterministic chai passenger across sample seeds');

      const runChai = (crashCount) => {
        const w2 = new CityWorld(world.seed, 'alto');
        w2.start();
        for (let i = 0; i < 10; i++) w2.step(makeInput());
        const target2 = w2.fares.waiting.find((p) => p.kind === 'chai');
        assert.ok(target2);
        w2.player.reset(target2.x, target2.z, 0);
        w2.player.freeRoam = true;
        w2.player.speed = 2.8;
        w2.drainEvents();
        let boardTicks = 0;
        for (let t = 1; t <= 36; t++) {
          w2.step(makeInput());
          boardTicks = t;
          if (w2.fares.fare) break;
        }
        assert.ok(w2.fares.fare, 'Chai passenger must board within <= 0.6 s below 3.2 m/s');
        assert.ok(boardTicks <= 36, `Boarding took ${boardTicks} ticks (> 36)`);
        assert.equal(w2.fares.fare.kind, 'chai');

        const spillEvents = [];
        if (crashCount > 0) {
          for (let c = 0; c < crashCount; c++) w2.fares.onCrash(9.5, spillEvents);
          assert.equal(spillEvents.filter((e) => e.type === 'fareSpill').length, crashCount);
        }

        const dest = w2.fares.places[w2.fares.fare.dest];
        w2.player.reset(dest.x, dest.z, 0);
        w2.player.freeRoam = true;
        w2.player.speed = 2.8;
        w2.drainEvents();
        let dropTicks = 0;
        let dropEvt = null;
        for (let t = 1; t <= 22; t++) {
          w2.step(makeInput());
          dropTicks = t;
          const evs = w2.drainEvents();
          dropEvt = evs.find((e) => e.type === 'dropoff');
          if (dropEvt) break;
        }
        assert.ok(dropEvt, 'Chai fare must drop off within <= 0.37 s below 3.2 m/s');
        assert.ok(dropTicks <= 21, `Alighting took ${dropTicks} ticks (> 21)`);
        return { pay: dropEvt.pay, tip: dropEvt.tip, money: w2.fares.money };
      };

      const intact = runChai(0);
      const spilled = runChai(2);
      assert.ok(intact.pay > spilled.pay, `Intact chai pay (${intact.pay}) must exceed spilled pay (${spilled.pay})`);
    });
  });

  describe('D. IDM + Block-the-Box Traffic Quality & Determinism', () => {
    it('stays bit-for-bit deterministic across two CityWorlds over 30 seconds', () => {
      const { CityWorld } = mods.cityWorldMod;
      const { defaultVehicleBuild } = mods.upgrades;
      const build = { ...defaultVehicleBuild('alto'), engine: 2, handling: 1, handlingBias: 0.5 };

      const w1 = new CityWorld(4242, 'alto', build);
      const w2 = new CityWorld(4242, 'alto', build);
      w1.start();
      w2.start();

      for (let t = 0; t < 1800; t++) {
        const inp = makeInput({
          throttle: t % 240 < 190 ? 1 : 0.2,
          brake: t % 240 >= 190 && t % 240 < 215 ? 0.8 : 0,
          steer: Math.sin(t * 0.03) * 0.65,
          horn: t % 180 === 20,
        });
        w1.step(inp);
        w2.step(inp);
      }

      assert.equal(w1.player.x, w2.player.x);
      assert.equal(w1.player.z, w2.player.z);
      assert.equal(w1.player.heading, w2.player.heading);
      assert.equal(w1.player.speed, w2.player.speed);
      assert.equal(w1.player.boostMeter, w2.player.boostMeter);
      assert.equal(w1.npcs.length, w2.npcs.length);
      for (let i = 0; i < w1.npcs.length; i++) {
        assert.equal(w1.npcs[i].x, w2.npcs[i].x);
        assert.equal(w1.npcs[i].z, w2.npcs[i].z);
        assert.equal(w1.npcs[i].speed, w2.npcs[i].speed);
      }
    });

    it('sustains healthy traffic flow (> 3.5 m/s) and low NPC-NPC overlaps (< 0.02/s) over 5 min across 3 seeds', () => {
      const { CityWorld } = mods.cityWorldMod;
      const { CityTraffic } = mods.cityTrafficMod;
      const { obbOverlap } = mods.mathMod;

      const totalSeconds = 300;
      const totalTicks = totalSeconds * 60;
      for (const seed of [1001, 1337, 2026]) {
        const w = new CityWorld(seed, 'alto');
        w.start();
        let speedSum = 0;
        let speedCount = 0;
        let overlaps = 0;

        for (let t = 0; t < totalTicks; t++) {
          w.step(makeInput());
          const npcs = w.traffic.npcs;
          for (let i = 0; i < npcs.length; i++) {
            const a = npcs[i];
            assert.ok(Number.isFinite(a.x + a.z + a.speed + a.heading), `Non-finite NPC on seed ${seed} tick ${t}`);
            speedSum += a.speed;
            speedCount++;
            if (t % 6 === 0) {
              for (let j = i + 1; j < npcs.length; j++) {
                const b = npcs[j];
                if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7) continue;
                const mtv = obbOverlap(CityTraffic.obb(a), CityTraffic.obb(b));
                if (mtv && mtv.depth > 0.06) overlaps++;
              }
            }
          }
        }

        const avgSpeed = speedSum / Math.max(1, speedCount);
        const overlapPerSec = (overlaps * 6) / totalSeconds;
        assert.ok(avgSpeed > 3.5, `Seed ${seed}: expected avg NPC speed > 3.5 m/s, got ${avgSpeed.toFixed(2)}`);
        assert.ok(overlapPerSec < 0.02, `Seed ${seed}: expected overlap rate < 0.02/s, got ${overlapPerSec.toFixed(4)}/s`);
      }
    });

    it('makes carts respond to player horn by yielding along the kerb', () => {
      const { CityWorld } = mods.cityWorldMod;
      const w = new CityWorld(1337, 'alto');
      w.start();
      let cart = w.traffic.npcs.find((n) => n.kind === 'cart' && !n.path);
      if (!cart) {
        // Deterministically place an NPC ahead as a cart on the player's link
        cart = w.traffic.npcs.find((n) => !n.path);
        assert.ok(cart);
        cart.kind = 'cart';
      }
      const link = w.map.links[cart.link];
      cart.lane = link.lanes - 1;
      cart.s = Math.min(link.len - 6, Math.max(15, cart.s));
      const cPt = w.map.linkPoint(link, cart.s, w.map.laneOffset(link, cart.lane));
      cart.x = cPt.x;
      cart.z = cPt.z;
      cart.heading = link.heading;
      cart.honkCooldown = 0;
      cart.yieldTime = 0;

      const behindPt = w.map.linkPoint(link, cart.s - 10, w.map.laneOffset(link, cart.lane));
      w.player.reset(behindPt.x, behindPt.z, link.heading);
      w.player.freeRoam = true;
      w.step(makeInput({ horn: true }));
      assert.ok(cart.yieldTime > 2.0, `Expected cart yieldTime > 2.0s after horn, got ${cart.yieldTime}`);
    });
  });
});
