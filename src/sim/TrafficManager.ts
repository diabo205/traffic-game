import type { HazardManager } from './HazardManager';
import { approach, clamp } from './math';
import type { PlayerCar } from './PlayerCar';
import { Rng } from './rng';
import { ZONES, laneAt, laneCenter, sampleRoad, zoneIndexAt } from './road';
import type { NpcKind, Obb } from './types';

interface KindSpec {
  hw: number;
  hl: number;
  mass: number;
  /** cruise speed range per zone index, m/s */
  cruise: readonly (readonly [number, number])[];
  accel: number;
  decel: number;
  /** lateral speed for normal lane changes, m/s */
  latSpeed: number;
  /** collision damage multiplier against the player */
  damage: number;
}

export const NPC_SPECS: Readonly<Record<NpcKind, KindSpec>> = {
  bike: {
    hw: 0.42, hl: 0.98, mass: 170,
    cruise: [[10, 14.5], [19, 25], [14, 19]],
    accel: 3.2, decel: 7, latSpeed: 2.2, damage: 1.1,
  },
  minibus: {
    // Karachi coaster-type minibus: ~7.4 m x 2.2 m.
    hw: 1.12, hl: 3.75, mass: 6000,
    cruise: [[15, 19], [23, 27], [19, 23]],
    accel: 1.9, decel: 6.5, latSpeed: 1.2, damage: 2.6,
  },
  rickshaw: {
    hw: 0.72, hl: 1.45, mass: 450,
    cruise: [[8.5, 12], [13, 16], [10.5, 13.5]],
    accel: 2.2, decel: 6, latSpeed: 2.8, damage: 1.6,
  },
  cart: {
    hw: 0.72, hl: 1.9, mass: 500,
    cruise: [[1.4, 2.6], [1.4, 2.6], [1.6, 2.6]],
    accel: 0.6, decel: 3, latSpeed: 0.5, damage: 1.5,
  },
  car: {
    hw: 0.88, hl: 2.25, mass: 1250,
    cruise: [[13, 17.5], [25, 33], [20, 26]],
    accel: 2.8, decel: 7.5, latSpeed: 1.6, damage: 2.1,
  },
  truck: {
    hw: 1.28, hl: 4.1, mass: 9000,
    cruise: [[9, 12.5], [18, 22], [15, 18.5]],
    accel: 1.3, decel: 5.5, latSpeed: 0.9, damage: 2.8,
  },
};

export type NpcState = 'cruise' | 'stopping' | 'stopped' | 'dart';

export interface Npc {
  id: number;
  kind: NpcKind;
  x: number;
  z: number;
  /** +1 = with traffic, -1 = wrong-way */
  dir: 1 | -1;
  /** forward speed along dir, >= 0 */
  speed: number;
  /** lateral velocity this tick (for heading / collisions) */
  latVel: number;
  heading: number;
  targetX: number;
  latSpeed: number;
  /** 0..1, where in the kind's cruise range this driver sits */
  temperament: number;
  state: NpcState;
  /** generic countdown for the current state, seconds */
  stateTimer: number;
  /** countdown to the next behaviour decision */
  thinkTimer: number;
  hazardLights: boolean;
  brakeLights: boolean;
  /** cosmetic variant for the renderer */
  variant: number;
  /** cooldown for horn/dipper reactions, seconds */
  reactCooldown: number;
  /** last tick the player hit this NPC */
  lastHitTick: number;
  /** time spent blocked behind something, seconds */
  blockedTime: number;
  /** z the NPC must stop before (solid obstacle in its path) */
  stopZ: number;

  prevX: number;
  prevZ: number;
  prevHeading: number;
}

/** Spawn window relative to the player. */
const AHEAD_MIN = 150;
const AHEAD_MAX = 240;
const BEHIND_DESPAWN = 70;
const AHEAD_DESPAWN = 330;
const MAX_NPCS = 34;

export class TrafficManager {
  readonly npcs: Npc[] = [];
  private nextId = 1;
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x2545f491);
  }

  reset(playerZ: number): void {
    this.npcs.length = 0;
    // Pre-populate the visible window so the road isn't empty at start.
    for (let z = playerZ + 30; z < playerZ + AHEAD_MAX; z += 8) {
      const zone = ZONES[zoneIndexAt(z)];
      if (this.rng.chance(8 / zone.trafficSpacing)) this.trySpawn(z, 0);
    }
  }

  static obb(n: Npc): Obb {
    const s = NPC_SPECS[n.kind];
    return { x: n.x, z: n.z, hw: s.hw, hl: s.hl, heading: n.heading };
  }

  private cruiseSpeed(n: Npc, zoneIndex: number): number {
    const [lo, hi] = NPC_SPECS[n.kind].cruise[zoneIndex];
    return lo + (hi - lo) * n.temperament;
  }

  private trySpawn(z: number, playerSpeed: number, forceBehind = false): Npc | null {
    const rng = this.rng;
    const zi = zoneIndexAt(z);
    const zone = ZONES[zi];
    const road = sampleRoad(z);
    const kind = rng.weighted(zone.trafficWeights);
    const spec = NPC_SPECS[kind];

    let dir: 1 | -1 = 1;
    let x: number;
    if (kind === 'bike' && !forceBehind && rng.chance(zone.wrongWayBikeChance)) {
      // Wrong-way rider along the left shoulder.
      dir = -1;
      x = road.left - road.shoulder * 0.45;
    } else if (kind === 'cart') {
      // Carts hug the left / middle lanes.
      x = laneCenter(road, rng.chance(0.7) ? 0 : 1) - road.laneWidth * 0.15;
    } else if (kind === 'truck' || kind === 'minibus') {
      x = laneCenter(road, rng.int(0, Math.max(0, road.lanes - 2)));
    } else if (kind === 'bike') {
      x = rng.range(road.left + 0.6, road.right - 0.6);
    } else {
      x = laneCenter(road, rng.int(0, road.lanes - 1));
    }

    const temperament = rng.next();
    const [lo, hi] = spec.cruise[zi];
    let speed = dir < 0 ? rng.range(5, 8) : lo + (hi - lo) * temperament;
    if (forceBehind && speed < playerSpeed + 4) return null;

    // Keep a free bubble around the spawn point.
    for (const o of this.npcs) {
      const os = NPC_SPECS[o.kind];
      if (Math.abs(o.z - z) < spec.hl + os.hl + 8 && Math.abs(o.x - x) < spec.hw + os.hw + 0.6) return null;
    }

    const n: Npc = {
      id: this.nextId++,
      kind,
      x,
      z,
      dir,
      speed,
      latVel: 0,
      heading: dir > 0 ? 0 : Math.PI,
      targetX: x,
      latSpeed: spec.latSpeed,
      temperament,
      state: 'cruise',
      stateTimer: 0,
      thinkTimer: rng.range(0.5, 3),
      hazardLights: false,
      brakeLights: false,
      variant: rng.int(0, 7),
      reactCooldown: 0,
      lastHitTick: -1e9,
      blockedTime: 0,
      stopZ: Infinity,
      prevX: x,
      prevZ: z,
      prevHeading: dir > 0 ? 0 : Math.PI,
    };
    if (kind === 'minibus') n.stateTimer = rng.range(5, 12); // time until next sudden stop
    this.npcs.push(n);
    return n;
  }

  /** Is the corridor around `x` free of other vehicles between z-back and z+ahead? */
  private corridorClear(self: Npc, x: number, back: number, ahead: number, player: PlayerCar): boolean {
    const spec = NPC_SPECS[self.kind];
    for (const o of this.npcs) {
      if (o === self) continue;
      const os = NPC_SPECS[o.kind];
      const dz = (o.z - self.z) * self.dir;
      if (dz < -back - os.hl || dz > ahead + os.hl) continue;
      if (Math.abs(o.x - x) < spec.hw + os.hw + 0.4) return false;
    }
    const pdz = (player.z - self.z) * self.dir;
    if (pdz > -back - 2 && pdz < ahead + 2 && Math.abs(player.x - x) < spec.hw + 0.74 + 0.5) return false;
    return true;
  }

  update(dt: number, player: PlayerCar, hazards: HazardManager, tick: number): void {
    const rng = this.rng;

    // ---- Spawn / despawn -------------------------------------------------
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      const rel = n.z - player.z;
      if (rel < -BEHIND_DESPAWN || rel > AHEAD_DESPAWN) this.npcs.splice(i, 1);
    }
    const zone = ZONES[zoneIndexAt(player.z + 120)];
    const target = Math.min(MAX_NPCS, Math.round((AHEAD_MAX + 40) / zone.trafficSpacing));
    if (this.npcs.length < target) {
      // High-speed overtakers from behind on the expressway.
      if (zone.elevated && rng.chance(0.25) && player.speed > 12) {
        this.trySpawn(player.z - 55, player.speed, true);
      } else {
        this.trySpawn(player.z + rng.range(AHEAD_MIN, AHEAD_MAX), player.speed);
      }
    }

    // ---- Behaviour + motion ----------------------------------------------
    for (const n of this.npcs) {
      n.prevX = n.x;
      n.prevZ = n.z;
      n.prevHeading = n.heading;
      this.think(n, dt, player, hazards, tick);
      this.move(n, dt, player);
    }
  }

  private think(n: Npc, dt: number, player: PlayerCar, hazards: HazardManager, _tick: number): void {
    const rng = this.rng;
    const road = sampleRoad(n.z);
    const minX = road.left - road.shoulder + NPC_SPECS[n.kind].hw;
    const maxX = road.right - NPC_SPECS[n.kind].hw - 0.2;
    n.thinkTimer -= dt;
    n.reactCooldown -= dt;

    // Player relation (only meaningful for same-direction traffic).
    const behindDist = (n.z - player.z) * n.dir; // >0: player is behind me
    const playerSignal = player.horn || player.dipper;
    const playerBehindClose = n.dir > 0 && behindDist > 2 && behindDist < 32 && Math.abs(player.x - n.x) < 3;

    switch (n.kind) {
      case 'bike': {
        if (n.dir < 0) {
          // Wrong-way rider: keep to the shoulder with a little wobble.
          if (n.thinkTimer <= 0) {
            n.targetX = clamp(road.left - road.shoulder * 0.45 + rng.range(-0.5, 0.9), minX, road.left + 1.2);
            n.thinkTimer = rng.range(1, 2.5);
          }
          // Dodge the player when close and on a collision course.
          const ahead = (player.z - n.z) * -1; // >0 if player ahead of me (in -z)
          if (ahead > 0 && ahead < 18 && Math.abs(player.x - n.x) < 1.6 && n.reactCooldown <= 0) {
            n.targetX = clamp(n.x + (player.x > n.x ? -1.4 : 1.4), minX, maxX);
            n.reactCooldown = 1.2;
          }
          break;
        }
        if (playerSignal && playerBehindClose && n.reactCooldown <= 0) {
          // Swerve slightly away from the honking car.
          const away = player.x > n.x ? -1 : 1;
          n.targetX = clamp(n.x + away * rng.range(1.0, 1.8), minX, maxX);
          n.latSpeed = 3.2;
          n.reactCooldown = 1.5;
          n.thinkTimer = 1.5;
        } else if (n.thinkTimer <= 0) {
          // Weave through traffic.
          const tx = clamp(n.x + rng.range(-2.4, 2.4), road.left + 0.3, maxX);
          if (this.corridorClear(n, tx, 3, 10, player)) n.targetX = tx;
          n.latSpeed = rng.range(1.5, 2.8);
          n.thinkTimer = rng.range(1.0, 2.8);
        }
        break;
      }
      case 'minibus': {
        if (n.state === 'cruise') {
          n.stateTimer -= dt;
          if (n.stateTimer <= 0) {
            n.state = 'stopping';
            n.hazardLights = true;
            // Sometimes pull toward the left kerb, often just stop dead in lane.
            if (rng.chance(0.35)) n.targetX = laneCenter(road, 0);
          }
        } else if (n.state === 'stopped') {
          n.stateTimer -= dt;
          if (n.stateTimer <= 0) {
            n.state = 'cruise';
            n.stateTimer = rng.range(7, 15);
          }
        }
        if (n.state === 'cruise' && n.hazardLights && n.speed > 6) n.hazardLights = false;
        break;
      }
      case 'rickshaw': {
        if (n.state === 'dart') {
          n.stateTimer -= dt;
          if (n.stateTimer <= 0) {
            n.state = 'cruise';
            n.latSpeed = NPC_SPECS.rickshaw.latSpeed;
          }
        } else if (n.thinkTimer <= 0) {
          if (rng.chance(0.18)) {
            // Sudden sharp turn toward the kerb, no indicator, slows hard.
            n.state = 'dart';
            n.stateTimer = rng.range(1.8, 3);
            n.targetX = clamp(road.left - road.shoulder * 0.3, minX, maxX);
            n.latSpeed = 5.5;
          } else {
            const lane = laneAt(road, n.x) + (rng.chance(0.5) ? -1 : 1);
            const tx = clamp(laneCenter(road, lane) + rng.range(-0.6, 0.6), road.left + 0.5, maxX);
            // Erratic, unsignalled — but never straight into an occupied space.
            if (this.corridorClear(n, tx, 2, 5, player)) {
              n.targetX = tx;
              n.latSpeed = rng.range(2.4, 4.2);
            }
          }
          n.thinkTimer = rng.range(1.4, 3.4);
        }
        break;
      }
      case 'cart': {
        if (n.thinkTimer <= 0) {
          n.targetX = clamp(n.targetX + rng.range(-0.25, 0.25), road.left + 0.5, laneCenter(road, 1));
          n.thinkTimer = rng.range(2, 4);
        }
        break;
      }
      case 'car':
      case 'truck': {
        // Karachi etiquette: flash the dipper and the car ahead moves over.
        if (player.dipper && playerBehindClose && n.reactCooldown <= 0 && n.kind === 'car') {
          n.reactCooldown = 3;
          const lane = laneAt(road, n.x);
          for (const d of [-1, 1]) {
            const l = lane + d;
            if (l < 0 || l >= road.lanes) continue;
            const tx = laneCenter(road, l);
            if (this.corridorClear(n, tx, 8, 14, player)) {
              n.targetX = tx;
              break;
            }
          }
        }
        // Change lanes when stuck behind something slow.
        if (n.blockedTime > (n.kind === 'truck' ? 4 : 1.6) && n.thinkTimer <= 0) {
          const lane = laneAt(road, n.x);
          const order = rng.chance(0.5) ? [1, -1] : [-1, 1];
          for (const d of order) {
            const l = lane + d;
            if (l < 0 || l >= road.lanes) continue;
            const tx = laneCenter(road, l);
            if (this.corridorClear(n, tx, 10, 20, player)) {
              n.targetX = tx;
              n.blockedTime = 0;
              break;
            }
          }
          n.thinkTimer = rng.range(0.8, 1.6);
        }
        // Re-centre in lane after zone width changes.
        if (Math.abs(n.targetX - n.x) < 0.05 && n.thinkTimer <= 0) {
          n.targetX = laneCenter(road, laneAt(road, n.x));
          n.thinkTimer = rng.range(1, 2);
        }
        break;
      }
    }

    // Solid obstacles (VIP roadblocks, construction barriers): steer around
    // them, and queue in front of them while still blocked.
    n.stopZ = Infinity;
    if (n.dir > 0) {
      const hw = NPC_SPECS[n.kind].hw;
      const rb = hazards.roadblockAhead(n.z, 80);
      if (rb) {
        const inGap = n.targetX - hw > rb.openMin && n.targetX + hw < rb.openMax;
        if (!inGap) n.targetX = clamp(rb.openX, rb.openMin + hw, rb.openMax - hw);
        n.latSpeed = Math.max(n.latSpeed, 1.6);
      }
      const hl = NPC_SPECS[n.kind].hl;
      hazards.forEachInRange(n.z, n.z + 45, (h) => {
        if (!h.solid) return;
        const front = h.z - h.hl - hl;
        if (front < n.z - 0.5) return;
        const overlaps = (x: number) => Math.abs(x - h.x) < h.hw + hw + 0.3;
        if (overlaps(n.targetX) && h.roadblock < 0) {
          // Go around on whichever side has more room.
          const leftRoom = h.x - h.hw - road.left;
          const rightRoom = road.right - (h.x + h.hw);
          n.targetX = leftRoom > rightRoom ? h.x - h.hw - hw - 0.5 : h.x + h.hw + hw + 0.5;
          n.latSpeed = Math.max(n.latSpeed, 1.8);
        }
        if (overlaps(n.x)) n.stopZ = Math.min(n.stopZ, front - 1);
      });
    }

    n.targetX = clamp(n.targetX, minX, maxX);
  }

  private move(n: Npc, dt: number, player: PlayerCar): void {
    const spec = NPC_SPECS[n.kind];
    const zi = zoneIndexAt(n.z);
    let desired = n.dir > 0 ? this.cruiseSpeed(n, zi) : n.speed;

    if (n.kind === 'minibus' && (n.state === 'stopping' || n.state === 'stopped')) desired = 0;
    if (n.kind === 'rickshaw' && n.state === 'dart') desired = Math.min(desired, 3);

    // Car following: nearest obstacle ahead in my corridor.
    const look = 6 + n.speed * 1.8;
    let gap = Infinity;
    let leadSpeed = 0;
    for (const o of this.npcs) {
      if (o === n) continue;
      const os = NPC_SPECS[o.kind];
      const dz = (o.z - n.z) * n.dir;
      if (dz <= 0 || dz > look + os.hl) continue;
      if (Math.abs(o.x - n.x) > spec.hw + os.hw + 0.25) continue;
      const g = dz - spec.hl - os.hl;
      if (g < gap) {
        gap = g;
        leadSpeed = o.dir === n.dir ? o.speed : -o.speed;
      }
    }
    const pdz = (player.z - n.z) * n.dir;
    if (pdz > 0 && pdz < look + 2 && Math.abs(player.x - n.x) < spec.hw + 0.74 + 0.25) {
      const g = pdz - spec.hl - 1.7;
      if (g < gap) {
        gap = g;
        leadSpeed = player.speed * Math.cos(player.travel) * n.dir;
      }
    }
    if (gap < Infinity) {
      const minGap = n.kind === 'bike' || n.kind === 'rickshaw' ? 1.2 : 2.5;
      const allowed = Math.max(0, leadSpeed + (gap - minGap) * 0.7);
      if (allowed < desired) {
        desired = allowed;
        n.blockedTime += dt;
      } else n.blockedTime = Math.max(0, n.blockedTime - dt);
    } else n.blockedTime = Math.max(0, n.blockedTime - dt);

    if (n.stopZ < Infinity) {
      const toStop = (n.stopZ - n.z) * n.dir;
      desired = Math.min(desired, Math.max(0, toStop * 0.6));
    }

    const rate = desired > n.speed ? spec.accel : n.kind === 'minibus' && n.state === 'stopping' ? 7 : spec.decel;
    n.speed = Math.max(0, approach(n.speed, desired, rate * dt));
    n.brakeLights = desired < n.speed - 0.3 || n.speed < 0.5;

    if (n.kind === 'minibus' && n.state === 'stopping' && n.speed < 0.2) {
      n.state = 'stopped';
      n.stateTimer = this.rng.range(2, 4);
    }

    // Lateral.
    const prevX = n.x;
    const latRate = n.latSpeed * Math.min(1, 0.5 + n.speed / 8); // can't strafe when stopped
    n.x = approach(n.x, n.targetX, latRate * dt);
    n.latVel = (n.x - prevX) / dt;
    n.z += n.dir * n.speed * dt;

    const base = n.dir > 0 ? 0 : Math.PI;
    const yawTarget = Math.atan2(n.latVel, Math.max(n.speed, 2)) * n.dir;
    n.heading = base + (n.heading - base) + (yawTarget - (n.heading - base)) * Math.min(1, dt * 8);
  }
}
