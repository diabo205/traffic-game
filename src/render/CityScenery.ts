import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityMap, KERB_H, SIDEWALK } from '../sim/city/cityMap';
import type { CityLink, CityMap } from '../sim/city/cityMap';
import { pointObbDistance } from '../sim/math';
import { Rng } from '../sim/rng';
import { GROUND_FLOOR_H, makeFacadeMaterial, setFacadeNight, STOREY_H } from './facadeMaterial';
import type { TimeOfDay } from './Renderer';
import { buildParkedBikeGeometry, PARKED_BIKE_COLORS } from './parkedBikes';
import { buildSaddarLandmark } from './SaddarLandmarks';
import { paint } from './strip';
import {
  asphaltTexture,
  BANNER_COUNT,
  dirtTexture,
  kerbStripeTexture,
  saddarFacadeAtlas,
  SHOP_SIGN_COUNT,
  shopSignAtlas,
  shopSignAtlasUv,
  signTexture,
  streetBannerAtlas,
  streetBannerAtlasUv,
  warmGlowTexture,
} from './textures';

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

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], shadow = false, receive = true): THREE.InstancedMesh | null {
  if (mats.length === 0) return null;
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mm, i) => m.setMatrixAt(i, mm));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.castShadow = shadow;
  m.receiveShadow = receive;
  group.add(m);
  return m;
}

/** Uniform non-indexed geometry layout for THREE.BatchedMesh. */
function prepBatchGeo(geo: THREE.BufferGeometry, withUv: boolean, paintColor?: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (withUv) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  } else {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
  }
  if (paintColor !== undefined || !g.getAttribute('color')) {
    paint(g, paintColor ?? '#ffffff');
  }
  for (const attr of Object.keys(g.attributes)) {
    if (attr !== 'position' && attr !== 'normal' && attr !== 'color' && (!withUv || attr !== 'uv')) {
      g.deleteAttribute(attr);
    }
  }
  return g;
}

function atlasQuadGeo(uv: readonly [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  const uvAttr = g.getAttribute('uv');
  const [u0, v0, u1, v1] = uv;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i, uvAttr.getX(i) > 0.5 ? u1 : u0, uvAttr.getY(i) > 0.5 ? v1 : v0);
  }
  return prepBatchGeo(g, true, '#ffffff');
}

function doubleSidedAtlasQuadGeo(uv: readonly [number, number, number, number]): THREE.BufferGeometry {
  const front = atlasQuadGeo(uv).translate(0, 0, 0.015);
  const back = atlasQuadGeo(uv).rotateY(Math.PI).translate(0, 0, -0.015);
  const merged = mergeGeometries([front, back]);
  front.dispose();
  back.dispose();
  return merged ?? atlasQuadGeo(uv);
}

interface BatchEntry {
  geo: THREE.BufferGeometry;
  mats: THREE.Matrix4[];
  cols?: THREE.Color[];
}

function addBatch(group: THREE.Group, mat: THREE.Material, entries: BatchEntry[], shadow = false, receive = true): THREE.BatchedMesh | null {
  const nonEmpty = entries.filter((e) => e.mats.length > 0);
  if (nonEmpty.length === 0) return null;
  let totalInstances = 0;
  let totalVertices = 0;
  for (const e of nonEmpty) {
    totalInstances += e.mats.length;
    totalVertices += e.geo.getAttribute('position').count;
  }
  const bm = new THREE.BatchedMesh(totalInstances, totalVertices, 0, mat);
  for (const e of nonEmpty) {
    const gid = bm.addGeometry(e.geo);
    for (let i = 0; i < e.mats.length; i++) {
      const iid = bm.addInstance(gid);
      bm.setMatrixAt(iid, e.mats[i]);
      bm.setColorAt(iid, e.cols?.[i] ?? WHITE);
    }
  }
  bm.computeBoundingBox();
  bm.computeBoundingSphere();
  bm.castShadow = shadow;
  bm.receiveShadow = receive;
  group.add(bm);
  return bm;
}

const CHUNK_SIZE = 260;

interface Chunk {
  cx: number;
  cz: number;
  group: THREE.Group;
}

interface ClutterBucket {
  group: THREE.Group;
  entries: Map<THREE.BufferGeometry, BatchEntry>;
  signs: THREE.Matrix4[][];
  banners: THREE.Matrix4[][];
  bulbs: THREE.Matrix4[];
  glows: THREE.Matrix4[];
}

/**
 * Draws the Real Saddar OSM open-city map: asphalt strips + junction caps,
 * raised pavements & Jehangir Park with road-facing kerbs, lane markings,
 * roundabouts, Empress Market, oriented buildings with shop signs, balconies,
 * overhead banners, parked motorbikes/carts, poles/wires, neem trees,
 * construction yards and ramps. Spatial 260m chunks use BatchedMesh to keep
 * draw calls low and switch smoothly to lit dusk/night signage & windows.
 */
export class CityScenery {
  readonly group = new THREE.Group();
  visibleChunks = 0;
  private chunks: Chunk[] = [];
  private chunkMap = new Map<string, Chunk>();
  private clutterBuckets = new Map<THREE.Group, ClutterBucket>();
  private occupied: Array<[number, number, number]> = [];
  private ownedGeos: THREE.BufferGeometry[] = [];
  private ownedMats: THREE.Material[] = [];
  private ownedTex: THREE.Texture[] = [];
  private facadeMat!: THREE.MeshLambertMaterial;
  private roadMat!: THREE.MeshPhongMaterial;
  private puddleMat!: THREE.MeshPhongMaterial;
  private shopSignMat!: THREE.MeshLambertMaterial;
  private bannerMat!: THREE.MeshLambertMaterial;
  private lampBulbMat!: THREE.MeshLambertMaterial;
  private warmGlowMat!: THREE.MeshBasicMaterial;
  private litProps: THREE.MeshLambertMaterial[] = [];
  private glowMeshes: THREE.InstancedMesh[] = [];

  constructor(lowSpec: boolean) {
    const map = cityMap();
    const shadow = !lowSpec;
    this.ground(map);
    this.roads(map);
    this.puddles(map);
    this.pavements(map);
    this.markings(map);
    this.islands(map, shadow);
    this.buildings(map, shadow);
    this.poles(map);
    this.trees(map, shadow);
    this.parkedClutter(map);
    this.yards(map);
    this.ramps(map, shadow);
    this.flushBatches(shadow);
    for (const l of map.landmarks) {
      const targetGroup = l.kind === 'empress' ? this.group : this.chunkFor(l.obb.x, l.obb.z);
      buildSaddarLandmark(targetGroup, l, shadow, this.litProps);
    }
  }

  private chunkFor(x: number, z: number): THREE.Group {
    const gx = Math.floor(x / CHUNK_SIZE);
    const gz = Math.floor(z / CHUNK_SIZE);
    const key = `${gx},${gz}`;
    let c = this.chunkMap.get(key);
    if (!c) {
      const group = new THREE.Group();
      c = { cx: (gx + 0.5) * CHUNK_SIZE, cz: (gz + 0.5) * CHUNK_SIZE, group };
      this.chunkMap.set(key, c);
      this.chunks.push(c);
      this.group.add(group);
    }
    return c.group;
  }

  private bucketFor(x: number, z: number): ClutterBucket {
    const group = this.chunkFor(x, z);
    let b = this.clutterBuckets.get(group);
    if (!b) {
      b = {
        group,
        entries: new Map(),
        signs: Array.from({ length: SHOP_SIGN_COUNT }, () => []),
        banners: Array.from({ length: BANNER_COUNT }, () => []),
        bulbs: [],
        glows: [],
      };
      this.clutterBuckets.set(group, b);
    }
    return b;
  }

  private pushClutter(x: number, z: number, geo: THREE.BufferGeometry, mat: THREE.Matrix4, col?: THREE.Color): void {
    const bk = this.bucketFor(x, z);
    let entry = bk.entries.get(geo);
    if (!entry) {
      entry = { geo, mats: [], cols: [] };
      bk.entries.set(geo, entry);
    }
    entry.mats.push(mat);
    entry.cols!.push(col ?? WHITE);
  }

  setTimeOfDay(tod: TimeOfDay): void {
    const night = tod === 'night' ? 0.95 : tod === 'monsoon' ? 0.68 : tod === 'sunset' ? 0.35 : 0;
    setFacadeNight(this.facadeMat, night);
    if (this.roadMat) {
      const wet = tod === 'monsoon';
      this.roadMat.color.set(wet ? '#7e868e' : '#c9c7c2');
      this.roadMat.specular.set(wet ? '#6a8298' : '#101010');
      this.roadMat.shininess = wet ? 58 : 8;
    }
    if (this.puddleMat) {
      const wet = tod === 'monsoon';
      this.puddleMat.color.set(wet ? '#3f5364' : '#65757e');
      this.puddleMat.opacity = wet ? 0.84 : 0.56;
    }
    if (this.shopSignMat) this.shopSignMat.emissiveIntensity = tod === 'night' ? 0.95 : tod === 'monsoon' ? 0.78 : tod === 'sunset' ? 0.35 : 0;
    if (this.bannerMat) this.bannerMat.emissiveIntensity = tod === 'night' ? 0.55 : tod === 'monsoon' ? 0.42 : tod === 'sunset' ? 0.2 : 0;
    if (this.lampBulbMat) this.lampBulbMat.emissiveIntensity = tod === 'night' ? 1.2 : tod === 'monsoon' ? 0.95 : tod === 'sunset' ? 0.45 : 0;
    for (const m of this.litProps) m.emissiveIntensity = tod === 'night' ? 0.65 : tod === 'monsoon' ? 0.5 : tod === 'sunset' ? 0.25 : 0;
    const showGlow = tod !== 'noon';
    if (this.warmGlowMat) this.warmGlowMat.opacity = tod === 'night' ? 0.44 : tod === 'monsoon' ? 0.38 : 0.22;
    for (const gm of this.glowMeshes) gm.visible = showGlow;
  }

  update(_time: number, x: number, z: number): void {
    let vis = 0;
    for (const c of this.chunks) {
      const on = Math.abs(c.cx - x) < 460 && Math.abs(c.cz - z) < 460;
      c.group.visible = on;
      if (on) vis++;
    }
    this.visibleChunks = vis;
  }

  dispose(): void {
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    for (const t of this.ownedTex) t.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.BatchedMesh) {
        o.dispose();
      } else if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTex = [];
    this.chunks = [];
    this.chunkMap.clear();
    this.clutterBuckets.clear();
    this.glowMeshes = [];
  }

  private ground(map: CityMap): void {
    const b = map.bounds;
    const w = Math.max(2600, b.x1 - b.x0 + 700);
    const d = Math.max(2400, b.z1 - b.z0 + 700);
    const tex = dirtTexture().clone();
    tex.repeat.set(Math.round(w / 13), Math.round(d / 13));
    tex.needsUpdate = true;
    this.ownedTex.push(tex);
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d, 48, 48),
      new THREE.MeshLambertMaterial({
        color: '#d8c39a',
        map: tex,
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
      }),
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set((b.x0 + b.x1) / 2, -0.08, -(b.z0 + b.z1) / 2);
    g.receiveShadow = true;
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
    this.roadMat = new THREE.MeshPhongMaterial({
      map: asphaltTexture(),
      color: '#c9c7c2',
      specular: '#101010',
      shininess: 8,
    });
    this.ownedMats.push(this.roadMat);
    const m = new THREE.Mesh(q.build(), this.roadMat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private puddles(map: CityMap): void {
    if (map.puddles.length === 0) return;
    const parts: THREE.BufferGeometry[] = [];
    for (const p of map.puddles) {
      const g = new THREE.CircleGeometry(1, 14);
      g.scale(p.hw, 1, p.hl);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-p.heading);
      g.translate(p.x, 0.025, -p.z);
      parts.push(g);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) return;
    this.puddleMat = new THREE.MeshPhongMaterial({
      color: '#65757e',
      specular: '#d8eeff',
      shininess: 98,
      transparent: true,
      opacity: 0.56,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.ownedMats.push(this.puddleMat);
    const mesh = new THREE.Mesh(merged, this.puddleMat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
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
    this.ownedTex.push(pave);
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
      this.ownedTex.push(tex);
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

  private canPlaceOnPavement(map: CityMap, x: number, z: number, radius: number, padRoad: number, padSolid: number): boolean {
    if (map.isRoad(x, z) || map.nearRoad(x, z, padRoad) || map.onIsland(x, z)) return false;
    for (const y of map.yards) {
      if (pointObbDistance(x, z, y) < 2.0) return false;
    }
    for (const r of map.ramps) {
      if (pointObbDistance(x, z, r) < 2.0) return false;
    }
    let hit = false;
    map.forEachSolidNear(x, z, padSolid + 2, (s) => {
      if (pointObbDistance(x, z, s) < padSolid) hit = true;
    });
    if (hit) return false;
    for (const [ox, oz, orad] of this.occupied) {
      const req = radius + orad;
      if ((x - ox) ** 2 + (z - oz) ** 2 < req * req) return false;
    }
    return true;
  }

  /** True when stepping outward across this kerb reaches another roadway before any solid building (divided median / splitter). */
  private isMedianSide(map: CityMap, l: CityLink, s: number, side: number): boolean {
    for (const d of [2.2, 3.4, 4.6, 5.8, 7.0, 8.2]) {
      const q = map.linkPoint(l, s, side * (l.hw + d));
      let hitSolid = false;
      map.forEachSolidNear(q.x, q.z, 1, (sol) => {
        if (pointObbDistance(q.x, q.z, sol) < 0.2) hitSolid = true;
      });
      if (hitSolid) return false;
      if (map.isRoad(q.x, q.z) || map.onIsland(q.x, q.z)) return true;
    }
    return false;
  }

  private buildings(map: CityMap, shadow: boolean): void {
    const awningPalette = ['#1e6fb8', '#2e7d32', '#c62828', '#f9a825', '#6a1b9a', '#00838f'].map((c) => new THREE.Color(c));
    const clothPalette = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ffffff', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'].map((c) => new THREE.Color(c));

    const facadeBuckets = new Map<THREE.Group, { mats: THREE.Matrix4[]; cols: THREE.Color[] }>();
    const fBucket = (x: number, z: number) => {
      const group = this.chunkFor(x, z);
      let b = facadeBuckets.get(group);
      if (!b) facadeBuckets.set(group, (b = { mats: [], cols: [] }));
      return b;
    };

    const tankGeo = prepBatchGeo(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 10).translate(0, 0.65, 0), false, '#ffffff');
    const roomGeo = prepBatchGeo(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), false, '#cfcac0');
    const awningRaw = new THREE.BoxGeometry(1, 1, 1);
    awningRaw.rotateX(-0.25);
    const awningGeo = prepBatchGeo(awningRaw, false, '#ffffff');

    const slab = new THREE.BoxGeometry(1, 0.14, 0.95).translate(0, 0, 0.475);
    paint(slab, '#d8d2c4');
    const parapet = new THREE.BoxGeometry(1, 0.9, 0.06).translate(0, 0.48, 0.92);
    paint(parapet, '#b7a47c');
    const rail = new THREE.BoxGeometry(1, 0.08, 0.1).translate(0, 0.94, 0.92);
    paint(rail, '#3f4341');
    const balconyMerged = mergeGeometries([slab.toNonIndexed(), parapet.toNonIndexed(), rail.toNonIndexed()]);
    const balconyGeo = balconyMerged ? prepBatchGeo(balconyMerged, false) : prepBatchGeo(new THREE.BoxGeometry(1, 0.2, 0.95).translate(0, 0, 0.475), false, '#d8d2c4');
    const clothGeo = prepBatchGeo(new THREE.BoxGeometry(1, 1, 0.035).translate(0, -0.5, 0), false, '#ffffff');
    this.ownedGeos.push(tankGeo, roomGeo, awningGeo, balconyGeo, clothGeo);

    for (const b of map.buildings) {
      const rng = new Rng(b.seed);
      const base = KERB_H;
      const ry = -b.heading;
      const s = Math.sin(b.heading), c = Math.cos(b.heading);
      const fb = fBucket(b.x, b.z);
      fb.mats.push(place(b.x, base, -b.z, ry, b.hw * 2, b.h, b.hl * 2));
      fb.cols.push(new THREE.Color(BUILDING_COLORS[rng.int(0, BUILDING_COLORS.length - 1)]).multiplyScalar(rng.range(0.92, 1.05)));

      const top = base + b.h;
      // Roof clutter: black / blue water tanks and a stair room.
      if (rng.chance(0.7)) {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) {
          const lf = rng.range(-b.hl + 1.2, b.hl - 1.2);
          const lr = rng.range(-b.hw + 1.2, b.hw - 1.2);
          const tx = b.x + lf * s + lr * c;
          const tz = b.z + lf * c - lr * s;
          this.pushClutter(tx, tz, tankGeo, place(tx, top, -tz, ry, 1, rng.range(0.9, 1.2), 1), new THREE.Color(rng.chance(0.75) ? '#1d1f22' : '#2f6fb0'));
        }
      }
      if (rng.chance(0.5) && b.hw > 2.5 && b.hl > 2.5) {
        const lf = rng.range(-b.hl + 2, b.hl - 2);
        const lr = rng.range(-b.hw + 2, b.hw - 2);
        const rx = b.x + lf * s + lr * c;
        const rz = b.z + lf * c - lr * s;
        this.pushClutter(rx, rz, roomGeo, place(rx, top, -rz, ry, 2.6, 2.6, 2.6));
      }

      // Street-facing sides: shop signs, awnings, upper balconies with hanging laundry, and sidewalk glow pools.
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
        const bk = this.bucketFor(ax, az);
        bk.signs[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(ax, base + 3.15, -az, fRy, w, w / 4.6 + 0.2, 1));
        if (b.storeys >= 2 && half >= 4 && rng.chance(0.42)) {
          const w2 = Math.min(half * 1.4, rng.range(3.6, 7.4));
          const off2 = rng.range(-(half - w2 / 2), half - w2 / 2) * 0.5;
          const ax2 = fx + nx * 0.09 - nz * off2, az2 = fz + nz * 0.09 + nx * off2;
          bk.signs[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(ax2, base + GROUND_FLOOR_H + 0.48, -az2, fRy, w2, w2 / 4.2 + 0.16, 1));
        }
        if (rng.chance(0.6)) {
          this.pushClutter(fx, fz, awningGeo, place(fx + nx * 0.7, base + 2.55, -(fz + nz * 0.7), fRy, half * 1.8, 0.1, 1.4), awningPalette[rng.int(0, awningPalette.length - 1)]);
        }
        if (rng.chance(0.55)) {
          const gx = fx + nx * 1.8 - nz * off, gz = fz + nz * 1.8 + nx * off;
          if (!map.isRoad(gx, gz) && !map.onIsland(gx, gz)) {
            bk.glows.push(place(gx, KERB_H + 0.025, -gz, 0, 7.2, 1, 7.2));
          }
        }
        if (b.storeys >= 2 && half >= 3.2 && rng.chance(0.62) && !map.isRoad(fx + nx * 1.4, fz + nz * 1.4) && !map.onIsland(fx + nx * 1.4, fz + nz * 1.4)) {
          const bLen = Math.min(half * 1.72, rng.range(Math.max(3.4, half * 0.9), half * 1.68));
          const bOff = rng.range(-(half - bLen * 0.5), half - bLen * 0.5) * 0.6;
          const bx = fx - nz * bOff, bz = fz + nx * bOff;
          for (let st = 0; st < b.storeys - 1; st++) {
            const by = base + GROUND_FLOOR_H + st * STOREY_H;
            if (by + 1.1 >= top) break;
            if (b.storeys > 3 && rng.chance(0.28)) continue;
            this.pushClutter(bx, bz, balconyGeo, place(bx, by, -bz, fRy, bLen, 1, 1));
            if (rng.chance(0.55)) {
              const pieces = rng.int(2, 4);
              for (let k = 0; k < pieces; k++) {
                const cOff = rng.range(-bLen * 0.42, bLen * 0.42);
                const cx = bx + nx * 0.98 - nz * cOff;
                const cz = bz + nz * 0.98 + nx * cOff;
                this.pushClutter(cx, cz, clothGeo, place(cx, by + 0.9, -cz, fRy, rng.range(0.36, 0.68), rng.range(0.45, 0.82), 1), clothPalette[rng.int(0, clothPalette.length - 1)]);
              }
            }
          }
        }
      }
    }

    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.facadeMat = makeFacadeMaterial(saddarFacadeAtlas());
    this.ownedGeos.push(box);
    this.ownedMats.push(this.facadeMat);
    for (const [group, fb] of facadeBuckets) {
      instanced(group, box, this.facadeMat, fb.mats, fb.cols, shadow);
    }
  }

  /** Concrete poles with wires, overhead street banners, and lit streetlamp bulbs. */
  private poles(map: CityMap): void {
    const H = 8.2;
    const shaft = new THREE.CylinderGeometry(0.1, 0.16, H, 6).translate(0, H / 2, 0);
    paint(shaft, '#a9a59b');
    const crossArm = new THREE.BoxGeometry(1.6, 0.12, 0.12).translate(0, H - 0.3, 0);
    paint(crossArm, '#8d9196');
    const lampArm = new THREE.BoxGeometry(1.5, 0.1, 0.1).translate(0.75, H - 0.05, 0);
    paint(lampArm, '#989c9f');
    const housing = new THREE.BoxGeometry(0.46, 0.1, 0.28).translate(1.42, H - 0.12, 0);
    paint(housing, '#34383c');
    const poleMerged = mergeGeometries([shaft.toNonIndexed(), crossArm.toNonIndexed(), lampArm.toNonIndexed(), housing.toNonIndexed()]);
    const poleGeo = poleMerged ? prepBatchGeo(poleMerged, false) : prepBatchGeo(shaft, false);
    this.ownedGeos.push(poleGeo);

    const wireBuckets = new Map<THREE.Group, number[]>();
    const pushWireSegment = (x: number, z: number, a: V3, b: V3, sag: number) => {
      const g = this.chunkFor(x, z);
      let wire = wireBuckets.get(g);
      if (!wire) wireBuckets.set(g, (wire = []));
      const n = 5;
      let prev = a;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
        wire.push(...prev, ...p);
        prev = p;
      }
    };

    const rng = new Rng(77);
    let bannerIdx = rng.int(0, BANNER_COUNT - 1);
    for (const l of map.links) {
      if (l.turnaround || l.len < 20) continue;
      if (map.nodes[l.from].roundabout && map.nodes[l.to].roundabout) continue;
      const sides = l.oneway ? [1, -1] : [1];
      for (const side of sides) {
        const off = side * (l.hw + 0.7);
        const poleRy = side > 0 ? -l.heading : -l.heading + Math.PI;
        let prev: V3 | null = null;
        for (let s = 5; s < l.len - 4; s += rng.range(22, 30)) {
          const p = map.linkPoint(l, s, off);
          if (!this.canPlaceOnPavement(map, p.x, p.z, 0.7, 0.35, 0.75)) {
            prev = null;
            continue;
          }
          this.occupied.push([p.x, p.z, 0.75]);
          const top: V3 = [p.x, KERB_H + H, -p.z];
          this.pushClutter(p.x, p.z, poleGeo, place(p.x, KERB_H, -p.z, poleRy));

          const bx = p.x + Math.cos(poleRy) * 1.42;
          const bz = p.z + Math.sin(poleRy) * 1.42;
          const bk = this.bucketFor(bx, bz);
          bk.bulbs.push(place(bx, KERB_H + H - 0.17, -bz, poleRy));
          const gx = p.x + Math.cos(poleRy) * 1.65;
          const gz = p.z + Math.sin(poleRy) * 1.65;
          bk.glows.push(place(gx, map.isRoad(gx, gz) ? 0.035 : KERB_H + 0.03, -gz, 0, 8.5, 1, 8.5));

          if (prev && Math.hypot(top[0] - prev[0], top[2] - prev[2]) < 42) {
            for (let k = 0; k < 3; k++) pushWireSegment(p.x, p.z, [prev[0], prev[1] - 0.35 * k, prev[2]], [top[0], top[1] - 0.35 * k, top[2]], rng.range(0.4, 0.9));
          }
          if (side > 0 && rng.chance(0.28)) {
            const far = map.linkPoint(l, s + rng.range(-3, 3), -(l.hw + SIDEWALK * 0.7));
            if (!map.isRoad(far.x, far.z)) {
              pushWireSegment(p.x, p.z, [top[0], top[1] - 0.2, top[2]], [far.x, KERB_H + rng.range(5.5, 7.5), -far.z], rng.range(0.6, 1.3));
            }
          }
          prev = top;
        }
      }

      // Overhead banners strung across roads (once per physical street).
      if ((l.oneway || l.id < l.reverse) && l.len >= 32) {
        const fracs = l.len >= 125 ? [0.28, 0.72] : [0.5];
        for (const f of fracs) {
          if (!rng.chance(0.75)) continue;
          const baseS = l.len * f;
          let chosenS: number | null = null;
          let chosenL = { x: 0, z: 0 };
          let chosenR = { x: 0, z: 0 };
          for (const ds of [0, 3.6, -3.6, 6.8, -6.8]) {
            const s = baseS + ds;
            if (s < 8 || s > l.len - 8) continue;
            const pL = map.linkPoint(l, s, l.hw + 0.7);
            const pR = map.linkPoint(l, s, -(l.hw + 0.7));
            if (map.isRoad(pL.x, pL.z) || map.isRoad(pR.x, pR.z) || map.onIsland(pL.x, pL.z) || map.onIsland(pR.x, pR.z)) continue;
            let blocked = false;
            for (const ep of [pL, pR]) {
              map.forEachSolidNear(ep.x, ep.z, 2, (sol) => {
                if (pointObbDistance(ep.x, ep.z, sol) < 0.35) blocked = true;
              });
              if (blocked) break;
              // Keep banner clear of utility poles and trees so nothing slices through the cloth.
              for (const [ox, oz] of this.occupied) {
                if ((ep.x - ox) ** 2 + (ep.z - oz) ** 2 < 2.8 * 2.8) {
                  blocked = true;
                  break;
                }
              }
              if (blocked) break;
            }
            if (!blocked) {
              chosenS = s;
              chosenL = pL;
              chosenR = pR;
              break;
            }
          }
          if (chosenS === null) continue;
          const pL = chosenL;
          const pR = chosenR;
          const span = Math.hypot(pR.x - pL.x, pR.z - pL.z);
          const w = Math.min(span - 1.2, span * 0.78);
          if (w < 4) continue;
          const cx = (pL.x + pR.x) * 0.5;
          const cz = (pL.z + pR.z) * 0.5;
          const ry = -l.heading;
          const by = 6.2;
          this.bucketFor(cx, cz).banners[bannerIdx++ % BANNER_COUNT].push(place(cx, by, -cz, ry, w, 1.05, 1));
          const ux = (pR.x - pL.x) / span, uz = -(pR.z - pL.z) / span;
          const e0: V3 = [cx - ux * (w * 0.5), by, -cz - uz * (w * 0.5)];
          const e1: V3 = [cx + ux * (w * 0.5), by, -cz + uz * (w * 0.5)];
          pushWireSegment(cx, cz, [pL.x, by + 0.25, -pL.z], [e0[0], e0[1] + 0.45, e0[2]], 0.08);
          pushWireSegment(cx, cz, [pL.x, by - 0.35, -pL.z], [e0[0], e0[1] - 0.45, e0[2]], 0.05);
          pushWireSegment(cx, cz, [e1[0], e1[1] + 0.45, e1[2]], [pR.x, by + 0.25, -pR.z], 0.08);
          pushWireSegment(cx, cz, [e1[0], e1[1] - 0.45, e1[2]], [pR.x, by - 0.35, -pR.z], 0.05);
        }
      }
    }

    const wireMat = new THREE.LineBasicMaterial({ color: '#2a2a2a' });
    this.ownedMats.push(wireMat);
    for (const [group, pts] of wireBuckets) {
      if (pts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        group.add(new THREE.LineSegments(g, wireMat));
      }
    }
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
    });
    const fBoard = new THREE.PlaneGeometry(5, 1.9).translate(0, 0, 0.02).toNonIndexed();
    const bBoard = new THREE.PlaneGeometry(5, 1.9).rotateY(Math.PI).translate(0, 0, -0.02).toNonIndexed();
    const boardGeo = mergeGeometries([fBoard, bBoard]) ?? new THREE.PlaneGeometry(5, 1.9);
    fBoard.dispose();
    bBoard.dispose();
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: '#555' });
    for (const y of map.yards) {
      const s = Math.sin(y.heading), c = Math.cos(y.heading);
      const lf = -(y.hl - 1.5);
      const bx = y.x + lf * s, bz = y.z + lf * c;
      const board = new THREE.Mesh(boardGeo, boardMat);
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
    this.ownedTex.push(tex);
    const side = new THREE.Mesh(sides.build(), new THREE.MeshLambertMaterial({ vertexColors: true, map: tex }));
    for (const m of [top, side]) {
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** Neem trees in Jehangir Park, along arterials and around the Empress Market plaza. */
  private trees(map: CityMap, _shadow: boolean): void {
    const trunkGeo = prepBatchGeo(new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0), false, '#6b5440');
    const crownGeo = prepBatchGeo(new THREE.IcosahedronGeometry(2.2, 0), false, '#ffffff');
    this.ownedGeos.push(trunkGeo, crownGeo);

    const placed: Array<[number, number]> = [];
    const rng = new Rng(31);
    const add = (x: number, z: number, minGap = 6) => {
      if (!this.canPlaceOnPavement(map, x, z, 1.0, 1.0, 1.2)) return;
      for (const [px, pz] of placed) {
        if ((x - px) ** 2 + (z - pz) ** 2 < minGap * minGap) return;
      }
      placed.push([x, z]);
      this.occupied.push([x, z, 1.4]);
      const s = rng.range(0.8, 1.25);
      this.pushClutter(x, z, trunkGeo, place(x, KERB_H, -z, 0, s, s, s));
      this.pushClutter(
        x,
        z,
        crownGeo,
        place(x, KERB_H + 3.6 * s, -z, rng.range(0, 6), s * rng.range(0.9, 1.2), s, s * rng.range(0.9, 1.2)),
        new THREE.Color().setHSL(rng.range(0.22, 0.28), 0.35, rng.range(0.3, 0.38)),
      );
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
      if (l.kind !== 'empress') continue;
      const o = l.obb;
      const s = Math.sin(o.heading), c = Math.cos(o.heading);
      const lr = o.hw + 7.5;
      for (let lf = -o.hl; lf <= o.hl; lf += 12) {
        add(o.x + lf * s + lr * c, o.z + lf * c - lr * s, 8);
      }
    }
  }

  /** Kerbside rows of parked CD-70 motorbikes and shaded fruit pushcarts. */
  private parkedClutter(map: CityMap): void {
    const bikeGeos = PARKED_BIKE_COLORS.map((tankCol) => {
      const raw = buildParkedBikeGeometry(tankCol);
      const g = prepBatchGeo(raw, false);
      raw.dispose();
      return g;
    });

    const umbrellaColors = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
    const cartGeos = umbrellaColors.map((umbCol) => {
      const parts: THREE.BufferGeometry[] = [];
      const addPart = (g: THREE.BufferGeometry, col: string) => {
        paint(g, col);
        parts.push(g.index ? g.toNonIndexed() : g);
      };
      addPart(new THREE.BoxGeometry(1.1, 0.12, 1.9).translate(0, 0.8, 0), '#8d5a2b');
      addPart(new THREE.SphereGeometry(0.75, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.7, 0.5, 1.15).translate(0, 0.86, 0), '#f57c00');
      addPart(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 8).rotateZ(Math.PI / 2).translate(0.6, 0.4, 0), '#3e2a16');
      addPart(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 8).rotateZ(Math.PI / 2).translate(-0.6, 0.4, 0), '#3e2a16');
      addPart(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4).translate(0, 1.9, 0), '#555555');
      addPart(new THREE.ConeGeometry(1.4, 0.6, 8).translate(0, 3.0, 0), umbCol);
      const merged = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      return prepBatchGeo(merged ?? new THREE.BoxGeometry(1.1, 2.0, 1.9), false);
    });

    this.ownedGeos.push(...bikeGeos, ...cartGeos);

    const rng = new Rng(505);
    for (const l of map.links) {
      if (l.turnaround || l.len < 28) continue;
      if (map.nodes[l.from].roundabout && map.nodes[l.to].roundabout) continue;
      const sides = l.oneway ? [1, -1] : [1];
      for (const side of sides) {
        let s = rng.range(10, 18);
        while (s < l.len - 10) {
          if (this.isMedianSide(map, l, s, side)) {
            s += 12;
            continue;
          }
          const roll = rng.next();
          if (roll < 0.42) {
            const count = rng.chance(0.28) ? 1 : rng.int(2, 4);
            const off = side * (l.hw + 1.38);
            for (let k = 0; k < count && s < l.len - 9; k++, s += rng.range(1.25, 1.65)) {
              if (this.isMedianSide(map, l, s, side)) continue;
              const p = map.linkPoint(l, s, off);
              if (!this.canPlaceOnPavement(map, p.x, p.z, 0.55, 0.55, 0.85)) continue;
              this.occupied.push([p.x, p.z, 0.55]);
              const bikeRy = -l.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + rng.range(-0.22, 0.22);
              this.pushClutter(p.x, p.z, bikeGeos[rng.int(0, bikeGeos.length - 1)], place(p.x, KERB_H, -p.z, bikeRy));
            }
            s += rng.range(16, 26);
          } else if (roll < 0.6) {
            const off = side * (l.hw + 1.55);
            const p = map.linkPoint(l, s, off);
            if (this.canPlaceOnPavement(map, p.x, p.z, 1.2, 0.55, 1.15)) {
              this.occupied.push([p.x, p.z, 1.2]);
              this.pushClutter(p.x, p.z, cartGeos[rng.int(0, cartGeos.length - 1)], place(p.x, KERB_H, -p.z, -l.heading + rng.range(-0.18, 0.18)));
            }
            s += rng.range(22, 34);
          } else {
            s += rng.range(18, 28);
          }
        }
      }
    }
  }

  /** Flush chunked static clutter, shop signs, banners, bulbs and night pools into BatchedMeshes. */
  private flushBatches(shadow: boolean): void {
    const signGeos = Array.from({ length: SHOP_SIGN_COUNT }, (_, i) => atlasQuadGeo(shopSignAtlasUv(i)));
    const bannerGeos = Array.from({ length: BANNER_COUNT }, (_, i) => doubleSidedAtlasQuadGeo(streetBannerAtlasUv(i)));
    const bulbGeo = new THREE.BoxGeometry(0.42, 0.14, 0.24);
    const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.ownedGeos.push(...signGeos, ...bannerGeos, bulbGeo, glowGeo);

    const clutterMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.shopSignMat = new THREE.MeshLambertMaterial({
      map: shopSignAtlas(),
      emissiveMap: shopSignAtlas(),
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
    });
    this.bannerMat = new THREE.MeshLambertMaterial({
      map: streetBannerAtlas(),
      emissiveMap: streetBannerAtlas(),
      emissive: new THREE.Color('#fff4db'),
      emissiveIntensity: 0,
    });
    this.lampBulbMat = new THREE.MeshLambertMaterial({
      color: '#e6e0cc',
      emissive: new THREE.Color('#ffcc66'),
      emissiveIntensity: 0,
    });
    this.warmGlowMat = new THREE.MeshBasicMaterial({
      map: warmGlowTexture(),
      color: '#ffc966',
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.ownedMats.push(clutterMat, this.shopSignMat, this.bannerMat, this.lampBulbMat, this.warmGlowMat);

    for (const bk of this.clutterBuckets.values()) {
      addBatch(bk.group, clutterMat, Array.from(bk.entries.values()), shadow, true);
      addBatch(
        bk.group,
        this.shopSignMat,
        bk.signs.map((mats, i) => ({ geo: signGeos[i], mats })),
        false,
        true,
      );
      addBatch(
        bk.group,
        this.bannerMat,
        bk.banners.map((mats, i) => ({ geo: bannerGeos[i], mats })),
        false,
        true,
      );
      instanced(bk.group, bulbGeo, this.lampBulbMat, bk.bulbs, undefined, false, false);
      const gm = instanced(bk.group, glowGeo, this.warmGlowMat, bk.glows, undefined, false, false);
      if (gm) {
        gm.visible = false;
        gm.renderOrder = 1;
        this.glowMeshes.push(gm);
      }
    }
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
