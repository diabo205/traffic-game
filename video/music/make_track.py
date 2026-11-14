"""Original hype track for the dev-journey video, synthesised from scratch.

150 BPM half-time trap/EDM in F harmonic minor. 54 bars of 1.6 s = 86.4 s,
plus a 2 s tail. The video (video/src/timing.ts) uses the same bar grid:
  bars  0-7   intro   (pads, arp, riser)
  bars  8-23  drop 1
  bars 24-31  break + build
  bars 32-47  drop 2
  bars 48-53  outro
Usage: python3 make_track.py out.wav
"""
import sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 150
BEAT = 60 / BPM          # 0.4 s
STEP = BEAT / 4          # sixteenth
BAR = BEAT * 4           # 1.6 s
BARS = 54
LEN = BARS * BAR + 2.0
N = int(LEN * SR)
rng = np.random.default_rng(7)

def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def t_arr(dur):
    return np.arange(int(dur * SR)) / SR

class Bus:
    def __init__(self):
        self.x = np.zeros((2, N))
    def add(self, start, sig, gain=1.0, pan=0.0):
        i = int(start * SR)
        if i >= N:
            return
        if sig.ndim == 1:
            l = np.cos((pan + 1) * np.pi / 4)
            r = np.sin((pan + 1) * np.pi / 4)
            sig = np.vstack([sig * l * 1.414, sig * r * 1.414])
        n = min(sig.shape[1], N - i)
        self.x[:, i:i + n] += sig[:, :n] * gain

def lp(x, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
    return sosfilt(sos, x, axis=-1)

def hp(x, fc, order=2):
    sos = butter(order, fc, 'high', fs=SR, output='sos')
    return sosfilt(sos, x, axis=-1)

def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], 'band', fs=SR, output='sos')
    return sosfilt(sos, x, axis=-1)

def sweep_lp(x, cutoff_fn, block=1024):
    """Time-varying low-pass: cutoff_fn(time_s) -> Hz, per block."""
    out = np.zeros_like(x)
    zi = None
    for s in range(0, x.shape[-1], block):
        fc = float(np.clip(cutoff_fn(s / SR), 60, SR * 0.45))
        sos = butter(2, fc, 'low', fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], x.shape[0], 2))
        out[:, s:s + block], zi = sosfilt(sos, x[:, s:s + block], axis=-1, zi=zi)
    return out

def saw(freq, t, phase=0.0):
    p = (freq * t + phase) % 1.0
    return 2 * p - 1

def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, hold=None):
    hold = n / SR if hold is None else hold
    t = np.arange(n) / SR
    env = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = np.clip((t - hold) / r, 0, 1)
    return env * (1 - rel)

# ---------------- instruments ----------------
def kick():
    t = t_arr(0.5)
    f = 45 + 120 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.18)
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.003) * 0.4
    return np.tanh(1.6 * (body + click))

def clap():
    t = t_arr(0.45)
    n = rng.standard_normal(len(t))
    env = np.zeros_like(t)
    for k, off in enumerate([0, 0.011, 0.022]):
        env += np.where(t >= off, np.exp(-(t - off) / (0.012 if k < 2 else 0.12)), 0)
    sig = bp(n * env, 900, 5000)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5
    return np.tanh(2.2 * (sig + tone)) * 0.9

def hat(open_=False):
    t = t_arr(0.3 if open_ else 0.06)
    n = hp(rng.standard_normal(len(t)), 7000)
    return n * np.exp(-t / (0.09 if open_ else 0.014)) * 0.6

def b808(m, dur, glide_from=None):
    t = t_arr(dur + 0.08)
    f = np.full(len(t), mtof(m))
    if glide_from is not None:
        f = mtof(m) + (mtof(glide_from) - mtof(m)) * np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = adsr(len(t), 0.003, 0.6, 0.55, 0.08, hold=dur)
    return np.tanh(2.5 * np.sin(ph)) * env

def supersaw(m, dur, voices=7, detune=0.18, bright=4000, a=0.01, r=0.15):
    t = t_arr(dur + r)
    l = np.zeros(len(t)); rr = np.zeros(len(t))
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
        f = mtof(m + d)
        s = saw(f, t, rng.random())
        pan = (v / (voices - 1)) * 2 - 1
        l += s * (1 - pan) / 2; rr += s * (1 + pan) / 2
    env = adsr(len(t), a, 0.3, 0.8, r, hold=dur)
    sig = np.vstack([l, rr]) * env / voices * 1.6
    return lp(sig, bright)

def pluck(m, dur=0.25, bright=3000):
    t = t_arr(dur)
    s = saw(mtof(m), t) * 0.6 + np.sign(np.sin(2 * np.pi * mtof(m) * t)) * 0.4
    s = lp(s, bright) * np.exp(-t / 0.09)
    return s

def lead(m, dur):
    t = t_arr(dur + 0.12)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.15, 0, 1)
    f = mtof(m) * vib
    ph = np.cumsum(f) / SR
    s = (2 * (ph % 1) - 1) * 0.5 + np.sign(np.sin(2 * np.pi * ph)) * 0.35
    s += (2 * ((ph * 2.003) % 1) - 1) * 0.25
    env = adsr(len(t), 0.004, 0.2, 0.75, 0.1, hold=dur)
    return lp(s * env, 5200)

def pad(ms, dur):
    t = t_arr(dur + 0.6)
    out = np.zeros((2, len(t)))
    for m in ms:
        out += supersaw(m, dur, voices=5, detune=0.12, bright=2200, a=0.35, r=0.6)[:, :len(t)]
    return out / len(ms) * 1.8

def noise_riser(dur):
    t = t_arr(dur)
    n = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    blk = 1024
    for s in range(0, len(t), blk):
        p = s / len(t)
        lo = 300 + 6000 * p ** 2
        out[s:s + blk] = bp(n[s:s + blk + 0], lo, min(lo * 2.5, 19000), 1)
    f = 110 * 2 ** (3 * (t / dur) ** 1.5)
    up = (2 * ((np.cumsum(f) / SR) % 1) - 1) * 0.25
    env = (t / dur) ** 2
    return (out * 0.8 + lp(up, 6000)) * env

def impact():
    t = t_arr(2.5)
    boom = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-t / 0.1)) / SR) * np.exp(-t / 0.7)
    crash = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.9) * 0.35
    return np.tanh(1.5 * boom) + crash

def downlift(dur=1.6):
    t = t_arr(dur)
    n = rng.standard_normal(len(t))
    return lp(n, 3000) * np.exp(-t / 0.5) * 0.4

# ---------------- score ----------------
CHORDS = [  # (pad voicing, bass root, stab voicing)
    ([53, 56, 60, 65], 29, [65, 68, 72]),   # Fm
    ([49, 53, 56, 61], 25, [61, 65, 68]),   # Db
    ([51, 55, 58, 63], 27, [63, 67, 70]),   # Eb
    ([48, 52, 55, 60], 24, [60, 64, 67]),   # C  (harmonic-minor V)
]
HOOK = [  # per bar: (step, midi, len_steps)
    [(0, 84, 2), (2, 80, 2), (4, 77, 2), (6, 80, 2), (8, 84, 3), (11, 85, 1), (12, 84, 4)],
    [(0, 80, 2), (2, 77, 2), (4, 73, 2), (6, 77, 2), (8, 80, 4), (12, 82, 2), (14, 80, 2)],
    [(0, 79, 2), (2, 82, 2), (4, 87, 4), (8, 85, 2), (10, 84, 2), (12, 82, 2), (14, 80, 2)],
    [(0, 79, 2), (2, 76, 2), (4, 79, 2), (6, 82, 2), (8, 80, 2), (10, 79, 2), (12, 76, 2), (14, 72, 2)],
]
ARP = [0, 2, 1, 2, 3, 2, 1, 2]

drums, bass, synth, padbus, fx, leadbus = Bus(), Bus(), Bus(), Bus(), Bus(), Bus()
K, C, H, HO = kick(), clap(), hat(), hat(True)
kick_times = []

def bar_t(b, step=0):
    return b * BAR + step * STEP

def drop_bar(b, local, heavy):
    ch = CHORDS[local % 4]
    # kick + 808
    pattern = [0, 6, 10] if local % 2 == 0 else [0, 3, 10, 14]
    for i, st in enumerate(pattern):
        tt = bar_t(b, st)
        drums.add(tt, K, 1.0); kick_times.append(tt)
        nxt = pattern[i + 1] if i + 1 < len(pattern) else 16
        glide = ch[1] + 12 if (st == 14) else None
        bass.add(tt, b808(ch[1] + 12 * (st == 14), (nxt - st) * STEP * 0.95, glide_from=None if glide is None else ch[1]), 0.9)
    # clap on beat 3
    drums.add(bar_t(b, 8), C, 0.8)
    if local % 4 == 3:
        drums.add(bar_t(b, 15), C, 0.35)
    # hats
    if local % 4 == 3:
        for k in range(12):  # triplet roll across the bar
            drums.add(b * BAR + k * BAR / 12, H, 0.45, pan=0.2)
    else:
        for st in range(0, 16, 2):
            drums.add(bar_t(b, st), H, 0.5 if st % 4 == 0 else 0.35, pan=0.2)
        if local % 2 == 1:
            for st in [12, 13, 14, 15]:
                drums.add(bar_t(b, st) + STEP / 2, H, 0.3, pan=0.2)
    drums.add(bar_t(b, 4), HO, 0.25, pan=-0.3)
    # stabs + pad + hook
    for st in [0, 3, 6, 10, 12]:
        for m in ch[2]:
            synth.add(bar_t(b, st), supersaw(m, STEP * 1.6, bright=5500 if heavy else 4200, r=0.08), 0.32)
    padbus.add(bar_t(b), pad(ch[0], BAR), 0.35)
    for st, m, ln in HOOK[local % 4]:
        leadbus.add(bar_t(b, st), lead(m, ln * STEP * 0.92), 0.30)
        if heavy:
            leadbus.add(bar_t(b, st), lead(m - 12, ln * STEP * 0.92), 0.18)

def arp_bar(b, local, gain=0.3, bright=3000):
    ch = CHORDS[local % 4]
    for k in range(8):
        m = ch[2][ARP[k] % 3] + (12 if ARP[k] == 3 else 0)
        synth.add(bar_t(b, k * 2), pluck(m, 0.3, bright), gain, pan=0.35 if k % 2 else -0.35)

# intro 0-7
for b in range(8):
    padbus.add(bar_t(b), pad(CHORDS[b % 4][0], BAR), 0.45)
    if b >= 2:
        arp_bar(b, b, 0.22, 1500 + 400 * b)
    if b >= 4:
        for st in range(0, 16, 2):
            drums.add(bar_t(b, st), H, 0.25, pan=0.2)
    if b in (4, 5):
        drums.add(bar_t(b, 0), K, 0.7); drums.add(bar_t(b, 8), K, 0.5)
fx.add(bar_t(6), noise_riser(2 * BAR), 0.55)
for k in range(16):  # accelerating snare roll in bar 7
    drums.add(bar_t(7) + BAR * (1 - (1 - k / 16) ** 1.4), C, 0.15 + 0.4 * k / 16)

# drop 1 8-23
fx.add(bar_t(8), impact(), 0.7)
for b in range(8, 24):
    drop_bar(b, b - 8, heavy=False)
fx.add(bar_t(24), downlift(), 1.0)

# break 24-31
for b in range(24, 32):
    local = b - 24
    padbus.add(bar_t(b), pad(CHORDS[local % 4][0], BAR), 0.5)
    arp_bar(b, local, 0.25, 2500)
    if local < 4:
        for st, m, ln in HOOK[local % 4]:
            leadbus.add(bar_t(b, st), pluck(m, ln * STEP + 0.2, 4000), 0.28, pan=0.1)
    else:
        for q in range(4 if local < 6 else 8):  # build: kicks 1/4 then 1/8
            drums.add(b * BAR + q * BAR / (4 if local < 6 else 8), K, 0.6)
fx.add(bar_t(28), noise_riser(4 * BAR), 0.6)
for k in range(32):
    drums.add(bar_t(30) + 2 * BAR * (1 - (1 - k / 32) ** 1.3), C, 0.1 + 0.45 * k / 32)

# drop 2 32-47
fx.add(bar_t(32), impact(), 0.8)
for b in range(32, 48):
    drop_bar(b, b - 32, heavy=True)

# outro 48-53
fx.add(bar_t(48), impact(), 0.8)
for b in range(48, 54):
    local = b - 48
    padbus.add(bar_t(b), pad(CHORDS[local % 4][0], BAR), 0.5 * (1 - local / 7))
    if local < 4:
        arp_bar(b, local, 0.22 * (1 - local / 5), 2200)
bass.add(bar_t(48), b808(29, BAR * 2), 0.8)
synth.add(bar_t(52), supersaw(65, BAR * 2, a=0.02, r=1.5, bright=3000), 0.3)
synth.add(bar_t(52), supersaw(72, BAR * 2, a=0.02, r=1.5, bright=3000), 0.3)

# ---------------- mix ----------------
# sidechain from kicks during drops
sc = np.ones(N)
tt = np.arange(N) / SR
for k in kick_times:
    i = int(k * SR); j = min(N, i + int(0.35 * SR))
    sc[i:j] = np.minimum(sc[i:j], 1 - 0.65 * np.exp(-(tt[i:j] - k) / 0.09))

# intro filter sweep on synth/pad, opening into drop 1
def intro_cut(ts):
    if ts < bar_t(8):
        return 400 * (10 ** (1.2 * ts / bar_t(8)))
    if bar_t(28) <= ts < bar_t(32):
        return 900 + 9000 * ((ts - bar_t(28)) / (4 * BAR)) ** 2
    return 14000

padbus.x = sweep_lp(padbus.x, intro_cut)
synth.x = sweep_lp(synth.x, intro_cut)

def reverb(x, secs=2.0, wet=0.25):
    t = t_arr(secs)
    ir = np.vstack([rng.standard_normal(len(t)), rng.standard_normal(len(t))]) * np.exp(-t / (secs / 5))
    ir = lp(ir, 6000)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    out = np.vstack([fftconvolve(x[0], ir[0])[:N], fftconvolve(x[1], ir[1])[:N]])
    return x + out * wet

mix = (drums.x * 0.9
       + bass.x * sc * 0.75
       + reverb(synth.x * sc, 1.6, 0.3) * 0.8
       + reverb(padbus.x * sc, 2.5, 0.5) * 0.55
       + reverb(leadbus.x, 1.4, 0.3) * 0.75
       + reverb(fx.x, 2.0, 0.3) * 0.8)
mix = hp(mix, 25)
print('pre-master peak %.2f  p99.9 %.2f' % (np.abs(mix).max(), np.percentile(np.abs(mix), 99.9)))
# Gain so the loudest 0.1% sits near full scale, then gentle soft clip.
mix /= np.percentile(np.abs(mix), 99.9)
mix = np.tanh(mix * 0.9) / np.tanh(0.9)
mix /= np.abs(mix).max() / 0.89
fade = np.clip((LEN - tt) / 1.5, 0, 1)
mix *= fade

out = (mix.T * 32767).astype(np.int16)
import wave
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(out.tobytes())
print('wrote', sys.argv[1], f'{LEN:.1f}s')
