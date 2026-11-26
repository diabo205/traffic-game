import * as THREE from 'three';

const STREAK_COUNT = 850;
const RIPPLE_COUNT = 90;
const BOX_W = 44;
const BOX_H = 22;
const BOX_D = 44;

function wrap(v: number, span: number): number {
  const half = span * 0.5;
  return ((((v + half) % span) + span) % span) - half;
}

/**
 * Zero-allocation 3D monsoon rain curtain and ground splash droplets.
 * Wraps seamlessly around the camera focus so rain stays dense at any speed.
 */
export class RainFx {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly linePos = new Float32Array((STREAK_COUNT + RIPPLE_COUNT) * 6);
  private readonly seeds = new Float32Array(STREAK_COUNT * 4);

  private readonly rippleSeed = new Float32Array(RIPPLE_COUNT * 3);
  private fallDist = 0;
  private time = 0;

  constructor() {
    for (let i = 0; i < STREAK_COUNT; i++) {
      this.seeds[i * 4] = (Math.random() - 0.5) * BOX_W;
      this.seeds[i * 4 + 1] = Math.random() * BOX_H;
      this.seeds[i * 4 + 2] = (Math.random() - 0.5) * BOX_D;
      this.seeds[i * 4 + 3] = 0.82 + Math.random() * 0.36;
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    const lineMat = new THREE.LineBasicMaterial({
      color: '#c6dcf0',
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(lineGeo, lineMat);
    this.lines.frustumCulled = false;

    for (let i = 0; i < RIPPLE_COUNT; i++) {
      this.rippleSeed[i * 3] = (Math.random() - 0.5) * 28;
      this.rippleSeed[i * 3 + 1] = (Math.random() - 0.5) * 28;
      this.rippleSeed[i * 3 + 2] = Math.random();
    }

    this.group.add(this.lines);
    this.group.visible = false;
  }

  setEnabled(on: boolean): void {
    this.group.visible = on;
  }

  update(dt: number, cx: number, cy: number, cz: number, windX = -3.4, windZ = 2.6): void {
    if (!this.group.visible) return;
    this.time += dt;
    this.fallDist += dt * 24;

    const sx = windX * 0.055;
    const sy = 1.35;
    const sz = windZ * 0.055;

    for (let i = 0; i < STREAK_COUNT; i++) {
      const b = i * 4;
      const spd = this.seeds[b + 3];
      const f = this.fallDist * spd;
      const rx = wrap(this.seeds[b] + f * (windX / 24) - cx, BOX_W) + cx;
      const ry = ((((this.seeds[b + 1] - f) % BOX_H) + BOX_H) % BOX_H) + cy - 1.5;
      const rz = wrap(this.seeds[b + 2] + f * (windZ / 24) - cz, BOX_D) + cz;

      const p = i * 6;
      this.linePos[p] = rx;
      this.linePos[p + 1] = ry;
      this.linePos[p + 2] = rz;
      this.linePos[p + 3] = rx - sx * spd;
      this.linePos[p + 4] = ry + sy * spd;
      this.linePos[p + 5] = rz - sz * spd;
    }

    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const r = i * 3;
      const phase = (this.rippleSeed[r + 2] + this.time * 4.2) % 1;
      const rx = wrap(this.rippleSeed[r] - cx, 28) + cx;
      const rz = wrap(this.rippleSeed[r + 1] - cz, 28) + cz;
      const p = (STREAK_COUNT + i) * 6;
      const h = 0.16 * Math.sin(phase * Math.PI);
      this.linePos[p] = rx;
      this.linePos[p + 1] = cy + 0.04;
      this.linePos[p + 2] = rz;
      this.linePos[p + 3] = rx;
      this.linePos[p + 4] = cy + 0.04 + h;
      this.linePos[p + 5] = rz;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
