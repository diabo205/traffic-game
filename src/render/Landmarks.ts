import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FINISH_Z, sampleRoad } from '../sim/road';
import { corridorEdges, FOOTPATH_W } from './Saddar';
import { clockFaceTexture, empressBayTexture, kerbStripeTexture, mazarGrilleTexture, mazarMarbleTexture, signTexture } from './textures';
import { archFrameGeo, gableRoofGeo, mergeByMaterial, pointedArchShape } from './landmarkKit';

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

export function buildLandmarks(group: THREE.Group, lowSpec: boolean, litMats: THREE.MeshLambertMaterial[] = []): void {
  buildEmpressMarket(group, !lowSpec, litMats);
  buildMazar(group, !lowSpec, litMats);
  for (const f of FLYOVERS) buildFlyover(group, f.z, f.name, !lowSpec, litMats);
  buildTeenTalwar(group, !lowSpec);
}

// ---- Empress Market (Saddar, left side) -----------------------------------------

function buildEmpressMarket(group: THREE.Group, shadow: boolean, litMats: THREE.MeshLambertMaterial[] = []): void {
  buildEmpressMarketAt(group, shadow, corridorEdges(EMPRESS_Z).left - FOOTPATH_W - 1.5, -EMPRESS_Z, 72, litMats);
}

/**
 * Empress Market (James Strachan, 1884–89): four two-storey wings of yellow
 * Jodhpur sandstone around an open quadrangle, Venetian/Domestic Gothic
 * shop arcades below and twin Tudor lancets above, pyramid-roofed corner
 * pavilions, and the ~140 ft clock tower over the main entrance with four
 * dials. Stalls crowd the courtyard. Street facade faces +x.
 * @param face three-space x of the street facade
 * @param zc three-space z of the hall's centre
 * @param len length along z
 */
export function buildEmpressMarketAt(
  group: THREE.Group,
  shadow: boolean,
  face: number,
  zc: number,
  len: number,
  litMats: THREE.MeshLambertMaterial[] = [],
): void {
  const g = new THREE.Group();
  g.position.set(face, 0, zc); // local: street face at x = 0, building toward -x
  group.add(g);
  const D = 26;
  const L = len;
  const stone = lam('#d3ab68');
  const dressed = lam('#ecd7a6');
  const trim = lam('#a9824a');
  const tile = lam('#8e4b32');
  const slate = lam('#5b5248');
  const dark = lam('#2a1d14');
  const iron = lam('#2b2b2b');
  const paving = lam('#cbbd9f');

  const bayMats = new Map<number, THREE.MeshLambertMaterial>();
  const bayMat = (n: number) => {
    let m = bayMats.get(n);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: '#ffffff',
        map: tiled(empressBayTexture(), n, 1),
        emissive: new THREE.Color('#ffd9a0'),
        emissiveMap: tiled(empressBayTexture(true), n, 1),
        emissiveIntensity: 0,
      });
      litMats.push(m);
      bayMats.set(n, m);
    }
    return m;
  };
  const WALL = 11;
  /** Arcaded wall face of length `w`, centred at (x, z), facing angle `a` (0 = +z, π/2 = +x). */
  const bays = (w: number, x: number, z: number, a: number) => {
    const n = Math.max(1, Math.round(w / 4.2));
    const p = mesh(g, new THREE.PlaneGeometry(w, WALL), bayMat(n), x + Math.sin(a) * 0.03, WALL / 2, z + Math.cos(a) * 0.03, false);
    p.rotation.y = a;
  };
  const E = Math.PI / 2; // facing +x (street)
  const Wd = -Math.PI / 2;

  // ---- Layout ----
  const PAV = 8; // corner pavilion size
  const frontD = 8, backD = 7, sideW = 7;
  const B = -D; // back face x
  const zN = L / 2;
  const wingLenZ = L - 2 * PAV;
  const sideLenX = D - 2 * PAV;

  // Courtyard floor
  const court = mesh(g, new THREE.PlaneGeometry(D - frontD - backD, L - 2 * sideW), paving, (B + backD - frontD) / 2, 0.04, 0, false);
  court.rotation.x = -Math.PI / 2;

  // ---- Wings: front & back (along z), sides (along x) ----
  const wing = (cx: number, cz: number, sx: number, sz: number, ridgeAlongZ: boolean) => {
    mesh(g, new THREE.BoxGeometry(sx, WALL, sz), stone, cx, WALL / 2, cz);
    mesh(g, new THREE.BoxGeometry(sx + 0.3, 0.35, sz + 0.3), dressed, cx, WALL + 0.1, cz, false);
    const roof = gableRoofGeo((ridgeAlongZ ? sx : sz) + 0.8, 3.4, ridgeAlongZ ? sz : sx);
    if (!ridgeAlongZ) roof.rotateY(Math.PI / 2);
    mesh(g, roof, tile, cx, WALL + 0.25, cz);
  };
  wing(-frontD / 2, 0, frontD, wingLenZ, true);
  wing(B + backD / 2, 0, backD, wingLenZ, true);
  for (const s of [-1, 1]) wing(-D / 2, s * (zN - sideW / 2), sideLenX, sideW, false);

  // Arcaded faces: street, back, both sides, and the four courtyard faces
  const half = wingLenZ / 2;
  bays(half - 4.5, 0, (half + 4.5) / 2, E); // street front, either side of the tower
  bays(half - 4.5, 0, -(half + 4.5) / 2, E);
  bays(wingLenZ, B, 0, Wd);
  for (const s of [-1, 1]) {
    bays(sideLenX, -D / 2, s * zN, s > 0 ? 0 : Math.PI);
    bays(sideLenX, -D / 2, s * (zN - sideW), s > 0 ? Math.PI : 0);
  }
  bays(wingLenZ, -frontD, 0, Wd);
  bays(wingLenZ, B + backD, 0, E);

  // Bay pinnacles along the street parapet
  const nFront = Math.round((half - 4.5) / 4.2);
  const stepF = (half - 4.5) / nFront;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= nFront; i++) {
      const z = s * (4.5 + i * stepF);
      mesh(g, new THREE.BoxGeometry(0.5, 1.2, 0.5), stone, 0.0, WALL + 0.6, z, false);
      mesh(g, new THREE.ConeGeometry(0.32, 1.1, 4).rotateY(Math.PI / 4), dressed, 0.0, WALL + 1.75, z, false);
    }
  }
  // Side & back entrance gables with deep pointed doorways
  const entrance = (x: number, z: number, a: number, w: number) => {
    const gab = new THREE.Shape();
    gab.moveTo(-w / 2, 0);
    gab.lineTo(w / 2, 0);
    gab.lineTo(0, w * 0.55);
    gab.lineTo(-w / 2, 0);
    const gm = mesh(g, new THREE.ExtrudeGeometry(gab, { depth: 0.6, bevelEnabled: false }), stone, x - Math.sin(a) * 0.3, WALL, z - Math.cos(a) * 0.3, false);
    gm.rotation.y = a;
    const door = mesh(g, new THREE.ShapeGeometry(pointedArchShape(1.6, 5.4) as THREE.Shape), dark, x + Math.sin(a) * 0.06, 0.4, z + Math.cos(a) * 0.06, false);
    door.rotation.y = a;
    const fr = mesh(g, archFrameGeo(1.6, 5.4, 0.45, 0.4), dressed, x + Math.sin(a) * 0.35, 0.4, z + Math.cos(a) * 0.35, false);
    fr.rotation.y = a;
    for (const d of [-1, 1]) {
      const px = x + Math.cos(a) * d * (w / 2), pz = z - Math.sin(a) * d * (w / 2);
      mesh(g, new THREE.BoxGeometry(0.8, WALL + 2.4, 0.8), stone, px, (WALL + 2.4) / 2, pz);
      mesh(g, new THREE.ConeGeometry(0.5, 1.8, 4).rotateY(Math.PI / 4), dressed, px, WALL + 3.3, pz, false);
    }
  };
  for (const s of [-1, 1]) entrance(-D / 2, s * zN, s > 0 ? 0 : Math.PI, 6);
  entrance(B, 0, Wd, 6);

  // ---- Corner pavilions ----
  const PAVH = 15;
  for (const sx of [0, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx === 0 ? -PAV / 2 : B + PAV / 2;
      const pz = sz * (zN - PAV / 2);
      mesh(g, new THREE.BoxGeometry(PAV, PAVH, PAV), stone, px, PAVH / 2, pz);
      // Outward faces carry two arcade bays
      bays(PAV, px + (sx === 0 ? PAV / 2 : -PAV / 2), pz, sx === 0 ? E : Wd);
      bays(PAV, px, pz + sz * PAV / 2, sz > 0 ? 0 : Math.PI);
      for (const y of [WALL, PAVH]) mesh(g, new THREE.BoxGeometry(PAV + 0.4, 0.4, PAV + 0.4), dressed, px, y, pz, false);
      // Corner quoins / buttresses with pinnacles
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          mesh(g, new THREE.BoxGeometry(0.9, PAVH + 1.0, 0.9), trim, px + cx * PAV / 2, (PAVH + 1.0) / 2, pz + cz * PAV / 2);
          mesh(g, new THREE.ConeGeometry(0.55, 2.2, 4).rotateY(Math.PI / 4), dressed, px + cx * PAV / 2, PAVH + 2.1, pz + cz * PAV / 2, false);
        }
      }
      mesh(g, new THREE.ConeGeometry(PAV * 0.62, 5.2, 4).rotateY(Math.PI / 4), slate, px, PAVH + 2.6, pz);
      mesh(g, new THREE.BoxGeometry(0.12, 1.6, 0.12), iron, px, PAVH + 5.9, pz, false);
    }
  }

  // ---- Clock tower over the main (street) entrance ----
  const T = 9;
  const tx = -T / 2;
  const shaftH = 24, clockH = 5.2, belfryH = 4.2;
  mesh(g, new THREE.BoxGeometry(T, shaftH + clockH, T), stone, tx, (shaftH + clockH) / 2, 0);
  // Banded shaft: lighter courses + tall paired lancets up the street face
  for (let y = 3; y < shaftH; y += 3.2) mesh(g, new THREE.BoxGeometry(T + 0.1, 0.45, T + 0.1), dressed, tx, y, 0, false);
  for (const y of [WALL, shaftH]) mesh(g, new THREE.BoxGeometry(T + 0.6, 0.5, T + 0.6), trim, tx, y, 0, false);
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2;
    const ox = Math.sin(a), oz = Math.cos(a);
    const r = T / 2 + 0.05;
    for (const d of [-1, 1]) {
      const w = mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.5, 4.6) as THREE.Shape), dark, tx + ox * r + Math.cos(a) * d * 1.3, 15.2, oz * r - Math.sin(a) * d * 1.3, false);
      w.rotation.y = a;
    }
  }
  // Clasping corner buttresses
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(1.2, shaftH, 1.2), trim, tx + cx * (T / 2), shaftH / 2, cz * (T / 2));
    }
  }
  // Grand entrance arch + name plaque on the street face
  mesh(g, new THREE.ShapeGeometry(pointedArchShape(2.4, 8.2) as THREE.Shape), dark, 0.06, 0.2, 0, false).rotation.y = E;
  mesh(g, archFrameGeo(2.4, 8.2, 0.7, 0.6), dressed, 0.6, 0.2, 0, false).rotation.y = E;
  const plaqueTex = signTexture(['EMPRESS MARKET', 'ایمپریس مارکیٹ · 1889'], '#4a2c14', '#f4e2b6', 512, 128);
  const plaque = new THREE.MeshLambertMaterial({ color: '#ffffff', map: plaqueTex, emissive: new THREE.Color('#f4e2b6'), emissiveMap: plaqueTex, emissiveIntensity: 0 });
  litMats.push(plaque);
  mesh(g, new THREE.PlaneGeometry(6.4, 1.6), plaque, 0.12, 10.0, 0, false).rotation.y = E;

  // Clock stage: four 6 ft-class dials under gabled hoods
  const clockTex = clockFaceTexture();
  const clock = new THREE.MeshLambertMaterial({ color: '#ffffff', map: clockTex, emissiveMap: clockTex, emissive: new THREE.Color('#fff2c4'), emissiveIntensity: 0 });
  litMats.push(clock);
  const cy = shaftH + clockH / 2;
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2;
    const ox = Math.sin(a), oz = Math.cos(a);
    const r = T / 2 + 0.08;
    mesh(g, new THREE.CircleGeometry(1.95, 24), clock, tx + ox * r, cy, oz * r, false).rotation.y = a;
    const ring = new THREE.RingGeometry(1.95, 2.3, 24);
    mesh(g, ring, trim, tx + ox * (r + 0.01), cy, oz * (r + 0.01), false).rotation.y = a;
    const hood = new THREE.Shape();
    hood.moveTo(-T / 2 + 0.6, 0);
    hood.lineTo(T / 2 - 0.6, 0);
    hood.lineTo(0, 2.6);
    hood.lineTo(-T / 2 + 0.6, 0);
    const hm = mesh(g, new THREE.ExtrudeGeometry(hood, { depth: 0.5, bevelEnabled: false }), stone, tx + ox * (T / 2 - 0.2), shaftH + clockH, oz * (T / 2 - 0.2), false);
    hm.rotation.y = a;
  }
  // Open belfry: corner piers, pointed openings, inner core
  const by = shaftH + clockH;
  mesh(g, new THREE.BoxGeometry(T - 3.0, belfryH, T - 3.0), dark, tx, by + belfryH / 2, 0);
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(1.5, belfryH, 1.5), stone, tx + cx * (T / 2 - 0.75), by + belfryH / 2, cz * (T / 2 - 0.75));
    }
  }
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2;
    const fr = mesh(g, archFrameGeo(2.2, belfryH - 0.4, 0.35, 0.4), stone, tx + Math.sin(a) * (T / 2), by, Math.cos(a) * (T / 2), false);
    fr.rotation.y = a;
  }
  // Parapet, corner pinnacles, steep pyramid spire and iron finial (~43 m overall)
  const py = by + belfryH;
  mesh(g, new THREE.BoxGeometry(T + 0.8, 0.5, T + 0.8), dressed, tx, py + 0.25, 0, false);
  mesh(g, new THREE.BoxGeometry(T + 0.4, 1.1, T + 0.4), stone, tx, py + 1.05, 0, false);
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(0.9, 2.4, 0.9), stone, tx + cx * (T / 2), py + 1.2, cz * (T / 2));
      mesh(g, new THREE.ConeGeometry(0.55, 2.8, 4).rotateY(Math.PI / 4), dressed, tx + cx * (T / 2), py + 3.8, cz * (T / 2), false);
    }
  }
  mesh(g, new THREE.ConeGeometry(T * 0.6, 7.5, 4).rotateY(Math.PI / 4), slate, tx, py + 1.6 + 3.75, 0);
  for (let f = 0; f < 4; f++) {
    // Lucarne gablets on the spire
    const a = (f / 4) * Math.PI * 2;
    mesh(g, new THREE.ConeGeometry(0.7, 1.6, 4).rotateY(Math.PI / 4), dressed, tx + Math.sin(a) * 2.2, py + 3.4, Math.cos(a) * 2.2, false);
  }
  mesh(g, new THREE.CylinderGeometry(0.08, 0.12, 2.6, 6), iron, tx, py + 10.3, 0, false);
  mesh(g, new THREE.SphereGeometry(0.28, 8, 6), lam('#c9a24a'), tx, py + 9.4, 0, false);

  // ---- Courtyard stalls: pole-and-tarp shades, crates of produce ----
  const tarps = [lam('#1e63b5'), lam('#e8772e'), lam('#2e8b57'), lam('#c62828')];
  const crate = lam('#9a6b3c');
  const produce = [lam('#f4511e'), lam('#fdd835'), lam('#7cb342')];
  const cx0 = -frontD - 1.8, cx1 = B + backD + 1.8;
  let k = 0;
  for (const sx of [cx0, cx1]) {
    for (let z = -L / 2 + sideW + 2.5; z <= L / 2 - sideW - 2.5; z += 4.2) {
      const t = mesh(g, new THREE.BoxGeometry(3.0, 0.06, 3.4), tarps[k % tarps.length], sx, 2.6, z, false);
      t.rotation.z = (sx === cx0 ? 1 : -1) * 0.18;
      for (const dz of [-1.5, 1.5]) mesh(g, new THREE.CylinderGeometry(0.05, 0.05, 2.6, 4), iron, sx, 1.3, z + dz, false);
      mesh(g, new THREE.BoxGeometry(1.6, 0.8, 2.6), crate, sx, 0.4, z, false);
      mesh(g, new THREE.BoxGeometry(1.3, 0.25, 2.3), produce[k % produce.length], sx, 0.92, z, false);
      k++;
    }
  }

  mergeByMaterial(g, shadow);
}

/**
 * Mazar-e-Quaid (Yahya Merchant, completed 1970), the white marble
 * mausoleum of Muhammad Ali Jinnah, modelled from reference photos:
 * - a battered cube (walls lean in as they rise) of large running-bond
 *   marble blocks; each face's top steps down towards the corners;
 * - one tall, narrow, sharply pointed arch per face over a deep dark recess
 *   holding a bronze grille, with the doorway at its foot;
 * - a tall cylindrical drum ringed with small arched grille windows,
 *   carrying a broad, near-hemispherical dome;
 * - low marble steps all round the base, on a wide marble plaza.
 * At night the marble is floodlit, the interior glows through the
 * grilles and four searchlights fan up round the dome.
 * @param W cube width at the base (m). Origin at ground centre; front +x.
 */
export function buildMazarModel(
  parent: THREE.Object3D,
  W: number,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  parent.add(g);
  const floodlit = (hex: string, glow: string, map?: THREE.Texture) => {
    const m = new THREE.MeshLambertMaterial({ color: hex, map: map ?? null, emissive: new THREE.Color(glow), emissiveIntensity: 0 });
    litMats.push(m);
    return m;
  };
  const blocks = (rx: number, ry: number) => tiled(mazarMarbleTexture(), rx, ry);
  const plain = floodlit('#f4f3ee', '#cfdcd6');
  const stepMat = lam('#e2e0d9');
  const recessMat = lam('#151517');
  const grille = new THREE.MeshLambertMaterial({
    color: '#e8b47a',
    map: tiled(mazarGrilleTexture(), 1 / (W * 0.035), 1 / (W * 0.035)),
    emissive: new THREE.Color('#ffcf8a'),
    emissiveMap: tiled(mazarGrilleTexture(true), 1 / (W * 0.035), 1 / (W * 0.035)),
    emissiveIntensity: 0,
  });
  litMats.push(grille);

  // ---- Plaza and low steps running right round the base ----
  const P = W * 1.42;
  const tiers = 4;
  const th = W * 0.012;
  for (let k = 0; k < tiers; k++) {
    const w = P - k * (P - W * 1.08) / (tiers - 1);
    mesh(g, new THREE.BoxGeometry(w, th, w), k === 0 ? plain : stepMat, 0, th * (k + 0.5), 0, false);
  }
  const y0 = th * tiers;

  // ---- Battered cube: a square frustum of marble blocks ----
  const H = W * 0.68;
  const Wt = W * 0.86; // width at the top of the walls
  const batter = Math.atan2((W - Wt) / 2, H);
  const cube = new THREE.CylinderGeometry((Wt / 2) * Math.SQRT2, (W / 2) * Math.SQRT2, H, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
  cube.computeVertexNormals();
  // World-scaled UVs so the blocks stay square on every face (~22 courses up the wall)
  const blockRep = (H / 22) * 4;
  {
    const pos = cube.getAttribute('position');
    const uv = cube.getAttribute('uv');
    const nrm = cube.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      // Pick the in-face horizontal axis from the (flat) face normal
      const t = i - (i % 3);
      const alongZ = Math.abs(nrm.getX(t)) > Math.abs(nrm.getZ(t));
      const along = alongZ ? pos.getZ(i) * Math.sign(nrm.getX(t)) : -pos.getX(i) * Math.sign(nrm.getZ(t));
      uv.setXY(i, along / blockRep, (pos.getY(i) + H / 2) / blockRep);
    }
    uv.needsUpdate = true;
  }
  const cubeMat = floodlit('#ffffff', '#cfdcd6', blocks(1, 1));
  mesh(g, cube, cubeMat, 0, y0 + H / 2, 0);
  // Stepped skyline: each face's middle rises in two steps above its corners
  const yTop = y0 + H;
  for (const [w, h] of [
    [Wt * 0.74, W * 0.035],
    [Wt * 0.5, W * 0.07],
  ] as const) {
    mesh(g, new THREE.BoxGeometry(w, h, Wt - 0.02).rotateY(0), plain, 0, yTop + h / 2, 0);
    mesh(g, new THREE.BoxGeometry(Wt - 0.02, h, w), plain, 0, yTop + h / 2, 0);
  }
  // Flat roof deck
  mesh(g, new THREE.BoxGeometry(Wt - 0.04, 0.05, Wt - 0.04), plain, 0, yTop + 0.02, 0, false);

  // ---- One tall, narrow pointed arch per face (leaning with the wall) ----
  const aHw = W * 0.085, aH = H * 0.74;
  /** Sharp lancet: two arcs of radius 2.5 × half-width meeting at the apex. */
  const lancet = (hw: number, h: number, shape: THREE.Shape | THREE.Path = new THREE.Shape()) => {
    const r = hw * 2.5;
    const rise = Math.sqrt(r * r - (r - hw) * (r - hw));
    const spring = h - rise;
    const apex = Math.atan2(rise, r - hw);
    shape.moveTo(-hw, 0);
    shape.lineTo(-hw, spring);
    shape.absarc(-hw + r, spring, r, Math.PI, Math.PI - apex, true); // left arc up to the apex
    shape.absarc(hw - r, spring, r, apex, 0, true); // right arc back down
    shape.lineTo(hw, 0);
    shape.lineTo(-hw, 0);
    return shape;
  };
  const lancetFrame = (hw: number, h: number, band: number, depth: number) => {
    const outer = lancet(hw + band, h + band * 1.8) as THREE.Shape;
    outer.holes.push(lancet(hw, h, new THREE.Path()) as THREE.Path);
    const geo = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 10 });
    geo.translate(0, 0, -depth);
    return geo;
  };
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2;
    const face = new THREE.Group();
    face.rotation.order = 'YXZ';
    face.rotation.y = a;
    face.rotation.x = -batter;
    face.position.set(Math.sin(a) * (W / 2), y0, Math.cos(a) * (W / 2));
    g.add(face);
    // Dark recess, bronze grille filling the head, and a moulded reveal
    face.add(new THREE.Mesh(new THREE.ShapeGeometry(lancet(aHw, aH) as THREE.Shape, 16), recessMat).translateZ(0.02));
    const gr = new THREE.Mesh(new THREE.ShapeGeometry(lancet(aHw * 0.84, aH * 0.93) as THREE.Shape, 16), grille);
    gr.position.set(0, aH * 0.05, 0.03);
    face.add(gr);
    // Door leaves at the foot of the grille
    const door = new THREE.Mesh(new THREE.PlaneGeometry(aHw * 1.1, aH * 0.2), lam('#4a3622'));
    door.position.set(0, aH * 0.1, 0.04);
    face.add(door);
    // Deep reveal (inner frame) and a slim outer moulding
    const reveal = new THREE.Mesh(lancetFrame(aHw, aH, W * 0.014, W * 0.035), plain);
    reveal.position.z = W * 0.035;
    face.add(reveal);
    const mould = new THREE.Mesh(lancetFrame(aHw + W * 0.014, aH + W * 0.025, W * 0.008, W * 0.012), plain);
    mould.position.z = W * 0.012;
    face.add(mould);
  }

  // ---- Drum with a ring of small arched grille windows, then the dome ----
  const R = W * 0.3;
  const drumY = yTop + W * 0.07;
  const drumH = W * 0.18;
  const drum = new THREE.CylinderGeometry(R, R * 1.02, drumH, 48, 1, true);
  {
    const pos = drum.getAttribute('position');
    const uv = drum.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.atan2(pos.getZ(i), pos.getX(i)) * R) / blockRep, (pos.getY(i) + drumH / 2) / blockRep);
    uv.needsUpdate = true;
  }
  mesh(g, drum, cubeMat, 0, drumY + drumH / 2, 0);
  mesh(g, new THREE.CylinderGeometry(R * 1.05, R * 1.06, W * 0.012, 48), plain, 0, drumY + drumH * 0.08, 0, false);
  mesh(g, new THREE.CylinderGeometry(R * 1.03, R * 1.03, W * 0.012, 48), plain, 0, drumY + drumH, 0, false);
  const nWin = 16;
  for (let k = 0; k < nWin; k++) {
    if (k % 4 === 0) continue; // solid piers on the axes, three windows per quarter
    const a = ((k + 0.5) / nWin) * Math.PI * 2;
    const win = new THREE.Mesh(new THREE.ShapeGeometry(lancet(W * 0.03, drumH * 0.64) as THREE.Shape, 8), grille);
    win.position.set(Math.sin(a) * (R + 0.04), drumY + drumH * 0.2, Math.cos(a) * (R + 0.04));
    win.rotation.y = a;
    g.add(win);
    const fr = new THREE.Mesh(lancetFrame(W * 0.03, drumH * 0.64, W * 0.008, W * 0.01), plain);
    fr.position.set(Math.sin(a) * (R + 0.05), drumY + drumH * 0.2, Math.cos(a) * (R + 0.05));
    fr.rotation.y = a;
    g.add(fr);
  }
  // Broad dome: a hemisphere eased slightly at the crown
  const D = R * 0.92;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.cos(t) * R * 1.01, Math.sin(t) * D));
  }
  const dome = new THREE.LatheGeometry(prof, 48);
  {
    const pos = dome.getAttribute('position');
    const uv = dome.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.atan2(pos.getZ(i), pos.getX(i)) * R) / 14, pos.getY(i) / 10);
    uv.needsUpdate = true;
  }
  // Dome: the same marble, its joints much fainter than on the walls
  const domeMat = floodlit('#fbfbf8', '#cfdcd6');
  mesh(g, dome, domeMat, 0, drumY + drumH, 0);
  mesh(g, new THREE.CylinderGeometry(W * 0.01, W * 0.014, W * 0.025, 8), plain, 0, drumY + drumH + D + W * 0.01, 0, false);

  mergeByMaterial(g, shadow);

  // ---- Searchlights (added after merging: no shadows, drawn last) ----
  const beam = new THREE.MeshLambertMaterial({
    color: '#000000',
    emissive: new THREE.Color('#5f7ea8'),
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  litMats.push(beam);
  const beamLen = W * 2.6;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const cone = new THREE.ConeGeometry(W * 0.1, beamLen, 12, 1, true).translate(0, -beamLen / 2, 0);
    const m = new THREE.Mesh(cone, beam);
    m.position.set(Math.sin(a) * P * 0.45, y0 + 0.2, Math.cos(a) * P * 0.45);
    m.rotation.set(Math.PI - Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
    m.renderOrder = 2;
    g.add(m);
  }
}

// ---- Mazar-e-Quaid (white marble mausoleum in its park, right side) ---------------

function buildMazar(group: THREE.Group, shadow: boolean, litMats: THREE.MeshLambertMaterial[]): void {
  const g = new THREE.Group();
  group.add(g);
  const edge = corridorEdges(MAZAR_Z).right + FOOTPATH_W;
  const cx = edge + 78;
  const zc = -MAZAR_Z;

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

  // The mausoleum itself, front turned to face the road.
  const m = new THREE.Group();
  m.position.set(cx, 0, zc);
  m.rotation.y = Math.PI;
  g.add(m);
  buildMazarModel(m, 40, shadow, litMats);
}

// ---- Flyovers crossing Shahrah-e-Faisal ----------------------------------------------

function buildFlyover(group: THREE.Group, zc: number, name: string, shadow: boolean, litMats: THREE.MeshLambertMaterial[]): void {
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
  const signTex = signTexture([name], '#0b6e3a', '#ffffff', 768, 80);
  const signMat = new THREE.MeshLambertMaterial({
    map: signTex,
    emissiveMap: signTex,
    emissive: new THREE.Color('#fff4db'),
    emissiveIntensity: 0,
  });
  litMats.push(signMat);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 1.6), signMat);
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
