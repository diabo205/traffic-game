import { Rng } from '../rng';

/**
 * Static open-city map: a Saddar street grid built from data into a road
 * graph (nodes = junctions, links = one direction of a street), city blocks,
 * buildings and colliders. Pure and deterministic: the same map is built on
 * every client, and the renderer draws exactly these shapes.
 *
 * Sim space as elsewhere: x = east, z = north, heading 0 = facing +z,
 * positive heading = turned right (clockwise seen from above).
 * Pakistan drives on the LEFT: each direction's lanes sit left of the
 * street's centre line, and roundabouts circulate clockwise.
 */

export type RoadClass = 'arterial' | 'main' | 'side';

interface ClassSpec {
  /** lanes per direction */
  lanes: number;
  laneW: number;
  /** raised median width between the two directions (0 = painted line) */
  median: number;
  /** NPC cruise multiplier */
  pace: number;
}

export const ROAD_CLASSES: Readonly<Record<RoadClass, ClassSpec>> = {
  arterial: { lanes: 2, laneW: 3.4, median: 1.4, pace: 1.15 },
  main: { lanes: 2, laneW: 3.3, median: 0, pace: 1 },
  side: { lanes: 1, laneW: 3.5, median: 0, pace: 0.8 },
};

export const halfWidth = (c: RoadClass): number => {
  const s = ROAD_CLASSES[c];
  return s.median / 2 + s.lanes * s.laneW;
};

interface StreetDef {
  name: string;
  cls: RoadClass;
  /** x of a column street (runs north-south) or z of a row street (east-west) */
  at: number;
}

/** North-south streets, west to east. */
export const COLUMNS: readonly StreetDef[] = [
  { name: 'Dr Daud Pota Road', cls: 'main', at: -235 },
  { name: 'Preedy Street', cls: 'side', at: -160 },
  { name: 'Zaibunnisa Street', cls: 'main', at: -82 },
  { name: 'Abdullah Haroon Road', cls: 'main', at: 0 },
  { name: 'Mansfield Street', cls: 'side', at: 78 },
  { name: 'Raja Ghazanfar Ali Road', cls: 'side', at: 152 },
  { name: 'Sarwar Shaheed Road', cls: 'main', at: 232 },
];

/** East-west streets, south to north. */
export const ROWS: readonly StreetDef[] = [
  { name: 'Shahrah-e-Iraq', cls: 'main', at: -215 },
  { name: 'Kutchery Road', cls: 'side', at: -120 },
  { name: 'Bohri Bazaar Lane', cls: 'side', at: -40 },
  { name: 'Club Road', cls: 'main', at: 42 },
  { name: 'Strachen Road', cls: 'side', at: 122 },
  { name: 'M.A. Jinnah Road', cls: 'arterial', at: 210 },
];

/** Street segments that don't exist (merged blocks): [column, row] = segment from that row to the next. */
const NO_COLUMN_SEGMENT: ReadonlyArray<readonly [number, number]> = [
  [4, 2],
  [1, 3],
  [5, 0],
];
/** [row, column] = segment from that column to the next. */
const NO_ROW_SEGMENT: ReadonlyArray<readonly [number, number]> = [
  [2, 5],
  [4, 1],
];

/** Junctions that are roundabouts: [column, row]. */
const ROUNDABOUTS: ReadonlyArray<readonly [number, number]> = [[3, 1]];
export const ROUNDABOUT_HALF = 17;
export const ISLAND_R = 7.5;

/** Pavement width between kerb and building line. */
export const SIDEWALK = 4.5;
/** Kerb / pavement height (m). */
export const KERB_H = 0.15;
/** Depth of the built-up ring beyond the outer streets. */
const OUTER_DEPTH = 34;

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface CityNode {
  id: number;
  col: number;
  row: number;
  x: number;
  z: number;
  /** half extents of the junction box */
  hx: number;
  hz: number;
  roundabout: boolean;
  /** outgoing link ids (stable order: N, E, S, W) */
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
  /** centre line at the start (edge of the from-junction) */
  sx: number;
  sz: number;
  len: number;
  heading: number;
  lanes: number;
  laneW: number;
  median: number;
  pace: number;
  cls: RoadClass;
  name: string;
  /** the opposite direction of the same street */
  reverse: number;
}

export interface Building {
  x: number;
  z: number;
  hw: number;
  hl: number;
  storeys: number;
  h: number;
  /** stable per-building variety seed */
  seed: number;
}

export interface Landmark {
  kind: 'empress';
  rect: Rect;
  /** x of the street facade (faces +x) */
  face: number;
}

export interface Island {
  x: number;
  z: number;
  r: number;
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
  /** drivable asphalt: link strips and junction boxes */
  readonly roadRects: Rect[] = [];
  /** raised median strips */
  readonly medians: Rect[] = [];
  /** raised pavement slabs (everything between streets) */
  readonly slabs: Rect[] = [];
  readonly buildings: Building[] = [];
  readonly landmarks: Landmark[] = [];
  readonly islands: Island[] = [];
  /** solid colliders (buildings, landmarks, outer walls), axis-aligned */
  readonly solids: Rect[] = [];
  readonly bounds: Rect;

  private roadGrid = new Map<number, number[]>();
  private medianGrid = new Map<number, number[]>();
  private solidGrid = new Map<number, number[]>();
  private paths = new Map<string, JunctionPath>();

  constructor() {
    const nc = COLUMNS.length, nr = ROWS.length;
    const colHw = COLUMNS.map((c) => halfWidth(c.cls));
    const rowHw = ROWS.map((r) => halfWidth(r.cls));
    const x0 = COLUMNS[0].at - colHw[0] - SIDEWALK - OUTER_DEPTH;
    const x1 = COLUMNS[nc - 1].at + colHw[nc - 1] + SIDEWALK + OUTER_DEPTH;
    const z0 = ROWS[0].at - rowHw[0] - SIDEWALK - OUTER_DEPTH;
    const z1 = ROWS[nr - 1].at + rowHw[nr - 1] + SIDEWALK + OUTER_DEPTH;
    this.bounds = { x0, z0, x1, z1 };

    const colSegment = (c: number, r: number) => !NO_COLUMN_SEGMENT.some(([a, b]) => a === c && b === r);
    const rowSegment = (r: number, c: number) => !NO_ROW_SEGMENT.some(([a, b]) => a === r && b === c);

    // ---- Nodes ----------------------------------------------------------
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const ra = ROUNDABOUTS.some(([a, b]) => a === c && b === r);
        this.nodes.push({
          id: r * nc + c,
          col: c,
          row: r,
          x: COLUMNS[c].at,
          z: ROWS[r].at,
          hx: ra ? ROUNDABOUT_HALF : colHw[c],
          hz: ra ? ROUNDABOUT_HALF : rowHw[r],
          roundabout: ra,
          out: [],
          in: [],
        });
        if (ra) this.islands.push({ x: COLUMNS[c].at, z: ROWS[r].at, r: ISLAND_R });
      }
    }
    const node = (c: number, r: number) => this.nodes[r * nc + c];

    // ---- Links (both directions of each street segment) -------------------
    const addStreet = (a: CityNode, b: CityNode, def: StreetDef) => {
      const spec = ROAD_CLASSES[def.cls];
      const mk = (from: CityNode, to: CityNode): CityLink => {
        const ddx = to.x - from.x, ddz = to.z - from.z;
        const d = Math.hypot(ddx, ddz);
        const dx = ddx / d, dz = ddz / d;
        const startOff = Math.abs(dx) > 0.5 ? from.hx : from.hz;
        const endOff = Math.abs(dx) > 0.5 ? to.hx : to.hz;
        return {
          id: this.links.length,
          from: from.id,
          to: to.id,
          dx,
          dz,
          sx: from.x + dx * startOff,
          sz: from.z + dz * startOff,
          len: d - startOff - endOff,
          heading: Math.atan2(dx, dz),
          lanes: spec.lanes,
          laneW: spec.laneW,
          median: spec.median,
          pace: spec.pace,
          cls: def.cls,
          name: def.name,
          reverse: -1,
        };
      };
      const ab = mk(a, b);
      this.links.push(ab);
      const ba = mk(b, a);
      this.links.push(ba);
      ab.reverse = ba.id;
      ba.reverse = ab.id;
      a.out.push(ab.id);
      b.in.push(ab.id);
      b.out.push(ba.id);
      a.in.push(ba.id);

      // Asphalt strip between the two junction boxes.
      const hw = halfWidth(def.cls);
      if (Math.abs(ab.dx) > 0.5) {
        this.roadRects.push({ x0: Math.min(ab.sx, ba.sx), x1: Math.max(ab.sx, ba.sx), z0: a.z - hw, z1: a.z + hw });
        if (spec.median > 0) this.medians.push({ x0: Math.min(ab.sx, ba.sx), x1: Math.max(ab.sx, ba.sx), z0: a.z - spec.median / 2, z1: a.z + spec.median / 2 });
      } else {
        this.roadRects.push({ x0: a.x - hw, x1: a.x + hw, z0: Math.min(ab.sz, ba.sz), z1: Math.max(ab.sz, ba.sz) });
        if (spec.median > 0) this.medians.push({ x0: a.x - spec.median / 2, x1: a.x + spec.median / 2, z0: Math.min(ab.sz, ba.sz), z1: Math.max(ab.sz, ba.sz) });
      }
    };
    for (let c = 0; c < nc; c++) for (let r = 0; r < nr - 1; r++) if (colSegment(c, r)) addStreet(node(c, r), node(c, r + 1), COLUMNS[c]);
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc - 1; c++) if (rowSegment(r, c)) addStreet(node(c, r), node(c + 1, r), ROWS[r]);
    // Stable N, E, S, W ordering of each node's outgoing links.
    const order = (id: number) => {
      const l = this.links[id];
      return l.dz > 0.5 ? 0 : l.dx > 0.5 ? 1 : l.dz < -0.5 ? 2 : 3;
    };
    for (const n of this.nodes) {
      n.out.sort((a, b) => order(a) - order(b));
      n.in.sort((a, b) => a - b);
      this.roadRects.push({ x0: n.x - n.hx, x1: n.x + n.hx, z0: n.z - n.hz, z1: n.z + n.hz });
    }

    // ---- Blocks: pavement slabs + building lots --------------------------
    const rng = new Rng(0x5add4);
    // Grid lines including the virtual outer edges (half width 0 there).
    const xs = [x0, ...COLUMNS.map((c) => c.at), x1];
    const zs = [z0, ...ROWS.map((r) => r.at), z1];
    const xh = [0, ...colHw, 0];
    const zh = [0, ...rowHw, 0];
    const outerX = (i: number) => i === 0 || i === xs.length - 1;
    const outerZ = (i: number) => i === 0 || i === zs.length - 1;

    // Merged cells: a missing street segment joins the two cells either side of it.
    const cellsX = xs.length - 1, cellsZ = zs.length - 1;
    const parent = Array.from({ length: cellsX * cellsZ }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const unite = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    // Column c (grid line c+1) segment between rows r and r+1 separates cells (c, r+1) and (c+1, r+1).
    for (const [c, r] of NO_COLUMN_SEGMENT) unite((r + 1) * cellsX + c, (r + 1) * cellsX + c + 1);
    for (const [r, c] of NO_ROW_SEGMENT) unite(r * cellsX + c + 1, (r + 1) * cellsX + c + 1);

    const empressCell = { cx: 3, cz: 1 }; // between Zaibunnisa / Abdullah Haroon, Shahrah-e-Iraq / Kutchery
    for (let iz = 0; iz < cellsZ; iz++) {
      for (let ix = 0; ix < cellsX; ix++) {
        const cell: Rect = {
          x0: xs[ix] + xh[ix],
          x1: xs[ix + 1] - xh[ix + 1],
          z0: zs[iz] + zh[iz],
          z1: zs[iz + 1] - zh[iz + 1],
        };
        // Junction boxes larger than the street (roundabouts) bite the corners.
        const holes: Rect[] = [];
        for (const n of this.nodes) {
          if (!n.roundabout) continue;
          holes.push({ x0: n.x - n.hx, x1: n.x + n.hx, z0: n.z - n.hz, z1: n.z + n.hz });
        }
        let slab = [cell];
        for (const h of holes) slab = slab.flatMap((s) => subtract(s, h));
        this.slabs.push(...slab);

        // Building lots: inset by the pavement on every street side.
        const lot: Rect = {
          x0: cell.x0 + (outerX(ix) ? 0 : SIDEWALK),
          x1: cell.x1 - (outerX(ix + 1) ? 0 : SIDEWALK),
          z0: cell.z0 + (outerZ(iz) ? 0 : SIDEWALK),
          z1: cell.z1 - (outerZ(iz + 1) ? 0 : SIDEWALK),
        };
        let lots = [lot];
        for (const h of holes) lots = lots.flatMap((s) => subtract(s, expand(h, SIDEWALK)));

        if (ix === empressCell.cx && iz === empressCell.cz) {
          this.empress(lot, rng);
          continue;
        }
        const outer = outerX(ix) || outerX(ix + 1) || outerZ(iz) || outerZ(iz + 1);
        for (const l of lots) this.fillLot(l, rng, outer, ROWS[Math.min(iz, ROWS.length - 1)].cls === 'arterial' || ROWS[Math.max(0, iz - 1)].cls === 'arterial');
      }
    }

    // Merged cells: pave over and build across the missing street segment.
    for (const [c, r] of NO_COLUMN_SEGMENT) {
      const x = COLUMNS[c].at, hw = colHw[c];
      const za = ROWS[r].at + rowHw[r], zb = ROWS[r + 1].at - rowHw[r + 1];
      this.slabs.push({ x0: x - hw, x1: x + hw, z0: za, z1: zb });
      this.fillLot({ x0: x - hw - SIDEWALK, x1: x + hw + SIDEWALK, z0: za + SIDEWALK, z1: zb - SIDEWALK }, rng, false, false);
    }
    for (const [r, c] of NO_ROW_SEGMENT) {
      const z = ROWS[r].at, hw = rowHw[r];
      const xa = COLUMNS[c].at + colHw[c], xb = COLUMNS[c + 1].at - colHw[c + 1];
      this.slabs.push({ x0: xa, x1: xb, z0: z - hw, z1: z + hw });
      this.fillLot({ x0: xa + SIDEWALK, x1: xb - SIDEWALK, z0: z - hw - SIDEWALK, z1: z + hw + SIDEWALK }, rng, false, false);
    }

    // Outer walls keep the car inside the map.
    const t = 6;
    this.solids.push(
      { x0: x0 - t, x1: x1 + t, z0: z0 - t, z1: z0 },
      { x0: x0 - t, x1: x1 + t, z0: z1, z1: z1 + t },
      { x0: x0 - t, x1: x0, z0: z0, z1: z1 },
      { x0: x1, x1: x1 + t, z0: z0, z1: z1 },
    );
    for (const b of this.buildings) this.solids.push({ x0: b.x - b.hw, x1: b.x + b.hw, z0: b.z - b.hl, z1: b.z + b.hl });
    for (const l of this.landmarks) this.solids.push(l.rect);

    this.index(this.roadRects, this.roadGrid);
    this.index(this.medians, this.medianGrid);
    this.index(this.solids, this.solidGrid);
  }

  // ---- Map building --------------------------------------------------------

  private empress(lot: Rect, rng: Rng): void {
    // Empress Market: gothic hall facing Abdullah Haroon Road, open plaza around it.
    const depth = 26;
    const len = Math.min(50, lot.z1 - lot.z0 - 10);
    const face = lot.x1 - 6;
    const zc = (lot.z0 + lot.z1) / 2;
    this.landmarks.push({ kind: 'empress', face, rect: { x0: face - depth, x1: face, z0: zc - len / 2, z1: zc + len / 2 } });
    // Stalls and shops on the far side of the plaza.
    this.fillLot({ x0: lot.x0, x1: face - depth - 12, z0: lot.z0, z1: lot.z1 }, rng, false, false);
  }

  /** Fill a lot with back-to-back buildings, with the odd drivable alley. */
  private fillLot(lot: Rect, rng: Rng, outer: boolean, nearArterial: boolean): void {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (w < 4 || d < 4) return;
    const alongX = w >= d;
    const long = alongX ? w : d;
    // An alley across the short side splits long lots.
    if (!outer && long > 46 && rng.chance(0.55)) {
      const at = rng.range(0.35, 0.65) * long;
      const aw = rng.range(4, 5.5);
      if (alongX) {
        this.fillLot({ ...lot, x1: lot.x0 + at - aw / 2 }, rng, outer, nearArterial);
        this.fillLot({ ...lot, x0: lot.x0 + at + aw / 2 }, rng, outer, nearArterial);
      } else {
        this.fillLot({ ...lot, z1: lot.z0 + at - aw / 2 }, rng, outer, nearArterial);
        this.fillLot({ ...lot, z0: lot.z0 + at + aw / 2 }, rng, outer, nearArterial);
      }
      return;
    }
    // Deep lots get two rows of buildings back to back.
    const short = alongX ? d : w;
    const rows = short > 34 ? 2 : 1;
    for (let k = 0; k < rows; k++) {
      const s0 = (short / rows) * k, s1 = (short / rows) * (k + 1);
      let p = 0;
      while (p < long - 0.5) {
        let bw = rng.range(9, 19);
        if (long - p - bw < 7) bw = long - p;
        const storeys = nearArterial ? rng.int(3, 8) : outer ? rng.int(3, 6) : rng.int(2, 6);
        const h = 4 + (storeys - 1) * 3.1 + rng.range(0.3, 1.2);
        const cx = alongX ? lot.x0 + p + bw / 2 : lot.x0 + (s0 + s1) / 2;
        const cz = alongX ? lot.z0 + (s0 + s1) / 2 : lot.z0 + p + bw / 2;
        this.buildings.push({
          x: cx,
          z: cz,
          hw: (alongX ? bw : s1 - s0) / 2,
          hl: (alongX ? s1 - s0 : bw) / 2,
          storeys,
          h,
          seed: rng.int(0, 1 << 30),
        });
        p += bw;
      }
    }
  }

  private index(rects: Rect[], grid: Map<number, number[]>): void {
    rects.forEach((r, i) => {
      for (let gx = Math.floor(r.x0 / GRID); gx <= Math.floor(r.x1 / GRID); gx++) {
        for (let gz = Math.floor(r.z0 / GRID); gz <= Math.floor(r.z1 / GRID); gz++) {
          const key = cellKey(gx, gz);
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(i);
        }
      }
    });
  }

  // ---- Queries ---------------------------------------------------------------

  isRoad(x: number, z: number): boolean {
    const list = this.roadGrid.get(cellKey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!list) return false;
    for (const i of list) if (inside(this.roadRects[i], x, z)) return !this.isMedian(x, z) && !this.onIsland(x, z);
    return false;
  }

  isMedian(x: number, z: number): boolean {
    const list = this.medianGrid.get(cellKey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!list) return false;
    for (const i of list) if (inside(this.medians[i], x, z)) return true;
    return false;
  }

  onIsland(x: number, z: number): boolean {
    for (const s of this.islands) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return true;
    return false;
  }

  /** Surface height: 0 on asphalt, kerb height on pavements / medians. */
  groundY(x: number, z: number): number {
    return this.isRoad(x, z) ? 0 : KERB_H;
  }

  /** Solid colliders whose cell overlaps the circle (stable, may repeat). */
  forEachSolidNear(x: number, z: number, r: number, fn: (s: Rect) => void): void {
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

  /** The link whose strip contains (x, z), preferring the direction of travel. */
  linkAt(x: number, z: number, heading: number): CityLink | null {
    let best: CityLink | null = null;
    let bestScore = -Infinity;
    for (const l of this.links) {
      const rx = x - l.sx, rz = z - l.sz;
      const along = rx * l.dx + rz * l.dz;
      if (along < -2 || along > l.len + 2) continue;
      const lat = Math.abs(rx * l.dz - rz * l.dx);
      if (lat > halfWidth(l.cls) + 1) continue;
      const score = Math.cos(heading - l.heading);
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  }

  /** Lateral offset (to the LEFT of the centre line) of a lane's centre. Lane 0 = nearest the centre. */
  laneOffset(l: CityLink, lane: number): number {
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

  /** Path through the junction between link a (lane la) and link b (lane lb). Cached. */
  junctionPath(a: CityLink, la: number, b: CityLink, lb: number): JunctionPath {
    const key = `${a.id}:${la}:${b.id}:${lb}`;
    const hit = this.paths.get(key);
    if (hit) return hit;
    const n = this.nodes[a.to];
    const p0 = this.linkPoint(a, a.len, this.laneOffset(a, la));
    const p1 = this.linkPoint(b, 0, this.laneOffset(b, lb));
    const pts: number[] = [];
    const turn = this.turnBetween(a, b);
    if (n.roundabout) {
      // Spiral in to the circulating lane, clockwise around the island, out.
      const t0 = Math.atan2(p0.z - n.z, p0.x - n.x);
      const t1 = Math.atan2(p1.z - n.z, p1.x - n.x);
      let sweep = t0 - t1;
      while (sweep <= 0.3) sweep += Math.PI * 2;
      const r0 = Math.hypot(p0.x - n.x, p0.z - n.z);
      const r1 = Math.hypot(p1.x - n.x, p1.z - n.z);
      const rc = ISLAND_R + 4.2;
      const steps = Math.max(8, Math.ceil(sweep * 7));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ease = Math.min(1, t / 0.28, (1 - t) / 0.28);
        const rBase = r0 + (r1 - r0) * t;
        const r = rBase + (rc - rBase) * smooth(ease);
        const th = t0 - sweep * t;
        pts.push(n.x + Math.cos(th) * r, n.z + Math.sin(th) * r);
      }
    } else if (turn === 'straight') {
      pts.push(p0.x, p0.z, p1.x, p1.z);
    } else {
      // Quadratic Bezier through the corner where the two lane lines meet.
      let cx: number, cz: number;
      const den = a.dx * b.dz - a.dz * b.dx;
      if (Math.abs(den) > 1e-3) {
        const t = ((p1.x - p0.x) * b.dz - (p1.z - p0.z) * b.dx) / den;
        cx = p0.x + a.dx * t;
        cz = p0.z + a.dz * t;
      } else {
        // U-turn: loop out ahead of the junction.
        cx = (p0.x + p1.x) / 2 + a.dx * 9;
        cz = (p0.z + p1.z) / 2 + a.dz * 9;
      }
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        pts.push(u * u * p0.x + 2 * u * t * cx + t * t * p1.x, u * u * p0.z + 2 * u * t * cz + t * t * p1.z);
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

// ---- Helpers ------------------------------------------------------------------

function cellKey(gx: number, gz: number): number {
  return (gx + 512) * 1024 + (gz + 512);
}

function inside(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function expand(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, x1: r.x1 + by, z0: r.z0 - by, z1: r.z1 + by };
}

/** r minus hole, as up to four rectangles. */
export function subtract(r: Rect, h: Rect): Rect[] {
  if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) return [r];
  const out: Rect[] = [];
  if (h.z0 > r.z0) out.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: h.z0 });
  if (h.z1 < r.z1) out.push({ x0: r.x0, x1: r.x1, z0: h.z1, z1: r.z1 });
  const zl = Math.max(r.z0, h.z0), zh = Math.min(r.z1, h.z1);
  if (h.x0 > r.x0) out.push({ x0: r.x0, x1: h.x0, z0: zl, z1: zh });
  if (h.x1 < r.x1) out.push({ x0: h.x1, x1: r.x1, z0: zl, z1: zh });
  return out.filter((q) => q.x1 - q.x0 > 0.05 && q.z1 - q.z0 > 0.05);
}

let shared: CityMap | null = null;
/** The (immutable) map, built once. */
export function cityMap(): CityMap {
  return (shared ??= new CityMap());
}
