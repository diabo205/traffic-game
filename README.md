# Karachi Traffic 3D

Low-poly 3D browser driving game set in Karachi.

## Modes
- **Free Roam Saddar (default):** Drive a 2×2 km road network built from real Saddar geometry around Empress Market, pick up Standard, **VIP (`2×` pay)**, and **2-stop Party** passengers before their meter runs out, build **Fare Chain Fever (`1.0×`–`2.0×`)** streaks, and chain drifts, donuts, jumps, smashes, and near-misses for bonus tips and **S–D License Ranks**.
- **Daily Saddar:** Same deterministic UTC `YYYYMMDD` seed worldwide so everyone shares the exact same traffic, riders, and spawns each day (`DAILY` button or `?daily=1`).
- **Route Run:** 4.2 km checkpoint dash from Saddar over the Lyari Expressway & Shahrah-e-Faisal to Clifton's Teen Talwar before the clock hits zero.

## Vehicles & Garage
Cumulative earnings bank across runs to unlock rides:
- **ALTO** (`Free`) — balanced 660cc all-rounder
- **RICKSHAW** (`Rs 400`) — agile gap-filterer
- **W-11** (`Rs 1,200`) — heavy traffic sweeper

## Controls & Features
- **Keyboard:** `W`/`↑` gas, `S`/`↓` brake/reverse, `A`/`D` or `←`/`→` steer, `E` drift, `Space` horn, `F`/`Shift` dipper, `M` mute, `Esc` pause.
- **Moves:** **Drift** (gas + brake + steer at speed, power out for boost), **Launch** (hold brake + gas stopped, release brake), **Dash** (double-tap gas out of corners).
- **Touch / Mobile / Gamepad:** On-screen **Buttons**, **Joystick**, or **Tilt** (gyro steering with portrait/landscape mapping & `ZERO TILT` recalibration), optional **Auto-Gas**, guarded **Haptics**, offline **PWA** installability (`manifest.webmanifest` + `sw.js`), and spatial stereo audio; standard gamepad supported.

## Development
```bash
npm install
npm run dev              # http://localhost:5173 and LAN IP for phones on Wi-Fi
npm run build            # type-check + production bundle + PWA assets in dist/
npm run preview          # serve dist/ on LAN
npm run playtest:metrics # run all headless sim feel probes
```

URL options: `?mode=city|route`, `?daily=1`, `?seed=123`, `?low` / `?high` (graphics tier), `?z=1500` (debug route start).

See [CLAUDE.md](CLAUDE.md) for architecture rules (`src/sim/` is pure, deterministic TypeScript; `src/render/` only reads it).

Map geometry © OpenStreetMap contributors.
