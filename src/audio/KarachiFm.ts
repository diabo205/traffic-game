import { RADIO_STATIONS, RADIO_STATION_ORDER } from './engineDspMath';
import type { RadioStationId } from './engineDspMath';

/**
 * Multi-station procedural Karachi FM synthesizer:
 *   - `dhol`:    FM 101 · Dholak Keherwa + Sindhi Benjo melody + fever ghungroo
 *   - `lyari`:   FM 104 · Lyari Beats (808 kick/snare/hat + E Bhairavi coastal groove)
 *   - `clifton`: FM 98  · Clifton Night Cruise (warm synthwave arp + glassy bell + tabla)
 *   - `off`:     Silent
 */
export class KarachiFm {
  private station: RadioStationId = 'dhol';
  private timer = 0;
  private step = 0;
  private lastDucked = false;

  private readonly bus: GainNode;
  private readonly fmFilter: BiquadFilterNode;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly sharedNoise: AudioBuffer,
    initialStation: RadioStationId = 'dhol',
  ) {
    this.station = initialStation;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;

    this.fmFilter = ctx.createBiquadFilter();
    this.fmFilter.type = 'lowpass';
    this.fmFilter.frequency.value = 5400;
    this.fmFilter.Q.value = 0.65;

    this.bus.connect(this.fmFilter).connect(dest);
  }

  getStation(): RadioStationId {
    return this.station;
  }

  isOn(): boolean {
    return this.station !== 'off';
  }

  setStation(id: RadioStationId, playStatic = false): void {
    const changed = this.station !== id;
    this.station = id;
    this.timer = 0;
    this.step = 0;
    if (changed && playStatic && this.ctx.state === 'running') {
      this.staticBurst();
    }
  }

  cycleStation(): RadioStationId {
    const idx = RADIO_STATION_ORDER.indexOf(this.station);
    const next = RADIO_STATION_ORDER[(idx + 1) % RADIO_STATION_ORDER.length];
    this.setStation(next, true);
    return next;
  }

  private connectBus(node: AudioNode, pan = 0): void {
    const p = Math.max(-1, Math.min(1, pan));
    if (Math.abs(p) > 0.02 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = p;
      node.connect(panner).connect(this.bus);
    } else {
      node.connect(this.bus);
    }
  }

  private staticBurst(): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.sharedNoise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, t);
    bp.Q.value = 1.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.095);
    src.connect(bp).connect(g).connect(this.bus);
    src.start(t, Math.random() * 1.4);
    src.stop(t + 0.11);
  }

  private noiseHit(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType, pan = 0): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.sharedNoise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0005, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g);
    this.connectBus(g, pan);
    src.start(t, Math.random() * 1.4);
    src.stop(t + dur + 0.02);
  }

  private memThump(f0: number, f1: number, dur: number, gain: number, pan = 0): void {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    this.connectBus(g, pan);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private dholSlap(gain: number): void {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(270, t + 0.045);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g);
    this.connectBus(g, 0.18);
    o.start(t);
    o.stop(t + 0.06);
    this.noiseHit(0.038, 2100, 3.5, gain * 0.55, 'bandpass', 0.18);
  }

  private benjoPluck(freq: number, dur: number, gain: number): void {
    const t = this.ctx.currentTime;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1180;
    bp.Q.value = 2.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    for (const detune of [-4, 4]) {
      const o = this.ctx.createOscillator();
      o.type = detune < 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = detune;
      o.connect(bp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    bp.connect(g);
    this.connectBus(g, 0.08);
  }

  private synthLead(freq: number, dur: number, gain: number, type: OscillatorType, cutoff: number, pan: number): void {
    const t = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(240, cutoff * 0.45), t + dur);
    lp.Q.value = 1.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    for (const detune of [-5, 5]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    lp.connect(g);
    this.connectBus(g, pan);
  }

  private triggerStep(station: RadioStationId, step: number, stepDur: number, fever: number): void {
    const meta = RADIO_STATIONS[station];
    const hit = meta.rhythm[step % meta.rhythm.length] ?? 0;
    const note = meta.melody[step % meta.melody.length] ?? 0;

    if (station === 'dhol') {
      if (hit === 1 || hit === 2) this.memThump(hit === 1 ? 122 : 104, 42, 0.11, 0.16, -0.15);
      if (hit === 1 || hit === 3) this.dholSlap(step % 4 === 0 ? 0.11 : 0.08);
      if (fever > 0.6 && (step % 2 === 1)) this.noiseHit(0.025, 5800, 2.5, 0.028, 'highpass', -0.2);
      if (note > 0) this.benjoPluck(note, stepDur * 1.45, 0.065);
    } else if (station === 'lyari') {
      if (hit === 1 || hit === 3) this.memThump(135, 38, 0.14, 0.18, 0);
      if (hit === 2) {
        this.memThump(190, 95, 0.055, 0.08, 0.1);
        this.noiseHit(0.085, 2400, 1.3, 0.11, 'bandpass', 0.1);
      }
      if (hit === 3 || hit === 4) this.noiseHit(0.028, 7200, 1.8, 0.036, 'highpass', -0.22);
      if (note > 0) this.synthLead(note, stepDur * 1.6, note < 140 ? 0.085 : 0.055, 'sawtooth', 920 + fever * 220, 0.08);
    } else if (station === 'clifton') {
      if (hit === 1) this.memThump(96, 44, 0.12, 0.11, 0);
      if (hit === 2) this.noiseHit(0.06, 1750, 2.2, 0.055, 'bandpass', 0.16);
      if (hit === 3) this.dholSlap(0.05);
      if (hit === 4) this.noiseHit(0.024, 6400, 2.0, 0.02, 'highpass', -0.18);
      if (note > 0) this.synthLead(note, stepDur * 1.9, 0.052, 'triangle', 1600 + fever * 260, -0.12);
    }
  }

  update(dt: number, running: boolean, hornActive: boolean, fever: number): void {
    const t = this.ctx.currentTime;
    if (hornActive !== this.lastDucked) {
      this.lastDucked = hornActive;
      this.bus.gain.setTargetAtTime(hornActive ? 0.36 : 1.0, t, 0.04);
    }

    if (this.station === 'off' || !running || dt <= 0 || this.ctx.state !== 'running') return;

    const meta = RADIO_STATIONS[this.station];
    const safeFever = Math.max(0, Math.min(2, fever));
    const bpm = Math.min(meta.maxFeverBpm, meta.baseBpm + safeFever * 7);
    const stepDur = 60 / bpm / 4;

    this.timer -= Math.min(0.1, dt);
    let stepsThisFrame = 0;
    while (this.timer <= 0 && stepsThisFrame < 2) {
      this.timer += stepDur;
      this.triggerStep(this.station, this.step++, stepDur, safeFever);
      stepsThisFrame++;
    }
    if (this.timer < 0) this.timer = 0;
  }

  dispose(): void {
    try {
      this.bus.disconnect();
      this.fmFilter.disconnect();
    } catch {
      /* ignore */
    }
  }
}
