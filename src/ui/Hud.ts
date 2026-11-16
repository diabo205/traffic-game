import type { TouchSteerMode } from '../input/InputManager';
import type { TimeOfDay } from '../render/Renderer';
import type { FareKind, ShiftRank } from '../sim/city/Fares';
import type { RunStats } from '../sim/LevelManager';
import { VEHICLE_COST, VEHICLE_SPECS } from '../sim/PlayerCar';
import { FINISH_Z } from '../sim/road';
import type { GameOverReason, PlayerVehicle } from '../sim/types';

type Mode = 'route' | 'city';

const VEHICLES: readonly PlayerVehicle[] = ['alto', 'rickshaw', 'minibus'];
const VEHICLE_PERK: Readonly<Record<PlayerVehicle, string>> = {
  alto: 'BALANCED',
  rickshaw: 'AGILE',
  minibus: 'TANK',
};

/**
 * Arcade HUD + menus. DOM only; the Game pushes values in and wires the
 * buttons. Visual language: tall condensed caps, slanted plates, navy
 * panels with white cards, hot magenta accents and lime "go" buttons.
 *
 * Screens: mode select (start), game options (settings), pause, results.
 */
export class Hud {
  readonly root: HTMLDivElement;

  // ---- In-game HUD -----------------------------------------------------------
  private speedLines: HTMLDivElement;
  private integLabel: HTMLSpanElement;
  private statA: HTMLSpanElement;
  private statAKey: HTMLSpanElement;
  private statB: HTMLSpanElement;
  private statBKey: HTMLSpanElement;
  private integrityFill: HTMLDivElement;
  private integrityText: HTMLSpanElement;
  private speed: HTMLSpanElement;
  private clock: HTMLDivElement;
  private clockText: HTMLSpanElement;
  private boost: HTMLDivElement;
  private boostFill: HTMLDivElement;
  private boostLabel: HTMLSpanElement;
  private farePanel: HTMLDivElement;
  private fareMeta: HTMLDivElement;
  private fareName: HTMLDivElement;
  private fareInfo: HTMLDivElement;
  private fareFill: HTMLDivElement;
  private arrow: HTMLDivElement;
  private arrowPath: SVGPathElement;
  private comboBox: HTMLDivElement;
  private comboMult: HTMLDivElement;
  private comboPts: HTMLDivElement;
  private comboFill: HTMLDivElement;
  private stuntStack: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerText: HTMLSpanElement;
  private toast: HTMLDivElement;
  private flash: HTMLDivElement;
  private shiftCard: HTMLDivElement;
  private shiftText: HTMLDivElement;
  readonly mapSlot: HTMLDivElement;
  readonly pauseBtn: HTMLButtonElement;
  readonly shiftBtn: HTMLButtonElement;

  // ---- Screens ------------------------------------------------------------------
  private startScreen: HTMLDivElement;
  private heroTitle: HTMLHeadingElement;
  private heroText: HTMLParagraphElement;
  private bankBadge: HTMLDivElement;
  private bestHint: HTMLDivElement;
  readonly rideBtns: Record<PlayerVehicle, HTMLButtonElement>;
  readonly cityBtn: HTMLButtonElement;
  /** route-run mode tile (kept under its old name) */
  readonly startBtn: HTMLButtonElement;
  readonly playBtn: HTMLButtonElement;
  readonly dailyBtn: HTMLButtonElement;
  private settingsScreen: HTMLDivElement;
  private tabSound: HTMLButtonElement;
  private tabControls: HTMLButtonElement;
  private paneSound: HTMLDivElement;
  private paneControls: HTMLDivElement;
  readonly rideBtn: HTMLButtonElement;
  readonly muteBtn: HTMLButtonElement;
  readonly radioBtn: HTMLButtonElement;
  readonly camBtn: HTMLButtonElement;
  readonly todBtn: HTMLButtonElement;
  readonly touchBtn: HTMLButtonElement;
  readonly stickBtn: HTMLButtonElement;
  readonly autoGasBtn: HTMLButtonElement;
  readonly hapticsBtn: HTMLButtonElement;
  private pauseScreen: HTMLDivElement;
  private pauseZone: HTMLDivElement;
  private pauseGoals: HTMLDivElement;
  readonly resumeBtn: HTMLButtonElement;
  readonly pauseCamBtn: HTMLButtonElement;
  readonly pauseSteerBtn: HTMLButtonElement;
  readonly pauseControlsBtn: HTMLButtonElement;
  readonly pauseRadioBtn: HTMLButtonElement;
  readonly pauseSoundBtn: HTMLButtonElement;
  readonly quitBtn: HTMLButtonElement;
  private endScreen: HTMLDivElement;
  private endTitle: HTMLDivElement;
  private endSub: HTMLParagraphElement;
  private endStats: HTMLDivElement;
  readonly restartBtn: HTMLButtonElement;

  private mode: Mode = 'city';
  private vehicleLabel = 'ALTO';
  private settingsBack: (() => void) | null = null;
  private bannerTimer = 0;
  private toastTimer = 0;
  private lastClock = '';
  private lastSpeed = -1;
  private lastIntegrity = -1;
  private lastFareKey = '';
  private targetMoney = 0;
  private shownMoney = Number.NaN;
  private lastMoneyShown = Number.NaN;
  private lastScore = -1;
  private lastCombo = '';
  private lastDistLeft = -1;
  private lastNextDist = -1;
  private lastUrgency = '';

  constructor(parent: HTMLElement) {
    this.root = div('hud');
    parent.appendChild(this.root);

    this.speedLines = div('speed-lines');

    // ---- Top-left: pause + stats + car integrity ------------------------------
    this.pauseBtn = button('', 'pause-btn', 'Pause (Esc)');
    this.pauseBtn.innerHTML = '<i></i><i></i>';
    const stats = div('stat-block');
    const row = (cls: string): [HTMLDivElement, HTMLSpanElement, HTMLSpanElement] => {
      const r = div(`stat-row ${cls}`);
      const k = span('stat-key');
      const v = span('stat-val');
      r.append(k, v);
      return [r, k, v];
    };
    const [ra, ka, va] = row('a');
    const [rb, kb, vb] = row('b');
    this.statAKey = ka;
    this.statA = va;
    this.statBKey = kb;
    this.statB = vb;
    stats.append(ra, rb);
    const integ = div('integrity');
    this.integLabel = span('integ-label');
    this.integLabel.textContent = 'ALTO';
    const bar = div('integ-bar');
    this.integrityFill = div('integ-fill');
    bar.appendChild(this.integrityFill);
    this.integrityText = span('integ-text');
    integ.append(this.integLabel, bar, this.integrityText);
    const tl = div('hud-tl');
    const tlTop = div('tl-top');
    tlTop.append(this.pauseBtn, stats);
    this.mapSlot = div('map-slot');
    tl.append(tlTop, integ, this.mapSlot);

    // ---- Top-centre: boost meter, fare plate, guide arrow -------------------------------
    this.boost = div('boost');
    this.boostFill = div('boost-fill');
    this.boostLabel = span('boost-label');
    this.boost.append(this.boostFill, this.boostLabel);
    this.farePanel = div('fare hidden');
    this.fareMeta = div('fare-meta hidden');
    this.fareName = div('fare-name');
    this.fareInfo = div('fare-info');
    const fbar = div('fare-bar');
    this.fareFill = div('fare-fill');
    fbar.appendChild(this.fareFill);
    this.farePanel.append(this.fareMeta, this.fareName, this.fareInfo, fbar);
    this.arrow = div('guide-arrow hidden');
    this.arrow.innerHTML = '<svg viewBox="0 0 40 40" width="100%" height="100%"><path d="M20 3 L36 34 L20 26 L4 34 Z" fill="#c6f432" stroke="#0b1530" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    this.arrowPath = this.arrow.querySelector('path')!;
    const tc = div('hud-tc');
    tc.append(this.boost, this.farePanel, this.arrow);

    // ---- Top-right: speed + clock badge ---------------------------------------------------
    const spd = div('speedo');
    const unit = span('speed-unit');
    unit.textContent = 'KM/H';
    this.speed = span('speed-num');
    spd.append(unit, this.speed);
    this.clock = div('clock');
    this.clockText = span('clock-text');
    this.clock.innerHTML = '<svg viewBox="0 0 16 16" width="1em" height="1em"><circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 9V5.5M6 1.5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    this.clock.appendChild(this.clockText);
    const tr = div('hud-tr');
    tr.append(spd, this.clock);

    // ---- Right: combo meter + stunt strips -------------------------------------------------
    this.comboBox = div('combo hidden');
    this.comboMult = div('combo-mult');
    this.comboPts = div('combo-pts');
    const cbar = div('combo-bar');
    this.comboFill = div('combo-fill');
    cbar.appendChild(this.comboFill);
    this.comboBox.append(this.comboMult, this.comboPts, cbar);
    this.stuntStack = div('stunts');
    const right = div('hud-right');
    right.append(this.comboBox, this.stuntStack);

    // ---- Banner (street / zone), toast, damage flash ---------------------------------------------
    this.banner = div('banner');
    this.bannerText = span('banner-text');
    this.banner.appendChild(this.bannerText);
    this.toast = div('toast');
    this.flash = div('flash');

    // ---- Shift-over card -------------------------------------------------------------------------
    this.shiftCard = div('shift-card hidden');
    this.shiftText = div('shift-text');
    this.shiftBtn = button('NEW SHIFT', 'go-btn small', 'Start a new shift');
    const shiftHint = div('hint');
    shiftHint.textContent = 'ENTER / A · OR KEEP DRIVING OFF DUTY';
    this.shiftCard.append(this.shiftText, this.shiftBtn, shiftHint);

    // ---- Mode select (start) ---------------------------------------------------------------------
    this.startScreen = div('screen start');
    const topbar = div('topbar');
    topbar.innerHTML = `<div class="brand"><span class="brand-mark">KT</span><span class="brand-name">KARACHI<br>TRAFFIC 3D</span></div>`;
    const topRight = div('topbar-right');
    this.bankBadge = div('bank-badge');
    const startSettings = button('', 'topbar-btn', 'Game options');
    startSettings.innerHTML = gearIcon();
    topRight.append(this.bankBadge, startSettings);
    topbar.appendChild(topRight);

    const hero = div('hero');
    this.heroTitle = document.createElement('h1');
    this.heroText = document.createElement('p');
    hero.append(div('hero-rule'), this.heroTitle, this.heroText);

    const garage = div('garage-strip');
    const makeRideBtn = (v: PlayerVehicle) => {
      const sp = VEHICLE_SPECS[v];
      const cost = VEHICLE_COST[v];
      const b = button('', 'garage-btn', `${sp.label} — ${sp.tag}`);
      b.innerHTML = `<span class="g-name">${sp.label}</span><span class="g-perk">${VEHICLE_PERK[v]}</span><span class="g-sub">${cost === 0 ? 'FREE' : `RS ${cost}`}</span>`;
      garage.appendChild(b);
      return b;
    };
    this.rideBtns = {
      alto: makeRideBtn('alto'),
      rickshaw: makeRideBtn('rickshaw'),
      minibus: makeRideBtn('minibus'),
    };

    this.playBtn = button('PLAY', 'go-btn play', 'Play');
    this.dailyBtn = button('', 'daily-btn', 'Daily Saddar challenge');
    this.dailyBtn.innerHTML = `<span class="d-top">DAILY</span><span class="d-sub">SADDAR</span>`;
    const playActions = div('play-actions');
    playActions.append(this.playBtn, this.dailyBtn);
    const playWrap = div('play-wrap');
    this.bestHint = div('hint best-hint');
    this.bestHint.textContent = 'ENTER / A';
    playWrap.append(garage, playActions, this.bestHint);

    const tiles = div('tiles');
    this.cityBtn = tile('FREE ROAM', 'SADDAR', 'Free roam in Saddar');
    this.startBtn = tile('ROUTE', 'RUN', 'Route run to Clifton');
    const controlsTile = tile('HOW TO', 'DRIVE', 'Controls');
    const optionsTile = tile('GAME', 'OPTIONS', 'Game options');
    controlsTile.classList.add('dim');
    optionsTile.classList.add('dim');
    tiles.append(this.cityBtn, this.startBtn, controlsTile, optionsTile);
    this.startScreen.append(topbar, hero, playWrap, tiles);

    // ---- Game options ------------------------------------------------------------------------------
    this.settingsScreen = div('screen settings hidden');
    const sBack = button('‹', 'back-btn', 'Back');
    const sHead = div('screen-title');
    sHead.textContent = 'GAME OPTIONS';
    const tabs = div('tabs');
    this.tabSound = button('SOUND & DISPLAY', 'tab on', 'Sound and display');
    this.tabControls = button('CONTROLS', 'tab', 'Controls');
    tabs.append(this.tabSound, this.tabControls);
    this.paneSound = div('card-grid');
    this.rideBtn = cardBtn('RIDE', 'ALTO', 'Switch vehicle');
    this.rideBtn.classList.add('wide');
    this.muteBtn = cardBtn('SOUND', 'ON', 'Toggle sound (M)');
    this.radioBtn = cardBtn('RADIO', 'DHOL FM', 'Toggle Karachi Dhol FM radio (R)');
    this.camBtn = cardBtn('CAMERA', 'NEAR', 'Camera distance');
    this.todBtn = cardBtn('TIME OF DAY', 'NOON', 'Noon, sunset, night, or monsoon');
    this.touchBtn = cardBtn('TOUCH CONTROLS', 'OFF', 'Show or hide touch controls');
    this.stickBtn = cardBtn('STEERING', 'BUTTONS', 'Steering buttons, joystick, or tilt');
    this.autoGasBtn = cardBtn('AUTO-GAS', 'OFF', 'Auto-accelerate on touch');
    this.hapticsBtn = cardBtn('HAPTICS', 'ON', 'Vibration feedback on supported devices');
    this.paneSound.append(this.rideBtn, this.muteBtn, this.radioBtn, this.camBtn, this.todBtn, this.touchBtn, this.stickBtn, this.autoGasBtn, this.hapticsBtn);
    this.paneControls = div('controls-pane hidden');
    this.paneControls.innerHTML = `
      <div class="ctl kb"><h3>KEYBOARD</h3>
        <p><b>W / ↑</b> gas · <b>S / ↓</b> brake, reverse</p>
        <p><b>A D / ← →</b> steer · <b>E</b> drift</p>
        <p><b>SPACE</b> horn · <b>F / SHIFT</b> dipper · <b>R</b> radio · <b>ESC</b> pause</p></div>
      <div class="ctl gp"><h3>GAMEPAD</h3>
        <p><b>RT</b> gas · <b>LT</b> brake</p>
        <p><b>LEFT STICK</b> steer · <b>B</b> drift</p>
        <p><b>A</b> horn · <b>X</b> dipper · <b>Y</b> radio · <b>START</b> pause</p></div>
      <div class="ctl tc"><h3>TOUCH</h3>
        <p><b>◀ ▶</b>, joystick or tilt · <b>ZERO TILT</b> centers</p>
        <p><b>GAS / BRAKE</b> pedals · <b>DRIFT</b></p>
        <p><b>📯</b> horn · <b>💡</b> dipper · <b>II</b> pause</p></div>
      <div class="ctl moves"><h3>MOVES</h3>
        <p><b>DRIFT</b> E or gas + brake while turning — power out for a boost</p>
        <p><b>LAUNCH</b> hold brake + gas when stopped, release brake</p>
        <p><b>DASH</b> double-tap gas (&lt; 55% top speed) · <b>DONUT</b> spin tight · <b>HORN</b> clears traffic & pedestrians</p></div>`;
    const osmCredit = div('osm-credit');
    osmCredit.textContent = 'Map data © OpenStreetMap contributors';
    this.settingsScreen.append(sBack, sHead, tabs, this.paneSound, this.paneControls, osmCredit);

    // ---- Pause --------------------------------------------------------------------------------------
    this.pauseScreen = div('screen pause hidden');
    const deco = div('pause-deco');
    this.pauseZone = div('zone-card');
    const goalsHead = div('goals-head');
    goalsHead.textContent = 'SHIFT GOALS';
    this.pauseGoals = div('goals');
    const pLeft = div('pause-left');
    pLeft.append(deco, this.pauseZone, goalsHead, this.pauseGoals);
    const menuTag = div('menu-tag');
    menuTag.textContent = 'GAME MENU';
    this.resumeBtn = cardBtn('RESUME', '', 'Resume');
    this.pauseCamBtn = cardBtn('CAMERA', 'NEAR', 'Camera distance');
    this.pauseSteerBtn = cardBtn('STEERING', 'BUTTONS', 'Touch steering mode');
    this.pauseControlsBtn = cardBtn('CONTROLS', '', 'Controls');
    this.pauseRadioBtn = cardBtn('RADIO', 'DHOL FM', 'Toggle Karachi Dhol FM radio (R)');
    this.pauseSoundBtn = cardBtn('SOUND', 'ON', 'Sound');
    this.quitBtn = cardBtn('QUIT TO MENU', '', 'Quit to menu');
    const pRight = div('pause-right');
    pRight.append(menuTag, this.resumeBtn, this.pauseCamBtn, this.pauseSteerBtn, this.pauseControlsBtn, this.pauseRadioBtn, this.pauseSoundBtn, this.quitBtn);
    this.pauseScreen.append(pLeft, pRight);

    // ---- Results --------------------------------------------------------------------------------------
    this.endScreen = div('screen end hidden');
    const endCard = div('results');
    this.endTitle = div('screen-title');
    this.endSub = document.createElement('p');
    this.endSub.className = 'results-sub';
    this.endStats = div('results-stats');
    this.restartBtn = button('DRIVE AGAIN', 'go-btn', 'Restart');
    const endHint = div('hint');
    endHint.textContent = 'ENTER / A';
    endCard.append(this.endTitle, this.endSub, this.endStats, this.restartBtn, endHint);
    this.endScreen.appendChild(endCard);

    this.root.append(this.speedLines, tl, tc, tr, right, this.banner, this.toast, this.flash, this.shiftCard, this.startScreen, this.settingsScreen, this.pauseScreen, this.endScreen);

    // Menu navigation that needs no game logic.
    const openSettings = (back: () => void, controls = false) => this.openSettings(back, controls);
    startSettings.addEventListener('click', () => openSettings(() => this.showStart(true)));
    optionsTile.addEventListener('click', () => openSettings(() => this.showStart(true)));
    controlsTile.addEventListener('click', () => openSettings(() => this.showStart(true), true));
    this.pauseControlsBtn.addEventListener('click', () => openSettings(() => this.showPause(true), true));
    sBack.addEventListener('click', () => this.closeSettings());
    this.tabSound.addEventListener('click', () => this.setTab(false));
    this.tabControls.addEventListener('click', () => this.setTab(true));

    this.setMode('city');
    this.setVehicle('alto', 0);
    this.showStart(true);
  }

  // ---- Modes & settings state ------------------------------------------------------------

  setMode(mode: Mode): void {
    this.mode = mode;
    this.root.classList.toggle('city', mode === 'city');
    this.cityBtn.classList.toggle('chosen', mode === 'city');
    this.startBtn.classList.toggle('chosen', mode === 'route');
    if (mode === 'city') {
      this.heroTitle.innerHTML = 'PICK UP FARES.<br><em>OWN</em> SADDAR.';
      this.heroText.innerHTML = 'Stop beside passengers across Saddar, beat the meter, and chain drifts, jumps &amp; near misses for bonus&nbsp;tips.';
      this.statAKey.textContent = 'RS';
      this.statBKey.textContent = '★';
    } else {
      this.heroTitle.innerHTML = 'SADDAR TO <em>CLIFTON</em><br>AGAINST THE CLOCK.';
      this.heroText.textContent = '4.2 km dash via Lyari Expressway & Shahrah-e-Faisal to Teen Talwar. Hit checkpoints before the clock hits zero and keep your ride intact.';
      this.statAKey.textContent = 'LEFT';
      this.statBKey.textContent = 'NEXT';
    }
    this.lastDistLeft = this.lastNextDist = this.lastScore = this.lastIntegrity = -1;
    this.targetMoney = 0;
    this.shownMoney = this.lastMoneyShown = Number.NaN;
    if (mode !== 'city') {
      this.setFare(null);
      this.setArrow(null);
      this.showShiftOver(null);
      this.setCombo(0, 0, 0);
    }
  }

  setDailyInfo(label: string, bestEarned: number, bestRank?: ShiftRank): void {
    const sub = bestEarned > 0 ? `BEST RS ${bestEarned.toLocaleString('en-PK')}${bestRank ? ` · ${bestRank}` : ''}` : 'SAME SEED WORLDWIDE';
    this.dailyBtn.innerHTML = `<span class="d-top">DAILY · ${escapeHtml(label)}</span><span class="d-sub">${sub}</span>`;
  }

  setBestSummary(text: string | null): void {
    this.bestHint.textContent = text ? `ENTER / A · ${text}` : 'ENTER / A';
  }

  setVehicle(v: PlayerVehicle, bank: number): void {
    const sp = VEHICLE_SPECS[v];
    this.vehicleLabel = sp.label;
    this.integLabel.textContent = sp.label;
    this.bankBadge.textContent = `BANK RS ${bank.toLocaleString('en-PK')}`;
    setCard(this.rideBtn, `${sp.label} · ${sp.tag}`);
    for (const k of VEHICLES) {
      const btn = this.rideBtns[k];
      const cost = VEHICLE_COST[k];
      const unlocked = bank >= cost;
      btn.classList.toggle('chosen', k === v);
      btn.classList.toggle('locked', !unlocked);
      const sub = btn.querySelector('.g-sub');
      if (sub) {
        sub.textContent = k === v ? 'ACTIVE' : unlocked ? 'UNLOCKED' : `LOCKED · RS ${cost}`;
      }
    }
  }

  setTimeOfDay(tod: TimeOfDay): void {
    setCard(this.todBtn, tod.toUpperCase());
  }

  setAutoGas(on: boolean): void {
    setCard(this.autoGasBtn, on ? 'ON' : 'OFF');
  }

  setHaptics(on: boolean): void {
    setCard(this.hapticsBtn, on ? 'ON' : 'OFF');
  }

  setRadio(on: boolean): void {
    const label = on ? 'DHOL FM' : 'OFF';
    setCard(this.radioBtn, label);
    setCard(this.pauseRadioBtn, label);
  }

  setMuted(m: boolean): void {
    setCard(this.muteBtn, m ? 'OFF' : 'ON');
    setCard(this.pauseSoundBtn, m ? 'OFF' : 'ON');
  }

  setSteerMode(mode: TouchSteerMode): void {
    setCard(this.stickBtn, mode.toUpperCase());
    setCard(this.pauseSteerBtn, mode.toUpperCase());
  }

  setTouchVisible(v: boolean): void {
    setCard(this.touchBtn, v ? 'ON' : 'OFF');
    this.stickBtn.classList.toggle('disabled', !v);
    this.autoGasBtn.classList.toggle('disabled', !v);
    this.hapticsBtn.classList.toggle('disabled', !v);
    this.pauseSteerBtn.classList.toggle('hidden', !v);
  }

  setCamera(far: boolean): void {
    setCard(this.camBtn, far ? 'FAR' : 'NEAR');
    setCard(this.pauseCamBtn, far ? 'FAR' : 'NEAR');
  }

  // ---- Screens ------------------------------------------------------------------------------

  private menu(open: boolean): void {
    this.root.classList.toggle('in-menu', open);
    document.body.classList.toggle('in-menu', open);
    if (open) {
      this.toast.classList.remove('show');
      this.toastTimer = 0;
      this.banner.classList.remove('show');
      this.bannerTimer = 0;
    }
  }

  showStart(v: boolean): void {
    this.startScreen.classList.toggle('hidden', !v);
    if (v) this.settingsScreen.classList.add('hidden');
    this.menu(v);
  }

  get startVisible(): boolean {
    return !this.startScreen.classList.contains('hidden');
  }

  private openSettings(back: () => void, controls: boolean): void {
    this.settingsBack = back;
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.settingsScreen.classList.remove('hidden');
    this.setTab(controls);
    this.menu(true);
  }

  /** Close game options and return to whichever screen opened them. */
  closeSettings(): void {
    if (this.settingsScreen.classList.contains('hidden')) return;
    this.settingsScreen.classList.add('hidden');
    const back = this.settingsBack;
    this.settingsBack = null;
    back?.();
  }

  get settingsOpen(): boolean {
    return !this.settingsScreen.classList.contains('hidden');
  }

  private setTab(controls: boolean): void {
    this.tabSound.classList.toggle('on', !controls);
    this.tabControls.classList.toggle('on', controls);
    this.paneSound.classList.toggle('hidden', controls);
    this.paneControls.classList.toggle('hidden', !controls);
  }

  /** Pause menu. zone = big card text; goals = short lines shown under SHIFT / RUN GOALS. */
  showPause(v: boolean, zone?: string, goals?: readonly string[]): void {
    if (zone !== undefined) this.pauseZone.textContent = zone.toUpperCase();
    if (goals) {
      this.pauseGoals.innerHTML = '';
      for (const g of goals) {
        const r = div('goal');
        r.innerHTML = `<span class="goal-flag">⚑</span>${escapeHtml(g)}`;
        this.pauseGoals.appendChild(r);
      }
      (this.pauseGoals.previousElementSibling as HTMLElement).textContent = this.mode === 'city' ? 'SHIFT GOALS' : 'RUN GOALS';
    }
    this.pauseScreen.classList.toggle('hidden', !v);
    if (!v) this.settingsScreen.classList.add('hidden');
    this.menu(v);
  }

  showEnd(win: boolean, reason: GameOverReason, stats: RunStats, integrity: number, timeLeft: number, progress: number): void {
    this.endTitle.textContent = win ? 'PAHUNCH GAYE!' : reason === 'wrecked' ? `${this.vehicleLabel} WRECKED` : 'OUT OF TIME';
    this.endTitle.className = `screen-title ${win ? 'win' : 'lose'}`;
    this.endSub.textContent = win
      ? 'You made it to Clifton. Karachi traffic: conquered (for today).'
      : reason === 'wrecked'
        ? `The ${this.vehicleLabel} gave up. Mechanic in Saddar says: "Bas ho gaya, sahab."`
        : `Stuck in traffic — ${Math.round(progress * 100)}% of the way to Clifton.`;
    if (this.mode === 'city') this.endSub.textContent = `The ${this.vehicleLabel} gave up in the middle of Saddar. Mechanic says: "Bas ho gaya, sahab."`;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const rows: [string, string][] = [
      ['TIME DRIVEN', fmt(stats.elapsed)],
      ...(this.mode === 'route' ? [['ROUTE COVERED', `${Math.round(progress * 100)}%`] as [string, string]] : []),
      ['VEHICLE HP', `${Math.round(integrity)} HP`],
      ['TOP SPEED', `${Math.round(stats.topSpeed * 3.6)} KM/H`],
      ['CRASHES', String(stats.crashes)],
      ...(this.mode === 'route'
        ? ([
            ['POTHOLES HIT', String(stats.potholes)],
            ['MANHOLES HIT', String(stats.manholes)],
          ] as [string, string][])
        : []),
    ];
    if (win) rows.push(['TIME TO SPARE', `${timeLeft.toFixed(1)} S`]);
    this.endStats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.endScreen.classList.remove('hidden');
    this.menu(true);
  }

  hideEnd(): void {
    this.endScreen.classList.add('hidden');
    this.menu(false);
  }

  // ---- In-game ------------------------------------------------------------------------------

  showBanner(text: string): void {
    this.bannerText.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // restart animation
    this.banner.classList.add('show');
    this.bannerTimer = 3.2;
  }

  showToast(text: string, good = true): void {
    this.toast.textContent = text;
    this.toast.className = `toast show ${good ? 'good' : 'bad'}`;
    this.toastTimer = 2.2;
  }

  damageFlash(strength: number): void {
    this.flash.style.opacity = String(Math.min(0.6, 0.15 + strength));
    this.flash.classList.remove('fade');
    void this.flash.offsetWidth;
    this.flash.classList.add('fade');
  }

  setMoney(rs: number): void {
    this.targetMoney = rs;
    if (Number.isNaN(this.shownMoney) || rs < this.shownMoney) {
      this.shownMoney = rs;
      this.syncMoneyDisplay();
    }
  }

  private syncMoneyDisplay(): void {
    const shown = Math.round(this.shownMoney);
    if (shown === this.lastMoneyShown) return;
    this.lastMoneyShown = shown;
    if (this.mode === 'city') this.statA.textContent = shown.toLocaleString('en-PK');
  }

  setScore(points: number): void {
    if (points === this.lastScore) return;
    this.lastScore = points;
    if (this.mode === 'city') this.statB.textContent = points.toLocaleString('en-PK');
  }

  setSpeedRush(rush: number): void {
    this.speedLines.style.opacity = rush > 0.42 ? String(Math.min(0.65, (rush - 0.42) * 1.15)) : '0';
  }

  /**
   * Boost meter. charge 0..1 (1 = ready), active = boosting now (fill shows
   * what's left), drifting shows the drift tag, launchFrac shows Launch charge.
   */
  setBoost(
    charge: number,
    active: boolean,
    drifting: boolean,
    launchFrac = 0,
    dashReady = false,
    stopped = false,
    launchReady = false,
    driftFrac = 0,
  ): void {
    const launchShown = !active && !drifting && launchFrac > 0;
    const c = Math.max(0, Math.min(1, drifting ? driftFrac : launchShown ? launchFrac : charge));
    this.boostFill.style.width = `${(c * 100).toFixed(1)}%`;
    const state = active
      ? 'active'
      : drifting
        ? 'drift'
        : launchShown
          ? launchReady
            ? 'launch-ready'
            : 'launch'
          : c >= 1
            ? 'ready'
            : 'charging';
    const label = active
      ? 'BOOST!'
      : drifting
        ? driftFrac >= 1
          ? 'FULL DRIFT · RELEASE!'
          : driftFrac >= 0.635
            ? 'MINI DRIFT · RELEASE'
            : 'DRIFTING · TURN'
        : launchShown
          ? launchFrac >= 1
            ? 'MAX LAUNCH · RELEASE!'
            : launchReady
              ? 'LAUNCH READY · HOLD'
              : 'CHARGING LAUNCH'
          : c >= 1
            ? dashReady
              ? 'DASH READY · 2× GAS'
              : stopped
                ? 'LAUNCH · BRAKE + GAS'
                : 'BOOST READY'
            : 'BOOST';
    if (this.boost.dataset.state !== state || this.boostLabel.textContent !== label) {
      this.boost.dataset.state = state;
      this.boostLabel.textContent = label;
    }
  }

  /** Current fare (or a hint when looking for one); null hides the plate. */
  setFare(
    f:
      | { name: string; distance: number; timeLeft: number; limit: number; kind?: FareKind; stop?: number; stops?: number; chain?: number }
      | { hint: string }
      | null,
  ): void {
    if (!f) {
      this.farePanel.classList.add('hidden');
      this.farePanel.classList.remove('vip', 'party');
      this.fareMeta.classList.add('hidden');
      this.lastFareKey = '';
      return;
    }
    this.farePanel.classList.remove('hidden');
    if ('hint' in f) {
      if (this.lastFareKey !== f.hint) {
        this.fareName.textContent = f.hint;
        this.fareInfo.textContent = '';
        this.fareMeta.classList.add('hidden');
        this.farePanel.classList.remove('vip', 'party');
        this.farePanel.classList.add('looking');
        this.lastFareKey = f.hint;
      }
      return;
    }
    this.farePanel.classList.remove('looking');
    this.farePanel.classList.toggle('vip', f.kind === 'vip');
    this.farePanel.classList.toggle('party', f.kind === 'party');
    const key = `${f.name}|${Math.round(f.distance / 10)}|${Math.ceil(f.timeLeft)}|${f.kind ?? 'standard'}|${f.stop ?? 1}|${f.chain ?? 0}`;
    if (key !== this.lastFareKey) {
      this.lastFareKey = key;
      const parts: string[] = [];
      if (f.kind === 'vip') parts.push('VIP · 2× PAY');
      else if (f.kind === 'party') parts.push(`PARTY · STOP ${f.stop ?? 1}/${f.stops ?? 2}`);
      if ((f.chain ?? 0) >= 2) {
        const mul = (1 + Math.min(4, (f.chain ?? 0) - 1) * 0.25).toFixed(2).replace(/\.?0+$/, '');
        parts.push(`FEVER ×${mul}`);
      }
      if (parts.length > 0) {
        this.fareMeta.textContent = parts.join(' · ');
        this.fareMeta.classList.remove('hidden');
      } else {
        this.fareMeta.classList.add('hidden');
      }
      this.fareName.textContent = f.name.toUpperCase();
      const d = f.distance < 1000 ? `${Math.round(f.distance / 10) * 10} M` : `${(f.distance / 1000).toFixed(1)} KM`;
      this.fareInfo.innerHTML = `${d} <span class="dot">·</span> <b>${Math.ceil(f.timeLeft)} S</b>`;
    }
    const frac = Math.max(0, Math.min(1, f.timeLeft / f.limit));
    this.fareFill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.fareFill.className = `fare-fill ${frac > 0.5 ? 'ok' : frac > 0.25 ? 'warn' : 'crit'}`;
  }

  /** Guide arrow rotation relative to the car (radians, 0 = straight ahead), null hides. */
  setArrow(angle: number | null, urgency: 'ok' | 'warn' | 'hot' = 'ok'): void {
    this.arrow.classList.toggle('hidden', angle === null);
    if (angle !== null) {
      this.arrow.style.transform = `perspective(300px) rotateX(38deg) rotate(${angle.toFixed(3)}rad)`;
      if (urgency !== this.lastUrgency) {
        this.lastUrgency = urgency;
        this.arrowPath.setAttribute('fill', urgency === 'hot' ? '#ff2d6f' : urgency === 'warn' ? '#ffc61a' : '#c6f432');
      }
    }
  }

  showShiftOver(
    info: {
      earned: number;
      fares: number;
      total: number;
      score: number;
      best: number;
      rank: ShiftRank;
      bestEarned: number;
      isNewBest: boolean;
      bestChain: number;
    } | null,
  ): void {
    this.shiftCard.classList.toggle('hidden', !info);
    if (info) {
      const n = (x: number) => x.toLocaleString('en-PK');
      const badge = info.isNewBest ? `<span class="new-best">NEW BEST!</span>` : `<span class="shift-best">BEST RS ${n(info.bestEarned)}</span>`;
      this.shiftText.innerHTML = `<div class="shift-head"><span class="shift-tag">SHIFT OVER</span><span class="shift-rank rank-${info.rank}">RANK ${info.rank}</span>${badge}</div><div class="shift-earned">RS ${n(info.earned)}</div><div class="shift-rows"><div><span>FARES</span><b>${info.fares}</b></div><div><span>FEVER CHAIN</span><b>${info.bestChain}</b></div><div><span>STUNT POINTS</span><b>${n(info.score)}</b></div><div><span>BEST COMBO</span><b>${n(info.best)}</b></div></div>`;
    }
  }

  /** Live combo: multiplier, points at stake, and how much of the window is left (0..1). */
  setCombo(mult: number, pending: number, left: number): void {
    const key = mult > 0 ? `${mult}|${pending}` : '';
    if (key !== this.lastCombo) {
      this.lastCombo = key;
      this.comboBox.classList.toggle('hidden', mult === 0);
      if (mult > 0) {
        this.comboMult.innerHTML = `<small>×</small>${mult}`;
        this.comboMult.dataset.tier = String(Math.min(4, Math.ceil(mult / 2)));
        this.comboPts.textContent = pending.toLocaleString('en-PK');
        this.comboBox.classList.remove('pop');
        void this.comboBox.offsetWidth;
        this.comboBox.classList.add('pop');
      }
    }
    if (mult > 0) this.comboFill.style.width = `${(Math.max(0, Math.min(1, left)) * 100).toFixed(1)}%`;
  }

  /** A stunt strip that slides in on the right and fades. */
  showStunt(label: string, points: number): void {
    const el = div('stunt');
    el.innerHTML = `<span>${escapeHtml(label)}</span><b>+${points}</b>`;
    this.stuntStack.prepend(el);
    while (this.stuntStack.children.length > 4) this.stuntStack.lastElementChild?.remove();
    window.setTimeout(() => el.remove(), 2000);
  }

  update(dt: number, speedKmh: number, integrity: number, timeLeft: number, progress: number, nextCpDist = 0): void {
    if (this.mode === 'city' && this.shownMoney < this.targetMoney) {
      const step = Math.max(dt * 120, (this.targetMoney - this.shownMoney) * Math.min(1, dt * 10));
      this.shownMoney = Math.min(this.targetMoney, this.shownMoney + step);
      this.syncMoneyDisplay();
    }

    const s = Math.round(Math.abs(speedKmh));
    if (s !== this.lastSpeed) {
      this.speed.textContent = String(s);
      this.lastSpeed = s;
    }
    const hp = Math.ceil(integrity);
    if (hp !== this.lastIntegrity) {
      this.integrityFill.style.width = `${hp}%`;
      this.integrityFill.className = `integ-fill ${hp > 60 ? 'ok' : hp > 30 ? 'warn' : 'crit'}`;
      this.integrityText.textContent = `${hp}%`;
      this.lastIntegrity = hp;
    }
    const tt = `${String(Math.floor(timeLeft / 60)).padStart(2, '0')}:${String(Math.floor(timeLeft % 60)).padStart(2, '0')}.${Math.floor((timeLeft % 1) * 10)}`;
    if (tt !== this.lastClock) {
      this.clockText.textContent = tt;
      this.clock.classList.toggle('low', timeLeft < 10);
      this.lastClock = tt;
    }
    if (this.mode === 'route') {
      const rem = Math.max(0, Math.round((1 - progress) * FINISH_Z));
      if (rem !== this.lastDistLeft) {
        this.lastDistLeft = rem;
        this.statA.textContent = rem >= 1000 ? `${(rem / 1000).toFixed(1)} KM` : `${rem} M`;
      }
      const nxt = Math.max(0, Math.round(nextCpDist));
      if (nxt !== this.lastNextDist) {
        this.lastNextDist = nxt;
        this.statB.textContent = nxt >= 1000 ? `${(nxt / 1000).toFixed(1)} KM` : `${nxt} M`;
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function span(cls: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  return s;
}

function button(label: string, cls: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}

/** Big mode tile: two lines of slanted caps. */
function tile(top: string, bottom: string, title: string): HTMLButtonElement {
  const b = button('', 'tile', title);
  b.innerHTML = `<span class="tile-top">${top}</span><span class="tile-bottom">${bottom}</span>`;
  return b;
}

/** White card button with an optional coloured value line. */
function cardBtn(label: string, value: string, title: string): HTMLButtonElement {
  const b = button('', 'card-btn', title);
  b.innerHTML = `<span class="card-label">${label}</span><span class="card-value">${value}</span>`;
  return b;
}

function setCard(b: HTMLButtonElement, value: string): void {
  const v = b.querySelector('.card-value');
  if (v) v.textContent = value;
}

function gearIcon(): string {
  return '<svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
