import { HazardManager } from './HazardManager';
import type { Hazard } from './HazardManager';
import { LevelManager } from './LevelManager';
import { clamp, obbOverlap, pointObbDistance } from './math';
import { MOVES, PlayerCar, WALL } from './PlayerCar';
import { ZONES, elevationAt, sampleRoad } from './road';
import { NPC_SPECS, TrafficManager } from './TrafficManager';
import type { InputFrame, NpcView, PlayerVehicle, SimEvent } from './types';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Restitution for car-vs-thing impacts. */
const RESTITUTION = 0.25;
/** Hits closer together than this (ticks) don't stack damage. */
const HIT_COOLDOWN = 36;
/** Max fraction of the zone top speed you can hold while grinding the barrier. */
const BARRIER_RIDE_CAP = 0.6;
/** Extra rolling drag on the dirt shoulder (m/s^2): caps you around 75% of zone speed. */
const SHOULDER_DRAG = 2.0;
/** Player-vs-traffic bounce: lower than walls so a rear-end doesn't fling you backwards. */
const TRAFFIC_RESTITUTION = 0.1;

/**
 * Damage from hitting traffic. Soft at city-traffic closing speeds (a
 * nudge at 15 km/h is a few HP), still brutal for a head-on at speed.
 */
export function trafficDamage(impact: number, kindDamage: number): number {
  if (impact <= 2.5) return 0;
  const x = impact - 2.5;
  return Math.min(22, x * (0.22 + x * 0.036) * kindDamage);
}

/**
 * The whole game state. Advance with step() at a fixed rate; read the public
 * fields to render. Contains no Three.js / DOM references.
 */
export class World {
  readonly seed: number;
  tick = 0;
  readonly player = new PlayerCar();
  readonly hazards: HazardManager;
  readonly traffic: TrafficManager;
  readonly level = new LevelManager();
  /** Events since the last drainEvents() call. */
  private events: SimEvent[] = [];

  private onWater = false;
  private lastWallHitTick = -1e9;
  private lastScrapeTick = -1e9;

  /** @param startZ debug: start further along the route (default 0). */
  constructor(seed: number, startZ = 0, vehicle: PlayerVehicle = 'alto') {
    this.seed = seed >>> 0;
    this.player.setVehicle(vehicle);
    this.hazards = new HazardManager(this.seed);
    this.traffic = new TrafficManager(this.seed);
    const road = sampleRoad(startZ);
    // Start in the middle lane.
    this.player.reset(road.left + road.laneWidth * 1.5, startZ, 0, elevationAt(startZ));
    this.traffic.reset(startZ);
    if (startZ > 0) {
      this.level.zoneIndex = road.zoneIndex;
      this.level.skipTo(startZ);
    }
  }

  readonly mode = 'route' as const;

  get phase() {
    return this.level.phase;
  }

  get npcs(): readonly NpcView[] {
    return this.traffic.npcs;
  }

  /** Ground height under a point (renderer / audio helper). */
  groundY(_x: number, z: number): number {
    return elevationAt(z);
  }

  topSpeed(): number {
    return sampleRoad(this.player.z).topSpeed * this.player.spec.topSpeedMul;
  }

  /** 0..1 camera speed-rush on the expressway. */
  speedRush(): number {
    const rush = ZONES[sampleRoad(this.player.z).zoneIndex].elevated ? clamp((this.player.speed - 18) / 14, 0, 1) : 0;
    return Math.max(rush, this.player.boostTime > 0 ? 1 : 0);
  }

  start(): void {
    if (this.level.phase === 'ready') {
      this.level.phase = 'running';
      const zi = this.level.zoneIndex;
      const zone = ZONES[zi];
      this.events.push({ type: 'zone', zoneIndex: zi, name: zone.name, banner: zone.banner });
    }
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private damage(amount: number): void {
    if (amount <= 0 || this.level.phase !== 'running') return;
    const scaled = amount * this.player.spec.damageRes;
    this.player.integrity = Math.max(0, this.player.integrity - scaled);
    this.level.stats.damageTaken += scaled;
  }

  step(input: InputFrame): void {
    this.tick++;
    const p = this.player;
    p.savePrev();
    if (this.level.phase === 'ready') {
      // Frozen until the player starts; keep NPC prev == current.
      for (const n of this.traffic.npcs) {
        n.prevX = n.x;
        n.prevZ = n.z;
        n.prevHeading = n.heading;
      }
      return;
    }

    const running = this.level.phase === 'running';
    const road = sampleRoad(p.z);

    this.applySurface();
    p.update(input, road.topSpeed * p.spec.topSpeedMul, DT, running);
    if (p.boostFired) this.events.push({ type: 'boost', kind: p.boostFired });
    if (p.driftEnded > 1) this.events.push({ type: 'drift', seconds: p.driftEnded });
    p.settle(elevationAt(p.z), DT);
    this.constrainToRoad();
    this.pinnedHint();
    if (running) this.hazardContacts(input);
    this.traffic.update(DT, p, this.hazards, this.tick);
    this.trafficCollisions();

    const prevCp = this.level.nextCheckpoint;
    this.level.update(DT, p.z, Math.max(0, p.speed), p.integrity, this.events);
    if (this.level.nextCheckpoint > prevCp && running) p.integrity = Math.min(100, p.integrity + 15);
  }

  // ---------------------------------------------------------------------

  private applySurface(): void {
    const p = this.player;
    const box = p.obb();
    let wet = false;
    this.hazards.forEachInRange(p.z - 12, p.z + 12, (h) => {
      if (h.kind === 'water' && obbOverlap(box, HazardManager.obb(h))) wet = true;
    });
    if (wet) {
      const v = Math.abs(p.speed);
      // Hydroplaning: grip falls away the faster you hit the water.
      p.traction = clamp(0.6 - v * 0.018, 0.07, 0.6);
      p.extraDrag = 0.9 + v * 0.06;
      if (!this.onWater && v > 6) this.events.push({ type: 'splash' });
    }
    this.onWater = wet;
    // The dirt shoulder is rough: drivable for dodging, never the fast line.
    const road = sampleRoad(p.z);
    if (p.x < road.left - p.spec.halfWidth * 0.5) p.extraDrag += SHOULDER_DRAG;
  }

  private constrainToRoad(): void {
    const p = this.player;
    const road = sampleRoad(p.z);
    const reach = p.spec.halfWidth * Math.abs(Math.cos(p.heading)) + p.spec.halfLength * Math.abs(Math.sin(p.heading));
    const minX = road.left - road.shoulder + reach;
    const maxX = road.right - 0.25 - reach;
    let side = 0;
    if (p.x < minX) {
      p.x = minX;
      side = -1;
    } else if (p.x > maxX) {
      p.x = maxX;
      side = 1;
    }
    if (p.z < -15) {
      p.z = -15;
      if (p.speed < 0) p.speed = 0;
    }
    if (side === 0) return;

    const { vx, vz } = p.velocity();
    const into = vx * side; // >0 = moving into the wall
    // Grinding along the barrier is a scrape, not a fresh crash every time you lean on it.
    const fresh = p.wallContact === 0;
    p.wallContact = WALL.memoryTicks;
    if (into > 0) {
      // Kill the push into the barrier, keep the speed along it, and swing
      // the nose parallel so a graze slides instead of grabbing the car.
      p.setVelocity(-vx * 0.15, vz);
      p.scrapeWall(-side, 0);
      if (fresh && into > 4 && this.tick - this.lastWallHitTick > HIT_COOLDOWN) {
        const dmg = (into - 4) * 1.8;
        this.damage(dmg);
        this.lastWallHitTick = this.tick;
        this.level.stats.crashes++;
        this.events.push({ type: 'crash', impact: into, damage: dmg, x: p.x + side * 0.8, z: p.z });
        p.kick(-0.25);
      }
    }
    // Riding the barrier is never the fast line: grinding caps you well
    // below lane speed (no free traffic-proof wall ride).
    const cap = sampleRoad(p.z).topSpeed * BARRIER_RIDE_CAP;
    if (p.speed > cap) p.speed -= (p.speed - cap) * 0.2;
    if (Math.abs(vz) > 3 && this.tick - this.lastScrapeTick > 6) {
      this.lastScrapeTick = this.tick;
      this.events.push({ type: 'scrape', intensity: clamp(Math.abs(vz) / 25, 0.1, 1) });
    }
  }

  private pinnedTicks = 0;
  /** Nose against a wall, gas held, not moving: tell the player to back up (once per pin). */
  private pinnedHint(): void {
    const t = this.player.pinnedTime;
    if (t >= MOVES.pinnedHint && this.pinnedTicks === 0) this.events.push({ type: 'pinned' });
    this.pinnedTicks = t >= MOVES.pinnedHint ? 1 : 0;
  }

  private hazardContacts(input: InputFrame): void {
    const p = this.player;
    this.hazards.forEachInRange(p.z - 8, p.z + 8, (h) => {
      switch (h.kind) {
        case 'pothole':
          this.pothole(h, input);
          break;
        case 'manhole':
          this.manhole(h);
          break;
        case 'barrier':
        case 'checkpoint':
          this.solid(h);
          break;
        case 'water':
          break;
      }
    });
  }

  private pothole(h: Hazard, input: InputFrame): void {
    const p = this.player;
    if (this.tick - h.lastHitTick < 90) return;
    if (pointObbDistance(h.x, h.z, p.obb()) > h.hw * 0.55) return;
    h.lastHitTick = this.tick;
    const v = Math.abs(p.speed);
    const severity = clamp(v / 20, 0.15, 1);
    p.kick(-0.55 * severity - 0.08);
    p.speed *= 1 - 0.05 * severity;
    let dmg = 0;
    if (v > 7 && input.brake < 0.35) {
      dmg = Math.round(2 + 3 * clamp((v - 7) / 18, 0, 1));
      this.damage(dmg);
    }
    this.level.stats.potholes++;
    this.events.push({ type: 'pothole', severity, damage: dmg });
  }

  private manhole(h: Hazard): void {
    const p = this.player;
    if (this.tick - h.lastHitTick < 120) return;
    if (pointObbDistance(h.x, h.z, p.obb()) > h.hw * 0.8) return;
    h.lastHitTick = this.tick;
    const v = Math.abs(p.speed);
    // Hurts and jolts, without cheap one-shot wipes.
    const dmg = v > 3 ? Math.round(4 + 5 * clamp(v / 25, 0, 1)) : 2;
    this.damage(dmg);
    p.kick(-1.3);
    p.speed *= 0.78;
    this.level.stats.manholes++;
    this.events.push({ type: 'manhole', damage: dmg });
  }

  private solid(h: Hazard): void {
    const p = this.player;
    const mtv = obbOverlap(p.obb(), HazardManager.obb(h));
    if (!mtv) return;
    p.x += mtv.nx * mtv.depth;
    p.z += mtv.nz * mtv.depth;
    p.wallContact = WALL.memoryTicks;
    const { vx, vz } = p.velocity();
    const rel = vx * mtv.nx + vz * mtv.nz;
    if (rel >= 0) return;
    const j = -(1 + RESTITUTION) * rel;
    p.setVelocity(vx + mtv.nx * j, vz + mtv.nz * j);
    // Nudge nose slightly toward the open side of the road so edge barrier clips don't glue you.
    if (Math.abs(mtv.nz) > 0.5 && Math.abs(vx) < 2) {
      const road = sampleRoad(p.z);
      const nearLeft = h.x - h.hw < road.left - road.shoulder + 2.8;
      const nearRight = h.x + h.hw > road.right - 2.8;
      const awayX = nearLeft ? 1 : nearRight ? -1 : p.x >= h.x ? 1 : -1;
      p.x += awayX * 0.08;
      p.heading += awayX * 0.14;
      p.setVelocity(vx + awayX * 2.2, vz * 0.85);
    } else {
      p.scrapeWall(mtv.nx, mtv.nz);
    }
    const impact = -rel;
    if (impact > 2 && this.tick - h.lastHitTick > HIT_COOLDOWN && this.tick - this.lastWallHitTick > HIT_COOLDOWN) {
      h.lastHitTick = this.tick;
      this.lastWallHitTick = this.tick;
      const dmg = Math.min(35, (impact - 2) * 2.3);
      this.damage(dmg);
      this.level.stats.crashes++;
      p.kick(-0.3);
      this.events.push({ type: 'crash', impact, damage: dmg, x: p.x - mtv.nx, z: p.z - mtv.nz });
    }
  }

  private trafficCollisions(): void {
    const p = this.player;
    for (const n of this.traffic.npcs) {
      if (Math.abs(n.z - p.z) > 10) continue;
      const box = TrafficManager.obb(n);
      const mtv = obbOverlap(p.obb(), box);
      if (!mtv) continue;
      // A stopped bus is a wall too: allow the pivot and the STUCK hint.
      if (n.speed < 1.5) p.wallContact = WALL.memoryTicks;
      const spec = NPC_SPECS[n.kind];
      // Mass share: how much of the correction the player takes.
      const mr = spec.mass / (spec.mass + p.spec.mass);
      p.x += mtv.nx * mtv.depth * mr;
      p.z += mtv.nz * mtv.depth * mr;
      n.x -= mtv.nx * mtv.depth * (1 - mr);
      n.z -= mtv.nz * mtv.depth * (1 - mr);
      n.targetX -= mtv.nx * mtv.depth * (1 - mr);

      const { vx, vz } = p.velocity();
      const nvx = n.latVel;
      const nvz = n.dir * n.speed;
      const rel = (vx - nvx) * mtv.nx + (vz - nvz) * mtv.nz;
      if (rel >= 0) continue;
      const j = -(1 + TRAFFIC_RESTITUTION) * rel;
      p.setVelocity(vx + mtv.nx * j * mr, vz + mtv.nz * j * mr);
      const newNvz = nvz - mtv.nz * j * (1 - mr);
      n.speed = Math.max(0, newNvz * n.dir);
      n.targetX -= mtv.nx * j * (1 - mr) * 0.3;

      const impact = -rel;
      if (impact > 1.5 && this.tick - n.lastHitTick > HIT_COOLDOWN) {
        n.lastHitTick = this.tick;
        const dmg = trafficDamage(impact, spec.damage);
        this.damage(dmg);
        this.level.stats.crashes++;
        p.kick(-0.2 - Math.min(0.4, impact * 0.02));
        this.events.push({
          type: 'crash',
          impact,
          damage: dmg,
          x: (p.x + n.x) / 2,
          z: (p.z + n.z) / 2,
        });
      }
    }
  }
}
