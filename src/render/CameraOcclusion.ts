import type { Building, CityMap } from '../sim/city/cityMap';
import type { Obb } from '../sim/types';

export interface OcclusionResult {
  x: number;
  y: number;
  z: number;
  t: number;
}

/**
 * 2D ray-vs-OBB entry fraction `t` in `[0, 1]` in sim coordinates `(x, z)`.
 * Returns `1` when the segment misses the expanded OBB, or `0` when `(ox, oz)` starts inside.
 */
export function rayObbEnterT(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  obb: Obb,
  padX: number,
  padZ = padX,
): number {
  const s = Math.sin(obb.heading);
  const c = Math.cos(obb.heading);
  const rx = ox - obb.x;
  const rz = oz - obb.z;

  const ol = rx * s + rz * c;
  const dl = dx * s + dz * c;
  const halfL = obb.hl + padZ;

  const or = rx * c - rz * s;
  const dr = dx * c - dz * s;
  const halfW = obb.hw + padX;

  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dl) < 1e-8) {
    if (Math.abs(ol) > halfL) return 1;
  } else {
    let t0 = (-halfL - ol) / dl;
    let t1 = (halfL - ol) / dl;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    if (tMin > tMax) return 1;
  }

  if (Math.abs(dr) < 1e-8) {
    if (Math.abs(or) > halfW) return 1;
  } else {
    let t0 = (-halfW - or) / dr;
    let t1 = (halfW - or) / dr;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    if (tMin > tMax) return 1;
  }

  return tMin;
}

const WHISKER_OFFSET = 0.52;
const WALL_PAD = 0.38;
const AWNING_PAD = 1.05;
const BRIDGE_DECK_Y_MIN = 5.0;
const BRIDGE_DECK_Y_MAX = 8.8;
const BRIDGE_PIER_Y_MAX = 6.5;
const RELEASE_RATE = 6.0;

/**
 * Pure analytical 3-ray whisker camera occlusion solver against Saddar buildings,
 * ground-floor awnings, pedestrian bridges, and road/kerb surfaces.
 * Uses asymmetric hysteresis (instant pull-in, smooth release) and allocates zero objects per frame.
 */
export class CameraOcclusion {
  private smoothT = 1;
  private readonly out: OcclusionResult = { x: 0, y: 0, z: 0, t: 1 };
  private readonly tmpObb: Obb = { x: 0, z: 0, hw: 0, hl: 0, heading: 0 };

  // Scratch fields for zero-allocation visitor callback
  private vOriginX = 0;
  private vOriginZ = 0;
  private vDeltaX = 0;
  private vDeltaZ = 0;
  private vPerpX = 0;
  private vPerpZ = 0;
  private vStartY = 0;
  private vEndY = 0;
  private vBestT = 1;

  private readonly solidVisitor = (s: Obb): void => {
    const b = s as Partial<Building>;
    const topY = typeof b.h === 'number' ? b.h + 0.65 : 18;
    const minRayY = this.vStartY < this.vEndY ? this.vStartY : this.vEndY;
    if (minRayY > topY) return;

    // 3-ray whisker fan across the camera near plane
    this.testRay(this.vOriginX, this.vOriginZ, s, WALL_PAD);
    this.testRay(this.vOriginX + this.vPerpX, this.vOriginZ + this.vPerpZ, s, WALL_PAD);
    this.testRay(this.vOriginX - this.vPerpX, this.vOriginZ - this.vPerpZ, s, WALL_PAD);

    // Ground-floor shop awnings jut ~1.4 m out from Saddar building walls around y = 1.8..3.5 m.
    if (typeof b.storeys === 'number') {
      const hitY = this.vStartY + (this.vEndY - this.vStartY) * this.vBestT;
      if (this.vEndY >= 1.6 && this.vEndY <= 3.6 && hitY >= 1.5 && hitY <= 3.7) {
        const tAwning = rayObbEnterT(
          this.vOriginX,
          this.vOriginZ,
          this.vDeltaX,
          this.vDeltaZ,
          s,
          AWNING_PAD,
          AWNING_PAD,
        );
        // Ignore grazing t = 0 hits unless the endpoint is genuinely inside the awning zone.
        if (tAwning > 0.02 && tAwning < this.vBestT) {
          this.vBestT = tAwning;
        } else if (tAwning === 0) {
          const tEndCheck = rayObbEnterT(
            this.vOriginX + this.vDeltaX * 0.25,
            this.vOriginZ + this.vDeltaZ * 0.25,
            this.vDeltaX * 0.75,
            this.vDeltaZ * 0.75,
            s,
            AWNING_PAD,
            AWNING_PAD,
          );
          if (tEndCheck < 1) {
            const pulled = 0.25 + tEndCheck * 0.75;
            if (pulled < this.vBestT) this.vBestT = pulled;
          }
        }
      }
    }
  };

  private testRay(ox: number, oz: number, obb: Obb, pad: number): void {
    const t = rayObbEnterT(ox, oz, this.vDeltaX, this.vDeltaZ, obb, pad, pad);
    if (t < this.vBestT) this.vBestT = t;
  }

  reset(): void {
    this.smoothT = 1;
  }

  /**
   * Resolves occlusion in Three.js world space (`camZ` / `targetZ` negated to query sim space).
   */
  resolve(
    map: CityMap,
    groundY: (x: number, z: number) => number,
    targetX: number,
    targetY: number,
    targetZ: number,
    camX: number,
    camY: number,
    camZ: number,
    minClipDist: number,
    dt: number,
  ): OcclusionResult {
    const simTargetX = targetX;
    const simTargetZ = -targetZ;
    const simCamX = camX;
    const simCamZ = -camZ;

    const dx = simCamX - simTargetX;
    const dz = simCamZ - simTargetZ;
    const horizDist = Math.hypot(dx, dz);

    if (horizDist < 0.1) {
      this.smoothT = 1;
      this.out.x = camX;
      this.out.y = Math.max(camY, groundY(simCamX, simCamZ) + 0.85);
      this.out.z = camZ;
      this.out.t = 1;
      return this.out;
    }

    const minT = Math.min(0.86, Math.max(0.32, minClipDist / Math.max(1, horizDist)));
    const ux = dx / horizDist;
    const uz = dz / horizDist;

    this.vOriginX = simTargetX;
    this.vOriginZ = simTargetZ;
    this.vDeltaX = dx;
    this.vDeltaZ = dz;
    this.vPerpX = -uz * WHISKER_OFFSET;
    this.vPerpZ = ux * WHISKER_OFFSET;
    this.vStartY = targetY + 1.05;
    this.vEndY = camY;
    this.vBestT = 1;

    const midX = simTargetX + dx * 0.5;
    const midZ = simTargetZ + dz * 0.5;
    map.forEachSolidNear(midX, midZ, horizDist * 0.5 + 3.5, this.solidVisitor);

    // Check pedestrian bridge piers and overhead decks.
    const bridges = map.bridges;
    let underDeckCapY = Infinity;
    for (let i = 0; i < bridges.length; i++) {
      const br = bridges[i];
      const bx = br.x - midX;
      const bz = br.z - midZ;
      const halfSpan = br.span * 0.5;
      const maxReach = halfSpan + horizDist * 0.5 + 4;
      if (bx * bx + bz * bz > maxReach * maxReach) continue;

      const s = Math.sin(br.heading);
      const c = Math.cos(br.heading);

      // Overhead walkway deck (only blocks rays passing through deck height)
      const deckObb = this.tmpObb;
      deckObb.x = br.x;
      deckObb.z = br.z;
      deckObb.hw = halfSpan + 0.8;
      deckObb.hl = 1.5;
      deckObb.heading = br.heading;
      const tDeck = rayObbEnterT(simTargetX, simTargetZ, dx, dz, deckObb, 0.35, 0.35);
      if (tDeck < 1) {
        const yAtDeck = this.vStartY + (this.vEndY - this.vStartY) * tDeck;
        if (yAtDeck >= BRIDGE_DECK_Y_MIN && yAtDeck <= BRIDGE_DECK_Y_MAX && tDeck < this.vBestT) {
          this.vBestT = tDeck;
        }
      }

      // Support piers on both pavements
      if (Math.min(this.vStartY, this.vEndY) < BRIDGE_PIER_Y_MAX) {
        for (const side of [-1, 1]) {
          const pierObb = this.tmpObb;
          pierObb.x = br.x + side * c * halfSpan;
          pierObb.z = br.z - side * s * halfSpan;
          pierObb.hw = 1.15;
          pierObb.hl = 1.55;
          pierObb.heading = br.heading;
          this.testRay(simTargetX, simTargetZ, pierObb, 0.35);
          this.testRay(simTargetX + this.vPerpX, simTargetZ + this.vPerpZ, pierObb, 0.35);
          this.testRay(simTargetX - this.vPerpX, simTargetZ - this.vPerpZ, pierObb, 0.35);
        }
      }

      // Check if resolved camera position could sit under the bridge deck
      const checkT = this.vBestT < 1 ? Math.max(minT, this.vBestT - 0.08) : 1;
      const testSimX = simTargetX + dx * checkT;
      const testSimZ = simTargetZ + dz * checkT;
      const relX = testSimX - br.x;
      const relZ = testSimZ - br.z;
      const alongSpan = Math.abs(relX * c - relZ * s);
      const alongRoad = Math.abs(relX * s + relZ * c);
      if (alongSpan <= halfSpan + 1.2 && alongRoad <= 2.2 && camY < BRIDGE_DECK_Y_MIN) {
        underDeckCapY = Math.min(underDeckCapY, BRIDGE_DECK_Y_MIN - 0.3);
      }
    }

    const rawT = this.vBestT < 1 ? Math.max(minT, this.vBestT - 0.08) : 1;

    // Asymmetric hysteresis: snap inward immediately so walls never clip, ease outward smoothly.
    if (dt <= 0 || rawT < this.smoothT) {
      this.smoothT = rawT;
    } else {
      this.smoothT += (rawT - this.smoothT) * (1 - Math.exp(-dt * RELEASE_RATE));
    }

    const t = this.smoothT;
    const outX = targetX + (camX - targetX) * t;
    const outZ = targetZ + (camZ - targetZ) * t;
    let outY = targetY + (camY - targetY) * t;
    if (t < 0.995) {
      outY = Math.max(outY, targetY + 1.35) + (1 - t) * 0.65;
      if (underDeckCapY < Infinity) outY = Math.min(outY, underDeckCapY);
    }

    const floorY = groundY(outX, -outZ) + 0.85;
    if (outY < floorY) outY = floorY;

    this.out.x = outX;
    this.out.y = outY;
    this.out.z = outZ;
    this.out.t = t;
    return this.out;
  }
}
