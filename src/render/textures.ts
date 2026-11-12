import * as THREE from 'three';
import { Rng } from '../sim/rng';

/** Procedural canvas textures (no external image files). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Grainy asphalt, tinted by vertex colour. */
export function asphaltTexture(): THREE.Texture {
  return cached('asphalt', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng(11);
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = 138 + rng.int(0, 56);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rng.int(0, 255), rng.int(0, 255), rng.int(1, 2), rng.int(1, 2));
    }
    // Patches and cracks.
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(60,60,60,${rng.range(0.06, 0.16)})`;
      ctx.beginPath();
      ctx.ellipse(rng.int(0, 255), rng.int(0, 255), rng.int(10, 50), rng.int(6, 30), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,40,40,0.35)';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      let x = rng.int(0, 255), y = rng.int(0, 255);
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += rng.int(-14, 14);
        y += rng.int(-14, 14);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return finish(c, true);
  });
}

export function dirtTexture(): THREE.Texture {
  return cached('dirt', () => {
    const [c, ctx] = canvas(128, 128);
    const rng = new Rng(5);
    ctx.fillStyle = '#c9b089';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2500; i++) {
      const v = rng.int(-30, 25);
      ctx.fillStyle = `rgb(${190 + v},${165 + v},${125 + v})`;
      ctx.fillRect(rng.int(0, 127), rng.int(0, 127), 2, 2);
    }
    return finish(c, true);
  });
}

/** Building facade with a grid of windows; tinted per-instance. */
export function facadeTexture(): THREE.Texture {
  return cached('facade', () => {
    const [c, ctx] = canvas(128, 256);
    const rng = new Rng(21);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.02, 0.06)})`;
      ctx.fillRect(rng.int(0, 127), rng.int(0, 255), rng.int(2, 10), rng.int(2, 10));
    }
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 10 + col * 29, y = 14 + row * 30;
        const lit = rng.next();
        ctx.fillStyle = lit < 0.15 ? '#6b5a3c' : lit < 0.5 ? '#3a4650' : '#4c5964';
        ctx.fillRect(x, y, 18, 18);
        // Balcony / AC unit.
        if (rng.chance(0.3)) {
          ctx.fillStyle = 'rgba(220,220,210,0.9)';
          ctx.fillRect(x + 2, y + 14, 10, 6);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x - 2, y + 18, 22, 3);
      }
    }
    return finish(c);
  });
}

const ART_PALETTES: readonly (readonly string[])[] = [
  ['#e63946', '#f1c40f', '#2a9d8f', '#ffffff', '#1d3557', '#ff7f11'],
  ['#ff006e', '#ffbe0b', '#3a86ff', '#fb5607', '#ffffff', '#06d6a0'],
  ['#d62828', '#fcbf49', '#003049', '#eae2b7', '#2ec4b6', '#f77f00'],
  ['#9b5de5', '#f15bb5', '#fee440', '#00bbf9', '#00f5d4', '#ffffff'],
];

/** Pakistani truck-art style panel: bands, florals, chevrons, mirror dots. */
export function truckArtTexture(variant: number): THREE.Texture {
  return cached(`art${variant % 8}`, () => {
    const [c, ctx] = canvas(512, 256);
    const rng = new Rng(100 + variant);
    const pal = ART_PALETTES[variant % ART_PALETTES.length];
    ctx.fillStyle = pal[0];
    ctx.fillRect(0, 0, 512, 256);
    // Horizontal bands.
    let y = 0;
    while (y < 256) {
      const h = rng.int(14, 40);
      ctx.fillStyle = rng.pick(pal);
      ctx.fillRect(0, y, 512, h);
      // Chevrons or dots inside the band.
      const style = rng.int(0, 2);
      ctx.fillStyle = rng.pick(pal);
      if (style === 0) {
        for (let x = 0; x < 512; x += h) {
          ctx.beginPath();
          ctx.moveTo(x, y + h);
          ctx.lineTo(x + h / 2, y + 2);
          ctx.lineTo(x + h, y + h);
          ctx.fill();
        }
      } else if (style === 1) {
        for (let x = h / 2; x < 512; x += h) {
          ctx.beginPath();
          ctx.arc(x, y + h / 2, h / 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      y += h + 3;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, y - 3, 512, 2);
    }
    // Big floral medallions.
    for (let i = 0; i < 4; i++) {
      const cx = 64 + i * 128 + rng.int(-10, 10), cy = 128 + rng.int(-30, 30);
      const r = rng.int(30, 46);
      for (let p = 0; p < 8; p++) {
        const a = (p / 8) * Math.PI * 2;
        ctx.fillStyle = rng.pick(pal);
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, r * 0.22, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rng.pick(pal);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/** Front destination board for minibuses. */
export function routeBoardTexture(route: string): THREE.Texture {
  return cached(`route${route}`, () => {
    const [c, ctx] = canvas(256, 64);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffd400';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(route, 128, 34);
    return finish(c);
  });
}

export function signTexture(lines: readonly string[], bg = '#0b6e3a', fg = '#ffffff', w = 512, h = 192): THREE.Texture {
  return cached(`sign:${lines.join('|')}:${bg}:${w}x${h}`, () => {
    const [c, ctx] = canvas(w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = Math.floor((h - 40) / lines.length * 0.72);
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, 20 + (i + 0.5) * ((h - 40) / lines.length), w - 40);
    });
    return finish(c);
  });
}

const BILLBOARDS: ReadonlyArray<{ lines: string[]; bg: string; fg: string }> = [
  { lines: ['GARMA GARAM', 'CHAI 24/7'], bg: '#c0392b', fg: '#fff6d5' },
  { lines: ['BIRYANI', 'HOUSE'], bg: '#f39c12', fg: '#3b1f0a' },
  { lines: ['SEA VIEW', '5 KM →'], bg: '#1f6f8b', fg: '#ffffff' },
  { lines: ['DRIVE SAFE', 'KARACHI'], bg: '#27ae60', fg: '#ffffff' },
  { lines: ['ROZANA', 'BACHAT BANK'], bg: '#2c3e50', fg: '#f1c40f' },
  { lines: ['MOBILE LOAD', 'YAHAN DASTIAB'], bg: '#8e44ad', fg: '#ffffff' },
  { lines: ['THANDI', 'LASSI'], bg: '#ecf0f1', fg: '#2980b9' },
  { lines: ['TIKKA', 'BOTI'], bg: '#6d214f', fg: '#ffd166' },
];

export function billboardTexture(i: number): THREE.Texture {
  const b = BILLBOARDS[i % BILLBOARDS.length];
  return signTexture(b.lines, b.bg, b.fg, 512, 256);
}

export const BILLBOARD_COUNT = BILLBOARDS.length;

export function stripesTexture(a = '#d62828', b = '#ffffff'): THREE.Texture {
  return cached(`stripes${a}${b}`, () => {
    const [c, ctx] = canvas(128, 32);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = a;
    for (let x = -32; x < 160; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, 32);
      ctx.fill();
    }
    return finish(c, true);
  });
}
