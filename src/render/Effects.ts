import * as THREE from 'three';

/** Tiny CPU particle pool: crash sparks, pothole dust, puddle splashes. */
const MAX = 400;

export class Effects {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private next = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1000;
  }

  private emit(x: number, y: number, z: number, n: number, color: THREE.Color, spread: number, up: number, life: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = Math.random() * up;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      const j = 0.85 + Math.random() * 0.3;
      this.col[i * 3] = color.r * j;
      this.col[i * 3 + 1] = color.g * j;
      this.col[i * 3 + 2] = color.b * j;
      this.life[i] = life * (0.6 + Math.random() * 0.6);
    }
  }

  sparks(x: number, y: number, z: number, intensity: number): void {
    this.emit(x, y + 0.5, z, Math.round(10 + intensity * 30), new THREE.Color('#ffd27a'), 9, 5, 0.5);
    this.emit(x, y + 0.6, z, Math.round(4 + intensity * 8), new THREE.Color('#9a9a9a'), 4, 3, 0.9);
  }

  dust(x: number, y: number, z: number, intensity: number): void {
    this.emit(x, y + 0.1, z, Math.round(8 + intensity * 14), new THREE.Color('#bba27c'), 3, 2.5, 0.8);
  }

  splash(x: number, y: number, z: number): void {
    this.emit(x, y + 0.2, z, 40, new THREE.Color('#c9d6dc'), 7, 5, 0.7);
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1000;
        continue;
      }
      this.vel[i * 3 + 1] -= 12 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
