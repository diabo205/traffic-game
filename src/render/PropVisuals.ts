import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROP_SPECS } from '../sim/city/Props';
import type { PropKind, Props } from '../sim/city/Props';
import { Rng } from '../sim/rng';
import { paint } from './strip';

type G = THREE.BufferGeometry;

function part(g: G, color: string, x = 0, y = 0, z = 0): G {
  g.translate(x, y, z);
  paint(g, color);
  return g.index ? g.toNonIndexed() : g;
}

function merge(parts: G[]): G {
  // Keep only the attributes every part has.
  for (const g of parts) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  return mergeGeometries(parts) ?? new THREE.BoxGeometry(0.5, 0.5, 0.5);
}

/** Low-poly street clutter. Built standing on y = 0, front along -z (three). */
function propGeometry(kind: PropKind): G {
  const p: G[] = [];
  switch (kind) {
    case 'cone':
      p.push(part(new THREE.BoxGeometry(0.42, 0.04, 0.42), '#1d1d1d', 0, 0.02, 0));
      p.push(part(new THREE.ConeGeometry(0.17, 0.66, 10), '#ff6d00', 0, 0.37, 0));
      p.push(part(new THREE.CylinderGeometry(0.105, 0.125, 0.12, 10), '#f5f5f5', 0, 0.42, 0));
      break;
    case 'fruitcart': {
      // Wooden thela with two big spoked wheels and a heap of fruit.
      p.push(part(new THREE.BoxGeometry(1.15, 0.08, 2.1), '#8a5a2b', 0, 0.78, 0));
      p.push(part(new THREE.BoxGeometry(1.2, 0.14, 0.06), '#6d4320', 0, 0.86, 1.05));
      p.push(part(new THREE.BoxGeometry(1.2, 0.14, 0.06), '#6d4320', 0, 0.86, -1.05));
      for (const sx of [-0.62, 0.62]) {
        const w = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12);
        w.rotateZ(Math.PI / 2);
        p.push(part(w, '#3b2a1a', sx, 0.42, 0.25));
      }
      p.push(part(new THREE.BoxGeometry(0.05, 0.7, 0.05), '#6d4320', 0, 0.42, -0.95));
      p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5).rotateX(Math.PI / 2), '#6d4320', -0.4, 0.82, 1.4));
      p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5).rotateX(Math.PI / 2), '#6d4320', 0.4, 0.82, 1.4));
      const rng = new Rng(4);
      const fruit = ['#ff9800', '#ffb300', '#fdd835', '#e53935', '#7cb342'];
      for (let i = 0; i < 26; i++) {
        const c = fruit[Math.floor(i / 6) % fruit.length];
        const s = new THREE.SphereGeometry(0.11, 6, 5);
        p.push(part(s, c, rng.range(-0.42, 0.42), 0.9 + rng.range(0, 0.18) * (1 - Math.abs(rng.range(-1, 1))), rng.range(-0.85, 0.85)));
      }
      break;
    }
    case 'stall':
      // Chai stall: a little table, kettle, cups and a stack of crates.
      p.push(part(new THREE.BoxGeometry(0.75, 0.05, 1.2), '#a1887f', 0, 0.72, 0));
      for (const sx of [-0.33, 0.33]) for (const sz of [-0.55, 0.55]) p.push(part(new THREE.BoxGeometry(0.05, 0.72, 0.05), '#5d4037', sx, 0.36, sz));
      p.push(part(new THREE.CylinderGeometry(0.12, 0.15, 0.22, 10), '#b0b6bb', 0.1, 0.86, -0.25));
      p.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 5).rotateZ(1.0), '#b0b6bb', 0.24, 0.92, -0.25));
      for (let i = 0; i < 4; i++) p.push(part(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 6), '#fff8e1', -0.15 + (i % 2) * 0.1, 0.78, 0.15 + Math.floor(i / 2) * 0.12));
      p.push(part(new THREE.BoxGeometry(0.5, 0.3, 0.4), '#c62828', 0, 0.15, 0.3));
      break;
    case 'drum':
      p.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14), '#1565c0', 0, 0.44, 0));
      p.push(part(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 14), '#0d47a1', 0, 0.3, 0));
      p.push(part(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 14), '#0d47a1', 0, 0.62, 0));
      p.push(part(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8), '#0d47a1', 0, 0.9, 0));
      break;
    case 'chair':
      // The white plastic chair of every chai dhaba.
      p.push(part(new THREE.BoxGeometry(0.46, 0.05, 0.44), '#f2f2ee', 0, 0.44, 0));
      p.push(part(new THREE.BoxGeometry(0.46, 0.42, 0.05).rotateX(-0.15), '#f2f2ee', 0, 0.68, 0.22));
      for (const sx of [-0.2, 0.2]) for (const sz of [-0.19, 0.19]) p.push(part(new THREE.CylinderGeometry(0.025, 0.03, 0.44, 5), '#e8e8e2', sx, 0.22, sz));
      break;
    case 'crate':
      p.push(part(new THREE.BoxGeometry(0.62, 0.48, 0.5), '#b5895a', 0, 0.24, 0));
      for (const y of [0.1, 0.38]) p.push(part(new THREE.BoxGeometry(0.64, 0.06, 0.52), '#8d6440', 0, y, 0));
      break;
  }
  const g = merge(p);
  // Pivot at the centre of the prop so it tumbles about its middle.
  g.translate(0, -PROP_SPECS[kind].h / 2, 0);
  return g;
}

const KINDS: PropKind[] = ['cone', 'fruitcart', 'stall', 'drum', 'chair', 'crate'];

const PROP_CHUNK = 280;

interface PropChunk {
  cx: number;
  cz: number;
  group: THREE.Group;
}

/** Instanced street props, partitioned by home chunk and posed from the sim when active. */
export class PropVisuals {
  readonly group = new THREE.Group();
  private chunks: PropChunk[] = [];
  private propMesh: THREE.InstancedMesh[] = [];
  private slot: number[] = [];
  private sharedGeos: THREE.BufferGeometry[] = [];
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private dummy = new THREE.Object3D();
  private first = true;
  /** props drawn away from their home pose last time (must be redrawn once more when reset) */
  private away: boolean[] = [];

  constructor(props: Props, shadow: boolean) {
    const geos = new Map<PropKind, THREE.BufferGeometry>();
    for (const k of KINDS) {
      const g = propGeometry(k);
      geos.set(k, g);
      this.sharedGeos.push(g);
    }

    const byKey = new Map<string, { cx: number; cz: number; items: typeof props.props }>();
    for (const p of props.props) {
      const gx = Math.floor(p.homeX / PROP_CHUNK);
      const gz = Math.floor(p.homeZ / PROP_CHUNK);
      const key = `${gx},${gz}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { cx: (gx + 0.5) * PROP_CHUNK, cz: (gz + 0.5) * PROP_CHUNK, items: [] };
        byKey.set(key, entry);
      }
      entry.items.push(p);
    }

    for (const entry of byKey.values()) {
      const counts = new Map<PropKind, number>();
      for (const p of entry.items) {
        const c = counts.get(p.kind) ?? 0;
        this.slot[p.id] = c;
        counts.set(p.kind, c + 1);
      }
      const chunkGroup = new THREE.Group();
      const meshes = new Map<PropKind, THREE.InstancedMesh>();
      for (const k of KINDS) {
        const n = counts.get(k) ?? 0;
        if (!n) continue;
        const m = new THREE.InstancedMesh(geos.get(k)!, this.mat, n);
        m.castShadow = shadow;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        meshes.set(k, m);
        chunkGroup.add(m);
      }
      for (const p of entry.items) {
        this.propMesh[p.id] = meshes.get(p.kind)!;
      }
      this.group.add(chunkGroup);
      this.chunks.push({ cx: entry.cx, cz: entry.cz, group: chunkGroup });
    }
    this.dummy.rotation.order = 'YXZ';
  }

  update(props: Props, px = 0, pz = 0): void {
    for (const c of this.chunks) {
      c.group.visible = Math.abs(c.cx - px) < 420 && Math.abs(c.cz - pz) < 420;
    }
    if (!props.dirty && !this.first) return;
    const touched = new Set<THREE.InstancedMesh>();
    for (const p of props.props) {
      const atHome = p.state === 0 && p.tumble === 0 && p.x === p.homeX && p.z === p.homeZ;
      if (!this.first && atHome && !this.away[p.id]) continue;
      this.away[p.id] = !atHome;
      const mesh = this.propMesh[p.id];
      if (!mesh) continue;
      const spec = PROP_SPECS[p.kind];
      // Half-extent pointing up after tumbling about the sideways axis.
      const up = (spec.h / 2) * Math.abs(Math.cos(p.tumble)) + spec.hl * Math.abs(Math.sin(p.tumble));
      const d = this.dummy;
      d.position.set(p.x, p.y + up, -p.z);
      d.rotation.set(p.tumble, -p.heading, 0);
      d.updateMatrix();
      mesh.setMatrixAt(this.slot[p.id], d.matrix);
      touched.add(mesh);
    }
    for (const m of touched) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    this.first = false;
  }

  dispose(): void {
    for (const g of this.sharedGeos) g.dispose();
    this.mat.dispose();
    this.sharedGeos = [];
    this.chunks = [];
    this.propMesh = [];
  }
}
