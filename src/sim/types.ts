/**
 * Shared simulation types. Pure data — no Three.js, no DOM.
 *
 * Coordinate system (sim space):
 *   x = lateral, positive = driver's RIGHT
 *   z = longitudinal, positive = FORWARD along the route
 *   heading = radians, 0 = facing +z, positive = turned right.
 *   Pakistan drives on the LEFT: the slow lane / shoulder is at negative x,
 *   the central median is at positive x.
 */

export interface InputFrame {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** held */
  horn: boolean;
  /** momentary high-beam flash, held */
  dipper: boolean;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  horn: false,
  dipper: false,
});

export type NpcKind = 'bike' | 'minibus' | 'rickshaw' | 'cart' | 'car' | 'truck';

export type HazardKind = 'pothole' | 'manhole' | 'water' | 'barrier' | 'checkpoint';

export type GamePhase = 'ready' | 'running' | 'gameover' | 'complete';

export type GameOverReason = 'time' | 'wrecked' | null;

/** Oriented box in the XZ plane. */
export interface Obb {
  x: number;
  z: number;
  /** half width (lateral) */
  hw: number;
  /** half length (longitudinal) */
  hl: number;
  heading: number;
}

export type SimEvent =
  | { type: 'pothole'; severity: number; damage: number }
  | { type: 'manhole'; damage: number }
  | { type: 'splash' }
  | { type: 'crash'; impact: number; damage: number; x: number; z: number }
  | { type: 'scrape'; intensity: number }
  | { type: 'checkpoint'; label: string; bonus: number }
  | { type: 'zone'; zoneIndex: number; name: string; banner: string }
  | { type: 'gameover'; reason: Exclude<GameOverReason, null> }
  | { type: 'complete' };
