import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityMap, KERB_H, SIDEWALK } from '../sim/city/cityMap';
import type { CityLink, CityMap } from '../sim/city/cityMap';
import { PATCHED_ROUNDABOUTS, ringOuterR } from '../sim/city/saddarPatches';
import { pointObbDistance } from '../sim/math';
import { Rng } from '../sim/rng';
import { GROUND_FLOOR_H, makeFacadeMaterial, setFacadeNight, STOREY_H } from './facadeMaterial';
import { buildParkedBikeGeometry, PARKED_BIKE_COLORS } from './parkedBikes';
import type { TimeOfDay } from './Renderer';
import { buildSaddarLandmark } from './SaddarLandmarks';
import { paint } from './strip';
import {
  asphaltTexture,
  BANNER_COUNT,
  contactShadowTexture,
  dirtTexture,
  flagPavingTexture,
  kerbStripeTexture,
  lawnTexture,
  NEON_H_COUNT,
  NEON_V_COUNT,
  neonHAtlas,
  neonHAtlasUv,
  neonVAtlas,
  neonVAtlasUv,
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

function segDistToPoint(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(ax + ex * t - px, az + ez * t - pz);
}

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
const CHUNK_SIZE = 200;
const CHUNK_CULL_DIST = 420;

const BUILDING_COLORS = [
  '#d9c9a3', '#cdb48a', '#e3dccb', '#bfae8e', '#d6c2a0', '#c9bba3',
  '#e0cfae', '#b8a888', '#cfd0c8', '#e6d3b0', '#c7b593', '#ddd2bd',
];

const ZERO_MAT = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -500, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0, 0, 0),
);
const dummy = new THREE.Object3D();

function place(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, ry, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

/** Normalize geometry to non-indexed [position, normal, color (, uv)] for BatchedMesh / merging. */
function prepBatchGeo(
  geo: THREE.BufferGeometry,
  withUv: boolean,
  color?: THREE.Color | string,
  matrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  if (!g.getAttribute('normal')) g.computeVertexNormals();

  if (withUv) {
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
  } else if (g.getAttribute('uv')) {
    g.deleteAttribute('uv');
  }

  if (color !== undefined || !g.getAttribute('color')) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color ?? '#ffffff');
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  for (const attr of Object.keys(g.attributes)) {
    if (attr !== 'position' && attr !== 'normal' && attr !== 'color' && (!withUv || attr !== 'uv')) {
      g.deleteAttribute(attr);
    }
  }
  return g;
}

/** Duplicate non-indexed triangles with reversed winding so DoubleSide renders properly on FrontSide BatchedMesh. */
function makeDoubleSidedGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position').array as Float32Array;
  const nrm = g.getAttribute('normal').array as Float32Array;
  const col = g.getAttribute('color').array as Float32Array;
  const uvAttr = g.getAttribute('uv');
  const uv = uvAttr ? (uvAttr.array as Float32Array) : null;
  const count = pos.length / 3;

  const outPos = new Float32Array(pos.length * 2);
  const outNrm = new Float32Array(nrm.length * 2);
  const outCol = new Float32Array(col.length * 2);
  const outUv = uv ? new Float32Array(uv.length * 2) : null;

  outPos.set(pos, 0);
  outNrm.set(nrm, 0);
  outCol.set(col, 0);
  if (uv && outUv) outUv.set(uv, 0);

  const pOff = pos.length;
  const uvOff = uv ? uv.length : 0;
  for (let i = 0; i < count; i += 3) {
    const mapIdx = [i, i + 2, i + 1];
    for (let k = 0; k < 3; k++) {
      const dst = i + k;
      const src = mapIdx[k];
      outPos[pOff + dst * 3] = pos[src * 3];
      outPos[pOff + dst * 3 + 1] = pos[src * 3 + 1];
      outPos[pOff + dst * 3 + 2] = pos[src * 3 + 2];
      outNrm[pOff + dst * 3] = -nrm[src * 3];
      outNrm[pOff + dst * 3 + 1] = -nrm[src * 3 + 1];
      outNrm[pOff + dst * 3 + 2] = -nrm[src * 3 + 2];
      outCol[pOff + dst * 3] = col[src * 3];
      outCol[pOff + dst * 3 + 1] = col[src * 3 + 1];
      outCol[pOff + dst * 3 + 2] = col[src * 3 + 2];
      if (uv && outUv) {
        outUv[uvOff + dst * 2] = uv[src * 2];
        outUv[uvOff + dst * 2 + 1] = uv[src * 2 + 1];
      }
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  if (outUv) out.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  g.dispose();
  return out;
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
  const merged = mergeGeometries([front, back], false);
  front.dispose();
  back.dispose();
  return merged ?? atlasQuadGeo(uv);
}

interface AtlasSlotRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Shelf-packs ClampToEdge decals into a single albedo + emissive atlas pair (flipY = true). */
class DecalAtlasBuilder {
  readonly width = 2048;
  readonly height = 1024;
  private readonly albedoCanvas = document.createElement('canvas');
  private readonly emissiveCanvas = document.createElement('canvas');
  private readonly albedoCtx: CanvasRenderingContext2D;
  private readonly emissiveCtx: CanvasRenderingContext2D;
  private readonly slots = new Map<string, AtlasSlotRect>();
  private curX = 4;
  private curY = 4;
  private shelfH = 0;

  constructor() {
    this.albedoCanvas.width = this.width;
    this.albedoCanvas.height = this.height;
    this.emissiveCanvas.width = this.width;
    this.emissiveCanvas.height = this.height;
    this.albedoCtx = this.albedoCanvas.getContext('2d')!;
    this.emissiveCtx = this.emissiveCanvas.getContext('2d')!;
    this.albedoCtx.fillStyle = '#ffffff';
    this.albedoCtx.fillRect(0, 0, this.width, this.height);
    this.emissiveCtx.fillStyle = '#000000';
    this.emissiveCtx.fillRect(0, 0, this.width, this.height);
  }

  pack(map: THREE.Texture, emissiveMap: THREE.Texture | null, emissiveColor: THREE.Color, lit: boolean): AtlasSlotRect {
    const img = map.image as HTMLCanvasElement | HTMLImageElement | undefined;
    const emImg = (emissiveMap?.image as HTMLCanvasElement | HTMLImageElement | undefined) ?? null;
    const key = `${map.uuid}|${emissiveMap?.uuid ?? ''}|${emissiveColor.getHexString()}|${lit ? 1 : 0}`;
    const hit = this.slots.get(key);
    if (hit) return hit;

    const srcW = Math.max(8, img?.width ?? 64);
    const srcH = Math.max(8, img?.height ?? 64);
    const scale = Math.min(1, 256 / Math.max(srcW, srcH));
    const w = Math.max(16, Math.round(srcW * scale));
    const h = Math.max(16, Math.round(srcH * scale));
    const pad = 4;

    if (this.curX + w + pad > this.width - 4) {
      this.curX = 4;
      this.curY += this.shelfH + pad;
      this.shelfH = 0;
    }
    if (this.curY + h + pad > this.height - 4) {
      // Compact fallback: scale down if atlas shelf fills up (won't happen in Saddar, stays < 50% full).
      return { u0: 0, v0: 0, u1: 1, v1: 1 };
    }

    const x = this.curX;
    const y = this.curY;
    this.curX += w + pad;
    if (h > this.shelfH) this.shelfH = h;

    if (img) {
      this.albedoCtx.drawImage(img, x, y, w, h);
      // 2 px edge extrusion to prevent mip bleed
      this.albedoCtx.drawImage(img, 0, 0, 1, srcH, x - 2, y, 2, h);
      this.albedoCtx.drawImage(img, srcW - 1, 0, 1, srcH, x + w, y, 2, h);
      this.albedoCtx.drawImage(img, 0, 0, srcW, 1, x, y - 2, w, 2);
      this.albedoCtx.drawImage(img, 0, srcH - 1, srcW, 1, x, y + h, w, 2);
    }

    if (lit && (emImg || img)) {
      const eSrc = emImg ?? img!;
      this.emissiveCtx.save();
      this.emissiveCtx.drawImage(eSrc, x, y, w, h);
      // Tint emissive channel by material emissive color when not white
      if (emissiveColor.r < 0.99 || emissiveColor.g < 0.99 || emissiveColor.b < 0.99) {
        this.emissiveCtx.globalCompositeOperation = 'multiply';
        this.emissiveCtx.fillStyle = `#${emissiveColor.getHexString()}`;
        this.emissiveCtx.fillRect(x, y, w, h);
      }
      this.emissiveCtx.restore();
    }

    // flipY = true -> V=1 is top of canvas (y), V=0 is bottom of canvas (y + h)
    const u0 = (x + 1.5) / this.width;
    const u1 = (x + w - 1.5) / this.width;
    const v1 = 1 - (y + 1.5) / this.height;
    const v0 = 1 - (y + h - 1.5) / this.height;
    const rect = { u0, v0, u1, v1 };
    this.slots.set(key, rect);
    return rect;
  }

  buildTextures(): { albedo: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
    const albedo = new THREE.CanvasTexture(this.albedoCanvas);
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.anisotropy = 4;

    const emissive = new THREE.CanvasTexture(this.emissiveCanvas);
    emissive.colorSpace = THREE.SRGBColorSpace;
    emissive.anisotropy = 4;
    return { albedo, emissive };
  }
}

interface BatchProtoEntry {
  chunkKey: string;
  geoIdx: number;
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

interface ChunkRef {
  cx: number;
  cz: number;
  visible: boolean;
  batches: Array<{ bm: THREE.BatchedMesh; ids: number[] }>;
  insts: Array<{ mesh: THREE.InstancedMesh; indices: number[]; mats: THREE.Matrix4[] }>;
  extras: THREE.Object3D[];
}

interface ChunkAccum {
  cx: number;
  cz: number;
  clutterGeos: THREE.BufferGeometry[];
  floodlitGeos: THREE.BufferGeometry[];
  decalGeos: THREE.BufferGeometry[];
  repeating: Map<string, { mat: THREE.MeshLambertMaterial; geos: THREE.BufferGeometry[] }>;
  wires: number[];
  signs: THREE.Matrix4[][];
  banners: THREE.Matrix4[][];
  neonH: THREE.Matrix4[][];
  neonV: THREE.Matrix4[][];
}

const IDENTITY_MAT = new THREE.Matrix4();

/**
 * Ground-up WebGL2 BatchedMesh + InstancedMesh Saddar renderer:
 * consolidates city surfaces, buildings, clutter, signage, and all 31 Saddar landmarks
 * into ~21-24 real draw calls with chunk-level visibility toggling.
 */
export class CityScenery {
  readonly group = new THREE.Group();
  visibleChunks = 0;

  private readonly chunks: ChunkRef[] = [];
  private readonly chunkMap = new Map<string, ChunkRef>();
  private readonly chunkAccum = new Map<string, ChunkAccum>();
  private readonly occupied: Array<[number, number, number]> = [];

  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private readonly ownedTex: THREE.Texture[] = [];
  private readonly ownedBatches: THREE.BatchedMesh[] = [];
  private readonly ownedInsts: THREE.InstancedMesh[] = [];
  private readonly dirtyInsts = new Set<THREE.InstancedMesh>();

  private facadeMat!: THREE.MeshLambertMaterial;
  private roadMat!: THREE.MeshPhongMaterial;
  private puddleMat!: THREE.MeshPhongMaterial;
  private shopSignMat!: THREE.MeshLambertMaterial;
  private bannerMat!: THREE.MeshLambertMaterial;
  private neonMats: THREE.MeshLambertMaterial[] = [];
  private lampBulbMat!: THREE.MeshLambertMaterial;
  private warmGlowMat!: THREE.MeshBasicMaterial;
  private litProps: THREE.MeshLambertMaterial[] = [];

  private glowInst: THREE.InstancedMesh | null = null;
  private fountainJetsInst: THREE.InstancedMesh | null = null;
  private fountainBaseMats: THREE.Matrix4[] = [];
  private fountainChunk: ChunkRef | null = null;
  private readonly tmpJetMat = new THREE.Matrix4();
  private readonly tmpJetScale = new THREE.Matrix4();

  private gardenTrees: Array<[number, number]> = [];
  private gardenGravelGeos: THREE.BufferGeometry[] = [];
  private gardenLawnGeos: THREE.BufferGeometry[] = [];
  private kerbParts: THREE.BufferGeometry[] = [];
  private dirtParts: THREE.BufferGeometry[] = [];

  private steamPos: Float32Array | null = null;
  private steamGeo: THREE.BufferGeometry | null = null;
  private steamSeeds: number[] = [];

  private readonly repeatTexCache = new Map<object, THREE.Texture>();
  private readonly repeatMatCache = new Map<string, THREE.MeshLambertMaterial>();

  constructor(lowSpec: boolean) {
    void lowSpec;
    const map = cityMap();
    this.ground(map);
    this.roads(map);
    this.puddles(map);
    this.pavements(map);
    this.marketSquare(map);
    this.landmarkGarden(map, 'frere_hall', 58, 7, 9);
    this.landmarkGarden(map, 'mazar_quaid', 60, 6, 10);
    this.landmarkGarden(map, 'sindh_high_court', 45, 5, 11);
    this.markings(map);
    this.islands(map);
    this.pedestrianBridges(map);
    this.buildings(map);
    this.poles(map);
    this.trees(map);
    this.chaiDhabas(map);
    this.parkedClutter(map);
    this.yards(map);
    this.ramps(map);
    this.flushSurfaces();
    this.landmarks(map);
    this.flushAllChunks();
  }

  private chunkKeyFor(x: number, z: number): string {
    const gx = Math.floor(x / CHUNK_SIZE);
    const gz = Math.floor(z / CHUNK_SIZE);
    return `${gx},${gz}`;
  }

  private ensureChunkRef(key: string): ChunkRef {
    let c = this.chunkMap.get(key);
    if (!c) {
      const [gxStr, gzStr] = key.split(',');
      const gx = Number(gxStr);
      const gz = Number(gzStr);
      c = {
        cx: (gx + 0.5) * CHUNK_SIZE,
        cz: (gz + 0.5) * CHUNK_SIZE,
        visible: true,
        batches: [],
        insts: [],
        extras: [],
      };
      this.chunkMap.set(key, c);
      this.chunks.push(c);
    }
    return c;
  }

  private accumFor(x: number, z: number): ChunkAccum {
    const key = this.chunkKeyFor(x, z);
    let a = this.chunkAccum.get(key);
    if (!a) {
      this.ensureChunkRef(key);
      const [gxStr, gzStr] = key.split(',');
      a = {
        cx: (Number(gxStr) + 0.5) * CHUNK_SIZE,
        cz: (Number(gzStr) + 0.5) * CHUNK_SIZE,
        clutterGeos: [],
        floodlitGeos: [],
        decalGeos: [],
        repeating: new Map(),
        wires: [],
        signs: Array.from({ length: SHOP_SIGN_COUNT }, () => []),
        banners: Array.from({ length: BANNER_COUNT }, () => []),
        neonH: Array.from({ length: NEON_H_COUNT }, () => []),
        neonV: Array.from({ length: NEON_V_COUNT }, () => []),
      };
      this.chunkAccum.set(key, a);
    }
    return a;
  }

  private repeatTexture(src: THREE.Texture): THREE.Texture {
    const img = src.image as object | undefined;
    const key = img ?? src;
    let tex = this.repeatTexCache.get(key);
    if (!tex) {
      tex = src.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      tex.offset.set(0, 0);
      tex.needsUpdate = true;
      this.repeatTexCache.set(key, tex);
      this.ownedTex.push(tex);
    }
    return tex;
  }

  private repeatingMaterial(
    map: THREE.Texture,
    emissiveMap: THREE.Texture | null,
    emissiveHex: string,
  ): THREE.MeshLambertMaterial {
    const mapTex = this.repeatTexture(map);
    const emTex = emissiveMap ? this.repeatTexture(emissiveMap) : null;
    const key = `${mapTex.uuid}|${emTex?.uuid ?? ''}|${emissiveHex}`;
    let mat = this.repeatMatCache.get(key);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color: '#ffffff',
        vertexColors: true,
        map: mapTex,
        emissiveMap: emTex,
        emissive: new THREE.Color(emissiveHex),
        emissiveIntensity: 0,
      });
      this.repeatMatCache.set(key, mat);
      this.ownedMats.push(mat);
      if (emTex || emissiveHex !== '000000') {
        this.litProps.push(mat);
      }
    }
    return mat;
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
    if (this.shopSignMat) this.shopSignMat.emissiveIntensity = tod === 'night' ? 1.7 : tod === 'monsoon' ? 1.3 : tod === 'sunset' ? 0.9 : 0;
    for (const m of this.neonMats) m.emissiveIntensity = tod === 'night' ? 2.6 : tod === 'monsoon' ? 2.2 : tod === 'sunset' ? 1.7 : 0.45;
    if (this.bannerMat) this.bannerMat.emissiveIntensity = tod === 'night' ? 0.55 : tod === 'monsoon' ? 0.42 : tod === 'sunset' ? 0.2 : 0;
    if (this.lampBulbMat) this.lampBulbMat.emissiveIntensity = tod === 'night' ? 3.0 : tod === 'monsoon' ? 2.4 : tod === 'sunset' ? 1.4 : 0;
    const propGlow = tod === 'night' ? 0.65 : tod === 'monsoon' ? 0.5 : tod === 'sunset' ? 0.25 : 0;
    for (const m of this.litProps) m.emissiveIntensity = propGlow;
    const showGlow = tod !== 'noon';
    if (this.warmGlowMat) this.warmGlowMat.opacity = tod === 'night' ? 0.44 : tod === 'monsoon' ? 0.38 : 0.22;
    if (this.glowInst) this.glowInst.visible = showGlow;
  }

  update(time: number, x: number, z: number): void {
    let vis = 0;
    this.dirtyInsts.clear();
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const on = Math.abs(c.cx - x) < CHUNK_CULL_DIST && Math.abs(c.cz - z) < CHUNK_CULL_DIST;
      if (on) vis++;
      if (on !== c.visible) {
        c.visible = on;
        for (let b = 0; b < c.batches.length; b++) {
          const ref = c.batches[b];
          const ids = ref.ids;
          for (let k = 0; k < ids.length; k++) {
            ref.bm.setVisibleAt(ids[k], on);
          }
        }
        for (let ii = 0; ii < c.insts.length; ii++) {
          const ref = c.insts[ii];
          const idxs = ref.indices;
          const mats = ref.mats;
          for (let k = 0; k < idxs.length; k++) {
            ref.mesh.setMatrixAt(idxs[k], on ? mats[k] : ZERO_MAT);
          }
          this.dirtyInsts.add(ref.mesh);
        }
        for (let e = 0; e < c.extras.length; e++) {
          c.extras[e].visible = on;
        }
      }
    }
    this.visibleChunks = vis;
    if (this.dirtyInsts.size > 0) {
      for (const m of this.dirtyInsts) m.instanceMatrix.needsUpdate = true;
    }

    if (this.fountainJetsInst && (!this.fountainChunk || this.fountainChunk.visible)) {
      for (let i = 0; i < this.fountainBaseMats.length; i++) {
        const pulse = 0.82 + 0.28 * Math.sin(time * 4.2 + i * 1.1);
        this.tmpJetScale.makeScale(1, pulse, 1);
        this.tmpJetMat.multiplyMatrices(this.fountainBaseMats[i], this.tmpJetScale);
        this.fountainJetsInst.setMatrixAt(i, this.tmpJetMat);
      }
      this.fountainJetsInst.instanceMatrix.needsUpdate = true;
    }

    if (this.steamPos && this.steamGeo) {
      const n = this.steamSeeds.length / 4;
      for (let i = 0; i < n; i++) {
        const bx = this.steamSeeds[i * 4];
        const by = this.steamSeeds[i * 4 + 1];
        const bz = this.steamSeeds[i * 4 + 2];
        const ph = this.steamSeeds[i * 4 + 3];
        const cyc = (time * 0.65 + ph) % 1;
        this.steamPos[i * 3] = bx + Math.sin(time * 2.1 + ph * 6.2) * 0.22 * cyc;
        this.steamPos[i * 3 + 1] = by + cyc * 1.65;
        this.steamPos[i * 3 + 2] = bz + Math.cos(time * 1.8 + ph * 6.2) * 0.22 * cyc;
      }
      this.steamGeo.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.ownedBatches) b.dispose();
    for (const im of this.ownedInsts) im.dispose();
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    for (const t of this.ownedTex) t.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) {
        if (o instanceof THREE.BatchedMesh || o instanceof THREE.InstancedMesh) return;
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    this.ownedBatches.length = 0;
    this.ownedInsts.length = 0;
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;
    this.ownedTex.length = 0;
    this.chunks.length = 0;
    this.chunkMap.clear();
    this.chunkAccum.clear();
    this.repeatTexCache.clear();
    this.repeatMatCache.clear();
    this.glowInst = null;
    this.fountainJetsInst = null;
    this.fountainBaseMats = [];
    this.fountainChunk = null;
    this.steamPos = null;
    this.steamGeo = null;
    this.steamSeeds = [];
  }

  // ---- Surfaces -------------------------------------------------------------

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
    g.castShadow = false;
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
    m.castShadow = false;
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
    const merged = mergeGeometries(parts, false);
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
    mesh.castShadow = false;
    this.group.add(mesh);
  }

  private landmarkCells(map: CityMap, kind: string, R: number, maxLr = Infinity) {
    const lm = map.landmarks.find((l) => l.kind === kind);
    if (!lm) return null;
    const N = 2 * R;
    const hs = Math.sin(lm.obb.heading), hc = Math.cos(lm.obb.heading);
    const world = (lr: number, lf: number): [number, number] => [lm.obb.x + lf * hs + lr * hc, lm.obb.z + lf * hc - lr * hs];
    const idx = (i: number, j: number) => j * N + i;
    const state = new Uint8Array(N * N);
    const open = (i: number, j: number) => {
      if (-R + i + 0.5 > maxLr) return false;
      const [x, z] = world(-R + i + 0.5, -R + j + 0.5);
      return !map.isRoad(x, z) && !map.nearRoad(x, z, SIDEWALK - 0.8);
    };
    const stack: Array<[number, number]> = [[R, R]];
    state[idx(R, R)] = 1;
    while (stack.length) {
      const [i, j] = stack.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N || state[idx(a, b)]) continue;
        if (open(a, b)) {
          state[idx(a, b)] = 1;
          stack.push([a, b]);
        } else state[idx(a, b)] = 2;
      }
    }
    const local = (i: number, j: number): [number, number] => [-R + i + 0.5, -R + j + 0.5];
    const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N && state[idx(i, j)] === 1;
    return { lm, N, R, world, local, filled };
  }

  private cellSurfaceGeo(
    cells: NonNullable<ReturnType<CityScenery['landmarkCells']>>,
    keep: (i: number, j: number) => boolean,
    y: number,
    uvS: number,
    colorHex: string,
  ): THREE.BufferGeometry | null {
    const { N, R, world } = cells;
    const pos: number[] = [];
    const uv: number[] = [];
    const ind: number[] = [];
    for (let j = 0; j < N; j++) {
      let i = 0;
      while (i < N) {
        if (!keep(i, j)) {
          i++;
          continue;
        }
        let e = i;
        while (e + 1 < N && keep(e + 1, j)) e++;
        const a = -R + i, b = -R + e + 1;
        const f0 = -R + j, f1 = f0 + 1;
        const v = pos.length / 3;
        for (const [lr, lf] of [[a, f0], [b, f0], [b, f1], [a, f1]]) {
          const [x, z] = world(lr, lf);
          pos.push(x, y, -z);
          uv.push(lr * uvS, lf * uvS);
        }
        ind.push(v, v + 1, v + 2, v, v + 2, v + 3);
        i = e + 1;
      }
    }
    if (!ind.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nrm = new Float32Array(pos.length);
    for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(ind);
    const prepped = prepBatchGeo(geo, true, colorHex);
    geo.dispose();
    return prepped;
  }

  private marketSquare(map: CityMap): void {
    const cells = this.landmarkCells(map, 'empress', 95);
    if (!cells) return;
    const geo = this.cellSurfaceGeo(cells, cells.filled, KERB_H + 0.02, 1 / 6, '#efe2c8');
    if (!geo) return;
    const mat = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      vertexColors: true,
      map: flagPavingTexture(),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    this.group.add(m);
  }

  private landmarkGarden(map: CityMap, kind: string, R: number, ring: number, treeStep: number): void {
    const lm0 = map.landmarks.find((l) => l.kind === kind);
    if (!lm0) return;
    const cells = this.landmarkCells(map, kind, R, lm0.obb.hw + 2);
    if (!cells) return;
    const { lm, local, filled } = cells;
    const { hw, hl } = lm.obb;
    const walk = (i: number, j: number) => {
      const [lr, lf] = local(i, j);
      const d = Math.max(Math.abs(lr) - hw - ring, Math.abs(lf) - hl - ring);
      return Math.abs(lf) < 2.2 || Math.abs(lr) < 1.6 || (d > -2.2 && d < 0);
    };
    const lawnGeo = this.cellSurfaceGeo(cells, (i, j) => filled(i, j) && !walk(i, j), KERB_H + 0.02, 1 / 8, '#ffffff');
    if (lawnGeo) this.gardenLawnGeos.push(lawnGeo);
    const gravelGeo = this.cellSurfaceGeo(cells, (i, j) => filled(i, j) && walk(i, j), KERB_H + 0.025, 1 / 3, '#e2d4b6');
    if (gravelGeo) this.gardenGravelGeos.push(gravelGeo);

    if (treeStep <= 0) return;
    const rng = new Rng(kind.length * 977);
    for (let j = 4; j < cells.N - 4; j += treeStep) {
      for (let i = 4; i < cells.N - 4; i += treeStep) {
        const ii = i + Math.round(rng.range(-3, 3)), jj = j + Math.round(rng.range(-3, 3));
        if (!filled(ii, jj) || walk(ii, jj)) continue;
        let ok = true;
        for (let d = -3; d <= 3 && ok; d += 3) for (let e = -3; e <= 3 && ok; e += 3) if (!filled(ii + d, jj + e)) ok = false;
        const [lr, lf] = local(ii, jj);
        if (!ok || (Math.abs(lr) < hw + ring && Math.abs(lf) < hl + ring)) continue;
        this.gardenTrees.push(cells.world(lr, lf));
      }
    }
  }

  private pavements(map: CityMap): void {
    const top = new Tris();
    const kerb = new Tris();
    const uvS = 1 / 3;
    const cuts = PATCHED_ROUNDABOUTS.map((ra) => ({ x: ra.x, z: ra.z, r: ringOuterR(ra) }));
    for (const slab of map.slabs) {
      const pts = slab.pts;
      const n = pts.length / 2;
      if (n < 3) continue;
      const col = slab.kind === 1 ? PARK_TINT : WHITE;
      const emit = (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, depth: number): void => {
        const cut = cuts.find((c) => Math.min(x0, x1, x2) < c.x + c.r && Math.max(x0, x1, x2) > c.x - c.r && Math.min(z0, z1, z2) < c.z + c.r && Math.max(z0, z1, z2) > c.z - c.r);
        if (cut) {
          const inside = (x: number, z: number) => (x - cut.x) ** 2 + (z - cut.z) ** 2 < cut.r * cut.r;
          const ins = (inside(x0, z0) ? 1 : 0) + (inside(x1, z1) ? 1 : 0) + (inside(x2, z2) ? 1 : 0);
          if (ins === 3) return;
          if (depth < 7) {
            const ax = (x0 + x1) / 2, az = (z0 + z1) / 2, bx = (x1 + x2) / 2, bz = (z1 + z2) / 2, cx = (x2 + x0) / 2, cz = (z2 + z0) / 2;
            emit(x0, z0, ax, az, cx, cz, depth + 1);
            emit(ax, az, x1, z1, bx, bz, depth + 1);
            emit(cx, cz, bx, bz, x2, z2, depth + 1);
            emit(ax, az, bx, bz, cx, cz, depth + 1);
            return;
          }
          if (ins > 0) return;
        }
        top.tri(
          [x0, KERB_H, -z0],
          [x1, KERB_H, -z1],
          [x2, KERB_H, -z2],
          [x0 * uvS, z0 * uvS, x1 * uvS, z1 * uvS, x2 * uvS, z2 * uvS],
          UP,
          col,
        );
      };
      for (let i = 0; i < slab.tris.length; i += 3) {
        const i0 = slab.tris[i] * 2, i1 = slab.tris[i + 1] * 2, i2 = slab.tris[i + 2] * 2;
        emit(pts[i0], pts[i0 + 1], pts[i1], pts[i1 + 1], pts[i2], pts[i2 + 1], 0);
      }
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
        const nx = (sign * ez) / len, nz = (-sign * ex) / len;
        const hits =
          (map.isRoad(ax + ex * 0.2 + nx * 0.45, az + ez * 0.2 + nz * 0.45) ? 1 : 0) +
          (map.isRoad(ax + ex * 0.5 + nx * 0.45, az + ez * 0.5 + nz * 0.45) ? 1 : 0) +
          (map.isRoad(ax + ex * 0.8 + nx * 0.45, az + ez * 0.8 + nz * 0.45) ? 1 : 0);
        const u1 = u + len;
        const inRing = cuts.some((c) => segDistToPoint(ax, az, bx, bz, c.x, c.z) < c.r + 0.2);
        if (!inRing && hits >= (len > 6 ? 2 : 1)) {
          kerb.quad([ax, 0, -az], [bx, 0, -bz], [bx, KERB_H, -bz], [ax, KERB_H, -az], [u, 0, u1, 0, u1, 1, u, 1], [nx, 0, -nz]);
        }
        u = u1;
      }
    }
    for (const c of cuts) {
      const K = 72, W = 2.8;
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * Math.PI * 2, a1 = ((k + 1) / K) * Math.PI * 2, am = (a0 + a1) / 2;
        const out = (a: number, r: number): [number, number] => [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r];
        const [mx, mz] = out(am, c.r + W / 2);
        if (map.isRoad(mx, mz) || map.nearRoad(mx, mz, 0.6)) continue;
        const p00 = out(a0, c.r), p01 = out(a1, c.r), p11 = out(a1, c.r + W), p10 = out(a0, c.r + W);
        const y = KERB_H + 0.006;
        top.quad(
          [p00[0], y, -p00[1]], [p01[0], y, -p01[1]], [p11[0], y, -p11[1]], [p10[0], y, -p10[1]],
          [p00[0] * uvS, p00[1] * uvS, p01[0] * uvS, p01[1] * uvS, p11[0] * uvS, p11[1] * uvS, p10[0] * uvS, p10[1] * uvS],
          UP,
        );
        const nx = Math.cos(am), nz = Math.sin(am);
        kerb.quad([p00[0], 0, -p00[1]], [p01[0], 0, -p01[1]], [p01[0], y, -p01[1]], [p00[0], y, -p00[1]], [0, 0, 1, 0, 1, 1, 0, 1], [-nx, 0, nz]);
      }
    }
    const pave = dirtTexture().clone();
    pave.needsUpdate = true;
    this.ownedTex.push(pave);
    const tm = new THREE.Mesh(top.build(), new THREE.MeshLambertMaterial({ map: pave, color: '#e4dfd5', vertexColors: true }));
    tm.receiveShadow = true;
    tm.castShadow = false;
    this.group.add(tm);
    if (!kerb.empty) {
      const kg = kerb.build();
      this.kerbParts.push(prepBatchGeo(kg, true, '#ffffff'));
      kg.dispose();
    }
  }

  private markings(map: CityMap): void {
    const q = new Tris();
    const white = new THREE.Color('#f2f0ea');
    const yellow = new THREE.Color('#e8b923');
    const y = 0.012;
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
    m.castShadow = false;
    this.group.add(m);
  }

  private islands(map: CityMap): void {
    const decalBuilder = this.ensureDecalBuilder();
    for (const s of map.islands) {
      const segs = s.monumental ? 40 : 28;
      const ak = this.accumFor(s.x, s.z);

      // Kerb cylinder merged into kerbParts with U scaled to circumference
      const kerbGeo = new THREE.CylinderGeometry(s.r, s.r, 0.35, segs, 1, true);
      const uv = kerbGeo.getAttribute('uv');
      const repU = Math.round(Math.PI * 2 * s.r);
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repU);
      kerbGeo.translate(s.x, 0.175, -s.z);
      this.kerbParts.push(prepBatchGeo(kerbGeo, true, '#ffffff'));
      kerbGeo.dispose();

      // Grass top
      const grassGeo = new THREE.CircleGeometry(s.r, segs).rotateX(-Math.PI / 2).translate(s.x, 0.34, -s.z);
      ak.clutterGeos.push(prepBatchGeo(grassGeo, false, '#86a05a'));
      grassGeo.dispose();

      if (s.monumental) {
        const pushBox = (geo: THREE.BufferGeometry, col: string, px: number, py: number, pz: number, floodlit = false) => {
          geo.translate(px, py, pz);
          const prepped = prepBatchGeo(geo, false, col);
          geo.dispose();
          if (floodlit) ak.floodlitGeos.push(prepped);
          else ak.clutterGeos.push(prepped);
        };

        pushBox(new THREE.CylinderGeometry(8.6, 9.2, 0.95, 16), '#b33c26', s.x, 0.75, -s.z);
        pushBox(new THREE.CylinderGeometry(8.0, 8.0, 0.82, 16), '#28a8c4', s.x, 0.85, -s.z, true);

        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const px = s.x + Math.cos(a) * 11.2;
          const pz = -s.z + Math.sin(a) * 11.2;
          pushBox(new THREE.BoxGeometry(0.95, 3.8, 0.95), '#b33c26', px, 2.1, pz);
          pushBox(new THREE.SphereGeometry(0.62, 8, 6), '#efece4', px, 4.3, pz);
        }

        pushBox(new THREE.CylinderGeometry(2.8, 3.3, 1.5, 12), '#b33c26', s.x, 1.1, -s.z);
        pushBox(new THREE.CylinderGeometry(0.75, 1.05, 7.2, 10), '#efece4', s.x, 5.2, -s.z);
        pushBox(new THREE.SphereGeometry(1.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#efece4', s.x, 8.8, -s.z);
        pushBox(new THREE.CylinderGeometry(0.06, 0.06, 6.2, 6), '#8d9196', s.x, 11.8, -s.z);

        // Pakistani flag -> DecalAtlas (double-sided)
        const fTex = flagTexture();
        const rect = decalBuilder.pack(fTex, null, BLACK_COL, false);
        const flagGeo = new THREE.PlaneGeometry(3.2, 2.1).translate(s.x + 1.6, 13.7, -s.z);
        const fUv = flagGeo.getAttribute('uv');
        for (let i = 0; i < fUv.count; i++) {
          fUv.setXY(i, rect.u0 + fUv.getX(i) * (rect.u1 - rect.u0), rect.v0 + fUv.getY(i) * (rect.v1 - rect.v0));
        }
        ak.decalGeos.push(makeDoubleSidedGeo(prepBatchGeo(flagGeo, true, '#ffffff')));
        flagGeo.dispose();

        // 9 animated fountain jets -> 1 InstancedMesh chunk-linked to Fawara Chowk
        const jetGeo = new THREE.CylinderGeometry(0.16, 0.42, 2.8, 8).translate(0, 1.4, 0);
        const jetMat = new THREE.MeshBasicMaterial({ color: '#dff8ff', transparent: true, opacity: 0.78 });
        this.ownedGeos.push(jetGeo);
        this.ownedMats.push(jetMat);
        this.fountainBaseMats = [];
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          this.fountainBaseMats.push(place(s.x + Math.cos(a) * 5.2, 1.15, -s.z + Math.sin(a) * 5.2));
        }
        this.fountainBaseMats.push(place(s.x, 2.0, -s.z, 0, 1.8, 4.4 / 2.8, 1.8));
        this.fountainJetsInst = new THREE.InstancedMesh(jetGeo, jetMat, this.fountainBaseMats.length);
        this.fountainJetsInst.frustumCulled = false;
        this.fountainBaseMats.forEach((m, i) => this.fountainJetsInst!.setMatrixAt(i, m));
        this.fountainJetsInst.instanceMatrix.needsUpdate = true;
        this.ownedInsts.push(this.fountainJetsInst);
        this.group.add(this.fountainJetsInst);
        this.fountainChunk = this.ensureChunkRef(this.chunkKeyFor(s.x, s.z));
        this.fountainChunk.extras.push(this.fountainJetsInst);
      } else {
        const pushSolid = (geo: THREE.BufferGeometry, col: string, py: number) => {
          geo.translate(s.x, py, -s.z);
          ak.clutterGeos.push(prepBatchGeo(geo, false, col));
          geo.dispose();
        };
        pushSolid(new THREE.CylinderGeometry(s.r * 0.42, s.r * 0.48, 0.7, 12), '#b8914f', 0.65);
        pushSolid(new THREE.CylinderGeometry(0.18, 0.28, 3.0, 6), '#6b5440', 2.3);
        pushSolid(new THREE.IcosahedronGeometry(2.3, 0), '#6f8c47', 4.4);
      }
    }
  }

  private pedestrianBridges(map: CityMap): void {
    const decalBuilder = this.ensureDecalBuilder();
    const deckY = 5.85;
    const deckW = 2.4;

    for (const b of map.bridges) {
      const ak = this.accumFor(b.x, b.z);
      const half = b.span * 0.5;
      const s = Math.sin(b.heading), c = Math.cos(b.heading);
      for (const side of [-1, 1]) {
        const lx = b.x + side * c * half;
        const lz = b.z - side * s * half;
        this.occupied.push([lx, lz, 4.2]);
        this.occupied.push([lx + s * 4.5, lz + c * 4.5, 3.5]);
      }

      const bgMat = place(b.x, 0, -b.z, -b.heading);
      const parts: THREE.BufferGeometry[] = [];
      const addPart = (g: THREE.BufferGeometry, col: string, px = 0, py = 0, pz = 0, rx = 0, doubleSided = false) => {
        if (rx !== 0) g.rotateX(rx);
        g.translate(px, py, pz);
        let prepped = prepBatchGeo(g, false, col, bgMat);
        g.dispose();
        if (doubleSided) prepped = makeDoubleSidedGeo(prepped);
        parts.push(prepped);
      };

      addPart(new THREE.BoxGeometry(b.span + 1.6, 0.38, deckW), '#cfc9bc', 0, deckY, 0);

      for (const dz of [-deckW / 2 + 0.08, deckW / 2 - 0.08]) {
        addPart(new THREE.BoxGeometry(b.span + 1.4, 0.16, 0.12), '#f2b705', 0, deckY + 1.25, dz);
        addPart(new THREE.BoxGeometry(b.span + 1.4, 0.12, 0.1), '#1b6b3a', 0, deckY + 0.68, dz);
        for (let x = -half; x <= half + 0.01; x += 2.6) {
          addPart(new THREE.BoxGeometry(0.12, 2.5, 0.12), '#1b6b3a', x, deckY + 1.25, dz);
        }
      }

      const roofGeo = new THREE.CylinderGeometry(deckW * 0.58, deckW * 0.58, b.span + 1.6, 8, 1, false, -Math.PI / 2, Math.PI);
      roofGeo.rotateZ(Math.PI / 2);
      roofGeo.scale(1, 0.42, 1);
      addPart(roofGeo, '#2b547e', 0, deckY + 2.45, 0, 0, true);

      for (const side of [-1, 1]) {
        const px = side * half;
        for (const dz of [-0.85, 0.85]) {
          addPart(new THREE.CylinderGeometry(0.36, 0.42, deckY, 8), '#cfc9bc', px, deckY / 2, dz);
        }
        addPart(new THREE.BoxGeometry(2.0, 0.3, 1.5), '#cfc9bc', px, deckY - 0.15, deckW / 2 + 0.55);
        const drop = deckY - 0.15;
        const run = 5.6;
        const stairLen = Math.hypot(drop, run);
        const stairTilt = Math.atan2(drop, run);
        const stairMidZ = deckW / 2 + 1.15 + run * 0.5;
        addPart(new THREE.BoxGeometry(1.5, 0.26, stairLen), '#1b6b3a', px, drop * 0.5, stairMidZ, stairTilt);
        addPart(new THREE.BoxGeometry(0.1, 0.14, stairLen), '#f2b705', px + side * 0.72, drop * 0.5 + 0.88, stairMidZ, stairTilt);
        addPart(new THREE.CylinderGeometry(0.16, 0.18, drop * 0.55, 6), '#cfc9bc', px, drop * 0.275, stairMidZ);
      }

      const mergedBridge = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (mergedBridge) ak.clutterGeos.push(mergedBridge);

      // Double-sided illuminated municipal gantry sign -> DecalAtlas
      const signTex = signTexture([b.name, 'PEDESTRIAN BRIDGE · PAIDAL PUL'], '#0f5c2e', '#ffffff', 512, 96);
      const rect = decalBuilder.pack(signTex, signTex, BRIDGE_EMISSIVE, true);
      for (const dir of [-1, 1]) {
        const sg = new THREE.PlaneGeometry(Math.min(11.5, b.span * 0.68), 1.25);
        if (dir < 0) sg.rotateY(Math.PI);
        sg.translate(0, deckY + 0.55, dir * (deckW / 2 + 0.16));
        const sUv = sg.getAttribute('uv');
        for (let i = 0; i < sUv.count; i++) {
          sUv.setXY(i, rect.u0 + sUv.getX(i) * (rect.u1 - rect.u0), rect.v0 + sUv.getY(i) * (rect.v1 - rect.v0));
        }
        ak.decalGeos.push(prepBatchGeo(sg, true, '#ffffff', bgMat));
        sg.dispose();
      }
    }
  }

  private nearBridge(map: CityMap, x: number, z: number, padAlong: number, padSpan: number): boolean {
    for (const br of map.bridges) {
      const dx = x - br.x, dz = z - br.z;
      const c = Math.cos(br.heading), s = Math.sin(br.heading);
      const alongSpan = dx * c + dz * s;
      const alongRoad = Math.abs(-dx * s + dz * c);
      if (Math.abs(alongSpan) <= br.span * 0.5 + padSpan && alongRoad <= padAlong) return true;
    }
    return false;
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

  private buildings(map: CityMap): void {
    const awningPalette = ['#1e6fb8', '#2e7d32', '#c62828', '#f9a825', '#6a1b9a', '#00838f'].map((c) => new THREE.Color(c));
    const clothPalette = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ffffff', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'].map((c) => new THREE.Color(c));

    const tankGeo = prepBatchGeo(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 10).translate(0, 0.65, 0), false, '#ffffff');
    const roomGeo = prepBatchGeo(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), false, '#cfcac0');
    const awningRaw = new THREE.BoxGeometry(1, 1, 1);
    awningRaw.rotateX(-0.25);
    const awningGeo = prepBatchGeo(awningRaw, false, '#ffffff');
    awningRaw.dispose();

    const slab = new THREE.BoxGeometry(1, 0.14, 0.95).translate(0, 0, 0.475);
    paint(slab, '#d8d2c4');
    const parapet = new THREE.BoxGeometry(1, 0.9, 0.06).translate(0, 0.48, 0.92);
    paint(parapet, '#b7a47c');
    const rail = new THREE.BoxGeometry(1, 0.08, 0.1).translate(0, 0.94, 0.92);
    paint(rail, '#3f4341');
    const balconyMerged = mergeGeometries([slab.toNonIndexed(), parapet.toNonIndexed(), rail.toNonIndexed()], false);
    slab.dispose();
    parapet.dispose();
    rail.dispose();
    const balconyGeo = balconyMerged ? prepBatchGeo(balconyMerged, false) : prepBatchGeo(new THREE.BoxGeometry(1, 0.2, 0.95).translate(0, 0, 0.475), false, '#d8d2c4');
    balconyMerged?.dispose();
    const clothGeo = prepBatchGeo(new THREE.BoxGeometry(1, 1, 0.035).translate(0, -0.5, 0), false, '#ffffff');

    const bldgMats: THREE.Matrix4[] = [];
    const bldgCols: THREE.Color[] = [];
    const bldgChunkKeys: string[] = [];

    const shadowMats: THREE.Matrix4[] = [];
    const shadowChunkKeys: string[] = [];

    const pushClutterGeo = (x: number, z: number, proto: THREE.BufferGeometry, mat: THREE.Matrix4, tint?: THREE.Color) => {
      this.accumFor(x, z).clutterGeos.push(prepBatchGeo(proto, false, tint, mat));
    };

    for (const b of map.buildings) {
      const rng = new Rng(b.seed);
      const base = KERB_H;
      const ry = -b.heading;
      const s = Math.sin(b.heading), c = Math.cos(b.heading);
      const ck = this.chunkKeyFor(b.x, b.z);

      bldgMats.push(place(b.x, base, -b.z, ry, b.hw * 2, b.h, b.hl * 2));
      bldgCols.push(new THREE.Color(BUILDING_COLORS[rng.int(0, BUILDING_COLORS.length - 1)]).multiplyScalar(rng.range(0.92, 1.05)));
      bldgChunkKeys.push(ck);

      shadowMats.push(place(b.x, base + 0.018, -b.z, ry, b.hw * 2 + 3.6, 1, b.hl * 2 + 3.6));
      shadowChunkKeys.push(ck);

      const top = base + b.h;
      if (rng.chance(0.7)) {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) {
          const lf = rng.range(-b.hl + 1.2, b.hl - 1.2);
          const lr = rng.range(-b.hw + 1.2, b.hw - 1.2);
          const tx = b.x + lf * s + lr * c;
          const tz = b.z + lf * c - lr * s;
          pushClutterGeo(tx, tz, tankGeo, place(tx, top, -tz, ry, 1, rng.range(0.9, 1.2), 1), rng.chance(0.75) ? TANK_BLACK : TANK_BLUE);
        }
      }
      if (rng.chance(0.5) && b.hw > 2.5 && b.hl > 2.5) {
        const lf = rng.range(-b.hl + 2, b.hl - 2);
        const lr = rng.range(-b.hw + 2, b.hw - 2);
        const rx = b.x + lf * s + lr * c;
        const rz = b.z + lf * c - lr * s;
        pushClutterGeo(rx, rz, roomGeo, place(rx, top, -rz, ry, 2.6, 2.6, 2.6));
      }

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
        const ax = fx + nx * 0.06 - nz * off, az = fz + nz * 0.06 + nx * off;
        const fRy = localRy + ry;
        const ak = this.accumFor(ax, az);
        ak.signs[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(ax, base + 3.15, -az, fRy, w, w / 4.6 + 0.2, 1));
        if (b.storeys >= 2 && half >= 4 && rng.chance(0.42)) {
          const w2 = Math.min(half * 1.4, rng.range(3.6, 7.4));
          const off2 = rng.range(-(half - w2 / 2), half - w2 / 2) * 0.5;
          const ax2 = fx + nx * 0.09 - nz * off2, az2 = fz + nz * 0.09 + nx * off2;
          this.accumFor(ax2, az2).signs[rng.int(0, SHOP_SIGN_COUNT - 1)].push(place(ax2, base + GROUND_FLOOR_H + 0.48, -az2, fRy, w2, w2 / 4.2 + 0.16, 1));
        }
        const blades = half > 7 ? 2 : 1;
        for (let k = 0; k < blades; k++) {
          if (!rng.chance(0.55)) continue;
          const bo = rng.range(-(half - 1), half - 1);
          const out = 0.75;
          const vx = fx + nx * out - nz * bo, vz = fz + nz * out + nx * bo;
          const vh = rng.range(2.6, 3.6);
          this.accumFor(vx, vz).neonV[rng.int(0, NEON_V_COUNT - 1)].push(place(vx, base + GROUND_FLOOR_H + 0.4 + vh / 2, -vz, fRy + Math.PI / 2, 1.05, vh, 1));
        }
        if (b.storeys >= 3 && rng.chance(0.6)) {
          const nw = Math.min(half * 1.6, rng.range(4.2, 6.8));
          const no = rng.range(-(half - nw / 2), half - nw / 2) * 0.6;
          const st = rng.int(1, Math.min(2, b.storeys - 2));
          const hx = fx + nx * 0.12 - nz * no, hz = fz + nz * 0.12 + nx * no;
          this.accumFor(hx, hz).neonH[rng.int(0, NEON_H_COUNT - 1)].push(place(hx, base + GROUND_FLOOR_H + st * STOREY_H - 0.15, -hz, fRy, nw, nw / 4, 1));
        }
        if (rng.chance(0.6)) {
          pushClutterGeo(fx, fz, awningGeo, place(fx + nx * 0.7, base + 2.55, -(fz + nz * 0.7), fRy, half * 1.8, 0.1, 1.4), awningPalette[rng.int(0, awningPalette.length - 1)]);
        }
        if (rng.chance(0.55)) {
          const gx = fx + nx * 1.8 - nz * off, gz = fz + nz * 1.8 + nx * off;
          if (!map.isRoad(gx, gz) && !map.onIsland(gx, gz)) {
            this.pushGlow(gx, gz, place(gx, KERB_H + 0.025, -gz, 0, 7.2, 1, 7.2));
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
            pushClutterGeo(bx, bz, balconyGeo, place(bx, by, -bz, fRy, bLen, 1, 1));
            if (rng.chance(0.55)) {
              const pieces = rng.int(2, 4);
              for (let k = 0; k < pieces; k++) {
                const cOff = rng.range(-bLen * 0.42, bLen * 0.42);
                const cx = bx + nx * 0.98 - nz * cOff;
                const cz = bz + nz * 0.98 + nx * cOff;
                pushClutterGeo(cx, cz, clothGeo, place(cx, by + 0.9, -cz, fRy, rng.range(0.36, 0.68), rng.range(0.45, 0.82), 1), clothPalette[rng.int(0, clothPalette.length - 1)]);
              }
            }
          }
        }
      }
    }

    tankGeo.dispose();
    roomGeo.dispose();
    awningGeo.dispose();
    balconyGeo.dispose();
    clothGeo.dispose();

    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.facadeMat = makeFacadeMaterial(saddarFacadeAtlas());
    this.ownedGeos.push(box);
    this.ownedMats.push(this.facadeMat);

    if (bldgMats.length > 0) {
      const bMesh = new THREE.InstancedMesh(box, this.facadeMat, bldgMats.length);
      bMesh.frustumCulled = false;
      bMesh.castShadow = false;
      bMesh.receiveShadow = true;
      for (let i = 0; i < bldgMats.length; i++) {
        bMesh.setMatrixAt(i, bldgMats[i]);
        bMesh.setColorAt(i, bldgCols[i]);
      }
      bMesh.instanceMatrix.needsUpdate = true;
      if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
      this.ownedInsts.push(bMesh);
      this.group.add(bMesh);
      this.registerChunkInst(bMesh, bldgMats, bldgChunkKeys);
    }

    if (shadowMats.length > 0) {
      const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: '#1a120c',
        alphaMap: contactShadowTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.ownedGeos.push(glowGeo);
      this.ownedMats.push(shadowMat);

      const sMesh = new THREE.InstancedMesh(glowGeo, shadowMat, shadowMats.length);
      sMesh.frustumCulled = false;
      sMesh.castShadow = false;
      sMesh.receiveShadow = false;
      for (let i = 0; i < shadowMats.length; i++) {
        sMesh.setMatrixAt(i, shadowMats[i]);
      }
      sMesh.instanceMatrix.needsUpdate = true;
      this.ownedInsts.push(sMesh);
      this.group.add(sMesh);
      this.registerChunkInst(sMesh, shadowMats, shadowChunkKeys);
    }
  }

  private readonly bulbMats: THREE.Matrix4[] = [];
  private readonly bulbChunkKeys: string[] = [];
  private readonly glowMats: THREE.Matrix4[] = [];
  private readonly glowChunkKeys: string[] = [];

  private pushBulb(x: number, z: number, mat: THREE.Matrix4): void {
    this.bulbMats.push(mat);
    this.bulbChunkKeys.push(this.chunkKeyFor(x, z));
  }

  private pushGlow(x: number, z: number, mat: THREE.Matrix4): void {
    this.glowMats.push(mat);
    this.glowChunkKeys.push(this.chunkKeyFor(x, z));
  }

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
    const poleMerged = mergeGeometries([shaft.toNonIndexed(), crossArm.toNonIndexed(), lampArm.toNonIndexed(), housing.toNonIndexed()], false);
    shaft.dispose();
    crossArm.dispose();
    lampArm.dispose();
    housing.dispose();
    const poleGeo = poleMerged ? prepBatchGeo(poleMerged, false) : prepBatchGeo(new THREE.BoxGeometry(0.2, H, 0.2), false);
    poleMerged?.dispose();

    const pushWireSegment = (x: number, z: number, a: V3, b: V3, sag: number) => {
      const wire = this.accumFor(x, z).wires;
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
          if (!this.canPlaceOnPavement(map, p.x, p.z, 0.7, 0.35, 0.75) || this.nearBridge(map, p.x, p.z, 10, 4)) {
            prev = null;
            continue;
          }
          this.occupied.push([p.x, p.z, 0.75]);
          const top: V3 = [p.x, KERB_H + H, -p.z];
          this.accumFor(p.x, p.z).clutterGeos.push(prepBatchGeo(poleGeo, false, undefined, place(p.x, KERB_H, -p.z, poleRy)));

          const bx = p.x + Math.cos(poleRy) * 1.42;
          const bz = p.z + Math.sin(poleRy) * 1.42;
          this.pushBulb(bx, bz, place(bx, KERB_H + H - 0.17, -bz, poleRy));
          const gx = p.x + Math.cos(poleRy) * 1.65;
          const gz = p.z + Math.sin(poleRy) * 1.65;
          this.pushGlow(gx, gz, place(gx, map.isRoad(gx, gz) ? 0.035 : KERB_H + 0.03, -gz, 0, 8.5, 1, 8.5));

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
            if (this.nearBridge(map, (pL.x + pR.x) * 0.5, (pL.z + pR.z) * 0.5, 18, 6)) continue;
            let blocked = false;
            for (const ep of [pL, pR]) {
              map.forEachSolidNear(ep.x, ep.z, 2, (sol) => {
                if (pointObbDistance(ep.x, ep.z, sol) < 0.35) blocked = true;
              });
              if (blocked) break;
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
          this.accumFor(cx, cz).banners[bannerIdx++ % BANNER_COUNT].push(place(cx, by, -cz, ry, w, 1.05, 1));
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
    poleGeo.dispose();
  }

  private trees(map: CityMap): void {
    const trunkGeo = prepBatchGeo(new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0), false, '#6b5440');
    const crownGeo = prepBatchGeo(new THREE.IcosahedronGeometry(2.2, 0), false, '#ffffff');
    const crownCol = new THREE.Color();

    const placed: Array<[number, number]> = [];
    const rng = new Rng(31);
    const add = (x: number, z: number, minGap = 6, garden = false) => {
      if (!garden && !this.canPlaceOnPavement(map, x, z, 1.0, 1.0, 1.2)) return;
      for (const [px, pz] of placed) {
        if ((x - px) ** 2 + (z - pz) ** 2 < minGap * minGap) return;
      }
      placed.push([x, z]);
      this.occupied.push([x, z, 1.4]);
      const s = rng.range(0.8, 1.25);
      const ak = this.accumFor(x, z);
      ak.clutterGeos.push(prepBatchGeo(trunkGeo, false, undefined, place(x, KERB_H, -z, 0, s, s, s)));
      crownCol.setHSL(rng.range(0.22, 0.28), 0.35, rng.range(0.3, 0.38));
      ak.clutterGeos.push(
        prepBatchGeo(
          crownGeo,
          false,
          crownCol,
          place(x, KERB_H + 3.6 * s, -z, rng.range(0, 6), s * rng.range(0.9, 1.2), s, s * rng.range(0.9, 1.2)),
        ),
      );
    };

    for (const [x, z] of this.gardenTrees) add(x, z, 5, true);
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
    for (const l of map.links) {
      if (l.turnaround || l.cls !== 'arterial' || l.len < 34) continue;
      if (map.nodes[l.from].roundabout && map.nodes[l.to].roundabout) continue;
      const off = l.hw + 1.8;
      for (let s = 12; s < l.len - 10; s += rng.range(28, 42)) {
        const p = map.linkPoint(l, s, off);
        add(p.x, p.z, 12);
      }
    }
    for (const l of map.landmarks) {
      if (l.kind !== 'empress') continue;
      const o = l.obb;
      const s = Math.sin(o.heading), c = Math.cos(o.heading);
      const lr = o.hw + 7.5;
      for (let lf = -o.hl; lf <= o.hl; lf += 12) {
        add(o.x + lf * s + lr * c, o.z + lf * c - lr * s, 8);
      }
    }
    trunkGeo.dispose();
    crownGeo.dispose();
  }

  private chaiDhabas(map: CityMap): void {
    const tarpColors = ['#1565c0', '#c62828', '#2e7d32', '#ef6c00'];
    const dhabaGeos = tarpColors.map((tarpCol) => {
      const parts: THREE.BufferGeometry[] = [];
      const addPart = (g: THREE.BufferGeometry, col: string) => {
        paint(g, col);
        parts.push(g.index ? g.toNonIndexed() : g);
      };
      for (const sx of [-1.4, 1.4]) {
        for (const sz of [-1.8, 1.8]) {
          addPart(new THREE.CylinderGeometry(0.045, 0.055, 2.8, 5).translate(sx, 1.4, sz), '#8d6e43');
        }
      }
      addPart(new THREE.BoxGeometry(3.2, 0.14, 4.0).translate(0, 2.82, 0), tarpCol);
      addPart(new THREE.BoxGeometry(3.3, 0.24, 4.1).translate(0, 2.68, 0), '#f9a825');
      addPart(new THREE.BoxGeometry(0.95, 0.98, 1.85).translate(-0.85, 0.49, -0.7), '#a63a28');
      addPart(new THREE.BoxGeometry(1.02, 0.08, 1.92).translate(-0.85, 1.0, -0.7), '#cfd8dc');
      addPart(new THREE.CylinderGeometry(0.24, 0.28, 0.72, 8).translate(-0.85, 1.38, -0.95), '#d4883a');
      addPart(new THREE.CylinderGeometry(0.38, 0.42, 0.82, 8).translate(-0.85, 0.41, 0.65), '#8d4925');
      addPart(new THREE.BoxGeometry(1.15, 0.1, 1.85).translate(0.65, 0.46, -0.75), '#e6d7b8');
      for (const cx of [0.15, 1.15]) {
        for (const cz of [-1.6, 0.1]) {
          addPart(new THREE.BoxGeometry(0.1, 0.52, 0.1).translate(cx, 0.26, cz), '#6d4c2f');
        }
      }
      addPart(new THREE.BoxGeometry(0.85, 0.08, 0.85).translate(0.65, 0.72, 1.05), '#e53935');
      addPart(new THREE.CylinderGeometry(0.06, 0.08, 0.72, 6).translate(0.65, 0.36, 1.05), '#b71c1c');
      for (const dz of [0.42, 1.68]) {
        addPart(new THREE.BoxGeometry(0.46, 0.44, 0.46).translate(0.65, 0.22, dz), '#c62828');
      }
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      const res = prepBatchGeo(merged ?? new THREE.BoxGeometry(2.8, 2.8, 3.6), false);
      merged?.dispose();
      return res;
    });

    const rng = new Rng(0xc4a1);
    let placedCount = 0;
    for (const l of map.links) {
      if (placedCount >= 22) break;
      if (l.turnaround || l.len < 42) continue;
      if (map.nodes[l.from].roundabout && map.nodes[l.to].roundabout) continue;
      const sides = l.oneway ? [1, -1] : [1];
      for (const side of sides) {
        if (placedCount >= 22) break;
        if (!rng.chance(0.26)) continue;
        const s = rng.range(14, l.len - 14);
        if (this.isMedianSide(map, l, s, side)) continue;
        const off = side * (l.hw + 2.35);
        const p = map.linkPoint(l, s, off);
        if (!this.canPlaceOnPavement(map, p.x, p.z, 2.4, 0.9, 1.2)) continue;
        this.occupied.push([p.x, p.z, 2.6]);
        placedCount++;

        const ry = -l.heading + (side > 0 ? 0 : Math.PI);
        const m = place(p.x, KERB_H, -p.z, ry);
        this.accumFor(p.x, p.z).clutterGeos.push(prepBatchGeo(dhabaGeos[placedCount % dhabaGeos.length], false, undefined, m));

        this.pushBulb(p.x, p.z, place(p.x, KERB_H + 2.62, -p.z, ry, 1.15, 1.15, 1.15));
        this.pushGlow(p.x, p.z, place(p.x, KERB_H + 0.03, -p.z, 0, 8.5, 1, 8.5));

        const sinR = Math.sin(ry), cosR = Math.cos(ry);
        const localX = -0.85, localZ = -0.95;
        const wx = p.x + localX * cosR + localZ * sinR;
        const wz = -p.z - localX * sinR + localZ * cosR;
        for (let k = 0; k < 4; k++) {
          this.steamSeeds.push(wx, KERB_H + 1.8, wz, k * 0.25 + rng.range(0, 0.2));
        }
      }
    }
    dhabaGeos.forEach((g) => g.dispose());

    if (this.steamSeeds.length > 0) {
      const count = this.steamSeeds.length / 4;
      this.steamPos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        this.steamPos[i * 3] = this.steamSeeds[i * 4];
        this.steamPos[i * 3 + 1] = this.steamSeeds[i * 4 + 1];
        this.steamPos[i * 3 + 2] = this.steamSeeds[i * 4 + 2];
      }
      this.steamGeo = new THREE.BufferGeometry();
      this.steamGeo.setAttribute('position', new THREE.BufferAttribute(this.steamPos, 3).setUsage(THREE.DynamicDrawUsage));
      const steamMat = new THREE.PointsMaterial({
        color: '#f5f2eb',
        size: 0.42,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      this.ownedGeos.push(this.steamGeo);
      this.ownedMats.push(steamMat);
      const pts = new THREE.Points(this.steamGeo, steamMat);
      pts.frustumCulled = false;
      this.group.add(pts);
    }
  }

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
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      const res = prepBatchGeo(merged ?? new THREE.BoxGeometry(1.1, 2.0, 1.9), false);
      merged?.dispose();
      return res;
    });

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
              this.accumFor(p.x, p.z).clutterGeos.push(prepBatchGeo(bikeGeos[rng.int(0, bikeGeos.length - 1)], false, undefined, place(p.x, KERB_H, -p.z, bikeRy)));
            }
            s += rng.range(16, 26);
          } else if (roll < 0.6) {
            const off = side * (l.hw + 1.55);
            const p = map.linkPoint(l, s, off);
            if (this.canPlaceOnPavement(map, p.x, p.z, 1.2, 0.55, 1.15)) {
              this.occupied.push([p.x, p.z, 1.2]);
              this.accumFor(p.x, p.z).clutterGeos.push(prepBatchGeo(cartGeos[rng.int(0, cartGeos.length - 1)], false, undefined, place(p.x, KERB_H, -p.z, -l.heading + rng.range(-0.18, 0.18))));
            }
            s += rng.range(22, 34);
          } else {
            s += rng.range(18, 28);
          }
        }
      }
    }
    bikeGeos.forEach((g) => g.dispose());
    cartGeos.forEach((g) => g.dispose());
  }

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
        YARD_TINT,
      );
    }
    if (q.empty) return;
    const yardGeo = q.build();
    this.dirtParts.push(prepBatchGeo(yardGeo, true));
    yardGeo.dispose();

    const decalBuilder = this.ensureDecalBuilder();
    const boardTex = signTexture(['KMC ROAD WORKS', 'KAAM JAARI HAI'], '#f9a825', '#1b1b1b', 512, 192);
    const rect = decalBuilder.pack(boardTex, null, BLACK_COL, false);

    const fBoard = new THREE.PlaneGeometry(5, 1.9).translate(0, 0, 0.02).toNonIndexed();
    const bBoard = new THREE.PlaneGeometry(5, 1.9).rotateY(Math.PI).translate(0, 0, -0.02).toNonIndexed();
    const boardGeo = mergeGeometries([fBoard, bBoard], false) ?? new THREE.PlaneGeometry(5, 1.9).toNonIndexed();
    fBoard.dispose();
    bBoard.dispose();
    const bUv = boardGeo.getAttribute('uv');
    for (let i = 0; i < bUv.count; i++) {
      bUv.setXY(i, rect.u0 + bUv.getX(i) * (rect.u1 - rect.u0), rect.v0 + bUv.getY(i) * (rect.v1 - rect.v0));
    }
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6);

    for (const y of map.yards) {
      const s = Math.sin(y.heading), c = Math.cos(y.heading);
      const lf = -(y.hl - 1.5);
      const bx = y.x + lf * s, bz = y.z + lf * c;
      const ak = this.accumFor(bx, bz);
      ak.decalGeos.push(prepBatchGeo(boardGeo, true, '#ffffff', place(bx, KERB_H + 3.2, -bz, -y.heading)));
      for (const lr of [-2.2, 2.2]) {
        ak.clutterGeos.push(prepBatchGeo(postGeo, false, '#555555', place(bx + lr * c, KERB_H + 1.6, -(bz - lr * s))));
      }
    }
    boardGeo.dispose();
    postGeo.dispose();
  }

  private ramps(map: CityMap): void {
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
      const len = Math.hypot(2 * r.hl, r.h);
      tops.quad(pt(-r.hl, -r.hw, true), pt(-r.hl, r.hw, true), pt(r.hl, r.hw, true), pt(r.hl, -r.hw, true), [0, 0, 1, 0, 1, len, 0, len], UP, yard ? dirt : steel);
      const hiL = pt(r.hl, -r.hw, true), hiR = pt(r.hl, r.hw, true), loL = pt(r.hl, -r.hw, false), loR = pt(r.hl, r.hw, false);
      const plain = [0.2, 0.5, 0.2, 0.5, 0.2, 0.5, 0.2, 0.5];
      sides.quad(loL, loR, hiR, hiL, yard ? plain : [0, 0, r.hw * 2, 0, r.hw * 2, 1, 0, 1], fwd, yard ? dirt.clone().multiplyScalar(0.55) : undefined);
      for (const side of [-1, 1]) {
        const a = pt(-r.hl, side * r.hw, false), b = pt(r.hl, side * r.hw, false), t = pt(r.hl, side * r.hw, true);
        sides.quad(a, b, t, t, yard ? plain : [0, 0, r.hl * 2, 0, r.hl * 2, 1, r.hl * 2, 1], side > 0 ? right : [-right[0], 0, -right[2]], yard ? dirt.clone().multiplyScalar(0.55) : undefined);
      }
    }
    if (!tops.empty) {
      const topGeo = tops.build();
      this.dirtParts.push(prepBatchGeo(topGeo, true));
      topGeo.dispose();
    }
    if (!sides.empty) {
      const sideGeo = sides.build();
      this.kerbParts.push(prepBatchGeo(sideGeo, true));
      sideGeo.dispose();
    }
  }

  private flushSurfaces(): void {
    // 1. Merged kerbs (pavement kerbs + roundabout collars + island kerbs + ramp sides)
    if (this.kerbParts.length > 0) {
      const merged = mergeGeometries(this.kerbParts, false);
      this.kerbParts.forEach((g) => g.dispose());
      this.kerbParts.length = 0;
      if (merged) {
        const tex = kerbStripeTexture().clone();
        tex.needsUpdate = true;
        this.ownedTex.push(tex);
        const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
        const m = new THREE.Mesh(merged, mat);
        m.receiveShadow = true;
        m.castShadow = false;
        this.group.add(m);
      }
    }

    // 2. Merged dirt/gravel (garden gravel walks + construction yards + ramp tops)
    const allDirt = [...this.gardenGravelGeos, ...this.dirtParts];
    this.gardenGravelGeos = [];
    this.dirtParts = [];
    if (allDirt.length > 0) {
      const merged = mergeGeometries(allDirt, false);
      allDirt.forEach((g) => g.dispose());
      if (merged) {
        const mat = new THREE.MeshLambertMaterial({
          map: dirtTexture(),
          vertexColors: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const m = new THREE.Mesh(merged, mat);
        m.receiveShadow = true;
        m.castShadow = false;
        this.group.add(m);
      }
    }

    // 3. Merged landmark garden lawns
    if (this.gardenLawnGeos.length > 0) {
      const merged = mergeGeometries(this.gardenLawnGeos, false);
      this.gardenLawnGeos.forEach((g) => g.dispose());
      this.gardenLawnGeos = [];
      if (merged) {
        const mat = new THREE.MeshLambertMaterial({
          color: '#ffffff',
          vertexColors: true,
          map: lawnTexture(),
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const m = new THREE.Mesh(merged, mat);
        m.receiveShadow = true;
        m.castShadow = false;
        this.group.add(m);
      }
    }
  }

  private decalBuilder: DecalAtlasBuilder | null = null;
  private ensureDecalBuilder(): DecalAtlasBuilder {
    return (this.decalBuilder ??= new DecalAtlasBuilder());
  }

  /** Build all 31 Saddar landmarks into unified BatchedMesh layers. */
  private landmarks(map: CityMap): void {
    const decalBuilder = this.ensureDecalBuilder();

    for (const l of map.landmarks) {
      const tmpGroup = new THREE.Group();
      const lmLitMats: THREE.MeshLambertMaterial[] = [];
      buildSaddarLandmark(tmpGroup, l, false, lmLitMats);
      tmpGroup.updateMatrixWorld(true);
      const litSet = new Set<THREE.Material>(lmLitMats);

      const ak = this.accumFor(l.obb.x, l.obb.z);
      const clutterParts: THREE.BufferGeometry[] = [];
      const floodParts: THREE.BufferGeometry[] = [];
      const decalParts: THREE.BufferGeometry[] = [];
      const repBuckets = new Map<string, { mat: THREE.MeshLambertMaterial; geos: THREE.BufferGeometry[] }>();

      const seenGeos = new Set<THREE.BufferGeometry>();
      const seenMats = new Set<THREE.Material>();

      tmpGroup.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mat) return;
        seenGeos.add(o.geometry);
        seenMats.add(mat);

        const isBasic = mat instanceof THREE.MeshBasicMaterial;
        const isLambert = mat instanceof THREE.MeshLambertMaterial;
        const mapTex = (mat as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial).map;
        const emMap = isLambert ? mat.emissiveMap : null;
        const matCol = (mat as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial).color ?? WHITE;
        const doubleSided = mat.side === THREE.DoubleSide;

        if (!mapTex) {
          // Untextured solid part
          let g = prepBatchGeo(o.geometry, false, matCol, o.matrixWorld);
          if (doubleSided) g = makeDoubleSidedGeo(g);
          const hasEmissive = isBasic || (isLambert && (mat.emissive.getHex() !== 0 || litSet.has(mat)));
          if (hasEmissive) floodParts.push(g);
          else clutterParts.push(g);
          return;
        }

        const wraps = mapTex.wrapS === THREE.RepeatWrapping || mapTex.wrapT === THREE.RepeatWrapping;
        if (!wraps) {
          // Non-wrapping sign, poster, clock face, or front facade -> DecalAtlas
          const emCol = isLambert ? mat.emissive : WHITE;
          const lit = isBasic || litSet.has(mat) || emMap !== null || (isLambert && mat.emissive.getHex() !== 0);
          const rect = decalBuilder.pack(mapTex, emMap, emCol, lit);
          let g = prepBatchGeo(o.geometry, true, matCol, o.matrixWorld);
          const uv = g.getAttribute('uv');
          const du = rect.u1 - rect.u0;
          const dv = rect.v1 - rect.v0;
          for (let i = 0; i < uv.count; i++) {
            const u = Math.max(0, Math.min(1, uv.getX(i)));
            const v = Math.max(0, Math.min(1, uv.getY(i)));
            uv.setXY(i, rect.u0 + u * du, rect.v0 + v * dv);
          }
          if (doubleSided) g = makeDoubleSidedGeo(g);
          decalParts.push(g);
          return;
        }

        // Wrapping architectural bay/stone/lawn texture -> bake repeat/offset into UVs & deduplicate material
        const emHex = isLambert && (emMap || mat.emissive.getHex() !== 0) ? mat.emissive.getHexString() : '000000';
        const sharedMat = this.repeatingMaterial(mapTex, emMap, emHex);
        let g = prepBatchGeo(o.geometry, true, matCol, o.matrixWorld);
        const rx = mapTex.repeat.x;
        const ry = mapTex.repeat.y;
        const ox = mapTex.offset.x;
        const oy = mapTex.offset.y;
        if (rx !== 1 || ry !== 1 || ox !== 0 || oy !== 0) {
          const uv = g.getAttribute('uv');
          for (let i = 0; i < uv.count; i++) {
            uv.setXY(i, uv.getX(i) * rx + ox, uv.getY(i) * ry + oy);
          }
        }
        if (doubleSided) g = makeDoubleSidedGeo(g);
        const rKey = sharedMat.uuid;
        let rb = repBuckets.get(rKey);
        if (!rb) {
          rb = { mat: sharedMat, geos: [] };
          repBuckets.set(rKey, rb);
        }
        rb.geos.push(g);
      });

      if (clutterParts.length > 0) {
        const merged = mergeGeometries(clutterParts, false);
        clutterParts.forEach((g) => g.dispose());
        if (merged) ak.clutterGeos.push(merged);
      }
      if (floodParts.length > 0) {
        const merged = mergeGeometries(floodParts, false);
        floodParts.forEach((g) => g.dispose());
        if (merged) ak.floodlitGeos.push(merged);
      }
      if (decalParts.length > 0) {
        const merged = mergeGeometries(decalParts, false);
        decalParts.forEach((g) => g.dispose());
        if (merged) ak.decalGeos.push(merged);
      }
      for (const [rKey, rb] of repBuckets) {
        const merged = mergeGeometries(rb.geos, false);
        rb.geos.forEach((g) => g.dispose());
        if (!merged) continue;
        let chunkRb = ak.repeating.get(rKey);
        if (!chunkRb) {
          chunkRb = { mat: rb.mat, geos: [] };
          ak.repeating.set(rKey, chunkRb);
        }
        chunkRb.geos.push(merged);
      }

      for (const g of seenGeos) g.dispose();
      for (const m of seenMats) m.dispose();
    }
  }

  private registerChunkInst(mesh: THREE.InstancedMesh, allMats: THREE.Matrix4[], allKeys: string[]): void {
    const byChunk = new Map<string, { indices: number[]; mats: THREE.Matrix4[] }>();
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      let b = byChunk.get(key);
      if (!b) {
        b = { indices: [], mats: [] };
        byChunk.set(key, b);
      }
      b.indices.push(i);
      b.mats.push(allMats[i]);
    }
    for (const [key, b] of byChunk) {
      this.ensureChunkRef(key).insts.push({ mesh, indices: b.indices, mats: b.mats });
    }
  }

  private buildChunkBatchedMesh(
    entries: Array<{ key: string; geo: THREE.BufferGeometry }>,
    mat: THREE.Material,
  ): THREE.BatchedMesh | null {
    if (entries.length === 0) return null;
    let totalVerts = 0;
    for (const e of entries) totalVerts += e.geo.getAttribute('position').count;
    const bm = new THREE.BatchedMesh(entries.length, totalVerts, 0, mat);
    bm.sortObjects = false;
    bm.frustumCulled = false;
    bm.perObjectFrustumCulled = true;
    bm.castShadow = false;
    bm.receiveShadow = true;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const gid = bm.addGeometry(e.geo);
      const iid = bm.addInstance(gid);
      bm.setMatrixAt(iid, IDENTITY_MAT);
      bm.setColorAt(iid, WHITE);
      e.geo.dispose();
      const ref = this.ensureChunkRef(e.key);
      let bRef = ref.batches.find((x) => x.bm === bm);
      if (!bRef) {
        bRef = { bm, ids: [] };
        ref.batches.push(bRef);
      }
      bRef.ids.push(iid);
    }
    bm.computeBoundingBox();
    bm.computeBoundingSphere();
    this.ownedBatches.push(bm);
    this.group.add(bm);
    return bm;
  }

  private buildProtoBatchedMesh(
    protos: THREE.BufferGeometry[],
    mat: THREE.Material,
    items: BatchProtoEntry[],
  ): THREE.BatchedMesh | null {
    if (items.length === 0) return null;
    let totalVerts = 0;
    for (const g of protos) totalVerts += g.getAttribute('position').count;
    const bm = new THREE.BatchedMesh(items.length, totalVerts, 0, mat);
    bm.sortObjects = false;
    bm.frustumCulled = false;
    bm.perObjectFrustumCulled = true;
    bm.castShadow = false;
    bm.receiveShadow = true;

    const gids = protos.map((g) => bm.addGeometry(g));
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const iid = bm.addInstance(gids[it.geoIdx]);
      bm.setMatrixAt(iid, it.matrix);
      bm.setColorAt(iid, it.color);
      const ref = this.ensureChunkRef(it.chunkKey);
      let bRef = ref.batches.find((x) => x.bm === bm);
      if (!bRef) {
        bRef = { bm, ids: [] };
        ref.batches.push(bRef);
      }
      bRef.ids.push(iid);
    }
    bm.computeBoundingBox();
    bm.computeBoundingSphere();
    this.ownedBatches.push(bm);
    this.group.add(bm);
    return bm;
  }

  private flushAllChunks(): void {
    // 1. Static clutter, floodlit accents, decal atlas, and repeating landmark batches
    const clutterEntries: Array<{ key: string; geo: THREE.BufferGeometry }> = [];
    const floodEntries: Array<{ key: string; geo: THREE.BufferGeometry }> = [];
    const decalEntries: Array<{ key: string; geo: THREE.BufferGeometry }> = [];
    const repAll = new Map<string, { mat: THREE.MeshLambertMaterial; entries: Array<{ key: string; geo: THREE.BufferGeometry }> }>();
    const allWires: number[] = [];

    const signItems: BatchProtoEntry[] = [];
    const bannerItems: BatchProtoEntry[] = [];
    const neonHItems: BatchProtoEntry[] = [];
    const neonVItems: BatchProtoEntry[] = [];

    for (const [key, ak] of this.chunkAccum) {
      if (ak.clutterGeos.length > 0) {
        const m = mergeGeometries(ak.clutterGeos, false);
        ak.clutterGeos.forEach((g) => g.dispose());
        if (m) clutterEntries.push({ key, geo: m });
      }
      if (ak.floodlitGeos.length > 0) {
        const m = mergeGeometries(ak.floodlitGeos, false);
        ak.floodlitGeos.forEach((g) => g.dispose());
        if (m) floodEntries.push({ key, geo: m });
      }
      if (ak.decalGeos.length > 0) {
        const m = mergeGeometries(ak.decalGeos, false);
        ak.decalGeos.forEach((g) => g.dispose());
        if (m) decalEntries.push({ key, geo: m });
      }
      for (const [rKey, rb] of ak.repeating) {
        const m = mergeGeometries(rb.geos, false);
        rb.geos.forEach((g) => g.dispose());
        if (!m) continue;
        let bucket = repAll.get(rKey);
        if (!bucket) {
          bucket = { mat: rb.mat, entries: [] };
          repAll.set(rKey, bucket);
        }
        bucket.entries.push({ key, geo: m });
      }
      if (ak.wires.length > 0) {
        for (let i = 0; i < ak.wires.length; i++) allWires.push(ak.wires[i]);
      }
      for (let gi = 0; gi < ak.signs.length; gi++) {
        for (const mat of ak.signs[gi]) signItems.push({ chunkKey: key, geoIdx: gi, matrix: mat, color: WHITE });
      }
      for (let gi = 0; gi < ak.banners.length; gi++) {
        for (const mat of ak.banners[gi]) bannerItems.push({ chunkKey: key, geoIdx: gi, matrix: mat, color: WHITE });
      }
      for (let gi = 0; gi < ak.neonH.length; gi++) {
        for (const mat of ak.neonH[gi]) neonHItems.push({ chunkKey: key, geoIdx: gi, matrix: mat, color: WHITE });
      }
      for (let gi = 0; gi < ak.neonV.length; gi++) {
        for (const mat of ak.neonV[gi]) neonVItems.push({ chunkKey: key, geoIdx: gi, matrix: mat, color: WHITE });
      }
    }
    this.chunkAccum.clear();

    const clutterMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ownedMats.push(clutterMat);
    this.buildChunkBatchedMesh(clutterEntries, clutterMat);

    const floodMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: new THREE.Color('#ffead0'),
      emissiveIntensity: 0,
    });
    this.ownedMats.push(floodMat);
    this.litProps.push(floodMat);
    this.buildChunkBatchedMesh(floodEntries, floodMat);

    if (this.decalBuilder && decalEntries.length > 0) {
      const { albedo, emissive } = this.decalBuilder.buildTextures();
      this.ownedTex.push(albedo, emissive);
      const decalMat = new THREE.MeshLambertMaterial({
        color: '#ffffff',
        vertexColors: true,
        map: albedo,
        emissiveMap: emissive,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0,
      });
      this.ownedMats.push(decalMat);
      this.litProps.push(decalMat);
      this.buildChunkBatchedMesh(decalEntries, decalMat);
    } else {
      decalEntries.forEach((e) => e.geo.dispose());
    }

    for (const bucket of repAll.values()) {
      this.buildChunkBatchedMesh(bucket.entries, bucket.mat);
    }

    // 2. Signage & neon BatchedMeshes (prototype geometry sharing across Saddar)
    const signGeos = Array.from({ length: SHOP_SIGN_COUNT }, (_, i) => atlasQuadGeo(shopSignAtlasUv(i)));
    const bannerGeos = Array.from({ length: BANNER_COUNT }, (_, i) => doubleSidedAtlasQuadGeo(streetBannerAtlasUv(i)));
    const neonHGeos = Array.from({ length: NEON_H_COUNT }, (_, i) => atlasQuadGeo(neonHAtlasUv(i)));
    const neonVGeos = Array.from({ length: NEON_V_COUNT }, (_, i) => doubleSidedAtlasQuadGeo(neonVAtlasUv(i)));
    this.ownedGeos.push(...signGeos, ...bannerGeos, ...neonHGeos, ...neonVGeos);

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
    const neonMat = (map: THREE.Texture, mask: THREE.Texture) =>
      new THREE.MeshLambertMaterial({ map, emissiveMap: mask, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.45 });
    const neonHMat = neonMat(neonHAtlas(), neonHAtlas(true));
    const neonVMat = neonMat(neonVAtlas(), neonVAtlas(true));
    this.neonMats.push(neonHMat, neonVMat);
    this.ownedMats.push(this.shopSignMat, this.bannerMat, neonHMat, neonVMat);

    this.buildProtoBatchedMesh(signGeos, this.shopSignMat, signItems);
    this.buildProtoBatchedMesh(bannerGeos, this.bannerMat, bannerItems);
    this.buildProtoBatchedMesh(neonHGeos, neonHMat, neonHItems);
    this.buildProtoBatchedMesh(neonVGeos, neonVMat, neonVItems);

    // 3. Single streetlamp bulb InstancedMesh & single night glow InstancedMesh
    if (this.bulbMats.length > 0) {
      const bulbGeo = new THREE.BoxGeometry(0.42, 0.14, 0.24);
      this.lampBulbMat = new THREE.MeshLambertMaterial({
        color: '#e6e0cc',
        emissive: new THREE.Color('#ffcc66'),
        emissiveIntensity: 0,
      });
      this.ownedGeos.push(bulbGeo);
      this.ownedMats.push(this.lampBulbMat);
      const bInst = new THREE.InstancedMesh(bulbGeo, this.lampBulbMat, this.bulbMats.length);
      bInst.frustumCulled = false;
      bInst.castShadow = false;
      for (let i = 0; i < this.bulbMats.length; i++) bInst.setMatrixAt(i, this.bulbMats[i]);
      bInst.instanceMatrix.needsUpdate = true;
      this.ownedInsts.push(bInst);
      this.group.add(bInst);
      this.registerChunkInst(bInst, this.bulbMats, this.bulbChunkKeys);
    }

    if (this.glowMats.length > 0) {
      const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
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
      this.ownedGeos.push(glowGeo);
      this.ownedMats.push(this.warmGlowMat);
      const gInst = new THREE.InstancedMesh(glowGeo, this.warmGlowMat, this.glowMats.length);
      gInst.frustumCulled = false;
      gInst.castShadow = false;
      gInst.visible = false;
      gInst.renderOrder = 1;
      for (let i = 0; i < this.glowMats.length; i++) gInst.setMatrixAt(i, this.glowMats[i]);
      gInst.instanceMatrix.needsUpdate = true;
      this.ownedInsts.push(gInst);
      this.glowInst = gInst;
      this.group.add(gInst);
      this.registerChunkInst(gInst, this.glowMats, this.glowChunkKeys);
    }

    // 4. Single merged LineSegments for all utility pole & banner wires
    if (allWires.length > 0) {
      const wireGeo = new THREE.BufferGeometry();
      wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(allWires, 3));
      const wireMat = new THREE.LineBasicMaterial({ color: '#2a2a2a' });
      this.ownedGeos.push(wireGeo);
      this.ownedMats.push(wireMat);
      const wireLines = new THREE.LineSegments(wireGeo, wireMat);
      wireLines.frustumCulled = false;
      this.group.add(wireLines);
    }

    // Initialize chunk visibility cleanly around origin
    this.update(0, 0, 0);
  }
}

const BLACK_COL = new THREE.Color('#000000');
const BRIDGE_EMISSIVE = new THREE.Color('#d8ffd0');
const YARD_TINT = new THREE.Color('#d9bf8f');
const TANK_BLACK = new THREE.Color('#1d1f22');
const TANK_BLUE = new THREE.Color('#2f6fb0');

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
