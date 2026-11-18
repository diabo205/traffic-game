/**
 * Generates binary glTF (.glb) vehicle models into public/models/ using Three.js
 * geometry builders + GLTFExporter, matching the exact conventions of tools/blender/*.py
 * and src/render/VehicleFactory.ts:
 *   - Front faces local -Z, right is +X, +Y is up, wheels rest on y = 0
 *   - Direct child node names: head_*, brake_*, hazard_*, wheel_*
 *   - Named MeshStandardMaterials: paint, art_side, art_top, art_rear, art_screen, etc.
 *
 * Run: node tools/build_models.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Lightweight FileReader polyfill for Node 24 so GLTFExporter can emit binary .glb buffers.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    result = null;
    onload = null;
    onloadend = null;
    onerror = null;
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(
        (buf) => {
          this.result = buf;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        },
        (err) => this.onerror?.(err),
      );
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then(
        (buf) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        },
        (err) => this.onerror?.(err),
      );
    }
  };
}

const OUT_DIR = path.resolve(process.cwd(), 'public/models');
fs.mkdirSync(OUT_DIR, { recursive: true });

function stdMat(name, hex, roughness = 0.5, metalness = 0.0) {
  return new THREE.MeshStandardMaterial({ name, color: new THREE.Color(hex), roughness, metalness });
}

const MATS = () => ({
  paint: stdMat('paint', '#d6dde2', 0.32, 0.15),
  glass: stdMat('glass', '#28363f', 0.08, 0.1),
  trim: stdMat('trim', '#18191b', 0.72, 0.05),
  chrome: stdMat('chrome', '#d8dcdf', 0.22, 0.85),
  tyre: stdMat('tyre', '#1f1f21', 0.9, 0.0),
  rim: stdMat('rim', '#b9bec3', 0.35, 0.65),
  head: stdMat('head', '#eef0e6', 0.15, 0.0),
  brake: stdMat('brake', '#8a1a1a', 0.3, 0.0),
  hazard: stdMat('hazard', '#d0861a', 0.3, 0.0),
  seat: stdMat('seat', '#241c1a', 0.65, 0.0),
  wood: stdMat('wood', '#8d5a2b', 0.82, 0.0),
  woodDark: stdMat('woodDark', '#553418', 0.85, 0.0),
  steel: stdMat('steel', '#60666d', 0.45, 0.55),
  plate: stdMat('plate', '#f2efe4', 0.45, 0.0),
  artSide: stdMat('art_side', '#d0a040', 0.55, 0.0),
  artTop: stdMat('art_top', '#c04040', 0.55, 0.0),
  artRear: stdMat('art_rear', '#40a0a0', 0.55, 0.0),
  artScreen: stdMat('art_screen', '#a03030', 0.45, 0.0),
  tarp: stdMat('tarp', '#d4c39c', 0.88, 0.0),
});

function ensureUv(geo) {
  if (!geo.getAttribute('uv')) {
    const count = geo.getAttribute('position').count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  return geo;
}

function addMesh(parent, name, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  ensureUv(geo);
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function addBox(parent, name, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return addMesh(parent, name, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
}

/** Add a rounded bar from 3D point a to point b (with radius r). */
function addBar(parent, name, a, b, r, mat, radialSegs = 8) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(vb, va);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r, r, len, radialSegs);
  const m = new THREE.Mesh(ensureUv(geo), mat);
  m.name = name;
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

function newVehicleRoot() {
  return new THREE.Scene();
}

/** Single-mesh spoked or alloy wheel centered at (x, r, z) so spin around X works cleanly. */
function makeWheel(parent, name, x, r, z, w, M, opts = {}) {
  const { spokes = 6, spoked = false, tyreGeoOnly = false } = opts;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, r, z);

  const sgn = x >= 0 ? 1 : -1;
  const tyre = new THREE.Mesh(ensureUv(new THREE.CylinderGeometry(r, r, w, 12)), M.tyre);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);

  if (spoked) {
    const rimMat = opts.rimMat ?? M.rim;
    const hub = new THREE.Mesh(ensureUv(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.02, 8)), M.trim);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);

    const ringGeo = new THREE.TorusGeometry(r * 0.72, r * 0.075, 5, 12);
    ringGeo.rotateY(Math.PI / 2);
    const ring = new THREE.Mesh(ensureUv(ringGeo), rimMat);
    ring.position.x = sgn * 0.004;
    g.add(ring);

    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const spokeGeo = new THREE.CylinderGeometry(0.012, 0.012, r * 1.38, 4);
      const sp = new THREE.Mesh(ensureUv(spokeGeo), rimMat);
      sp.rotation.x = a;
      sp.position.x = sgn * (w * 0.1);
      g.add(sp);
    }
  } else {
    const rim = new THREE.Mesh(ensureUv(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.014, 10)), M.rim);
    rim.rotation.z = Math.PI / 2;
    g.add(rim);
    if (!tyreGeoOnly) {
      const cap = new THREE.Mesh(ensureUv(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.026, 6)), M.trim);
      cap.rotation.z = Math.PI / 2;
      g.add(cap);
    }
  }
  parent.add(g);
  return g;
}

/** Flat panel facing an outward direction (+X, -X, +Z, -Z) with exact 0..1 UVs. */
function addArtPlane(parent, name, cx, cy, cz, width, height, facing, mat, lift = 0.008) {
  const nMap = {
    '+x': new THREE.Vector3(1, 0, 0),
    '-x': new THREE.Vector3(-1, 0, 0),
    '-z': new THREE.Vector3(0, 0, -1),
    '+z': new THREE.Vector3(0, 0, 1),
  };
  const n = nMap[facing];
  const up = new THREE.Vector3(0, 1, 0);
  // As viewed from outside looking along -n, viewer right is up x n
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  const c = new THREE.Vector3(cx, cy, cz).addScaledVector(n, lift);
  const hw = width / 2;
  const hh = height / 2;
  const p0 = c.clone().addScaledVector(right, -hw).addScaledVector(up, -hh);
  const p1 = c.clone().addScaledVector(right, hw).addScaledVector(up, -hh);
  const p2 = c.clone().addScaledVector(right, hw).addScaledVector(up, hh);
  const p3 = c.clone().addScaledVector(right, -hw).addScaledVector(up, hh);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z], 3),
  );
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return addMesh(parent, name, geo, mat);
}

// ---------------------------------------------------------------------------
// 1. Honda CD-70 Motorbike (bike.glb) — R=0.30, wheelbase -0.68..+0.68
// ---------------------------------------------------------------------------
function buildBike() {
  const root = newVehicleRoot();
  const M = MATS();
  const R = 0.30;

  makeWheel(root, 'wheel_F', 0, R, -0.68, 0.09, M, { spoked: true, spokes: 8 });
  makeWheel(root, 'wheel_R', 0, R, 0.68, 0.11, M, { spoked: true, spokes: 8 });

  // Spine & cradle frame + swingarm
  addBar(root, 'frame_top', [0, 0.72, -0.45], [0, 0.66, 0.38], 0.025, M.trim);
  addBar(root, 'frame_down', [0, 0.68, -0.46], [0, 0.36, -0.14], 0.024, M.trim);
  addBar(root, 'frame_rear_L', [-0.07, 0.66, 0.32], [-0.08, 0.30, 0.68], 0.02, M.chrome);
  addBar(root, 'frame_rear_R', [0.07, 0.66, 0.32], [0.08, 0.30, 0.68], 0.02, M.chrome);
  addBar(root, 'swing_L', [-0.08, 0.33, 0.10], [-0.08, 0.30, 0.68], 0.022, M.trim);
  addBar(root, 'swing_R', [0.08, 0.33, 0.10], [0.08, 0.30, 0.68], 0.022, M.trim);

  // Front forks, triple clamp, wide swept chrome handlebars & grips
  for (const sx of [-1, 1]) {
    addBar(root, `fork_${sx}`, [sx * 0.085, 0.30, -0.68], [sx * 0.085, 0.88, -0.45], 0.022, M.chrome);
    addBar(root, `bar_half_${sx}`, [sx * 0.08, 0.90, -0.46], [sx * 0.32, 0.97, -0.34], 0.014, M.chrome);
    addBar(root, `grip_${sx}`, [sx * 0.24, 0.95, -0.37], [sx * 0.34, 0.975, -0.33], 0.02, M.trim);
    addBar(root, `mirror_arm_${sx}`, [sx * 0.22, 0.95, -0.38], [sx * 0.28, 1.12, -0.40], 0.008, M.trim);
    addBox(root, `mirror_${sx}`, 0.09, 0.06, 0.025, M.trim, sx * 0.29, 1.14, -0.40, 0, sx * 0.2, 0);
  }
  addBox(root, 'crown', 0.22, 0.04, 0.08, M.steel, 0, 0.87, -0.45);
  addMesh(root, 'speedo', new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), M.trim, 0, 0.94, -0.49, 0.5, 0, 0);

  // Curved mudguards (partial cylinders arched over wheels)
  const fGuard = new THREE.CylinderGeometry(R + 0.05, R + 0.05, 0.13, 12, 1, true, -Math.PI * 0.35, Math.PI * 0.7);
  fGuard.rotateZ(Math.PI / 2);
  addMesh(root, 'fender_f', fGuard, M.chrome, 0, R, -0.68);
  const rGuard = new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.14, 12, 1, true, Math.PI * 0.05, Math.PI * 0.6);
  rGuard.rotateZ(Math.PI / 2);
  addMesh(root, 'fender_r', rGuard, M.chrome, 0, R + 0.08, 0.62);

  // Teardrop CD-70 fuel tank + painted side panels
  const tankShape = new THREE.Shape();
  tankShape.moveTo(-0.24, 0.0);
  tankShape.quadraticCurveTo(-0.26, 0.17, -0.06, 0.21);
  tankShape.quadraticCurveTo(0.20, 0.22, 0.24, 0.04);
  tankShape.lineTo(0.22, -0.02);
  tankShape.lineTo(-0.22, -0.02);
  tankShape.closePath();
  const tankGeo = new THREE.ExtrudeGeometry(tankShape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.035,
    bevelSegments: 2,
  });
  tankGeo.rotateY(Math.PI / 2);
  tankGeo.translate(-0.11, 0.70, -0.18);
  addMesh(root, 'tank', tankGeo, M.paint);
  // Decorative side covers & silver tank stripe
  addBox(root, 'side_cov', 0.26, 0.16, 0.22, M.paint, 0, 0.57, 0.14);
  addBox(root, 'tank_stripe', 0.30, 0.035, 0.34, M.plate, 0, 0.78, -0.18);

  // Ribbed bench seat
  addBox(root, 'seat', 0.24, 0.10, 0.58, M.seat, 0, 0.75, 0.34, -0.03, 0, 0);
  addBox(root, 'grab_rail', 0.26, 0.025, 0.12, M.chrome, 0, 0.77, 0.68);

  // Air-cooled finned engine + crank + swept chrome silencer exhaust on right side
  addBox(root, 'engine_crank', 0.28, 0.18, 0.28, M.chrome, 0, 0.38, -0.05);
  addBox(root, 'engine_cyl', 0.18, 0.18, 0.18, M.steel, 0, 0.51, -0.18, -0.3, 0, 0);
  addBar(root, 'exhaust_pipe', [0.12, 0.44, -0.22], [0.15, 0.24, 0.12], 0.02, M.chrome);
  addMesh(root, 'muffler', new THREE.CylinderGeometry(0.042, 0.034, 0.56, 10), M.chrome, 0.16, 0.27, 0.42, Math.PI / 2 - 0.08, 0, 0);

  // Chrome round headlamp bucket + glowing lens + indicators + tail lamp + number plate
  addMesh(root, 'lamp_cowl', new THREE.CylinderGeometry(0.088, 0.075, 0.12, 12), M.trim, 0, 0.86, -0.58, Math.PI / 2, 0, 0);
  addMesh(root, 'head_lamp', new THREE.CylinderGeometry(0.078, 0.078, 0.03, 12), M.head, 0, 0.86, -0.64, Math.PI / 2, 0, 0);
  addBox(root, 'brake_lamp', 0.12, 0.09, 0.05, M.brake, 0, 0.76, 0.80);
  addBox(root, 'plate_r', 0.16, 0.10, 0.02, M.plate, 0, 0.64, 0.83, -0.2, 0, 0);
  for (const sx of [-1, 1]) {
    addBox(root, `hazard_f${sx}`, 0.055, 0.045, 0.05, M.hazard, sx * 0.14, 0.85, -0.56);
    addBox(root, `hazard_r${sx}`, 0.05, 0.04, 0.04, M.hazard, sx * 0.12, 0.75, 0.78);
  }
  return root;
}

// ---------------------------------------------------------------------------
// 2. Pakistani Wooden Rehri / Cart Chassis (cart.glb) — R=0.48, wheels z=+0.55
// ---------------------------------------------------------------------------
function buildCart() {
  const root = newVehicleRoot();
  const M = MATS();
  const R = 0.48;

  makeWheel(root, 'wheel_L', -0.70, R, 0.52, 0.10, M, { spoked: true, spokes: 12, rimMat: M.woodDark });
  makeWheel(root, 'wheel_R', 0.70, R, 0.52, 0.10, M, { spoked: true, spokes: 12, rimMat: M.woodDark });

  // Solid axle beam
  addBar(root, 'axle', [-0.75, R, 0.52], [0.75, R, 0.52], 0.035, M.steel);

  // Planking deck + longitudinal stringers + crossbeams
  addBox(root, 'bed_main', 1.32, 0.09, 2.02, M.wood, 0, 0.70, 0.52);
  for (const sx of [-0.50, 0, 0.50]) {
    addBox(root, `stringer_${sx}`, 0.08, 0.09, 2.1, M.woodDark, sx, 0.62, 0.52);
  }

  // Carved slatted sideboards + corner posts + colorful painted trim stripe
  for (const sx of [-1, 1]) {
    addBox(root, `rail_top_${sx}`, 0.05, 0.07, 2.04, M.woodDark, sx * 0.635, 0.96, 0.52);
    addBox(root, `rail_band_${sx}`, 0.055, 0.08, 2.04, M.paint, sx * 0.635, 0.84, 0.52);
    for (const z of [-0.42, 0.05, 0.52, 0.99, 1.46]) {
      addBox(root, `post_${sx}_${z}`, 0.055, 0.28, 0.06, M.woodDark, sx * 0.635, 0.86, z);
    }
  }
  addBox(root, 'front_board', 1.32, 0.24, 0.06, M.woodDark, 0, 0.86, -0.46);
  addBox(root, 'rear_board', 1.32, 0.24, 0.06, M.paint, 0, 0.86, 1.50);

  // Hanging kerosene lantern under front right corner & rear red reflectors
  addBar(root, 'lantern_hook', [0.58, 0.68, -0.46], [0.58, 0.52, -0.46], 0.015, M.steel);
  addMesh(root, 'hazard_lantern', new THREE.CylinderGeometry(0.055, 0.07, 0.14, 8), M.hazard, 0.58, 0.44, -0.46);
  for (const sx of [-1, 1]) {
    addBox(root, `brake_${sx}`, 0.09, 0.07, 0.04, M.brake, sx * 0.54, 0.72, 1.54);
  }
  return root;
}

// ---------------------------------------------------------------------------
// 3. Karachi Sedan (Corolla / City style, car.glb) — R=0.32, L=4.40, W=1.74
// ---------------------------------------------------------------------------
function buildCar() {
  const root = newVehicleRoot();
  const M = MATS();
  const R = 0.32;

  makeWheel(root, 'wheel_FL', -0.78, R, -1.36, 0.21, M, { spokes: 5 });
  makeWheel(root, 'wheel_FR', 0.78, R, -1.36, 0.21, M, { spokes: 5 });
  makeWheel(root, 'wheel_RL', -0.78, R, 1.36, 0.21, M, { spokes: 5 });
  makeWheel(root, 'wheel_RR', 0.78, R, 1.36, 0.21, M, { spokes: 5 });

  // Sculpted beveled side-profile hull extruded along X
  const prof = [
    [-2.14, 0.30],
    [-2.18, 0.52],
    [-2.12, 0.70],
    [-1.12, 0.84],
    [-0.45, 1.35],
    [0.82, 1.35],
    [1.46, 0.89],
    [2.10, 0.83],
    [2.16, 0.64],
    [2.10, 0.32],
  ];
  const shape = new THREE.Shape();
  // Shape XZ mapped after rotateY(-Math.PI/2): shape +x -> world -z
  prof.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  const bevel = 0.08;
  const depth = 1.72 - bevel * 2;
  const shellGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  shellGeo.rotateY(Math.PI / 2);
  shellGeo.translate(-depth / 2, 0, 0);
  // Subtle tumblehome inward above belt line (y > 0.84) + nose plan taper near bumpers
  const pos = shellGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    if (py > 0.86) px *= 1 - Math.min(0.24, (py - 0.86) * 0.36);
    if (Math.abs(pz) > 1.85) px *= 1 - (Math.abs(pz) - 1.85) * 0.25;
    pos.setX(i, px);
  }
  shellGeo.computeVertexNormals();
  addMesh(root, 'body_shell', shellGeo, M.paint);

  // Dark wheel arch liners
  for (const sx of [-1, 1]) {
    for (const z of [-1.36, 1.36]) {
      const arch = new THREE.CircleGeometry(0.39, 12, 0, Math.PI);
      arch.rotateY((Math.PI / 2) * sx);
      addMesh(root, `arch_${sx}_${z}`, arch, M.trim, sx * 0.855, 0.30, z);
    }
  }

  // Front windscreen, rear glass & side greenhouse windows
  addBox(root, 'windscreen', 1.32, 0.03, 0.78, M.glass, 0, 1.11, -0.78, -0.62, 0, 0);
  addBox(root, 'rear_glass', 1.28, 0.03, 0.74, M.glass, 0, 1.13, 1.13, 0.56, 0, 0);
  for (const sx of [-1, 1]) {
    addBox(root, `side_win_${sx}`, 0.03, 0.41, 1.56, M.glass, sx * 0.73, 1.11, 0.24, 0, 0, sx * -0.26);
    addBox(root, `bpillar_${sx}`, 0.04, 0.43, 0.11, M.trim, sx * 0.735, 1.11, 0.18, 0, 0, sx * -0.26);
    // Wing mirrors & door handles
    addBox(root, `mirror_${sx}`, 0.16, 0.10, 0.09, M.paint, sx * 0.90, 0.90, -0.62);
    addBox(root, `handle_f_${sx}`, 0.03, 0.035, 0.15, M.chrome, sx * 0.865, 0.77, -0.15);
    addBox(root, `handle_r_${sx}`, 0.03, 0.035, 0.15, M.chrome, sx * 0.865, 0.78, 0.72);
  }

  // Grille, lower intake, bumpers, chrome boot strip & number plates
  addBox(root, 'grille', 0.82, 0.14, 0.06, M.trim, 0, 0.64, -2.23);
  addBox(root, 'grille_bar', 0.76, 0.03, 0.07, M.chrome, 0, 0.66, -2.235);
  addBox(root, 'intake', 1.18, 0.14, 0.05, M.trim, 0, 0.40, -2.23);
  addBox(root, 'bumper_f', 1.66, 0.12, 0.08, M.trim, 0, 0.34, -2.22);
  addBox(root, 'bumper_r', 1.68, 0.14, 0.08, M.trim, 0, 0.38, 2.21);
  addBox(root, 'boot_trim', 0.76, 0.04, 0.04, M.chrome, 0, 0.76, 2.22);
  addBox(root, 'plate_f', 0.40, 0.11, 0.03, M.plate, 0, 0.50, -2.24);
  addBox(root, 'plate_r', 0.40, 0.11, 0.03, M.plate, 0, 0.66, 2.22);

  // Swappable lights: head_*, brake_*, hazard_*
  for (const sx of [-1, 1]) {
    addBox(root, `head_${sx}`, 0.34, 0.13, 0.06, M.head, sx * 0.60, 0.64, -2.20, 0, sx * 0.16, 0);
    addBox(root, `hazard_f${sx}`, 0.10, 0.08, 0.06, M.hazard, sx * 0.77, 0.64, -2.14, 0, sx * 0.32, 0);
    addBox(root, `brake_${sx}`, 0.38, 0.14, 0.06, M.brake, sx * 0.62, 0.76, 2.18, 0, sx * -0.14, 0);
    addBox(root, `hazard_r${sx}`, 0.14, 0.07, 0.06, M.hazard, sx * 0.75, 0.66, 2.15, 0, sx * -0.25, 0);
  }
  return root;
}

// ---------------------------------------------------------------------------
// 4. Pakistani Bedford J6 Truck (truck.glb) — R=0.50, L=8.3m, W=2.52m
// ---------------------------------------------------------------------------
function buildTruck() {
  const root = newVehicleRoot();
  const M = MATS();
  const R = 0.50;

  // 6 wheels: steer axle + tandem rear axles
  makeWheel(root, 'wheel_FL', -1.04, R, -3.05, 0.34, M, { spokes: 6 });
  makeWheel(root, 'wheel_FR', 1.04, R, -3.05, 0.34, M, { spokes: 6 });
  makeWheel(root, 'wheel_ML', -1.04, R, 1.20, 0.38, M, { spokes: 6 });
  makeWheel(root, 'wheel_MR', 1.04, R, 1.20, 0.38, M, { spokes: 6 });
  makeWheel(root, 'wheel_RL', -1.04, R, 2.55, 0.38, M, { spokes: 6 });
  makeWheel(root, 'wheel_RR', 1.04, R, 2.55, 0.38, M, { spokes: 6 });

  // Chassis rails + fuel tank + steps
  addBox(root, 'chassis', 1.45, 0.24, 7.6, M.trim, 0, 0.72, -0.1);
  addMesh(root, 'fuel_tank', new THREE.CylinderGeometry(0.28, 0.28, 1.15, 10), M.chrome, -0.98, 0.68, -0.65, Math.PI / 2, 0, 0);
  addMesh(root, 'spare_wheel', new THREE.CylinderGeometry(0.45, 0.45, 0.26, 12), M.tyre, 0.92, 0.65, -0.55, 0, 0, Math.PI / 2);

  // Bulbous Bedford snub nose & fenders + cab shell
  addBox(root, 'cab_lower', 2.26, 0.85, 1.55, M.paint, 0, 1.22, -2.55);
  addBox(root, 'cab_upper', 2.22, 0.88, 1.48, M.paint, 0, 2.08, -2.52);
  addBox(root, 'bonnet', 1.52, 0.76, 1.15, M.paint, 0, 1.22, -3.72, 0.08, 0, 0);
  // Wide rounded nose brow & front fender cheeks
  addBox(root, 'fender_L', 0.44, 0.42, 1.20, M.paint, -0.94, 1.04, -3.65);
  addBox(root, 'fender_R', 0.44, 0.42, 1.20, M.paint, 0.94, 1.04, -3.65);

  // Split windscreen + painted sun-visor brow + art_screen top half
  addBox(root, 'windscreen_low', 1.88, 0.40, 0.05, M.glass, 0, 1.84, -3.28, -0.06, 0, 0);
  addArtPlane(root, 'art_screen', 0, 2.18, -3.30, 1.88, 0.34, '-z', M.artScreen, 0.01);
  addBox(root, 'cab_post_C', 0.07, 0.74, 0.07, M.chrome, 0, 1.98, -3.30);
  addBox(root, 'sun_visor', 2.28, 0.14, 0.26, M.chrome, 0, 2.48, -3.36, 0.22, 0, 0);

  // Door glass + wing mirrors + dual vertical exhaust stacks behind cab
  for (const sx of [-1, 1]) {
    addBox(root, `cab_glass_${sx}`, 0.04, 0.56, 1.02, M.glass, sx * 1.12, 2.06, -2.55);
    addBar(root, `mirror_arm_${sx}`, [sx * 1.11, 2.05, -3.12], [sx * 1.34, 2.12, -3.30], 0.02, M.chrome);
    addBox(root, `mirror_${sx}`, 0.06, 0.32, 0.16, M.trim, sx * 1.35, 2.02, -3.30);
    addMesh(root, `stack_${sx}`, new THREE.CylinderGeometry(0.055, 0.055, 2.45, 8), M.chrome, sx * 1.16, 1.92, -1.72);
  }

  // Front grille + chamak-patti chrome bumper + hanging decorative chain valance (jhanjhar)
  addBox(root, 'grille_bg', 1.30, 0.58, 0.06, M.trim, 0, 1.24, -4.30);
  for (let row = 0; row < 4; row++) {
    addBox(root, `grille_slat_${row}`, 1.24, 0.045, 0.08, M.chrome, 0, 1.06 + row * 0.12, -4.31);
  }
  addBox(root, 'bumper_f', 2.42, 0.24, 0.18, M.chrome, 0, 0.62, -4.34);
  for (let i = -5; i <= 5; i++) {
    addBox(root, `chain_${i + 5}`, 0.11, 0.16, 0.04, M.chrome, i * 0.20, 0.44, -4.40);
  }
  addBox(root, 'plate_f', 0.46, 0.13, 0.03, M.plate, 0, 0.62, -4.44);

  // Iconic arched Pakistani Taj crown atop the cab with UV art_top panel + finials
  const crownGeo = new THREE.CylinderGeometry(1.18, 1.18, 0.32, 16, 1, false, -Math.PI / 2, Math.PI);
  crownGeo.rotateX(Math.PI / 2);
  crownGeo.scale(1.0, 0.72, 1.0);
  addMesh(root, 'taj_crown', crownGeo, M.paint, 0, 2.52, -3.14);
  addArtPlane(root, 'art_top', 0, 2.94, -3.31, 1.96, 0.76, '-z', M.artTop, 0.01);
  for (const [fx, fy] of [[-0.95, 3.12], [-0.48, 3.36], [0, 3.48], [0.48, 3.36], [0.95, 3.12]]) {
    addMesh(root, `finial_${fx}`, new THREE.ConeGeometry(0.08, 0.32, 6), M.chrome, fx, fy, -3.14);
  }

  // Timber & steel cargo box + sideboards + high tarp load + UV'd truck art panels
  addBox(root, 'bed_floor', 2.48, 0.18, 5.56, M.woodDark, 0, 1.12, 1.12);
  addBox(root, 'bed_core', 2.42, 1.62, 5.44, M.wood, 0, 2.02, 1.12);
  // Domed canvas tarpaulin cargo load above the stakes
  const loadGeo = new THREE.CylinderGeometry(1.15, 1.24, 5.24, 12, 1, false, 0, Math.PI);
  loadGeo.rotateZ(Math.PI / 2);
  loadGeo.rotateY(Math.PI / 2);
  loadGeo.scale(1.0, 0.56, 1.0);
  addMesh(root, 'cargo_tarp', loadGeo, M.tarp, 0, 2.82, 1.12);

  // Full 0..1 UV-mapped art planes covering cargo sides & rear tailgate
  addArtPlane(root, 'art_side_L', -1.21, 2.02, 1.12, 5.32, 1.54, '-x', M.artSide, 0.015);
  addArtPlane(root, 'art_side_R', 1.21, 2.02, 1.12, 5.32, 1.54, '+x', M.artSide, 0.015);
  addArtPlane(root, 'art_rear', 0, 2.02, 3.84, 2.34, 1.54, '+z', M.artRear, 0.015);

  // Vertical side stake ribs + rear bumper + mudflaps
  for (const sx of [-1, 1]) {
    for (let kz = -1.2; kz <= 3.5; kz += 1.15) {
      addBox(root, `stake_${sx}_${kz.toFixed(1)}`, 0.05, 1.68, 0.08, M.chrome, sx * 1.24, 2.02, kz);
    }
    addBox(root, `flap_${sx}`, 0.42, 0.44, 0.03, M.trim, sx * 0.96, 0.42, 3.56);
  }
  addBox(root, 'bumper_r', 2.42, 0.18, 0.16, M.trim, 0, 0.80, 3.92);
  addBox(root, 'plate_r', 0.46, 0.13, 0.03, M.plate, 0, 0.92, 3.92);

  // Dual Bedford round headlamps, amber indicators, rear brake lights
  for (const sx of [-1, 1]) {
    addMesh(root, `lamp_ring_${sx}`, new THREE.CylinderGeometry(0.16, 0.16, 0.07, 12), M.chrome, sx * 0.92, 1.04, -4.27, Math.PI / 2, 0, 0);
    addMesh(root, `head_${sx}`, new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12), M.head, sx * 0.92, 1.04, -4.30, Math.PI / 2, 0, 0);
    addBox(root, `hazard_f${sx}`, 0.15, 0.10, 0.06, M.hazard, sx * 1.06, 1.30, -4.24);
    addBox(root, `brake_${sx}`, 0.24, 0.18, 0.06, M.brake, sx * 0.88, 0.98, 3.90);
    addBox(root, `hazard_r${sx}`, 0.16, 0.14, 0.06, M.hazard, sx * 1.08, 0.98, 3.90);
  }

  return root;
}

// ---------------------------------------------------------------------------
// 5. '65 Ford Mustang-inspired Coupe (coupe.glb) — R=0.33, L=4.44, W=1.74
// ---------------------------------------------------------------------------
function buildCoupe() {
  const root = newVehicleRoot();
  const M = MATS();
  M.paint = stdMat('paint', '#1e40af', 0.24, 0.35);
  M.stripe = stdMat('stripe', '#e8eef7', 0.28, 0.25);
  const R = 0.33;

  // 8-spoke alloy wheels resting flush on y = 0; slightly wider rear stance
  makeWheel(root, 'wheel_FL', -0.78, R, -1.36, 0.22, M, { spoked: true, spokes: 8 });
  makeWheel(root, 'wheel_FR', 0.78, R, -1.36, 0.22, M, { spoked: true, spokes: 8 });
  makeWheel(root, 'wheel_RL', -0.78, R, 1.36, 0.25, M, { spoked: true, spokes: 8 });
  makeWheel(root, 'wheel_RR', 0.78, R, 1.36, 0.25, M, { spoked: true, spokes: 8 });

  // Classic 3-box pony car profile: long flat muscular hood, crisp beltline, fast/notch roof, short rear deck + ducktail
  const prof = [
    [-2.14, 0.28],
    [-2.19, 0.50],
    [-2.14, 0.69],
    [-0.88, 0.80],
    [-0.36, 1.28],
    [0.68, 1.27],
    [1.34, 0.86],
    [2.12, 0.82],
    [2.16, 0.84],
    [2.16, 0.56],
    [2.10, 0.28],
  ];
  const shape = new THREE.Shape();
  prof.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  const bevel = 0.07;
  const depth = 1.72 - bevel * 2;
  const shellGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  shellGeo.rotateY(Math.PI / 2);
  shellGeo.translate(-depth / 2, 0, 0);
  const pos = shellGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    if (py > 0.80) px *= 1 - Math.min(0.22, (py - 0.80) * 0.34);
    if (Math.abs(pz) > 1.88) px *= 1 - (Math.abs(pz) - 1.88) * 0.20;
    pos.setX(i, px);
  }
  shellGeo.computeVertexNormals();
  addMesh(root, 'body_shell', shellGeo, M.paint);

  // Dark underbody sill & flared wheel arches
  addBox(root, 'underbody', 1.56, 0.08, 4.10, M.trim, 0, 0.24, 0);
  for (const sx of [-1, 1]) {
    for (const z of [-1.36, 1.36]) {
      const arch = new THREE.CircleGeometry(0.41, 12, 0, Math.PI);
      arch.rotateY((Math.PI / 2) * sx);
      addMesh(root, `arch_${sx}_${z}`, arch, M.trim, sx * 0.855, 0.32, z);
      const lipGeo = new THREE.TorusGeometry(0.41, 0.032, 6, 14, Math.PI);
      lipGeo.rotateY(Math.PI / 2);
      addMesh(root, `arch_lip_${sx}_${z}`, lipGeo, M.paint, sx * 0.845, 0.32, z);
    }
  }

  // Hood power bulge & front intake + twin racing stripes (hood, roof, rear deck + side rocker)
  addBox(root, 'hood_bulge', 0.56, 0.045, 1.05, M.paint, 0, 0.77, -1.48);
  addBox(root, 'hood_scoop', 0.44, 0.025, 0.06, M.trim, 0, 0.785, -2.00);
  for (const sx of [-1, 1]) {
    addBox(root, `stripe_hood_${sx}`, 0.14, 0.015, 1.24, M.stripe, sx * 0.15, 0.798, -1.52, 0.08, 0, 0);
    addBox(root, `stripe_roof_${sx}`, 0.14, 0.015, 1.02, M.stripe, sx * 0.15, 1.355, 0.16);
    addBox(root, `stripe_deck_${sx}`, 0.14, 0.015, 0.76, M.stripe, sx * 0.15, 0.892, 1.74, -0.05, 0, 0);
    addBox(root, `stripe_rocker_${sx}`, 0.025, 0.055, 2.04, M.stripe, sx * 0.865, 0.32, 0);
  }

  // Greenhouse: raked windscreen, rear fastback glass, side windows, pillars, chrome trim, mirrors & C-scoops
  addBox(root, 'windscreen', 1.28, 0.03, 0.72, M.glass, 0, 1.09, -0.62, -0.74, 0, 0);
  addBox(root, 'rear_glass', 1.22, 0.03, 0.78, M.glass, 0, 1.11, 1.02, 0.54, 0, 0);
  for (const sx of [-1, 1]) {
    addBox(root, `side_win_${sx}`, 0.03, 0.36, 1.26, M.glass, sx * 0.71, 1.08, 0.18, 0, 0, sx * -0.24);
    addBox(root, `bpillar_${sx}`, 0.04, 0.38, 0.08, M.trim, sx * 0.715, 1.08, 0.14, 0, 0, sx * -0.24);
    addBox(root, `win_trim_${sx}`, 0.025, 0.028, 1.30, M.chrome, sx * 0.735, 0.88, 0.18);
    addBox(root, `mirror_${sx}`, 0.15, 0.085, 0.08, M.chrome, sx * 0.89, 0.88, -0.56);
    addBox(root, `handle_${sx}`, 0.03, 0.03, 0.14, M.chrome, sx * 0.865, 0.75, 0.10);
    // Signature '65 Mustang side C-scoop & chrome louver bars
    addBox(root, `cscoop_${sx}`, 0.035, 0.22, 0.42, M.trim, sx * 0.865, 0.58, 0.86);
    for (let j = -1; j <= 1; j++) {
      addBox(root, `cscoop_bar_${sx}_${j + 1}`, 0.045, 0.024, 0.26, M.chrome, sx * 0.868, 0.58 + j * 0.06, 0.86);
    }
  }

  // Front fascia: recessed honeycomb grille, chrome surround, Mustang pony bar, full-width chrome bumpers
  addBox(root, 'grille', 0.96, 0.22, 0.06, M.trim, 0, 0.61, -2.20);
  addBox(root, 'grille_top', 1.02, 0.03, 0.075, M.chrome, 0, 0.72, -2.205);
  addBox(root, 'grille_bot', 1.02, 0.03, 0.075, M.chrome, 0, 0.50, -2.205);
  addBox(root, 'grille_emblem', 0.28, 0.035, 0.08, M.chrome, 0, 0.61, -2.21);
  addBox(root, 'bumper_f', 1.70, 0.11, 0.09, M.chrome, 0, 0.35, -2.24);
  addBox(root, 'bumper_r', 1.70, 0.11, 0.09, M.chrome, 0, 0.38, 2.23);
  addBox(root, 'plate_f', 0.38, 0.10, 0.025, M.plate, 0, 0.35, -2.29);
  addBox(root, 'plate_r', 0.38, 0.10, 0.025, M.plate, 0, 0.52, 2.21);

  // Dual chrome exhaust tips (driver side -0.54 aligns with FLAME_POS.coupe)
  for (const sx of [-1, 1]) {
    addMesh(root, `exhaust_${sx}`, new THREE.CylinderGeometry(0.042, 0.042, 0.16, 10), M.chrome, sx * 0.54, 0.25, 2.22, Math.PI / 2, 0, 0);
  }

  // Direct child light meshes: head_* added first, then hazard_*, brake_*
  for (const sx of [-1, 1]) {
    addMesh(root, `head_bezel_${sx}`, new THREE.CylinderGeometry(0.135, 0.135, 0.06, 12), M.chrome, sx * 0.66, 0.64, -2.18, Math.PI / 2, 0, 0);
    addMesh(root, `head_${sx}`, new THREE.CylinderGeometry(0.11, 0.11, 0.04, 12), M.head, sx * 0.66, 0.64, -2.20, Math.PI / 2, 0, 0);
  }
  for (const sx of [-1, 1]) {
    addBox(root, `hazard_f${sx}`, 0.14, 0.065, 0.05, M.hazard, sx * 0.62, 0.44, -2.20);
    addBox(root, `brake_${sx}`, 0.30, 0.12, 0.06, M.brake, sx * 0.60, 0.68, 2.18);
    addBox(root, `tail_div_a_${sx}`, 0.025, 0.13, 0.07, M.chrome, sx * 0.60 - 0.05, 0.68, 2.185);
    addBox(root, `tail_div_b_${sx}`, 0.025, 0.13, 0.07, M.chrome, sx * 0.60 + 0.05, 0.68, 2.185);
    addBox(root, `hazard_r${sx}`, 0.10, 0.09, 0.06, M.hazard, sx * 0.79, 0.68, 2.16);
  }

  return root;
}

// ---------------------------------------------------------------------------
// 6. Toyota Hilux 4x4 Double-Cab Pickup / SUV (suv.glb) — R=0.42, L=5.06, W=1.90
// ---------------------------------------------------------------------------
function buildSuv() {
  const root = newVehicleRoot();
  const M = MATS();
  M.paint = stdMat('paint', '#c27b2b', 0.36, 0.18);
  const R = 0.42;

  // Rugged 6-spoke all-terrain wheels on y = 0, wheelbase 3.04m
  makeWheel(root, 'wheel_FL', -0.82, R, -1.52, 0.28, M, { spoked: true, spokes: 6 });
  makeWheel(root, 'wheel_FR', 0.82, R, -1.52, 0.28, M, { spoked: true, spokes: 6 });
  makeWheel(root, 'wheel_RL', -0.82, R, 1.52, 0.28, M, { spoked: true, spokes: 6 });
  makeWheel(root, 'wheel_RR', 0.82, R, 1.52, 0.28, M, { spoked: true, spokes: 6 });

  // Lifted ladder chassis, steel front skid plate & side nerf steps
  addBox(root, 'chassis', 1.30, 0.18, 4.65, M.trim, 0, 0.44, 0);
  addBox(root, 'skid_plate', 0.96, 0.06, 0.56, M.steel, 0, 0.38, -2.30, -0.35, 0, 0);
  for (const sx of [-1, 1]) {
    addBox(root, `step_${sx}`, 0.14, 0.06, 1.65, M.trim, sx * 0.92, 0.39, -0.14);
  }

  // Sculpted double-cab body: tall hood, upright cab, pickup bed side walls
  const cabProf = [
    [-2.42, 0.54],
    [-2.45, 0.88],
    [-2.38, 1.18],
    [-0.95, 1.24],
    [-0.48, 1.80],
    [0.68, 1.80],
    [0.74, 1.22],
    [2.38, 1.20],
    [2.42, 0.86],
    [2.38, 0.54],
  ];
  const shape = new THREE.Shape();
  cabProf.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  const bevel = 0.07;
  const depth = 1.84 - bevel * 2;
  const shellGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  shellGeo.rotateY(Math.PI / 2);
  shellGeo.translate(-depth / 2, 0, 0);
  const pos = shellGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    if (py > 1.26) px *= 1 - Math.min(0.14, (py - 1.26) * 0.22);
    if (pz < -2.15) px *= 1 - (-2.15 - pz) * 0.18;
    pos.setX(i, px);
  }
  shellGeo.computeVertexNormals();
  addMesh(root, 'body_shell', shellGeo, M.paint);

  // Open pickup bed liner recess + tailgate trim
  addBox(root, 'bedliner', 1.44, 0.08, 1.56, M.trim, 0, 1.23, 1.55);
  addBox(root, 'bed_cap_L', 0.12, 0.04, 1.62, M.trim, -0.82, 1.24, 1.55);
  addBox(root, 'bed_cap_R', 0.12, 0.04, 1.62, M.trim, 0.82, 1.24, 1.55);
  addBox(root, 'bed_cap_R_tail', 1.64, 0.05, 0.09, M.trim, 0, 1.23, 2.38);

  // Hood intercooler scoop
  addBox(root, 'hood_scoop', 0.54, 0.08, 0.48, M.paint, 0, 1.24, -1.65);
  addBox(root, 'hood_intake', 0.42, 0.04, 0.05, M.trim, 0, 1.24, -1.89);

  // Chunky matte black fender flares & wheel well liners
  for (const sx of [-1, 1]) {
    for (const z of [-1.52, 1.52]) {
      const arch = new THREE.CircleGeometry(0.49, 12, 0, Math.PI);
      arch.rotateY((Math.PI / 2) * sx);
      addMesh(root, `arch_${sx}_${z}`, arch, M.trim, sx * 0.915, 0.42, z);
      const flareGeo = new THREE.TorusGeometry(0.50, 0.055, 6, 14, Math.PI);
      flareGeo.rotateY(Math.PI / 2);
      addMesh(root, `flare_${sx}_${z}`, flareGeo, M.trim, sx * 0.91, 0.42, z);
    }
    addBox(root, `mudflap_${sx}`, 0.30, 0.32, 0.03, M.trim, sx * 0.80, 0.32, 2.05);
  }

  // Double-cab glasshouse, B/C pillars, wing mirrors, handles, snorkel
  addBox(root, 'windscreen', 1.46, 0.03, 0.68, M.glass, 0, 1.55, -0.74, -0.68, 0, 0);
  addBox(root, 'rear_cab_glass', 1.38, 0.42, 0.03, M.glass, 0, 1.53, 0.72);
  for (const sx of [-1, 1]) {
    addBox(root, `side_win_${sx}`, 0.03, 0.42, 1.06, M.glass, sx * 0.81, 1.53, 0.06, 0, 0, sx * -0.16);
    addBox(root, `bpillar_${sx}`, 0.04, 0.44, 0.10, M.trim, sx * 0.815, 1.53, 0.02, 0, 0, sx * -0.16);
    addBox(root, `mirror_${sx}`, 0.18, 0.14, 0.10, M.trim, sx * 1.04, 1.32, -0.72);
    addBox(root, `handle_f_${sx}`, 0.03, 0.035, 0.14, M.chrome, sx * 0.935, 1.12, -0.22);
    addBox(root, `handle_r_${sx}`, 0.03, 0.035, 0.14, M.chrome, sx * 0.935, 1.12, 0.38);
  }
  // Right-side 4x4 safari snorkel
  addBar(root, 'snorkel_run', [0.91, 1.12, -1.10], [0.84, 1.78, -0.58], 0.042, M.trim);
  addBox(root, 'snorkel_head', 0.10, 0.14, 0.12, M.trim, 0.84, 1.84, -0.56);

  // Tubular steel bed rollbar + roof rack
  addBar(root, 'roll_L', [-0.74, 1.24, 0.86], [-0.70, 1.84, 0.86], 0.038, M.trim);
  addBar(root, 'roll_R', [0.74, 1.24, 0.86], [0.70, 1.84, 0.86], 0.038, M.trim);
  addBar(root, 'roll_top', [-0.70, 1.84, 0.86], [0.70, 1.84, 0.86], 0.038, M.trim);
  addBar(root, 'roll_brace_L', [-0.70, 1.82, 0.86], [-0.74, 1.24, 1.48], 0.03, M.trim);
  addBar(root, 'roll_brace_R', [0.70, 1.82, 0.86], [0.74, 1.24, 1.48], 0.03, M.trim);
  for (const sx of [-1, 1]) {
    addBox(root, `rack_rail_${sx}`, 0.05, 0.07, 1.06, M.trim, sx * 0.58, 1.89, 0.08);
  }
  for (const rz of [-0.36, 0.08, 0.52]) {
    addBox(root, `rack_bar_${rz}`, 1.16, 0.04, 0.05, M.trim, 0, 1.88, rz);
  }

  // Front grille, heavy-duty bullbar, rear step bumper, plates, exhaust
  addBox(root, 'grille_bg', 1.04, 0.30, 0.06, M.trim, 0, 0.96, -2.43);
  for (let i = -1; i <= 1; i++) {
    addBox(root, `grille_slat_${i + 1}`, 0.98, 0.038, 0.07, M.chrome, 0, 0.96 + i * 0.08, -2.435);
  }
  addBox(root, 'bumper_f', 1.82, 0.18, 0.14, M.trim, 0, 0.62, -2.48);
  addBar(root, 'bull_L', [-0.46, 0.64, -2.53], [-0.40, 1.06, -2.53], 0.034, M.trim);
  addBar(root, 'bull_R', [0.46, 0.64, -2.53], [0.40, 1.06, -2.53], 0.034, M.trim);
  addBar(root, 'bull_top', [-0.40, 1.06, -2.53], [0.40, 1.06, -2.53], 0.034, M.trim);
  addBar(root, 'bull_mid', [-0.84, 0.86, -2.49], [0.84, 0.86, -2.49], 0.028, M.trim);
  addBox(root, 'bumper_r', 1.84, 0.16, 0.14, M.trim, 0, 0.60, 2.46);
  addBox(root, 'plate_f', 0.40, 0.11, 0.03, M.plate, 0, 0.62, -2.55);
  addBox(root, 'plate_r', 0.40, 0.11, 0.03, M.plate, 0, 0.62, 2.53);
  addMesh(root, 'exhaust', new THREE.CylinderGeometry(0.048, 0.048, 0.22, 10), M.chrome, -0.68, 0.40, 2.42, Math.PI / 2, 0, 0);

  // Direct child light meshes: main head_* MUST be added BEFORE head_fog_*!
  for (const sx of [-1, 1]) {
    addBox(root, `head_${sx}`, 0.30, 0.15, 0.06, M.head, sx * 0.68, 1.00, -2.41, 0, sx * 0.12, 0);
  }
  for (const sx of [-1, 1]) {
    addMesh(root, `head_fog_${sx}`, new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10), M.head, sx * 0.28, 0.78, -2.53, Math.PI / 2, 0, 0);
    addBox(root, `hazard_f${sx}`, 0.11, 0.09, 0.06, M.hazard, sx * 0.84, 0.96, -2.36, 0, sx * 0.22, 0);
    addBox(root, `brake_${sx}`, 0.14, 0.26, 0.06, M.brake, sx * 0.84, 0.98, 2.42);
    addBox(root, `hazard_r${sx}`, 0.14, 0.10, 0.06, M.hazard, sx * 0.84, 0.78, 2.42);
  }

  return root;
}

const exporter = new GLTFExporter();
function writeGlb(name, scene) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error(`Expected ArrayBuffer for ${name}`));
          return;
        }
        const out = path.join(OUT_DIR, `${name}.glb`);
        fs.writeFileSync(out, Buffer.from(result));
        console.log(`wrote ${out} (${(result.byteLength / 1024).toFixed(1)} kB)`);
        resolve();
      },
      reject,
      { binary: true },
    );
  });
}

await writeGlb('bike', buildBike());
await writeGlb('cart', buildCart());
await writeGlb('car', buildCar());
await writeGlb('truck', buildTruck());
await writeGlb('coupe', buildCoupe());
await writeGlb('suv', buildSuv());
