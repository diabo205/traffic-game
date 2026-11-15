import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../sim/rng';
import { sampleRoad } from '../sim/road';
import { GROUND_FLOOR_H, STOREY_H } from './facadeMaterial';
import { buildParkedBikeGeometry, PARKED_BIKE_COLORS } from './parkedBikes';
import { paint, StripBuilder } from './strip';
import {
  BANNER_COUNT,
  SHOP_SIGN_COUNT,
  dirtTexture,
  shopSignAtlas,
  shopSignAtlasUv,
  streetBannerAtlas,
  streetBannerAtlasUv,
} from './textures';

/**
 * Street-level clutter that makes Saddar read as Saddar: footpaths, tangled
 * overhead wires on concrete poles, banners across the road, stacked bilingual
 * shop signs, balconies with laundry, rooftop water tanks and dishes, parked
 * motorbikes, carts and people on the pavement. Render-only, instanced/batched.
 */

export const SADDAR_START = -80;
export const SADDAR_END = 1060;
/** Footpath width beyond each outer kerb. */
export const FOOTPATH_W = 3.4;
const FOOTPATH_H = 0.3;

export interface SaddarBuilding {
  x: number;
  z: number;
  /** length along the road */
  w: number;
  /** depth away from the road */
  d: number;
  h: number;
  storeys: number;
  /** -1 = left of the road, +1 = right (beyond the opposite carriageway) */
  side: -1 | 1;
}

/** x of the outer kerb on each side of the whole road corridor. */
export function corridorEdges(z: number): { left: number; right: number } {
  const r = sampleRoad(z);
  return { left: r.left - r.shoulder - 0.3, right: r.right + 1.4 + (r.right - r.left) };
}

const dummy = new THREE.Object3D();

function place(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

function instanced(
  group: THREE.Group,
  geo: THREE.BufferGeometry | null,
  mat: THREE.Material,
  mats: THREE.Matrix4[],
  colors?: THREE.Color[],
  shadow = false,
): void {
  if (!geo || mats.length === 0) return;
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mx, i) => m.setMatrixAt(i, mx));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
}

function atlasQuad(uv: readonly [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  const uvAttr = g.getAttribute('uv');
  const [u0, v0, u1, v1] = uv;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i, uvAttr.getX(i) > 0.5 ? u1 : u0, uvAttr.getY(i) > 0.5 ? v1 : v0);
  }
  return g;
}

function doubleAtlasQuad(uv: readonly [number, number, number, number]): THREE.BufferGeometry {
  const front = atlasQuad(uv).translate(0, 0, 0.015);
  const back = atlasQuad(uv).rotateY(Math.PI).translate(0, 0, -0.015);
  const merged = mergeGeometries([front, back]);
  front.dispose();
  back.dispose();
  return merged ?? atlasQuad(uv);
}

function batchedQuads(group: THREE.Group, mat: THREE.Material, geos: THREE.BufferGeometry[], lists: THREE.Matrix4[][]): void {
  let totalInstances = 0;
  let totalVertices = 0;
  for (let i = 0; i < geos.length; i++) {
    if (lists[i].length === 0) continue;
    totalInstances += lists[i].length;
    totalVertices += geos[i].getAttribute('position').count;
  }
  if (totalInstances === 0) return;
  const bm = new THREE.BatchedMesh(totalInstances, totalVertices, 0, mat);
  for (let i = 0; i < geos.length; i++) {
    if (lists[i].length === 0) continue;
    const gid = bm.addGeometry(geos[i]);
    for (const mx of lists[i]) {
      const iid = bm.addInstance(gid);
      bm.setMatrixAt(iid, mx);
    }
  }
  bm.computeBoundingBox();
  bm.computeBoundingSphere();
  group.add(bm);
}

const vcMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });

export function buildSaddar(group: THREE.Group, buildings: SaddarBuilding[], lowSpec: boolean, litMats: THREE.MeshLambertMaterial[] = []): void {
  const rng = new Rng(9090);
  const shadow = !lowSpec;

  // ---- Footpaths ------------------------------------------------------------
  const fp = new StripBuilder();
  const paving = new THREE.Color('#c4baa8');
  const top = () => FOOTPATH_H;
  fp.flat((z) => corridorEdges(z).left - FOOTPATH_W, (z) => corridorEdges(z).left, top, SADDAR_START, SADDAR_END, () => paving, 0.5, 0.5);
  fp.flat((z) => corridorEdges(z).right, (z) => corridorEdges(z).right + FOOTPATH_W, top, SADDAR_START, SADDAR_END, () => paving, 0.5, 0.5);
  const fpMesh = new THREE.Mesh(fp.build(), new THREE.MeshLambertMaterial({ map: dirtTexture(), vertexColors: true }));
  fpMesh.receiveShadow = true;
  group.add(fpMesh);

  // ---- Poles + wires ------------------------------------------------------------
  const poleGeo = (() => {
    const p = new THREE.CylinderGeometry(0.12, 0.2, 9, 4);
    p.rotateY(Math.PI / 4);
    p.translate(0, 4.5, 0);
    const arm = new THREE.BoxGeometry(1.8, 0.12, 0.12);
    arm.translate(0, 8.4, 0);
    const arm2 = new THREE.BoxGeometry(1.2, 0.1, 0.1);
    arm2.translate(0, 7.6, 0);
    [p, arm, arm2].forEach((g) => paint(g, '#a8a39a'));
    return mergeGeometries([p, arm, arm2]);
  })();
  const transformerGeo = (() => {
    const b = new THREE.BoxGeometry(0.8, 1.2, 0.7);
    b.translate(0, 6.2, 0.45);
    paint(b, '#6f7a74');
    const f = new THREE.BoxGeometry(0.9, 0.1, 0.1);
    f.translate(0, 6.9, 0.45);
    paint(f, '#3d3d3d');
    return mergeGeometries([b, f]);
  })();

  interface Pole { x: number; z: number; side: -1 | 1 }
  const poles: Pole[] = [];
  const poleMats: THREE.Matrix4[] = [];
  const transformerMats: THREE.Matrix4[] = [];
  for (const side of [-1, 1] as const) {
    for (let z = SADDAR_START + rng.range(5, 20); z < SADDAR_END; z += rng.range(24, 32)) {
      const e = corridorEdges(z);
      const x = side < 0 ? e.left - 0.6 : e.right + 0.6;
      poles.push({ x, z, side });
      poleMats.push(place(x, FOOTPATH_H, -z, rng.range(-0.04, 0.04), 1, 1, 1, rng.range(-0.03, 0.03), rng.range(-0.03, 0.03)));
      if (rng.chance(0.25)) transformerMats.push(place(x, FOOTPATH_H, -z, side < 0 ? 0 : Math.PI));
    }
  }
  instanced(group, poleGeo, vcMat(), poleMats, undefined, shadow);
  instanced(group, transformerGeo, vcMat(), transformerMats);

  // Wires: sagging polylines, all in one LineSegments.
  const wirePts: number[] = [];
  const wire = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number) => {
    const N = 8;
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
      const z = az + (bz - az) * t;
      wirePts.push(px, py, -pz, x, y, -z);
      px = x;
      py = y;
      pz = z;
    }
  };
  const top8 = FOOTPATH_H + 8.4;
  for (const side of [-1, 1] as const) {
    const list = poles.filter((p) => p.side === side);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const next = list[i + 1];
      if (next) {
        for (const off of [-0.85, 0, 0.85]) {
          const h = off === 0 ? top8 + 0.5 : top8;
          wire(p.x + off, h, p.z, next.x + off, h, next.z, rng.range(0.5, 1.1));
        }
        wire(p.x, top8 - 0.8, p.z, next.x, top8 - 0.8, next.z, rng.range(0.8, 1.6));
      }
      // Service drops into the buildings behind.
      const faceX = side < 0 ? corridorEdges(p.z).left - FOOTPATH_W - 0.6 : corridorEdges(p.z).right + FOOTPATH_W + 0.6;
      const drops = rng.int(2, 6);
      for (let k = 0; k < drops; k++) {
        wire(p.x + rng.range(-0.8, 0.8), top8 - rng.range(0, 1), p.z, faceX, rng.range(4.5, 10), p.z + rng.range(-12, 12), rng.range(0.2, 0.9));
      }
      // The tangle around the pole top.
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(0.4, 1.4);
        wire(p.x + Math.cos(a) * r, top8 - rng.range(0, 1.2), p.z + Math.sin(a) * r,
          p.x - Math.cos(a) * r * 0.6, top8 - rng.range(0, 1.2), p.z - Math.sin(a) * r * 0.6, rng.range(0.2, 0.6));
      }
    }
  }
  // Wires crossing the whole road.
  const leftPoles = poles.filter((p) => p.side < 0);
  const rightPoles = poles.filter((p) => p.side > 0);
  for (let i = 0; i < leftPoles.length; i += 2) {
    const a = leftPoles[i];
    let best = rightPoles[0];
    for (const b of rightPoles) if (Math.abs(b.z - a.z) < Math.abs(best.z - a.z)) best = b;
    if (!best) continue;
    for (let k = 0; k < rng.int(1, 3); k++) wire(a.x + 0.85, top8, a.z, best.x - 0.85, top8, best.z, rng.range(1.0, 1.8));
  }

  // ---- Banners across the road (batched on streetBannerAtlas) ------------------
  const bannerTex = streetBannerAtlas();
  const bannerMat = new THREE.MeshLambertMaterial({
    map: bannerTex,
    emissiveMap: bannerTex,
    emissive: new THREE.Color('#fff4db'),
    emissiveIntensity: 0,
  });
  litMats.push(bannerMat);
  const bannerGeos = Array.from({ length: BANNER_COUNT }, (_, i) => doubleAtlasQuad(streetBannerAtlasUv(i)));
  const bannerLists: THREE.Matrix4[][] = Array.from({ length: BANNER_COUNT }, () => []);
  let bi = rng.int(0, BANNER_COUNT - 1);
  for (let i = 1; i < leftPoles.length; i += 3) {
    const p = leftPoles[i];
    const r = sampleRoad(p.z);
    const x1 = r.right + 0.7; // median lamp post
    const span = x1 - p.x;
    const w = span * 0.72;
    const cx = (p.x + x1) / 2;
    const y = 6.3;
    bannerLists[bi++ % BANNER_COUNT].push(place(cx, y, -p.z, 0, w, 1.1, 1, 0, rng.range(-0.02, 0.02)));
    wire(p.x, y + 0.6, p.z, cx - w / 2, y + 0.5, p.z, 0.1);
    wire(cx + w / 2, y + 0.5, p.z, x1, y + 0.6, p.z, 0.1);
    wire(p.x, y - 0.4, p.z, cx - w / 2, y - 0.5, p.z, 0.05);
    wire(cx + w / 2, y - 0.5, p.z, x1, y - 0.4, p.z, 0.05);
  }
  batchedQuads(group, bannerMat, bannerGeos, bannerLists);
  bannerGeos.forEach((g) => g.dispose());

  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  group.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: '#1e1c1a' })));

  // ---- Shop signs (stacked, bilingual, batched on shopSignAtlas) --------------
  const signMats: THREE.Matrix4[][] = Array.from({ length: SHOP_SIGN_COUNT }, () => []);
  const signGeos = Array.from({ length: SHOP_SIGN_COUNT }, (_, i) => atlasQuad(shopSignAtlasUv(i)));
  const signTex = shopSignAtlas();
  const signMat = new THREE.MeshLambertMaterial({
    map: signTex,
    emissiveMap: signTex,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0,
  });
  litMats.push(signMat);
  for (const b of buildings) {
    const faceX = b.x - b.side * (b.d / 2 + 0.05);
    const ry = b.side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const w = rng.range(2.6, Math.min(b.w * 0.9, 8));
      const h = w / rng.range(3.5, 4.5);
      // First sign in the ground-floor band; the rest stacked over the windows above.
      const y = k === 0 ? GROUND_FLOOR_H - 0.55 : GROUND_FLOOR_H + 0.3 + (k - 1) * 1.4 + rng.range(0, 0.6);
      const z = b.z + rng.range(-(b.w - w) / 2, (b.w - w) / 2);
      const off = -b.side * (0.02 + k * 0.03); // avoid z-fighting between overlaps
      signMats[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(faceX + off, y, -z, ry, w, h, 1));
    }
  }
  batchedQuads(group, signMat, signGeos, signMats);
  signGeos.forEach((g) => g.dispose());

  // ---- Balconies + laundry -------------------------------------------------------
  const balconyGeo = (() => {
    const slab = new THREE.BoxGeometry(1.0, 0.16, 1);
    slab.translate(0.5, 0, 0);
    paint(slab, '#d8d2c4');
    const wall = new THREE.BoxGeometry(0.06, 0.95, 1);
    wall.translate(0.97, 0.5, 0);
    paint(wall, '#b7a47c');
    const rail = new THREE.BoxGeometry(0.1, 0.08, 1);
    rail.translate(0.97, 1.0, 0);
    paint(rail, '#3f4341');
    return mergeGeometries([slab, wall, rail]);
  })();
  const balconyMats: THREE.Matrix4[] = [];
  const clothMats: THREE.Matrix4[] = [];
  const clothCols: THREE.Color[] = [];
  const CLOTH = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ffffff', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'];
  for (const b of buildings) {
    // Nearly every Saddar block has a balcony on each upper floor.
    if (b.storeys < 2 || !rng.chance(0.85)) continue;
    const faceX = b.x - b.side * (b.d / 2);
    const ry = b.side < 0 ? 0 : Math.PI;
    const len = b.w * rng.range(0.55, 0.95);
    const zc = b.z + rng.range(-(b.w - len) / 2, (b.w - len) / 2);
    for (let s = 0; s < b.storeys; s++) {
      const y = GROUND_FLOOR_H + s * STOREY_H;
      balconyMats.push(place(faceX, y, -zc, ry, 1, 1, len));
      if (rng.chance(0.6)) {
        const pieces = rng.int(2, 5);
        for (let k = 0; k < pieces; k++) {
          const cz = zc + rng.range(-len / 2 + 0.3, len / 2 - 0.3);
          clothMats.push(place(faceX - b.side * 1.02, y + 0.55, -cz, ry, 1, rng.range(0.5, 0.9), rng.range(0.35, 0.7)));
          clothCols.push(new THREE.Color(CLOTH[rng.int(0, CLOTH.length - 1)]));
        }
      }
    }
  }
  instanced(group, balconyGeo, vcMat(), balconyMats, undefined, shadow);
  instanced(group, new THREE.BoxGeometry(0.03, 1, 1).translate(0, -0.5, 0), new THREE.MeshLambertMaterial(), clothMats, clothCols);

  // ---- Rooftops: water tanks, stair heads, dishes --------------------------------------
  const tankMats: THREE.Matrix4[] = [];
  const tankCols: THREE.Color[] = [];
  const mumtyMats: THREE.Matrix4[] = [];
  const dishMats: THREE.Matrix4[] = [];
  const TANKS = ['#1d1d1d', '#1d1d1d', '#1d1d1d', '#2d5fa8', '#e8e6df'];
  for (const b of buildings) {
    const rx = () => b.x + rng.range(-b.d / 2 + 1, b.d / 2 - 1);
    const rz = () => b.z + rng.range(-b.w / 2 + 1, b.w / 2 - 1);
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      tankMats.push(place(rx(), b.h, -rz(), 0, 1, rng.range(0.9, 1.2), 1));
      tankCols.push(new THREE.Color(TANKS[rng.int(0, TANKS.length - 1)]));
    }
    if (rng.chance(0.6)) mumtyMats.push(place(rx(), b.h, -rz(), 0, rng.range(2.2, 3), rng.range(2.4, 2.8), rng.range(2.4, 3.2)));
    if (rng.chance(0.45)) dishMats.push(place(rx(), b.h, -rz(), rng.range(0, 6.28)));
  }
  const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.35, 10).translate(0, 0.675, 0);
  instanced(group, tankGeo, new THREE.MeshLambertMaterial(), tankMats, tankCols, shadow);
  instanced(group, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#cfc6b4' }), mumtyMats, undefined, shadow);
  const dishGeo = (() => {
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4).translate(0, 0.55, 0);
    paint(pole, '#777777');
    const dish = new THREE.SphereGeometry(0.45, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.6);
    dish.rotateX(-Math.PI / 2 - 0.5);
    dish.translate(0, 1.15, 0);
    paint(dish, '#ecebe6');
    return mergeGeometries([pole, dish]);
  })();
  instanced(group, dishGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), dishMats);

  // ---- Pavement life: people, parked bikes, carts, neem trees --------------------------
  const personBody = (() => {
    const legs = new THREE.BoxGeometry(0.34, 0.8, 0.22).translate(0, 0.4, 0);
    const kameez = new THREE.BoxGeometry(0.46, 0.85, 0.28).translate(0, 1.15, 0);
    return mergeGeometries([legs, kameez]);
  })();
  const personHead = new THREE.SphereGeometry(0.13, 6, 4).translate(0, 1.72, 0);
  const bikeGeos = PARKED_BIKE_COLORS.map((c) => buildParkedBikeGeometry(c));
  const cartGeo = (() => {
    const bed = new THREE.BoxGeometry(1.1, 0.12, 1.9).translate(0, 0.8, 0);
    paint(bed, '#8d5a2b');
    const pile = new THREE.SphereGeometry(0.75, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.7, 0.5, 1.15).translate(0, 0.86, 0);
    paint(pile, '#f57c00');
    const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 8).rotateZ(Math.PI / 2).translate(0.6, 0.4, 0);
    paint(wheel, '#3e2a16');
    const wheel2 = wheel.clone().translate(-1.2, 0, 0);
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4).translate(0, 1.9, 0);
    paint(pole, '#555555');
    const umbrella = new THREE.ConeGeometry(1.4, 0.6, 8).translate(0, 3.0, 0);
    paint(umbrella, '#ffffff');
    return mergeGeometries([bed, pile, wheel, wheel2, pole, umbrella]);
  })();
  const treeGeo = (() => {
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3.2, 5).translate(0, 1.6, 0);
    paint(trunk, '#6b5a45');
    const c1 = new THREE.IcosahedronGeometry(1.9, 0).scale(1.2, 0.8, 1.2).translate(0, 4.2, 0);
    paint(c1, '#4d6b34');
    const c2 = new THREE.IcosahedronGeometry(1.4, 0).translate(0.8, 5.0, 0.4);
    paint(c2, '#5a7a3c');
    return mergeGeometries([trunk.toNonIndexed(), c1, c2]);
  })();

  const bodyMats: THREE.Matrix4[] = [];
  const bodyCols: THREE.Color[] = [];
  const headMats: THREE.Matrix4[] = [];
  const bikeLists: THREE.Matrix4[][] = PARKED_BIKE_COLORS.map(() => []);
  const cartMats: THREE.Matrix4[] = [];
  const cartCols: THREE.Color[] = [];
  const treeMats: THREE.Matrix4[] = [];
  const CLOTHES = ['#efe9dc', '#e9e4d4', '#3a6ea5', '#6b8e23', '#7a7a7a', '#2f4f4f', '#c2b280', '#8b0000', '#4a3b6b', '#d4a373'];
  const UMBRELLAS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
  for (const side of [-1, 1] as const) {
    for (let z = SADDAR_START + 5; z < SADDAR_END; z += rng.range(3, 7)) {
      const e = corridorEdges(z);
      const kerb = side < 0 ? e.left : e.right;
      // t metres from the kerb, towards the buildings.
      const across = (t: number) => (side < 0 ? kerb - t : kerb + t);
      const roll = rng.next();
      if (roll < 0.45) {
        const n = rng.chance(0.3) ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const x = across(rng.range(0.8, FOOTPATH_W - 0.3));
          const zz = z + k * 0.6;
          bodyMats.push(place(x, FOOTPATH_H, -zz, rng.range(0, 6.28)));
          bodyCols.push(new THREE.Color(CLOTHES[rng.int(0, CLOTHES.length - 1)]));
          headMats.push(place(x, FOOTPATH_H, -zz));
        }
      } else if (roll < 0.62) {
        // A kerbside group of parked CD-70 bikes spaced cleanly on the footpath.
        const n = rng.int(2, 4);
        const step = rng.range(1.3, 1.65);
        for (let k = 0; k < n; k++) {
          const idx = rng.int(0, bikeGeos.length - 1);
          bikeLists[idx].push(place(across(1.38), FOOTPATH_H, -(z + k * step), Math.PI / 2 + rng.range(-0.2, 0.2)));
        }
        z += n * step;
      } else if (roll < 0.68) {
        cartMats.push(place(across(1.45), FOOTPATH_H, -z, rng.range(-0.3, 0.3)));
        cartCols.push(new THREE.Color(UMBRELLAS[rng.int(0, UMBRELLAS.length - 1)]));
      } else if (roll < 0.72) {
        treeMats.push(place(across(1.6), FOOTPATH_H, -z, rng.range(0, 6.28), 1, rng.range(0.9, 1.2), 1));
      }
    }
  }
  instanced(group, personBody, new THREE.MeshLambertMaterial(), bodyMats, bodyCols);
  instanced(group, personHead, new THREE.MeshLambertMaterial({ color: '#8d5a3c' }), headMats);
  for (let i = 0; i < bikeGeos.length; i++) instanced(group, bikeGeos[i], vcMat(), bikeLists[i], undefined, shadow);
  instanced(group, cartGeo, vcMat(), cartMats, cartCols);
  instanced(group, treeGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), treeMats, undefined, shadow);
}
