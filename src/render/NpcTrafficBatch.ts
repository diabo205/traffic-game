import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NpcKind, NpcView } from '../sim/types';
import {
  contactShadowTexture,
  headlightPoolTexture,
  routeBoardTexture,
  truckArtTexture,
  windscreenArtTexture,
} from './textures';
import {
  NPC_BIKE_PAINTS,
  NPC_CAR_PAINTS,
  NPC_CART_RAILS,
  NPC_MINIBUS_PAINTS,
  NPC_RICKSHAW_PAINTS,
  NPC_ROUTE_BOARDS,
  NPC_TRUCK_CABS,
} from './VehicleFactory';
import type { RawProto, VehicleFactory } from './VehicleFactory';

function isAuxiliaryMesh(o: THREE.Mesh, raw: RawProto): boolean {
  if (o === raw.lights.beam || o === raw.lights.pool) return true;
  if (o.name === 'beam' || o.name === 'pool') return true;
  return (o.material as THREE.Material | undefined)?.transparent === true;
}

const MAX_SLOTS = 64;
const WHITE = new THREE.Color('#ffffff');
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);
const ONE_SCALE = new THREE.Vector3(1, 1, 1);

const HEAD_OFF = new THREE.Color('#b8b4a4');
const HEAD_DAY = new THREE.Color('#e9e4cf');
const HEAD_NIGHT = new THREE.Color('#fff9d6').multiplyScalar(1.45);
const BRAKE_OFF = new THREE.Color('#4a0b0b');
const BRAKE_ON = new THREE.Color('#ff2222').multiplyScalar(1.65);
const HAZARD_OFF = new THREE.Color('#5a3b0b');
const HAZARD_ON = new THREE.Color('#ffaa18').multiplyScalar(1.55);

const NPC_KINDS: readonly NpcKind[] = ['bike', 'car', 'rickshaw', 'cart', 'minibus', 'truck'];

const POOL_DIMS: Readonly<Record<NpcKind, readonly [number, number]>> = {
  bike: [2.8, 8.5],
  cart: [3.0, 6.5],
  car: [4.6, 11.5],
  rickshaw: [4.0, 9.5],
  minibus: [6.2, 14.5],
  truck: [6.4, 15.0],
};

interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface KindTemplates {
  paintGids: number[];
  fixedGids: number[];
  artGids: number[];
  headGid: number;
  brakeGid: number;
  hazardGid: number;
  shadowCx: number;
  shadowCz: number;
  shadowW: number;
  shadowL: number;
  hasPool: boolean;
  poolZ: number;
  poolW: number;
  poolL: number;
}

interface SlotData {
  bodyPaintIid: number;
  bodyFixedIid: number;
  artIid: number;
  headIid: number;
  brakeIid: number;
  hazardIid: number;
}

const _invMat = new THREE.Matrix4();
const _relMat = new THREE.Matrix4();
const _box3 = new THREE.Box3();
const _vec3 = new THREE.Vector3();

function prepNonIndexedVC(
  space: THREE.Object3D,
  meshes: THREE.Mesh[],
  forceWhite = false,
): THREE.BufferGeometry | null {
  if (meshes.length === 0) return null;
  space.updateMatrixWorld(true);
  _invMat.copy(space.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const raw = m.geometry;
    const g = raw.index ? raw.toNonIndexed() : raw.clone();
    _relMat.multiplyMatrices(_invMat, m.matrixWorld);
    g.applyMatrix4(_relMat);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    }
    const mat = m.material as THREE.MeshLambertMaterial;
    const c = forceWhite ? WHITE : mat.color;
    const count = g.getAttribute('position').count;
    const cols = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

function prepTexturedAtlasGeo(
  space: THREE.Object3D,
  meshes: Array<{ mesh: THREE.Mesh; rect: AtlasRect }>,
): THREE.BufferGeometry | null {
  if (meshes.length === 0) return null;
  space.updateMatrixWorld(true);
  _invMat.copy(space.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  for (const { mesh, rect } of meshes) {
    const raw = mesh.geometry;
    const g = raw.index ? raw.toNonIndexed() : raw.clone();
    _relMat.multiplyMatrices(_invMat, mesh.matrixWorld);
    g.applyMatrix4(_relMat);
    if (!g.getAttribute('normal')) g.computeVertexNormals();

    const mat = mesh.material as THREE.MeshLambertMaterial;
    const flipV = mat.map ? mat.map.flipY : false;
    const uvAttr = g.getAttribute('uv');
    const count = g.getAttribute('position').count;
    const newUv = new Float32Array(count * 2);
    const du = rect.u1 - rect.u0;
    const dv = rect.v1 - rect.v0;
    for (let i = 0; i < count; i++) {
      const u = uvAttr ? Math.max(0, Math.min(1, uvAttr.getX(i))) : 0.5;
      const vRaw = uvAttr ? Math.max(0, Math.min(1, uvAttr.getY(i))) : 0.5;
      const v = flipV ? 1 - vRaw : vRaw;
      newUv[i * 2] = rect.u0 + u * du;
      newUv[i * 2 + 1] = rect.v0 + v * dv;
    }
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(newUv, 2));
    const cols = new Float32Array(count * 3);
    cols.fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

function tinyFallbackGeo(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.01, 0.01, 0.01).toNonIndexed();
  const count = g.getAttribute('position').count;
  const cols = new Float32Array(count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  }
  return g;
}

function drawSlotWithGutter(
  ctx: CanvasRenderingContext2D,
  srcTex: THREE.Texture,
  x: number,
  y: number,
  w: number,
  h: number,
  atlasW: number,
  atlasH: number,
): AtlasRect {
  const img = srcTex.image as HTMLCanvasElement | HTMLImageElement | undefined;
  if (img) {
    ctx.drawImage(img, x, y, w, h);
    // 2 px edge extrusion to eliminate bilinear/mipmap seam bleeding
    ctx.drawImage(img, 0, 0, 1, img.height, x - 2, y, 2, h);
    ctx.drawImage(img, img.width - 1, 0, 1, img.height, x + w, y, 2, h);
    ctx.drawImage(img, 0, 0, img.width, 1, x, y - 2, w, 2);
    ctx.drawImage(img, 0, img.height - 1, img.width, 1, x, y + h, w, 2);
  }
  return {
    u0: (x + 1.5) / atlasW,
    v0: (y + 1.5) / atlasH,
    u1: (x + w - 1.5) / atlasW,
    v1: (y + h - 1.5) / atlasH,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/**
 * Renders every NPC vehicle in both City and Route modes with 4 draw calls by day
 * (5 at night with headlight ground pools) using Three.js BatchedMesh + InstancedMesh.
 */
export class NpcTrafficBatch {
  readonly group = new THREE.Group();

  private readonly bodyBatch: THREE.BatchedMesh;
  private readonly artBatch: THREE.BatchedMesh;
  private readonly lightBatch: THREE.BatchedMesh;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly poolMesh: THREE.InstancedMesh;

  private readonly atlasTex: THREE.CanvasTexture;
  private readonly ownedMats: THREE.Material[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];

  private readonly templates = new Map<NpcKind, KindTemplates>();
  private readonly slots: SlotData[] = [];
  private readonly activeSlotById = new Map<number, number>();
  private readonly freeSlots: number[] = [];
  private readonly slotAssignedId = new Int32Array(MAX_SLOTS).fill(-1);
  private readonly slotUsedFrame = new Uint8Array(MAX_SLOTS);

  // Reusable zero-allocation math objects
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpLeanQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpLeanEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpRootMat = new THREE.Matrix4();
  private readonly tmpLeanMat = new THREE.Matrix4();
  private readonly tmpBodyMat = new THREE.Matrix4();
  private readonly tmpShadowMat = new THREE.Matrix4();
  private readonly tmpShadowPos = new THREE.Vector3();
  private readonly tmpShadowScale = new THREE.Vector3();
  private readonly tmpPoolMat = new THREE.Matrix4();
  private readonly tmpPoolPos = new THREE.Vector3();
  private readonly tmpPoolScale = new THREE.Vector3();
  private readonly zeroMat = new THREE.Matrix4().compose(new THREE.Vector3(0, -500, 0), new THREE.Quaternion(), ZERO_SCALE);
  private readonly tmpColor = new THREE.Color();

  private shadowDirty = true;
  private poolDirty = true;

  constructor(factory: VehicleFactory) {
    // 1. Build 1024x1024 shelf-packed NPC art atlas (flipY=false matches glTF UVs).
    const atlasW = 1024;
    const atlasH = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = atlasW;
    canvas.height = atlasH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1d2a33';
    ctx.fillRect(0, 0, atlasW, atlasH);

    const truckArtRects: AtlasRect[] = [];
    for (let i = 0; i < 10; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 4 + col * 254;
      const y = 4 + row * 132;
      truckArtRects.push(drawSlotWithGutter(ctx, truckArtTexture(i), x, y, 248, 124, atlasW, atlasH));
    }

    const wsArtRects: AtlasRect[] = [];
    for (let i = 0; i < 8; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 4 + col * 254;
      const y = 408 + row * 132;
      wsArtRects.push(drawSlotWithGutter(ctx, windscreenArtTexture(i), x, y, 248, 124, atlasW, atlasH));
    }

    const routeRects: AtlasRect[] = [];
    for (let i = 0; i < NPC_ROUTE_BOARDS.length; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 4 + col * 254;
      const y = 680 + row * 70;
      routeRects.push(drawSlotWithGutter(ctx, routeBoardTexture(NPC_ROUTE_BOARDS[i]), x, y, 248, 62, atlasW, atlasH));
    }

    this.atlasTex = new THREE.CanvasTexture(canvas);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.atlasTex.flipY = false;
    this.atlasTex.anisotropy = 4;

    // 2. Collect raw geometries across all 6 NPC kinds & structural variants.
    const bodyGeos: THREE.BufferGeometry[] = [];
    const artGeos: THREE.BufferGeometry[] = [];
    const lightGeos: THREE.BufferGeometry[] = [];

    const variantSchedules: Record<NpcKind, readonly number[]> = {
      car: [0, 7], // standard sedan + yellow-black taxi
      bike: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // covers pillion (v%4==1), bag (v%6==3), helmet (v%5==0) & shirt variety
      cart: [0, 1, 2, 3], // donkey, fruit, donkey, canopy fruit
      rickshaw: [0, 1, 2, 3],
      minibus: [0, 1, 2, 3, 4, 5], // 0..3 roof riders, door riders, 6 route boards
      truck: [0, 1, 2, 3, 4, 5],
    };

    const addBodyGeo = (g: THREE.BufferGeometry): number => {
      bodyGeos.push(g);
      return bodyGeos.length - 1;
    };
    const addArtGeo = (g: THREE.BufferGeometry): number => {
      artGeos.push(g);
      return artGeos.length - 1;
    };
    const addLightGeo = (g: THREE.BufferGeometry): number => {
      lightGeos.push(g);
      return lightGeos.length - 1;
    };

    for (const kind of NPC_KINDS) {
      const variants = variantSchedules[kind];
      const paintGids: number[] = [];
      const fixedGids: number[] = [];
      const artGids: number[] = [];
      let headGid = -1;
      let brakeGid = -1;
      let hazardGid = -1;
      let shadowCx = 0;
      let shadowCz = 0;
      let shadowW = 1.6;
      let shadowL = 3.2;
      let hasPool = false;
      let poolZ = -2;
      const [poolW, poolL] = POOL_DIMS[kind];

      for (let vi = 0; vi < variants.length; vi++) {
        const v = variants[vi];
        const raw = factory.buildRawNpcProto(kind, v);
        raw.body.updateMatrixWorld(true);

        const lightSet = new Set<THREE.Object3D>([...raw.lights.head, ...raw.lights.brake, ...raw.lights.hazard]);
        if (vi === 0) {
          _box3.makeEmpty();
          raw.body.traverse((o) => {
            if (o instanceof THREE.Mesh && !isAuxiliaryMesh(o, raw)) {
              _box3.expandByObject(o);
            }
          });
          if (!_box3.isEmpty()) {
            shadowW = (_box3.max.x - _box3.min.x) * 1.25 + 0.3;
            shadowL = (_box3.max.z - _box3.min.z) * 1.15 + 0.4;
            shadowCx = (_box3.min.x + _box3.max.x) * 0.5;
            shadowCz = (_box3.min.z + _box3.max.z) * 0.5;
          }
          if (raw.lights.head.length > 0) {
            _box3.setFromObject(raw.lights.head[0]).getCenter(_vec3);
            hasPool = true;
            poolZ = _vec3.z - poolL * 0.5 + 0.35;
          }
          headGid = addLightGeo(prepNonIndexedVC(raw.body, raw.lights.head, true) ?? tinyFallbackGeo());
          brakeGid = addLightGeo(prepNonIndexedVC(raw.body, raw.lights.brake, true) ?? tinyFallbackGeo());
          hazardGid = addLightGeo(prepNonIndexedVC(raw.body, raw.lights.hazard, true) ?? tinyFallbackGeo());
        }

        const paintMeshes: THREE.Mesh[] = [];
        const fixedMeshes: THREE.Mesh[] = [];
        const artEntries: Array<{ mesh: THREE.Mesh; rect: AtlasRect }> = [];

        raw.body.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || lightSet.has(o) || isAuxiliaryMesh(o, raw)) return;
          const mat = o.material as THREE.MeshLambertMaterial;
          const mName = mat?.name || '';
          if (mName === 'paint') {
            paintMeshes.push(o);
            return;
          }
          if (mName === 'art_side' || mName === 'art_top' || mName === 'art_rear' || mName === 'art_screen' || mName === 'route_board') {
            let rect: AtlasRect;
            if (mName === 'route_board') {
              rect = routeRects[v % routeRects.length];
            } else if (mName === 'art_screen') {
              const idx = kind === 'truck' ? (v + 2) % wsArtRects.length : v % wsArtRects.length;
              rect = wsArtRects[idx];
            } else if (mName === 'art_top') {
              const idx = kind === 'truck' ? (v + 7) % truckArtRects.length : (v + 3) % truckArtRects.length;
              rect = truckArtRects[idx];
            } else if (mName === 'art_rear') {
              const idx = kind === 'truck' ? (v + 9) % truckArtRects.length : (v + 5) % truckArtRects.length;
              rect = truckArtRects[idx];
            } else {
              const idx = kind === 'truck' ? (v + 4) % truckArtRects.length : v % truckArtRects.length;
              rect = truckArtRects[idx];
            }
            artEntries.push({ mesh: o, rect });
            return;
          }
          fixedMeshes.push(o);
        });

        // Paint shell is only split once per kind (except variants whose paint shell geometry differs? No, same base model per kind!)
        if (vi === 0 || kind === 'car' || kind === 'cart' || kind === 'rickshaw' || kind === 'minibus' || kind === 'truck') {
          if (vi === 0) {
            paintGids.push(addBodyGeo(prepNonIndexedVC(raw.body, paintMeshes, true) ?? tinyFallbackGeo()));
          }
        }
        fixedGids.push(addBodyGeo(prepNonIndexedVC(raw.body, fixedMeshes, false) ?? tinyFallbackGeo()));
        if (artEntries.length > 0) {
          artGids.push(addArtGeo(prepTexturedAtlasGeo(raw.body, artEntries) ?? tinyFallbackGeo()));
        }
      }

      this.templates.set(kind, {
        paintGids,
        fixedGids,
        artGids,
        headGid,
        brakeGid,
        hazardGid,
        shadowCx,
        shadowCz,
        shadowW,
        shadowL,
        hasPool,
        poolZ,
        poolW,
        poolL,
      });
    }

    // 3. Allocate BatchedMeshes & InstancedMeshes.
    const bodyMat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true });
    const artMat = new THREE.MeshLambertMaterial({ color: '#ffffff', map: this.atlasTex, vertexColors: true, flatShading: true });
    const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.ownedMats.push(bodyMat, artMat, lightMat);

    const bodyVerts = bodyGeos.reduce((s, g) => s + g.getAttribute('position').count, 0);
    this.bodyBatch = new THREE.BatchedMesh(MAX_SLOTS * 2, bodyVerts, 0, bodyMat);
    this.bodyBatch.sortObjects = false;
    this.bodyBatch.frustumCulled = false;
    this.bodyBatch.perObjectFrustumCulled = true;
    this.bodyBatch.castShadow = false;
    this.bodyBatch.receiveShadow = true;
    for (const g of bodyGeos) {
      this.bodyBatch.addGeometry(g);
      g.dispose();
    }

    if (artGeos.length === 0) artGeos.push(tinyFallbackGeo());
    const artVerts = artGeos.reduce((s, g) => s + g.getAttribute('position').count, 0);
    this.artBatch = new THREE.BatchedMesh(MAX_SLOTS, artVerts, 0, artMat);
    this.artBatch.sortObjects = false;
    this.artBatch.frustumCulled = false;
    this.artBatch.perObjectFrustumCulled = true;
    this.artBatch.castShadow = false;
    this.artBatch.receiveShadow = true;
    for (const g of artGeos) {
      this.artBatch.addGeometry(g);
      g.dispose();
    }

    const lightVerts = lightGeos.reduce((s, g) => s + g.getAttribute('position').count, 0);
    this.lightBatch = new THREE.BatchedMesh(MAX_SLOTS * 3, lightVerts, 0, lightMat);
    this.lightBatch.sortObjects = false;
    this.lightBatch.frustumCulled = false;
    this.lightBatch.perObjectFrustumCulled = true;
    this.lightBatch.castShadow = false;
    for (const g of lightGeos) {
      this.lightBatch.addGeometry(g);
      g.dispose();
    }

    // Pre-allocate all instance slots (hidden initially) & prime batching colors before gl.compile.
    for (let i = MAX_SLOTS - 1; i >= 0; i--) this.freeSlots.push(i);
    for (let i = 0; i < MAX_SLOTS; i++) {
      const bodyPaintIid = this.bodyBatch.addInstance(0);
      const bodyFixedIid = this.bodyBatch.addInstance(0);
      const artIid = this.artBatch.addInstance(0);
      const headIid = this.lightBatch.addInstance(0);
      const brakeIid = this.lightBatch.addInstance(0);
      const hazardIid = this.lightBatch.addInstance(0);

      this.bodyBatch.setVisibleAt(bodyPaintIid, false);
      this.bodyBatch.setVisibleAt(bodyFixedIid, false);
      this.artBatch.setVisibleAt(artIid, false);
      this.lightBatch.setVisibleAt(headIid, false);
      this.lightBatch.setVisibleAt(brakeIid, false);
      this.lightBatch.setVisibleAt(hazardIid, false);

      this.bodyBatch.setColorAt(bodyPaintIid, WHITE);
      this.bodyBatch.setColorAt(bodyFixedIid, WHITE);
      this.artBatch.setColorAt(artIid, WHITE);
      this.lightBatch.setColorAt(headIid, HEAD_OFF);
      this.lightBatch.setColorAt(brakeIid, BRAKE_OFF);
      this.lightBatch.setColorAt(hazardIid, HAZARD_OFF);

      this.slots.push({ bodyPaintIid, bodyFixedIid, artIid, headIid, brakeIid, hazardIid });
    }

    const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.ownedGeos.push(planeGeo);

    const shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      alphaMap: contactShadowTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const poolMat = new THREE.MeshBasicMaterial({
      map: headlightPoolTexture(),
      color: '#ffeec2',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.ownedMats.push(shadowMat, poolMat);

    this.shadowMesh = new THREE.InstancedMesh(planeGeo, shadowMat, MAX_SLOTS);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.renderOrder = 1;
    this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.poolMesh = new THREE.InstancedMesh(planeGeo, poolMat, MAX_SLOTS);
    this.poolMesh.frustumCulled = false;
    this.poolMesh.renderOrder = 2;
    this.poolMesh.visible = false;
    this.poolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < MAX_SLOTS; i++) {
      this.shadowMesh.setMatrixAt(i, this.zeroMat);
      this.poolMesh.setMatrixAt(i, this.zeroMat);
    }
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    this.poolMesh.instanceMatrix.needsUpdate = true;

    this.group.add(this.bodyBatch, this.artBatch, this.lightBatch, this.shadowMesh, this.poolMesh);
  }

  private paintHexFor(kind: NpcKind, variant: number): string {
    switch (kind) {
      case 'bike':
        return NPC_BIKE_PAINTS[variant % NPC_BIKE_PAINTS.length];
      case 'cart':
        return NPC_CART_RAILS[variant % NPC_CART_RAILS.length];
      case 'car':
        return variant % 10 === 7 ? '#f2c200' : NPC_CAR_PAINTS[variant % NPC_CAR_PAINTS.length];
      case 'truck':
        return NPC_TRUCK_CABS[variant % NPC_TRUCK_CABS.length];
      case 'minibus':
        return NPC_MINIBUS_PAINTS[variant % NPC_MINIBUS_PAINTS.length];
      case 'rickshaw':
        return NPC_RICKSHAW_PAINTS[variant % NPC_RICKSHAW_PAINTS.length];
    }
  }

  private fixedIdxFor(kind: NpcKind, variant: number): number {
    switch (kind) {
      case 'car':
        return variant % 10 === 7 ? 1 : 0;
      case 'bike':
        return variant % 12;
      case 'cart':
        return variant % 4;
      case 'rickshaw':
        return variant % 4;
      case 'minibus':
        return variant % 6;
      case 'truck':
        return variant % 6;
    }
  }

  private artIdxFor(kind: NpcKind, variant: number): number {
    if (kind === 'minibus' || kind === 'truck') return variant % 6;
    return -1;
  }

  clear(): void {
    for (const [id, slotIdx] of this.activeSlotById) {
      this.hideSlot(slotIdx);
      this.slotAssignedId[slotIdx] = -1;
      this.freeSlots.push(slotIdx);
      void id;
    }
    this.activeSlotById.clear();
    this.slotUsedFrame.fill(0);
    if (this.shadowDirty) {
      this.shadowMesh.instanceMatrix.needsUpdate = true;
      this.shadowDirty = false;
    }
    if (this.poolDirty) {
      this.poolMesh.instanceMatrix.needsUpdate = true;
      this.poolDirty = false;
    }
  }

  private hideSlot(slotIdx: number): void {
    const s = this.slots[slotIdx];
    this.bodyBatch.setVisibleAt(s.bodyPaintIid, false);
    this.bodyBatch.setVisibleAt(s.bodyFixedIid, false);
    this.artBatch.setVisibleAt(s.artIid, false);
    this.lightBatch.setVisibleAt(s.headIid, false);
    this.lightBatch.setVisibleAt(s.brakeIid, false);
    this.lightBatch.setVisibleAt(s.hazardIid, false);
    this.shadowMesh.setMatrixAt(slotIdx, this.zeroMat);
    this.poolMesh.setMatrixAt(slotIdx, this.zeroMat);
    this.shadowDirty = true;
    this.poolDirty = true;
  }

  update(
    npcs: readonly NpcView[],
    alpha: number,
    time: number,
    lowLight: boolean,
    groundY: (x: number, z: number) => number,
    slopeFn: (x: number, z: number, heading: number) => number,
  ): void {
    this.slotUsedFrame.fill(0);
    const blink = Math.floor(time * 2.5) % 2 === 0;
    const headCol = lowLight ? HEAD_NIGHT : HEAD_DAY;

    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      let slotIdx = this.activeSlotById.get(n.id);
      if (slotIdx === undefined) {
        const free = this.freeSlots.pop();
        if (free === undefined) continue;
        slotIdx = free;
        this.activeSlotById.set(n.id, slotIdx);
        this.slotAssignedId[slotIdx] = n.id;

        const tpl = this.templates.get(n.kind)!;
        const s = this.slots[slotIdx];
        const fixIdx = this.fixedIdxFor(n.kind, n.variant);
        const artIdx = this.artIdxFor(n.kind, n.variant);

        this.bodyBatch.setGeometryIdAt(s.bodyPaintIid, tpl.paintGids[0]);
        this.bodyBatch.setGeometryIdAt(s.bodyFixedIid, tpl.fixedGids[fixIdx]);
        this.bodyBatch.setVisibleAt(s.bodyPaintIid, true);
        this.bodyBatch.setVisibleAt(s.bodyFixedIid, true);

        this.tmpColor.set(this.paintHexFor(n.kind, n.variant));
        this.bodyBatch.setColorAt(s.bodyPaintIid, this.tmpColor);
        this.bodyBatch.setColorAt(s.bodyFixedIid, WHITE);

        if (artIdx >= 0 && tpl.artGids.length > 0) {
          this.artBatch.setGeometryIdAt(s.artIid, tpl.artGids[artIdx % tpl.artGids.length]);
          this.artBatch.setVisibleAt(s.artIid, true);
        } else {
          this.artBatch.setVisibleAt(s.artIid, false);
        }

        this.lightBatch.setGeometryIdAt(s.headIid, tpl.headGid);
        this.lightBatch.setGeometryIdAt(s.brakeIid, tpl.brakeGid);
        this.lightBatch.setGeometryIdAt(s.hazardIid, tpl.hazardGid);
        this.lightBatch.setVisibleAt(s.headIid, true);
        this.lightBatch.setVisibleAt(s.brakeIid, true);
        this.lightBatch.setVisibleAt(s.hazardIid, true);
      }

      this.slotUsedFrame[slotIdx] = 1;
      const s = this.slots[slotIdx];
      const tpl = this.templates.get(n.kind)!;

      const nx = n.prevX + (n.x - n.prevX) * alpha;
      const nz = n.prevZ + (n.z - n.prevZ) * alpha;
      const nh = lerpAngle(n.prevHeading, n.heading, alpha);
      const ne = groundY(nx, nz);
      const slope = slopeFn(nx, nz, nh);

      this.tmpPos.set(nx, ne, -nz);
      this.tmpEuler.set(slope, -nh, 0, 'YXZ');
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpRootMat.compose(this.tmpPos, this.tmpQuat, ONE_SCALE);

      const leanRaw = n.kind === 'bike' ? -n.latVel * 0.12 * n.dir : -n.latVel * 0.02 * n.dir;
      const lean = Math.max(-0.35, Math.min(0.35, leanRaw));
      this.tmpLeanEuler.set(0, 0, lean, 'YXZ');
      this.tmpLeanQuat.setFromEuler(this.tmpLeanEuler);
      this.tmpLeanMat.makeRotationFromQuaternion(this.tmpLeanQuat);
      this.tmpBodyMat.multiplyMatrices(this.tmpRootMat, this.tmpLeanMat);

      this.bodyBatch.setMatrixAt(s.bodyPaintIid, this.tmpBodyMat);
      this.bodyBatch.setMatrixAt(s.bodyFixedIid, this.tmpBodyMat);
      if (tpl.artGids.length > 0) {
        this.artBatch.setMatrixAt(s.artIid, this.tmpBodyMat);
      }

      this.lightBatch.setMatrixAt(s.headIid, this.tmpBodyMat);
      this.lightBatch.setMatrixAt(s.brakeIid, this.tmpBodyMat);
      this.lightBatch.setMatrixAt(s.hazardIid, this.tmpBodyMat);
      this.lightBatch.setColorAt(s.headIid, headCol);
      this.lightBatch.setColorAt(s.brakeIid, n.brakeLights ? BRAKE_ON : BRAKE_OFF);
      this.lightBatch.setColorAt(s.hazardIid, n.hazardLights && blink ? HAZARD_ON : HAZARD_OFF);

      // Contact shadow at root pose
      this.tmpShadowPos.set(tpl.shadowCx, 0.03, tpl.shadowCz).applyMatrix4(this.tmpRootMat);
      this.tmpShadowScale.set(tpl.shadowW, 1, tpl.shadowL);
      this.tmpShadowMat.compose(this.tmpShadowPos, this.tmpQuat, this.tmpShadowScale);
      this.shadowMesh.setMatrixAt(slotIdx, this.tmpShadowMat);
      this.shadowDirty = true;

      // Headlight ground pool (rendered only during sunset / night / monsoon)
      if (lowLight) {
        if (tpl.hasPool) {
          this.tmpPoolPos.set(0, 0.055, tpl.poolZ).applyMatrix4(this.tmpRootMat);
          this.tmpPoolScale.set(tpl.poolW, 1, tpl.poolL);
          this.tmpPoolMat.compose(this.tmpPoolPos, this.tmpQuat, this.tmpPoolScale);
          this.poolMesh.setMatrixAt(slotIdx, this.tmpPoolMat);
        } else {
          this.poolMesh.setMatrixAt(slotIdx, this.zeroMat);
        }
        this.poolDirty = true;
      }
    }

    // Free slots belonging to despawned NPCs without allocating any Set/array
    for (let slotIdx = 0; slotIdx < MAX_SLOTS; slotIdx++) {
      const id = this.slotAssignedId[slotIdx];
      if (id >= 0 && this.slotUsedFrame[slotIdx] === 0) {
        this.hideSlot(slotIdx);
        this.activeSlotById.delete(id);
        this.slotAssignedId[slotIdx] = -1;
        this.freeSlots.push(slotIdx);
      }
    }

    this.poolMesh.visible = lowLight;
    if (this.shadowDirty) {
      this.shadowMesh.instanceMatrix.needsUpdate = true;
      this.shadowDirty = false;
    }
    if (lowLight || this.poolDirty) {
      this.poolMesh.instanceMatrix.needsUpdate = true;
      this.poolDirty = false;
    }
  }

  dispose(): void {
    this.bodyBatch.dispose();
    this.artBatch.dispose();
    this.lightBatch.dispose();
    this.shadowMesh.dispose();
    this.poolMesh.dispose();
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    this.atlasTex.dispose();
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;
    this.activeSlotById.clear();
    this.templates.clear();
  }
}
