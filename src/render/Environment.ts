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
  barrierStripeTexture,
  kerbStripeTexture,
  saddarFacadeAtlas,
  settlementFacadeAtlas,
  signTexture,
  stripesTexture,
  towerFacadeAtlas,
} from './textures';
import { buildCorridors, FOOTBRIDGES, hasCrescentLight, inRiver, PLANTER_Z, RIVER_Z0, RIVER_Z1, riverFar, TOLL_Z } from './Corridors';
import { makeFacadeMaterial, setFacadeNight, GROUND_FLOOR_H, STOREY_H } from './facadeMaterial';
import { buildLandmarks, excluded, FLYOVERS } from './Landmarks';
import type { TimeOfDay } from './Renderer';
import { buildSaddar, FOOTPATH_W, SADDAR_END } from './Saddar';
import type { SaddarBuilding } from './Saddar';
import { paint, StripBuilder } from './strip';
import type { XFn } from './strip';
import type { VehicleFactory, VehicleVisual } from './VehicleFactory';

/**
 * Static world: road surface, expressway deck, scenery and hazard props.
 * Sim (x, z) maps to Three (x, elevation, -z).
 */

const START_Z = -80;
const END_Z = ROUTE_END + 150;

/** Sample spacing for painted kerbs (finer so stripes stay crisp at bends). */
const STRIPE_STEP = 2;

// Measured from reference photos: pale, dusty asphalt (warmer in Saddar).
const ZONE_TINT = [new THREE.Color('#c2b6a4'), new THREE.Color('#aeb0b0'), new THREE.Color('#b8b6b0')];

export class Environment {
  readonly group = new THREE.Group();
  private ground!: THREE.Mesh;
  /** Materials animated each frame (VIP lights). */
  private redLight = new THREE.MeshBasicMaterial({ color: '#ff1a1a' });
  private blueLight = new THREE.MeshBasicMaterial({ color: '#1a4dff' });
  private water: THREE.MeshPhongMaterial | null = null;
  private facadeMats: THREE.MeshLambertMaterial[] = [];
  private litSigns: THREE.MeshLambertMaterial[] = [];
  private ownedTex: THREE.Texture[] = [];
  private roadblockPolice: VehicleVisual[] = [];

  constructor(hazards: HazardManager, factory: VehicleFactory, private readonly lowSpec: boolean) {
    this.buildGround();
    this.buildRoad();
    this.buildExpressway();
    this.buildScenery();
    this.buildHazards(hazards, factory);
    this.buildGantries();
    buildLandmarks(this.group, this.lowSpec, this.litSigns);
    buildCorridors(this.group, this.lowSpec, this.litSigns);
  }

  // ---------------------------------------------------------------------------

  private buildGround(): void {
    const tex = dirtTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(120, 120);
    this.ownedTex.push(tex);
    const g = new THREE.PlaneGeometry(1200, 1200, 24, 24);
    g.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({
        color: '#d8c39a',
        map: tex,
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
      }),
    );
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

    const base: XFn = (z) => elevationAt(z);
    const kerbTop: XFn = (z) => elevationAt(z) + (ZONES[zoneIndexAt(z)].elevated || elevationAt(z) > 0.5 ? 1.05 : 0.3);
    // Median: jersey barrier, dropping to a low planted kerb on Shahrah-e-Faisal.
    const mTop: XFn = (z) => elevationAt(z) + 0.85 - 0.49 * Math.min(1, Math.max(0, (z - PLANTER_Z + 20) / 20));
    // Outer parapet on the far side of the opposite carriageway.
    const farEdge: XFn = (z) => right(z) + 1.4 + (right(z) - left(z));

    // Kerbs, jersey barriers and parapets: black-and-yellow kerbs in the city,
    // long faded yellow/grey panels on the expressway's concrete barriers.
    const w = new THREE.Color('#ffffff');
    const paintRange = (S0: number, S1: number, tex: THREE.Texture, u: number) => {
      const painted = new StripBuilder();
      painted.wall(shoulderEdge, base, kerbTop, S0, S1, w, 1, STRIPE_STEP, u);
      painted.wall((z) => shoulderEdge(z) - 0.3, base, kerbTop, S0, S1, w, -1, STRIPE_STEP, u);
      painted.flat((z) => shoulderEdge(z) - 0.3, shoulderEdge, kerbTop, S0, S1, () => w, 1, u, STRIPE_STEP, true);
      painted.wall((z) => right(z) + 0.05, base, mTop, S0, S1, w, -1, STRIPE_STEP, u);
      painted.wall((z) => right(z) + 1.35, base, mTop, S0, S1, w, 1, STRIPE_STEP, u);
      painted.flat((z) => right(z) + 0.05, (z) => right(z) + 1.35, mTop, S0, S1, () => w, 1, u, STRIPE_STEP, true);
      painted.wall(farEdge, base, kerbTop, S0, S1, w, -1, STRIPE_STEP, u);
      const mesh = new THREE.Mesh(painted.build(), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      mesh.receiveShadow = true;
      mesh.castShadow = !this.lowSpec;
      this.group.add(mesh);
    };
    const X0 = ZONES[1].start - 20, X1 = ZONES[1].end + 180;
    paintRange(START_Z, X0, kerbStripeTexture(), 0.5);
    paintRange(X0, X1, barrierStripeTexture(), 0.2);
    paintRange(X1, END_Z, kerbStripeTexture(), 0.5);

    // Lane markings (dashes) + edge lines.
    const marks = new StripBuilder();
    const white = new THREE.Color('#f4f1e8');
    const yellow = new THREE.Color('#f2c230');
    const my: XFn = (z) => elevationAt(z) + 0.035;
    const fadeRng = new Rng(31);
    const faded = new THREE.Color('#bdb7aa');
    for (let z = START_Z; z < END_Z; z += 12) {
      const road = sampleRoad(z);
      const saddar = z < SADDAR_END;
      for (let k = 1; k < road.lanes; k++) {
        // Saddar's lane paint has mostly worn away.
        if (saddar && fadeRng.chance(0.45)) continue;
        const x = road.left + k * road.laneWidth;
        const len = saddar ? fadeRng.range(1.2, 4) : 4;
        marks.flat(() => x - 0.07, () => x + 0.07, my, z, z + len, () => (saddar ? faded : white), 1, 1, saddar ? len : 2);
      }
    }
    marks.flat((z) => left(z) + 0.15, (z) => left(z) + 0.3, my, SADDAR_END, END_Z, () => yellow, 1, 1);
    marks.flat((z) => right(z) - 0.3, (z) => right(z) - 0.15, my, SADDAR_END, END_Z, () => white, 1, 1);
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
  }

  private buildScenery(): void {
    const rng = new Rng(4242);
    const dummy = new THREE.Object3D();

    // --- Buildings (instanced) --------------------------------------------
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    type Block = { x: number; z: number; w: number; d: number; h: number; c: THREE.Color };
    const settlements: Block[] = [];
    const towers: Block[] = [];
    const saddar: (SaddarBuilding & { c: THREE.Color })[] = [];
    // Old Saddar: sun-bleached cream, yellow stone, faded pastels.
    // Old Saddar from the photos: ochre/yellow Gizri stone, weathered cream.
    const saddarPal = ['#e6c47c', '#dab06a', '#d2b07e', '#ebd6a2', '#c9a77a', '#e0d4bb', '#e2b96c', '#c7b394', '#d8c9a8'];
    // Atlases carry the base colours; tints just vary them.
    const towerPal = ['#ffffff', '#eef3f6', '#e2ebf0', '#f4efe6', '#dfe4e8'];
    const settlePal = ['#ffffff', '#f1ece4', '#e6e2da', '#f6efe6', '#d9d5cc'];
    for (const side of [-1, 1] as const) {
      let z = START_Z + 20;
      while (z < END_Z) {
        const zi = zoneIndexAt(z);
        const zone = ZONES[zi];
        const road = sampleRoad(z);
        const edge = side < 0 ? road.left - road.shoulder - 0.3 : road.right + 1.4 + (road.right - road.left);
        if (zi === 0 && z < SADDAR_END) {
          const w = rng.range(8, 18);
          const d = rng.range(12, 18);
          const storeys = rng.weighted({ 3: 1, 4: 3, 5: 4, 6: 3, 7: 2 } as Record<string, number>);
          const n = Number(storeys);
          const x = edge + side * (FOOTPATH_W + rng.range(0.4, 1.0) + d / 2);
          if (!excluded(side, z, z + w)) {
            saddar.push({ x, z: z + w / 2, w, d, h: GROUND_FLOOR_H + n * STOREY_H, storeys: n, side, c: new THREE.Color(rng.pick(saddarPal)) });
          }
          // Mostly wall-to-wall, with the odd gully.
          z += w + (rng.chance(0.15) ? rng.range(3, 6) : rng.range(0, 0.6));
          continue;
        }
        if (zone.elevated || zi === 0) {
          // Lyari: dense 1-4 storey block and brick housing packed up to the
          // expressway; on the left it lines the far bank of the river.
          const w = rng.range(5, 11);
          const zc = z + w / 2;
          const riverside = side < 0 && zc > RIVER_Z0 - 20 && zc < RIVER_Z1 + 10;
          let x = riverside ? riverFar(zc) - 1.5 : edge + side * rng.range(3, 10);
          for (let row = 0; row < 2; row++) {
            const d = rng.range(7, 12);
            const n = Number(rng.weighted({ 0: 2, 1: 4, 2: 3, 3: 1 } as Record<string, number>));
            const bx = x + side * (d / 2);
            if (!excluded(side, z, z + w) && !inRiver(bx, d / 2, z, z + w)) {
              settlements.push({ x: bx, z: zc, w, d, h: GROUND_FLOOR_H + n * STOREY_H, c: new THREE.Color(rng.pick(settlePal)) });
            }
            x = bx + side * (d / 2 + rng.range(1.5, 4));
          }
          z += w + (rng.chance(0.2) ? rng.range(2, 6) : rng.range(0, 0.8));
          continue;
        }
        // Shahrah-e-Faisal: 4-15 storey corporate glass and precast towers.
        const w = rng.range(14, 26);
        const d = rng.range(12, 20);
        const n = Number(rng.weighted({ 3: 2, 5: 3, 7: 3, 9: 2, 12: 2, 15: 1 } as Record<string, number>));
        const x = edge + side * (0.3 + rng.range(14, 26) + d / 2);
        if (!excluded(side, z, z + w)) {
          towers.push({ x, z: z + w / 2, w, d, h: GROUND_FLOOR_H + n * STOREY_H, c: new THREE.Color(rng.pick(towerPal)) });
        }
        z += w + rng.range(8, 20);
      }
    }
    const placeBlocks = (list: Block[], mat: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(bGeo, mat, list.length);
      list.forEach((b, i) => {
        dummy.position.set(b.x, 0, -b.z);
        dummy.scale.set(b.d, b.h, b.w);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, b.c);
      });
      mesh.castShadow = !this.lowSpec;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    const settlementMat = makeFacadeMaterial(settlementFacadeAtlas(), 'settlementFacade');
    const towerMat = makeFacadeMaterial(towerFacadeAtlas(), 'towerFacade', true);
    const saddarMat = makeFacadeMaterial(saddarFacadeAtlas());
    this.facadeMats.push(settlementMat, towerMat, saddarMat);
    placeBlocks(settlements, settlementMat);
    placeBlocks(towers, towerMat);
    this.buildRoofClutter(rng, settlements, towers);
    // Saddar blocks: facade tiles in world space (correct storeys + shopfronts).
    const sMesh = new THREE.InstancedMesh(bGeo, saddarMat, saddar.length);
    saddar.forEach((b, i) => {
      dummy.position.set(b.x, 0, -b.z);
      dummy.scale.set(b.d, b.h, b.w);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      sMesh.setMatrixAt(i, dummy.matrix);
      sMesh.setColorAt(i, b.c);
    });
    sMesh.castShadow = !this.lowSpec;
    sMesh.receiveShadow = true;
    this.group.add(sMesh);
    buildSaddar(this.group, saddar, this.lowSpec, this.litSigns);

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
      if (FLYOVERS.some((f) => Math.abs(f.z - z) < 10)) continue;
      if (zi === 2) {
        // Shahrah-e-Faisal: palms down the median and both verges.
        if (rng.chance(0.35)) put(road.right + 0.7, elevationAt(z) + 0.2);
        if (rng.chance(0.25)) put(road.left - road.shoulder - 2.5);
        if (rng.chance(0.2)) put(road.right + 1.4 + (road.right - road.left) + 2.5);
      } else if (zi === 1) {
        const px = road.left - road.shoulder - rng.range(6, 30);
        if (rng.chance(0.4) && !inRiver(px, 1, z, z)) put(px);
        if (rng.chance(0.3)) put(road.right + 20 + rng.range(0, 30));
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
    [pole, arm, arm2].forEach((g) => paint(g, '#8d9196'));
    const lightGeo = mergeGeometries([pole, arm, arm2]);
    const lamp = new THREE.BoxGeometry(0.6, 0.15, 0.3);
    lamp.translate(-2.5, 8.9, 0);
    const lamp2 = lamp.clone();
    lamp2.translate(5, 0, 0);
    const lampGeo = mergeGeometries([lamp, lamp2]);
    const bulbMat = new THREE.MeshLambertMaterial({
      color: '#f1eedc',
      emissive: new THREE.Color('#ffcc66'),
      emissiveIntensity: 0,
    });
    this.litSigns.push(bulbMat);
    const lights: THREE.Matrix4[] = [];
    for (let z = START_Z; z < END_Z; z += 40) {
      if (hasCrescentLight(z) || FOOTBRIDGES.some((f) => Math.abs(f - z) < 6)) continue;
      const road = sampleRoad(z);
      dummy.position.set(road.right + 0.7, elevationAt(z) + 0.85, -z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      lights.push(dummy.matrix.clone());
    }
    if (lightGeo && lights.length) {
      const lMesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), lights.length);
      lights.forEach((m, i) => lMesh.setMatrixAt(i, m));
      this.group.add(lMesh);
    }
    if (lampGeo && lights.length) {
      const bMesh = new THREE.InstancedMesh(lampGeo, bulbMat, lights.length);
      lights.forEach((m, i) => bMesh.setMatrixAt(i, m));
      this.group.add(bMesh);
    }

    // --- Billboards ------------------------------------------------------------------
    const postMat = new THREE.MeshLambertMaterial({ color: '#6d6f73' });
    const postGeo = new THREE.BoxGeometry(0.4, 1, 0.4);
    let bi = 0;
    for (let z = 120; z < END_Z - 100; z += rng.range(110, 190)) {
      const road = sampleRoad(z);
      const zone = ZONES[zoneIndexAt(z)];
      const side = rng.chance(0.65) ? -1 : 1;
      if (z < SADDAR_END + 40 || FLYOVERS.some((f) => Math.abs(f.z - z) < 25) || FOOTBRIDGES.some((f) => Math.abs(f - z) < 25) || Math.abs(z - TOLL_Z) < 40) continue;
      if (side < 0 && inRiver(road.left - road.shoulder - 6, 3, z, z)) continue;
      const base = 0;
      const h = zone.elevated ? elevationAt(z) + 6 : 9;
      const x = side < 0 ? road.left - road.shoulder - rng.range(4, 8) : road.right + 1.4 + (road.right - road.left) + rng.range(4, 8);
      const bTex = billboardTexture(bi++ % BILLBOARD_COUNT);
      const bMat = new THREE.MeshLambertMaterial({
        map: bTex,
        emissiveMap: bTex,
        emissive: new THREE.Color('#fff4db'),
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      });
      this.litSigns.push(bMat);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), bMat);
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

  /** Water tanks on the housing; plant rooms and masts on the towers. */
  private buildRoofClutter(rng: Rng, settlements: { x: number; z: number; w: number; d: number; h: number }[], towers: { x: number; z: number; w: number; d: number; h: number }[]): void {
    const d = new THREE.Object3D();
    const tanks: THREE.Matrix4[] = [];
    const tankCols: THREE.Color[] = [];
    const TANKS = ['#2f5fa8', '#1f4f9a', '#222222', '#e8e4da', '#3a6fc0'];
    for (const b of settlements) {
      const n = rng.chance(0.75) ? rng.int(1, 2) : 0;
      for (let k = 0; k < n; k++) {
        d.position.set(b.x + rng.range(-b.d / 2 + 0.8, b.d / 2 - 0.8), b.h, -(b.z + rng.range(-b.w / 2 + 0.8, b.w / 2 - 0.8)));
        const s = rng.range(0.8, 1.15);
        d.scale.set(s, s, s);
        d.updateMatrix();
        tanks.push(d.matrix.clone());
        tankCols.push(new THREE.Color(TANKS[rng.int(0, TANKS.length - 1)]));
      }
    }
    const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 10).translate(0, 0.65, 0), new THREE.MeshLambertMaterial(), tanks.length);
    tanks.forEach((m, i) => {
      tank.setMatrixAt(i, m);
      tank.setColorAt(i, tankCols[i]);
    });
    tank.castShadow = !this.lowSpec;
    this.group.add(tank);

    const rooms: THREE.Matrix4[] = [];
    for (const b of towers) {
      d.position.set(b.x + rng.range(-1, 1), b.h, -b.z);
      d.scale.set(b.d * rng.range(0.35, 0.55), rng.range(2.5, 4), b.w * rng.range(0.3, 0.5));
      d.updateMatrix();
      rooms.push(d.matrix.clone());
    }
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const room = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#cfcac0' }), rooms.length);
    rooms.forEach((m, i) => room.setMatrixAt(i, m));
    room.castShadow = !this.lowSpec;
    this.group.add(room);
  }

  private buildHazards(hm: HazardManager, factory: VehicleFactory): void {
    const potholes: THREE.BufferGeometry[] = [];
    const potholeRims: THREE.BufferGeometry[] = [];
    const potholeLips: THREE.BufferGeometry[] = [];
    const rubble: THREE.BufferGeometry[] = [];
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
          // Readable at speed: pale crumbled rim -> dark lip -> near-black hole,
          // plus loose rubble. Drawn a bit larger than the hit area.
          const ring = (r0: number, r1: number, list: THREE.BufferGeometry[], lift: number) => {
            const r = new THREE.RingGeometry(r0, r1, 9);
            r.rotateX(-Math.PI / 2);
            r.scale(h.hw, 1, h.hl);
            list.push(at(r, h, lift));
          };
          ring(1.0, 1.4, potholeRims, 0.04);
          ring(0.72, 1.0, potholeLips, 0.045);
          const g = new THREE.CircleGeometry(0.74, 9);
          g.rotateX(-Math.PI / 2);
          g.scale(h.hw, 1, h.hl);
          potholes.push(at(g, h, 0.05));
          for (let k = 0; k < 4; k++) {
            const a = h.id * 2.39 + k * 1.7;
            const d = 1.35 + ((h.id * 7 + k * 3) % 5) * 0.08;
            const c = new THREE.BoxGeometry(0.14, 0.06, 0.11);
            c.rotateY(a);
            c.translate(Math.cos(a) * h.hw * d, 0.03, Math.sin(a) * h.hl * d);
            rubble.push(at(c, h, 0.02));
          }
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
    addMerged(potholeRims, decal('#d2c4aa', -3));
    addMerged(potholeLips, decal('#4a4036', -4));
    addMerged(potholes, new THREE.MeshBasicMaterial({ color: '#0d0b0a', polygonOffset: true, polygonOffsetFactor: -5 }));
    addMerged(rubble, new THREE.MeshLambertMaterial({ color: '#a39887' }));
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
      v.root.userData.sharedFactory = true;
      v.root.position.set(road.left - road.shoulder * 0.5, elevationAt(rb.z), -(rb.z - 6));
      v.root.rotation.y = 0.25;
      this.group.add(v.root);
      this.roadblockPolice.push(v);
      // "VIP MOVEMENT" warning sign ahead of it.
      const warnTex = signTexture(['VIP MOVEMENT', 'ROAD CLOSED'], '#b71c1c', '#ffffff', 384, 144);
      const warnMat = new THREE.MeshLambertMaterial({
        map: warnTex,
        emissiveMap: warnTex,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0,
      });
      this.litSigns.push(warnMat);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), warnMat);
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
      const gTex = signTexture(lines, bg);
      const gMat = new THREE.MeshLambertMaterial({
        map: gTex,
        emissiveMap: gTex,
        emissive: new THREE.Color('#fff4db'),
        emissiveIntensity: 0,
      });
      this.litSigns.push(gMat);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(11, x1 - x0 - 1), 2.4), gMat);
      sign.position.set((x0 + x1) / 2, y + h - 0.6, -z + 0.25);
      this.group.add(sign);
    };
    for (const cp of CHECKPOINTS) addGantry(cp.z - 10, [cp.label, `CHECKPOINT  +${cp.bonus}s`], '#0b6e3a');

    // Green direction board before Karsaz, English + Urdu.
    addGantry(3195, ['↑ AIRPORT  ·  KARSAZ ←', 'ایئرپورٹ  ·  کارساز'], '#0b6e3a');

    // Destination gantry; the Teen Talwar monument stands just beyond it.
    addGantry(FINISH_Z, ['CLIFTON · TEEN TALWAR', 'DESTINATION'], '#1b5e20');
  }

  setTimeOfDay(tod: TimeOfDay): void {
    const night = tod === 'night' ? 0.95 : tod === 'monsoon' ? 0.65 : tod === 'sunset' ? 0.35 : 0;
    for (const m of this.facadeMats) setFacadeNight(m, night);
    const glow = tod === 'night' ? 0.85 : tod === 'monsoon' ? 0.72 : tod === 'sunset' ? 0.32 : 0;
    for (const s of this.litSigns) s.emissiveIntensity = glow;
    for (const pv of this.roadblockPolice) pv.setHeadlights(tod === 'noon' ? 0 : 1, tod !== 'noon');
  }

  dispose(): void {
    for (const t of this.ownedTex) t.dispose();
    this.ownedTex = [];
    const disposeTree = (obj: THREE.Object3D) => {
      if (obj.userData.sharedFactory) return;
      if (obj instanceof THREE.BatchedMesh) {
        obj.dispose();
      } else if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
      for (const ch of obj.children) disposeTree(ch);
    };
    disposeTree(this.group);
    this.facadeMats = [];
    this.litSigns = [];
    this.roadblockPolice = [];
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
