import { PLAYER_VEHICLES, VEHICLE_COST } from '../sim/PlayerCar';
import { clamp } from '../sim/math';
import type { PlayerVehicle } from '../sim/types';
import {
  cosmeticCost,
  HORN_CATALOG,
  LIVERY_CATALOG,
  MAX_UPGRADE_TIER,
  PAINT_CATALOG,
  sanitizeVehicleBuild,
  UNDERGLOW_CATALOG,
  upgradeCost,
} from '../sim/upgrades';
import type {
  HornId,
  LiveryId,
  PaintId,
  UnderglowId,
  UpgradeTier,
  UpgradeTrack,
  VehicleBuild,
} from '../sim/upgrades';

export type CosmeticSlot = 'paint' | 'livery' | 'underglow' | 'horn';

export interface OwnedCosmetics {
  paint: Set<PaintId>;
  livery: Set<LiveryId>;
  underglow: Set<UnderglowId>;
  horn: Set<HornId>;
}

export interface ParsedGarageState {
  bank: number;
  builds: Record<PlayerVehicle, VehicleBuild>;
  owned: OwnedCosmetics;
  unlocked: Set<PlayerVehicle>;
}

export type UpgradePurchaseResult =
  | { ok: true; cost: number; newTier: UpgradeTier }
  | { ok: false; reason: 'locked' | 'max' | 'insufficient'; cost: number };

export type CosmeticSelectResult =
  | { ok: true; purchased: boolean; cost: number }
  | { ok: false; purchased: false; reason: 'locked' | 'invalid' | 'insufficient'; cost: number };

const STORAGE_BANK = 'kt3d.bank';
const STORAGE_BUILDS = 'kt3d.builds.v2';
const STORAGE_OWNED = 'kt3d.owned.v2';
const STORAGE_UNLOCKED = 'kt3d.unlocked.v2';

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function seedOwnedSet<T extends string>(
  rawList: unknown,
  catalog: readonly { id: T }[],
  defaultId: T,
): Set<T> {
  const validIds = new Set(catalog.map((c) => c.id));
  const out = new Set<T>([defaultId]);
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (typeof item === 'string' && validIds.has(item as T)) {
        out.add(item as T);
      }
    }
  }
  return out;
}

/**
 * Pure parser/sanitizer for persisted garage state (`localStorage` strings).
 * Safe to call in Node unit tests or browsers with corrupted storage values.
 */
export function parseGarageState(
  rawBank: string | null,
  rawBuilds: string | null,
  rawOwned: string | null,
  rawUnlocked: string | null,
): ParsedGarageState {
  const nBank = Number(rawBank ?? '0');
  const bank = Number.isFinite(nBank) && nBank > 0 ? Math.floor(nBank) : 0;

  const parsedBuilds = safeJsonParse(rawBuilds);
  const buildRecord =
    parsedBuilds && typeof parsedBuilds === 'object' && !Array.isArray(parsedBuilds)
      ? (parsedBuilds as Record<string, unknown>)
      : {};

  const parsedOwned = safeJsonParse(rawOwned);
  const ownedObj =
    parsedOwned && typeof parsedOwned === 'object' && !Array.isArray(parsedOwned)
      ? (parsedOwned as Record<string, unknown>)
      : {};

  const owned: OwnedCosmetics = {
    paint: seedOwnedSet(ownedObj.paint, PAINT_CATALOG, 'stock'),
    livery: seedOwnedSet(ownedObj.livery, LIVERY_CATALOG, 'none'),
    underglow: seedOwnedSet(ownedObj.underglow, UNDERGLOW_CATALOG, 'none'),
    horn: seedOwnedSet(ownedObj.horn, HORN_CATALOG, 'stock'),
  };

  const builds = {} as Record<PlayerVehicle, VehicleBuild>;
  for (const v of PLAYER_VEHICLES) {
    const b = sanitizeVehicleBuild(v, buildRecord[v]);
    builds[v] = b;
    owned.paint.add(b.paint);
    owned.livery.add(b.livery);
    owned.underglow.add(b.underglow);
    owned.horn.add(b.horn);
  }

  const unlocked = new Set<PlayerVehicle>();
  const parsedUnlocked = safeJsonParse(rawUnlocked);
  if (Array.isArray(parsedUnlocked)) {
    for (const item of parsedUnlocked) {
      if (typeof item === 'string' && PLAYER_VEHICLES.includes(item as PlayerVehicle)) {
        unlocked.add(item as PlayerVehicle);
      }
    }
  }
  for (const v of PLAYER_VEHICLES) {
    if (bank >= VEHICLE_COST[v]) {
      unlocked.add(v);
    }
  }

  return { bank, builds, owned, unlocked };
}

function isCatalogId(slot: CosmeticSlot, id: string): boolean {
  switch (slot) {
    case 'paint':
      return PAINT_CATALOG.some((c) => c.id === id);
    case 'livery':
      return LIVERY_CATALOG.some((c) => c.id === id);
    case 'underglow':
      return UNDERGLOW_CATALOG.some((c) => c.id === id);
    case 'horn':
      return HORN_CATALOG.some((c) => c.id === id);
  }
}

/**
 * Persistent garage economy, per-vehicle upgrades, owned cosmetics, and unlocked fleet.
 */
export class GarageStore {
  private _bank: number;
  private readonly builds: Record<PlayerVehicle, VehicleBuild>;
  private readonly owned: OwnedCosmetics;
  private readonly unlocked: Set<PlayerVehicle>;
  private readonly persist: boolean;

  constructor(initial: ParsedGarageState, persist = false) {
    this._bank = initial.bank;
    this.builds = initial.builds;
    this.owned = initial.owned;
    this.unlocked = initial.unlocked;
    this.persist = persist;
  }

  static loadFromStorage(): GarageStore {
    let rawBank: string | null = null;
    let rawBuilds: string | null = null;
    let rawOwned: string | null = null;
    let rawUnlocked: string | null = null;
    try {
      rawBank = window.localStorage.getItem(STORAGE_BANK);
      rawBuilds = window.localStorage.getItem(STORAGE_BUILDS);
      rawOwned = window.localStorage.getItem(STORAGE_OWNED);
      rawUnlocked = window.localStorage.getItem(STORAGE_UNLOCKED);
    } catch {
      /* private mode etc. */
    }
    return new GarageStore(parseGarageState(rawBank, rawBuilds, rawOwned, rawUnlocked), true);
  }

  get bank(): number {
    return this._bank;
  }

  addBank(delta: number): PlayerVehicle[] {
    const gain = Math.round(delta);
    if (!Number.isFinite(gain) || gain <= 0) return [];
    this._bank += gain;
    const newlyUnlocked: PlayerVehicle[] = [];
    for (const v of PLAYER_VEHICLES) {
      if (!this.unlocked.has(v) && this._bank >= VEHICLE_COST[v]) {
        this.unlocked.add(v);
        newlyUnlocked.push(v);
      }
    }
    this.save();
    return newlyUnlocked;
  }

  isVehicleUnlocked(v: PlayerVehicle): boolean {
    return this.unlocked.has(v) || this._bank >= VEHICLE_COST[v];
  }

  getBuild(v: PlayerVehicle): VehicleBuild {
    return { ...this.builds[v] };
  }

  isCosmeticOwned(slot: CosmeticSlot, id: string): boolean {
    switch (slot) {
      case 'paint':
        return this.owned.paint.has(id as PaintId);
      case 'livery':
        return this.owned.livery.has(id as LiveryId);
      case 'underglow':
        return this.owned.underglow.has(id as UnderglowId);
      case 'horn':
        return this.owned.horn.has(id as HornId);
    }
  }

  buyUpgrade(v: PlayerVehicle, track: UpgradeTrack): UpgradePurchaseResult {
    if (!this.isVehicleUnlocked(v)) {
      return { ok: false, reason: 'locked', cost: 0 };
    }
    const build = this.builds[v];
    const current = build[track];
    if (current >= MAX_UPGRADE_TIER) {
      return { ok: false, reason: 'max', cost: 0 };
    }
    const nextTier = (current + 1) as 1 | 2 | 3;
    const cost = upgradeCost(v, track, nextTier);
    if (this._bank < cost) {
      return { ok: false, reason: 'insufficient', cost };
    }
    this._bank -= cost;
    build[track] = nextTier;
    this.save();
    return { ok: true, cost, newTier: nextTier };
  }

  setHandlingBias(v: PlayerVehicle, bias: number): boolean {
    if (!this.isVehicleUnlocked(v)) return false;
    const build = this.builds[v];
    if (build.handling < 1 || !Number.isFinite(bias)) return false;
    const clamped = Math.round(clamp(bias, -1, 1) * 10) / 10;
    build.handlingBias = Object.is(clamped, -0) ? 0 : clamped;
    this.save();
    return true;
  }

  selectOrBuyCosmetic(v: PlayerVehicle, slot: CosmeticSlot, id: string): CosmeticSelectResult {
    if (!isCatalogId(slot, id)) {
      return { ok: false, purchased: false, reason: 'invalid', cost: 0 };
    }
    if (!this.isVehicleUnlocked(v)) {
      return { ok: false, purchased: false, reason: 'locked', cost: 0 };
    }

    const build = this.builds[v];
    if (this.isCosmeticOwned(slot, id)) {
      this.assignCosmetic(build, slot, id);
      this.save();
      return { ok: true, purchased: false, cost: 0 };
    }

    const cost = cosmeticCost(slot, id);
    if (this._bank < cost) {
      return { ok: false, purchased: false, reason: 'insufficient', cost };
    }
    this._bank -= cost;
    this.markCosmeticOwned(slot, id);
    this.assignCosmetic(build, slot, id);
    this.save();
    return { ok: true, purchased: true, cost };
  }

  private markCosmeticOwned(slot: CosmeticSlot, id: string): void {
    switch (slot) {
      case 'paint':
        this.owned.paint.add(id as PaintId);
        break;
      case 'livery':
        this.owned.livery.add(id as LiveryId);
        break;
      case 'underglow':
        this.owned.underglow.add(id as UnderglowId);
        break;
      case 'horn':
        this.owned.horn.add(id as HornId);
        break;
    }
  }

  private assignCosmetic(build: VehicleBuild, slot: CosmeticSlot, id: string): void {
    switch (slot) {
      case 'paint':
        build.paint = id as PaintId;
        break;
      case 'livery':
        build.livery = id as LiveryId;
        break;
      case 'underglow':
        build.underglow = id as UnderglowId;
        break;
      case 'horn':
        build.horn = id as HornId;
        break;
    }
  }

  save(): void {
    if (!this.persist || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_BANK, String(this._bank));
      window.localStorage.setItem(STORAGE_BUILDS, JSON.stringify(this.builds));
      window.localStorage.setItem(
        STORAGE_OWNED,
        JSON.stringify({
          paint: [...this.owned.paint],
          livery: [...this.owned.livery],
          underglow: [...this.owned.underglow],
          horn: [...this.owned.horn],
        }),
      );
      window.localStorage.setItem(STORAGE_UNLOCKED, JSON.stringify([...this.unlocked]));
    } catch {
      /* ignore private mode storage errors */
    }
  }
}
