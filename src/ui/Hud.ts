import type { RunStats } from '../sim/LevelManager';
import type { GameOverReason } from '../sim/types';

/** Arcade HUD + start / end screens. DOM only; the Game pushes values in. */
export class Hud {
  readonly root: HTMLDivElement;
  private integrityFill: HTMLDivElement;
  private integrityText: HTMLSpanElement;
  private timer: HTMLDivElement;
  private speed: HTMLSpanElement;
  private timerLabel: HTMLDivElement;
  private money: HTMLDivElement;
  private farePanel: HTMLDivElement;
  private fareName: HTMLDivElement;
  private fareInfo: HTMLDivElement;
  private fareFill: HTMLDivElement;
  private arrow: HTMLDivElement;
  private shiftCard: HTMLDivElement;
  private shiftText: HTMLDivElement;
  readonly shiftBtn: HTMLButtonElement;
  readonly mapSlot: HTMLDivElement;
  private comboBox: HTMLDivElement;
  private comboMult: HTMLDivElement;
  private comboPts: HTMLDivElement;
  private comboFill: HTMLDivElement;
  private stuntStack: HTMLDivElement;
  private score: HTMLDivElement;
  private lastCombo = '';
  private lastScore = -1;
  private lastFareKey = '';
  private lastMoney = -1;
  private progressFill: HTMLDivElement;
  private banner: HTMLDivElement;
  private toast: HTMLDivElement;
  private flash: HTMLDivElement;
  private startScreen: HTMLDivElement;
  private endScreen: HTMLDivElement;
  private endTitle: HTMLHeadingElement;
  private endSub: HTMLParagraphElement;
  private endStats: HTMLDivElement;
  readonly muteBtn: HTMLButtonElement;
  readonly touchBtn: HTMLButtonElement;
  readonly stickBtn: HTMLButtonElement;
  readonly startBtn: HTMLButtonElement;
  readonly cityBtn: HTMLButtonElement;
  private mode: 'route' | 'city' = 'city';
  readonly restartBtn: HTMLButtonElement;
  private bannerTimer = 0;
  private toastTimer = 0;
  private lastTimerText = '';
  private lastSpeed = -1;
  private lastIntegrity = -1;

  constructor(parent: HTMLElement) {
    this.root = div('hud');
    parent.appendChild(this.root);

    // Top-left: integrity.
    const integ = div('panel integrity');
    integ.innerHTML = '<div class="label">CAR INTEGRITY</div>';
    const bar = div('bar');
    this.integrityFill = div('bar-fill');
    bar.appendChild(this.integrityFill);
    this.integrityText = document.createElement('span');
    this.integrityText.className = 'bar-text';
    bar.appendChild(this.integrityText);
    integ.appendChild(bar);

    // Top-centre: timer.
    const timerWrap = div('panel timer-wrap');
    this.timerLabel = div('label');
    this.timerLabel.textContent = 'CHECKPOINT';
    this.timer = div('timer');
    timerWrap.append(this.timerLabel, this.timer);

    // Top-right: speed + route progress.
    const spd = div('panel speedo');
    this.speed = document.createElement('span');
    this.speed.className = 'speed-num';
    const unit = document.createElement('span');
    unit.className = 'speed-unit';
    unit.textContent = 'km/h';
    const prog = div('progress');
    this.progressFill = div('progress-fill');
    prog.appendChild(this.progressFill);
    const progLabel = div('progress-label');
    progLabel.innerHTML = '<span>SADDAR</span><span>CLIFTON</span>';
    this.money = div('money');
    this.score = div('score');
    spd.append(this.speed, unit, prog, progLabel, this.money, this.score);

    const top = div('top');
    top.append(integ, timerWrap, spd);

    // Free-roam taxi: guide arrow, current fare, minimap slot, shift-over card.
    this.arrow = div('guide-arrow hidden');
    this.arrow.innerHTML = '<svg viewBox="0 0 40 40" width="100%" height="100%"><path d="M20 3 L36 34 L20 26 L4 34 Z" fill="#ffc23d" stroke="#1b1b1b" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    this.farePanel = div('panel fare hidden');
    this.fareName = div('fare-name');
    this.fareInfo = div('fare-info');
    const fbar = div('fare-bar');
    this.fareFill = div('fare-fill');
    fbar.appendChild(this.fareFill);
    this.farePanel.append(this.fareName, this.fareInfo, fbar);
    const centre = div('centre-stack');
    centre.append(this.arrow, this.farePanel);
    this.mapSlot = div('map-slot');
    this.shiftCard = div('panel shift-card hidden');
    this.shiftText = div('shift-text');
    this.shiftBtn = button('START NEW SHIFT', 'big-btn small', 'Start a new shift');
    const shiftHint = div('hint');
    shiftHint.textContent = 'Enter / A / tap · or keep driving off duty';
    this.shiftCard.append(this.shiftText, this.shiftBtn, shiftHint);

    // Stunt combo meter and pop-ups (right side).
    this.comboBox = div('combo hidden');
    this.comboMult = div('combo-mult');
    this.comboPts = div('combo-pts');
    const cbar = div('combo-bar');
    this.comboFill = div('combo-fill');
    cbar.appendChild(this.comboFill);
    this.stuntStack = div('stunts');
    this.comboBox.append(this.comboMult, this.comboPts, cbar);
    const comboWrap = div('combo-wrap');
    comboWrap.append(this.comboBox, this.stuntStack);

    this.banner = div('banner');
    this.toast = div('toast');
    this.flash = div('flash');

    // Settings buttons.
    const settings = div('settings');
    this.muteBtn = button('🔊', 'icon-btn', 'Toggle sound (M)');
    this.touchBtn = button('🎮', 'icon-btn', 'Show / hide touch controls');
    this.stickBtn = button('🕹️', 'icon-btn', 'Switch steering buttons / joystick');
    settings.append(this.muteBtn, this.touchBtn, this.stickBtn);

    // Start screen.
    this.startScreen = div('screen start');
    this.startScreen.innerHTML = `
      <div class="card">
        <div class="kicker">KARACHI TRAFFIC 3D</div>
        <h1>Saddar · Lyari Expressway · Clifton</h1>
        <p class="lede"><b>Free roam:</b> drive the streets of Saddar wherever you like — junctions, the Empress Market roundabout, back alleys and pavements. <b>Route run:</b> race your 660cc Alto across Karachi before the checkpoint timer runs out. Either way, keep the car in one piece.</p>
        <div class="controls-grid">
          <div class="kb"><b>Keyboard</b><br>W/↑ gas · S/↓ brake/reverse<br>A D / ← → steer · E drift<br>Space horn · F/Shift dipper</div>
          <div class="gp"><b>Gamepad</b><br>RT gas · LT brake<br>Left stick steer · B drift<br>A horn · X dipper</div>
          <div class="tc"><b>Touch</b><br>◀ ▶ or joystick to steer<br>GAS / BRAKE pedals · DRIFT<br>📯 horn · 💡 dipper</div>
        </div>
        <p class="tip"><b>Drift:</b> gas + brake together while turning, and power out for a boost. <b>Boost:</b> tap the gas twice quickly, or hold brake + gas when stopped and let the brake go. Hit the ramps for air, and anything on the pavement goes flying.</p>
      </div>`;
    this.cityBtn = button('FREE ROAM · SADDAR', 'big-btn', 'Free roam in Saddar');
    this.startBtn = button('ROUTE RUN', 'big-btn alt', 'Route run to Clifton');
    const modes = div('modes');
    modes.append(this.cityBtn, this.startBtn);
    this.startScreen.querySelector('.card')?.appendChild(modes);
    const hint = div('hint');
    hint.textContent = 'Enter / A starts the highlighted mode';
    this.startScreen.querySelector('.card')?.appendChild(hint);

    // End screen.
    this.endScreen = div('screen end hidden');
    const endCard = div('card');
    this.endTitle = document.createElement('h1');
    this.endSub = document.createElement('p');
    this.endSub.className = 'lede';
    this.endStats = div('stats');
    this.restartBtn = button('DRIVE AGAIN', 'big-btn', 'Restart');
    const hint2 = div('hint');
    hint2.textContent = 'Enter / A / tap to restart';
    endCard.append(this.endTitle, this.endSub, this.endStats, this.restartBtn, hint2);
    this.endScreen.appendChild(endCard);

    this.root.append(top, centre, comboWrap, this.mapSlot, this.shiftCard, this.banner, this.toast, this.flash, settings, this.startScreen, this.endScreen);
    this.showStart(true);
  }

  setMuted(m: boolean): void {
    this.muteBtn.textContent = m ? '🔇' : '🔊';
  }

  setStickMode(joystick: boolean): void {
    this.stickBtn.classList.toggle('on', joystick);
  }

  setTouchVisible(v: boolean): void {
    this.touchBtn.classList.toggle('on', v);
    this.stickBtn.classList.toggle('hidden', !v);
  }

  /** Route mode shows the checkpoint timer and route progress; the city hides them. */
  setMode(mode: 'route' | 'city'): void {
    this.mode = mode;
    this.root.classList.toggle('city', mode === 'city');
    this.cityBtn.classList.toggle('chosen', mode === 'city');
    this.startBtn.classList.toggle('chosen', mode === 'route');
    this.timerLabel.textContent = mode === 'city' ? 'SHIFT' : 'CHECKPOINT';
    if (mode !== 'city') {
      this.setFare(null);
      this.setArrow(null);
      this.showShiftOver(null);
    }
  }

  setMoney(rs: number): void {
    if (rs === this.lastMoney) return;
    this.lastMoney = rs;
    this.money.textContent = `Rs ${rs.toLocaleString('en-PK')}`;
  }

  /** Current fare (or a hint when looking for one); null hides the panel. */
  setFare(f: { name: string; distance: number; timeLeft: number; limit: number } | { hint: string } | null): void {
    if (!f) {
      this.farePanel.classList.add('hidden');
      this.lastFareKey = '';
      return;
    }
    this.farePanel.classList.remove('hidden');
    if ('hint' in f) {
      if (this.lastFareKey !== f.hint) {
        this.fareName.textContent = f.hint;
        this.fareInfo.textContent = '';
        this.farePanel.classList.add('looking');
        this.lastFareKey = f.hint;
      }
      return;
    }
    this.farePanel.classList.remove('looking');
    const key = `${f.name}|${Math.round(f.distance / 10)}|${Math.ceil(f.timeLeft)}`;
    if (key !== this.lastFareKey) {
      this.lastFareKey = key;
      this.fareName.textContent = f.name.toUpperCase();
      this.fareInfo.textContent = `${f.distance < 1000 ? `${Math.round(f.distance / 10) * 10} m` : `${(f.distance / 1000).toFixed(1)} km`} · ${Math.ceil(f.timeLeft)} s`;
    }
    const frac = Math.max(0, Math.min(1, f.timeLeft / f.limit));
    this.fareFill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.fareFill.className = `fare-fill ${frac > 0.5 ? 'ok' : frac > 0.25 ? 'warn' : 'crit'}`;
  }

  /** Guide arrow rotation relative to the car (radians, 0 = straight ahead), null hides. */
  setArrow(angle: number | null): void {
    this.arrow.classList.toggle('hidden', angle === null);
    if (angle !== null) this.arrow.style.transform = `perspective(300px) rotateX(38deg) rotate(${angle.toFixed(3)}rad)`;
  }

  showShiftOver(info: { earned: number; fares: number; total: number; score: number; best: number } | null): void {
    this.shiftCard.classList.toggle('hidden', !info);
    if (info) {
      const n = (x: number) => x.toLocaleString('en-PK');
      this.shiftText.innerHTML = `<div class="kicker">SHIFT OVER</div><h2>Rs ${n(info.earned)}</h2><p>${info.fares} fare${info.fares === 1 ? '' : 's'} this shift · Rs ${n(info.total)} in your pocket</p><p class="stunt-line">★ ${n(info.score)} stunt points · best combo ${n(info.best)}</p>`;
    }
  }

  setScore(points: number): void {
    if (points === this.lastScore) return;
    this.lastScore = points;
    this.score.textContent = `★ ${points.toLocaleString('en-PK')}`;
  }

  /** Live combo: multiplier, unbanked points, and how much of the window is left (0..1). */
  setCombo(mult: number, pending: number, left: number): void {
    const key = mult > 0 ? `${mult}|${pending}` : '';
    if (key !== this.lastCombo) {
      this.lastCombo = key;
      this.comboBox.classList.toggle('hidden', mult === 0);
      if (mult > 0) {
        this.comboMult.textContent = `×${mult}`;
        this.comboPts.textContent = `${pending.toLocaleString('en-PK')}`;
        this.comboBox.classList.remove('pop');
        void this.comboBox.offsetWidth;
        this.comboBox.classList.add('pop');
      }
    }
    if (mult > 0) this.comboFill.style.width = `${(Math.max(0, Math.min(1, left)) * 100).toFixed(1)}%`;
  }

  /** A stunt label that floats up and fades. */
  showStunt(label: string, points: number): void {
    const el = div('stunt');
    el.innerHTML = `${label} <b>+${points}</b>`;
    this.stuntStack.prepend(el);
    while (this.stuntStack.children.length > 4) this.stuntStack.lastElementChild?.remove();
    window.setTimeout(() => el.remove(), 1800);
  }

  showStart(v: boolean): void {
    this.startScreen.classList.toggle('hidden', !v);
    this.root.classList.toggle('in-menu', v);
  }

  showEnd(win: boolean, reason: GameOverReason, stats: RunStats, integrity: number, timeLeft: number, progress: number): void {
    this.endTitle.textContent = win ? 'PAHUNCH GAYE! 🎉' : reason === 'wrecked' ? 'ALTO WRECKED' : 'OUT OF TIME';
    this.endTitle.className = win ? 'win' : 'lose';
    this.endSub.textContent = win
      ? 'You made it to Clifton. Karachi traffic: conquered (for today).'
      : reason === 'wrecked'
        ? 'The Alto gave up. Mechanic in Saddar says: "Bas ho gaya, sahab."'
        : `Stuck in traffic — ${Math.round(progress * 100)}% of the way to Clifton.`;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    if (this.mode === 'city') this.endSub.textContent = 'The Alto gave up in the middle of Saddar. Mechanic says: "Bas ho gaya, sahab."';
    const rows: [string, string][] = [
      ['Time driven', fmt(stats.elapsed)],
      ...(this.mode === 'route' ? [['Route covered', `${Math.round(progress * 100)}%`] as [string, string]] : []),
      ['Car integrity', `${Math.round(integrity)} HP`],
      ['Top speed', `${Math.round(stats.topSpeed * 3.6)} km/h`],
      ['Crashes', String(stats.crashes)],
      ...(this.mode === 'route'
        ? ([
            ['Potholes hit', String(stats.potholes)],
            ['Manholes hit', String(stats.manholes)],
          ] as [string, string][])
        : []),
    ];
    if (win) rows.push(['Time to spare', `${timeLeft.toFixed(1)} s`]);
    this.endStats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.endScreen.classList.remove('hidden');
    this.root.classList.add('in-menu');
  }

  hideEnd(): void {
    this.endScreen.classList.add('hidden');
    this.root.classList.remove('in-menu');
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
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

  update(dt: number, speedKmh: number, integrity: number, timeLeft: number, progress: number): void {
    const s = Math.round(Math.abs(speedKmh));
    if (s !== this.lastSpeed) {
      this.speed.textContent = String(s);
      this.lastSpeed = s;
    }
    const hp = Math.ceil(integrity);
    if (hp !== this.lastIntegrity) {
      this.integrityFill.style.width = `${hp}%`;
      this.integrityFill.className = `bar-fill ${hp > 60 ? 'ok' : hp > 30 ? 'warn' : 'crit'}`;
      this.integrityText.textContent = `${hp} HP`;
      this.lastIntegrity = hp;
    }
    const tt = `${Math.floor(timeLeft / 60)}:${String(Math.floor(timeLeft % 60)).padStart(2, '0')}.${Math.floor((timeLeft % 1) * 10)}`;
    if (tt !== this.lastTimerText) {
      this.timer.textContent = tt;
      this.timer.classList.toggle('low', timeLeft < 10);
      this.lastTimerText = tt;
    }
    this.progressFill.style.width = `${(progress * 100).toFixed(1)}%`;

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

function button(label: string, cls: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}
