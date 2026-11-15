import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KERB_H } from '../sim/city/cityMap';
import type { Landmark } from '../sim/city/cityMap';
import { buildEmpressMarketAt } from './Landmarks';
import {
  cinemaPosterTexture,
  clockFaceTexture,
  colonialVerandahTexture,
  gothicWallTexture,
  mazarFaceTexture,
  signTexture,
  stainedLancetTexture,
  stPatricksFrontTexture,
  stripesTexture,
} from './textures';

const lam = (color: THREE.ColorRepresentation, map?: THREE.Texture, doubleSide = false) =>
  new THREE.MeshLambertMaterial({
    color,
    map: map ?? null,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });

const basic = (color: THREE.ColorRepresentation, map?: THREE.Texture, doubleSide = false) =>
  new THREE.MeshBasicMaterial({
    color,
    map: map ?? null,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });

function mesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function tiled(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

interface LocalLandmark {
  rect: { x0: number; z0: number; x1: number; z1: number };
}

/**
 * Builds all 26 named Saddar landmarks in Free Roam mode so every fare
 * destination has an authentic, recognizable 3D architectural presence.
 */
export function buildSaddarLandmark(
  group: THREE.Group,
  l: Landmark,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[] = [],
): void {
  const { x, z, hw, hl, heading } = l.obb;
  if (l.kind === 'empress') {
    const sub = new THREE.Group();
    sub.position.set(x, KERB_H, -z);
    sub.rotation.y = -heading;
    buildEmpressMarketAt(sub, shadow, hw, 0, hl * 2, litMats);
    group.add(sub);
    return;
  }

  const sub = new THREE.Group();
  sub.position.set(x, 0, -z);
  group.add(sub);

  // Builders written with front at +x (depth = 2*hw along x, frontage = 2*hl along z)
  const rectPosX: LocalLandmark = { rect: { x0: -hw, x1: hw, z0: -hl, z1: hl } };
  // Builders written with front at +z or -z (width = 2*hl along x, depth = 2*hw along z)
  const rectZ: LocalLandmark = { rect: { x0: -hl, x1: hl, z0: -hw, z1: hw } };

  switch (l.kind) {
    case 'st_patricks':
      sub.rotation.y = -heading + Math.PI / 2;
      buildStPatricksCathedral(sub, rectZ, shadow);
      break;
    case 'dawakhana':
      sub.rotation.y = -heading;
      buildSaddarDawakhana(sub, rectPosX, shadow);
      break;
    case 'bohri_bazaar':
      sub.rotation.y = -heading - Math.PI / 2;
      buildBohriBazaar(sub, rectZ, shadow);
      break;
    case 'zainab_market':
      sub.rotation.y = -heading + Math.PI;
      buildZainabMarket(sub, rectPosX, shadow);
      break;
    case 'regal_chowk':
      sub.rotation.y = -heading;
      buildRegalChowk(sub, rectPosX, shadow);
      break;
    case 'paradise_cinema':
      sub.rotation.y = -heading;
      buildParadiseCinema(sub, rectPosX, shadow);
      break;
    case 'capri_cinema':
      sub.rotation.y = -heading - Math.PI / 2;
      buildCapriCinema(sub, rectZ, shadow);
      break;
    case 'jahangir_park':
      sub.rotation.y = -heading;
      buildJahangirPark(sub, rectPosX, shadow);
      break;
    case 'pakistan_chowk':
      sub.rotation.y = -heading + Math.PI / 2;
      buildPakistanChowk(sub, rectZ, shadow);
      break;
    case 'burns_road':
      sub.rotation.y = -heading + Math.PI;
      buildBurnsRoad(sub, rectPosX, shadow);
      break;
    case 'sindh_secretariat':
      sub.rotation.y = -heading + Math.PI / 2;
      buildSindhSecretariat(sub, rectZ, shadow);
      break;
    case 'cantt_station':
      sub.rotation.y = -heading;
      buildCanttStation(sub, rectPosX, shadow);
      break;
    case 'lucky_star':
      sub.rotation.y = -heading;
      buildLuckyStarHotel(sub, rectPosX, shadow);
      break;
    case 'sindh_high_court':
      sub.rotation.y = -heading;
      buildSindhHighCourt(sub, hw, hl, shadow);
      break;
    case 'grammar_school':
      sub.rotation.y = -heading;
      buildKarachiGrammarSchool(sub, hw, hl, shadow);
      break;
    case 'press_club':
      sub.rotation.y = -heading;
      buildKarachiPressClub(sub, hw, hl, shadow);
      break;
    case 'ymca':
      sub.rotation.y = -heading;
      buildHistoricYmca(sub, hw, hl, shadow);
      break;
    case 'preedy_police':
      sub.rotation.y = -heading;
      buildPreedyPoliceStation(sub, hw, hl, shadow);
      break;
    case 'passport_office':
      sub.rotation.y = -heading;
      buildPassportOffice(sub, hw, hl, shadow);
      break;
    case 'rainbow_centre':
      sub.rotation.y = -heading;
      buildCommercialPlaza(sub, hw, hl, shadow, {
        title: 'RAINBOW CENTRE · رینبو سینٹر',
        sub: 'CDs · CASSETTES · ELECTRONICS · COMPUTERS',
        wall: '#e4ddd0',
        band: '#c62828',
        accent: '#1565c0',
        signBg: '#1a237e',
        signFg: '#ffeb3b',
        storeys: 5,
        rainbow: true,
      });
      break;
    case 'atrium_mall':
      sub.rotation.y = -heading;
      buildCommercialPlaza(sub, hw, hl, shadow, {
        title: 'ATRIUM MALL · ایٹریم مال',
        sub: 'NUEPLEX CINEMAS · BRANDS · FOOD COURT',
        wall: '#cfd8dc',
        band: '#263238',
        accent: '#b71c1c',
        signBg: '#b71c1c',
        signFg: '#ffffff',
        storeys: 5,
        glassAtrium: true,
      });
      break;
    case 'gul_plaza':
      sub.rotation.y = -heading;
      buildCommercialPlaza(sub, hw, hl, shadow, {
        title: 'GUL PLAZA · گل پلازہ',
        sub: 'WHOLESALE CROCKERY · ELECTRONICS · TOYS · GIFTS',
        wall: '#f2e8d5',
        band: '#b8432e',
        accent: '#8d2b1c',
        signBg: '#880e4f',
        signFg: '#ffd54f',
        storeys: 4,
      });
      break;
    case 'tibet_centre':
      sub.rotation.y = -heading;
      buildCommercialPlaza(sub, hw, hl, shadow, {
        title: 'TIBET CENTRE · تبت سینٹر',
        sub: 'AUTO SPARE PARTS · ACCESSORIES · M.A. JINNAH RD',
        wall: '#dfd7c6',
        band: '#00695c',
        accent: '#e65100',
        signBg: '#004d40',
        signFg: '#ffeb3b',
        storeys: 5,
      });
      break;
    case 'panorama_centre':
      sub.rotation.y = -heading;
      buildCommercialPlaza(sub, hw, hl, shadow, {
        title: 'PANORAMA CENTRE · پینوراما سینٹر',
        sub: 'GARMENTS · SUITING · TAILORING · BOOTS',
        wall: '#f4f1ea',
        band: '#4e342e',
        accent: '#1565c0',
        signBg: '#0d47a1',
        signFg: '#ffffff',
        storeys: 7,
      });
      break;
    case 'madina_mall':
      sub.rotation.y = -heading;
      buildCommercialPlaza(sub, hw, hl, shadow, {
        title: 'MADINA CITY MALL · مدینہ سٹی مال',
        sub: 'MOBILE MARKET · GARMENTS · WATCHES · OPTICS',
        wall: '#ebe4d4',
        band: '#1b5e20',
        accent: '#fbc02d',
        signBg: '#1b5e20',
        signFg: '#ffee58',
        storeys: 5,
        glassAtrium: true,
      });
      break;
    case 'mazar_quaid':
      sub.rotation.y = -heading;
      buildMazarQuaid(sub, hw, hl, shadow, litMats);
      break;
    case 'frere_hall':
      sub.rotation.y = -heading;
      buildFrereHall(sub, hw, hl, shadow, litMats);
      break;
    case 'merewether_tower':
      sub.rotation.y = -heading;
      buildMerewetherTower(sub, hw, hl, shadow, litMats);
      break;
    case 'arts_council':
      sub.rotation.y = -heading;
      buildArtsCouncil(sub, hw, hl, shadow, litMats);
      break;
    case 'dj_science_college':
      sub.rotation.y = -heading;
      buildDjScienceCollege(sub, hw, hl, shadow, litMats);
      break;
  }
}

// ---------------------------------------------------------------------------
// 2. St. Patrick's Cathedral (Shahrah-e-Iraq, Gothic Revival + Christ the King)
// ---------------------------------------------------------------------------

function buildStPatricksCathedral(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const zFront = -l.rect.z0; // South edge facing Shahrah-e-Iraq (+z in three space)
  g.position.set(cx, KERB_H, zFront);
  group.add(g);

  const w = l.rect.x1 - l.rect.x0;
  const d = l.rect.z1 - l.rect.z0;
  const stone = lam('#d8b77c');
  const darkStone = lam('#b89352');
  const redTrim = lam('#9e4733');
  const roofMat = lam('#7d4e38');
  const marble = lam('#f5f4ef');
  const lancet = stainedLancetTexture();

  // Courtyard lawn & paved central approach walk
  const lawn = mesh(g, new THREE.PlaneGeometry(w, d), lam('#7e9958'), 0, 0.02, -d / 2, false);
  lawn.rotation.x = -Math.PI / 2;
  const walk = mesh(g, new THREE.PlaneGeometry(11, d - 4), lam('#dfd7c6'), 0, 0.03, -d / 2, false);
  walk.rotation.x = -Math.PI / 2;

  // Low stone compound wall + iron fence along Shahrah-e-Iraq with wide open gate
  for (const side of [-1, 1]) {
    const segW = (w - 12) / 2;
    const sx = side * (6 + segW / 2);
    mesh(g, new THREE.BoxGeometry(segW, 0.85, 0.5), stone, sx, 0.425, -0.25, false);
    mesh(g, new THREE.BoxGeometry(segW, 0.9, 0.12), lam('#222426'), sx, 1.3, -0.25, false);
    // Gate piers
    mesh(g, new THREE.BoxGeometry(1.1, 2.6, 1.1), darkStone, side * 6, 1.3, -0.3, shadow);
    mesh(g, new THREE.ConeGeometry(0.85, 1.1, 4).rotateY(Math.PI / 4), redTrim, side * 6, 3.15, -0.3, false);
  }
  // Entrance arch sign
  const gateSign = mesh(
    g,
    new THREE.PlaneGeometry(9.5, 1.3),
    lam('#ffffff', signTexture(["ST. PATRICK'S CATHEDRAL", 'ARCHDIOCESE OF KARACHI · 1881'], '#5d291e', '#f7e7c4', 512, 128), true),
    0,
    3.6,
    -0.3,
    false,
  );
  void gateSign;

  // ---- Monument to Christ the King (1931) in the forecourt (z = -8.5) ----
  const mz = -8.5;
  mesh(g, new THREE.CylinderGeometry(3.4, 3.8, 0.8, 8), marble, 0, 0.4, mz, shadow);
  mesh(g, new THREE.CylinderGeometry(2.5, 2.9, 1.1, 8), marble, 0, 1.35, mz, shadow);
  // Four marble canopy pillars + octagonal cupola
  for (const dx of [-1.2, 1.2]) {
    for (const dz of [-1.2, 1.2]) {
      mesh(g, new THREE.CylinderGeometry(0.22, 0.25, 3.2, 8), marble, dx, 3.5, mz + dz, shadow);
    }
  }
  mesh(g, new THREE.BoxGeometry(3.2, 0.45, 3.2), marble, 0, 5.3, mz, shadow);
  mesh(g, new THREE.SphereGeometry(1.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), marble, 0, 5.5, mz, shadow);
  // Statue of Christ the King with outstretched arms atop the dome
  mesh(g, new THREE.CylinderGeometry(0.28, 0.36, 2.1, 8), marble, 0, 7.8, mz, shadow);
  mesh(g, new THREE.BoxGeometry(1.75, 0.24, 0.26), marble, 0, 8.35, mz, shadow); // outstretched arms
  mesh(g, new THREE.SphereGeometry(0.24, 8, 6), marble, 0, 9.05, mz, false);
  mesh(g, new THREE.CylinderGeometry(0.35, 0.35, 0.06, 12).rotateX(Math.PI / 2), lam('#e0b94b'), 0, 9.15, mz - 0.1, false); // halo

  // ---- Cathedral Nave, Side Aisles & Cruciform Transept (z = -16 to -48) ----
  const naveLen = 32;
  const naveW = 16.5;
  const naveH = 14.5;
  const naveZc = -16 - naveLen / 2;
  mesh(g, new THREE.BoxGeometry(naveW, naveH, naveLen), stone, 0, naveH / 2, naveZc, shadow);
  // Side aisles (lower flanking wings)
  mesh(g, new THREE.BoxGeometry(24, 9.2, naveLen - 4), darkStone, 0, 4.6, naveZc - 1, shadow);
  // Cruciform transept crossing
  const tranW = 36, tranLen = 9.5, tranH = 14.0, tranZc = -36;
  mesh(g, new THREE.BoxGeometry(tranW, tranH, tranLen), stone, 0, tranH / 2, tranZc, shadow);

  // Pitched gable roofs over nave and transept
  const naveRoof = new THREE.ConeGeometry(naveW * 0.62, naveLen, 3);
  naveRoof.rotateX(Math.PI / 2);
  naveRoof.scale(1, 0.45, 1);
  mesh(g, naveRoof, roofMat, 0, naveH + 2.2, naveZc, shadow);

  const tranRoof = new THREE.ConeGeometry(tranLen * 0.65, tranW, 3);
  tranRoof.rotateZ(Math.PI / 2);
  tranRoof.scale(1, 0.45, 1);
  mesh(g, tranRoof, roofMat, 0, tranH + 2.0, tranZc, shadow);

  // Front Gothic facade with Rose Window & triple portals
  mesh(
    g,
    new THREE.PlaneGeometry(naveW, naveH),
    lam('#ffffff', stPatricksFrontTexture()),
    0,
    naveH / 2,
    -16 + 0.05,
    false,
  );
  // Triangular front gable + central stone cross
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-naveW / 2, 0);
  gableShape.lineTo(naveW / 2, 0);
  gableShape.lineTo(0, 5.2);
  gableShape.closePath();
  mesh(g, new THREE.ShapeGeometry(gableShape), stone, 0, naveH, -16 + 0.04, false);
  mesh(g, new THREE.BoxGeometry(0.35, 2.4, 0.35), marble, 0, naveH + 6.0, -16, false);
  mesh(g, new THREE.BoxGeometry(1.4, 0.35, 0.35), marble, 0, naveH + 6.4, -16, false);

  // Stained-glass lancet side walls & buttresses
  for (const s of [-1, 1]) {
    const sidePlane = mesh(
      g,
      new THREE.PlaneGeometry(naveLen - 4, 9.0),
      lam('#ffffff', tiled(lancet, 4, 1)),
      s * 12.04,
      4.5,
      naveZc - 1,
      false,
    );
    sidePlane.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    // Clerestory lancets
    const clPlane = mesh(
      g,
      new THREE.PlaneGeometry(naveLen - 4, 5.0),
      lam('#ffffff', tiled(lancet, 5, 1)),
      s * (naveW / 2 + 0.04),
      11.8,
      naveZc,
      false,
    );
    clPlane.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    // Stone buttresses along side aisle
    for (let bz = -20; bz >= -44; bz -= 6) {
      mesh(g, new THREE.BoxGeometry(0.9, 9.8, 1.1), redTrim, s * 12.3, 4.9, bz, false);
    }
  }

  // ---- Twin Gothic Bell Towers & Spires flanking the South entrance ----
  const towerH = 22.5;
  for (const s of [-1, 1]) {
    const tx = s * 9.8;
    const tz = -17.5;
    mesh(g, new THREE.BoxGeometry(5.6, towerH, 5.6), stone, tx, towerH / 2, tz, shadow);
    // Terracotta cornice bands
    for (const bh of [8, 15, towerH]) {
      mesh(g, new THREE.BoxGeometry(6.1, 0.55, 6.1), redTrim, tx, bh, tz, false);
    }
    // Belfry lancet openings on all 4 faces of each tower
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2;
      const bf = mesh(
        g,
        new THREE.PlaneGeometry(4.8, 6.5),
        lam('#ffffff', tiled(lancet, 1, 1)),
        tx + Math.sin(a) * 2.83,
        towerH - 3.8,
        tz + Math.cos(a) * 2.83,
        false,
      );
      bf.rotation.y = a;
    }
    // Corner pinnacles + tall octagonal spire + cross
    for (const dx of [-2.4, 2.4]) {
      for (const dz of [-2.4, 2.4]) {
        mesh(g, new THREE.ConeGeometry(0.55, 2.6, 4).rotateY(Math.PI / 4), redTrim, tx + dx, towerH + 1.3, tz + dz, false);
      }
    }
    mesh(g, new THREE.ConeGeometry(3.1, 11.5, 8), roofMat, tx, towerH + 5.75, tz, shadow);
    mesh(g, new THREE.BoxGeometry(0.24, 2.0, 0.24), marble, tx, towerH + 12.2, tz, false);
    mesh(g, new THREE.BoxGeometry(1.1, 0.24, 0.24), marble, tx, towerH + 12.5, tz, false);
  }
}

// ---------------------------------------------------------------------------
// 3. Saddar Dawakhana (Jehangir Kothari Building / Hamdard, Zaibunnisa St)
// ---------------------------------------------------------------------------

function buildSaddarDawakhana(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const w = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 13.8;
  const stone = lam('#dfc388');
  const trim = lam('#8c583a');
  const greenWood = lam('#1b5e20');
  const tex = colonialVerandahTexture('#dfc388', '#1b5e20');

  // Main heritage block
  mesh(g, new THREE.BoxGeometry(w - 2.4, h, len), stone, -1.2, h / 2, 0, shadow);
  // Street-facing colonial verandah texture
  const front = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(tex, len / 11, 1)), w / 2 - 2.35, h / 2, 0, false);
  front.rotation.y = Math.PI / 2;

  // Projecting two-tier timber verandah balcony along Zaibunnisa St (+x)
  const vx = w / 2 - 1.1;
  for (const vy of [4.6, 9.2, 13.6]) {
    mesh(g, new THREE.BoxGeometry(2.4, 0.35, len + 0.4), trim, vx, vy, 0, shadow);
  }
  // Verandah balustrade railings
  for (const vy of [5.25, 9.85]) {
    mesh(g, new THREE.BoxGeometry(0.18, 1.0, len), greenWood, w / 2 - 0.05, vy, 0, false);
  }
  // Colonnade pillars from ground to roof
  for (let z = -len / 2 + 1.5; z <= len / 2 - 1.5; z += 4.2) {
    mesh(g, new THREE.CylinderGeometry(0.22, 0.26, h, 8), stone, w / 2 - 0.15, h / 2, z, shadow);
  }

  // Iconic chamfered corner turret with pyramidal roof & finial at the SE corner
  const tx = w / 2 - 1.8, tz = len / 2 - 1.8;
  mesh(g, new THREE.CylinderGeometry(3.2, 3.2, h + 3.5, 8), stone, tx, (h + 3.5) / 2, tz, shadow);
  mesh(g, new THREE.ConeGeometry(3.8, 3.8, 8), trim, tx, h + 3.5 + 1.9, tz, shadow);

  // Famous green & white HAMDARD / SADDAR DAWAKHANA signboards
  const sign1 = mesh(
    g,
    new THREE.PlaneGeometry(len * 0.78, 1.55),
    lam('#ffffff', signTexture(['SADDAR DAWAKHANA · صدر دواخانہ', 'HAMDARD MATAB & HERBAL DISPENSARY'], '#0b6e3a', '#ffffff', 768, 128)),
    w / 2 + 0.08,
    4.6,
    0,
    false,
  );
  sign1.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 4. Bohri Bazaar (Arched Entry Gate + Covered Canopy Arcade on Bohri Bazaar Ln)
// ---------------------------------------------------------------------------

function buildBohriBazaar(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const w = l.rect.x1 - l.rect.x0;
  const d = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const wingW = (w - 7.2) / 2;
  const h = 11.5;
  const ochre = lam('#e3c184');
  const redStone = lam('#a13d2d');
  const tex = colonialVerandahTexture('#e3c184', '#2e5d7c');

  // Left and right bazaar wings flanking the central covered lane
  for (const s of [-1, 1]) {
    const wx = s * (3.6 + wingW / 2);
    mesh(g, new THREE.BoxGeometry(wingW, h, d), ochre, wx, h / 2, 0, shadow);
    const f = mesh(g, new THREE.PlaneGeometry(wingW, h), lam('#ffffff', tiled(tex, wingW / 10, 1)), wx, h / 2, -d / 2 - 0.04, false);
    f.rotation.y = Math.PI;
  }

  // Ornate Bohri Bazaar Gateway Arch spanning the central bazaar lane at the street (-d/2)
  const gz = -d / 2 + 0.6;
  for (const s of [-1, 1]) {
    mesh(g, new THREE.BoxGeometry(1.4, 9.5, 1.4), redStone, s * 3.5, 4.75, gz, shadow);
    mesh(g, new THREE.SphereGeometry(0.85, 8, 6), lam('#f4d068'), s * 3.5, 10.0, gz, false);
  }
  // Arch lintel + stepped Indo-Saracenic crest
  mesh(g, new THREE.BoxGeometry(8.6, 2.4, 1.3), redStone, 0, 8.2, gz, shadow);
  mesh(g, new THREE.BoxGeometry(5.6, 1.2, 1.1), ochre, 0, 9.8, gz, false);
  const archSign = mesh(
    g,
    new THREE.PlaneGeometry(8.0, 1.7),
    lam('#ffffff', signTexture(['BOHRI BAZAAR · بوہری بازار', 'ESTD. 1939 · CLOTH & BANGLE MARKET'], '#8c1d18', '#ffd54f', 512, 128), true),
    0,
    8.2,
    gz - 0.7,
    false,
  );
  archSign.rotation.y = Math.PI;

  // Colorful overhead fabric shade canopies (shamiana) & hanging dupattas across the alley
  const canopyCols = ['#e53935', '#fbc02d', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00'];
  for (let i = 0; i < 6; i++) {
    const az = -d / 2 + 3.2 + i * 3.1;
    const m = mesh(
      g,
      new THREE.PlaneGeometry(7.0, 2.3),
      lam(canopyCols[i % canopyCols.length], undefined, true),
      0,
      5.4 + (i % 2) * 0.3,
      az,
      false,
    );
    m.rotation.x = Math.PI / 2 + 0.08;
  }
}

// ---------------------------------------------------------------------------
// 5. Zainab Market (Export-Surplus & Handicraft Atrium on Abdullah Haroon Rd)
// ---------------------------------------------------------------------------

function buildZainabMarket(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const d = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 13.0;
  const concrete = lam('#e5dfd3');
  const tealBand = lam('#00695c');
  const darkRecess = lam('#222629');

  // Main market block facing West (-x) onto Abdullah Haroon Road
  mesh(g, new THREE.BoxGeometry(d, h, len), concrete, 0, h / 2, 0, shadow);
  // Deep recessed ground-floor shopping arcade
  mesh(g, new THREE.BoxGeometry(1.2, 4.4, len - 3), darkRecess, -d / 2 + 0.5, 2.2, 0, false);
  // Arcade pillars + hanging blue jeans / leather jacket displays
  const rackCols = ['#1565c0', '#283593', '#4e342e', '#c62828', '#f9a825'];
  for (let z = -len / 2 + 2.5; z <= len / 2 - 2.5; z += 4.2) {
    mesh(g, new THREE.BoxGeometry(0.7, 4.5, 0.7), concrete, -d / 2 + 0.3, 2.25, z, false);
    mesh(g, new THREE.BoxGeometry(0.2, 1.8, 2.4), lam(rackCols[Math.abs(z | 0) % rackCols.length]), -d / 2 + 0.2, 2.6, z + 1.8, false);
  }
  // Upper-floor horizontal window ribbons & vertical sun fins
  for (const wy of [6.8, 10.2]) {
    mesh(g, new THREE.BoxGeometry(0.3, 1.8, len - 2), lam('#37474f'), -d / 2 - 0.05, wy, 0, false);
    mesh(g, new THREE.BoxGeometry(0.8, 0.6, len + 0.4), tealBand, -d / 2 - 0.2, wy - 1.3, 0, false);
  }

  // Stepped central entrance portal frame + large ZAINAB MARKET fascia board
  mesh(g, new THREE.BoxGeometry(1.6, h + 2.8, 14), tealBand, -d / 2 - 0.4, (h + 2.8) / 2, 0, shadow);
  const sign = mesh(
    g,
    new THREE.PlaneGeometry(len * 0.82, 2.1),
    lam('#ffffff', signTexture(['ZAINAB MARKET · زینب مارکیٹ', 'EXPORT GARMENTS · LEATHER · HANDICRAFTS'], '#004d40', '#ffeb3b', 768, 128)),
    -d / 2 - 1.25,
    4.9,
    0,
    false,
  );
  sign.rotation.y = -Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 6. Regal Chowk (1930s Building with Twin Rooftop Lions & Bridal Mannequins)
// ---------------------------------------------------------------------------

function buildRegalChowk(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const d = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 13.5;
  const stone = lam('#dfd1b4');
  const trim = lam('#9c7b54');
  const lionMat = lam('#f2ead8');
  const tex = colonialVerandahTexture('#dfd1b4', '#5c4033');

  // 1930s heritage block facing East (+x) onto Abdullah Haroon Road
  mesh(g, new THREE.BoxGeometry(d, h, len), stone, 0, h / 2, 0, shadow);
  const f = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(tex, len / 11, 1)), d / 2 + 0.04, h / 2, 0, false);
  f.rotation.y = Math.PI / 2;

  // Stepped Art Deco central roof parapet
  mesh(g, new THREE.BoxGeometry(2.2, 2.6, 14), trim, d / 2 - 0.8, h + 1.3, 0, shadow);
  mesh(g, new THREE.BoxGeometry(2.4, 1.2, 8), stone, d / 2 - 0.8, h + 3.2, 0, shadow);

  // Iconic Twin Guardian Lions atop the parapet (facing each other with a sphere)
  for (const s of [-1, 1]) {
    const lz = s * 2.6;
    const lx = d / 2 - 0.6;
    const ly = h + 3.8;
    mesh(g, new THREE.BoxGeometry(1.1, 0.4, 1.6), trim, lx, ly + 0.2, lz, false); // plinth
    mesh(g, new THREE.BoxGeometry(0.8, 1.1, 1.2), lionMat, lx, ly + 0.95, lz, shadow); // body
    mesh(g, new THREE.SphereGeometry(0.55, 8, 6), lionMat, lx, ly + 1.7, lz - s * 0.35, shadow); // mane/head
    mesh(g, new THREE.SphereGeometry(0.25, 6, 6), trim, lx + 0.2, ly + 0.55, lz - s * 0.65, false); // ball under paw
  }

  // Signboards: REGAL CHOWK ELECTRONICS & BRIDAL MARKET
  const sign = mesh(
    g,
    new THREE.PlaneGeometry(len * 0.76, 1.65),
    lam('#ffffff', signTexture(['REGAL CHOWK · ریگل چوک', 'REGAL ELECTRONICS & BRIDAL EMPORIUM'], '#1a237e', '#ffd54f', 768, 128)),
    d / 2 + 0.12,
    4.5,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;

  // Congregation of brightly dressed bridal mannequins along the veranda edge
  const bridalCols = ['#d50000', '#ad1457', '#ff8f00', '#2e7d32', '#6a1b9a', '#c62828'];
  for (let i = 0; i < 10; i++) {
    const mz = -len / 2 + 4 + i * ((len - 8) / 9);
    const col = bridalCols[i % bridalCols.length];
    mesh(g, new THREE.ConeGeometry(0.38, 1.35, 7), lam(col), d / 2 + 0.65, 0.68, mz, false);
    mesh(g, new THREE.SphereGeometry(0.14, 6, 5), lam('#e0c8a8'), d / 2 + 0.65, 1.52, mz, false);
  }
}

// ---------------------------------------------------------------------------
// 7. Paradise Cinema (Art Deco Streamlined Hall + Neon Fin on Zaibunnisa St)
// ---------------------------------------------------------------------------

function buildParadiseCinema(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const d = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 13.5;
  const cream = lam('#f4ebd9');
  const coral = lam('#c63d2f');
  const teal = lam('#00838f');
  const gold = basic('#ffd600');

  // Art Deco auditorium hall facing East (+x)
  mesh(g, new THREE.BoxGeometry(d, h, len), cream, 0, h / 2, 0, shadow);
  // Stepped Art Deco horizontal speed-bands & central vertical pilaster ribs
  for (const by of [4.2, 8.8, 12.6]) {
    mesh(g, new THREE.BoxGeometry(0.6, 0.45, len + 0.4), coral, d / 2 + 0.1, by, 0, false);
  }
  for (let z = -6; z <= 6; z += 3) {
    mesh(g, new THREE.BoxGeometry(0.7, h + 1.5, 0.55), teal, d / 2 + 0.15, (h + 1.5) / 2, z, false);
  }

  // Sweeping cantilevered Art Deco marquee canopy over the entrance
  mesh(g, new THREE.BoxGeometry(3.8, 0.9, 18), coral, d / 2 + 1.6, 4.0, 0, shadow);
  mesh(g, new THREE.BoxGeometry(4.0, 0.3, 18.4), gold, d / 2 + 1.6, 4.0, 0, false);

  // Tall vertical neon fin sign spelling PARADISE
  mesh(g, new THREE.BoxGeometry(2.4, 9.5, 1.1), coral, d / 2 + 0.8, h + 3.2, 0, shadow);
  const finSign = mesh(
    g,
    new THREE.PlaneGeometry(2.2, 9.0),
    basic('#ffffff', signTexture(['P', 'A', 'R', 'A', 'D', 'I', 'S', 'E'], '#b71c1c', '#ffff00', 128, 512), true),
    d / 2 + 0.8,
    h + 3.2,
    0.58,
    false,
  );
  void finSign;
  const finSignBack = finSign.clone();
  finSignBack.position.z = -0.58;
  finSignBack.rotation.y = Math.PI;
  g.add(finSignBack);

  // Hand-painted movie hoarding billboard above the marquee
  const poster = mesh(
    g,
    new THREE.PlaneGeometry(16, 5.6),
    lam('#ffffff', cinemaPosterTexture(0)),
    d / 2 + 0.55,
    8.2,
    0,
    false,
  );
  poster.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 8. Capri Cinema (1968 Modernist Brise-Soleil & Hoarding on M.A. Jinnah Rd)
// ---------------------------------------------------------------------------

function buildCapriCinema(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const w = l.rect.x1 - l.rect.x0;
  const d = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 14.0;
  const concrete = lam('#dcd6c8');
  const darkGlass = lam('#263238');
  const finMat = lam('#f0ece1');
  const accent = lam('#b71c1c');

  // 1968 Modernist cinema box facing North (+z in sim -> -z in Three space)
  mesh(g, new THREE.BoxGeometry(w, h, d), concrete, 0, h / 2, 0, shadow);
  mesh(g, new THREE.BoxGeometry(w - 3, 7.5, 0.5), darkGlass, 0, 8.8, -d / 2 - 0.05, false);

  // Signature angled vertical concrete sun-breaker fins (brise-soleil) across the facade
  const fins: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 2.2; x <= w / 2 - 2.2; x += 2.1) {
    const fg = new THREE.BoxGeometry(0.28, 7.8, 1.3);
    fg.rotateY(0.32);
    fg.translate(x, 8.8, -d / 2 - 0.55);
    fins.push(fg);
  }
  const mergedFins = mergeGeometries(fins);
  if (mergedFins) mesh(g, mergedFins, finMat, 0, 0, 0, shadow);

  // Cantilevered modernist porch canopy & CAPRI 70MM fascia
  mesh(g, new THREE.BoxGeometry(w - 4, 1.1, 3.8), accent, 0, 4.2, -d / 2 - 1.6, shadow);
  const fascia = mesh(
    g,
    new THREE.PlaneGeometry(w - 6, 1.2),
    lam('#ffffff', signTexture(['CAPRI CINEMA · 70MM · کیپری سینما'], '#b71c1c', '#ffffff', 768, 96)),
    0,
    4.2,
    -d / 2 - 3.55,
    false,
  );
  fascia.rotation.y = Math.PI;

  // Giant hand-painted Lollywood hoarding billboard mounted above the porch
  const hoarding = mesh(
    g,
    new THREE.PlaneGeometry(18, 6.2),
    lam('#ffffff', cinemaPosterTexture(1)),
    0,
    8.6,
    -d / 2 - 1.35,
    false,
  );
  hoarding.rotation.y = Math.PI;
}

// ---------------------------------------------------------------------------
// 9. Jahangir Park (Walled Green Park + Sandstone Pavilion on Raja Ghazanfar)
// ---------------------------------------------------------------------------

function buildJahangirPark(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const w = l.rect.x1 - l.rect.x0;
  const d = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const stone = lam('#d8b474');
  const roofMat = lam('#8e3b2e');
  const iron = lam('#1e2224');

  // Lush park lawn covering the entire block + sandstone cross pathways
  const lawn = mesh(g, new THREE.PlaneGeometry(w - 0.8, d - 0.8), lam('#6e9648'), 0, 0.02, 0, false);
  lawn.rotation.x = -Math.PI / 2;
  const pathEW = mesh(g, new THREE.PlaneGeometry(w - 2, 5.5), lam('#dfd5c0'), 0, 0.035, 0, false);
  pathEW.rotation.x = -Math.PI / 2;
  const pathNS = mesh(g, new THREE.PlaneGeometry(5.5, d - 2), lam('#dfd5c0'), 0, 0.035, 0, false);
  pathNS.rotation.x = -Math.PI / 2;

  // Perimeter low sandstone wall + wrought-iron railing with open gates on East & South
  for (const s of [-1, 1]) {
    // East & West walls (split in middle for gate)
    const halfD = (d - 10) / 2;
    for (const zs of [-1, 1]) {
      const wz = zs * (5 + halfD / 2);
      mesh(g, new THREE.BoxGeometry(0.45, 0.75, halfD), stone, s * (w / 2 - 0.25), 0.375, wz, false);
      mesh(g, new THREE.BoxGeometry(0.12, 0.95, halfD), iron, s * (w / 2 - 0.25), 1.2, wz, false);
    }
    // North & South walls
    const halfW = (w - 10) / 2;
    for (const xs of [-1, 1]) {
      const wx = xs * (5 + halfW / 2);
      mesh(g, new THREE.BoxGeometry(halfW, 0.75, 0.45), stone, wx, 0.375, s * (d / 2 - 0.25), false);
      mesh(g, new THREE.BoxGeometry(halfW, 0.95, 0.12), iron, wx, 1.2, s * (d / 2 - 0.25), false);
    }
  }

  // Main Park Gate Arch on Raja Ghazanfar Ali Road (+x)
  for (const zs of [-1, 1]) {
    mesh(g, new THREE.BoxGeometry(1.2, 3.8, 1.2), stone, w / 2 - 0.4, 1.9, zs * 4.6, shadow);
  }
  const gateSign = mesh(
    g,
    new THREE.PlaneGeometry(10.2, 1.4),
    lam('#ffffff', signTexture(['JAHANGIR PARK · جہانگیر پارک', 'PUBLIC GARDENS · ESTD. 1893'], '#1b5e20', '#ffffff', 512, 128), true),
    w / 2 - 0.4,
    4.3,
    0,
    false,
  );
  gateSign.rotation.y = Math.PI / 2;

  // Central Colonial Octagonal Sandstone Pavilion / Bandstand
  mesh(g, new THREE.CylinderGeometry(6.8, 7.2, 0.9, 8), stone, 0, 0.45, 0, shadow);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    mesh(g, new THREE.CylinderGeometry(0.32, 0.38, 4.6, 8), stone, Math.cos(a) * 5.2, 3.2, Math.sin(a) * 5.2, shadow);
  }
  mesh(g, new THREE.CylinderGeometry(7.4, 7.8, 0.6, 8), stone, 0, 5.7, 0, shadow);
  mesh(g, new THREE.SphereGeometry(5.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), roofMat, 0, 6.0, 0, shadow);
  mesh(g, new THREE.CylinderGeometry(0.15, 0.35, 1.8, 6), stone, 0, 12.2, 0, false);

  // Dense ring of neem & banyan trees inside the park
  const trunkMat = lam('#6b5440');
  const leafMat = lam('#487532');
  for (const tx of [-w * 0.3, w * 0.3]) {
    for (const tz of [-d * 0.32, -d * 0.14, d * 0.14, d * 0.32]) {
      mesh(g, new THREE.CylinderGeometry(0.24, 0.35, 3.5, 6), trunkMat, tx, 1.75, tz, shadow);
      mesh(g, new THREE.IcosahedronGeometry(3.2, 0), leafMat, tx, 4.8, tz, shadow);
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Pakistan Chowk (Public Square + Stone Obelisk Monument on Kutchery Rd)
// ---------------------------------------------------------------------------

function buildPakistanChowk(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const zFront = -l.rect.z0; // South edge on Kutchery Rd (+z in Three space)
  const w = l.rect.x1 - l.rect.x0;
  const d = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, zFront);
  group.add(g);

  const stone = lam('#dfd0b0');
  const obeliskMat = lam('#f0e8d5');
  const redPlinth = lam('#8e3b30');
  const tex = colonialVerandahTexture('#dfd0b0', '#2b5468');

  // Paved heritage square
  const plaza = mesh(g, new THREE.PlaneGeometry(24, d), lam('#d5ccb8'), 0, 0.02, -d / 2, false);
  plaza.rotation.x = -Math.PI / 2;

  // Flanking colonial heritage buildings with carved timber balconies
  const wingW = (w - 24) / 2;
  const h = 13.0;
  for (const s of [-1, 1]) {
    const wx = s * (12 + wingW / 2);
    mesh(g, new THREE.BoxGeometry(wingW, h, d - 2), stone, wx, h / 2, -d / 2 - 1, shadow);
    const f = mesh(g, new THREE.PlaneGeometry(wingW, h), lam('#ffffff', tiled(tex, wingW / 10, 1)), wx, h / 2, -2 + 0.05, false);
    void f;
    const inner = mesh(g, new THREE.PlaneGeometry(d - 2, h), lam('#ffffff', tiled(tex, (d - 2) / 10, 1)), s * 12 - s * 0.05, h / 2, -d / 2 - 1, false);
    inner.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
  }

  // Iconic Pakistan Chowk Obelisk Monument in the centre of the square (z = -7.8)
  const oz = -7.8;
  mesh(g, new THREE.BoxGeometry(5.6, 0.7, 5.6), redPlinth, 0, 0.35, oz, shadow);
  mesh(g, new THREE.BoxGeometry(4.2, 1.1, 4.2), stone, 0, 1.25, oz, shadow);
  mesh(g, new THREE.BoxGeometry(2.6, 2.2, 2.6), obeliskMat, 0, 2.9, oz, shadow);
  // Tapered four-sided obelisk shaft + pyramidion tip
  const shaft = new THREE.CylinderGeometry(0.55, 1.25, 9.5, 4);
  shaft.rotateY(Math.PI / 4);
  mesh(g, shaft, obeliskMat, 0, 8.75, oz, shadow);
  const tip = new THREE.ConeGeometry(0.55, 1.4, 4);
  tip.rotateY(Math.PI / 4);
  mesh(g, tip, lam('#d4af37'), 0, 14.2, oz, false);

  // Heritage plaque sign
  mesh(
    g,
    new THREE.PlaneGeometry(7.2, 1.2),
    lam('#ffffff', signTexture(['PAKISTAN CHOWK · پاکستان چوک', 'HISTORIC CULTURAL SQUARE'], '#263238', '#ffd54f', 512, 96), true),
    0,
    2.4,
    oz + 1.35,
    false,
  );
}

// ---------------------------------------------------------------------------
// 11. Burns Road Food Street (Lattice Balconies, Degh Cauldrons & Neon Signs)
// ---------------------------------------------------------------------------

function buildBurnsRoad(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const d = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 15.0;
  const wall = lam('#e6cb94');
  const tex = colonialVerandahTexture('#e6cb94', '#00695c');
  const copper = lam('#c86d3b');
  const awningMat = lam('#ffffff', stripesTexture('#c62828', '#ffd600'));

  // Historic colonial residential/food-street block facing West (-x) onto Dr Daud Pota Rd
  mesh(g, new THREE.BoxGeometry(d, h, len), wall, 0, h / 2, 0, shadow);
  const f = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(tex, len / 10, 1)), -d / 2 - 0.04, h / 2, 0, false);
  f.rotation.y = -Math.PI / 2;

  // Projecting teal & blue wooden lattice jharoka balconies on upper floors
  const balCols = ['#00695c', '#1565c0', '#2e7d32', '#6a1b9a'];
  for (let i = 0; i < 6; i++) {
    const bz = -len / 2 + 5 + i * 8.5;
    const bm = lam(balCols[i % balCols.length]);
    mesh(g, new THREE.BoxGeometry(1.4, 2.6, 5.2), bm, -d / 2 - 0.65, 7.2, bz, shadow);
    mesh(g, new THREE.BoxGeometry(1.4, 2.6, 5.2), bm, -d / 2 - 0.65, 11.4, bz, shadow);
  }

  // Red-and-gold striped restaurant awnings + steaming copper Biryani Degh cauldrons
  const awning = mesh(g, new THREE.BoxGeometry(2.6, 0.35, len - 2), awningMat, -d / 2 - 1.2, 3.5, 0, false);
  void awning;
  for (let z = -len / 2 + 4; z <= len / 2 - 4; z += 5.5) {
    // Brick tandoor / stove base + round copper degh pot
    mesh(g, new THREE.BoxGeometry(1.1, 0.75, 1.1), lam('#8d3b29'), -d / 2 - 1.1, 0.375, z, false);
    mesh(g, new THREE.SphereGeometry(0.58, 10, 8), copper, -d / 2 - 1.1, 1.15, z, shadow);
    mesh(g, new THREE.CylinderGeometry(0.42, 0.48, 0.18, 10), copper, -d / 2 - 1.1, 1.7, z, false);
  }

  // Iconic Burns Road Food Street signboards
  const mainSign = mesh(
    g,
    new THREE.PlaneGeometry(len * 0.85, 1.85),
    lam('#ffffff', signTexture(['BURNS ROAD FOOD STREET · برنس روڈ فوڈ اسٹریٹ', 'WAHEED KABAB · NIHARI · FRESCO DAHI BARAY · HALEEM'], '#b71c1c', '#ffeb3b', 768, 128)),
    -d / 2 - 0.25,
    4.7,
    0,
    false,
  );
  mainSign.rotation.y = -Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 12. Sindh Secretariat (Tughlaq House & Colonial Barracks on Strachen Rd)
// ---------------------------------------------------------------------------

function buildSindhSecretariat(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const zFront = -l.rect.z0; // South edge facing Strachen Rd (+z in Three space)
  const w = l.rect.x1 - l.rect.x0;
  const d = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, zFront);
  group.add(g);

  const white = lam('#f4f2ec');
  const buff = lam('#d9ccb2');
  const green = lam('#01411c');
  const redRoof = lam('#963d2f');

  // Forecourt lawn & security perimeter fence with white sentry booths
  const lawn = mesh(g, new THREE.PlaneGeometry(w, 7.5), lam('#769650'), 0, 0.02, -3.75, false);
  lawn.rotation.x = -Math.PI / 2;
  for (const s of [-1, 1]) {
    const segW = (w - 10) / 2;
    mesh(g, new THREE.BoxGeometry(segW, 1.8, 0.2), lam('#222629'), s * (5 + segW / 2), 0.9, -0.2, false);
    // Sentry guard booth
    mesh(g, new THREE.BoxGeometry(2.0, 2.8, 2.0), white, s * 5.2, 1.4, -0.8, shadow);
    mesh(g, new THREE.BoxGeometry(2.3, 0.35, 2.3), green, s * 5.2, 2.95, -0.8, false);
  }

  // Imposing 5-storey Tughlaq House / Sindh Secretariat main block (z = -7 to -d)
  const bodyD = d - 8;
  const bodyH = 17.5;
  const bodyZ = -7 - bodyD / 2;
  mesh(g, new THREE.BoxGeometry(w - 4, bodyH, bodyD), white, 0, bodyH / 2, bodyZ, shadow);
  // Horizontal window bands & green Government of Sindh frieze
  for (let y = 3.5; y < bodyH - 1; y += 3.3) {
    mesh(g, new THREE.BoxGeometry(w - 3.6, 1.3, bodyD + 0.1), lam('#37474f'), 0, y, bodyZ, false);
    mesh(g, new THREE.BoxGeometry(w - 3.4, 0.4, bodyD + 0.2), buff, 0, y - 0.85, bodyZ, false);
  }
  mesh(g, new THREE.BoxGeometry(w - 3.2, 1.2, bodyD + 0.3), green, 0, bodyH - 0.6, bodyZ, false);

  // Projecting neoclassical 4-column central portico
  mesh(g, new THREE.BoxGeometry(14, bodyH + 1.5, 3.2), buff, 0, (bodyH + 1.5) / 2, -7 + 1.2, shadow);
  for (const px of [-5.2, -1.8, 1.8, 5.2]) {
    mesh(g, new THREE.CylinderGeometry(0.45, 0.52, bodyH, 10), white, px, bodyH / 2, -7 + 2.9, shadow);
  }
  // Rooftop flagpole + Pakistani flag
  mesh(g, new THREE.CylinderGeometry(0.08, 0.1, 6.5, 6), lam('#999999'), 0, bodyH + 1.5 + 3.25, -7 + 1.2, false);
  mesh(g, new THREE.PlaneGeometry(3.4, 2.2), lam('#01411c', undefined, true), 1.7, bodyH + 6.8, -7 + 1.2, false);
  mesh(g, new THREE.PlaneGeometry(0.85, 2.2), lam('#ffffff', undefined, true), 0.42, bodyH + 6.8, -7 + 1.22, false);

  // Red-tiled colonial barrack roofs on the flanking wings
  for (const s of [-1, 1]) {
    const roof = new THREE.ConeGeometry(4.5, 12, 3);
    roof.rotateZ(Math.PI / 2);
    roof.scale(1, 0.45, 1);
    mesh(g, roof, redRoof, s * (w / 2 - 7), bodyH + 1.2, bodyZ, false);
  }

  // Official green Sindh Secretariat signboard over the portico
  mesh(
    g,
    new THREE.PlaneGeometry(13.5, 1.7),
    lam('#ffffff', signTexture(['SINDH SECRETARIAT · سندھ سیکریٹریٹ', 'GOVERNMENT OF SINDH · TUGHLAQ HOUSE'], '#01411c', '#ffffff', 768, 128)),
    0,
    5.2,
    -7 + 2.95,
    false,
  );
}

// ---------------------------------------------------------------------------
// 13. Cantt Station Bus Stop (Colonial Arched Station + Minibus Terminal)
// ---------------------------------------------------------------------------

function buildCanttStation(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const d = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const stone = lam('#d6b26d');
  const darkStone = lam('#9e783c');
  const green = lam('#0b6e3a');
  const yellow = lam('#fbc02d');
  const wallTex = gothicWallTexture();

  // Colonial Karachi Cantonment Railway Station building set back 7 m from the kerb
  const stD = d - 7;
  const stH = 12.5;
  const stX = -7 / 2;
  mesh(g, new THREE.BoxGeometry(stD, stH, len), stone, stX, stH / 2, 0, shadow);
  const front = mesh(
    g,
    new THREE.PlaneGeometry(len, stH),
    lam('#ffffff', tiled(wallTex, len / 12, 1)),
    stX + stD / 2 + 0.05,
    stH / 2,
    0,
    false,
  );
  front.rotation.y = Math.PI / 2;

  // Projecting central station clock/crest pediment & twin corner turrets
  const pedX = stX + stD / 2 + 0.8;
  mesh(g, new THREE.BoxGeometry(2.4, stH + 4.5, 12), darkStone, pedX, (stH + 4.5) / 2, 0, shadow);
  for (const s of [-1, 1]) {
    mesh(g, new THREE.BoxGeometry(2.2, stH + 6.5, 2.2), darkStone, pedX, (stH + 6.5) / 2, s * 6.2, shadow);
    mesh(g, new THREE.SphereGeometry(1.3, 8, 6), lam('#f4efe4'), pedX, stH + 7.1, s * 6.2, false);
  }
  const stSign = mesh(
    g,
    new THREE.PlaneGeometry(11.5, 1.6),
    lam('#ffffff', signTexture(['KARACHI CANTT RAILWAY STATION · کینٹ اسٹیشن', 'PAKISTAN RAILWAYS · ESTD. 1898'], '#01411c', '#ffd54f', 768, 128)),
    pedX + 1.25,
    stH + 2.2,
    0,
    false,
  );
  stSign.rotation.y = Math.PI / 2;

  // Bustling W-11 Minibus & Coach Terminal Shelter along the Sarwar Shaheed Rd kerb (+x)
  const bx = d / 2 - 2.6;
  const shelterLen = len * 0.72;
  for (let z = -shelterLen / 2 + 2; z <= shelterLen / 2 - 2; z += 5.5) {
    mesh(g, new THREE.CylinderGeometry(0.16, 0.18, 3.8, 8), green, bx, 1.9, z, shadow);
    // Waiting bench
    mesh(g, new THREE.BoxGeometry(0.7, 0.5, 2.4), yellow, bx - 0.5, 0.45, z, false);
  }
  // Arched green-and-yellow bus terminal roof canopy + route boards
  mesh(g, new THREE.BoxGeometry(3.8, 0.4, shelterLen), green, bx, 3.9, 0, shadow);
  mesh(g, new THREE.BoxGeometry(4.0, 0.22, shelterLen + 0.2), yellow, bx, 4.15, 0, false);
  const busSign = mesh(
    g,
    new THREE.PlaneGeometry(shelterLen * 0.85, 1.15),
    lam('#ffffff', signTexture(['CANTT STATION BUS STOP · W-11 · D-7 · SADDAR COACH TERMINAL'], '#ffd600', '#111111', 768, 96)),
    bx + 1.95,
    4.65,
    0,
    false,
  );
  busSign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 14. Lucky Star Hotel (Chamfered Corner Hotel + Rooftop Star on Sarwar Shaheed)
// ---------------------------------------------------------------------------

function buildLuckyStarHotel(group: THREE.Group, l: LocalLandmark, shadow: boolean): void {
  const g = new THREE.Group();
  const cx = (l.rect.x0 + l.rect.x1) / 2;
  const cz = -(l.rect.z0 + l.rect.z1) / 2;
  const d = l.rect.x1 - l.rect.x0;
  const len = l.rect.z1 - l.rect.z0;
  g.position.set(cx, KERB_H, cz);
  group.add(g);

  const h = 18.0;
  const cream = lam('#f2eadb');
  const terracotta = lam('#b8432e');
  const blueGlass = lam('#2c4c64');
  const starGold = basic('#ffea00', undefined, true);

  // 5-storey mid-century hotel block facing East (+x) & North (-z, Club Rd corner)
  mesh(g, new THREE.BoxGeometry(d - 2, h, len - 2), cream, -1, h / 2, 1, shadow);
  // Iconic rounded/chamfered corner tower at the NE intersection (x = +d/2, z = -len/2)
  const tx = d / 2 - 3.5, tz = -len / 2 + 3.5;
  mesh(g, new THREE.CylinderGeometry(4.8, 4.8, h + 2.2, 12), cream, tx, (h + 2.2) / 2, tz, shadow);

  // Wrap-around horizontal balcony slabs & terracotta railings on every floor
  for (let y = 4.0; y <= h; y += 3.4) {
    mesh(g, new THREE.BoxGeometry(d, 0.35, len), cream, 0, y, 0, false);
    mesh(g, new THREE.BoxGeometry(d + 0.15, 0.85, len + 0.15), terracotta, 0, y + 0.55, 0, false);
    mesh(g, new THREE.CylinderGeometry(5.1, 5.1, 0.85, 12), terracotta, tx, y + 0.55, tz, false);
    if (y < h) {
      mesh(g, new THREE.CylinderGeometry(4.88, 4.88, 1.5, 12), blueGlass, tx, y + 2.1, tz, false);
    }
  }

  // Rooftop steel frame + giant glowing 5-pointed Star & LUCKY STAR HOTEL sign
  const rY = h + 2.2;
  mesh(g, new THREE.CylinderGeometry(0.2, 0.25, 6.5, 6), lam('#555555'), tx, rY + 3.25, tz, false);

  // 5-pointed star geometry
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 3.2 : 1.3;
    const sx = Math.cos(a) * r, sy = Math.sin(a) * r;
    if (i === 0) starShape.moveTo(sx, sy);
    else starShape.lineTo(sx, sy);
  }
  starShape.closePath();
  const starMesh = mesh(g, new THREE.ShapeGeometry(starShape), starGold, tx, rY + 6.8, tz, false);
  starMesh.rotation.y = Math.PI / 4;

  // Rooftop & ground-floor hotel cafe signage
  const roofSign = mesh(
    g,
    new THREE.PlaneGeometry(14, 2.2),
    basic('#ffffff', signTexture(['★ LUCKY STAR HOTEL ★', 'لکی اسٹار ہوٹل اینڈ کیفے'], '#880e4f', '#ffea00', 512, 128), true),
    d / 2 - 0.4,
    h + 1.8,
    2,
    false,
  );
  roofSign.rotation.y = Math.PI / 2;

  const cafeSign = mesh(
    g,
    new THREE.PlaneGeometry(len * 0.7, 1.4),
    lam('#ffffff', signTexture(['LUCKY STAR HOTEL · CHAI & BIRYANI'], '#b71c1c', '#ffffff', 512, 96)),
    d / 2 + 0.15,
    3.6,
    2,
    false,
  );
  cafeSign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 15. Sindh High Court (1929 Red Jodhpur Sandstone Colonnade & Twin Cupolas)
// ---------------------------------------------------------------------------

function buildSindhHighCourt(group: THREE.Group, hw: number, hl: number, shadow: boolean): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 15.5;
  const redStone = lam('#b85d47');
  const buffStone = lam('#dfc392');
  const domeMat = lam('#e8d8b8');
  const tex = colonialVerandahTexture('#b85d47', '#4a2518');

  // Main sandstone judicial block set back behind a ceremonial forecourt
  mesh(g, new THREE.BoxGeometry(d - 4, h, len), redStone, -2, h / 2, 0, shadow);
  const f = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(tex, len / 10, 1)), hw - 3.95, h / 2, 0, false);
  f.rotation.y = Math.PI / 2;

  // Grand neoclassical portico with 6 tall Corinthian sandstone columns + triangular pediment
  const px = hw - 2.0;
  for (let z = -7.5; z <= 7.5; z += 3.0) {
    mesh(g, new THREE.CylinderGeometry(0.42, 0.5, h - 1.5, 10), buffStone, px, (h - 1.5) / 2, z, shadow);
  }
  mesh(g, new THREE.BoxGeometry(3.8, 1.6, 17.5), buffStone, px - 0.6, h - 0.4, 0, shadow);

  // Twin corner pavilion towers topped with Indo-Saracenic chhatri cupolas
  for (const s of [-1, 1]) {
    const tz = s * (hl - 3.2);
    mesh(g, new THREE.BoxGeometry(6.5, h + 3.5, 6.5), redStone, hw - 3.5, (h + 3.5) / 2, tz, shadow);
    mesh(g, new THREE.CylinderGeometry(2.4, 2.4, 2.6, 8), buffStone, hw - 3.5, h + 4.8, tz, shadow);
    mesh(g, new THREE.SphereGeometry(2.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, hw - 3.5, h + 6.1, tz, shadow);
  }

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(15.5, 1.6),
    lam('#ffffff', signTexture(['SINDH HIGH COURT · سندھ ہائی کورٹ', 'HIGH COURT OF SINDH AT KARACHI · ESTD. 1929'], '#01411c', '#ffd54f', 768, 128)),
    px + 0.45,
    h - 0.4,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 16. Karachi Grammar School (1854 Gothic Sandstone Quadrangle at Depot Lines)
// ---------------------------------------------------------------------------

function buildKarachiGrammarSchool(group: THREE.Group, hw: number, hl: number, shadow: boolean): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 11.5;
  const stone = lam('#d8b878');
  const darkStone = lam('#a68246');
  const redRoof = lam('#8e3b2e');
  const wallTex = gothicWallTexture();

  // Main Gothic Revival stone wing + pitched tile roof
  mesh(g, new THREE.BoxGeometry(d - 3, h, len), stone, -1.5, h / 2, 0, shadow);
  const f = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(wallTex, len / 10, 1)), hw - 2.95, h / 2, 0, false);
  f.rotation.y = Math.PI / 2;
  const roof = new THREE.CylinderGeometry((d - 3) * 0.42, (d - 3) * 0.42, len, 3);
  roof.rotateX(Math.PI / 2);
  roof.rotateZ(Math.PI / 2);
  roof.scale(1, 0.48, 1);
  mesh(g, roof, redRoof, -1.5, h + 1.8, 0, shadow);

  // Central bell-gable tower over entrance arch
  mesh(g, new THREE.BoxGeometry(4.5, h + 5.5, 6.8), darkStone, hw - 2.2, (h + 5.5) / 2, 0, shadow);
  mesh(g, new THREE.ConeGeometry(4.2, 4.2, 4).rotateY(Math.PI / 4), redRoof, hw - 2.2, h + 7.6, 0, shadow);

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(16, 1.5),
    lam('#ffffff', signTexture(['KARACHI GRAMMAR SCHOOL · کراچی گرامر اسکول', 'INDUSTRIA ET PROBITE · FOUNDED 1847'], '#1a237e', '#ffd54f', 768, 128)),
    hw + 0.08,
    4.6,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 17. Karachi Press Club (Heritage Colonial Bungalow & Lawn Forecourt)
// ---------------------------------------------------------------------------

function buildKarachiPressClub(group: THREE.Group, hw: number, hl: number, shadow: boolean): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 9.2;
  const white = lam('#f5f3ec');
  const stone = lam('#d6be8c');
  const redRoof = lam('#9c3b2e');

  // Forecourt green lawn
  const lawn = mesh(g, new THREE.PlaneGeometry(5.5, len - 1), lam('#6e9648'), hw - 2.8, 0.03, 0, false);
  lawn.rotation.x = -Math.PI / 2;

  // Whitewashed colonial press club pavilion + arched verandah + hipped red tile roof
  mesh(g, new THREE.BoxGeometry(d - 5.5, h, len - 1.5), white, -2.75, h / 2, 0, shadow);
  mesh(g, new THREE.BoxGeometry(2.2, 4.4, len - 2), stone, hw - 4.5, 2.2, 0, shadow);
  mesh(g, new THREE.ConeGeometry(Math.hypot(hw - 2, hl - 1) * 0.78, 3.8, 4).rotateY(Math.PI / 4), redRoof, -2.0, h + 1.9, 0, shadow);

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(14.5, 1.5),
    lam('#ffffff', signTexture(['KARACHI PRESS CLUB · کراچی پریس کلب', 'ESTD. 1958 · SARWAR SHAHEED ROAD'], '#0d47a1', '#ffffff', 768, 128)),
    hw - 0.2,
    3.6,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 18. Historic YMCA (1913 Gizri Sandstone Pavilion & Corner Turrets)
// ---------------------------------------------------------------------------

function buildHistoricYmca(group: THREE.Group, hw: number, hl: number, shadow: boolean): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 11.8;
  const stone = lam('#dec286');
  const redTrim = lam('#a63a2b');
  const tex = colonialVerandahTexture('#dec286', '#7a2b20');

  mesh(g, new THREE.BoxGeometry(d - 2, h, len), stone, -1, h / 2, 0, shadow);
  const f = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(tex, len / 10, 1)), hw - 1.95, h / 2, 0, false);
  f.rotation.y = Math.PI / 2;

  // Twin corner towers with red pyramidal roofs
  for (const s of [-1, 1]) {
    mesh(g, new THREE.BoxGeometry(4.4, h + 3.0, 4.4), stone, hw - 2.2, (h + 3.0) / 2, s * (hl - 2.2), shadow);
    mesh(g, new THREE.ConeGeometry(3.4, 2.8, 4).rotateY(Math.PI / 4), redTrim, hw - 2.2, h + 4.4, s * (hl - 2.2), shadow);
  }

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(15, 1.5),
    lam('#ffffff', signTexture(['HISTORIC Y.M.C.A. KARACHI · 1913', 'AIWAN-E-SADDAR ROAD · HERITAGE PAVILION'], '#b71c1c', '#ffffff', 768, 128)),
    hw + 0.08,
    4.6,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 19. Preedy Police Station (Colonial Stone Thana + Sindh Police Signage)
// ---------------------------------------------------------------------------

function buildPreedyPoliceStation(group: THREE.Group, hw: number, hl: number, shadow: boolean): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 10.8;
  const stone = lam('#d9be86');
  const policeBlue = lam('#0d2b6b');
  const policeRed = lam('#c62828');
  const tex = colonialVerandahTexture('#d9be86', '#0d2b6b');

  mesh(g, new THREE.BoxGeometry(d - 2, h, len), stone, -1, h / 2, 0, shadow);
  const f = mesh(g, new THREE.PlaneGeometry(len, h), lam('#ffffff', tiled(tex, len / 10, 1)), hw - 1.95, h / 2, 0, false);
  f.rotation.y = Math.PI / 2;

  // Red & dark-blue Sindh Police stripe band across the facade + rooftop radio mast
  mesh(g, new THREE.BoxGeometry(0.4, 0.7, len + 0.2), policeBlue, hw - 1.75, 4.2, 0, false);
  mesh(g, new THREE.BoxGeometry(0.42, 0.35, len + 0.2), policeRed, hw - 1.74, 3.7, 0, false);
  mesh(g, new THREE.CylinderGeometry(0.12, 0.28, 9.5, 6), lam('#78909c'), -1, h + 4.75, 0, false);

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(15.5, 1.55),
    lam('#ffffff', signTexture(['PREEDY POLICE STATION · تھانہ پریڈی', 'SINDH POLICE · DISTRICT SOUTH SADDAR'], '#0d2b6b', '#ffffff', 768, 128)),
    hw + 0.08,
    4.9,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 20. Passport Office Saddar (Government Block + Green Canopy Queue Shelter)
// ---------------------------------------------------------------------------

function buildPassportOffice(group: THREE.Group, hw: number, hl: number, shadow: boolean): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 14.5;
  const cream = lam('#f0ece1');
  const green = lam('#01411c');

  mesh(g, new THREE.BoxGeometry(d - 3, h, len), cream, -1.5, h / 2, 0, shadow);
  for (let y = 3.6; y < h; y += 3.4) {
    mesh(g, new THREE.BoxGeometry(0.35, 1.2, len - 1.5), lam('#263238'), hw - 2.95, y + 1.2, 0, false);
    mesh(g, new THREE.BoxGeometry(0.5, 0.4, len + 0.2), green, hw - 2.9, y, 0, false);
  }
  // Shaded green applicant queue canopy in front
  mesh(g, new THREE.BoxGeometry(3.2, 0.35, len * 0.75), green, hw - 1.4, 3.6, 0, shadow);

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(15.5, 1.55),
    lam('#ffffff', signTexture(['REGIONAL PASSPORT OFFICE SADDAR', 'پاسپورٹ آفس صدر · GOVT. OF PAKISTAN'], '#01411c', '#ffffff', 768, 128)),
    hw + 0.1,
    4.6,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 21–26. Iconic Saddar Commercial Plazas & Malls (Rainbow, Atrium, Gul, Tibet, Panorama, Madina)
// ---------------------------------------------------------------------------

interface PlazaStyle {
  title: string;
  sub: string;
  wall: string;
  band: string;
  accent: string;
  signBg: string;
  signFg: string;
  storeys: number;
  rainbow?: boolean;
  glassAtrium?: boolean;
}

function buildCommercialPlaza(group: THREE.Group, hw: number, hl: number, shadow: boolean, style: PlazaStyle): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 4.2 + style.storeys * 3.1;
  const wallMat = lam(style.wall);
  const bandMat = lam(style.band);
  const accentMat = lam(style.accent);
  const glassMat = lam('#1e3342');

  // Main multi-storey commercial complex body
  mesh(g, new THREE.BoxGeometry(d, h, len), wallMat, 0, h / 2, 0, shadow);
  // Recessed ground-floor shopping arcade
  mesh(g, new THREE.BoxGeometry(1.6, 3.8, len - 2), lam('#1a1d20'), hw - 0.75, 1.9, 0, false);

  // Horizontal window ribbons and spandrel bands on every floor
  const rainbowCols = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5'];
  for (let st = 0; st < style.storeys; st++) {
    const y = 4.2 + st * 3.1;
    const spandrelMat = style.rainbow ? lam(rainbowCols[st % rainbowCols.length]) : bandMat;
    mesh(g, new THREE.BoxGeometry(d + 0.3, 0.85, len + 0.3), spandrelMat, 0, y + 0.4, 0, false);
    mesh(g, new THREE.BoxGeometry(d + 0.15, 1.4, len - 1.6), glassMat, 0, y + 1.75, 0, false);
  }

  // Central glass atrium or vertical architectural fin tower
  if (style.glassAtrium) {
    mesh(g, new THREE.CylinderGeometry(3.8, 3.8, h + 1.8, 12), lam('#29526d'), hw - 1.2, (h + 1.8) / 2, 0, shadow);
    mesh(g, new THREE.BoxGeometry(1.2, h + 2.2, 1.2), accentMat, hw - 0.2, (h + 2.2) / 2, -4.2, shadow);
    mesh(g, new THREE.BoxGeometry(1.2, h + 2.2, 1.2), accentMat, hw - 0.2, (h + 2.2) / 2, 4.2, shadow);
  } else {
    for (let z = -hl + 2.5; z <= hl - 2.5; z += 4.5) {
      mesh(g, new THREE.BoxGeometry(0.65, h - 3.8, 0.35), accentMat, hw + 0.2, 3.8 + (h - 3.8) / 2, z, false);
    }
  }

  // Prominent street fascia & rooftop billboard
  const fascia = mesh(
    g,
    new THREE.PlaneGeometry(len * 0.84, 1.6),
    lam('#ffffff', signTexture([style.title, style.sub], style.signBg, style.signFg, 768, 128)),
    hw + 0.28,
    4.3,
    0,
    false,
  );
  fascia.rotation.y = Math.PI / 2;

  const roofSign = mesh(
    g,
    new THREE.PlaneGeometry(Math.min(18, len * 0.72), 2.3),
    basic('#ffffff', signTexture([style.title], style.signBg, style.signFg, 512, 96), true),
    hw - 1.0,
    h + 1.25,
    0,
    false,
  );
  roofSign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 27. Mazar-e-Quaid (White Marble Mausoleum, Tiered Podium & Reflecting Pool)
// ---------------------------------------------------------------------------

function buildMazarQuaid(
  group: THREE.Group,
  hw: number,
  hl: number,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const marble = new THREE.MeshLambertMaterial({
    color: '#f8f7f2',
    emissive: new THREE.Color('#fff5dd'),
    emissiveIntensity: 0,
  });
  litMats.push(marble);
  const darkSteps = lam('#45494e');
  const lawnMat = lam('#6fa050');
  const poolMat = lam('#38a3b8');
  const goldMat = lam('#e6b830');

  // Manicured terraced lawn base & ornamental perimeter iron-green boundary
  mesh(g, new THREE.BoxGeometry(d, 0.35, len), lawnMat, 0, 0.175, 0, false);
  // Reflecting pool and fountain jets along the front approach (+x)
  mesh(g, new THREE.BoxGeometry(4.2, 0.42, len * 0.56), poolMat, hw - 2.6, 0.22, 0, false);
  for (const fz of [-len * 0.2, 0, len * 0.2]) {
    mesh(g, new THREE.CylinderGeometry(0.18, 0.35, 1.4, 8), basic('#d8f6ff'), hw - 2.6, 0.9, fz, false);
  }

  // Two-tier white marble podium with dark ceremonial stair flights on all 4 sides
  mesh(g, new THREE.BoxGeometry(d * 0.76, 1.8, len * 0.78), marble, -1.2, 0.9, 0, shadow);
  mesh(g, new THREE.BoxGeometry(d * 0.64, 1.6, len * 0.66), marble, -1.2, 2.6, 0, shadow);
  mesh(g, new THREE.BoxGeometry(2.6, 1.85, 5.6), darkSteps, hw - 3.6, 0.92, 0, false);
  mesh(g, new THREE.BoxGeometry(2.2, 1.65, 4.6), darkSteps, hw - 4.8, 2.62, 0, false);

  // Tapered white marble mausoleum chamber with pointed-arch portals
  const chW = Math.min(14.5, d * 0.56);
  const chH = 11.8;
  const bodyGeo = new THREE.CylinderGeometry(chW * 0.64, chW * 0.74, chH, 4);
  bodyGeo.rotateY(Math.PI / 4);
  mesh(g, bodyGeo, marble, -1.2, 3.4 + chH / 2, 0, shadow);

  const faceTex = mazarFaceTexture();
  const faceMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: faceTex,
    emissiveMap: faceTex,
    emissive: new THREE.Color('#fff2cc'),
    emissiveIntensity: 0,
  });
  litMats.push(faceMat);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const f = mesh(
      g,
      new THREE.PlaneGeometry(chW * 0.88, chH * 0.92),
      faceMat,
      -1.2 + Math.sin(a) * (chW * 0.5 + 0.08),
      3.4 + chH * 0.48,
      Math.cos(a) * (chW * 0.5 + 0.08),
      false,
    );
    f.rotation.y = a;
  }

  // Octagonal drum, white marble dome, and golden crescent finial
  const topY = 3.4 + chH;
  mesh(g, new THREE.BoxGeometry(chW * 0.96, 0.7, chW * 0.96), marble, -1.2, topY + 0.35, 0, shadow);
  mesh(g, new THREE.CylinderGeometry(chW * 0.44, chW * 0.48, 1.4, 16), lam('#d8e6e2'), -1.2, topY + 1.2, 0, shadow);
  const dome = new THREE.SphereGeometry(chW * 0.44, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
  dome.scale(1, 1.18, 1);
  mesh(g, dome, marble, -1.2, topY + 1.6, 0, shadow);
  mesh(g, new THREE.ConeGeometry(0.42, 2.4, 8), goldMat, -1.2, topY + 1.6 + chW * 0.52 + 1.1, 0, false);

  // Corner ceremonial marble minar pillars on the podium corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      mesh(
        g,
        new THREE.BoxGeometry(0.85, 4.8, 0.85),
        marble,
        -1.2 + sx * (d * 0.34),
        3.4 + 2.4,
        sz * (len * 0.35),
        shadow,
      );
    }
  }

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(15.0, 1.5),
    lam('#ffffff', signTexture(['MAZAR-E-QUAID · مزارِ قائد', 'QUAID-E-AZAM MAUSOLEUM · M.A. JINNAH RD'], '#01411c', '#ffffff', 768, 128)),
    hw + 0.15,
    2.6,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 28. Frere Hall (1865 Venetian-Gothic Limestone Hall, Spire & Bagh-e-Jinnah)
// ---------------------------------------------------------------------------

function buildFrereHall(
  group: THREE.Group,
  hw: number,
  hl: number,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 11.8;
  const gizri = lam('#dfc282');
  const redStone = lam('#9e3d2b');
  const darkSlate = lam('#5e2d24');
  const lawn = lam('#6fa050');

  // Bagh-e-Jinnah manicured garden terrace & red sandstone plinth
  mesh(g, new THREE.BoxGeometry(d, 0.4, len), lawn, 0, 0.2, 0, false);
  mesh(g, new THREE.BoxGeometry(d * 0.78, 1.4, len * 0.84), redStone, -0.8, 0.9, 0, shadow);

  // Main Venetian-Gothic hall body in yellow Gizri limestone
  const hallW = d * 0.68;
  const hallL = len * 0.76;
  mesh(g, new THREE.BoxGeometry(hallW, h, hallL), gizri, -0.8, 1.6 + h / 2, 0, shadow);

  // Ground & upper arched Venetian loggia along the front (+x) and sides
  const wallTex = tiled(gothicWallTexture(), Math.max(2, Math.round(hallL / 7)), 2);
  const frontArcade = mesh(
    g,
    new THREE.PlaneGeometry(hallL - 0.6, h - 0.8),
    lam('#f0d89c', wallTex),
    -0.8 + hallW / 2 + 0.06,
    1.6 + h / 2,
    0,
    false,
  );
  frontArcade.rotation.y = Math.PI / 2;

  // Alternating red-and-yellow limestone stringcourses and crenellated cornice
  for (const y of [5.4, 9.2, 1.6 + h]) {
    mesh(g, new THREE.BoxGeometry(hallW + 0.4, 0.45, hallL + 0.4), redStone, -0.8, y, 0, false);
  }

  // Steep pitched red-slate roof over the main hall
  const roofGeo = new THREE.CylinderGeometry(hallW * 0.48, hallW * 0.48, hallL - 0.6, 3);
  roofGeo.rotateX(Math.PI / 2);
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.scale(1, 0.68, 1);
  mesh(g, roofGeo, darkSlate, -0.8, 1.6 + h + 2.4, 0, shadow);

  // Iconic octagonal Venetian-Gothic bell/clock tower on the north-front corner
  const tx = -0.8 + hallW * 0.32;
  const tz = -hallL * 0.32;
  const tH = 22.5;
  mesh(g, new THREE.BoxGeometry(4.6, tH, 4.6), gizri, tx, 1.6 + tH / 2, tz, shadow);
  mesh(g, new THREE.BoxGeometry(5.1, 0.6, 5.1), redStone, tx, 1.6 + tH, tz, false);
  mesh(g, new THREE.CylinderGeometry(2.1, 2.3, 4.2, 8), gizri, tx, 1.6 + tH + 2.1, tz, shadow);
  const spire = new THREE.ConeGeometry(2.4, 6.8, 8);
  mesh(g, spire, darkSlate, tx, 1.6 + tH + 4.2 + 3.4, tz, shadow);

  const plaqueMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: signTexture(['FRERE HALL · فریئر ہال · 1865', 'BAGH-E-JINNAH · SADEQUAIN GALLERY'], '#7b1f16', '#ffecb3', 768, 128),
    emissive: new THREE.Color('#ffecb3'),
    emissiveIntensity: 0,
  });
  litMats.push(plaqueMat);
  const sign = mesh(g, new THREE.PlaneGeometry(14.5, 1.5), plaqueMat, hw + 0.12, 3.2, 0, false);
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 29. Merewether Clock Tower (1892 Victorian Gothic Memorial Clock Tower)
// ---------------------------------------------------------------------------

function buildMerewetherTower(
  group: THREE.Group,
  hw: number,
  hl: number,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const stone = lam('#dcc08a');
  const trim = lam('#a8844c');
  const roofCol = lam('#6e472b');

  // Ornamental octagonal stone courtyard & red-trimmed railings
  mesh(g, new THREE.BoxGeometry(d * 0.88, 0.8, len * 0.88), trim, 0, 0.4, 0, shadow);
  mesh(g, new THREE.BoxGeometry(9.6, 2.4, 9.6), stone, 0, 1.6, 0, shadow);

  // Cruciform buttressed lower shaft, gothic lancet stage, and clock stage
  const tH = 25.0;
  const wallTex = tiled(gothicWallTexture(), 1, 3);
  mesh(g, new THREE.BoxGeometry(5.6, tH, 5.6), lam('#e5cb97', wallTex), 0, 2.8 + tH / 2, 0, shadow);
  // Corner angle buttresses
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(1.1, tH * 0.78, 1.1), trim, sx * 2.75, 2.8 + (tH * 0.78) / 2, sz * 2.75, shadow);
      mesh(g, new THREE.ConeGeometry(0.75, 2.6, 4), roofCol, sx * 2.75, 2.8 + tH * 0.78 + 1.3, sz * 2.75, false);
    }
  }

  // Decorative stone cornices dividing the 4 Gothic stages
  for (const y of [9.0, 15.5, 21.8, 27.8]) {
    mesh(g, new THREE.BoxGeometry(6.5, 0.65, 6.5), trim, 0, y, 0, false);
  }

  // 4 illuminated Victorian clock faces
  const cTex = clockFaceTexture();
  const clockMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: cTex,
    emissiveMap: cTex,
    emissive: new THREE.Color('#fff2c4'),
    emissiveIntensity: 0,
  });
  litMats.push(clockMat);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const cf = mesh(
      g,
      new THREE.PlaneGeometry(3.1, 3.1),
      clockMat,
      Math.sin(a) * 2.88,
      24.8,
      Math.cos(a) * 2.88,
      false,
    );
    cf.rotation.y = a;
  }

  // Open Gothic belfry canopy & tall pointed spire with 4 corner spirelets
  const topY = 27.8;
  for (const sx of [-2.1, 2.1]) {
    for (const sz of [-2.1, 2.1]) {
      mesh(g, new THREE.BoxGeometry(0.85, 4.4, 0.85), stone, sx, topY + 2.2, sz, shadow);
      mesh(g, new THREE.ConeGeometry(0.6, 2.4, 4), roofCol, sx, topY + 5.6, sz, false);
    }
  }
  mesh(g, new THREE.BoxGeometry(5.8, 0.7, 5.8), trim, 0, topY + 4.6, 0, false);
  const spire = new THREE.ConeGeometry(3.4, 8.8, 4);
  spire.rotateY(Math.PI / 4);
  mesh(g, spire, roofCol, 0, topY + 5.0 + 4.4, 0, shadow);

  const sign = mesh(
    g,
    new THREE.PlaneGeometry(13.5, 1.45),
    lam('#ffffff', signTexture(['MEREWETHER CLOCK TOWER · میری ویدر ٹاور', 'M.A. JINNAH RD · I.I. CHUNDRIGAR RD · 1892'], '#4e342e', '#ffecb3', 768, 128)),
    hw + 0.12,
    3.2,
    0,
    false,
  );
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 30. Arts Council of Pakistan (Modernist Amphitheatre & Brise-Soleil Complex)
// ---------------------------------------------------------------------------

function buildArtsCouncil(
  group: THREE.Group,
  hw: number,
  hl: number,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 14.2;
  const ivory = lam('#f2ede2');
  const charcoal = lam('#263238');
  const teal = lam('#00796b');
  const crimson = lam('#c62828');

  // Main auditorium block & sweeping curved modernist rotunda drum
  mesh(g, new THREE.BoxGeometry(d * 0.78, h, len * 0.88), ivory, -1.2, h / 2, 0, shadow);
  mesh(g, new THREE.CylinderGeometry(7.2, 7.6, h + 2.4, 18), ivory, hw - 5.2, (h + 2.4) / 2, 0, shadow);
  mesh(g, new THREE.CylinderGeometry(7.5, 7.5, 1.1, 18), crimson, hw - 5.2, h + 2.2, 0, false);

  // Vertical modernist acoustic brise-soleil fins & vibrant cultural mural bands
  const muralCols = ['#e53935', '#fb8c00', '#fdd835', '#00897b', '#1e88e5', '#8e24aa'];
  let idx = 0;
  for (let z = -hl + 2.2; z <= hl - 2.2; z += 2.4, idx++) {
    mesh(g, new THREE.BoxGeometry(0.55, h - 3.6, 0.28), teal, hw - 1.6, 3.6 + (h - 3.6) / 2, z, false);
    mesh(
      g,
      new THREE.BoxGeometry(0.25, 2.4, 1.6),
      lam(muralCols[idx % muralCols.length]),
      hw - 1.75,
      5.4,
      z,
      false,
    );
  }

  // Cantilevered entrance stage canopy
  mesh(g, new THREE.BoxGeometry(3.6, 0.5, len * 0.66), charcoal, hw - 0.6, 3.8, 0, shadow);

  const marqueeTex = signTexture(
    ['ARTS COUNCIL OF PAKISTAN · آرٹس کونسل کراچی', 'OPEN AIR AUDITORIUM · THEATRE · LITERATURE FESTIVAL'],
    '#880e4f',
    '#ffeb3b',
    768,
    128,
  );
  const marqueeMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: marqueeTex,
    emissiveMap: marqueeTex,
    emissive: new THREE.Color('#ffeb3b'),
    emissiveIntensity: 0,
  });
  litMats.push(marqueeMat);
  const sign = mesh(g, new THREE.PlaneGeometry(16.0, 1.65), marqueeMat, hw + 0.2, 4.5, 0, false);
  sign.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// 31. DJ Sindh Govt. Science College (1887 Indo-Saracenic Sandstone & Dome)
// ---------------------------------------------------------------------------

function buildDjScienceCollege(
  group: THREE.Group,
  hw: number,
  hl: number,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  g.position.set(0, KERB_H, 0);
  group.add(g);

  const d = hw * 2;
  const len = hl * 2;
  const h = 13.8;
  const sandstone = lam('#dfbe7d');
  const deepStone = lam('#b38b46');
  const domeMat = lam('#4b7f6e');

  // Grand yellow Gizri sandstone block with arched colonial verandahs
  mesh(g, new THREE.BoxGeometry(d * 0.84, h, len), sandstone, -0.8, h / 2, 0, shadow);
  const verTex = tiled(colonialVerandahTexture(), Math.max(3, Math.round(len / 6)), 2);
  const front = mesh(
    g,
    new THREE.PlaneGeometry(len - 0.8, h - 1.2),
    lam('#f3dca8', verTex),
    hw - 0.72,
    h / 2,
    0,
    false,
  );
  front.rotation.y = Math.PI / 2;

  // Projecting neoclassical entrance portico with columns & triangular pediment
  mesh(g, new THREE.BoxGeometry(2.6, h + 1.4, 7.6), deepStone, hw - 0.4, (h + 1.4) / 2, 0, shadow);
  for (const z of [-2.8, -1.0, 1.0, 2.8]) {
    mesh(g, new THREE.CylinderGeometry(0.32, 0.36, h - 0.6, 8), lam('#f5ebd0'), hw + 0.9, (h - 0.6) / 2, z, shadow);
  }

  // Central octagonal clock drum & Indo-Saracenic copper-green cupola dome
  const topY = h + 1.4;
  mesh(g, new THREE.CylinderGeometry(3.2, 3.5, 4.8, 8), sandstone, hw - 0.6, topY + 2.4, 0, shadow);
  const dome = new THREE.SphereGeometry(3.1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  mesh(g, dome, domeMat, hw - 0.6, topY + 4.8, 0, shadow);
  mesh(g, new THREE.ConeGeometry(0.35, 2.0, 8), deepStone, hw - 0.6, topY + 4.8 + 3.6, 0, false);

  const signTex = signTexture(
    ['D.J. SINDH GOVT. SCIENCE COLLEGE · ڈی جے سائنس کالج', 'EST. 1887 · BURNS ROAD HERITAGE DISTRICT'],
    '#5d4037',
    '#ffecb3',
    768,
    128,
  );
  const signMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: signTex,
    emissiveMap: signTex,
    emissive: new THREE.Color('#ffecb3'),
    emissiveIntensity: 0,
  });
  litMats.push(signMat);
  const sign = mesh(g, new THREE.PlaneGeometry(16.0, 1.55), signMat, hw + 1.0, 4.2, 0, false);
  sign.rotation.y = Math.PI / 2;
}


