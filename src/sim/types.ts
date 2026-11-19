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

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Seconds to land the next stunt before the combo banks. */
export const COMBO_WINDOW = 3;

/**
 * Damage from hitting traffic. Soft at city-traffic closing speeds (a
 * nudge at 15 km/h is a few HP), still brutal for a head-on at speed.
 */
export function trafficDamage(impact: number, kindDamage: number): number {
  if (impact <= 2.5) return 0;
  const x = impact - 2.5;
  return Math.min(8 + kindDamage * 6.5, x * (0.2 + x * 0.032) * kindDamage);
}

export type NpcKind = 'bike' | 'minibus' | 'rickshaw' | 'cart' | 'car' | 'truck';

export type PlayerVehicle = 'alto' | 'coupe' | 'rickshaw' | 'suv' | 'minibus';

export interface VehicleShowcaseStats {
  power: number;        // 0..10
  highSpeed: number;    // 0..10
  acceleration: number; // 0..10
  nitrous: number;      // 0..10
}

export interface VehicleShowcaseMeta {
  id: PlayerVehicle;
  brand: string;
  model: string;
  badgeName: string;
  perfRating: number;
  stats: VehicleShowcaseStats;
  handlingGrid: { x: number; y: number }; // x: -1 (RACE) .. +1 (DRIFT), y: -1 (ROAD) .. +1 (OFF-ROAD)
  customizationRating: number; // integer 1..10
  paintHex: number;
}

export type HazardKind = 'pothole' | 'manhole' | 'water' | 'barrier' | 'checkpoint';

export type GamePhase = 'ready' | 'running' | 'gameover' | 'complete';

export type GameOverReason = 'time' | 'wrecked' | null;

/** What the renderer needs from any NPC (route or city traffic). */
export interface NpcView {
  id: number;
  kind: NpcKind;
  variant: number;
  x: number;
  z: number;
  heading: number;
  prevX: number;
  prevZ: number;
  prevHeading: number;
  /** +1 with traffic, -1 wrong-way (route mode) */
  dir: 1 | -1;
  latVel: number;
  brakeLights: boolean;
  hazardLights: boolean;
}

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
  /** stuck nose-first against a wall with the gas held (HUD hints to reverse) */
  | { type: 'pinned' }
  | { type: 'checkpoint'; label: string; bonus: number }
  | { type: 'zone'; zoneIndex: number; name: string; banner: string }
  | { type: 'kerb'; severity: number }
  | { type: 'street'; name: string }
  | { type: 'shiftStart'; time: number }
  | { type: 'shiftOver'; earned: number; fares: number }
  | { type: 'pickup'; name: string; time: number; distance: number; kind?: 'standard' | 'vip' | 'party' | 'chai'; stops?: number }
  | { type: 'dropoff'; name: string; pay: number; tip: number; bonus: number; rating: number; chain?: number; kind?: 'standard' | 'vip' | 'party' | 'chai'; nextStop?: string }
  | { type: 'fareSpill'; name: string; spills: number }
  | { type: 'fareFailed'; name: string; reason: 'time' | 'shift' | 'towed' }
  | { type: 'towed'; cost: number }
  | { type: 'boost'; kind: 'launch' | 'dash' | 'drift' }
  | { type: 'boostCharge'; meter: number; delta: number; source: 'drift' | 'nearMiss' | 'air' | 'honk' }
  | { type: 'drift'; seconds: number }
  | { type: 'jump' }
  | { type: 'land'; impact: number; air: number }
  | { type: 'smash'; kind: string; x: number; z: number; impact: number }
  | { type: 'stunt'; kind: string; label: string; points: number; mult: number }
  | { type: 'comboEnd'; total: number; mult: number; tip: number }
  | { type: 'comboBroken'; lost: number }
  | { type: 'honk'; cleared: number }
  | { type: 'pedDodge'; count: number }
  | { type: 'gameover'; reason: Exclude<GameOverReason, null> }
  | { type: 'complete' };
