import * as THREE from 'three';

/**
 * Third-person chase camera: critically-damped spring follow, speed-based
 * FOV kick, and trauma-based shake for impacts / potholes.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private trauma = 0;
  private fov = 62;
  private initialised = false;

  /** Distance behind and height above the car. */
  distance = 5.0;
  height = 2.2;
  baseFov = 62;

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

  /**
   * @param target car position (three space)
   * @param heading sim heading (rad, + = right)
   * @param speed m/s
   * @param fovKick 0..1 extra FOV (expressway speed rush)
   * @param bump suspension displacement (m)
   */
  update(dt: number, target: THREE.Vector3, heading: number, speed: number, fovKick: number, bump: number): void {
    // Smooth the yaw we orbit around so steering doesn't whip the camera.
    const yawRate = 1 - Math.exp(-dt * 4.5);
    this.yaw += (heading - this.yaw) * yawRate;

    const back = speed < -0.5 ? -0.6 : 1; // look forward even when reversing slowly
    const dist = this.distance + Math.min(0.9, Math.max(0, speed) * 0.025);
    const desired = new THREE.Vector3(
      target.x - Math.sin(this.yaw) * dist * back,
      target.y + this.height + Math.max(0, speed) * 0.008,
      target.z + Math.cos(this.yaw) * dist * back,
    );

    if (!this.initialised) {
      this.pos.copy(desired);
      this.vel.set(0, 0, 0);
      this.look.copy(target);
      this.yaw = heading;
      this.initialised = true;
    }

    // Critically damped spring toward desired position.
    // (Closed-form critically damped smoothing, "Game Programming Gems 4".)
    const omega = 9;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.pos.clone().sub(desired);
    const temp = this.vel.clone().addScaledVector(change, omega).multiplyScalar(dt);
    this.vel.addScaledVector(temp, -omega).multiplyScalar(decay);
    this.pos.copy(desired).add(change.add(temp).multiplyScalar(decay));
    // Camera can't lag more than a few metres (prevents clipping into the car).
    const lag = this.pos.clone().sub(desired);
    if (lag.length() > 1.8) this.pos.copy(desired).add(lag.setLength(1.8));

    const lookAhead = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * 6,
      target.y + 1.1,
      target.z - Math.cos(this.yaw) * 6,
    );
    this.look.lerp(lookAhead, 1 - Math.exp(-dt * 12));

    // Shake.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;
    const t = performance.now() / 1000;
    const sx = Math.sin(t * 47.3) * Math.sin(t * 13.1) * 0.35 * shake;
    const sy = (Math.sin(t * 53.7) * 0.3 * shake) + bump * 0.5;

    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look.x + sx * 0.5, this.look.y + sy * 0.6, this.look.z);
    this.camera.rotateZ(Math.sin(t * 31.0) * 0.03 * shake);

    // FOV: mild speed sense everywhere, big kick on the expressway.
    const targetFov = this.baseFov + Math.max(0, speed) * 0.12 + fovKick * 14;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // Portrait phones: pull back and widen so the road is readable.
    this.baseFov = aspect < 0.8 ? 74 : 62;
    this.distance = aspect < 0.8 ? 5.6 : 5.0;
    this.height = aspect < 0.8 ? 2.5 : 2.2;
    this.camera.updateProjectionMatrix();
  }
}
