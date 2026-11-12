import * as THREE from 'three';
import { elevationAt, sampleRoad, ZONES } from '../sim/road';
import type { SimEvent } from '../sim/types';
import type { World } from '../sim/World';
import { Birds } from './Birds';
import { ChaseCamera } from './ChaseCamera';
import { Effects } from './Effects';
import { Environment } from './Environment';
import { VehicleFactory } from './VehicleFactory';
import type { VehicleVisual, VisualKind } from './VehicleFactory';

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
  private env: Environment | null = null;
  private envSeed = -1;
  private effects = new Effects();
  private birds = new Birds();
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
    this.scene.add(this.birds.mesh);

    this.resize();
  }

  static async create(container: HTMLElement, lowSpec: boolean): Promise<Renderer> {
    const factory = new VehicleFactory();
    await factory.preload();
    return new Renderer(container, factory, lowSpec);
  }

  /** (Re)bind to a world. Rebuilds static scenery only if the seed changed. */
  attach(world: World): void {
    if (this.envSeed !== world.seed) {
      if (this.env) this.scene.remove(this.env.group);
      this.env = new Environment(world.hazards, this.factory, this.lowSpec);
      this.scene.add(this.env.group);
      this.envSeed = world.seed;
    }
    if (!this.player) {
      this.player = this.factory.create('alto', 0);
      this.scene.add(this.player.root);
    }
    for (const [id, v] of this.npcVisuals) this.release(v, id);
    this.npcVisuals.clear();
    this.chase.reset();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.chase.resize(w / h);
  }

  handleEvent(e: SimEvent, world: World): void {
    const p = world.player;
    const y = elevationAt(p.z);
    switch (e.type) {
      case 'crash':
        this.effects.sparks(e.x, elevationAt(e.z), -e.z, Math.min(1, e.impact / 15));
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

  render(world: World, alpha: number, dt: number): void {
    this.time += dt;
    const p = world.player;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // ---- Player -----------------------------------------------------------
    const px = lerp(p.prevX, p.x);
    const pz = lerp(p.prevZ, p.z);
    const heading = lerp(p.prevHeading, p.heading);
    const elev = elevationAt(pz);
    const slope = Math.atan2(elevationAt(pz + 1.2) - elevationAt(pz - 1.2), 2.4);
    if (this.player) {
      const v = this.player;
      v.root.position.set(px, elev, -pz);
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
    for (const n of world.traffic.npcs) {
      seen.add(n.id);
      let v = this.npcVisuals.get(n.id);
      if (!v) {
        v = this.acquire(n.kind, n.variant);
        v.root.userData.variant = n.variant;
        this.npcVisuals.set(n.id, v);
      }
      const nz = lerp(n.prevZ, n.z);
      const nh = lerp(n.prevHeading, n.heading);
      const ne = elevationAt(nz);
      const ns = Math.atan2(elevationAt(nz + 1.2) - elevationAt(nz - 1.2), 2.4) * n.dir;
      v.root.position.set(lerp(n.prevX, n.x), ne, -nz);
      v.root.rotation.set(ns, -nh, 0);
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
    const road = sampleRoad(pz);
    const expressway = ZONES[road.zoneIndex].elevated;
    const kick = expressway ? Math.max(0, Math.min(1, (p.speed - 20) / 14)) : 0;
    this.tmp.set(px, elev, -pz);
    this.chase.update(dt, this.tmp, heading, p.speed, kick, lerp(p.prevBump, p.bump));

    this.sun.position.set(px - 40, elev + 60, -pz + 25);
    this.birds.update(dt, pz, elev, this.time);
    this.sun.target.position.set(px, elev, -pz - 15);
    this.env?.update(this.time, pz);
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
