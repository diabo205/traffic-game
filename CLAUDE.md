# Project: Karachi Traffic 3D (Working Title)

## Core Vision
A stylized low-poly 3D third-person browser driving game set in Karachi, Pakistan. Players drive a 660cc Suzuki Alto through chaotic, authentic Karachi road conditions, transitioning between iconic city zones via high-speed stretches of the Lyari Expressway. Must run smoothly at 60 FPS on both desktop and mobile browsers, with unified support for Keyboard, Mobile Touch Controls, and HTML5 Gamepad API controllers.

## Tech Stack
- **Build Tool:** Vite + TypeScript (strict mode)
- **3D Engine:** Three.js (lightweight, fast mobile WebGL performance, zero heavy physics engine bloat—use custom deterministic arcade vehicle & AABB/OBB collision math)
- **Audio:** Procedural Web Audio API synthesizer (`src/audio/SoundEngine.ts`)—no external audio file dependencies in MVP. Browsers block audio until a user gesture, so create/resume the `AudioContext` on the first key press, tap, or gamepad button.
- **UI:** Lightweight HTML/CSS HUD overlay (`src/ui/`) with responsive mobile touch controls

## Critical Architectural Rules (Multiplayer-Ready & Cross-Platform)
1. **Strict Simulation / Renderer Separation (`src/sim/` vs `src/render/`):**
   - ALL game state (player position, velocity, steering angle, car integrity/health, horn/dipper state, NPC vehicle states, hazard positions, RNG seed, level timers) MUST live inside pure TypeScript classes in `src/sim/` with **zero imports from `three` or `window`/`document`**, and no imports from `src/render/`, `src/ui/`, `src/input/`, or `src/audio/`. Shared types the sim consumes (e.g. `InputFrame`) are defined in `src/sim/`.
   - `src/render/` reads snapshots from `src/sim/` to update Three.js meshes, camera follow, and particles. Rendering interpolates between the last two sim snapshots; it never mutates sim state.
   - Use a seeded PRNG (`mulberry32`) for traffic and hazard spawning so future multiplayer sessions can sync world state deterministically via WebSockets.
   - **Determinism rules for `src/sim/`:**
     - Advance with a **fixed timestep** (e.g. 60 Hz, accumulator loop); never feed variable frame `dt` into the sim.
     - No `Math.random()`, `Date.now()`, or `performance.now()` inside the sim—time comes from tick count, randomness from the seeded PRNG.
     - Iterate entities in a stable order (arrays / insertion-ordered maps), never by object identity.
2. **Unified Input Abstraction (`src/input/InputManager.ts`):**
   - Normalize all inputs into a single `InputFrame` struct per tick: `{ throttle: 0..1, brake: 0..1, steer: -1..1, horn: boolean, dipper: boolean }`.
   - When several sources are active at once, merge per tick: `throttle`/`brake` take the max across sources, `steer` is summed then clamped to -1..1, booleans are OR'd. Apply a small dead zone (~0.1) to analog sticks and triggers.
   - `horn` is held (active while pressed); `dipper` is a momentary flash (active while pressed). Any toggle behaviour (e.g. high/low beam) is sim state, not input state.
   - Support three simultaneous input sources seamlessly:
     - **Desktop Keyboard:** WASD / Arrow Keys, `Space` (Horn), `F` or `Shift` (Headlight Dipper).
     - **Mobile Touch HUD:** Responsive on-screen left/right steering buttons (with toggleable virtual joystick option) on bottom-left; gas/brake pedals + Horn/Dipper buttons on bottom-right. Use Pointer Events with multi-touch support. Auto-detect touch devices (`pointer: coarse`) and provide a manual HUD toggle.
     - **Gamepad API (`navigator.getGamepads()`):** Standard mapping (Right Trigger `buttons[7]` = throttle, Left Trigger `buttons[6]` = brake, Left Stick X `axes[0]` = steer, South/A `buttons[0]` = horn, West/X `buttons[2]` = dipper) working on both desktop and mobile browsers. Poll every frame; gamepads expose no input events.
3. **Asset Swap-Ready Factory (`src/render/VehicleFactory.ts`):**
   - Build stylized low-poly 3D procedural meshes for the MVP (Suzuki Alto, 70cc bike, W-11 minibus, Chingchi/auto-rickshaw, donkey/push carts, Bedford trucks) wrapped in an async factory interface so custom `.glb` models can replace procedural meshes later without touching gameplay code.
   - Collision shapes (AABB/OBB dimensions) are defined per vehicle type in `src/sim/`, never derived from mesh geometry, so swapping a model cannot change gameplay.

## Commands
- `npm run dev` — Start Vite dev server (expose `--host` so mobile devices on local Wi-Fi can test immediately)
- `npm run build` — Type-check (`tsc --noEmit`) and build production bundle
- `npm run preview` — Serve the production build locally (also with `--host`)
