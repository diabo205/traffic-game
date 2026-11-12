import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../sim/rng';
import { elevationAt, sampleRoad, ZONES } from '../sim/road';
import { paint, StripBuilder } from './strip';
import type { XFn } from './strip';
import { kerbStripeTexture, signTexture, tollBoardTexture } from './textures';

/**
 * Corridor dressing for the Lyari Expressway (river channel, toll plaza,
 * crescent street lights) and Shahrah-e-Faisal (planted median, pedestrian
 * bridges with hoardings). Render-only.
 */

const LYARI = ZONES[1];
const FAISAL = ZONES[2];

/** The dry Lyari river runs below the deck on the left (sim x < 0). */
export const RIVER_Z0 = LYARI.start + 160;
export const RIVER_Z1 = LYARI.end + 20;
const RIVER_WIDTH = 64;
const BANK_H = 2.6;

/** Toll plaza on the on-ramp, before the climb. */
export const TOLL_Z = LYARI.start + 25;
/** Pedestrian bridges with ad hoardings over Shahrah-e-Faisal. */
export const FOOTBRIDGES: readonly number[] = [3110, 3905];
/** Median becomes a low planted kerb once the road is back at grade. */
export const PLANTER_Z = FAISAL.start + 180;

const outerLeft: XFn = (z) => {
  const r = sampleRoad(z);
  return r.left - r.shoulder - 0.3;
};
const farEdge: XFn = (z) => {
  const r = sampleRoad(z);
  return r.right + 1.4 + (r.right - r.left);
};
export const riverNear: XFn = (z) => outerLeft(z) - 7;
export const riverFar: XFn = (z) => riverNear(z) - RIVER_WIDTH;

/** True if a building footprint (centre x, half-depth) would sit in the riverbed. */
export function inRiver(x: number, halfD: number, z0: number, z1: number): boolean {
  if (z1 < RIVER_Z0 - 10 || z0 > RIVER_Z1 + 10) return false;
  const z = (z0 + z1) / 2;
  return x + halfD > riverFar(z) - 3 && x - halfD < riverNear(z) + 1;
}

const lam = (color: THREE.ColorRepresentation, map?: THREE.Texture) => new THREE.MeshLambertMaterial({ color, map: map ?? null });

function add(group: THREE.Object3D, geos: THREE.BufferGeometry[], mat: THREE.Material, castShadow: boolean): void {
  if (!geos.length) return;
  const g = mergeGeometries(geos);
  if (!g) return;
  const m = new THREE.Mesh(g, mat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  group.add(m);
}

export function buildCorridors(group: THREE.Group, lowSpec: boolean): void {
  const shadow = !lowSpec;
  buildRiver(group);
  buildTollPlaza(group, shadow);
  buildCrescentLights(group);
  buildPlanter(group, lowSpec);
  for (const z of FOOTBRIDGES) buildFootbridge(group, z, shadow);
}

// ---- Lyari river: silt bed, a thin dark stream, concrete bank walls --------------

function buildRiver(group: THREE.Group): void {
  const bed = new StripBuilder();
  const silt = new THREE.Color('#9e9483');
  const siltDark = new THREE.Color('#857b6a');
  bed.flat(riverFar, riverNear, () => -0.035, RIVER_Z0, RIVER_Z1, (z) => (Math.sin(z * 0.05) > 0.3 ? siltDark : silt), 0.1, 0.05, 8);
  const bedMesh = new THREE.Mesh(bed.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  bedMesh.receiveShadow = true;
  group.add(bedMesh);

  // Meandering trickle of black water, with green scum at the edges.
  const mid: XFn = (z) => (riverNear(z) + riverFar(z)) / 2 + Math.sin(z / 110) * 16 + Math.sin(z / 37) * 3;
  const half: XFn = (z) => 4 + Math.sin(z / 53) * 2;
  const scum = new StripBuilder();
  scum.flat((z) => mid(z) - half(z) - 1.6, (z) => mid(z) + half(z) + 1.6, () => -0.03, RIVER_Z0, RIVER_Z1, () => new THREE.Color('#5f6b47'), 0.1, 0.05, 8);
  const scumMesh = new THREE.Mesh(scum.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  scumMesh.receiveShadow = true;
  group.add(scumMesh);
  const water = new StripBuilder();
  water.flat((z) => mid(z) - half(z), (z) => mid(z) + half(z), () => -0.025, RIVER_Z0, RIVER_Z1, () => new THREE.Color('#2d3330'), 0.1, 0.05, 8);
  group.add(new THREE.Mesh(water.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: '#8a9a9a' })));

  // Vertical retaining walls lining both banks.
  const walls = new StripBuilder();
  const conc = new THREE.Color('#bdb6a8');
  const top = () => BANK_H;
  const bot = () => -0.04;
  const nearOuter: XFn = (z) => riverNear(z) + 0.5;
  const farOuter: XFn = (z) => riverFar(z) - 0.5;
  walls.wall(riverNear, bot, top, RIVER_Z0, RIVER_Z1, conc, -1, 8);
  walls.wall(nearOuter, bot, top, RIVER_Z0, RIVER_Z1, conc, 1, 8);
  walls.flat(riverNear, nearOuter, top, RIVER_Z0, RIVER_Z1, () => conc, 1, 1, 8);
  walls.wall(riverFar, bot, top, RIVER_Z0, RIVER_Z1, conc, 1, 8);
  walls.wall(farOuter, bot, top, RIVER_Z0, RIVER_Z1, conc, -1, 8);
  walls.flat(farOuter, riverFar, top, RIVER_Z0, RIVER_Z1, () => conc, 1, 1, 8);
  const wallMesh = new THREE.Mesh(walls.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // Litter and debris dumped on the silt.
  const rng = new Rng(808);
  const junk: THREE.BufferGeometry[] = [];
  const COLS = ['#d8d4cc', '#3b6fb0', '#c94f3a', '#2a2a2a', '#7a8a5a'];
  for (let i = 0; i < 260; i++) {
    const z = rng.range(RIVER_Z0, RIVER_Z1);
    const x = rng.range(riverFar(z) + 1, riverNear(z) - 1);
    const s = rng.range(0.3, 1.4);
    const g = new THREE.BoxGeometry(s, s * rng.range(0.15, 0.4), s * rng.range(0.6, 1.4));
    g.rotateY(rng.range(0, 3));
    g.translate(x, 0.05, -z);
    paint(g, COLS[rng.int(0, COLS.length - 1)]);
    junk.push(g);
  }
  add(group, junk, new THREE.MeshLambertMaterial({ vertexColors: true }), false);
}

// ---- Toll plaza: white canopy, booths on the islands, rate board -------------------

function buildTollPlaza(group: THREE.Group, shadow: boolean): void {
  const z = TOLL_Z;
  const y = elevationAt(z);
  const r = sampleRoad(z);
  const x0 = r.left - r.shoulder - 3.5;
  const x1 = farEdge(z) + 3.5;
  const H = 6.2, depth = 16;
  const white = lam('#f2f2ee');
  const steel: THREE.BufferGeometry[] = [];
  // Canopy slab with a space-frame grid underneath.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.9, depth), white);
  slab.position.set((x0 + x1) / 2, y + H + 0.45, -z);
  slab.castShadow = shadow;
  group.add(slab);
  for (let x = x0 + 1; x < x1; x += 2.5) steel.push(new THREE.BoxGeometry(0.08, 0.5, depth - 0.4).translate(x, y + H - 0.2, -z));
  for (let dz = -depth / 2 + 1; dz < depth / 2; dz += 2.5) steel.push(new THREE.BoxGeometry(x1 - x0 - 0.4, 0.08, 0.08).translate((x0 + x1) / 2, y + H - 0.4, -z + dz));
  // Columns on the outer verge, the median and the far side.
  const cols = [x0 + 1.5, r.right + 0.7, x1 - 1.5];
  for (const x of cols) for (const dz of [-5, 5]) steel.push(new THREE.CylinderGeometry(0.28, 0.28, H, 8).translate(x, y + H / 2, -z + dz));
  add(group, steel, lam('#d9dcdf'), shadow);

  // Blue fascia with the expressway name, both faces.
  const fascia = signTexture(['LYARI EXPRESSWAY · TOLL PLAZA', 'لیاری ایکسپریس وے'], '#123f8c', '#ffffff', 1024, 128);
  for (const s of [1, -1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(30, x1 - x0 - 2), 1.6), lam('#ffffff', fascia));
    f.position.set((x0 + x1) / 2 - 3, y + H + 0.5, -z + s * (depth / 2 + 0.03));
    if (s < 0) f.rotation.y = Math.PI;
    group.add(f);
  }

  // Booths: one on the kerbside island, one on the median.
  const boothBody = lam('#f4f4f0');
  const boothBand = lam('#1f56b8');
  const glass = lam('#34495a');
  for (const [bx, w] of [[r.left - r.shoulder - 1.5, 1.8], [r.right + 0.7, 1.2]] as const) {
    const b = new THREE.Group();
    b.position.set(bx, y + 0.3, -z);
    group.add(b);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 3), boothBody);
    body.position.y = 1.2;
    body.castShadow = shadow;
    b.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.35, 3.06), boothBand);
    band.position.y = 2.2;
    b.add(band);
    const win = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.9, 1.8), glass);
    win.position.y = 1.5;
    b.add(win);
    // Island under the booth: painted kerb.
    const island = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, 9), lam('#ffffff', kerbStripeTexture()));
    island.position.y = -0.15;
    b.add(island);
  }
  // Barrier arm (raised) and the rate board on the verge.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.4, 0.1), lam('#ffffff', kerbStripeTexture()));
  arm.position.set(r.left - r.shoulder - 0.4, y + 2.6, -z + 2.6);
  arm.rotation.z = -0.25;
  group.add(arm);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2), lam('#ffffff', tollBoardTexture()));
  board.position.set(x0 + 0.5, y + 2.2, -z + depth / 2 + 6);
  board.rotation.y = 0.45;
  group.add(board);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), lam('#8d9196'));
  post.position.set(x0 + 0.5, y + 0.7, -z + depth / 2 + 6);
  group.add(post);
}

// ---- Crescent-moon street lights on the expressway median ---------------------------

function buildCrescentLights(group: THREE.Group): void {
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 10, 6).translate(0, 5, 0);
  const parts: THREE.BufferGeometry[] = [pole];
  // A 3/4 arc curling out over each carriageway like a crescent moon,
  // with the lamp hanging from its tip.
  const arc = new THREE.TorusGeometry(1.25, 0.07, 4, 14, Math.PI * 1.15);
  arc.rotateZ(Math.PI * -0.15);
  arc.translate(1.25, 10, 0);
  const lamp = new THREE.BoxGeometry(0.28, 0.14, 0.55).translate(2.36, 9.36, 0);
  for (const s of [1, -1]) {
    const a = arc.clone();
    const l = lamp.clone();
    if (s < 0) {
      a.rotateY(Math.PI);
      l.rotateY(Math.PI);
    }
    parts.push(a, l);
  }
  parts.forEach((g, i) => paint(g, i === 2 || i === 4 ? '#f1eedc' : '#a7acb2'));
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  if (!geo) return;
  const mats: THREE.Matrix4[] = [];
  const d = new THREE.Object3D();
  for (let z = LYARI.start + 20; z < LYARI.end + 120; z += 45) {
    const r = sampleRoad(z);
    d.position.set(r.right + 0.7, elevationAt(z) + 0.85, -z);
    d.updateMatrix();
    mats.push(d.matrix.clone());
  }
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), mats.length);
  mats.forEach((mm, i) => m.setMatrixAt(i, mm));
  group.add(m);
}

/** True where Environment should skip its standard twin-arm lights. */
export function hasCrescentLight(z: number): boolean {
  return z >= LYARI.start && z < LYARI.end + 120;
}

// ---- Shahrah-e-Faisal median: grass, bougainvillea ---------------------------------------

function buildPlanter(group: THREE.Group, lowSpec: boolean): void {
  const end = FAISAL.end + 150;
  const grass = new StripBuilder();
  const top: XFn = (z) => elevationAt(z) + 0.36;
  grass.flat((z) => sampleRoad(z).right + 0.16, (z) => sampleRoad(z).right + 1.24, top, PLANTER_Z, end, (z) => (Math.sin(z * 0.7) > 0 ? new THREE.Color('#6f9a45') : new THREE.Color('#7ea84f')), 1, 1);
  const gm = new THREE.Mesh(grass.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  gm.receiveShadow = true;
  group.add(gm);

  const rng = new Rng(515);
  const bush = new THREE.IcosahedronGeometry(0.55, 0);
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const PAL = ['#c2185b', '#d81b60', '#e05a9a', '#4f8a3a', '#b0306a'];
  const d = new THREE.Object3D();
  for (let z = PLANTER_Z + 2; z < end; z += rng.range(1.6, lowSpec ? 5 : 3)) {
    const r = sampleRoad(z);
    const s = rng.range(0.6, 1.05);
    d.position.set(r.right + 0.7 + rng.range(-0.15, 0.15), elevationAt(z) + 0.36 + s * 0.3, -z);
    d.scale.set(s, s * 0.8, s * 1.2);
    d.rotation.set(0, rng.range(0, 3), 0);
    d.updateMatrix();
    mats.push(d.matrix.clone());
    cols.push(new THREE.Color(PAL[rng.int(0, PAL.length - 1)]));
  }
  const m = new THREE.InstancedMesh(bush, new THREE.MeshLambertMaterial({ flatShading: true }), mats.length);
  mats.forEach((mm, i) => {
    m.setMatrixAt(i, mm);
    m.setColorAt(i, cols[i]);
  });
  m.receiveShadow = true;
  group.add(m);
}

// ---- Steel-truss pedestrian bridge carrying a full-width hoarding -------------------------

const HOARDINGS: ReadonlyArray<{ lines: string[]; bg: string; fg: string }> = [
  { lines: ['SEA BREEZE RESIDENCY', 'BOOKINGS OPEN · EASY INSTALMENTS'], bg: '#0d47a1', fg: '#ffffff' },
  { lines: ['KADAK CHAI · SINCE 1972', 'کڑک چائے'], bg: '#f9a825', fg: '#3e2723' },
];

function buildFootbridge(group: THREE.Group, z: number, shadow: boolean): void {
  const y = elevationAt(z);
  const r = sampleRoad(z);
  const x0 = r.left - r.shoulder - 4;
  const x1 = farEdge(z) + 4;
  const deckY = y + 5.6, trussH = 2.2, depth = 2.4;
  const len = x1 - x0, cx = (x0 + x1) / 2;
  const steel: THREE.BufferGeometry[] = [];
  steel.push(new THREE.BoxGeometry(len, 0.25, depth).translate(cx, deckY, -z));
  for (const s of [-1, 1]) {
    const zz = -z + s * (depth / 2);
    steel.push(new THREE.BoxGeometry(len, 0.18, 0.18).translate(cx, deckY + trussH, zz));
    for (let x = x0; x <= x1 + 0.01; x += 2.4) steel.push(new THREE.BoxGeometry(0.14, trussH, 0.14).translate(x, deckY + trussH / 2, zz));
  }
  steel.push(new THREE.BoxGeometry(len, 0.1, depth).translate(cx, deckY + trussH, -z));
  // Columns on the verge, median and far side.
  for (const x of [x0 + 0.6, r.right + 0.7, x1 - 0.6]) {
    steel.push(new THREE.BoxGeometry(0.45, deckY - y, 0.45).translate(x, y + (deckY - y) / 2, -z));
  }
  // Stair flight down the left verge (parallel to the road).
  const run = 9;
  const stair = new THREE.BoxGeometry(1.4, 0.25, Math.hypot(run, deckY - y));
  stair.rotateX(-Math.atan2(deckY - y, run));
  stair.translate(x0 + 0.8, y + (deckY - y) / 2, -z + depth / 2 + run / 2);
  steel.push(stair);
  add(group, steel, lam('#5f6a72'), shadow);

  // Hoarding panels on both faces.
  const h = HOARDINGS[FOOTBRIDGES.indexOf(z) % HOARDINGS.length];
  const tex = signTexture(h.lines, h.bg, h.fg, 1024, 128);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len - 2, 34), trussH + 0.3), lam('#ffffff', tex));
    p.position.set(cx - 2, deckY + trussH / 2, -z + s * (depth / 2 + 0.12));
    if (s < 0) p.rotation.y = Math.PI;
    group.add(p);
  }
}
