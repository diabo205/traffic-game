import { approach, clamp } from './math';
import type { InputFrame, Obb } from './types';

/**
 * Arcade model of a 660cc Suzuki Alto: light, nimble, eager at low speed,
 * runs out of breath quickly. All units SI (m, s, rad).
 */
export const ALTO = {
  halfWidth: 0.74,
  halfLength: 1.7,
  wheelBase: 2.36,
  mass: 750,
  /** peak drive acceleration at standstill */
  driveAccel: 4.6,
  brakeDecel: 10.5,
  reverseAccel: 3.2,
  maxReverse: 5.5,
  rollingDrag: 0.28,
  aeroDrag: 0.00095,
  maxSteerLow: 0.6,
  steerSpeedFalloff: 0.065,
  steerRate: 3.2,
  steerReturnRate: 4.5,
  /** lateral grip, m/s^2 */
  maxLateralAccel: 9.5,
} as const;

export class PlayerCar {
  x = 0;
  z = 0;
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
  prevHeading = 0;
  prevRoll = 0;
  prevPitch = 0;
  prevBump = 0;

  reset(x: number, z: number, heading = 0): void {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
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
  }

  obb(): Obb {
    return { x: this.x, z: this.z, hw: ALTO.halfWidth, hl: ALTO.halfLength, heading: this.heading };
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
    this.prevHeading = this.heading;
    this.prevRoll = this.roll;
    this.prevPitch = this.pitch;
    this.prevBump = this.bump;
  }

  /** @param vTop top speed here (m/s) */
  update(input: InputFrame, vTop: number, dt: number, controllable: boolean): void {
    const throttle = controllable ? input.throttle : 0;
    const brake = controllable ? input.brake : 0.6;
    const steerIn = controllable ? input.steer : 0;
    this.horn = controllable && input.horn;
    this.dipper = controllable && input.dipper;

    const v = this.speed;
    const absV = Math.abs(v);

    // --- Steering --------------------------------------------------------
    const maxSteer = ALTO.maxSteerLow / (1 + absV * ALTO.steerSpeedFalloff);
    const target = steerIn * maxSteer;
    const rate = Math.abs(target) < Math.abs(this.steerAngle) ? ALTO.steerReturnRate : ALTO.steerRate;
    this.steerAngle = approach(this.steerAngle, target, rate * maxSteer * dt * 2.2);

    // --- Longitudinal ----------------------------------------------------
    let a = 0;
    this.reversing = false;
    if (v >= -0.2) {
      // Forward gear.
      const ratio = Math.max(v, 0) / vTop;
      const drive = ratio < 1 ? 1 - ratio * ratio : -(ratio - 1) * 4; // over the zone limit -> engine braking
      a += throttle * ALTO.driveAccel * drive;
      if (ratio > 1 && throttle < 0.05) a -= (ratio - 1) * 6;
      if (brake > 0.05) {
        if (v > 0.6) a -= brake * ALTO.brakeDecel;
        else if (throttle < 0.1 && controllable) {
          // Hold brake at standstill -> reverse.
          a -= brake * ALTO.reverseAccel;
          this.reversing = true;
        } else a -= v / dt; // stop
      }
    } else {
      // Reversing.
      this.reversing = true;
      if (brake > 0.05) a -= brake * ALTO.reverseAccel;
      if (throttle > 0.05) a += throttle * ALTO.brakeDecel;
      if (v < -ALTO.maxReverse) a += (-ALTO.maxReverse - v) * 4;
    }
    const drag = ALTO.rollingDrag + ALTO.aeroDrag * v * v + this.extraDrag;
    if (absV > 0.01) a -= Math.sign(v) * Math.min(drag, absV / dt);

    let nv = v + a * dt;
    // Don't let braking flip direction from forward into reverse in one tick.
    if (v > 0 && nv < 0 && !this.reversing) nv = 0;
    if (v < 0 && nv > 0 && throttle > 0.05) nv = 0;
    this.speed = nv;
    this.accel = a;
    this.throttle = throttle;
    this.braking = brake > 0.05 && !this.reversing;

    // --- Yaw (kinematic bicycle, capped by lateral grip) -------------------
    const grip = ALTO.maxLateralAccel * this.traction;
    let yaw = (nv * Math.tan(this.steerAngle)) / ALTO.wheelBase;
    const maxYaw = grip / Math.max(Math.abs(nv), 1);
    // On low traction the car rotates more freely than it can change course.
    const yawCap = this.traction < 0.6 ? maxYaw * 2.2 + 0.4 : maxYaw;
    yaw = clamp(yaw, -yawCap, yawCap);
    this.yawRate = yaw;
    this.heading += yaw * dt;

    // Travel direction catches up with heading according to traction.
    const catchUp = 1 - Math.exp(-dt * (2 + 14 * this.traction * this.traction));
    let diff = this.heading - this.travel;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.travel += diff * catchUp;

    // Self-align heading toward road direction a touch when nearly straight
    // (keeps arcade cars from drifting slowly off-axis forever).
    if (!this.freeRoam) {
      if (Math.abs(steerIn) < 0.05 && absV > 1) {
        this.heading -= this.heading * Math.min(1, 0.35 * dt);
      }
      this.heading = clamp(this.heading, -1.3, 1.3);
    }

    // --- Integrate position -------------------------------------------------
    this.x += Math.sin(this.travel) * nv * dt;
    this.z += Math.cos(this.travel) * nv * dt;

    // --- Body motion (visual, but deterministic) ----------------------------
    // Under-damped springs so the body leans into a turn, settles with a
    // little wobble, squats on the gas and dives under braking.
    const latAccel = nv * yaw;
    const rollTarget = clamp(-latAccel * 0.0115, -0.12, 0.12);
    this.rollVel += (90 * (rollTarget - this.roll) - 10 * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    // Nose up (squat) when accelerating, nose down (dive) when braking.
    const pitchTarget = clamp(a * 0.0075, -0.075, 0.045);
    this.pitchVel += (75 * (pitchTarget - this.pitch) - 10 * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;

    // Suspension spring for jolts.
    const k = 160, c = 11;
    this.bumpVel += (-k * this.bump - c * this.bumpVel) * dt;
    this.bump += this.bumpVel * dt;

    // Reset per-tick surface modifiers; World re-applies them.
    this.traction = 1;
    this.extraDrag = 0;
  }
}
