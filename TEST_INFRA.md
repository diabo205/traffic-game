# E2E & Automated Test Infrastructure (`TEST_INFRA.md`)

## 1. Overview & 4-Tier Opaque-Box Architecture

Karachi Traffic 3D uses a 4-tier requirement-driven, opaque-box test suite designed against `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `/home/antigravity/image.png`:

| Tier | File / Runner | Scope | Runtime |
|---|---|---|---|
| **Tier 1** | `tools/test/tier1-catalog-physics.test.mjs` | Vehicle catalog (`PLAYER_VEHICLES`, `VEHICLE_COST`, `VEHICLE_SHOWCASE`), `VehicleSpec` physics/showcase alignment, boost/nitrous differentiation, `World`/`CityWorld` off-road drag & traction, `InputManager` menu navigation, and `src/sim/` purity invariant | `node:test` + Vite SSR (`ssrLoadModule`) |
| **Tier 2** | `tools/test/tier2-boundaries.test.mjs` | Cyclic wraparound indexing, bank unlock/lock boundaries (`0/399/400/799/800/1199/1200`), rapid vehicle instantiation & state isolation, `InputManager` repeat/key-leak boundaries, extreme physics corner cases (`NaN`/`Infinity` immunity), `.glb` & precache/pack asset boundaries | `node:test` + Vite SSR (`ssrLoadModule`) |
| **Tier 3** | `tools/test/tier3-combinations.test.mjs` | Pairwise cross-feature matrix: `Weather` (`noon`, `sunset`, `night`, `monsoon` -> `clear \| monsoon`) × `Vehicle` (`5` rides) × `Mode` (`route`, `city`), weather traction penalty verification, and combined Keyboard + Gamepad + Touch `InputManager` transitions | `node:test` + Vite SSR (`ssrLoadModule`) |
| **Tier 4** | `tools/playtest/e2e-car-select.mjs` + `tools/playtest/browser.mjs` | Real headless Chromium CDP + SwiftShader WebGL E2E journeys (`J1`–`J7`) across desktop (`1280×720`) and mobile (`412×915` portrait, `844×390` landscape) viewports, checking 3D canvas visibility, NFS Heat panel completeness, 3D-to-2D badge projection, lock/unlock flows, persistence, corrupted `localStorage` fallback (`J7`), pause/quit, zero overlap, and zero console/page errors | Vite dev server + Headless Chromium CDP (or Playwright if installed) |

---

## 2. Runner Commands

```bash
# Run Tiers 1–3 (node:test + Vite ssrLoadModule)
npm test

# Run Tier 4 dedicated Car Select E2E browser suite (exits non-zero on any failure or console/page error)
npm run test:e2e

# Run browser smoke script (Menu -> Car Select -> City Driving)
npm run playtest:browser -- smoke

# Run multi-seed statistical sim balance check (per vehicle)
npm run playtest:balance -- --vehicle alto --check
npm run playtest:balance -- --vehicle coupe --check
npm run playtest:balance -- --vehicle suv --check
```

---

## 3. Environment & Dependencies

- **Node.js**: `>= 24` (`v24.22.2` verified) with built-in `node:test`, `node:assert/strict`, and native `WebSocket`.
- **TypeScript Module Loading in Node**:
  - `src/` uses extensionless bundler-style imports (`"moduleResolution": "bundler"` in `tsconfig.json`).
  - `tools/test/helpers.mjs` boots a headless Vite server via `createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } })` and loads TypeScript modules via `server.ssrLoadModule('/src/...')`, closing cleanly in `after()` hooks.
  - `InputManager` is tested by passing an `EventTarget`-based window shim and a `navigator.getGamepads` provider to the real `InputManager` class loaded via `ssrLoadModule('/src/input/InputManager.ts')`.
- **Browser & WebGL**:
  - System Chromium (`/usr/bin/chromium` / `/usr/bin/google-chrome`) or Playwright if installed.
  - Launched headless with SwiftShader software WebGL flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.

---

## 4. Feature Coverage Matrix (`PROJECT.md` #1–#12 & `image.png`)

| Feature # | Requirement (`PROJECT.md` / `image.png`) | Covered By |
|---|---|---|
| **#1** Two-step flow (Weather -> Car Select -> Play) | `.garage-strip` removed from Start; `PLAY`/`DAILY` -> Car Select; `SELECT` -> Play; `BACK`/`Esc` -> Start | Tier 4 (`J1`, `J3`, `J4`, `J5`, `J7`), `browser.mjs` |
| **#2** Expanded 5-vehicle roster & `.glb` models | `alto`, `coupe`, `rickshaw`, `suv`, `minibus` + `.glb` files + `vite.config.ts` precache + `pack_html.mjs` | Tier 1 (`A`), Tier 2 (`F`) |
| **#3** Authentic physics, boost/nitrous & off-road drag | 8 `VehicleSpec` fields; launch/drift/dash boost differentiation; `World` & `CityWorld` `applySurface()` off-road drag/traction | Tier 1 (`B`, `C`, `D`), Tier 2 (`C`, `E`), Tier 3 |
| **#4** Pure `VEHICLE_SHOWCASE` catalog & derived stats | `brand`, `model`, `badgeName`, `perfRating`, `stats.{power,highSpeed,acceleration,nitrous}`, `handlingGrid`, `customizationRating`, `paintHex` | Tier 1 (`A`, `B`, `F`) |
| **#5** 3D NFS Heat garage showcase scene | Transparent/translucent `.screen.car-select` over live `#app canvas`, weather-reactive lighting, hero + adjacent car | Tier 4 (`J1`, `J2`, `J4`) |
| **#6** 3D-to-2D floating tag anchor projection | `.car-tag-anchor` and `button.car-adj-badge` positioned inside viewport and tracking 3D vehicles | Tier 4 (`J1`, `J2`, `J6`) |
| **#7** Data-driven Renderer, TyreFx, Camera & Audio | Runtime driving & garage render across all 5 vehicles without console/page errors; `.integ-label` matches chosen ride | Tier 4 (`J2`, `J3`, `J5`) |
| **#8** Left stats panel & header UI (`image.png`) | `.car-panel`, `.car-brand`, `.car-model`, `.car-perf-rating`, 4 `.car-stat` bars + `.car-stat-fill` + `.car-stat-val` | Tier 4 (`J1`, `J2`, `J6`) |
| **#9** 2D diamond handling grid & customization bar (`image.png`) | `.handling-diamond` + `.handling-dot`, `.custom-rating` with 10 `.seg` elements + `.custom-rating-val` | Tier 4 (`J1`) |
| **#10** Floating badge, cycle arrows & adjacent car pin (`image.png`) | `.car-tag-anchor` (`.car-tag-name`, `.car-gear-badge`, `button.car-arrow.prev`, `button.car-arrow.next`) + `button.car-adj-badge` | Tier 4 (`J1`, `J2`) |
| **#11** Action prompts, lock handling & controls (`image.png`) | `.car-actions` (`button.car-select-go`, `button.car-select-back`), `LOCKED` rejection at `bank=0`, corrupted `localStorage` fallback, keyboard/gamepad nav without key-leaks | Tier 1 (`E`), Tier 2 (`B`, `D`), Tier 3, Tier 4 (`J2`, `J3`, `J4`, `J7`) |
| **#12** Responsive desktop & mobile layouts | `1280×720`, `412×915` portrait, `844×390` landscape with zero viewport overflow or panel/action/tag overlap | Tier 4 (`J1`, `J6`) |

---

## 5. DOM Selector & `localStorage` Contracts

### DOM Selectors (`PROJECT.md § Interface Contracts`)
- **Start Screen**: `.screen.start`, `button.cond-strip[data-tod="noon|sunset|night|monsoon"]`, `button.tile[title="Free roam in Saddar"]`, `button.tile[title="Route run to Clifton"]`, `button.go-btn.play`, `button.daily-btn`. Legacy `.garage-strip` MUST NOT exist.
- **Car Select Screen**: `.screen.car-select` (hidden via `.hidden`; transparent background over `#app canvas`).
  - Left Panel (`.car-panel`): `.car-brand`, `.car-model`, `.car-perf-rating`, `.car-stat[data-stat="power|highSpeed|acceleration|nitrous"]` (with `.car-stat-fill`, `.car-stat-val`), `.handling-diamond` + `.handling-dot`, `.custom-rating` (`10 × .seg` + `.custom-rating-val`).
  - Floating Hero Tag (`.car-tag-anchor`): `.car-tag-name`, `.car-gear-badge`, `button.car-arrow.prev`, `button.car-arrow.next`.
  - Adjacent Car Pin: `button.car-adj-badge`.
  - Action Prompts (`.car-actions`): `button.car-select-go` (`SELECT` or `LOCKED · RS <cost>`), `button.car-select-back` (`BACK`).
- **Gameplay / Pause**: `.hud`, `.hud.in-menu`, `.integ-label`, `.speed-num`, `.screen.pause`.

### `localStorage` Keys (`kt3d.*`)
- `kt3d.bank`: cumulative earned Rupees (integer string, e.g. `'0'`, `'2000'`)
- `kt3d.veh`: selected `PlayerVehicle` (`'alto' | 'coupe' | 'rickshaw' | 'suv' | 'minibus'`)
- `kt3d.tod`: selected `TimeOfDay` (`'noon' | 'sunset' | 'night' | 'monsoon'`)
- `kt3d.mode`: selected mode (`'route' | 'city'`)
