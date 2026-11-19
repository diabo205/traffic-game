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

function mergePropParts(parts: G[]): G {
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    }
  }
  const merged = mergeGeometries(parts, false) ?? part(new THREE.BoxGeometry(0.5, 0.5, 0.5), '#ffffff');
  for (const g of parts) g.dispose();
  return merged;
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
  const g = mergePropParts(p);
  // Pivot at the centre of the prop so it tumbles about its middle.
  g.translate(0, -PROP_SPECS[kind].h / 2, 0);
  return g;
}

const KINDS: readonly PropKind[] = ['cone', 'fruitcart', 'stall', 'drum', 'chair', 'crate'];
const PROP_CHUNK = 240;

interface PropChunk {
  cx: number;
  cz: number;
  visible: boolean;
  instanceIds: number[];
}

/**
 * Single-draw-call BatchedMesh street props partitioned by spatial chunks for fast visibility culling.
 */
export class PropVisuals {
  readonly group = new THREE.Group();
  private readonly batch: THREE.BatchedMesh | null = null;
  private readonly mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly chunks: PropChunk[] = [];
  private readonly instanceIds: number[];
  private readonly away: Uint8Array;
  private readonly dummy = new THREE.Object3D();
  private first = true;

  constructor(props: Props, _shadow: boolean) {
    this.dummy.rotation.order = 'YXZ';
    const list = props.props;
    this.instanceIds = new Array<number>(list.length);
    this.away = new Uint8Array(list.length);

    if (list.length === 0) return;

    const geos = new Map<PropKind, THREE.BufferGeometry>();
    let totalVerts = 0;
    for (const k of KINDS) {
      const g = propGeometry(k);
      geos.set(k, g);
      totalVerts += g.getAttribute('position').count;
    }

    const batch = new THREE.BatchedMesh(list.length, totalVerts, 0, this.mat);
    batch.sortObjects = false;
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = true;
    batch.castShadow = false;
    batch.receiveShadow = true;

    const gidByKind = new Map<PropKind, number>();
    for (const k of KINDS) {
      const g = geos.get(k)!;
      gidByKind.set(k, batch.addGeometry(g));
      g.dispose();
    }

    const chunkMap = new Map<string, PropChunk>();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const iid = batch.addInstance(gidByKind.get(p.kind)!);
      this.instanceIds[p.id] = iid;

      const spec = PROP_SPECS[p.kind];
      this.dummy.position.set(p.x, p.y + spec.h * 0.5, -p.z);
      this.dummy.rotation.set(0, -p.heading, 0);
      this.dummy.updateMatrix();
      batch.setMatrixAt(iid, this.dummy.matrix);
      batch.setVisibleAt(iid, false);

      const gx = Math.floor(p.homeX / PROP_CHUNK);
      const gz = Math.floor(p.homeZ / PROP_CHUNK);
      const key = `${gx},${gz}`;
      let c = chunkMap.get(key);
      if (!c) {
        c = {
          cx: (gx + 0.5) * PROP_CHUNK,
          cz: (gz + 0.5) * PROP_CHUNK,
          visible: false,
          instanceIds: [],
        };
        chunkMap.set(key, c);
        this.chunks.push(c);
      }
      c.instanceIds.push(iid);
    }

    this.batch = batch;
    this.group.add(batch);
  }

  update(props: Props, px = 0, pz = 0): void {
    const batch = this.batch;
    if (!batch) return;

    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const on = Math.abs(c.cx - px) < 420 && Math.abs(c.cz - pz) < 420;
      if (on !== c.visible) {
        c.visible = on;
        const ids = c.instanceIds;
        for (let j = 0; j < ids.length; j++) {
          batch.setVisibleAt(ids[j], on);
        }
      }
    }

    if (!props.dirty && !this.first) return;
    const list = props.props;
    const d = this.dummy;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const atHome = p.state === 0 && p.tumble === 0 && p.x === p.homeX && p.z === p.homeZ;
      if (!this.first && atHome && !this.away[p.id]) continue;
      this.away[p.id] = atHome ? 0 : 1;
      const spec = PROP_SPECS[p.kind];
      const up = (spec.h * 0.5) * Math.abs(Math.cos(p.tumble)) + spec.hl * Math.abs(Math.sin(p.tumble));
      d.position.set(p.x, p.y + up, -p.z);
      d.rotation.set(p.tumble, -p.heading, 0);
      d.updateMatrix();
      batch.setMatrixAt(this.instanceIds[p.id], d.matrix);
    }
    this.first = false;
  }

  dispose(): void {
    this.batch?.dispose();
    this.mat.dispose();
    this.chunks.length = 0;
  }
}
