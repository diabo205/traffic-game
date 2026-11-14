import { HazardManager } from './HazardManager';
import type { Hazard } from './HazardManager';
import { LevelManager } from './LevelManager';
import { clamp, obbOverlap, pointObbDistance } from './math';
import { ALTO, PlayerCar } from './PlayerCar';
import { ZONES, elevationAt, sampleRoad } from './road';
import { NPC_SPECS, TrafficManager } from './TrafficManager';
import type { InputFrame, NpcView, SimEvent } from './types';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Restitution for car-vs-thing impacts. */
const RESTITUTION = 0.25;
/** Hits closer together than this (ticks) don't stack damage. */
const HIT_COOLDOWN = 36;

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
  constructor(seed: number, startZ = 0) {
    this.seed = seed >>> 0;
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
    return sampleRoad(this.player.z).topSpeed;
  }

  /** 0..1 camera speed-rush on the expressway. */
  speedRush(): number {
    const rush = ZONES[sampleRoad(this.player.z).zoneIndex].elevated ? clamp((this.player.speed - 20) / 14, 0, 1) : 0;
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
    this.player.integrity = Math.max(0, this.player.integrity - amount);
    this.level.stats.damageTaken += amount;
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
    p.update(input, road.topSpeed, DT, running);
    if (p.boostFired) this.events.push({ type: 'boost', kind: p.boostFired });
    if (p.driftEnded > 1) this.events.push({ type: 'drift', seconds: p.driftEnded });
    p.settle(elevationAt(p.z), DT);
    this.constrainToRoad();
    this.hazardContacts(input);
    this.traffic.update(DT, p, this.hazards, this.tick);
    this.trafficCollisions();

    this.level.update(DT, p.z, Math.max(0, p.speed), p.integrity, this.events);
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
  }

  private constrainToRoad(): void {
    const p = this.player;
    const road = sampleRoad(p.z);
    const reach = ALTO.halfWidth * Math.abs(Math.cos(p.heading)) + ALTO.halfLength * Math.abs(Math.sin(p.heading));
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
    if (into > 0) {
      p.setVelocity(-vx * 0.15, vz * 0.97);
      p.heading *= 0.75;
      if (into > 4 && this.tick - this.lastWallHitTick > HIT_COOLDOWN) {
        const dmg = (into - 4) * 1.8;
        this.damage(dmg);
        this.lastWallHitTick = this.tick;
        this.level.stats.crashes++;
        this.events.push({ type: 'crash', impact: into, damage: dmg, x: p.x + side * 0.8, z: p.z });
        p.kick(-0.25);
      }
    }
    if (Math.abs(vz) > 3 && this.tick - this.lastScrapeTick > 6) {
      this.lastScrapeTick = this.tick;
      this.events.push({ type: 'scrape', intensity: clamp(Math.abs(vz) / 25, 0.1, 1) });
      p.speed *= 0.985;
    }
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
      dmg = Math.round(3 + 5 * clamp((v - 7) / 18, 0, 1));
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
    const dmg = v > 3 ? Math.round(10 + 10 * clamp(v / 25, 0, 1)) : 3;
    this.damage(dmg);
    p.kick(-1.3);
    p.speed *= 0.5;
    this.level.stats.manholes++;
    this.events.push({ type: 'manhole', damage: dmg });
  }

  private solid(h: Hazard): void {
    const p = this.player;
    const mtv = obbOverlap(p.obb(), HazardManager.obb(h));
    if (!mtv) return;
    p.x += mtv.nx * mtv.depth;
    p.z += mtv.nz * mtv.depth;
    const { vx, vz } = p.velocity();
    const rel = vx * mtv.nx + vz * mtv.nz;
    if (rel >= 0) return;
    const j = -(1 + RESTITUTION) * rel;
    p.setVelocity(vx + mtv.nx * j, vz + mtv.nz * j);
    const impact = -rel;
    if (impact > 2 && this.tick - h.lastHitTick > HIT_COOLDOWN) {
      h.lastHitTick = this.tick;
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
      const spec = NPC_SPECS[n.kind];
      // Mass share: how much of the correction the player takes.
      const mr = spec.mass / (spec.mass + ALTO.mass);
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
      const j = -(1 + RESTITUTION) * rel;
      p.setVelocity(vx + mtv.nx * j * mr, vz + mtv.nz * j * mr);
      const newNvz = nvz - mtv.nz * j * (1 - mr);
      n.speed = Math.max(0, newNvz * n.dir);
      n.targetX -= mtv.nx * j * (1 - mr) * 0.3;

      const impact = -rel;
      if (impact > 1.5 && this.tick - n.lastHitTick > HIT_COOLDOWN) {
        n.lastHitTick = this.tick;
        const dmg = Math.min(40, (impact - 1.5) * spec.damage * 1.1);
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
