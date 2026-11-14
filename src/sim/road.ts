import { clamp, lerp, smoothstep } from './math';
import type { NpcKind } from './types';

/**
 * Static route definition: one continuous carriageway running along +z,
 * split into three zones. Pure data + pure functions (deterministic).
 */

export interface ZoneDef {
  name: string;
  banner: string;
  start: number;
  end: number;
  lanes: number;
  laneWidth: number;
  /** width of the dirt/service shoulder on the LEFT (drivable) */
  shoulder: number;
  /** player top speed in m/s */
  topSpeed: number;
  elevated: boolean;
  /** metres of road per NPC inside the spawn window */
  trafficSpacing: number;
  trafficWeights: Partial<Record<NpcKind, number>>;
  /** chance that a spawned bike rides wrong-way on the shoulder */
  wrongWayBikeChance: number;
}

export const ZONES: readonly ZoneDef[] = [
  {
    name: 'Saddar / M.A. Jinnah Road',
    banner: 'SADDAR · M.A. JINNAH ROAD',
    start: 0,
    end: 1100,
    lanes: 3,
    laneWidth: 3.3,
    shoulder: 2.6,
    topSpeed: 23.6, // 85 km/h
    elevated: false,
    trafficSpacing: 24,
    trafficWeights: { bike: 30, rickshaw: 22, car: 16, minibus: 14, cart: 12, truck: 3 },
    wrongWayBikeChance: 0.10,
  },
  {
    name: 'Lyari Expressway',
    banner: 'ENTERING LYARI EXPRESSWAY',
    start: 1100,
    end: 2900,
    lanes: 4,
    laneWidth: 3.6,
    shoulder: 1.4,
    topSpeed: 36.1, // 130 km/h
    elevated: true,
    trafficSpacing: 32,
    trafficWeights: { car: 44, truck: 18, minibus: 14, bike: 10, rickshaw: 4 },
    wrongWayBikeChance: 0,
  },
  {
    name: 'Shahrah-e-Faisal / Clifton',
    banner: 'SHAHRAH-E-FAISAL · CLIFTON',
    start: 2900,
    end: 4300,
    lanes: 4,
    laneWidth: 3.4,
    shoulder: 2.2,
    topSpeed: 27.8, // 100 km/h
    elevated: false,
    trafficSpacing: 25,
    trafficWeights: { car: 40, bike: 22, minibus: 16, rickshaw: 14, truck: 5, cart: 3 },
    wrongWayBikeChance: 0.05,
  },
];

export const ROUTE_END = ZONES[ZONES.length - 1].end;
export const FINISH_Z = 4220;
/** Length over which width / speed limits blend between zones. */
const BLEND = 80;
/** Height of the elevated expressway deck. */
export const DECK_HEIGHT = 8;
const RAMP = 170;

export function zoneIndexAt(z: number): number {
  for (let i = ZONES.length - 1; i >= 0; i--) if (z >= ZONES[i].start) return i;
  return 0;
}

export interface RoadSample {
  zoneIndex: number;
  lanes: number;
  /** x of the left kerb of the carriageway (shoulder lies beyond this) */
  left: number;
  /** x of the right edge (median barrier) */
  right: number;
  laneWidth: number;
  shoulder: number;
  topSpeed: number;
  elevation: number;
}

function zoneWidth(z: ZoneDef): number {
  return z.lanes * z.laneWidth;
}

/** Blend factor toward the next zone near a boundary. */
function blendInfo(z: number): { a: ZoneDef; b: ZoneDef; t: number } {
  const i = zoneIndexAt(z);
  const cur = ZONES[i];
  const next = ZONES[Math.min(i + 1, ZONES.length - 1)];
  const prev = ZONES[Math.max(i - 1, 0)];
  // Blend centred on the boundary.
  if (z < cur.start + BLEND / 2 && i > 0) {
    return { a: prev, b: cur, t: smoothstep(cur.start - BLEND / 2, cur.start + BLEND / 2, z) };
  }
  if (z > cur.end - BLEND / 2 && i < ZONES.length - 1) {
    return { a: cur, b: next, t: smoothstep(cur.end - BLEND / 2, cur.end + BLEND / 2, z) };
  }
  return { a: cur, b: cur, t: 0 };
}

export function elevationAt(z: number): number {
  let h = 0;
  for (const zone of ZONES) {
    if (!zone.elevated) continue;
    h += DECK_HEIGHT * smoothstep(zone.start, zone.start + RAMP, z);
    h -= DECK_HEIGHT * smoothstep(zone.end, zone.end + RAMP, z);
  }
  return h;
}

export function sampleRoad(z: number): RoadSample {
  const { a, b, t } = blendInfo(z);
  const width = lerp(zoneWidth(a), zoneWidth(b), t);
  const zoneIndex = zoneIndexAt(z);
  const lanes = ZONES[zoneIndex].lanes;
  return {
    zoneIndex,
    lanes,
    left: -width / 2,
    right: width / 2,
    laneWidth: width / lanes,
    shoulder: lerp(a.shoulder, b.shoulder, t),
    topSpeed: lerp(a.topSpeed, b.topSpeed, t),
    elevation: elevationAt(z),
  };
}

export function laneCenter(road: RoadSample, lane: number): number {
  const l = clamp(lane, 0, road.lanes - 1);
  return road.left + (l + 0.5) * road.laneWidth;
}

export function laneAt(road: RoadSample, x: number): number {
  return clamp(Math.floor((x - road.left) / road.laneWidth), 0, road.lanes - 1);
}
