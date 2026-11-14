// Bar grid shared with music/make_track.py: 150 BPM at 30 fps.
export const FPS = 30;
export const BEAT = 12; // frames
export const STEP = BEAT / 4;
export const BAR = BEAT * 4; // 48 frames = 1.6 s
export const TOTAL_BARS = 54;
export const DURATION = TOTAL_BARS * BAR + 60; // + 2 s tail

export const bar = (b: number, beat = 0) => Math.round(b * BAR + beat * BEAT);

export const SECTIONS = {
  intro: [0, 8],
  drop1: [8, 24],
  brk: [24, 32],
  drop2: [32, 48],
  outro: [48, 54],
} as const;

const inDrop = (b: number) => (b >= 8 && b < 24) || (b >= 32 && b < 48);

/** Frames where a kick lands (same pattern as the music). */
export const KICKS: number[] = (() => {
  const out: number[] = [];
  for (let b = 0; b < TOTAL_BARS; b++) {
    if (inDrop(b)) {
      const local = b < 24 ? b - 8 : b - 32;
      const pat = local % 2 === 0 ? [0, 6, 10] : [0, 3, 10, 14];
      for (const s of pat) out.push(Math.round(b * BAR + s * STEP));
    } else if (b === 4 || b === 5) {
      out.push(b * BAR, b * BAR + 8 * STEP);
    } else if (b >= 28 && b < 32) {
      const n = b < 30 ? 4 : 8;
      for (let q = 0; q < n; q++) out.push(Math.round(b * BAR + (q * BAR) / n));
    }
  }
  return out;
})();

/** Frames where the clap / snare lands in the drops. */
export const CLAPS: number[] = (() => {
  const out: number[] = [];
  for (let b = 0; b < TOTAL_BARS; b++) if (inDrop(b)) out.push(Math.round(b * BAR + 8 * STEP));
  return out;
})();

/** 1 on a hit, decaying over `decay` frames. */
export function pulse(frame: number, hits: number[], decay = 6): number {
  let v = 0;
  for (const h of hits) {
    const d = frame - h;
    if (d >= 0 && d < decay * 4) v = Math.max(v, Math.exp(-d / decay));
  }
  return v;
}
