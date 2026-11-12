import type { Obb } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Move `v` toward `target` by at most `maxDelta`. */
export const approach = (v: number, target: number, maxDelta: number): number =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);

export interface Mtv {
  /** push direction for box A (unit) */
  nx: number;
  nz: number;
  depth: number;
}

/**
 * 2D separating-axis test between two oriented boxes.
 * Returns the minimum translation vector that pushes A out of B, or null.
 */
export function obbOverlap(a: Obb, b: Obb): Mtv | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Broad phase: bounding circles.
  const ra = Math.hypot(a.hw, a.hl);
  const rb = Math.hypot(b.hw, b.hl);
  if (dx * dx + dz * dz > (ra + rb) * (ra + rb)) return null;

  const sa = Math.sin(a.heading), ca = Math.cos(a.heading);
  const sb = Math.sin(b.heading), cb = Math.cos(b.heading);
  // Each box has a forward axis (sin h, cos h) and a right axis (cos h, -sin h).
  const axes: ReadonlyArray<readonly [number, number]> = [
    [sa, ca],
    [ca, -sa],
    [sb, cb],
    [cb, -sb],
  ];

  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (const [axx, axz] of axes) {
    const projA =
      a.hl * Math.abs(sa * axx + ca * axz) + a.hw * Math.abs(ca * axx - sa * axz);
    const projB =
      b.hl * Math.abs(sb * axx + cb * axz) + b.hw * Math.abs(cb * axx - sb * axz);
    const dist = dx * axx + dz * axz;
    const overlap = projA + projB - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < best) {
      best = overlap;
      // Push A away from B.
      const sign = dist > 0 ? -1 : 1;
      bx = axx * sign;
      bz = axz * sign;
    }
  }
  return { nx: bx, nz: bz, depth: best };
}

/** Distance from a point to an OBB (0 if inside). */
export function pointObbDistance(px: number, pz: number, b: Obb): number {
  const s = Math.sin(b.heading), c = Math.cos(b.heading);
  const dx = px - b.x, dz = pz - b.z;
  const lf = dx * s + dz * c; // along forward
  const lr = dx * c - dz * s; // along right
  const ef = Math.max(Math.abs(lf) - b.hl, 0);
  const er = Math.max(Math.abs(lr) - b.hw, 0);
  return Math.hypot(ef, er);
}
