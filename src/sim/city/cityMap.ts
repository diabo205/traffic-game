import { Rng } from '../rng';
import type { Obb } from '../types';
import {
  SADDAR_BOUNDS,
  SADDAR_BUILDINGS,
  SADDAR_EMPRESS,
  SADDAR_ISLANDS,
  SADDAR_LINKS,
  SADDAR_NODES,
  SADDAR_POIS,
  SADDAR_SEGS,
  SADDAR_SLABS,
  SADDAR_YARDS,
} from './saddarData';

/**
 * Static open-city map: Real Saddar (Karachi) road network converted from
 * OpenStreetMap into a strongly connected directed road graph, pavement slabs,
 * roundabout islands, Empress Market, construction yards, street ramps and
 * oriented building colliders. Pure and deterministic: zero DOM/three.
 *
 * Sim space as elsewhere: x = east, z = north, heading 0 = facing +z,
 * positive heading = turned right (clockwise seen from above).
 * Pakistan drives on the LEFT: traffic uses left lanes, roundabouts go clockwise.
 */

export type RoadClass = 'arterial' | 'main' | 'side';

interface ClassSpec {
  lanes: number;
  laneW: number;
  median: number;
  pace: number;
}

const CLS_BY_CODE: readonly RoadClass[] = ['arterial', 'main', 'side'];

export const ROAD_CLASSES: Readonly<Record<RoadClass, ClassSpec>> = {
  arterial: { lanes: 2, laneW: 3.4, median: 1.4, pace: 1.15 },
  main: { lanes: 2, laneW: 3.3, median: 0, pace: 1 },
  side: { lanes: 1, laneW: 3.5, median: 0, pace: 0.8 },
};

/** Pavement width between kerb and building line (m). */
export const SIDEWALK = 4.2;
/** Kerb / pavement height (m). */
export const KERB_H = 0.15;

export interface Bounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface CityNode {
  id: number;
  x: number;
  z: number;
  /** roundabout ring vertex (clockwise one-way loop) */
  roundabout: boolean;
  /** degree-2 road curve bend vertex: traffic glides through without stopping/yielding */
  bend: boolean;
  /** effective intersection radius (used in route costs & cap visual) */
  r: number;
  /** outgoing link ids */
  out: number[];
  /** incoming link ids */
  in: number[];
}

export interface CityLink {
  id: number;
  from: number;
  to: number;
  /** unit direction */
  dx: number;
  dz: number;
  /** centre line at the start (trimmed outside the from-node) */
  sx: number;
  sz: number;
  len: number;
  heading: number;
  lanes: number;
  laneW: number;
  median: number;
  /** half-width of the asphalt carriageway on this link */
  hw: number;
  pace: number;
  cls: RoadClass;
  oneway: boolean;
  turnaround: boolean;
  name: string;
  /** the opposite direction of the same two-way street, or -1 */
  reverse: number;
  /** lane blocked by a ramp (-1 none) and the stretch it covers */
  rampLane: number;
  rampS0: number;
  rampS1: number;
}

export interface RoadSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
}

export interface Slab {
  /** 0 = paved city block, 1 = park (Jehangir Park) */
  kind: 0 | 1;
  pts: readonly number[];
  tris: readonly number[];
}

/** A wedge you can drive up and jump off. Rises along its heading from 0 to h. */
export interface Ramp {
  x: number;
  z: number;
  heading: number;
  hw: number;
  hl: number;
  h: number;
}

export interface Building extends Obb {
  storeys: number;
  h: number;
  /** stable per-building variety seed */
  seed: number;
}

export interface Landmark {
  kind: 'empress';
  obb: Obb;
}

export interface Island {
  x: number;
  z: number;
  r: number;
  monumental: boolean;
}

export interface RoundaboutLoop {
  island: Island;
  pts: number[];
  r2: number;
}

export interface Poi {
  name: string;
  x: number;
  z: number;
}

export interface JunctionPath {
  /** polyline points, x/z interleaved */
  pts: number[];
  /** cumulative length at each point */
  cum: number[];
  len: number;
  /** 'straight' | 'left' | 'right' | 'uturn' */
  turn: Turn;
  node: number;
}

export type Turn = 'straight' | 'left' | 'right' | 'uturn';

const GRID = 40;

export class CityMap {
  readonly nodes: CityNode[] = [];
  readonly links: CityLink[] = [];
  /** undirected road strips matching the baked pavement capsules */
  readonly roadSegs: RoadSeg[] = [];
  /** max incident asphalt half-width per node (for seamless cap sealing) */
  readonly nodeCapR: number[] = [];
  /** pre-triangulated raised pavement and park slabs */
  readonly slabs: Slab[] = [];
  readonly buildings: Building[] = [];
  readonly landmarks: Landmark[] = [];
  readonly islands: Island[] = [];
  readonly roundaboutLoops: RoundaboutLoop[] = [];
  readonly pois: Poi[] = [];
  readonly ramps: Ramp[] = [];
  /** open oriented dirt construction yards (no buildings) */
  readonly yards: Obb[] = [];
  /** solid oriented colliders (buildings, landmarks, outer boundary walls) */
  readonly solids: Obb[] = [];
  readonly bounds: Bounds = { ...SADDAR_BOUNDS };

  private roadGrid = new Map<number, number[]>();
  private linkGrid = new Map<number, number[]>();
  private solidGrid = new Map<number, number[]>();
  private rampGrid = new Map<number, number[]>();
  private paths = new Map<string, JunctionPath>();

  constructor() {
    // ---- Nodes --------------------------------------------------------------
    for (let i = 0; i < SADDAR_NODES.length; i++) {
      const [x, z, ra] = SADDAR_NODES[i];
      this.nodes.push({
        id: i,
        x,
        z,
        roundabout: ra === 1,
        bend: false,
        r: 2,
        out: [],
        in: [],
      });
      this.nodeCapR.push(0);
    }

    // ---- Undirected road strips (matched to baked pavement cutouts) ---------
    for (const [u, v, hw] of SADDAR_SEGS) {
      const a = this.nodes[u], b = this.nodes[v];
      this.roadSegs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, hw });
      if (hw > this.nodeCapR[u]) this.nodeCapR[u] = hw;
      if (hw > this.nodeCapR[v]) this.nodeCapR[v] = hw;
    }

    // ---- Directed links (pass 1: raw unit geometry & adjacency) -------------
    interface RawEdge {
      u: number;
      v: number;
      dx: number;
      dz: number;
      d: number;
      hw: number;
      turnaround: boolean;
    }
    const raw: RawEdge[] = [];
    const byPair = new Map<string, number>();

    for (let i = 0; i < SADDAR_LINKS.length; i++) {
      const [u, v, clsCode, ln, lw, ow, tr, name] = SADDAR_LINKS[i];
      const from = this.nodes[u], to = this.nodes[v];
      const ddx = to.x - from.x, ddz = to.z - from.z;
      const d = Math.hypot(ddx, ddz) || 1;
      const dx = ddx / d, dz = ddz / d;
      const cls = CLS_BY_CODE[clsCode];
      const oneway = ow === 1;
      const turnaround = tr === 1;
      const hw = oneway ? (ln * lw) / 2 : ln * lw;
      const revKey = `${v}:${u}`;
      const revIdx = !oneway && !turnaround ? (byPair.get(revKey) ?? -1) : -1;

      const link: CityLink = {
        id: i,
        from: u,
        to: v,
        dx,
        dz,
        sx: from.x,
        sz: from.z,
        len: d,
        heading: Math.atan2(dx, dz),
        lanes: ln,
        laneW: lw,
        median: 0,
        hw,
        pace: ROAD_CLASSES[cls].pace,
        cls,
        oneway,
        turnaround,
        name,
        reverse: revIdx,
        rampLane: -1,
        rampS0: 0,
        rampS1: 0,
      };
      this.links.push(link);
      from.out.push(i);
      to.in.push(i);
      if (revIdx >= 0) this.links[revIdx].reverse = i;
      else if (!oneway && !turnaround) byPair.set(`${u}:${v}`, i);
      raw.push({ u, v, dx, dz, d, hw, turnaround });
    }

    // ---- Identify degree-2 curve bends & effective node radii ---------------
    for (const n of this.nodes) {
      n.out.sort((a, b) => this.links[a].heading - this.links[b].heading);
      n.in.sort((a, b) => a - b);

      const nbrs = new Map<number, { dx: number; dz: number; hw: number; turnaround: boolean }>();
      for (const id of n.out) {
        const e = raw[id];
        const prev = nbrs.get(e.v);
        if (!prev || e.hw > prev.hw) nbrs.set(e.v, { dx: e.dx, dz: e.dz, hw: e.hw, turnaround: e.turnaround });
      }
      for (const id of n.in) {
        const e = raw[id];
        const prev = nbrs.get(e.u);
        if (!prev || e.hw > prev.hw) nbrs.set(e.u, { dx: -e.dx, dz: -e.dz, hw: e.hw, turnaround: e.turnaround });
      }

      const vecs = [...nbrs.values()];
      if (!n.roundabout && vecs.length === 2 && !vecs[0].turnaround && !vecs[1].turnaround && n.out.length > 0 && n.in.length > 0) {
        // Opposite unit rays from n have dot = -1 on a dead-straight continuation.
        const dot = vecs[0].dx * vecs[1].dx + vecs[0].dz * vecs[1].dz;
        if (dot < 0.25) n.bend = true;
      }

      if (n.bend) n.r = 1.4;
      else if (n.roundabout) n.r = 1.6;
      else {
        let maxHw = 3.2;
        for (const v of vecs) if (v.hw > maxHw) maxHw = v.hw;
        n.r = maxHw;
      }
    }

    // ---- Pass 2: trim link start/end cleanly around junctions & bends -------
    const trimAtNode = (nodeId: number, edgeIdx: number, outwardX: number, outwardZ: number): number => {
      const n = this.nodes[nodeId];
      const self = raw[edgeIdx];
      if (n.bend) {
        // Tiny miter trim only when neighboring angle bends appreciably.
        let otherDx = -outwardX, otherDz = -outwardZ;
        for (const id of n.out) if (id !== edgeIdx && this.links[id].from !== this.links[id].to) { otherDx = raw[id].dx; otherDz = raw[id].dz; }
        for (const id of n.in) if (id !== edgeIdx && raw[id].u !== self.v && raw[id].v !== self.v) { otherDx = -raw[id].dx; otherDz = -raw[id].dz; }
        const cosTurn = Math.max(-0.99, Math.min(0.99, -(outwardX * otherDx + outwardZ * otherDz)));
        const halfTan = Math.sqrt((1 - cosTurn) / (1 + cosTurn));
        return Math.min(2.4, Math.max(0.4, self.hw * halfTan * 0.45));
      }
      if (n.roundabout) {
        const otherIsRa = n.out.some((id) => id === edgeIdx ? this.nodes[raw[id].v].roundabout : false) ||
          n.in.some((id) => id === edgeIdx ? this.nodes[raw[id].u].roundabout : false);
        // Ring chords keep nearly full length; approach/exit stems stop cleanly outside ring width.
        return otherIsRa ? 0.8 : 3.2;
      }
      let trim = 1.5;
      const checkIncident = (otherId: number, ox: number, oz: number, ohw: number) => {
        if (otherId === edgeIdx || otherId === this.links[edgeIdx].reverse) return;
        const sinTheta = Math.abs(outwardX * oz - outwardZ * ox);
        const proj = ohw * sinTheta * 1.05;
        if (proj > trim) trim = proj;
      };
      for (const id of n.out) checkIncident(id, raw[id].dx, raw[id].dz, raw[id].hw);
      for (const id of n.in) checkIncident(id, -raw[id].dx, -raw[id].dz, raw[id].hw);
      return trim;
    };

    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i];
      const r = raw[i];
      let so = trimAtNode(l.from, i, r.dx, r.dz);
      let eo = trimAtNode(l.to, i, -r.dx, -r.dz);
      const minKeep = Math.min(2.5, r.d * 0.4);
      const maxTrim = Math.max(0, r.d - minKeep);
      if (so + eo > maxTrim) {
        const scale = maxTrim / (so + eo || 1);
        so *= scale;
        eo *= scale;
      }
      l.sx = this.nodes[l.from].x + r.dx * so;
      l.sz = this.nodes[l.from].z + r.dz * so;
      l.len = Math.max(0.2, r.d - so - eo);
    }

    // ---- Pre-baked slabs, islands, landmarks, yards, POIs & buildings -------
    for (const [kind, pts, tris] of SADDAR_SLABS) this.slabs.push({ kind, pts, tris });
    for (const [x, z, r, mon] of SADDAR_ISLANDS) this.islands.push({ x, z, r, monumental: mon === 1 });
    const raNext = new Map<number, number>();
    for (const l of this.links) {
      if (this.nodes[l.from].roundabout && this.nodes[l.to].roundabout && !raNext.has(l.from)) raNext.set(l.from, l.to);
    }
    const raSeen = new Set<number>();
    for (const start of raNext.keys()) {
      if (raSeen.has(start)) continue;
      const pts: number[] = [];
      let cur: number | undefined = start;
      let sx = 0, sz = 0, n = 0;
      while (cur !== undefined && !raSeen.has(cur)) {
        raSeen.add(cur);
        const nd = this.nodes[cur];
        pts.push(nd.x, nd.z);
        sx += nd.x;
        sz += nd.z;
        n++;
        cur = raNext.get(cur);
      }
      if (n < 3) continue;
      const cx = sx / n, cz = sz / n;
      const island = this.islands.find((isl) => Math.hypot(isl.x - cx, isl.z - cz) < 30);
      if (!island) continue;
      let maxR2 = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const d2 = (pts[k] - island.x) ** 2 + (pts[k + 1] - island.z) ** 2;
        if (d2 > maxR2) maxR2 = d2;
      }
      this.roundaboutLoops.push({ island, pts, r2: maxR2 });
    }
    for (const [name, x, z] of SADDAR_POIS) this.pois.push({ name, x, z });
    for (const [x, z, hw, hl, heading] of SADDAR_YARDS) this.yards.push({ x, z, hw, hl, heading });

    const emObb: Obb = { ...SADDAR_EMPRESS };
    this.landmarks.push({ kind: 'empress', obb: emObb });

    const rng = new Rng(0x5add4);
    for (const [x, z, hw, hl, heading, storeys] of SADDAR_BUILDINGS) {
      const h = 4 + (storeys - 1) * 3.1 + rng.range(0.3, 1.2);
      const b: Building = {
        x,
        z,
        hw,
        hl,
        heading,
        storeys,
        h,
        seed: rng.int(0, 1 << 30),
      };
      this.buildings.push(b);
      this.solids.push(b);
    }
    this.solids.push(emObb);

    // Outer boundary walls keep the car inside the baked Saddar extent.
    const t = 6;
    const b = this.bounds;
    const wX = (b.x1 - b.x0) / 2 + t;
    const wZ = (b.z1 - b.z0) / 2;
    const midX = (b.x0 + b.x1) / 2;
    const midZ = (b.z0 + b.z1) / 2;
    this.solids.push(
      { x: midX, z: b.z0 - t / 2, hw: wX, hl: t / 2, heading: 0 },
      { x: midX, z: b.z1 + t / 2, hw: wX, hl: t / 2, heading: 0 },
      { x: b.x0 - t / 2, z: midZ, hw: t / 2, hl: wZ, heading: 0 },
      { x: b.x1 + t / 2, z: midZ, hw: t / 2, hl: wZ, heading: 0 },
    );

    // ---- Ramps (yard dirt jumps + safe street kickers away from junctions) -
    this.yardRamps();
    this.streetRamps();

    // ---- Spatial indices ----------------------------------------------------
    this.indexBoxes(
      this.ramps.map((r) => obbAabb(r.x, r.z, r.hw, r.hl, r.heading)),
      this.rampGrid,
    );
    this.indexBoxes(
      this.roadSegs.map((s) => ({
        x0: Math.min(s.ax, s.bx) - s.hw - 1,
        z0: Math.min(s.az, s.bz) - s.hw - 1,
        x1: Math.max(s.ax, s.bx) + s.hw + 1,
        z1: Math.max(s.az, s.bz) + s.hw + 1,
      })),
      this.roadGrid,
    );
    this.indexBoxes(
      this.links.map((l) => {
        const ex = l.sx + l.dx * l.len, ez = l.sz + l.dz * l.len;
        const pad = l.hw + 2.5;
        return {
          x0: Math.min(l.sx, ex) - pad,
          z0: Math.min(l.sz, ez) - pad,
          x1: Math.max(l.sx, ex) + pad,
          z1: Math.max(l.sz, ez) + pad,
        };
      }),
      this.linkGrid,
    );
    this.indexBoxes(
      this.solids.map((s) => obbAabb(s.x, s.z, s.hw, s.hl, s.heading)),
      this.solidGrid,
    );
  }

  // ---- Ramp placement -----------------------------------------------------

  private yardRamps(): void {
    for (const y of this.yards) {
      const ys = Math.sin(y.heading), yc = Math.cos(y.heading);
      const mk = (lf: number, lr: number, dh: number, hw: number, hl: number, h: number): Ramp => ({
        x: y.x + lf * ys + lr * yc,
        z: y.z + lf * yc - lr * ys,
        heading: y.heading + dh,
        hw,
        hl,
        h,
      });
      const f = y.hl * 0.35;
      const r = y.hw * 0.38;
      this.ramps.push(
        mk(-f, -r, 0, 2.3, 4.2, 1.9),
        mk(f * 0.8, r, Math.PI, 2.3, 4.2, 1.9),
        mk(-f * 0.9, r * 0.8, -Math.PI / 2, 2.0, 3.2, 1.2),
        mk(f * 0.9, -r * 0.8, Math.PI / 2, 2.0, 3.2, 1.2),
      );
    }
  }

  /** Kicker ramps left in the kerb lane of longer multi-lane avenues (kept well clear of junctions). */
  private streetRamps(): void {
    const rng = new Rng(0x4a3e);
    const used = new Set<number>();
    const yardRamps = this.ramps.length;
    for (const l of this.links) {
      if (this.ramps.length >= yardRamps + 10) break;
      if (l.turnaround || l.cls === 'side' || l.lanes < 2 || l.len < 68 || used.has(l.id) || (l.reverse >= 0 && used.has(l.reverse))) continue;
      if (this.nodes[l.from].roundabout || this.nodes[l.to].roundabout) continue;
      if (!rng.chance(0.18)) continue;
      const lane = l.lanes - 1;
      const hl = 3;
      const s = rng.range(Math.max(24, l.len * 0.35), Math.min(l.len - 24, l.len * 0.65));
      const p = this.linkPoint(l, s, this.laneOffset(l, lane));
      this.ramps.push({ x: p.x, z: p.z, heading: l.heading, hw: l.laneW / 2 - 0.2, hl, h: 1.25 });
      l.rampLane = lane;
      l.rampS0 = s - hl;
      l.rampS1 = s + hl;
      used.add(l.id);
    }
  }

  private indexBoxes(boxes: Bounds[], grid: Map<number, number[]>): void {
    for (let i = 0; i < boxes.length; i++) {
      const r = boxes[i];
      for (let gx = Math.floor(r.x0 / GRID); gx <= Math.floor(r.x1 / GRID); gx++) {
        for (let gz = Math.floor(r.z0 / GRID); gz <= Math.floor(r.z1 / GRID); gz++) {
          const key = cellKey(gx, gz);
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  // ---- Queries ------------------------------------------------------------

  isRoad(x: number, z: number): boolean {
    if (this.onIsland(x, z)) return false;
    const list = this.roadGrid.get(cellKey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (list) {
      for (const i of list) {
        const s = this.roadSegs[i];
        if (ptToSegDist2(x, z, s.ax, s.az, s.bx, s.bz) <= s.hw * s.hw) return true;
      }
    }
    for (const loop of this.roundaboutLoops) {
      if ((x - loop.island.x) ** 2 + (z - loop.island.z) ** 2 <= loop.r2 && ptInPoly(x, z, loop.pts)) return true;
    }
    return false;
  }

  /** True if (x, z) is within `pad` metres of any road asphalt edge (or on an island). */
  nearRoad(x: number, z: number, pad: number): boolean {
    if (this.onIsland(x, z)) return true;
    const reach = pad + 10;
    const seen = new Set<number>();
    for (let gx = Math.floor((x - reach) / GRID); gx <= Math.floor((x + reach) / GRID); gx++) {
      for (let gz = Math.floor((z - reach) / GRID); gz <= Math.floor((z + reach) / GRID); gz++) {
        const list = this.roadGrid.get(cellKey(gx, gz));
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          const s = this.roadSegs[i];
          const r = s.hw + pad;
          if (ptToSegDist2(x, z, s.ax, s.az, s.bx, s.bz) <= r * r) return true;
        }
      }
    }
    return false;
  }

  onIsland(x: number, z: number): boolean {
    for (const s of this.islands) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return true;
    return false;
  }

  /** Surface height: 0 on asphalt, kerb height on pavements / islands, plus any ramp. */
  groundY(x: number, z: number): number {
    return (this.isRoad(x, z) ? 0 : KERB_H) + this.rampHeight(x, z);
  }

  /** Height a ramp adds at (x, z), 0 if none. */
  rampHeight(x: number, z: number): number {
    const list = this.rampGrid.get(cellKey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!list) return 0;
    let h = 0;
    for (const i of list) {
      const r = this.ramps[i];
      const dx = x - r.x, dz = z - r.z;
      const s = Math.sin(r.heading), c = Math.cos(r.heading);
      const along = dx * s + dz * c;
      const lat = dx * c - dz * s;
      if (Math.abs(along) > r.hl || Math.abs(lat) > r.hw) continue;
      h = Math.max(h, (r.h * (along + r.hl)) / (2 * r.hl));
    }
    return h;
  }

  /** Solid colliders whose cell overlaps the circle (stable, may repeat across passes). */
  forEachSolidNear(x: number, z: number, r: number, fn: (s: Obb) => void): void {
    const seen = new Set<number>();
    for (let gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++) {
      for (let gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++) {
        const list = this.solidGrid.get(cellKey(gx, gz));
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          fn(this.solids[i]);
        }
      }
    }
  }

  /** The link whose strip contains (x, z), preferring the direction of travel and closer lane alignment. */
  linkAt(x: number, z: number, heading: number): CityLink | null {
    const list = this.linkGrid.get(cellKey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!list) return null;
    let best: CityLink | null = null;
    let bestScore = -Infinity;
    for (const i of list) {
      const l = this.links[i];
      const rx = x - l.sx, rz = z - l.sz;
      const along = rx * l.dx + rz * l.dz;
      if (along < -2.5 || along > l.len + 2.5) continue;
      // left = (-dz, dx): positive lat = on the left side of the centerline
      const signedLat = -rx * l.dz + rz * l.dx;
      const lat = Math.abs(signedLat);
      if (lat > l.hw + 1.5) continue;
      // On two-way links our lanes sit on the +signedLat side; mild boost avoids picking the wrong direction when near the centre.
      const dirBonus = l.oneway ? 0 : signedLat >= -0.3 ? 0.15 : -0.35;
      const score = Math.cos(heading - l.heading) + dirBonus - lat * 0.04;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  }

  /** Lateral offset (to the LEFT of the link centre line) of a lane's centre. Lane 0 = inside / right lane, lanes-1 = kerb lane. */
  laneOffset(l: CityLink, lane: number): number {
    if (l.oneway) return (lane - (l.lanes - 1) * 0.5) * l.laneW;
    return l.median / 2 + (lane + 0.5) * l.laneW;
  }

  /** World position on a link. */
  linkPoint(l: CityLink, s: number, offset: number): { x: number; z: number } {
    // left = (-dz, dx)
    return { x: l.sx + l.dx * s - l.dz * offset, z: l.sz + l.dz * s + l.dx * offset };
  }

  turnBetween(a: CityLink, b: CityLink): Turn {
    if (b.id === a.reverse) return 'uturn';
    const cross = a.dx * b.dz - a.dz * b.dx; // >0: b points to the left of a
    const dot = a.dx * b.dx + a.dz * b.dz;
    if (dot > 0.7) return 'straight';
    return cross > 0 ? 'left' : 'right';
  }

  /** Path through the node between link a (lane la) and link b (lane lb). Cached. */
  junctionPath(a: CityLink, la: number, b: CityLink, lb: number): JunctionPath {
    const key = `${a.id}:${la}:${b.id}:${lb}`;
    const hit = this.paths.get(key);
    if (hit) return hit;
    const n = this.nodes[a.to];
    const p0 = this.linkPoint(a, a.len, this.laneOffset(a, la));
    const p1 = this.linkPoint(b, 0, this.laneOffset(b, lb));
    const pts: number[] = [];
    const turn = this.turnBetween(a, b);
    const den = a.dx * b.dz - a.dz * b.dx;
    if (turn === 'straight' && Math.abs(den) < 0.08) {
      pts.push(p0.x, p0.z, p1.x, p1.z);
    } else if (turn !== 'uturn' && Math.abs(den) > 1e-3) {
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const t = (dx * b.dz - dz * b.dx) / den;
      const u = (a.dx * dz - a.dz * dx) / den;
      if (t >= 0 && t < 35 && u >= 0 && u < 35) {
        const cx = p0.x + a.dx * t;
        const cz = p0.z + a.dz * t;
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const s = i / steps, inv = 1 - s;
          pts.push(inv * inv * p0.x + 2 * inv * s * cx + s * s * p1.x, inv * inv * p0.z + 2 * inv * s * cz + s * s * p1.z);
        }
      } else {
        // Oblique Y-fork or wide offset transition: G1 cubic Hermite spline never loops backwards.
        const chord = Math.hypot(dx, dz);
        const lead = Math.max(0.5, Math.min(8, chord * 0.35));
        const c1x = p0.x + a.dx * lead, c1z = p0.z + a.dz * lead;
        const c2x = p1.x - b.dx * lead, c2z = p1.z - b.dz * lead;
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const s = i / steps, inv = 1 - s;
          pts.push(
            inv * inv * inv * p0.x + 3 * inv * inv * s * c1x + 3 * inv * s * s * c2x + s * s * s * p1.x,
            inv * inv * inv * p0.z + 3 * inv * inv * s * c1z + 3 * inv * s * s * c2z + s * s * s * p1.z,
          );
        }
      }
    } else {
      // U-turn or sharp ~180 deg turnaround: loop smoothly ahead.
      const chord = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const lead = Math.max(4, Math.min(9, Math.max(chord * 0.7, 4)));
      const cx = (p0.x + p1.x) / 2 + a.dx * lead;
      const cz = (p0.z + p1.z) / 2 + a.dz * lead;
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const s = i / steps, inv = 1 - s;
        pts.push(inv * inv * p0.x + 2 * inv * s * cx + s * s * p1.x, inv * inv * p0.z + 2 * inv * s * cz + s * s * p1.z);
      }
    }
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
    const path: JunctionPath = { pts, cum, len: cum[cum.length - 1], turn, node: n.id };
    this.paths.set(key, path);
    return path;
  }

  /** Point and direction at arc length s along a junction path. */
  samplePath(p: JunctionPath, s: number): { x: number; z: number; dx: number; dz: number } {
    const cum = p.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = i - 1;
    const segLen = cum[i] - cum[a] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[a]) / segLen));
    const ax = p.pts[a * 2], az = p.pts[a * 2 + 1];
    const bx = p.pts[i * 2], bz = p.pts[i * 2 + 1];
    const dx = (bx - ax) / segLen, dz = (bz - az) / segLen;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx, dz };
  }
}

// ---- Helpers ----------------------------------------------------------------

function cellKey(gx: number, gz: number): number {
  return (gx + 512) * 1024 + (gz + 512);
}

function ptToSegDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return (px - ax) ** 2 + (pz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return (px - (ax + t * dx)) ** 2 + (pz - (az + t * dz)) ** 2;
}

function obbAabb(x: number, z: number, hw: number, hl: number, heading: number): Bounds {
  const s = Math.abs(Math.sin(heading)), c = Math.abs(Math.cos(heading));
  const ex = s * hl + c * hw;
  const ez = c * hl + s * hw;
  return { x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez };
}

function ptInPoly(px: number, pz: number, pts: readonly number[]): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1];
    const xj = pts[j * 2], zj = pts[j * 2 + 1];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

let shared: CityMap | null = null;
/** The (immutable) map, built once. */
export function cityMap(): CityMap {
  return (shared ??= new CityMap());
}
