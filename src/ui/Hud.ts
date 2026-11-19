import { RADIO_STATIONS } from '../audio/engineDspMath';
import type { RadioStationId } from '../audio/engineDspMath';
import type { TouchSteerMode } from '../input/InputManager';
import type { TimeOfDay } from '../render/Renderer';
import type { FareKind, ShiftRank } from '../sim/city/Fares';
import type { RunStats } from '../sim/LevelManager';
import { VEHICLE_SPECS } from '../sim/PlayerCar';
import { FINISH_Z } from '../sim/road';
import type { GameOverReason, PlayerVehicle } from '../sim/types';

type Mode = 'route' | 'city';


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
  private trackKicker: HTMLDivElement;
  private trackSpec: HTMLSpanElement;
  private trackMapCity: SVGSVGElement;
  private trackMapRoute: SVGSVGElement;
  private bankBadge: HTMLDivElement;
  private bestHint: HTMLSpanElement;

  readonly todBtns: Record<TimeOfDay, HTMLButtonElement>;
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

    // ---- Mode & conditions select (start) --------------------------------------------------------
    this.startScreen = div('screen start');
    const topbar = div('topbar');
    topbar.innerHTML = `<div class="brand"><span class="brand-mark">KT</span><span class="brand-name">KARACHI<br>TRAFFIC 3D</span></div>`;
    const topRight = div('topbar-right');
    this.bankBadge = div('bank-badge');
    const startSettings = button('', 'topbar-btn', 'Game options');
    startSettings.innerHTML = gearIcon();
    topRight.append(this.bankBadge, startSettings);
    topbar.appendChild(topRight);

    const stage = div('start-stage');
    const stageHead = div('stage-head');
    stageHead.innerHTML = '<span class="stage-title">SELECT RUN &amp; CONDITIONS</span><span class="stage-sub">PICK WEATHER, RIDE &amp; ROUTE</span>';

    const stageGrid = div('stage-grid');

    // Left featured card: map preview + mode info + specs + ride picker
    const trackCard = div('track-card');
    const trackPreview = div('track-preview');
    trackPreview.innerHTML = trackPreviewMarkup();
    this.trackMapCity = trackPreview.querySelector('.map-city')!;
    this.trackMapRoute = trackPreview.querySelector('.map-route')!;
    const trackInfo = div('track-info');
    this.trackKicker = div('track-kicker');
    this.heroTitle = document.createElement('h1');
    this.heroText = document.createElement('p');
    const trackStats = div('track-stats');
    const specRow = div('track-stat');
    const specLbl = span('ts-lbl');
    specLbl.textContent = 'MAP';
    this.trackSpec = span('ts-val');
    specRow.append(specLbl, this.trackSpec);
    const bestRow = div('track-stat');
    const bestLbl = span('ts-lbl');
    bestLbl.textContent = 'BEST';
    const bestVal = span('ts-val best-val');
    bestRow.append(bestLbl, bestVal);
    trackStats.append(specRow, bestRow);
    this.bestHint = bestVal;



    trackInfo.append(this.trackKicker, this.heroTitle, this.heroText, trackStats);
    trackCard.append(trackPreview, trackInfo);



    // Right: vertical Time-of-Day / Weather condition strips
    const condWrap = div('cond-strips');
    const makeCondStrip = (tod: TimeOfDay, name: string, clock: string, desc: string, art: string) => {
      const b = button('', `cond-strip cond-${tod}`, `${name} — ${clock} (${desc})`);
      b.dataset.tod = tod;
      b.innerHTML = `<div class="cond-art">${art}</div><div class="cond-meta"><span class="cond-tag">SELECTED</span><span class="cond-name">${name}</span><span class="cond-time">${clock}</span><span class="cond-desc">${desc}</span></div>`;
      condWrap.appendChild(b);
      return b;
    };
    this.todBtns = {
      noon: makeCondStrip('noon', 'NOON', '12:30', 'Fine Weather', condSvg('noon')),
      sunset: makeCondStrip('sunset', 'SUNSET', '18:15', 'Golden Hour', condSvg('sunset')),
      night: makeCondStrip('night', 'NIGHT', '22:00', 'Neon Streets', condSvg('night')),
      monsoon: makeCondStrip('monsoon', 'MONSOON', '16:40', 'Heavy Rain', condSvg('monsoon')),
    };

    stageGrid.append(trackCard, condWrap);
    stage.append(stageHead, stageGrid);

    // Bottom dock: mode / utility tiles on left, Daily + Play CTA on right
    const dock = div('start-dock');
    const tiles = div('tiles');
    this.cityBtn = tile('FREE ROAM', 'SADDAR', 'Free roam in Saddar');
    this.startBtn = tile('ROUTE', 'RUN', 'Route run to Clifton');
    const controlsTile = tile('HOW TO', 'DRIVE', 'Controls');
    const optionsTile = tile('GAME', 'OPTIONS', 'Game options');
    controlsTile.classList.add('dim');
    optionsTile.classList.add('dim');
    tiles.append(this.cityBtn, this.startBtn, controlsTile, optionsTile);

    this.playBtn = button('PLAY', 'go-btn play', 'Play');
    this.dailyBtn = button('', 'daily-btn', 'Daily Saddar challenge');
    this.dailyBtn.innerHTML = `<span class="d-top">DAILY</span><span class="d-sub">SADDAR</span>`;
    const playActions = div('play-actions');
    playActions.append(this.dailyBtn, this.playBtn);

    dock.append(tiles, playActions);
    this.startScreen.append(topbar, stage, dock);

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
    this.trackMapCity.classList.toggle('hidden', mode !== 'city');
    this.trackMapRoute.classList.toggle('hidden', mode !== 'route');
    if (mode === 'city') {
      this.trackKicker.textContent = 'WORLD CITY · KARACHI';
      this.heroTitle.innerHTML = 'SADDAR FREE ROAM';
      this.heroText.textContent = 'Pick up fares across Saddar, beat the meter, and chain drifts, jumps & near misses.';
      this.trackSpec.textContent = '1.6 × 1.6 km · 31 Landmarks';
      this.statAKey.textContent = 'RS';
      this.statBKey.textContent = '★';
    } else {
      this.trackKicker.textContent = 'HIGHWAY RUN · CLIFTON';
      this.heroTitle.innerHTML = 'SADDAR TO CLIFTON';
      this.heroText.textContent = '4.2 km dash via Lyari Expressway & Shahrah-e-Faisal to Teen Talwar against the clock.';
      this.trackSpec.textContent = '4.2 km · 3 Zones';
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
    this.bestHint.textContent = text ? text : 'NO RECORD YET';
  }

  setVehicle(v: PlayerVehicle, bank: number): void {
    const sp = VEHICLE_SPECS[v];
    this.vehicleLabel = sp.label;
    this.integLabel.textContent = sp.label;
    this.bankBadge.textContent = `BANK RS ${bank.toLocaleString('en-PK')}`;
    setCard(this.rideBtn, `${sp.label} · ${sp.tag}`);

  }

  setTimeOfDay(tod: TimeOfDay): void {
    setCard(this.todBtn, tod.toUpperCase());
    for (const k of ['noon', 'sunset', 'night', 'monsoon'] as const) {
      const btn = this.todBtns[k];
      btn.classList.toggle('chosen', k === tod);
      btn.setAttribute('aria-pressed', k === tod ? 'true' : 'false');
    }
  }

  setAutoGas(on: boolean): void {
    setCard(this.autoGasBtn, on ? 'ON' : 'OFF');
  }

  setHaptics(on: boolean): void {
    setCard(this.hapticsBtn, on ? 'ON' : 'OFF');
  }

  setRadio(stationOrOn: RadioStationId | boolean): void {
    const id: RadioStationId =
      typeof stationOrOn === 'boolean' ? (stationOrOn ? 'dhol' : 'off') : stationOrOn;
    const label = RADIO_STATIONS[id]?.hudLabel ?? 'OFF';
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

  setMenu(open: boolean): void {
    this.menu(open);
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
    this.banner.classList.toggle('long', text.length > 22);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // restart animation
    this.banner.classList.add('show');
    this.bannerTimer = 2.4;
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
      else if (f.kind === 'chai') parts.push('HOT CHAI · NO SPILLS');
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

function trackPreviewMarkup(): string {
  return `
    <svg class="map-city" viewBox="0 0 260 130" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M28 96 L80 94 L132 82 L188 74 L232 62 M46 44 L106 38 L168 48 L224 44 M68 22 L80 94 L86 116 M132 20 L132 112 M186 24 L188 108" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="4" stroke-linecap="round"/>
      <path d="M56 70 L108 66 L158 60 L188 74 L148 96 L94 94 L56 70 Z" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="132" cy="63" r="6.5" fill="none" stroke="#c6f432" stroke-width="2.5"/>
      <circle cx="158" cy="60" r="6" fill="#ff2d6f" stroke="#ffffff" stroke-width="2"/>
    </svg>
    <svg class="map-route hidden" viewBox="0 0 260 130" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M30 98 C74 96, 86 58, 130 56 C174 54, 184 28, 228 34" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="10" stroke-linecap="round"/>
      <path d="M30 98 C74 96, 86 58, 130 56 C174 54, 184 28, 228 34" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round"/>
      <circle cx="130" cy="56" r="4.5" fill="#ffc61a"/>
      <circle cx="228" cy="34" r="6" fill="#c6f432" stroke="#0b1530" stroke-width="2"/>
      <circle cx="30" cy="98" r="6" fill="#ff2d6f" stroke="#ffffff" stroke-width="2"/>
    </svg>
  `;
}

function condSvg(tod: TimeOfDay): string {
  const palette: Record<TimeOfDay, { sky0: string; sky1: string; sky2: string; bldg: string; road: string; line: string }> = {
    noon: { sky0: '#2e78c7', sky1: '#7bc0f2', sky2: '#dceeff', bldg: '#45546b', road: '#2b3442', line: '#e4e9f0' },
    sunset: { sky0: '#241a3f', sky1: '#b8465a', sky2: '#ffbe63', bldg: '#261b2f', road: '#1d1628', line: '#ffd085' },
    night: { sky0: '#040814', sky1: '#0b1838', sky2: '#1a2d5a', bldg: '#081024', road: '#090e1c', line: '#6fa4ff' },
    monsoon: { sky0: '#16212e', sky1: '#33485b', sky2: '#5f7484', bldg: '#1c2834', road: '#151e28', line: '#90b4cc' },
  };
  const p = palette[tod];
  const skyFx =
    tod === 'noon'
      ? `<circle cx="122" cy="78" r="18" fill="#fff6c4" opacity="0.95"/><circle cx="122" cy="78" r="32" fill="#fff6c4" opacity="0.22"/><ellipse cx="64" cy="112" rx="44" ry="12" fill="#ffffff" opacity="0.45"/><ellipse cx="138" cy="144" rx="50" ry="13" fill="#ffffff" opacity="0.35"/>`
      : tod === 'sunset'
        ? `<circle cx="92" cy="186" r="30" fill="#ffd97a" opacity="0.92"/><circle cx="92" cy="186" r="54" fill="#ff8f45" opacity="0.32"/><ellipse cx="52" cy="128" rx="46" ry="9" fill="#ff9e6d" opacity="0.35"/><ellipse cx="134" cy="146" rx="42" ry="8" fill="#ffb87a" opacity="0.3"/>`
        : tod === 'night'
          ? `<path d="M126 58a14 14 0 1 0 16 18 11 11 0 1 1-16-18z" fill="#eef4ff" opacity="0.9"/><circle cx="38" cy="48" r="1.5" fill="#fff"/><circle cx="78" cy="74" r="1.2" fill="#fff" opacity="0.75"/><circle cx="148" cy="108" r="1.4" fill="#fff" opacity="0.8"/><circle cx="54" cy="122" r="1.1" fill="#fff" opacity="0.65"/>`
          : `<ellipse cx="62" cy="72" rx="58" ry="22" fill="#233140" opacity="0.85"/><ellipse cx="128" cy="90" rx="64" ry="24" fill="#2b3d4f" opacity="0.85"/><path d="M114 96 L98 134 L110 134 L94 172" stroke="#dceeff" stroke-width="2" fill="none" opacity="0.55"/><g stroke="#cde4f5" stroke-width="1.2" opacity="0.48"><line x1="24" y1="70" x2="10" y2="128"/><line x1="62" y1="88" x2="48" y2="146"/><line x1="96" y1="62" x2="82" y2="120"/><line x1="142" y1="84" x2="128" y2="142"/><line x1="42" y1="148" x2="28" y2="206"/><line x1="116" y1="152" x2="102" y2="210"/><line x1="160" y1="138" x2="146" y2="196"/></g>`;
  const winGlow =
    tod === 'night'
      ? `<g fill="#ffc61a" opacity="0.85"><rect x="20" y="218" width="5" height="6"/><rect x="30" y="218" width="5" height="6"/><rect x="20" y="232" width="5" height="6"/><rect x="134" y="210" width="5" height="6"/><rect x="144" y="210" width="5" height="6"/><rect x="134" y="224" width="5" height="6"/><rect x="144" y="224" width="5" height="6"/></g><rect x="14" y="248" width="32" height="4" fill="#ff2d6f" opacity="0.85"/><rect x="128" y="246" width="38" height="4" fill="#c6f432" opacity="0.8"/>`
      : tod === 'monsoon'
        ? `<g fill="#ffe18c" opacity="0.55"><rect x="20" y="218" width="5" height="6"/><rect x="134" y="210" width="5" height="6"/><rect x="144" y="224" width="5" height="6"/></g><path d="M40 264 L145 264" stroke="#8dc2e6" stroke-width="2" opacity="0.35"/>`
        : '';
  return `<svg viewBox="0 0 180 340" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="sky-${tod}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.sky0}"/><stop offset="56%" stop-color="${p.sky1}"/><stop offset="100%" stop-color="${p.sky2}"/></linearGradient></defs>
    <rect width="180" height="340" fill="url(#sky-${tod})"/>
    ${skyFx}
    <path d="M0 262 L0 208 L44 208 L44 226 L62 226 L62 198 L74 188 L82 156 L92 156 L100 188 L112 198 L112 224 L126 224 L126 198 L162 198 L162 218 L180 218 L180 262 Z" fill="${p.bldg}"/>
    <rect y="256" width="180" height="84" fill="${p.road}"/>
    <polygon points="84,256 96,256 120,340 60,340" fill="${p.line}" opacity="0.22"/>
    ${winGlow}
  </svg>`;
}
