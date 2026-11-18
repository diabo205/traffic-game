import * as THREE from 'three';
import { PLAYER_VEHICLES, VEHICLE_SHOWCASE } from '../sim/PlayerCar';
import type { PlayerVehicle } from '../sim/types';
import type { TimeOfDay } from './Renderer';
import type { VehicleFactory, VehicleVisual } from './VehicleFactory';

export interface GarageProjection {
  activeAnchor: { x: number; y: number; visible: boolean };
  adjacentAnchor: { x: number; y: number; visible: boolean };
  adjacentVehicle: PlayerVehicle;
}

interface GarageSlotEntry {
  visual: VehicleVisual;
  roofY: number;
  halfWidth: number;
  halfLength: number;
}

interface GarageMood {
  bg: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  skylightColor: string;
  skylightIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  keyColor: string;
  keyIntensity: number;
  rimIntensity: number;
  magentaIntensity: number;
  cyanIntensity: number;
  poolOpacity: number;
  exposure: number;
  headlights: number;
  headlightPool: boolean;
}

const GARAGE_MOODS: Record<TimeOfDay, GarageMood> = {
  noon: {
    bg: '#10151e',
    fog: '#141a24',
    fogNear: 18,
    fogFar: 46,
    skylightColor: '#a8cbe4',
    skylightIntensity: 1.35,
    hemiSky: '#c6d8ea',
    hemiGround: '#242228',
    hemiIntensity: 1.15,
    keyColor: '#fff0d8',
    keyIntensity: 2.35,
    rimIntensity: 1.1,
    magentaIntensity: 16,
    cyanIntensity: 18,
    poolOpacity: 0.24,
    exposure: 1.05,
    headlights: 0,
    headlightPool: false,
  },
  sunset: {
    bg: '#14121b',
    fog: '#191522',
    fogNear: 17,
    fogFar: 44,
    skylightColor: '#e8875b',
    skylightIntensity: 1.15,
    hemiSky: '#dfb09a',
    hemiGround: '#261e26',
    hemiIntensity: 1.0,
    keyColor: '#ffdfc0',
    keyIntensity: 2.15,
    rimIntensity: 1.25,
    magentaIntensity: 20,
    cyanIntensity: 20,
    poolOpacity: 0.3,
    exposure: 1.08,
    headlights: 1,
    headlightPool: false,
  },
  night: {
    bg: '#090d16',
    fog: '#0c101c',
    fogNear: 15,
    fogFar: 40,
    skylightColor: '#1f3564',
    skylightIntensity: 0.7,
    hemiSky: '#637eb5',
    hemiGround: '#1a1520',
    hemiIntensity: 0.78,
    keyColor: '#ffe7cc',
    keyIntensity: 1.95,
    rimIntensity: 1.45,
    magentaIntensity: 28,
    cyanIntensity: 28,
    poolOpacity: 0.36,
    exposure: 1.14,
    headlights: 1,
    headlightPool: true,
  },
  monsoon: {
    bg: '#0b121c',
    fog: '#101925',
    fogNear: 14,
    fogFar: 36,
    skylightColor: '#36506b',
    skylightIntensity: 0.85,
    hemiSky: '#7896b3',
    hemiGround: '#181c24',
    hemiIntensity: 0.88,
    keyColor: '#e6effa',
    keyIntensity: 1.9,
    rimIntensity: 1.4,
    magentaIntensity: 26,
    cyanIntensity: 27,
    poolOpacity: 0.38,
    exposure: 1.1,
    headlights: 1,
    headlightPool: true,
  },
};

const FALLBACK_DIMS: Record<PlayerVehicle, { roofY: number; hw: number; hl: number }> = {
  alto: { roofY: 1.49, hw: 0.89, hl: 1.75 },
  coupe: { roofY: 1.36, hw: 0.97, hl: 2.3 },
  rickshaw: { roofY: 1.92, hw: 0.7, hl: 1.67 },
  suv: { roofY: 1.93, hw: 1.13, hl: 2.57 },
  minibus: { roofY: 3.47, hw: 1.43, hl: 3.82 },
};

const HERO_YAW = -Math.PI * 0.72;
const ADJ_YAW = -Math.PI * 0.75;
const DEG2RAD = Math.PI / 180;

function makeConcreteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#33363c';
  ctx.fillRect(0, 0, 512, 512);

  // Concrete aggregate speckle & worn garage blotches
  let s = 1337;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 6500; i++) {
    const v = 38 + Math.floor(rand() * 36);
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},0.35)`;
    ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 3, 1 + rand() * 3);
  }
  for (let i = 0; i < 18; i++) {
    const g = ctx.createRadialGradient(
      rand() * 512,
      rand() * 512,
      8,
      rand() * 512,
      rand() * 512,
      40 + rand() * 70,
    );
    g.addColorStop(0, 'rgba(18, 20, 25, 0.22)');
    g.addColorStop(1, 'rgba(18, 20, 25, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  // Expansion slab joints
  ctx.strokeStyle = 'rgba(16, 18, 22, 0.65)';
  ctx.lineWidth = 3;
  for (let p = 0; p < 512; p += 128) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }
  // Subtle tyre scuff arcs
  ctx.strokeStyle = 'rgba(15, 16, 20, 0.25)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(40, 420);
  ctx.quadraticCurveTo(220, 320, 440, 260);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = 4;
  return tex;
}

function makeCorrugatedWallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1f27';
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    ctx.fillStyle = '#252a34';
    ctx.fillRect(x, 0, 7, 256);
    ctx.fillStyle = '#13161c';
    ctx.fillRect(x + 7, 0, 5, 256);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < 256; y += 64) {
    ctx.fillRect(0, y, 256, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  return tex;
}

function makeMuralTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 512, 256);
  bg.addColorStop(0, '#161a23');
  bg.addColorStop(0.5, '#1d222d');
  bg.addColorStop(1, '#12151c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 256);

  // Industrial corrugated ribs behind mural
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 0; x < 512; x += 14) {
    ctx.fillRect(x, 0, 5, 256);
  }

  // Street-art geometric/portrait mural inspired by NFS Heat garage back wall
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#38d9f5';
  ctx.beginPath();
  ctx.arc(256, 128, 86, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff2d6f';
  ctx.beginPath();
  ctx.moveTo(90, 230);
  ctx.lineTo(220, 46);
  ctx.lineTo(290, 120);
  ctx.lineTo(180, 240);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#181c26';
  ctx.beginPath();
  ctx.arc(256, 126, 68, 0, Math.PI * 2);
  ctx.fill();

  // Stylized eyes/visor & graffiti streaks
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(216, 108, 28, 10);
  ctx.fillRect(266, 108, 28, 10);
  ctx.fillStyle = '#38d9f5';
  ctx.fillRect(224, 110, 12, 6);
  ctx.fillRect(274, 110, 12, 6);

  ctx.strokeStyle = '#ff2d6f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(150, 175);
  ctx.lineTo(362, 82);
  ctx.stroke();

  ctx.strokeStyle = '#38d9f5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(180, 200);
  ctx.lineTo(395, 130);
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowPoolTexture(rgb: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 6, 128, 128, 124);
  g.addColorStop(0, `rgba(${rgb}, 0.72)`);
  g.addColorStop(0.45, `rgba(${rgb}, 0.32)`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function measureVehicleBounds(root: THREE.Object3D, fallback: { roofY: number; hw: number; hl: number }) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name !== 'beam' && o.name !== 'pool') {
      box.expandByObject(o);
    }
  });
  if (box.isEmpty()) return fallback;
  return {
    roofY: Math.max(0.8, box.max.y),
    halfWidth: Math.max(0.5, (box.max.x - box.min.x) * 0.5),
    halfLength: Math.max(1.0, (box.max.z - box.min.z) * 0.5),
  };
}

/**
 * Isolated 3D NFS Heat-inspired industrial garage showcase scene.
 * Rendered exclusively through the caller-owned WebGLRenderer (never instantiates its own WebGLRenderer).
 */
export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  exposure = GARAGE_MOODS.noon.exposure;

  private readonly pool = new Map<PlayerVehicle, GarageSlotEntry>();
  private readonly heroGroup = new THREE.Group();
  private readonly adjGroup = new THREE.Group();

  private activeVehicle: PlayerVehicle = 'coupe';
  private adjacentVehicle: PlayerVehicle = 'alto';
  private timeOfDay: TimeOfDay = 'noon';
  private aspect = 16 / 9;
  private time = 0;

  // Lighting & mood-reactive elements
  private readonly hemi: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly magentaLight: THREE.PointLight;
  private readonly cyanLight: THREE.PointLight;
  private readonly skylightMat: THREE.MeshBasicMaterial;
  private readonly magentaBarMat: THREE.MeshBasicMaterial;
  private readonly cyanBarMat: THREE.MeshBasicMaterial;
  private readonly heroGlowMat: THREE.MeshBasicMaterial;
  private readonly adjGlowMat: THREE.MeshBasicMaterial;
  private readonly heroGlowMesh: THREE.Mesh;
  private readonly adjGlowMesh: THREE.Mesh;

  // Camera smoothing state
  private camPos = new THREE.Vector3(-0.35, 1.55, 6.2);
  private camTarget = new THREE.Vector3(-0.35, 0.88, 0.0);
  private camPosDesired = new THREE.Vector3(-0.35, 1.55, 6.2);
  private camTargetDesired = new THREE.Vector3(-0.35, 0.88, 0.0);
  private targetFov = 42;
  private camInitialized = false;

  // Reusable projection temporaries
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpAdjVec = new THREE.Vector3();

  constructor(factory: VehicleFactory, aspect: number, lowSpec: boolean) {
    this.aspect = Math.max(0.25, aspect);
    this.camera = new THREE.PerspectiveCamera(42, this.aspect, 0.25, 90);

    this.scene.background = new THREE.Color(GARAGE_MOODS.noon.bg);
    this.scene.fog = new THREE.Fog(GARAGE_MOODS.noon.fog, GARAGE_MOODS.noon.fogNear, GARAGE_MOODS.noon.fogFar);

    // ---- Lighting ------------------------------------------------------------
    this.hemi = new THREE.HemisphereLight('#c6d8ea', '#242228', 1.15);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight('#fff0d8', 2.35);
    this.keyLight.position.set(3.5, 8.2, 5.5);
    this.keyLight.castShadow = !lowSpec;
    if (!lowSpec) {
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.camera.left = -9;
      this.keyLight.shadow.camera.right = 9;
      this.keyLight.shadow.camera.top = 9;
      this.keyLight.shadow.camera.bottom = -9;
      this.keyLight.shadow.camera.near = 1;
      this.keyLight.shadow.camera.far = 26;
      this.keyLight.shadow.bias = -0.0008;
    }
    this.scene.add(this.keyLight, this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight('#38d9f5', 1.1);
    this.rimLight.position.set(-7.5, 4.5, -5.0);
    this.scene.add(this.rimLight);

    this.magentaLight = new THREE.PointLight('#ff2d6f', 16, 18, 1.5);
    this.magentaLight.position.set(-1.6, 4.4, -3.2);
    this.scene.add(this.magentaLight);

    this.cyanLight = new THREE.PointLight('#38d9f5', 18, 18, 1.5);
    this.cyanLight.position.set(4.8, 4.3, -2.0);
    this.scene.add(this.cyanLight);

    // ---- Environment geometry ------------------------------------------------
    this.skylightMat = new THREE.MeshBasicMaterial({ color: '#a8cbe4' });
    this.magentaBarMat = new THREE.MeshBasicMaterial({ color: '#ff3b7f' });
    this.cyanBarMat = new THREE.MeshBasicMaterial({ color: '#45e0ff' });
    this.heroGlowMat = new THREE.MeshBasicMaterial({
      map: makeGlowPoolTexture('255, 45, 111'),
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.adjGlowMat = new THREE.MeshBasicMaterial({
      map: makeGlowPoolTexture('56, 217, 245'),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.heroGlowMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.4).rotateX(-Math.PI / 2), this.heroGlowMat);
    this.heroGlowMesh.position.set(0.3, 0.012, 0.2);
    this.adjGlowMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 4.8).rotateX(-Math.PI / 2), this.adjGlowMat);
    this.adjGlowMesh.position.set(5.0, 0.012, -2.2);

    this.buildWarehouse();
    this.scene.add(this.heroGlowMesh, this.adjGlowMesh);
    this.scene.add(this.heroGroup, this.adjGroup);

    // ---- Pre-build all 5 player vehicles once --------------------------------
    for (const veh of PLAYER_VEHICLES) {
      const visual = factory.create(veh, 0, true, VEHICLE_SHOWCASE[veh].paintHex);
      visual.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name !== 'beam' && o.name !== 'pool') {
          o.castShadow = !lowSpec;
        }
      });
      const fb = FALLBACK_DIMS[veh];
      const measured = measureVehicleBounds(visual.root, fb);
      const roofY = 'roofY' in measured ? measured.roofY : fb.roofY;
      const halfWidth = 'halfWidth' in measured ? measured.halfWidth : fb.hw;
      const halfLength = 'halfLength' in measured ? measured.halfLength : fb.hl;
      this.pool.set(veh, { visual, roofY, halfWidth, halfLength });
    }

    this.setVehicle('coupe', 'alto');
    this.setTimeOfDay('noon');
    this.update(0);
  }

  private buildWarehouse(): void {
    const concreteMat = new THREE.MeshStandardMaterial({
      map: makeConcreteTexture(),
      color: '#aeb4be',
      roughness: 0.36,
      metalness: 0.14,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), concreteMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Subtle yellow/cyan workshop bay floor stripes
    const bayStripeMat = new THREE.MeshBasicMaterial({ color: '#38d9f5', transparent: true, opacity: 0.35 });
    const bayStripeRear = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 0.07).rotateX(-Math.PI / 2), bayStripeMat);
    bayStripeRear.position.set(4.8, 0.014, -4.1);
    const bayStripeSide = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 4.4).rotateX(-Math.PI / 2), bayStripeMat);
    bayStripeSide.position.set(2.4, 0.014, -1.9);
    this.scene.add(bayStripeRear, bayStripeSide);

    const wallTex = makeCorrugatedWallTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      color: '#464d59',
      roughness: 0.78,
      metalness: 0.25,
    });
    const steelMat = new THREE.MeshStandardMaterial({ color: '#262b34', roughness: 0.55, metalness: 0.65 });
    const darkMetalMat = new THREE.MeshStandardMaterial({ color: '#181b21', roughness: 0.65, metalness: 0.5 });

    // Back wall + left/right walls + dark ceiling bay
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), wallMat);
    backWall.position.set(0, 5, -9.8);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(28, 10), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-12.5, 5, 3);
    this.scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(28, 10), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(13.5, 5, 3);
    this.scene.add(rightWall);

    // Graffiti / street-art mural on back wall behind the hero car
    const muralMat = new THREE.MeshStandardMaterial({
      map: makeMuralTexture(),
      roughness: 0.7,
      metalness: 0.1,
    });
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 5.4), muralMat);
    mural.position.set(-0.6, 3.2, -9.72);
    this.scene.add(mural);

    // Structural steel H-columns along back and sides
    const colGeo = new THREE.BoxGeometry(0.32, 9.2, 0.36);
    for (const x of [-9.5, -5.8, 4.8, 9.8]) {
      const col = new THREE.Mesh(colGeo, steelMat);
      col.position.set(x, 4.6, -9.55);
      this.scene.add(col);
    }

    // Overhead steel roof trusses & skylight bays
    const trussGeo = new THREE.BoxGeometry(26, 0.24, 0.26);
    const braceGeo = new THREE.BoxGeometry(0.14, 1.35, 0.14);
    for (const z of [-7.5, -3.2, 1.2, 5.6, 10.0]) {
      const beam = new THREE.Mesh(trussGeo, steelMat);
      beam.position.set(0.5, 6.9, z);
      this.scene.add(beam);
      const topChord = new THREE.Mesh(trussGeo, steelMat);
      topChord.position.set(0.5, 8.05, z);
      this.scene.add(topChord);
      for (let bx = -10; bx <= 10; bx += 4) {
        const strut = new THREE.Mesh(braceGeo, darkMetalMat);
        strut.position.set(bx, 7.45, z);
        strut.rotation.z = bx % 8 === 0 ? 0.35 : -0.35;
        this.scene.add(strut);
      }
    }

    // Skylight panels overhead (right & center-rear)
    const skyPanelGeo = new THREE.PlaneGeometry(4.4, 3.4);
    for (const [sx, sz] of [
      [-1.5, -5.3],
      [4.0, -5.3],
      [4.0, -1.0],
      [-1.5, -1.0],
    ] as const) {
      const sky = new THREE.Mesh(skyPanelGeo, this.skylightMat);
      sky.rotation.x = Math.PI / 2;
      sky.position.set(sx, 8.2, sz);
      this.scene.add(sky);
    }

    // Left foreground ceiling soffit / mezzanine overhang (frames top-left like reference image)
    const mezzanine = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.45, 7.2), darkMetalMat);
    mezzanine.position.set(-7.2, 6.2, 1.0);
    this.scene.add(mezzanine);

    // Signature magenta/pink neon ceiling light bar (center-left)
    const magHousing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 0.2), darkMetalMat);
    magHousing.position.set(-1.5, 4.95, -4.4);
    const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 4.4, 8), this.magentaBarMat);
    magTube.rotation.z = Math.PI / 2;
    magTube.position.set(-1.5, 4.86, -4.4);
    this.scene.add(magHousing, magTube);

    // Signature cyan neon ceiling light bar (over right/adjacent bay)
    const cyanHousing = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.18), darkMetalMat);
    cyanHousing.position.set(5.4, 4.65, -2.5);
    cyanHousing.rotation.y = -0.28;
    const cyanTube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 8), this.cyanBarMat);
    cyanTube.rotation.z = Math.PI / 2;
    cyanTube.rotation.y = -0.28;
    cyanTube.position.set(5.4, 4.57, -2.5);
    this.scene.add(cyanHousing, cyanTube);

    // Overhead conduit pipes
    const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 18, 8);
    const pipe = new THREE.Mesh(pipeGeo, steelMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0.5, 5.7, -8.9);
    this.scene.add(pipe);

    // ---- Left background workshop props (clear of cars & keeping left ~30% readable) ----
    // 1. Stacked spare tyres on rolling dolly
    const tyreStack = new THREE.Group();
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#18191c', roughness: 0.85, metalness: 0.05 });
    const dolly = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 1.15), darkMetalMat);
    dolly.position.y = 0.12;
    tyreStack.add(dolly);
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.3, 14), tyreMat);
      t.position.y = 0.33 + i * 0.31;
      t.castShadow = true;
      tyreStack.add(t);
    }
    tyreStack.position.set(-4.7, 0, -2.9);
    this.scene.add(tyreStack);

    // 2. Industrial storage shelving rack against back-left wall
    const rack = new THREE.Group();
    const rackLegGeo = new THREE.BoxGeometry(0.08, 2.5, 0.08);
    for (const rx of [-0.95, 0.95]) {
      for (const rz of [-0.35, 0.35]) {
        const leg = new THREE.Mesh(rackLegGeo, steelMat);
        leg.position.set(rx, 1.25, rz);
        rack.add(leg);
      }
    }
    const shelfGeo = new THREE.BoxGeometry(2.0, 0.06, 0.78);
    for (const sy of [0.35, 1.05, 1.75, 2.42]) {
      const shelf = new THREE.Mesh(shelfGeo, darkMetalMat);
      shelf.position.y = sy;
      rack.add(shelf);
    }
    const crateMat = new THREE.MeshStandardMaterial({ color: '#394657', roughness: 0.65 });
    const jugMat = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.45 });
    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.34, 0.45), crateMat);
    crate1.position.set(-0.45, 1.25, 0);
    const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 0.42), crateMat);
    crate2.position.set(0.45, 1.94, 0);
    const jug = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.18), jugMat);
    jug.position.set(-0.3, 1.95, 0.08);
    rack.add(crate1, crate2, jug);
    rack.position.set(-5.8, 0, -7.8);
    this.scene.add(rack);

    // 3. Safety traffic cone on far left foreground
    const cone = new THREE.Group();
    const coneOrange = new THREE.MeshStandardMaterial({ color: '#c84b18', roughness: 0.6 });
    const coneStripe = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.4 });
    const coneBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), darkMetalMat);
    coneBase.position.y = 0.025;
    const coneBody = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.68, 10), coneOrange);
    coneBody.position.y = 0.39;
    const coneBand = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.115, 0.14, 10), coneStripe);
    coneBand.position.y = 0.44;
    cone.add(coneBase, coneBody, coneBand);
    cone.position.set(-5.8, 0, 1.8);
    this.scene.add(cone);
  }

  private nextVehicle(veh: PlayerVehicle): PlayerVehicle {
    const idx = PLAYER_VEHICLES.indexOf(veh);
    return PLAYER_VEHICLES[(idx + 1) % PLAYER_VEHICLES.length];
  }

  setVehicle(vehicle: PlayerVehicle, adjacentVehicle?: PlayerVehicle): void {
    this.activeVehicle = vehicle;
    this.adjacentVehicle = adjacentVehicle ?? this.nextVehicle(vehicle);

    this.heroGroup.clear();
    this.adjGroup.clear();

    const hero = this.pool.get(vehicle);
    if (hero) {
      hero.visual.root.position.set(0, 0, 0);
      hero.visual.root.rotation.set(0, 0, 0);
      hero.visual.body.position.set(0, 0, 0);
      hero.visual.body.rotation.set(0, 0, 0);
      this.heroGroup.add(hero.visual.root);

      const heroRadius = Math.hypot(hero.halfWidth, hero.halfLength);
      const heroX = this.aspect < 0.85 ? 0.05 : 0.72;
      const heroZ = 0.25;
      this.heroGroup.position.set(heroX, 0, heroZ);
      this.heroGroup.rotation.set(0, HERO_YAW, 0);

      this.heroGlowMesh.position.set(heroX - 0.3, 0.012, heroZ + 0.35);
      const glowScale = Math.max(0.85, heroRadius / 2.4);
      this.heroGlowMesh.scale.set(glowScale, 1, glowScale);

      const showAdjacent = this.adjacentVehicle !== vehicle;
      const adj = showAdjacent ? this.pool.get(this.adjacentVehicle) : undefined;
      if (adj && showAdjacent) {
        adj.visual.root.position.set(0, 0, 0);
        adj.visual.root.rotation.set(0, 0, 0);
        adj.visual.body.position.set(0, 0, 0);
        adj.visual.body.rotation.set(0, 0, 0);
        this.adjGroup.add(adj.visual.root);
        this.adjGroup.visible = true;
        this.adjGlowMesh.visible = true;

        const adjRadius = Math.hypot(adj.halfWidth, adj.halfLength);
        const minSeparation = heroRadius + adjRadius + 0.9;
        const dirX = 0.86;
        const dirZ = -0.51;
        const adjX = heroX + dirX * minSeparation;
        const adjZ = heroZ + dirZ * minSeparation;
        this.adjGroup.position.set(adjX, 0, adjZ);
        this.adjGroup.rotation.set(0, ADJ_YAW, 0);

        const adjScale = Math.max(0.8, adjRadius / 2.3);
        this.adjGlowMesh.position.set(adjX, 0.012, adjZ);
        this.adjGlowMesh.scale.set(adjScale, 1, adjScale);
      } else {
        this.adjGroup.visible = false;
        this.adjGlowMesh.visible = false;
      }

      this.computeCameraGoals(hero);
      if (!this.camInitialized) {
        this.snapCamera();
        this.camInitialized = true;
      }
    }

    this.applyHeadlights();
  }

  private computeCameraGoals(hero: GarageSlotEntry): void {
    const portrait = this.aspect < 0.85;
    const radius = Math.hypot(hero.halfWidth, hero.halfLength);
    const sizeScale = Math.max(1, radius / 2.55);
    const heightScale = Math.max(1, hero.roofY / 1.65);

    this.targetFov = portrait ? 56 : 42;
    const baseDist = portrait ? 8.8 / Math.max(0.45, this.aspect * 1.45) : 6.15;
    const dist = baseDist * sizeScale;

    // In landscape, shift look target slightly left so the hero sits slightly right of center (leaving left 30% open for stats).
    // In portrait, center the hero horizontally.
    const lookX = portrait ? this.heroGroup.position.x : this.heroGroup.position.x - 0.95 * sizeScale;
    const lookY = hero.roofY * 0.56 + 0.08;
    const lookZ = this.heroGroup.position.z - 0.15;

    this.camTargetDesired.set(lookX, lookY, lookZ);
    this.camPosDesired.set(
      lookX + (portrait ? 0.15 : -0.15),
      Math.max(1.38, 1.48 * heightScale),
      lookZ + dist,
    );
  }

  private snapCamera(): void {
    this.camPos.copy(this.camPosDesired);
    this.camTarget.copy(this.camTargetDesired);
    this.camera.fov = this.targetFov;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.updateProjectionMatrix();
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    const m = GARAGE_MOODS[tod];
    this.exposure = m.exposure;
    if (this.scene.background instanceof THREE.Color) this.scene.background.set(m.bg);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(m.fog);
      this.scene.fog.near = m.fogNear;
      this.scene.fog.far = m.fogFar;
    }
    this.skylightMat.color.set(m.skylightColor);
    this.hemi.color.set(m.hemiSky);
    this.hemi.groundColor.set(m.hemiGround);
    this.hemi.intensity = m.hemiIntensity;
    this.keyLight.color.set(m.keyColor);
    this.keyLight.intensity = m.keyIntensity;
    this.rimLight.intensity = m.rimIntensity;
    this.magentaLight.intensity = m.magentaIntensity;
    this.cyanLight.intensity = m.cyanIntensity;
    this.heroGlowMat.opacity = m.poolOpacity;
    this.adjGlowMat.opacity = m.poolOpacity * 0.85;
    this.applyHeadlights();
  }

  private applyHeadlights(): void {
    const m = GARAGE_MOODS[this.timeOfDay];
    const active = this.pool.get(this.activeVehicle);
    if (active) active.visual.setHeadlights(m.headlights, m.headlightPool);
    if (this.adjacentVehicle !== this.activeVehicle) {
      const adj = this.pool.get(this.adjacentVehicle);
      if (adj) adj.visual.setHeadlights(m.headlights, m.headlightPool);
    }
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(0.25, width / Math.max(1, height));
    this.camera.aspect = this.aspect;
    const hero = this.pool.get(this.activeVehicle);
    if (hero) {
      // Re-evaluate hero horizontal offset between portrait & landscape
      this.setVehicle(this.activeVehicle, this.adjacentVehicle);
      this.snapCamera();
    } else {
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt: number): void {
    this.time += dt;
    const hero = this.pool.get(this.activeVehicle);
    if (hero) {
      this.computeCameraGoals(hero);
      // Subtle suspension settle / idle life
      const settle = dt > 0 ? Math.sin(this.time * 1.4) * 0.004 : 0;
      hero.visual.body.position.y = settle;
    }

    if (dt <= 0) {
      this.snapCamera();
    } else {
      const k = 1 - Math.exp(-dt * 6.5);
      this.camPos.lerp(this.camPosDesired, k);
      this.camTarget.lerp(this.camTargetDesired, k);
      if (Math.abs(this.camera.fov - this.targetFov) > 0.01) {
        this.camera.fov += (this.targetFov - this.camera.fov) * k;
        this.camera.updateProjectionMatrix();
      }
      // Subtle breathing sway around resting position
      const breathX = Math.sin(this.time * 0.55) * 0.055;
      const breathY = Math.cos(this.time * 0.72) * 0.024;
      this.camera.position.set(this.camPos.x + breathX, this.camPos.y + breathY, this.camPos.z);
      this.camera.lookAt(this.camTarget);
    }

    // Subtle neon buzz flicker on magenta bar
    const m = GARAGE_MOODS[this.timeOfDay];
    const hum = 1 + Math.sin(this.time * 11.3) * 0.025 + Math.sin(this.time * 23.7) * 0.015;
    this.magentaLight.intensity = m.magentaIntensity * hum;
    const fovRad = this.camera.fov * DEG2RAD;
    void fovRad;
  }

  getProjection(): GarageProjection {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);

    const hero = this.pool.get(this.activeVehicle);
    const activeRoofY = hero ? hero.roofY : FALLBACK_DIMS[this.activeVehicle].roofY;
    this.tmpVec.set(0, activeRoofY + 0.55, 0);
    this.heroGroup.localToWorld(this.tmpVec);
    this.tmpVec.project(this.camera);

    const ax = (this.tmpVec.x + 1) * 0.5;
    const ay = (1 - this.tmpVec.y) * 0.5;
    const aVis =
      Number.isFinite(ax) &&
      Number.isFinite(ay) &&
      this.tmpVec.z >= -1 &&
      this.tmpVec.z <= 1 &&
      ax >= 0 &&
      ax <= 1 &&
      ay >= 0 &&
      ay <= 1;

    let bx = 0.85;
    let by = 0.35;
    let bVis = false;
    if (this.adjacentVehicle !== this.activeVehicle && this.adjGroup.visible) {
      const adj = this.pool.get(this.adjacentVehicle);
      const adjRoofY = adj ? adj.roofY : FALLBACK_DIMS[this.adjacentVehicle].roofY;
      this.tmpAdjVec.set(0, adjRoofY + 0.45, 0);
      this.adjGroup.localToWorld(this.tmpAdjVec);
      this.tmpAdjVec.project(this.camera);

      bx = (this.tmpAdjVec.x + 1) * 0.5;
      by = (1 - this.tmpAdjVec.y) * 0.5;
      bVis =
        Number.isFinite(bx) &&
        Number.isFinite(by) &&
        this.tmpAdjVec.z >= -1 &&
        this.tmpAdjVec.z <= 1 &&
        bx >= 0 &&
        bx <= 1 &&
        by >= 0 &&
        by <= 1;
    }

    return {
      activeAnchor: { x: ax, y: ay, visible: aVis },
      adjacentAnchor: { x: bx, y: by, visible: bVis },
      adjacentVehicle: this.adjacentVehicle,
    };
  }

  render(gl: THREE.WebGLRenderer): void {
    gl.render(this.scene, this.camera);
  }
}
