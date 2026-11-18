import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NpcKind, PlayerVehicle } from '../sim/types';
import { headlightPoolTexture, routeBoardTexture, truckArtTexture, windscreenArtTexture, contactShadowTexture } from './textures';

/**
 * Builds low-poly procedural vehicles.
 *
 * Model convention: front faces local -Z, right is +X, wheels sit on y = 0.
 * Every model is wrapped as root (position + yaw) -> body (roll/pitch/bump).
 *
 * Preloads Blender/GLTF .glb models for all vehicles (with procedural
 * fallbacks), then returns pooled clones from create().
 * Gameplay never depends on mesh geometry — collision sizes live in src/sim/.
 */

export type VisualKind = NpcKind | PlayerVehicle | 'police';

export interface VehicleVisual {
  kind: VisualKind;
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  setBrake(on: boolean): void;
  setHazard(on: boolean): void;
  /** 0 = off, 1 = normal, 2 = flash (dipper). Pass pool=true at sunset/night. */
  setHeadlights(level: number, pool?: boolean): void;
}

/** glTF UVs expect flipY=false; canvas textures default to true. Cached clone. */
const gltfTex = new Map<string, THREE.Texture>();
function gltfTexture(t: THREE.Texture): THREE.Texture {
  let c = gltfTex.get(t.uuid);
  if (!c) {
    c = t.clone();
    c.flipY = false;
    c.needsUpdate = true;
    gltfTex.set(t.uuid, c);
  }
  return c;
}

const matCache = new Map<string, THREE.Material>();
function lambert(color: THREE.ColorRepresentation, opts: { emissive?: THREE.ColorRepresentation; map?: THREE.Texture } = {}): THREE.MeshLambertMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? ''}|${opts.map?.uuid ?? ''}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, map: opts.map ?? null });
    if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, l: number): THREE.BufferGeometry {
  const key = `b${w.toFixed(3)},${h.toFixed(3)},${l.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, l);
    geoCache.set(key, g);
  }
  return g;
}
function cylGeo(rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry {
  const key = `c${rt},${rb},${h},${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }
  return g;
}
function sphereGeo(r: number, seg = 6): THREE.BufferGeometry {
  const key = `s${r},${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
    geoCache.set(key, g);
  }
  return g;
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function box(parent: THREE.Object3D, w: number, h: number, l: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  return add(parent, boxGeo(w, h, l), mat, x, y, z);
}

// Shared palette.
const M = {
  tyre: () => lambert('#1d1d1f'),
  rim: () => lambert('#9aa0a6'),
  glass: () => lambert('#22303a'),
  chrome: () => lambert('#d9dde0'),
  black: () => lambert('#18181a'),
  darkGrey: () => lambert('#3a3c40'),
  plate: () => lambert('#f4f1e6'),
  skin: () => lambert('#a8714f'),
  hair: () => lambert('#1e1712'),
  headOff: () => lambert('#e9e4cf'),
  headOn: () => lambert('#fffbe8', { emissive: '#fff3c4' }),
  brakeOff: () => lambert('#6e1010'),
  brakeOn: () => lambert('#ff2020', { emissive: '#ff1a1a' }),
  hazardOff: () => lambert('#8a5a12'),
  hazardOn: () => lambert('#ffb020', { emissive: '#ff9900' }),
  poolDim: () => {
    let m = matCache.get('poolDim') as THREE.MeshBasicMaterial | undefined;
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: headlightPoolTexture(),
        color: '#ffeec2',
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      matCache.set('poolDim', m);
    }
    return m;
  },
  poolBright: () => {
    let m = matCache.get('poolBright') as THREE.MeshBasicMaterial | undefined;
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: headlightPoolTexture(),
        color: '#fff9e6',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      matCache.set('poolBright', m);
    }
    return m;
  },
};

const SHIRT_COLORS = ['#e9e4d4', '#3a6ea5', '#6b8e23', '#b5651d', '#7a7a7a', '#2f4f4f', '#c2b280', '#8b0000'];
const CAR_COLORS = ['#f2f2f2', '#c9ccd1', '#1f1f22', '#7a1d24', '#2c4a7a', '#d8d2c0', '#5b6168', '#3c6e71'];
const ROUTE_BOARDS = ['W-11', 'W-22', 'D-7', 'G-19', '1-C', 'S-1'];

function wheel(parent: THREE.Object3D, r: number, w: number, x: number, z: number, list: THREE.Object3D[]): void {
  const pivot = new THREE.Group();
  pivot.position.set(x, r, z);
  add(pivot, cylGeo(r, r, w, 10), M.tyre(), 0, 0, 0, 0, 0, Math.PI / 2);
  add(pivot, cylGeo(r * 0.55, r * 0.55, w + 0.02, 6), M.rim(), 0, 0, 0, 0, 0, Math.PI / 2);
  parent.add(pivot);
  list.push(pivot);
}

function rider(parent: THREE.Object3D, shirt: string, x: number, y: number, z: number, helmet: boolean): void {
  const shirtMat = lambert(shirt);
  box(parent, 0.42, 0.62, 0.3, shirtMat, x, y + 0.31, z);
  add(parent, sphereGeo(0.14), helmet ? lambert('#c62828') : M.skin(), x, y + 0.78, z - 0.02);
  if (!helmet) add(parent, sphereGeo(0.12), M.hair(), x, y + 0.84, z + 0.03);
  // Legs (shalwar).
  box(parent, 0.16, 0.5, 0.18, shirtMat, x - 0.15, y - 0.15, z - 0.22);
  box(parent, 0.16, 0.5, 0.18, shirtMat, x + 0.15, y - 0.15, z - 0.22);
  // Arms reaching forward.
  box(parent, 0.11, 0.11, 0.48, shirtMat, x - 0.25, y + 0.42, z - 0.25);
  box(parent, 0.11, 0.11, 0.48, shirtMat, x + 0.25, y + 0.42, z - 0.25);
}

interface Lights {
  brake: THREE.Mesh[];
  hazard: THREE.Mesh[];
  head: THREE.Mesh[];
  beam?: THREE.Mesh;
  pool?: THREE.Mesh;
}

interface Proto {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  lights: Lights;
}

const LIGHT_NAMES = ['brake', 'hazard', 'head'] as const;

function attachHeadlightPool(body: THREE.Group, lights: Lights, frontZ: number, width: number, len: number): void {
  const geo = new THREE.PlaneGeometry(width, len);
  geo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(geo, M.poolDim());
  pool.name = 'pool';
  pool.position.set(0, 0.055, frontZ - len * 0.5 + 0.35);
  pool.visible = false;
  pool.castShadow = false;
  pool.renderOrder = 2;
  body.add(pool);
  lights.pool = pool;
}

/** Merge a list of meshes into one mesh in `body` space. */
function mergeMeshes(body: THREE.Object3D, meshes: THREE.Mesh[], material: THREE.Material, name: string): THREE.Mesh | null {
  if (meshes.length === 0) return null;
  const inv = body.matrixWorld.clone().invert();
  let geos = meshes.map((m) => {
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    return g;
  });
  // Extruded / shape parts are non-indexed; boxes are indexed. Unify.
  if (geos.some((g) => !g.index) && geos.some((g) => g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  // Model parts may differ in attributes (e.g. projected panels have no uv):
  // keep only those every part has.
  const common = Object.keys(geos[0].attributes).filter((k) => geos.every((g) => k in g.attributes));
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k);
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.castShadow = true;
  body.add(mesh);
  return mesh;
}

/**
 * Collapse a hand-built vehicle into a few draw calls: one mesh per material,
 * plus one mesh per light group (so lights can swap material). Wheels stay
 * separate only when they need to spin.
 */
function finalize(p: Proto, keepWheels: boolean): void {
  const { body, lights } = p;
  body.updateMatrixWorld(true);
  const lightSet = new Set<THREE.Object3D>([...lights.brake, ...lights.hazard, ...lights.head]);
  if (lights.beam) lightSet.add(lights.beam);
  if (lights.pool) lightSet.add(lights.pool);
  const wheelSet = new Set<THREE.Object3D>();
  if (keepWheels) for (const w of p.wheels) w.traverse((o) => wheelSet.add(o));

  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || lightSet.has(o) || wheelSet.has(o)) return;
    const mat = o.material as THREE.Material;
    let list = byMat.get(mat);
    if (!list) byMat.set(mat, (list = []));
    list.push(o);
  });
  const mergedLights: Record<string, THREE.Mesh | null> = {};
  for (const name of LIGHT_NAMES) {
    const list = lights[name];
    mergedLights[name] = list.length ? mergeMeshes(body, list, list[0].material as THREE.Material, name) : null;
  }
  for (const [mat, list] of byMat) mergeMeshes(body, list, mat, 'part');

  // Remove originals.
  const remove: THREE.Object3D[] = [];
  body.traverse((o) => {
    if (o === body || o.parent !== body) return;
    if (o.name === 'part' || LIGHT_NAMES.includes(o.name as (typeof LIGHT_NAMES)[number])) return;
    if (o === lights.beam || o === lights.pool || (keepWheels && wheelSet.has(o))) return;
    remove.push(o);
  });
  for (const o of remove) body.remove(o);
  if (lights.beam) lights.beam.name = 'beam';
  if (lights.pool) lights.pool.name = 'pool';
  for (const w of p.wheels) w.name = 'wheel';
  if (!keepWheels) p.wheels = [];
}

function bind(kind: VisualKind, root: THREE.Group, wheelRadius: number): VehicleVisual {
  const body = root.children[0] as THREE.Group;
  const find = (n: string) => body.children.find((c) => c.name === n) as THREE.Mesh | undefined;
  const brakeMesh = find('brake');
  const hazardMesh = find('hazard');
  const headMesh = find('head');
  const beam = find('beam');
  const poolMesh = find('pool');
  const wheels = body.children.filter((c) => c.name === 'wheel');
  let brake = false, hazard = false, head = -1, poolOn = false;
  return {
    kind, root, body, wheels, wheelRadius,
    setBrake(on) {
      if (on === brake || !brakeMesh) return;
      brake = on;
      brakeMesh.material = on ? M.brakeOn() : M.brakeOff();
    },
    setHazard(on) {
      if (on === hazard || !hazardMesh) return;
      hazard = on;
      hazardMesh.material = on ? M.hazardOn() : M.hazardOff();
    },
    setHeadlights(level, pool = false) {
      if (level === head && pool === poolOn) return;
      head = level;
      poolOn = pool;
      if (headMesh) headMesh.material = level > 0 ? M.headOn() : M.headOff();
      if (beam) beam.visible = level >= 2;
      if (poolMesh) {
        const showPool = level > 0 && (pool || level >= 2);
        poolMesh.visible = showPool;
        if (showPool) poolMesh.material = level >= 2 ? M.poolBright() : M.poolDim();
      }
    },
  };
}

export class VehicleFactory {
  private beamMaterial: THREE.MeshBasicMaterial | null = null;
  /** Blender/GLTF .glb models; procedural fallback if missing. */
  private models = new Map<string, THREE.Group>();

  /** Load all .glb assets and warm shared textures up front. */
  async preload(): Promise<void> {
    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: '#fff7d6',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const loader = new GLTFLoader();
    await Promise.all(
      ['alto', 'coupe', 'rickshaw', 'suv', 'minibus', 'bike', 'cart', 'car', 'truck'].map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.${(import.meta.env.VITE_MODEL_EXT as string | undefined) ?? 'glb'}`);
          this.models.set(name, gltf.scene);
        } catch (err) {
          console.warn(`model ${name}.glb unavailable, using procedural mesh`, err);
        }
      }),
    );
    // Warm the texture caches so first spawns don't hitch.
    for (let i = 0; i < 10; i++) truckArtTexture(i);
    for (const r of ROUTE_BOARDS) routeBoardTexture(r);
    headlightPoolTexture();
  }

  private protos = new Map<string, Proto>();

  create(
    kind: VisualKind,
    variant: number,
    keepWheels = kind === 'alto' || kind === 'coupe' || kind === 'suv',
    paint?: string | number,
  ): VehicleVisual {
    const paintKey = paint === undefined ? '' : typeof paint === 'number' ? `#${paint.toString(16).padStart(6, '0')}` : paint;
    const key = `${kind}:${variant}:${keepWheels ? 'p' : 'n'}:${paintKey}`;
    let proto = this.protos.get(key);
    if (!proto) {
      proto = this.build(kind, variant, paint);
      finalize(proto, keepWheels);
      addContactShadow(proto.root);
      this.protos.set(key, proto);
    }
    const v = bind(kind, proto.root.clone(true), proto.wheelRadius);
    if (keepWheels) v.setHeadlights(1, false);
    return v;
  }

  private build(kind: VisualKind, variant: number, paint?: string | number): Proto {
    switch (kind) {
      case 'alto': return this.models.has('alto') ? this.fromModel('alto', 0.28, paint) : this.alto(paint);
      case 'coupe': return this.models.has('coupe') ? this.fromModel('coupe', 0.33, paint, {}, {}, [4.8, 12.0]) : this.car(variant, paint);
      case 'suv': return this.models.has('suv') ? this.fromModel('suv', 0.42, paint, {}, {}, [5.2, 13.0]) : this.car(variant, paint);
      case 'car': return this.models.has('car') ? this.carModel(variant) : this.car(variant);
      case 'bike': return this.models.has('bike') ? this.bikeModel(variant) : this.bike(variant);
      case 'minibus': return this.models.has('minibus') ? this.minibusModel(variant, paint) : this.minibus(variant, paint);
      case 'rickshaw': return this.models.has('rickshaw') ? this.rickshawModel(variant, paint) : this.rickshaw(variant, paint);
      case 'cart': return this.models.has('cart') ? this.cartModel(variant) : this.cart(variant);
      case 'truck': return this.models.has('truck') ? this.truckModel(variant) : this.truck(variant);
      case 'police': return this.police();
    }
  }

  private shell(): { root: THREE.Group; body: THREE.Group } {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    root.rotation.order = 'YXZ';
    body.rotation.order = 'YXZ';
    return { root, body };
  }

  /**
   * Wrap a loaded .glb in the same Proto shape the procedural builders use.
   * Node names carry meaning: head_, brake_ and hazard_ nodes are lights; wheel_ nodes spin.
   * glTF PBR materials become smooth Lambert to match the scene's lighting.
   */
  private fromModel(
    name: string,
    wheelRadius: number,
    paint?: string | number,
    maps: Record<string, THREE.Texture> = {},
    matColors: Record<string, string | number> = {},
    poolSize: readonly [number, number] = [4.6, 11],
  ): Proto {
    const { root, body } = this.shell();
    const src = this.models.get(name);
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    if (!src) return { root, body, wheels, wheelRadius, lights };
    const scene = src.clone(true);
    for (const c of [...scene.children]) body.add(c);
    const mats = new Map<string, THREE.Material>();
    body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      let lm = mats.get(m.name);
      if (!lm) {
        const map = maps[m.name] ? gltfTexture(maps[m.name]) : null;
        const override = matColors[m.name] ?? (m.name === 'paint' ? paint : undefined);
        const color = map ? new THREE.Color('#ffffff') : override !== undefined ? new THREE.Color(override) : m.color;
        lm = new THREE.MeshLambertMaterial({ color, map, name: m.name });
        mats.set(m.name, lm);
      }
      o.material = lm;
      o.castShadow = true;
    });
    for (const c of body.children) {
      const n = c.name.toLowerCase();
      const mesh = c instanceof THREE.Mesh ? c : null;
      if (n.startsWith('wheel')) wheels.push(c);
      else if (
        mesh &&
        n.startsWith('head') &&
        !n.startsWith('head_bezel') &&
        !n.startsWith('head_surround') &&
        !n.startsWith('head_reflector')
      ) {
        mesh.material = M.headOff();
        lights.head.push(mesh);
      } else if (mesh && n.startsWith('brake')) {
        mesh.material = M.brakeOff();
        lights.brake.push(mesh);
      } else if (mesh && n.startsWith('hazard')) {
        mesh.material = M.hazardOff();
        lights.hazard.push(mesh);
      }
    }
    if (lights.head.length) {
      body.updateMatrixWorld(true);
      const box3 = new THREE.Box3();
      const headCenter = new THREE.Vector3();
      box3.setFromObject(lights.head[0]).getCenter(headCenter);
      if (this.beamMaterial) {
        const beamGeo = new THREE.ConeGeometry(2.2, 14, 12, 1, true);
        beamGeo.translate(0, -7, 0);
        beamGeo.rotateX(Math.PI / 2);
        const beam = new THREE.Mesh(beamGeo, this.beamMaterial);
        beam.position.set(0, headCenter.y, headCenter.z);
        beam.visible = false;
        beam.castShadow = false;
        body.add(beam);
        lights.beam = beam;
      }
      attachHeadlightPool(body, lights, headCenter.z, poolSize[0], poolSize[1]);
    }
    return { root, body, wheels, wheelRadius, lights };
  }

  /** Honda CD-70 motorcycle from .glb, with rider & optional pillion or delivery box. */
  private bikeModel(variant: number): Proto {
    const PAINTS = ['#c0161c', '#c0161c', '#1c1d20', '#164ea6', '#216e39', '#3c4043'];
    const p = this.fromModel('bike', 0.3, PAINTS[variant % PAINTS.length], {}, {}, [2.8, 8.5]);
    rider(p.body, SHIRT_COLORS[variant % SHIRT_COLORS.length], 0, 0.86, 0.22, variant % 5 === 0);
    if (variant % 4 === 1) {
      rider(p.body, SHIRT_COLORS[(variant + 3) % SHIRT_COLORS.length], 0, 0.9, 0.62, false);
    } else if (variant % 6 === 3) {
      const bagCols = ['#d32f2f', '#1b5e20', '#ef6c00'];
      box(p.body, 0.36, 0.3, 0.36, lambert(bagCols[variant % bagCols.length]), 0, 0.96, 0.64);
    }
    return p;
  }

  /** Wooden Karachi rehri/cart from .glb: donkey haul vs fruit push-thela. */
  private cartModel(variant: number): Proto {
    const RAIL = ['#d32f2f', '#1976d2', '#2e7d32', '#f9a825', '#7b1fa2'];
    const p = this.fromModel('cart', 0.48, RAIL[variant % RAIL.length], {}, {}, [3.0, 6.5]);
    const darkWood = lambert('#5d3a1a');
    if (variant % 2 === 0) {
      const grey = lambert('#8e8a86');
      for (const sx of [-0.3, 0.3]) box(p.body, 0.06, 0.06, 1.6, darkWood, sx, 0.84, -1.0);
      box(p.body, 0.42, 0.5, 1.0, grey, 0, 0.95, -1.35);
      add(p.body, boxGeo(0.24, 0.5, 0.26), grey, 0, 1.3, -1.85, -0.5);
      box(p.body, 0.2, 0.22, 0.4, grey, 0, 1.38, -2.05);
      for (const sx of [-0.06, 0.06]) box(p.body, 0.05, 0.28, 0.05, grey, sx, 1.66, -1.9);
      for (const [x, z] of [[-0.14, -1.7], [0.14, -1.7], [-0.14, -1.0], [0.14, -1.0]] as const) box(p.body, 0.1, 0.62, 0.1, grey, x, 0.36, z);
      rider(p.body, SHIRT_COLORS[variant % SHIRT_COLORS.length], 0, 0.88, -0.04, false);
      box(p.body, 0.9, 0.42, 0.86, lambert('#d7c7a0'), 0, 0.96, 0.9);
    } else {
      const fruit = [lambert('#f57c00'), lambert('#c62828'), lambert('#fbc02d'), lambert('#7cb342')];
      for (let i = 0; i < 12; i++) {
        add(p.body, sphereGeo(0.17, 5), fruit[(i + variant) % 4], -0.38 + (i % 3) * 0.38, 0.88 + Math.floor(i / 6) * 0.15, -0.15 + (Math.floor(i / 3) % 4) * 0.44);
      }
      if (variant % 4 === 3) {
        const canopyCols = ['#d32f2f', '#1976d2', '#2e7d32'];
        add(p.body, cylGeo(0.025, 0.025, 1.5, 5), darkWood, 0, 1.55, 0.52);
        add(p.body, new THREE.ConeGeometry(0.95, 0.32, 8), lambert(canopyCols[variant % canopyCols.length]), 0, 2.38, 0.52);
      }
      box(p.body, 0.06, 0.06, 0.78, darkWood, -0.5, 0.92, 1.82);
      box(p.body, 0.06, 0.06, 0.78, darkWood, 0.5, 0.92, 1.82);
      const g = new THREE.Group();
      g.position.set(0, 0.55, 2.24);
      p.body.add(g);
      rider(g, SHIRT_COLORS[(variant + 1) % SHIRT_COLORS.length], 0, 0, 0, false);
    }
    return p;
  }

  /** Karachi sedan (Corolla / City / Yellow-Black Taxi) from .glb. */
  private carModel(variant: number): Proto {
    const taxi = variant % 10 === 7;
    const p = this.fromModel('car', 0.32, taxi ? '#f2c200' : CAR_COLORS[variant % CAR_COLORS.length], {}, {}, [4.6, 11.5]);
    if (taxi) {
      box(p.body, 1.75, 0.11, 3.6, M.black(), 0, 0.79, 0);
      box(p.body, 0.42, 0.14, 0.22, lambert('#ffe066', { emissive: '#ffaa00' }), 0, 1.44, -0.12);
    }
    return p;
  }

  /** Decorated Bedford J6 truck from .glb with Taj crown & truck-art panels. */
  private truckModel(variant: number): Proto {
    const CAB = ['#1565c0', '#c62828', '#2e7d32', '#ef6c00', '#00695c', '#5e35b1'];
    return this.fromModel(
      'truck',
      0.5,
      CAB[variant % CAB.length],
      {
        art_side: truckArtTexture(variant + 4),
        art_top: truckArtTexture(variant + 7),
        art_rear: truckArtTexture(variant + 9),
        art_screen: windscreenArtTexture(variant + 2),
      },
      {},
      [6.4, 15],
    );
  }

  /** Karachi route minibus from Blender: truck art & route board per variant, riders on doors/roof. */
  private minibusModel(variant: number, paintOverride?: string | number): Proto {
    const BASE = ['#1f4fa8', '#e9e2cf', '#1f7a4d', '#b3261e', '#1565c0', '#6a1b9a', '#00796b', '#d84315'];
    const CREAM = ['#f3ecd8', '#fff8e1', '#e8eef5', '#f2e8cf'];
    const RED = ['#c62828', '#ad1457', '#ef6c00', '#1565c0'];
    const p = this.fromModel(
      'minibus',
      0.42,
      paintOverride ?? BASE[variant % BASE.length],
      {
        art_side: truckArtTexture(variant),
        art_top: truckArtTexture(variant + 3),
        art_rear: truckArtTexture(variant + 5),
        art_screen: windscreenArtTexture(variant),
      },
      {
        cream: CREAM[variant % CREAM.length],
        red: RED[(variant >> 1) % RED.length],
      },
      [6.2, 14.5],
    );
    const route = ROUTE_BOARDS[variant % ROUTE_BOARDS.length];
    box(p.body, 1.12, 0.24, 0.04, lambert('#ffffff', { map: routeBoardTexture(route), emissive: '#ffd400' }), 0, 2.74, -3.58);
    const shirt = (k: number) => SHIRT_COLORS[(variant + k) % SHIRT_COLORS.length];
    // Hanging off the kerb-side doors (model doors at y 1.62 / -2.62 -> three z).
    rider(p.body, shirt(1), -1.22, 0.95, -1.62, false);
    if (variant % 2 === 0) rider(p.body, shirt(2), -1.22, 0.95, 2.62, false);
    // Riding on the roof rack.
    const roof: Array<[number, number]> = [[-0.4, -0.2], [0.35, -0.9], [-0.3, 1.0]];
    for (let k = 0; k < variant % 4; k++) rider(p.body, shirt(3 + k), roof[k][0], 2.96, roof[k][1], false);
    return p;
  }

  /** Sazgar auto-rickshaw from Blender, in Karachi's common liveries & canopies, with driver. */
  private rickshawModel(variant: number, paintOverride?: string | number): Proto {
    const LIVERY = ['#e8731c', '#f2b51c', '#2e7d32', '#e8731c', '#c9461c', '#00796b', '#ef6c00', '#1b5e20'];
    const CANOPY = ['#151517', '#1f2329', '#1e3f20', '#2b1b17'];
    const CURTAIN = ['#b71c1c', '#1565c0', '#2e7d32', '#6a1b9a'];
    const STRIPE = ['#ffd600', '#ffffff', '#ff5722', '#00e676'];
    const p = this.fromModel(
      'rickshaw',
      0.24,
      paintOverride ?? LIVERY[variant % LIVERY.length],
      {},
      {
        canopy: CANOPY[variant % CANOPY.length],
        curtain: CURTAIN[(variant + 1) % CURTAIN.length],
        trim_stripe: STRIPE[variant % STRIPE.length],
      },
      [4.0, 9.5],
    );
    rider(p.body, SHIRT_COLORS[variant % SHIRT_COLORS.length], 0, 0.91, -0.32, false);
    return p;
  }

  // ---- Suzuki Alto (procedural fallback) --------------------------------------
  // 8th-gen Alto as seen on Karachi roads: tall, rounded one-box hatch,
  // upright tailgate with a big rear window, small horizontal tail lamps.
  private alto(paintOverride?: string | number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const paint = lambert(paintOverride ?? '#dfe2e3');
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const BEVEL = 0.11;
    const HALF_W = 0.74;

    // Side profile in (z, y), z forward-negative; bevel grows it by BEVEL.
    const prof: Array<[number, number]> = [
      [-1.6, 0.44], [-1.64, 0.62], [-1.58, 0.76], [-0.92, 0.9], [-0.36, 1.34],
      [1.32, 1.36], [1.58, 0.9], [1.6, 0.6], [1.57, 0.44],
    ];
    const shape = new THREE.Shape();
    prof.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
    shape.closePath();
    const depth = 2 * (HALF_W - BEVEL);
    const shell = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 3 });
    shell.rotateY(Math.PI / 2);
    shell.translate(-depth / 2, 0, 0);
    // Tumblehome: the glasshouse leans inward above the waistline.
    const taper = (x: number, y: number) => x * (1 - Math.max(0, y - 0.88) * 0.32);
    {
      const pos = shell.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setX(i, taper(pos.getX(i), pos.getY(i)));
      shell.computeVertexNormals();
    }
    add(body, shell, paint, 0, 0, 0);

    // Glass as thin panels just proud of the shell. A quad between two
    // profile points (z0,y0)-(z1,y1), offset along the surface normal.
    const glass = lambert('#4a5862'); // hazy, reflective grey
    const quad = (z0: number, y0: number, z1: number, y1: number, hw: number) => {
      const dz = z1 - z0, dy = y1 - y0;
      const len = Math.hypot(dz, dy);
      // Outward normal of the profile edge (shape is wound front -> back over the top).
      const nz = -dy / len, ny = dz / len;
      const o = BEVEL + 0.012;
      const a = [z0 + nz * o, y0 + ny * o], b = [z1 + nz * o, y1 + ny * o];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-hw, a[1], a[0], hw, a[1], a[0], hw, b[1], b[0], -hw, b[1], b[0]], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
      g.computeVertexNormals();
      add(body, g, glass, 0, 0, 0);
    };
    quad(-0.86, 0.95, -0.4, 1.32, 0.56); // windscreen
    quad(1.37, 1.33, 1.57, 0.96, 0.56); // big rear window
    // Side windows (one shape per side) with a black B-pillar.
    const side = new THREE.Shape();
    const win: Array<[number, number]> = [[-0.82, 1.0], [-0.4, 1.31], [1.28, 1.32], [1.5, 1.04]];
    win.forEach(([z, y], i) => (i ? side.lineTo(-z, y) : side.moveTo(-z, y)));
    side.closePath();
    for (const sx of [-1, 1]) {
      const g = new THREE.ShapeGeometry(side);
      g.rotateY(Math.PI / 2);
      if (sx < 0) g.scale(-1, 1, 1);
      // Lean in with the tumblehome (pivot at the waistline).
      g.translate(0, -0.88, 0);
      g.rotateZ(sx * 0.233); // atan(HALF_W * 0.32)
      g.translate(0, 0.88, 0);
      add(body, g, glass, sx * (HALF_W + 0.014), 0, 0, 0, 0, 0);
      box(body, 0.03, 0.4, 0.09, M.black(), sx * (HALF_W + 0.018 - 0.29 * 0.237), 1.17, 0.28).rotation.z = sx * 0.233;
      // Wheel arches: dark discs behind the tyres.
      for (const z of [-1.1, 1.14]) {
        const arch = new THREE.CircleGeometry(0.4, 10, 0, Math.PI);
        arch.rotateY(Math.PI / 2 * sx);
        add(body, arch, M.black(), sx * (HALF_W + 0.008), 0.3, z);
      }
      // Door seam + handle.
      box(body, 0.012, 0.5, 0.02, lambert('#b9bdc0'), sx * (HALF_W + 0.006), 0.66, 0.3);
      box(body, 0.03, 0.04, 0.16, lambert('#c9cdd0'), sx * (HALF_W + 0.012), 0.86, 0.12);
      box(body, 0.03, 0.04, 0.16, lambert('#c9cdd0'), sx * (HALF_W + 0.012), 0.86, 1.0);
      // Mirror.
      box(body, 0.16, 0.12, 0.08, paint, sx * 0.86, 1.02, -0.64);
    }
    // Front: swept headlamps, slim black grille, lower intake.
    const front = -1.64 - BEVEL - 0.01;
    for (const sx of [-0.5, 0.5]) {
      lights.head.push(box(body, 0.36, 0.14, 0.05, M.headOff(), sx, 0.74, front + 0.04));
      lights.hazard.push(box(body, 0.1, 0.06, 0.05, M.hazardOff(), sx * 1.32, 0.72, front + 0.07));
    }
    box(body, 0.56, 0.08, 0.04, M.black(), 0, 0.74, front + 0.01);
    box(body, 0.9, 0.1, 0.04, M.darkGrey(), 0, 0.46, front + 0.03);
    // Rear: tall tailgate, small horizontal lamps either side of the plate.
    const rear = 1.6 + BEVEL + 0.005;
    for (const sx of [-0.5, 0.5]) lights.brake.push(box(body, 0.26, 0.08, 0.05, M.brakeOff(), sx, 0.58, rear - 0.02));
    box(body, 0.38, 0.12, 0.03, M.plate(), 0, 0.58, rear);
    box(body, 0.38, 0.12, 0.03, M.plate(), 0, 0.52, front);
    box(body, 1.1, 0.05, 0.04, M.darkGrey(), 0, 0.4, rear - 0.03);
    box(body, 0.5, 0.03, 0.03, lambert('#c9cdd0'), 0, 0.9, rear - 0.035);
    // Wheels: narrow track, small 13" wheels.
    for (const [x, z] of [[-0.69, -1.1], [0.69, -1.1], [-0.69, 1.14], [0.69, 1.14]] as const) wheel(body, 0.29, 0.21, x, z, wheels);
    // Dipper flash beam (visible only when flashing).
    if (this.beamMaterial) {
      const beamGeo = new THREE.ConeGeometry(2.2, 14, 12, 1, true);
      beamGeo.translate(0, -7, 0);
      beamGeo.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(beamGeo, this.beamMaterial);
      beam.position.set(0, 0.74, front);
      beam.visible = false;
      beam.castShadow = false;
      body.add(beam);
      lights.beam = beam;
    }
    attachHeadlightPool(body, lights, front, 4.6, 11);
    return { root, body, wheels, wheelRadius: 0.29, lights };
  }

  // ---- Generic sedan ---------------------------------------------------------
  private car(variant: number, paintOverride?: string | number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const taxi = variant === 7;
    const paint = lambert(paintOverride ?? (taxi ? '#f2c200' : CAR_COLORS[variant % CAR_COLORS.length]));
    box(body, 1.72, 0.6, 4.4, paint, 0, 0.62, 0);
    box(body, 1.6, 0.52, 2.3, M.glass(), 0, 1.16, 0.2);
    box(body, 1.62, 0.08, 1.9, paint, 0, 1.45, 0.25);
    if (taxi) box(body, 1.74, 0.12, 4.0, M.black(), 0, 0.82, 0);
    for (const sx of [-0.62, 0.62]) {
      lights.head.push(box(body, 0.42, 0.14, 0.05, M.headOff(), sx, 0.78, -2.21));
      lights.brake.push(box(body, 0.4, 0.16, 0.05, M.brakeOff(), sx, 0.82, 2.21));
      lights.hazard.push(box(body, 0.12, 0.08, 0.05, M.hazardOff(), sx * 1.3, 0.62, -2.21));
    }
    box(body, 1.74, 0.18, 0.15, M.darkGrey(), 0, 0.42, -2.22);
    box(body, 1.74, 0.18, 0.15, M.darkGrey(), 0, 0.42, 2.22);
    for (const [x, z] of [[-0.78, -1.4], [0.78, -1.4], [-0.78, 1.4], [0.78, 1.4]] as const) wheel(body, 0.32, 0.22, x, z, wheels);
    attachHeadlightPool(body, lights, -2.21, 4.6, 11.5);
    return { root, body, wheels, wheelRadius: 0.32, lights };
  }

  // ---- Police pickup (roadblock prop) -----------------------------------------
  private police(): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const paint = lambert('#f4f4f4');
    box(body, 1.8, 0.7, 5, paint, 0, 0.75, 0);
    box(body, 1.7, 0.6, 1.6, M.glass(), 0, 1.4, -0.6);
    box(body, 1.82, 0.16, 5.02, lambert('#1a3c8c'), 0, 0.9, 0);
    box(body, 1.2, 0.14, 0.3, lambert('#ff2020', { emissive: '#ff0000' }), -0.3, 1.78, -0.6).name = 'lightRed';
    box(body, 1.2, 0.14, 0.3, lambert('#2050ff', { emissive: '#0030ff' }), 0.3, 1.78, -0.6).name = 'lightBlue';
    for (const [x, z] of [[-0.82, -1.6], [0.82, -1.6], [-0.82, 1.6], [0.82, 1.6]] as const) wheel(body, 0.38, 0.26, x, z, wheels);
    return { root, body, wheels, wheelRadius: 0.38, lights };
  }

  // ---- 70cc motorbike with rider ---------------------------------------------
  private bike(variant: number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const tank = lambert(variant % 3 === 0 ? '#1d1d1f' : '#c0161c');
    wheel(body, 0.3, 0.1, 0, -0.68, wheels);
    wheel(body, 0.3, 0.1, 0, 0.68, wheels);
    box(body, 0.1, 0.1, 1.2, M.darkGrey(), 0, 0.48, 0);
    box(body, 0.26, 0.22, 0.46, tank, 0, 0.74, -0.18);
    box(body, 0.26, 0.1, 0.6, M.black(), 0, 0.78, 0.3);
    box(body, 0.32, 0.22, 0.3, M.chrome(), 0, 0.4, 0.1);
    box(body, 0.62, 0.04, 0.04, M.chrome(), 0, 1.0, -0.5);
    add(body, cylGeo(0.03, 0.03, 0.55, 5), M.chrome(), 0, 0.72, -0.6, 0.35);
    lights.head.push(box(body, 0.16, 0.14, 0.06, M.headOff(), 0, 0.88, -0.66));
    lights.brake.push(box(body, 0.12, 0.08, 0.05, M.brakeOff(), 0, 0.82, 0.62));
    rider(body, SHIRT_COLORS[variant % SHIRT_COLORS.length], 0, 0.86, 0.22, variant % 5 === 0);
    if (variant % 4 === 1) rider(body, SHIRT_COLORS[(variant + 3) % SHIRT_COLORS.length], 0, 0.9, 0.62, false);
    attachHeadlightPool(body, lights, -0.66, 2.8, 8.5);
    return { root, body, wheels, wheelRadius: 0.3, lights };
  }

  // ---- W-11 decorated minibus --------------------------------------------------
  private minibus(variant: number, paintOverride?: string | number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const art = lambert('#ffffff', { map: truckArtTexture(variant) });
    const base = lambert(paintOverride ?? ['#1f7a4d', '#c2185b', '#1565c0', '#f9a825'][variant % 4]);
    const L = 8.6, W = 2.36;
    // Main body with art on the sides.
    box(body, W, 1.3, L, art, 0, 1.15, 0);
    box(body, W + 0.02, 0.18, L + 0.02, base, 0, 0.52, 0);
    // Window band.
    box(body, W - 0.04, 0.72, L - 0.6, M.glass(), 0, 2.15, 0.2);
    box(body, W + 0.02, 0.26, L, base, 0, 2.63, 0);
    // Chrome trims + front.
    box(body, W + 0.04, 0.06, L + 0.04, M.chrome(), 0, 1.82, 0);
    box(body, W - 0.1, 0.9, 0.06, M.glass(), 0, 2.1, -L / 2 - 0.01);
    box(body, W, 0.6, 0.1, M.chrome(), 0, 0.9, -L / 2 - 0.03);
    const board = new THREE.Mesh(boxGeo(1.4, 0.3, 0.04), lambert('#ffffff', { map: routeBoardTexture('W-11') }));
    board.position.set(0, 2.7, -L / 2 - 0.08);
    body.add(board);
    // Roof rack with luggage.
    box(body, W - 0.3, 0.08, L * 0.6, M.chrome(), 0, 2.82, -0.4);
    box(body, 0.9, 0.36, 1.2, lambert('#5d4037'), -0.3, 3.0, -1.2);
    box(body, 0.8, 0.3, 0.9, lambert('#1565c0'), 0.4, 2.98, 0.4);
    // Passengers hanging off the back door.
    rider(body, SHIRT_COLORS[(variant + 2) % 8], -W / 2 - 0.15, 1.3, L / 2 - 0.8, false);
    for (const sx of [-0.8, 0.8]) {
      lights.head.push(box(body, 0.3, 0.2, 0.06, M.headOff(), sx, 0.95, -L / 2 - 0.06));
      lights.brake.push(box(body, 0.22, 0.3, 0.06, M.brakeOff(), sx * 1.2, 1.0, L / 2 + 0.03));
      lights.hazard.push(box(body, 0.2, 0.14, 0.07, M.hazardOff(), sx * 1.32, 1.4, -L / 2 - 0.05));
      lights.hazard.push(box(body, 0.2, 0.14, 0.07, M.hazardOff(), sx * 1.32, 1.4, L / 2 + 0.05));
    }
    for (const z of [-2.9, 2.6]) for (const x of [-1.0, 1.0]) wheel(body, 0.45, 0.32, x, z, wheels);
    attachHeadlightPool(body, lights, -L / 2 - 0.06, 6.2, 14.5);
    return { root, body, wheels, wheelRadius: 0.45, lights };
  }

  // ---- Auto-rickshaw ---------------------------------------------------------------
  private rickshaw(variant: number, paintOverride?: string | number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const green = variant % 4 === 3;
    const paint = lambert(paintOverride ?? (green ? '#2e7d32' : '#f6c50f'));
    const canopy = lambert(green ? '#f6c50f' : '#141414');
    box(body, 1.36, 0.5, 2.6, paint, 0, 0.62, 0.1);
    // Tapered nose.
    add(body, boxGeo(0.8, 0.9, 0.6), paint, 0, 0.9, -1.25, 0.15);
    lights.head.push(box(body, 0.2, 0.18, 0.05, M.headOff(), 0, 1.18, -1.56));
    // Canopy frame + roof.
    for (const sx of [-0.64, 0.64]) {
      box(body, 0.05, 0.9, 0.05, M.black(), sx, 1.32, -0.75);
      box(body, 0.05, 0.9, 0.05, M.black(), sx, 1.32, 1.3);
      lights.brake.push(box(body, 0.14, 0.12, 0.05, M.brakeOff(), sx * 0.9, 0.7, 1.42));
    }
    box(body, 1.42, 0.12, 2.3, canopy, 0, 1.82, 0.25);
    box(body, 1.4, 0.7, 0.06, canopy, 0, 1.45, 1.38);
    box(body, 1.1, 0.5, 0.04, M.glass(), 0, 1.45, -0.78);
    // Fringe decoration.
    box(body, 1.44, 0.08, 0.04, lambert('#e53935'), 0, 1.73, -0.86);
    rider(body, SHIRT_COLORS[variant % 8], 0, 0.9, -0.35, false);
    box(body, 1.1, 0.3, 0.5, lambert('#7b1f1f'), 0, 0.98, 0.85);
    wheel(body, 0.26, 0.14, 0, -1.15, wheels);
    wheel(body, 0.26, 0.14, -0.62, 0.95, wheels);
    wheel(body, 0.26, 0.14, 0.62, 0.95, wheels);
    attachHeadlightPool(body, lights, -1.56, 4.0, 9.5);
    return { root, body, wheels, wheelRadius: 0.26, lights };
  }

  // ---- Donkey cart / push thela -------------------------------------------------
  private cart(variant: number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const wood = lambert('#8d5a2b');
    const darkWood = lambert('#5d3a1a');
    const donkey = variant % 2 === 0;
    // Bed.
    box(body, 1.3, 0.12, 2.0, wood, 0, 0.72, 0.5);
    for (const sx of [-0.62, 0.62]) box(body, 0.06, 0.25, 2.0, darkWood, sx, 0.88, 0.5);
    wheel(body, 0.48, 0.1, -0.72, 0.6, wheels);
    wheel(body, 0.48, 0.1, 0.72, 0.6, wheels);
    if (donkey) {
      const grey = lambert('#8e8a86');
      // Shafts.
      for (const sx of [-0.3, 0.3]) box(body, 0.06, 0.06, 1.6, darkWood, sx, 0.85, -1.0);
      box(body, 0.42, 0.5, 1.0, grey, 0, 0.95, -1.35);
      add(body, boxGeo(0.24, 0.5, 0.26), grey, 0, 1.3, -1.85, -0.5);
      box(body, 0.2, 0.22, 0.4, grey, 0, 1.38, -2.05);
      for (const sx of [-0.06, 0.06]) box(body, 0.05, 0.28, 0.05, grey, sx, 1.66, -1.9);
      for (const [x, z] of [[-0.14, -1.7], [0.14, -1.7], [-0.14, -1.0], [0.14, -1.0]] as const) box(body, 0.1, 0.62, 0.1, grey, x, 0.36, z);
      rider(body, SHIRT_COLORS[variant % 8], 0, 0.9, 0.0, false);
      // Load: sacks.
      box(body, 0.9, 0.4, 0.8, lambert('#d7c7a0'), 0, 1.0, 0.9);
    } else {
      // Fruit thela pushed from behind.
      const fruit = [lambert('#f57c00'), lambert('#c62828'), lambert('#fbc02d'), lambert('#7cb342')];
      for (let i = 0; i < 12; i++) {
        add(body, sphereGeo(0.17, 5), fruit[(i + variant) % 4], -0.4 + (i % 3) * 0.4, 0.9 + Math.floor(i / 6) * 0.15, -0.2 + (Math.floor(i / 3) % 4) * 0.45);
      }
      box(body, 0.06, 0.06, 0.8, darkWood, -0.5, 0.95, 1.8);
      box(body, 0.06, 0.06, 0.8, darkWood, 0.5, 0.95, 1.8);
      // Pusher standing (no seat offset).
      const g = new THREE.Group();
      g.position.set(0, 0.55, 2.25);
      body.add(g);
      rider(g, SHIRT_COLORS[(variant + 1) % 8], 0, 0, 0, false);
    }
    return { root, body, wheels, wheelRadius: 0.48, lights };
  }

  // ---- Bedford truck with truck-art --------------------------------------------
  private truck(variant: number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const art = lambert('#ffffff', { map: truckArtTexture(variant + 4) });
    const cab = lambert(['#1565c0', '#c62828', '#2e7d32', '#ef6c00'][variant % 4]);
    const wood = lambert('#a0522d');
    // Cab (rounded Bedford nose).
    box(body, 2.2, 1.1, 1.6, cab, 0, 1.25, -3.1);
    box(body, 2.0, 0.9, 1.0, cab, 0, 1.1, -4.0);
    box(body, 2.1, 0.7, 0.06, M.glass(), 0, 2.0, -3.92);
    box(body, 2.2, 0.8, 1.6, cab, 0, 2.15, -3.1);
    // Ornate "taj" crown above the cab.
    const crown = new THREE.Mesh(boxGeo(2.4, 1.1, 0.25), art);
    crown.position.set(0, 3.05, -3.85);
    crown.rotation.x = -0.2;
    body.add(crown);
    box(body, 1.9, 0.8, 0.06, art, 0, 1.15, -4.52);
    // Cargo body with art panels.
    box(body, 2.5, 1.6, 5.4, art, 0, 2.05, 0.95);
    box(body, 2.52, 0.12, 5.42, wood, 0, 1.2, 0.95);
    box(body, 2.4, 0.5, 5.2, lambert('#d7c7a0'), 0, 3.05, 1.0);
    // Chain/bumper dangles.
    box(body, 2.3, 0.14, 0.12, M.chrome(), 0, 0.62, -4.55);
    for (const sx of [-0.75, 0.75]) {
      lights.head.push(box(body, 0.26, 0.22, 0.06, M.headOff(), sx, 0.95, -4.53));
      lights.brake.push(box(body, 0.22, 0.22, 0.06, M.brakeOff(), sx * 1.4, 1.0, 3.67));
      lights.hazard.push(box(body, 0.16, 0.12, 0.06, M.hazardOff(), sx * 1.4, 1.35, -4.53));
    }
    for (const z of [-3.6, 1.2, 2.6]) for (const x of [-1.0, 1.0]) wheel(body, 0.5, 0.36, x, z, wheels);
    attachHeadlightPool(body, lights, -4.53, 6.4, 15);
    return { root, body, wheels, wheelRadius: 0.5, lights };
  }
}

let blobMat: THREE.MeshBasicMaterial | null = null;
/** Soft dark blob under a vehicle so it sits on the road (sized from the mesh's footprint). */
function addContactShadow(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  blobMat ??= new THREE.MeshBasicMaterial({
    color: '#000000',
    alphaMap: contactShadowTexture(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const w = box.max.x - box.min.x, l = box.max.z - box.min.z;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.25 + 0.3, l * 1.15 + 0.4).rotateX(-Math.PI / 2), blobMat);
  m.position.set((box.min.x + box.max.x) / 2, 0.03, (box.min.z + box.max.z) / 2);
  m.renderOrder = 1;
  m.name = 'contactShadow';
  root.add(m);
}
