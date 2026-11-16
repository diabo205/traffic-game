import { approach, obbOverlap } from '../math';
import { ALTO } from '../PlayerCar';
import type { PlayerCar } from '../PlayerCar';
import { Rng } from '../rng';
import { NPC_SPECS } from '../TrafficManager';
import type { NpcKind, Obb } from '../types';
import type { CityLink, CityMap, JunctionPath } from './cityMap';

/** Saddar cruise speeds (m/s) per kind; side streets / arterials scale these. */
const CRUISE: Readonly<Record<NpcKind, readonly [number, number]>> = {
  bike: [10, 14],
  minibus: [10, 13.5],
  rickshaw: [8, 11],
  cart: [1.6, 2.6],
  car: [11, 15],
  truck: [8, 11],
};

const WEIGHTS: Readonly<Partial<Record<NpcKind, number>>> = {
  bike: 28,
  rickshaw: 24,
  car: 22,
  minibus: 13,
  truck: 4,
  cart: 5,
};

const MAX_NPCS = 36;
const SPAWN_MIN = 75;
const SPAWN_MAX = 165;
const DESPAWN = 195;
/** Speed through a turn / roundabout. */
const TURN_SPEED = 6.5;
const ROUNDABOUT_SPEED = 8;
/** Give up waiting at a busy junction after this long (Karachi rules). */
const MAX_WAIT = 3.5;

export interface CityNpc {
  id: number;
  kind: NpcKind;
  variant: number;
  temperament: number;

  /** current link, or the link we came from while on a junction path */
  link: number;
  lane: number;
  /** distance along the link */
  s: number;
  /** current lateral offset left of the centre line (eases between lanes) */
  lat: number;
  /** junction path being driven (null = on a link) */
  path: JunctionPath | null;
  /** distance along the path */
  ps: number;
  nextLink: number;
  nextLane: number;

  speed: number;
  x: number;
  z: number;
  heading: number;
  /** knock-back from collisions, decays to zero */
  kx: number;
  kz: number;
  /** knock-back velocity and spin from being shoved */
  kvx: number;
  kvz: number;
  kSpin: number;
  /** heading offset from being spun round (decays) */
  kHead: number;

  /** renderer compatibility with route NPCs */
  dir: 1;
  latVel: number;
  brakeLights: boolean;
  hazardLights: boolean;
  lastHitTick: number;
  waitTime: number;
  blockedTime: number;
  /** seconds left to drive clear after breaking a junction/cycle deadlock */
  creepTime: number;
  /** seconds left pulling over for the player's horn / dipper */
  yieldTime: number;
  honkCooldown: number;
  /** id of what this NPC stopped for last tick (-1 none, 0 player) */
  blocker: number;

  prevX: number;
  prevZ: number;
  prevHeading: number;
}

/**
 * Traffic that drives the city road graph: follows lanes, turns at
 * junctions (clockwise round roundabouts), queues behind whatever is in front
 * and loosely takes turns at junctions. Spawns in a ring around the player.
 */
export class CityTraffic {
  readonly npcs: CityNpc[] = [];
  private nextId = 1;
  private readonly rng: Rng;
  private spawnLinks: number[] = [];

  constructor(seed: number, private readonly map: CityMap) {
    this.rng = new Rng(seed ^ 0x51ab0c);
  }

  static obb(n: CityNpc): Obb {
    const s = NPC_SPECS[n.kind];
    return { x: n.x, z: n.z, hw: s.hw, hl: s.hl, heading: n.heading };
  }

  reset(px: number, pz: number): void {
    this.npcs.length = 0;
    this.refreshSpawnLinks(px, pz);
    for (let i = 0; i < 400 && this.npcs.length < MAX_NPCS; i++) this.trySpawn(px, pz, 18);
  }

  private refreshSpawnLinks(px: number, pz: number): void {
    this.spawnLinks = [];
    for (const l of this.map.links) {
      const mx = l.sx + l.dx * l.len * 0.5, mz = l.sz + l.dz * l.len * 0.5;
      if (Math.hypot(mx - px, mz - pz) < SPAWN_MAX + l.len * 0.5) this.spawnLinks.push(l.id);
    }
  }

  private trySpawn(px: number, pz: number, minDist: number): void {
    if (this.spawnLinks.length === 0) return;
    const rng = this.rng;
    const link = this.map.links[rng.pick(this.spawnLinks)];
    if (link.len < 12 || link.turnaround) return;
    const kind = rng.weighted(WEIGHTS);
    // Hand carts keep to the kerb lane of multi-lane streets.
    if (kind === 'cart' && link.lanes < 2) return;
    let lane = kind === 'cart' ? link.lanes - 1 : rng.int(0, link.lanes - 1);
    if (lane === link.rampLane) lane = 0;
    const s = rng.range(4, link.len - 4);
    const off = this.map.laneOffset(link, lane);
    const p = this.map.linkPoint(link, s, off);
    const d = Math.hypot(p.x - px, p.z - pz);
    if (d < minDist || d > SPAWN_MAX) return;
    for (const o of this.npcs) if (Math.hypot(o.x - p.x, o.z - p.z) < 11) return;

    const [lo, hi] = CRUISE[kind];
    const temperament = rng.next();
    const n: CityNpc = {
      id: this.nextId++,
      kind,
      variant: rng.int(0, 5),
      temperament,
      link: link.id,
      lane,
      s,
      lat: off,
      path: null,
      ps: 0,
      nextLink: -1,
      nextLane: 0,
      speed: (lo + (hi - lo) * temperament) * link.pace * 0.8,
      x: p.x,
      z: p.z,
      heading: link.heading,
      kx: 0,
      kz: 0,
      kvx: 0,
      kvz: 0,
      kSpin: 0,
      kHead: 0,
      dir: 1,
      latVel: 0,
      brakeLights: false,
      hazardLights: false,
      lastHitTick: -1e9,
      waitTime: 0,
      blockedTime: 0,
      creepTime: 0,
      blocker: -1,
      yieldTime: 0,
      honkCooldown: 0,
      prevX: p.x,
      prevZ: p.z,
      prevHeading: link.heading,
    };
    this.chooseNext(n);
    this.npcs.push(n);
  }

  /** Pick where to go at the end of the current link. */
  private chooseNext(n: CityNpc): void {
    const m = this.map;
    const link = m.links[n.link];
    const node = m.nodes[link.to];
    const hasThru = node.out.some((k) => !m.links[k].turnaround);
    const options: number[] = [];
    const weights: number[] = [];
    for (const id of node.out) {
      const out = m.links[id];
      if (hasThru && out.turnaround) continue;
      const turn = m.turnBetween(link, out);
      if (turn === 'uturn') continue;
      if (n.kind === 'cart' && out.lanes < 2) continue;
      options.push(id);
      weights.push(turn === 'straight' ? 3 : 1.4);
    }
    if (options.length === 0) {
      if (link.reverse >= 0) {
        options.push(link.reverse);
        weights.push(1);
      } else if (node.out.length > 0) {
        options.push(node.out[0]);
        weights.push(1);
      }
    }
    let total = 0;
    for (const w of weights) total += w;
    let r = this.rng.next() * total;
    let pick = options[options.length - 1];
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r < 0) {
        pick = options[i];
        break;
      }
    }
    const out = m.links[pick];
    n.nextLink = pick;
    n.nextLane = n.kind === 'cart' ? out.lanes - 1 : Math.min(n.lane, out.lanes - 1);
    // Keep out of a lane with a ramp in it.
    if (n.nextLane === out.rampLane) n.nextLane = 0;
  }

  private cruise(n: CityNpc, link: CityLink): number {
    const [lo, hi] = CRUISE[n.kind];
    return (lo + (hi - lo) * n.temperament) * link.pace;
  }

  /** Vehicles that pulled over for the horn this tick. */
  honked = 0;

  /**
   * Horn or dipper: traffic in front of the player, within earshot, pulls
   * toward the kerb (or into the kerb lane) and slows to let the car past.
   */
  private honk(player: PlayerCar): void {
    this.honked = 0;
    if (!player.horn && !player.dipper) return;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    const m = this.map;
    for (const n of this.npcs) {
      if (n.honkCooldown > 0) continue;
      const dx = n.x - player.x, dz = n.z - player.z;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * fz - dz * fx);
      if (along < 2 || along > 38 || lat > 4.5) continue;
      // Only traffic going our way can sensibly pull over for us.
      if (Math.cos(n.heading - player.heading) < 0.5) continue;
      n.yieldTime = 2.8;
      n.honkCooldown = 5;
      this.honked++;
      if (!n.path && n.kind !== 'cart') {
        const link = m.links[n.link];
        const kerb = link.lanes - 1;
        if (n.lane !== kerb && kerb !== link.rampLane) {
          const p = m.linkPoint(link, n.s, m.laneOffset(link, kerb));
          if (!this.npcs.some((o) => o !== n && Math.hypot(o.x - p.x, o.z - p.z) < 7)) {
            n.lane = kerb;
            n.nextLane = Math.min(n.lane, m.links[n.nextLink].lanes - 1);
            if (n.nextLane === m.links[n.nextLink].rampLane) n.nextLane = 0;
          }
        }
      }
    }
  }

  update(dt: number, player: PlayerCar): void {
    const m = this.map;
    const px = player.x, pz = player.z;
    this.honk(player);

    // ---- Spawning / despawning (stable array order) --------------------------
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      if (Math.hypot(n.x - px, n.z - pz) > DESPAWN) this.npcs.splice(i, 1);
    }
    if (this.npcs.length < MAX_NPCS) {
      this.refreshSpawnLinks(px, pz);
      this.trySpawn(px, pz, SPAWN_MIN);
    }

    // ---- Junction occupancy: which approach each vehicle in a junction came from.
    const occupants = new Map<number, number[]>();
    for (const n of this.npcs) {
      if (!n.path) continue;
      let list = occupants.get(n.path.node);
      if (!list) occupants.set(n.path.node, (list = []));
      list.push(n.link);
    }

    const byId = new Map<number, CityNpc>();
    for (const o of this.npcs) byId.set(o.id, o);

    for (const n of this.npcs) {
      n.prevX = n.x;
      n.prevZ = n.z;
      n.prevHeading = n.heading;
      const spec = NPC_SPECS[n.kind];
      const link = m.links[n.link];

      // ---- Desired speed ----------------------------------------------------
      let target = this.cruise(n, n.path ? m.links[n.nextLink] : link);
      let stopGap = Infinity;

      if (!n.path) {
        const remaining = link.len - n.s;
        const next = m.links[n.nextLink];
        const node = m.nodes[link.to];
        const turn = m.turnBetween(link, next);
        if (!node.bend) {
          const vTurn = node.roundabout ? ROUNDABOUT_SPEED : turn === 'straight' ? Infinity : TURN_SPEED;
          if (vTurn < Infinity) target = Math.min(target, Math.sqrt(vTurn * vTurn + 2 * spec.decel * 0.6 * Math.max(0, remaining - 2)));
          // Take turns at junctions; vehicles circulating inside a roundabout ring don't stop for ring chords.
          const circulating = node.roundabout && m.nodes[link.from].roundabout && m.nodes[next.to].roundabout;
          if (remaining < 14 && !circulating && n.creepTime <= 0) {
            const occ = occupants.get(node.id);
            const busy = occ?.some((from) => from !== link.id && !(turn === 'straight' && link.reverse >= 0 && from === link.reverse)) ?? false;
            if (busy && n.waitTime < MAX_WAIT) {
              stopGap = Math.min(stopGap, remaining - 2.5);
              if (n.speed < 0.5) n.waitTime += dt;
            } else if (!busy) n.waitTime = 0;
          }
        }
      } else {
        const node = m.nodes[n.path.node];
        if (!node.bend) {
          if (node.roundabout) target = Math.min(target, ROUNDABOUT_SPEED);
          else if (n.path.turn !== 'straight') target = Math.min(target, TURN_SPEED);
        }
      }

      // ---- Whatever is in front (other NPCs and the player) -------------------
      const fx = Math.sin(n.heading), fz = Math.cos(n.heading);
      const look = 6 + n.speed * 1.6;
      let blocker = -1;
      let creep = n.creepTime > 0;
      if (n.creepTime > 0) n.creepTime = Math.max(0, n.creepTime - dt);
      const triggerCreep = (latch = 2.2) => {
        creep = true;
        n.creepTime = Math.max(n.creepTime, latch);
      };
      const consider = (id: number, ox: number, oz: number, ohw: number, ohl: number) => {
        const dx = ox - n.x, dz = oz - n.z;
        const along = dx * fx + dz * fz;
        if (along <= 0 || along > look + ohl) return;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > spec.hw + ohw + 0.35) return;
        const gap = along - spec.hl - ohl;
        if (gap < stopGap) {
          stopGap = gap;
          blocker = id;
        }
      };
      for (const o of this.npcs) {
        if (o === n) continue;
        // Deadlock breakers:
        // 1) Two-way or multi-vehicle (3-6 hop) waiting cycles: lowest ID in the cycle proceeds.
        let inCycleLowest = false;
        if (o.blocker === n.id && n.id < o.id) {
          inCycleLowest = true;
        } else if ((n.blockedTime > 0.8 || creep) && o.blocker > 0) {
          let cur: CityNpc | undefined = o;
          let minId = Math.min(n.id, o.id);
          for (let hop = 0; hop < 6 && cur && cur.blocker > 0; hop++) {
            minId = Math.min(minId, cur.blocker);
            if (cur.blocker === n.id) {
              inCycleLowest = n.id <= minId;
              break;
            }
            cur = byId.get(cur.blocker);
          }
        }
        if (inCycleLowest) {
          if (n.blockedTime > 0.8) triggerCreep(1.6);
          continue;
        }
        const os = NPC_SPECS[o.kind];
        const dx = o.x - n.x;
        const dz = o.z - n.z;
        const distSq = dx * dx + dz * dz;
        const crossing = Math.cos(o.heading - n.heading) < 0.6;
        const minClear = (spec.hl + os.hl) * (crossing ? 0.85 : 0.96);
        if (distSq > minClear * minClear) {
          // Crossing / turning / long-blocked junction traffic creeps clear once outside bumper overlap.
          if ((creep || n.blockedTime > 2.5) && crossing) {
            triggerCreep();
            continue;
          }
          if (n.path && (creep || n.blockedTime > 3.0) && n.id < o.id) {
            triggerCreep();
            continue;
          }
          if ((creep || n.blockedTime > 4.5) && n.id < o.id) {
            triggerCreep();
            continue;
          }
        }
        consider(o.id, o.x, o.z, os.hw, os.hl);
      }
      if (player.y < 1.6) consider(0, px, pz, ALTO.halfWidth, ALTO.halfLength);
      // Ramps left in the road are obstacles too.
      for (const r of m.ramps) {
        if (Math.abs(r.x - n.x) < 40 && Math.abs(r.z - n.z) < 40) consider(-2, r.x, r.z, r.hw, r.hl);
      }
      n.blocker = blocker;
      if (creep) target = Math.min(target, 5.5);

      if (n.yieldTime > 0) {
        n.yieldTime -= dt;
        target = Math.min(target, this.cruise(n, link) * 0.4);
      }
      n.honkCooldown = Math.max(0, n.honkCooldown - dt);
      if (stopGap < Infinity) {
        const margin = 2.2;
        const allowed = stopGap <= margin ? 0 : Math.sqrt(2 * spec.decel * 0.75 * (stopGap - margin));
        if (allowed < target) target = allowed;
      }
      const blocked = target < Math.min(2.2, this.cruise(n, link) * 0.25);
      n.blockedTime = blocked ? n.blockedTime + dt : 0;

      // ---- Lane change around a slow vehicle -----------------------------------
      if (!n.path && n.blockedTime > 1.2 && link.lanes > 1 && n.kind !== 'cart' && link.len - n.s > 20) {
        let want = n.lane === 0 ? 1 : n.lane - 1;
        if (want === link.rampLane && n.s < link.rampS1 + 3) want = n.lane;
        const off = m.laneOffset(link, want);
        const p = m.linkPoint(link, n.s, off);
        let clear = true;
        for (const o of this.npcs) {
          if (o === n) continue;
          if (Math.hypot(o.x - p.x, o.z - p.z) < 9) {
            clear = false;
            break;
          }
        }
        if (Math.hypot(px - p.x, pz - p.z) < 8) clear = false;
        if (clear && want !== n.lane) {
          n.lane = want;
          n.blockedTime = 0;
          n.nextLane = Math.min(n.lane, m.links[n.nextLink].lanes - 1);
        }
      }

      // ---- Integrate speed / progress ----------------------------------------------
      const prevSpeed = n.speed;
      n.speed = n.speed < target ? approach(n.speed, target, spec.accel * dt) : approach(n.speed, target, spec.decel * 1.4 * dt);
      n.brakeLights = n.speed < prevSpeed - spec.accel * dt * 0.2 || n.speed < 0.3;
      n.hazardLights = n.waitTime >= MAX_WAIT;
      const ds = n.speed * dt;

      if (!n.path) {
        n.s += ds;
        if (n.s >= link.len) {
          const next = m.links[n.nextLink];
          n.path = m.junctionPath(link, n.lane, next, n.nextLane);
          n.ps = n.s - link.len;
          n.waitTime = 0;
        }
      } else {
        n.ps += ds;
      }
      if (n.path && n.ps >= n.path.len) {
        const over = n.ps - n.path.len;
        n.link = n.nextLink;
        n.lane = n.nextLane;
        n.s = over;
        n.path = null;
        n.lat = m.laneOffset(m.links[n.link], n.lane);
        this.chooseNext(n);
      }

      // ---- Pose ------------------------------------------------------------------------
      let x: number, z: number, heading: number;
      if (n.path) {
        const q = m.samplePath(n.path, n.ps);
        x = q.x;
        z = q.z;
        heading = Math.atan2(q.dx, q.dz);
        n.latVel = 0;
      } else {
        const l = m.links[n.link];
        let offT = m.laneOffset(l, n.lane);
        if (n.yieldTime > 0 && n.lane === l.lanes - 1 && l.rampLane !== n.lane) {
          // Squeeze up against the kerb.
          const room = l.hw - offT - spec.hw - 0.2;
          offT += Math.max(0, Math.min(1.3, room));
        }
        const latRateCap = n.yieldTime > 0 ? Math.max(spec.latSpeed, 1.8) : spec.latSpeed;
        const before = n.lat;
        n.lat = approach(n.lat, offT, latRateCap * dt);
        const latRate = (n.lat - before) / dt;
        const p = m.linkPoint(l, n.s, n.lat);
        x = p.x;
        z = p.z;
        // Moving left (lat increasing) turns the nose left (negative heading).
        heading = l.heading - Math.atan2(latRate, Math.max(n.speed, 1.5));
        n.latVel = -latRate;
      }
      // Shoves: slide off with friction, spin, then drift back into lane once moving again.
      n.kx += n.kvx * dt;
      n.kz += n.kvz * dt;
      const fr = Math.exp(-dt * 3.2);
      n.kvx *= fr;
      n.kvz *= fr;
      n.kHead += n.kSpin * dt;
      n.kSpin *= Math.exp(-dt * 2.5);
      if (n.speed > 1.2 && n.blockedTime < 0.25) {
        const back = Math.exp(-dt * 0.9 * Math.min(1, n.speed / 5));
        n.kx *= back;
        n.kz *= back;
        n.kHead *= Math.exp(-dt * 1.1 * Math.min(1, n.speed / 5));
      }
      const kLen = Math.hypot(n.kx, n.kz);
      if (kLen > 1.8) {
        const sc = 1.8 / kLen;
        n.kx *= sc;
        n.kz *= sc;
      }
      n.x = x + n.kx;
      n.z = z + n.kz;
      heading += n.kHead;
      // A shoved vehicle stops to collect itself.
      if (Math.hypot(n.kvx, n.kvz) > 1 || Math.abs(n.kSpin) > 0.6) n.speed *= Math.exp(-dt * 3);
      // Keep heading continuous with the previous tick (no 2*pi jumps for interpolation).
      let dh = heading - n.prevHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      n.heading = n.prevHeading + dh;
    }

    // ---- Pairwise NPC separation (prevents junction deadlock phasing & tailback overlap) ------
    for (let i = 0; i < this.npcs.length; i++) {
      const a = this.npcs[i];
      for (let j = i + 1; j < this.npcs.length; j++) {
        const b = this.npcs[j];
        if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7) continue;
        const mtv = obbOverlap(CityTraffic.obb(a), CityTraffic.obb(b));
        if (!mtv || mtv.depth <= 0.02) continue;
        const push = Math.min(mtv.depth + 0.03, 1.2) * 0.5;
        const aProj = mtv.nx * Math.sin(a.heading) + mtv.nz * Math.cos(a.heading);
        a.x += mtv.nx * push;
        a.z += mtv.nz * push;
        if (aProj < -0.5 && a.creepTime <= 0) {
          const back = -aProj * push;
          if (a.path) a.ps = Math.max(0, a.ps - back);
          else a.s = Math.max(0, a.s - back);
          a.speed = Math.min(a.speed, b.speed * 0.5);
        } else {
          a.kx += mtv.nx * push;
          a.kz += mtv.nz * push;
        }
        const bProj = -(mtv.nx * Math.sin(b.heading) + mtv.nz * Math.cos(b.heading));
        b.x -= mtv.nx * push;
        b.z -= mtv.nz * push;
        if (bProj < -0.5 && b.creepTime <= 0) {
          const back = -bProj * push;
          if (b.path) b.ps = Math.max(0, b.ps - back);
          else b.s = Math.max(0, b.s - back);
          b.speed = Math.min(b.speed, a.speed * 0.5);
        } else {
          b.kx -= mtv.nx * push;
          b.kz -= mtv.nz * push;
        }
        for (const v of [a, b]) {
          const kl = Math.hypot(v.kx, v.kz);
          if (kl > 1.8) {
            const sc = 1.8 / kl;
            v.kx *= sc;
            v.kz *= sc;
          }
        }
        if (a.id > b.id) a.speed *= 0.88;
        else b.speed *= 0.88;
      }
    }
  }
}
