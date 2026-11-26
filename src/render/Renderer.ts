import * as THREE from 'three';
import type { CityWorld } from '../sim/city/CityWorld';
import type { PlayerVehicle, SimEvent } from '../sim/types';
import type { VehicleBuild } from '../sim/upgrades';
import type { World } from '../sim/World';
import { Birds } from './Birds';
import { CameraOcclusion } from './CameraOcclusion';
import { ChaseCamera } from './ChaseCamera';
import type { ChaseInput } from './ChaseCamera';
import type { CityScenery } from './CityScenery';
import { Effects } from './Effects';
import { PostFx } from './PostFx';
import type { GradeParams } from './PostFx';
import type { Environment } from './Environment';
import type { FareVisuals } from './FareVisuals';
import { GarageScene } from './GarageScene';
import type { GarageProjection } from './GarageScene';
import { NpcTrafficBatch } from './NpcTrafficBatch';
import type { PropVisuals } from './PropVisuals';
import { RainFx } from './RainFx';
import { TyreFx } from './TyreFx';
import { VehicleFactory } from './VehicleFactory';
import type { VehicleVisual } from './VehicleFactory';

export type { GarageProjection };
export type AnyWorld = World | CityWorld;
export type TimeOfDay = 'noon' | 'sunset' | 'night' | 'monsoon';

interface Scenery {
  group: THREE.Group;
  visibleChunks?: number;
  setTimeOfDay?(tod: TimeOfDay): void;
  update(time: number, x: number, z: number): void;
  dispose?(): void;
}

/** Dusty, bleached Karachi horizon. */
const HORIZON = new THREE.Color('#d3d5cc');
const FLAME_CYAN = new THREE.Color('#7fd3ff');
const FLAME_AMBER = new THREE.Color('#ffb347');

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const FLAME_POS: Record<PlayerVehicle, readonly [number, number, number]> = {
  alto: [-0.42, 0.3, 1.72],
  coupe: [-0.54, 0.25, 2.30],
  rickshaw: [-0.28, 0.25, 1.38],
  suv: [-0.68, 0.40, 2.53],
  minibus: [-0.75, 0.42, 3.62],
};

interface CameraPreset {
  distScale: number;
  heightScale: number;
  lookHeight: number;
  aheadScale: number;
  minClipDist: number;
}

const CAMERA_PRESETS: Record<PlayerVehicle, CameraPreset> = {
  alto: { distScale: 1.0, heightScale: 1.0, lookHeight: 1.05, aheadScale: 1.0, minClipDist: 2.1 },
  coupe: { distScale: 1.08, heightScale: 1.02, lookHeight: 1.05, aheadScale: 1.08, minClipDist: 2.35 },
  rickshaw: { distScale: 1.12, heightScale: 1.32, lookHeight: 1.3, aheadScale: 1.25, minClipDist: 2.1 },
  suv: { distScale: 1.24, heightScale: 1.24, lookHeight: 1.38, aheadScale: 1.2, minClipDist: 2.65 },
  minibus: { distScale: 1.95, heightScale: 2.1, lookHeight: 2.15, aheadScale: 1.75, minClipDist: 4.35 },
};

interface LightingPreset {
  top: string;
  mid: string;
  bottom: string;
  /** sky-shader sun disc / halo colour (HDR, so it blooms) */
  sunGlow: string;
  sunDir: readonly [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  exposure: number;
  fogNear: number;
  fogFar: number;
  post: GradeParams;
}

const LIGHTING: Record<TimeOfDay, LightingPreset> = {
  // Clear, warm Karachi afternoon: deep blue overhead, dusty warm horizon.
  noon: {
    top: '#4f93d4',
    mid: '#b9d3e4',
    bottom: '#ecdcbf',
    sunGlow: '#fff1d0',
    sunDir: [-0.49, 0.73, 0.49],
    hemiSky: '#cfe0ef',
    hemiGround: '#b39a72',
    hemiIntensity: 1.3,
    sunColor: '#ffe6c0',
    sunIntensity: 3.0,
    exposure: 1.0,
    fogNear: 60,
    fogFar: 430,
    post: {
      bloom: 0.25, bloomRadius: 0.4, bloomThreshold: 0.95,
      saturation: 1.15, contrast: 1.06,
      shadowTint: '#e4ebff', highlightTint: '#fff4e2',
      vignette: 0.25, glowTint: '#fff0d0', glow: 0.06,
    },
  },
  // Golden hour: low orange sun, long shadows, violet shade, glowing haze.
  sunset: {
    top: '#4a5296',
    mid: '#f2a272',
    bottom: '#ffd09a',
    sunGlow: '#ffb468',
    sunDir: [-0.84, 0.17, -0.52],
    hemiSky: '#c4b6dc',
    hemiGround: '#8c6a52',
    hemiIntensity: 1.45,
    sunColor: '#ffa45c',
    sunIntensity: 3.2,
    exposure: 1.05,
    fogNear: 70,
    fogFar: 380,
    post: {
      bloom: 0.5, bloomRadius: 0.55, bloomThreshold: 0.85,
      saturation: 1.15, contrast: 1.06,
      shadowTint: '#d2c8ff', highlightTint: '#ffeed6',
      vignette: 0.38, glowTint: '#ffb47a', glow: 0.14,
    },
  },
  night: {
    top: '#060c22',
    mid: '#16264a',
    bottom: '#2a3350',
    sunGlow: '#9fb8ff',
    sunDir: [-0.4, 0.65, 0.5],
    hemiSky: '#5874b0',
    hemiGround: '#2d282c',
    hemiIntensity: 1.0,
    sunColor: '#a6c2ff',
    sunIntensity: 0.85,
    exposure: 1.18,
    fogNear: 25,
    fogFar: 320,
    post: {
      bloom: 0.55, bloomRadius: 0.45, bloomThreshold: 0.88,
      saturation: 1.18, contrast: 1.08,
      shadowTint: '#b4c4ff', highlightTint: '#ffe4c4',
      vignette: 0.48, glowTint: '#3a5aa8', glow: 0.1,
    },
  },
  monsoon: {
    top: '#182433',
    mid: '#2c3d4f',
    bottom: '#3a4b5c',
    sunGlow: '#b5d0ea',
    sunDir: [-0.35, 0.78, 0.42],
    hemiSky: '#7d97b2',
    hemiGround: '#28313a',
    hemiIntensity: 1.25,
    sunColor: '#b5d0ea',
    sunIntensity: 1.35,
    exposure: 1.08,
    fogNear: 18,
    fogFar: 235,
    post: {
      bloom: 0.6, bloomRadius: 0.55, bloomThreshold: 0.65,
      saturation: 0.95, contrast: 1.06,
      shadowTint: '#c4d8ff', highlightTint: '#eef4ff',
      vignette: 0.38, glowTint: '#8aa4c0', glow: 0.1,
    },
  },
};

/**
 * Reads World state (never writes it) and draws it with Three.js.
 * Interpolates between the previous and current sim tick by `alpha`.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly chase: ChaseCamera;
  private readonly garage: GarageScene;
  private garageMode = false;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private skyMat: THREE.ShaderMaterial;
  private post: PostFx;
  private timeOfDay: TimeOfDay = 'noon';
  private env: Scenery | null = null;
  private envKey = '';
  private attachSeq = 0;
  private fares: FareVisuals | null = null;
  private props: PropVisuals | null = null;
  private flame: THREE.Mesh;
  private effects = new Effects();
  private birds = new Birds();
  private tyres = new TyreFx();
  private rain = new RainFx();
  private sprayTimer = 0;
  private lightningTimer = 9;
  private lightningFlash = 0;
  onThunder: ((pan: number, intensity: number) => void) | null = null;
  private player: VehicleVisual | null = null;
  private playerVehicle: PlayerVehicle = 'alto';
  private readonly npcBatch: NpcTrafficBatch;
  private readonly occlusion = new CameraOcclusion();
  private readonly dprSteps: readonly number[];
  private dprStepIdx = 0;
  private activeWorld: AnyWorld | null = null;
  private readonly boundGroundY = (x: number, z: number): number =>
    this.activeWorld ? this.activeWorld.groundY(x, z) : 0;
  private readonly boundSlope = (x: number, z: number, heading: number): number =>
    this.activeWorld ? this.slope(this.activeWorld, x, z, heading) : 0;
  private readonly boundClipCamera = (camPos: THREE.Vector3, target: THREE.Vector3, dt: number): void => {
    const w = this.activeWorld;
    if (!w || w.mode !== 'city') return;
    const res = this.occlusion.resolve(
      w.map,
      this.boundGroundY,
      target.x,
      target.y,
      target.z,
      camPos.x,
      camPos.y,
      camPos.z,
      this.chase.minClipDist,
      dt,
    );
    camPos.set(res.x, res.y, res.z);
  };
  private readonly chaseInput: ChaseInput = {
    travel: 0,
    fovKick: 0,
    bump: 0,
    slide: 0,
    topSpeed: 30,
    clip: undefined,
  };
  private time = 0;
  private avgDt = 1 / 60;
  private slowFrames = 0;
  private perfEl: HTMLDivElement | null = null;
  private perfTimer = 0;
  private perfFrames = 0;
  private perfMsAcc = 0;
  private perfFps = 60;
  private tmp = new THREE.Vector3();

  private constructor(
    private readonly container: HTMLElement,
    private readonly factory: VehicleFactory,
    private readonly lowSpec: boolean,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: !lowSpec, powerPreference: 'high-performance' });
    this.gl.info.autoReset = false;
    const maxDpr = Math.min(window.devicePixelRatio || 1, lowSpec ? 1.5 : 2);
    const steps = [maxDpr, 1.5, 1.25, 1.0].filter((d) => d <= maxDpr + 1e-3);
    this.dprSteps = steps.filter((d, i) => i === 0 || Math.abs(d - steps[i - 1]) > 0.04);
    this.gl.setPixelRatio(this.dprSteps[0]);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = !lowSpec;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.gl.domElement);

    if (new URLSearchParams(window.location.search).has('perf')) {
      const el = document.createElement('div');
      el.className = 'perf-hud';
      el.textContent = 'FPS -- · CALLS -- · TRIS --';
      document.body.appendChild(el);
      this.perfEl = el;
    }

    this.chase = new ChaseCamera(1);
    const flameGeo = new THREE.ConeGeometry(0.11, 0.7, 8).rotateX(Math.PI / 2).translate(0, 0, 0.35);
    this.flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#7fd3ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flame.position.set(...FLAME_POS.alto);
    this.flame.visible = false;

    // Pale, dusty Karachi afternoon: hazy white-blue sky, harsh high sun.
    this.scene.background = HORIZON.clone();
    // Heavy coastal dust haze: distance washes out to pale grey-blue.
    this.scene.fog = new THREE.Fog(HORIZON, 25, 330);
    const sky = makeSky();
    this.skyMat = sky.material as THREE.ShaderMaterial;
    this.scene.add(sky);
    this.hemi = new THREE.HemisphereLight('#e6edf1', '#a8977a', 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    this.sun.position.set(-40, 60, 40);
    this.sun.castShadow = !lowSpec;
    this.sun.shadow.mapSize.set(512, 512);
    const sc = this.sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.effects.points);
    this.scene.add(this.tyres.group);
    this.scene.add(this.birds.mesh);
    this.scene.add(this.rain.group);

    this.npcBatch = new NpcTrafficBatch(this.factory);
    this.scene.add(this.npcBatch.group);

    this.post = new PostFx(this.gl, this.scene, this.chase.camera, this.lowSpec);
    this.post.setParams(LIGHTING.noon.post);
    const initW = container.clientWidth || window.innerWidth || 1280;
    const initH = container.clientHeight || window.innerHeight || 720;
    this.garage = new GarageScene(this.factory, initW / Math.max(1, initH), this.lowSpec);
    this.resize();
  }

  static async create(container: HTMLElement, lowSpec: boolean): Promise<Renderer> {
    const factory = new VehicleFactory();
    await factory.preload();
    return new Renderer(container, factory, lowSpec);
  }

  setGarageMode(active: boolean, vehicle?: PlayerVehicle, adjacentVehicle?: PlayerVehicle): void {
    this.garageMode = active;
    if (active) {
      if (vehicle !== undefined) this.garage.setVehicle(vehicle, adjacentVehicle);
      this.garage.update(0);
      this.gl.toneMappingExposure = this.garage.exposure;
    } else {
      this.gl.toneMappingExposure = LIGHTING[this.timeOfDay].exposure;
    }
  }

  setGarageVehicle(vehicle: PlayerVehicle, adjacentVehicle?: PlayerVehicle): void {
    this.garage.setVehicle(vehicle, adjacentVehicle);
  }

  setGarageBuild(vehicle: PlayerVehicle, build: VehicleBuild): void {
    this.garage.setVehicleBuild(vehicle, build);
  }

  getGarageProjection(): GarageProjection {
    return this.garage.getProjection();
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    const p = LIGHTING[tod];
    this.skyMat.uniforms.top.value.set(p.top);
    this.skyMat.uniforms.mid.value.set(p.mid);
    this.skyMat.uniforms.bottom.value.set(p.bottom);
    this.skyMat.uniforms.sunDir.value.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
    this.skyMat.uniforms.sunGlow.value.set(p.sunGlow);
    this.post.setParams(p.post);
    (this.scene.background as THREE.Color).set(p.bottom);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(p.bottom);
      this.scene.fog.near = p.fogNear;
      this.scene.fog.far = p.fogFar;
    }
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.rain.setEnabled(tod === 'monsoon');
    this.birds.mesh.visible = tod !== 'monsoon';
    this.env?.setTimeOfDay?.(tod);
    this.garage.setTimeOfDay(tod);
    this.gl.toneMappingExposure = this.garageMode ? this.garage.exposure : p.exposure;
  }

  /** (Re)bind to a world. Dynamically imports scenery modules and rebuilds static scenery only if the seed changed. */
  async attach(world: AnyWorld): Promise<void> {
    const seq = ++this.attachSeq;
    const key = world.mode === 'city' ? 'city' : `${world.mode}:${world.seed}`;
    let loadedEnv: Environment | null = null;
    let loadedScenery: CityScenery | null = null;
    let LoadedFares: (typeof FareVisuals) | null = null;
    let LoadedProps: (typeof PropVisuals) | null = null;

    if (world.mode === 'route') {
      if (this.envKey !== key) {
        const { Environment } = await import('./Environment');
        if (seq !== this.attachSeq) return;
        loadedEnv = new Environment(world.hazards, this.factory, this.lowSpec);
        loadedEnv.group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = false;
        });
      }
    } else {
      const needScenery = this.envKey !== key;
      const [sceneryMod, fareMod, propMod] = await Promise.all([
        needScenery ? import('./CityScenery') : Promise.resolve(null),
        import('./FareVisuals'),
        import('./PropVisuals'),
      ]);
      if (seq !== this.attachSeq) return;
      if (sceneryMod) loadedScenery = new sceneryMod.CityScenery(this.lowSpec);
      LoadedFares = fareMod.FareVisuals;
      LoadedProps = propMod.PropVisuals;
    }

    if (this.envKey !== key) {
      if (this.env) {
        this.scene.remove(this.env.group);
        this.env.dispose?.();
      }
      if (loadedEnv) {
        this.env = {
          group: loadedEnv.group,
          setTimeOfDay: (tod) => loadedEnv.setTimeOfDay(tod),
          update: (t, _x, z) => loadedEnv.update(t, z),
          dispose: () => loadedEnv.dispose(),
        };
      } else if (loadedScenery) {
        this.env = loadedScenery;
      }
      if (this.env) this.scene.add(this.env.group);
      this.envKey = key;
    }
    if (this.fares) {
      this.scene.remove(this.fares.group);
      this.fares.dispose();
    }
    if (this.props) {
      this.scene.remove(this.props.group);
      this.props.dispose();
    }
    this.fares = null;
    this.props = null;
    if (world.mode === 'city' && LoadedFares && LoadedProps) {
      this.fares = new LoadedFares();
      this.scene.add(this.fares.group);
      this.props = new LoadedProps(world.props, !this.lowSpec);
      this.scene.add(this.props.group);
    }
    const veh = world.player.vehicle;
    if (!this.player || this.playerVehicle !== veh) {
      if (this.player) {
        this.player.body.remove(this.flame);
        this.scene.remove(this.player.root);
      }
      this.playerVehicle = veh;
      this.player = this.factory.create(veh, 0, true);
      this.player.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name !== 'underglow') {
          const mat = o.material as THREE.Material;
          o.castShadow = !this.lowSpec && (mat?.name === 'paint' || o.name === 'part_vc');
        }
      });
      this.scene.add(this.player.root);
      // Exhaust flame for boosts (tailpipe under the rear bumper, driver's side).
      this.flame.position.set(...FLAME_POS[veh]);
      this.player.body.add(this.flame);
    }
    this.player.applyBuild(world.player.build);
    const preset = CAMERA_PRESETS[veh];
    this.chase.distScale = preset.distScale;
    this.chase.heightScale = preset.heightScale;
    this.chase.lookHeight = preset.lookHeight;
    this.chase.aheadScale = preset.aheadScale;
    this.chase.minClipDist = preset.minClipDist;
    this.npcBatch.clear();
    this.chase.reset();
    this.occlusion.reset();
    this.tyres.clear();
    this.setTimeOfDay(this.timeOfDay);
    // Compile every shader now, so nothing pops in (or hitches) the first
    // time it is drawn: a new road material, the first skid, the first puff.
    this.gl.compile(this.scene, this.chase.camera);
    this.gl.info.reset();
    this.perfTimer = 0.25;
    this.perfFrames = 0;
    this.perfMsAcc = 0;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.chase.resize(w / h);
    this.post?.setSize(w, h);
    this.garage.resize(w, h);
  }

  handleEvent(e: SimEvent, world: AnyWorld): void {
    const p = world.player;
    const y = world.groundY(p.x, p.z);
    switch (e.type) {
      case 'towed':
        this.tyres.clear();
        this.chase.reset();
        this.occlusion.reset();
        break;
      case 'smash':
        this.effects.dust(e.x, world.groundY(e.x, e.z), -e.z, Math.min(1, e.impact / 15));
        this.chase.addTrauma(0.06 + Math.min(0.18, e.impact / 80));
        break;
      case 'land':
        this.effects.dust(p.x, y, -p.z, Math.min(1, e.impact / 8));
        this.chase.addTrauma(0.15 + Math.min(0.5, e.impact / 18));
        break;
      case 'boost':
        this.chase.addTrauma(0.12);
        break;
      case 'kerb':
        this.chase.addTrauma(0.08 + e.severity * 0.2);
        break;
      case 'crash':
        this.effects.sparks(e.x, world.groundY(e.x, e.z) + 0.4, -e.z, Math.min(1, e.impact / 15));
        this.chase.addTrauma(0.25 + Math.min(0.6, e.impact / 20));
        break;
      case 'pothole':
        this.effects.dust(p.x, y, -p.z, e.severity);
        this.chase.addTrauma(0.15 + e.severity * 0.3);
        break;
      case 'manhole':
        this.effects.dust(p.x, y, -p.z, 1);
        this.chase.addTrauma(0.7);
        break;
      case 'splash':
        this.effects.splash(p.x, y, -p.z);
        this.chase.addTrauma(0.1);
        break;
      case 'scrape':
        if (Math.random() < 0.5) this.effects.sparks(p.x + Math.sign(p.x) * 0.8, y, -p.z, 0.05);
        break;
      default:
        break;
    }
  }

  /** Nose-up pitch of the ground under a vehicle (three-space radians). */
  private slope(world: AnyWorld, x: number, z: number, heading: number): number {
    const fx = Math.sin(heading) * 1.2, fz = Math.cos(heading) * 1.2;
    return Math.atan2(world.groundY(x + fx, z + fz) - world.groundY(x - fx, z - fz), 2.4);
  }

  render(world: AnyWorld, alpha: number, dt: number): void {
    this.gl.info.reset();
    this.time += dt;
    if (dt > 0 && dt < 0.1) {
      this.avgDt = this.avgDt * 0.96 + dt * 0.04;
      if (this.avgDt > 1 / 34) {
        this.slowFrames++;
        if (this.slowFrames > 90 && this.dprStepIdx + 1 < this.dprSteps.length) {
          this.dprStepIdx++;
          this.gl.setPixelRatio(this.dprSteps[this.dprStepIdx]);
          this.resize();
          this.slowFrames = 0;
        }
      } else {
        this.slowFrames = Math.max(0, this.slowFrames - 1);
      }
    }
    if (this.garageMode) {
      this.garage.update(dt);
      this.gl.autoClear = true;
      this.gl.setRenderTarget(null);
      this.gl.toneMapping = THREE.ACESFilmicToneMapping;
      this.gl.toneMappingExposure = this.garage.exposure;
      const t0 = performance.now();
      this.garage.render(this.gl);
      const renderMs = performance.now() - t0;
      this.recordPerf(dt, renderMs, 'garage');
      return;
    }
    this.activeWorld = world;
    const p = world.player;
    const lowLight = this.timeOfDay !== 'noon';

    // ---- Player -----------------------------------------------------------
    const px = mix(p.prevX, p.x, alpha);
    const pz = mix(p.prevZ, p.z, alpha);
    const heading = mix(p.prevHeading, p.heading, alpha);
    const elev = mix(p.prevY, p.y, alpha);
    const bump = mix(p.prevBump, p.bump, alpha);
    const slope = p.airborne ? 0 : this.slope(world, px, pz, heading);
    if (this.player) {
      const v = this.player;
      v.root.position.set(px, elev, -pz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(slope, -heading, 0);
      v.body.rotation.set(mix(p.prevPitch, p.pitch, alpha), 0, -mix(p.prevRoll, p.roll, alpha));
      v.body.position.y = bump * 0.6;
      v.setBrake(p.braking || p.reversing);
      v.setHeadlights(p.dipper ? 2 : 1, lowLight);
      v.setHazard(world.phase === 'gameover' && Math.floor(this.time * 3) % 2 === 0);
      for (const w of v.wheels) {
        w.rotation.order = 'YXZ';
        w.rotation.x -= (p.speed * dt) / v.wheelRadius;
        if (w.position.z < 0) w.rotation.y = -p.steerAngle;
      }
    }

    // ---- NPCs (batched into 4 noon / 5 night WebGL2 draw calls) -----------
    this.npcBatch.update(world.npcs, alpha, this.time, lowLight, this.boundGroundY, this.boundSlope);

    // ---- Camera / world -----------------------------------------------------
    const slide = this.tyres.update(dt, p, px, pz, heading, this.boundGroundY, this.chase.pixelScale(this.gl.domElement.height));
    this.tmp.set(px, elev, -pz);
    this.chaseInput.travel = p.travel;
    this.chaseInput.fovKick = world.speedRush();
    this.chaseInput.bump = bump;
    this.chaseInput.slide = Math.max(slide.front, slide.rear);
    this.chaseInput.topSpeed = world.topSpeed();
    this.chaseInput.clip = world.mode === 'city' ? this.boundClipCamera : undefined;
    this.chase.update(dt, this.tmp, heading, p.speed, this.chaseInput);

    const pLight = LIGHTING[this.timeOfDay];
    if (this.timeOfDay === 'monsoon' && dt > 0) {
      this.rain.update(dt, px, elev, -pz);
      this.sprayTimer -= dt;
      if (!p.airborne && Math.abs(p.speed) > 7 && this.sprayTimer <= 0) {
        this.sprayTimer = 0.045;
        const backX = px - Math.sin(heading) * (p.spec.halfLength * 0.85);
        const backZ = pz - Math.cos(heading) * (p.spec.halfLength * 0.85);
        this.effects.spray(backX, elev, -backZ, Math.min(1, (Math.abs(p.speed) - 7) / 18));
      }
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 10 + Math.random() * 11;
        this.lightningFlash = 1.0;
        const pan = (Math.random() - 0.5) * 1.4;
        this.onThunder?.(pan, 0.7 + Math.random() * 0.3);
      }
      if (this.lightningFlash > 0) {
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 5.2);
        const pulse = this.lightningFlash > 0.45 && this.lightningFlash < 0.65 ? 0.2 : this.lightningFlash;
        this.sun.intensity = pLight.sunIntensity + pulse * 3.2;
        this.hemi.intensity = pLight.hemiIntensity + pulse * 1.4;
        this.gl.toneMappingExposure = pLight.exposure + pulse * 0.35;
      } else {
        this.sun.intensity = pLight.sunIntensity;
        this.hemi.intensity = pLight.hemiIntensity;
        this.gl.toneMappingExposure = pLight.exposure;
      }
    }
    this.sun.position.set(px + pLight.sunDir[0] * 75, elev + pLight.sunDir[1] * 85, -pz + pLight.sunDir[2] * 75);
    this.birds.update(dt, pz, elev, this.time);
    this.sun.target.position.set(px, elev, -pz);
    this.sun.target.updateMatrixWorld();
    this.env?.update(this.time, px, pz);
    if (world.mode === 'city') {
      this.fares?.update(world.fares, px, pz, this.time, world.pedestrians.peds);
      this.props?.update(world.props, px, pz);
    }
    // Boost flame flicker.
    this.flame.visible = p.boostTime > 0;
    if (this.flame.visible) {
      const f = 0.75 + Math.random() * 0.5;
      this.flame.scale.set(f, f, (0.8 + Math.random() * 0.7) * Math.min(1, p.boostTime * 3 + 0.3));
      (this.flame.material as THREE.MeshBasicMaterial).color.copy(Math.random() < 0.5 ? FLAME_CYAN : FLAME_AMBER);
    }
    this.effects.update(dt);

    const t0 = performance.now();
    this.post.render();
    const renderMs = performance.now() - t0;
    this.recordPerf(dt, renderMs, world.mode);
  }

  private recordPerf(dt: number, renderMs: number, mode: string): void {
    if (dt > 0) {
      this.perfFrames++;
      this.perfMsAcc += dt;
      this.perfTimer += dt;
      if (this.perfTimer >= 0.25) {
        this.perfFps = this.perfFrames / Math.max(1e-3, this.perfMsAcc);
        const info = this.gl.info.render;
        const chunks = this.garageMode ? null : (this.env?.visibleChunks ?? null);
        const snap = {
          fps: +this.perfFps.toFixed(1),
          ms: +(1000 / Math.max(1, this.perfFps)).toFixed(1),
          renderMs: +renderMs.toFixed(2),
          calls: info.calls,
          triangles: info.triangles,
          geometries: this.gl.info.memory.geometries,
          textures: this.gl.info.memory.textures,
          dpr: +this.gl.getPixelRatio().toFixed(2),
          visibleChunks: chunks,
          mode,
          timeOfDay: this.timeOfDay,
          postTier: this.post.tier,
        };
        (window as unknown as { __KT3D_PERF__?: typeof snap }).__KT3D_PERF__ = snap;
        if (this.perfEl) {
          const chStr = chunks !== null ? ` · CHUNKS ${chunks}` : '';
          this.perfEl.textContent =
            `${snap.fps.toFixed(0)} FPS (${snap.ms.toFixed(1)} ms) · CALLS ${snap.calls} · TRIS ${(snap.triangles / 1000).toFixed(1)}k · DPR ${snap.dpr}${chStr}`;
        }
        this.perfFrames = 0;
        this.perfMsAcc = 0;
        this.perfTimer = 0;
      }
    } else if (this.perfEl || !(window as unknown as { __KT3D_PERF__?: unknown }).__KT3D_PERF__) {
      const info = this.gl.info.render;
      const chunks = this.garageMode ? null : (this.env?.visibleChunks ?? null);
      const snap = {
        fps: +this.perfFps.toFixed(1),
        ms: +(1000 / Math.max(1, this.perfFps)).toFixed(1),
        renderMs: +renderMs.toFixed(2),
        calls: info.calls,
        triangles: info.triangles,
        geometries: this.gl.info.memory.geometries,
        textures: this.gl.info.memory.textures,
        dpr: +this.gl.getPixelRatio().toFixed(2),
        visibleChunks: chunks,
        mode,
        timeOfDay: this.timeOfDay,
        postTier: this.post.tier,
      };
      (window as unknown as { __KT3D_PERF__?: typeof snap }).__KT3D_PERF__ = snap;
      if (this.perfEl) {
        const chStr = chunks !== null ? ` · CHUNKS ${chunks}` : '';
        this.perfEl.textContent =
          `PAUSED · CALLS ${snap.calls} · TRIS ${(snap.triangles / 1000).toFixed(1)}k · DPR ${snap.dpr}${chStr}`;
      }
    }
  }
}

function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(480, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#9ec0d8') },
      mid: { value: new THREE.Color('#dde1db') },
      bottom: { value: HORIZON.clone() },
      // Matches the directional light (sun behind-left of the camera).
      sunDir: { value: new THREE.Vector3(-0.49, 0.73, 0.49).normalize() },
      sunGlow: { value: new THREE.Color('#fff1d0') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunGlow;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.16, h));
        c = mix(c, top, smoothstep(0.16, 0.75, h));
        float s = max(dot(d, sunDir), 0.0);
        // Horizon glow brightest under the sun, sun disc (HDR → blooms) and halo
        float side = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0), 3.0);
        c += sunGlow * side * (1.0 - smoothstep(0.0, 0.35, abs(h - 0.02))) * 0.35;
        c += sunGlow * (smoothstep(0.9985, 0.9993, s) * 6.0 + pow(s, 48.0) * 0.8 + pow(s, 6.0) * 0.22);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  // Follow the camera so it never clips.
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  return sky;
}
