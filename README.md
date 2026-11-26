# Karachi Traffic 3D

A stylized low-poly 3D arcade browser driving game set in Karachi, Pakistan. Pilot a 660cc Suzuki Alto, Rickshaw, or W-11 Minibus through chaotic Karachi traffic at 60 FPS on desktop and mobile browsers with unified Keyboard, Touch, Tilt, and Gamepad support.

### Live Playable Links
- **Play Online (PWA / Web):** [https://diabo205.github.io/traffic-game/](https://diabo205.github.io/traffic-game/)
- **Monsoon Mode (Direct Launch):** [https://diabo205.github.io/traffic-game/?monsoon](https://diabo205.github.io/traffic-game/?monsoon)
- **Single-File Standalone Build:** [https://diabo205.github.io/traffic-game/standalone.html](https://diabo205.github.io/traffic-game/standalone.html)

## Game Modes

| Mode | Description |
| --- | --- |
| **Free Roam · Saddar** *(default)* | Open-world 2×2 km street network built from real OpenStreetMap Saddar geometry with **31 authentic 3D landmarks** (*Mazar-e-Quaid, Frere Hall, Merewether Clock Tower, Karachi Arts Council, DJ Science College, Empress Market, St. Patrick's Cathedral, Saddar Dawakhana, Bohri Bazaar, Zainab Market, Regal Chowk, Paradise Cinema, Capri Cinema, Jehangir Park, Pakistan Chowk, Burns Road Food Street, Pakistan Secretariat, Cantt Station Bus Stop, Lucky Star Hotel, Sindh High Court, Karachi Grammar School, Karachi Press Club, Historic YMCA, Preedy Police Station, Passport Office Saddar, Rainbow Centre, Atrium Mall, Gul Plaza, Tibet Centre, Panorama Centre, Madina Mall*), the animated **Fawara Chowk** musical fountain, **6 overhead steel pedestrian bridges**, and **roadside Quetta chai dhabas** with rising samovar steam. Pick up Standard, **VIP (`2×` pay)**, and **2-stop Party** passengers, build **Fare Chain Fever (`1.0×`–`2.0×`)** streaks, and chain drifts, donuts, jumps, smashes, and near-misses for **S–D License Ranks**. |
| **Daily Saddar** | Deterministic UTC `YYYYMMDD` seed worldwide so everyone shares the exact same traffic, riders, and spawns each day (`DAILY` button or `?daily=1`). |
| **Route Run** | High-speed 4.2 km checkpoint sprint from Saddar over the Lyari Expressway and Shahrah-e-Faisal to Clifton (Teen Talwar). Dodge potholes, open manholes, standing water, and VIP roadblocks while keeping your car's integrity above zero before the checkpoint clock runs out. |

## Vehicles & Garage

Cumulative earnings bank across runs to unlock rides:
- **ALTO** (`Free`) — balanced 660cc all-rounder
- **RICKSHAW** (`Rs 400`) — agile gap-filterer
- **W-11** (`Rs 1,200`) — heavy traffic sweeper

## Quick Start

```bash
npm install
npm run dev              # http://localhost:5173 and LAN IP for phones on Wi-Fi
npm run build            # type-check (tsc --noEmit) + split production bundle + PWA assets in dist/
npm run pack             # build self-contained single-file HTML in dist/
npm run preview          # serve the production build (also exposed on LAN)
npm run playtest:metrics # run all headless sim feel probes
```

### URL Options

- `?mode=city` or `?mode=route` — launch directly into Free Roam or Route Run (defaults to last played, or `city`)
- `?daily=1` — play Daily Saddar with today's UTC seed
- `?tod=noon|sunset|night|monsoon` — start at a given time of day
- `?monsoon` — launch directly into Karachi Monsoon weather mode (rain curtain, lightning, wet asphalt reflections, and hydroplaning puddles)
- `?seed=123` — set deterministic world PRNG seed (default `1337`)
- `?low` / `?high` — force graphics quality tier (touch devices default to `low`)
- `?perf` — toggle FPS & draw-call HUD
- `?z=1500` — debug: start further along the corridor in Route Run mode

## Controls & Arcade Moves

| Action | Keyboard | Gamepad (Standard) | Mobile Touch |
| --- | --- | --- | --- |
| **Gas / Brake-Reverse** | `W` `↑` / `S` `↓` | `RT` / `LT` | `GAS` / `BRAKE` pedals (or Auto-Gas) |
| **Steer** | `A` `D` / `←` `→` | Left Stick (or D-Pad) | `◀` `▶` buttons, virtual joystick, or **Tilt** (gyro) |
| **Drift (Handbrake)** | `E` (or `W` + `S`) | `B` (or `RT` + `LT`) | `DRIFT` button |
| **Horn / Headlight Dipper** | `Space` / `F` or `Shift` | `A` / `X` | `📯` / `💡` buttons |
| **Radio (`DHOL FM` / `OFF`)** | `R` | `Y` | Options / Pause Menu (`RADIO`) |
| **Pause** | `Esc` or `P` | `Start` | `‖` (top-left) |
| **Confirm / Mute** | `Enter` / `M` | `A` or `Start` / `Back` | On-screen buttons |

- **Boosts:**
  - **Launch Boost:** Hold Brake + Gas at a standstill, then release Brake.
  - **Dash Boost:** Double-tap Gas while rolling at low speed.
  - **Drift Boost:** Power out of a drift held for longer than 0.7 s.
- **Horn (`Space`):** Encourages traffic ahead to pull over (`RAASTA DO!`).
- **Taxi Fares (Free Roam):** Come to a stop (<8 km/h) beside a marked kerbside passenger to board them, then stop inside the destination beam in front of their landmark to drop them off.

## Architecture & Tooling

- **`src/sim/` (Pure, Deterministic Simulation):** Runs at a fixed 60 Hz timestep using a seeded `mulberry32` PRNG (`src/sim/rng.ts`) and custom OBB/AABB collision math—zero imports from Three.js, DOM APIs, or `Math.random()`.
- **`src/render/` (Three.js Renderer):** Reads simulation snapshots and interpolates between ticks; combines procedural low-poly landmarks (`src/render/SaddarLandmarks.ts`, `src/render/Landmarks.ts`) with Blender-authored `.glb` vehicles (`alto.glb`, `rickshaw.glb`, `minibus.glb`, `bike.glb`, `cart.glb`, `car.glb`, `truck.glb`).
- **`src/audio/` (Procedural Web Audio):** Synthesizes spatial stereo engine revving, horn, tyre screech, crashes, monsoon rain/thunder, and a procedural **Karachi Dhol FM** (Dholak percussion + Benjo folk melody) radio without external audio assets.
- **Playtest Harness (`tools/playtest/`):** Headless simulation (`sim.mjs`), browser (`browser.mjs`), and feel metrics (`metrics.sh`) runners. See `playtests/PROTOCOL.md`.

See [`CLAUDE.md`](./CLAUDE.md) for architectural invariants and [`HANDOFF.md`](./HANDOFF.md) for a detailed codebase guide.

## Credits

- Player car model (`public/models/alto.glb`): [2017 Suzuki Alto Works](https://sketchfab.com/3d-models/2017-suzuki-alto-works-0fda9e9048524ddba8f13e64de958f70) by DisneyCars (`@supercarmodels`), licensed under CC Attribution.

Map geometry © OpenStreetMap contributors.
