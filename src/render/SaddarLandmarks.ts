import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KERB_H } from '../sim/city/cityMap';
import type { Landmark } from '../sim/city/cityMap';
import { buildEmpressMarketAt } from './Landmarks';
import { archFrameGeo, gableRoofGeo, mergeByMaterial, pointedArchShape } from './landmarkKit';
import {
  cinemaPosterTexture,
  clockFaceTexture,
  frereBayTexture,
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
      buildStPatricksCathedral(sub, rectZ, shadow, litMats);
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

/**
 * Gothic Revival cathedral (Fr. Karl Wagner SJ, 1881) in yellow Gizri
 * limestone: twin-towered west front on the street, five-bay nave with
 * clerestory over lean-to aisles and flying buttresses, a shallow transept
 * and a polygonal apse. In the forecourt stands the white Renaissance-style
 * Christ the King monument (1931). Everything stays inside the collider;
 * meshes are merged per material at the end.
 */
function buildStPatricksCathedral(
  group: THREE.Group,
  l: LocalLandmark,
  shadow: boolean,
  litMats: THREE.MeshLambertMaterial[],
): void {
  const g = new THREE.Group();
  const W = l.rect.x1 - l.rect.x0; // street frontage
  const D = l.rect.z1 - l.rect.z0; // depth back from the street
  // Origin at the middle of the street edge; the building extends toward -z.
  g.position.set((l.rect.x0 + l.rect.x1) / 2, KERB_H, l.rect.z1);
  group.add(g);

  const stone = lam('#d9be86');
  const dressed = lam('#ecdcb4');
  const shade = lam('#b39762');
  const roof = lam('#5d6168');
  const marble = lam('#f4f2ec');
  // The Christ the King monument is floodlit at night.
  marble.emissive.set('#fff1d8');
  litMats.push(marble);
  const gold = lam('#d6aa45');
  const iron = lam('#24262a');
  const dark = lam('#2a2018');
  const paving = lam('#d8cfbd');
  const lawnMat = lam('#7f9a57');
  const glassMat = (rx: number) =>
    new THREE.MeshLambertMaterial({
      color: '#ffffff',
      map: tiled(stainedLancetTexture(), rx, 1),
      emissive: new THREE.Color('#ffe2a8'),
      emissiveMap: tiled(stainedLancetTexture(true), rx, 1),
      emissiveIntensity: 0,
    });

  // ---- Layout (z measured back from the street edge) ----
  const facadeZ = -11.5; // west front face
  const naveHalf = 6.2;
  const naveWallH = 13.5;
  const naveEnd = -(D - 4.6); // where the apse begins
  const aisleOut = 10.6;
  const aisleH = 7.6;
  const towerX = 9.0;
  const towerS = 5.4;
  const towerZ = facadeZ - towerS / 2 + 0.6; // towers project slightly ahead of the front
  const tranZ0 = naveEnd + 9.5;
  const tranZ1 = naveEnd + 3.0;
  const tranHalf = Math.min(W / 2 - 1.5, 15);
  const tranH = 12.5;

  // ---- Grounds: paved forecourt, lawns, compound wall with iron railings & gate ----
  const ground = (w: number, d: number, x: number, z: number, mat: THREE.Material, y: number) => {
    const p = mesh(g, new THREE.PlaneGeometry(w, d), mat, x, y, z, false);
    p.rotation.x = -Math.PI / 2;
  };
  ground(W, D, 0, -D / 2, lawnMat, 0.02);
  ground(10, -facadeZ, 0, facadeZ / 2, paving, 0.03);
  ground(2 * aisleOut + 2, 1.6, 0, facadeZ - 0.2, paving, 0.035);
  const gateHalf = 5.0;
  const segW = W / 2 - gateHalf - 0.7;
  for (const s of [-1, 1]) {
    const sx = s * (gateHalf + 0.7 + segW / 2);
    mesh(g, new THREE.BoxGeometry(segW, 0.9, 0.45), stone, sx, 0.45, -0.3);
    mesh(g, new THREE.BoxGeometry(segW, 0.12, 0.55), dressed, sx, 0.96, -0.3);
    mesh(g, new THREE.BoxGeometry(segW, 0.06, 0.06), iron, sx, 2.05, -0.3);
    mesh(g, new THREE.BoxGeometry(segW, 0.06, 0.06), iron, sx, 1.25, -0.3);
    for (let x = -segW / 2 + 0.2; x <= segW / 2; x += 0.32) {
      mesh(g, new THREE.BoxGeometry(0.05, 1.25, 0.05), iron, sx + x, 1.62, -0.3);
      mesh(g, new THREE.ConeGeometry(0.06, 0.16, 4), gold, sx + x, 2.32, -0.3);
    }
    // Intermediate piers along the railing
    for (const f of [-0.5, 0, 0.5]) {
      mesh(g, new THREE.BoxGeometry(0.6, 2.3, 0.6), stone, sx + f * segW, 1.15, -0.3);
      mesh(g, new THREE.BoxGeometry(0.75, 0.15, 0.75), dressed, sx + f * segW, 2.35, -0.3);
    }
    // Gate piers with gabled caps & lanterns
    const gx = s * (gateHalf + 0.35);
    mesh(g, new THREE.BoxGeometry(1.2, 3.4, 1.2), stone, gx, 1.7, -0.3);
    mesh(g, new THREE.BoxGeometry(1.4, 0.25, 1.4), dressed, gx, 3.45, -0.3);
    mesh(g, new THREE.ConeGeometry(0.95, 1.2, 4).rotateY(Math.PI / 4), dressed, gx, 4.15, -0.3);
      }
  const gateSignMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: signTexture(["ST. PATRICK'S CATHEDRAL", 'ARCHDIOCESE OF KARACHI · 1881'], '#3d2a1a', '#f3e3bc', 512, 96),
    emissive: new THREE.Color('#f3e3bc'),
    emissiveMap: signTexture(["ST. PATRICK'S CATHEDRAL", 'ARCHDIOCESE OF KARACHI · 1881'], '#3d2a1a', '#f3e3bc', 512, 96),
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  litMats.push(gateSignMat);
  // Wrought-iron gate arch carrying the name board
  mesh(g, new THREE.BoxGeometry(gateHalf * 2, 0.14, 0.14), iron, 0, 3.3, -0.3);
  mesh(g, new THREE.BoxGeometry(gateHalf * 2, 0.1, 0.1), iron, 0, 4.5, -0.3);
  for (const s of [-1, 1]) {
    // Scrolled iron bracing between the two rails
    for (const f of [0.25, 0.55, 0.85]) {
      mesh(g, new THREE.BoxGeometry(0.06, 1.2, 0.06), iron, s * gateHalf * f, 3.9, -0.3, false);
    }
    const lamp = mesh(g, new THREE.BoxGeometry(0.3, 0.45, 0.3), gold, s * (gateHalf + 0.35), 5.2, -0.3, false);
    void lamp;
  }
  mesh(
    g,
    new THREE.PlaneGeometry(6.4, 0.9),
    gateSignMat,
    0,
    3.95,
    -0.22,
    false,
  );

  // ---- Christ the King monument (1931): white Renaissance aedicule + statue ----
  const mz = facadeZ / 2 - 0.4;
  mesh(g, new THREE.CylinderGeometry(2.7, 2.9, 0.35, 8), marble, 0, 0.175, mz);
  mesh(g, new THREE.CylinderGeometry(2.25, 2.45, 0.35, 8), marble, 0, 0.525, mz);
  mesh(g, new THREE.BoxGeometry(3.2, 1.6, 3.2), marble, 0, 1.5, mz);
  mesh(g, new THREE.BoxGeometry(3.45, 0.2, 3.45), marble, 0, 2.38, mz);
  for (let f = 0; f < 4; f++) {
    // Arched niches on the plinth faces
    const a = (f / 4) * Math.PI * 2;
    const niche = mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.45, 1.05) as THREE.Shape), dark, Math.sin(a) * 1.61, 0.85, mz + Math.cos(a) * 1.61, false);
    niche.rotation.y = a;
  }
  for (const dx of [-1.15, 1.15]) {
    for (const dz of [-1.15, 1.15]) {
      mesh(g, new THREE.CylinderGeometry(0.18, 0.2, 3.0, 8), marble, dx, 3.98, mz + dz);
      mesh(g, new THREE.BoxGeometry(0.42, 0.18, 0.42), marble, dx, 2.57, mz + dz);
      mesh(g, new THREE.BoxGeometry(0.42, 0.22, 0.42), marble, dx, 5.53, mz + dz);
    }
  }
  mesh(g, new THREE.BoxGeometry(3.0, 0.45, 3.0), marble, 0, 5.85, mz);
  mesh(g, new THREE.BoxGeometry(3.2, 0.14, 3.2), marble, 0, 6.12, mz);
  mesh(g, new THREE.CylinderGeometry(1.15, 1.15, 0.5, 12), marble, 0, 6.44, mz);
  mesh(g, new THREE.SphereGeometry(1.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), marble, 0, 6.69, mz);
  mesh(g, new THREE.CylinderGeometry(0.42, 0.55, 1.2, 8), marble, 0, 8.3, mz);
  // Statue: robed figure, arms outstretched in blessing, gilt crown
  mesh(g, new THREE.CylinderGeometry(0.3, 0.5, 2.2, 8), marble, 0, 10.0, mz);
  mesh(g, new THREE.CylinderGeometry(0.32, 0.3, 0.45, 8), marble, 0, 11.3, mz);
  for (const s of [-1, 1]) {
    const arm = mesh(g, new THREE.BoxGeometry(1.0, 0.2, 0.22), marble, s * 0.74, 11.15, mz);
    arm.rotation.z = s * -0.38;
  }
  mesh(g, new THREE.SphereGeometry(0.24, 8, 6), marble, 0, 11.78, mz);
  mesh(g, new THREE.CylinderGeometry(0.21, 0.18, 0.18, 8), gold, 0, 12.06, mz);

  // ---- Nave with clerestory, lean-to aisles, buttresses ----
  const naveLen = facadeZ - naveEnd;
  const naveZc = (facadeZ + naveEnd) / 2;
  mesh(g, new THREE.BoxGeometry(naveHalf * 2, naveWallH, naveLen), stone, 0, naveWallH / 2, naveZc);
  mesh(g, new THREE.BoxGeometry(naveHalf * 2 + 0.3, 0.35, naveLen + 0.3), dressed, 0, naveWallH + 0.1, naveZc);
  const naveRoof = gableRoofGeo(naveHalf * 2 + 1.0, 5.6, naveLen + 0.6);
  mesh(g, naveRoof, roof, 0, naveWallH + 0.25, naveZc);
  // Ridge cresting
  mesh(g, new THREE.BoxGeometry(0.18, 0.35, naveLen), dressed, 0, naveWallH + 5.9, naveZc, false);

  const aisleZ0 = towerZ - towerS / 2;
  const aisleLen = aisleZ0 - naveEnd;
  const aisleZc = (aisleZ0 + naveEnd) / 2;
  const aisleW = aisleOut - naveHalf;
  const bays = Math.max(3, Math.round(aisleLen / 3.4));
  const bay = aisleLen / bays;
  const aisleGlass = glassMat(bays);
  const clereGlass = glassMat(bays);
  litMats.push(aisleGlass, clereGlass);
  for (const s of [-1, 1]) {
    const ax = s * (naveHalf + aisleW / 2);
    mesh(g, new THREE.BoxGeometry(aisleW, aisleH, aisleLen), stone, ax, aisleH / 2, aisleZc);
    // Lean-to roof from the aisle eaves up against the nave wall
    const lean = new THREE.Shape();
    lean.moveTo(0, aisleH + 2.3);
    lean.lineTo(s * (aisleW + 0.5), aisleH - 0.15);
    lean.lineTo(s * (aisleW + 0.5), aisleH - 0.4);
    lean.lineTo(0, aisleH + 2.05);
    const leanGeo = new THREE.ExtrudeGeometry(lean, { depth: aisleLen + 0.3, bevelEnabled: false });
    leanGeo.translate(0, 0, -(aisleLen + 0.3) / 2);
    mesh(g, leanGeo, roof, s * naveHalf, 0, aisleZc);
    // Aisle windows (one lancet per bay) and clerestory lancets above the lean-to
    const aw = mesh(g, new THREE.PlaneGeometry(aisleLen, aisleH - 1.6), aisleGlass, s * (aisleOut + 0.02), aisleH / 2 + 0.2, aisleZc, false);
    aw.rotation.y = s * Math.PI / 2;
    const cw = mesh(g, new THREE.PlaneGeometry(aisleLen, naveWallH - aisleH - 3.0), clereGlass, s * (naveHalf + 0.02), (naveWallH + aisleH + 2.6) / 2, aisleZc, false);
    cw.rotation.y = s * Math.PI / 2;
    // Stepped buttresses with pinnacles + flying buttresses to the clerestory
    for (let i = 0; i <= bays; i++) {
      const bz = aisleZ0 - i * bay;
      const bx = s * (aisleOut + 0.45);
      mesh(g, new THREE.BoxGeometry(0.9, aisleH - 1.2, 0.8), stone, bx, (aisleH - 1.2) / 2, bz);
      mesh(g, new THREE.BoxGeometry(0.7, 2.2, 0.65), stone, bx - s * 0.1, aisleH + 0.0, bz);
      mesh(g, new THREE.ConeGeometry(0.42, 1.5, 4).rotateY(Math.PI / 4), dressed, bx - s * 0.1, aisleH + 1.85, bz, false);
      if (i > 0 && i < bays) {
        const span = aisleOut - naveHalf;
        const fly = mesh(g, new THREE.BoxGeometry(Math.hypot(span, 3.2), 0.4, 0.4), dressed, s * (naveHalf + span / 2), aisleH + 2.7, bz, false);
        fly.rotation.z = s * Math.atan2(3.2, span);
      }
    }
    mesh(g, new THREE.BoxGeometry(aisleW + 0.3, 0.3, aisleLen + 0.2), dressed, ax, aisleH - 0.1, aisleZc, false);
    mesh(g, new THREE.BoxGeometry(0.15, 0.8, aisleLen), shade, s * (aisleOut + 0.05), 0.4, aisleZc, false);
  }

  // ---- Shallow transept with its own gables and lancet groups ----
  const tranLen = tranZ0 - tranZ1;
  const tranZc = (tranZ0 + tranZ1) / 2;
  mesh(g, new THREE.BoxGeometry(tranHalf * 2, tranH, tranLen), stone, 0, tranH / 2, tranZc);
  const tranRoof = gableRoofGeo(tranLen + 0.9, 4.4, tranHalf * 2 + 0.6);
  tranRoof.rotateY(Math.PI / 2);
  mesh(g, tranRoof, roof, 0, tranH + 0.2, tranZc);
  const tranGlass = glassMat(1);
  litMats.push(tranGlass);
  for (const s of [-1, 1]) {
    const gab = new THREE.Shape();
    gab.moveTo(-tranLen / 2 - 0.4, 0);
    gab.lineTo(tranLen / 2 + 0.4, 0);
    gab.lineTo(0, 4.9);
    gab.lineTo(-tranLen / 2 - 0.4, 0);
    const gabGeo = new THREE.ExtrudeGeometry(gab, { depth: 0.5, bevelEnabled: false });
    const gm = mesh(g, gabGeo, stone, s * (tranHalf - 0.25), tranH, tranZc, false);
    gm.rotation.y = s * Math.PI / 2;
    const tw = mesh(g, new THREE.PlaneGeometry(tranLen * 0.55, tranH - 3.5), tranGlass, s * (tranHalf + 0.02), tranH / 2 + 0.6, tranZc, false);
    tw.rotation.y = s * Math.PI / 2;
    for (const dz of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(0.9, tranH + 1.0, 0.9), stone, s * (tranHalf + 0.1), (tranH + 1.0) / 2, tranZc + dz * (tranLen / 2 + 0.1));
      mesh(g, new THREE.ConeGeometry(0.5, 1.8, 4).rotateY(Math.PI / 4), dressed, s * (tranHalf + 0.1), tranH + 1.9, tranZc + dz * (tranLen / 2 + 0.1), false);
    }
    mesh(g, new THREE.BoxGeometry(0.2, 1.6, 0.2), dressed, s * (tranHalf + 0.1), tranH + 5.4, tranZc, false);
    mesh(g, new THREE.BoxGeometry(0.2, 0.2, 0.9), dressed, s * (tranHalf + 0.1), tranH + 5.7, tranZc, false);
  }

  // ---- Polygonal apse (half-octagon) closing the east end ----
  const apseR = naveHalf + 0.2;
  const apseDepth = Math.min(4.3, D + naveEnd - 0.3);
  const apse = new THREE.CylinderGeometry(apseR, apseR, naveWallH - 1.5, 8, 1, false, Math.PI / 2, Math.PI);
  apse.scale(1, 1, apseDepth / apseR);
  const apseFlat = apse.toNonIndexed();
  apseFlat.computeVertexNormals(); // crisp polygonal facets rather than a smooth drum
  mesh(g, apseFlat, stone, 0, (naveWallH - 1.5) / 2, naveEnd);
  const apseRoof = new THREE.ConeGeometry(apseR + 0.5, 5.0, 8, 1, false, Math.PI / 2, Math.PI).toNonIndexed();
  apseRoof.scale(1, 1, (apseDepth + 0.4) / (apseR + 0.5));
  apseRoof.computeVertexNormals();
  mesh(g, apseRoof, roof, 0, naveWallH - 1.5 + 2.5, naveEnd);
  const apseGlass = glassMat(1);
  litMats.push(apseGlass);
  for (let k = 0; k <= 8; k++) {
    // Buttress at each polygon vertex, a tall lancet on each facet
    const a = Math.PI / 2 + (k / 8) * Math.PI;
    const vx = Math.sin(a) * (apseR + 0.3);
    const vz = Math.cos(a) * (apseDepth + 0.3);
    if (k > 0 && k < 8) {
      mesh(g, new THREE.BoxGeometry(0.7, naveWallH - 3.0, 0.7), stone, vx, (naveWallH - 3.0) / 2, naveEnd + vz);
      mesh(g, new THREE.ConeGeometry(0.4, 1.4, 4).rotateY(Math.PI / 4), dressed, vx, naveWallH - 2.3, naveEnd + vz, false);
    }
    if (k < 8 && k % 2 === 1) {
      const am = a + Math.PI / 16;
      const facet = mesh(g, new THREE.PlaneGeometry(1.5, 5.5), apseGlass, Math.sin(am) * (apseR * Math.cos(Math.PI / 16) + 0.05), 5.0, naveEnd + Math.cos(am) * (apseDepth * Math.cos(Math.PI / 16) + 0.05), false);
      facet.rotation.y = Math.atan2(Math.sin(am) / apseR, Math.cos(am) / apseDepth);
    }
  }

  // ---- West front: gabled centre between twin towers ----
  const frontW = (towerX - towerS / 2) * 2;
  const frontMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: stPatricksFrontTexture(),
    emissive: new THREE.Color('#ffe2a8'),
    emissiveMap: stPatricksFrontTexture(true),
    emissiveIntensity: 0,
  });
  litMats.push(frontMat);
  mesh(g, new THREE.PlaneGeometry(frontW, naveWallH), frontMat, 0, naveWallH / 2, facadeZ + 0.03, false);
  // Projecting portal hoods (three moulded arches matching the texture)
  const px = frontW / 512;
  for (const [cx, hw, h] of [
    [-170, 40, 150],
    [0, 58, 200],
    [170, 40, 150],
  ] as const) {
    const fr = mesh(g, archFrameGeo(hw * px + 0.05, h * px * (naveWallH / frontW) + 0.05, 0.28, 0.45), dressed, cx * px, 22 * px * (naveWallH / frontW), facadeZ + 0.48, false);
    void fr;
  }
  // Great window hood
  mesh(g, archFrameGeo(94 * px, 239 * px * (naveWallH / frontW), 0.22, 0.3), dressed, 0, (512 - 256) * px * (naveWallH / frontW), facadeZ + 0.33, false);
  // Front gable with coping, quatrefoil-carved tympanum, apex cross
  const gableRise = 5.6;
  const gab = new THREE.Shape();
  gab.moveTo(-frontW / 2, 0);
  gab.lineTo(frontW / 2, 0);
  gab.lineTo(0, gableRise);
  gab.lineTo(-frontW / 2, 0);
  mesh(g, new THREE.ExtrudeGeometry(gab, { depth: 0.6, bevelEnabled: false }), stone, 0, naveWallH, facadeZ - 0.55);
  const slope = Math.atan2(gableRise, frontW / 2);
  const copeLen = Math.hypot(gableRise, frontW / 2) + 0.4;
  for (const s of [-1, 1]) {
    const cope = mesh(g, new THREE.BoxGeometry(copeLen, 0.35, 0.85), dressed, s * frontW / 4, naveWallH + gableRise / 2 + 0.15, facadeZ - 0.25, false);
    cope.rotation.z = -s * slope;
    // Crockets along the coping
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      mesh(g, new THREE.ConeGeometry(0.16, 0.5, 4), dressed, s * (frontW / 2) * (1 - t), naveWallH + gableRise * t + 0.55, facadeZ - 0.25, false);
    }
  }
  const qf = new THREE.Shape();
  qf.absarc(0, 0, 0.95, 0, Math.PI * 2, false);
  const qfHole = new THREE.Path();
  qfHole.absarc(0, 0, 0.7, 0, Math.PI * 2, true);
  qf.holes.push(qfHole);
  mesh(g, new THREE.ExtrudeGeometry(qf, { depth: 0.15, bevelEnabled: false, curveSegments: 10 }), dressed, 0, naveWallH + 2.1, facadeZ + 0.05, false);
  mesh(g, new THREE.CircleGeometry(0.7, 10), dark, 0, naveWallH + 2.1, facadeZ + 0.06, false);
  mesh(g, new THREE.BoxGeometry(0.26, 2.0, 0.26), dressed, 0, naveWallH + gableRise + 1.0, facadeZ - 0.25, false);
  mesh(g, new THREE.BoxGeometry(1.1, 0.26, 0.26), dressed, 0, naveWallH + gableRise + 1.35, facadeZ - 0.25, false);
  // Entrance steps across the front
  for (let k = 0; k < 3; k++) {
    mesh(g, new THREE.BoxGeometry(frontW + 2 - k * 0.6, 0.18, 1.6 - k * 0.45), dressed, 0, 0.09 + k * 0.18, facadeZ + 1.0 - k * 0.22, false);
  }

  // ---- Twin west towers: buttressed shaft, belfry, pinnacled parapet, octagonal spire ----
  const shaftH = 17.0;
  const belfryH = 5.0;
  const towerGlass = glassMat(1);
  litMats.push(towerGlass);
  for (const s of [-1, 1]) {
    const tx = s * towerX;
    mesh(g, new THREE.BoxGeometry(towerS, shaftH + belfryH, towerS), stone, tx, (shaftH + belfryH) / 2, towerZ);
    // String courses
    for (const y of [aisleH, shaftH]) {
      mesh(g, new THREE.BoxGeometry(towerS + 0.3, 0.3, towerS + 0.3), dressed, tx, y, towerZ, false);
    }
    // Clasping corner buttresses, stepping in as they rise
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const bx = tx + cx * (towerS / 2 + 0.05);
        const bz = towerZ + cz * (towerS / 2 + 0.05);
        mesh(g, new THREE.BoxGeometry(0.9, aisleH, 0.9), stone, bx, aisleH / 2, bz);
        mesh(g, new THREE.BoxGeometry(0.7, shaftH - aisleH, 0.7), stone, bx, (shaftH + aisleH) / 2, bz);
        mesh(g, new THREE.BoxGeometry(0.55, belfryH + 1.2, 0.55), shade, bx, shaftH + (belfryH + 1.2) / 2, bz);
        mesh(g, new THREE.ConeGeometry(0.45, 2.6, 4).rotateY(Math.PI / 4), dressed, bx, shaftH + belfryH + 2.5, bz, false);
      }
    }
    // Faces: lancet window mid-shaft (street + outer side), louvred belfry openings on all four
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2;
      const ox = Math.sin(a), oz = Math.cos(a);
      const r = towerS / 2 + 0.02;
      if (f === 0 || (f === 1 && s > 0) || (f === 3 && s < 0)) {
        const lw = mesh(g, new THREE.PlaneGeometry(2.0, 5.2), towerGlass, tx + ox * r, aisleH + 4.3, towerZ + oz * r, false);
        lw.rotation.y = a;
      }
      for (const dx of [-0.7, 0.7]) {
        const op = mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.48, 3.6) as THREE.Shape), dark, 0, 0, 0, false);
        op.rotation.y = a;
        op.position.set(tx + ox * r + Math.cos(a) * dx, shaftH + 0.6, towerZ + oz * r - Math.sin(a) * dx);
        const hood = mesh(g, archFrameGeo(0.48, 3.6, 0.14, 0.2), dressed, 0, 0, 0, false);
        hood.rotation.y = a;
        hood.position.set(tx + ox * (r + 0.18) + Math.cos(a) * dx, shaftH + 0.6, towerZ + oz * (r + 0.18) - Math.sin(a) * dx);
      }
    }
    // Pierced parapet + octagonal spire with lucarnes, gilt cross
    const topY = shaftH + belfryH;
    mesh(g, new THREE.BoxGeometry(towerS + 0.5, 0.35, towerS + 0.5), dressed, tx, topY + 0.1, towerZ, false);
    mesh(g, new THREE.BoxGeometry(towerS + 0.2, 0.9, towerS + 0.2), stone, tx, topY + 0.7, towerZ, false);
    mesh(g, new THREE.CylinderGeometry(2.0, 2.3, 1.0, 8), stone, tx, topY + 0.8, towerZ, false);
    mesh(g, new THREE.ConeGeometry(2.05, 8.6, 8), roof, tx, topY + 1.3 + 4.3, towerZ);
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2;
      const lu = mesh(g, new THREE.ConeGeometry(0.42, 1.3, 4).rotateY(Math.PI / 4), dressed, tx + Math.sin(a) * 1.55, topY + 3.0, towerZ + Math.cos(a) * 1.55, false);
      void lu;
    }
    mesh(g, new THREE.SphereGeometry(0.2, 6, 4), gold, tx, topY + 10.0, towerZ, false);
    mesh(g, new THREE.BoxGeometry(0.16, 1.4, 0.16), gold, tx, topY + 10.8, towerZ, false);
    mesh(g, new THREE.BoxGeometry(0.75, 0.16, 0.16), gold, tx, topY + 11.05, towerZ, false);
  }

  mergeByMaterial(g, shadow);
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

/**
 * Frere Hall (Henry Saint Clair Wilkins, 1863–65), Venetian Gothic in
 * yellow Karachi limestone banded with red and grey sandstone. Two storeys
 * of pointed-arch verandahs wrap all four faces (quatrefoils above the
 * upper arches) under a steep tiled roof with dormers and iron cresting.
 * The entrance tower rises from a porch through square stages to an
 * octagonal belfry and spire crowned with an iron cage. It stands on a
 * grey plinth in the Bagh-e-Jinnah lawns. Street front faces +x.
 */
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

  const lime = lam('#dcc283');
  const red = lam('#a5523a');
  const grey = lam('#8f8b82');
  const cream = lam('#efe0b8');
  const roofMat = lam('#5d4842');
  const slate = lam('#4f5258');
  const iron = lam('#26282b');
  const dark = lam('#2c2219');
  const lawnMat = lam('#6f9a4e');
  const pathMat = lam('#d9cdb2');

  // ---- Garden: lawn, gravel walk to the porch, flower beds ----
  const flat = (w: number, d: number, x: number, z: number, mat: THREE.Material, y: number) => {
    const p = mesh(g, new THREE.PlaneGeometry(w, d), mat, x, y, z, false);
    p.rotation.x = -Math.PI / 2;
  };
  flat(hw * 2, hl * 2, 0, 0, lawnMat, 0.02);
  flat(hw * 2, 1.6, 0, hl - 0.8, pathMat, 0.03);
  flat(hw * 2, 1.6, 0, -hl + 0.8, pathMat, 0.03);
  for (const s of [-1, 1]) {
    const bed = mesh(g, new THREE.CylinderGeometry(1.4, 1.5, 0.3, 10), lam('#7a4b2e'), hw - 2.6, 0.15, s * 5.2, false);
    void bed;
    mesh(g, new THREE.SphereGeometry(1.2, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), lam(s > 0 ? '#c2185b' : '#f9a825'), hw - 2.6, 0.3, s * 5.2, false);
  }

  // ---- Plinth & hall body ----
  const x0 = -8.6, x1 = 5.4; // hall depth (front face at x1)
  const zH = Math.min(11.5, hl - 2.5);
  const hx = (x0 + x1) / 2, hd = x1 - x0, hL = zH * 2;
  const P = 1.0; // plinth height
  const WALL = 11.5;
  mesh(g, new THREE.BoxGeometry(hd + 1.4, P, hL + 1.4), grey, hx, P / 2, 0);
  mesh(g, new THREE.BoxGeometry(hd + 1.6, 0.15, hL + 1.6), cream, hx, P, 0, false);
  mesh(g, new THREE.BoxGeometry(hd, WALL, hL), lime, hx, P + WALL / 2, 0);

  const bayMats = new Map<number, THREE.MeshLambertMaterial>();
  const bayMat = (n: number) => {
    let m = bayMats.get(n);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: '#ffffff',
        map: tiled(frereBayTexture(), n, 1),
        emissive: new THREE.Color('#ffd49a'),
        emissiveMap: tiled(frereBayTexture(true), n, 1),
        emissiveIntensity: 0,
      });
      litMats.push(m);
      bayMats.set(n, m);
    }
    return m;
  };
  const face = (w: number, x: number, z: number, a: number) => {
    const n = Math.max(1, Math.round(w / 3.2));
    mesh(g, new THREE.PlaneGeometry(w, WALL), bayMat(n), x + Math.sin(a) * 0.03, P + WALL / 2, z + Math.cos(a) * 0.03, false).rotation.y = a;
    // Projecting piers at the bay divisions, each with a small pinnacle
    const ux = Math.cos(a), uz = -Math.sin(a);
    for (let k = 0; k <= n; k++) {
      const t = -w / 2 + (k * w) / n;
      const px = x + Math.sin(a) * 0.25 + ux * t, pz = z + Math.cos(a) * 0.25 + uz * t;
      mesh(g, new THREE.BoxGeometry(0.55, WALL, 0.55), lime, px, P + WALL / 2, pz, false);
      mesh(g, new THREE.ConeGeometry(0.34, 1.3, 4).rotateY(Math.PI / 4), cream, px, P + WALL + 0.95, pz, false);
    }
  };
  face(hL, x1, 0, Math.PI / 2);
  face(hL, x0, 0, -Math.PI / 2);
  face(hd, hx, zH, 0);
  face(hd, hx, -zH, Math.PI);
  // Balcony ledge between storeys, red & cream cornice, parapet
  mesh(g, new THREE.BoxGeometry(hd + 1.0, 0.3, hL + 1.0), cream, hx, P + 6.35, 0, false);
  mesh(g, new THREE.BoxGeometry(hd + 0.9, 0.35, hL + 0.9), red, hx, P + WALL - 0.1, 0, false);
  mesh(g, new THREE.BoxGeometry(hd + 1.2, 0.3, hL + 1.2), cream, hx, P + WALL + 0.2, 0, false);

  // ---- Steep roof with iron ridge cresting, dormers, end gables ----
  const top = P + WALL + 0.35;
  const rise = 6.2;
  const roof = gableRoofGeo(hd + 1.2, rise, hL + 0.4);
  mesh(g, roof, roofMat, hx, top, 0);
  for (let z = -zH + 0.6; z <= zH - 0.6; z += 0.9) {
    mesh(g, new THREE.BoxGeometry(0.05, 0.6, 0.05), iron, hx, top + rise + 0.3, z, false);
  }
  mesh(g, new THREE.BoxGeometry(0.08, 0.06, hL), iron, hx, top + rise + 0.6, 0, false);
  const slope = Math.atan2(rise, (hd + 1.2) / 2);
  for (const s of [-1, 1]) {
    for (const dz of [-6.5, 6.5]) {
      // Gabled dormer sitting on the slope
      const run = (hd + 1.2) / 2;
      const dx = hx + s * run * 0.45;
      const dy = top + rise * 0.55;
      mesh(g, new THREE.BoxGeometry(1.6, 1.8, 1.8), lime, dx, dy, dz, false);
      const dg = gableRoofGeo(2.2, 1.1, 2.0);
      dg.rotateY(Math.PI / 2);
      mesh(g, dg, roofMat, dx, dy + 0.9, dz, false);
      const win = mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.42, 1.3) as THREE.Shape), dark, dx + s * 0.81, dy - 0.75, dz, false);
      win.rotation.y = s * Math.PI / 2;
    }
    void slope;
    // End gable wall with a red quatrefoil roundel and stone coping
    const gab = new THREE.Shape();
    gab.moveTo(-hd / 2 - 0.4, 0);
    gab.lineTo(hd / 2 + 0.4, 0);
    gab.lineTo(0, rise + 0.2);
    gab.lineTo(-hd / 2 - 0.4, 0);
    const gm = mesh(g, new THREE.ExtrudeGeometry(gab, { depth: 0.6, bevelEnabled: false }), lime, hx, top - 0.05, s * (zH - 0.15) - 0.3, false);
    void gm;
    const ring = new THREE.Shape();
    ring.absarc(0, 0, 1.15, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.8, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    const rg = mesh(g, new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false, curveSegments: 10 }), red, hx, top + 2.4, s * (zH + 0.32), false);
    rg.rotation.y = s > 0 ? 0 : Math.PI;
    const glass = mesh(g, new THREE.CircleGeometry(0.8, 10), dark, hx, top + 2.4, s * (zH + 0.33), false);
    glass.rotation.y = s > 0 ? 0 : Math.PI;
    const run = hd / 2 + 0.6;
    for (const side of [-1, 1]) {
      const cope = mesh(g, new THREE.BoxGeometry(Math.hypot(run, rise) + 0.3, 0.3, 0.9), cream, hx + side * run / 2, top + rise / 2 + 0.1, s * (zH + 0.05), false);
      cope.rotation.z = -side * Math.atan2(rise, run);
    }
    mesh(g, new THREE.ConeGeometry(0.35, 1.6, 4).rotateY(Math.PI / 4), cream, hx, top + rise + 0.9, s * (zH + 0.05), false);
  }

  // ---- Entrance tower: porch, square stages, octagonal belfry, spire, iron cage ----
  const T = 5.6;
  const tx = Math.min(hw - T / 2 - 1.6, x1 + 0.4);
  flat(hw - (tx + T / 2), 4.2, (hw + tx + T / 2) / 2, 0, pathMat, 0.03); // gravel walk to the porch
  const s1 = P + 6.3; // porch top
  const s2 = P + 17.0; // square shaft top
  const s3 = s2 + 5.0; // octagonal belfry top
  mesh(g, new THREE.BoxGeometry(T, s2 - P, T), lime, tx, (P + s2) / 2, 0);
  for (const y of [s1, P + 11.5, s2]) {
    mesh(g, new THREE.BoxGeometry(T + 0.3, 0.35, T + 0.3), red, tx, y, 0, false);
    mesh(g, new THREE.BoxGeometry(T + 0.2, 0.25, T + 0.2), cream, tx, y + 0.3, 0, false);
  }
  // Grey sandstone bands, kept clear of the porch arch and the lancets
  for (const y of [s1 + 4.3, P + 16.3]) mesh(g, new THREE.BoxGeometry(T + 0.06, 0.28, T + 0.06), grey, tx, y, 0, false);
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2 + Math.PI / 2; // f=0 faces the street
    const ox = Math.sin(a), oz = Math.cos(a);
    const r = T / 2;
    if (f !== 2) {
      // Porch arch through the base (front and both sides)
      mesh(g, new THREE.ShapeGeometry(pointedArchShape(1.5, 5.0) as THREE.Shape), dark, tx + ox * (r + 0.02), P, oz * (r + 0.02), false).rotation.y = a;
      mesh(g, archFrameGeo(1.5, 5.0, 0.4, 0.35), red, tx + ox * (r + 0.32), P, oz * (r + 0.32), false).rotation.y = a;
    }
    // Paired lancets in the middle stage, a single tall lancet above
    for (const d of [-0.75, 0.75]) {
      mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.36, 2.6) as THREE.Shape), dark, tx + ox * (r + 0.02) + Math.cos(a) * d, s1 + 1.2, oz * (r + 0.02) - Math.sin(a) * d, false).rotation.y = a;
    }
    mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.5, 3.6) as THREE.Shape), dark, tx + ox * (r + 0.02), P + 12.4, oz * (r + 0.02), false).rotation.y = a;
    mesh(g, archFrameGeo(0.5, 3.6, 0.22, 0.2), cream, tx + ox * (r + 0.2), P + 12.4, oz * (r + 0.2), false).rotation.y = a;
  }
  // Corner pinnacles easing square into octagon
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(0.7, 1.8, 0.7), lime, tx + cx * (T / 2 - 0.2), s2 + 0.9, cz * (T / 2 - 0.2), false);
      mesh(g, new THREE.ConeGeometry(0.42, 2.0, 4).rotateY(Math.PI / 4), cream, tx + cx * (T / 2 - 0.2), s2 + 2.8, cz * (T / 2 - 0.2), false);
    }
  }
  const oct = new THREE.CylinderGeometry(2.25, 2.4, s3 - s2, 8).toNonIndexed();
  oct.computeVertexNormals();
  mesh(g, oct, lime, tx, (s2 + s3) / 2, 0);
  for (let f = 0; f < 8; f++) {
    const a = ((f + 0.5) / 8) * Math.PI * 2;
    const r = 2.25 * Math.cos(Math.PI / 8) + 0.03;
    mesh(g, new THREE.ShapeGeometry(pointedArchShape(0.42, 2.8) as THREE.Shape), dark, tx + Math.sin(a) * r, s2 + 1.0, Math.cos(a) * r, false).rotation.y = a;
  }
  mesh(g, new THREE.CylinderGeometry(2.6, 2.6, 0.4, 8), red, tx, s3, 0, false);
  const spire = new THREE.ConeGeometry(2.35, 9.0, 8).toNonIndexed();
  spire.computeVertexNormals();
  mesh(g, spire, slate, tx, s3 + 0.2 + 4.5, 0);
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2 + Math.PI / 8;
    mesh(g, new THREE.ConeGeometry(0.5, 1.4, 4).rotateY(Math.PI / 4), cream, tx + Math.sin(a) * 1.7, s3 + 2.0, Math.cos(a) * 1.7, false);
  }
  // Iron cage crown: ring, eight bars, cap and finial
  const cageY = s3 + 0.2 + 9.0 - 1.0;
  mesh(g, new THREE.TorusGeometry(0.75, 0.05, 4, 12).rotateX(Math.PI / 2), iron, tx, cageY, 0, false);
  mesh(g, new THREE.TorusGeometry(0.55, 0.05, 4, 12).rotateX(Math.PI / 2), iron, tx, cageY + 1.4, 0, false);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const bar = mesh(g, new THREE.BoxGeometry(0.06, 1.45, 0.06), iron, tx + Math.sin(a) * 0.65, cageY + 0.7, Math.cos(a) * 0.65, false);
    bar.rotation.set(Math.cos(a) * 0.14, 0, -Math.sin(a) * 0.14);
  }
  mesh(g, new THREE.ConeGeometry(0.6, 0.8, 8), iron, tx, cageY + 1.8, 0, false);
  mesh(g, new THREE.CylinderGeometry(0.04, 0.04, 2.0, 4), iron, tx, cageY + 3.0, 0, false);
  mesh(g, new THREE.SphereGeometry(0.16, 6, 4), lam('#c9a24a'), tx, cageY + 2.25, 0, false);

  // Porch steps
  for (let k = 0; k < 3; k++) {
    mesh(g, new THREE.BoxGeometry(1.0, P - k * 0.33, 4.2 - k * 0.3), grey, tx + T / 2 + 0.5 - k * 0.4, (P - k * 0.33) / 2, 0, false);
  }

  // Name stone on the lawn by the gate
  const plaqueTex = signTexture(['FRERE HALL · فریئر ہال · 1865', 'BAGH-E-JINNAH · SADEQUAIN GALLERY'], '#7b1f16', '#ffecb3', 768, 128);
  const plaqueMat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    map: plaqueTex,
    emissive: new THREE.Color('#ffecb3'),
    emissiveMap: plaqueTex,
    emissiveIntensity: 0,
  });
  litMats.push(plaqueMat);
  mesh(g, new THREE.BoxGeometry(0.5, 1.6, 7.6), grey, hw - 0.6, 0.8, -hl + 5.0);
  mesh(g, new THREE.PlaneGeometry(7.2, 1.0), plaqueMat, hw - 0.34, 1.0, -hl + 5.0, false).rotation.y = Math.PI / 2;

  mergeByMaterial(g, shadow);
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


