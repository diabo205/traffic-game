import { SoundEngine } from './audio/SoundEngine';
import { InputManager } from './input/InputManager';
import type { TouchSteerMode } from './input/InputManager';
import { Renderer } from './render/Renderer';
import type { AnyWorld, TimeOfDay } from './render/Renderer';
import { CHECKPOINTS } from './sim/LevelManager';
import { MOVES, VEHICLE_COST, VEHICLE_SPECS } from './sim/PlayerCar';
import { FINISH_Z, ZONES } from './sim/road';
import { COMBO_WINDOW, DT } from './sim/types';
import type { PlayerVehicle, SimEvent } from './sim/types';
import { Hud } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';

import type { ShiftRank } from './sim/city/Fares';

const MAX_STEPS_PER_FRAME = 5;
const VEHICLES: readonly PlayerVehicle[] = ['alto', 'rickshaw', 'minibus'];
const TIMES_OF_DAY: readonly TimeOfDay[] = ['noon', 'sunset', 'night', 'monsoon'];
const STEER_MODES: readonly TouchSteerMode[] = ['buttons', 'joystick', 'tilt'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

type Mode = 'route' | 'city';

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode etc. — preferences just won't persist */
  }
}

function dailyUtcInfo(): { key: string; label: string; seed: number } {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const key = `${y}${String(m + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const label = `${MONTHS[m]} ${String(day).padStart(2, '0')}`;
  let h = Number(key) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const seed = (h ^ (h >>> 16)) >>> 0 || 1337;
  return { key, label, seed };
}

function parseCityBest(raw: string | null): { earned: number; rank?: ShiftRank } {
  if (!raw) return { earned: 0 };
  const [eStr, r] = raw.split('|');
  const earned = Math.max(0, Math.floor(Number(eStr) || 0));
  const rank = r === 'S' || r === 'A' || r === 'B' || r === 'C' || r === 'D' ? r : undefined;
  return { earned, rank };
}

/**
 * Wires sim, renderer, input, audio and UI together and runs the
 * fixed-timestep loop (sim at 60 Hz, rendering at display rate).
 */
export class Game {
  private world: AnyWorld;
  private mode: Mode;
  private vehicle: PlayerVehicle = 'alto';
  private bank = 0;
  private tod: TimeOfDay = 'noon';
  private autoGas = false;
  private haptics = true;
  private steerMode: TouchSteerMode = 'buttons';
  private whooshCooldown = 0;
  private npcHornCooldown = 0;
  private lastTrackedMoney = 0;
  private lastCountdownSec = -1;
  private readonly input = new InputManager();
  private readonly audio = new SoundEngine();
  private readonly hud: Hud;
  private readonly touch: TouchControls;
  private accumulator = 0;
  private lastTime = 0;
  private endShownAt = -1;
  private endPendingAt = -1;
  private clock = 0;
  private minimap: Minimap | null = null;
  private paused = false;
  private farCamera = false;
  private mapTimer = 0;
  private dailyMode = false;
  private readonly daily = dailyUtcInfo();
  private hadFirstShift = false;
  private pendingToast: { delay: number; text: string; good: boolean } | null = null;
  private worldSeq = 0;
  private switching = false;

  private constructor(
    private readonly renderer: Renderer,
    world: AnyWorld,
    private readonly seed: number,
    private readonly startZ: number,
    mode: Mode,
    dailyMode: boolean,
    bank: number,
    vehicle: PlayerVehicle,
    tod: TimeOfDay,
    uiRoot: HTMLElement,
  ) {
    this.world = world;
    this.mode = mode;
    this.dailyMode = dailyMode;
    this.bank = bank;
    this.vehicle = vehicle;
    this.tod = tod;
    this.world.weather = tod === 'monsoon' ? 'monsoon' : 'clear';

    this.hud = new Hud(uiRoot);
    this.hud.setMode(mode);
    this.hud.setVehicle(this.vehicle, this.bank);
    this.hud.setTimeOfDay(this.tod);
    this.syncBestHud();
    this.syncMinimap();
    this.touch = new TouchControls(this.hud.root, this.input.touch);

    this.renderer.onThunder = (pan, intensity) => {
      if (this.world.phase === 'running' && !this.paused) {
        this.audio.thunder(pan, intensity);
        this.vibrate([18, 40, 28]);
      }
    };

    // Touch HUD: auto-detect, remember manual choice.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const savedTouch = storageGet('kt3d.touch');
    const rawSteer = storageGet('kt3d.steer');
    let initialSteer: TouchSteerMode =
      rawSteer === 'tilt' || rawSteer === 'joystick' || rawSteer === 'buttons'
        ? rawSteer
        : storageGet('kt3d.stick') === '1'
          ? 'joystick'
          : 'buttons';
    const needsIosGesture =
      'DeviceOrientationEvent' in window &&
      typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function';
    if (initialSteer === 'tilt' && needsIosGesture) initialSteer = 'buttons';

    this.setTouchVisible(savedTouch === null ? coarse : savedTouch === '1', false);
    this.setSteerMode(initialSteer, false);
    this.setAutoGas(storageGet('kt3d.autogas') === '1', false);
    this.setHaptics(storageGet('kt3d.haptics') !== '0', false);
    this.setMuted(storageGet('kt3d.muted') === '1');
    this.setRadio(storageGet('kt3d.radio') !== '0', false);
    this.setCamera(storageGet('kt3d.cam') === 'far', false);

    this.bindUi();
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 200));
  }

  private static async buildWorld(mode: Mode, seed: number, startZ: number, vehicle: PlayerVehicle): Promise<AnyWorld> {
    if (mode === 'city') {
      const mod = await import('./sim/city/CityWorld');
      return new mod.CityWorld(seed, vehicle);
    }
    const mod = await import('./sim/World');
    return new mod.World(seed, startZ, vehicle);
  }

  static async create(container: HTMLElement, uiRoot: HTMLElement): Promise<Game> {
    const params = new URLSearchParams(window.location.search);
    const isDaily = params.has('daily');
    const daily = dailyUtcInfo();
    const seed = isDaily ? daily.seed : Number(params.get('seed') ?? '1337') >>> 0 || 1337;
    const lowSpec = params.has('low') || (window.matchMedia('(pointer: coarse)').matches && !params.has('high'));
    // Debug: ?z=1500 starts further along the route.
    const startZ = Math.max(0, Math.min(4200, Number(params.get('z') ?? '0') || 0));
    // ?mode=route|city, else ?z implies the route, else the last mode played.
    const asked = params.get('mode');
    const saved = storageGet('kt3d.mode');
    const mode: Mode = isDaily ? 'city' : asked === 'route' || asked === 'city' ? asked : params.has('z') ? 'route' : saved === 'route' ? 'route' : 'city';

    const bank = Math.max(0, Math.floor(Number(storageGet('kt3d.bank') ?? '0') || 0));
    let vehicle: PlayerVehicle = 'alto';
    const savedVeh = storageGet('kt3d.veh');
    if ((savedVeh === 'alto' || savedVeh === 'rickshaw' || savedVeh === 'minibus') && bank >= VEHICLE_COST[savedVeh]) {
      vehicle = savedVeh;
    }
    let tod: TimeOfDay = 'noon';
    const savedTod = storageGet('kt3d.tod');
    if (params.has('monsoon')) tod = 'monsoon';
    else if (savedTod === 'noon' || savedTod === 'sunset' || savedTod === 'night' || savedTod === 'monsoon') tod = savedTod;

    const renderer = await Renderer.create(container, lowSpec);
    const activeSeed = isDaily ? daily.seed : seed;
    const world = await Game.buildWorld(mode, activeSeed, startZ, vehicle);
    world.weather = tod === 'monsoon' ? 'monsoon' : 'clear';
    renderer.setTimeOfDay(tod);
    await renderer.attach(world);
    return new Game(renderer, world, seed, startZ, mode, isDaily, bank, vehicle, tod, uiRoot);
  }

  private resetRunTrackers(): void {
    this.lastTrackedMoney = 0;
    this.lastCountdownSec = -1;
    this.hadFirstShift = false;
    this.pendingToast = null;
  }

  private async swapWorld(mode: Mode, dailyMode: boolean, vehicle: PlayerVehicle): Promise<boolean> {
    const seq = ++this.worldSeq;
    this.switching = true;
    try {
      const activeSeed = dailyMode ? this.daily.seed : this.seed;
      const nextWorld = await Game.buildWorld(mode, activeSeed, this.startZ, vehicle);
      nextWorld.weather = this.tod === 'monsoon' ? 'monsoon' : 'clear';
      if (seq !== this.worldSeq) return false;
      await this.renderer.attach(nextWorld);
      if (seq !== this.worldSeq) return false;
      this.mode = mode;
      this.dailyMode = dailyMode;
      this.vehicle = vehicle;
      this.world = nextWorld;
      this.resetRunTrackers();
      this.accumulator = 0;
      return true;
    } finally {
      if (seq === this.worldSeq) this.switching = false;
    }
  }

  private syncBestHud(): void {
    const dBest = parseCityBest(storageGet(`kt3d.daily.${this.daily.key}`));
    this.hud.setDailyInfo(this.daily.label, dBest.earned, dBest.rank);
    if (this.mode === 'city') {
      const cBest = parseCityBest(storageGet(`kt3d.best.city.${this.vehicle}`));
      this.hud.setBestSummary(cBest.earned > 0 ? `BEST RS ${cBest.earned.toLocaleString('en-PK')}${cBest.rank ? ` (${cBest.rank})` : ''}` : null);
    } else {
      const rRaw = storageGet(`kt3d.best.route.${this.vehicle}`);
      if (rRaw?.startsWith('win:')) this.hud.setBestSummary(`BEST WIN ${rRaw.slice(4)}S LEFT`);
      else if (rRaw?.startsWith('prog:')) this.hud.setBestSummary(`BEST ${rRaw.slice(5)}%`);
      else this.hud.setBestSummary(null);
    }
  }

  private addBank(delta: number): void {
    const gain = Math.round(delta);
    if (gain <= 0) return;
    const prev = this.bank;
    this.bank += gain;
    storageSet('kt3d.bank', String(this.bank));
    this.hud.setVehicle(this.vehicle, this.bank);
    for (const v of VEHICLES) {
      const cost = VEHICLE_COST[v];
      if (cost > 0 && prev < cost && this.bank >= cost) {
        this.hud.showBanner(`${VEHICLE_SPECS[v].label} UNLOCKED!`);
        this.audio.chime();
      }
    }
  }

  private async selectVehicle(v: PlayerVehicle, save = true): Promise<void> {
    const cost = VEHICLE_COST[v];
    if (this.bank < cost) {
      this.toastNow(`NEED RS ${cost.toLocaleString('en-PK')} TOTAL IN BANK`, false);
      return;
    }
    if (v === this.vehicle) return;
    this.vehicle = v;
    if (save) storageSet('kt3d.veh', v);
    this.hud.setVehicle(v, this.bank);
    this.syncBestHud();
    if (this.world.phase === 'ready') {
      if (await this.swapWorld(this.mode, this.dailyMode, v)) this.syncMinimap();
    } else {
      this.toastNow(`${VEHICLE_SPECS[v].label} READY NEXT RUN`);
    }
  }

  private cycleVehicle(): void {
    const unlocked = VEHICLES.filter((v) => this.bank >= VEHICLE_COST[v]);
    if (unlocked.length <= 1) {
      const next = VEHICLES.find((v) => this.bank < VEHICLE_COST[v]);
      if (next) this.toastNow(`EARN RS ${VEHICLE_COST[next].toLocaleString('en-PK')} TO UNLOCK ${VEHICLE_SPECS[next].label}`, false);
      return;
    }
    const idx = unlocked.indexOf(this.vehicle);
    void this.selectVehicle(unlocked[(idx + 1) % unlocked.length]);
  }

  private cycleTimeOfDay(): void {
    const next = TIMES_OF_DAY[(TIMES_OF_DAY.indexOf(this.tod) + 1) % TIMES_OF_DAY.length];
    this.tod = next;
    this.world.weather = next === 'monsoon' ? 'monsoon' : 'clear';
    this.renderer.setTimeOfDay(next);
    this.hud.setTimeOfDay(next);
    storageSet('kt3d.tod', next);
  }

  /** The minimap exists only for the city. */
  private syncMinimap(): void {
    if (this.world.mode === 'city' && !this.minimap) {
      this.minimap = new Minimap(this.world.map);
      this.hud.mapSlot.appendChild(this.minimap.el);
    } else if (this.world.mode !== 'city' && this.minimap) {
      this.minimap.el.remove();
      this.minimap = null;
    }
  }

  /** Mode tile on the start screen: rebuild the world if the mode changed (PLAY starts it). */
  private async chooseMode(mode: Mode): Promise<void> {
    if (this.world.phase !== 'ready') return;
    if (mode === this.mode && !this.dailyMode && !this.switching) return;
    this.mode = mode;
    this.dailyMode = false;
    this.hud.setMode(mode);
    storageSet('kt3d.mode', mode);
    if (await this.swapWorld(mode, false, this.vehicle)) {
      this.syncMinimap();
      this.syncBestHud();
    }
  }

  /** Quick-launch today's deterministic UTC Saddar challenge. */
  private async launchDaily(): Promise<void> {
    if (this.world.phase !== 'ready' || this.switching) return;
    this.audio.unlock();
    this.dailyMode = true;
    this.mode = 'city';
    this.hud.setMode('city');
    if (!(await this.swapWorld('city', true, this.vehicle))) return;
    this.syncMinimap();
    this.syncBestHud();
    this.hud.showStart(false);
    this.world.start();
    this.drainAndHandle();
    this.lastTime = performance.now();
    this.hud.showBanner(`DAILY · ${this.daily.label}`);
  }

  private toastNow(text: string, good = true): void {
    this.pendingToast = null;
    this.hud.showToast(text, good);
  }

  // ---- Pause ----------------------------------------------------------------------------

  private pause(): void {
    if (this.paused || this.world.phase !== 'running') return;
    this.paused = true;
    this.audio.setPaused(true);
    const w = this.world;
    const goals: string[] = [];
    let zone = 'Karachi';
    if (w.mode === 'city') {
      const f = w.fares;
      zone = this.dailyMode ? `Daily · ${this.daily.label}` : 'Saddar';
      if (f.fare) goals.push(`Deliver to ${f.places[f.fare.dest].name} · ${Math.round(f.navDist)} m · ${Math.ceil(f.fare.timeLeft)} s left`);
      else if (f.onShift) goals.push('Find a passenger and stop beside them');
      else goals.push('Shift over · start a new one when you are ready');
      goals.push(`Shift clock ${Math.floor(f.shiftTime / 60)}:${String(Math.floor(f.shiftTime % 60)).padStart(2, '0')} · ${f.shiftFares} fares · Rs ${f.shiftEarnings.toLocaleString('en-PK')}`);
      goals.push(`Stunt points ${w.stunts.shiftScore.toLocaleString('en-PK')} · best combo ${w.stunts.bestCombo.toLocaleString('en-PK')}`);
    } else {
      zone = ZONES[w.level.zoneIndex]?.name.split(/[/·]/)[0].trim() ?? 'Karachi';
      goals.push(`Reach Clifton · ${Math.round(w.level.progress * 100)}% of the way`);
      goals.push(`Checkpoint timer ${Math.ceil(w.level.timeLeft)} s · keep ${VEHICLE_SPECS[this.vehicle].label} above 0 HP`);
    }
    this.hud.showPause(true, zone, goals);
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.audio.setPaused(false);
    this.hud.showPause(false);
    this.lastTime = performance.now();
    this.input.consumeConfirm();
  }

  /** Back to the mode select screen with a fresh world. */
  private async quitToMenu(): Promise<void> {
    this.paused = false;
    this.dailyMode = false;
    this.audio.setPaused(false);
    this.hud.showPause(false);
    this.hud.showShiftOver(null);
    this.hud.hideEnd();
    this.endShownAt = this.endPendingAt = -1;
    if (!(await this.swapWorld(this.mode, false, this.vehicle))) return;
    this.syncMinimap();
    this.syncBestHud();
    this.hud.showStart(true);
    this.input.consumeConfirm();
    this.lastTime = performance.now();
  }

  private setCamera(far: boolean, save = true): void {
    this.farCamera = far;
    this.renderer.chase.zoom = far ? 1.3 : 1;
    this.hud.setCamera(far);
    if (save) storageSet('kt3d.cam', far ? 'far' : 'near');
  }

  private bindUi(): void {
    // Audio unlocks on the first real gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    for (const v of VEHICLES) {
      this.hud.rideBtns[v].addEventListener('click', () => void this.selectVehicle(v));
    }
    this.hud.rideBtn.addEventListener('click', () => this.cycleVehicle());
    this.hud.todBtn.addEventListener('click', () => this.cycleTimeOfDay());
    this.hud.autoGasBtn.addEventListener('click', () => this.setAutoGas(!this.autoGas));
    this.hud.startBtn.addEventListener('click', () => void this.chooseMode('route'));
    this.hud.cityBtn.addEventListener('click', () => void this.chooseMode('city'));
    this.hud.playBtn.addEventListener('click', () => this.input.queueConfirm());
    this.hud.dailyBtn.addEventListener('click', () => void this.launchDaily());
    this.hud.pauseBtn.addEventListener('click', () => this.pause());
    this.hud.resumeBtn.addEventListener('click', () => this.resume());
    this.hud.quitBtn.addEventListener('click', () => void this.quitToMenu());
    this.hud.pauseSoundBtn.addEventListener('click', () => this.setMuted(!this.audio.isMuted));
    this.hud.pauseRadioBtn.addEventListener('click', () => this.toggleRadio());
    this.hud.camBtn.addEventListener('click', () => this.setCamera(!this.farCamera));
    this.hud.pauseCamBtn.addEventListener('click', () => this.setCamera(!this.farCamera));
    this.hud.shiftBtn.addEventListener('click', () => this.input.queueConfirm());
    this.hud.restartBtn.addEventListener('click', () => this.input.queueConfirm());
    this.hud.muteBtn.addEventListener('click', () => this.setMuted(!this.audio.isMuted));
    this.hud.radioBtn.addEventListener('click', () => this.toggleRadio());
    this.hud.touchBtn.addEventListener('click', () => this.setTouchVisible(!this.touch.visible));
    this.hud.stickBtn.addEventListener('click', () => void this.cycleSteerMode());
    this.hud.pauseSteerBtn.addEventListener('click', () => void this.cycleSteerMode());
    this.hud.hapticsBtn.addEventListener('click', () => this.setHaptics(!this.haptics));
    this.touch.calBtn.addEventListener('click', () => {
      this.input.calibrateTilt();
      this.vibrate(15);
      this.toastNow('TILT RE-CENTERED');
    });
    // Prevent pinch-zoom / double-tap zoom on iOS Safari.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.haptics || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore before user gesture or unsupported runtime */
    }
  }

  private setHaptics(on: boolean, save = true): void {
    this.haptics = on;
    this.hud.setHaptics(on);
    if (save) storageSet('kt3d.haptics', on ? '1' : '0');
  }

  private setMuted(m: boolean): void {
    this.audio.setMuted(m);
    this.hud.setMuted(m);
    storageSet('kt3d.muted', m ? '1' : '0');
  }

  private setRadio(on: boolean, save = true): void {
    this.audio.setRadio(on);
    this.hud.setRadio(on);
    if (save) storageSet('kt3d.radio', on ? '1' : '0');
  }

  private toggleRadio(): void {
    const next = !this.audio.isRadioOn;
    this.setRadio(next);
    if (!this.hud.settingsOpen && !this.paused) {
      this.toastNow(next ? '📻 KARACHI DHOL FM · ON' : '📻 RADIO OFF', next);
    }
  }

  private setTouchVisible(v: boolean, save = true): void {
    this.touch.setVisible(v);
    this.hud.setTouchVisible(v);
    document.body.classList.toggle('touch-ui', v);
    this.input.setTiltEnabled(v && this.steerMode === 'tilt');
    if (save) storageSet('kt3d.touch', v ? '1' : '0');
  }

  private async cycleSteerMode(): Promise<void> {
    const next = STEER_MODES[(STEER_MODES.indexOf(this.steerMode) + 1) % STEER_MODES.length];
    if (next === 'tilt') {
      const perm = await this.input.requestTiltPermission();
      if (perm !== 'granted') {
        this.toastNow(perm === 'unsupported' ? 'TILT SENSOR NOT AVAILABLE' : 'MOTION PERMISSION DENIED', false);
        this.setSteerMode('buttons');
        return;
      }
      this.input.calibrateTilt();
      if (!this.hud.settingsOpen) this.toastNow('TILT TO STEER · TAP ZERO TILT TO CENTER');
    }
    this.setSteerMode(next);
  }

  private setSteerMode(mode: TouchSteerMode, save = true): void {
    this.steerMode = mode;
    this.touch.setMode(mode);
    this.hud.setSteerMode(mode);
    this.input.setTiltEnabled(this.touch.visible && mode === 'tilt');
    if (save) storageSet('kt3d.steer', mode);
  }

  private setAutoGas(on: boolean, save = true): void {
    this.autoGas = on;
    this.hud.setAutoGas(on);
    if (save) storageSet('kt3d.autogas', on ? '1' : '0');
  }

  start(): void {
    this.lastTime = performance.now();
    const frame = (now: number) => {
      this.frame(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private async restart(): Promise<void> {
    this.endShownAt = this.endPendingAt = -1;
    this.hud.hideEnd();
    this.hud.showShiftOver(null);
    if (!(await this.swapWorld(this.mode, this.dailyMode, this.vehicle))) return;
    this.syncMinimap();
    this.world.start();
    this.drainAndHandle();
    this.lastTime = performance.now();
    if (this.world.mode === 'route') this.pendingToast = { delay: 1.8, text: 'REACH CLIFTON · 4.2 KM', good: true };
  }

  private frame(now: number): void {
    const frameDt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clock += frameDt;

    const auto = this.autoGas && this.touch.visible && this.world.phase === 'running';
    const input = this.input.sample(frameDt, auto);
    if (this.input.consumeMute()) this.setMuted(!this.audio.isMuted);
    if (this.input.consumeRadio()) this.toggleRadio();
    const pausePressed = this.input.consumePause();
    // Esc / Start: back out of game options first, then toggle pause.
    if (pausePressed) {
      if (this.hud.settingsOpen) this.hud.closeSettings();
      else if (this.paused) this.resume();
      else this.pause();
    }
    if (this.paused) {
      // Frozen: keep drawing the scene behind the menu, nothing advances.
      this.input.consumeConfirm();
      this.renderer.render(this.world, this.accumulator / DT, 0);
      return;
    }
    if (this.switching) {
      this.renderer.render(this.world, this.accumulator / DT, 0);
      return;
    }
    if (this.pendingToast) {
      this.pendingToast.delay -= frameDt;
      if (this.pendingToast.delay <= 0) {
        const pt = this.pendingToast;
        this.pendingToast = null;
        this.hud.showToast(pt.text, pt.good);
      }
    }
    const confirm = this.input.consumeConfirm() && !this.hud.settingsOpen;
    const phase = this.world.phase;

    if (phase === 'ready' && confirm) {
      this.audio.unlock();
      this.hud.showStart(false);
      this.world.start();
      this.drainAndHandle();
      if (this.dailyMode) this.hud.showBanner(`DAILY · ${this.daily.label}`);
      if (this.world.mode === 'route') this.pendingToast = { delay: 1.8, text: 'REACH CLIFTON · 4.2 KM', good: true };
    } else if (phase === 'running' && confirm && this.world.mode === 'city' && !this.world.fares.onShift) {
      this.world.startShift();
    } else if ((phase === 'gameover' || phase === 'complete') && confirm && this.endShownAt >= 0 && this.clock - this.endShownAt > 0.6) {
      this.audio.unlock();
      void this.restart();
      return;
    }

    // Fixed-timestep simulation.
    if (document.visibilityState === 'visible') {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.world.step(input);
        this.accumulator -= DT;
        steps++;
        this.drainAndHandle();
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // spiral-of-death guard
    }

    if (this.endPendingAt >= 0 && this.clock >= this.endPendingAt) {
      this.endPendingAt = -1;
      this.endShownAt = this.clock;
      this.input.consumeConfirm(); // ignore presses made while driving
      const w = this.world;
      this.hud.showEnd(w.phase === 'complete', w.level.reason, w.level.stats, w.player.integrity, w.level.timeLeft, w.level.progress);
    }

    const alpha = this.accumulator / DT;
    this.renderer.render(this.world, alpha, frameDt);

    const p = this.world.player;
    this.updateTaxiHud(frameDt);
    // Boost meter: what's left while boosting, else drift charge or recharge.
    this.hud.setBoost(
      p.boostTime > 0 ? p.boostFraction : 1 - p.boostCooldown / MOVES.boostCooldown,
      p.boostTime > 0,
      p.handbrake,
      p.launchFraction,
      p.dashReady,
      Math.abs(p.speed) < 3,
      p.launchReady,
      Math.min(1, p.driftTime / 0.7),
    );
    this.hud.setSpeedRush(this.world.speedRush());
    this.touch.setPedalCues(p.launchReady, p.dashReady, auto);
    const nextDist =
      this.world.mode === 'route' && 'nextCheckpoint' in this.world.level
        ? Math.max(0, (this.world.level.nextCheckpoint < CHECKPOINTS.length ? CHECKPOINTS[this.world.level.nextCheckpoint].z : FINISH_Z) - p.z)
        : 0;
    this.hud.update(frameDt, p.speed * 3.6, p.integrity, this.world.level.timeLeft, this.world.level.progress, nextDist);

    const timerSecLeft =
      this.world.phase !== 'running'
        ? 99
        : this.world.mode === 'city'
          ? (this.world.fares.fare?.timeLeft ?? (this.world.fares.onShift ? this.world.fares.shiftTime : 99))
          : this.world.level.timeLeft;
    if (timerSecLeft > 0 && timerSecLeft <= 5) {
      const sec = Math.ceil(timerSecLeft);
      if (sec !== this.lastCountdownSec) {
        this.lastCountdownSec = sec;
        this.audio.timerTick(timerSecLeft <= 2.5);
      }
    } else {
      this.lastCountdownSec = -1;
    }

    let slip = p.travel - p.heading;
    slip = Math.abs(Math.atan2(Math.sin(slip), Math.cos(slip)));
    const screech = Math.max(
      p.braking && p.speed > 8 ? 0.35 + Math.min(0.5, (p.speed - 8) / 30) : 0,
      p.speed > 6 ? Math.max(0, slip - 0.06) * 4 : 0,
    );
    this.audio.update(
      {
        speed: p.speed,
        throttle: p.throttle,
        topSpeed: this.world.topSpeed(),
        horn: p.horn,
        screech,
        running: this.world.phase === 'running',
        vehicle: p.vehicle,
        monsoon: this.tod === 'monsoon',
        fever: this.world.mode === 'city' ? this.world.fares.chain : this.world.speedRush() * 2,
      },
      frameDt,
    );
    this.updateSpatialTrafficAudio(frameDt);
  }

  private panFromWorld(wx: number, wz: number): number {
    const p = this.world.player;
    const dx = wx - p.x;
    const dz = wz - p.z;
    const localRight = dx * Math.cos(p.heading) - dz * Math.sin(p.heading);
    return Math.max(-0.9, Math.min(0.9, localRight / 6));
  }

  private updateSpatialTrafficAudio(dt: number): void {
    this.whooshCooldown = Math.max(0, this.whooshCooldown - dt);
    this.npcHornCooldown = Math.max(0, this.npcHornCooldown - dt);
    if (this.world.phase !== 'running' || !this.audio.unlocked || this.audio.isMuted) return;

    const p = this.world.player;
    const sinH = Math.sin(p.heading);
    const cosH = Math.cos(p.heading);
    const pvx = p.speed * sinH;
    const pvz = p.speed * cosH;

    if (this.whooshCooldown <= 0 && Math.abs(p.speed) > 9) {
      let bestDist = 7.5;
      let bestPan = 0;
      let bestRel = 0;
      for (const n of this.world.npcs) {
        const dx = n.x - p.x;
        const dz = n.z - p.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 56.25) continue;
        const localFwd = dx * sinH + dz * cosH;
        const localRight = dx * cosH - dz * sinH;
        const absRight = Math.abs(localRight);
        if (Math.abs(localFwd) > 4.5 || absRight < 1.4 || absRight > 7.5) continue;
        const nvx = (n.x - n.prevX) / DT;
        const nvz = (n.z - n.prevZ) / DT;
        const relSpeed = Math.hypot(nvx - pvx, nvz - pvz);
        if (relSpeed > 11 && absRight < bestDist) {
          bestDist = absRight;
          bestPan = Math.max(-0.9, Math.min(0.9, localRight / 5.5));
          bestRel = relSpeed;
        }
      }
      if (bestRel > 0) {
        this.audio.passingRush(bestPan, Math.min(1, bestRel / 26));
        this.whooshCooldown = 0.45;
      }
    }

    if (this.npcHornCooldown <= 0 && (p.horn || Math.abs(p.speed) > 13)) {
      for (const n of this.world.npcs) {
        if (n.kind === 'cart') continue;
        const dx = n.x - p.x;
        const dz = n.z - p.z;
        const localFwd = dx * sinH + dz * cosH;
        const localRight = dx * cosH - dz * sinH;
        if (localFwd < 1 || localFwd > 20 || Math.abs(localRight) > 5.5) continue;
        const opposing = Math.cos(n.heading - p.heading) < -0.35;
        if (p.horn || (opposing && localFwd < 14)) {
          const pan = Math.max(-0.85, Math.min(0.85, localRight / 5.5));
          this.audio.npcHorn(pan, 0.9 + ((n.id % 5) - 2) * 0.06);
          this.npcHornCooldown = 2.6;
          break;
        }
      }
    }
  }

  private updateTaxiHud(dt: number): void {
    const w = this.world;
    if (w.mode !== 'city') return;
    const f = w.fares;
    const prevPos = Math.max(0, this.lastTrackedMoney);
    const curPos = Math.max(0, f.money);
    if (curPos > prevPos) this.addBank(curPos - prevPos);
    this.lastTrackedMoney = f.money;
    const p = w.player;
    const px = p.prevX + (p.x - p.prevX) * (this.accumulator / DT);
    const pz = p.prevZ + (p.z - p.prevZ) * (this.accumulator / DT);
    this.hud.setMoney(f.money);
    const st = w.stunts;
    this.hud.setScore(st.score);
    this.hud.setCombo(st.mult, st.pending * st.mult, st.window / COMBO_WINDOW);
    const running = w.phase === 'running';
    if (running && f.fare) {
      const pl = f.places[f.fare.dest];
      this.hud.setFare({
        name: pl.name,
        distance: f.navDist,
        timeLeft: f.fare.timeLeft,
        limit: f.fare.limit,
        kind: f.fare.kind,
        stop: f.fare.totalStops - f.fare.stopsLeft + 1,
        stops: f.fare.totalStops,
        chain: f.chain,
      });
    } else if (running && f.onShift) this.hud.setFare({ hint: 'Find a passenger · stop beside them' });
    else this.hud.setFare(null);
    if (running && f.navDist > 0) {
      const bearing = Math.atan2(f.navX - px, f.navZ - pz) - p.heading;
      const urgency = f.fare && f.navDist < 45 ? 'hot' : f.fare && f.navDist < 130 ? 'warn' : 'ok';
      this.hud.setArrow(Math.atan2(Math.sin(bearing), Math.cos(bearing)), urgency);
    } else this.hud.setArrow(null);
    this.mapTimer -= dt;
    if (this.minimap && this.mapTimer <= 0) {
      this.mapTimer = 1 / 30;
      this.minimap.draw(px, pz, p.heading, f);
    }
  }

  private drainAndHandle(): void {
    for (const e of this.world.drainEvents()) this.handle(e);
  }

  private handle(e: SimEvent): void {
    this.renderer.handleEvent(e, this.world);
    switch (e.type) {
      case 'zone':
        this.hud.showBanner(e.banner);
        break;
      case 'checkpoint':
        this.toastNow(`+${e.bonus}s · +15% HP · ${e.label}`);
        this.audio.chime();
        this.vibrate([20, 35, 30]);
        break;
      case 'shiftStart':
        this.hud.showShiftOver(null);
        if (!this.hadFirstShift) {
          this.hadFirstShift = true;
          this.pendingToast = { delay: 1.8, text: `FIND A PASSENGER · ${e.time}s SHIFT`, good: true };
        } else {
          this.toastNow(`ON DUTY · ${e.time}s SHIFT`);
        }
        break;
      case 'shiftOver':
        if (this.world.mode === 'city') {
          const st = this.world.stunts;
          const rank = this.world.fares.shiftRank(st.shiftScore);
          const cityKey = `kt3d.best.city.${this.vehicle}`;
          const prev = parseCityBest(storageGet(cityKey));
          const isNewBest = e.earned > 0 && e.earned > prev.earned;
          const bestEarned = Math.max(prev.earned, e.earned);
          if (isNewBest) storageSet(cityKey, `${e.earned}|${rank}`);
          if (this.dailyMode) {
            const dKey = `kt3d.daily.${this.daily.key}`;
            const prevD = parseCityBest(storageGet(dKey));
            if (e.earned > prevD.earned) storageSet(dKey, `${e.earned}|${rank}`);
          }
          this.syncBestHud();
          this.hud.showShiftOver({
            earned: e.earned,
            fares: e.fares,
            total: this.world.fares.money,
            score: st.shiftScore,
            best: st.bestCombo,
            rank,
            bestEarned,
            isNewBest,
            bestChain: this.world.fares.bestChain,
          });
          if (rank === 'S' || rank === 'A') this.audio.fanfare(2);
          else this.audio.chime();
        } else {
          this.audio.chime();
        }
        break;
      case 'pickup': {
        const prefix = e.kind === 'vip' ? '★ VIP · ' : e.kind === 'party' ? `★ PARTY (${e.stops ?? 2} STOPS) · ` : '➜ ';
        this.hud.showBanner(`${prefix}${e.name.toUpperCase()}`);
        const tag = e.kind === 'vip' ? '2× PAY · ' : e.kind === 'party' ? `${e.stops ?? 2} STOPS · ` : '';
        this.toastNow(`${tag}${e.time}s to get there`);
        if (e.kind === 'vip' || e.kind === 'party') this.audio.fanfare(1);
        else this.audio.chime();
        this.vibrate(25);
        break;
      }
      case 'dropoff': {
        if (e.nextStop) {
          this.hud.showBanner(`STOP 1 DONE! ➜ ${e.nextStop.toUpperCase()}`);
          this.toastNow(`+Rs ${e.pay} · +${e.bonus}s · NEXT STOP!`);
          this.audio.chime();
          this.vibrate([20, 35, 25]);
          break;
        }
        const stars = e.rating === 2 ? '★★★ ' : e.rating === 1 ? '★★ ' : '★ ';
        const fever = e.chain && e.chain >= 2 ? `FEVER ×${(1 + Math.min(4, e.chain - 1) * 0.25).toFixed(2).replace(/\.?0+$/, '')} · ` : '';
        this.hud.showBanner(e.rating === 2 ? 'BOHAT TEZ! SHABASH!' : e.rating === 1 ? 'SHUKRIYA!' : 'THODA LATE...');
        this.toastNow(`${stars}${fever}+Rs ${e.pay}${e.tip ? ` + Rs ${e.tip} tip` : ''} · +${e.bonus}s`);
        if (e.chain && e.chain >= 2) this.audio.fanfare(1);
        else this.audio.chime();
        this.vibrate([25, 40, 45]);
        break;
      }
      case 'fareFailed':
        if (e.reason !== 'shift') this.toastNow(e.reason === 'time' ? 'TOO SLOW! Passenger got out' : 'Fare lost', false);
        break;
      case 'towed':
        this.hud.showBanner('TOWED TO THE MECHANIC');
        this.toastNow(e.cost > 0 ? `Repairs −Rs ${e.cost} · −10s` : 'Towed to kerb · −10s', false);
        this.vibrate([60, 50, 90]);
        this.renderer.chase.reset();
        break;
      case 'boost':
        this.audio.whoosh();
        this.vibrate(e.kind === 'launch' ? [35, 30, 55] : [25, 25, 40]);
        this.toastNow(e.kind === 'drift' ? 'DRIFT BOOST!' : e.kind === 'launch' ? 'LAUNCH!' : 'DASH!');
        break;
      case 'drift':
        this.toastNow(`DRIFT ${e.seconds.toFixed(1)}s`);
        break;
      case 'land':
        this.audio.pothole(Math.min(1, e.impact / 10));
        if (e.air > 0.35 || e.impact > 4) this.vibrate(Math.round(Math.min(55, 16 + e.impact * 3)));
        if (e.air > 0.5) this.toastNow(`AIR ${e.air.toFixed(1)}s!`);
        break;
      case 'smash':
        this.audio.smash(e.kind, e.impact / 15, this.panFromWorld(e.x, e.z));
        this.vibrate(18);
        break;
      case 'stunt':
        this.hud.showStunt(e.label, e.points);
        this.audio.stunt(e.mult);
        break;
      case 'comboEnd':
        if (e.mult > 1 || e.total >= 200) {
          this.toastNow(`COMBO ×${e.mult} · +${e.total.toLocaleString('en-PK')}${e.tip ? ` · passenger tip Rs ${e.tip}` : ''}`);
          this.audio.chime();
        }
        break;
      case 'comboBroken':
        if (e.lost >= 100) this.toastNow(`COMBO LOST · −${e.lost.toLocaleString('en-PK')}`, false);
        break;
      case 'honk':
        this.toastNow('RAASTA DO! 📯');
        break;
      case 'street':
        this.hud.showBanner(e.name.toUpperCase());
        break;
      case 'pinned':
        this.toastNow(this.input.lastSource === 'touch' ? 'STUCK? Hold BRAKE to back up' : this.input.lastSource === 'gamepad' ? 'STUCK? Hold LT to back up' : 'STUCK? Hold S / ↓ to back up', false);
        break;
      case 'kerb':
        this.audio.pothole(e.severity * 0.4);
        if (e.severity > 0.25) this.vibrate(12);
        break;
      case 'pothole':
        this.audio.pothole(e.severity);
        this.vibrate(Math.round(18 + e.severity * 25));
        if (e.damage > 0) {
          this.toastNow(`POTHOLE −${e.damage} HP`, false);
          this.hud.damageFlash(0.1);
        }
        break;
      case 'manhole':
        this.audio.manhole();
        this.vibrate([45, 35, 65]);
        this.toastNow(`OPEN MANHOLE! −${e.damage} HP`, false);
        this.hud.damageFlash(0.4);
        break;
      case 'crash':
        this.audio.crash(e.impact / 15, this.panFromWorld(e.x, e.z));
        if (e.impact > 3) this.vibrate(Math.round(Math.min(110, 22 + e.impact * 5)));
        if (e.damage >= 5) this.toastNow(`CRASH −${Math.round(e.damage)} HP`, false);
        if (e.damage >= 1) this.hud.damageFlash(Math.min(0.5, e.damage / 40));
        break;
      case 'scrape':
        this.audio.scrape(e.intensity);
        break;
      case 'splash':
        this.audio.splash();
        this.toastNow('HYDROPLANING!', false);
        break;
      case 'gameover':
      case 'complete': {
        this.endPendingAt = this.clock + (e.type === 'complete' ? 1.5 : 1.2);
        this.vibrate(e.type === 'complete' ? [40, 50, 40, 50, 80] : [90, 60, 120]);
        const rKey = `kt3d.best.route.${this.vehicle}`;
        const prev = storageGet(rKey) ?? '';
        if (e.type === 'complete') {
          const left = +this.world.level.timeLeft.toFixed(1);
          const prevWin = prev.startsWith('win:') ? Number(prev.slice(4)) || 0 : 0;
          if (left > prevWin) storageSet(rKey, `win:${left.toFixed(1)}`);
          this.addBank(300);
          this.toastNow('CLIFTON REACHED! +RS 300 BANKED');
          this.audio.fanfare(2);
        } else if (!prev.startsWith('win:')) {
          const pct = Math.round(this.world.level.progress * 100);
          const prevPct = prev.startsWith('prog:') ? Number(prev.slice(5)) || 0 : 0;
          if (pct > prevPct) storageSet(rKey, `prog:${pct}`);
        }
        this.syncBestHud();
        break;
      }
    }
  }
}
