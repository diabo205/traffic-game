import { LevelManager } from '../LevelManager';
import type { RunStats } from '../LevelManager';
import { clamp, obbOverlap, pointObbDistance } from '../math';
import { MOVES, PlayerCar, WALL } from '../PlayerCar';
import { Rng } from '../rng';
import { NPC_SPECS } from '../TrafficManager';
import { trafficDamage } from '../types';
import type { GameOverReason, GamePhase, InputFrame, NpcView, Obb, PlayerVehicle, SimEvent } from '../types';
import type { VehicleBuild } from '../upgrades';
import { cityMap } from './cityMap';
import type { CityLink, CityMap } from './cityMap';
import { CityTraffic } from './CityTraffic';
import { Fares } from './Fares';
import { Pedestrians } from './Pedestrians';
import { Props } from './Props';
import { Stunts } from './Stunts';

const RESTITUTION = 0.15;
const TRAFFIC_RESTITUTION = 0.1;
const HIT_COOLDOWN = 36;
/** Base city top speed for the Alto (m/s, ~100 km/h). */
const CITY_TOP_SPEED = 27.8;
/** Rough NPC roof heights, for jumping over traffic. */
const NPC_HEIGHT: Readonly<Record<string, number>> = { bike: 1.3, minibus: 2.9, rickshaw: 1.9, cart: 1.3, car: 1.5, truck: 3.2 };
/** Extra rolling drag off-road/on pavements in Saddar (m/s^2), scaled by vehicle offroadDragMul. */
const CITY_OFFROAD_DRAG = 0.85;
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

/** Towing and repairs when the player vehicle is wrecked. */
const TOW_COST = 300;
const TOW_TIME = 10;
const WRECK_BEAT_TICKS = 90;
const WRECK_BOOST_PENALTY = 4.5;

/**
 * Open-world Saddar: free driving on a street network with junctions,
 * roundabouts, solid buildings, kerbs and graph-following traffic.
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
  readonly pedestrians: Pedestrians;
  readonly props: Props;
  readonly stunts = new Stunts();
  private lastHonkTick = -1e9;
  private wasPinned = false;
  readonly level: CityLevel;
  private startX = 0;
  private startZ = 0;
  private startHeading = 0;
  private events: SimEvent[] = [];
  weather: 'clear' | 'monsoon' = 'clear';
  private onWater = false;
  private onRoad = true;
  private lastKerbTick = -1e9;
  private lastWallHitTick = -1e9;
  private postLandGrace = 0;
  private street = '';
  private streetCandidate = '';
  private streetTicks = 0;
  private wreckTicks = 0;

  constructor(seed: number, vehicle: PlayerVehicle = 'alto', build?: VehicleBuild) {
    this.seed = seed >>> 0;
    this.player.setVehicle(vehicle, build);
    this.map = cityMap();
    this.traffic = new CityTraffic(this.seed, this.map);
    this.fares = new Fares(this.seed, this.map);
    this.pedestrians = new Pedestrians(this.seed, this.map);
    this.props = new Props(this.seed, this.map);
    this.level = new CityLevel(this.fares);
    // Pick a deterministic starting street from the world seed across major Saddar avenues.
    const b = this.map.bounds;
    const margin = 110;
    const spawnPose = (l: CityLink) => {
      let lane = l.lanes - 1;
      if (lane === l.rampLane && l.lanes > 1) lane = 0;
      let s = Math.min(20, l.len * 0.35);
      if (lane === l.rampLane && s >= l.rampS0 - 3 && s <= l.rampS1 + 3) {
        if (l.rampS0 - 3 >= 8) s = l.rampS0 - 3;
        else if (l.rampS1 + 3 <= l.len - 12) s = l.rampS1 + 3;
        else return null;
      }
      const pt = this.map.linkPoint(l, s, this.map.laneOffset(l, lane));
      if (
        this.map.rampHeight(pt.x, pt.z) > 0.01 ||
        this.map.rampHeight(pt.x + l.dx * 1.8, pt.z + l.dz * 1.8) > 0.01 ||
        this.map.rampHeight(pt.x - l.dx * 1.8, pt.z - l.dz * 1.8) > 0.01
      ) {
        return null;
      }
      const carBox: Obb = {
        x: pt.x,
        z: pt.z,
        hw: this.player.spec.halfWidth + 0.3,
        hl: this.player.spec.halfLength + 0.3,
        heading: l.heading,
      };
      let blocked = false;
      this.map.forEachSolidNear(pt.x, pt.z, 6, (sb) => {
        if (!blocked && obbOverlap(carBox, sb)) blocked = true;
      });
      if (blocked) return null;
      const fx = Math.sin(l.heading);
      const fz = Math.cos(l.heading);
      const hasAheadSpot = this.fares.spots.some((sp) => {
        const dx = sp.x - pt.x;
        const dz = sp.z - pt.z;
        const along = dx * fx + dz * fz;
        const d = Math.hypot(dx, dz);
        return along > 18 && d >= 38 && d <= 105;
      });
      if (!hasAheadSpot) return null;
      return { x: pt.x, z: pt.z, heading: l.heading };
    };

    const candidates: Array<{ x: number; z: number; heading: number }> = [];
    for (const l of this.map.links) {
      if (l.turnaround || l.len < 50 || l.lanes < 2 || !l.name) continue;
      if (this.map.nodes[l.from].roundabout || this.map.nodes[l.to].roundabout) continue;
      if (this.map.nodes[l.to].out.length === 0) continue;
      const ex = l.sx + l.dx * l.len;
      const ez = l.sz + l.dz * l.len;
      const mx = (l.sx + ex) * 0.5;
      const mz = (l.sz + ez) * 0.5;
      if (mx < b.x0 + margin || mx > b.x1 - margin || mz < b.z0 + margin || mz > b.z1 - margin) continue;
      const pose = spawnPose(l);
      if (pose) candidates.push(pose);
    }

    if (candidates.length > 0) {
      const spawnRng = new Rng(this.seed ^ 0x57a27);
      const pick = candidates[spawnRng.int(0, candidates.length - 1)];
      this.startX = pick.x;
      this.startZ = pick.z;
      this.startHeading = pick.heading;
    } else {
      const fallback = this.map.links.find((l) => !l.turnaround && l.len >= 40 && l.lanes >= 2);
      if (fallback) {
        const p = this.map.linkPoint(fallback, Math.min(20, fallback.len * 0.35), this.map.laneOffset(fallback, fallback.lanes - 1));
        this.startX = p.x;
        this.startZ = p.z;
        this.startHeading = fallback.heading;
      }
    }
    this.player.reset(this.startX, this.startZ, this.startHeading);
    this.player.freeRoam = true;
    this.traffic.reset(this.player.x, this.player.z);
    this.pedestrians.reset(this.player.x, this.player.z);
  }

  get phase(): GamePhase {
    return this.level.phase;
  }

  get wrecking(): boolean {
    return this.wreckTicks > 0;
  }

  get wreckProgress(): number {
    return this.wreckTicks > 0 ? 1 - this.wreckTicks / WRECK_BEAT_TICKS : 0;
  }

  get npcs(): readonly NpcView[] {
    return this.traffic.npcs;
  }

  groundY(x: number, z: number): number {
    return this.map.groundY(x, z);
  }

  topSpeed(): number {
    return CITY_TOP_SPEED * this.player.spec.topSpeedMul;
  }

  speedRush(): number {
    const p = this.player;
    return Math.max(clamp((p.speed - 17) / 11, 0, 1) * 0.85, p.boostTime > 0 ? 1 : 0);
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
    if (amount <= 0 || this.level.phase !== 'running' || this.wreckTicks > 0) return;
    const grace = this.postLandGrace > 0 ? 0.35 : 1;
    const scaled = amount * this.player.spec.damageRes * grace;
    this.player.integrity = Math.max(0, this.player.integrity - scaled);
    this.level.stats.damageTaken += scaled;
  }

  private applySurface(): void {
    const p = this.player;
    if (p.airborne) {
      this.onWater = false;
      return;
    }
    const box = p.obb();
    let wet = false;
    this.map.forEachPuddleNear(p.x, p.z, 10, (pud) => {
      if (!wet && obbOverlap(box, pud)) wet = true;
    });
    if (wet) {
      const v = Math.abs(p.speed);
      p.traction = clamp(0.62 - v * 0.016, 0.12, 0.62);
      p.extraDrag += 0.7 + v * 0.045;
      if (!this.onWater && v > 5.5) this.events.push({ type: 'splash' });
    } else if (this.weather === 'monsoon') {
      p.traction = Math.min(p.traction, 0.85);
    }
    this.onWater = wet;
    if (!this.map.isRoad(p.x, p.z)) {
      p.extraDrag += CITY_OFFROAD_DRAG * p.spec.offroadDragMul;
      p.traction = Math.min(p.traction, p.spec.offroadTraction);
    }
  }

  step(input: InputFrame): void {
    this.tick++;
    if (this.postLandGrace > 0) this.postLandGrace = Math.max(0, this.postLandGrace - 1 / 60);
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
    this.applySurface();
    p.update(input, this.topSpeed(), 1 / 60, running && this.wreckTicks === 0);
    if (p.boostFired) this.events.push({ type: 'boost', kind: p.boostFired });
    if (p.driftEnded > 0.85) this.events.push({ type: 'drift', seconds: p.driftEnded });
    this.staticCollisions();
    this.vertical();
    if (!p.airborne) this.kerbs();
    const smashDamage = this.props.update(1 / 60, p, this.events);
    if (smashDamage > 0) this.damage(smashDamage);
    this.traffic.update(1 / 60, p);
    this.trafficCollisions();
    this.pedestrians.update(1 / 60, p, this.events);
    this.streetName();
    const pinned = p.pinnedTime >= MOVES.pinnedHint;
    if (pinned && !this.wasPinned) this.events.push({ type: 'pinned' });
    this.wasPinned = pinned;
    this.fares.update(1 / 60, p, this.tick, this.events);

    // Horn / dipper cleared the way.
    if (this.traffic.honked > 0 && this.tick - this.lastHonkTick > 90) {
      this.lastHonkTick = this.tick;
      this.events.push({ type: 'honk', cleared: this.traffic.honked });
    }
    if (running) {
      const st = this.level.stats;
      st.elapsed += 1 / 60;
      st.topSpeed = Math.max(st.topSpeed, Math.max(0, p.speed));
      if (this.wreckTicks > 0) {
        this.wreckTicks--;
        if (this.wreckTicks === 0) this.tow();
      } else if (p.integrity <= 0) {
        this.beginWreck();
      }
    }
    // Stunts: score what happened this tick (including tow combo-break), then tick the combo clock.
    const f = this.fares;
    const pay = (rs: number) => {
      f.money += rs;
      f.shiftEarnings += rs;
    };
    const end = this.events.length;
    for (let i = firstEvent; i < end; i++) this.stunts.handle(this.events[i], this.events);
    this.stunts.update(1 / 60, this.tick, p, this.traffic.npcs, !!f.fare, this.events, pay, f.fare?.partyCount ?? 1);
    const afterStunts = this.events.length;
    for (let i = firstEvent; i < afterStunts; i++) {
      const ev = this.events[i];
      if (ev.type === 'crash') {
        this.fares.onCrash(ev.impact, this.events);
      } else if (ev.type === 'drift') {
        const delta = p.chargeBoost(Math.min(25, ev.seconds * 14));
        if (delta >= 1) this.events.push({ type: 'boostCharge', meter: p.boostMeter, delta, source: 'drift' });
      } else if (ev.type === 'stunt' && ev.kind === 'near') {
        const delta = p.chargeBoost(10);
        if (delta >= 1) this.events.push({ type: 'boostCharge', meter: p.boostMeter, delta, source: 'nearMiss' });
      } else if (ev.type === 'land' && ev.air > 0.25) {
        const delta = p.chargeBoost(Math.min(22, ev.air * 18));
        if (delta >= 1) this.events.push({ type: 'boostCharge', meter: p.boostMeter, delta, source: 'air' });
      } else if (ev.type === 'honk' && ev.cleared > 0) {
        const delta = p.chargeBoost(Math.min(12, ev.cleared * 5));
        if (delta >= 1) this.events.push({ type: 'boostCharge', meter: p.boostMeter, delta, source: 'honk' });
      }
    }
  }

  /** Begin the post-wreck crash-cam beat before towing back onto the road. */
  private beginWreck(): void {
    this.wreckTicks = WRECK_BEAT_TICKS;
    if (this.fares.fare) this.events.push({ type: 'fareFailed', name: this.fares.places[this.fares.fare.dest].name, reason: 'towed' });
    this.fares.cancelFare();
    this.events.push({ type: 'wrecked' });
  }

  /** Wrecked: no game over, just a tow onto the nearest clear kerb, a repair bill and lost time. */
  private tow(): void {
    const f = this.fares;
    if (f.fare) this.events.push({ type: 'fareFailed', name: f.places[f.fare.dest].name, reason: 'towed' });
    f.cancelFare();
    const rawBill = Math.round((Math.max(0, f.money) * 0.35) / 10) * 10;
    const cost = Math.min(TOW_COST, Math.max(120, rawBill));
    const paid = Math.min(Math.max(0, f.money), cost);
    f.money = Math.max(0, f.money - paid);
    f.shiftEarnings = Math.max(0, f.shiftEarnings - paid);
    if (f.onShift) f.shiftTime = Math.max(0, f.shiftTime - TOW_TIME);

    // Nearest clear road kerb instead of teleporting back to spawn.
    const p = this.player;
    let bestLink: CityLink | null = null;
    let bestS = 0;
    let bestLane = 0;
    let bestD = Infinity;
    for (const l of this.map.links) {
      if (l.turnaround || l.len < 22) continue;
      const rx = p.x - l.sx;
      const rz = p.z - l.sz;
      let lane = l.lanes - 1;
      if (lane === l.rampLane && l.lanes > 1) lane = 0;
      let s = clamp(rx * l.dx + rz * l.dz, 10, l.len - 10);
      if (lane === l.rampLane && s >= l.rampS0 - 3 && s <= l.rampS1 + 3) {
        if (l.rampS0 - 3 >= 10) s = l.rampS0 - 3;
        else if (l.rampS1 + 3 <= l.len - 10) s = l.rampS1 + 3;
        else continue;
      }
      const pt = this.map.linkPoint(l, s, this.map.laneOffset(l, lane));
      if (
        this.map.rampHeight(pt.x, pt.z) > 0.01 ||
        this.map.rampHeight(pt.x + l.dx * 1.8, pt.z + l.dz * 1.8) > 0.01 ||
        this.map.rampHeight(pt.x - l.dx * 1.8, pt.z - l.dz * 1.8) > 0.01
      ) {
        continue;
      }
      const d = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (d < bestD) {
        bestD = d;
        bestLink = l;
        bestS = s;
        bestLane = lane;
      }
    }
    let tx = this.startX, tz = this.startZ, th = this.startHeading;
    if (bestLink) {
      const pt = this.map.linkPoint(bestLink, bestS, this.map.laneOffset(bestLink, bestLane));
      tx = pt.x;
      tz = pt.z;
      th = bestLink.heading;
    }
    this.player.reset(tx, tz, th, this.map.groundY(tx, tz));
    this.player.penalizeBoost(WRECK_BOOST_PENALTY);
    this.player.freeRoam = true;
    this.onRoad = true;
    this.events.push({ type: 'towed', cost: paid });
  }

  // ---------------------------------------------------------------------------

  private staticCollisions(): void {
    const p = this.player;
    // Two passes resolve corners where two buildings meet.
    for (let pass = 0; pass < 2; pass++) {
      this.map.forEachSolidNear(p.x, p.z, 6, (b) => this.solid(b));
      for (const isl of this.map.islands) this.circle(isl.x, isl.z, isl.r);
    }
  }

  private solid(box: Obb): void {
    const p = this.player;
    const mtv = obbOverlap(p.obb(), box);
    if (!mtv) return;
    p.x += mtv.nx * mtv.depth;
    p.z += mtv.nz * mtv.depth;
    this.bounce(mtv.nx, mtv.nz, p.x - mtv.nx * p.spec.halfWidth, p.z - mtv.nz * p.spec.halfWidth);
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
    const fresh = p.wallContact === 0;
    p.wallContact = WALL.memoryTicks;
    const prevSpeed = p.speed;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const intoNorm = prevSpeed < -0.15 ? fx * nx + fz * nz : -(fx * nx + fz * nz);
    const { vx, vz } = p.velocity();
    const rel = vx * nx + vz * nz;
    if (rel >= 0) return;
    const preMag = Math.hypot(vx, vz);
    const j = -(1 + RESTITUTION) * rel;
    p.setVelocity(vx + nx * j, vz + nz * j);
    if (prevSpeed > 1.5 && intoNorm < WALL.glanceMax) {
      // Oblique forward wall contact: never flip gear into reverse; slide forward along wall.
      if (p.speed < 0) p.speed = Math.abs(p.speed);
      if (preMag > 3) {
        p.speed = Math.max(p.speed, preMag * Math.max(0.68, 1 - intoNorm * 0.3));
      }
    } else if (prevSpeed > 1.5 && intoNorm >= WALL.glanceMax && p.throttle > 0.3 && p.speed < -3.5) {
      p.speed = -3.5;
    }
    if (p.speed < -Math.max(4.5, p.spec.maxReverse * 0.85)) {
      p.speed = -Math.max(4.5, p.spec.maxReverse * 0.85);
    }
    p.scrapeWall(nx, nz);
    const impact = -rel;
    // Already scraping along this wall: steering back into it isn't a new crash
    // unless it's a real hit (well above the scrape threshold).
    const hitThresh = fresh ? (intoNorm < 0.5 ? 5.5 : 3) : 8;
    if (impact > hitThresh && this.tick - this.lastWallHitTick > HIT_COOLDOWN) {
      this.lastWallHitTick = this.tick;
      const dmg = Math.min(30, (impact - 3) * (intoNorm < 0.5 ? 1.1 : 1.7));
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
      // Drove into the tall side or back of a ramp: resolve against the ramp's
      // actual OBB normal so angled hits deflect along the side instead of wedging.
      const lim = p.y + MAX_STEP;
      let nx = 0, nz = 0;
      for (const r of this.map.ramps) {
        const dx = p.x - r.x, dz = p.z - r.z;
        const s = Math.sin(r.heading), c = Math.cos(r.heading);
        const along = dx * s + dz * c;
        const lat = dx * c - dz * s;
        if (Math.abs(along) > r.hl || Math.abs(lat) > r.hw) continue;
        const backPen = r.hl - along;
        const sidePen = r.hw - Math.abs(lat);
        if (backPen < sidePen) {
          nx = s;
          nz = c;
          const push = backPen + 0.05;
          p.x += nx * push;
          p.z += nz * push;
        } else {
          const sg = lat >= 0 ? 1 : -1;
          nx = sg * c;
          nz = -sg * s;
          const push = sidePen + 0.05;
          p.x += nx * push;
          p.z += nz * push;
        }
        break;
      }
      if ((nx === 0 && nz === 0) || this.map.groundY(p.x, p.z) > lim) {
        const dx = p.x - p.prevX, dz = p.z - p.prevZ;
        if (this.map.groundY(p.x, p.prevZ) <= lim) {
          p.z = p.prevZ;
          if (nz === 0) nz = dz > 0 ? -1 : 1;
        } else if (this.map.groundY(p.prevX, p.z) <= lim) {
          p.x = p.prevX;
          if (nx === 0) nx = dx > 0 ? -1 : 1;
        } else {
          p.x = p.prevX;
          p.z = p.prevZ;
          if (nx === 0 && nz === 0) {
            if (Math.abs(dx) > Math.abs(dz)) nx = dx > 0 ? -1 : 1;
            else nz = dz > 0 ? -1 : 1;
          }
        }
      }
      this.bounce(nx, nz, p.x - nx * p.spec.halfLength, p.z - nz * p.spec.halfLength);
      g = this.map.groundY(p.x, p.z);
    }
    const wasAir = p.airborne;
    const impact = p.settle(g, 1 / 60);
    if (!wasAir && p.airborne && p.vy > 1) this.events.push({ type: 'jump' });
    if (impact > 0 && p.airTime > 0.15) {
      this.postLandGrace = 0.45;
      this.events.push({ type: 'land', impact, air: p.airTime });
      // Only a really big drop hurts the vehicle.
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
      // A stopped bus is a wall too: allow the pivot and the STUCK hint.
      if (n.speed < 1.5) p.wallContact = WALL.memoryTicks;
      const spec = NPC_SPECS[n.kind];
      const mr = spec.mass / (spec.mass + p.spec.mass);
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
      const j = -(1 + TRAFFIC_RESTITUTION) * rel;
      p.setVelocity(vx + mtv.nx * j * mr, vz + mtv.nz * j * mr);
      // The NPC gets shoved (light ones fly sideways and spin) and loses speed; cap velocity so multi-tick contacts never go supersonic.
      const shove = j * (1 - mr);
      n.kvx -= mtv.nx * shove * 0.9;
      n.kvz -= mtv.nz * shove * 0.9;
      const maxShoveV = Math.max(22, Math.abs(p.speed) * 1.35);
      const kvMag = Math.hypot(n.kvx, n.kvz);
      if (kvMag > maxShoveV) {
        n.kvx *= maxShoveV / kvMag;
        n.kvz *= maxShoveV / kvMag;
      }
      // Spin from where it was hit: off-centre hits twist it.
      const rx = (p.x - n.x), rz = (p.z - n.z);
      const torque = (rx * -mtv.nz + rz * mtv.nx) * shove;
      n.kSpin = clamp(n.kSpin + clamp(torque * 0.35 * (1 - mr) * (1 - mr) * 4, -4, 4), -10, 10);
      n.speed = Math.max(0, n.speed - shove * 0.8);

      const impact = -rel;
      if (impact > 1.5 && this.tick - n.lastHitTick > HIT_COOLDOWN) {
        n.lastHitTick = this.tick;
        const dmg = trafficDamage(impact, spec.damage);
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

