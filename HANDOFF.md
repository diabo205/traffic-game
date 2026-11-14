# Karachi Traffic 3D — Handoff

Snapshot: 2026-11-14. Branch with the latest game: **`claude/pensive-pascal-mlpxao`** (head `02a3bc7` + this handoff commit).
`main` is empty. Read this file, then `CLAUDE.md` (architecture rules, still binding), before changing code.

---

## 1. What the project is

A stylised low-poly 3D **browser driving game set in Karachi**. You drive a 660cc Suzuki Alto. Runs in desktop and mobile browsers, aiming for 60 FPS, with keyboard, touch and gamepad input. Two modes, chosen on the start screen:

| Mode | What it is |
|---|---|
| **Free roam · Saddar** (default) | Open-world street grid of Saddar. Crazy-Taxi-style loop: pick up passengers at the kerb, drive them to named places before their fare timer runs out, earn tips; stunts (drift, jumps, near misses, smashing props) build combos. A shift clock replaces game over. |
| **Route run** | The original MVP: one straight 4.2 km corridor, Saddar → Lyari Expressway → Shahrah-e-Faisal → Clifton (Teen Talwar), beat checkpoint timers, avoid potholes and manholes, keep integrity above 0. |

Stack: **Vite 8 + TypeScript (strict) + Three.js 0.187**. No physics engine (custom arcade vehicle + OBB/AABB maths). Procedural Web Audio (no audio files). HTML/CSS HUD. Vehicles modelled in **headless Blender (bpy)** from Python scripts and exported as `.glb`.

### Hard architecture rules (from `CLAUDE.md`, enforced so far)
- **`src/sim/` is pure, deterministic TypeScript**: no `three`, no `window`/`document`, no `Math.random`/`Date.now`/`performance.now`, and no imports from `render/`, `ui/`, `input/` or `audio/`. All game state lives here.
- Fixed **60 Hz timestep** (accumulator loop in `Game.ts`, max 5 steps per frame). Randomness only from the seeded **mulberry32** `Rng` (`src/sim/rng.ts`). Stable iteration order (arrays), never by object identity. Goal: multiplayer lockstep later.
- **`src/render/` only reads sim state** and interpolates between the previous and current tick (`prevX`, `prevZ`, `prevHeading`, … with `alpha`).
- **Input is one `InputFrame` per tick**: `{ throttle 0..1, brake 0..1, steer -1..1, horn, dipper }`. Merge rule: max for throttle/brake, summed and clamped steer, OR for booleans. **New moves were built as input combos so this contract did not change** (see "Controls").
- **Collision shapes are defined in the sim** (`NPC_SPECS`, `ALTO`, `PROP_SPECS`, map rects), never derived from meshes.

Quick check that the sim is still pure:
```bash
grep -rnE "Math.random|Date.now|performance.now|from 'three'|window\.|document\." src/sim/
```
It should print nothing (comments excepted).

### Coordinate conventions (important, easy to get wrong)
- **Sim space**: `x` = east/right, `z` = north/forward. `heading` 0 = facing +z, **positive = turned right** (clockwise from above). Forward vector = `(sin h, cos h)`, right = `(cos h, -sin h)`.
- **Three space**: `(x, y, -z)`. Three `rotation.y = -heading`. Car meshes face three −Z. Vehicle roots use rotation order `'YXZ'` (yaw, then pitch about the local axis); positive pitch = nose up, `body.rotation.z = -roll`.
- **Pakistan drives on the LEFT.** City lanes sit to the left of the centre line (`laneOffset` is a distance to the left; lane 0 is nearest the centre, kerb lane = `lanes-1`). Roundabouts circulate **clockwise**. Route mode: slow lane/shoulder at negative x, median at positive x.
- **Blender**: +Y is the vehicle front (exports to glTF −Z), Z up, metres, origin on the ground under the vehicle's centre.

---

## 2. Code map

```
src/
  main.ts                 boot, font imports, error fallback
  Game.ts                 wires sim/render/input/audio/UI; fixed-step loop; modes; pause; event → HUD/audio
  sim/                    PURE, deterministic
    types.ts              InputFrame, NpcView, Obb, SimEvent union (all events listed here)
    rng.ts                mulberry32 Rng
    math.ts               clamp/lerp/approach, obbOverlap (SAT + MTV), pointObbDistance
    PlayerCar.ts          Alto arcade model (ALTO, MOVES): steering, drive/brake, drift, boosts,
                          launch/dash, airborne + settle(), spring-damped roll/pitch, bump
    World.ts              ROUTE mode world (road.ts zones, HazardManager, TrafficManager, LevelManager)
    road.ts               route corridor definition: ZONES, sampleRoad(z), elevationAt(z)
    TrafficManager.ts     route traffic + NPC_SPECS (sizes, masses, damage; shared with city)
    HazardManager.ts      potholes, manholes, water, barriers, checkpoints (route)
    LevelManager.ts       checkpoint timer, zones, stats (route)
    city/                 FREE ROAM mode
      cityMap.ts          data-driven Saddar grid → road graph (nodes/links/lanes), roundabout,
                          blocks, buildings (+ drivable alleys), Empress Market, construction yard,
                          street ramps, colliders, spatial grids, junction paths, groundY()
      CityWorld.ts        free-roam world: player, collisions (buildings/islands/ramp sides),
                          kerbs, vertical/jumps, props, traffic shoves, fares, stunts, towing
      CityTraffic.ts      graph-following traffic: lanes, turns, junction yielding, deadlock
                          breakers, lane changes, ramp avoidance, horn yielding, shove dynamics
      Fares.ts            passengers, 14 named places, fare timers/payouts, shift clock,
                          Dijkstra route guidance (navX/navZ/navPath for HUD arrow + minimap)
      Props.ts            smashable props (cones, fruit carts, chai stalls, chairs, drums, crates)
      Stunts.ts           near miss / drift / air / over-the-top / smash scoring, combo multiplier
  render/
    Renderer.ts           scene, lights, sky, fog, vehicle pooling, interpolation, events → FX,
                          shader pre-compile on attach, boost flame
    ChaseCamera.ts        spring-damped chase cam, slide-aware yaw, speed FOV, rumble/shake, zoom
    VehicleFactory.ts     async factory: glb models (alto/rickshaw/minibus) or procedural meshes;
                          node-name conventions (head_/brake_/hazard_/wheel_, material "paint")
    CityScenery.ts        free-roam scenery: roads, kerbs, markings, buildings, signs, wires,
                          trees, island + flag, ramps, yard, Empress Market
    FareVisuals.ts        waiting passengers, markers, destination beam
    PropVisuals.ts        instanced props posed from sim
    TyreFx.ts             skid marks (ring buffer) + tyre smoke (shader points)
    Environment.ts, Corridors.ts, Landmarks.ts, Saddar.ts   route-mode scenery
    textures.ts, facadeMaterial.ts, strip.ts, Effects.ts, Birds.ts
  input/InputManager.ts   keyboard / touch state / gamepad merge, confirm/mute/pause queues
  audio/SoundEngine.ts    procedural engine, horn, screech, one-shots (crash, whoosh, smash, stunt…)
  ui/Hud.ts               all HUD + screens (mode select, game options, pause, results, shift card)
  ui/Minimap.ts           heading-up canvas minimap (city)
  ui/TouchControls.ts     on-screen steering/joystick, pedals, horn, dipper, DRIFT
  ui/styles.css           whole UI theme (Barlow Condensed, navy/white/magenta/lime)
tools/blender/            kit.py + alto.py, rickshaw.py, minibus.py (headless bpy model scripts)
tools/glb2json.mjs        converts .glb → self-contained glTF JSON (for hosts that won't serve .glb)
public/models/            alto.glb, rickshaw.glb, minibus.glb (committed build outputs)
```

### Frame flow
`Game.frame()` → `InputManager.sample()` → pause/confirm handling → `world.step(input)` 0–5 times at 1/60 s → `drainEvents()` per step (sim pushes `SimEvent`s; Game routes them to HUD/audio, Renderer to FX/camera) → `renderer.render(world, alpha, dt)` → HUD updates.

Both worlds expose the same surface used by Game/Renderer: `mode`, `seed`, `player`, `npcs`, `phase`, `level` (`phase/reason/stats/timeLeft/progress`), `groundY(x,z)`, `topSpeed()`, `speedRush()`, `start()`, `step()`, `drainEvents()`. `AnyWorld = World | CityWorld` (in `Renderer.ts`).

---

## 3. Current state — what works

**Free roam (Saddar grid)**: about 560 × 520 m, 7×6 streets with real Saddar street names (positions are stylised, not real). Classes: arterial (2 lanes each way, median with trees), main (2+2) and side (1+1). Missing segments make merged blocks. One roundabout (clockwise) with Empress Market beside it. Buildings fill the blocks, with drivable back alleys. Pavements are raised (kerb jolt), and outer walls bound the map.
- Traffic (bikes, rickshaws, cars, minibuses, trucks, carts) follows lanes, turns, yields at junctions, changes lanes, avoids ramps, pulls over for the horn, and gets shoved and spun by hits. Verified flowing for 20 simulated minutes on several seeds.
- **Fares**: 6 waiting passengers near you. Stop beside one (<8 km/h for 0.7 s) to board, drive to one of 14 named places before the timer runs out. Pay is distance-based, with a speed tip and shift-time bonus. 90 s shift clock; when it runs out you keep driving off duty. Wrecking means a tow back to the start, a Rs 300 repair bill and −10 s.
- **Moves**: handbrake drift with a drift-exit boost, launch boost, dash boost, harder arcade braking. Six street kicker ramps plus a construction yard with four dirt ramps. Real airborne physics with landing jolts; you can jump over traffic.
- **Props**: about 460 smashables that fly, tumble, settle and reset when far away.
- **Stunts and combos**: near miss (×2 oncoming), drift, air, over-the-top, smash. A 3 s combo window (frozen while drifting or airborne), up to ×8, passenger tip on bank, and a crash breaks the combo.
- **Camera/FX**: spring chase cam, FOV widening with speed, rumble, roll into turns. Skid marks and tyre smoke. Body roll and pitch springs (pitch sign fixed: dive under braking). Shaders are pre-compiled on attach.

**Route run**: unchanged MVP plus the new handling and camera. Landmarks (Empress Market, Mazar-e-Quaid, flyovers, Teen Talwar), Lyari river, toll plaza, footbridges, potholes, manholes, water, VIP roadblocks, checkpoints.

**UI** (Asphalt-9-inspired visual language, no copied assets):
- Mode select, game options (sound, camera near/far, touch controls, steering style, controls reference).
- Pause menu (Esc/P/gamepad Start/on-screen ‖), with the sim and audio frozen.
- HUD: stat block, integrity bar, boost meter, fare plate, guide arrow, giant speed, clock badge, combo meter, stunt strips, street banner, minimap.
- Results and shift-over cards. Phone landscape layout checked at 844×390.

**Vehicles**: the Alto, Sazgar auto-rickshaw and truck-art minibus are Blender-scripted glb models (built from user reference photos). Car, truck, bike and cart are still procedural meshes in `VehicleFactory.ts`.

**Playable phone build** (no PC needed): a private claude.ai artifact (`https://claude.ai/artifact/Mnb1nftCx5Qs8sHPGXg9Jn`). It is a snapshot of `7d72ef8`'s UI with JSON models and doesn't auto-update. See §5 for how it was built.

### Half-finished / in flight elsewhere
1. **Playtest + feel tuning branch `claude/gamer-persona-sub-agents-mgh36t`** (another agent): persona playtest agents (`.claude/agents/gamer-*.md`), `playtests/PROTOCOL.md`, a headless harness (`tools/playtest/sim.mjs`, `browser.mjs`, `metrics.sh`), and feel passes 1–3:
   - Walls slide instead of sticking, with a "STUCK? hold S" hint.
   - Stronger mid-range acceleration, lower aero drag.
   - Dash nerf (own 4 s cooldown, low speed only).
   - Gentler manholes.
   - Barrier speed cap, slower dirt shoulder.
   - Shared crash cooldown, softer traffic crashes.
   - Stopped traffic counts as a wall.

   It is built on `3029b4a` and **NOT merged** into `pensive-pascal`. Persona fun ratings went from 6/6/5 to 7/7/(chaos re-test pending). Contains an **unfixed bug**, see §4.1.
2. **Dev-journey video branch `claude/modest-ptolemy-h0avrc`**: a Remotion project in `video/` plus `CHANGELOG.md`, built on `2e5aa63`. Separate from the game code; don't merge `video/` into the game bundle.
3. **Real Saddar streets from OpenStreetMap** (requested, not started). See §4 and §5. The plan is ready, but the data couldn't be downloaded from this environment.

---

## 4. Known bugs, edge cases, technical debt

### 4.1 Bugs
- **(Playtest branch) `wallContact` never counts down.** In `src/sim/PlayerCar.ts` the line `if (this.wallContact > 0) this.wallContact--;` sits inside `reset()` (around line 165), so it never runs during play. After the first wall touch, the "pinned against a wall" low-speed pivot (around line 364) and the STUCK hint (around line 423) stay active forever. Measured effect: crawl + full steer turns 49° in 1 s instead of 8°.
  - **Fix**: move that line to the top of `update()`.
  - **Repro**: touch a wall, drive 10 s in the open, then crawl at about 3 km/h with full steer.
- **NPC–NPC overlaps** are not resolved physically. Occasional brief interpenetration at busy junctions (about 0.1/s measured) when the deadlock breakers nose crossing traffic through.
- **Street ramps can sit close to a junction**, so a jump can land you in cross traffic (one test lost 37 HP). The ramp placement (`streetRamps()` in `cityMap.ts`) doesn't check distance to the next junction.
- **Tow always returns you to the fixed start** on Abdullah Haroon Road, even if you were across the map.
- **Headless/initial frames**: before the shader pre-compile fix, roads could flash as dirt for a second. It's fixed via `gl.compile` in `Renderer.attach`, but watch for it if materials are created lazily later.

### 4.2 Edge cases / tuning that's still a guess
- Fare time limits (`dist/8.5 + 9` s), payouts, tips, the 90 s shift and stunt point values are first guesses. Near-miss scoring could be farmable.
- The horn only affects same-direction traffic within about 38 m; carts ignore it.
- Route mode with the new handling is harder (traffic hits hurt more at higher speed). The playtest branch softens this; the autopilot test driver still dies on every seed (it never dodges traffic).
- Drift, boost and the stronger brakes also apply in route mode.
- The pause menu goal text is generated in `Game.pause()`; the route zone name comes from `ZONES[i].name`.
- Touch controls take a lot of screen at 844×390; the combo and stunt strips are moved up on short screens to clear the pedals.

### 4.3 Technical debt
- **`cityMap.ts` assumes axis-aligned streets** (`Rect` road strips, junction boxes `hx/hz`, rectangular blocks, AABB building solids). Real OSM streets need:
  - Generalised junctions (radius per node) and straight links per polyline vertex (degree-2 bend nodes).
  - Segment-distance road queries.
  - Oriented building boxes.
  - Polygon road and pavement meshes in `CityScenery`.
  - Line-drawn roads in `Minimap`.
  - A heap-based Dijkstra in `Fares.ts`, since the current O(n²) selection is fine for 42 nodes and not for about 1000.
  - `linkAt()` via a spatial grid (it currently scans every link every 10 ticks).
- **`facadeMaterial.ts`** maps the atlas by axis (`abs(fn.x) > 0.5 ? z : x`). For rotated buildings, change it to `along = dot(fw.xz, normalize(vec2(-fn.z, fn.x)))`. That gives identical results for axis-aligned faces, so route mode is unaffected.
- **Free roam isn't connected to the route** (Lyari/Faisal exist only in route mode); the two world types share an interface but not geometry.
- City scenery is sparser than route-mode Saddar: no balconies, pedestrians, parked bikes or banners in the grid.
- The bundle is one about 900 kB chunk (Vite warns at 800 kB); no code-splitting.
- No real-phone performance profiling (all testing used SwiftShader). No LOD or streaming: about 520 instanced buildings, about 460 props, 36 NPCs, shadows off on mobile (`lowSpec`).
- `README.md` still only describes route mode.
- Four vehicle types are still procedural meshes (car, truck, bike, cart). A Bedford truck model needs photos; a Honda CD-70 style bike could be modelled without them.
- Some debug tooling lives only in old chats: the `window.__g = game` hook pattern for Playwright (see §5) is applied temporarily and never committed.

---

## 5. Environment, dependencies, commands

### Requirements
- **Node 22** (developed on v22.23), npm. Packages: `three@^0.187`, `@fontsource/barlow-condensed@^5.2.6` (OFL), dev: `typescript@^7.0.2`, `vite@^8.3.8`, `@types/three`.
- Optional: **Python 3.11+ with `pip install bpy`** (Blender as a Python module, used with Blender 5.3) to rebuild vehicle models.
- Optional: **Playwright + Chromium** for headless screenshots (the Claude cloud container had them preinstalled).

### Commands
```bash
npm install
npm run dev        # Vite dev server on :5173, also on your LAN IP (phones on the same Wi-Fi)
npm run build      # tsc --noEmit + production bundle in dist/
npm run preview    # serve dist/ on :4173 (also LAN)
```
`vite.config.ts` sets `host: true` and `allowedHosts: true` for dev and preview, so LAN IPs and hosted preview links aren't blocked.

URL options:
- `?mode=city` or `?mode=route` (otherwise the last mode played).
- `?seed=123` for the world seed (default 1337).
- `?low` / `?high` to force a graphics tier (touch devices default to low).
- `?z=1500` to start further along the route (implies route mode).

### Rebuilding vehicle models (headless Blender)
```bash
python -m venv bl && bl/bin/pip install bpy
bl/bin/python tools/blender/alto.py        # writes public/models/alto.glb (same for rickshaw.py, minibus.py)
```
In scripts, `import bpy` must come before `import bmesh`. `VehicleFactory.fromModel()` relies on node names (`head_*`, `brake_*`, `hazard_*`, `wheel_*`), the material name `paint` (recoloured per variant) and `art_*` materials (canvas truck-art textures).

### Static build for hosts that won't serve .glb (how the phone artifact was made)
```bash
VITE_MODEL_EXT=json npx vite build --base ./ --outDir build-static
for m in alto rickshaw minibus; do node tools/glb2json.mjs build-static/models/$m.glb build-static/models/$m.json && rm build-static/models/$m.glb; done
```
Then publish `build-static/` (relative paths throughout). The claude.ai artifact needed the page body without `<!doctype>/<html>/<head>/<body>` and every asset listed as a supporting file.

### Testing approach used so far
- **Sim tests run headless with `npx tsx`**: build a `CityWorld`/`World`, feed `InputFrame`s, read state and events. Checks used:
  - Determinism: two worlds with the same seed and input must match exactly.
  - Traffic flow over N minutes (average speed, stopped fraction, overlaps).
  - Each move (jump height, drift slip, launch speed), fares, combos and the horn.
  - The playtest branch adds a reusable harness in `tools/playtest/`.
- **Browser checks**: Playwright with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - SwiftShader runs about 3–16 sim ticks per real second, so poll state instead of fixed waits.
  - For scripted shots, temporarily add `(window as any).__g = game;` after `game.start()` in `main.ts`, then drive via `__g.world.player.reset(x, z, heading, y)`, `.speed`, `__g.world.map`, `__g.world.fares`, `__g.world.props`.
  - Never commit the hook.
- Always run `npm run build` and the sim-purity grep before committing.

### Git / branches
- `claude/pensive-pascal-mlpxao` — **the game, latest**. Commits end with co-author/session trailers (keep or drop as you like).
- `claude/gamer-persona-sub-agents-mgh36t` — playtest harness and feel passes 1–3 (unmerged; fix the §4.1 bug first). It branched from `3029b4a`, so a merge into `pensive-pascal` will conflict lightly in `src/Game.ts` (the new HUD/pause code vs their 3-line hint) and maybe `src/sim/city/CityWorld.ts`.
- `claude/modest-ptolemy-h0avrc` — Remotion dev-journey video and CHANGELOG.
- `main` — empty. Pick `pensive-pascal` as the base (or merge it into `main`).

### Network / data notes
- The user can't use paid services or assets. All data and tools so far are free (Blender, OSM, OFL font).
- The OpenStreetMap download of Saddar failed from the Claude cloud sandbox (`overpass-api.de` connections were reset). From a normal machine, either works:
  - `https://api.openstreetmap.org/api/0.6/map?bbox=67.0205,24.8525,67.0395,24.8675` (OSM XML for Saddar around Empress Market, about 24.8605 N, 67.0303 E).
  - An Overpass query for `highway~trunk|primary|secondary|tertiary|unclassified|residential|living_street|*_link` ways (`out geom`) plus named POIs (`out center`) in the same bbox.
- OSM data is **ODbL**: show "© OpenStreetMap contributors" in the game (for example on the options screen) and keep the converted data file attributed.
- The reference photo pack (67 Karachi photos, `Karachi_Visual_Reference_Guide.md`) came from the user's Google Drive and is not in the repo.

---

## 6. Next steps (priority order)

1. **Fix and merge the feel passes.** Fix the `wallContact` bug on `claude/gamer-persona-sub-agents-mgh36t` (§4.1), let the chaos persona re-test pass, then merge into `claude/pensive-pascal-mlpxao`. Resolve the `Game.ts` conflict by keeping the new HUD/pause code and adding their STUCK hint as a `showToast`. Re-run the determinism test, the traffic-flow test and `npm run build`.
2. **Real Saddar from OpenStreetMap** (the user's latest request, "Update Saddar"):
   1. Download the bbox above, convert lat/lon to local metres (equirectangular around Empress Market is fine at this scale).
   2. Simplify the polylines (about 3 m Douglas–Peucker) and split ways into straight links at every vertex and intersection.
   3. Lanes from `lanes=*` or highway class. Treat ways as two-way at first, since oneway=yes needs a "no reverse link" path through `CityTraffic.chooseNext`.
   4. Bake the result into a committed TS/JSON module that the sim imports, so it stays deterministic and offline.
   5. Do the generalisations listed in §4.3. Place buildings procedurally along street frontages as oriented boxes (OSM building coverage is patchy). Use real POIs as fare destinations, Empress Market at its real spot, and drop the fake roundabout unless OSM has one.
   6. Add the OSM credit.
3. **Phone performance pass**: profile on a real mid-range Android and iPhone; consider distance culling for props and signs, fewer NPCs on `lowSpec`, merged far geometry, and code-splitting the route-only scenery.
4. **Look-and-feel pass for the city**: a brighter grade; pedestrians that dive away; balconies, banners and parked bikes in the grid (reuse `Saddar.ts` ideas).
5. **Tuning**: fare timers and payouts, combo values, ramp placement away from junctions, the tow destination (nearest kerb instead of the start), route-mode traffic damage.
6. **Content**: Bedford truck model (needs photos), CD-70 bike, rickshaw and minibus variants; connect free roam to Lyari/Faisal.
7. **Housekeeping**: update `README.md` for free roam, controls and the static build; add `npm` scripts for the static build and the sim tests; consider moving the playtest harness onto the main game branch.

## 7. Controls (as shipped)
| | Keyboard | Gamepad (standard) | Touch |
|---|---|---|---|
| Gas / brake-reverse | W/↑ · S/↓ | RT · LT | GAS · BRAKE pedals |
| Steer | A D / ← → | Left stick (D-pad fallback) | ◀ ▶ buttons or joystick |
| Drift (gas + brake) | E (or W+S) | B (or RT+LT) | DRIFT |
| Horn / dipper | Space / F or Shift | A / X | 📯 / 💡 |
| Pause | Esc or P | Start | ‖ (top-left) |
| Confirm / mute | Enter / M | A or Start / Back | tap buttons |

- **Boosts**: launch (hold brake + gas at a standstill, release the brake); dash (double-tap gas while rolling); drift boost (power out of a drift longer than 0.7 s).
- **Horn**: traffic ahead pulls over.
- **Fares**: stop next to a marked passenger.
