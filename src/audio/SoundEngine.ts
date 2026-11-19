import type { NpcKind, NpcView, PlayerVehicle } from '../sim/types';
import type { HornId, UpgradeTier } from '../sim/upgrades';
import { ENGINE_PROFILES, NPC_ACOUSTIC_PROFILE, RADIO_STATIONS, RADIO_STATION_ORDER } from './engineDspMath';
import type { RadioStationId } from './engineDspMath';
import { EngineVoice } from './EngineVoice';
import type { EngineBackend } from './EngineVoice';
import { HornSynth } from './HornSynth';
import { KarachiFm } from './KarachiFm';
import { SpatialTrafficAudio } from './SpatialTrafficAudio';

export { ENGINE_PROFILES as SOUND_PROFILE, RADIO_STATIONS, RADIO_STATION_ORDER };
export type { EngineBackend, RadioStationId };

/**
 * M3 Procedural Audio Architecture (Worklet-first with synchronous fallback).
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
  /** M1/M3 upgrade tier 0..3 */
  engineTier?: UpgradeTier | number;
  /** 0..1 nitrous boost active mix */
  boost?: number;
  /** 0..1 normalized longitudinal engine load */
  load?: number;
  /** active equipped horn id */
  hornId?: HornId;
}

export interface AudioDiagnostics {
  unlocked: boolean;
  contextState: AudioContextState | 'uninitialized';
  backend: EngineBackend;
  workletReady: boolean;
  vehicle: PlayerVehicle;
  engineTier: number;
  hornId: HornId;
  radioStation: RadioStationId;
  radioOn: boolean;
  activeDopplerVoices: number;
  muted: boolean;
}

export interface SoundEngineOptions {
  lowSpec?: boolean;
  forceFallback?: boolean;
  hornId?: HornId;
  radioStation?: RadioStationId;
}

export class SoundEngine {
  private readonly lowSpec: boolean;
  private readonly forceFallback: boolean;

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private userPaused = false;
  private disposed = false;

  private engineVoice: EngineVoice | null = null;
  private hornSynth: HornSynth | null = null;
  private spatialTraffic: SpatialTrafficAudio | null = null;
  private fmRadio: KarachiFm | null = null;

  // Continuous ambient noise beds (tyre screech, wind/road, monsoon rainfall)
  private screechGain!: GainNode;
  private roadGain!: GainNode;
  private roadFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;

  // Desired state persisted across lazy AudioContext unlock
  private desiredRadioStation: RadioStationId = 'dhol';
  private desiredHornId: HornId = 'stock';
  private currentVehicle: PlayerVehicle = 'alto';
  private currentEngineTier = 0;

  private visHandler: (() => void) | null = null;
  private stateHandler: (() => void) | null = null;

  private readonly diagnostics: AudioDiagnostics;

  constructor(opts: SoundEngineOptions = {}) {
    this.lowSpec = Boolean(opts.lowSpec);
    this.forceFallback = Boolean(opts.forceFallback);
    if (opts.hornId) this.desiredHornId = opts.hornId;
    if (opts.radioStation) this.desiredRadioStation = opts.radioStation;

    this.diagnostics = {
      unlocked: false,
      contextState: 'uninitialized',
      backend: this.forceFallback ? 'fallback' : 'pending',
      workletReady: false,
      vehicle: this.currentVehicle,
      engineTier: this.currentEngineTier,
      hornId: this.desiredHornId,
      radioStation: this.desiredRadioStation,
      radioOn: this.desiredRadioStation !== 'off',
      activeDopplerVoices: 0,
      muted: this.muted,
    };
    this.syncDiagnostics();
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isRadioOn(): boolean {
    return (this.fmRadio?.getStation() ?? this.desiredRadioStation) !== 'off';
  }

  getRadioStation(): RadioStationId {
    return this.fmRadio?.getStation() ?? this.desiredRadioStation;
  }

  getDiagnostics(): AudioDiagnostics {
    this.syncDiagnostics();
    return this.diagnostics;
  }

  private syncDiagnostics(): void {
    const d = this.diagnostics;
    const state = this.ctx ? this.ctx.state : 'uninitialized';
    d.contextState = state;
    d.unlocked = state === 'running';
    d.backend = this.engineVoice ? this.engineVoice.backend : this.forceFallback ? 'fallback' : 'pending';
    d.workletReady = this.engineVoice ? this.engineVoice.isWorkletReady : false;
    d.vehicle = this.currentVehicle;
    d.engineTier = this.currentEngineTier;
    d.hornId = this.hornSynth ? this.hornSynth.getHorn() : this.desiredHornId;
    d.radioStation = this.fmRadio ? this.fmRadio.getStation() : this.desiredRadioStation;
    d.radioOn = d.radioStation !== 'off';
    d.activeDopplerVoices = this.spatialTraffic ? this.spatialTraffic.activeCount : 0;
    d.muted = this.muted;
    if (typeof window !== 'undefined') {
      (window as unknown as { __KT3D_AUDIO__?: AudioDiagnostics }).__KT3D_AUDIO__ = d;
    }
  }

  setRadio(on: boolean): void {
    this.setRadioStation(on ? 'dhol' : 'off', false);
  }

  setRadioStation(station: RadioStationId, playStatic = false): void {
    this.desiredRadioStation = station;
    this.fmRadio?.setStation(station, playStatic);
    this.syncDiagnostics();
  }

  cycleRadioStation(): RadioStationId {
    const next = this.fmRadio
      ? this.fmRadio.cycleStation()
      : RADIO_STATION_ORDER[(RADIO_STATION_ORDER.indexOf(this.desiredRadioStation) + 1) % RADIO_STATION_ORDER.length];
    this.desiredRadioStation = next;
    this.syncDiagnostics();
    return next;
  }

  setHorn(id: HornId): void {
    this.desiredHornId = id;
    this.hornSynth?.setHorn(id);
    this.syncDiagnostics();
  }

  previewHorn(id: HornId, vehicle: PlayerVehicle = this.currentVehicle): void {
    if (!this.ctx) this.unlock();
    this.hornSynth?.preview(id, vehicle);
    this.syncDiagnostics();
  }

  revBurst(vehicle: PlayerVehicle, engineTier: UpgradeTier | number = 0): void {
    if (!this.ctx) this.unlock();
    this.currentVehicle = vehicle;
    this.currentEngineTier = engineTier;
    this.engineVoice?.revBurst(vehicle, engineTier);
    this.syncDiagnostics();
  }

  /** Must be called from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.disposed) return;
    if (this.ctx) {
      if (!this.userPaused && this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => this.syncDiagnostics()).catch(() => {});
      }
      this.syncDiagnostics();
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

    // White noise buffer shared across intake, tyres, rain, radio, and one-shots.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.engineVoice = new EngineVoice(
      ctx,
      this.master,
      this.noise,
      this.forceFallback,
      () => this.syncDiagnostics(),
      () => this.exhaustPop(),
    );
    this.hornSynth = new HornSynth(ctx, this.master);
    this.hornSynth.setHorn(this.desiredHornId);

    this.spatialTraffic = new SpatialTrafficAudio(
      ctx,
      this.master,
      this.lowSpec,
      (pan, intensity) => this.passingRush(pan, intensity),
      (pan, kind, ratio) => this.npcHorn(pan, kind, ratio),
    );
    this.fmRadio = new KarachiFm(ctx, this.master, this.noise, this.desiredRadioStation);

    this.buildScreech(ctx);
    this.buildRoad(ctx);
    this.buildRain(ctx);

    this.stateHandler = () => this.syncDiagnostics();
    ctx.addEventListener('statechange', this.stateHandler);

    if (typeof document !== 'undefined') {
      this.visHandler = () => {
        const c = this.ctx;
        if (!c) return;
        if (document.visibilityState === 'hidden') {
          if (c.state === 'running') void c.suspend().then(() => this.syncDiagnostics()).catch(() => {});
        } else if (!this.userPaused && c.state === 'suspended') {
          void c.resume().then(() => this.syncDiagnostics()).catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', this.visHandler);
    }

    if (ctx.state === 'suspended' && !this.userPaused) {
      void ctx.resume().then(() => this.syncDiagnostics()).catch(() => {});
    }
    this.syncDiagnostics();
  }

  /** Pause menu: freeze all sound cleanly (engine loops included). */
  setPaused(p: boolean): void {
    this.userPaused = p;
    const ctx = this.ctx;
    if (!ctx) {
      this.syncDiagnostics();
      return;
    }
    if (p && ctx.state === 'running') {
      void ctx.suspend().then(() => this.syncDiagnostics()).catch(() => {});
    } else if (!p && ctx.state === 'suspended' && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
      void ctx.resume().then(() => this.syncDiagnostics()).catch(() => {});
    }
    this.syncDiagnostics();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
    this.syncDiagnostics();
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
    const vehicle = p.vehicle ?? 'alto';
    const engineTier = p.engineTier ?? 0;
    this.currentVehicle = vehicle;
    this.currentEngineTier = engineTier;
    if (p.hornId && p.hornId !== this.desiredHornId) {
      this.desiredHornId = p.hornId;
      this.hornSynth?.setHorn(p.hornId);
    }

    const ctx = this.ctx;
    if (!ctx) {
      this.syncDiagnostics();
      return;
    }

    const t = ctx.currentTime;
    const v = Math.abs(p.speed);

    this.engineVoice?.update(
      {
        speed: p.speed,
        throttle: p.throttle,
        topSpeed: p.topSpeed,
        running: p.running,
        vehicle,
        engineTier,
        boost: p.boost ?? 0,
        load: p.load ?? p.throttle,
      },
      dt,
    );

    this.hornSynth?.update(p.horn, vehicle, dt);
    const hornActive = this.hornSynth?.isActive() ?? p.horn;

    this.screechGain.gain.setTargetAtTime(Math.min(1, p.screech) * 0.22, t, 0.04);
    this.roadGain.gain.setTargetAtTime(Math.min(0.25, v * 0.008), t, 0.1);
    this.roadFilter.frequency.setTargetAtTime(250 + v * 25, t, 0.1);

    const rainLevel = p.monsoon ? (p.running ? 0.11 + Math.min(0.08, v * 0.003) : 0.07) : 0;
    this.rainGain.gain.setTargetAtTime(rainLevel, t, 0.12);
    this.rainFilter.frequency.setTargetAtTime(980 + v * 22, t, 0.12);

    this.fmRadio?.update(dt, p.running, hornActive, p.fever ?? 0);
    this.syncDiagnostics();
  }

  /** Spatial multi-voice Doppler traffic passby mix + rush + NPC horn reply. */
  updateSpatialTraffic(
    npcs: readonly NpcView[],
    px: number,
    pz: number,
    pHeading: number,
    pvx: number,
    pvz: number,
    dt: number,
    active: boolean,
    playerHorn: boolean,
    playerSpeed: number,
  ): void {
    const canPlay = active && this.unlocked && !this.muted;
    this.spatialTraffic?.update(npcs, px, pz, pHeading, pvx, pvz, dt, canPlay, playerHorn, playerSpeed);
    this.syncDiagnostics();
  }

  resetSpatialTraffic(): void {
    this.spatialTraffic?.reset();
    this.syncDiagnostics();
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
    this.burst(0.25, 2400, 12, 0.4, 'bandpass');
  }

  crash(intensity: number, pan = 0): void {
    const i = Math.min(1, intensity);
    this.thump(90, 0.3, 0.6 + i * 0.4, pan);
    this.burst(0.35 + i * 0.4, 1800, 0.7, 0.5 + i * 0.5, 'lowpass', pan);
    this.burst(0.5, 3200, 14, 0.25 + i * 0.3, 'bandpass', pan);
    this.burst(0.2, 5200, 3, 0.2 * i, 'highpass', pan);
  }

  scrape(intensity: number): void {
    this.burst(0.12, 2200, 3, 0.12 + intensity * 0.15, 'bandpass');
  }

  splash(): void {
    this.burst(0.6, 1400, 0.6, 0.55);
    this.burst(0.35, 400, 1, 0.3);
  }

  /** Ceramic cup clink + hot chai slosh when fragile chai cargo spills. */
  chaiSpill(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, delay] of [[2880, 0], [3920, 0.045]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t + delay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t + delay);
      g.gain.exponentialRampToValueAtTime(0.14, t + delay + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + delay + 0.16);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 0.18);
    }
    this.burst(0.22, 1800, 1.3, 0.16, 'bandpass', 0.12);
  }

  /** Crisp subtle pressure chime when nitrous bar hits 100%. */
  boostReady(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(740, t);
    o.frequency.exponentialRampToValueAtTime(1180, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.18);
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

  /** Brief spatial horn reply from nearby Karachi traffic, tailored by vehicle kind & Doppler ratio. */
  npcHorn(pan: number, kindOrPitchScale: NpcKind | number = 1, dopplerRatio = 1): void {
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

    const freqs =
      typeof kindOrPitchScale === 'string'
        ? [
            NPC_ACOUSTIC_PROFILE[kindOrPitchScale].hornFreqs[0] * dopplerRatio,
            NPC_ACOUSTIC_PROFILE[kindOrPitchScale].hornFreqs[1] * dopplerRatio,
          ]
        : [390 * kindOrPitchScale, 468 * kindOrPitchScale];

    for (const freq of freqs) {
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

  dispose(): void {
    this.disposed = true;
    if (this.visHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visHandler);
      this.visHandler = null;
    }
    if (this.ctx && this.stateHandler) {
      this.ctx.removeEventListener('statechange', this.stateHandler);
      this.stateHandler = null;
    }
    this.engineVoice?.dispose();
    this.hornSynth?.dispose();
    this.spatialTraffic?.dispose();
    this.fmRadio?.dispose();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.syncDiagnostics();
  }
}
