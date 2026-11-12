import type { RunStats } from '../sim/LevelManager';
import type { GameOverReason } from '../sim/types';

/** Arcade HUD + start / end screens. DOM only; the Game pushes values in. */
export class Hud {
  readonly root: HTMLDivElement;
  private integrityFill: HTMLDivElement;
  private integrityText: HTMLSpanElement;
  private timer: HTMLDivElement;
  private speed: HTMLSpanElement;
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
    timerWrap.innerHTML = '<div class="label">CHECKPOINT</div>';
    this.timer = div('timer');
    timerWrap.appendChild(this.timer);

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
    spd.append(this.speed, unit, prog, progLabel);

    const top = div('top');
    top.append(integ, timerWrap, spd);

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
        <h1>Saddar ➜ Lyari Expressway ➜ Clifton</h1>
        <p class="lede">Get your 660cc Alto across Karachi before the checkpoint timer runs out. Dodge potholes, open manholes, W-11s, rickshaws and VIP protocol. Keep the car in one piece.</p>
        <div class="controls-grid">
          <div class="kb"><b>Keyboard</b><br>W/↑ gas · S/↓ brake/reverse<br>A D / ← → steer<br>Space horn · F/Shift dipper</div>
          <div class="gp"><b>Gamepad</b><br>RT gas · LT brake<br>Left stick steer<br>A horn · X dipper</div>
          <div class="tc"><b>Touch</b><br>◀ ▶ or joystick to steer<br>GAS / BRAKE pedals<br>📯 horn · 💡 dipper</div>
        </div>
        <p class="tip">Tip: brake before a pothole and it won't damage the car. Flash your dipper and slow cars move over.</p>
      </div>`;
    this.startBtn = button('START DRIVING', 'big-btn', 'Start');
    this.startScreen.querySelector('.card')?.appendChild(this.startBtn);
    const hint = div('hint');
    hint.textContent = 'Enter / A / tap to start';
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

    this.root.append(top, this.banner, this.toast, this.flash, settings, this.startScreen, this.endScreen);
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
    const rows: [string, string][] = [
      ['Time driven', fmt(stats.elapsed)],
      ['Route covered', `${Math.round(progress * 100)}%`],
      ['Car integrity', `${Math.round(integrity)} HP`],
      ['Top speed', `${Math.round(stats.topSpeed * 3.6)} km/h`],
      ['Crashes', String(stats.crashes)],
      ['Potholes hit', String(stats.potholes)],
      ['Manholes hit', String(stats.manholes)],
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
