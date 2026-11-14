import { LevelManager } from '../LevelManager';
import type { RunStats } from '../LevelManager';
import { clamp, obbOverlap, pointObbDistance } from '../math';
import { ALTO, PlayerCar } from '../PlayerCar';
import { NPC_SPECS } from '../TrafficManager';
import type { GameOverReason, GamePhase, InputFrame, NpcView, Obb, SimEvent } from '../types';
import { cityMap } from './cityMap';
import type { CityMap, Rect } from './cityMap';
import { CityTraffic } from './CityTraffic';

const RESTITUTION = 0.25;
const HIT_COOLDOWN = 36;
/** City top speed for the Alto (m/s, ~100 km/h). */
const CITY_TOP_SPEED = 27.8;

/** Run state with the same shape the HUD reads from the route LevelManager. */
class CityLevel {
  phase: GamePhase = 'ready';
  reason: GameOverReason = null;
  stats: RunStats = LevelManager.emptyStats();
  readonly timeLeft = 0;
  readonly progress = 0;
}

/**
 * Open-world Saddar: free driving on a street grid with junctions, a
 * roundabout, solid buildings, kerbs and graph-following traffic.
 * Same contract as the route World: fixed-step, deterministic, no DOM/three.
 */
export class CityWorld {
  readonly mode = 'city' as const;
  readonly seed: number;
  readonly map: CityMap;
  tick = 0;
  readonly player = new PlayerCar();
  readonly traffic: CityTraffic;
  readonly level = new CityLevel();
  private events: SimEvent[] = [];
  private onRoad = true;
  private lastKerbTick = -1e9;
  private lastWallHitTick = -1e9;
  private street = '';
  private streetCandidate = '';
  private streetTicks = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.map = cityMap();
    this.traffic = new CityTraffic(this.seed, this.map);
    // Start on Abdullah Haroon Road, just north of the Empress Market roundabout, heading north.
    const start = this.map.links.find((l) => l.name === 'Abdullah Haroon Road' && l.dz > 0.5 && this.map.nodes[l.from].roundabout);
    if (start) {
      const p = this.map.linkPoint(start, 8, this.map.laneOffset(start, start.lanes - 1));
      this.player.reset(p.x, p.z, start.heading);
    } else this.player.reset(0, 0, 0);
    this.player.freeRoam = true;
    this.traffic.reset(this.player.x, this.player.z);
  }

  get phase(): GamePhase {
    return this.level.phase;
  }

  get npcs(): readonly NpcView[] {
    return this.traffic.npcs;
  }

  groundY(x: number, z: number): number {
    return this.map.groundY(x, z);
  }

  topSpeed(): number {
    return CITY_TOP_SPEED;
  }

  speedRush(): number {
    return clamp((this.player.speed - 18) / 12, 0, 1) * 0.6;
  }

  start(): void {
    if (this.level.phase !== 'ready') return;
    this.level.phase = 'running';
    this.events.push({ type: 'zone', zoneIndex: -1, name: 'Saddar', banner: 'SADDAR · FREE ROAM' });
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
      for (const n of this.traffic.npcs) {
        n.prevX = n.x;
        n.prevZ = n.z;
        n.prevHeading = n.heading;
      }
      return;
    }
    const running = this.level.phase === 'running';
    p.update(input, CITY_TOP_SPEED, 1 / 60, running);
    this.staticCollisions();
    this.kerbs();
    this.traffic.update(1 / 60, p);
    this.trafficCollisions();
    this.streetName();

    if (running) {
      const st = this.level.stats;
      st.elapsed += 1 / 60;
      st.topSpeed = Math.max(st.topSpeed, Math.max(0, p.speed));
      if (p.integrity <= 0) {
        this.level.phase = 'gameover';
        this.level.reason = 'wrecked';
        this.events.push({ type: 'gameover', reason: 'wrecked' });
      }
    }
  }

  // ---------------------------------------------------------------------------

  private staticCollisions(): void {
    const p = this.player;
    // Two passes resolve corners where two buildings meet.
    for (let pass = 0; pass < 2; pass++) {
      this.map.forEachSolidNear(p.x, p.z, 6, (r) => this.solid(rectObb(r)));
      for (const isl of this.map.islands) this.circle(isl.x, isl.z, isl.r);
    }
  }

  private solid(box: Obb): void {
    const p = this.player;
    const mtv = obbOverlap(p.obb(), box);
    if (!mtv) return;
    p.x += mtv.nx * mtv.depth;
    p.z += mtv.nz * mtv.depth;
    this.bounce(mtv.nx, mtv.nz, p.x - mtv.nx * ALTO.halfWidth, p.z - mtv.nz * ALTO.halfWidth);
  }

  private circle(cx: number, cz: number, r: number): void {
    const p = this.player;
    const d = pointObbDistance(cx, cz, p.obb());
    if (d >= r) return;
    let nx = p.x - cx, nz = p.z - cz;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    p.x += nx * (r - d);
    p.z += nz * (r - d);
    this.bounce(nx, nz, cx + nx * r, cz + nz * r);
  }

  /** Reflect the velocity off a surface with normal n and apply crash damage. */
  private bounce(nx: number, nz: number, hx: number, hz: number): void {
    const p = this.player;
    const { vx, vz } = p.velocity();
    const rel = vx * nx + vz * nz;
    if (rel >= 0) return;
    const j = -(1 + RESTITUTION) * rel;
    p.setVelocity(vx + nx * j, vz + nz * j);
    const impact = -rel;
    if (impact > 3 && this.tick - this.lastWallHitTick > HIT_COOLDOWN) {
      this.lastWallHitTick = this.tick;
      const dmg = Math.min(30, (impact - 3) * 1.7);
      this.damage(dmg);
      this.level.stats.crashes++;
      p.kick(-0.3);
      this.events.push({ type: 'crash', impact, damage: dmg, x: hx, z: hz });
    } else if (impact > 1 && this.tick - this.lastWallHitTick > 6) {
      this.events.push({ type: 'scrape', intensity: clamp(Math.abs(p.speed) / 25, 0.1, 1) });
    }
  }

  /** Mounting / dropping off a kerb jolts the car. */
  private kerbs(): void {
    const p = this.player;
    const road = this.map.isRoad(p.x, p.z);
    if (road !== this.onRoad) {
      const v = Math.abs(p.speed);
      if (v > 2 && this.tick - this.lastKerbTick > 12) {
        this.lastKerbTick = this.tick;
        const severity = clamp(v / 22, 0.1, 1);
        p.kick(road ? -0.25 * severity : -0.45 * severity);
        p.speed *= road ? 0.99 : 0.96;
        this.events.push({ type: 'kerb', severity });
      }
      this.onRoad = road;
    }
    // Pavements are busier and rougher than the road.
    if (!road) p.extraDrag = 0.5;
  }

  private trafficCollisions(): void {
    const p = this.player;
    for (const n of this.traffic.npcs) {
      if (Math.abs(n.z - p.z) > 10 || Math.abs(n.x - p.x) > 10) continue;
      const box = CityTraffic.obb(n);
      const mtv = obbOverlap(p.obb(), box);
      if (!mtv) continue;
      const spec = NPC_SPECS[n.kind];
      const mr = spec.mass / (spec.mass + ALTO.mass);
      p.x += mtv.nx * mtv.depth * mr;
      p.z += mtv.nz * mtv.depth * mr;
      n.kx -= mtv.nx * mtv.depth * (1 - mr);
      n.kz -= mtv.nz * mtv.depth * (1 - mr);
      n.x -= mtv.nx * mtv.depth * (1 - mr);
      n.z -= mtv.nz * mtv.depth * (1 - mr);

      const { vx, vz } = p.velocity();
      const nvx = Math.sin(n.heading) * n.speed;
      const nvz = Math.cos(n.heading) * n.speed;
      const rel = (vx - nvx) * mtv.nx + (vz - nvz) * mtv.nz;
      if (rel >= 0) continue;
      const j = -(1 + RESTITUTION) * rel;
      p.setVelocity(vx + mtv.nx * j * mr, vz + mtv.nz * j * mr);
      // The NPC gets shoved and loses speed along the hit.
      const shove = j * (1 - mr);
      n.kx -= mtv.nx * shove * 0.35;
      n.kz -= mtv.nz * shove * 0.35;
      n.speed = Math.max(0, n.speed - shove * 0.8);

      const impact = -rel;
      if (impact > 1.5 && this.tick - n.lastHitTick > HIT_COOLDOWN) {
        n.lastHitTick = this.tick;
        const dmg = Math.min(40, (impact - 1.5) * spec.damage * 1.1);
        this.damage(dmg);
        this.level.stats.crashes++;
        p.kick(-0.2 - Math.min(0.4, impact * 0.02));
        this.events.push({ type: 'crash', impact, damage: dmg, x: (p.x + n.x) / 2, z: (p.z + n.z) / 2 });
      }
    }
  }

  /** Announce the street once the player has been on it for a moment. */
  private streetName(): void {
    if (this.tick % 10 !== 0 || this.level.phase !== 'running') return;
    const p = this.player;
    const l = this.map.linkAt(p.x, p.z, p.heading);
    const name = l ? l.name : '';
    if (name === this.streetCandidate) this.streetTicks += 10;
    else {
      this.streetCandidate = name;
      this.streetTicks = 0;
    }
    if (name && name !== this.street && this.streetTicks >= 60) {
      this.street = name;
      this.events.push({ type: 'street', name });
    }
  }
}

function rectObb(r: Rect): Obb {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, hw: (r.x1 - r.x0) / 2, hl: (r.z1 - r.z0) / 2, heading: 0 };
}
