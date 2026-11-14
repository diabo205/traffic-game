import type { PlayerCar } from '../PlayerCar';
import { NPC_SPECS } from '../TrafficManager';
import type { SimEvent } from '../types';
import type { CityNpc } from './CityTraffic';

/**
 * Stunts and combos. Near misses, drifts, donuts, air time, jumping over traffic
 * and smashing things all score points. Chaining stunts within a few
 * seconds builds a multiplier; when the chain lapses the combo banks into
 * your score and, if you have a passenger, earns a tip. A real crash breaks
 * the chain and the unbanked points are lost.
 */

/** Seconds to land the next stunt before the combo banks. */
export const COMBO_WINDOW = 3;
const MAX_MULT = 8;
const NEAR_GAP = 0.9;
const NEAR_SPEED = 11;
const SMASH_POINTS: Readonly<Record<string, number>> = { cone: 15, chair: 15, crate: 20, drum: 25, stall: 40, fruitcart: 60 };

export class Stunts {
  /** points waiting to bank (before the multiplier) */
  pending = 0;
  mult = 0;
  /** seconds left in the combo window */
  window = 0;
  score = 0;
  shiftScore = 0;
  bestCombo = 0;
  private nearTick = new Map<number, number>();
  private overTick = new Map<number, number>();
  private donutTime = 0;
  private donutCooldown = 0;
  private donutAnchorX = 1e6;
  private donutAnchorZ = 1e6;
  private sameSpotDonuts = 0;
  private shaveCooldown = 0;
  private smashCooldown = 0;
  private fareTipLeft = 320;

  get active(): boolean {
    return this.mult > 0;
  }

  resetShift(): void {
    this.shiftScore = 0;
    this.bestCombo = 0;
    this.donutTime = 0;
    this.donutCooldown = 0;
    this.donutAnchorX = 1e6;
    this.donutAnchorZ = 1e6;
    this.sameSpotDonuts = 0;
    this.shaveCooldown = 0;
    this.smashCooldown = 0;
    this.fareTipLeft = 320;
  }

  private add(kind: string, label: string, points: number, events: SimEvent[]): void {
    const pts = Math.round(points / 5) * 5;
    if (pts <= 0) return;
    this.pending += pts;
    this.mult = Math.min(MAX_MULT, this.mult + 1);
    this.window = COMBO_WINDOW;
    events.push({ type: 'stunt', kind, label, points: pts, mult: this.mult });
  }

  /** React to this tick's world events (landings, drifts, smashes, crashes, dodges). */
  handle(e: SimEvent, events: SimEvent[]): void {
    switch (e.type) {
      case 'pickup':
        this.fareTipLeft = e.kind === 'vip' ? 520 : e.kind === 'party' ? 540 : 320;
        break;
      case 'smash':
        if (e.impact > 7 && this.smashCooldown <= 0) {
          this.smashCooldown = 0.45;
          this.add('smash', e.kind === 'fruitcart' ? 'THELA SMASH' : 'SMASH', SMASH_POINTS[e.kind] ?? 15, events);
        }
        break;
      case 'land':
        if (e.air > 0.35) this.add('air', `AIR ${e.air.toFixed(1)}s`, 60 + e.air * 220, events);
        break;
      case 'drift':
        this.add('drift', `DRIFT ${e.seconds.toFixed(1)}s`, e.seconds * 90, events);
        break;
      case 'pedDodge':
        if (this.shaveCooldown <= 0) {
          this.shaveCooldown = 1.5;
          this.add('shave', 'CLOSE SHAVE', 35 * Math.min(2, e.count), events);
        }
        break;
      case 'crash':
        if (e.damage >= 4) this.breakCombo(events);
        break;
      case 'towed':
        this.breakCombo(events);
        break;
      default:
        break;
    }
  }

  private breakCombo(events: SimEvent[]): void {
    if (this.mult > 0 && this.pending > 0) events.push({ type: 'comboBroken', lost: this.pending * this.mult });
    this.pending = 0;
    this.mult = 0;
    this.window = 0;
    this.donutTime = 0;
  }

  update(
    dt: number,
    tick: number,
    p: PlayerCar,
    npcs: readonly CityNpc[],
    carrying: boolean,
    events: SimEvent[],
    pay: (rs: number) => void,
    partyCount = 1,
  ): void {
    if (this.donutCooldown > 0) this.donutCooldown = Math.max(0, this.donutCooldown - dt);
    if (this.shaveCooldown > 0) this.shaveCooldown = Math.max(0, this.shaveCooldown - dt);
    if (this.smashCooldown > 0) this.smashCooldown = Math.max(0, this.smashCooldown - dt);

    const v = Math.abs(p.speed);
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const sp = p.spec;

    // Sustained tight spin (gas + steer / handbrake circle) -> DONUT stunt (diminishes if farmed in one spot).
    if (!p.airborne && Math.abs(p.yawRate) > 1.45 && v > 2 && v < 13.5 && (p.handbrake || Math.abs(p.steerAngle) > 0.35)) {
      this.donutTime += dt;
      if (this.donutTime >= 0.85 && this.donutCooldown <= 0) {
        if (Math.hypot(p.x - this.donutAnchorX, p.z - this.donutAnchorZ) < 24) {
          this.sameSpotDonuts++;
        } else {
          this.donutAnchorX = p.x;
          this.donutAnchorZ = p.z;
          this.sameSpotDonuts = 0;
        }
        const pts = this.sameSpotDonuts === 0 ? 95 : this.sameSpotDonuts === 1 ? 45 : 0;
        if (pts > 0) this.add('donut', 'DONUT', pts, events);
        this.donutTime = 0;
        this.donutCooldown = 1.8;
      }
    } else {
      this.donutTime = Math.max(0, this.donutTime - dt * 2);
    }

    for (const n of npcs) {
      const dx = n.x - p.x, dz = n.z - p.z;
      if (Math.abs(dx) > 9 || Math.abs(dz) > 9) continue;
      const spec = NPC_SPECS[n.kind];
      // Jumped clean over it.
      if (p.airborne && p.y > 1.2 && Math.hypot(dx, dz) < spec.hl + 0.5 && tick - (this.overTick.get(n.id) ?? -1e9) > 120) {
        this.overTick.set(n.id, tick);
        this.add('over', 'OVER THE TOP', 250, events);
        continue;
      }
      // Near miss: alongside it, a hand's width apart, fast, and not touching.
      if (v < NEAR_SPEED || p.airborne) continue;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * fz - dz * fx);
      const cosRel = Math.cos(n.heading - p.heading);
      // Footprint of the NPC across the car's sideways axis.
      const nAcross = spec.hw * Math.abs(cosRel) + spec.hl * Math.sqrt(Math.max(0, 1 - cosRel * cosRel));
      const gap = lat - sp.halfWidth - nAcross;
      if (Math.abs(along) > sp.halfLength + spec.hl || gap <= 0.05 || gap > NEAR_GAP) continue;
      if (tick - n.lastHitTick < 120) continue;
      if (tick - (this.nearTick.get(n.id) ?? -1e9) < 180) continue;
      this.nearTick.set(n.id, tick);
      const oncoming = cosRel < -0.5;
      const close = 1 - gap / NEAR_GAP;
      const pts = (40 + close * 60 + (v - NEAR_SPEED) * 3) * (oncoming ? 2 : 1);
      this.add('near', oncoming ? 'ONCOMING NEAR MISS' : 'NEAR MISS', pts, events);
    }
    // Forget old entries so the maps don't grow forever.
    if (tick % 600 === 0) {
      for (const [id, t] of this.nearTick) if (tick - t > 600) this.nearTick.delete(id);
      for (const [id, t] of this.overTick) if (tick - t > 600) this.overTick.delete(id);
    }

    // The window freezes while a stunt is still going (drifting, spinning a fresh donut, in the air).
    const activeDonut = this.sameSpotDonuts < 2 && this.donutTime >= 0.25;
    if (this.mult > 0 && !p.handbrake && !p.airborne && !activeDonut) {
      this.window -= dt;
      if (this.window <= 0) {
        const total = this.pending * this.mult;
        this.score += total;
        this.shiftScore += total;
        this.bestCombo = Math.max(this.bestCombo, total);
        // Passengers tip for a good show (multi-passenger party rides boost tips, capped per fare).
        const mult = 1 + Math.max(0, partyCount - 1) * 0.35;
        const rawTip = carrying ? Math.round((total * mult) / 8 / 10) * 10 : 0;
        const tip = Math.min(rawTip, this.fareTipLeft);
        this.fareTipLeft = Math.max(0, this.fareTipLeft - tip);
        if (tip > 0) pay(tip);
        events.push({ type: 'comboEnd', total, mult: this.mult, tip });
        this.pending = 0;
        this.mult = 0;
        this.window = 0;
      }
    }
  }
}
