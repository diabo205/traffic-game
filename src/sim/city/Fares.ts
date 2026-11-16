import type { PlayerCar } from '../PlayerCar';
import { Rng } from '../rng';
import type { SimEvent } from '../types';
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

export type FareKind = 'standard' | 'vip' | 'party';
export type ShiftRank = 'S' | 'A' | 'B' | 'C' | 'D';

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
  /** 0 short hop, 1 medium, 2 long ride, 3 VIP magenta (marker colour) */
  tier: 0 | 1 | 2 | 3;
  kind: FareKind;
  partyCount: number;
  /** boarding progress, seconds stopped beside them */
  board: number;
}

export interface Fare {
  dest: number;
  /** passenger look, so the renderer can show them in the car */
  variant: number;
  kind: FareKind;
  partyCount: number;
  stopsLeft: number;
  totalStops: number;
  limit: number;
  timeLeft: number;
  /** route length when picked up (m) */
  distance: number;
  /** seconds stopped at the destination */
  alight: number;
}

const WAITING = 6;
const SPAWN_MIN = 35;
const SPAWN_MAX = 185;
const DESPAWN = 260;
export const SHIFT_START = 105;
const BOARD_TIME = 0.7;
const ALIGHT_TIME = 0.4;
const BOARD_RADIUS = 6;
const DROP_RADIUS = 10;
const STOP_SPEED = 2.6;

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
  chain = 0;
  bestChain = 0;

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
      if (l.turnaround || l.len < 24) continue;
      const off = l.hw + 1.4;
      for (let s = 10; s < l.len - 8; s += 22) {
        const p = map.linkPoint(l, s, off);
        if (map.isRoad(p.x, p.z) || map.nearRoad(p.x, p.z, 0.7)) continue;
        this.spots.push({ x: p.x, z: p.z, link: l.id, s });
      }
    }

    // Snap each real Saddar POI to the nearest distinct kerbside road spot.
    const usedSpot = new Set<number>();
    for (const poi of map.pois) {
      let tx = poi.x;
      let tz = poi.z;
      const lm = map.landmarks.find((l) => l.name === poi.name);
      if (lm) {
        const frontDist = lm.kind === 'empress' ? 60 : lm.obb.hw + 8;
        tx = lm.obb.x + Math.cos(lm.obb.heading) * frontDist;
        tz = lm.obb.z - Math.sin(lm.obb.heading) * frontDist;
      }
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.spots.length; i++) {
        if (usedSpot.has(i)) continue;
        const sp = this.spots[i];
        const d = Math.hypot(sp.x - tx, sp.z - tz);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        usedSpot.add(best);
        this.places.push({ ...this.spots[best], name: poi.name });
      }
    }
  }

  startShift(events: SimEvent[]): void {
    this.onShift = true;
    this.shiftTime = SHIFT_START;
    this.shiftEarnings = 0;
    this.shiftFares = 0;
    this.chain = 0;
    this.bestChain = 0;
    events.push({ type: 'shiftStart', time: SHIFT_START });
  }

  /** Grade the shift into an arcade license rank. */
  shiftRank(stuntScore: number): ShiftRank {
    const pts = this.shiftEarnings + this.shiftFares * 120 + stuntScore * 0.04;
    if (pts >= 2800) return 'S';
    if (pts >= 1900) return 'A';
    if (pts >= 1100) return 'B';
    if (pts >= 500) return 'C';
    return 'D';
  }

  /** Drop any current fare (towed, shift over). */
  cancelFare(): void {
    this.fare = null;
    this.chain = 0;
  }

  update(dt: number, p: PlayerCar, tick: number, events: SimEvent[]): void {
    this.population(p);

    if (this.onShift) {
      this.shiftTime = Math.max(0, this.shiftTime - dt);
      if (this.shiftTime <= 0) {
        this.onShift = false;
        if (this.fare) events.push({ type: 'fareFailed', name: this.places[this.fare.dest].name, reason: 'shift' });
        this.fare = null;
        this.chain = 0;
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
        if (f.alight >= ALIGHT_TIME) this.deliver(p, events);
      } else f.alight = Math.max(0, f.alight - dt * 2.5);
      if (this.fare && f.timeLeft <= 0) {
        events.push({ type: 'fareFailed', name: place.name, reason: 'time' });
        this.fare = null;
        this.chain = 0;
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
        } else w.board = Math.max(0, w.board - dt * 2.5);
      }
    }

    if (tick % 6 === 0) this.navigate(p);
  }

  private board(w: Passenger, p: PlayerCar, events: SimEvent[]): void {
    const place = this.places[w.dest];
    const dist = this.routeLength(p.x, p.z, p.heading, place);
    const pace = w.kind === 'vip' ? 9.8 : 9.0;
    const pad = w.kind === 'vip' ? 6 : 8;
    const limit = Math.max(14, Math.round(dist / pace + pad));
    const stops = w.kind === 'party' ? 2 : 1;
    const partyCount = w.kind === 'party' ? (p.vehicle === 'minibus' ? 3 : 2) : 1;
    this.fare = {
      dest: w.dest,
      variant: w.variant,
      kind: w.kind,
      partyCount,
      stopsLeft: stops,
      totalStops: stops,
      limit,
      timeLeft: limit,
      distance: dist,
      alight: 0,
    };
    events.push({ type: 'pickup', name: place.name, time: limit, distance: Math.round(dist), kind: w.kind, stops });
    this.navigate(p);
  }

  private pickDest(fromX: number, fromZ: number, exclude = -1, maxRoute = Infinity): number {
    if (this.places.length <= 1) return 0;
    const cands: number[] = [];
    for (let k = 0; k < 14 && cands.length < 5; k++) {
      const c = this.rng.int(0, this.places.length - 1);
      if (c === exclude || cands.includes(c)) continue;
      if (Math.hypot(this.places[c].x - fromX, this.places[c].z - fromZ) >= 95) cands.push(c);
    }
    if (cands.length === 0) {
      let dest = this.rng.int(0, this.places.length - 1);
      if (dest === exclude) dest = (dest + 1) % this.places.length;
      return dest;
    }
    if (this.shiftFares < 2 || maxRoute < Infinity) {
      const cap = this.shiftFares < 2 ? Math.min(maxRoute, 540) : maxRoute;
      const targetLen = this.shiftFares === 0 ? 290 : 380;
      let best = cands[0];
      let bestScore = Infinity;
      for (const c of cands) {
        const rLen = this.routeLength(fromX, fromZ, 0, this.places[c]);
        const over = Math.max(0, rLen - cap) * 3.5;
        const sc = Math.abs(rLen - targetLen) + over;
        if (sc < bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      return best;
    }
    return cands[0];
  }

  private deliver(p: PlayerCar, events: SimEvent[]): void {
    const f = this.fare;
    if (!f) return;
    const frac = f.timeLeft / Math.max(1, f.limit);
    if (f.stopsLeft > 1) {
      // Mid-ride stop on a Party fare: pay leg 1 and chain seamlessly to stop 2!
      const legPay = Math.round(((50 + f.distance * 0.4) * (1 + (f.partyCount - 1) * 0.25)) / 10) * 10;
      const bonus = Math.round(7 + f.distance / 120);
      this.money += legPay;
      this.shiftEarnings += legPay;
      this.shiftTime += bonus;
      const oldName = this.places[f.dest].name;
      const nextDest = this.pickDest(p.x, p.z, f.dest, 720);
      const nextPlace = this.places[nextDest];
      const nextDist = this.routeLength(p.x, p.z, p.heading, nextPlace);
      const nextLimit = Math.max(14, Math.round(nextDist / 9.0 + 7));
      const carry = Math.min(12, Math.round(f.timeLeft * 0.45));
      f.dest = nextDest;
      f.distance = nextDist;
      f.timeLeft = nextLimit + carry;
      f.limit = f.timeLeft;
      f.stopsLeft--;
      f.alight = 0;
      events.push({
        type: 'dropoff',
        name: oldName,
        pay: legPay,
        tip: 0,
        bonus,
        rating: frac > 0.5 ? 2 : frac > 0.25 ? 1 : 0,
        chain: this.chain,
        kind: f.kind,
        nextStop: nextPlace.name,
      });
      this.navigate(p);
      return;
    }

    if (frac > 0.25) this.chain++;
    else this.chain = 0;
    this.bestChain = Math.max(this.bestChain, this.chain);
    const streakMul = 1 + Math.min(4, Math.max(0, this.chain - 1)) * 0.25;
    const kindMul = f.kind === 'vip' ? 2.0 : f.kind === 'party' ? 1.45 : 1.0;
    const base = Math.round(((60 + f.distance * 0.5) * kindMul * streakMul) / 10) * 10;
    const tip = frac > 0.5 ? Math.round((base * 0.5) / 10) * 10 : frac > 0.25 ? Math.round((base * 0.2) / 10) * 10 : 0;
    const distSec = Math.round(f.distance / 110);
    const bonus = Math.round((8 + distSec + 12 * frac + (f.kind === 'vip' ? 5 : 0)) * (1 + Math.min(3, Math.max(0, this.chain - 1)) * 0.1));
    this.money += base + tip;
    this.shiftEarnings += base + tip;
    this.shiftFares++;
    this.totalFares++;
    this.shiftTime += bonus;
    events.push({
      type: 'dropoff',
      name: this.places[f.dest].name,
      pay: base,
      tip,
      bonus,
      rating: frac > 0.5 ? 2 : frac > 0.25 ? 1 : 0,
      chain: this.chain,
      kind: f.kind,
    });
    this.fare = null;
  }

  /** Keep a handful of passengers waiting around the player (first one spawns ahead). */
  private population(p: PlayerCar): void {
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const w = this.waiting[i];
      if (Math.hypot(w.x - p.x, w.z - p.z) > DESPAWN) this.waiting.splice(i, 1);
    }
    if (this.waiting.length >= WAITING || this.spots.length === 0 || this.places.length === 0) return;
    const rng = this.rng;
    let si = rng.int(0, this.spots.length - 1);
    // On an empty street at start of play, place the first rider clearly ahead of the nose.
    if (this.waiting.length === 0 && !this.fare && this.shiftFares === 0) {
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < this.spots.length; i++) {
        const sp = this.spots[i];
        const dx = sp.x - p.x, dz = sp.z - p.z;
        const along = dx * fx + dz * fz;
        const d = Math.hypot(dx, dz);
        if (along > 18 && d >= 38 && d <= 105 && d < bestScore) {
          bestScore = d;
          best = i;
        }
      }
      if (best >= 0) si = best;
    }
    const sp = this.spots[si];
    const d = Math.hypot(sp.x - p.x, sp.z - p.z);
    if (d < SPAWN_MIN || d > SPAWN_MAX) return;
    if (this.waiting.some((w) => Math.hypot(w.x - sp.x, w.z - sp.z) < 40)) return;
    const dest = this.pickDest(sp.x, sp.z);
    const pl = this.places[dest];
    const crow = Math.hypot(pl.x - sp.x, pl.z - sp.z);
    if (crow < 70) return;
    const roll = rng.next();
    const kind: FareKind = this.shiftFares === 0 && this.waiting.length === 0 ? 'standard' : roll < 0.16 ? 'vip' : roll < 0.36 ? 'party' : 'standard';
    const tier: 0 | 1 | 2 | 3 = kind === 'vip' ? 3 : crow < 260 ? 0 : crow < 520 ? 1 : 2;
    this.waiting.push({
      id: this.nextId++,
      x: sp.x,
      z: sp.z,
      spot: si,
      dest,
      variant: rng.int(0, 7),
      tier,
      kind,
      partyCount: kind === 'party' ? 2 : 1,
      board: 0,
    });
  }

  // ---- Route guidance -----------------------------------------------------

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
    const here = this.map.linkAt(p.x, p.z, p.heading);
    const tl = this.map.links[target.link];
    const sameStreet = !!(here && (here.id === tl.id || (tl.reverse >= 0 && here.id === tl.reverse)));
    const r = direct < 26 && sameStreet ? null : this.shortest(p.x, p.z, p.heading, target);
    const pts: number[] = [p.x, p.z];
    if (r) for (const n of r.nodes) pts.push(this.map.nodes[n].x, this.map.nodes[n].z);
    pts.push(tx, tz);
    this.navPath = pts;
    this.navDist = r ? r.dist : direct;
    // Aim at the first route point comfortably ahead along the street (avoids corner-cutting at nodes).
    this.navX = tx;
    this.navZ = tz;
    for (let i = 2; i < pts.length; i += 2) {
      if (Math.hypot(pts[i] - p.x, pts[i + 1] - p.z) > 11) {
        this.navX = pts[i];
        this.navZ = pts[i + 1];
        break;
      }
    }
  }

  /** Binary-heap Dijkstra from where the car is heading to the target's street. */
  shortest(x: number, z: number, heading: number, target: Spot): { dist: number; nodes: number[] } | null {
    const m = this.map;
    const n = m.nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    const heapN: number[] = [];
    const heapD: number[] = [];
    const push = (id: number, d: number) => {
      let i = heapN.length;
      heapN.push(id);
      heapD.push(d);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapD[p] <= d) break;
        heapN[i] = heapN[p];
        heapD[i] = heapD[p];
        i = p;
      }
      heapN[i] = id;
      heapD[i] = d;
    };
    const pop = (): number => {
      const top = heapN[0];
      const ln = heapN.pop()!;
      const ld = heapD.pop()!;
      if (heapN.length > 0) {
        let i = 0;
        const len = heapN.length;
        for (;;) {
          let best = i;
          const l = i * 2 + 1;
          const r = l + 1;
          if (l < len && heapD[l] < ld) best = l;
          if (r < len && heapD[r] < (best === i ? ld : heapD[l])) best = r;
          if (best === i) break;
          heapN[i] = heapN[best];
          heapD[i] = heapD[best];
          i = best;
        }
        heapN[i] = ln;
        heapD[i] = ld;
      }
      return top;
    };

    const here = m.linkAt(x, z, heading);
    if (here) {
      // Ahead to the next junction (or back, at a cost, for a U-turn on two-way streets).
      const s = (x - here.sx) * here.dx + (z - here.sz) * here.dz;
      dist[here.to] = Math.max(0, here.len - s);
      push(here.to, dist[here.to]);
      if (!here.oneway) {
        dist[here.from] = Math.max(0, s) + 38;
        push(here.from, dist[here.from]);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const nd = m.nodes[i];
        const d = Math.hypot(nd.x - x, nd.z - z) * 1.3;
        dist[i] = d;
        push(i, d);
      }
    }

    const tl = m.links[target.link];
    while (heapN.length > 0) {
      const u = pop();
      if (done[u]) continue;
      done[u] = true;
      // Early stop once both endpoints of target link have settled.
      if (done[tl.from] && (tl.oneway || done[tl.to])) break;
      const base = dist[u];
      for (const id of m.nodes[u].out) {
        const l = m.links[id];
        const node = m.nodes[l.to];
        const d = base + l.len + node.r * 2;
        if (d < dist[l.to]) {
          dist[l.to] = d;
          prev[l.to] = u;
          push(l.to, d);
        }
      }
    }

    const viaFrom = dist[tl.from] + target.s;
    const viaTo = tl.oneway ? Infinity : dist[tl.to] + (tl.len - target.s);
    // Already on the target's street, heading along it.
    if (here && (here.id === tl.id || (tl.reverse >= 0 && here.id === tl.reverse))) {
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
