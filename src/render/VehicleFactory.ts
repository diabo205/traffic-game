import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NpcKind } from '../sim/types';
import { routeBoardTexture, truckArtTexture } from './textures';

/**
 * Builds low-poly procedural vehicles.
 *
 * Model convention: front faces local -Z, right is +X, wheels sit on y = 0.
 * Every model is wrapped as root (position + yaw) -> body (roll/pitch/bump).
 *
 * The factory is async (`preload`) so .glb assets can replace the procedural
 * prototypes later: load them in preload(), then return clones from create().
 * Gameplay never depends on mesh geometry — collision sizes live in src/sim/.
 */

export type VisualKind = NpcKind | 'alto' | 'police';

export interface VehicleVisual {
  kind: VisualKind;
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  setBrake(on: boolean): void;
  setHazard(on: boolean): void;
  /** 0 = off, 1 = normal, 2 = flash (dipper) */
  setHeadlights(level: number): void;
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
};

const SHIRT_COLORS = ['#e9e4d4', '#3a6ea5', '#6b8e23', '#b5651d', '#7a7a7a', '#2f4f4f', '#c2b280', '#8b0000'];
const CAR_COLORS = ['#f2f2f2', '#c9ccd1', '#1f1f22', '#7a1d24', '#2c4a7a', '#d8d2c0', '#5b6168', '#f2f2f2'];

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
}

interface Proto {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  lights: Lights;
}

const LIGHT_NAMES = ['brake', 'hazard', 'head'] as const;

/** Merge a list of meshes into one mesh in `body` space. */
function mergeMeshes(body: THREE.Object3D, meshes: THREE.Mesh[], material: THREE.Material, name: string): THREE.Mesh | null {
  if (meshes.length === 0) return null;
  const inv = body.matrixWorld.clone().invert();
  const geos = meshes.map((m) => {
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    return g;
  });
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
    if (o === lights.beam || (keepWheels && wheelSet.has(o))) return;
    remove.push(o);
  });
  for (const o of remove) body.remove(o);
  if (lights.beam) lights.beam.name = 'beam';
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
  const wheels = body.children.filter((c) => c.name === 'wheel');
  let brake = false, hazard = false, head = -1;
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
    setHeadlights(level) {
      if (level === head) return;
      head = level;
      if (headMesh) headMesh.material = level > 0 ? M.headOn() : M.headOff();
      if (beam) beam.visible = level >= 2;
    },
  };
}

export class VehicleFactory {
  private beamMaterial: THREE.MeshBasicMaterial | null = null;

  /** Load / build any assets up front. Swap in GLTFLoader here later. */
  async preload(): Promise<void> {
    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: '#fff7d6',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // Warm the texture caches so first spawns don't hitch.
    for (let i = 0; i < 4; i++) truckArtTexture(i);
    routeBoardTexture('W-11');
  }

  private protos = new Map<string, Proto>();

  create(kind: VisualKind, variant: number): VehicleVisual {
    const key = `${kind}:${variant}`;
    let proto = this.protos.get(key);
    if (!proto) {
      proto = this.build(kind, variant);
      finalize(proto, kind === 'alto');
      this.protos.set(key, proto);
    }
    const v = bind(kind, proto.root.clone(true), proto.wheelRadius);
    if (kind === 'alto') v.setHeadlights(1);
    return v;
  }

  private build(kind: VisualKind, variant: number): Proto {
    switch (kind) {
      case 'alto': return this.alto();
      case 'car': return this.car(variant);
      case 'bike': return this.bike(variant);
      case 'minibus': return this.minibus(variant);
      case 'rickshaw': return this.rickshaw(variant);
      case 'cart': return this.cart(variant);
      case 'truck': return this.truck(variant);
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

  // ---- Suzuki Alto (player) -------------------------------------------------
  private alto(): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const paint = lambert('#e8eaec');
    const lights: Lights = { brake: [], hazard: [], head: [] };
    // Lower body + bumpers.
    box(body, 1.48, 0.56, 3.38, paint, 0, 0.6, 0);
    box(body, 1.5, 0.2, 0.18, M.darkGrey(), 0, 0.42, -1.69);
    box(body, 1.5, 0.22, 0.18, M.darkGrey(), 0, 0.42, 1.69);
    // Short sloping bonnet.
    add(body, boxGeo(1.4, 0.16, 0.8), paint, 0, 0.92, -1.22, -0.18);
    // Cabin: tall hatchback glasshouse.
    box(body, 1.34, 0.58, 2.05, M.glass(), 0, 1.16, 0.28);
    box(body, 1.38, 0.08, 1.85, paint, 0, 1.48, 0.35);
    // Pillars.
    for (const sx of [-0.66, 0.66]) {
      box(body, 0.06, 0.58, 0.1, paint, sx, 1.16, -0.7);
      box(body, 0.06, 0.58, 0.12, paint, sx, 1.16, 0.25);
      box(body, 0.06, 0.58, 0.14, paint, sx, 1.16, 1.24);
    }
    // Grille + headlights.
    box(body, 0.7, 0.12, 0.04, M.black(), 0, 0.72, -1.7);
    for (const sx of [-0.52, 0.52]) {
      lights.head.push(box(body, 0.34, 0.16, 0.05, M.headOff(), sx, 0.76, -1.7));
      lights.brake.push(box(body, 0.2, 0.3, 0.05, M.brakeOff(), sx * 1.25, 0.84, 1.7));
      lights.hazard.push(box(body, 0.12, 0.08, 0.05, M.hazardOff(), sx * 1.05, 0.62, -1.71));
      // Mirrors.
      box(body, 0.14, 0.1, 0.06, paint, sx * 1.48, 1.0, -0.62);
    }
    box(body, 0.42, 0.13, 0.03, M.plate(), 0, 0.5, 1.79);
    box(body, 0.42, 0.13, 0.03, M.plate(), 0, 0.5, -1.79);
    // Wheels.
    for (const [x, z] of [[-0.66, -1.1], [0.66, -1.1], [-0.66, 1.1], [0.66, 1.1]] as const) wheel(body, 0.29, 0.2, x, z, wheels);
    // Dipper flash beam (visible only when flashing).
    if (this.beamMaterial) {
      const beamGeo = new THREE.ConeGeometry(2.2, 14, 12, 1, true);
      beamGeo.translate(0, -7, 0);
      beamGeo.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(beamGeo, this.beamMaterial);
      beam.position.set(0, 0.76, -1.75);
      beam.visible = false;
      beam.castShadow = false;
      body.add(beam);
      lights.beam = beam;
    }
    return { root, body, wheels, wheelRadius: 0.29, lights };
  }

  // ---- Generic sedan ---------------------------------------------------------
  private car(variant: number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const taxi = variant === 7;
    const paint = lambert(taxi ? '#f2c200' : CAR_COLORS[variant % CAR_COLORS.length]);
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
    return { root, body, wheels, wheelRadius: 0.3, lights };
  }

  // ---- W-11 decorated minibus --------------------------------------------------
  private minibus(variant: number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const art = lambert('#ffffff', { map: truckArtTexture(variant) });
    const base = lambert(['#1f7a4d', '#c2185b', '#1565c0', '#f9a825'][variant % 4]);
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
    return { root, body, wheels, wheelRadius: 0.45, lights };
  }

  // ---- Auto-rickshaw ---------------------------------------------------------------
  private rickshaw(variant: number): Proto {
    const { root, body } = this.shell();
    const wheels: THREE.Object3D[] = [];
    const lights: Lights = { brake: [], hazard: [], head: [] };
    const green = variant % 4 === 3;
    const paint = lambert(green ? '#2e7d32' : '#f6c50f');
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
    return { root, body, wheels, wheelRadius: 0.5, lights };
  }
}
