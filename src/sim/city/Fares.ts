import type { PlayerCar } from '../PlayerCar';
import { Rng } from '../rng';
import type { SimEvent } from '../types';
import { halfWidth } from './cityMap';
import type { CityMap } from './cityMap';

/**
 * Taxi fares: passengers wait at the kerb, you stop beside one, drive them to
 * their named destination before their fare timer runs out, get paid (with a
 * tip for speed) and earn extra shift time. Includes the route guidance used
 * by the HUD arrow and minimap. Pure and deterministic.
 */

/** A kerbside point on the pavement next to a link. */
export interface Spot {
  x: number;
  z: number;
  link: number;
  s: number;
}

export interface Place extends Spot {
  name: string;
}

export interface Passenger {
  id: number;
  x: number;
  z: number;
  /** index into spots (where they wait) */
  spot: number;
  /** index into places */
  dest: number;
  /** clothing / look variant for the renderer */
  variant: number;
  /** 0 short hop, 1 medium, 2 long ride (marker colour) */
  tier: 0 | 1 | 2;
  /** boarding progress, seconds stopped beside them */
  board: number;
}

export interface Fare {
  dest: number;
  /** passenger look, so the renderer can show them in the car */
  variant: number;
  limit: number;
  timeLeft: number;
  /** route length when picked up (m) */
  distance: number;
  /** seconds stopped at the destination */
  alight: number;
}

const PLACE_NAMES = [
  'Empress Market',
  'Bohri Bazaar',
  'Zainab Market',
  'Regal Chowk',
  "St. Patrick's Cathedral",
  'Saddar Dawakhana',
  'Paradise Cinema',
  'Cantt Station Bus Stop',
  'Burns Road Food Street',
  'Lucky Star Hotel',
  'Jahangir Park',
  'Sindh Secretariat',
  'Capri Cinema',
  'Pakistan Chowk',
];

const WAITING = 6;
const SPAWN_MIN = 35;
const SPAWN_MAX = 170;
const DESPAWN = 240;
export const SHIFT_START = 90;
const BOARD_TIME = 0.7;
const ALIGHT_TIME = 0.4;
const BOARD_RADIUS = 6;
const DROP_RADIUS = 10;
const STOP_SPEED = 2.2;

export class Fares {
  readonly spots: Spot[] = [];
  readonly places: Place[] = [];
  readonly waiting: Passenger[] = [];
  fare: Fare | null = null;
  onShift = false;
  shiftTime = SHIFT_START;
  money = 0;
  shiftEarnings = 0;
  shiftFares = 0;
  totalFares = 0;

  /** Guidance: point the arrow aims at, and route length to the target. */
  navX = 0;
  navZ = 0;
  navDist = 0;
  /** Route polyline for the minimap (x/z interleaved), player first. */
  navPath: number[] = [];

  private readonly rng: Rng;
  private nextId = 1;

  constructor(seed: number, private readonly map: CityMap) {
    this.rng = new Rng(seed ^ 0x7a71);
    for (const l of map.links) {
      if (l.len < 26) continue;
      const off = halfWidth(l.cls) + 1.4;
      for (let s = 10; s < l.len - 9; s += 24) {
        const p = map.linkPoint(l, s, off);
        this.spots.push({ x: p.x, z: p.z, link: l.id, s });
      }
    }
    // Named places: each pinned to the kerbside spot right outside its landmark entrance.
    for (const name of PLACE_NAMES) {
      const lm = map.landmarks.find((l) => l.name === name);
      const tx = lm ? lm.stopX : 0;
      const tz = lm ? lm.stopZ : 0;
      let best = 0;
      let bestD = Infinity;
      this.spots.forEach((s, i) => {
        const d = Math.hypot(s.x - tx, s.z - tz);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      this.places.push({ ...this.spots[best], name });
    }
  }

  startShift(events: SimEvent[]): void {
    this.onShift = true;
    this.shiftTime = SHIFT_START;
    this.shiftEarnings = 0;
    this.shiftFares = 0;
    events.push({ type: 'shiftStart', time: SHIFT_START });
  }

  /** Drop any current fare (towed, shift over). */
  cancelFare(): void {
    this.fare = null;
  }

  update(dt: number, p: PlayerCar, tick: number, events: SimEvent[]): void {
    this.population(p);

    if (this.onShift) {
      this.shiftTime = Math.max(0, this.shiftTime - dt);
      if (this.shiftTime <= 0) {
        this.onShift = false;
        if (this.fare) events.push({ type: 'fareFailed', name: this.places[this.fare.dest].name, reason: 'shift' });
        this.fare = null;
        events.push({ type: 'shiftOver', earned: this.shiftEarnings, fares: this.shiftFares });
      }
    }

    const stopped = Math.abs(p.speed) < STOP_SPEED;
    if (this.fare) {
      const f = this.fare;
      f.timeLeft = Math.max(0, f.timeLeft - dt);
      const place = this.places[f.dest];
      if (Math.hypot(p.x - place.x, p.z - place.z) < DROP_RADIUS && stopped) {
        f.alight += dt;
        if (f.alight >= ALIGHT_TIME) this.deliver(events);
      } else f.alight = 0;
      if (this.fare && f.timeLeft <= 0) {
        events.push({ type: 'fareFailed', name: place.name, reason: 'time' });
        this.fare = null;
      }
    } else if (this.onShift) {
      for (let i = 0; i < this.waiting.length; i++) {
        const w = this.waiting[i];
        if (Math.hypot(p.x - w.x, p.z - w.z) < BOARD_RADIUS && stopped) {
          w.board += dt;
          if (w.board >= BOARD_TIME) {
            this.waiting.splice(i, 1);
            this.board(w, p, events);
            break;
          }
        } else w.board = 0;
      }
    }

    if (tick % 15 === 0) this.navigate(p);
  }

  private board(w: Passenger, p: PlayerCar, events: SimEvent[]): void {
    const place = this.places[w.dest];
    const dist = this.routeLength(p.x, p.z, p.heading, place);
    const limit = Math.round(dist / 8.5 + 9);
    this.fare = { dest: w.dest, variant: w.variant, limit, timeLeft: limit, distance: dist, alight: 0 };
    events.push({ type: 'pickup', name: place.name, time: limit, distance: Math.round(dist) });
    this.navigate(p);
  }

  private deliver(events: SimEvent[]): void {
    const f = this.fare;
    if (!f) return;
    const frac = f.timeLeft / f.limit;
    const base = Math.round((60 + f.distance * 0.5) / 10) * 10;
    const tip = frac > 0.5 ? Math.round(base * 0.5 / 10) * 10 : frac > 0.25 ? Math.round(base * 0.2 / 10) * 10 : 0;
    const bonus = Math.round(5 + 12 * frac);
    this.money += base + tip;
    this.shiftEarnings += base + tip;
    this.shiftFares++;
    this.totalFares++;
    this.shiftTime += bonus;
    events.push({ type: 'dropoff', name: this.places[f.dest].name, pay: base, tip, bonus, rating: frac > 0.5 ? 2 : frac > 0.25 ? 1 : 0 });
    this.fare = null;
  }

  /** Keep a handful of passengers waiting around the player. */
  private population(p: PlayerCar): void {
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const w = this.waiting[i];
      if (Math.hypot(w.x - p.x, w.z - p.z) > DESPAWN) this.waiting.splice(i, 1);
    }
    if (this.waiting.length >= WAITING) return;
    const rng = this.rng;
    const si = rng.int(0, this.spots.length - 1);
    const sp = this.spots[si];
    const d = Math.hypot(sp.x - p.x, sp.z - p.z);
    if (d < SPAWN_MIN || d > SPAWN_MAX) return;
    if (this.waiting.some((w) => Math.hypot(w.x - sp.x, w.z - sp.z) < 40)) return;
    let dest = rng.int(0, this.places.length - 1);
    for (let k = 0; k < 4 && Math.hypot(this.places[dest].x - sp.x, this.places[dest].z - sp.z) < 90; k++) dest = rng.int(0, this.places.length - 1);
    const pl = this.places[dest];
    const crow = Math.hypot(pl.x - sp.x, pl.z - sp.z);
    if (crow < 70) return;
    this.waiting.push({
      id: this.nextId++,
      x: sp.x,
      z: sp.z,
      spot: si,
      dest,
      variant: rng.int(0, 7),
      tier: crow < 180 ? 0 : crow < 320 ? 1 : 2,
      board: 0,
    });
  }

  // ---- Route guidance -------------------------------------------------------

  /** Shortest route over the road graph to a place; fills the nav fields. */
  private navigate(p: PlayerCar): void {
    if (!this.fare) {
      // Off a fare: point at the nearest waiting passenger.
      let best: Passenger | null = null;
      let bd = Infinity;
      for (const w of this.waiting) {
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bd) {
          bd = d;
          best = w;
        }
      }
      if (!best || !this.onShift) {
        this.navDist = 0;
        this.navPath = [];
        return;
      }
      this.route(p, this.spots[best.spot], best.x, best.z);
      return;
    }
    const pl = this.places[this.fare.dest];
    this.route(p, pl, pl.x, pl.z);
  }

  private routeLength(x: number, z: number, heading: number, target: Spot): number {
    const r = this.shortest(x, z, heading, target);
    return r ? r.dist : Math.hypot(target.x - x, target.z - z);
  }

  private route(p: PlayerCar, target: Spot, tx: number, tz: number): void {
    const direct = Math.hypot(tx - p.x, tz - p.z);
    const r = direct < 30 ? null : this.shortest(p.x, p.z, p.heading, target);
    const pts: number[] = [p.x, p.z];
    if (r) for (const n of r.nodes) pts.push(this.map.nodes[n].x, this.map.nodes[n].z);
    pts.push(tx, tz);
    this.navPath = pts;
    this.navDist = r ? r.dist : direct;
    // Aim at the first route point comfortably ahead of the car.
    this.navX = tx;
    this.navZ = tz;
    for (let i = 2; i < pts.length; i += 2) {
      if (Math.hypot(pts[i] - p.x, pts[i + 1] - p.z) > 16) {
        this.navX = pts[i];
        this.navZ = pts[i + 1];
        break;
      }
    }
  }

  /** Dijkstra from where the car is heading to either end of the target's street. */
  private shortest(x: number, z: number, heading: number, target: Spot): { dist: number; nodes: number[] } | null {
    const m = this.map;
    const n = m.nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    const here = m.linkAt(x, z, heading);
    if (here) {
      // Ahead to the next junction (or back, at a cost, for a U-turn).
      const s = (x - here.sx) * here.dx + (z - here.sz) * here.dz;
      dist[here.to] = Math.max(0, here.len - s);
      dist[here.from] = Math.max(0, s) + 25;
    } else {
      m.nodes.forEach((nd, i) => {
        dist[i] = Math.hypot(nd.x - x, nd.z - z) * 1.3;
      });
    }
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      for (const id of m.nodes[u].out) {
        const l = m.links[id];
        const node = m.nodes[l.to];
        const d = dist[u] + l.len + (Math.abs(l.dx) > 0.5 ? node.hx : node.hz) * 2;
        if (d < dist[l.to]) {
          dist[l.to] = d;
          prev[l.to] = u;
        }
      }
    }
    const tl = m.links[target.link];
    const viaFrom = dist[tl.from] + target.s;
    const viaTo = dist[tl.to] + (tl.len - target.s);
    // Already on the target's street, heading the right way.
    if (here && (here.id === tl.id || here.id === tl.reverse)) {
      const direct = Math.hypot(target.x - x, target.z - z);
      if (direct < Math.min(viaFrom, viaTo)) return { dist: direct, nodes: [] };
    }
    let end = viaFrom <= viaTo ? tl.from : tl.to;
    const total = Math.min(viaFrom, viaTo);
    if (total === Infinity) return null;
    const nodes: number[] = [];
    for (let k = 0; end >= 0 && k < n; k++) {
      nodes.push(end);
      end = prev[end];
    }
    nodes.reverse();
    return { dist: total, nodes };
  }
}
