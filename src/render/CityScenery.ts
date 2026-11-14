import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityMap, halfWidth, KERB_H, SIDEWALK } from '../sim/city/cityMap';
import type { CityLink, CityMap, Rect } from '../sim/city/cityMap';
import { Rng } from '../sim/rng';
import { makeFacadeMaterial } from './facadeMaterial';
import { buildEmpressMarketAt } from './Landmarks';
import { asphaltTexture, dirtTexture, kerbStripeTexture, saddarFacadeAtlas, SHOP_SIGN_COUNT, shopSignTexture, signTexture } from './textures';

type V3 = readonly [number, number, number];

/** Collects textured quads (auto-oriented to a facing hint) into one geometry. */
class Quads {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  quad(a: V3, b: V3, c: V3, d: V3, uvs: readonly number[], facing: V3, color?: THREE.Color): void {
    // Flip winding if the quad faces away from the hint.
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

  /** Horizontal rectangle in sim space at height y, world-scaled UVs. */
  flat(r: Rect, y: number, uvScale: number, color?: THREE.Color): void {
    const a: V3 = [r.x0, y, -r.z0], b: V3 = [r.x1, y, -r.z0], c: V3 = [r.x1, y, -r.z1], d: V3 = [r.x0, y, -r.z1];
    this.quad(a, b, c, d, [r.x0 * uvScale, r.z0 * uvScale, r.x1 * uvScale, r.z0 * uvScale, r.x1 * uvScale, r.z1 * uvScale, r.x0 * uvScale, r.z1 * uvScale], UP, color);
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
 * Draws the open-city map: asphalt, pavements with painted kerbs, lane
 * markings, the roundabout, Empress Market, buildings with shop signs and
 * roof clutter, and the tangle of poles and wires. Static; built once.
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
      if (l.kind === 'empress') buildEmpressMarketAt(this.group, shadow, l.face, -(l.rect.z0 + l.rect.z1) / 2, l.rect.z1 - l.rect.z0);
    }
  }

  update(_time: number, _x: number, _z: number): void {
    /* static scenery */
  }

  private ground(map: CityMap): void {
    const b = map.bounds;
    const tex = dirtTexture().clone();
    tex.repeat.set(120, 120);
    tex.needsUpdate = true;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: '#d8c39a', map: tex }));
    g.rotation.x = -Math.PI / 2;
    g.position.set((b.x0 + b.x1) / 2, -0.03, -(b.z0 + b.z1) / 2);
    this.group.add(g);
  }

  private roads(map: CityMap): void {
    const q = new Quads();
    for (const r of map.roadRects) q.flat(r, 0, 1 / 7);
    const m = new THREE.Mesh(q.build(), new THREE.MeshLambertMaterial({ map: asphaltTexture(), color: '#c9c7c2' }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  private pavements(map: CityMap): void {
    const top = new Quads();
    const kerb = new Quads();
    const addKerbs = (r: Rect, onlyIfRoad: boolean) => {
      // Edge order: south, north, west, east (sim). Outward normal in three space.
      const edges: Array<[number, number, number, number, number, number]> = [
        [r.x0, r.z0, r.x1, r.z0, 0, -1],
        [r.x0, r.z1, r.x1, r.z1, 0, 1],
        [r.x0, r.z0, r.x0, r.z1, -1, 0],
        [r.x1, r.z0, r.x1, r.z1, 1, 0],
      ];
      for (const [ax, az, bx, bz, nx, nz] of edges) {
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        if (onlyIfRoad) {
          let road = false;
          for (const t of [0.15, 0.5, 0.85]) {
            if (map.isRoad(ax + (bx - ax) * t + nx * 0.4, az + (bz - az) * t + nz * 0.4)) road = true;
          }
          if (!road) continue;
        }
        const u0 = (ax + az) * 1.0, u1 = u0 + len * 1.0;
        kerb.quad([ax, 0, -az], [bx, 0, -bz], [bx, KERB_H, -bz], [ax, KERB_H, -az], [u0, 0, u1, 0, u1, 1, u0, 1], [nx, 0, -nz]);
      }
    };
    for (const s of map.slabs) {
      top.flat(s, KERB_H, 1 / 3);
      addKerbs(s, true);
    }
    for (const md of map.medians) {
      top.flat(md, KERB_H, 1 / 3, new THREE.Color('#b9b9ae'));
      addKerbs(md, false);
    }
    const pave = dirtTexture().clone();
    pave.needsUpdate = true;
    const tm = new THREE.Mesh(top.build(), new THREE.MeshLambertMaterial({ map: pave, color: '#e4dfd5', vertexColors: true }));
    tm.receiveShadow = true;
    this.group.add(tm);
    const km = new THREE.Mesh(kerb.build(), new THREE.MeshLambertMaterial({ map: kerbStripeTexture() }));
    this.group.add(km);
  }

  private markings(map: CityMap): void {
    const q = new Quads();
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
      const hw = halfWidth(l.cls);
      // Each street segment once: centre line from the lower-id direction.
      if (l.id < l.reverse && l.median === 0) {
        if (l.cls === 'main') {
          rect(l, 1, l.len - 1, -0.22, -0.08, yellow);
          rect(l, 1, l.len - 1, 0.08, 0.22, yellow);
        } else dashes(l, 0, white);
      }
      for (let k = 1; k < l.lanes; k++) dashes(l, l.median / 2 + k * l.laneW, white);
      // Stop line, and zebra crossings on the bigger streets.
      if (l.len > 16) {
        const zebra = l.cls !== 'side';
        const stopAt = zebra ? l.len - 5.2 : l.len - 0.8;
        rect(l, stopAt, stopAt + 0.45, l.median / 2 + 0.1, hw - 0.2, white);
        if (zebra && l.id < l.reverse) {
          // Across the whole carriageway at both ends of the segment.
          for (const [s0, s1] of [[l.len - 4.4, l.len - 1.2], [1.2, 4.4]] as const) {
            for (let o = -hw + 0.4; o < hw - 0.4; o += 1.1) rect(l, s0, s1, o, o + 0.55, white);
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
      const tex = kerbStripeTexture().clone();
      tex.repeat.set(Math.round(Math.PI * 2 * s.r), 1);
      tex.needsUpdate = true;
      const kerb = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 0.35, 40, 1, true), new THREE.MeshLambertMaterial({ map: tex }));
      kerb.position.set(s.x, 0.175, -s.z);
      const grass = new THREE.Mesh(new THREE.CircleGeometry(s.r, 40), new THREE.MeshLambertMaterial({ color: '#86a05a' }));
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(s.x, 0.34, -s.z);
      grass.receiveShadow = true;
      // Plinth, white column and a national flag.
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
      this.group.add(kerb, grass, plinth, col, cap, pole, flag);
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
      mats.push(place(b.x, base, -b.z, 0, b.hw * 2, b.h, b.hl * 2));
      colors.push(new THREE.Color(BUILDING_COLORS[rng.int(0, BUILDING_COLORS.length - 1)]).multiplyScalar(rng.range(0.92, 1.05)));
      const top = base + b.h;
      // Roof clutter: black / blue water tanks and a stair room.
      if (rng.chance(0.7)) {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) {
          tanks.push(place(b.x + rng.range(-b.hw + 1.2, b.hw - 1.2), top, -(b.z + rng.range(-b.hl + 1.2, b.hl - 1.2)), 0, 1, rng.range(0.9, 1.2), 1));
          tankColors.push(new THREE.Color(rng.chance(0.75) ? '#1d1f22' : '#2f6fb0'));
        }
      }
      if (rng.chance(0.5) && b.hw > 2.5 && b.hl > 2.5) {
        rooms.push(place(b.x + rng.range(-b.hw + 2, b.hw - 2), top, -(b.z + rng.range(-b.hl + 2, b.hl - 2)), 0, 2.6, 2.6, 2.6));
      }
      // Street-facing sides get shop signs and an awning over the shutters.
      const sides: Array<[number, number, number, number]> = [
        // [nx, nz, half length of side, ry]
        [1, 0, b.hl, Math.PI / 2],
        [-1, 0, b.hl, -Math.PI / 2],
        [0, 1, b.hw, Math.PI],
        [0, -1, b.hw, 0],
      ];
      for (const [nx, nz, half, ry] of sides) {
        if (half < 2.5) continue;
        const ex = nx ? b.hw : 0, ez = nz ? b.hl : 0;
        const fx = b.x + nx * ex, fz = b.z + nz * ez;
        if (!map.isRoad(fx + nx * (SIDEWALK + 1), fz + nz * (SIDEWALK + 1))) continue;
        const w = Math.min(half * 1.7, rng.range(5, 10));
        const off = rng.range(-(half - w / 2), half - w / 2) * 0.6;
        const ax = fx + nx * 0.06 + (nz ? off : 0), az = fz + nz * 0.06 + (nx ? off : 0);
        signs[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(ax, base + 3.15, -az, ry, w, w / 4.6 + 0.2, 1));
        if (rng.chance(0.6)) {
          awnings.push(place(fx + nx * 0.7, base + 2.55, -(fz + nz * 0.7), ry, half * 1.8, 0.1, 1.4));
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
      if (l.len < 20) continue;
      const off = halfWidth(l.cls) + 0.7;
      let prev: V3 | null = null;
      for (let s = 5; s < l.len - 4; s += rng.range(22, 30)) {
        const p = map.linkPoint(l, s, off);
        const top: V3 = [p.x, KERB_H + H, -p.z];
        poles.push(place(p.x, KERB_H, -p.z, l.heading));
        if (prev) for (let k = 0; k < 3; k++) sagLine([prev[0], prev[1] - 0.35 * k, prev[2]], [top[0], top[1] - 0.35 * k, top[2]], rng.range(0.4, 0.9));
        // Now and then a wire straight across the street to the far facade.
        if (rng.chance(0.3)) {
          const far = map.linkPoint(l, s + rng.range(-4, 4), -(halfWidth(l.cls) + SIDEWALK));
          sagLine([top[0], top[1] - 0.2, top[2]], [far.x, KERB_H + rng.range(5.5, 7.5), -far.z], rng.range(0.6, 1.3));
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

  /** Bare dirt construction yards with a site board. */
  private yards(map: CityMap): void {
    const q = new Quads();
    for (const y of map.yards) q.flat(y, KERB_H + 0.012, 1 / 4);
    if (q.empty) return;
    const m = new THREE.Mesh(q.build(), new THREE.MeshLambertMaterial({ map: dirtTexture(), color: '#d9bf8f', polygonOffset: true, polygonOffsetFactor: -1 }));
    m.receiveShadow = true;
    this.group.add(m);
    for (const y of map.yards) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), new THREE.MeshLambertMaterial({ map: signTexture(['KMC ROAD WORKS', 'KAAM JAARI HAI'], '#f9a825', '#1b1b1b', 512, 192), side: THREE.DoubleSide }));
      board.position.set((y.x0 + y.x1) / 2, KERB_H + 3.2, -(y.z0 + 1.2));
      const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6);
      const postMat = new THREE.MeshLambertMaterial({ color: '#555' });
      for (const dx of [-2.2, 2.2]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(board.position.x + dx, KERB_H + 1.6, board.position.z);
        this.group.add(post);
      }
      this.group.add(board);
    }
  }

  /** Wedge ramps: steel kickers with hazard stripes on the street, packed dirt in the yard. */
  private ramps(map: CityMap, shadow: boolean): void {
    const tops = new Quads();
    const sides = new Quads();
    const steel = new THREE.Color('#b3ada2');
    const dirt = new THREE.Color('#b08a5a');
    const inYard = (x: number, z: number) => map.yards.some((y) => x > y.x0 && x < y.x1 && z > y.z0 && z < y.z1);
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

  /** Neem trees on the medians and round the Empress Market plaza. */
  private trees(map: CityMap, shadow: boolean): void {
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const crownColors: THREE.Color[] = [];
    const rng = new Rng(31);
    const add = (x: number, z: number) => {
      const s = rng.range(0.8, 1.25);
      trunks.push(place(x, KERB_H, -z, 0, s, s, s));
      crowns.push(place(x, KERB_H + 3.6 * s, -z, rng.range(0, 6), s * rng.range(0.9, 1.2), s, s * rng.range(0.9, 1.2)));
      crownColors.push(new THREE.Color().setHSL(rng.range(0.22, 0.28), 0.35, rng.range(0.3, 0.38)));
    };
    for (const md of map.medians) {
      const alongX = md.x1 - md.x0 > md.z1 - md.z0;
      const len = alongX ? md.x1 - md.x0 : md.z1 - md.z0;
      for (let t = 6; t < len - 4; t += rng.range(14, 22)) add(alongX ? md.x0 + t : (md.x0 + md.x1) / 2, alongX ? (md.z0 + md.z1) / 2 : md.z0 + t);
    }
    for (const l of map.landmarks) {
      const r = l.rect;
      for (let z = r.z0 - 4; z <= r.z1 + 4; z += 9) add(r.x1 + 3.5, z);
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
