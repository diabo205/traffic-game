import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, Easing } from 'remotion';
import { CLAPS, KICKS, pulse } from './timing';

export const C = {
  bg: '#0c0a12',
  pink: '#ff2e88',
  yellow: '#ffd23f',
  teal: '#00d1b2',
  orange: '#ff7b1c',
  green: '#1fbf5a',
  white: '#fff8ec',
};
export const DISPLAY = 'Anton, Impact, sans-serif';
export const BODY = 'Inter, sans-serif';
export const MONO = '"JetBrains Mono", monospace';
export const URDU = '"Noto Nastaliq Urdu", serif';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const ease = (f: number, a: number, b: number, from = 0, to = 1, e = Easing.out(Easing.cubic)) =>
  interpolate(f, [a, b], [from, to], { ...clamp, easing: e });

/** A screenshot with Ken Burns drift, a punch-in on kicks and a flash on entry. */
export const Shot: React.FC<{
  f: number; // global frame
  start: number;
  dur: number;
  src: string;
  dir?: number; // -1 / 1 drift direction
  zoom?: number;
  blur?: number;
  dim?: number;
  punch?: number;
}> = ({ f, start, dur, src, dir = 1, zoom = 0.12, blur = 0, dim = 0.15, punch = 1 }) => {
  const t = (f - start) / dur;
  const k = pulse(f, KICKS, 4) * 0.035 * punch;
  const s = 1.08 + zoom * t + k;
  const x = dir * 30 * (t - 0.5);
  const flash = ease(f, start, start + 6, 0.7, 0);
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: C.bg }}>
      <Img
        src={staticFile(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${s}) translateX(${x}px)`,
          filter: `blur(${blur}px) saturate(1.15) contrast(1.05)`,
        }}
      />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${0.55 + dim}) 100%)` }}
      />
      <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />
      <AbsoluteFill style={{ background: C.white, opacity: flash }} />
    </AbsoluteFill>
  );
};

/** Big display text that slams in (scale + blur) at `start`. */
export const Slam: React.FC<{
  f: number;
  start: number;
  children: React.ReactNode;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  stroke?: boolean;
}> = ({ f, start, children, size = 160, color = C.white, style, stroke }) => {
  const p = ease(f, start, start + 7, 0, 1, Easing.out(Easing.back(1.6)));
  if (f < start) return null;
  const sc = interpolate(p, [0, 1], [2.2, 1]);
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 0.95,
        color,
        textTransform: 'uppercase',
        letterSpacing: 2,
        transform: `scale(${sc})`,
        opacity: Math.min(1, p * 1.5),
        filter: `blur(${(1 - Math.min(1, p)) * 14}px)`,
        textShadow: '0 8px 40px rgba(0,0,0,0.6)',
        WebkitTextStroke: stroke ? `3px ${color}` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Highlighted caption bar that wipes in from the left. */
export const Caption: React.FC<{ f: number; start: number; text: string; color?: string; size?: number }> = ({
  f,
  start,
  text,
  color = C.yellow,
  size = 64,
}) => {
  if (f < start) return null;
  const w = ease(f, start, start + 8);
  return (
    <div style={{ position: 'relative', display: 'inline-block', padding: '6px 22px', marginTop: 10 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: color,
          transform: `scaleX(${w}) skewX(-8deg)`,
          transformOrigin: 'left',
        }}
      />
      <span
        style={{
          position: 'relative',
          fontFamily: DISPLAY,
          fontSize: size,
          color: C.bg,
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          opacity: ease(f, start + 3, start + 8),
        }}
      >
        {text}
      </span>
    </div>
  );
};

/** Phase chip: "PHASE 2" pill + commit hash. */
export const Chip: React.FC<{ f: number; start: number; phase: string; hash: string; color?: string }> = ({
  f,
  start,
  phase,
  hash,
  color = C.pink,
}) => {
  if (f < start) return null;
  const x = ease(f, start, start + 10, -80, 0);
  const o = ease(f, start, start + 8);
  return (
    <div style={{ position: 'absolute', top: 60, left: 70, display: 'flex', gap: 14, alignItems: 'center', transform: `translateX(${x}px)`, opacity: o }}>
      <div style={{ background: color, color: C.bg, fontFamily: DISPLAY, fontSize: 38, padding: '4px 18px', letterSpacing: 2 }}>{phase}</div>
      <div style={{ fontFamily: MONO, fontSize: 30, color: C.white, background: 'rgba(0,0,0,0.55)', padding: '6px 14px', fontWeight: 700 }}>{hash}</div>
    </div>
  );
};

/** Truck-art chevron border, pulsing with the kick. */
export const TruckBorder: React.FC<{ f: number; opacity?: number }> = ({ f, opacity = 1 }) => {
  const k = pulse(f, KICKS, 5);
  const off = (f * 3) % 80;
  const stripe = (angle: number) =>
    `repeating-linear-gradient(${angle}deg, ${C.pink} 0 20px, ${C.yellow} 20px 40px, ${C.teal} 40px 60px, ${C.orange} 60px 80px)`;
  const h = 14 + k * 10;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: h, background: stripe(45), backgroundPosition: `${off}px 0` }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: h, background: stripe(-45), backgroundPosition: `${-off}px 0` }} />
    </AbsoluteFill>
  );
};

/** Camera shake from claps and kicks. */
export const useShake = (f: number, amount = 1) => {
  const c = pulse(f, CLAPS, 4) * 14 * amount;
  const k = pulse(f, KICKS, 3) * 6 * amount;
  const a = c + k;
  return `translate(${Math.sin(f * 2.3) * a}px, ${Math.cos(f * 3.1) * a}px) rotate(${Math.sin(f * 1.7) * a * 0.04}deg)`;
};

/** Chromatic-split flash overlay for transitions. */
export const Flash: React.FC<{ f: number; at: number; color?: string; len?: number }> = ({ f, at, color = C.white, len = 10 }) => {
  const o = f >= at ? ease(f, at, at + len, 1, 0) : 0;
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none' }} />;
};

/** Diagonal stripe wipe (truck-art colours) covering the frame around `at`. */
export const StripeWipe: React.FC<{ f: number; at: number }> = ({ f, at }) => {
  const d = f - at;
  if (d < -8 || d > 8) return null;
  const x = interpolate(d, [-8, 8], [-2400, 2400]);
  const cols = [C.pink, C.yellow, C.teal, C.orange];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {cols.map((c, i) => (
        <div
          key={c}
          style={{
            position: 'absolute',
            top: -400,
            left: 0,
            width: 700,
            height: 2000,
            background: c,
            transform: `translateX(${x + i * 160 - 300}px) skewX(-20deg)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
