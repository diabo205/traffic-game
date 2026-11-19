import type { PlayerVehicle } from '../sim/types';
import type { HornId } from '../sim/upgrades';
import { HORN_SEQUENCES } from './engineDspMath';

const STOCK_VEHICLE_SCALE: Readonly<Record<PlayerVehicle, number>> = {
  alto: 1.0,
  coupe: 0.92,
  rickshaw: 1.24,
  suv: 0.84,
  minibus: 0.64,
};

/**
 * Zero-click persistent polyphonic Web Audio horn rack supporting all 4 unlockable
 * Karachi horns (`stock`, `rickshaw-beep`, `air-horn`, `pak-melody`).
 */
export class HornSynth {
  private hornId: HornId = 'stock';
  private oscs: [OscillatorNode, OscillatorNode, OscillatorNode];
  private voiceGains: [GainNode, GainNode, GainNode];
  private formant: BiquadFilterNode;
  private outGain: GainNode;
  private shaper: WaveShaperNode;

  private active = false;
  private wasPlaying = false;
  private stepIdx = 0;
  private stepElapsed = 0;
  private lastAppliedHorn: HornId = 'stock';
  private lastAppliedStep = -1;

  private previewTimer = 0;
  private previewId: HornId | null = null;
  private previewVehicle: PlayerVehicle = 'alto';

  constructor(private readonly ctx: AudioContext, dest: AudioNode) {
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 0;

    this.formant = ctx.createBiquadFilter();
    this.formant.type = 'bandpass';
    this.formant.frequency.value = 1300;
    this.formant.Q.value = 0.85;

    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.8);
    }
    this.shaper.curve = curve;

    this.shaper.connect(this.formant).connect(this.outGain).connect(dest);

    const oscs: OscillatorNode[] = [];
    const gains: GainNode[] = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 415;
      const g = ctx.createGain();
      g.gain.value = i < 2 ? 0.5 : 0;
      osc.connect(g).connect(this.shaper);
      osc.start();
      oscs.push(osc);
      gains.push(g);
    }
    this.oscs = oscs as [OscillatorNode, OscillatorNode, OscillatorNode];
    this.voiceGains = gains as [GainNode, GainNode, GainNode];
  }

  setHorn(id: HornId): void {
    if (this.hornId !== id) {
      this.hornId = id;
      this.stepIdx = 0;
      this.stepElapsed = 0;
      this.lastAppliedStep = -1;
    }
  }

  getHorn(): HornId {
    return this.hornId;
  }

  preview(id: HornId, vehicle: PlayerVehicle = 'alto'): void {
    this.previewId = id;
    this.previewVehicle = vehicle;
    this.previewTimer = 0.85;
    this.stepIdx = 0;
    this.stepElapsed = 0;
    this.lastAppliedStep = -1;
  }

  isActive(): boolean {
    return this.active;
  }

  private applyStep(id: HornId, stepIdx: number, vehicle: PlayerVehicle, forceScoop: boolean): void {
    const def = HORN_SEQUENCES[id];
    const step = def.steps[stepIdx];
    const t = this.ctx.currentTime;
    const scale = id === 'stock' ? STOCK_VEHICLE_SCALE[vehicle] : 1;

    this.formant.frequency.setTargetAtTime(def.formantHz, t, 0.015);
    this.formant.Q.setTargetAtTime(def.formantQ, t, 0.015);

    for (let i = 0; i < 3; i++) {
      const f = step.freqs[i] * scale;
      const osc = this.oscs[i];
      if (osc.type !== def.waveform) osc.type = def.waveform;
      if (f > 0) {
        if (forceScoop) {
          osc.frequency.setValueAtTime(f * 0.965, t);
          osc.frequency.setTargetAtTime(f, t, 0.016);
        } else {
          osc.frequency.setTargetAtTime(f, t, 0.012);
        }
        this.voiceGains[i].gain.setTargetAtTime(i === 2 ? 0.38 : 0.48, t, 0.01);
      } else {
        this.voiceGains[i].gain.setTargetAtTime(0, t, 0.008);
      }
    }

    this.outGain.gain.setTargetAtTime(step.gain, t, 0.012);
    this.lastAppliedHorn = id;
    this.lastAppliedStep = stepIdx;
  }

  update(held: boolean, vehicle: PlayerVehicle, dt: number): void {
    if (this.previewTimer > 0) {
      this.previewTimer = Math.max(0, this.previewTimer - Math.max(0, dt));
      if (this.previewTimer === 0) this.previewId = null;
    }

    const previewing = this.previewTimer > 0 && this.previewId !== null;
    const playing = held || previewing;
    const activeId = previewing && this.previewId ? this.previewId : this.hornId;
    const effVehicle = previewing ? this.previewVehicle : vehicle;

    this.active = playing;

    if (!playing) {
      if (this.wasPlaying) {
        this.outGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.014);
        this.wasPlaying = false;
        this.stepIdx = 0;
        this.stepElapsed = 0;
        this.lastAppliedStep = -1;
      }
      return;
    }

    const def = HORN_SEQUENCES[activeId];
    if (!this.wasPlaying || this.lastAppliedHorn !== activeId) {
      this.wasPlaying = true;
      this.stepIdx = 0;
      this.stepElapsed = 0;
      this.applyStep(activeId, this.stepIdx, effVehicle, true);
    } else if (def.steps.length > 1) {
      this.stepElapsed += Math.max(0, dt);
      const curStep = def.steps[this.stepIdx];
      if (this.stepElapsed >= curStep.dur) {
        this.stepElapsed %= curStep.dur;
        this.stepIdx = (this.stepIdx + 1) % def.steps.length;
        this.applyStep(activeId, this.stepIdx, effVehicle, false);
      }
    } else if (this.lastAppliedStep !== 0 || activeId === 'stock') {
      // Keep vehicle-scaled stock horn pitch responsive without clicks.
      this.applyStep(activeId, 0, effVehicle, false);
    }
  }

  dispose(): void {
    for (const osc of this.oscs) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      this.outGain.disconnect();
    } catch {
      /* ignore */
    }
  }
}
