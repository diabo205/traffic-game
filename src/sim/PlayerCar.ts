import { approach, clamp } from './math';
import type { InputFrame, Obb, PlayerVehicle } from './types';

export interface VehicleSpec {
  readonly label: string;
  readonly tag: string;
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly wheelBase: number;
  readonly mass: number;
  /** peak drive acceleration at standstill */
  readonly driveAccel: number;
  readonly brakeDecel: number;
  readonly reverseAccel: number;
  readonly maxReverse: number;
  readonly rollingDrag: number;
  readonly aeroDrag: number;
  readonly maxSteerLow: number;
  readonly steerSpeedFalloff: number;
  readonly steerRate: number;
  readonly steerReturnRate: number;
  /** lateral grip, m/s^2 */
  readonly maxLateralAccel: number;
  /** top speed multiplier relative to road/city speed limit */
  readonly topSpeedMul: number;
  /** incoming collision damage multiplier */
  readonly damageRes: number;
}

/**
 * Arcade model of a 660cc Suzuki Alto: light, nimble, eager at low speed,
 * runs out of breath quickly. All units SI (m, s, rad).
 */
export const ALTO: VehicleSpec = {
  label: 'ALTO',
  tag: '660CC ALL-ROUNDER',
  halfWidth: 0.74,
  halfLength: 1.7,
  wheelBase: 2.36,
  mass: 750,
  driveAccel: 4.6,
  brakeDecel: 10.5,
  reverseAccel: 3.2,
  maxReverse: 5.5,
  rollingDrag: 0.28,
  aeroDrag: 0.00046,
  maxSteerLow: 0.6,
  steerSpeedFalloff: 0.042,
  steerRate: 3.4,
  steerReturnRate: 4.8,
  maxLateralAccel: 9.8,
  topSpeedMul: 1,
  damageRes: 1,
} as const;

export const VEHICLE_SPECS: Readonly<Record<PlayerVehicle, VehicleSpec>> = {
  alto: ALTO,
  rickshaw: {
    label: 'RICKSHAW',
    tag: 'RAZOR-SHARP GAP FILTER',
    halfWidth: 0.66,
    halfLength: 1.38,
    wheelBase: 1.9,
    mass: 520,
    driveAccel: 5.25,
    brakeDecel: 11.4,
    reverseAccel: 3.4,
    maxReverse: 5.0,
    rollingDrag: 0.3,
    aeroDrag: 0.0006,
    maxSteerLow: 0.72,
    steerSpeedFalloff: 0.032,
    steerRate: 3.9,
    steerReturnRate: 5.4,
    maxLateralAccel: 10.8,
    topSpeedMul: 0.9,
    damageRes: 1.15,
  },
  minibus: {
    label: 'W-11',
    tag: 'HEAVY TRAFFIC SWEEPER',
    halfWidth: 1.12,
    halfLength: 4.05,
    wheelBase: 4.8,
    mass: 4200,
    driveAccel: 3.65,
    brakeDecel: 8.6,
    reverseAccel: 2.8,
    maxReverse: 5.0,
    rollingDrag: 0.25,
    aeroDrag: 0.00055,
    maxSteerLow: 0.54,
    steerSpeedFalloff: 0.052,
    steerRate: 2.7,
    steerReturnRate: 3.9,
    maxLateralAccel: 7.8,
    topSpeedMul: 1.04,
    damageRes: 0.62,
  },
};

/** Unlock prices in cumulative earned Rupees. */
export const VEHICLE_COST: Readonly<Record<PlayerVehicle, number>> = {
  alto: 0,
  rickshaw: 400,
  minibus: 1200,
};

/** Arcade moves. */
export const MOVES = {
  /** drift: hold gas + brake together above this speed (m/s) */
  driftMinSpeed: 7,
  /** extra push while boosting (m/s^2) and how far past top speed it can go */
  boostAccel: 9.5,
  boostTopSpeed: 1.28,
  boostCooldown: 1.4,
  /** dash has its own, longer cooldown so tapping the gas never beats holding it */
  dashCooldown: 4,
  /** dash only fires below this fraction of top speed (a pick-me-up out of corners) */
  dashMaxSpeed: 0.55,
  /** how many seconds pinned at a wall with the gas held before World hints to reverse */
  pinnedHint: 1.2,
  /** quick double-tap of the gas: release then re-press within this (s) */
  dashWindow: 0.28,
  /** hold brake + gas at a standstill at least this long to launch (s), max bonus at launchMaxCharge */
  launchCharge: 0.35,
  launchMaxCharge: 0.75,
  /** gravity for jumps (m/s^2, a bit heavier than real for snappy airtime) */
  gravity: 17,
} as const;

/** Wall contact feel. */
export const WALL = {
  /** contact remembered for this many ticks (lets steering pivot you free) */
  memoryTicks: 6,
  /** hits with |cos(angle to normal)| below this count as glancing (~74° off the wall) */
  glanceMax: 0.96,
  /** fraction of the heading error to the wall tangent removed per contact tick */
  align: 0.38,
  /** speed kept per contact tick while scraping */
  scrapeKeep: 0.997,
  /** minimum speed used for steering yaw while touching a wall (m/s) */
  pivotSpeed: 3.6,
} as const;

export type BoostKind = 'launch' | 'dash' | 'drift';

export class PlayerCar {
  vehicle: PlayerVehicle = 'alto';
  spec: VehicleSpec = ALTO;

  x = 0;
  z = 0;
  /** height of the car's base above y = 0 (ground, ramps, air) */
  y = 0;
  vy = 0;
  airborne = false;
  /** seconds in the air this hop */
  airTime = 0;
  heading = 0;
  /** direction of motion; lags heading when traction is lost */
  travel = 0;
  /** signed speed along `travel` (negative = reversing) */
  speed = 0;
  steerAngle = 0;
  yawRate = 0;
  /** body roll (rad), positive = leaning to the right */
  roll = 0;
  /** body pitch (rad), positive = nose up */
  pitch = 0;
  rollVel = 0;
  pitchVel = 0;
  /** suspension displacement for jolts (m, negative = compressed) */
  bump = 0;
  bumpVel = 0;
  integrity = 100;
  /** open-world driving: no heading limit or pull back toward the route axis */
  freeRoam = false;

  /** 0..1 how loose the rear is (handbrake drift) */
  drift = 0;
  /** true while gas + brake are held at speed */
  handbrake = false;
  /** seconds of the current drift */
  driftTime = 0;
  /** seconds of boost left */
  boostTime = 0;
  /** duration of the current active boost (s), for HUD meter normalization */
  boostMax = 0.75;
  boostCooldown = 0;
  /** set for one tick when a boost fires (World turns it into an event) */
  boostFired: BoostKind | null = null;
  /** set for one tick when a drift ends: its length in seconds */
  driftEnded = 0;
  private driftDir = 0;
  private driftTurnTime = 0;
  private driftYawAccum = 0;
  private launchCharge = 0;
  private dashCooldown = 0;
  private lastTopSpeed = 27.8;
  /** seconds pinned against a wall with the gas held */
  pinnedTime = 0;
  private sinceRelease = 1e9;
  private prevThrottle = 0;
  private prevBrake = 0;
  /** vertical speed of the ground under the wheels (ramp climb) */
  private groundVy = 0;
  /** ticks since the world last reported wall contact (counts down) */
  wallContact = 0;

  horn = false;
  dipper = false;
  braking = false;
  reversing = false;
  /** 0..1 grip multiplier for this tick (water lowers it) */
  traction = 1;
  extraDrag = 0;
  /** throttle actually applied this tick (for engine audio) */
  throttle = 0;
  /** longitudinal accel this tick (m/s^2) */
  accel = 0;

  prevX = 0;
  prevZ = 0;
  prevY = 0;
  prevHeading = 0;
  prevRoll = 0;
  prevPitch = 0;
  prevBump = 0;

  setVehicle(kind: PlayerVehicle): void {
    this.vehicle = kind;
    this.spec = VEHICLE_SPECS[kind];
  }

  /** 0..1 remaining fraction of the active boost. */
  get boostFraction(): number {
    return this.boostTime > 0 ? clamp(this.boostTime / Math.max(0.2, this.boostMax), 0, 1) : 0;
  }

  /** 0..1 progress toward maximum launch boost (holding gas + brake stopped up to 0.75s). */
  get launchFraction(): number {
    return clamp(this.launchCharge / MOVES.launchMaxCharge, 0, 1);
  }

  get launchReady(): boolean {
    return this.launchCharge >= MOVES.launchCharge;
  }

  get dashReady(): boolean {
    return (
      !this.airborne &&
      this.dashCooldown <= 0 &&
      this.boostCooldown <= 0 &&
      this.speed > 5.5 &&
      this.speed < this.lastTopSpeed * MOVES.dashMaxSpeed
    );
  }

  get dashCooldownFraction(): number {
    return 1 - clamp(this.dashCooldown / MOVES.dashCooldown, 0, 1);
  }

  reset(x: number, z: number, heading = 0, y = 0): void {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.y = this.prevY = y;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.heading = this.prevHeading = heading;
    this.travel = heading;
    this.speed = 0;
    this.steerAngle = 0;
    this.yawRate = 0;
    this.roll = this.pitch = this.bump = this.bumpVel = 0;
    this.rollVel = this.pitchVel = 0;
    this.prevRoll = this.prevPitch = this.prevBump = 0;
    this.integrity = 100;
    this.horn = this.dipper = this.braking = this.reversing = false;
    this.traction = 1;
    this.extraDrag = 0;
    this.throttle = 0;
    this.accel = 0;
    this.drift = this.driftTime = this.boostTime = this.boostCooldown = 0;
    this.boostMax = 0.75;
    this.handbrake = false;
    this.boostFired = null;
    this.driftEnded = 0;
    this.driftDir = 0;
    this.driftTurnTime = 0;
    this.driftYawAccum = 0;
    this.launchCharge = 0;
    this.dashCooldown = 0;
    this.pinnedTime = 0;
    this.sinceRelease = 1e9;
    this.prevThrottle = this.prevBrake = 0;
    this.groundVy = 0;
    this.wallContact = 0;
  }

  obb(): Obb {
    return { x: this.x, z: this.z, hw: this.spec.halfWidth, hl: this.spec.halfLength, heading: this.heading };
  }

  /** Velocity vector in world space. */
  velocity(): { vx: number; vz: number } {
    return { vx: Math.sin(this.travel) * this.speed, vz: Math.cos(this.travel) * this.speed };
  }

  /** Apply a world-space velocity back onto the speed/travel representation. */
  setVelocity(vx: number, vz: number): void {
    const fwdX = Math.sin(this.heading), fwdZ = Math.cos(this.heading);
    const along = vx * fwdX + vz * fwdZ;
    const mag = Math.hypot(vx, vz);
    if (mag < 0.05) {
      this.speed = 0;
      this.travel = this.heading;
      return;
    }
    this.speed = along >= 0 ? mag : -mag;
    const dirX = along >= 0 ? vx : -vx;
    const dirZ = along >= 0 ? vz : -vz;
    this.travel = Math.atan2(dirX, dirZ);
  }

  kick(impulse: number): void {
    this.bumpVel += impulse;
  }

  savePrev(): void {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevY = this.y;
    this.prevHeading = this.heading;
    this.prevRoll = this.roll;
    this.prevPitch = this.pitch;
    this.prevBump = this.bump;
  }

  /**
   * The world resolved a static collision with surface normal (nx, nz) and
   * already removed the velocity into it. Arcade wall feel: a glancing hit
   * swings the nose along the wall so the car slides on instead of
   * re-steering itself into the wall every tick (sticky walls).
   * Head-on hits keep the bounce; steering then pivots the car free.
   */
  scrapeWall(nx: number, nz: number): void {
    this.wallContact = WALL.memoryTicks;
    if (this.airborne) return;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rev = this.speed < -0.15;
    // Reverse travel enters along (-fx, -fz), forward along (+fx, +fz).
    const into = rev ? fx * nx + fz * nz : -(fx * nx + fz * nz);
    if (into <= 0) return;

    const orientAlong = (tx: number, tz: number, weight: number) => {
      const target = Math.atan2(tx, tz);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * weight;
      const keep = Math.abs(this.speed) * WALL.scrapeKeep;
      if (rev) {
        this.speed = -keep;
        this.travel = this.heading;
      } else {
        const { vx, vz } = this.velocity();
        const mag = Math.hypot(vx, vz);
        if (mag < 0.05) {
          this.speed = 0;
          this.travel = this.heading;
        } else {
          this.speed = keep;
          this.travel = into <= 0.85 ? this.heading : Math.atan2(vx, vz);
        }
      }
    };

    if (into > WALL.glanceMax) {
      // Nearly head-on (or tail-on): deflect gently toward steered escape tangent.
      if (Math.abs(this.steerAngle) > 0.04) {
        let tx = -nz, tz = nx;
        const turnBias = rev ? -this.steerAngle : this.steerAngle;
        if (turnBias * (fz * tx - fx * tz) < 0) {
          tx = -tx;
          tz = -tz;
        }
        orientAlong(tx, tz, 0.18);
      }
      return;
    }

    // Glancing wall hit: align nose/tail along the forward wall tangent.
    let tx = -nz, tz = nx;
    if (into > 0.85 && Math.abs(this.steerAngle) > 0.08) {
      const turnBias = rev ? -this.steerAngle : this.steerAngle;
      if (turnBias * (fz * tx - fx * tz) < 0) {
        tx = -tx;
        tz = -tz;
      }
    } else if (tx * fx + tz * fz < 0) {
      tx = -tx;
      tz = -tz;
    }
    orientAlong(tx, tz, Math.min(1, WALL.align + (1 - into) * 0.4));
  }

  private boost(kind: BoostKind, seconds: number): void {
    if (this.boostCooldown > 0) return;
    this.boostTime = Math.max(this.boostTime, seconds);
    this.boostMax = Math.max(this.boostTime, 0.35);
    this.boostCooldown = MOVES.boostCooldown;
    this.boostFired = kind;
  }

  /** @param vTop top speed here (m/s) */
  update(input: InputFrame, vTop: number, dt: number, controllable: boolean): void {
    const sp = this.spec;
    this.lastTopSpeed = vTop;
    const throttle = controllable ? input.throttle : 0;
    const brake = controllable ? input.brake : 0.6;
    const steerIn = controllable ? input.steer : 0;
    this.horn = controllable && input.horn;
    this.dipper = controllable && input.dipper;
    this.boostFired = null;
    this.driftEnded = 0;
    if (this.wallContact > 0) this.wallContact--;

    const v = this.speed;
    const absV = Math.abs(v);
    const air = this.airborne;

    let slipNow = this.heading - this.travel;
    slipNow = Math.atan2(Math.sin(slipNow), Math.cos(slipNow));

    // --- Arcade moves -----------------------------------------------------------
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.boostTime = Math.max(0, this.boostTime - dt);
    // Handbrake drift: gas + brake together while moving fast.
    // Charging drift-boost requires committed single-direction turning (blocks micro-steer & ±wiggle exploits).
    const wasHandbrake = this.handbrake;
    this.handbrake = !air && throttle > 0.5 && brake > 0.5 && v > (wasHandbrake ? 3 : MOVES.driftMinSpeed);
    this.drift = this.handbrake ? approach(this.drift, 1, dt * 6) : approach(this.drift, 0, dt * 1.8);
    if (this.handbrake) {
      const turnSign = Math.abs(steerIn) >= 0.22 && Math.abs(this.yawRate) >= 0.38 ? Math.sign(steerIn) : 0;
      if (turnSign !== 0) {
        if (this.driftDir === 0 || this.driftDir === turnSign) {
          this.driftDir = turnSign;
          this.driftTurnTime += dt;
          this.driftYawAccum += Math.abs(this.yawRate) * dt;
        } else {
          // Steering direction reversed mid-drift: restart drift charge so ±wiggling cannot farm straight-line boost.
          this.driftDir = turnSign;
          this.driftTurnTime = dt;
          this.driftYawAccum = 0;
          this.driftTime = 0;
        }
      } else {
        this.driftTurnTime = Math.max(0, this.driftTurnTime - dt * 2);
      }
      if (this.driftTurnTime >= 0.04 && (Math.abs(steerIn) >= 0.22 || (this.driftYawAccum >= 0.22 && Math.abs(this.yawRate) >= 0.42))) {
        this.driftTime += dt;
      }
    } else if (wasHandbrake) {
      // Powering out of a drift gives a boost (mini-boost for >=0.45s micro-drifts, full >=0.7s).
      if (this.driftTime >= 0.445 && this.driftYawAccum >= 0.22 && throttle > 0.5) {
        const dur = this.driftTime >= 0.7 ? Math.min(0.75, 0.34 + this.driftTime * 0.15) : 0.24 + Math.max(0, this.driftTime - 0.45) * 0.32;
        this.boost('drift', dur);
      }
      this.driftEnded = this.driftTime;
      this.driftTime = 0;
      this.driftDir = 0;
      this.driftTurnTime = 0;
      this.driftYawAccum = 0;
    }
    // Launch: rev against the brake at a standstill, then let the brake go (monotonic reward up to 0.75s).
    const chargingLaunch = !air && absV < 0.8 && throttle > 0.5 && brake > 0.5;
    if (chargingLaunch) this.launchCharge = Math.min(MOVES.launchMaxCharge, this.launchCharge + dt);
    else {
      if (this.launchCharge >= MOVES.launchCharge && throttle > 0.5 && brake < 0.2 && this.prevBrake >= 0.2) {
        this.boost('launch', 0.45 + Math.max(0, this.launchCharge - MOVES.launchCharge) * 1.45);
      }
      if (brake < 0.2 || throttle < 0.5) this.launchCharge = 0;
    }
    // Dash: a quick re-tap of the gas while rolling out of a corner (v > 5.5 m/s blocks straight-start tap cheese).
    if (throttle < 0.2 && this.prevThrottle >= 0.2) this.sinceRelease = 0;
    else this.sinceRelease += dt;
    if (!air && throttle > 0.8 && this.prevThrottle <= 0.8 && this.sinceRelease < MOVES.dashWindow && v > 5.5 && v < vTop * MOVES.dashMaxSpeed && brake < 0.2 && this.dashCooldown <= 0 && this.boostCooldown <= 0) {
      this.boost('dash', 0.6);
      this.dashCooldown = MOVES.dashCooldown;
    }
    this.prevThrottle = throttle;
    this.prevBrake = brake;
    const boosting = this.boostTime > 0;
    const top = boosting ? vTop * MOVES.boostTopSpeed : vTop;

    // --- Steering --------------------------------------------------------
    const maxSteer = sp.maxSteerLow / (1 + absV * sp.steerSpeedFalloff * (1 - this.drift * 0.45));
    const target = steerIn * maxSteer;
    const rate = Math.abs(target) < Math.abs(this.steerAngle) ? sp.steerReturnRate : sp.steerRate;
    this.steerAngle = approach(this.steerAngle, target, rate * maxSteer * dt * 2.2);

    // --- Longitudinal ----------------------------------------------------
    let a = 0;
    this.reversing = false;
    if (air) {
      // No grip in the air: just drag.
    } else if (chargingLaunch) {
      // Hold wheels locked cleanly while staging Launch (no 0.3 km/h creep).
      a -= v / dt;
    } else if (this.handbrake) {
      // Rear locked, engine still pulling: slight speed bleed without killing corner momentum.
      a += throttle * sp.driveAccel * 0.58 - 0.65;
    } else if (v >= -0.2) {
      // Forward gear.
      const ratio = Math.max(v, 0) / top;
      // Sixth-order taper + steady-drag compensation: strong pull through top-20%
      // so the vehicle cleanly hits its nominal zone limit within <3.5s from 80%.
      const r2 = ratio * ratio;
      const r6 = r2 * r2 * r2;
      const steadyDrag = sp.rollingDrag + sp.aeroDrag * top * top;
      const drive = ratio < 1 ? sp.driveAccel * Math.max(0.22, 1 - r6) + steadyDrag * Math.min(1, ratio * 1.05) : -(ratio - 1) * sp.driveAccel * 5;
      // Part throttle (sticks, triggers) responds a little more eagerly.
      a += Math.pow(throttle, 0.7) * drive;
      if (ratio > 1 && throttle < 0.05) a -= (ratio - 1) * 6;
      if (brake > 0.05) {
        // Arcade stop: brakes bite harder as you slow, so you stop on a dime.
        if (v > 0.6) a -= brake * sp.brakeDecel * (v < 14 ? 1.7 : 1.2);
        else if (throttle < 0.1 && controllable) {
          // Hold brake at standstill -> reverse.
          a -= brake * sp.reverseAccel;
          this.reversing = true;
        } else a -= v / dt; // stop
      }
    } else {
      // Reversing.
      this.reversing = true;
      const revRatio = Math.max(-v, 0) / sp.maxReverse;
      if (brake > 0.05) a -= brake * sp.reverseAccel * clamp(1 - revRatio * revRatio, 0, 1);
      if (throttle > 0.05) a += throttle * sp.brakeDecel;
      if (v < -sp.maxReverse) a += (-sp.maxReverse - v) * 6;
    }
    if (boosting && !air && v > -0.2 && !this.handbrake) a += MOVES.boostAccel * Math.max(0, 1 - Math.max(v, 0) / top);
    const drag = sp.rollingDrag * (air ? 0 : 1) + sp.aeroDrag * v * v + this.extraDrag;
    if (absV > 0.01) a -= Math.sign(v) * Math.min(drag, absV / dt);
    // Sliding sideways scrubs speed.
    if (!air && absV > 1) a -= Math.sign(v) * Math.abs(Math.sin(slipNow)) * 1.8;

    let nv = v + a * dt;
    // Don't let braking flip direction from forward into reverse in one tick.
    if (v > 0 && nv < 0 && !this.reversing) nv = 0;
    if (v < 0 && nv > 0 && throttle > 0.05) nv = 0;
    this.speed = nv;
    this.accel = a;
    this.throttle = throttle;
    this.braking = brake > 0.05 && !this.reversing && !this.handbrake;

    // --- Yaw (kinematic bicycle, capped by lateral grip) -------------------
    let yaw: number;
    if (air) {
      // Keep whatever spin we took off with.
      yaw = this.yawRate * Math.exp(-dt * 0.6);
    } else {
      const grip = sp.maxLateralAccel * this.traction;
      const d = this.drift;
      // Pinned against a wall: let gas/brake + steer pivot the nose off it.
      const pinned = this.wallContact > 0 && Math.abs(nv) < WALL.pivotSpeed && (throttle > 0.1 || brake > 0.1);
      const yawV = pinned ? (nv < -0.2 || (brake > 0.1 && throttle < 0.1) ? -WALL.pivotSpeed : WALL.pivotSpeed) : nv;
      yaw = ((yawV * Math.tan(this.steerAngle)) / sp.wheelBase) * (1 + d * 0.5);
      const maxYaw = grip / Math.max(Math.abs(nv), 1);
      // Loose rear (drift) or low traction: the car rotates more freely than it changes course.
      const loose = Math.max(d, this.traction < 0.6 ? 1 : 0);
      const yawCap = maxYaw * (1 + loose * 1.1) + loose * 0.35;
      yaw = clamp(yaw, -yawCap, yawCap);
    }
    this.yawRate = yaw;
    this.heading += yaw * dt;
    // Arcade drift: the slide angle tops out instead of spinning the car round.
    if (!air && this.drift > 0.05 && absV > 3) {
      let sl = this.heading - this.travel;
      sl = Math.atan2(Math.sin(sl), Math.cos(sl));
      const maxSlip = 0.8;
      if (Math.abs(sl) > maxSlip) this.heading -= (sl - Math.sign(sl) * maxSlip);
    }

    // Travel direction catches up with heading according to grip.
    if (!air) {
      const grip = this.traction * this.traction * (1 - this.drift * 0.9);
      const catchUp = 1 - Math.exp(-dt * (1.6 + 14.4 * grip));
      let diff = this.heading - this.travel;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.travel += diff * catchUp;
    }

    // Self-align heading toward road direction a touch when nearly straight
    // (keeps arcade cars from drifting slowly off-axis forever).
    if (!this.freeRoam) {
      if (Math.abs(steerIn) < 0.05 && absV > 1 && !this.handbrake) {
        this.heading -= this.heading * Math.min(1, 0.35 * dt);
      }
      this.heading = clamp(this.heading, -1.3, 1.3);
    }

    // --- Integrate position -------------------------------------------------
    this.x += Math.sin(this.travel) * nv * dt;
    this.z += Math.cos(this.travel) * nv * dt;

    // --- Body motion (visual, but deterministic) ----------------------------
    // Under-damped springs so the body leans into a turn, settles with a
    // little wobble, squats on the gas and dives under braking. In the air
    // the nose follows the flight path.
    const latAccel = air ? 0 : nv * yaw;
    const rollTarget = clamp(-latAccel * 0.0115, -0.12, 0.12);
    this.rollVel += (90 * (rollTarget - this.roll) - 10 * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    const pitchTarget = air ? clamp(Math.atan2(this.vy, Math.max(absV, 4)) * 0.8, -0.45, 0.4) : clamp(a * 0.0075, -0.075, 0.045);
    const pk = air ? 30 : 75;
    this.pitchVel += (pk * (pitchTarget - this.pitch) - 10 * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;

    // Suspension spring for jolts.
    const k = 160, c = 11;
    this.bumpVel += (-k * this.bump - c * this.bumpVel) * dt;
    this.bump += this.bumpVel * dt;

    if (this.wallContact > 0 && throttle > 0.5 && brake < 0.2 && Math.abs(this.speed) < 1.5) {
      this.pinnedTime += dt;
    } else if (Math.abs(this.speed) > 3 || brake > 0.2) {
      this.pinnedTime = 0;
    } else {
      this.pinnedTime = Math.max(0, this.pinnedTime - dt);
    }

    // Reset per-tick surface modifiers; World re-applies them.
    this.traction = 1;
    this.extraDrag = 0;
  }

  /**
   * Follow the ground, or fly. Leaving the top of a ramp fast enough throws
   * the car into the air with the ramp's climb rate.
   * @returns landing impact speed (m/s) on the tick the car touches down, else 0
   */
  settle(groundH: number, dt: number): number {
    if (this.airborne) {
      this.vy -= MOVES.gravity * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= groundH) {
        const impact = -this.vy;
        this.y = groundH;
        this.vy = 0;
        this.airborne = false;
        this.groundVy = 0;
        this.kick(-Math.min(1.4, 0.1 + impact * 0.11));
        return Math.max(impact, 0.01);
      }
      return 0;
    }
    const drop = this.y - groundH;
    if ((drop > 0.06 && this.groundVy > 1.2) || drop > 0.3) {
      // Ramp lip (or a ledge): take off.
      this.airborne = true;
      this.airTime = 0;
      this.vy = Math.max(0, this.groundVy);
      this.y += this.vy * dt;
      return 0;
    }
    this.groundVy = clamp((groundH - this.y) / dt, -20, 20);
    this.y = groundH;
    return 0;
  }
}
