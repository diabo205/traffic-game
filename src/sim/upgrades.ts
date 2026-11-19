import { clamp } from './math';
import type { VehicleSpec } from './PlayerCar';
import type { PlayerVehicle, VehicleShowcaseMeta } from './types';

export type UpgradeTrack = 'engine' | 'nitrous' | 'handling' | 'armor';
export type UpgradeTier = 0 | 1 | 2 | 3;

export type PaintId =
  | 'stock'
  | 'pearl-white'
  | 'karachi-yellow'
  | 'sindh-crimson'
  | 'clifton-teal'
  | 'midnight-cobalt'
  | 'monsoon-slate';

export type LiveryId = 'none' | 'truck-art' | 'taxi-check' | 'street-stripe';
export type UnderglowId = 'none' | 'cyan' | 'magenta' | 'amber' | 'lime';
export type HornId = 'stock' | 'pak-melody' | 'air-horn' | 'rickshaw-beep';

export interface VehicleBuild {
  engine: UpgradeTier;
  nitrous: UpgradeTier;
  handling: UpgradeTier;
  armor: UpgradeTier;
  /** -1 (RACE) .. +1 (DRIFT); applied when handling tier > 0 */
  handlingBias: number;
  paint: PaintId;
  livery: LiveryId;
  underglow: UnderglowId;
  horn: HornId;
}

export const UPGRADE_TRACKS: readonly UpgradeTrack[] = ['engine', 'nitrous', 'handling', 'armor'] as const;
export const MAX_UPGRADE_TIER = 3 as const;

export interface PaintOption {
  readonly id: PaintId;
  readonly label: string;
  readonly hex: number;
  readonly cost: number;
}

export interface CosmeticOption<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly cost: number;
}

export interface UnderglowOption extends CosmeticOption<UnderglowId> {
  readonly hex: number;
}

export const PAINT_CATALOG: readonly PaintOption[] = [
  { id: 'stock', label: 'Factory Paint', hex: 0xd6dde2, cost: 0 },
  { id: 'pearl-white', label: 'Pearl White', hex: 0xf4f6f8, cost: 120 },
  { id: 'karachi-yellow', label: 'Karachi Cab Yellow', hex: 0xf2b705, cost: 140 },
  { id: 'sindh-crimson', label: 'Sindh Crimson', hex: 0xb91c1c, cost: 180 },
  { id: 'clifton-teal', label: 'Clifton Teal', hex: 0x0d9488, cost: 200 },
  { id: 'midnight-cobalt', label: 'Midnight Cobalt', hex: 0x1d4ed8, cost: 220 },
  { id: 'monsoon-slate', label: 'Monsoon Matte Slate', hex: 0x334155, cost: 240 },
] as const;

export const LIVERY_CATALOG: readonly CosmeticOption<LiveryId>[] = [
  { id: 'none', label: 'Clean Body', cost: 0 },
  { id: 'taxi-check', label: 'Saddar Cab Check', cost: 180 },
  { id: 'street-stripe', label: 'Twin Racing Stripe', cost: 260 },
  { id: 'truck-art', label: 'Karachi Truck Art', cost: 450 },
] as const;

export const UNDERGLOW_CATALOG: readonly UnderglowOption[] = [
  { id: 'none', label: 'Off', hex: 0x000000, cost: 0 },
  { id: 'cyan', label: 'Neon Cyan', hex: 0x2bd9ec, cost: 220 },
  { id: 'magenta', label: 'Bazaar Magenta', hex: 0xff2d6f, cost: 240 },
  { id: 'amber', label: 'Chai Amber', hex: 0xffb347, cost: 260 },
  { id: 'lime', label: 'Turbo Lime', hex: 0xc6f432, cost: 320 },
] as const;

export const HORN_CATALOG: readonly CosmeticOption<HornId>[] = [
  { id: 'stock', label: 'Standard Horn', cost: 0 },
  { id: 'rickshaw-beep', label: 'Pee-Pee Double Beep', cost: 100 },
  { id: 'air-horn', label: 'Highway Air Horn', cost: 200 },
  { id: 'pak-melody', label: 'Pakistani Truck Melody', cost: 320 },
] as const;

const VEHICLE_TIER_COST_MUL: Readonly<Record<PlayerVehicle, number>> = {
  alto: 1.0,
  rickshaw: 1.05,
  coupe: 1.2,
  suv: 1.25,
  minibus: 1.3,
};

const TRACK_COST_MUL: Readonly<Record<UpgradeTrack, number>> = {
  engine: 1.05,
  nitrous: 1.0,
  handling: 0.95,
  armor: 0.9,
};

const TIER_BASE_COSTS: readonly [number, number, number] = [180, 420, 820];

function clampTier(raw: unknown): UpgradeTier {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  const t = Math.trunc(n);
  if (t <= 0) return 0;
  if (t >= 3) return 3;
  return t as UpgradeTier;
}

function validId<T extends string>(raw: unknown, catalog: readonly { id: T }[], fallback: T): T {
  if (typeof raw === 'string') {
    for (const item of catalog) {
      if (item.id === raw) return item.id;
    }
  }
  return fallback;
}

export function defaultVehicleBuild(_vehicle: PlayerVehicle): VehicleBuild {
  return {
    engine: 0,
    nitrous: 0,
    handling: 0,
    armor: 0,
    handlingBias: 0,
    paint: 'stock',
    livery: 'none',
    underglow: 'none',
    horn: 'stock',
  };
}

export function isStockBuild(build?: VehicleBuild): boolean {
  if (!build) return true;
  return (
    build.engine === 0 &&
    build.nitrous === 0 &&
    build.handling === 0 &&
    build.armor === 0 &&
    build.handlingBias === 0
  );
}

export function sanitizeVehicleBuild(vehicle: PlayerVehicle, raw: unknown): VehicleBuild {
  const def = defaultVehicleBuild(vehicle);
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Record<string, unknown>;
  const engine = clampTier(r.engine);
  const nitrous = clampTier(r.nitrous);
  const handling = clampTier(r.handling);
  const armor = clampTier(r.armor);
  const rawBias = typeof r.handlingBias === 'number' ? r.handlingBias : Number(r.handlingBias);
  const handlingBias = handling > 0 && Number.isFinite(rawBias) ? clamp(rawBias, -1, 1) : 0;
  return {
    engine,
    nitrous,
    handling,
    armor,
    handlingBias,
    paint: validId(r.paint, PAINT_CATALOG, def.paint),
    livery: validId(r.livery, LIVERY_CATALOG, def.livery),
    underglow: validId(r.underglow, UNDERGLOW_CATALOG, def.underglow),
    horn: validId(r.horn, HORN_CATALOG, def.horn),
  };
}

export function upgradeCost(vehicle: PlayerVehicle, track: UpgradeTrack, nextTier: 1 | 2 | 3): number {
  const base = TIER_BASE_COSTS[nextTier - 1];
  const raw = base * VEHICLE_TIER_COST_MUL[vehicle] * TRACK_COST_MUL[track];
  return Math.max(10, Math.round(raw / 10) * 10);
}

export function cosmeticCost(slot: 'paint' | 'livery' | 'underglow' | 'horn', id: string): number {
  const list: readonly { id: string; cost: number }[] =
    slot === 'paint'
      ? PAINT_CATALOG
      : slot === 'livery'
        ? LIVERY_CATALOG
        : slot === 'underglow'
          ? UNDERGLOW_CATALOG
          : HORN_CATALOG;
  const found = list.find((item) => item.id === id);
  return found ? found.cost : 0;
}

export function maxIntegrityForBuild(build?: VehicleBuild): number {
  const armor = build ? clampTier(build.armor) : 0;
  return 100 + armor * 15;
}

export function applyUpgrades(_vehicle: PlayerVehicle, baseSpec: VehicleSpec, build?: VehicleBuild): VehicleSpec {
  if (!build || isStockBuild(build)) return baseSpec;

  const e = clampTier(build.engine);
  const n = clampTier(build.nitrous);
  const h = clampTier(build.handling);
  const a = clampTier(build.armor);
  const rawBias = Number.isFinite(build.handlingBias) ? build.handlingBias : 0;
  const bias = h > 0 ? clamp(rawBias, -1, 1) : 0;

  if (e === 0 && n === 0 && h === 0 && a === 0 && bias === 0) return baseSpec;

  return {
    ...baseSpec,
    driveAccel: baseSpec.driveAccel * (1 + 0.08 * e),
    topSpeedMul: baseSpec.topSpeedMul * (1 + 0.045 * e),
    reverseAccel: baseSpec.reverseAccel * (1 + 0.06 * e),

    boostAccel: baseSpec.boostAccel * (1 + 0.11 * n),
    boostTopSpeedMul: baseSpec.boostTopSpeedMul + 0.03 * n,
    boostDurationMul: baseSpec.boostDurationMul * (1 + 0.12 * n),
    boostCooldown: baseSpec.boostCooldown * (1 - 0.09 * n),

    maxLateralAccel: baseSpec.maxLateralAccel * (1 + 0.06 * h - 0.05 * bias),
    steerRate: baseSpec.steerRate * (1 + 0.06 * h),
    steerReturnRate: baseSpec.steerReturnRate * (1 + 0.05 * h),
    offroadTraction: clamp(baseSpec.offroadTraction + (0.99 - baseSpec.offroadTraction) * 0.25 * h, 0.4, 0.99),
    offroadDragMul: Math.max(0.45, baseSpec.offroadDragMul * (1 - 0.05 * h)),
    driftSlideKeep: clamp(baseSpec.driftSlideKeep + 0.025 * bias, 0.72, 0.97),
    driftYawBoost: clamp(baseSpec.driftYawBoost + 0.06 * h + 0.08 * bias, 0.35, 0.85),

    damageRes: Math.max(0.35, baseSpec.damageRes * (1 - 0.11 * a)),
  };
}

export function deriveShowcaseMeta(
  _vehicle: PlayerVehicle,
  baseMeta: VehicleShowcaseMeta,
  build?: VehicleBuild,
): VehicleShowcaseMeta {
  if (!build) return baseMeta;

  const e = clampTier(build.engine);
  const n = clampTier(build.nitrous);
  const h = clampTier(build.handling);
  const a = clampTier(build.armor);
  const rawBias = Number.isFinite(build.handlingBias) ? build.handlingBias : 0;
  const bias = h > 0 ? clamp(rawBias, -1, 1) : 0;

  const hasCosmetic =
    build.paint !== 'stock' || build.livery !== 'none' || build.underglow !== 'none' || build.horn !== 'stock';

  if (e === 0 && n === 0 && h === 0 && a === 0 && bias === 0 && !hasCosmetic) {
    return baseMeta;
  }

  const round1 = (v: number) => Math.round(clamp(v, 0, 10) * 10) / 10;
  const paintOpt = build.paint !== 'stock' ? PAINT_CATALOG.find((p) => p.id === build.paint) : undefined;
  const cosmeticBonus =
    (build.paint !== 'stock' ? 1 : 0) +
    (build.livery !== 'none' ? 1 : 0) +
    (build.underglow !== 'none' ? 1 : 0) +
    (build.horn !== 'stock' ? 1 : 0);
  const tierSum = e + n + h + a;
  const customDelta = Math.min(5, Math.ceil(tierSum / 3) + cosmeticBonus);

  return {
    ...baseMeta,
    perfRating: Math.round(baseMeta.perfRating + e * 12 + n * 10 + h * 8 + a * 6),
    stats: {
      power: round1(baseMeta.stats.power + e * 0.7 + a * 0.15),
      highSpeed: round1(baseMeta.stats.highSpeed + e * 0.65 + n * 0.2),
      acceleration: round1(baseMeta.stats.acceleration + e * 0.6 + h * 0.2),
      nitrous: round1(baseMeta.stats.nitrous + n * 0.9),
    },
    handlingGrid: {
      x: clamp(baseMeta.handlingGrid.x + bias * 0.45, -1, 1),
      y: clamp(baseMeta.handlingGrid.y + h * 0.08, -1, 1),
    },
    customizationRating: Math.max(1, Math.min(10, baseMeta.customizationRating + customDelta)),
    paintHex: paintOpt ? paintOpt.hex : baseMeta.paintHex,
  };
}
