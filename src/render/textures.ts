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
    // Sun-bleached, dusty grey: Karachi roads read pale, not black.
    ctx.fillStyle = '#b9b8b4';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = 165 + rng.int(0, 38);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rng.int(0, 255), rng.int(0, 255), rng.int(1, 2), rng.int(1, 2));
    }
    // Patches and cracks.
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(70,70,68,${rng.range(0.05, 0.12)})`;
      ctx.beginPath();
      ctx.ellipse(rng.int(0, 255), rng.int(0, 255), rng.int(10, 50), rng.int(6, 30), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(50,50,50,0.25)';
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

/** Karachi route names painted on minibus windscreens. */
const ROUTE_NAMES = ['گلستان', 'کورنگی', 'لیاقت آباد', 'صدر', 'ملیر', 'لانڈھی', 'نارتھ کراچی', 'کیماڑی'];

/**
 * Painted upper half of a minibus windscreen: framed truck-art panel with
 * peacocks, florals and the route name in white Urdu.
 */
export function windscreenArtTexture(variant: number): THREE.Texture {
  return cached(`wsart${variant % 8}`, () => {
    const [c, ctx] = canvas(512, 256);
    const rng = new Rng(300 + variant);
    const pal = ART_PALETTES[variant % ART_PALETTES.length];
    // Dark glass showing through the middle.
    ctx.fillStyle = '#1d2a33';
    ctx.fillRect(0, 0, 512, 256);
    // Painted frame: thick red border with a yellow inner line.
    ctx.fillStyle = '#d62828';
    ctx.fillRect(0, 0, 512, 40);
    ctx.fillRect(0, 0, 34, 256);
    ctx.fillRect(478, 0, 34, 256);
    ctx.fillStyle = '#ffd60a';
    ctx.fillRect(34, 40, 444, 5);
    ctx.fillRect(34, 40, 5, 216);
    ctx.fillRect(473, 40, 5, 216);
    for (let x = 6; x < 512; x += 18) {
      ctx.fillStyle = pal[(x / 18) % pal.length | 0];
      ctx.beginPath();
      ctx.arc(x, 20, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Peacock fans in the upper corners.
    for (const [cx, dir] of [[110, 1], [402, -1]] as const) {
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (0.15 + k * 0.1) * dir + (dir < 0 ? Math.PI : 0);
        ctx.fillStyle = pal[k % pal.length];
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 34, 88 - Math.abs(Math.sin(a)) * 26, 22, 9, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#0a9396';
      ctx.beginPath();
      ctx.ellipse(cx, 104, 18, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Central floral medallion.
    for (let p = 0; p < 10; p++) {
      const a = (p / 10) * Math.PI * 2;
      ctx.fillStyle = rng.pick(pal);
      ctx.beginPath();
      ctx.ellipse(256 + Math.cos(a) * 20, 84 + Math.sin(a) * 20, 16, 7, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // Route name.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.font = 'bold 64px "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = ROUTE_NAMES[variant % ROUTE_NAMES.length];
    ctx.strokeText(name, 256, 178);
    ctx.fillText(name, 256, 178);
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

// ---------------------------------------------------------------------------
// Saddar street dressing
// ---------------------------------------------------------------------------

/**
 * Facade atlas for old Saddar buildings, sampled in world space by
 * facadeMaterial.ts. 4 bay variants across; top half = one upper storey
 * (3.1 m), bottom half = the ground-floor shop (4 m). Mostly light so the
 * per-building tint shows through.
 */
export function saddarFacadeAtlas(): THREE.Texture {
  return cached('saddarAtlas', () => {
    const [c, ctx] = canvas(512, 256);
    const rng = new Rng(77);
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, 512, 256);
    // Weathering noise everywhere.
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(70,55,40,${rng.range(0.02, 0.07)})`;
      ctx.fillRect(rng.int(0, 511), rng.int(0, 255), rng.int(1, 4), rng.int(1, 4));
    }
    const SH = ['#3d6b4a', '#2f5d7c', '#6b4a2f', '#4a6b6b'];
    for (let b = 0; b < 4; b++) {
      const x0 = b * 128;
      // ---- Upper storey (rows 0..127): slab ledge at the bottom.
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x0, 116, 128, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x0, 114, 128, 3);
      const wx = x0 + 34, wy = 26, ww = 60, wh = 72;
      // Rain / AC streaks below the window.
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = `rgba(60,50,40,${rng.range(0.06, 0.14)})`;
        ctx.fillRect(wx + rng.int(0, ww), wy + wh, rng.int(2, 6), rng.int(10, 30));
      }
      if (b === 0) {
        // Window with open wooden shutters.
        ctx.fillStyle = '#2b2a28';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = SH[rng.int(0, 3)];
        ctx.fillRect(wx - 16, wy, 15, wh);
        ctx.fillRect(wx + ww + 1, wy, 15, wh);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = wy + 4; y < wy + wh; y += 7) {
          ctx.fillRect(wx - 16, y, 15, 2);
          ctx.fillRect(wx + ww + 1, y, 15, 2);
        }
      } else if (b === 1) {
        // Barred window + AC unit.
        ctx.fillStyle = '#34393d';
        ctx.fillRect(wx, wy, ww, wh - 10);
        ctx.fillStyle = '#8c8f91';
        for (let x = wx + 6; x < wx + ww; x += 9) ctx.fillRect(x, wy, 2, wh - 10);
        ctx.fillStyle = '#d9d6cc';
        ctx.fillRect(wx + 8, wy + wh - 6, 44, 24);
        ctx.fillStyle = '#9a978e';
        for (let y = wy + wh - 2; y < wy + wh + 16; y += 4) ctx.fillRect(wx + 12, y, 36, 1);
      } else if (b === 2) {
        // Balcony door with railing.
        ctx.fillStyle = '#26282a';
        ctx.fillRect(wx + 4, wy - 6, ww - 8, wh + 22);
        ctx.fillStyle = '#5a5f63';
        ctx.fillRect(x0 + 10, 78, 108, 4);
        for (let x = x0 + 12; x < x0 + 118; x += 8) ctx.fillRect(x, 78, 2, 36);
      } else {
        // Small vent window + big water stain.
        ctx.fillStyle = '#3a3a38';
        ctx.fillRect(wx + 14, wy + 14, 32, 26);
        const g = ctx.createLinearGradient(0, 30, 0, 116);
        g.addColorStop(0, 'rgba(80,70,55,0)');
        g.addColorStop(1, 'rgba(80,70,55,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(x0 + 20, 30, 70, 86);
      }

      // ---- Ground-floor shop (rows 128..255): sign band at the top.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x0, 128, 128, 26);
      const sx = x0 + 8, sy = 160, sw = 112, sh = 96;
      if (b === 0 || b === 2) {
        // Rolling shutter, half up on b0, closed + painted on b2.
        const open = b === 0 ? 46 : 0;
        ctx.fillStyle = '#1d1b19';
        ctx.fillRect(sx, sy, sw, sh);
        if (open) {
          for (let i = 0; i < 10; i++) {
            ctx.fillStyle = `hsl(${rng.int(0, 360)},55%,${rng.int(35, 60)}%)`;
            ctx.fillRect(sx + rng.int(0, sw - 16), sy + open + rng.int(0, sh - open - 14), rng.int(8, 20), rng.int(8, 14));
          }
        }
        ctx.fillStyle = b === 2 ? '#5a7d9a' : '#a7a9a8';
        ctx.fillRect(sx, sy, sw, open || sh);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = sy + 3; y < sy + (open || sh); y += 5) ctx.fillRect(sx, y, sw, 1);
      } else if (b === 1) {
        // Open shop: lit interior with goods and a tube light.
        ctx.fillStyle = '#2a2622';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.fillStyle = '#fffbe6';
        ctx.fillRect(sx + 20, sy + 6, 70, 4);
        for (let i = 0; i < 18; i++) {
          ctx.fillStyle = `hsl(${rng.int(0, 360)},60%,${rng.int(40, 65)}%)`;
          ctx.fillRect(sx + rng.int(2, sw - 14), sy + rng.int(16, sh - 14), rng.int(6, 14), rng.int(6, 12));
        }
      } else {
        // Stairwell entrance between pillars.
        ctx.fillStyle = '#c9c2b4';
        ctx.fillRect(sx, sy, 16, sh);
        ctx.fillRect(sx + sw - 16, sy, 16, sh);
        ctx.fillStyle = '#151413';
        ctx.fillRect(sx + 34, sy + 8, 44, sh - 8);
      }
    }
    // Mipmapped; facadeMaterial samples with textureGrad to avoid bay seams.
    return finish(c);
  });
}

const SHOPS: ReadonlyArray<{ en: string; ur: string; bg: string; fg: string }> = [
  { en: 'AL-MADINA CLOTH HOUSE', ur: 'کپڑا', bg: '#1b5e20', fg: '#ffffff' },
  { en: 'BISMILLAH MOBILE CENTRE', ur: 'موبائل', bg: '#0d47a1', fg: '#ffeb3b' },
  { en: 'NEW KARACHI ELECTRONICS', ur: 'کراچی', bg: '#b71c1c', fg: '#ffffff' },
  { en: 'SADDAR SWEETS & BAKERS', ur: 'مٹھائی', bg: '#ffeb3b', fg: '#b71c1c' },
  { en: 'PAK MEDICAL STORE', ur: 'میڈیکل اسٹور', bg: '#ffffff', fg: '#1b5e20' },
  { en: 'ROYAL TAILORS', ur: 'ٹیلرز', bg: '#4a148c', fg: '#ffffff' },
  { en: 'STAR PHOTOSTAT', ur: 'فوٹو اسٹیٹ', bg: '#e65100', fg: '#ffffff' },
  { en: 'SHOE PALACE', ur: 'جوتے', bg: '#263238', fg: '#ffc107' },
  { en: 'ZAM ZAM TRAVELS', ur: 'ٹریولز', bg: '#006064', fg: '#ffffff' },
  { en: 'AL-FAISAL HARDWARE', ur: 'ہارڈویئر', bg: '#f5f5f5', fg: '#0d47a1' },
];
export const SHOP_SIGN_COUNT = SHOPS.length;

/** Bilingual shop signboard (English + Urdu). */
export function shopSignTexture(i: number): THREE.Texture {
  const s = SHOPS[i % SHOPS.length];
  return cached(`shop${i % SHOPS.length}`, () => {
    const [c, ctx] = canvas(512, 128);
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = s.fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = s.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 44px system-ui, sans-serif';
    ctx.fillText(s.en, 256, 44, 480);
    ctx.font = '700 34px "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif';
    ctx.direction = 'rtl';
    ctx.fillText(s.ur, 256, 94, 480);
    return finish(c);
  });
}

const BANNERS: ReadonlyArray<{ lines: string[]; bg: string; fg: string }> = [
  { lines: ['JASHN-E-AZADI MUBARAK'], bg: '#01411c', fg: '#ffffff' },
  { lines: ['GRAND SALE · 50% OFF'], bg: '#d50000', fg: '#ffeb3b' },
  { lines: ['WELCOME TO SADDAR'], bg: '#ffffff', fg: '#01411c' },
  { lines: ['ROAD SAFETY WEEK · DHYAN SE'], bg: '#ffd600', fg: '#212121' },
  { lines: ['CRICKET TOURNAMENT · FINAL'], bg: '#1565c0', fg: '#ffffff' },
];
export const BANNER_COUNT = BANNERS.length;

export function streetBannerTexture(i: number): THREE.Texture {
  const b = BANNERS[i % BANNERS.length];
  return signTexture(b.lines, b.bg, b.fg, 768, 96);
}

/** Faded yellow and grey stripes on the expressway's concrete barriers. */
export function barrierStripeTexture(): THREE.Texture {
  return cached('barrierStripe', () => {
    const [c, ctx] = canvas(64, 16);
    ctx.fillStyle = '#d9b84a';
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = '#b9b7b0';
    ctx.fillRect(32, 0, 32, 16);
    ctx.fillStyle = 'rgba(80,75,65,0.18)';
    ctx.fillRect(0, 11, 64, 5);
    const t = finish(c, true);
    t.magFilter = THREE.NearestFilter;
    return t;
  });
}

/** Black-and-yellow kerb paint (repeats along the kerb). */
export function kerbStripeTexture(): THREE.Texture {
  return cached('kerbStripe', () => {
    const [c, ctx] = canvas(64, 16);
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(32, 0, 32, 16);
    const t = finish(c, true);
    t.magFilter = THREE.NearestFilter;
    return t;
  });
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

/** Victorian-gothic stone wall with pointed-arch windows (Empress Market). */
export function gothicWallTexture(): THREE.Texture {
  return cached('gothic', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng(9);
    ctx.fillStyle = '#d9b46e';
    ctx.fillRect(0, 0, 256, 256);
    // Ashlar courses.
    ctx.strokeStyle = 'rgba(120,85,40,0.35)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 256; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
      for (let x = (y / 12) % 2 ? 0 : 16; x < 256; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 12);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = `rgba(90,60,30,${rng.range(0.03, 0.1)})`;
      ctx.fillRect(rng.int(0, 255), rng.int(0, 255), rng.int(1, 4), rng.int(1, 4));
    }
    // Two pointed-arch windows per tile.
    for (const cx of [64, 192]) {
      ctx.fillStyle = '#c99f58';
      archPath(ctx, cx, 200, 46, 150);
      ctx.fill();
      ctx.fillStyle = '#2a2420';
      archPath(ctx, cx, 196, 36, 136);
      ctx.fill();
      ctx.fillStyle = '#c99f58';
      ctx.fillRect(cx - 2, 70, 4, 126);
    }
    const t = finish(c, true);
    return t;
  });
}

function archPath(ctx: CanvasRenderingContext2D, cx: number, baseY: number, halfW: number, height: number): void {
  const springY = baseY - height + halfW * 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, baseY);
  ctx.lineTo(cx - halfW, springY);
  ctx.quadraticCurveTo(cx - halfW, baseY - height + 10, cx, baseY - height);
  ctx.quadraticCurveTo(cx + halfW, baseY - height + 10, cx + halfW, springY);
  ctx.lineTo(cx + halfW, baseY);
  ctx.closePath();
}

export function clockFaceTexture(): THREE.Texture {
  return cached('clock', () => {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = '#d9b46e';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#f7f2e4';
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 4;
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(64 + Math.sin(a) * 44 - 2, 64 - Math.cos(a) * 44 - 2, 4, 4);
    }
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64 + 26, 64 - 18);
    ctx.moveTo(64, 64);
    ctx.lineTo(64 - 6, 64 - 40);
    ctx.stroke();
    return finish(c);
  });
}

/** White marble face with one tall Moorish pointed arch (Mazar-e-Quaid). */
export function mazarFaceTexture(): THREE.Texture {
  return cached('mazar', () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#f4f3ee';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#e4e2da';
    archPath(ctx, 128, 256, 74, 230);
    ctx.fill();
    ctx.fillStyle = '#7f8a86';
    archPath(ctx, 128, 256, 58, 206);
    ctx.fill();
    // Copper grille lattice inside the arch.
    ctx.strokeStyle = 'rgba(40,60,55,0.6)';
    ctx.lineWidth = 2;
    for (let x = 70; x < 190; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, 90);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    for (let y = 100; y < 256; y += 12) {
      ctx.beginPath();
      ctx.moveTo(70, y);
      ctx.lineTo(186, y);
      ctx.stroke();
    }
    return finish(c);
  });
}

// ---------------------------------------------------------------------------
// Lyari settlements & Shahrah-e-Faisal towers (world-space atlases, same
// layout as saddarFacadeAtlas: 4 variants across, top half = 3.1 m storey,
// bottom half = 4 m ground floor).
// ---------------------------------------------------------------------------

/** Unplastered grey block / red brick riverbank housing. */
export function settlementFacadeAtlas(): THREE.Texture {
  return cached('settlementAtlas', () => {
    const [c, ctx] = canvas(512, 256);
    const rng = new Rng(91);
    const WALLS = ['#a6a39c', '#a8553c', '#b9b2a2', '#97948d'];
    for (let b = 0; b < 4; b++) {
      const x0 = b * 128;
      ctx.fillStyle = WALLS[b];
      ctx.fillRect(x0, 0, 128, 256);
      // Masonry coursing: blocks (big) or bricks (small).
      const brick = b === 1;
      const ch = brick ? 6 : 14, cw = brick ? 18 : 30;
      if (b !== 2) {
        ctx.fillStyle = brick ? 'rgba(235,215,190,0.35)' : 'rgba(60,58,54,0.28)';
        for (let y = 0, r = 0; y < 256; y += ch, r++) {
          ctx.fillRect(x0, y, 128, 1);
          for (let x = (r % 2) * (cw / 2); x < 128; x += cw) ctx.fillRect(x0 + x, y, 1, ch);
        }
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(${brick ? '120,50,30' : '70,70,70'},${rng.range(0.08, 0.2)})`;
          ctx.fillRect(x0 + rng.int(0, 120), rng.int(0, 250), cw - 2, ch - 1);
        }
      } else {
        // Patchy plaster with damp stains.
        for (let i = 0; i < 25; i++) {
          ctx.fillStyle = `rgba(90,80,65,${rng.range(0.05, 0.14)})`;
          ctx.fillRect(x0 + rng.int(0, 100), rng.int(0, 230), rng.int(10, 40), rng.int(10, 40));
        }
      }
      // Concrete slab band between storeys.
      ctx.fillStyle = '#8f8c86';
      ctx.fillRect(x0, 118, 128, 10);
      // Upper storey: small grilled window (+ AC or exhaust fan).
      const wx = x0 + 30 + (b % 2) * 18, wy = 34;
      ctx.fillStyle = '#25292b';
      ctx.fillRect(wx, wy, 46, 48);
      ctx.fillStyle = b === 3 ? '#3d6f8f' : '#6b6f72';
      for (let x = wx + 4; x < wx + 46; x += 8) ctx.fillRect(x, wy, 2, 48);
      ctx.fillRect(wx, wy + 22, 46, 2);
      if (b === 0) {
        ctx.fillStyle = '#d6d2c6';
        ctx.fillRect(wx + 52, wy + 30, 30, 18);
      }
      // Rust / water streaks.
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = `rgba(70,50,35,${rng.range(0.1, 0.22)})`;
        ctx.fillRect(wx + rng.int(0, 46), wy + 48, rng.int(2, 4), rng.int(12, 40));
      }
      // Ground floor: steel door / shutter / blue door / blank wall + vent.
      const sy = 150;
      if (b === 0) {
        ctx.fillStyle = '#5d6a73';
        ctx.fillRect(x0 + 12, sy, 104, 106);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = sy + 3; y < 256; y += 5) ctx.fillRect(x0 + 12, y, 104, 1);
      } else if (b === 1 || b === 3) {
        ctx.fillStyle = b === 1 ? '#2f6f8f' : '#6e7f3c';
        ctx.fillRect(x0 + 40, sy + 10, 44, 96);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x0 + 44, sy + 16, 16, 40);
        ctx.fillRect(x0 + 64, sy + 16, 16, 40);
      } else {
        ctx.fillStyle = '#2b2b29';
        ctx.fillRect(x0 + 70, sy + 20, 30, 24);
      }
      // Grime near the ground.
      const g = ctx.createLinearGradient(0, 200, 0, 256);
      g.addColorStop(0, 'rgba(60,50,40,0)');
      g.addColorStop(1, 'rgba(60,50,40,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 200, 128, 56);
    }
    return finish(c);
  });
}

/** Corporate glass / precast towers along Shahrah-e-Faisal. One style per building. */
export function towerFacadeAtlas(): THREE.Texture {
  return cached('towerAtlas', () => {
    const [c, ctx] = canvas(512, 256);
    const glass = (x: number, y: number, w: number, h: number, top: string, bot: string) => {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, top);
      g.addColorStop(1, bot);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    };
    for (let b = 0; b < 4; b++) {
      const x0 = b * 128;
      if (b === 0) {
        // Blue-green curtain wall with thin mullions and a spandrel band.
        glass(x0, 0, 128, 128, '#9cc3cf', '#3f6f80');
        ctx.fillStyle = '#5b7f8c';
        ctx.fillRect(x0, 104, 128, 24);
        ctx.fillStyle = '#d7dee0';
        for (let x = 0; x < 128; x += 32) ctx.fillRect(x0 + x, 0, 3, 128);
        ctx.fillRect(x0, 102, 128, 3);
      } else if (b === 1) {
        // Precast concrete with a dark ribbon window.
        ctx.fillStyle = '#e4ded2';
        ctx.fillRect(x0, 0, 128, 128);
        glass(x0, 22, 128, 64, '#7d93a0', '#2c3a44');
        ctx.fillStyle = '#c9c2b4';
        for (let x = 0; x < 128; x += 42) ctx.fillRect(x0 + x, 22, 4, 64);
      } else if (b === 2) {
        // Dark reflective glass grid.
        glass(x0, 0, 128, 128, '#6f8da3', '#1f2c38');
        ctx.fillStyle = '#9aa7b0';
        for (let x = 0; x < 128; x += 64) ctx.fillRect(x0 + x, 0, 4, 128);
        ctx.fillRect(x0, 124, 128, 4);
        ctx.fillRect(x0, 60, 128, 2);
      } else {
        // Concrete grid with punched square windows.
        ctx.fillStyle = '#d3cec4';
        ctx.fillRect(x0, 0, 128, 128);
        for (let x = 8; x < 128; x += 40) glass(x0 + x, 18, 30, 78, '#8aa1ad', '#34424c');
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x0, 120, 128, 8);
      }
      // Ground floor: lobby / showroom glazing under a canopy band.
      ctx.fillStyle = b === 1 || b === 3 ? '#cfc8ba' : '#4d5e68';
      ctx.fillRect(x0, 128, 128, 128);
      ctx.fillStyle = '#e9e6de';
      ctx.fillRect(x0, 128, 128, 22);
      glass(x0 + 6, 156, 116, 100, '#a9bec8', '#3a4a52');
      ctx.fillStyle = '#c8cdd0';
      for (let x = 6; x < 128; x += 29) ctx.fillRect(x0 + x, 156, 3, 100);
    }
    return finish(c);
  });
}

/** Rate-list board at the expressway toll plaza. */
export function tollBoardTexture(): THREE.Texture {
  return cached('tollBoard', () => {
    const [c, ctx] = canvas(256, 320);
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#123f8c';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RATE LIST', 128, 44);
    ctx.fillStyle = '#123f8c';
    ctx.font = 'bold 22px sans-serif';
    const rows = [['CAR / JEEP', '30'], ['HIACE', '50'], ['COASTER', '80'], ['TRUCK', '150']];
    rows.forEach(([k, v], i) => {
      const y = 104 + i * 44;
      ctx.textAlign = 'left';
      ctx.fillText(k, 18, y);
      ctx.textAlign = 'right';
      ctx.fillText(v, 238, y);
      ctx.fillRect(14, y + 12, 228, 2);
    });
    ctx.fillStyle = '#c62828';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HELPLINE 130', 128, 300);
    return finish(c);
  });
}
