export const ENGINE_WORKLET_PROCESSOR_NAME = 'kt3d-engine-processor';

/**
 * Self-contained AudioWorkletProcessor JavaScript module loaded via Blob URL.
 * Zero allocations inside process(), unconditional SVF stability across all sample rates,
 * DC blocker, and soft limiter.
 */
export const ENGINE_WORKLET_SOURCE = `
class Kt3dEngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 500, maxValue: 9500, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'profile', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'upgradeTier', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'boost', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'running', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.phaseSub = 0;
    this.lopePhase = 0;
    this.turboPhase = 0;
    this.rng = 0x13579bdf;

    // Body lowpass SVF
    this.lpLow = 0;
    this.lpBand = 0;
    // Exhaust bandpass SVF
    this.exLow = 0;
    this.exBand = 0;
    // Intake air bandpass SVF
    this.inLow = 0;
    this.inBand = 0;
    // Exhaust pop envelope & oscillator
    this.popEnv = 0;
    this.popPhase = 0;
    // DC blocker
    this.dcPrevX = 0;
    this.dcPrevY = 0;
    // Smoothed controls
    this.sRpm = 900;
    this.sThr = 0;
    this.sLoad = 0;
    this.sBoost = 0;
    this.sRun = 0;
    this.sGain = 0;

    if (this.port) {
      this.port.onmessage = (ev) => {
        const d = ev && ev.data;
        if (d && d.type === 'pop') {
          const v = Number(d.intensity);
          const clamped = Number.isFinite(v) ? (v < 0.2 ? 0.2 : v > 1 ? 1 : v) : 0.7;
          if (clamped > this.popEnv) this.popEnv = clamped;
        }
      };
    }
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const ch0 = out[0];
    const n = ch0.length;
    const sr = typeof sampleRate === 'number' && sampleRate > 8000 ? sampleRate : 48000;
    const invSr = 1 / sr;

    const rpmTarget = parameters.rpm[0];
    const thrTarget = parameters.throttle[0];
    const loadTarget = parameters.load[0];
    const pIdxRaw = Math.round(parameters.profile[0]);
    const pIdx = pIdxRaw < 0 ? 0 : pIdxRaw > 4 ? 4 : pIdxRaw;
    const tierRaw = parameters.upgradeTier[0];
    const tier = tierRaw < 0 ? 0 : tierRaw > 3 ? 3 : tierRaw;
    const boostTarget = parameters.boost[0];
    const runTarget = parameters.running[0];
    const gainTarget = parameters.gain[0];

    // Acoustic profile constants matching ENGINE_PROFILES in engineDspMath.ts:
    // [cylRatio, pitchMul, filtMul, exMul, idleLopeHz, turboBaseHz, raspMix, subMix, gritDrive]
    let cylRatio = 1.5;
    let pitchMul = 1.0;
    let filtMul = 1.0;
    let exMul = 0.95;
    let lopeHz = 11.2;
    let turboBase = 0;
    let raspMix = 0.32;
    let subMix = 0.62;
    let gritDrive = 1.5;

    if (pIdx === 1) {
      cylRatio = 4.0; pitchMul = 0.78; filtMul = 0.88; exMul = 1.25; lopeHz = 8.2; turboBase = 0; raspMix = 0.58; subMix = 0.78; gritDrive = 2.3;
    } else if (pIdx === 2) {
      cylRatio = 1.0; pitchMul = 1.18; filtMul = 1.22; exMul = 1.35; lopeHz = 12.5; turboBase = 0; raspMix = 0.75; subMix = 0.32; gritDrive = 2.6;
    } else if (pIdx === 3) {
      cylRatio = 2.0; pitchMul = 0.68; filtMul = 0.78; exMul = 1.05; lopeHz = 9.0; turboBase = 2400; raspMix = 0.42; subMix = 0.82; gritDrive = 1.8;
    } else if (pIdx === 4) {
      cylRatio = 3.0; pitchMul = 0.56; filtMul = 0.66; exMul = 0.74; lopeHz = 7.0; turboBase = 1850; raspMix = 0.38; subMix = 0.92; gritDrive = 1.9;
    }

    const tierDriveBoost = 1 + tier * 0.28;
    const smoothK = 1 - Math.exp(-invSr * 45);
    const maxFc = sr * 0.40;
    const popDecay = Math.exp(-invSr * 26);

    for (let i = 0; i < n; i++) {
      this.sRpm += (rpmTarget - this.sRpm) * smoothK;
      this.sThr += (thrTarget - this.sThr) * smoothK;
      this.sLoad += (loadTarget - this.sLoad) * smoothK;
      this.sBoost += (boostTarget - this.sBoost) * smoothK;
      this.sRun += (runTarget - this.sRun) * smoothK;
      this.sGain += (gainTarget - this.sGain) * smoothK;

      const fireHz = (this.sRpm * (1 / 60)) * cylRatio * pitchMul;
      const clampedFire = fireHz < 12 ? 12 : fireHz > 950 ? 950 : fireHz;
      this.phase += clampedFire * invSr;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);

      this.phaseSub += clampedFire * 0.5 * exMul * invSr;
      if (this.phaseSub >= 1) this.phaseSub -= Math.floor(this.phaseSub);

      this.lopePhase += lopeHz * invSr;
      if (this.lopePhase >= 1) this.lopePhase -= Math.floor(this.lopePhase);

      // Xorshift32 noise in -1..1
      let r = this.rng | 0;
      r ^= r << 13;
      r ^= r >>> 17;
      r ^= r << 5;
      this.rng = r;
      const white = (r >>> 0) * (2 / 4294967295) - 1;

      // Idle 3-cylinder / diesel lumpy pulse
      const rpmNorm = (this.sRpm - 650) / 5000;
      const idleAmt = rpmNorm < 0 ? 1 : rpmNorm > 0.25 ? 0 : 1 - rpmNorm * 4;
      const lope = 1 + Math.sin(this.lopePhase * 6.2831853) * 0.18 * idleAmt;

      // Saw + shaped triangle crank core + V8/2-stroke harmonic asymmetry
      const p1 = this.phase;
      const saw = p1 * 2 - 1;
      const p2 = p1 * 2;
      const ph2 = p2 - Math.floor(p2);
      const tri2 = ph2 < 0.5 ? ph2 * 4 - 1 : 3 - ph2 * 4;
      const subTri = this.phaseSub < 0.5 ? this.phaseSub * 4 - 1 : 3 - this.phaseSub * 4;
      const subHarm = subTri * subMix + Math.sin(this.phaseSub * 12.56637) * 0.14 * (pIdx === 1 ? 1.5 : 1.0);
      const harmonic = saw * 0.55 + tri2 * (pIdx === 2 ? 0.42 : 0.22) + subHarm * 0.48;

      // Soft waveshaper exhaust grit scaled by throttle & upgrade tier
      const drive = gritDrive * tierDriveBoost * (0.7 + this.sThr * 0.9 + this.sLoad * 0.4);
      const xDrv = harmonic * drive;
      const xDrv2 = xDrv * xDrv;
      const saturated = (xDrv * (27 + xDrv2)) / (27 + 9 * xDrv2);

      // Chamberlin lowpass SVF on engine crank body
      const bodyFcRaw = (240 + this.sRpm * 0.145 + this.sThr * 340 + tier * 85) * filtMul;
      const bodyFc = bodyFcRaw < 60 ? 60 : bodyFcRaw > maxFc ? maxFc : bodyFcRaw;
      const fBody = Math.min(0.85, 2 * Math.sin(Math.PI * bodyFc * invSr));
      this.lpLow += fBody * this.lpBand;
      const lpHigh = harmonic - this.lpLow - 0.85 * this.lpBand;
      this.lpBand += fBody * lpHigh;

      // Exhaust bandpass SVF
      const exFcRaw = (195 + this.sRpm * 0.11 + this.sThr * 280 + tier * 70) * filtMul;
      const exFc = exFcRaw < 80 ? 80 : exFcRaw > maxFc ? maxFc : exFcRaw;
      const fEx = Math.min(0.85, 2 * Math.sin(Math.PI * exFc * invSr));
      this.exLow += fEx * this.exBand;
      const exHigh = saturated - this.exLow - 0.72 * this.exBand;
      this.exBand += fEx * exHigh;

      // Intake air noise bandpass SVF
      const inFcRaw = (320 + this.sRpm * 0.12 + this.sThr * 520 + this.sBoost * 650) * filtMul;
      const inFc = inFcRaw < 120 ? 120 : inFcRaw > maxFc ? maxFc : inFcRaw;
      const fIn = Math.min(0.85, 2 * Math.sin(Math.PI * inFc * invSr));
      this.inLow += fIn * this.inBand;
      const inHigh = white - this.inLow - 0.85 * this.inBand;
      this.inBand += fIn * inHigh;

      // Turbo / supercharger spool whistle (SUV/Minibus diesels or upgraded >= tier 2 or nitrous boost)
      let turboSig = 0;
      const effectiveTurbo = turboBase > 0 ? turboBase : (tier >= 2 ? 2200 + tier * 350 : 0);
      if (effectiveTurbo > 0 || this.sBoost > 0.02) {
        const tFreq = (effectiveTurbo || 2600) * (0.45 + Math.max(0, (this.sRpm - 1400) / 5500) * 0.75 + this.sBoost * 0.25);
        this.turboPhase += Math.min(tFreq, maxFc) * invSr;
        if (this.turboPhase >= 1) this.turboPhase -= Math.floor(this.turboPhase);
        const spoolGain = (effectiveTurbo > 0 ? (0.02 + this.sThr * 0.035) * Math.min(1, Math.max(0, (this.sRpm - 1300) / 2600)) : 0) + this.sBoost * 0.075;
        turboSig = Math.sin(this.turboPhase * 6.2831853) * spoolGain;
      }

      // Shift / lift-off exhaust pop impulse
      let popSig = 0;
      if (this.popEnv > 0.002) {
        this.popPhase += (105 + this.popEnv * 75) * invSr;
        if (this.popPhase >= 1) this.popPhase -= Math.floor(this.popPhase);
        popSig = (Math.sin(this.popPhase * 6.2831853) * 0.55 + white * 0.45) * this.popEnv * 0.28;
        this.popEnv *= popDecay;
      } else {
        this.popEnv = 0;
      }

      const bodyGain = 0.14 + this.sThr * 0.12 + this.sRun * 0.06;
      const exGain = (0.06 + this.sThr * 0.10 + tier * 0.02) * raspMix * 1.4;
      const inGain = (0.02 + this.sThr * 0.075 + this.sBoost * 0.055) * (0.5 + this.sRun * 0.5);

      let mix = (this.lpLow * bodyGain + this.exBand * exGain) * lope + this.inBand * inGain + turboSig + popSig;
      mix *= this.sGain;

      // 1-pole DC blocker
      const dcOut = mix - this.dcPrevX + 0.995 * this.dcPrevY;
      this.dcPrevX = mix;
      this.dcPrevY = dcOut;

      // Padé tanh soft limiter in -1..1
      const c2 = dcOut * dcOut;
      const limited = (dcOut * (27 + c2)) / (27 + 9 * c2);
      const safe = Number.isFinite(limited) ? (limited < -1 ? -1 : limited > 1 ? 1 : limited) : 0;

      if (!Number.isFinite(this.lpLow) || !Number.isFinite(this.exBand) || !Number.isFinite(this.inBand)) {
        this.lpLow = 0; this.lpBand = 0;
        this.exLow = 0; this.exBand = 0;
        this.inLow = 0; this.inBand = 0;
        this.dcPrevX = 0; this.dcPrevY = 0;
      }

      ch0[i] = safe;
    }

    for (let c = 1; c < out.length; c++) {
      out[c].set(ch0);
    }
    return true;
  }
}

registerProcessor('${ENGINE_WORKLET_PROCESSOR_NAME}', Kt3dEngineProcessor);
`;
