import type { PlayerVehicle } from '../sim/types';

/**
 * Procedural Web Audio synth — no audio files.
 * Engine (3-cylinder 660cc buzz, raspy rickshaw, or W-11 diesel), horn, brake screech, thuds, crashes, splash.
 * The AudioContext is created/resumed on the first user gesture (unlock()).
 */

export interface EngineParams {
  /** m/s, signed */
  speed: number;
  throttle: number;
  /** current zone top speed (for gear spread) */
  topSpeed: number;
  horn: boolean;
  /** 0..1 tyre screech amount */
  screech: number;
  running: boolean;
  vehicle?: PlayerVehicle;
  monsoon?: boolean;
  /** 0..2 fare chain / speed fever level for radio intensity */
  fever?: number;
}

/** Gear upshift points as fractions of top speed (5-speed manual). */
const GEARS = [0, 0.18, 0.36, 0.56, 0.78, 1.2];

/**
 * 16-step Karachi Dholak Keherwa / Chaal rhythm:
 * 1 = Dha (bayan bass + tilli slap), 2 = Dhin (bayan bass), 3 = Ta/Na (tilli rim slap), 4 = Tin (soft rim), 0 = rest.
 */
const DHOL_STEPS = [1, 0, 4, 3, 2, 0, 3, 4, 1, 3, 0, 2, 3, 0, 4, 3] as const;

/**
 * 32-step Sindhi/Karachi Benjo (bulbul tarang) folk melody in D Mixolydian (MIDI-like Hz, 0 = sustain/rest).
 */
const BENJO_NOTES = [
  293.66, 0, 329.63, 369.99, 392.0, 0, 440.0, 392.0,
  369.99, 329.63, 293.66, 0, 261.63, 293.66, 329.63, 0,
  392.0, 0, 440.0, 523.25, 493.88, 440.0, 392.0, 369.99,
  329.63, 369.99, 329.63, 293.66, 261.63, 293.66, 293.66, 0,
] as const;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;

  // Engine voice (primary intake/crank + secondary bandpass exhaust grit).
  private engOsc1!: OscillatorNode;
  private engOsc2!: OscillatorNode;
  private engSub!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private exhaustOsc!: OscillatorNode;
  private exhaustFilter!: BiquadFilterNode;
  private exhaustGain!: GainNode;
  private rpm = 900;
  private lastGear = 1;

  // Horn voice.
  private hornGain!: GainNode;

  // Screech voice.
  private screechGain!: GainNode;

  // Wind / road noise.
  private roadGain!: GainNode;
  private roadFilter!: BiquadFilterNode;

  // Monsoon rainfall wash.
  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;

  // Procedural Karachi Dhol FM radio sequencer.
  private radioOn = true;
  private radioTimer = 0;
  private radioStep = 0;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isRadioOn(): boolean {
    return this.radioOn;
  }

  setRadio(on: boolean): void {
    this.radioOn = on;
  }

  /** Must be called from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // White noise buffer shared by noise voices.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.buildEngine(ctx);
    this.buildHorn(ctx);
    this.buildScreech(ctx);
    this.buildRoad(ctx);
    this.buildRain(ctx);
    if (ctx.state === 'suspended') void ctx.resume();
  }

  /** Pause menu: freeze all sound (engine loops included). */
  setPaused(p: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (p && ctx.state === 'running') void ctx.suspend();
    else if (!p && ctx.state === 'suspended') void ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  private loopNoise(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  private connectMaster(node: AudioNode, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = Math.max(-1, Math.min(1, pan));
    if (Math.abs(p) > 0.02 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = p;
      node.connect(panner).connect(this.master);
    } else {
      node.connect(this.master);
    }
  }

  private buildEngine(ctx: AudioContext): void {
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'triangle';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    const gSub = ctx.createGain();
    gSub.gain.value = 0.6;
    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(g2).connect(this.engFilter);
    this.engSub.connect(gSub).connect(this.engFilter);
    // Lumpy 3-cylinder idle: amplitude wobble.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(this.engGain.gain);
    this.engFilter.connect(this.engGain).connect(this.master);

    // Dual-layer exhaust rasp: bandpass-filtered harmonic growl.
    this.exhaustOsc = ctx.createOscillator();
    this.exhaustOsc.type = 'sawtooth';
    this.exhaustFilter = ctx.createBiquadFilter();
    this.exhaustFilter.type = 'bandpass';
    this.exhaustFilter.frequency.value = 280;
    this.exhaustFilter.Q.value = 2.4;
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.exhaustOsc.connect(this.exhaustFilter).connect(this.exhaustGain).connect(this.master);

    [this.engOsc1, this.engOsc2, this.engSub, lfo, this.exhaustOsc].forEach((o) => o.start());
  }

  private buildHorn(ctx: AudioContext): void {
    // Classic two-tone electric horn, slightly nasal.
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 0.8;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    for (const f of [415, 498]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(shaper);
      o.start();
    }
    shaper.connect(bp).connect(this.hornGain).connect(this.master);
  }

  private buildScreech(ctx: AudioContext): void {
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 8;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 3400;
    bp2.Q.value = 10;
    const src = this.loopNoise(ctx);
    src.connect(bp).connect(this.screechGain);
    src.connect(bp2).connect(this.screechGain);
    this.screechGain.connect(this.master);
  }

  private buildRoad(ctx: AudioContext): void {
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 400;
    this.loopNoise(ctx).connect(this.roadFilter).connect(this.roadGain).connect(this.master);
  }

  private buildRain(ctx: AudioContext): void {
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 1150;
    this.rainFilter.Q.value = 0.7;
    this.loopNoise(ctx).connect(this.rainFilter).connect(this.rainGain).connect(this.master);
  }

  /** Per-frame continuous voices. */
  update(p: EngineParams, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.abs(p.speed);

    // Fake 5-speed gearbox -> RPM.
    const ratio = v / Math.max(p.topSpeed, 1);
    let gear = 1;
    while (gear < GEARS.length - 1 && ratio > GEARS[gear]) gear++;
    const lo = GEARS[gear - 1], hi = GEARS[gear];
    const inGear = Math.min(1, Math.max(0, (ratio - lo) / (hi - lo)));
    let targetRpm = 1000 + inGear * 5200 + p.throttle * 600;
    if (v < 0.5) targetRpm = 900 + p.throttle * 2600;
    if (!p.running) targetRpm = 850;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 8);

    if (p.running && gear > this.lastGear && p.throttle > 0.35 && v > 4) {
      this.exhaustPop();
    }
    this.lastGear = p.running ? gear : 1;

    // 3 cylinders, 4-stroke: firing freq = rpm/60 * 1.5; scaled per vehicle
    const pitchMul = p.vehicle === 'minibus' ? 0.56 : p.vehicle === 'rickshaw' ? 1.18 : 1;
    const filtMul = p.vehicle === 'minibus' ? 0.65 : p.vehicle === 'rickshaw' ? 1.2 : 1;
    const fire = (this.rpm / 60) * 1.5 * pitchMul;
    this.engOsc1.frequency.setTargetAtTime(fire, t, 0.03);
    this.engOsc2.frequency.setTargetAtTime(fire * 2.01, t, 0.03);
    this.engSub.frequency.setTargetAtTime(fire / 2, t, 0.03);
    this.engFilter.frequency.setTargetAtTime((500 + this.rpm * 0.35 + p.throttle * 900) * filtMul, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.16 + p.throttle * 0.14, t, 0.05);

    const exMul = p.vehicle === 'minibus' ? 0.72 : p.vehicle === 'rickshaw' ? 1.35 : 0.95;
    this.exhaustOsc.frequency.setTargetAtTime(fire * exMul, t, 0.03);
    this.exhaustFilter.frequency.setTargetAtTime((210 + this.rpm * 0.14 + p.throttle * 340) * filtMul, t, 0.05);
    this.exhaustGain.gain.setTargetAtTime(p.running ? 0.045 + p.throttle * 0.085 : 0.025, t, 0.05);

    this.hornGain.gain.setTargetAtTime(p.horn ? 0.32 : 0, t, 0.012);
    this.screechGain.gain.setTargetAtTime(Math.min(1, p.screech) * 0.22, t, 0.04);
    this.roadGain.gain.setTargetAtTime(Math.min(0.25, v * 0.008), t, 0.1);
    this.roadFilter.frequency.setTargetAtTime(250 + v * 25, t, 0.1);

    // Monsoon rainfall wash (richer as you drive through the downpour).
    const rainLevel = p.monsoon ? (p.running ? 0.11 + Math.min(0.08, v * 0.003) : 0.07) : 0;
    this.rainGain.gain.setTargetAtTime(rainLevel, t, 0.12);
    this.rainFilter.frequency.setTargetAtTime(980 + v * 22, t, 0.12);

    // Procedural Karachi Dhol FM sequencer.
    if (this.radioOn && p.running && dt > 0) {
      this.tickRadio(dt, p.horn, p.fever ?? 0);
    }
  }

  private tickRadio(dt: number, hornActive: boolean, fever: number): void {
    const bpm = 126 + Math.min(14, fever * 4);
    const stepDur = 60 / bpm / 4; // 16th note
    this.radioTimer -= dt;
    if (this.radioTimer > 0) return;
    this.radioTimer += stepDur;
    if (this.radioTimer < 0) this.radioTimer = stepDur;

    const step = this.radioStep++;
    const duck = hornActive ? 0.42 : 1.0;
    const hit = DHOL_STEPS[step % 16];
    if (hit === 1 || hit === 2) {
      // Dholak 'Ghe' / 'Dha' bass head (warm pitch-swept membrane).
      this.thump(hit === 1 ? 122 : 104, 0.11, 0.16 * duck, -0.15);
    }
    if (hit === 1 || hit === 3) {
      // Dholak 'Na' / 'Ta' treble rim slap.
      this.dholSlap((step % 4 === 0 ? 0.11 : 0.08) * duck);
    }
    const note = BENJO_NOTES[step % BENJO_NOTES.length];
    if (note > 0) {
      this.benjoPluck(note, stepDur * 1.45, 0.065 * duck);
    }
  }

  private dholSlap(gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(270, t + 0.045);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g);
    this.connectMaster(g, 0.18);
    o.start(t);
    o.stop(t + 0.06);
    this.burst(0.038, 2100, 3.5, gain * 0.55, 'bandpass', 0.18);
  }

  private benjoPluck(freq: number, duration: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1180;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    for (const detune of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = detune < 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = detune;
      o.connect(bp);
      o.start(t);
      o.stop(t + duration + 0.02);
    }
    bp.connect(g);
    this.connectMaster(g, 0.08);
  }

  /** Rolling monsoon thunder crack and low rumble. */
  thunder(pan = 0, intensity = 1): void {
    const i = Math.max(0.3, Math.min(1, intensity));
    this.burst(0.45, 520, 0.9, 0.28 * i, 'lowpass', pan);
    this.burst(1.35, 165, 0.7, 0.42 * i, 'lowpass', pan * 0.6);
    this.thump(54, 0.95, 0.36 * i, pan * 0.5);
  }

  private exhaustPop(): void {
    this.burst(0.065, 420, 1.8, 0.2, 'bandpass');
    this.thump(95, 0.055, 0.14);
  }

  // ---- One-shots ------------------------------------------------------------

  private burst(duration: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass', pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g);
    this.connectMaster(g, pan);
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration + 0.05);
  }

  private thump(freq: number, duration: number, gain: number, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    this.connectMaster(g, pan);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  pothole(severity: number): void {
    this.thump(70, 0.25, 0.5 + severity * 0.5);
    this.burst(0.15, 600, 1, 0.3 * severity);
  }

  manhole(): void {
    this.thump(55, 0.45, 1);
    this.burst(0.3, 900, 1, 0.5);
    // Metallic clank.
    this.burst(0.25, 2400, 12, 0.4, 'bandpass');
  }

  crash(intensity: number, pan = 0): void {
    const i = Math.min(1, intensity);
    this.thump(90, 0.3, 0.6 + i * 0.4, pan);
    this.burst(0.35 + i * 0.4, 1800, 0.7, 0.5 + i * 0.5, 'lowpass', pan);
    this.burst(0.5, 3200, 14, 0.25 + i * 0.3, 'bandpass', pan); // metal ring
    this.burst(0.2, 5200, 3, 0.2 * i, 'highpass', pan); // glass tinkle
  }

  scrape(intensity: number): void {
    this.burst(0.12, 2200, 3, 0.12 + intensity * 0.15, 'bandpass');
  }

  splash(): void {
    this.burst(0.6, 1400, 0.6, 0.55);
    this.burst(0.35, 400, 1, 0.3);
  }

  /** Spatial Doppler rush when slicing fast past close traffic. */
  passingRush(pan: number, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const i = Math.max(0.2, Math.min(1, intensity));
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(980, t);
    f.frequency.exponentialRampToValueAtTime(340, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.14 * i, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f).connect(g);
    this.connectMaster(g, pan);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.22);
  }

  /** Brief spatial horn reply from nearby Karachi traffic. */
  npcHorn(pan: number, pitchScale = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1250;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.015);
    g.gain.setValueAtTime(0.11, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    for (const freq of [390 * pitchScale, 468 * pitchScale]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.17);
    }
    bp.connect(g);
    this.connectMaster(g, pan);
  }

  chime(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.12 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.5);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.6);
    });
  }

  /** Celebratory ascending triad for VIP fares, Fever chains, and A/S ranks. */
  fanfare(tier = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = tier >= 2 ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 880, 1174.66];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.42);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.48);
    });
  }

  /** Boost: a rising whoosh plus a low turbo thump. */
  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.65);
    this.thump(110, 0.25, 0.35);
  }

  /** Something knocked flying: wood / plastic clatter, or a hollow drum bonk. */
  smash(kind: string, intensity: number, pan = 0): void {
    const i = Math.min(1, intensity);
    if (kind === 'drum') {
      this.thump(140, 0.35, 0.5 + i * 0.3, pan);
      this.burst(0.2, 900, 4, 0.2, 'bandpass', pan);
    } else if (kind === 'cone' || kind === 'chair') {
      this.burst(0.12, 1600, 3, 0.25 + i * 0.2, 'bandpass', pan);
      this.thump(220, 0.08, 0.2, pan);
    } else {
      this.thump(95, 0.22, 0.45 + i * 0.3, pan);
      this.burst(0.3, 1200, 1.2, 0.35 + i * 0.3, 'lowpass', pan);
      this.burst(0.18, 2600, 6, 0.2, 'bandpass', pan);
    }
  }

  /** Short rising blip; pitch climbs with the combo multiplier. */
  stunt(mult: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f0 = 520 * Math.pow(1.12, Math.min(8, mult) - 1);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Countdown tick for the final seconds of a fare or checkpoint timer. */
  timerTick(urgent: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(urgent ? 1040 : 780, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(urgent ? 0.11 : 0.07, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }
}
