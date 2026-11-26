import type { InputManager } from '../input/InputManager';
import type { GarageProjection } from '../render/GarageScene';
import { PLAYER_VEHICLES, VEHICLE_COST, VEHICLE_SHOWCASE } from '../sim/PlayerCar';
import type { PlayerVehicle } from '../sim/types';
import {
  cosmeticCost,
  defaultVehicleBuild,
  deriveShowcaseMeta,
  HORN_CATALOG,
  LIVERY_CATALOG,
  MAX_UPGRADE_TIER,
  maxIntegrityForBuild,
  PAINT_CATALOG,
  UNDERGLOW_CATALOG,
  UPGRADE_TRACKS,
  upgradeCost,
} from '../sim/upgrades';
import type { UpgradeTrack, VehicleBuild } from '../sim/upgrades';
import type { CosmeticSlot, GarageStore } from './GarageStore';

type GarageTab = 'stats' | 'perf' | 'style';

const TRACK_LABELS: Readonly<Record<UpgradeTrack, { title: string; effect: string }>> = {
  engine: { title: 'ENGINE / TURBO', effect: '+8% ACCEL & +4.5% TOP SPD' },
  nitrous: { title: 'NITROUS OXIDE', effect: '+11% BOOST & FASTER RECHARGE' },
  handling: { title: 'SUSPENSION & TYRES', effect: '+6% CORNER GRIP & DRIFT TUNE' },
  armor: { title: 'CHASSIS ARMOR', effect: '+15 MAX HP & 11% IMPACT RES' },
};

export interface GarageActionHandlers {
  onBuyUpgrade?: (vehicle: PlayerVehicle, track: UpgradeTrack) => void;
  onHandlingBias?: (vehicle: PlayerVehicle, bias: number) => void;
  onSelectCosmetic?: (vehicle: PlayerVehicle, slot: CosmeticSlot, id: string) => void;
  onPreviewHorn?: (vehicle: PlayerVehicle, hornId: string) => void;
}

export class CarSelectScreen {
  readonly root: HTMLDivElement;
  private selectedIndex = 0;
  private vehicles: readonly PlayerVehicle[] = PLAYER_VEHICLES;
  private bank = 0;
  private store: GarageStore | null = null;
  private activeTab: GarageTab = 'stats';
  private adjacentVehicle: PlayerVehicle = PLAYER_VEHICLES[1];
  private onSelectCb: (vehicle: PlayerVehicle) => void = () => {};
  private onChangeCb: (vehicle: PlayerVehicle, adjacent: PlayerVehicle) => void = () => {};
  private onBackCb: () => void = () => {};
  private actions: GarageActionHandlers = {};

  // Left panel header & bank summary
  private panelEl: HTMLDivElement;
  private brandEl: HTMLDivElement;
  private modelEl: HTMLDivElement;
  private perfRatingEl: HTMLSpanElement;
  private bankValEl: HTMLSpanElement;
  private buildBadgeEl: HTMLSpanElement;
  private statusLiveEl: HTMLDivElement;

  // Accessible tabs & panels
  private tabButtons: Record<GarageTab, HTMLButtonElement>;
  private tabPanels: Record<GarageTab, HTMLDivElement>;

  // Stats tab elements (preserved selectors for e2e-car-select.mjs)
  private statRows: Record<'power' | 'highSpeed' | 'acceleration' | 'nitrous', { fill: HTMLDivElement; val: HTMLSpanElement }>;
  private handlingDot: HTMLDivElement;
  private customSegs: NodeListOf<HTMLDivElement>;
  private customValEl: HTMLSpanElement;

  // Performance upgrades tab elements
  private upgRows: Record<UpgradeTrack, { pips: NodeListOf<HTMLSpanElement>; buyBtn: HTMLButtonElement; btnCost: HTMLSpanElement }>;
  private biasSlider: HTMLInputElement;
  private biasValEl: HTMLSpanElement;
  private biasHintEl: HTMLSpanElement;

  // Style tab elements
  private paintBtns = new Map<string, HTMLButtonElement>();
  private liveryBtns = new Map<string, HTMLButtonElement>();
  private glowBtns = new Map<string, HTMLButtonElement>();
  private hornBtns = new Map<string, HTMLButtonElement>();

  // Floating 3D-projected tag & adjacent car badge
  private tagAnchorEl: HTMLDivElement;
  private tagNameEl: HTMLDivElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private adjBadgeBtn: HTMLButtonElement;

  // Bottom-left action prompts
  private goBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, private readonly input: InputManager) {
    this.root = document.createElement('div');
    this.root.className = 'screen car-select hidden';

    const upgMarkup = UPGRADE_TRACKS.map((track) => {
      const meta = TRACK_LABELS[track];
      return `
        <div class="upg-row" data-track="${track}">
          <div class="upg-meta">
            <div class="upg-top">
              <span class="upg-name">${meta.title}</span>
              <span class="upg-pips" aria-hidden="true">
                <span class="upg-pip"></span><span class="upg-pip"></span><span class="upg-pip"></span>
              </span>
            </div>
            <div class="upg-effect">${meta.effect}</div>
          </div>
          <button type="button" class="upg-buy-btn" data-track="${track}">
            <span class="upg-btn-cost">RS 180</span>
          </button>
        </div>`;
    }).join('');

    const paintMarkup = PAINT_CATALOG.map((p) => {
      const hex = `#${p.hex.toString(16).padStart(6, '0')}`;
      return `<button type="button" class="paint-swatch" data-slot="paint" data-id="${p.id}" aria-pressed="false" title="${p.label}">
        <span class="swatch-chip" style="background:${hex}" aria-hidden="true"></span>
        <span class="swatch-tag">${p.cost === 0 ? 'STOCK' : `RS ${p.cost}`}</span>
      </button>`;
    }).join('');

    const liveryMarkup = LIVERY_CATALOG.map((l) => {
      return `<button type="button" class="style-chip" data-slot="livery" data-id="${l.id}" aria-pressed="false">
        <span class="chip-name">${l.label}</span>
        <span class="chip-cost">${l.cost === 0 ? 'FREE' : `RS ${l.cost}`}</span>
      </button>`;
    }).join('');

    const glowMarkup = UNDERGLOW_CATALOG.map((g) => {
      const hex = g.hex === 0 ? 'transparent' : `#${g.hex.toString(16).padStart(6, '0')}`;
      return `<button type="button" class="glow-swatch" data-slot="underglow" data-id="${g.id}" aria-pressed="false" title="${g.label}">
        <span class="swatch-chip ${g.hex === 0 ? 'is-off' : ''}" style="--chip-col:${hex}" aria-hidden="true"></span>
        <span class="swatch-tag">${g.cost === 0 ? 'OFF' : `RS ${g.cost}`}</span>
      </button>`;
    }).join('');

    const hornMarkup = HORN_CATALOG.map((h) => {
      return `<div class="horn-row">
        <button type="button" class="horn-preview-btn" data-horn="${h.id}" aria-label="Preview ${h.label}"><span aria-hidden="true">🔊</span></button>
        <button type="button" class="style-chip horn-equip-btn" data-slot="horn" data-id="${h.id}" aria-pressed="false">
          <span class="chip-name">${h.label}</span>
          <span class="chip-cost">${h.cost === 0 ? 'FREE' : `RS ${h.cost}`}</span>
        </button>
      </div>`;
    }).join('');

    this.root.innerHTML = `
      <div class="car-panel">
        <div class="car-panel-head">
          <div class="car-identity">
            <div class="car-brand">SUZUKI</div>
            <div class="car-model">Alto 660cc</div>
          </div>
          <div class="car-rating-wrap">
            <svg class="car-rating-icon" viewBox="0 0 24 14" aria-hidden="true">
              <path d="M2 10 L4 5 L9 3 L16 3 L20 6 L22 10 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <circle cx="6.5" cy="10.5" r="2" fill="currentColor"/>
              <circle cx="17.5" cy="10.5" r="2" fill="currentColor"/>
            </svg>
            <span class="car-perf-rating">118</span>
          </div>
        </div>

        <div class="car-bank-row">
          <span class="car-build-badge">STOCK · 100 HP</span>
          <span class="car-bank-pill">BANK <strong class="car-bank-val">RS 0</strong></span>
        </div>

        <div class="car-tablist" role="tablist" focusgroup="tablist nomemory" aria-label="Garage sections">
          <button type="button" role="tab" id="garage-tab-stats" class="car-tab" data-tab="stats" aria-selected="true" focusgroupstart>STATS</button>
          <button type="button" role="tab" id="garage-tab-perf" class="car-tab" data-tab="perf" aria-selected="false" tabindex="-1">UPGRADES</button>
          <button type="button" role="tab" id="garage-tab-style" class="car-tab" data-tab="style" aria-selected="false" tabindex="-1">STYLE</button>
        </div>

        <div class="car-tab-panels">
          <div role="tabpanel" class="car-tabpanel" data-panel="stats" aria-labelledby="garage-tab-stats" tabindex="0">
            <div class="car-tab-inner car-stats-inner">
              <div class="car-stats">
                <div class="car-stat" data-stat="power">
                  <div class="car-stat-label">POWER</div>
                  <div class="car-stat-row">
                    <div class="car-stat-track"><div class="car-stat-fill"></div></div>
                    <span class="car-stat-val">2.8</span>
                  </div>
                </div>
                <div class="car-stat" data-stat="highSpeed">
                  <div class="car-stat-label">HIGH SPEED</div>
                  <div class="car-stat-row">
                    <div class="car-stat-track"><div class="car-stat-fill"></div></div>
                    <span class="car-stat-val">4.2</span>
                  </div>
                </div>
                <div class="car-stat" data-stat="acceleration">
                  <div class="car-stat-label">ACCELERATION</div>
                  <div class="car-stat-row">
                    <div class="car-stat-track"><div class="car-stat-fill"></div></div>
                    <span class="car-stat-val">4.5</span>
                  </div>
                </div>
                <div class="car-stat" data-stat="nitrous">
                  <div class="car-stat-label">NITROUS</div>
                  <div class="car-stat-row">
                    <div class="car-stat-track"><div class="car-stat-fill"></div></div>
                    <span class="car-stat-val">5.0</span>
                  </div>
                </div>
              </div>

              <div class="handling-section">
                <div class="handling-diamond" aria-label="Handling profile">
                  <span class="hd-lbl hd-top">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2h6M8 2v12M5 5l6 2M5 9l6 2M5 14h6" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>
                    OFF-ROAD
                  </span>
                  <span class="hd-lbl hd-left">
                    RACE
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2v12M3 3h9l-2 3 2 3H3" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>
                  </span>
                  <span class="hd-lbl hd-right">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12c3-5 6-7 10-8M5 13c2-3 5-5 8-5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>
                    DRIFT
                  </span>
                  <span class="hd-lbl hd-bottom">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M2.5 7.5h11M8 8v6M5.5 11.5l2.5-3.5 2.5 3.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
                    ROAD
                  </span>
                  <div class="hd-grid">
                    <div class="hd-ring hd-ring-1"></div>
                    <div class="hd-ring hd-ring-2"></div>
                    <div class="hd-ring hd-ring-3"></div>
                    <div class="hd-axis hd-axis-x"></div>
                    <div class="hd-axis hd-axis-y"></div>
                    <div class="handling-dot"></div>
                  </div>
                </div>
              </div>

              <div class="custom-section">
                <div class="custom-title">CUSTOMIZATION RATING</div>
                <div class="custom-row">
                  <div class="custom-rating">
                    <div class="seg"></div><div class="seg"></div><div class="seg"></div><div class="seg"></div><div class="seg"></div>
                    <div class="seg"></div><div class="seg"></div><div class="seg"></div><div class="seg"></div><div class="seg"></div>
                  </div>
                  <span class="custom-rating-val">5/10</span>
                </div>
              </div>
            </div>
          </div>

          <div role="tabpanel" class="car-tabpanel" data-panel="perf" aria-labelledby="garage-tab-perf" hidden="until-found">
            <div class="car-tab-inner car-perf-inner">
              <div class="upg-list">${upgMarkup}</div>
              <div class="bias-box">
                <div class="bias-head">
                  <label class="bias-label" for="handling-bias-slider">HANDLING BIAS</label>
                  <span class="bias-val">BALANCED</span>
                </div>
                <input
                  type="range"
                  id="handling-bias-slider"
                  class="bias-slider"
                  min="-1"
                  max="1"
                  step="0.1"
                  value="0"
                  aria-describedby="handling-bias-hint"
                />
                <div class="bias-ends" aria-hidden="true"><span>RACE</span><span>CENTER</span><span>DRIFT</span></div>
                <div id="handling-bias-hint" class="bias-hint">Install Suspension Tier 1 to unlock tuning</div>
              </div>
            </div>
          </div>

          <div role="tabpanel" class="car-tabpanel" data-panel="style" aria-labelledby="garage-tab-style" hidden="until-found">
            <div class="car-tab-inner car-style-inner">
              <div class="style-group">
                <div class="style-head">BODY PAINT</div>
                <div class="swatch-grid">${paintMarkup}</div>
              </div>
              <div class="style-group">
                <div class="style-head">LIVERY WRAP</div>
                <div class="chip-grid">${liveryMarkup}</div>
              </div>
              <div class="style-group">
                <div class="style-head">NEON UNDERGLOW</div>
                <div class="swatch-grid glow-grid">${glowMarkup}</div>
              </div>
              <div class="style-group">
                <div class="style-head">HORN &amp; SOUND</div>
                <div class="horn-list">${hornMarkup}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="car-status-live" aria-live="polite"></div>
      </div>

      <div class="car-tag-anchor">
        <div class="car-tag-name">Suzuki Alto 660</div>
        <div class="car-tag-controls">
          <button type="button" class="car-arrow prev" aria-label="Previous vehicle">◀</button>
          <div class="car-gear-badge" aria-hidden="true">
            <svg class="car-gear-cog" viewBox="0 0 40 40">
              <path d="M20 3 L23 7 L28 5.5 L29.5 10 L34.5 11 L33.5 16 L37.5 19 L34.5 23 L36.5 27.5 L31.5 29.5 L31 34.5 L26 34 L23 38 L19 35 L14.5 37.5 L12.5 32.5 L7.5 32.5 L8 27.5 L3.5 25 L6 20.5 L3 16 L7.5 13.5 L7 8.5 L12 8.5 L14.5 4 L19 6.5 Z" fill="#ffffff"/>
              <circle cx="20" cy="20.5" r="11.5" fill="#2bd9ec"/>
              <path d="M12.5 22 L14 17.5 L17 16 H23 L26 17.5 L27.5 22 Z" fill="#ffffff"/>
              <circle cx="15.5" cy="23" r="1.7" fill="#ffffff"/>
              <circle cx="24.5" cy="23" r="1.7" fill="#ffffff"/>
            </svg>
          </div>
          <button type="button" class="car-arrow next" aria-label="Next vehicle">▶</button>
        </div>
      </div>

      <button type="button" class="car-adj-badge" aria-label="Switch to adjacent vehicle">
        <svg viewBox="0 0 24 14" aria-hidden="true">
          <path d="M2 10 L4 5 L9 3 L16 3 L20 6 L22 10 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          <circle cx="6.5" cy="10.5" r="2" fill="currentColor"/>
          <circle cx="17.5" cy="10.5" r="2" fill="currentColor"/>
        </svg>
      </button>

      <div class="car-actions">
        <button type="button" class="car-select-go">
          <span class="key-cap">✕</span>
          <span class="go-text">SELECT</span>
        </button>
        <button type="button" class="car-select-back">
          <span class="key-cap">ESC</span>
          <span>BACK</span>
        </button>
      </div>
    `;

    parent.appendChild(this.root);

    this.panelEl = this.root.querySelector('.car-panel')!;
    this.brandEl = this.root.querySelector('.car-brand')!;
    this.modelEl = this.root.querySelector('.car-model')!;
    this.perfRatingEl = this.root.querySelector('.car-perf-rating')!;
    this.bankValEl = this.root.querySelector('.car-bank-val')!;
    this.buildBadgeEl = this.root.querySelector('.car-build-badge')!;
    this.statusLiveEl = this.root.querySelector('.car-status-live')!;

    this.tabButtons = {
      stats: this.root.querySelector('button[data-tab="stats"]')!,
      perf: this.root.querySelector('button[data-tab="perf"]')!,
      style: this.root.querySelector('button[data-tab="style"]')!,
    };
    this.tabPanels = {
      stats: this.root.querySelector('.car-tabpanel[data-panel="stats"]')!,
      perf: this.root.querySelector('.car-tabpanel[data-panel="perf"]')!,
      style: this.root.querySelector('.car-tabpanel[data-panel="style"]')!,
    };

    const getStat = (name: string) => {
      const row = this.root.querySelector(`.car-stat[data-stat="${name}"]`)!;
      return {
        fill: row.querySelector<HTMLDivElement>('.car-stat-fill')!,
        val: row.querySelector<HTMLSpanElement>('.car-stat-val')!,
      };
    };
    this.statRows = {
      power: getStat('power'),
      highSpeed: getStat('highSpeed'),
      acceleration: getStat('acceleration'),
      nitrous: getStat('nitrous'),
    };
    this.handlingDot = this.root.querySelector('.handling-dot')!;
    this.customSegs = this.root.querySelectorAll('.custom-rating .seg');
    this.customValEl = this.root.querySelector('.custom-rating-val')!;

    const getUpg = (track: UpgradeTrack) => {
      const row = this.root.querySelector(`.upg-row[data-track="${track}"]`)!;
      const buyBtn = row.querySelector<HTMLButtonElement>('.upg-buy-btn')!;
      return {
        pips: row.querySelectorAll<HTMLSpanElement>('.upg-pip'),
        buyBtn,
        btnCost: buyBtn.querySelector<HTMLSpanElement>('.upg-btn-cost')!,
      };
    };
    this.upgRows = {
      engine: getUpg('engine'),
      nitrous: getUpg('nitrous'),
      handling: getUpg('handling'),
      armor: getUpg('armor'),
    };
    this.biasSlider = this.root.querySelector('#handling-bias-slider')!;
    this.biasValEl = this.root.querySelector('.bias-val')!;
    this.biasHintEl = this.root.querySelector('#handling-bias-hint')!;

    this.root.querySelectorAll<HTMLButtonElement>('[data-slot="paint"]').forEach((b) => {
      this.paintBtns.set(b.dataset.id!, b);
      b.addEventListener('click', () => this.actions.onSelectCosmetic?.(this.getCurrentVehicle(), 'paint', b.dataset.id!));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot="livery"]').forEach((b) => {
      this.liveryBtns.set(b.dataset.id!, b);
      b.addEventListener('click', () => this.actions.onSelectCosmetic?.(this.getCurrentVehicle(), 'livery', b.dataset.id!));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot="underglow"]').forEach((b) => {
      this.glowBtns.set(b.dataset.id!, b);
      b.addEventListener('click', () => this.actions.onSelectCosmetic?.(this.getCurrentVehicle(), 'underglow', b.dataset.id!));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot="horn"]').forEach((b) => {
      this.hornBtns.set(b.dataset.id!, b);
      b.addEventListener('click', () => this.actions.onSelectCosmetic?.(this.getCurrentVehicle(), 'horn', b.dataset.id!));
    });
    this.root.querySelectorAll<HTMLButtonElement>('.horn-preview-btn').forEach((b) => {
      b.addEventListener('click', () => this.actions.onPreviewHorn?.(this.getCurrentVehicle(), b.dataset.horn!));
    });

    for (const track of UPGRADE_TRACKS) {
      this.upgRows[track].buyBtn.addEventListener('click', () => {
        this.actions.onBuyUpgrade?.(this.getCurrentVehicle(), track);
      });
    }

    this.biasSlider.addEventListener('input', () => {
      const v = Number(this.biasSlider.value);
      this.syncSliderCustomProps(v);
      this.actions.onHandlingBias?.(this.getCurrentVehicle(), v);
    });

    // Accessible tablist interaction (selection follows focus)
    const tabOrder: readonly GarageTab[] = ['stats', 'perf', 'style'];
    const tablist = this.root.querySelector('.car-tablist')!;
    tablist.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent;
      const curIdx = tabOrder.indexOf(this.activeTab);
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (curIdx + 1) % tabOrder.length;
      else if (e.key === 'ArrowLeft') nextIdx = (curIdx - 1 + tabOrder.length) % tabOrder.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabOrder.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        const nextTab = tabOrder[nextIdx];
        this.setActiveTab(nextTab, true);
      }
    });
    for (const tabKey of tabOrder) {
      this.tabButtons[tabKey].addEventListener('click', () => this.setActiveTab(tabKey, false));
      this.tabPanels[tabKey].addEventListener('beforematch', () => this.setActiveTab(tabKey, false));
    }

    this.tagAnchorEl = this.root.querySelector('.car-tag-anchor')!;
    this.tagNameEl = this.root.querySelector('.car-tag-name')!;
    this.prevBtn = this.root.querySelector('button.car-arrow.prev')!;
    this.nextBtn = this.root.querySelector('button.car-arrow.next')!;
    this.adjBadgeBtn = this.root.querySelector('button.car-adj-badge')!;

    this.goBtn = this.root.querySelector('button.car-select-go')!;
    this.backBtn = this.root.querySelector('button.car-select-back')!;

    this.prevBtn.addEventListener('click', () => this.cycleCar(-1));
    this.nextBtn.addEventListener('click', () => this.cycleCar(1));
    this.adjBadgeBtn.addEventListener('click', () => this.selectAdjacent());
    this.backBtn.addEventListener('click', () => this.onBackCb());
    this.goBtn.addEventListener('click', () => this.confirmSelection());
  }

  setStore(store: GarageStore): void {
    this.store = store;
    this.bank = store.bank;
    this.updateDisplay();
  }

  setActionHandlers(handlers: GarageActionHandlers): void {
    this.actions = handlers;
  }

  setBank(bank: number): void {
    this.bank = bank;
    this.updateDisplay();
  }

  announceStatus(message: string): void {
    this.statusLiveEl.textContent = message;
  }

  setActiveTab(tab: GarageTab, focusTab = false): void {
    this.activeTab = tab;
    for (const key of ['stats', 'perf', 'style'] as const) {
      const selected = key === tab;
      const btn = this.tabButtons[key];
      const panel = this.tabPanels[key];
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.tabIndex = selected ? 0 : -1;
      btn.toggleAttribute('focusgroupstart', selected);
      if (selected) {
        panel.removeAttribute('hidden');
        if (key === 'stats') panel.tabIndex = 0;
        else panel.removeAttribute('tabindex');
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (focusTab) btn.focus();
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    }
  }

  show(v: boolean, initialVehicle: PlayerVehicle = 'alto', bank = this.store?.bank ?? this.bank): void {
    this.bank = this.store ? this.store.bank : bank;
    const idx = this.vehicles.indexOf(initialVehicle);
    this.selectedIndex = idx >= 0 ? idx : 0;
    this.root.classList.toggle('hidden', !v);
    if (v) {
      this.setActiveTab('stats', false);
      this.statusLiveEl.textContent = '';
      this.updateDisplay();
    }
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOnSelect(cb: (v: PlayerVehicle) => void): void {
    this.onSelectCb = cb;
  }

  setOnChange(cb: (v: PlayerVehicle, adjacent: PlayerVehicle) => void): void {
    this.onChangeCb = cb;
  }

  setOnBack(cb: () => void): void {
    this.onBackCb = cb;
  }

  getCurrentVehicle(): PlayerVehicle {
    return this.vehicles[this.selectedIndex];
  }

  getAdjacentVehicle(): PlayerVehicle {
    return this.vehicles[(this.selectedIndex + 1) % this.vehicles.length];
  }

  cycleCar(dir: number): void {
    this.selectedIndex = (this.selectedIndex + dir + this.vehicles.length) % this.vehicles.length;
    this.updateDisplay();
    this.onChangeCb(this.getCurrentVehicle(), this.getAdjacentVehicle());
  }

  private selectAdjacent(): void {
    const idx = this.vehicles.indexOf(this.adjacentVehicle);
    if (idx >= 0) {
      this.selectedIndex = idx;
      this.updateDisplay();
      this.onChangeCb(this.getCurrentVehicle(), this.getAdjacentVehicle());
    } else {
      this.cycleCar(1);
    }
  }

  private syncSliderCustomProps(val: number): void {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(val) ? val : 0));
    this.biasSlider.style.setProperty('--attr-min', this.biasSlider.min || '-1');
    this.biasSlider.style.setProperty('--attr-max', this.biasSlider.max || '1');
    this.biasSlider.style.setProperty('--control-value', String(clamped));
    const text =
      Math.abs(clamped) < 0.05
        ? 'BALANCED'
        : clamped < 0
          ? `RACE ${Math.round(-clamped * 100)}%`
          : `DRIFT ${Math.round(clamped * 100)}%`;
    this.biasValEl.textContent = text;
    this.biasSlider.setAttribute('aria-valuetext', text);
  }

  private effectiveBank(): number {
    return this.store ? this.store.bank : this.bank;
  }

  private isUnlocked(v: PlayerVehicle): boolean {
    return this.store ? this.store.isVehicleUnlocked(v) : this.bank >= VEHICLE_COST[v];
  }

  private buildFor(v: PlayerVehicle): VehicleBuild {
    return this.store ? this.store.getBuild(v) : defaultVehicleBuild(v);
  }

  updateDisplay(): void {
    const vKey = this.getCurrentVehicle();
    const build = this.buildFor(vKey);
    const meta = deriveShowcaseMeta(vKey, VEHICLE_SHOWCASE[vKey], build);
    const cost = VEHICLE_COST[vKey];
    const bankNow = this.effectiveBank();
    const unlocked = this.isUnlocked(vKey);

    this.brandEl.textContent = meta.brand;
    this.modelEl.textContent = meta.model;
    this.perfRatingEl.textContent = String(meta.perfRating);
    this.bankValEl.textContent = `RS ${bankNow.toLocaleString('en-PK')}`;

    const totalTiers = build.engine + build.nitrous + build.handling + build.armor;
    const maxHp = maxIntegrityForBuild(build);
    this.buildBadgeEl.textContent = unlocked
      ? `${totalTiers > 0 ? `TUNED ${totalTiers}/12` : 'STOCK'} · ${maxHp} HP`
      : `UNLOCK RS ${cost.toLocaleString('en-PK')}`;
    this.buildBadgeEl.classList.toggle('is-tuned', unlocked && totalTiers > 0);
    this.buildBadgeEl.classList.toggle('is-locked', !unlocked);

    const setStat = (key: 'power' | 'highSpeed' | 'acceleration' | 'nitrous', value: number) => {
      const clamped = Math.max(0, Math.min(10, value));
      this.statRows[key].fill.style.width = `${(clamped * 10).toFixed(1)}%`;
      this.statRows[key].val.textContent = clamped.toFixed(1);
    };
    setStat('power', meta.stats.power);
    setStat('highSpeed', meta.stats.highSpeed);
    setStat('acceleration', meta.stats.acceleration);
    setStat('nitrous', meta.stats.nitrous);

    // 2D handling grid: x (-1 race .. +1 drift), y (-1 road .. +1 off-road)
    const dotLeft = 50 + Math.max(-1, Math.min(1, meta.handlingGrid.x)) * 42;
    const dotTop = 50 - Math.max(-1, Math.min(1, meta.handlingGrid.y)) * 42;
    this.handlingDot.style.left = `${dotLeft.toFixed(1)}%`;
    this.handlingDot.style.top = `${dotTop.toFixed(1)}%`;
    this.handlingDot.style.transform = 'translate(-50%, -50%)';

    const custom = Math.max(0, Math.min(10, Math.round(meta.customizationRating)));
    this.customSegs.forEach((seg, idx) => {
      seg.classList.toggle('on', idx < custom);
    });
    this.customValEl.textContent = `${custom}/10`;

    // Sync UPGRADES tab
    for (const track of UPGRADE_TRACKS) {
      const row = this.upgRows[track];
      const tier = build[track];
      row.pips.forEach((pip, i) => pip.classList.toggle('on', i < tier));
      const trackTitle = TRACK_LABELS[track].title;
      if (tier >= MAX_UPGRADE_TIER) {
        row.btnCost.textContent = 'MAX';
        row.buyBtn.disabled = true;
        row.buyBtn.classList.add('is-max');
        row.buyBtn.setAttribute('aria-label', `${trackTitle} MAX`);
      } else {
        const nextTier = (tier + 1) as 1 | 2 | 3;
        const c = upgradeCost(vKey, track, nextTier);
        const canAfford = unlocked && bankNow >= c;
        const txt = `RS ${c.toLocaleString('en-PK')}`;
        row.btnCost.textContent = txt;
        row.buyBtn.disabled = !canAfford;
        row.buyBtn.classList.remove('is-max');
        row.buyBtn.setAttribute('aria-label', `Upgrade ${trackTitle} Tier ${nextTier} — ${txt}`);
      }
    }

    const biasUnlocked = unlocked && build.handling >= 1;
    this.biasSlider.disabled = !biasUnlocked;
    this.biasSlider.value = String(build.handlingBias);
    this.syncSliderCustomProps(build.handlingBias);
    this.biasHintEl.textContent = !unlocked
      ? 'Unlock this vehicle to tune handling'
      : build.handling < 1
        ? 'Install Suspension Tier 1 to unlock tuning'
        : 'Drag toward RACE for grip or DRIFT for slide angle';

    // Sync STYLE tab swatches & chips
    const syncCosmeticButtons = (
      map: Map<string, HTMLButtonElement>,
      slot: CosmeticSlot,
      equippedId: string,
      labels: Map<string, { label: string; freeTag: string }>,
    ) => {
      for (const [id, btn] of map) {
        const owned = this.store ? this.store.isCosmeticOwned(slot, id) : id === equippedId;
        const equipped = equippedId === id;
        const c = cosmeticCost(slot, id);
        const metaInfo = labels.get(id)!;
        btn.setAttribute('aria-pressed', equipped ? 'true' : 'false');
        btn.classList.toggle('is-equipped', equipped);
        btn.classList.toggle('is-owned', owned);
        btn.disabled = !unlocked || (!owned && bankNow < c);

        const tagEl = btn.querySelector('.swatch-tag, .chip-cost');
        if (tagEl) {
          tagEl.textContent = equipped ? 'ON' : owned ? 'OWNED' : c === 0 ? metaInfo.freeTag : `RS ${c}`;
        }
        btn.setAttribute(
          'aria-label',
          `${metaInfo.label}${equipped ? ' (equipped)' : owned ? ' (owned)' : c > 0 ? ` — RS ${c}` : ''}`,
        );
      }
    };

    syncCosmeticButtons(
      this.paintBtns,
      'paint',
      build.paint,
      new Map(PAINT_CATALOG.map((p) => [p.id, { label: p.label, freeTag: 'STOCK' }])),
    );
    syncCosmeticButtons(
      this.liveryBtns,
      'livery',
      build.livery,
      new Map(LIVERY_CATALOG.map((l) => [l.id, { label: l.label, freeTag: 'FREE' }])),
    );
    syncCosmeticButtons(
      this.glowBtns,
      'underglow',
      build.underglow,
      new Map(UNDERGLOW_CATALOG.map((g) => [g.id, { label: `${g.label} underglow`, freeTag: 'OFF' }])),
    );
    syncCosmeticButtons(
      this.hornBtns,
      'horn',
      build.horn,
      new Map(HORN_CATALOG.map((h) => [h.id, { label: h.label, freeTag: 'FREE' }])),
    );

    this.tagNameEl.textContent = meta.badgeName;
    this.adjacentVehicle = this.getAdjacentVehicle();
    this.adjBadgeBtn.title = `Switch to ${VEHICLE_SHOWCASE[this.adjacentVehicle].badgeName}`;

    const goTextEl = this.goBtn.querySelector('.go-text');
    if (unlocked) {
      if (goTextEl) goTextEl.textContent = 'SELECT';
      else this.goBtn.textContent = 'SELECT';
      this.goBtn.disabled = false;
      this.goBtn.classList.remove('locked');
    } else {
      const label = `LOCKED · RS ${cost.toLocaleString('en-PK')}`;
      if (goTextEl) goTextEl.textContent = label;
      else this.goBtn.textContent = label;
      this.goBtn.disabled = true;
      this.goBtn.classList.add('locked');
    }
  }

  updateProjection(proj: GarageProjection): void {
    if (!this.visible) return;
    this.adjacentVehicle = proj.adjacentVehicle;

    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const isPortraitMobile = vw <= 760 && vh >= 500;

    if (proj.activeAnchor.visible) {
      const minX = isPortraitMobile ? 86 : Math.min(vw * 0.54, 420);
      const maxX = vw - (isPortraitMobile ? 86 : 120);
      const maxY = isPortraitMobile ? vh * 0.42 : vh * 0.56;
      const x = Math.max(minX, Math.min(maxX, proj.activeAnchor.x));
      const y = Math.max(82, Math.min(maxY, proj.activeAnchor.y));
      this.tagAnchorEl.style.left = `${x.toFixed(1)}px`;
      this.tagAnchorEl.style.top = `${y.toFixed(1)}px`;
      this.tagAnchorEl.classList.remove('hidden');
    } else {
      this.tagAnchorEl.style.left = `${(isPortraitMobile ? vw * 0.5 : vw * 0.62).toFixed(1)}px`;
      this.tagAnchorEl.style.top = `${(vh * 0.24).toFixed(1)}px`;
    }

    if (proj.adjacentAnchor.visible) {
      const minX = isPortraitMobile ? 40 : vw * 0.45;
      const maxY = isPortraitMobile ? vh * 0.44 : vh - 90;
      const x = Math.max(minX, Math.min(vw - 36, proj.adjacentAnchor.x));
      const y = Math.max(80, Math.min(maxY, proj.adjacentAnchor.y));
      this.adjBadgeBtn.style.left = `${x.toFixed(1)}px`;
      this.adjBadgeBtn.style.top = `${y.toFixed(1)}px`;
    } else {
      this.adjBadgeBtn.style.left = `${Math.max(vw * 0.45, vw - 64).toFixed(1)}px`;
      this.adjBadgeBtn.style.top = `${(vh * 0.32).toFixed(1)}px`;
    }
    this.adjBadgeBtn.classList.remove('hidden');
  }

  confirmSelection(): void {
    const vKey = this.getCurrentVehicle();
    if (this.isUnlocked(vKey)) {
      this.onSelectCb(vKey);
    }
  }

  pollInput(): void {
    if (!this.visible) return;
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const inPanel = activeEl instanceof HTMLElement && this.panelEl.contains(activeEl);

    const nav = this.input.consumeMenuNav();
    if (nav !== 0 && !(inPanel && activeEl.matches('input, [role="tab"]'))) {
      this.cycleCar(nav);
    }
    const confirm = this.input.consumeConfirm();
    if (confirm && !(inPanel && activeEl.matches('button, input'))) {
      this.confirmSelection();
    }
    if (this.input.consumeBack()) {
      this.onBackCb();
    }
  }
}
