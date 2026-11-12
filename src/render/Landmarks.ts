import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FINISH_Z, sampleRoad } from '../sim/road';
import { corridorEdges, FOOTPATH_W } from './Saddar';
import { clockFaceTexture, gothicWallTexture, kerbStripeTexture, mazarFaceTexture, signTexture } from './textures';

/**
 * Low-poly Karachi landmarks placed along the route. Render-only.
 * Stylised, not survey-accurate: proportions are tuned to read at speed.
 */

/** Stretches where procedural buildings must not be generated. */
export interface Exclusion {
  side: -1 | 1 | 0; // 0 = both sides
  z0: number;
  z1: number;
}

export const EMPRESS_Z = 430;
export const MAZAR_Z = 700;
export const FLYOVERS: ReadonlyArray<{ z: number; name: string }> = [
  { z: 3262, name: 'KARSAZ FLYOVER' },
  { z: 3655, name: 'FTC FLYOVER' },
];

export const EXCLUSIONS: readonly Exclusion[] = [
  { side: -1, z0: EMPRESS_Z - 42, z1: EMPRESS_Z + 42 },
  { side: 1, z0: MAZAR_Z - 105, z1: MAZAR_Z + 105 },
  ...FLYOVERS.map((f) => ({ side: 0 as const, z0: f.z - 14, z1: f.z + 14 })),
];

export function excluded(side: -1 | 1, z0: number, z1: number): boolean {
  return EXCLUSIONS.some((e) => (e.side === 0 || e.side === side) && z1 > e.z0 && z0 < e.z1);
}

const lam = (color: THREE.ColorRepresentation, map?: THREE.Texture) =>
  new THREE.MeshLambertMaterial({ color, map: map ?? null });

function mesh(group: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function tiled(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

export function buildLandmarks(group: THREE.Group, lowSpec: boolean): void {
  buildEmpressMarket(group, !lowSpec);
  buildMazar(group, !lowSpec);
  for (const f of FLYOVERS) buildFlyover(group, f.z, f.name, !lowSpec);
  buildTeenTalwar(group, !lowSpec);
}

// ---- Empress Market (Saddar, left side) -----------------------------------------

function buildEmpressMarket(group: THREE.Group, shadow: boolean): void {
  const g = new THREE.Group();
  group.add(g);
  const face = corridorEdges(EMPRESS_Z).left - FOOTPATH_W - 1.5; // street facade x
  const depth = 26, len = 72, h = 12;
  const cx = face - depth / 2;
  const zc = -EMPRESS_Z;
  const stone = lam('#d6b06a');
  const darkStone = lam('#b8914f');
  const wall = gothicWallTexture();

  // Hall body + gothic facades.
  mesh(g, new THREE.BoxGeometry(depth, h, len), stone, cx, h / 2, zc, shadow);
  const front = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(wall, len / 12, 1)), face + 0.02, h / 2, zc, false);
  front.rotation.y = Math.PI / 2;
  for (const s of [-1, 1]) {
    const end = mesh(g, new THREE.PlaneGeometry(depth, h), lam('#ffffff', tiled(wall, depth / 12, 1)), cx, h / 2, zc + s * (len / 2 + 0.02), false);
    end.rotation.y = s > 0 ? 0 : Math.PI;
  }
  // Pitched roof ridge.
  const roof = new THREE.CylinderGeometry(depth * 0.36, depth * 0.36, len - 2, 3);
  roof.rotateX(Math.PI / 2);
  roof.rotateZ(Math.PI / 2);
  roof.scale(1, 0.55, 1);
  mesh(g, roof, lam('#9c7a52'), cx, h + 2.2, zc, shadow);
  // Crenellated parapet along the street.
  const merlons: THREE.BufferGeometry[] = [];
  for (let z = -len / 2 + 0.8; z < len / 2; z += 1.8) merlons.push(new THREE.BoxGeometry(0.7, 1.0, 0.9).translate(face - 0.3, h + 0.5, zc + z));
  const merged = mergeGeometries(merlons);
  if (merged) mesh(g, merged, darkStone, 0, 0, 0, false);
  // Corner turrets with pyramid caps.
  for (const z of [-len / 2, len / 2]) {
    for (const x of [face - 1.2, face - depth + 1.2]) {
      mesh(g, new THREE.BoxGeometry(2.6, h + 4, 2.6), darkStone, x, (h + 4) / 2, zc + z, shadow);
      const cap = new THREE.ConeGeometry(2.0, 3.2, 4);
      cap.rotateY(Math.PI / 4);
      mesh(g, cap, lam('#8a6a40'), x, h + 4 + 1.6, zc + z, shadow);
    }
  }

  // Clock tower over the main entrance.
  const tx = face - 4.5, tH = 30;
  const shaft = mesh(g, new THREE.BoxGeometry(8, tH, 8), lam('#ffffff', tiled(wall, 0.66, 2.5)), tx, tH / 2, zc, shadow);
  void shaft;
  mesh(g, new THREE.BoxGeometry(9, 1.2, 9), darkStone, tx, tH + 0.6, zc, shadow);
  const clock = lam('#ffffff', clockFaceTexture());
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const c = mesh(g, new THREE.PlaneGeometry(3.4, 3.4), clock, tx + Math.sin(a) * 4.05, tH - 3.5, zc + Math.cos(a) * 4.05, false);
    c.rotation.y = a;
  }
  // Open belfry: four corner piers + cornice.
  for (const dx of [-3.4, 3.4]) for (const dz of [-3.4, 3.4]) mesh(g, new THREE.BoxGeometry(1.2, 6, 1.2), stone, tx + dx, tH + 4.2, zc + dz, shadow);
  mesh(g, new THREE.BoxGeometry(8.6, 1, 8.6), darkStone, tx, tH + 7.6, zc, shadow);
  const spire = new THREE.ConeGeometry(5.8, 11, 4);
  spire.rotateY(Math.PI / 4);
  mesh(g, spire, lam('#9c7a52'), tx, tH + 8.1 + 5.5, zc, shadow);
  for (const dx of [-3.8, 3.8]) for (const dz of [-3.8, 3.8]) mesh(g, new THREE.ConeGeometry(0.5, 3, 4), darkStone, tx + dx, tH + 9.6, zc + dz, false);
}

// ---- Mazar-e-Quaid (white marble mausoleum in its park, right side) ---------------

function buildMazar(group: THREE.Group, shadow: boolean): void {
  const g = new THREE.Group();
  group.add(g);
  const edge = corridorEdges(MAZAR_Z).right + FOOTPATH_W;
  const cx = edge + 78;
  const zc = -MAZAR_Z;
  const marble = lam('#f6f5f0');

  // Park lawn and the boundary wall with green railings along the road.
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(190, 205), lam('#8aa063'));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(edge + 95, -0.03, zc);
  lawn.receiveShadow = true;
  g.add(lawn);
  mesh(g, new THREE.BoxGeometry(0.4, 0.8, 205), lam('#efeee8'), edge + 0.3, 0.4, zc, false);
  const rails: THREE.BufferGeometry[] = [];
  for (let z = -100; z <= 100; z += 0.9) rails.push(new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(edge + 0.3, 1.35, zc + z));
  rails.push(new THREE.BoxGeometry(0.08, 0.08, 205).translate(edge + 0.3, 1.9, zc));
  const railGeo = mergeGeometries(rails);
  if (railGeo) mesh(g, railGeo, lam('#1e1f20'), 0, 0, 0, false); // black wrought-iron spears
  // Approach avenue of palms is suggested by a pale path.
  const path = new THREE.Mesh(new THREE.PlaneGeometry(60, 10), lam('#e8e2d2'));
  path.rotation.x = -Math.PI / 2;
  path.position.set(edge + 30, -0.02, zc);
  g.add(path);

  // Terraced platform.
  mesh(g, new THREE.BoxGeometry(66, 2, 66), marble, cx, 1, zc, shadow);
  mesh(g, new THREE.BoxGeometry(58, 1.4, 58), marble, cx, 2.7, zc, shadow);
  // Main cube with a tall pointed arch on every face.
  const H = 22, W = 36, base = 3.4;
  mesh(g, new THREE.BoxGeometry(W, H, W), marble, cx, base + H / 2, zc, shadow);
  const arch = lam('#ffffff', mazarFaceTexture());
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const p = mesh(g, new THREE.PlaneGeometry(W, H), arch, cx + Math.sin(a) * (W / 2 + 0.03), base + H / 2, zc + Math.cos(a) * (W / 2 + 0.03), false);
    p.rotation.y = a;
  }
  mesh(g, new THREE.BoxGeometry(W + 1.2, 1.2, W + 1.2), marble, cx, base + H + 0.6, zc, shadow);
  // Drum, dome and finial.
  const domeBase = base + H + 1.2;
  mesh(g, new THREE.CylinderGeometry(13.5, 14.5, 4, 24), marble, cx, domeBase + 2, zc, shadow);
  const dome = new THREE.SphereGeometry(13.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 1.3, 1);
  mesh(g, dome, marble, cx, domeBase + 4, zc, shadow);
  mesh(g, new THREE.CylinderGeometry(0.25, 0.4, 3.2, 6), lam('#c9b77a'), cx, domeBase + 4 + 13.5 * 1.3 + 1.4, zc, false);
  mesh(g, new THREE.SphereGeometry(0.55, 8, 6), lam('#c9b77a'), cx, domeBase + 4 + 13.5 * 1.3 + 3.2, zc, false);
}

// ---- Flyovers crossing Shahrah-e-Faisal ----------------------------------------------

function buildFlyover(group: THREE.Group, zc: number, name: string, shadow: boolean): void {
  const H = 7.8, thick = 1.3, halfW = 6.5;
  const xL = -150, xR = 170, flatL = -55, flatR = 75;
  const height = (x: number) => {
    if (x < flatL) return H * Math.max(0, (x - xL) / (flatL - xL));
    if (x > flatR) return H * Math.max(0, (xR - x) / (xR - flatR));
    return H;
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const z0 = -zc - halfW, z1 = -zc + halfW;
  for (let x = xL; x < xR; x += 5) {
    const x2 = x + 5;
    const h1 = height(x), h2 = height(x2);
    const b1 = Math.max(0, h1 - thick), b2 = Math.max(0, h2 - thick);
    quad([x, h1, z1], [x2, h2, z1], [x2, h2, z0], [x, h1, z0]); // deck top
    quad([x, b1, z0], [x2, b2, z0], [x2, b2, z1], [x, b1, z1]); // underside
    quad([x, b1, z1], [x2, b2, z1], [x2, h2 + 1, z1], [x, h1 + 1, z1]); // near side + parapet
    quad([x2, b2, z0], [x, b1, z0], [x, h1 + 1, z0], [x2, h2 + 1, z0]); // far side + parapet
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#c3bcae', side: THREE.DoubleSide }));
  deck.castShadow = shadow;
  deck.receiveShadow = true;
  group.add(deck);

  // Piers: verges, central median, and along the ramps.
  const road = sampleRoad(zc);
  const e = corridorEdges(zc);
  const piers = [e.left - 1.6, road.right + 0.7, e.right + 1.6, -30, -45, 50, 65];
  const pierGeos: THREE.BufferGeometry[] = [];
  for (const x of piers) {
    const h = height(x) - thick;
    if (h < 1) continue;
    pierGeos.push(new THREE.BoxGeometry(x === road.right + 0.7 ? 1.0 : 1.4, h, 3.2).translate(x, h / 2, -zc));
  }
  const pg = mergeGeometries(pierGeos);
  if (pg) {
    const m = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ color: '#b3ab9c' }));
    m.castShadow = shadow;
    group.add(m);
  }
  // Name painted on the side facing oncoming drivers.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 1.6),
    new THREE.MeshLambertMaterial({ map: signTexture([name], '#0b6e3a', '#ffffff', 768, 80) }),
  );
  sign.position.set((road.left + road.right) / 2 + 2, H - 0.3, z1 + 0.06);
  group.add(sign);
}

// ---- Teen Talwar (three swords) roundabout at the Clifton finish ------------------------

function buildTeenTalwar(group: THREE.Group, shadow: boolean): void {
  const g = new THREE.Group();
  group.add(g);
  const road = sampleRoad(FINISH_Z);
  const width = road.right - road.left;
  const x = road.right + 1.4 + width / 2; // on the (empty) opposite carriageway
  const z = -(FINISH_Z + 28);
  g.position.set(x, 0, z);
  const white = lam('#f3f2ec');

  // Roundabout island: black-and-yellow kerb ring, grass mound, red plinth.
  const ringTex = kerbStripeTexture().clone();
  ringTex.repeat.set(24, 1);
  ringTex.needsUpdate = true;
  mesh(g, new THREE.CylinderGeometry(6.3, 6.3, 0.4, 32, 1, true), new THREE.MeshLambertMaterial({ map: ringTex, side: THREE.DoubleSide }), 0, 0.2, 0, false);
  const mound = new THREE.SphereGeometry(6.2, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1, 0.18, 1);
  mesh(g, mound, lam('#6f9a45'), 0, 0.2, 0, false);
  mesh(g, new THREE.CylinderGeometry(4.4, 4.6, 0.9, 24), lam('#8e3b30'), 0, 1.25, 0, shadow);
  mesh(g, new THREE.CylinderGeometry(4.0, 4.0, 0.35, 24), lam('#a3483b'), 0, 1.85, 0, shadow);
  // Faceted marble base under each sword, pierced by a pointed arch.
  const archShape = new THREE.Shape();
  archShape.moveTo(-0.5, 0);
  archShape.lineTo(-0.5, 1.2);
  archShape.quadraticCurveTo(-0.5, 1.75, 0, 2.0);
  archShape.quadraticCurveTo(0.5, 1.75, 0.5, 1.2);
  archShape.lineTo(0.5, 0);
  const archGeo = new THREE.ShapeGeometry(archShape, 4);
  const dark = lam('#2a2723');
  const swords: Array<[number, number, number]> = [
    [-2.9, 21, 0.14],
    [0, 25, 0],
    [2.9, 21, -0.14],
  ];
  for (const [sx, len, lean] of swords) {
    const s = new THREE.Group();
    // Hexagonal, rotated so a flat face looks along the road (apothem 1.08).
    mesh(g, new THREE.CylinderGeometry(1.25, 1.25, 2.6, 6), white, sx, 3.3, 0, shadow).rotation.y = Math.PI / 6;
    for (const f of [1, -1]) {
      const a = mesh(g, archGeo, dark, sx, 2.05, f * 1.1, false);
      if (f < 0) a.rotation.y = Math.PI;
    }
    s.position.set(sx, 4.6, 0);
    s.rotation.z = lean;
    g.add(s);
    mesh(s, new THREE.SphereGeometry(0.42, 8, 6), white, 0, 0.3, 0, shadow); // pommel
    mesh(s, new THREE.CylinderGeometry(0.22, 0.28, 2.0, 8), lam('#d8d4c8'), 0, 1.5, 0, shadow); // grip
    mesh(s, new THREE.BoxGeometry(3.4, 0.5, 0.8), lam('#cfcabd'), 0, 2.7, 0, shadow); // crossguard
    const blade = new THREE.CylinderGeometry(0.05, 0.85, len, 4);
    blade.rotateY(Math.PI / 4);
    blade.scale(1, 1, 0.38);
    mesh(s, blade, lam('#e2ded2'), 0, 2.9 + len / 2, 0, shadow);
  }
}
