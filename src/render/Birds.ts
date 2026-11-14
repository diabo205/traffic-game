import * as THREE from 'three';

/**
 * Black kites (cheel) soaring in lazy circles above the road — a fixture of
 * the Karachi sky. Purely cosmetic, one instanced draw call.
 */
const COUNT = 18;

interface Kite {
  cx: number;
  /** orbit centre, sim z (forward) */
  cz: number;
  alt: number;
  radius: number;
  angle: number;
  /** rad/s, sign = direction */
  omega: number;
  flapPhase: number;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private kites: Kite[] = [];
  private dummy = new THREE.Object3D();

  constructor() {
    // Nose at -z, wings along x, forked tail behind.
    const v = [
      // left wing
      0, 0, -0.25, -0.95, 0.08, 0.05, 0, 0, 0.25,
      // right wing
      0, 0, -0.25, 0, 0, 0.25, 0.95, 0.08, 0.05,
      // body
      0, 0, -0.45, -0.07, 0, 0.3, 0.07, 0, 0.3,
      // forked tail
      -0.07, 0, 0.25, -0.2, 0, 0.75, 0, 0, 0.45,
      0.07, 0, 0.25, 0, 0, 0.45, 0.2, 0, 0.75,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    geo.scale(1.6, 1.6, 1.6);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color: '#3a2e25', side: THREE.DoubleSide }),
      COUNT,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < COUNT; i++) this.kites.push(this.spawn(0, true));
  }

  private spawn(playerZ: number, initial: boolean): Kite {
    const r = Math.random;
    return {
      cx: (r() - 0.5) * 90,
      cz: playerZ + (initial ? -40 + r() * 320 : 230 + r() * 120),
      alt: 22 + r() * 38,
      radius: 9 + r() * 26,
      angle: r() * Math.PI * 2,
      omega: (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.3),
      flapPhase: r() * 100,
    };
  }

  update(dt: number, playerZ: number, baseY: number, time: number): void {
    for (let i = 0; i < COUNT; i++) {
      let k = this.kites[i];
      if (k.cz < playerZ - 60) k = this.kites[i] = this.spawn(playerZ, false);
      k.angle += k.omega * dt;
      const x = k.cx + Math.cos(k.angle) * k.radius;
      const z = k.cz + Math.sin(k.angle) * k.radius;
      // Tangent heading, banked into the turn.
      const dx = -Math.sin(k.angle) * Math.sign(k.omega);
      const dz = Math.cos(k.angle) * Math.sign(k.omega);
      const yaw = Math.atan2(-dx, dz);
      // Mostly gliding; a few lazy flaps now and then.
      const flapping = Math.sin(time * 0.4 + k.flapPhase) > 0.85;
      const flap = flapping ? Math.sin(time * 9 + k.flapPhase) * 0.35 : 0;
      this.dummy.position.set(x, baseY + k.alt + Math.sin(time * 0.3 + k.flapPhase) * 1.5, -z);
      this.dummy.rotation.set(0, yaw, -0.35 * Math.sign(k.omega), 'YXZ');
      this.dummy.scale.set(1, 1 + flap, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
