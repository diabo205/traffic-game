import { SoundEngine } from './audio/SoundEngine';
import { InputManager } from './input/InputManager';
import { Renderer } from './render/Renderer';
import type { AnyWorld, TimeOfDay } from './render/Renderer';
import { CityWorld } from './sim/city/CityWorld';
import { COMBO_WINDOW } from './sim/city/Stunts';
import { MOVES, VEHICLE_COST, VEHICLE_SPECS } from './sim/PlayerCar';
import { ZONES } from './sim/road';
import type { PlayerVehicle, SimEvent } from './sim/types';
import { DT, World } from './sim/World';
import { Hud } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';

const MAX_STEPS_PER_FRAME = 5;
const VEHICLES: readonly PlayerVehicle[] = ['alto', 'rickshaw', 'minibus'];
const TIMES_OF_DAY: readonly TimeOfDay[] = ['noon', 'sunset', 'night'];

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

  private constructor(
    private readonly renderer: Renderer,
    private readonly seed: number,
    private readonly startZ: number,
    mode: Mode,
    uiRoot: HTMLElement,
  ) {
    this.mode = mode;
    this.bank = Math.max(0, Math.floor(Number(storageGet('kt3d.bank') ?? '0') || 0));
    const savedVeh = storageGet('kt3d.veh');
    if (savedVeh === 'alto' || savedVeh === 'rickshaw' || savedVeh === 'minibus') {
      if (this.bank >= VEHICLE_COST[savedVeh]) this.vehicle = savedVeh;
    }
    const savedTod = storageGet('kt3d.tod');
    if (savedTod === 'noon' || savedTod === 'sunset' || savedTod === 'night') this.tod = savedTod;

    this.world = this.makeWorld();
    renderer.setTimeOfDay(this.tod);
    renderer.attach(this.world);

    this.hud = new Hud(uiRoot);
    this.hud.setMode(mode);
    this.hud.setVehicle(this.vehicle, this.bank);
    this.hud.setTimeOfDay(this.tod);
    this.syncMinimap();
    this.touch = new TouchControls(this.hud.root, this.input.touch);

    // Touch HUD: auto-detect, remember manual choice.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const savedTouch = storageGet('kt3d.touch');
    this.setTouchVisible(savedTouch === null ? coarse : savedTouch === '1', false);
    if (storageGet('kt3d.stick') === '1') this.setStickMode(true, false);
    this.setAutoGas(storageGet('kt3d.autogas') === '1', false);
    this.setMuted(storageGet('kt3d.muted') === '1');
    this.setCamera(storageGet('kt3d.cam') === 'far', false);

    this.bindUi();
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 200));
  }

  static async create(container: HTMLElement, uiRoot: HTMLElement): Promise<Game> {
    const params = new URLSearchParams(window.location.search);
    const seed = Number(params.get('seed') ?? '1337') >>> 0 || 1337;
    const lowSpec = params.has('low') || (window.matchMedia('(pointer: coarse)').matches && !params.has('high'));
    // Debug: ?z=1500 starts further along the route.
    const startZ = Math.max(0, Math.min(4200, Number(params.get('z') ?? '0') || 0));
    // ?mode=route|city, else ?z implies the route, else the last mode played.
    const asked = params.get('mode');
    const saved = storageGet('kt3d.mode');
    const mode: Mode = asked === 'route' || asked === 'city' ? asked : params.has('z') ? 'route' : saved === 'route' ? 'route' : 'city';
    const renderer = await Renderer.create(container, lowSpec);
    return new Game(renderer, seed, startZ, mode, uiRoot);
  }

  private makeWorld(): AnyWorld {
    this.lastTrackedMoney = 0;
    this.lastCountdownSec = -1;
    return this.mode === 'city' ? new CityWorld(this.seed, this.vehicle) : new World(this.seed, this.startZ, this.vehicle);
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

  private selectVehicle(v: PlayerVehicle, save = true): void {
    const cost = VEHICLE_COST[v];
    if (this.bank < cost) {
      this.hud.showToast(`NEED RS ${cost.toLocaleString('en-PK')} TOTAL IN BANK`, false);
      return;
    }
    if (v === this.vehicle) return;
    this.vehicle = v;
    if (save) storageSet('kt3d.veh', v);
    this.hud.setVehicle(v, this.bank);
    if (this.world.phase === 'ready') {
      this.world = this.makeWorld();
      this.renderer.attach(this.world);
      this.syncMinimap();
    } else {
      this.hud.showToast(`${VEHICLE_SPECS[v].label} READY NEXT RUN`);
    }
  }

  private cycleVehicle(): void {
    const unlocked = VEHICLES.filter((v) => this.bank >= VEHICLE_COST[v]);
    if (unlocked.length <= 1) {
      const next = VEHICLES.find((v) => this.bank < VEHICLE_COST[v]);
      if (next) this.hud.showToast(`EARN RS ${VEHICLE_COST[next].toLocaleString('en-PK')} TO UNLOCK ${VEHICLE_SPECS[next].label}`, false);
      return;
    }
    const idx = unlocked.indexOf(this.vehicle);
    this.selectVehicle(unlocked[(idx + 1) % unlocked.length]);
  }

  private cycleTimeOfDay(): void {
    const next = TIMES_OF_DAY[(TIMES_OF_DAY.indexOf(this.tod) + 1) % TIMES_OF_DAY.length];
    this.tod = next;
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
  private chooseMode(mode: Mode): void {
    if (this.world.phase !== 'ready') return;
    if (mode !== this.mode) {
      this.mode = mode;
      this.world = this.makeWorld();
      this.renderer.attach(this.world);
      this.hud.setMode(mode);
      this.syncMinimap();
      storageSet('kt3d.mode', mode);
    }
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
      zone = 'Saddar';
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
  private quitToMenu(): void {
    this.paused = false;
    this.audio.setPaused(false);
    this.hud.showPause(false);
    this.hud.showShiftOver(null);
    this.hud.hideEnd();
    this.endShownAt = this.endPendingAt = -1;
    this.world = this.makeWorld();
    this.renderer.attach(this.world);
    this.accumulator = 0;
    this.hud.showStart(true);
    this.input.consumeConfirm();
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
      this.hud.rideBtns[v].addEventListener('click', () => this.selectVehicle(v));
    }
    this.hud.rideBtn.addEventListener('click', () => this.cycleVehicle());
    this.hud.todBtn.addEventListener('click', () => this.cycleTimeOfDay());
    this.hud.autoGasBtn.addEventListener('click', () => this.setAutoGas(!this.autoGas));
    this.hud.startBtn.addEventListener('click', () => this.chooseMode('route'));
    this.hud.cityBtn.addEventListener('click', () => this.chooseMode('city'));
    this.hud.playBtn.addEventListener('click', () => this.input.queueConfirm());
    this.hud.pauseBtn.addEventListener('click', () => this.pause());
    this.hud.resumeBtn.addEventListener('click', () => this.resume());
    this.hud.quitBtn.addEventListener('click', () => this.quitToMenu());
    this.hud.pauseSoundBtn.addEventListener('click', () => this.setMuted(!this.audio.isMuted));
    this.hud.camBtn.addEventListener('click', () => this.setCamera(!this.farCamera));
    this.hud.pauseCamBtn.addEventListener('click', () => this.setCamera(!this.farCamera));
    this.hud.shiftBtn.addEventListener('click', () => this.input.queueConfirm());
    this.hud.restartBtn.addEventListener('click', () => this.input.queueConfirm());
    this.hud.muteBtn.addEventListener('click', () => this.setMuted(!this.audio.isMuted));
    this.hud.touchBtn.addEventListener('click', () => this.setTouchVisible(!this.touch.visible));
    this.hud.stickBtn.addEventListener('click', () => this.setStickMode(this.touch.currentMode !== 'joystick'));
    // Prevent pinch-zoom / double-tap zoom on iOS Safari.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private setMuted(m: boolean): void {
    this.audio.setMuted(m);
    this.hud.setMuted(m);
    storageSet('kt3d.muted', m ? '1' : '0');
  }

  private setTouchVisible(v: boolean, save = true): void {
    this.touch.setVisible(v);
    this.hud.setTouchVisible(v);
    if (save) storageSet('kt3d.touch', v ? '1' : '0');
  }

  private setStickMode(joystick: boolean, save = true): void {
    this.touch.setMode(joystick ? 'joystick' : 'buttons');
    this.hud.setStickMode(joystick);
    if (save) storageSet('kt3d.stick', joystick ? '1' : '0');
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

  private restart(): void {
    this.world = this.makeWorld();
    this.renderer.attach(this.world);
    this.accumulator = 0;
    this.endShownAt = this.endPendingAt = -1;
    this.hud.hideEnd();
    this.hud.showShiftOver(null);
    this.world.start();
    if (this.world.mode === 'route') this.hud.showToast('REACH CLIFTON · 4.2 KM');
    this.drainAndHandle();
  }

  private frame(now: number): void {
    const frameDt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clock += frameDt;

    const auto = this.autoGas && this.touch.visible && this.world.phase === 'running';
    const input = this.input.sample(frameDt, auto);
    if (this.input.consumeMute()) this.setMuted(!this.audio.isMuted);
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
    const confirm = this.input.consumeConfirm() && !this.hud.settingsOpen;
    const phase = this.world.phase;

    if (phase === 'ready' && confirm) {
      this.audio.unlock();
      this.hud.showStart(false);
      this.world.start();
      if (this.world.mode === 'route') this.hud.showToast('REACH CLIFTON · 4.2 KM');
      this.drainAndHandle();
    } else if (phase === 'running' && confirm && this.world.mode === 'city' && !this.world.fares.onShift) {
      this.world.startShift();
    } else if ((phase === 'gameover' || phase === 'complete') && confirm && this.endShownAt >= 0 && this.clock - this.endShownAt > 0.6) {
      this.audio.unlock();
      this.restart();
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
    // Boost meter: what's left while boosting, else how far it has recharged.
    this.hud.setBoost(
      p.boostTime > 0 ? p.boostTime / 0.9 : 1 - p.boostCooldown / MOVES.boostCooldown,
      p.boostTime > 0,
      p.handbrake,
      p.launchFraction,
      p.dashReady,
    );
    this.hud.setSpeedRush(this.world.speedRush());
    this.touch.setPedalCues(p.launchReady, p.dashReady, auto);
    this.hud.update(frameDt, p.speed * 3.6, p.integrity, this.world.level.timeLeft, this.world.level.progress);

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
      },
      frameDt,
    );
  }

  private updateTaxiHud(dt: number): void {
    const w = this.world;
    if (w.mode !== 'city') return;
    const f = w.fares;
    if (f.money > this.lastTrackedMoney) this.addBank(f.money - this.lastTrackedMoney);
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
      this.hud.setFare({ name: pl.name, distance: f.navDist, timeLeft: f.fare.timeLeft, limit: f.fare.limit });
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
        this.hud.showToast(`+${e.bonus}s · ${e.label}`);
        this.audio.chime();
        break;
      case 'shiftStart':
        this.hud.showShiftOver(null);
        this.hud.showToast(`ON DUTY · ${e.time}s shift`);
        break;
      case 'shiftOver':
        if (this.world.mode === 'city') {
          const st = this.world.stunts;
          this.hud.showShiftOver({ earned: e.earned, fares: e.fares, total: this.world.fares.money, score: st.shiftScore, best: st.bestCombo });
        }
        this.audio.chime();
        break;
      case 'pickup':
        this.hud.showBanner(`➜ ${e.name.toUpperCase()}`);
        this.hud.showToast(`${e.time}s to get there`);
        this.audio.chime();
        break;
      case 'dropoff': {
        const stars = e.rating === 2 ? '★★★ ' : e.rating === 1 ? '★★ ' : '★ ';
        this.hud.showBanner(e.rating === 2 ? 'BOHAT TEZ! SHABASH!' : e.rating === 1 ? 'SHUKRIYA!' : 'THODA LATE...');
        this.hud.showToast(`${stars}+Rs ${e.pay}${e.tip ? ` + Rs ${e.tip} tip` : ''} · +${e.bonus}s`);
        this.audio.chime();
        break;
      }
      case 'fareFailed':
        if (e.reason !== 'shift') this.hud.showToast(e.reason === 'time' ? 'TOO SLOW! Passenger got out' : 'Fare lost', false);
        break;
      case 'towed':
        this.hud.showBanner('TOWED TO THE MECHANIC');
        this.hud.showToast(`Repairs −Rs ${e.cost} · −10s`, false);
        this.renderer.chase.reset();
        break;
      case 'boost':
        this.audio.whoosh();
        this.hud.showToast(e.kind === 'drift' ? 'DRIFT BOOST!' : e.kind === 'launch' ? 'LAUNCH!' : 'DASH!');
        break;
      case 'drift':
        this.hud.showToast(`DRIFT ${e.seconds.toFixed(1)}s`);
        break;
      case 'land':
        this.audio.pothole(Math.min(1, e.impact / 10));
        if (e.air > 0.5) this.hud.showToast(`AIR ${e.air.toFixed(1)}s!`);
        break;
      case 'smash':
        this.audio.smash(e.kind, e.impact / 15);
        break;
      case 'stunt':
        this.hud.showStunt(e.label, e.points);
        this.audio.stunt(e.mult);
        break;
      case 'comboEnd':
        if (e.mult > 1 || e.total >= 200) {
          this.hud.showToast(`COMBO ×${e.mult} · +${e.total.toLocaleString('en-PK')}${e.tip ? ` · passenger tip Rs ${e.tip}` : ''}`);
          this.audio.chime();
        }
        break;
      case 'comboBroken':
        this.hud.showToast(`COMBO LOST · −${e.lost.toLocaleString('en-PK')}`, false);
        break;
      case 'honk':
        this.hud.showToast('RAASTA DO! 📯');
        break;
      case 'street':
        this.hud.showBanner(e.name.toUpperCase());
        break;
      case 'pinned':
        this.hud.showToast(this.input.lastSource === 'touch' ? 'STUCK? Hold BRAKE to back up' : this.input.lastSource === 'gamepad' ? 'STUCK? Hold LT to back up' : 'STUCK? Hold S / ↓ to back up', false);
        break;
      case 'kerb':
        this.audio.pothole(e.severity * 0.4);
        break;
      case 'pothole':
        this.audio.pothole(e.severity);
        if (e.damage > 0) {
          this.hud.showToast(`POTHOLE −${e.damage} HP`, false);
          this.hud.damageFlash(0.1);
        }
        break;
      case 'manhole':
        this.audio.manhole();
        this.hud.showToast(`OPEN MANHOLE! −${e.damage} HP`, false);
        this.hud.damageFlash(0.4);
        break;
      case 'crash':
        this.audio.crash(e.impact / 15);
        if (e.damage >= 1) this.hud.damageFlash(Math.min(0.5, e.damage / 40));
        break;
      case 'scrape':
        this.audio.scrape(e.intensity);
        break;
      case 'splash':
        this.audio.splash();
        this.hud.showToast('HYDROPLANING!', false);
        break;
      case 'gameover':
      case 'complete':
        this.endPendingAt = this.clock + (e.type === 'complete' ? 1.5 : 1.2);
        if (e.type === 'complete') {
          this.addBank(300);
          this.hud.showToast('CLIFTON REACHED! +RS 300 BANKED');
          this.audio.chime();
        }
        break;
    }
  }
}
