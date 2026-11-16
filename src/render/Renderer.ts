import * as THREE from 'three';
import type { CityWorld } from '../sim/city/CityWorld';
import { pointObbDistance } from '../sim/math';
import type { PlayerVehicle, SimEvent } from '../sim/types';
import type { World } from '../sim/World';
import { Birds } from './Birds';
import { ChaseCamera } from './ChaseCamera';
import type { CityScenery } from './CityScenery';
import { Effects } from './Effects';
import type { Environment } from './Environment';
import type { FareVisuals } from './FareVisuals';
import type { PropVisuals } from './PropVisuals';
import { RainFx } from './RainFx';
import { TyreFx } from './TyreFx';
import { VehicleFactory } from './VehicleFactory';
import type { VehicleVisual, VisualKind } from './VehicleFactory';

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

const FLAME_POS: Record<PlayerVehicle, readonly [number, number, number]> = {
  alto: [-0.42, 0.3, 1.72],
  rickshaw: [-0.28, 0.25, 1.38],
  minibus: [-0.75, 0.42, 4.15],
};

interface LightingPreset {
  top: string;
  mid: string;
  bottom: string;
  sunDir: readonly [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  exposure: number;
}

const LIGHTING: Record<TimeOfDay, LightingPreset> = {
  noon: {
    top: '#9ec0d8',
    mid: '#dde1db',
    bottom: '#d3d5cc',
    sunDir: [-0.49, 0.73, 0.49],
    hemiSky: '#e6edf1',
    hemiGround: '#a8977a',
    hemiIntensity: 1.5,
    sunColor: '#fff1d6',
    sunIntensity: 2.6,
    exposure: 1.0,
  },
  sunset: {
    top: '#32386b',
    mid: '#df7b5c',
    bottom: '#e7ab7f',
    sunDir: [-0.82, 0.22, -0.52],
    hemiSky: '#ffd3aa',
    hemiGround: '#72524c',
    hemiIntensity: 1.25,
    sunColor: '#ffa25b',
    sunIntensity: 2.4,
    exposure: 1.06,
  },
  night: {
    top: '#091129',
    mid: '#19294c',
    bottom: '#202d45',
    sunDir: [-0.4, 0.65, 0.5],
    hemiSky: '#5874b0',
    hemiGround: '#2d282c',
    hemiIntensity: 1.05,
    sunColor: '#a6c2ff',
    sunIntensity: 0.9,
    exposure: 1.18,
  },
  monsoon: {
    top: '#182433',
    mid: '#2c3d4f',
    bottom: '#3a4b5c',
    sunDir: [-0.35, 0.78, 0.42],
    hemiSky: '#7d97b2',
    hemiGround: '#28313a',
    hemiIntensity: 1.25,
    sunColor: '#b5d0ea',
    sunIntensity: 1.35,
    exposure: 1.08,
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
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private skyMat: THREE.ShaderMaterial;
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
  private npcVisuals = new Map<number, VehicleVisual>();
  private pool = new Map<string, VehicleVisual[]>();
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
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, lowSpec ? 1.5 : 2));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = !lowSpec;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
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
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.effects.points);
    this.scene.add(this.tyres.group);
    this.scene.add(this.birds.mesh);
    this.scene.add(this.rain.group);

    this.resize();
  }

  static async create(container: HTMLElement, lowSpec: boolean): Promise<Renderer> {
    const factory = new VehicleFactory();
    await factory.preload();
    return new Renderer(container, factory, lowSpec);
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    const p = LIGHTING[tod];
    this.skyMat.uniforms.top.value.set(p.top);
    this.skyMat.uniforms.mid.value.set(p.mid);
    this.skyMat.uniforms.bottom.value.set(p.bottom);
    this.skyMat.uniforms.sunDir.value.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
    (this.scene.background as THREE.Color).set(p.bottom);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(p.bottom);
      this.scene.fog.near = tod === 'monsoon' ? 18 : 25;
      this.scene.fog.far = tod === 'monsoon' ? 235 : 330;
    }
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.gl.toneMappingExposure = p.exposure;
    this.rain.setEnabled(tod === 'monsoon');
    this.birds.mesh.visible = tod !== 'monsoon';
    this.env?.setTimeOfDay?.(tod);
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
      this.scene.add(this.player.root);
      // Exhaust flame for boosts (tailpipe under the rear bumper, driver's side).
      this.flame.position.set(...FLAME_POS[veh]);
      this.player.body.add(this.flame);
    }
    this.chase.vehicleScale = veh === 'minibus' ? 1.48 : 1.0;
    for (const [id, v] of this.npcVisuals) this.release(v, id);
    this.npcVisuals.clear();
    this.chase.reset();
    this.tyres.clear();
    this.setTimeOfDay(this.timeOfDay);
    // Compile every shader now, so nothing pops in (or hitches) the first
    // time it is drawn: a new road material, the first skid, the first puff.
    this.gl.compile(this.scene, this.chase.camera);
    this.perfTimer = 0.25;
    this.perfFrames = 0;
    this.perfMsAcc = 0;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.chase.resize(w / h);
  }

  handleEvent(e: SimEvent, world: AnyWorld): void {
    const p = world.player;
    const y = world.groundY(p.x, p.z);
    switch (e.type) {
      case 'towed':
        this.tyres.clear();
        this.chase.reset();
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

  private visualKey(kind: VisualKind, variant: number): string {
    return `${kind}:${variant}`;
  }

  private acquire(kind: VisualKind, variant: number): VehicleVisual {
    const list = this.pool.get(this.visualKey(kind, variant));
    const v = list?.pop() ?? this.factory.create(kind, variant, false);
    v.root.visible = true;
    this.scene.add(v.root);
    return v;
  }

  private release(v: VehicleVisual, variantId: number): void {
    void variantId;
    this.scene.remove(v.root);
    const variant = (v.root.userData.variant as number | undefined) ?? 0;
    const key = this.visualKey(v.kind, variant);
    let list = this.pool.get(key);
    if (!list) this.pool.set(key, (list = []));
    list.push(v);
  }

  /** Nose-up pitch of the ground under a vehicle (three-space radians). */
  private slope(world: AnyWorld, x: number, z: number, heading: number): number {
    const fx = Math.sin(heading) * 1.2, fz = Math.cos(heading) * 1.2;
    return Math.atan2(world.groundY(x + fx, z + fz) - world.groundY(x - fx, z - fz), 2.4);
  }

  /** Pull chase camera inside building OBBs in Saddar so awnings/walls never occlude the car. */
  private clipCamera(world: CityWorld, camPos: THREE.Vector3, target: THREE.Vector3): void {
    const horizDist = Math.hypot(camPos.x - target.x, camPos.z - target.z);
    // Keep camera outside the player's own vehicle body (minibus is ~4.15m half-length).
    const minT = Math.min(0.86, Math.max(0.35, (this.chase.vehicleScale > 1.05 ? 4.35 : 2.1) / Math.max(1, horizDist)));
    let bestT = 1;
    for (const t of [minT, 0.55, 0.72, 0.86, 1.0]) {
      const x = target.x + (camPos.x - target.x) * t;
      const y = target.y + (camPos.y - target.y) * t;
      const z = target.z + (camPos.z - target.z) * t;
      let hit = false;
      world.map.forEachSolidNear(x, -z, 2.5, (b) => {
        if (y < 10 && pointObbDistance(x, -z, b) < 1.85) hit = true;
      });
      if (hit) {
        bestT = Math.min(bestT, Math.max(minT, t - 0.14));
        break;
      }
    }
    if (bestT < 1) {
      camPos.x = target.x + (camPos.x - target.x) * bestT;
      camPos.z = target.z + (camPos.z - target.z) * bestT;
      camPos.y = Math.min(target.y + 2.25, Math.max(camPos.y, target.y + 1.65) + (1 - bestT) * 0.25);
    }
  }

  render(world: AnyWorld, alpha: number, dt: number): void {
    this.time += dt;
    if (dt > 0 && dt < 0.1) {
      this.avgDt = this.avgDt * 0.96 + dt * 0.04;
      if (this.avgDt > 1 / 34) {
        this.slowFrames++;
        if (this.slowFrames > 90 && this.gl.getPixelRatio() > 1) {
          this.gl.setPixelRatio(1);
          this.resize();
          this.slowFrames = 0;
        }
      } else {
        this.slowFrames = Math.max(0, this.slowFrames - 1);
      }
    }
    const p = world.player;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const lowLight = this.timeOfDay !== 'noon';

    // ---- Player -----------------------------------------------------------
    const px = lerp(p.prevX, p.x);
    const pz = lerp(p.prevZ, p.z);
    const heading = lerp(p.prevHeading, p.heading);
    const elev = lerp(p.prevY, p.y);
    const slope = p.airborne ? 0 : this.slope(world, px, pz, heading);
    if (this.player) {
      const v = this.player;
      v.root.position.set(px, elev, -pz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(slope, -heading, 0);
      v.body.rotation.set(lerp(p.prevPitch, p.pitch), 0, -lerp(p.prevRoll, p.roll));
      v.body.position.y = lerp(p.prevBump, p.bump) * 0.6;
      v.setBrake(p.braking || p.reversing);
      v.setHeadlights(p.dipper ? 2 : 1, lowLight);
      v.setHazard(world.phase === 'gameover' && Math.floor(this.time * 3) % 2 === 0);
      for (const w of v.wheels) {
        w.rotation.order = 'YXZ';
        w.rotation.x -= (p.speed * dt) / v.wheelRadius;
        if (w.position.z < 0) w.rotation.y = -p.steerAngle;
      }
    }

    // ---- NPCs --------------------------------------------------------------
    const seen = new Set<number>();
    const blink = Math.floor(this.time * 2.5) % 2 === 0;
    for (const n of world.npcs) {
      seen.add(n.id);
      let v = this.npcVisuals.get(n.id);
      if (!v) {
        v = this.acquire(n.kind, n.variant);
        v.root.userData.variant = n.variant;
        this.npcVisuals.set(n.id, v);
      }
      const nx = lerp(n.prevX, n.x);
      const nz = lerp(n.prevZ, n.z);
      const nh = lerp(n.prevHeading, n.heading);
      const ne = world.groundY(nx, nz);
      v.root.position.set(nx, ne, -nz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(this.slope(world, nx, nz, nh), -nh, 0);
      const lean = n.kind === 'bike' ? -n.latVel * 0.12 * n.dir : -n.latVel * 0.02 * n.dir;
      v.body.rotation.z = Math.max(-0.35, Math.min(0.35, lean));
      v.setBrake(n.brakeLights);
      v.setHazard(n.hazardLights && blink);
      v.setHeadlights(lowLight ? 1 : 0, lowLight);
    }
    for (const [id, v] of this.npcVisuals) {
      if (!seen.has(id)) {
        this.release(v, id);
        this.npcVisuals.delete(id);
      }
    }

    // ---- Camera / world -----------------------------------------------------
    const ground = (x: number, z: number) => world.groundY(x, z);
    const slide = this.tyres.update(dt, p, px, pz, heading, ground, this.chase.pixelScale(this.gl.domElement.height));
    this.tmp.set(px, elev, -pz);
    this.chase.update(dt, this.tmp, heading, p.speed, {
      travel: p.travel,
      fovKick: world.speedRush(),
      bump: lerp(p.prevBump, p.bump),
      slide: Math.max(slide.front, slide.rear),
      topSpeed: world.topSpeed(),
      clip: world.mode === 'city' ? (camPos, target) => this.clipCamera(world, camPos, target) : undefined,
    });

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
    this.sun.target.position.set(px, elev, -pz - 15);
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
      (this.flame.material as THREE.MeshBasicMaterial).color.set(Math.random() < 0.5 ? '#7fd3ff' : '#ffb347');
    }
    this.effects.update(dt);

    const t0 = performance.now();
    this.gl.render(this.scene, this.chase.camera);
    const renderMs = performance.now() - t0;

    if (dt > 0) {
      this.perfFrames++;
      this.perfMsAcc += dt;
      this.perfTimer += dt;
      if (this.perfTimer >= 0.25) {
        this.perfFps = this.perfFrames / Math.max(1e-3, this.perfMsAcc);
        const info = this.gl.info.render;
        const chunks = this.env?.visibleChunks ?? null;
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
          mode: world.mode,
          timeOfDay: this.timeOfDay,
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
      const chunks = this.env?.visibleChunks ?? null;
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
        mode: world.mode,
        timeOfDay: this.timeOfDay,
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
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.12, h));
        c = mix(c, top, smoothstep(0.12, 0.7, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.82, 0.5) * (pow(s, 600.0) * 1.5 + pow(s, 8.0) * 0.25);
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
