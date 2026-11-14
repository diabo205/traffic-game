import { obbOverlap, pointObbDistance } from '../math';
import { ALTO } from '../PlayerCar';
import type { PlayerCar } from '../PlayerCar';
import { Rng } from '../rng';
import type { SimEvent } from '../types';
import type { CityMap } from './cityMap';

/**
 * Smashable street clutter: traffic cones, fruit carts, chai stalls,
 * water drums, plastic chairs and fruit crates. Drive through them and they
 * go flying, tumble and settle; they reset once you're far away.
 * Collision sizes live here, never in the meshes.
 */

export type PropKind = 'cone' | 'fruitcart' | 'stall' | 'drum' | 'chair' | 'crate';

interface PropSpec {
  hw: number;
  hl: number;
  /** height (m), for the renderer and for jumping over */
  h: number;
  mass: number;
  /** integrity lost hitting it at speed */
  damage: number;
}

export const PROP_SPECS: Readonly<Record<PropKind, PropSpec>> = {
  cone: { hw: 0.2, hl: 0.2, h: 0.7, mass: 4, damage: 0 },
  fruitcart: { hw: 0.6, hl: 1.1, h: 1.1, mass: 120, damage: 2 },
  stall: { hw: 0.4, hl: 0.65, h: 1.0, mass: 40, damage: 1 },
  drum: { hw: 0.32, hl: 0.32, h: 0.9, mass: 25, damage: 0 },
  chair: { hw: 0.27, hl: 0.27, h: 0.85, mass: 3, damage: 0 },
  crate: { hw: 0.32, hl: 0.25, h: 0.5, mass: 12, damage: 0 },
};

export interface Prop {
  id: number;
  kind: PropKind;
  homeX: number;
  homeZ: number;
  homeHeading: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  /** tumble about the prop's own sideways axis (rad) */
  tumble: number;
  vx: number;
  vz: number;
  vy: number;
  spin: number;
  tumbleRate: number;
  /** 0 standing, 1 moving, 2 knocked over and resting */
  state: 0 | 1 | 2;
}

const GRAVITY = 17;
const RESET_DIST = 210;

export class Props {
  readonly props: Prop[] = [];
  /** props changed this tick (renderer can skip the rest) */
  dirty = true;
  private rng: Rng;

  constructor(seed: number, private readonly map: CityMap) {
    this.rng = new Rng(seed ^ 0x9e0b);
    // Placement is fixed (not seed dependent) so the street looks the same for everyone.
    const pr = new Rng(0x3f1c);
    const add = (kind: PropKind, x: number, z: number, heading: number, allowRoad = false) => {
      if (!allowRoad && (map.isRoad(x, z) || map.nearRoad(x, z, 0.8))) return;
      // Keep off oriented buildings & landmarks.
      let blocked = false;
      map.forEachSolidNear(x, z, 3, (b) => {
        if (pointObbDistance(x, z, b) < 0.7) blocked = true;
      });
      if (blocked) return;
      this.props.push({
        id: this.props.length,
        kind,
        homeX: x,
        homeZ: z,
        homeHeading: heading,
        x,
        z,
        y: map.groundY(x, z),
        heading,
        tumble: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        spin: 0,
        tumbleRate: 0,
        state: 0,
      });
    };

    // Pavement clutter in front of the shops.
    for (const l of map.links) {
      if (l.turnaround || l.len < 30) continue;
      const off = l.hw + 2.9;
      for (let s = 14 + pr.range(0, 8); s < l.len - 10; s += pr.range(20, 38)) {
        const p = map.linkPoint(l, s, off);
        const roll = pr.next();
        const along = l.heading;
        if (roll < 0.2) add('fruitcart', p.x, p.z, along);
        else if (roll < 0.42) {
          // Chai stall with plastic chairs round it.
          add('stall', p.x, p.z, along);
          for (let k = 0; k < 2; k++) {
            const q = map.linkPoint(l, s + (k ? 1.3 : -1.3), off - 0.9);
            add('chair', q.x, q.z, along + pr.range(-0.5, 0.5));
          }
        } else if (roll < 0.58) {
          add('crate', p.x, p.z, along + pr.range(-0.3, 0.3));
          const q = map.linkPoint(l, s + 0.75, off);
          add('crate', q.x, q.z, along + pr.range(-0.3, 0.3));
        } else if (roll < 0.72) add('drum', p.x, p.z, 0);
      }
    }
    // Cones warning of each street ramp (in its lane, before it).
    for (const l of map.links) {
      if (l.rampLane < 0) continue;
      for (let k = 0; k < 3; k++) {
        const p = map.linkPoint(l, l.rampS0 - 5 - k * 4, map.laneOffset(l, l.rampLane) + (k % 2 ? 0.8 : -0.8));
        add('cone', p.x, p.z, 0, true);
      }
    }
    // The oriented construction yards: cones, drums and crates scattered about.
    for (const y of map.yards) {
      const ys = Math.sin(y.heading), yc = Math.cos(y.heading);
      for (let k = 0; k < 26; k++) {
        const lf = pr.range(-(y.hl - 3), y.hl - 3);
        const lr = pr.range(-(y.hw - 3), y.hw - 3);
        const x = y.x + lf * ys + lr * yc;
        const z = y.z + lf * yc - lr * ys;
        if (map.rampHeight(x, z) > 0) continue;
        add(pr.pick(['cone', 'cone', 'drum', 'crate'] as const), x, z, y.heading + pr.range(0, 6));
      }
    }
  }

  static obb(p: Prop): { x: number; z: number; hw: number; hl: number; heading: number } {
    const s = PROP_SPECS[p.kind];
    return { x: p.x, z: p.z, hw: s.hw, hl: s.hl, heading: p.heading };
  }

  /** @returns integrity damage dealt to the player this tick */
  update(dt: number, player: PlayerCar, events: SimEvent[]): number {
    const px = player.x, pz = player.z;
    let damage = 0;
    this.dirty = false;
    const box = player.obb();
    const { vx: pvx, vz: pvz } = player.velocity();
    const pv = Math.hypot(pvx, pvz);

    for (const p of this.props) {
      const dx = p.x - px, dz = p.z - pz;
      // Player contact.
      if (Math.abs(dx) < 3.5 && Math.abs(dz) < 3.5 && player.y < p.y + PROP_SPECS[p.kind].h) {
        const mtv = obbOverlap(Props.obb(p), box);
        if (mtv) {
          const spec = PROP_SPECS[p.kind];
          // Send it flying, mostly the way the car is going, a bit sideways.
          const push = Math.max(pv, 2);
          const lat = this.rng.range(-0.35, 0.35);
          const heavy = spec.mass / (spec.mass + ALTO.mass);
          const k = (1.15 + this.rng.range(0, 0.35)) * (1 - heavy * 1.6);
          const dirx = pv > 0.5 ? pvx / pv : mtv.nx, dirz = pv > 0.5 ? pvz / pv : mtv.nz;
          p.vx = (dirx + -dirz * lat) * push * k + mtv.nx * 1.5;
          p.vz = (dirz + dirx * lat) * push * k + mtv.nz * 1.5;
          p.vy = 1.8 + push * this.rng.range(0.12, 0.28);
          p.spin = this.rng.range(-7, 7);
          p.tumbleRate = this.rng.range(4, 11) * (this.rng.chance(0.5) ? 1 : -1);
          // Unstick from the car this tick.
          p.x += mtv.nx * mtv.depth * -1 + dirx * 0.3;
          p.z += mtv.nz * mtv.depth * -1 + dirz * 0.3;
          if (p.state !== 1) {
            const loss = spec.mass / (spec.mass + ALTO.mass);
            player.speed *= 1 - loss * 0.6;
            if (pv > 4) damage += spec.damage;
            events.push({ type: 'smash', kind: p.kind, x: p.x, z: p.z, impact: pv });
          }
          p.state = 1;
          this.dirty = true;
        }
      }
      if (p.state === 1) {
        this.fly(p, dt);
        this.dirty = true;
      } else if (p.state === 2 && Math.hypot(dx, dz) > RESET_DIST) {
        // Out of sight: tidy it back to where it stood.
        p.x = p.homeX;
        p.z = p.homeZ;
        p.heading = p.homeHeading;
        p.y = this.map.groundY(p.x, p.z);
        p.tumble = 0;
        p.state = 0;
        this.dirty = true;
      }
    }
    return damage;
  }

  private fly(p: Prop, dt: number): void {
    p.vy -= GRAVITY * dt;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    // Bounce off oriented buildings & landmarks.
    this.map.forEachSolidNear(nx, nz, 1.5, (b) => {
      const s = Math.sin(b.heading), c = Math.cos(b.heading);
      const dx = nx - b.x, dz = nz - b.z;
      const lf = dx * s + dz * c;
      const lr = dx * c - dz * s;
      if (Math.abs(lf) < b.hl && Math.abs(lr) < b.hw) {
        const pf = b.hl - Math.abs(lf);
        const pr = b.hw - Math.abs(lr);
        let bnx: number, bnz: number;
        if (pr < pf) {
          const sg = lr >= 0 ? 1 : -1;
          bnx = sg * c;
          bnz = sg * -s;
        } else {
          const sg = lf >= 0 ? 1 : -1;
          bnx = sg * s;
          bnz = sg * c;
        }
        const rv = p.vx * bnx + p.vz * bnz;
        if (rv < 0) {
          p.vx -= 1.35 * rv * bnx;
          p.vz -= 1.35 * rv * bnz;
        }
        nx = p.x;
        nz = p.z;
      }
    });
    p.x = nx;
    p.z = nz;
    p.y += p.vy * dt;
    p.heading += p.spin * dt;
    p.tumble += p.tumbleRate * dt;
    const g = this.map.groundY(p.x, p.z);
    if (p.y <= g) {
      p.y = g;
      if (p.vy < -2.5) {
        p.vy *= -0.32;
        p.tumbleRate *= 0.6;
      } else p.vy = 0;
      const f = Math.exp(-dt * 3.5);
      p.vx *= f;
      p.vz *= f;
      p.spin *= f;
      p.tumbleRate *= Math.exp(-dt * 5);
      if (Math.hypot(p.vx, p.vz) < 0.25 && Math.abs(p.vy) < 0.1) {
        // Come to rest lying on a side (or the right way up, for heavy carts).
        const quarter = Math.round(p.tumble / (Math.PI / 2)) * (Math.PI / 2);
        p.tumble = p.kind === 'fruitcart' ? Math.round(p.tumble / Math.PI) * Math.PI : quarter;
        p.vx = p.vz = p.vy = 0;
        p.state = 2;
      }
    }
  }
}
