import { RADIO_STATIONS, RADIO_STATION_ORDER } from './engineDspMath';
import type { RadioStationId } from './engineDspMath';

/**
 * Multi-station procedural Karachi FM synthesizer with Web Audio lookahead scheduling:
 *   - `dhol`:    FM 101 · Dholak Keherwa + Sindhi Benjo melody + fever ghungroo
 *   - `lyari`:   FM 104 · Lyari Beats (808 kick/snare/hat + E Bhairavi coastal groove)
 *   - `clifton`: FM 98  · Clifton Night Cruise (warm synthwave arp + glassy bell + tabla)
 *   - `off`:     Silent
 */
export class KarachiFm {
  private station: RadioStationId = 'dhol';
  private nextStepTime = 0;
  private step = 0;
  private lastDucked = false;
  private lastActive = true;

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
    this.bus.gain.value = initialStation === 'off' ? 0 : 1.05;

    this.fmFilter = ctx.createBiquadFilter();
    this.fmFilter.type = 'lowpass';
    this.fmFilter.frequency.value = 7200;
    this.fmFilter.Q.value = 0.55;

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
    this.nextStepTime = 0;
    this.step = 0;
    const t = this.ctx.currentTime;
    const active = id !== 'off';
    this.lastActive = active;
    this.bus.gain.setTargetAtTime(active ? (this.lastDucked ? 0.38 : 1.05) : 0, t, 0.02);
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
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.095);
    src.connect(bp).connect(g).connect(this.fmFilter);
    src.start(t, Math.random() * 1.4);
    src.stop(t + 0.11);
  }

  private noiseHit(at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType, pan = 0): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sharedNoise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0005, gain), at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    src.connect(f).connect(g);
    this.connectBus(g, pan);
    src.start(at, Math.random() * 1.4);
    src.stop(at + dur + 0.02);
  }

  private memThump(at: number, f0: number, f1: number, dur: number, gain: number, pan = 0): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, f1), at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    o.connect(g);
    this.connectBus(g, pan);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private dholSlap(at: number, gain: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(430, at);
    o.frequency.exponentialRampToValueAtTime(270, at + 0.045);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    o.connect(g);
    this.connectBus(g, 0.18);
    o.start(at);
    o.stop(at + 0.06);
    this.noiseHit(at, 0.038, 2100, 3.5, gain * 0.55, 'bandpass', 0.18);
  }

  private benjoPluck(at: number, freq: number, dur: number, gain: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(4800, freq * 6.5), at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(520, freq * 2.2), at + dur);
    lp.Q.value = 2.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    for (const detune of [-4, 4]) {
      const o = this.ctx.createOscillator();
      o.type = detune < 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(freq, at);
      o.detune.value = detune;
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
    lp.connect(g);
    this.connectBus(g, 0.08);
  }

  private synthLead(at: number, freq: number, dur: number, gain: number, type: OscillatorType, cutoff: number, pan: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(240, cutoff * 0.45), at + dur);
    lp.Q.value = 1.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    for (const detune of [-5, 5]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, at);
      o.detune.value = detune;
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
    lp.connect(g);
    this.connectBus(g, pan);
  }

  private triggerStep(at: number, station: RadioStationId, step: number, stepDur: number, fever: number): void {
    const meta = RADIO_STATIONS[station];
    const hit = meta.rhythm[step % meta.rhythm.length] ?? 0;
    const note = meta.melody[step % meta.melody.length] ?? 0;

    if (station === 'dhol') {
      if (hit === 1 || hit === 2) this.memThump(at, hit === 1 ? 122 : 104, 42, 0.12, hit === 1 ? 0.26 : 0.21, -0.15);
      if (hit === 1 || hit === 3) this.dholSlap(at, step % 4 === 0 ? 0.22 : 0.17);
      if (fever > 0.6 && (step % 2 === 1)) this.noiseHit(at, 0.025, 5800, 2.5, 0.065, 'highpass', -0.2);
      if (step % 8 === 0) {
        this.synthLead(at, step % 16 === 0 ? 130.81 : 146.83, stepDur * 3.2, 0.14, 'triangle', 680, -0.06);
      }
      if (note > 0) this.benjoPluck(at, note, stepDur * 1.45, 0.22);
    } else if (station === 'lyari') {
      if (hit === 1 || hit === 3) this.memThump(at, 135, 38, 0.17, 0.28, 0);
      if (hit === 2) {
        this.memThump(at, 190, 95, 0.06, 0.16, 0.1);
        this.noiseHit(at, 0.085, 2400, 1.3, 0.22, 'bandpass', 0.1);
      }
      if (hit === 3 || hit === 4) this.noiseHit(at, 0.028, 7200, 1.8, 0.08, 'highpass', -0.22);
      if (note > 0) {
        this.synthLead(
          at,
          note,
          stepDur * 1.65,
          note < 140 ? 0.22 : 0.19,
          'sawtooth',
          note < 140 ? 1150 : 1850 + fever * 320,
          0.08,
        );
      }
    } else if (station === 'clifton') {
      if (hit === 1) this.memThump(at, 96, 44, 0.14, 0.30, 0);
      if (hit === 2) this.noiseHit(at, 0.065, 1750, 2.2, 0.17, 'bandpass', 0.16);
      if (hit === 3) this.dholSlap(at, 0.18);
      if (hit === 4) this.noiseHit(at, 0.026, 6400, 2.0, 0.075, 'highpass', -0.18);
      if (step % 8 === 0) {
        this.synthLead(at, step % 16 === 0 ? 110 : 98, stepDur * 3.4, 0.21, 'triangle', 760, 0.05);
      }
      if (note > 0) this.synthLead(at, note, stepDur * 1.95, 0.25, 'triangle', 2600 + fever * 360, -0.12);
    }
  }

  update(dt: number, running: boolean, hornActive: boolean, fever: number): void {
    const now = this.ctx.currentTime;
    const active = this.station !== 'off' && running;
    if (hornActive !== this.lastDucked || active !== this.lastActive) {
      this.lastDucked = hornActive;
      this.lastActive = active;
      this.bus.gain.setTargetAtTime(active ? (hornActive ? 0.38 : 1.05) : 0, now, active ? 0.06 : 0.02);
    }

    if (!active || dt <= 0 || this.ctx.state !== 'running') {
      this.nextStepTime = 0;
      return;
    }

    const meta = RADIO_STATIONS[this.station];
    const safeFever = Math.max(0, Math.min(2, fever));
    const bpm = Math.min(meta.maxFeverBpm, meta.baseBpm + safeFever * 7);
    const stepDur = 60 / bpm / 4;

    if (this.nextStepTime <= 0 || this.nextStepTime < now - 0.12 || this.nextStepTime > now + 1.0) {
      this.nextStepTime = now + 0.015;
    }

    const horizon = now + 0.32;
    let scheduled = 0;
    while (this.nextStepTime < horizon && scheduled < 6) {
      this.triggerStep(this.nextStepTime, this.station, this.step++, stepDur, safeFever);
      this.nextStepTime += stepDur;
      scheduled++;
    }
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
