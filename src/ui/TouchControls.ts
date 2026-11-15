import type { TouchInputState, TouchSteerMode } from '../input/InputManager';

/**
 * On-screen controls for touch devices. Pure DOM; writes into TouchInputState.
 * Bottom-left: steering buttons, a virtual joystick, or tilt re-center pill.
 * Bottom-right: gas / brake pedals + horn / dipper.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  readonly calBtn: HTMLButtonElement;
  private buttonsPad: HTMLDivElement;
  private stickPad: HTMLDivElement;
  private knob: HTMLDivElement;
  private gasBtn: HTMLButtonElement;
  private mode: TouchSteerMode = 'buttons';
  private stickPointer: number | null = null;
  private stickOrigin = 0;

  constructor(parent: HTMLElement, private readonly state: TouchInputState) {
    this.root = el('div', 'touch');
    parent.appendChild(this.root);

    // ---- Left: steering --------------------------------------------------
    const left = el('div', 'touch-left');
    this.buttonsPad = el('div', 'steer-buttons');
    this.buttonsPad.append(
      this.hold('◀', 'tbtn steer', (on) => (state.left = on), 'Steer left'),
      this.hold('▶', 'tbtn steer', (on) => (state.right = on), 'Steer right'),
    );
    this.stickPad = el('div', 'stick');
    this.knob = el('div', 'stick-knob');
    this.stickPad.appendChild(this.knob);
    this.bindStick();
    this.calBtn = document.createElement('button');
    this.calBtn.className = 'tbtn small tilt-cal hidden';
    this.calBtn.textContent = 'ZERO TILT';
    this.calBtn.setAttribute('aria-label', 'Recalibrate tilt steering');
    left.append(this.buttonsPad, this.stickPad, this.calBtn);

    // ---- Right: pedals + horn/dipper ---------------------------------------
    const right = el('div', 'touch-right');
    const aux = el('div', 'aux');
    aux.append(
      this.hold('📯', 'tbtn small horn', (on) => (state.horn = on), 'Horn'),
      this.hold('💡', 'tbtn small dipper', (on) => (state.dipper = on), 'Dipper'),
      this.hold('DRIFT', 'tbtn small drift', (on) => (state.drift = on), 'Handbrake drift'),
    );
    const pedals = el('div', 'pedals');
    this.gasBtn = this.hold('GAS', 'tbtn pedal gas', (on) => (state.gas = on), 'Accelerate');
    pedals.append(
      this.hold('BRAKE', 'tbtn pedal brake', (on) => (state.brake = on), 'Brake / reverse'),
      this.gasBtn,
    );
    right.append(aux, pedals);

    this.root.append(left, right);
    this.setMode('buttons');
  }

  setPedalCues(launchReady: boolean, dashReady: boolean, autoGas: boolean): void {
    this.gasBtn.classList.toggle('launch-ready', launchReady);
    this.gasBtn.classList.toggle('dash-ready', dashReady);
    this.gasBtn.classList.toggle('auto-on', autoGas);
    const cue = launchReady ? 'launch' : dashReady ? 'dash' : autoGas ? 'auto' : '';
    if (this.gasBtn.dataset.cue !== cue) this.gasBtn.dataset.cue = cue;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.state.clear();
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setMode(mode: TouchSteerMode): void {
    this.mode = mode;
    this.buttonsPad.classList.toggle('hidden', mode !== 'buttons');
    this.stickPad.classList.toggle('hidden', mode !== 'joystick');
    this.calBtn.classList.toggle('hidden', mode !== 'tilt');
    this.state.left = this.state.right = false;
    this.state.joystick = 0;
  }

  get currentMode(): TouchSteerMode {
    return this.mode;
  }

  /** A press-and-hold button supporting multi-touch. */
  private hold(label: string, cls: string, set: (on: boolean) => void, aria: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    const active = new Set<number>();
    const update = () => {
      const on = active.size > 0;
      set(on);
      b.classList.toggle('active', on);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      active.add(e.pointerId);
      update();
    });
    const up = (e: PointerEvent) => {
      active.delete(e.pointerId);
      update();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  private bindStick(): void {
    const pad = this.stickPad;
    const range = () => pad.clientWidth * 0.38;
    const move = (clientX: number) => {
      const dx = clientX - this.stickOrigin;
      const v = Math.max(-1, Math.min(1, dx / range()));
      this.state.joystick = v;
      this.knob.style.transform = `translate(calc(-50% + ${v * range()}px), -50%)`;
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      this.stickOrigin = r.left + r.width / 2;
      move(e.clientX);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) move(e.clientX);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.state.joystick = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
