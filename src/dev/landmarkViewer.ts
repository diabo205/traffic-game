/**
 * Dev-only landmark viewer (open /landmark.html on the Vite dev server).
 * Builds one Saddar landmark in isolation, with its gameplay collider (red
 * outline) and front direction (yellow arrow), so a model can be inspected
 * and compared against its collision box. Not part of the production build.
 *
 * URL params: kind=<LandmarkKind>  yaw=<deg>  pitch=<deg>  dist=<m>
 *             tod=noon|sunset|night  noshadow  orbit (auto-rotate)
 * Drag to orbit, wheel to zoom.
 */
import * as THREE from 'three';
import { cityMap } from '../sim/city/cityMap';
import type { Landmark } from '../sim/city/cityMap';
import { buildSaddarLandmark } from '../render/SaddarLandmarks';
import { CityScenery } from '../render/CityScenery';

const params = new URLSearchParams(location.search);
const city = cityMap();
const kinds = city.landmarks.map((l) => l.kind);
const kind = params.get('kind') ?? kinds[1];
const src = city.landmarks.find((l) => l.kind === kind) ?? city.landmarks[0];

// `ctx` builds the whole Saddar city around it (real roads & neighbours);
// otherwise the landmark is rebuilt alone at the origin.
const ctx = params.has('ctx');
const lm: Landmark = ctx ? src : { ...src, obb: { ...src.obb, x: 0, z: 0 } };
const origin = new THREE.Vector3(lm.obb.x, 0, -lm.obb.z);

const gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
gl.setPixelRatio(Math.min(2, devicePixelRatio));
gl.setSize(innerWidth, innerHeight);
gl.outputColorSpace = THREE.SRGBColorSpace;
gl.toneMapping = THREE.ACESFilmicToneMapping;
gl.shadowMap.enabled = !params.has('noshadow');
gl.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(gl.domElement);

const scene = new THREE.Scene();
const tod = params.get('tod') ?? 'noon';
const night = tod === 'night';
scene.background = new THREE.Color(night ? '#19294c' : tod === 'sunset' ? '#e7ab7f' : '#d3d5cc');
scene.add(new THREE.HemisphereLight(night ? '#5874b0' : '#e6edf1', night ? '#2d282c' : '#a8977a', night ? 1.05 : 1.5));
const sun = new THREE.DirectionalLight(night ? '#a6c2ff' : tod === 'sunset' ? '#ffa25b' : '#fff1d6', night ? 0.9 : 2.6);
sun.position.set(-49, 73, 49);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 250 });
sun.shadow.bias = -0.0008;
scene.add(sun);

if (!ctx) {
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: '#8d8a80' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
}

const litMats: THREE.MeshLambertMaterial[] = [];
const group = new THREE.Group();
buildSaddarLandmark(group, lm, true, litMats);
if (ctx) {
  const scenery = new CityScenery(false);
  scenery.update(0, lm.obb.x, lm.obb.z);
  scenery.setTimeOfDay(tod as 'noon' | 'sunset' | 'night');
  // CityScenery already contains this landmark; only measure our copy.
  scene.add(scenery.group);
  sun.position.set(origin.x - 49, 73, origin.z + 49);
  sun.target.position.copy(origin);
  scene.add(sun.target);
} else {
  scene.add(group);
}
if (night && !ctx) for (const m of litMats) m.emissiveIntensity = 0.65;

// Collider outline (sim OBB) + front arrow (local +x of the OBB = heading).
const { hw, hl, heading } = lm.obb;
const box = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(hw * 2, 0.4, hl * 2)),
  new THREE.LineBasicMaterial({ color: '#ff1744' }),
);
box.position.set(origin.x, 0.2, origin.z);
box.rotation.y = -heading;
scene.add(box);
// Arrow = the OBB's local +x (the hw axis); builders treat one side of it as the front.
const fwd = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
scene.add(new THREE.ArrowHelper(fwd, origin.clone().setY(0.5), hw + 6, 0xffd600, 2, 1.2));

// Measure model bounds for the HUD.
// Measure in the collider's frame (undo the heading) so sizes compare directly.
group.rotation.y = heading;
group.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(group);
group.rotation.y = 0;
group.updateMatrixWorld(true);
const size = bounds.getSize(new THREE.Vector3());
let tris = 0;
let meshes = 0;
group.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    meshes++;
    const g = o.geometry as THREE.BufferGeometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
});

const hud = document.getElementById('hud')!;
const sel = document.createElement('select');
for (const k of kinds) sel.add(new Option(k, k, false, k === kind));
sel.onchange = () => {
  params.set('kind', sel.value);
  location.search = params.toString();
};
hud.append(sel, document.createElement('br'));
hud.append(
  `${src.name} · collider ${(hw * 2).toFixed(1)}×${(hl * 2).toFixed(1)} m · model ${size.x.toFixed(1)}×${size.z.toFixed(1)} m, ${size.y.toFixed(1)} m tall · ${meshes} meshes · ${Math.round(tris)} tris`,
);
if (params.has('nohud')) hud.style.display = 'none';

// Orbit camera, angles relative to the landmark's front.
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 1000);
const deg = Math.PI / 180;
let yaw = Number(params.get('yaw') ?? 30) * deg;
let pitch = Number(params.get('pitch') ?? 18) * deg;
let dist = Number(params.get('dist') ?? Math.max(size.x, size.z, size.y) * 1.6 * Number(params.get('close') ?? 1));
const target = origin.clone().setY(Math.min(size.y * 0.4, 12));
const eye = params.has('eye');
if (eye) target.y = Math.min(size.y * 0.3, 10);
function place(): void {
  const a = Math.atan2(fwd.z, fwd.x) + yaw;
  camera.position.set(
    target.x + Math.cos(a) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.sin(a) * Math.cos(pitch) * dist,
  );
  // Driver's-eye: camera at car height, looking up at the building.
  if (eye) camera.position.y = 1.6;
  camera.lookAt(target);
}
let drag: { x: number; y: number } | null = null;
addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag.x) * 0.006;
  pitch = Math.max(-0.1, Math.min(1.5, pitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener('wheel', (e) => (dist = Math.max(5, dist * (1 + Math.sign(e.deltaY) * 0.1))));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  gl.setSize(innerWidth, innerHeight);
});

const orbit = params.has('orbit');
gl.setAnimationLoop(() => {
  if (orbit) yaw += 0.004;
  place();
  gl.render(scene, camera);
});
(window as unknown as { __ready: boolean }).__ready = true;
