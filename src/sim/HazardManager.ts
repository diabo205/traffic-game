import { Rng } from './rng';
import { FINISH_Z, ZONES, laneCenter, sampleRoad } from './road';
import type { HazardKind, Obb } from './types';

export interface Hazard {
  id: number;
  kind: HazardKind;
  x: number;
  z: number;
  /** half extents; potholes/manholes use hw as radius */
  hw: number;
  hl: number;
  heading: number;
  /** solid hazards block movement (barriers) */
  solid: boolean;
  /** roadblock this barrier belongs to, -1 if none */
  roadblock: number;
  /** last tick the player triggered this hazard */
  lastHitTick: number;
}

export interface Roadblock {
  id: number;
  /** z of the first barrier row; a second row sits at z + ROW_GAP */
  z: number;
  openMin: number;
  openMax: number;
  /** x of the open gap's centre */
  openX: number;
}

export const ROADBLOCK_ROW_GAP = 11;

/** Keep hazards clear of these z ranges (ramps, checkpoint gates, start). */
const KEEP_CLEAR: ReadonlyArray<readonly [number, number]> = [
  [-50, 120],
  [1080, 1290],
  [2880, 3090],
  [FINISH_Z - 40, FINISH_Z + 200],
];

interface ZoneHazardPlan {
  potholeEvery: [number, number];
  manholeEvery: [number, number] | null;
  waterEvery: [number, number] | null;
  barrierEvery: [number, number] | null;
  roadblockEvery: [number, number] | null;
}

const PLANS: readonly ZoneHazardPlan[] = [
  // Saddar: potholes, open manholes, monsoon puddles, construction.
  {
    potholeEvery: [36, 62],
    manholeEvery: [170, 260],
    waterEvery: [190, 290],
    barrierEvery: [240, 350],
    roadblockEvery: null,
  },
  // Lyari Expressway: smoother; no carts, no manholes.
  {
    potholeEvery: [110, 190],
    manholeEvery: null,
    waterEvery: [460, 680],
    barrierEvery: null,
    roadblockEvery: null,
  },
  // Shahrah-e-Faisal / Clifton: VIP protocol checkpoints.
  {
    potholeEvery: [70, 120],
    manholeEvery: null,
    waterEvery: [280, 400],
    barrierEvery: null,
    roadblockEvery: [380, 480],
  },
];

export class HazardManager {
  readonly hazards: Hazard[] = [];
  readonly roadblocks: Roadblock[] = [];
  private nextId = 1;

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x9e3779b9);
    ZONES.forEach((zone, i) => this.generateZone(rng, zone.start, zone.end, PLANS[i]));
    this.hazards.sort((a, b) => a.z - b.z || a.id - b.id);
  }

  private clear(z: number, margin = 0): boolean {
    for (const [a, b] of KEEP_CLEAR) if (z > a - margin && z < b + margin) return false;
    for (const rb of this.roadblocks) {
      if (z > rb.z - 25 - margin && z < rb.z + ROADBLOCK_ROW_GAP + 25 + margin) return false;
    }
    return true;
  }

  private add(h: Omit<Hazard, 'id' | 'lastHitTick'>): void {
    this.hazards.push({ ...h, id: this.nextId++, lastHitTick: -1e9 });
  }

  private generateZone(rng: Rng, start: number, end: number, plan: ZoneHazardPlan): void {
    // Roadblocks first so other hazards keep clear of them.
    if (plan.roadblockEvery) {
      for (let z = start + rng.range(...plan.roadblockEvery) * 0.6; z < end - 60; z += rng.range(...plan.roadblockEvery)) {
        if (!this.clear(z, 10)) continue;
        this.addRoadblock(rng, z);
      }
    }
    for (let z = start + rng.range(...plan.potholeEvery); z < end; z += rng.range(...plan.potholeEvery)) {
      if (!this.clear(z)) continue;
      const road = sampleRoad(z);
      // Clusters of 1-3 potholes.
      const n = rng.chance(0.3) ? rng.int(2, 3) : 1;
      for (let k = 0; k < n; k++) {
        const r = rng.range(0.45, 0.95);
        this.add({
          kind: 'pothole',
          x: rng.range(road.left + 0.8, road.right - 0.8),
          z: z + k * rng.range(1.5, 3),
          hw: r,
          hl: r * rng.range(0.7, 1.2),
          heading: rng.range(0, Math.PI),
          solid: false,
          roadblock: -1,
        });
      }
    }
    if (plan.manholeEvery) {
      for (let z = start + rng.range(...plan.manholeEvery); z < end; z += rng.range(...plan.manholeEvery)) {
        if (!this.clear(z, 4)) continue;
        const road = sampleRoad(z);
        const lane = rng.int(0, road.lanes - 1);
        this.add({
          kind: 'manhole',
          x: laneCenter(road, lane) + rng.range(-0.6, 0.6),
          z,
          hw: 0.42,
          hl: 0.42,
          heading: 0,
          solid: false,
          roadblock: -1,
        });
      }
    }
    if (plan.waterEvery) {
      for (let z = start + rng.range(...plan.waterEvery); z < end; z += rng.range(...plan.waterEvery)) {
        if (!this.clear(z, 8)) continue;
        const road = sampleRoad(z);
        // Puddles collect on the left (gutter side) more often.
        const width = rng.range(3.5, 7.5);
        const leftBias = rng.chance(0.6);
        const x = leftBias ? road.left + width / 2 - 0.5 : rng.range(road.left + width / 2, road.right - width / 2);
        this.add({
          kind: 'water',
          x,
          z,
          hw: width / 2,
          hl: rng.range(4, 9),
          heading: 0,
          solid: false,
          roadblock: -1,
        });
      }
    }
    if (plan.barrierEvery) {
      for (let z = start + rng.range(...plan.barrierEvery); z < end; z += rng.range(...plan.barrierEvery)) {
        if (!this.clear(z, 10)) continue;
        const road = sampleRoad(z);
        // Construction barrier sticking into one outer lane.
        const fromLeft = rng.chance(0.55);
        const w = road.laneWidth * rng.range(0.55, 0.95);
        this.add({
          kind: 'barrier',
          x: fromLeft ? road.left + w / 2 : road.right - w / 2,
          z,
          hw: w / 2,
          hl: rng.range(1.2, 3.5),
          heading: 0,
          solid: true,
          roadblock: -1,
        });
      }
    }
  }

  private addRoadblock(rng: Rng, z: number): void {
    const road = sampleRoad(z);
    const open = rng.int(0, road.lanes - 1);
    const id = this.roadblocks.length;
    const openMin = road.left + open * road.laneWidth;
    const openMax = openMin + road.laneWidth;
    this.roadblocks.push({ id, z, openMin, openMax, openX: (openMin + openMax) / 2 });
    const leftEdge = road.left - road.shoulder;
    for (const rowZ of [z, z + ROADBLOCK_ROW_GAP]) {
      // Barrier segment left of the gap (spans shoulder + closed left lanes).
      const pad = 0.15;
      if (openMin - leftEdge > 0.5) {
        const w = openMin - leftEdge - pad;
        this.add({
          kind: 'checkpoint',
          x: leftEdge + w / 2,
          z: rowZ,
          hw: w / 2,
          hl: 0.45,
          heading: 0,
          solid: true,
          roadblock: id,
        });
      }
      if (road.right - openMax > 0.5) {
        const w = road.right - openMax - pad;
        this.add({
          kind: 'checkpoint',
          x: road.right - w / 2,
          z: rowZ,
          hw: w / 2,
          hl: 0.45,
          heading: 0,
          solid: true,
          roadblock: id,
        });
      }
    }
  }

  /** Index of first hazard with z >= minZ (binary search). */
  private lowerBound(minZ: number): number {
    let lo = 0, hi = this.hazards.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.hazards[mid].z < minZ) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Visit hazards whose z lies within [minZ, maxZ]. */
  forEachInRange(minZ: number, maxZ: number, fn: (h: Hazard) => void): void {
    for (let i = this.lowerBound(minZ); i < this.hazards.length; i++) {
      const h = this.hazards[i];
      if (h.z > maxZ) break;
      fn(h);
    }
  }

  /** The next roadblock ahead of z within `range`, or null. */
  roadblockAhead(z: number, range: number): Roadblock | null {
    for (const rb of this.roadblocks) {
      if (rb.z + ROADBLOCK_ROW_GAP + 2 >= z && rb.z - z <= range) return rb;
    }
    return null;
  }

  static obb(h: Hazard): Obb {
    return { x: h.x, z: h.z, hw: h.hw, hl: h.hl, heading: h.heading };
  }
}
