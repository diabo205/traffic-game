import type { PlayerVehicle } from '../sim/types';
import type { UpgradeTier } from '../sim/upgrades';
import { computeGearboxRpm, ENGINE_PROFILES } from './engineDspMath';
import { ENGINE_WORKLET_PROCESSOR_NAME, ENGINE_WORKLET_SOURCE } from './engineWorkletSource';

export type EngineBackend = 'pending' | 'worklet' | 'fallback';

export interface EngineVoiceUpdate {
  speed: number;
  throttle: number;
  topSpeed: number;
  running: boolean;
  vehicle: PlayerVehicle;
  engineTier: UpgradeTier | number;
  boost: number;
  load: number;
}

export class EngineVoice {
  backend: EngineBackend = 'fallback';
  private disposed = false;

  // Worklet path
  private workletNode: AudioWorkletNode | null = null;
  private workletBus: GainNode | null = null;
  private workletReady = false;

  // Fallback Web Audio path
  private fallbackBus: GainNode;
  private fbOsc1: OscillatorNode;
  private fbOsc2: OscillatorNode;
  private fbSub: OscillatorNode;
  private fbExOsc: OscillatorNode;
  private fbLfo: OscillatorNode;
  private fbNoise: AudioBufferSourceNode;
  private fbFilter: BiquadFilterNode;
  private fbGain: GainNode;
  private fbLfoGain: GainNode;
  private fbExFilter: BiquadFilterNode;
  private fbExGain: GainNode;
  private fbIntakeFilter: BiquadFilterNode;
  private fbIntakeGain: GainNode;
  private fbTurboOsc: OscillatorNode;
  private fbTurboGain: GainNode;
  private fallbackStopped = false;
  private fallbackStopTimer: ReturnType<typeof setTimeout> | null = null;

  // Gearbox & smoothing state
  private rpm = 900;
  private lastGear = 1;
  private lastThrottle = 0;
  private revTimer = 0;
  private revVehicle: PlayerVehicle = 'alto';
  private revTier = 0;

  // Cached last values for seamless worklet handoff
  private lastProfile = 0;
  private lastTier = 0;
  private lastBoost = 0;
  private lastLoad = 0;
  private lastRunning = 0;
  private lastGain = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    sharedNoise: AudioBuffer,
    forceFallback = false,
    private readonly onBackendChange?: (b: EngineBackend) => void,
    private readonly onFallbackPop?: (intensity: number) => void,
  ) {
    // Always construct the zero-alloc fallback voice so audio works on frame 0 and offline file://.
    this.fallbackBus = ctx.createGain();
    this.fallbackBus.gain.value = 1;
    this.fallbackBus.connect(dest);

    this.fbFilter = ctx.createBiquadFilter();
    this.fbFilter.type = 'lowpass';
    this.fbFilter.frequency.value = 500;
    this.fbFilter.Q.value = 0.85;
    this.fbGain = ctx.createGain();
    this.fbGain.gain.value = 0;

    this.fbOsc1 = ctx.createOscillator();
    this.fbOsc1.type = 'sawtooth';
    this.fbOsc2 = ctx.createOscillator();
    this.fbOsc2.type = 'triangle';
    this.fbSub = ctx.createOscillator();
    this.fbSub.type = 'triangle';

    const g2 = ctx.createGain();
    g2.gain.value = 0.16;
    const gSub = ctx.createGain();
    gSub.gain.value = 0.7;
    this.fbOsc1.connect(this.fbFilter);
    this.fbOsc2.connect(g2).connect(this.fbFilter);
    this.fbSub.connect(gSub).connect(this.fbFilter);

    this.fbLfo = ctx.createOscillator();
    this.fbLfo.frequency.value = 11.2;
    this.fbLfoGain = ctx.createGain();
    this.fbLfoGain.gain.value = 0.035;
    this.fbLfo.connect(this.fbLfoGain).connect(this.fbGain.gain);
    this.fbFilter.connect(this.fbGain).connect(this.fallbackBus);

    this.fbNoise = ctx.createBufferSource();
    this.fbNoise.buffer = sharedNoise;
    this.fbNoise.loop = true;
    this.fbIntakeFilter = ctx.createBiquadFilter();
    this.fbIntakeFilter.type = 'bandpass';
    this.fbIntakeFilter.frequency.value = 380;
    this.fbIntakeFilter.Q.value = 0.9;
    this.fbIntakeGain = ctx.createGain();
    this.fbIntakeGain.gain.value = 0;
    this.fbNoise.connect(this.fbIntakeFilter).connect(this.fbIntakeGain).connect(this.fallbackBus);

    this.fbExOsc = ctx.createOscillator();
    this.fbExOsc.type = 'sawtooth';
    this.fbExFilter = ctx.createBiquadFilter();
    this.fbExFilter.type = 'bandpass';
    this.fbExFilter.frequency.value = 220;
    this.fbExFilter.Q.value = 1.2;
    this.fbExGain = ctx.createGain();
    this.fbExGain.gain.value = 0;
    this.fbExOsc.connect(this.fbExFilter).connect(this.fbExGain).connect(this.fallbackBus);

    this.fbTurboOsc = ctx.createOscillator();
    this.fbTurboOsc.type = 'sine';
    this.fbTurboGain = ctx.createGain();
    this.fbTurboGain.gain.value = 0;
    this.fbTurboOsc.connect(this.fbTurboGain).connect(this.fallbackBus);

    this.fbOsc1.start();
    this.fbOsc2.start();
    this.fbSub.start();
    this.fbExOsc.start();
    this.fbLfo.start();
    this.fbNoise.start();
    this.fbTurboOsc.start();

    const isFileOrOpaque =
      typeof location !== 'undefined' && (location.protocol === 'file:' || location.origin === 'null');
    const isSecure = typeof window === 'undefined' || window.isSecureContext !== false;
    const canWorklet =
      !forceFallback &&
      !isFileOrOpaque &&
      isSecure &&
      typeof AudioWorkletNode === 'function' &&
      Boolean(ctx.audioWorklet) &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function';

    if (canWorklet) {
      this.backend = 'pending';
      this.onBackendChange?.('pending');
      void this.initWorklet();
    } else {
      this.backend = 'fallback';
      this.onBackendChange?.('fallback');
    }
  }

  private async initWorklet(): Promise<void> {
    let url = '';
    try {
      const blob = new Blob([ENGINE_WORKLET_SOURCE], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(url);
      if (this.disposed) return;

      const node = new AudioWorkletNode(this.ctx, ENGINE_WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const wBus = this.ctx.createGain();
      wBus.gain.value = 0;
      node.connect(wBus).connect(this.dest);

      const t = this.ctx.currentTime;
      const p = node.parameters;
      p.get('rpm')?.setValueAtTime(this.rpm, t);
      p.get('throttle')?.setValueAtTime(this.lastThrottle, t);
      p.get('load')?.setValueAtTime(this.lastLoad, t);
      p.get('profile')?.setValueAtTime(this.lastProfile, t);
      p.get('upgradeTier')?.setValueAtTime(this.lastTier, t);
      p.get('boost')?.setValueAtTime(this.lastBoost, t);
      p.get('running')?.setValueAtTime(this.lastRunning, t);
      p.get('gain')?.setValueAtTime(this.lastGain, t);

      // Click-free 60 ms crossfade from fallback to AudioWorklet.
      wBus.gain.setTargetAtTime(1, t, 0.02);
      this.fallbackBus.gain.setTargetAtTime(0, t, 0.02);

      this.workletNode = node;
      this.workletBus = wBus;
      this.workletReady = true;
      this.backend = 'worklet';
      this.onBackendChange?.('worklet');

      this.fallbackStopTimer = setTimeout(() => {
        if (!this.disposed) this.stopFallbackNodes();
      }, 140);
    } catch {
      // Expected on insecure file:// origins or restricted CSP environments: stay cleanly on fallback.
      if (!this.disposed) {
        this.workletReady = false;
        this.backend = 'fallback';
        this.onBackendChange?.('fallback');
      }
    } finally {
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private stopFallbackNodes(): void {
    if (this.fallbackStopped) return;
    this.fallbackStopped = true;
    for (const src of [this.fbOsc1, this.fbOsc2, this.fbSub, this.fbExOsc, this.fbLfo, this.fbNoise, this.fbTurboOsc]) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        /* ignore already stopped */
      }
    }
    try {
      this.fallbackBus.disconnect();
    } catch {
      /* ignore */
    }
  }

  get isWorkletReady(): boolean {
    return this.workletReady;
  }

  /** Brief garage/upgrade rev preview burst. */
  revBurst(vehicle: PlayerVehicle, engineTier: UpgradeTier | number = 0): void {
    this.revVehicle = vehicle;
    this.revTier = engineTier;
    this.revTimer = 0.55;
  }

  update(v: EngineVoiceUpdate, dt: number): void {
    if (this.disposed) return;

    let effVehicle = v.vehicle;
    let effTier = v.engineTier;
    let effSpeed = v.speed;
    let effThrottle = v.throttle;
    let effRunning = v.running;
    let effBoost = v.boost;

    if (this.revTimer > 0) {
      this.revTimer = Math.max(0, this.revTimer - Math.max(0, dt));
      effVehicle = this.revVehicle;
      effTier = this.revTier;
      effSpeed = 0;
      effThrottle = this.revTimer > 0.18 ? 0.95 : 0.1;
      effRunning = true;
    }

    const res = computeGearboxRpm(
      this.rpm,
      this.lastGear,
      this.lastThrottle,
      effSpeed,
      effThrottle,
      v.topSpeed,
      effRunning,
      dt,
      effVehicle,
      effTier,
    );
    this.rpm = res.rpm;
    this.lastGear = effRunning ? res.gear : 1;
    this.lastThrottle = effThrottle;

    const prof = ENGINE_PROFILES[effVehicle];
    const clampTier = Math.max(0, Math.min(3, Math.trunc(effTier)));
    const clampLoad = Math.max(0, Math.min(1, v.load));
    const clampBoost = Math.max(0, Math.min(1, effBoost));
    const revGain = this.revTimer > 0 ? 0.65 : 0;
    const outGain = effRunning ? Math.max(0.48, revGain) : 0.22;

    this.lastProfile = prof.index;
    this.lastTier = clampTier;
    this.lastBoost = clampBoost;
    this.lastLoad = clampLoad;
    this.lastRunning = effRunning ? 1 : 0;
    this.lastGain = outGain;

    const t = this.ctx.currentTime;
    if (this.workletReady && this.workletNode) {
      const p = this.workletNode.parameters;
      p.get('rpm')?.setTargetAtTime(this.rpm, t, 0.025);
      p.get('throttle')?.setTargetAtTime(effThrottle, t, 0.025);
      p.get('load')?.setTargetAtTime(clampLoad, t, 0.03);
      p.get('profile')?.setValueAtTime(prof.index, t);
      p.get('upgradeTier')?.setValueAtTime(clampTier, t);
      p.get('boost')?.setTargetAtTime(clampBoost, t, 0.03);
      p.get('running')?.setTargetAtTime(this.lastRunning, t, 0.04);
      p.get('gain')?.setTargetAtTime(outGain, t, 0.04);
      if (res.shiftedUp || res.liftOffPop) {
        this.workletNode.port.postMessage({ type: 'pop', intensity: res.shiftedUp ? 0.8 : 0.55 });
      }
      return;
    }

    if (this.fallbackStopped) return;

    const fire = (this.rpm / 60) * prof.cylRatio * prof.pitchMul;
    this.fbOsc1.frequency.setTargetAtTime(fire, t, 0.03);
    this.fbOsc2.frequency.setTargetAtTime(fire * 2.01, t, 0.03);
    this.fbSub.frequency.setTargetAtTime(fire * 0.5, t, 0.03);
    this.fbLfo.frequency.setTargetAtTime(prof.idleLopeHz, t, 0.05);

    this.fbFilter.frequency.setTargetAtTime((240 + this.rpm * 0.145 + effThrottle * 340 + clampTier * 85) * prof.filtMul, t, 0.05);
    this.fbGain.gain.setTargetAtTime(effRunning ? 0.05 + effThrottle * 0.065 : 0.018, t, 0.05);

    const idleFactor = Math.max(0, 1 - (this.rpm - 950) / 900);
    this.fbLfoGain.gain.setTargetAtTime((effRunning ? 0.025 : 0.011) * idleFactor, t, 0.08);

    this.fbIntakeFilter.frequency.setTargetAtTime((300 + this.rpm * 0.12 + effThrottle * 480 + clampBoost * 600) * prof.filtMul, t, 0.06);
    this.fbIntakeGain.gain.setTargetAtTime(effRunning ? 0.012 + effThrottle * 0.04 + clampBoost * 0.032 : 0.005, t, 0.06);

    this.fbExOsc.frequency.setTargetAtTime(fire * prof.exMul, t, 0.03);
    this.fbExFilter.frequency.setTargetAtTime((185 + this.rpm * 0.1 + effThrottle * 240 + clampTier * 70) * prof.filtMul, t, 0.05);
    this.fbExGain.gain.setTargetAtTime((effRunning ? 0.018 + effThrottle * 0.042 + clampTier * 0.01 : 0.009) * prof.raspMix * 2.0, t, 0.05);

    const effTurbo = prof.turboBaseHz > 0 ? prof.turboBaseHz : clampTier >= 2 ? 2200 + clampTier * 350 : 0;
    if (effTurbo > 0 || clampBoost > 0.02) {
      const tf = (effTurbo || 2600) * (0.45 + Math.max(0, (this.rpm - 1400) / 5500) * 0.75 + clampBoost * 0.25);
      const tg = (effTurbo > 0 ? (0.012 + effThrottle * 0.02) * Math.min(1, Math.max(0, (this.rpm - 1300) / 2600)) : 0) + clampBoost * 0.04;
      this.fbTurboOsc.frequency.setTargetAtTime(tf, t, 0.05);
      this.fbTurboGain.gain.setTargetAtTime(tg, t, 0.05);
    } else {
      this.fbTurboGain.gain.setTargetAtTime(0, t, 0.05);
    }

    if ((res.shiftedUp || res.liftOffPop) && this.onFallbackPop) {
      this.onFallbackPop(res.shiftedUp ? 0.8 : 0.55);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.fallbackStopTimer !== null) {
      clearTimeout(this.fallbackStopTimer);
      this.fallbackStopTimer = null;
    }
    this.stopFallbackNodes();
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        /* ignore */
      }
      this.workletNode = null;
    }
    if (this.workletBus) {
      try {
        this.workletBus.disconnect();
      } catch {
        /* ignore */
      }
      this.workletBus = null;
    }
  }
}
