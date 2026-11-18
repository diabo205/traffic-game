import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInputHarness,
  createMockGamepad,
  loadSimModules,
  makeInput,
} from './helpers.mjs';

const VEHICLES = ['alto', 'coupe', 'rickshaw', 'suv', 'minibus'];
const TIME_OF_DAY_WEATHERS = [
  { tod: 'noon', weather: 'clear' },
  { tod: 'sunset', weather: 'clear' },
  { tod: 'night', weather: 'clear' },
  { tod: 'monsoon', weather: 'monsoon' },
];
const MODES = ['route', 'city'];

let mods;

before(async () => {
  mods = await loadSimModules();
});

after(async () => {
  await mods?.close();
});

describe('Tier 3 — Cross-Feature Pairwise Combinations (Weather × Vehicle × Mode & Multi-Source Input)', () => {
  describe('A. Pairwise Matrix: TimeOfDay/Weather × Vehicle × Mode', () => {
    for (const { tod, weather } of TIME_OF_DAY_WEATHERS) {
      for (const vehicle of VEHICLES) {
        for (const mode of MODES) {
          it(`simulates ${tod} (${weather}) × ${vehicle} × ${mode} cleanly without NaN/Inf and with valid phase progression`, () => {
            const { World } = mods.worldMod;
            const { CityWorld } = mods.cityWorldMod;
            const world = mode === 'route' ? new World(1337, 0, vehicle) : new CityWorld(1337, vehicle);
            world.weather = weather;

            assert.equal(world.phase, 'ready');
            assert.equal(world.player.vehicle, vehicle);

            world.start();
            assert.equal(world.phase, 'running');
            const startEvents = world.drainEvents();
            assert.ok(startEvents.some((e) => e.type === 'zone'), `${mode} start should emit zone banner`);

            for (let t = 0; t < 180; t++) {
              const steer = t > 90 && t < 130 ? 0.35 : 0;
              world.step(makeInput({ throttle: 1, steer }));
              const p = world.player;
              assert.ok(
                Number.isFinite(p.x) &&
                  Number.isFinite(p.z) &&
                  Number.isFinite(p.y) &&
                  Number.isFinite(p.speed) &&
                  Number.isFinite(p.heading) &&
                  Number.isFinite(p.integrity),
                `${tod}/${vehicle}/${mode} non-finite state at tick ${t}`,
              );
            }
            assert.ok(world.player.speed > 5, `${tod}/${vehicle}/${mode} should accelerate cleanly`);
          });
        }
      }
    }
  });

  describe('B. Monsoon vs Clear Traction Penalty & City vs Route Differentiation', () => {
    for (const vehicle of VEHICLES) {
      it(`applies monsoon traction penalty (< clear) in both route and city modes for ${vehicle}`, () => {
        const { World } = mods.worldMod;
        const { CityWorld } = mods.cityWorldMod;

        const runRouteTurn = (weather) => {
          const w = new World(404, 1200, vehicle);
          w.weather = weather;
          w.start();
          for (let t = 0; t < 120; t++) w.step(makeInput({ throttle: 1 }));
          for (let t = 0; t < 20; t++) w.step(makeInput({ throttle: 1, steer: 1 }));
          return Math.abs(w.player.heading - w.player.travel);
        };
        const clearRouteSlip = runRouteTurn('clear');
        const monsoonRouteSlip = runRouteTurn('monsoon');
        assert.ok(
          monsoonRouteSlip > clearRouteSlip,
          `${vehicle} route monsoon slip (${monsoonRouteSlip.toFixed(4)}) should exceed clear (${clearRouteSlip.toFixed(4)})`,
        );

        const runCityTurn = (weather) => {
          const w = new CityWorld(404, vehicle);
          w.weather = weather;
          w.start();
          for (let t = 0; t < 80; t++) w.step(makeInput({ throttle: 1 }));
          for (let t = 0; t < 15; t++) w.step(makeInput({ throttle: 1, steer: 1 }));
          return Math.abs(w.player.heading - w.player.travel);
        };
        const clearCitySlip = runCityTurn('clear');
        const monsoonCitySlip = runCityTurn('monsoon');
        assert.ok(
          monsoonCitySlip > clearCitySlip,
          `${vehicle} city monsoon slip (${monsoonCitySlip.toFixed(4)}) must exceed clear (${clearCitySlip.toFixed(4)})`,
        );
      });
    }

    it('preserves route expressway vs city top-speed differential and drift/boost differentiation across modes', () => {
      const { World } = mods.worldMod;
      const { CityWorld } = mods.cityWorldMod;
      const { VEHICLE_SPECS } = mods.playerCar;

      for (const vehicle of VEHICLES) {
        const routeWorld = new World(505, 1500, vehicle); // Lyari Expressway (36.1 base)
        const cityWorld = new CityWorld(505, vehicle); // Saddar (27.8 base)
        assert.ok(
          routeWorld.topSpeed() > cityWorld.topSpeed(),
          `${vehicle} expressway topSpeed (${routeWorld.topSpeed()}) must exceed city (${cityWorld.topSpeed()})`,
        );
        assert.ok(
          Math.abs(routeWorld.topSpeed() - 36.1 * VEHICLE_SPECS[vehicle].topSpeedMul) < 0.1,
          `${vehicle} route topSpeed must scale by topSpeedMul`,
        );
      }

      // Cross-mode drift & boost differentiation: coupe vs minibus in CityWorld
      const measureCityDriftSlip = (vehicle) => {
        const w = new CityWorld(404, vehicle);
        w.start();
        for (let t = 0; t < 90; t++) w.step(makeInput({ throttle: 1 }));
        for (let t = 0; t < 35; t++) w.step(makeInput({ throttle: 1, brake: 1, steer: 0.85 }));
        return Math.abs(w.player.heading - w.player.travel);
      };
      const coupeDriftSlip = measureCityDriftSlip('coupe');
      const minibusDriftSlip = measureCityDriftSlip('minibus');
      assert.ok(
        coupeDriftSlip > minibusDriftSlip,
        `CityWorld coupe drift slip (${coupeDriftSlip.toFixed(4)}) must exceed minibus (${minibusDriftSlip.toFixed(4)})`,
      );

      // Cross-mode launch boost speed differentiation: coupe vs alto in CityWorld
      const measureCityLaunch = (vehicle) => {
        const w = new CityWorld(404, vehicle);
        w.start();
        for (let t = 0; t < 46; t++) w.step(makeInput({ throttle: 1, brake: 1 }));
        w.step(makeInput({ throttle: 1, brake: 0 }));
        for (let t = 0; t < 45; t++) w.step(makeInput({ throttle: 1 }));
        return w.player.speed;
      };
      assert.ok(
        measureCityLaunch('coupe') > measureCityLaunch('alto'),
        'CityWorld coupe launch speed must exceed alto',
      );
    });
  });

  describe('C. Combined Keyboard + Gamepad + Touch InputManager Transitions', () => {
    it('allows Gamepad D-Pad navigation followed by Keyboard Enter confirmation without conflict', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.setGamepad(createMockGamepad({ buttons: { 15: true } }));
        h.input.sample(1 / 60);
        assert.equal(h.input.consumeMenuNav(), 1);
        assert.equal(h.input.lastSource, 'gamepad');

        h.tapKey('Enter');
        assert.equal(h.input.consumeConfirm(), true);
        assert.equal(h.input.lastSource, 'keyboard');
      } finally {
        h.restore();
      }
    });

    it('allows Keyboard navigation followed by Gamepad B back without triggering driving steer or pause', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        h.tapKey('ArrowLeft');
        assert.equal(h.input.consumeMenuNav(), -1);

        h.setGamepad(createMockGamepad({ buttons: { 1: true } }));
        const frame = h.input.sample(1 / 60);
        assert.equal(h.input.consumeBack(), true);
        assert.equal(h.input.consumePause(), false, 'Gamepad B must not trigger pause');

        // Release gamepad B before entering driving mode
        h.setGamepad(createMockGamepad({}));
        const nextFrame = h.input.sample(1 / 60);
        assert.equal(nextFrame.throttle, 0);
        assert.equal(nextFrame.brake, 0);
        assert.equal(nextFrame.steer, 0);
        assert.ok(Number.isFinite(frame.throttle));
      } finally {
        h.restore();
      }
    });

    it('merges touch + keyboard + gamepad driving frames cleanly after menu exit', () => {
      const h = createInputHarness(mods.inputMod.InputManager);
      try {
        // Confirm via touch button queueConfirm() + release keys
        h.input.queueConfirm();
        assert.equal(h.input.consumeConfirm(), true);
        h.input.touch.gas = true;
        h.pressKey('KeyA');
        let frame;
        for (let i = 0; i < 15; i++) frame = h.input.sample(1 / 60);
        assert.equal(frame.throttle, 1);
        assert.ok(frame.steer < -0.5, `Expected negative steer from KeyA, got ${frame.steer}`);
        assert.equal(h.input.lastSource, 'touch');
      } finally {
        h.restore();
      }
    });
  });
});
