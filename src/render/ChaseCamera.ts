import * as THREE from 'three';

export interface ChaseInput {
  /** direction of motion (sim rad); differs from heading in a slide */
  travel: number;
  /** 0..1 extra FOV push (expressway speed rush) */
  fovKick: number;
  /** suspension displacement (m) */
  bump: number;
  /** 0..1 how hard the tyres are sliding (drift rumble) */
  slide: number;
  /** speed (m/s) at which the FOV is fully widened */
  topSpeed: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Cheap smooth 1D noise in -1..1 (sum of incommensurate sines). */
const noise = (t: number, seed: number) =>
  (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.79 + seed * 2.9) * 0.2);

/**
 * Third-person chase camera.
 *  - Position rides a slightly under-damped spring behind the car, so it
 *    lags on launch and swings out a touch in corners before settling.
 *  - Orbit yaw follows a blend of heading and travel direction, so in a
 *    slide the camera looks where the car is going, not where it points.
 *  - FOV widens smoothly with speed; the camera drops a little and pulls back.
 *  - Shake = impact trauma + a subtle speed rumble + drift rumble, plus a
 *    slight roll into turns.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private lookAhead = new THREE.Vector3();
  private yaw = 0;
  private yawVel = 0;
  private roll = 0;
  private trauma = 0;
  private fov = 62;
  private time = 0;
  private initialised = false;

  /** Distance behind and height above the car. */
  distance = 5.0;
  height = 2.2;
  baseFov = 62;
  /** Extra degrees of FOV at full speed. */
  speedFov = 14;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.3, 520);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  reset(): void {
    this.initialised = false;
    this.trauma = 0;
  }

  /** Pixels per world unit at distance 1 (for size-attenuated point sprites). */
  pixelScale(bufferHeight: number): number {
    return bufferHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /**
   * @param target car position (three space)
   * @param heading sim heading (rad, + = right)
   * @param speed m/s (negative reversing)
   */
  update(dt: number, target: THREE.Vector3, heading: number, speed: number, o: ChaseInput): void {
    this.time += dt;
    const fwd = Math.max(0, speed);
    const ratio = Math.min(1.2, fwd / Math.max(1, o.topSpeed));

    // ---- Orbit yaw: spring toward heading, biased into the slide ---------------------
    const slip = wrap(o.travel - heading);
    const yawTarget = heading + (fwd > 3 ? slip * 0.55 : 0);
    if (!this.initialised) {
      this.yaw = yawTarget;
      this.yawVel = 0;
    }
    const prevYaw = this.yaw;
    // Sub-step the springs: frame dt can be large on slow devices.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const err = wrap(yawTarget - this.yaw);
      this.yawVel += (38 * err - 11.5 * this.yawVel) * h;
      this.yaw += this.yawVel * h;
    }
    const turnRate = (this.yaw - prevYaw) / Math.max(dt, 1e-4);

    // ---- Desired position: further back and a bit lower at speed -----------------------
    const back = speed < -0.5 ? -0.6 : 1; // keep looking forward when reversing slowly
    const dist = this.distance + ratio * 0.8;
    const height = this.height - ratio * 0.25;
    this.desired.set(
      target.x - Math.sin(this.yaw) * dist * back,
      target.y + height,
      target.z + Math.cos(this.yaw) * dist * back,
    );
    if (!this.initialised) {
      this.pos.copy(this.desired);
      this.vel.set(0, 0, 0);
      this.look.copy(target);
      this.fov = this.baseFov;
      this.initialised = true;
    }

    // ---- Spring-damper follow (zeta ~0.8: a hint of overshoot, no wobble) --------------
    const k = 70, c = 13.5, kY = 110, cY = 19;
    for (let i = 0; i < steps; i++) {
      const ax = k * (this.desired.x - this.pos.x) - c * this.vel.x;
      const ay = kY * (this.desired.y - this.pos.y) - cY * this.vel.y;
      const az = k * (this.desired.z - this.pos.z) - c * this.vel.z;
      this.vel.x += ax * h;
      this.vel.y += ay * h;
      this.vel.z += az * h;
      this.pos.x += this.vel.x * h;
      this.pos.y += this.vel.y * h;
      this.pos.z += this.vel.z * h;
    }
    // Never lag so far the car leaves the frame or the camera enters it.
    const lagX = this.pos.x - this.desired.x, lagY = this.pos.y - this.desired.y, lagZ = this.pos.z - this.desired.z;
    const lag = Math.hypot(lagX, lagY, lagZ);
    if (lag > 2.2) {
      const s = 2.2 / lag;
      this.pos.set(this.desired.x + lagX * s, this.desired.y + lagY * s, this.desired.z + lagZ * s);
    }
    // Keep above the ground / kerb.
    this.pos.y = Math.max(this.pos.y, target.y + 0.9);

    // Look ahead of the car, further at speed.
    const ahead = 6 + ratio * 4;
    this.lookAhead.set(target.x + Math.sin(this.yaw) * ahead, target.y + 1.1, target.z - Math.cos(this.yaw) * ahead);
    this.look.lerp(this.lookAhead, 1 - Math.exp(-dt * 12));

    // ---- Shake ------------------------------------------------------------------------------
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const t = this.time;
    const impact = this.trauma * this.trauma;
    // Subtle road rumble that grows with speed, and a buzz while sliding.
    const rumble = 0.004 + 0.022 * ratio * ratio + 0.035 * o.slide;
    const freq = 9 + ratio * 14 + o.slide * 10;
    const sx = noise(t * 11, 1.3) * 0.38 * impact + noise(t * freq, 4.1) * rumble;
    const sy = noise(t * 13, 7.7) * 0.32 * impact + noise(t * freq * 1.1, 9.2) * rumble * 0.8 + o.bump * 0.5;

    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look.x + sx * 0.5, this.look.y + sy * 0.6, this.look.z);
    // Roll a little into turns (the horizon tilts with the car), plus impact roll.
    const rollTarget = Math.max(-0.045, Math.min(0.045, -turnRate * fwd * 0.0016));
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-dt * 5));
    this.camera.rotateZ(this.roll + noise(t * 9, 2.2) * 0.03 * impact);

    // ---- FOV: widens smoothly with speed, extra push on the expressway -------------------
    const targetFov = this.baseFov + this.speedFov * smoothstep(0.15, 1, ratio) + o.fovKick * 7 + o.slide * 2;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 2.5));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // Portrait phones: pull back and widen so the road is readable.
    this.baseFov = aspect < 0.8 ? 74 : 62;
    this.speedFov = aspect < 0.8 ? 10 : 14;
    this.distance = aspect < 0.8 ? 5.6 : 5.0;
    this.height = aspect < 0.8 ? 2.5 : 2.2;
    this.camera.updateProjectionMatrix();
  }
}
