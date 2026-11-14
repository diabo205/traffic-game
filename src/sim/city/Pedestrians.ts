import type { PlayerCar } from '../PlayerCar';
import { Rng } from '../rng';
import type { SimEvent } from '../types';
import type { CityMap } from './cityMap';

export interface KerbSpot {
  x: number;
  z: number;
  /** unit vector pointing deeper into the pavement (away from road) */
  inX: number;
  inZ: number;
  heading: number;
}

export interface Pedestrian {
  id: number;
  homeX: number;
  homeZ: number;
  inX: number;
  inZ: number;
  x: number;
  z: number;
  /** height offset above pavement (dive hop) */
  y: number;
  facing: number;
  variant: number;
  state: 'idle' | 'dive';
  diveTimer: number;
  diveVx: number;
  diveVz: number;
  phase: number;
  cooldown: number;
}

const TARGET_COUNT = 22;
const SPAWN_MIN = 22;
const SPAWN_MAX = 165;
const DESPAWN = 195;

/**
 * Ambient sidewalk shoppers along Saddar kerbs who leap away when you mount
 * the pavement or lay on the horn (Crazy Taxi rule: nobody ever gets hit).
 * Pure & deterministic.
 */
export class Pedestrians {
  readonly peds: Pedestrian[] = [];
  private readonly spots: KerbSpot[] = [];
  private readonly rng: Rng;
  private nextId = 1;

  constructor(seed: number, map: CityMap) {
    this.rng = new Rng(seed ^ 0x51a7);
    for (const l of map.links) {
      if (l.turnaround || l.len < 22) continue;
      // Left side pavement offset: l.hw + 1.1m inside kerb.
      const off = l.hw + 1.1;
      // Outward pavement direction for Pakistan left-side offset: (-l.dz, l.dx)
      const inX = -l.dz;
      const inZ = l.dx;
      for (let s = 8; s < l.len - 6; s += 16) {
        const p = map.linkPoint(l, s, off);
        if (map.isRoad(p.x, p.z) || map.nearRoad(p.x, p.z, 0.5)) continue;
        this.spots.push({ x: p.x, z: p.z, inX, inZ, heading: l.heading });
      }
    }
  }

  reset(px: number, pz: number): void {
    this.peds.length = 0;
    for (let k = 0; k < 60 && this.peds.length < TARGET_COUNT; k++) this.spawn(px, pz);
  }

  private spawn(px: number, pz: number): void {
    if (this.spots.length === 0) return;
    const sp = this.spots[this.rng.int(0, this.spots.length - 1)];
    const d = Math.hypot(sp.x - px, sp.z - pz);
    if (d < SPAWN_MIN || d > SPAWN_MAX) return;
    if (this.peds.some((p) => Math.hypot(p.homeX - sp.x, p.homeZ - sp.z) < 9)) return;
    this.peds.push({
      id: this.nextId++,
      homeX: sp.x,
      homeZ: sp.z,
      inX: sp.inX,
      inZ: sp.inZ,
      x: sp.x,
      z: sp.z,
      y: 0,
      facing: sp.heading + this.rng.range(-0.6, 0.6),
      variant: this.rng.int(0, 7),
      state: 'idle',
      diveTimer: 0,
      diveVx: 0,
      diveVz: 0,
      phase: this.rng.range(0, 6.28),
      cooldown: 0,
    });
  }

  update(dt: number, player: PlayerCar, events: SimEvent[]): void {
    const px = player.x, pz = player.z;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const pd = this.peds[i];
      if (Math.hypot(pd.homeX - px, pd.homeZ - pz) > DESPAWN) this.peds.splice(i, 1);
    }
    if (this.peds.length < TARGET_COUNT) {
      for (let k = 0; k < 4 && this.peds.length < TARGET_COUNT; k++) this.spawn(px, pz);
    }

    const v = Math.abs(player.speed);
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let dodged = 0;

    for (const pd of this.peds) {
      pd.phase += dt * 2.5;
      if (pd.cooldown > 0) pd.cooldown = Math.max(0, pd.cooldown - dt);

      if (pd.state === 'dive') {
        pd.diveTimer -= dt;
        const arc = Math.max(0, Math.sin((1 - Math.max(0, pd.diveTimer) / 0.8) * Math.PI));
        pd.y = arc * 0.65;
        const t = Math.max(0, pd.diveTimer) / 0.8;
        if (pd.diveTimer > 0.25) {
          pd.x += pd.diveVx * dt;
          pd.z += pd.diveVz * dt;
        } else {
          // Ease back toward pavement spot after landing.
          pd.x += (pd.homeX - pd.x) * Math.min(1, dt * 3);
          pd.z += (pd.homeZ - pd.z) * Math.min(1, dt * 3);
        }
        if (t <= 0) {
          pd.state = 'idle';
          pd.y = 0;
          pd.x = pd.homeX;
          pd.z = pd.homeZ;
        }
        continue;
      }

      // Trigger jump/dive when player barrels close or blasts the horn nearby.
      const dx = pd.x - px, dz = pd.z - pz;
      const d = Math.hypot(dx, dz);
      const ahead = dx * fx + dz * fz;
      const alertRange = player.horn ? 14 : v > 9 ? 9.5 : 5.5;
      if (d < alertRange && pd.cooldown <= 0 && (ahead > -2 || d < 4.5) && (v > 3.5 || player.horn)) {
        // Leap perpendicular/into sidewalk away from car.
        const awayX = dx / Math.max(d, 0.1), awayZ = dz / Math.max(d, 0.1);
        const dirX = awayX * 0.45 + pd.inX * 0.85;
        const dirZ = awayZ * 0.45 + pd.inZ * 0.85;
        const len = Math.hypot(dirX, dirZ) || 1;
        pd.state = 'dive';
        pd.diveTimer = 0.8;
        pd.diveVx = (dirX / len) * 4.4;
        pd.diveVz = (dirZ / len) * 4.4;
        pd.facing = Math.atan2(pd.diveVx, -pd.diveVz) + Math.PI;
        pd.cooldown = 3.0;
        if (v > 10 && d < 6.5) dodged++;
      }
    }

    if (dodged > 0) events.push({ type: 'pedDodge', count: dodged });
  }
}
