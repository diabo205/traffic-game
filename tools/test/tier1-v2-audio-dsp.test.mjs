import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadSimModules } from './helpers.mjs';

let mods;
let dspMod;
let workletMod;

before(async () => {
  mods = await loadSimModules();
  dspMod = await mods.server.ssrLoadModule('/src/audio/engineDspMath.ts');
  workletMod = await mods.server.ssrLoadModule('/src/audio/engineWorkletSource.ts');
});

after(async () => {
  await mods?.close();
});

function createWorkletInstance() {
  let RegisteredCtor = null;
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  }
  const sandbox = {
    sampleRate: 48000,
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor(_name, ctor) {
      RegisteredCtor = ctor;
    },
    Math,
    Number,
    Float32Array,
  };
  vm.runInNewContext(workletMod.ENGINE_WORKLET_SOURCE, sandbox);
  assert.ok(RegisteredCtor, 'Expected ENGINE_WORKLET_SOURCE to call registerProcessor');
  return new RegisteredCtor();
}

function makeParams({
  rpm = 2400,
  throttle = 0.75,
  load = 0.5,
  profile = 0,
  upgradeTier = 0,
  boost = 0,
  running = 1,
  gain = 0.85,
} = {}) {
  return {
    rpm: new Float32Array([rpm]),
    throttle: new Float32Array([throttle]),
    load: new Float32Array([load]),
    profile: new Float32Array([profile]),
    upgradeTier: new Float32Array([upgradeTier]),
    boost: new Float32Array([boost]),
    running: new Float32Array([running]),
    gain: new Float32Array([gain]),
  };
}

describe('Tier 1 (V2 M3) — AudioWorklet Engine DSP, Doppler Traffic, Horns & Karachi FM', () => {
  it('computeGearboxRpm advances 1..5 monotonically across all 5 vehicles and detects pops/upgrades cleanly', () => {
    const { PLAYER_VEHICLES } = mods.playerCar;
    const { computeGearboxRpm, ENGINE_PROFILES } = dspMod;

    for (const v of PLAYER_VEHICLES) {
      const prof = ENGINE_PROFILES[v];
      let prevGear = 1;
      for (const frac of [0.05, 0.25, 0.45, 0.65, 0.9]) {
        const res = computeGearboxRpm(prof.idleRpm, prevGear, 0.5, frac * 30, 0.85, 30, true, 1 / 60, v, 0);
        assert.ok(res.gear >= prevGear && res.gear <= 5, `${v}: expected gear >= ${prevGear}, got ${res.gear}`);
        assert.ok(Number.isFinite(res.rpm) && res.rpm >= prof.idleRpm * 0.85);
        prevGear = res.gear;
      }
      assert.equal(prevGear, 5, `${v}: expected top gear 5 at 90% speed`);

      // Engine tier 3 raises peak RPM ceiling compared to stock tier 0
      const stockRpm = computeGearboxRpm(prof.redlineRpm * 0.8, 4, 0.9, 28, 1.0, 30, true, 0.1, v, 0).rpm;
      const tier3Rpm = computeGearboxRpm(prof.redlineRpm * 0.8, 4, 0.9, 28, 1.0, 30, true, 0.1, v, 3).rpm;
      assert.ok(tier3Rpm > stockRpm, `${v}: tier3 RPM (${tier3Rpm}) should exceed stock (${stockRpm})`);

      // Upshift and lift-off pop detection
      const upshift = computeGearboxRpm(3600, 2, 0.8, 14, 0.9, 30, true, 1 / 60, v, 0);
      assert.equal(upshift.shiftedUp, true, `${v}: expected shiftedUp on gear 2->3 jump`);

      const liftOff = computeGearboxRpm(prof.redlineRpm * 0.72, 3, 0.9, 20, 0.0, 30, true, 1 / 60, v, 0);
      assert.equal(liftOff.liftOffPop, true, `${v}: expected liftOffPop on sharp throttle release at high RPM`);

      // Zero, reverse, NaN, and oversized dt safety
      for (const bad of [
        computeGearboxRpm(NaN, 1, 0, -12, 0.5, 30, true, 5.0, v, 0),
        computeGearboxRpm(1000, 1, 0, 0, 0, 0, false, NaN, v, 0),
      ]) {
        assert.ok(Number.isFinite(bad.rpm) && bad.gear >= 1 && bad.gear <= 5);
      }
    }
  });

  it('executes AudioWorklet Kt3dEngineProcessor cleanly across all 5 profiles, upgrade tiers, boosts & pops', () => {
    const profileSignatures = [];

    for (let profile = 0; profile <= 4; profile++) {
      const proc = createWorkletInstance();
      const chL = new Float32Array(128);
      const chR = new Float32Array(128);
      let sumSq = 0;
      let sum = 0;
      let zcr = 0;
      let prevSign = 1;
      let sampleCount = 0;

      for (let q = 0; q < 200; q++) {
        if (q === 60 && proc.port.onmessage) {
          proc.port.onmessage({ data: { type: 'pop', intensity: 0.9 } });
        }
        const upgradeTier = Math.floor(q / 50); // sweeps 0, 1, 2, 3
        const boost = q >= 120 && q < 160 ? 1 : 0;
        const rpm = 1400 + q * 22;
        const params = makeParams({ rpm, throttle: 0.8, load: 0.65, profile, upgradeTier, boost, running: 1, gain: 0.85 });

        const keepAlive = proc.process([], [[chL, chR]], params);
        assert.equal(keepAlive, true);

        for (let i = 0; i < 128; i++) {
          const s = chL[i];
          assert.ok(Number.isFinite(s), `profile=${profile} q=${q} i=${i}: non-finite sample`);
          assert.ok(s >= -1 && s <= 1, `profile=${profile} q=${q} i=${i}: clipped sample ${s}`);
          assert.equal(chR[i], s, 'stereo channels should stay locked');
          sum += s;
          sumSq += s * s;
          const sign = s >= 0 ? 1 : -1;
          if (sign !== prevSign) zcr++;
          prevSign = sign;
          sampleCount++;
        }
      }

      const rms = Math.sqrt(sumSq / sampleCount);
      const mean = sum / sampleCount;
      assert.ok(rms > 0.005, `profile=${profile}: RMS too low (${rms})`);
      assert.ok(Math.abs(mean) < 0.03, `profile=${profile}: excessive DC offset (${mean})`);
      profileSignatures.push({ profile, rms, zcr });
    }

    // Distinct vehicle families (e.g., high-buzz rickshaw vs deep minibus) must show distinct zero-crossing rates
    const zcrs = profileSignatures.map((p) => p.zcr);
    const minZcr = Math.min(...zcrs);
    const maxZcr = Math.max(...zcrs);
    assert.ok(maxZcr > minZcr * 1.25, `Expected distinct spectral ZCR across profiles, got ${JSON.stringify(profileSignatures)}`);
  });

  it('computes accurate Doppler pitch shift, stereo pan, distance cutoff, and slot hysteresis', () => {
    const { computeDopplerVoice, selectSpatialTrafficSlots, MAX_SPATIAL_DIST } = dspMod;

    // Approaching head-on on +z axis raises pitch (> 1.05); receding lowers pitch (< 0.95)
    const approach = computeDopplerVoice(0, 0, 0, 0, 15, 0, 8, 0, -10, 'truck');
    assert.equal(approach.active, true);
    assert.ok(approach.dopplerRatio > 1.05, `Expected approaching doppler > 1.05, got ${approach.dopplerRatio}`);

    const recede = computeDopplerVoice(0, 0, 0, 0, -15, 0, 8, 0, 10, 'truck');
    assert.ok(recede.dopplerRatio < 0.95, `Expected receding doppler < 0.95, got ${recede.dopplerRatio}`);

    // Sim +x right => positive pan; -x left => negative pan
    const right = computeDopplerVoice(0, 0, 0, 0, 0, 4, 4, 0, 0, 'car');
    const left = computeDopplerVoice(0, 0, 0, 0, 0, -4, 4, 0, 0, 'car');
    assert.ok(right.pan > 0.3 && left.pan < -0.3);

    // Distance > MAX_SPATIAL_DIST is silent
    const far = computeDopplerVoice(0, 0, 0, 0, 0, 0, MAX_SPATIAL_DIST + 2, 0, 0, 'minibus');
    assert.equal(far.active, false);
    assert.equal(far.gain, 0);

    // Co-located dist = 0 must remain NaN-free
    const zero = computeDopplerVoice(10, 20, 0.5, 5, 5, 10, 20, 5, 5, 'bike');
    assert.ok(Number.isFinite(zero.dopplerRatio) && Number.isFinite(zero.pan) && Number.isFinite(zero.gain));

    // Slot hysteresis keeps active vehicle ID in its existing slot even against slightly closer newcomer
    const npcs = [
      { id: 10, kind: 'car', variant: 0, x: 3, z: 6.2, prevX: 3, prevZ: 6.0, heading: 0, prevHeading: 0, dir: 1, latVel: 0, brakeLights: false, hazardLights: false },
      { id: 20, kind: 'car', variant: 1, x: -3, z: 6.1, prevX: -3, prevZ: 5.9, heading: 0, prevHeading: 0, dir: 1, latVel: 0, brakeLights: false, hazardLights: false },
    ];
    const slots = selectSpatialTrafficSlots(npcs, 0, 0, 0, 0, 0, 1 / 60, 1, [10]);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].id, 10, 'Hysteresis must retain slot owner id=10');
    assert.equal(slots[0].slot, 0);
  });

  it('defines valid HORN_SEQUENCES for every HORN_CATALOG entry and valid RADIO_STATIONS patterns', () => {
    const { HORN_CATALOG } = mods.upgrades;
    const { HORN_SEQUENCES, RADIO_STATIONS, RADIO_STATION_ORDER } = dspMod;

    for (const item of HORN_CATALOG) {
      const def = HORN_SEQUENCES[item.id];
      assert.ok(def, `Missing HORN_SEQUENCES definition for ${item.id}`);
      assert.ok(Array.isArray(def.steps) && def.steps.length >= 1, `${item.id}: missing horn steps`);
      for (const s of def.steps) {
        assert.ok(s.dur > 0 && s.freqs.length === 3 && s.gain >= 0);
      }
    }

    assert.deepEqual([...RADIO_STATION_ORDER], ['dhol', 'lyari', 'clifton', 'off']);
    for (const id of ['dhol', 'lyari', 'clifton']) {
      const st = RADIO_STATIONS[id];
      assert.ok(st && st.rhythm.length >= 16 && st.melody.length >= 16, `${id}: invalid station patterns`);
      assert.ok(st.baseBpm > 60 && st.maxFeverBpm >= st.baseBpm);
    }
    assert.equal(RADIO_STATIONS.off.rhythm.length, 0);
  });
});
