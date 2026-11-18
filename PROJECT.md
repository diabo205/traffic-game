# Project: Karachi Traffic 3D — NFS Heat-Inspired Car Selection Screen

## Architecture
- **Pure Simulation (`src/sim/`)**: Deterministic 60 Hz TypeScript with zero `three`, DOM, `window`, `document`, `Math.random`, or `Date.now`/`performance.now` imports (`CLAUDE.md` invariant). Owns `PlayerVehicle` union, `VehicleSpec` (kinematics, per-vehicle boost/nitrous, off-road grip/drag, drift tuning), `VEHICLE_COST`, and pure `VehicleShowcaseMeta` display stats/ratings (`brand`, `model`, `perfRating`, `stats`, `handlingGrid`, `customizationRating`, `paintHex`).
- **3D Rendering & Audio (`src/render/`, `src/audio/`)**: Single `WebGLRenderer` inside `Renderer`. Normal gameplay/weather-screen renders `this.scene` with `ChaseCamera`; when car selection showcase is active (`renderer.setGarageMode(...)`), renders `GarageScene` (industrial warehouse bay, reflective concrete floor, cyan/magenta neon lighting, 3/4 hero vehicle, adjacent parked vehicle(s), weather-aware headlights) and projects 3D roof anchor coordinates `(activeTagPos, adjTagPos)` to normalized/pixel viewport coordinates. `VehicleFactory`, `TyreFx`, and `SoundEngine` use data tables keyed by `PlayerVehicle`.
- **UI, Input & Flow (`src/ui/`, `src/input/`, `src/Game.ts`)**: Vanilla DOM/CSS overlay (`#ui`, `@fontsource/barlow-condensed`). Pre-game flow (`phase === 'ready'`) splits into two steps:
  1. `startScreen` (Mode + Weather/Time-of-Day selection -> `PLAY` / `DAILY` / `OPTIONS`)
  2. `carSelectScreen` (`CarSelectScreen`: NFS Heat-style left translucent stats panel, 4 stat bars, 2D diamond handling grid, 10-segment customization bar, floating 3D-projected nameplate + cyan gear badge + cycle arrows, adjacent car pin, bottom-left `SELECT` / `BACK` controls).
  Confirming an unlocked vehicle commits `this.vehicle`, exits garage mode, ensures `world` uses the chosen vehicle, and calls `world.start()`.
- **E2E Testing Track (`tools/test/`, `tools/playtest/`)**: Requirement-driven opaque-box tests (Tiers 1–4) using `node:test` + Vite SSR sim checks + headless Chromium CDP browser verification (`tools/playtest/browser.mjs` & dedicated E2E car-selection suite) against desktop and mobile viewports.

## Code Layout
```
src/
├── main.ts                 # Bootstraps Game into #app and #ui
├── Game.ts                 # Top-level game loop, screen state machine, persistence
├── sim/                    # Pure deterministic TS (NO three/DOM/window/random)
│   ├── types.ts            # PlayerVehicle, InputFrame, HudSnapshot, GamePhase
│   ├── PlayerCar.ts        # VEHICLE_SPECS, VEHICLE_COST, VEHICLE_SHOWCASE, physics & boost
│   ├── World.ts            # Route mode world & surface drag/traction
│   └── city/CityWorld.ts   # Free-roam city world & surface/kerb drag
├── render/
│   ├── Renderer.ts         # Single WebGLRenderer, mode switching (world vs garage)
│   ├── GarageScene.ts      # [NEW] 3D NFS Heat-inspired garage stage & 3D->2D projection
│   ├── VehicleFactory.ts   # .glb loader + material/paint/light bindings
│   ├── ChaseCamera.ts      # Gameplay camera
│   └── TyreFx.ts           # Data-driven skid marks & smoke per vehicle
├── audio/
│   └── SoundEngine.ts      # Data-driven engine/boost sound profiles per vehicle
├── input/
│   └── InputManager.ts     # Keyboard, mouse, touch, gamepad + edge-triggered menu nav
└── ui/
    ├── Hud.ts              # Screen visibility orchestration & in-game HUD
    ├── CarSelectScreen.ts  # [NEW] NFS Heat-style car selection DOM/SVG UI
    └── styles.css          # Theme variables, responsive desktop/mobile car-select styling
public/models/              # .glb meshes (alto, coupe, rickshaw, suv, minibus, npc...)
tools/
├── build_models.mjs        # Node Three.js GLTFExporter asset builder
├── pack_html.mjs           # Single-file HTML packer (base64 models + fonts)
├── test/                   # [NEW] Pure unit & integration tests (node:test)
└── playtest/               # sim.mjs, balance.mjs, metrics.sh, browser.mjs + E2E specs
```

## Feature Inventory
Every Survey feature and `/home/antigravity/image.png` UI requirement assigned to a milestone (none unassigned):
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Two-step flow (Weather -> Car Select -> Play) | Selecting `PLAY`/`DAILY` (or pressing `Enter`/Gamepad A) on Weather/Mode screen transitions to Car Select; `SELECT` starts gameplay; `BACK`/`Esc`/Gamepad B returns to Weather screen. Remove redundant `.garage-strip` from Step 1. | M3 | ORIGINAL_REQUEST, Survey 1 & 3 |
| 2 | Expanded Playable Vehicle Roster & `.glb` Models | Keep `alto` (0), `rickshaw` (400), `minibus` (1200); add `'coupe'` ('65 Mustang-inspired blue coupe, cost 0 starter) and `'suv'` (4x4 off-road pickup/SUV, cost 800) with generated `.glb` models, PWA precache (`vite.config.ts`), and `pack_html.mjs` inlining. | M1 | Survey 1, 2 & 3 |
| 3 | Authentic Gameplay Physics Differentiation | Per-vehicle `boostAccel`/`boostTopSpeedMul`/`boostCooldown`/`boostDurationMul` (`NITROUS`), per-vehicle off-road drag/traction (`OFF-ROAD`/`ROAD`, moving `CityWorld.kerbs()` off-road drag into `applySurface()`), and drift/grip tuning (`RACE`/`DRIFT`). | M1 | Survey 2 |
| 4 | Pure Vehicle Showcase Catalog & Derived Stats | `VEHICLE_SHOWCASE` metadata (`brand`, `model`, `badgeName`, `perfRating`, `power`, `highSpeed`, `acceleration`, `nitrous`, `handlingGrid: { x, y }`, `customizationRating`, `paintHex`) aligned with actual `VehicleSpec` physics. | M1 | image.png, Survey 1–3 |
| 5 | 3D NFS Heat Garage Showcase Scene | Isolated `GarageScene` using shared `WebGLRenderer`: industrial bay, reflective concrete floor, cyan/magenta neon strips, warm spotlight, weather-reactive headlights (`night`/`monsoon`), hero car at 3/4 front-right angle, adjacent parked neighbor car(s), smooth camera transitions. | M2 | image.png, Survey 2 |
| 6 | 3D-to-2D Floating Tag Anchor Projection | Project hero car roof and adjacent neighbor car roof coordinates into screen space every frame while in garage mode so floating tags track the 3D cars cleanly across aspect ratios. | M2 | image.png, Survey 3 |
| 7 | Data-Driven Renderer, TyreFx, Camera & Audio | Replace hardcoded 3-vehicle `if/else`/ternaries in `Renderer.ts` (`FLAME_POS`, camera presets), `VehicleFactory.ts`, `TyreFx.ts` (`wheelBase`/`halfWidth`/`maxLateralAccel`), and `SoundEngine.ts` (`SOUND_PROFILE`) with full `PlayerVehicle` tables. | M2 | Survey 2 |
| 8 | Left Stats Panel & Header UI | Translucent dark glass panel with uppercase Brand, Model, car SVG icon + Performance Rating number, and 4 segmented stat bars (`POWER`, `HIGH SPEED`, `ACCELERATION`, `NITROUS`) with right-aligned numeric score pills (`0.0`–`10.0`). | M3 | image.png, Survey 3 |
| 9 | 2D Diamond Handling Grid & Customization Bar | Rotated 45° inner diamond grid + crosshairs + 4 cardinal icon+label pairs (`OFF-ROAD`, `DRIFT`, `ROAD`, `RACE`) + animated white marker dot; detached footer with `CUSTOMIZATION RATING` 10-segment meter + `X/10`. | M3 | image.png, Survey 3 |
| 10 | Floating Car Badge, Arrows & Adjacent Car Pin | Floating vehicle nameplate pill (`'65 Coupe`, etc.) + glowing cyan gear-tooth circle with car SVG + `◀`/`▶` cycle arrows above 3D car, plus subtle clickable adjacent-car circular badge. | M3 | image.png, Survey 3 |
| 11 | Bottom-Left Action Prompts, Lock Handling & Controls | `(X) SELECT` & `(ESC) BACK` bottom-left pills; locked-car visual state (`LOCKED · RS ...`) preventing launch + showing feedback; keyboard (`←/→/A/D`, `Enter`, `Esc`), mouse/touch, and Gamepad navigation without leaking into driving/pause. | M3 | image.png, Survey 1 & 3 |
| 12 | Responsive Desktop & Mobile Layouts | Clean scaling at desktop (`1280×720+`), mobile landscape (`844×390`), and mobile portrait (`412×915`) with safe-area insets and no panel/car/badge overlap. | M3 | Survey 1 & 3 |
| 13 | E2E Testing Track (Tiers 1–4) | `TEST_INFRA.md`, pure `node:test` suite, sim balance checks across all vehicles, updated `browser.mjs` smoke + dedicated E2E car-selection browser verification (desktop & mobile) -> `TEST_READY.md`. | E2E | Survey 3, Dual Track |
| 14 | Final Integration, E2E Pass & Tier 5 Hardening | Pass 100% E2E Tiers 1–4 sequentially, then white-box Tier 5 adversarial Challenger->Worker->Reviewer hardening + whole-project Forensic Audit. | Final | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|--------------|--------|
| 1 | M1: Sim Roster, Physics/Boost/Off-Road & Models | `npm install`, `src/sim/types.ts`, `src/sim/PlayerCar.ts`, `src/sim/World.ts`, `src/sim/city/CityWorld.ts`, `tools/build_models.mjs`, `public/models/*.glb`, `vite.config.ts`, `tools/pack_html.mjs` | none | DONE |
| 2 | M2: 3D Garage Showcase, Render & Audio Tables | `src/render/GarageScene.ts`, `src/render/Renderer.ts`, `src/render/VehicleFactory.ts`, `src/render/TyreFx.ts`, `src/audio/SoundEngine.ts` | M1 | DONE |
| 3 | M3: NFS Heat Car Select UI, Input & Screen Flow | `src/ui/CarSelectScreen.ts`, `src/ui/Hud.ts`, `src/ui/styles.css`, `src/input/InputManager.ts`, `src/Game.ts` | M1, M2 | IN_PROGRESS (dispatched) |
| 4 | E2E: Requirement-Driven E2E Test Suite | `TEST_INFRA.md`, `tools/test/*.test.mjs`, `tools/playtest/browser.mjs`, `tools/playtest/e2e-car-select.mjs`, `package.json`, `TEST_READY.md` | none (runs parallel) | IN_PROGRESS (dispatched) |
| 5 | Final: E2E Tiers 1-4 Pass & Tier 5 Hardening | Whole-project E2E pass + white-box Tier 5 adversarial testing + Final Forensic Audit | M1, M2, M3, E2E (`TEST_READY.md`) | PLANNED |

## Interface Contracts

### `src/sim/types.ts` & `src/sim/PlayerCar.ts` (M1 -> M2, M3)
```ts
export type PlayerVehicle = 'alto' | 'coupe' | 'rickshaw' | 'suv' | 'minibus';

export interface VehicleShowcaseStats {
  power: number;        // 0..10
  highSpeed: number;    // 0..10
  acceleration: number; // 0..10
  nitrous: number;      // 0..10
}

export interface VehicleShowcaseMeta {
  id: PlayerVehicle;
  brand: string;               // e.g., 'SUZUKI', 'FORD', 'SAZGAR', 'TOYOTA', 'KARACHI W-11'
  model: string;               // e.g., 'Alto 660cc', "Mustang '65", 'CNG Rickshaw', 'Hilux 4x4', 'Express Minibus'
  badgeName: string;           // e.g., "'65 Ford Mustang", 'Suzuki Alto 660', ...
  perfRating: number;          // e.g., 100..260
  stats: VehicleShowcaseStats;
  handlingGrid: { x: number; y: number }; // x: -1 (RACE) .. +1 (DRIFT), y: -1 (ROAD) .. +1 (OFF-ROAD)
  customizationRating: number; // integer 1..10
  paintHex: number;            // primary showroom/gameplay body color hex
}

// VehicleSpec extensions in src/sim/PlayerCar.ts:
// boostAccel: number;
// boostTopSpeedMul: number;
// boostCooldown: number;
// boostDurationMul: number;
// offroadDragMul: number;
// offroadTraction: number;
// driftSlideKeep: number;
// driftYawBoost: number;

// Exports from src/sim/PlayerCar.ts:
export const PLAYER_VEHICLES: readonly PlayerVehicle[] = ['alto', 'coupe', 'rickshaw', 'suv', 'minibus'];
export const VEHICLE_COST: Record<PlayerVehicle, number>;
export const VEHICLE_SHOWCASE: Record<PlayerVehicle, VehicleShowcaseMeta>;
```

### `src/render/Renderer.ts` & `src/render/GarageScene.ts` (M2 <-> M3)
```ts
export interface GarageProjection {
  activeAnchor: { x: number; y: number; visible: boolean };   // normalized [0..1] viewport coords
  adjacentAnchor: { x: number; y: number; visible: boolean }; // normalized [0..1] viewport coords
  adjacentVehicle: PlayerVehicle;
}

// Public methods on Renderer (consumed by Game.ts / M3):
// setGarageMode(active: boolean, vehicle?: PlayerVehicle, adjacentVehicle?: PlayerVehicle): void
// setGarageVehicle(vehicle: PlayerVehicle, adjacentVehicle?: PlayerVehicle): void
// getGarageProjection(): GarageProjection
// setTimeOfDay(tod: TimeOfDay): void  // updates garage headlight/mood lighting as well as world sky
```

### `src/input/InputManager.ts` (M3 internal)
- Edge-triggered menu navigation methods when car selection is open (so menu keys do not leak into gameplay or trigger pause):
  - `consumeMenuNav(): -1 | 0 | 1` (`ArrowLeft`/`KeyA`/Gamepad D-Pad Left -> `-1`, `ArrowRight`/`KeyD`/Gamepad D-Pad Right -> `1`)
  - `consumeBack(): boolean` (`Escape`/`Backspace`/Gamepad B `buttons[1]`)
  - Existing `consumeConfirm(): boolean` (`Enter`/`NumpadEnter`/Gamepad A/Start + UI button `queueConfirm()`)

### `src/ui/CarSelectScreen.ts` & `src/ui/Hud.ts` (M3 <-> E2E)
- Stable DOM structure & selectors for UI & E2E verification:
  - `.screen.car-select` (hidden via `.hidden` class when inactive)
  - `.car-panel`: `.car-brand`, `.car-model`, `.car-perf-rating`, `.car-stat[data-stat="power|highSpeed|acceleration|nitrous"]` (`.car-stat-fill`, `.car-stat-val`), `.handling-diamond` + `.handling-dot`, `.custom-rating` (10 `.seg` elements + `.custom-rating-val`)
  - `.car-tag-anchor`: `.car-tag-name`, `.car-gear-badge`, `button.car-arrow.prev`, `button.car-arrow.next`
  - `button.car-adj-badge` (adjacent car indicator/jump button)
  - `.car-actions`: `button.car-select-go` (`SELECT` / `LOCKED · RS ...`), `button.car-select-back` (`BACK`)
