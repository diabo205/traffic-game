import * as THREE from 'three';
import { VEHICLE_SPECS } from '../sim/PlayerCar';
import type { PlayerCar } from '../sim/PlayerCar';
import type { PlayerVehicle } from '../sim/types';

export interface WheelDef {
  along: number;
  side: number;
  axle: 'front' | 'rear';
}

const WHEEL_LAYOUTS: Record<PlayerVehicle, readonly WheelDef[]> = {
  alto: [
    { along: VEHICLE_SPECS.alto.wheelBase * 0.5 + 0.01, side: -(VEHICLE_SPECS.alto.halfWidth * 0.87), axle: 'front' },
    { along: VEHICLE_SPECS.alto.wheelBase * 0.5 + 0.01, side: VEHICLE_SPECS.alto.halfWidth * 0.87, axle: 'front' },
    { along: -(VEHICLE_SPECS.alto.wheelBase * 0.5 + 0.09), side: -(VEHICLE_SPECS.alto.halfWidth * 0.87), axle: 'rear' },
    { along: -(VEHICLE_SPECS.alto.wheelBase * 0.5 + 0.09), side: VEHICLE_SPECS.alto.halfWidth * 0.87, axle: 'rear' },
  ],
  coupe: [
    { along: VEHICLE_SPECS.coupe.wheelBase * 0.5, side: -(VEHICLE_SPECS.coupe.halfWidth * 0.907), axle: 'front' },
    { along: VEHICLE_SPECS.coupe.wheelBase * 0.5, side: VEHICLE_SPECS.coupe.halfWidth * 0.907, axle: 'front' },
    { along: -VEHICLE_SPECS.coupe.wheelBase * 0.5, side: -(VEHICLE_SPECS.coupe.halfWidth * 0.907), axle: 'rear' },
    { along: -VEHICLE_SPECS.coupe.wheelBase * 0.5, side: VEHICLE_SPECS.coupe.halfWidth * 0.907, axle: 'rear' },
  ],
  rickshaw: [
    { along: VEHICLE_SPECS.rickshaw.wheelBase * 0.5 + 0.22, side: 0, axle: 'front' },
    { along: -(VEHICLE_SPECS.rickshaw.wheelBase * 0.5 - 0.13), side: -(VEHICLE_SPECS.rickshaw.halfWidth * 0.91), axle: 'rear' },
    { along: -(VEHICLE_SPECS.rickshaw.wheelBase * 0.5 - 0.13), side: VEHICLE_SPECS.rickshaw.halfWidth * 0.91, axle: 'rear' },
  ],
  suv: [
    { along: VEHICLE_SPECS.suv.wheelBase * 0.5, side: -(VEHICLE_SPECS.suv.halfWidth * 0.872), axle: 'front' },
    { along: VEHICLE_SPECS.suv.wheelBase * 0.5, side: VEHICLE_SPECS.suv.halfWidth * 0.872, axle: 'front' },
    { along: -VEHICLE_SPECS.suv.wheelBase * 0.5, side: -(VEHICLE_SPECS.suv.halfWidth * 0.872), axle: 'rear' },
    { along: -VEHICLE_SPECS.suv.wheelBase * 0.5, side: VEHICLE_SPECS.suv.halfWidth * 0.872, axle: 'rear' },
  ],
  minibus: [
    { along: VEHICLE_SPECS.minibus.wheelBase * 0.5 - 0.05, side: -(VEHICLE_SPECS.minibus.halfWidth * 0.768), axle: 'front' },
    { along: VEHICLE_SPECS.minibus.wheelBase * 0.5 - 0.05, side: VEHICLE_SPECS.minibus.halfWidth * 0.768, axle: 'front' },
    { along: -(VEHICLE_SPECS.minibus.wheelBase * 0.5 - 0.65), side: -(VEHICLE_SPECS.minibus.halfWidth * 0.768), axle: 'rear' },
    { along: -(VEHICLE_SPECS.minibus.wheelBase * 0.5 - 0.65), side: VEHICLE_SPECS.minibus.halfWidth * 0.768, axle: 'rear' },
  ],
};

const MAX_SEG = 900;
const MARK_W = 0.17;
const MARK_LIFE = 30;
const MAX_SMOKE = 260;

/** How hard each axle is sliding this frame, 0..1. Render-only reading of sim state. */
export interface Slide {
  front: number;
  rear: number;
}

export function tyreSlide(p: PlayerCar): Slide {
  const v = Math.abs(p.speed);
  let slip = p.travel - p.heading;
  slip = Math.abs(Math.atan2(Math.sin(slip), Math.cos(slip)));
  const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  // Sideways slide (drift / hydroplaning).
  const slide = ramp(slip, 0.06, 0.26) * ramp(v, 3, 8);
  // Cornering right at the grip limit.
  const grip = Math.max(1, p.spec.maxLateralAccel);
  const corner = ramp(Math.abs(p.speed * p.yawRate) / grip, 0.78, 1) * ramp(v, 7, 13) * 0.7;
  // Hard braking from speed.
  const brake = p.braking && p.accel < -7 ? ramp(v, 5, 16) * 0.85 : 0;
  // Launch chirp when floored from a standstill.
  const launch = p.throttle > 0.85 && p.speed > 0.3 && p.speed < 6 ? (1 - p.speed / 6) * 0.65 : 0;
  return { rear: Math.max(slide, corner, brake), front: Math.max(slide * 0.6, corner * 0.8, brake, launch) };
}

/**
 * Dark rubber skid marks laid down by sliding tyres (fading after a while)
 * and billowing tyre smoke. Purely cosmetic.
 */
export class TyreFx {
  readonly group = new THREE.Group();

  // ---- Skid marks: a ring buffer of quads ---------------------------------------
  private markPos = new Float32Array(MAX_SEG * 4 * 3);
  private markCol = new Float32Array(MAX_SEG * 4 * 4);
  private markBirth = new Float32Array(MAX_SEG).fill(-1e9);
  private markBase = new Float32Array(MAX_SEG);
  private nextSeg = 0;
  private marks: THREE.Mesh;
  /** last laid point per wheel (FL, FR, RL, RR), null when not marking */
  private last: Array<{ x: number; y: number; z: number } | null> = [null, null, null, null];

  // ---- Smoke: soft growing billboards --------------------------------------------
  private smokePos = new Float32Array(MAX_SMOKE * 3);
  private smokeSize = new Float32Array(MAX_SMOKE);
  private smokeAlpha = new Float32Array(MAX_SMOKE);
  private smokeVel = new Float32Array(MAX_SMOKE * 3);
  private smokeAge = new Float32Array(MAX_SMOKE).fill(1e9);
  private smokeLife = new Float32Array(MAX_SMOKE);
  private smokeStart = new Float32Array(MAX_SMOKE);
  private nextSmoke = 0;
  private smokeMat: THREE.ShaderMaterial;
  private smoke: THREE.Points;
  private emitDebt = [0, 0, 0, 0];
  private time = 0;
  private lastVehicle: PlayerVehicle | null = null;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.markCol, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < MAX_SEG; i++) {
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    g.setIndex(idx);
    for (let i = 0; i < MAX_SEG * 4; i++) this.markPos[i * 3 + 1] = -1000;
    this.marks = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }),
    );
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aSize', new THREE.BufferAttribute(this.smokeSize, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aAlpha', new THREE.BufferAttribute(this.smokeAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    for (let i = 0; i < MAX_SMOKE; i++) this.smokePos[i * 3 + 1] = -1000;
    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color('#e4e0d8') } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.15, r) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.smoke = new THREE.Points(sg, this.smokeMat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 3;
    this.group.add(this.marks, this.smoke);
  }

  /** Remove every mark and puff (new world / tow). */
  clear(): void {
    this.markPos.fill(0);
    for (let i = 0; i < MAX_SEG * 4; i++) this.markPos[i * 3 + 1] = -1000;
    this.markBirth.fill(-1e9);
    this.smokeAge.fill(1e9);
    for (let i = 0; i < MAX_SMOKE; i++) this.smokePos[i * 3 + 1] = -1000;
    this.last = [null, null, null, null];
    this.emitDebt = [0, 0, 0, 0];
    this.marks.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * @param x,z,heading interpolated car pose (sim space)
   * @param ground ground height lookup (sim x, z)
   * @param pixelScale drawing-buffer height / (2 tan(fov / 2))
   */
  update(dt: number, p: PlayerCar, x: number, z: number, heading: number, ground: (x: number, z: number) => number, pixelScale: number): Slide {
    this.time += dt;
    this.smokeMat.uniforms.uScale.value = pixelScale;
    if (this.lastVehicle !== p.vehicle) {
      this.lastVehicle = p.vehicle;
      this.last = [null, null, null, null];
      this.emitDebt = [0, 0, 0, 0];
    }
    const slide = tyreSlide(p);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    const wheels = WHEEL_LAYOUTS[p.vehicle];
    for (let i = wheels.length; i < 4; i++) {
      this.last[i] = null;
      this.emitDebt[i] = 0;
    }
    const { vx, vz } = p.velocity();
    let marksDirty = false;
    wheels.forEach(({ along, side, axle }, i) => {
      const k = slide[axle];
      const wx = x + fx * along + rx * side;
      const wz = z + fz * along + rz * side;
      const y = ground(wx, wz) + 0.012;
      // Skid marks.
      if (k > 0.14) {
        const prev = this.last[i];
        const pt = { x: wx, y, z: -wz };
        if (!prev) this.last[i] = pt;
        else if (Math.hypot(pt.x - prev.x, pt.z - prev.z) > 0.35) {
          if (Math.hypot(pt.x - prev.x, pt.z - prev.z) < 3) this.addSegment(prev, pt, Math.min(0.75, 0.25 + k * 0.6));
          this.last[i] = pt;
          marksDirty = true;
        }
      } else this.last[i] = null;
      // Smoke.
      if (k > 0.28) {
        this.emitDebt[i] += dt * (10 + k * 34);
        while (this.emitDebt[i] >= 1) {
          this.emitDebt[i] -= 1;
          this.puff(wx, y + 0.15, -wz, vx * 0.25, -vz * 0.25, k);
        }
      } else this.emitDebt[i] = 0;
    });
    this.fadeMarks(marksDirty);
    this.updateSmoke(dt);
    return slide;
  }

  private addSegment(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, alpha: number): void {
    const i = this.nextSeg;
    this.nextSeg = (this.nextSeg + 1) % MAX_SEG;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * MARK_W * 0.5, nz = (dx / len) * MARK_W * 0.5;
    const P = this.markPos;
    const o = i * 12;
    P[o] = a.x + nx; P[o + 1] = a.y; P[o + 2] = a.z + nz;
    P[o + 3] = a.x - nx; P[o + 4] = a.y; P[o + 5] = a.z - nz;
    P[o + 6] = b.x + nx; P[o + 7] = b.y; P[o + 8] = b.z + nz;
    P[o + 9] = b.x - nx; P[o + 10] = b.y; P[o + 11] = b.z - nz;
    this.markBirth[i] = this.time;
    this.markBase[i] = alpha;
  }

  private fadeTimer = 0;
  private fadeMarks(dirty: boolean): void {
    // Fading is slow, so refresh alphas a few times a second unless new marks were laid.
    this.fadeTimer -= 1;
    if (!dirty && this.fadeTimer > 0) return;
    this.fadeTimer = 15;
    const C = this.markCol;
    for (let i = 0; i < MAX_SEG; i++) {
      const age = this.time - this.markBirth[i];
      const a = age > MARK_LIFE ? 0 : this.markBase[i] * Math.min(1, (MARK_LIFE - age) / 8);
      for (let v = 0; v < 4; v++) {
        const o = (i * 4 + v) * 4;
        C[o] = 0.09;
        C[o + 1] = 0.085;
        C[o + 2] = 0.08;
        C[o + 3] = a;
      }
    }
    this.marks.geometry.attributes.color.needsUpdate = true;
    this.marks.geometry.attributes.position.needsUpdate = true;
  }

  private puff(x: number, y: number, z: number, vx: number, vz: number, k: number): void {
    const i = this.nextSmoke;
    this.nextSmoke = (this.nextSmoke + 1) % MAX_SMOKE;
    this.smokePos[i * 3] = x + (Math.random() - 0.5) * 0.3;
    this.smokePos[i * 3 + 1] = y;
    this.smokePos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
    this.smokeVel[i * 3] = vx + (Math.random() - 0.5) * 1.6;
    this.smokeVel[i * 3 + 1] = 0.5 + Math.random() * 0.8;
    this.smokeVel[i * 3 + 2] = vz + (Math.random() - 0.5) * 1.6;
    this.smokeAge[i] = 0;
    this.smokeLife[i] = 1.1 + Math.random() * 0.9;
    this.smokeStart[i] = 0.25 + k * 0.45;
  }

  private updateSmoke(dt: number): void {
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < MAX_SMOKE; i++) {
      const age = (this.smokeAge[i] += dt);
      const life = this.smokeLife[i];
      if (age >= life) {
        this.smokeAlpha[i] = 0;
        continue;
      }
      const t = age / life;
      this.smokeVel[i * 3] *= drag;
      this.smokeVel[i * 3 + 2] *= drag;
      this.smokeVel[i * 3 + 1] = this.smokeVel[i * 3 + 1] * drag + 0.25 * dt;
      this.smokePos[i * 3] += this.smokeVel[i * 3] * dt;
      this.smokePos[i * 3 + 1] += this.smokeVel[i * 3 + 1] * dt;
      this.smokePos[i * 3 + 2] += this.smokeVel[i * 3 + 2] * dt;
      this.smokeSize[i] = 0.6 + t * 3.4;
      this.smokeAlpha[i] = this.smokeStart[i] * Math.min(1, t * 6) * (1 - t) * (1 - t);
    }
    const a = this.smoke.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }
}
