import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { BAR, BEAT, DURATION, KICKS, bar, pulse } from './timing';
import { BODY, C, Caption, Chip, DISPLAY, Flash, MONO, Shot, Slam, StripeWipe, TruckBorder, URDU, ease, useShake } from './ui';

const shot = (id: string) => `shots/${id}.jpg`;

/** All 16 commits, with the bar where the video reaches them. */
const COMMITS: { hash: string; label: string; at: number }[] = [
  { hash: 'de5ead4', label: 'Initial commit', at: 0 },
  { hash: 'ca5f8c4', label: 'Project guide', at: 10 },
  { hash: 'b7b35d5', label: 'Playable MVP', at: 12 },
  { hash: '73271a9', label: 'Readable potholes', at: 14 },
  { hash: '2c402ba', label: 'Karachi landmarks', at: 16 },
  { hash: 'e3a11cf', label: 'Lyari & Faisal', at: 18 },
  { hash: '13eedd5', label: 'Reference photos', at: 19 },
  { hash: 'fcd0f00', label: 'Alto in Blender', at: 20 },
  { hash: 'f1f001f', label: 'Brochure details', at: 21 },
  { hash: '0f603bc', label: 'Sazgar rickshaw', at: 21.5 },
  { hash: '879371c', label: 'Ignore pycache', at: 21.6 },
  { hash: 'ab99422', label: 'Smooth Alto', at: 21.7 },
  { hash: 'f23a3c0', label: 'Truck-art minibus', at: 23 },
  { hash: 'd20d07b', label: 'Free roam', at: 28 },
  { hash: 'e8765c8', label: 'Taxi fares', at: 36 },
  { hash: '2e5aa63', label: 'Game feel', at: 40 },
];

// ------------------------------------------------------------------ intro
const TERMINAL = [
  { at: bar(0, 0), text: '$ git log --reverse', color: C.white },
  { at: bar(0, 2), text: 'de5ead4  2026-11-12 12:28  Initial commit', color: C.yellow },
  { at: bar(1, 0), text: '$ cat README.md', color: C.white },
  { at: bar(1, 2), text: '# traffic-game', color: C.teal },
];

const Intro: React.FC<{ f: number }> = ({ f }) => {
  const stats = [
    { at: bar(4), big: '16', small: 'COMMITS', color: C.pink },
    { at: bar(5), big: '12,412', small: 'LINES OF CODE', color: C.yellow },
    { at: bar(6), big: '3', small: 'BLENDER MODELS', color: C.teal },
  ];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 80px), repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 80px)`,
          transform: `translateY(${(f * 0.5) % 80 - 80}px)`,
          opacity: ease(f, 0, 40),
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 60%, rgba(255,46,136,${0.08 + 0.1 * ease(f, bar(4), bar(8), 0, 1)}) 0%, transparent 60%)` }} />
      {/* bars 0-1: terminal */}
      {f < bar(2) && (
        <AbsoluteFill style={{ padding: '300px 260px', fontFamily: MONO, fontSize: 48, lineHeight: 1.6 }}>
          {TERMINAL.map((l) => {
            if (f < l.at) return null;
            const n = Math.floor(interpolate(f - l.at, [0, 10], [0, l.text.length], { extrapolateRight: 'clamp' }));
            return (
              <div key={l.text} style={{ color: l.color }}>
                {l.text.slice(0, n)}
                {n < l.text.length || (l === TERMINAL[3] && Math.floor(f / 8) % 2 === 0) ? '▌' : ''}
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      {/* bars 2-3: the empty repo */}
      {f >= bar(2) && f < bar(4) && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontFamily: BODY, fontWeight: 300, fontSize: 70, color: C.white, opacity: ease(f, bar(2), bar(2) + 14) }}>
            Nov 12. <b style={{ fontWeight: 800 }}>An empty repo.</b>
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 300,
              fontSize: 54,
              marginTop: 30,
              color: C.yellow,
              opacity: ease(f, bar(3), bar(3) + 14),
              transform: `translateY(${ease(f, bar(3), bar(3) + 14, 30, 0)}px)`,
            }}
          >
            49 hours later…
          </div>
        </AbsoluteFill>
      )}
      {/* bars 4-6: stat counters */}
      {stats.map((s, i) => {
        if (f < s.at || f >= s.at + BAR) return null;
        const num = Number(s.big.replace(/,/g, ''));
        const v = Math.round(num * ease(f, s.at, s.at + 20, 0, 1, Easing.out(Easing.quad)));
        return (
          <AbsoluteFill key={i} style={{ justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ transform: `scale(${1 + pulse(f, KICKS, 5) * 0.05})`, textAlign: 'center' }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 300, color: s.color, lineHeight: 1 }}>{v.toLocaleString('en-US')}</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 80, color: C.white, letterSpacing: 8 }}>{s.small}</div>
            </div>
          </AbsoluteFill>
        );
      })}
      {/* bar 7: countdown over the snare roll */}
      {f >= bar(7) && f < bar(8) && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          {['3', '2', '1', ''].map((n, i) => {
            const at = bar(7, i);
            if (f < at || f >= at + BEAT) return null;
            return (
              <div key={i} style={{ fontFamily: DISPLAY, fontSize: 420, color: [C.pink, C.yellow, C.teal][i], transform: `scale(${ease(f, at, at + BEAT, 1.4, 0.9)})` }}>
                {n}
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      <Flash f={f} at={bar(4)} len={8} color={C.pink} />
      <Flash f={f} at={bar(5)} len={8} color={C.yellow} />
      <Flash f={f} at={bar(6)} len={8} color={C.teal} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ scene helpers
type Cut = { at: number; src: string; dir?: number; blur?: number; dim?: number };
/** Render whichever cut is current. */
const Cuts: React.FC<{ f: number; cuts: Cut[]; end: number; zoom?: number }> = ({ f, cuts, end, zoom }) => {
  let idx = -1;
  for (let i = 0; i < cuts.length; i++) if (f >= cuts[i].at) idx = i;
  if (idx < 0) return null;
  const c = cuts[idx];
  const next = idx + 1 < cuts.length ? cuts[idx + 1].at : end;
  return <Shot f={f} start={c.at} dur={next - c.at} src={c.src} dir={c.dir ?? (idx % 2 ? -1 : 1)} blur={c.blur} dim={c.dim} zoom={zoom} />;
};

const Lower: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'absolute', left: 70, bottom: 150, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>{children}</div>
);

const Center: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', ...style }}>{children}</AbsoluteFill>
);

/** Pick the item whose start frame is the latest one reached. */
function current<T extends { at: number }>(f: number, items: T[]): T | undefined {
  let out: T | undefined;
  for (const it of items) if (f >= it.at) out = it;
  return out;
}

// ------------------------------------------------------------------ drop 1
const Title: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill>
    <Shot f={f} start={bar(8)} dur={BAR * 2} src={shot('12_juice-speed_1')} blur={6} dim={0.35} />
    <Center>
      <Slam f={f} start={bar(8)} size={210}>
        Karachi Traffic <span style={{ color: C.yellow }}>3D</span>
      </Slam>
      {f >= bar(8, 2) && (
        <div style={{ fontFamily: URDU, fontSize: 88, color: C.white, direction: 'rtl', marginTop: 10, opacity: ease(f, bar(8, 2), bar(8, 3)) }}>
          کراچی ٹریفک
        </div>
      )}
      <div style={{ marginTop: 30 }}>
        <Caption f={f} start={bar(9)} text="The development journey" color={C.pink} size={70} />
      </div>
    </Center>
  </AbsoluteFill>
);

const RULES = [
  { at: bar(10, 0), text: 'Simulation is pure + deterministic', color: C.yellow },
  { at: bar(10, 2), text: 'One input frame: keys · touch · gamepad', color: C.teal },
  { at: bar(11, 0), text: "Swap the models, never the gameplay", color: C.pink },
  { at: bar(11, 2), text: '60 FPS. On a phone.', color: C.orange },
];
const Rules: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill style={{ background: C.bg }}>
    <AbsoluteFill
      style={{
        backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 80px), repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 80px)`,
        transform: `translateY(${(f % 80) - 80}px)`,
      }}
    />
    <Chip f={f} start={bar(10)} phase="PHASE 0 · THE RULES" hash="ca5f8c4 CLAUDE.md" color={C.yellow} />
    <div style={{ position: 'absolute', left: 120, top: 250 }}>
      {RULES.map((r, i) => (
        <div key={i} style={{ marginBottom: 26 }}>
          <Slam f={f} start={r.at} size={104} color={r.color} style={{ transformOrigin: 'left center' }}>
            {r.text}
          </Slam>
        </div>
      ))}
    </div>
  </AbsoluteFill>
);

const MVP_CUTS: Cut[] = [
  { at: bar(12, 0), src: shot('01_mvp-saddar_title') },
  { at: bar(12, 2), src: shot('01_mvp-saddar') },
  { at: bar(13, 0), src: shot('01_mvp-lyari') },
  { at: bar(13, 2), src: shot('01_mvp-faisal') },
  { at: bar(14, 0), src: shot('02_pothole-saddar_1') },
  { at: bar(15, 0), src: shot('02_pothole-saddar_2') },
];
const MvpCaps = [
  { at: bar(12, 0), el: (f: number) => <Chip f={f} start={bar(12)} phase="PHASE 1 · PLAYABLE MVP" hash="b7b35d5" color={C.pink} /> },
];
const Mvp: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill>
    <Cuts f={f} cuts={MVP_CUTS} end={bar(16)} />
    {f < bar(14) ? (
      <>
        {MvpCaps[0].el(f)}
        <Lower>
          <Slam f={f} start={bar(12, 1)} size={120} style={{ transformOrigin: 'left' }}>
            Saddar → Lyari → Clifton
          </Slam>
          <Caption f={f} start={bar(13)} text="Beat the checkpoint clock in a 660cc Alto" />
        </Lower>
      </>
    ) : (
      <>
        <Chip f={f} start={bar(14)} phase="READABILITY PASS" hash="73271a9" color={C.teal} />
        <Lower>
          <Slam f={f} start={bar(14)} size={120} style={{ transformOrigin: 'left' }}>
            Potholes you can see
          </Slam>
          <Caption f={f} start={bar(15)} text="Chase cam 6.4 m → 5.0 m" color={C.teal} />
        </Lower>
      </>
    )}
  </AbsoluteFill>
);

const KHI = [
  { at: bar(16, 0), src: shot('03_landmarks-empress'), name: 'Empress Market', hash: '2c402ba' },
  { at: bar(16, 2), src: shot('03_landmarks-saddar'), name: 'Saddar street life', hash: '2c402ba' },
  { at: bar(17, 0), src: shot('03_landmarks-mazar'), name: 'Mazar-e-Quaid', hash: '2c402ba' },
  { at: bar(17, 2), src: shot('03_landmarks-karsaz'), name: 'Karsaz flyover', hash: '2c402ba' },
  { at: bar(18, 0), src: shot('04_lyari-toll'), name: 'Lyari toll plaza', hash: 'e3a11cf' },
  { at: bar(18, 2), src: shot('04_lyari-talwar'), name: 'Teen Talwar', hash: 'e3a11cf' },
  { at: bar(19, 0), src: shot('05_reference-saddar'), name: 'Matched to real photos', hash: '13eedd5' },
  { at: bar(19, 2), src: shot('05_reference-faisal'), name: 'Shahrah-e-Faisal', hash: '13eedd5' },
];
const Karachi: React.FC<{ f: number }> = ({ f }) => {
  const cur = current(f, KHI)!;
  return (
    <AbsoluteFill>
      <Cuts f={f} cuts={KHI} end={bar(20)} />
      <Chip f={f} start={bar(16)} phase="PHASE 2 · MAKE IT KARACHI" hash={cur.hash} color={C.orange} />
      <Lower>
        <Slam key={cur.at} f={f} start={cur.at} size={130} style={{ transformOrigin: 'left' }}>
          {cur.name}
        </Slam>
      </Lower>
    </AbsoluteFill>
  );
};

/** Before / after wipe of the Alto. */
const AltoWipe: React.FC<{ f: number }> = ({ f }) => {
  const p = ease(f, bar(20, 1), bar(20, 3), 0, 1, Easing.inOut(Easing.cubic));
  return (
    <AbsoluteFill>
      <Shot f={f} start={bar(20)} dur={BAR} src={shot('01_mvp-saddar')} zoom={0.05} />
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` }}>
        <Shot f={f} start={bar(20)} dur={BAR} src={shot('08_smooth-alto_1')} zoom={0.05} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(1 - p) * 100}%`, width: 10, background: C.yellow, boxShadow: `0 0 40px ${C.yellow}` }} />
      <div style={{ position: 'absolute', left: 70, top: 160, fontFamily: DISPLAY, fontSize: 70, color: C.white, opacity: 1 - p }}>BEFORE: A BOX</div>
      <div style={{ position: 'absolute', right: 70, top: 160, fontFamily: DISPLAY, fontSize: 70, color: C.yellow, opacity: p }}>AFTER: BLENDER</div>
    </AbsoluteFill>
  );
};

const BLENDER = [
  { at: bar(21, 0), src: shot('06_altoglb-alto_1'), name: 'Alto, built in bpy', sub: 'Headless Blender → alto.glb', hash: 'fcd0f00' },
  { at: bar(21, 2), src: shot('08_smooth-alto_2'), name: '121 cross-sections', sub: 'Rebuilt from the real car’s dimensions', hash: 'ab99422' },
  { at: bar(22, 0), src: shot('07_rickshaw-saddar_2'), name: 'Sazgar rickshaw', sub: '4 liveries · driver · open back', hash: '0f603bc' },
  { at: bar(23, 0), src: shot('09_minibus-saddar_3'), name: 'Truck-art minibus', sub: 'Peacocks · roof riders · 7.4 m', hash: 'f23a3c0' },
];
const Blender: React.FC<{ f: number }> = ({ f }) => {
  if (f < bar(21)) return <AltoWipe f={f} />;
  const cur = current(f, BLENDER)!;
  return (
    <AbsoluteFill>
      <Cuts f={f} cuts={BLENDER} end={bar(24)} />
      <Chip f={f} start={bar(21)} phase="PHASE 3 · BUILT IN BLENDER" hash={cur.hash} color={C.teal} />
      <Lower>
        <Slam key={cur.at} f={f} start={cur.at} size={130} style={{ transformOrigin: 'left' }}>
          {cur.name}
        </Slam>
        <Caption key={'c' + cur.at} f={f} start={cur.at + 6} text={cur.sub} color={C.teal} size={56} />
      </Lower>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ break + build
const CITY_WORDS = ['Junctions', 'Lanes', 'Roundabout', 'Back alleys', 'Traffic that turns', 'Takes turns', 'Changes lanes', 'Breaks deadlocks'];
const Break: React.FC<{ f: number }> = ({ f }) => {
  if (f < bar(28)) {
    const o = ease(f, bar(24), bar(25));
    return (
      <AbsoluteFill style={{ background: C.bg }}>
        <AbsoluteFill style={{ opacity: o * 0.8 }}>
          <Shot f={f} start={bar(24)} dur={BAR * 4} src={shot('10_city-city_title')} blur={10} dim={0.4} zoom={0.25} punch={0} />
        </AbsoluteFill>
        <Center>
          <div style={{ fontFamily: BODY, fontWeight: 300, fontSize: 90, color: C.white, opacity: ease(f, bar(24, 1), bar(25)) }}>
            Then the road…
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 170,
              color: C.yellow,
              marginTop: 20,
              opacity: ease(f, bar(26), bar(26, 2)),
              letterSpacing: interpolate(f, [bar(26), bar(28)], [30, 6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}
          >
            BECAME A CITY
          </div>
        </Center>
      </AbsoluteFill>
    );
  }
  // build: words on quarter notes (bars 28-29), city flashes on eighths (bars 30-31)
  if (f < bar(30)) {
    const i = Math.floor((f - bar(28)) / BEAT);
    return (
      <AbsoluteFill style={{ background: i % 2 ? C.bg : '#16121f' }}>
        <Chip f={f} start={bar(28)} phase="PHASE 4 · OPEN CITY" hash="d20d07b" color={C.green} />
        <Center>
          <Slam key={i} f={f} start={bar(28) + i * BEAT} size={170} color={[C.white, C.yellow, C.teal, C.pink][i % 4]}>
            {CITY_WORDS[i % CITY_WORDS.length]}
          </Slam>
        </Center>
      </AbsoluteFill>
    );
  }
  const flashes = ['10_city-city', '10_city-city_1', '10_city-city_2', '10_city-city_3', '10_city-city_4', '11_fares-fares_1', '11_fares-fares_2', '12_juice-drift'];
  const step = BEAT / 2;
  const j = Math.floor((f - bar(30)) / step);
  const z = ease(f, bar(30), bar(32), 1, 1.6, Easing.in(Easing.quad));
  return (
    <AbsoluteFill style={{ transform: `scale(${z})` }}>
      <Shot f={f} start={bar(30) + j * step} dur={step} src={shot(flashes[j % flashes.length])} punch={0} />
      <Center>
        <div style={{ fontFamily: DISPLAY, fontSize: 150, color: C.white, opacity: f > bar(31) ? 1 : 0, textShadow: '0 0 40px #000' }}>
          {['FREE', 'FREE', 'ROAM', 'ROAM', '·', '·', '!!', '!!'][Math.floor((f - bar(31)) / (BEAT / 2)) % 8]}
        </div>
      </Center>
      <AbsoluteFill style={{ background: C.white, opacity: ease(f, bar(31, 3), bar(32), 0, 1, Easing.in(Easing.quad)) }} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ drop 2
const ROAM_CUTS: Cut[] = [
  { at: bar(32, 0), src: shot('10_city-city') },
  { at: bar(33, 0), src: shot('10_city-city_1') },
  { at: bar(33, 2), src: shot('10_city-city_2') },
  { at: bar(34, 0), src: shot('10_city-city_3') },
  { at: bar(35, 0), src: shot('10_city-city_4') },
];
const Roam: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill>
    <Cuts f={f} cuts={ROAM_CUTS} end={bar(36)} />
    {f < bar(33) ? (
      <Center>
        <Slam f={f} start={bar(32)} size={260} color={C.yellow}>
          Free Roam
        </Slam>
        <Caption f={f} start={bar(32, 2)} text="Saddar street grid" color={C.green} size={70} />
      </Center>
    ) : (
      <>
        <Chip f={f} start={bar(33)} phase="PHASE 4 · OPEN CITY" hash="d20d07b" color={C.green} />
        <Lower>
          <Slam f={f} start={bar(33)} size={110} style={{ transformOrigin: 'left' }}>
            A real road graph
          </Slam>
          <Caption f={f} start={bar(34)} text="Lanes · junctions · solid buildings · kerb jolts" color={C.green} size={54} />
        </Lower>
      </>
    )}
  </AbsoluteFill>
);

const FARES = [
  { at: bar(36), src: shot('11_fares-fares'), text: 'Pick up passengers' },
  { at: bar(37), src: shot('11_fares-fares_2'), text: '14 Saddar destinations' },
  { at: bar(38), src: shot('11_fares-fares_4'), text: 'Tips for speed' },
  { at: bar(39), src: shot('11_fares-fares_5'), text: 'Wreck it → towed + repair bill' },
];
const Fares: React.FC<{ f: number }> = ({ f }) => {
  const cur = current(f, FARES)!;
  const money = Math.round(ease(f, bar(36), bar(40), 0, 4850, Easing.linear) / 10) * 10;
  return (
    <AbsoluteFill>
      <Cuts f={f} cuts={FARES} end={bar(40)} />
      <Chip f={f} start={bar(36)} phase="TAXI FARES" hash="e8765c8" color={C.yellow} />
      <div style={{ position: 'absolute', right: 80, top: 50, fontFamily: DISPLAY, fontSize: 110, color: C.green, textShadow: '0 4px 30px #000', transform: `scale(${1 + pulse(f, KICKS, 4) * 0.08})` }}>
        Rs {money.toLocaleString('en-US')}
      </div>
      <Lower>
        <Slam key={cur.at} f={f} start={cur.at} size={120} style={{ transformOrigin: 'left' }}>
          {cur.text}
        </Slam>
        {f >= bar(37) && <Caption f={f} start={bar(37, 2)} text="Shift clock instead of game over" color={C.yellow} size={52} />}
      </Lower>
    </AbsoluteFill>
  );
};

const FEEL = [
  { at: bar(40), src: shot('12_juice-drift'), text: 'Spring chase camera' },
  { at: bar(41), src: shot('12_juice-drift_2'), text: 'Tyre smoke' },
  { at: bar(42), src: shot('12_juice-drift_3'), text: 'Skid marks' },
  { at: bar(43), src: shot('12_juice-speed_2'), text: 'Body roll + FOV kick' },
];
const Feel: React.FC<{ f: number }> = ({ f }) => {
  const cur = current(f, FEEL)!;
  return (
    <AbsoluteFill style={{ transform: useShake(f, 1.6) }}>
      <Cuts f={f} cuts={FEEL} end={bar(44)} zoom={0.3} />
      <Chip f={f} start={bar(40)} phase="PHASE 5 · GAME FEEL" hash="2e5aa63" color={C.pink} />
      <Lower>
        <Slam key={cur.at} f={f} start={cur.at} size={140} color={C.white} style={{ transformOrigin: 'left' }}>
          {cur.text}
        </Slam>
      </Lower>
    </AbsoluteFill>
  );
};

/** One shot per beat, oldest to newest. */
const EVOLUTION: { src: string; hash: string; date: string }[] = [
  { src: '01_mvp-saddar', hash: 'b7b35d5', date: 'NOV 12 08:04' },
  { src: '01_mvp-lyari', hash: 'b7b35d5', date: 'NOV 12 08:04' },
  { src: '02_pothole-saddar', hash: '73271a9', date: 'NOV 12 08:30' },
  { src: '03_landmarks-empress', hash: '2c402ba', date: 'NOV 12 08:53' },
  { src: '03_landmarks-mazar', hash: '2c402ba', date: 'NOV 12 08:53' },
  { src: '04_lyari-lyari', hash: 'e3a11cf', date: 'NOV 12 11:00' },
  { src: '04_lyari-faisal', hash: 'e3a11cf', date: 'NOV 12 11:00' },
  { src: '05_reference-lyari', hash: '13eedd5', date: 'NOV 12 12:10' },
  { src: '06_altoglb-alto', hash: 'fcd0f00', date: 'NOV 12 12:47' },
  { src: '07_rickshaw-saddar', hash: '0f603bc', date: 'NOV 13 09:26' },
  { src: '08_smooth-alto', hash: 'ab99422', date: 'NOV 13 09:37' },
  { src: '09_minibus-faisal_1', hash: 'f23a3c0', date: 'NOV 14 11:16' },
  { src: '10_city-city_2', hash: 'd20d07b', date: 'NOV 14 13:30' },
  { src: '11_fares-fares_3', hash: 'e8765c8', date: 'NOV 14 13:41' },
  { src: '12_juice-drift_1', hash: '2e5aa63', date: 'NOV 14 13:47' },
  { src: '12_juice-speed', hash: '2e5aa63', date: 'NOV 14 13:47' },
];
const Evolution: React.FC<{ f: number }> = ({ f }) => {
  const i = Math.min(15, Math.floor((f - bar(44)) / BEAT));
  const e = EVOLUTION[i];
  const at = bar(44) + i * BEAT;
  return (
    <AbsoluteFill>
      <Shot f={f} start={at} dur={BEAT} src={shot(e.src)} zoom={0.08} />
      <div style={{ position: 'absolute', right: 70, top: 60, textAlign: 'right' }}>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 64, color: C.yellow, textShadow: '0 4px 20px #000' }}>{e.hash}</div>
        <div style={{ fontFamily: MONO, fontSize: 40, color: C.white, textShadow: '0 4px 20px #000' }}>{e.date}</div>
      </div>
      <Lower>
        <Slam f={f} start={bar(44)} size={150}>
          49 hours
        </Slam>
        <Caption f={f} start={bar(46)} text="From an empty repo to an open city" color={C.pink} size={64} />
      </Lower>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ outro
const Outro: React.FC<{ f: number }> = ({ f }) => {
  const stats = [
    ['16', 'commits'],
    ['12,412', 'lines'],
    ['3', 'Blender models'],
    ['2', 'game modes'],
  ];
  const fadeOut = ease(f, DURATION - 40, DURATION, 1, 0);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: fadeOut }}>
      <AbsoluteFill style={{ opacity: 0.35 }}>
        <Shot f={f} start={bar(48)} dur={BAR * 6 + 60} src={shot('12_juice-title_title')} blur={8} dim={0.4} zoom={0.1} punch={0} />
      </AbsoluteFill>
      <Center style={{ paddingBottom: 60 }}>
        <Slam f={f} start={bar(48)} size={190}>
          Karachi Traffic <span style={{ color: C.yellow }}>3D</span>
        </Slam>
        <div style={{ display: 'flex', gap: 70, marginTop: 50 }}>
          {stats.map(([n, l], i) => {
            const at = bar(49, i);
            return (
              <div key={l} style={{ opacity: ease(f, at, at + 8), transform: `translateY(${ease(f, at, at + 10, 40, 0)}px)` }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 120, color: [C.pink, C.yellow, C.teal, C.orange][i] }}>{n}</div>
                <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 34, color: C.white, textTransform: 'uppercase', letterSpacing: 4 }}>{l}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 70, fontFamily: BODY, fontWeight: 300, fontSize: 52, color: C.white, opacity: ease(f, bar(51), bar(51, 2)) }}>
          Next stop: <b style={{ color: C.yellow, fontWeight: 800 }}>wherever the Alto goes.</b>
        </div>
      </Center>
      <TruckBorder f={f} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ timeline HUD
const Timeline: React.FC<{ f: number }> = ({ f }) => {
  const b = f / BAR;
  const sorted = COMMITS; // chronological
  let active = 0;
  sorted.forEach((c, i) => {
    if (b >= c.at) active = i;
  });
  const o = ease(f, bar(10), bar(10) + 10) * ease(f, bar(47, 3), bar(48), 1, 0) * (f >= bar(24) && f < bar(28) ? 0.25 : 1);
  return (
    <div style={{ position: 'absolute', left: 70, right: 70, bottom: 55, height: 50, opacity: o }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 18, height: 4, background: 'rgba(255,255,255,0.25)' }} />
      <div style={{ position: 'absolute', left: 0, width: `${(active / (sorted.length - 1)) * 100}%`, top: 18, height: 4, background: C.yellow }} />
      {sorted.map((c, i) => {
        const on = i <= active;
        return (
          <div
            key={c.hash}
            style={{
              position: 'absolute',
              left: `${(i / (sorted.length - 1)) * 100}%`,
              top: i === active ? 6 : 12,
              width: i === active ? 28 : 16,
              height: i === active ? 28 : 16,
              marginLeft: i === active ? -14 : -8,
              borderRadius: '50%',
              background: on ? C.yellow : '#3a3546',
              boxShadow: i === active ? `0 0 ${20 + pulse(f, KICKS, 5) * 30}px ${C.yellow}` : 'none',
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: `${(active / (sorted.length - 1)) * 100}%`,
          transform: `translateX(${active > 12 ? '-100%' : active < 2 ? '0' : '-50%'})`,
          top: -40,
          fontFamily: MONO,
          fontSize: 24,
          fontWeight: 700,
          color: C.white,
          whiteSpace: 'nowrap',
          textShadow: '0 2px 10px #000',
        }}
      >
        {sorted[active].hash} · {sorted[active].label}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ main
export const DevJourney: React.FC = () => {
  const f = useCurrentFrame();
  const inBar = (a: number, b: number) => f >= bar(a) && f < bar(b);
  const shake = f >= bar(8) && f < bar(48) && !(f >= bar(24) && f < bar(32)) ? useShake(f, 0.6) : 'none';
  const wipes = [bar(10), bar(12), bar(16), bar(20), bar(36), bar(40), bar(44)];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile('hype.wav')} />
      <AbsoluteFill style={{ transform: shake }}>
        {inBar(0, 8) && <Intro f={f} />}
        {inBar(8, 10) && <Title f={f} />}
        {inBar(10, 12) && <Rules f={f} />}
        {inBar(12, 16) && <Mvp f={f} />}
        {inBar(16, 20) && <Karachi f={f} />}
        {inBar(20, 24) && <Blender f={f} />}
        {inBar(24, 32) && <Break f={f} />}
        {inBar(32, 36) && <Roam f={f} />}
        {inBar(36, 40) && <Fares f={f} />}
        {inBar(40, 44) && <Feel f={f} />}
        {inBar(44, 48) && <Evolution f={f} />}
      </AbsoluteFill>
      {f >= bar(48) && <Outro f={f} />}
      {f < bar(48) && <Timeline f={f} />}
      {(inBar(8, 24) || inBar(32, 48)) && <TruckBorder f={f} />}
      {wipes.map((w) => (
        <StripeWipe key={w} f={f} at={w} />
      ))}
      <Flash f={f} at={bar(8)} len={14} />
      <Flash f={f} at={bar(32)} len={16} />
      <Flash f={f} at={bar(48)} len={14} />
      <Flash f={f} at={bar(24)} len={20} color={C.bg} />
    </AbsoluteFill>
  );
};
