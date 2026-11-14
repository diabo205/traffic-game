import type { InputFrame } from '../sim/types';

/**
 * Merges keyboard, touch and gamepad into a single InputFrame per tick.
 *   throttle / brake : max across sources
 *   steer            : sum across sources, clamped to -1..1
 *   horn / dipper    : OR across sources
 */

/** Raw state written by the touch HUD (src/ui/TouchControls.ts). */
export class TouchInputState {
  left = false;
  right = false;
  /** analog joystick steer, -1..1 (0 when unused) */
  joystick = 0;
  gas = false;
  brake = false;
  /** handbrake drift button: gas + brake together */
  drift = false;
  horn = false;
  dipper = false;

  clear(): void {
    this.left = this.right = this.gas = this.brake = this.horn = this.dipper = this.drift = false;
    this.joystick = 0;
  }
}

const DEAD_ZONE = 0.12;

function deadZone(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  return (Math.sign(v) * (a - DEAD_ZONE)) / (1 - DEAD_ZONE);
}

export type InputSource = 'keyboard' | 'touch' | 'gamepad';

export class InputManager {
  readonly touch = new TouchInputState();
  private keys = new Set<string>();
  /** Smoothed digital steering for keyboard / touch buttons. */
  private digitalSteer = 0;
  private confirmQueued = false;
  private prevPadConfirm = false;
  private prevPadMute = false;
  private muteQueued = false;
  private pauseQueued = false;
  private prevPadPause = false;
  lastSource: InputSource = 'keyboard';
  gamepadConnected = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.lastSource = 'keyboard';
      if (e.code === 'Enter' || e.code === 'NumpadEnter') this.confirmQueued = true;
      if (e.code === 'KeyM') this.muteQueued = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.pauseQueued = true;
      if (this.isGameKey(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.touch.clear();
    });
    target.addEventListener('gamepadconnected', () => (this.gamepadConnected = true));
    target.addEventListener('gamepaddisconnected', () => (this.gamepadConnected = this.findPad() !== null));
  }

  private isGameKey(code: string): boolean {
    return /^(Arrow|Space)/.test(code) || code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' || code === 'KeyE';
  }

  /** Enter / gamepad A or Start: start or restart. */
  consumeConfirm(): boolean {
    const c = this.confirmQueued;
    this.confirmQueued = false;
    return c;
  }

  /** Esc / P / gamepad Start: pause or resume. */
  consumePause(): boolean {
    const p = this.pauseQueued;
    this.pauseQueued = false;
    return p;
  }

  queueConfirm(): void {
    this.confirmQueued = true;
  }

  consumeMute(): boolean {
    const m = this.muteQueued;
    this.muteQueued = false;
    return m;
  }

  private findPad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Sample all sources. Call once per rendered frame. */
  sample(dt: number, autoGas = false): InputFrame {
    const k = this.keys;
    const t = this.touch;

    // Keyboard.
    // E = handbrake drift: presses gas and brake together (the sim's drift combo).
    const kDrift = k.has('KeyE');
    const kThrottle = k.has('KeyW') || k.has('ArrowUp') || kDrift ? 1 : 0;
    const kBrake = k.has('KeyS') || k.has('ArrowDown') || kDrift ? 1 : 0;
    const kLeft = k.has('KeyA') || k.has('ArrowLeft');
    const kRight = k.has('KeyD') || k.has('ArrowRight');
    const kHorn = k.has('Space');
    const kDipper = k.has('KeyF') || k.has('ShiftLeft') || k.has('ShiftRight');

    // Digital steering (keys + touch buttons) ramps for smoothness.
    const dTarget = (kRight || t.right ? 1 : 0) - (kLeft || t.left ? 1 : 0);
    const rate = dTarget === 0 ? 7 : Math.sign(dTarget) !== Math.sign(this.digitalSteer) ? 9 : 4.5;
    const diff = dTarget - this.digitalSteer;
    this.digitalSteer += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);

    // Gamepad (standard mapping).
    let gThrottle = 0, gBrake = 0, gSteer = 0, gHorn = false, gDipper = false;
    const pad = this.findPad();
    this.gamepadConnected = pad !== null;
    if (pad) {
      const b = (i: number) => pad.buttons[i];
      gThrottle = deadZone(b(7)?.value ?? 0);
      gBrake = deadZone(b(6)?.value ?? 0);
      // East / B = handbrake drift (gas + brake together).
      if (b(1)?.pressed) {
        gThrottle = 1;
        gBrake = 1;
      }
      gSteer = deadZone(pad.axes[0] ?? 0);
      // D-pad as a fallback steer.
      if (b(14)?.pressed) gSteer -= 1;
      if (b(15)?.pressed) gSteer += 1;
      gHorn = !!b(0)?.pressed;
      gDipper = !!b(2)?.pressed;
      if (gThrottle || gBrake || gSteer || gHorn || gDipper) this.lastSource = 'gamepad';
      // Start pauses during play (and confirms on menus); A confirms.
      const startBtn = !!b(9)?.pressed;
      if (startBtn && !this.prevPadPause) this.pauseQueued = true;
      this.prevPadPause = startBtn;
      const confirm = !!(b(9)?.pressed || b(0)?.pressed);
      if (confirm && !this.prevPadConfirm) this.confirmQueued = true;
      this.prevPadConfirm = confirm;
      const mute = !!b(8)?.pressed;
      if (mute && !this.prevPadMute) this.muteQueued = true;
      this.prevPadMute = mute;
    }

    if (t.gas || t.brake || t.drift || t.left || t.right || t.joystick || t.horn || t.dipper) this.lastSource = 'touch';

    const brake = Math.max(kBrake, t.brake || t.drift ? 1 : 0, gBrake);
    const cruise = autoGas && brake < 0.05 ? 1 : 0;
    const steer = Math.max(-1, Math.min(1, this.digitalSteer + t.joystick + gSteer));
    return {
      throttle: Math.max(kThrottle, t.gas || t.drift ? 1 : 0, gThrottle, cruise),
      brake,
      steer,
      horn: kHorn || t.horn || gHorn,
      dipper: kDipper || t.dipper || gDipper,
    };
  }
}
