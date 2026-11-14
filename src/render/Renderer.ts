import * as THREE from 'three';
import type { CityWorld } from '../sim/city/CityWorld';
import type { SimEvent } from '../sim/types';
import type { World } from '../sim/World';
import { Birds } from './Birds';
import { ChaseCamera } from './ChaseCamera';
import { CityScenery } from './CityScenery';
import { Effects } from './Effects';
import { Environment } from './Environment';
import { FareVisuals } from './FareVisuals';
import { PropVisuals } from './PropVisuals';
import { TyreFx } from './TyreFx';
import { VehicleFactory } from './VehicleFactory';
import type { VehicleVisual, VisualKind } from './VehicleFactory';

export type AnyWorld = World | CityWorld;

interface Scenery {
  group: THREE.Group;
  update(time: number, x: number, z: number): void;
}

/** Dusty, bleached Karachi horizon. */
const HORIZON = new THREE.Color('#d3d5cc');

/**
 * Reads World state (never writes it) and draws it with Three.js.
 * Interpolates between the previous and current sim tick by `alpha`.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly chase: ChaseCamera;
  private sun: THREE.DirectionalLight;
  private env: Scenery | null = null;
  private envKey = '';
  private fares: FareVisuals | null = null;
  private props: PropVisuals | null = null;
  private flame: THREE.Mesh;
  private effects = new Effects();
  private birds = new Birds();
  private tyres = new TyreFx();
  private player: VehicleVisual | null = null;
  private npcVisuals = new Map<number, VehicleVisual>();
  private pool = new Map<string, VehicleVisual[]>();
  private time = 0;
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

    this.chase = new ChaseCamera(1);
    const flameGeo = new THREE.ConeGeometry(0.11, 0.7, 8).rotateX(Math.PI / 2).translate(0, 0, 0.35);
    this.flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#7fd3ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flame.position.set(-0.42, 0.3, 1.72);
    this.flame.visible = false;

    // Pale, dusty Karachi afternoon: hazy white-blue sky, harsh high sun.
    this.scene.background = HORIZON.clone();
    // Heavy coastal dust haze: distance washes out to pale grey-blue.
    this.scene.fog = new THREE.Fog(HORIZON, 25, 330);
    this.scene.add(makeSky());
    this.scene.add(new THREE.HemisphereLight('#e6edf1', '#a8977a', 1.5));
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

    this.resize();
  }

  static async create(container: HTMLElement, lowSpec: boolean): Promise<Renderer> {
    const factory = new VehicleFactory();
    await factory.preload();
    return new Renderer(container, factory, lowSpec);
  }

  /** (Re)bind to a world. Rebuilds static scenery only if the seed changed. */
  attach(world: AnyWorld): void {
    const key = `${world.mode}:${world.seed}`;
    if (this.envKey !== key) {
      if (this.env) this.scene.remove(this.env.group);
      if (world.mode === 'route') {
        const env = new Environment(world.hazards, this.factory, this.lowSpec);
        this.env = { group: env.group, update: (t, _x, z) => env.update(t, z) };
      } else {
        this.env = new CityScenery(this.lowSpec);
      }
      this.scene.add(this.env.group);
      this.envKey = key;
    }
    if (this.fares) this.scene.remove(this.fares.group);
    if (this.props) this.scene.remove(this.props.group);
    this.fares = null;
    this.props = null;
    if (world.mode === 'city') {
      this.fares = new FareVisuals();
      this.scene.add(this.fares.group);
      this.props = new PropVisuals(world.props, !this.lowSpec);
      this.scene.add(this.props.group);
    }
    if (!this.player) {
      this.player = this.factory.create('alto', 0);
      this.scene.add(this.player.root);
      // Exhaust flame for boosts (tailpipe under the rear bumper, driver's side).
      this.player.body.add(this.flame);
    }
    for (const [id, v] of this.npcVisuals) this.release(v, id);
    this.npcVisuals.clear();
    this.chase.reset();
    this.tyres.clear();
    // Compile every shader now, so nothing pops in (or hitches) the first
    // time it is drawn: a new road material, the first skid, the first puff.
    this.gl.compile(this.scene, this.chase.camera);
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
    const v = list?.pop() ?? this.factory.create(kind, variant);
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

  render(world: AnyWorld, alpha: number, dt: number): void {
    this.time += dt;
    const p = world.player;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

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
      v.setHeadlights(p.dipper ? 2 : 1);
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
    });

    this.sun.position.set(px - 40, elev + 60, -pz + 25);
    this.birds.update(dt, pz, elev, this.time);
    this.sun.target.position.set(px, elev, -pz - 15);
    this.env?.update(this.time, px, pz);
    if (world.mode === 'city') {
      this.fares?.update(world.fares, px, pz, this.time);
      this.props?.update(world.props);
    }
    // Boost flame flicker.
    this.flame.visible = p.boostTime > 0;
    if (this.flame.visible) {
      const f = 0.75 + Math.random() * 0.5;
      this.flame.scale.set(f, f, (0.8 + Math.random() * 0.7) * Math.min(1, p.boostTime * 3 + 0.3));
      (this.flame.material as THREE.MeshBasicMaterial).color.set(Math.random() < 0.5 ? '#7fd3ff' : '#ffb347');
    }
    this.effects.update(dt);

    this.gl.render(this.scene, this.chase.camera);
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
