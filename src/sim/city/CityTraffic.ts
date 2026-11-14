import { approach } from '../math';
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
    if (link.len < 12) return;
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
    const options: number[] = [];
    const weights: number[] = [];
    for (const id of node.out) {
      const out = m.links[id];
      const turn = m.turnBetween(link, out);
      if (turn === 'uturn') continue;
      if (n.kind === 'cart' && out.lanes < 2) continue;
      options.push(id);
      weights.push(turn === 'straight' ? 3 : 1.4);
    }
    if (options.length === 0) {
      options.push(link.reverse);
      weights.push(1);
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
      if (n.honkCooldown > 0 || n.kind === 'cart') continue;
      const dx = n.x - player.x, dz = n.z - player.z;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * fz - dz * fx);
      if (along < 2 || along > 38 || lat > 4.5) continue;
      // Only traffic going our way can sensibly pull over for us.
      if (Math.cos(n.heading - player.heading) < 0.5) continue;
      n.yieldTime = 2.8;
      n.honkCooldown = 5;
      this.honked++;
      if (!n.path) {
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
        const vTurn = node.roundabout ? ROUNDABOUT_SPEED : turn === 'straight' ? Infinity : TURN_SPEED;
        if (vTurn < Infinity) target = Math.min(target, Math.sqrt(vTurn * vTurn + 2 * spec.decel * 0.6 * Math.max(0, remaining - 2)));
        // Take turns at the junction: wait while traffic from another approach is in it.
        if (remaining < 14) {
          const occ = occupants.get(node.id);
          const busy = occ?.some((from) => from !== link.id && !(turn === 'straight' && from === link.reverse)) ?? false;
          if (busy && n.waitTime < MAX_WAIT) {
            stopGap = Math.min(stopGap, remaining - 2.5);
            if (n.speed < 0.5) n.waitTime += dt;
          } else if (!busy) n.waitTime = 0;
        }
      } else {
        const node = m.nodes[n.path.node];
        if (node.roundabout) target = Math.min(target, ROUNDABOUT_SPEED);
        else if (n.path.turn !== 'straight') target = Math.min(target, TURN_SPEED);
      }

      // ---- Whatever is in front (other NPCs and the player) -------------------
      const fx = Math.sin(n.heading), fz = Math.cos(n.heading);
      const look = 6 + n.speed * 1.6;
      let blocker = -1;
      let creep = false;
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
        // Deadlock breakers: of two vehicles waiting on each other the lower id
        // goes; after a long wait, crossing traffic is nosed through slowly.
        if (o.blocker === n.id && n.id < o.id) continue;
        if (n.blockedTime > 3 && Math.cos(o.heading - n.heading) < 0.6) {
          creep = true;
          continue;
        }
        const os = NPC_SPECS[o.kind];
        consider(o.id, o.x, o.z, os.hw, os.hl);
      }
      if (player.y < 1.6) consider(0, px, pz, ALTO.halfWidth, ALTO.halfLength);
      // Ramps left in the road are obstacles too.
      for (const r of m.ramps) {
        if (Math.abs(r.x - n.x) < 40 && Math.abs(r.z - n.z) < 40) consider(-2, r.x, r.z, r.hw, r.hl);
      }
      n.blocker = blocker;
      if (creep) target = Math.min(target, 3);

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
      const blocked = target < this.cruise(n, link) * 0.35;
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
          const room = l.median / 2 + l.lanes * l.laneW - offT - spec.hw - 0.2;
          offT += Math.max(0, Math.min(1.3, room));
        }
        const before = n.lat;
        n.lat = approach(n.lat, offT, spec.latSpeed * dt);
        const latRate = (n.lat - before) / dt;
        const p = m.linkPoint(l, n.s, n.lat);
        x = p.x;
        z = p.z;
        // Moving left (lat increasing) turns the nose left (negative heading).
        heading = l.heading - Math.atan2(latRate, Math.max(n.speed, 1.5));
        n.latVel = -latRate;
      }
      // Shoves: slide off with friction, spin, then drift back into lane.
      n.kx += n.kvx * dt;
      n.kz += n.kvz * dt;
      const fr = Math.exp(-dt * 3.2);
      n.kvx *= fr;
      n.kvz *= fr;
      n.kHead += n.kSpin * dt;
      n.kSpin *= Math.exp(-dt * 2.5);
      const back = Math.exp(-dt * 0.9);
      n.kx *= back;
      n.kz *= back;
      n.kHead *= Math.exp(-dt * 1.1);
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
  }
}
