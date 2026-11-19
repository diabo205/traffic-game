import type { NpcKind, NpcView, PlayerVehicle } from '../sim/types';
import type { HornId, UpgradeTier } from '../sim/upgrades';

/** Gear upshift thresholds as fractions of zone top speed (5-speed manual). */
export const GEARS = [0, 0.18, 0.36, 0.56, 0.78, 1.2] as const;

export const DOPPLER_C_EFF = 110;
export const MAX_SPATIAL_DIST = 28;

export interface EngineAcousticProfile {
  readonly index: 0 | 1 | 2 | 3 | 4;
  readonly cylRatio: number;
  readonly pitchMul: number;
  readonly filtMul: number;
  readonly exMul: number;
  readonly idleRpm: number;
  readonly redlineRpm: number;
  readonly idleLopeHz: number;
  readonly turboBaseHz: number;
  readonly raspMix: number;
  readonly subMix: number;
  readonly gritDrive: number;
}

export const ENGINE_PROFILES: Readonly<Record<PlayerVehicle, EngineAcousticProfile>> = {
  alto: {
    index: 0,
    cylRatio: 1.5,
    pitchMul: 1.0,
    filtMul: 1.0,
    exMul: 0.95,
    idleRpm: 900,
    redlineRpm: 6600,
    idleLopeHz: 11.2,
    turboBaseHz: 0,
    raspMix: 0.32,
    subMix: 0.62,
    gritDrive: 1.5,
  },
  coupe: {
    index: 1,
    cylRatio: 4.0,
    pitchMul: 0.78,
    filtMul: 0.88,
    exMul: 1.25,
    idleRpm: 760,
    redlineRpm: 6800,
    idleLopeHz: 8.2,
    turboBaseHz: 0,
    raspMix: 0.58,
    subMix: 0.78,
    gritDrive: 2.3,
  },
  rickshaw: {
    index: 2,
    cylRatio: 1.0,
    pitchMul: 1.18,
    filtMul: 1.22,
    exMul: 1.35,
    idleRpm: 1050,
    redlineRpm: 7000,
    idleLopeHz: 12.5,
    turboBaseHz: 0,
    raspMix: 0.75,
    subMix: 0.32,
    gritDrive: 2.6,
  },
  suv: {
    index: 3,
    cylRatio: 2.0,
    pitchMul: 0.68,
    filtMul: 0.78,
    exMul: 1.05,
    idleRpm: 720,
    redlineRpm: 5600,
    idleLopeHz: 9.0,
    turboBaseHz: 2400,
    raspMix: 0.42,
    subMix: 0.82,
    gritDrive: 1.8,
  },
  minibus: {
    index: 4,
    cylRatio: 3.0,
    pitchMul: 0.56,
    filtMul: 0.66,
    exMul: 0.74,
    idleRpm: 650,
    redlineRpm: 4600,
    idleLopeHz: 7.0,
    turboBaseHz: 1850,
    raspMix: 0.38,
    subMix: 0.92,
    gritDrive: 1.9,
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface GearboxResult {
  rpm: number;
  gear: number;
  shiftedUp: boolean;
  liftOffPop: boolean;
}

/** Smooth 5-speed gearbox + RPM solver shared between AudioWorklet and fallback voice. */
export function computeGearboxRpm(
  prevRpm: number,
  prevGear: number,
  prevThrottle: number,
  speed: number,
  throttle: number,
  topSpeed: number,
  running: boolean,
  dt: number,
  vehicle: PlayerVehicle,
  engineTier: UpgradeTier | number = 0,
): GearboxResult {
  const profile = ENGINE_PROFILES[vehicle];
  const tier = clamp(Math.trunc(Number.isFinite(engineTier) ? engineTier : 0), 0, 3);
  const effectiveRedline = profile.redlineRpm + tier * 320;
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.1, dt) : 0;
  const safeSpeed = Number.isFinite(speed) ? Math.abs(speed) : 0;
  const safeTop = Number.isFinite(topSpeed) && topSpeed > 1 ? topSpeed : 1;
  const safeThrottle = clamp(Number.isFinite(throttle) ? throttle : 0, 0, 1);
  const safePrevRpm = Number.isFinite(prevRpm) ? prevRpm : profile.idleRpm;

  if (!running) {
    const idleOff = profile.idleRpm * 0.92;
    const alpha = Math.min(1, safeDt * 8.5);
    const rpm = safePrevRpm + (idleOff - safePrevRpm) * alpha;
    return { rpm: Number.isFinite(rpm) ? rpm : idleOff, gear: 1, shiftedUp: false, liftOffPop: false };
  }

  const ratio = safeSpeed / safeTop;
  let gear = 1;
  while (gear < GEARS.length - 1 && ratio > GEARS[gear]) gear++;
  const lo = GEARS[gear - 1];
  const hi = GEARS[gear];
  const inGear = clamp((ratio - lo) / Math.max(1e-4, hi - lo), 0, 1);

  const usableSpan = effectiveRedline - profile.idleRpm;
  let targetRpm: number;
  if (safeSpeed < 0.5) {
    targetRpm = profile.idleRpm + safeThrottle * Math.min(2800, usableSpan * 0.52);
  } else {
    targetRpm = profile.idleRpm + 160 + inGear * (usableSpan - 420) + safeThrottle * 480;
  }
  targetRpm = clamp(targetRpm, profile.idleRpm * 0.92, effectiveRedline);

  const alpha = safeDt > 0 ? Math.min(1, safeDt * 8.5) : 0.25;
  const rpm = clamp(safePrevRpm + (targetRpm - safePrevRpm) * alpha, profile.idleRpm * 0.85, effectiveRedline + 120);

  const safePrevThrottle = clamp(Number.isFinite(prevThrottle) ? prevThrottle : 0, 0, 1);
  const shiftedUp = gear > prevGear && safeThrottle > 0.32 && safeSpeed > 4;
  const liftOffPop = safePrevThrottle > 0.55 && safeThrottle < 0.12 && safePrevRpm > profile.redlineRpm * 0.62;

  return { rpm, gear, shiftedUp, liftOffPop };
}

export interface NpcAcousticProfile {
  readonly baseHz: number;
  readonly formantHz: number;
  readonly formantQ: number;
  readonly gain: number;
  readonly hornFreqs: readonly [number, number];
  readonly hasHorn: boolean;
}

export const NPC_ACOUSTIC_PROFILE: Readonly<Record<NpcKind, NpcAcousticProfile>> = {
  bike: { baseHz: 78, formantHz: 920, formantQ: 1.8, gain: 0.11, hornFreqs: [620, 625], hasHorn: true },
  rickshaw: { baseHz: 62, formantHz: 680, formantQ: 2.1, gain: 0.14, hornFreqs: [520, 640], hasHorn: true },
  car: { baseHz: 54, formantHz: 420, formantQ: 1.2, gain: 0.12, hornFreqs: [410, 492], hasHorn: true },
  minibus: { baseHz: 38, formantHz: 260, formantQ: 1.1, gain: 0.18, hornFreqs: [246, 311], hasHorn: true },
  truck: { baseHz: 32, formantHz: 220, formantQ: 1.0, gain: 0.2, hornFreqs: [218, 275], hasHorn: true },
  cart: { baseHz: 28, formantHz: 340, formantQ: 0.9, gain: 0.05, hornFreqs: [400, 400], hasHorn: false },
};

export interface DopplerVoice {
  active: boolean;
  dist: number;
  pan: number;
  gain: number;
  dopplerRatio: number;
  relSpeed: number;
  whoosh: number;
}

/** Analytical listener-space stereo pan, attenuation, and Doppler pitch shift for a moving traffic source. */
export function computeDopplerVoice(
  px: number,
  pz: number,
  pHeading: number,
  pvx: number,
  pvz: number,
  nx: number,
  nz: number,
  nvx: number,
  nvz: number,
  kind: NpcKind,
): DopplerVoice {
  const dx = nx - px;
  const dz = nz - pz;
  const dist = Math.hypot(dx, dz);
  if (!Number.isFinite(dist) || dist > MAX_SPATIAL_DIST) {
    return { active: false, dist: MAX_SPATIAL_DIST, pan: 0, gain: 0, dopplerRatio: 1, relSpeed: 0, whoosh: 0 };
  }

  const localRight = dx * Math.cos(pHeading) - dz * Math.sin(pHeading);
  const pan = clamp(localRight / 6.0, -0.95, 0.95);

  let vRadial = 0;
  if (dist > 1e-4) {
    const ux = dx / dist;
    const uz = dz / dist;
    vRadial = -((nvx - pvx) * ux + (nvz - pvz) * uz);
  }
  const dopplerRatio = clamp(DOPPLER_C_EFF / (DOPPLER_C_EFF - clamp(vRadial, -65, 65)), 0.62, 1.55);
  const relSpeed = Math.hypot(nvx - pvx, nvz - pvz);
  const distNorm = dist / 5.5;
  const distGain = clamp(1 / (1 + distNorm * distNorm) - 0.036, 0, 1);
  const prof = NPC_ACOUSTIC_PROFILE[kind];
  const gain = clamp(distGain * prof.gain * (0.65 + Math.min(0.65, relSpeed / 22)), 0, 0.35);
  const whoosh = dist < 9.5 && relSpeed > 10 ? clamp((1 - dist / 9.5) * ((relSpeed - 10) / 18), 0, 1) : 0;

  return {
    active: gain > 0.002,
    dist,
    pan,
    gain,
    dopplerRatio,
    relSpeed,
    whoosh,
  };
}

export interface SpatialSlotAssignment {
  slot: number;
  id: number;
  kind: NpcKind;
  doppler: DopplerVoice;
}

interface CandidateEntry {
  id: number;
  kind: NpcKind;
  score: number;
  doppler: DopplerVoice;
}

const _candPool: CandidateEntry[] = [];

/**
 * Selects up to `maxSlots` highest-priority passing NPCs using retention hysteresis
 * and preserves slot indices for active IDs so voices do not jump across oscillators.
 */
export function selectSpatialTrafficSlots(
  npcs: readonly NpcView[],
  px: number,
  pz: number,
  pHeading: number,
  pvx: number,
  pvz: number,
  simDt: number,
  maxSlots: number,
  prevIds: readonly number[],
): SpatialSlotAssignment[] {
  if (maxSlots <= 0 || npcs.length === 0) return [];
  const dt = Number.isFinite(simDt) && simDt > 1e-4 ? simDt : 1 / 60;
  const maxDistSq = MAX_SPATIAL_DIST * MAX_SPATIAL_DIST;
  _candPool.length = 0;

  for (let i = 0; i < npcs.length; i++) {
    const n = npcs[i];
    const dx = n.x - px;
    const dz = n.z - pz;
    if (dx * dx + dz * dz > maxDistSq) continue;
    const nvx = (n.x - n.prevX) / dt;
    const nvz = (n.z - n.prevZ) / dt;
    const doppler = computeDopplerVoice(px, pz, pHeading, pvx, pvz, n.x, n.z, nvx, nvz, n.kind);
    if (!doppler.active) continue;

    let retained = false;
    for (let s = 0; s < prevIds.length; s++) {
      if (prevIds[s] === n.id) {
        retained = true;
        break;
      }
    }
    const score = doppler.gain * (retained ? 1.18 : 1.0);
    _candPool.push({ id: n.id, kind: n.kind, score, doppler });
  }

  if (_candPool.length === 0) return [];
  _candPool.sort((a, b) => b.score - a.score);

  const count = Math.min(maxSlots, _candPool.length);
  const slotTaken = new Array<boolean>(maxSlots).fill(false);
  const chosenAssigned = new Array<boolean>(count).fill(false);
  const out: SpatialSlotAssignment[] = [];

  // First pass: keep existing IDs in their previous slots cleanly.
  for (let c = 0; c < count; c++) {
    const cand = _candPool[c];
    const prevSlot = prevIds.indexOf(cand.id);
    if (prevSlot >= 0 && prevSlot < maxSlots && !slotTaken[prevSlot]) {
      slotTaken[prevSlot] = true;
      chosenAssigned[c] = true;
      out.push({ slot: prevSlot, id: cand.id, kind: cand.kind, doppler: cand.doppler });
    }
  }

  // Second pass: place newly entered top candidates into free slots.
  let freeCursor = 0;
  for (let c = 0; c < count; c++) {
    if (chosenAssigned[c]) continue;
    while (freeCursor < maxSlots && slotTaken[freeCursor]) freeCursor++;
    if (freeCursor >= maxSlots) break;
    slotTaken[freeCursor] = true;
    const cand = _candPool[c];
    out.push({ slot: freeCursor, id: cand.id, kind: cand.kind, doppler: cand.doppler });
  }

  out.sort((a, b) => a.slot - b.slot);
  return out;
}

export interface HornStep {
  readonly freqs: readonly [number, number, number];
  readonly dur: number;
  readonly gain: number;
}

export interface HornSequenceDef {
  readonly id: HornId;
  readonly waveform: OscillatorType;
  readonly formantHz: number;
  readonly formantQ: number;
  readonly steps: readonly HornStep[];
}

export const HORN_SEQUENCES: Readonly<Record<HornId, HornSequenceDef>> = {
  stock: {
    id: 'stock',
    waveform: 'square',
    formantHz: 1300,
    formantQ: 0.85,
    steps: [{ freqs: [415, 498, 0], dur: 1.0, gain: 0.32 }],
  },
  'rickshaw-beep': {
    id: 'rickshaw-beep',
    waveform: 'square',
    formantHz: 1650,
    formantQ: 1.4,
    steps: [
      { freqs: [540, 675, 0], dur: 0.11, gain: 0.30 },
      { freqs: [0, 0, 0], dur: 0.075, gain: 0 },
      { freqs: [540, 675, 0], dur: 0.11, gain: 0.30 },
      { freqs: [0, 0, 0], dur: 0.24, gain: 0 },
    ],
  },
  'air-horn': {
    id: 'air-horn',
    waveform: 'sawtooth',
    formantHz: 960,
    formantQ: 0.9,
    steps: [{ freqs: [233.08, 293.66, 349.23], dur: 1.0, gain: 0.36 }],
  },
  'pak-melody': {
    id: 'pak-melody',
    waveform: 'sawtooth',
    formantHz: 1220,
    formantQ: 1.05,
    // Iconic festive Pakistani Bedford truck air-horn phrase (C5 - D5 - E5 - G5 - E5 - C5).
    steps: [
      { freqs: [523.25, 526.0, 0], dur: 0.13, gain: 0.31 },
      { freqs: [587.33, 590.2, 0], dur: 0.13, gain: 0.31 },
      { freqs: [659.25, 662.4, 0], dur: 0.15, gain: 0.32 },
      { freqs: [783.99, 787.5, 0], dur: 0.24, gain: 0.34 },
      { freqs: [659.25, 662.4, 0], dur: 0.14, gain: 0.31 },
      { freqs: [523.25, 526.0, 0], dur: 0.30, gain: 0.33 },
      { freqs: [0, 0, 0], dur: 0.18, gain: 0 },
    ],
  },
};

export type RadioStationId = 'dhol' | 'lyari' | 'clifton' | 'off';

export const RADIO_STATION_ORDER: readonly RadioStationId[] = ['dhol', 'lyari', 'clifton', 'off'] as const;

export interface RadioStationMeta {
  readonly id: RadioStationId;
  readonly label: string;
  readonly hudLabel: string;
  readonly toastLabel: string;
  readonly baseBpm: number;
  readonly maxFeverBpm: number;
  readonly rhythm: readonly number[];
  readonly melody: readonly number[];
}

export const RADIO_STATIONS: Readonly<Record<RadioStationId, RadioStationMeta>> = {
  dhol: {
    id: 'dhol',
    label: 'Karachi Dhol FM',
    hudLabel: 'FM 101 DHOL',
    toastLabel: 'FM 101 · DHOL FM',
    baseBpm: 126,
    maxFeverBpm: 140,
    // 1 = Dha (bayan + slap), 2 = Dhin (bayan), 3 = Ta/Na (rim), 4 = Tin (soft rim), 0 = rest.
    rhythm: [1, 0, 4, 3, 2, 0, 3, 4, 1, 3, 0, 2, 3, 0, 4, 3],
    // Sindhi/Karachi Benjo folk melody in D Mixolydian (0 = sustain/rest).
    melody: [
      293.66, 0, 329.63, 369.99, 392.0, 0, 440.0, 392.0,
      369.99, 329.63, 293.66, 0, 261.63, 293.66, 329.63, 0,
      392.0, 0, 440.0, 523.25, 493.88, 440.0, 392.0, 369.99,
      329.63, 369.99, 329.63, 293.66, 261.63, 293.66, 293.66, 0,
    ],
  },
  lyari: {
    id: 'lyari',
    label: 'Lyari Street Beats FM',
    hudLabel: 'FM 104 LYARI',
    toastLabel: 'FM 104 · LYARI BEATS',
    baseBpm: 112,
    maxFeverBpm: 126,
    // 1 = 808 kick, 2 = snare crack, 3 = kick+hat, 4 = crisp closed hat, 0 = rest.
    rhythm: [1, 4, 4, 3, 2, 4, 1, 4, 1, 4, 3, 4, 2, 4, 3, 2],
    // E Bhairavi / Phrygian coastal street bass + synth stab line.
    melody: [
      82.41, 0, 87.31, 0, 98.0, 0, 110.0, 87.31,
      82.41, 0, 82.41, 110.0, 123.47, 110.0, 98.0, 87.31,
      82.41, 0, 164.81, 0, 174.61, 164.81, 130.81, 123.47,
      110.0, 0, 98.0, 87.31, 82.41, 0, 73.42, 0,
    ],
  },
  clifton: {
    id: 'clifton',
    label: 'Clifton Night Cruise FM',
    hudLabel: 'FM 98 CLIFTON',
    toastLabel: 'FM 98 · CLIFTON NIGHTS',
    baseBpm: 102,
    maxFeverBpm: 114,
    // 1 = soft thump kick, 2 = mellow rim/clap, 3 = tabla tap, 4 = breeze hat.
    rhythm: [1, 4, 3, 4, 2, 4, 3, 4, 1, 4, 1, 3, 2, 4, 3, 4],
    // A minor dreamy nocturnal synthwave arp.
    melody: [
      220.0, 261.63, 329.63, 440.0, 392.0, 329.63, 261.63, 220.0,
      174.61, 220.0, 261.63, 349.23, 329.63, 261.63, 220.0, 174.61,
      196.0, 246.94, 293.66, 392.0, 349.23, 293.66, 246.94, 196.0,
      164.81, 196.0, 246.94, 329.63, 293.66, 246.94, 220.0, 0,
    ],
  },
  off: {
    id: 'off',
    label: 'Radio Off',
    hudLabel: 'OFF',
    toastLabel: 'RADIO OFF',
    baseBpm: 0,
    maxFeverBpm: 0,
    rhythm: [],
    melody: [],
  },
};
