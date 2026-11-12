import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Hazard, HazardManager } from '../sim/HazardManager';
import { CHECKPOINTS } from '../sim/LevelManager';
import { Rng } from '../sim/rng';
import { FINISH_Z, ROUTE_END, ZONES, elevationAt, sampleRoad, zoneIndexAt } from '../sim/road';
import {
  BILLBOARD_COUNT,
  asphaltTexture,
  billboardTexture,
  dirtTexture,
  facadeTexture,
  signTexture,
  stripesTexture,
} from './textures';
import type { VehicleFactory } from './VehicleFactory';

/**
 * Static world: road surface, expressway deck, scenery and hazard props.
 * Sim (x, z) maps to Three (x, elevation, -z).
 */

const START_Z = -80;
const END_Z = ROUTE_END + 150;
const STEP = 4;

const ZONE_TINT = [new THREE.Color('#b3aca2'), new THREE.Color('#77797d'), new THREE.Color('#94918c')];

type XFn = (z: number) => number;

/** Builds a strip of quads along z. */
class StripBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  /** Flat horizontal ribbon between two x functions. */
  flat(xa: XFn, xb: XFn, y: XFn, z0: number, z1: number, color: (z: number) => THREE.Color, uScale = 0.25, vScale = 0.125, step = STEP): void {
    let first = true;
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const a = xa(z), b = xb(z), h = y(z);
      const c = color(z);
      const base = this.pos.length / 3;
      this.pos.push(a, h, -z, b, h, -z);
      this.uv.push(a * uScale, z * vScale, b * uScale, z * vScale);
      this.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (!first) this.idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      first = false;
    }
  }

  /** Vertical wall following x(z) between y0(z) and y1(z). `facing` = +1 faces +x. */
  wall(x: XFn, y0: XFn, y1: XFn, z0: number, z1: number, color: THREE.Color, facing: 1 | -1, step = STEP): void {
    let first = true;
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const xx = x(z);
      const base = this.pos.length / 3;
      this.pos.push(xx, y0(z), -z, xx, y1(z), -z);
      this.uv.push(z * 0.1, 0, z * 0.1, 1);
      this.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (!first) {
        if (facing > 0) this.idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
        else this.idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      }
      first = false;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

export class Environment {
  readonly group = new THREE.Group();
  private ground!: THREE.Mesh;
  /** Materials animated each frame (VIP lights). */
  private redLight = new THREE.MeshBasicMaterial({ color: '#ff1a1a' });
  private blueLight = new THREE.MeshBasicMaterial({ color: '#1a4dff' });
  private water: THREE.MeshPhongMaterial | null = null;

  constructor(hazards: HazardManager, factory: VehicleFactory, private readonly lowSpec: boolean) {
    this.buildGround();
    this.buildRoad();
    this.buildExpressway();
    this.buildScenery();
    this.buildHazards(hazards, factory);
    this.buildGantries();
  }

  // ---------------------------------------------------------------------------

  private buildGround(): void {
    const tex = dirtTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(120, 120);
    const g = new THREE.PlaneGeometry(1200, 1200);
    g.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#d8c39a', map: tex }));
    this.ground.position.y = -0.06;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
  }

  private buildRoad(): void {
    const left: XFn = (z) => sampleRoad(z).left;
    const right: XFn = (z) => sampleRoad(z).right;
    const shoulderEdge: XFn = (z) => {
      const r = sampleRoad(z);
      return r.left - r.shoulder;
    };
    const y: XFn = (z) => elevationAt(z) + 0.02;
    const tint = (z: number) => {
      const i = zoneIndexAt(z);
      return ZONE_TINT[i];
    };

    // Asphalt.
    const asphalt = new StripBuilder();
    asphalt.flat(left, right, y, START_Z, END_Z, tint);
    // Opposite carriageway beyond the median (decorative).
    asphalt.flat((z) => right(z) + 1.4, (z) => right(z) + 1.4 + (right(z) - left(z)), y, START_Z, END_Z, tint);
    const asphaltMesh = new THREE.Mesh(
      asphalt.build(),
      new THREE.MeshLambertMaterial({ map: asphaltTexture(), vertexColors: true }),
    );
    asphaltMesh.receiveShadow = true;
    this.group.add(asphaltMesh);

    // Shoulder: dusty kacha strip in the city, concrete on the deck.
    const shoulder = new StripBuilder();
    const dust = new THREE.Color('#cdb48a');
    const concrete = new THREE.Color('#b9b4ab');
    shoulder.flat(shoulderEdge, left, (z) => elevationAt(z) + 0.015, START_Z, END_Z, (z) => (ZONES[zoneIndexAt(z)].elevated ? concrete : dust), 0.5, 0.25);
    // Median strip between carriageways.
    shoulder.flat(right, (z) => right(z) + 1.4, (z) => elevationAt(z) + 0.2, START_Z, END_Z, () => concrete, 0.5, 0.25);
    const shoulderMesh = new THREE.Mesh(shoulder.build(), new THREE.MeshLambertMaterial({ map: dirtTexture(), vertexColors: true }));
    shoulderMesh.receiveShadow = true;
    this.group.add(shoulderMesh);

    // Kerbs, median walls, parapets.
    const walls = new StripBuilder();
    const kerbA = new THREE.Color('#e8e2d0');
    const medianCol = new THREE.Color('#d4cfc4');
    const base: XFn = (z) => elevationAt(z);
    const kerbTop: XFn = (z) => elevationAt(z) + (ZONES[zoneIndexAt(z)].elevated || elevationAt(z) > 0.5 ? 1.05 : 0.3);
    walls.wall(shoulderEdge, base, kerbTop, START_Z, END_Z, kerbA, 1);
    walls.wall((z) => shoulderEdge(z) - 0.3, base, kerbTop, START_Z, END_Z, kerbA, -1);
    walls.flat((z) => shoulderEdge(z) - 0.3, shoulderEdge, kerbTop, START_Z, END_Z, () => kerbA, 1, 1);
    // Median jersey barrier.
    const mTop: XFn = (z) => elevationAt(z) + 0.85;
    walls.wall((z) => right(z) + 0.05, base, mTop, START_Z, END_Z, medianCol, -1);
    walls.wall((z) => right(z) + 1.35, base, mTop, START_Z, END_Z, medianCol, 1);
    walls.flat((z) => right(z) + 0.05, (z) => right(z) + 1.35, mTop, START_Z, END_Z, () => medianCol, 1, 1);
    // Outer parapet on the far side of the opposite carriageway.
    const farEdge: XFn = (z) => right(z) + 1.4 + (right(z) - left(z));
    walls.wall(farEdge, base, kerbTop, START_Z, END_Z, kerbA, -1);
    const wallMesh = new THREE.Mesh(walls.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    wallMesh.receiveShadow = true;
    wallMesh.castShadow = !this.lowSpec;
    this.group.add(wallMesh);

    // Lane markings (dashes) + edge lines.
    const marks = new StripBuilder();
    const white = new THREE.Color('#f4f1e8');
    const yellow = new THREE.Color('#f2c230');
    const my: XFn = (z) => elevationAt(z) + 0.035;
    for (let z = START_Z; z < END_Z; z += 12) {
      const road = sampleRoad(z);
      for (let k = 1; k < road.lanes; k++) {
        const x = road.left + k * road.laneWidth;
        marks.flat(() => x - 0.07, () => x + 0.07, my, z, z + 4, () => white, 1, 1, 2);
      }
    }
    marks.flat((z) => left(z) + 0.15, (z) => left(z) + 0.3, my, START_Z, END_Z, () => yellow, 1, 1);
    marks.flat((z) => right(z) - 0.3, (z) => right(z) - 0.15, my, START_Z, END_Z, () => white, 1, 1);
    const markMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 });
    const markMesh = new THREE.Mesh(marks.build(), markMat);
    markMesh.receiveShadow = true;
    this.group.add(markMesh);

    // Finish line.
    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(right(FINISH_Z) - shoulderEdge(FINISH_Z), 2.5),
      new THREE.MeshLambertMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    finish.rotation.x = -Math.PI / 2;
    finish.position.set((right(FINISH_Z) + shoulderEdge(FINISH_Z)) / 2, elevationAt(FINISH_Z) + 0.04, -FINISH_Z);
    this.group.add(finish);
  }

  private buildExpressway(): void {
    // Deck slab sides and pillars wherever the road is raised.
    const slab = new StripBuilder();
    const conc = new THREE.Color('#c8c0b2');
    const shade = new THREE.Color('#9d968a');
    const raised = (z: number) => elevationAt(z) > 0.4;
    const zone = ZONES.find((zz) => zz.elevated);
    if (!zone) return;
    const z0 = zone.start, z1 = zone.end + 175;
    const outerL: XFn = (z) => {
      const r = sampleRoad(z);
      return r.left - r.shoulder - 0.3;
    };
    const outerR: XFn = (z) => {
      const r = sampleRoad(z);
      return r.right + 1.4 + (r.right - r.left);
    };
    const top: XFn = (z) => elevationAt(z);
    const bottom: XFn = (z) => Math.max(0, elevationAt(z) - 1.3);
    slab.wall(outerL, bottom, top, z0, z1, conc, -1);
    slab.wall(outerR, bottom, top, z0, z1, conc, 1);
    slab.flat(outerL, outerR, bottom, z0, z1, () => shade);
    const slabGeo = slab.build();
    // Underside must face down.
    const slabMesh = new THREE.Mesh(slabGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    slabMesh.castShadow = !this.lowSpec;
    this.group.add(slabMesh);

    const pillars: THREE.BufferGeometry[] = [];
    for (let z = z0; z < z1; z += 32) {
      if (!raised(z) || elevationAt(z) < 2.5) continue;
      const r = sampleRoad(z);
      const h = elevationAt(z) - 1.3;
      for (const x of [(r.left + r.right) / 2, r.right + 0.7 + (r.right - r.left) / 2]) {
        const g = new THREE.BoxGeometry(2.2, h, 1.6);
        g.translate(x, h / 2, -z);
        pillars.push(g);
        const cap = new THREE.BoxGeometry(r.right - r.left + 1, 0.6, 2);
        cap.translate(x, h - 0.3, -z);
        pillars.push(cap);
      }
    }
    if (pillars.length) {
      const merged = mergeGeometries(pillars);
      if (merged) {
        const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: '#bdb5a6' }));
        m.castShadow = !this.lowSpec;
        m.receiveShadow = true;
        this.group.add(m);
      }
    }
    // Lyari river channel below the expressway (sluggish, greenish).
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(26, z1 - z0 - 200),
      new THREE.MeshLambertMaterial({ color: '#56664a' }),
    );
    river.rotation.x = -Math.PI / 2;
    river.position.set(-34, -0.03, -(z0 + z1) / 2);
    this.group.add(river);
  }

  private buildScenery(): void {
    const rng = new Rng(4242);
    const dummy = new THREE.Object3D();

    // --- Buildings (instanced) --------------------------------------------
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    const bMat = new THREE.MeshLambertMaterial({ map: facadeTexture() });
    const buildings: { x: number; z: number; w: number; d: number; h: number; c: THREE.Color }[] = [];
    const cityPal = ['#e8d8b8', '#d9b98c', '#c9a27a', '#f0e6d2', '#b8c4b0', '#d7a98c', '#e4cfa0', '#c4b6a6'];
    const modernPal = ['#a9c0cf', '#d8dde2', '#8fa7b8', '#e9e1d4', '#c3b8a5'];
    for (const side of [-1, 1] as const) {
      let z = START_Z + 20;
      while (z < END_Z) {
        const zi = zoneIndexAt(z);
        const zone = ZONES[zi];
        const road = sampleRoad(z);
        const w = rng.range(9, 22);
        const d = rng.range(10, 18);
        let h: number;
        let gap: number;
        let pal: string[];
        if (zi === 0) {
          h = rng.range(7, 24);
          gap = rng.range(0, 1.5);
          pal = cityPal;
        } else if (zone.elevated) {
          // Low-rise settlements below the flyover.
          h = rng.range(3, 9);
          gap = rng.range(4, 18);
          pal = cityPal;
        } else {
          h = rng.range(10, 45);
          gap = rng.range(8, 20);
          pal = modernPal;
        }
        const edge = side < 0 ? road.left - road.shoulder - 0.3 : road.right + 1.4 + (road.right - road.left) + 0.3;
        const setback = zi === 0 ? rng.range(3, 5) : zone.elevated ? rng.range(18, 50) : rng.range(14, 26);
        const x = edge + side * (setback + d / 2);
        // Keep the river channel clear.
        if (!(zone.elevated && side < 0 && Math.abs(x + 34) < 18)) {
          buildings.push({ x, z: z + w / 2, w, d, h, c: new THREE.Color(rng.pick(pal)) });
        }
        z += w + gap;
      }
    }
    const bMesh = new THREE.InstancedMesh(bGeo, bMat, buildings.length);
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, 0, -b.z);
      dummy.scale.set(b.d, b.h, b.w);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bMesh.setMatrixAt(i, dummy.matrix);
      bMesh.setColorAt(i, b.c);
    });
    bMesh.castShadow = !this.lowSpec;
    bMesh.receiveShadow = true;
    this.group.add(bMesh);

    // Shop signboards on city buildings (street side).
    const signColors = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00'];
    const signs = buildings.filter((b) => zoneIndexAt(b.z) === 0);
    const sGeo = new THREE.BoxGeometry(0.2, 1.4, 1);
    const sMesh = new THREE.InstancedMesh(sGeo, new THREE.MeshLambertMaterial(), signs.length);
    signs.forEach((b, i) => {
      const side = b.x < 0 ? 1 : -1;
      dummy.position.set(b.x + side * (b.d / 2 + 0.12), 3.2, -b.z);
      dummy.scale.set(1, 1, b.w * 0.8);
      dummy.updateMatrix();
      sMesh.setMatrixAt(i, dummy.matrix);
      sMesh.setColorAt(i, new THREE.Color(signColors[i % signColors.length]));
    });
    this.group.add(sMesh);

    // --- Palm trees (instanced, merged trunk + crown) ------------------------
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 7, 6);
    trunk.translate(0, 3.5, 0);
    paint(trunk, '#8b6a45');
    const fronds: THREE.BufferGeometry[] = [trunk];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.ConeGeometry(0.5, 3.6, 4);
      f.rotateX(Math.PI / 2 + 0.35);
      f.translate(0, 0.2, 1.6);
      f.rotateY((i / 7) * Math.PI * 2);
      f.translate(0, 7, 0);
      paint(f, i % 2 ? '#3f7d3a' : '#4f9447');
      fronds.push(f);
    }
    const palmGeo = mergeGeometries(fronds);
    const palms: THREE.Matrix4[] = [];
    for (let z = START_Z; z < END_Z; z += rng.range(9, 20)) {
      const zi = zoneIndexAt(z);
      const road = sampleRoad(z);
      const s = rng.range(0.8, 1.25);
      const put = (x: number, y = 0) => {
        dummy.position.set(x, y, -z);
        dummy.scale.set(s, s, s);
        dummy.rotation.set(rng.range(-0.08, 0.08), rng.range(0, 6.28), rng.range(-0.08, 0.08));
        dummy.updateMatrix();
        palms.push(dummy.matrix.clone());
      };
      if (zi === 2) {
        // Shahrah-e-Faisal: palms down the median and both verges.
        put(road.right + 0.7, elevationAt(z) + 0.2);
        if (rng.chance(0.7)) put(road.left - road.shoulder - 2.5);
        if (rng.chance(0.5)) put(road.right + 1.4 + (road.right - road.left) + 2.5);
      } else if (zi === 1) {
        if (rng.chance(0.4)) put(road.left - road.shoulder - rng.range(6, 30));
        if (rng.chance(0.3)) put(road.right + 20 + rng.range(0, 30));
      } else if (rng.chance(0.35)) {
        put(road.left - road.shoulder - 1.5);
      }
    }
    if (palmGeo && palms.length) {
      const pMesh = new THREE.InstancedMesh(palmGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), palms.length);
      palms.forEach((m, i) => pMesh.setMatrixAt(i, m));
      pMesh.castShadow = !this.lowSpec;
      this.group.add(pMesh);
    }

    // --- Street lights on the median ---------------------------------------------
    const pole = new THREE.CylinderGeometry(0.08, 0.12, 9, 5);
    pole.translate(0, 4.5, 0);
    const arm = new THREE.BoxGeometry(2.6, 0.1, 0.1);
    arm.translate(-1.3, 9, 0);
    const arm2 = arm.clone();
    arm2.translate(2.6, 0, 0);
    const lamp = new THREE.BoxGeometry(0.6, 0.15, 0.3);
    lamp.translate(-2.5, 8.9, 0);
    const lamp2 = lamp.clone();
    lamp2.translate(5, 0, 0);
    [pole, arm, arm2, lamp, lamp2].forEach((g, i) => paint(g, i < 3 ? '#8d9196' : '#f1eedc'));
    const lightGeo = mergeGeometries([pole, arm, arm2, lamp, lamp2]);
    const lights: THREE.Matrix4[] = [];
    for (let z = START_Z; z < END_Z; z += 40) {
      const road = sampleRoad(z);
      dummy.position.set(road.right + 0.7, elevationAt(z) + 0.85, -z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      lights.push(dummy.matrix.clone());
    }
    if (lightGeo) {
      const lMesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), lights.length);
      lights.forEach((m, i) => lMesh.setMatrixAt(i, m));
      this.group.add(lMesh);
    }

    // --- Billboards ------------------------------------------------------------------
    const postMat = new THREE.MeshLambertMaterial({ color: '#6d6f73' });
    const postGeo = new THREE.BoxGeometry(0.4, 1, 0.4);
    let bi = 0;
    for (let z = 120; z < END_Z - 100; z += rng.range(110, 190)) {
      const road = sampleRoad(z);
      const zone = ZONES[zoneIndexAt(z)];
      const side = rng.chance(0.65) ? -1 : 1;
      const base = 0;
      const h = zone.elevated ? elevationAt(z) + 6 : 9;
      const x = side < 0 ? road.left - road.shoulder - rng.range(4, 8) : road.right + 1.4 + (road.right - road.left) + rng.range(4, 8);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 4.5),
        new THREE.MeshLambertMaterial({ map: billboardTexture(bi++ % BILLBOARD_COUNT), side: THREE.DoubleSide }),
      );
      board.position.set(x, h + 2.25, -z);
      board.rotation.y = side * -0.35;
      this.group.add(board);
      const back = new THREE.Mesh(new THREE.BoxGeometry(9.3, 4.8, 0.3), postMat);
      back.position.copy(board.position);
      back.rotation.copy(board.rotation);
      back.translateZ(-0.2);
      this.group.add(back);
      const post = new THREE.Mesh(postGeo, postMat);
      post.scale.y = h - base;
      post.position.set(x, base + (h - base) / 2, -z);
      this.group.add(post);
    }
  }

  private buildHazards(hm: HazardManager, factory: VehicleFactory): void {
    const potholes: THREE.BufferGeometry[] = [];
    const rims: THREE.BufferGeometry[] = [];
    const manholes: THREE.BufferGeometry[] = [];
    const sticks: THREE.BufferGeometry[] = [];
    const waters: THREE.BufferGeometry[] = [];
    const barriers: THREE.BufferGeometry[] = [];
    const cones: THREE.BufferGeometry[] = [];
    const vipBars: THREE.BufferGeometry[] = [];
    const reds: THREE.BufferGeometry[] = [];
    const blues: THREE.BufferGeometry[] = [];

    const at = (g: THREE.BufferGeometry, h: Hazard, lift: number) => {
      g.rotateY(-h.heading);
      g.translate(h.x, elevationAt(h.z) + lift, -h.z);
      return g;
    };

    for (const h of hm.hazards) {
      switch (h.kind) {
        case 'pothole': {
          const g = new THREE.CircleGeometry(1, 7);
          g.rotateX(-Math.PI / 2);
          g.scale(h.hw, 1, h.hl);
          potholes.push(at(g, h, 0.045));
          const r = new THREE.RingGeometry(1, 1.25, 7);
          r.rotateX(-Math.PI / 2);
          r.scale(h.hw, 1, h.hl);
          rims.push(at(r, h, 0.04));
          break;
        }
        case 'manhole': {
          const g = new THREE.CircleGeometry(h.hw, 10);
          g.rotateX(-Math.PI / 2);
          manholes.push(at(g, h, 0.05));
          const r = new THREE.RingGeometry(h.hw, h.hw + 0.12, 10);
          r.rotateX(-Math.PI / 2);
          rims.push(at(r, h, 0.045));
          // The classic Karachi warning: a branch stuck in the hole.
          const s = new THREE.CylinderGeometry(0.03, 0.05, 1.6, 4);
          s.rotateZ(0.25);
          s.translate(0, 0.6, 0);
          sticks.push(at(s, h, 0));
          break;
        }
        case 'water': {
          const g = new THREE.PlaneGeometry(h.hw * 2, h.hl * 2, 1, 1);
          g.rotateX(-Math.PI / 2);
          waters.push(at(g, h, 0.05));
          break;
        }
        case 'barrier': {
          const g = new THREE.BoxGeometry(h.hw * 2, 0.9, h.hl * 2);
          g.translate(0, 0.45, 0);
          barriers.push(at(g, h, 0));
          for (let k = -1; k <= 1; k += 2) {
            const c = new THREE.ConeGeometry(0.22, 0.75, 6);
            c.translate(h.hw * 0.6 * k, 0.37, -h.hl - 1.5);
            cones.push(at(c, h, 0));
          }
          break;
        }
        case 'checkpoint': {
          const g = new THREE.BoxGeometry(h.hw * 2, 1.0, h.hl * 2);
          g.translate(0, 0.5, 0);
          vipBars.push(at(g, h, 0));
          // Flashing light bulbs along the top.
          const n = Math.max(1, Math.floor(h.hw));
          for (let k = 0; k < n; k++) {
            const lx = -h.hw + ((k + 0.5) / n) * h.hw * 2;
            const b = new THREE.BoxGeometry(0.35, 0.22, 0.35);
            b.translate(lx, 1.12, 0);
            (k % 2 ? blues : reds).push(at(b, h, 0));
          }
          break;
        }
      }
    }

    const addMerged = (list: THREE.BufferGeometry[], mat: THREE.Material, shadow = false) => {
      if (!list.length) return;
      const g = mergeGeometries(list);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow && !this.lowSpec;
      m.receiveShadow = true;
      this.group.add(m);
    };
    const decal = (color: string, factor: number) =>
      new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: factor });
    addMerged(potholes, decal('#2b2724', -4));
    addMerged(rims, decal('#6e665c', -3));
    addMerged(manholes, new THREE.MeshBasicMaterial({ color: '#050505', polygonOffset: true, polygonOffsetFactor: -4 }));
    addMerged(sticks, new THREE.MeshLambertMaterial({ color: '#6b4a2b' }));
    this.water = new THREE.MeshPhongMaterial({
      color: '#6f7f86',
      specular: '#ffffff',
      shininess: 90,
      transparent: true,
      opacity: 0.82,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    addMerged(waters, this.water);
    const stripes = stripesTexture('#d62828', '#ffffff');
    addMerged(barriers, new THREE.MeshLambertMaterial({ map: stripes }), true);
    addMerged(cones, new THREE.MeshLambertMaterial({ color: '#ff6d00' }), true);
    addMerged(vipBars, new THREE.MeshLambertMaterial({ map: stripesTexture('#1a237e', '#f5f5f5') }), true);
    addMerged(reds, this.redLight);
    addMerged(blues, this.blueLight);

    // Police pickup parked by each VIP roadblock.
    for (const rb of hm.roadblocks) {
      const road = sampleRoad(rb.z);
      const v = factory.create('police', 0);
      v.root.position.set(road.left - road.shoulder * 0.5, elevationAt(rb.z), -(rb.z - 6));
      v.root.rotation.y = 0.25;
      this.group.add(v.root);
      // "VIP MOVEMENT" warning sign ahead of it.
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 1.2),
        new THREE.MeshLambertMaterial({ map: signTexture(['VIP MOVEMENT', 'ROAD CLOSED'], '#b71c1c', '#ffffff', 384, 144) }),
      );
      sign.position.set(road.left - road.shoulder + 0.5, elevationAt(rb.z) + 1.6, -(rb.z - 40));
      sign.rotation.y = 0.5;
      this.group.add(sign);
    }
  }

  private buildGantries(): void {
    const steel = new THREE.MeshLambertMaterial({ color: '#7d8288' });
    const addGantry = (z: number, lines: string[], bg: string) => {
      const road = sampleRoad(z);
      const y = elevationAt(z);
      const x0 = road.left - road.shoulder - 0.6;
      const x1 = road.right + 0.7;
      const h = 6.2;
      for (const x of [x0, x1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), steel);
        post.position.set(x, y + h / 2, -z);
        this.group.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.4, 0.4), steel);
      beam.position.set((x0 + x1) / 2, y + h, -z);
      this.group.add(beam);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(11, x1 - x0 - 1), 2.4),
        new THREE.MeshLambertMaterial({ map: signTexture(lines, bg) }),
      );
      sign.position.set((x0 + x1) / 2, y + h - 0.6, -z + 0.25);
      this.group.add(sign);
    };
    for (const cp of CHECKPOINTS) addGantry(cp.z - 10, [cp.label, `CHECKPOINT  +${cp.bonus}s`], '#0b6e3a');

    // Finish arch.
    const road = sampleRoad(FINISH_Z);
    const y = elevationAt(FINISH_Z);
    const x0 = road.left - road.shoulder - 1.2;
    const x1 = road.right + 1.4 + (road.right - road.left) + 0.8;
    const archMat = new THREE.MeshLambertMaterial({ color: '#1b5e20' });
    const trim = new THREE.MeshLambertMaterial({ color: '#f5f5f5' });
    for (const x of [x0, x1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), archMat);
      p.position.set(x, y + 4.5, -FINISH_Z);
      this.group.add(p);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), trim);
      dome.position.set(x, y + 9, -FINISH_Z);
      this.group.add(dome);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2.2, 1.2), archMat);
    top.position.set((x0 + x1) / 2, y + 8, -FINISH_Z);
    this.group.add(top);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 - 2, 1.8),
      new THREE.MeshLambertMaterial({ map: signTexture(['CLIFTON · DESTINATION'], '#1b5e20', '#ffffff', 1024, 160) }),
    );
    banner.position.set((x0 + x1) / 2, y + 8, -FINISH_Z + 0.62);
    this.group.add(banner);
  }

  /** Per-frame: keep ground under the camera, animate lights. */
  update(time: number, focusZ: number): void {
    // Snap to the texture tile so the ground pattern doesn't slide.
    this.ground.position.z = -Math.round(focusZ / 10) * 10;
    const phase = Math.floor(time * 6) % 2 === 0;
    this.redLight.color.set(phase ? '#ff2222' : '#4a0a0a');
    this.blueLight.color.set(phase ? '#0a1440' : '#2a5bff');
  }
}

function paint(g: THREE.BufferGeometry, color: string): void {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

let checker: THREE.Texture | null = null;
function checkerTexture(): THREE.Texture {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  }
  checker = new THREE.CanvasTexture(c);
  checker.colorSpace = THREE.SRGBColorSpace;
  return checker;
}
