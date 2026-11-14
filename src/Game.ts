import { SoundEngine } from './audio/SoundEngine';
import { InputManager } from './input/InputManager';
import { Renderer } from './render/Renderer';
import type { AnyWorld } from './render/Renderer';
import { CityWorld } from './sim/city/CityWorld';
import type { SimEvent } from './sim/types';
import { DT, World } from './sim/World';
import { Hud } from './ui/Hud';
import { TouchControls } from './ui/TouchControls';

const MAX_STEPS_PER_FRAME = 5;

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
  private readonly input = new InputManager();
  private readonly audio = new SoundEngine();
  private readonly hud: Hud;
  private readonly touch: TouchControls;
  private accumulator = 0;
  private lastTime = 0;
  private endShownAt = -1;
  private endPendingAt = -1;
  private clock = 0;

  private constructor(
    private readonly renderer: Renderer,
    private readonly seed: number,
    private readonly startZ: number,
    mode: Mode,
    uiRoot: HTMLElement,
  ) {
    this.mode = mode;
    this.world = this.makeWorld();
    renderer.attach(this.world);

    this.hud = new Hud(uiRoot);
    this.hud.setMode(mode);
    this.touch = new TouchControls(this.hud.root, this.input.touch);

    // Touch HUD: auto-detect, remember manual choice.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const savedTouch = storageGet('kt3d.touch');
    this.setTouchVisible(savedTouch === null ? coarse : savedTouch === '1', false);
    if (storageGet('kt3d.stick') === '1') this.setStickMode(true, false);
    this.setMuted(storageGet('kt3d.muted') === '1');

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
    return this.mode === 'city' ? new CityWorld(this.seed) : new World(this.seed, this.startZ);
  }

  /** Start-screen choice: rebuild the world if the mode changed, then go. */
  private chooseMode(mode: Mode): void {
    if (this.world.phase !== 'ready') return;
    if (mode !== this.mode) {
      this.mode = mode;
      this.world = this.makeWorld();
      this.renderer.attach(this.world);
      this.hud.setMode(mode);
      storageSet('kt3d.mode', mode);
    }
    this.input.queueConfirm();
  }

  private bindUi(): void {
    // Audio unlocks on the first real gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    this.hud.startBtn.addEventListener('click', () => this.chooseMode('route'));
    this.hud.cityBtn.addEventListener('click', () => this.chooseMode('city'));
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
    this.world.start();
    this.drainAndHandle();
  }

  private frame(now: number): void {
    const frameDt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clock += frameDt;

    const input = this.input.sample(frameDt);
    if (this.input.consumeMute()) this.setMuted(!this.audio.isMuted);
    const confirm = this.input.consumeConfirm();
    const phase = this.world.phase;

    if (phase === 'ready' && confirm) {
      this.audio.unlock();
      this.hud.showStart(false);
      this.world.start();
      this.drainAndHandle();
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
    this.hud.update(frameDt, p.speed * 3.6, p.integrity, this.world.level.timeLeft, this.world.level.progress);

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
      },
      frameDt,
    );
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
      case 'street':
        this.hud.showBanner(e.name.toUpperCase());
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
        if (e.type === 'complete') this.audio.chime();
        break;
    }
  }
}
