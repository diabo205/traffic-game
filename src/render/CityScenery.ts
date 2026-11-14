import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityMap, KERB_H, SIDEWALK } from '../sim/city/cityMap';
import type { CityLink, CityMap } from '../sim/city/cityMap';
import { pointObbDistance } from '../sim/math';
import { Rng } from '../sim/rng';
import { makeFacadeMaterial } from './facadeMaterial';
import { buildEmpressMarketAt } from './Landmarks';
import { asphaltTexture, dirtTexture, kerbStripeTexture, saddarFacadeAtlas, SHOP_SIGN_COUNT, shopSignTexture, signTexture } from './textures';

type V3 = readonly [number, number, number];

/** Collects textured triangles & quads (auto-oriented to a facing hint) into one geometry. */
class Tris {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  tri(a: V3, b: V3, c: V3, uvs: readonly number[], facing: V3, color?: THREE.Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0;
    const base = this.pos.length / 3;
    for (const p of [a, b, c]) this.pos.push(p[0], p[1], p[2]);
    this.uv.push(...uvs);
    const cc = color ?? WHITE;
    for (let i = 0; i < 3; i++) this.col.push(cc.r, cc.g, cc.b);
    if (flip) this.idx.push(base, base + 2, base + 1);
    else this.idx.push(base, base + 1, base + 2);
  }

  quad(a: V3, b: V3, c: V3, d: V3, uvs: readonly number[], facing: V3, color?: THREE.Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0;
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    this.uv.push(...uvs);
    const cc = color ?? WHITE;
    for (let i = 0; i < 4; i++) this.col.push(cc.r, cc.g, cc.b);
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  get empty(): boolean {
    return this.idx.length === 0;
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

const WHITE = new THREE.Color('#ffffff');
const PARK_TINT = new THREE.Color('#8ecf6e');
const UP: V3 = [0, 1, 0];

const BUILDING_COLORS = ['#d9c9a3', '#cdb48a', '#e3dccb', '#bfae8e', '#d6c2a0', '#c9bba3', '#e0cfae', '#b8a888', '#cfd0c8', '#e6d3b0', '#c7b593', '#ddd2bd'];

const dummy = new THREE.Object3D();
function place(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, ry, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], shadow = false): void {
  if (mats.length === 0) return;
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mm, i) => m.setMatrixAt(i, mm));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
}

/**
 * Draws the Real Saddar OSM open-city map: asphalt strips + junction caps,
 * raised pavements & Jehangir Park with road-facing kerbs, lane markings,
 * roundabouts, Empress Market, oriented buildings with shop signs and roof
 * clutter, poles/wires, neem trees, construction yards and ramps. Static; built once.
 */
export class CityScenery {
  readonly group = new THREE.Group();

  constructor(lowSpec: boolean) {
    const map = cityMap();
    const shadow = !lowSpec;
    this.ground(map);
    this.roads(map);
    this.pavements(map);
    this.markings(map);
    this.islands(map, shadow);
    this.buildings(map, shadow);
    this.poles(map);
    this.trees(map, shadow);
    this.yards(map);
    this.ramps(map, shadow);
    for (const l of map.landmarks) {
      if (l.kind === 'empress') {
        const sub = new THREE.Group();
        sub.position.set(l.obb.x, KERB_H, -l.obb.z);
        sub.rotation.y = -l.obb.heading;
        buildEmpressMarketAt(sub, shadow, l.obb.hw, 0, l.obb.hl * 2);
        this.group.add(sub);
      }
    }
  }

  update(_time: number, _x: number, _z: number): void {
    /* static scenery */
  }

  private ground(map: CityMap): void {
    const b = map.bounds;
    const w = Math.max(2600, b.x1 - b.x0 + 700);
    const d = Math.max(2400, b.z1 - b.z0 + 700);
    const tex = dirtTexture().clone();
    tex.repeat.set(Math.round(w / 13), Math.round(d / 13));
    tex.needsUpdate = true;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: '#d8c39a', map: tex }));
    g.rotation.x = -Math.PI / 2;
    g.position.set((b.x0 + b.x1) / 2, -0.03, -(b.z0 + b.z1) / 2);
    this.group.add(g);
  }

  private roads(map: CityMap): void {
    const q = new Tris();
    const uvS = 1 / 7;
    for (const s of map.roadSegs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const ux = dx / len, uz = dz / len;
      // Right = (uz, -ux), left = (-uz, ux)
      const p0x = s.ax + uz * s.hw, p0z = s.az - ux * s.hw;
      const p1x = s.bx + uz * s.hw, p1z = s.bz - ux * s.hw;
      const p2x = s.bx - uz * s.hw, p2z = s.bz + ux * s.hw;
      const p3x = s.ax - uz * s.hw, p3z = s.az + ux * s.hw;
      q.quad(
        [p0x, 0, -p0z],
        [p1x, 0, -p1z],
        [p2x, 0, -p2z],
        [p3x, 0, -p3z],
        [p0x * uvS, p0z * uvS, p1x * uvS, p1z * uvS, p2x * uvS, p2z * uvS, p3x * uvS, p3z * uvS],
        UP,
      );
    }
    const SEG = 12;
    const invCos = 1 / Math.cos(Math.PI / SEG);
    for (let i = 0; i < map.nodes.length; i++) {
      const r = map.nodeCapR[i];
      if (r <= 0) continue;
      const nd = map.nodes[i];
      const capR = r * invCos;
      const cu = nd.x * uvS, cv = nd.z * uvS;
      const center: V3 = [nd.x, 0, -nd.z];
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * Math.PI * 2;
        const a1 = ((k + 1) / SEG) * Math.PI * 2;
        const x0 = nd.x + Math.cos(a0) * capR, z0 = nd.z + Math.sin(a0) * capR;
        const x1 = nd.x + Math.cos(a1) * capR, z1 = nd.z + Math.sin(a1) * capR;
        q.tri(center, [x0, 0, -z0], [x1, 0, -z1], [cu, cv, x0 * uvS, z0 * uvS, x1 * uvS, z1 * uvS], UP);
      }
    }
    // Seal roundabout plaza interiors smoothly up to the central islands.
    for (const loop of map.roundaboutLoops) {
      const cx = loop.island.x, cz = loop.island.z;
      const center: V3 = [cx, 0, -cz];
      const pts = loop.pts;
      const n = pts.length / 2;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const ax = pts[k * 2], az = pts[k * 2 + 1];
        const bx = pts[k2 * 2], bz = pts[k2 * 2 + 1];
        q.tri(center, [ax, 0, -az], [bx, 0, -bz], [cx * uvS, cz * uvS, ax * uvS, az * uvS, bx * uvS, bz * uvS], UP);
      }
    }
    const m = new THREE.Mesh(q.build(), new THREE.MeshLambertMaterial({ map: asphaltTexture(), color: '#c9c7c2' }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  private pavements(map: CityMap): void {
    const top = new Tris();
    const kerb = new Tris();
    const uvS = 1 / 3;
    for (const slab of map.slabs) {
      const pts = slab.pts;
      const n = pts.length / 2;
      if (n < 3) continue;
      const col = slab.kind === 1 ? PARK_TINT : WHITE;
      for (let i = 0; i < slab.tris.length; i += 3) {
        const i0 = slab.tris[i] * 2, i1 = slab.tris[i + 1] * 2, i2 = slab.tris[i + 2] * 2;
        const x0 = pts[i0], z0 = pts[i0 + 1];
        const x1 = pts[i1], z1 = pts[i1 + 1];
        const x2 = pts[i2], z2 = pts[i2 + 1];
        top.tri(
          [x0, KERB_H, -z0],
          [x1, KERB_H, -z1],
          [x2, KERB_H, -z2],
          [x0 * uvS, z0 * uvS, x1 * uvS, z1 * uvS, x2 * uvS, z2 * uvS],
          UP,
          col,
        );
      }
      // Road-facing kerbs around the slab perimeter.
      let area = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
      }
      const sign = area >= 0 ? 1 : -1;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = pts[i * 2], az = pts[i * 2 + 1];
        const bx = pts[j * 2], bz = pts[j * 2 + 1];
        const ex = bx - ax, ez = bz - az;
        const len = Math.hypot(ex, ez);
        if (len < 0.2) continue;
        // For CCW polygon in (x, z), outward normal is (+ez, -ex).
        const nx = (sign * ez) / len, nz = (-sign * ex) / len;
        const hits =
          (map.isRoad(ax + ex * 0.2 + nx * 0.45, az + ez * 0.2 + nz * 0.45) ? 1 : 0) +
          (map.isRoad(ax + ex * 0.5 + nx * 0.45, az + ez * 0.5 + nz * 0.45) ? 1 : 0) +
          (map.isRoad(ax + ex * 0.8 + nx * 0.45, az + ez * 0.8 + nz * 0.45) ? 1 : 0);
        const u1 = u + len;
        if (hits >= (len > 6 ? 2 : 1)) {
          kerb.quad([ax, 0, -az], [bx, 0, -bz], [bx, KERB_H, -bz], [ax, KERB_H, -az], [u, 0, u1, 0, u1, 1, u, 1], [nx, 0, -nz]);
        }
        u = u1;
      }
    }
    const pave = dirtTexture().clone();
    pave.needsUpdate = true;
    const tm = new THREE.Mesh(top.build(), new THREE.MeshLambertMaterial({ map: pave, color: '#e4dfd5', vertexColors: true }));
    tm.receiveShadow = true;
    this.group.add(tm);
    if (!kerb.empty) {
      const km = new THREE.Mesh(kerb.build(), new THREE.MeshLambertMaterial({ map: kerbStripeTexture() }));
      this.group.add(km);
    }
  }

  private markings(map: CityMap): void {
    const q = new Tris();
    const white = new THREE.Color('#f2f0ea');
    const yellow = new THREE.Color('#e8b923');
    const y = 0.012;
    /** Rectangle in link-local coordinates (s along, o = offset to the left). */
    const rect = (l: CityLink, s0: number, s1: number, o0: number, o1: number, c: THREE.Color) => {
      const p = (s: number, o: number): V3 => {
        const w = map.linkPoint(l, s, o);
        return [w.x, y, -w.z];
      };
      q.quad(p(s0, o0), p(s1, o0), p(s1, o1), p(s0, o1), [0, 0, 1, 0, 1, 1, 0, 1], UP, c);
    };
    const dashes = (l: CityLink, o: number, c: THREE.Color, w = 0.14) => {
      for (let s = 2; s < l.len - 6; s += 6) rect(l, s, s + 3, o - w / 2, o + w / 2, c);
    };
    for (const l of map.links) {
      if (l.turnaround) continue;
      const fromNd = map.nodes[l.from], toNd = map.nodes[l.to];
      const raLink = fromNd.roundabout && toNd.roundabout;
      // Each two-way street segment once: centre line from the lower-id direction.
      if (!l.oneway && l.id < l.reverse && l.median === 0) {
        if (l.cls === 'arterial' || l.cls === 'main') {
          const pad = fromNd.bend || toNd.bend ? 0.3 : 1;
          if (l.len > pad * 2 + 1) {
            rect(l, pad, l.len - pad, -0.22, -0.08, yellow);
            rect(l, pad, l.len - pad, 0.08, 0.22, yellow);
          }
        } else {
          dashes(l, 0, white);
        }
      }
      for (let k = 1; k < l.lanes; k++) {
        dashes(l, (map.laneOffset(l, k - 1) + map.laneOffset(l, k)) * 0.5, white);
      }
      // Stop line, and zebra crossings at actual junctions on bigger streets.
      if (l.len > 16 && !raLink) {
        const zebra = l.cls !== 'side';
        if (!toNd.bend) {
          const stopAt = zebra ? l.len - 5.2 : l.len - 0.8;
          const leftLo = l.oneway ? -l.hw + 0.2 : l.median / 2 + 0.1;
          rect(l, stopAt, stopAt + 0.45, leftLo, l.hw - 0.2, white);
        }
        if (zebra && (l.oneway || l.id < l.reverse)) {
          if (!toNd.bend) {
            for (let o = -l.hw + 0.4; o < l.hw - 0.4; o += 1.1) rect(l, l.len - 4.4, l.len - 1.2, o, o + 0.55, white);
          }
          if (!fromNd.bend) {
            for (let o = -l.hw + 0.4; o < l.hw - 0.4; o += 1.1) rect(l, 1.2, 4.4, o, o + 0.55, white);
          }
        }
      }
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(q.build(), mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private islands(map: CityMap, shadow: boolean): void {
    for (const s of map.islands) {
      const segs = s.monumental ? 40 : 28;
      const tex = kerbStripeTexture().clone();
      tex.repeat.set(Math.round(Math.PI * 2 * s.r), 1);
      tex.needsUpdate = true;
      const kerb = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 0.35, segs, 1, true), new THREE.MeshLambertMaterial({ map: tex }));
      kerb.position.set(s.x, 0.175, -s.z);
      const grass = new THREE.Mesh(new THREE.CircleGeometry(s.r, segs), new THREE.MeshLambertMaterial({ color: '#86a05a' }));
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(s.x, 0.34, -s.z);
      grass.receiveShadow = true;
      this.group.add(kerb, grass);
      if (s.monumental) {
        // Plinth, white column and a national flag (Fawara Chowk).
        const stone = new THREE.MeshLambertMaterial({ color: '#efece4' });
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 1.2, 8), new THREE.MeshLambertMaterial({ color: '#b3261e' }));
        plinth.position.set(s.x, 0.9, -s.z);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 7, 8), stone);
        col.position.set(s.x, 5, -s.z);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stone);
        cap.position.set(s.x, 8.5, -s.z);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), new THREE.MeshLambertMaterial({ color: '#8d9196' }));
        pole.position.set(s.x, 11.5, -s.z);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
        flag.position.set(s.x + 1.5, 13.4, -s.z);
        for (const o of [plinth, col, cap]) o.castShadow = shadow;
        this.group.add(plinth, col, cap, pole, flag);
      } else {
        // Compact roundabout planter & neem centrepiece (Art Council Roundabout).
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.42, s.r * 0.48, 0.7, 12), new THREE.MeshLambertMaterial({ color: '#b8914f' }));
        plinth.position.set(s.x, 0.65, -s.z);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 3.0, 6), new THREE.MeshLambertMaterial({ color: '#6b5440' }));
        trunk.position.set(s.x, 2.3, -s.z);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), new THREE.MeshLambertMaterial({ color: '#6f8c47', flatShading: true }));
        crown.position.set(s.x, 4.4, -s.z);
        crown.castShadow = plinth.castShadow = shadow;
        this.group.add(plinth, trunk, crown);
      }
    }
  }

  private buildings(map: CityMap, shadow: boolean): void {
    const mats: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const tanks: THREE.Matrix4[] = [];
    const tankColors: THREE.Color[] = [];
    const rooms: THREE.Matrix4[] = [];
    const signs: THREE.Matrix4[][] = Array.from({ length: SHOP_SIGN_COUNT }, () => []);
    const awnings: THREE.Matrix4[] = [];
    const awningColors: THREE.Color[] = [];
    const awningPalette = ['#1e6fb8', '#2e7d32', '#c62828', '#f9a825', '#6a1b9a', '#00838f'].map((c) => new THREE.Color(c));

    for (const b of map.buildings) {
      const rng = new Rng(b.seed);
      const base = KERB_H;
      const ry = -b.heading;
      const s = Math.sin(b.heading), c = Math.cos(b.heading);
      mats.push(place(b.x, base, -b.z, ry, b.hw * 2, b.h, b.hl * 2));
      colors.push(new THREE.Color(BUILDING_COLORS[rng.int(0, BUILDING_COLORS.length - 1)]).multiplyScalar(rng.range(0.92, 1.05)));
      const top = base + b.h;
      // Roof clutter: black / blue water tanks and a stair room.
      if (rng.chance(0.7)) {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) {
          const lf = rng.range(-b.hl + 1.2, b.hl - 1.2);
          const lr = rng.range(-b.hw + 1.2, b.hw - 1.2);
          const tx = b.x + lf * s + lr * c;
          const tz = b.z + lf * c - lr * s;
          tanks.push(place(tx, top, -tz, ry, 1, rng.range(0.9, 1.2), 1));
          tankColors.push(new THREE.Color(rng.chance(0.75) ? '#1d1f22' : '#2f6fb0'));
        }
      }
      if (rng.chance(0.5) && b.hw > 2.5 && b.hl > 2.5) {
        const lf = rng.range(-b.hl + 2, b.hl - 2);
        const lr = rng.range(-b.hw + 2, b.hw - 2);
        const rx = b.x + lf * s + lr * c;
        const rz = b.z + lf * c - lr * s;
        rooms.push(place(rx, top, -rz, ry, 2.6, 2.6, 2.6));
      }
      // Street-facing sides get shop signs and an awning over the shutters.
      // Each face: [outward sim normal nx, nz, distance from center, wall half-length, local Three ry]
      const faces: Array<[number, number, number, number, number]> = [
        [c, -s, b.hw, b.hl, Math.PI / 2],
        [-c, s, b.hw, b.hl, -Math.PI / 2],
        [s, c, b.hl, b.hw, Math.PI],
        [-s, -c, b.hl, b.hw, 0],
      ];
      for (const [nx, nz, dist, half, localRy] of faces) {
        if (half < 2.5) continue;
        const fx = b.x + nx * dist, fz = b.z + nz * dist;
        if (map.isRoad(fx + nx * 0.5, fz + nz * 0.5)) continue;
        if (!map.nearRoad(fx + nx * (SIDEWALK + 0.8), fz + nz * (SIDEWALK + 0.8), 1.5)) continue;
        const w = Math.min(half * 1.7, rng.range(5, 10));
        const off = rng.range(-(half - w / 2), half - w / 2) * 0.6;
        // Tangent along wall perpendicular to (nx, nz): (-nz, nx)
        const ax = fx + nx * 0.06 - nz * off, az = fz + nz * 0.06 + nx * off;
        const fRy = localRy + ry;
        signs[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(ax, base + 3.15, -az, fRy, w, w / 4.6 + 0.2, 1));
        if (rng.chance(0.6)) {
          awnings.push(place(fx + nx * 0.7, base + 2.55, -(fz + nz * 0.7), fRy, half * 1.8, 0.1, 1.4));
          awningColors.push(awningPalette[rng.int(0, awningPalette.length - 1)]);
        }
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    instanced(this.group, box, makeFacadeMaterial(saddarFacadeAtlas()), mats, colors, shadow);
    instanced(this.group, new THREE.CylinderGeometry(0.6, 0.6, 1.3, 10).translate(0, 0.65, 0), new THREE.MeshLambertMaterial(), tanks, tankColors, shadow);
    instanced(this.group, box, new THREE.MeshLambertMaterial({ color: '#cfcac0' }), rooms, undefined, shadow);
    const plane = new THREE.PlaneGeometry(1, 1);
    signs.forEach((m, i) => instanced(this.group, plane, new THREE.MeshLambertMaterial({ map: shopSignTexture(i) }), m));
    const awningGeo = new THREE.BoxGeometry(1, 1, 1);
    awningGeo.rotateX(-0.25);
    instanced(this.group, awningGeo, new THREE.MeshLambertMaterial(), awnings, awningColors);
  }

  /** Concrete poles along the kerbs with sagging bundles of wires. */
  private poles(map: CityMap): void {
    const poles: THREE.Matrix4[] = [];
    const wire: number[] = [];
    const rng = new Rng(77);
    const sagLine = (a: V3, b: V3, sag: number) => {
      const n = 5;
      let prev = a;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
        wire.push(...prev, ...p);
        prev = p;
      }
    };
    const H = 8.2;
    for (const l of map.links) {
      if (l.turnaround || l.len < 20) continue;
      if (map.nodes[l.from].roundabout && map.nodes[l.to].roundabout) continue;
      const off = l.hw + 0.7;
      let prev: V3 | null = null;
      for (let s = 5; s < l.len - 4; s += rng.range(22, 30)) {
        const p = map.linkPoint(l, s, off);
        if (map.isRoad(p.x, p.z) || map.nearRoad(p.x, p.z, 0.35)) {
          prev = null;
          continue;
        }
        const top: V3 = [p.x, KERB_H + H, -p.z];
        poles.push(place(p.x, KERB_H, -p.z, -l.heading));
        if (prev && Math.hypot(top[0] - prev[0], top[2] - prev[2]) < 42) {
          for (let k = 0; k < 3; k++) sagLine([prev[0], prev[1] - 0.35 * k, prev[2]], [top[0], top[1] - 0.35 * k, top[2]], rng.range(0.4, 0.9));
        }
        // Now and then a wire straight across the street to the far facade.
        if (rng.chance(0.28)) {
          const far = map.linkPoint(l, s + rng.range(-3, 3), -(l.hw + SIDEWALK * 0.7));
          if (!map.isRoad(far.x, far.z)) {
            sagLine([top[0], top[1] - 0.2, top[2]], [far.x, KERB_H + rng.range(5.5, 7.5), -far.z], rng.range(0.6, 1.3));
          }
        }
        prev = top;
      }
    }
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.1, 0.16, H, 6).translate(0, H / 2, 0),
      new THREE.BoxGeometry(1.6, 0.12, 0.12).translate(0, H - 0.3, 0),
    ]);
    if (poleGeo) instanced(this.group, poleGeo, new THREE.MeshLambertMaterial({ color: '#a9a59b' }), poles);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2a2a2a' })));
  }

  /** Bare dirt construction yards with oriented site boards. */
  private yards(map: CityMap): void {
    const q = new Tris();
    const uvS = 1 / 4;
    for (const y of map.yards) {
      const s = Math.sin(y.heading), c = Math.cos(y.heading);
      const pt = (lf: number, lr: number): V3 => [y.x + lf * s + lr * c, KERB_H + 0.012, -(y.z + lf * c - lr * s)];
      q.quad(
        pt(-y.hl, -y.hw),
        pt(-y.hl, y.hw),
        pt(y.hl, y.hw),
        pt(y.hl, -y.hw),
        [-y.hw * uvS, -y.hl * uvS, y.hw * uvS, -y.hl * uvS, y.hw * uvS, y.hl * uvS, -y.hw * uvS, y.hl * uvS],
        UP,
      );
    }
    if (q.empty) return;
    const m = new THREE.Mesh(q.build(), new THREE.MeshLambertMaterial({ map: dirtTexture(), color: '#d9bf8f', polygonOffset: true, polygonOffsetFactor: -1 }));
    m.receiveShadow = true;
    this.group.add(m);
    const boardMat = new THREE.MeshLambertMaterial({
      map: signTexture(['KMC ROAD WORKS', 'KAAM JAARI HAI'], '#f9a825', '#1b1b1b', 512, 192),
      side: THREE.DoubleSide,
    });
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: '#555' });
    for (const y of map.yards) {
      const s = Math.sin(y.heading), c = Math.cos(y.heading);
      const lf = -(y.hl - 1.5);
      const bx = y.x + lf * s, bz = y.z + lf * c;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), boardMat);
      board.position.set(bx, KERB_H + 3.2, -bz);
      board.rotation.y = -y.heading;
      for (const lr of [-2.2, 2.2]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(bx + lr * c, KERB_H + 1.6, -(bz - lr * s));
        this.group.add(post);
      }
      this.group.add(board);
    }
  }

  /** Wedge ramps: steel kickers with hazard stripes on the street, packed dirt in the yard. */
  private ramps(map: CityMap, shadow: boolean): void {
    const tops = new Tris();
    const sides = new Tris();
    const steel = new THREE.Color('#b3ada2');
    const dirt = new THREE.Color('#b08a5a');
    const inYard = (x: number, z: number) => map.yards.some((y) => pointObbDistance(x, z, y) === 0);
    for (const r of map.ramps) {
      const base = map.isRoad(r.x, r.z) ? 0 : KERB_H;
      const yard = inYard(r.x, r.z);
      const s = Math.sin(r.heading), c = Math.cos(r.heading);
      const pt = (f: number, l: number, up: boolean): V3 => {
        const x = r.x + f * s + l * c, z = r.z + f * c - l * s;
        return [x, base + (up ? (r.h * (f + r.hl)) / (2 * r.hl) : 0) + 0.005, -z];
      };
      const fwd: V3 = [s, 0, -c];
      const right: V3 = [c, 0, s];
      // Sloping top.
      const len = Math.hypot(2 * r.hl, r.h);
      tops.quad(pt(-r.hl, -r.hw, true), pt(-r.hl, r.hw, true), pt(r.hl, r.hw, true), pt(r.hl, -r.hw, true), [0, 0, 1, 0, 1, len, 0, len], UP, yard ? dirt : steel);
      // Tall end and the two triangular sides.
      const hiL = pt(r.hl, -r.hw, true), hiR = pt(r.hl, r.hw, true), loL = pt(r.hl, -r.hw, false), loR = pt(r.hl, r.hw, false);
      // Dirt ramps sample a plain patch of the stripe texture (no hazard paint).
      const plain = [0.2, 0.5, 0.2, 0.5, 0.2, 0.5, 0.2, 0.5];
      sides.quad(loL, loR, hiR, hiL, yard ? plain : [0, 0, r.hw * 2, 0, r.hw * 2, 1, 0, 1], fwd, yard ? dirt.clone().multiplyScalar(0.55) : undefined);
      for (const side of [-1, 1]) {
        const a = pt(-r.hl, side * r.hw, false), b = pt(r.hl, side * r.hw, false), t = pt(r.hl, side * r.hw, true);
        sides.quad(a, b, t, t, yard ? plain : [0, 0, r.hl * 2, 0, r.hl * 2, 1, r.hl * 2, 1], side > 0 ? right : [-right[0], 0, -right[2]], yard ? dirt.clone().multiplyScalar(0.55) : undefined);
      }
    }
    if (tops.empty) return;
    const top = new THREE.Mesh(tops.build(), new THREE.MeshLambertMaterial({ vertexColors: true, map: dirtTexture() }));
    const tex = kerbStripeTexture().clone();
    tex.needsUpdate = true;
    const side = new THREE.Mesh(sides.build(), new THREE.MeshLambertMaterial({ vertexColors: true, map: tex }));
    for (const m of [top, side]) {
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** Neem trees in Jehangir Park, along arterials and around the Empress Market plaza. */
  private trees(map: CityMap, shadow: boolean): void {
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const crownColors: THREE.Color[] = [];
    const placed: Array<[number, number]> = [];
    const rng = new Rng(31);
    const add = (x: number, z: number, minGap = 6) => {
      if (map.nearRoad(x, z, 1.0)) return;
      let hit = false;
      map.forEachSolidNear(x, z, 3, (b) => {
        if (pointObbDistance(x, z, b) < 1.2) hit = true;
      });
      if (hit) return;
      for (const [px, pz] of placed) {
        if ((x - px) ** 2 + (z - pz) ** 2 < minGap * minGap) return;
      }
      placed.push([x, z]);
      const s = rng.range(0.8, 1.25);
      trunks.push(place(x, KERB_H, -z, 0, s, s, s));
      crowns.push(place(x, KERB_H + 3.6 * s, -z, rng.range(0, 6), s * rng.range(0.9, 1.2), s, s * rng.range(0.9, 1.2)));
      crownColors.push(new THREE.Color().setHSL(rng.range(0.22, 0.28), 0.35, rng.range(0.3, 0.38)));
    };
    // Jehangir Park scatter.
    for (const slab of map.slabs) {
      if (slab.kind !== 1) continue;
      const pts = slab.pts;
      for (let i = 0; i < slab.tris.length; i += 3) {
        const i0 = slab.tris[i] * 2, i1 = slab.tris[i + 1] * 2, i2 = slab.tris[i + 2] * 2;
        const ax = pts[i0], az = pts[i0 + 1];
        const bx = pts[i1], bz = pts[i1 + 1];
        const cx = pts[i2], cz = pts[i2 + 1];
        const area = 0.5 * Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
        const count = Math.floor(area / 360 + (rng.next() < (area % 360) / 360 ? 1 : 0));
        for (let k = 0; k < count; k++) {
          let u = rng.next(), v = rng.next();
          if (u + v > 1) {
            u = 1 - u;
            v = 1 - v;
          }
          add(ax + u * (bx - ax) + v * (cx - ax), az + u * (bz - az) + v * (cz - az), 9);
        }
      }
    }
    // Major arterials.
    for (const l of map.links) {
      if (l.turnaround || l.cls !== 'arterial' || l.len < 34) continue;
      if (map.nodes[l.from].roundabout && map.nodes[l.to].roundabout) continue;
      const off = l.hw + 1.8;
      for (let s = 12; s < l.len - 10; s += rng.range(28, 42)) {
        const p = map.linkPoint(l, s, off);
        add(p.x, p.z, 12);
      }
    }
    // Empress Market front plaza.
    for (const l of map.landmarks) {
      const o = l.obb;
      const s = Math.sin(o.heading), c = Math.cos(o.heading);
      const lr = o.hw + 7.5;
      for (let lf = -o.hl; lf <= o.hl; lf += 12) {
        add(o.x + lf * s + lr * c, o.z + lf * c - lr * s, 8);
      }
    }
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0);
    const crown = new THREE.IcosahedronGeometry(2.2, 0);
    instanced(this.group, trunk, new THREE.MeshLambertMaterial({ color: '#6b5440' }), trunks, undefined, shadow);
    instanced(this.group, crown, new THREE.MeshLambertMaterial({ flatShading: true }), crowns, crownColors, shadow);
  }
}

let flagTex: THREE.Texture | null = null;
function flagTexture(): THREE.Texture {
  if (flagTex) return flagTex;
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 48, 128);
    ctx.fillStyle = '#01411c';
    ctx.fillRect(48, 0, 144, 128);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(124, 64, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#01411c';
    ctx.beginPath();
    ctx.arc(136, 56, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5 + 0.6;
      const r = i % 2 === 0 ? 13 : 5.5;
      ctx.lineTo(150 + Math.cos(a) * r, 44 + Math.sin(a) * r);
    }
    ctx.fill();
  }
  flagTex = new THREE.CanvasTexture(c);
  flagTex.colorSpace = THREE.SRGBColorSpace;
  return flagTex;
}
