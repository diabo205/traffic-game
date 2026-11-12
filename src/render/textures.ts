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
