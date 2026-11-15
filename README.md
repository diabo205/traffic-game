# Karachi Traffic 3D

A stylized low-poly 3D arcade browser driving game set in Karachi, Pakistan. Pilot a 660cc Suzuki Alto through chaotic Karachi traffic at 60 FPS on desktop and mobile browsers with unified Keyboard, Touch, and Gamepad support.

## Game Modes

| Mode | Description |
| --- | --- |
| **Free Roam · Saddar** *(default)* | Open-world street grid of Saddar with 14 authentic 3D landmarks (Empress Market, Bohri Bazaar, Zainab Market, Regal Chowk, St. Patrick's Cathedral, Saddar Dawakhana, Paradise Cinema, Cantt Station Bus Stop, Burns Road Food Street, Lucky Star Hotel, Jahangir Park, Sindh Secretariat, Capri Cinema, Pakistan Chowk). Pick up kerbside passengers, follow the HUD arrow and minimap route, beat fare timers for speed tips and bonus shift time, hit street and construction-yard ramps, smash ~460 street props, and chain stunts into up to a ×8 combo multiplier. |
| **Route Run** | High-speed 4.2 km checkpoint sprint from Saddar over the Lyari Expressway and Shahrah-e-Faisal to Clifton (Teen Talwar). Dodge potholes, open manholes, standing water, and VIP roadblocks while keeping your car's integrity above zero before the checkpoint clock runs out. |

## Quick Start

```bash
npm install
npm run dev      # http://localhost:5173 and your LAN IP (for phones on the same Wi-Fi)
npm run build    # type-check (tsc --noEmit) + production bundle in dist/
npm run preview  # serve the production build (also exposed on LAN)
```

### URL Options

- `?mode=city` or `?mode=route` — launch directly into Free Roam or Route Run (defaults to last played, or `city`)
- `?seed=123` — set deterministic world PRNG seed (default `1337`)
- `?low` / `?high` — force graphics quality tier (touch devices default to `low`)
- `?z=1500` — debug: start further along the corridor in Route Run mode

## Controls & Arcade Moves

| Action | Keyboard | Gamepad (Standard) | Mobile Touch |
| --- | --- | --- | --- |
| **Gas / Brake-Reverse** | `W` `↑` / `S` `↓` | `RT` / `LT` | `GAS` / `BRAKE` pedals |
| **Steer** | `A` `D` / `←` `→` | Left Stick (or D-Pad) | `◀` `▶` buttons or virtual joystick |
| **Drift (Handbrake)** | `E` (or `W` + `S`) | `B` (or `RT` + `LT`) | `DRIFT` button |
| **Horn / Headlight Dipper** | `Space` / `F` or `Shift` | `A` / `X` | `📯` / `💡` buttons |
| **Pause** | `Esc` or `P` | `Start` | `‖` (top-left) |
| **Confirm / Mute** | `Enter` / `M` | `A` or `Start` / `Back` | On-screen buttons |

- **Boosts:**
  - **Launch Boost:** Hold Brake + Gas at a standstill, then release Brake.
  - **Dash Boost:** Double-tap Gas while rolling at low speed.
  - **Drift Boost:** Power out of a drift held for longer than 0.7 s.
- **Horn (`Space`):** Encourages traffic ahead to pull over (`RAASTA DO!`).
- **Taxi Fares (Free Roam):** Come to a stop (<8 km/h) beside a marked kerbside passenger to board them, then stop inside the destination beam to drop them off.

## Architecture & Tooling

- **`src/sim/` (Pure, Deterministic Simulation):** Runs at a fixed 60 Hz timestep using a seeded `mulberry32` PRNG (`src/sim/rng.ts`) and custom OBB/AABB collision math—zero imports from Three.js, DOM APIs, or `Math.random()`.
- **`src/render/` (Three.js Renderer):** Reads simulation snapshots and interpolates between ticks; combines procedural low-poly geometry with Blender-authored `.glb` vehicles (`alto.glb`, `rickshaw.glb`, `minibus.glb`).
- **`src/audio/` (Procedural Web Audio):** Synthesizes engine revving, horn, tyre screech, crashes, and UI chimes without external audio assets.
- **Blender Model Pipeline (`tools/blender/`):** Headless Python `bpy` scripts generate `public/models/*.glb`. Use `tools/glb2json.mjs` with `VITE_MODEL_EXT=json` when deploying to static hosts that do not serve `.glb` binaries.
- **Playtest Harness (`tools/playtest/`):** Headless simulation (`sim.mjs`), browser (`browser.mjs`), and feel metrics (`metrics.sh`) runners. See `playtests/PROTOCOL.md`.

See [`CLAUDE.md`](./CLAUDE.md) for architectural invariants and [`HANDOFF.md`](./HANDOFF.md) for a detailed codebase guide.

