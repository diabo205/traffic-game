import type { InputManager } from '../input/InputManager';
import type { GarageProjection } from '../render/GarageScene';
import { PLAYER_VEHICLES, VEHICLE_COST, VEHICLE_SHOWCASE } from '../sim/PlayerCar';
import type { PlayerVehicle } from '../sim/types';

export class CarSelectScreen {
  readonly root: HTMLDivElement;
  private selectedIndex = 0;
  private vehicles: readonly PlayerVehicle[] = PLAYER_VEHICLES;
  private bank = 0;
  private adjacentVehicle: PlayerVehicle = PLAYER_VEHICLES[1];
  private onSelectCb: (vehicle: PlayerVehicle) => void = () => {};
  private onChangeCb: (vehicle: PlayerVehicle, adjacent: PlayerVehicle) => void = () => {};
  private onBackCb: () => void = () => {};

  // Left stats panel elements
  private brandEl: HTMLDivElement;
  private modelEl: HTMLDivElement;
  private perfRatingEl: HTMLSpanElement;
  private statRows: Record<'power' | 'highSpeed' | 'acceleration' | 'nitrous', { fill: HTMLDivElement; val: HTMLSpanElement }>;
  private handlingDot: HTMLDivElement;
  private customSegs: NodeListOf<HTMLDivElement>;
  private customValEl: HTMLSpanElement;

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

    this.brandEl = this.root.querySelector('.car-brand')!;
    this.modelEl = this.root.querySelector('.car-model')!;
    this.perfRatingEl = this.root.querySelector('.car-perf-rating')!;
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

  setBank(bank: number): void {
    this.bank = bank;
    this.updateDisplay();
  }

  show(v: boolean, initialVehicle: PlayerVehicle = 'alto', bank = this.bank): void {
    this.bank = bank;
    const idx = this.vehicles.indexOf(initialVehicle);
    this.selectedIndex = idx >= 0 ? idx : 0;
    this.root.classList.toggle('hidden', !v);
    if (v) {
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

  updateDisplay(): void {
    const vKey = this.getCurrentVehicle();
    const meta = VEHICLE_SHOWCASE[vKey];
    const cost = VEHICLE_COST[vKey];
    const unlocked = this.bank >= cost;

    this.brandEl.textContent = meta.brand;
    this.modelEl.textContent = meta.model;
    this.perfRatingEl.textContent = String(meta.perfRating);

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
      const minX = isPortraitMobile ? 86 : Math.min(vw * 0.52, 400);
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
    const cost = VEHICLE_COST[vKey];
    if (this.bank >= cost) {
      this.onSelectCb(vKey);
    }
  }

  pollInput(): void {
    if (!this.visible) return;
    const nav = this.input.consumeMenuNav();
    if (nav !== 0) {
      this.cycleCar(nav);
    }
    if (this.input.consumeConfirm()) {
      this.confirmSelection();
    }
    if (this.input.consumeBack()) {
      this.onBackCb();
    }
  }
}
