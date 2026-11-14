import { LevelManager } from '../LevelManager';
import type { RunStats } from '../LevelManager';
import { clamp, obbOverlap, pointObbDistance } from '../math';
import { ALTO, PlayerCar } from '../PlayerCar';
import { NPC_SPECS } from '../TrafficManager';
import type { GameOverReason, GamePhase, InputFrame, NpcView, Obb, SimEvent } from '../types';
import { cityMap } from './cityMap';
import type { CityMap, Rect } from './cityMap';
import { CityTraffic } from './CityTraffic';
import { Fares } from './Fares';
import { Props } from './Props';
import { Stunts } from './Stunts';

const RESTITUTION = 0.25;
const HIT_COOLDOWN = 36;
/** City top speed for the Alto (m/s, ~100 km/h). */
const CITY_TOP_SPEED = 27.8;
/** Rough NPC roof heights, for jumping over traffic. */
const NPC_HEIGHT: Readonly<Record<string, number>> = { bike: 1.3, minibus: 2.9, rickshaw: 1.9, cart: 1.3, car: 1.5, truck: 3.2 };
/** Taller steps than this are walls (the side or back of a ramp). */
const MAX_STEP = 0.35;

/** Run state with the same shape the HUD reads from the route LevelManager. */
class CityLevel {
  phase: GamePhase = 'ready';
  reason: GameOverReason = null;
  stats: RunStats = LevelManager.emptyStats();
  readonly progress = 0;
  constructor(private readonly fares: Fares) {}
  /** The shift clock. */
  get timeLeft(): number {
    return this.fares.shiftTime;
  }
}

/** Towing and repairs when the Alto is wrecked. */
const TOW_COST = 300;
const TOW_TIME = 10;

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
  readonly fares: Fares;
  readonly props: Props;
  readonly stunts = new Stunts();
  private lastHonkTick = -1e9;
  readonly level: CityLevel;
  private startX = 0;
  private startZ = 0;
  private startHeading = 0;
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
    this.fares = new Fares(this.seed, this.map);
    this.props = new Props(this.seed, this.map);
    this.level = new CityLevel(this.fares);
    // Start on Abdullah Haroon Road, just north of the Empress Market roundabout, heading north.
    const start = this.map.links.find((l) => l.name === 'Abdullah Haroon Road' && l.dz > 0.5 && this.map.nodes[l.from].roundabout);
    if (start) {
      const p = this.map.linkPoint(start, 8, this.map.laneOffset(start, start.lanes - 1));
      this.startX = p.x;
      this.startZ = p.z;
      this.startHeading = start.heading;
    }
    this.player.reset(this.startX, this.startZ, this.startHeading);
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
    const p = this.player;
    return Math.max(clamp((p.speed - 18) / 12, 0, 1) * 0.6, p.boostTime > 0 ? 1 : 0);
  }

  start(): void {
    if (this.level.phase !== 'ready') return;
    this.level.phase = 'running';
    this.events.push({ type: 'zone', zoneIndex: -1, name: 'Saddar', banner: 'SADDAR · ON DUTY' });
    this.fares.startShift(this.events);
    this.stunts.resetShift();
  }

  /** Start a new shift after the last one ended (keeps driving meanwhile). */
  startShift(): void {
    if (this.level.phase === 'running' && !this.fares.onShift) {
      this.fares.startShift(this.events);
      this.stunts.resetShift();
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
      for (const n of this.traffic.npcs) {
        n.prevX = n.x;
        n.prevZ = n.z;
        n.prevHeading = n.heading;
      }
      return;
    }
    const running = this.level.phase === 'running';
    const firstEvent = this.events.length;
    p.update(input, CITY_TOP_SPEED, 1 / 60, running);
    if (p.boostFired) this.events.push({ type: 'boost', kind: p.boostFired });
    if (p.driftEnded > 1) this.events.push({ type: 'drift', seconds: p.driftEnded });
    this.staticCollisions();
    this.vertical();
    if (!p.airborne) this.kerbs();
    const smashDamage = this.props.update(1 / 60, p, this.events);
    if (smashDamage > 0) this.damage(smashDamage);
    this.traffic.update(1 / 60, p);
    this.trafficCollisions();
    this.streetName();
    this.fares.update(1 / 60, p, this.tick, this.events);

    // Horn / dipper cleared the way.
    if (this.traffic.honked > 0 && this.tick - this.lastHonkTick > 90) {
      this.lastHonkTick = this.tick;
      this.events.push({ type: 'honk', cleared: this.traffic.honked });
    }
    // Stunts: score what happened this tick, then tick the combo clock.
    const f = this.fares;
    const pay = (rs: number) => {
      f.money += rs;
      f.shiftEarnings += rs;
    };
    const end = this.events.length;
    for (let i = firstEvent; i < end; i++) this.stunts.handle(this.events[i], this.events);
    this.stunts.update(1 / 60, this.tick, p, this.traffic.npcs, !!f.fare, this.events, pay);

    if (running) {
      const st = this.level.stats;
      st.elapsed += 1 / 60;
      st.topSpeed = Math.max(st.topSpeed, Math.max(0, p.speed));
      if (p.integrity <= 0) this.tow();
    }
  }

  /** Wrecked: no game over, just a tow back to the start, a repair bill and lost time. */
  private tow(): void {
    const f = this.fares;
    if (f.fare) this.events.push({ type: 'fareFailed', name: f.places[f.fare.dest].name, reason: 'towed' });
    f.cancelFare();
    const cost = Math.min(f.money, TOW_COST);
    f.money -= cost;
    if (f.onShift) f.shiftTime = Math.max(1, f.shiftTime - TOW_TIME);
    this.player.reset(this.startX, this.startZ, this.startHeading, this.map.groundY(this.startX, this.startZ));
    this.player.freeRoam = true;
    this.onRoad = true;
    this.events.push({ type: 'towed', cost });
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

  /** Ramps: climb, take off, fly, land. The sides and backs of ramps are walls. */
  private vertical(): void {
    const p = this.player;
    let g = this.map.groundY(p.x, p.z);
    if (g > p.y + MAX_STEP) {
      // Drove into the tall side of a ramp: stop as if it were a wall.
      p.x = p.prevX;
      p.z = p.prevZ;
      const impact = Math.abs(p.speed);
      p.speed *= -0.25;
      if (impact > 3 && this.tick - this.lastWallHitTick > HIT_COOLDOWN) {
        this.lastWallHitTick = this.tick;
        const dmg = Math.min(20, (impact - 3) * 1.2);
        this.damage(dmg);
        this.level.stats.crashes++;
        this.events.push({ type: 'crash', impact, damage: dmg, x: p.x, z: p.z });
      }
      g = this.map.groundY(p.x, p.z);
    }
    const wasAir = p.airborne;
    const impact = p.settle(g, 1 / 60);
    if (!wasAir && p.airborne && p.vy > 1) this.events.push({ type: 'jump' });
    if (impact > 0 && p.airTime > 0.15) {
      this.events.push({ type: 'land', impact, air: p.airTime });
      // Only a really big drop hurts the Alto.
      if (impact > 11) this.damage((impact - 11) * 2);
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
      // Sailing over it.
      if (p.y > (NPC_HEIGHT[n.kind] ?? 1.5)) continue;
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
      // The NPC gets shoved (light ones fly sideways and spin) and loses speed.
      const shove = j * (1 - mr);
      n.kvx -= mtv.nx * shove * 0.9;
      n.kvz -= mtv.nz * shove * 0.9;
      // Spin from where it was hit: off-centre hits twist it.
      const rx = (p.x - n.x), rz = (p.z - n.z);
      const torque = (rx * -mtv.nz + rz * mtv.nx) * shove;
      n.kSpin += clamp(torque * 0.35 * (1 - mr) * (1 - mr) * 4, -4, 4);
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
