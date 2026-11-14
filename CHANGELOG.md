# Changelog — Karachi Traffic 3D

A history of the major changes to the game, oldest first, grouped into phases.
Each entry lists the commit(s) it came from.

## Overview

| Phase | Dates | What changed |
|---|---|---|
| 0. Project setup | Nov 12 | Empty repo, then a project guide with the architecture rules |
| 1. Playable MVP | Nov 12 | Point-to-point route run: Saddar → Lyari Expressway → Clifton |
| 2. Making it look like Karachi | Nov 12 | Landmarks, street life, zone dressing, matched to reference photos |
| 3. Real vehicle models | Nov 12–14 | Alto, Sazgar rickshaw and truck-art minibus modelled in Blender |
| 4. Open city | Nov 14 | Free-roam Saddar street grid with taxi fares |
| 5. Game feel | Nov 14 | Spring camera, tyre smoke, skid marks, body roll |

---

## Phase 0 — Project setup (Nov 12)

### Initial commit — `de5ead4`
- Repository created with an empty `README.md`.

### Project guide — `ca5f8c4`
- Added `CLAUDE.md`, which sets the game's vision and the rules every later
  change follows:
  - A low-poly 3D browser driving game in Karachi: a 660cc Suzuki Alto at
    60 FPS on desktop and mobile.
  - Tech stack: Vite + strict TypeScript, Three.js, a procedural Web Audio
    synth, and an HTML/CSS HUD. No physics engine.
  - **Sim/render split:** all game state lives in `src/sim/` as pure,
    deterministic TypeScript (fixed timestep, seeded `mulberry32` RNG, no
    `three` or DOM imports). This keeps the game ready for multiplayer later.
  - **One input type:** keyboard, touch and gamepad are merged into a
    single `InputFrame` each tick.
  - **Models can be swapped:** vehicles come from an async factory so
    `.glb` models can replace the procedural meshes. Collision boxes are
    defined in the sim, not taken from the meshes.

## Phase 1 — Playable MVP (Nov 12)

### First playable build — `b7b35d5`
The first version of the game: a timed run from Saddar, over the Lyari
Expressway, to Clifton.
- **Simulation (`src/sim/`):** deterministic fixed-step world, arcade
  physics for the Alto, Karachi-style traffic AI, road hazards, and three
  zones with checkpoint timers.
- **Rendering (`src/render/`):** procedural low-poly vehicles (merged per
  material), road, expressway and scenery, a chase camera, and particles.
- **Input (`src/input/`):** keyboard, gamepad and touch merged into one
  `InputFrame`.
- **UI (`src/ui/`):** arcade HUD, start and end screens, and on-screen
  touch controls for mobile.
- **Audio (`src/audio/`):** procedural engine sound, horn, tyre screech
  and impacts, all from Web Audio with no sound files.
- URL options: `?seed=`, `?low` / `?high` graphics tier, and `?z=` to
  start further along the route.

### Readability pass — `73271a9`
- Potholes are easier to see: pale crumbled rim, dark lip, near-black
  centre and loose rubble, drawn slightly larger than their hit area.
- Calmer asphalt texture so hazards stand out.
- Chase camera moved closer (5.0 m back and 2.2 m up, was 6.4 m and 2.5 m),
  with less pull-back at speed and less lag.

## Phase 2 — Making it look like Karachi (Nov 12)

These changes only touch rendering. Gameplay and the sim are unchanged.

### Landmarks, Saddar street life and dusty light — `2c402ba`
- **Landmarks:** Empress Market and its clock tower in Saddar,
  Mazar-e-Quaid in its park, the Karsaz and FTC flyovers over
  Shahrah-e-Faisal, and Teen Talwar at the Clifton finish (replacing a
  generic finish arch).
- **Saddar:** 2–6 storey old buildings with a facade shader (storeys,
  shutters, open shopfronts), stacked English/Urdu shop signs, balconies
  with laundry, rooftop water tanks and dishes, concrete poles with
  tangled wires, banners across the road, and pavements with people,
  parked bikes, fruit carts and neem trees. Black-and-yellow kerbs and
  worn lane paint.
- **Lighting:** pale dusty sky, harsh high sun, and black kites circling
  overhead.

### Lyari and Shahrah-e-Faisal dressing — `e3a11cf`
- **Lyari:** dry riverbed with walled banks and debris, dense brick and
  block housing, a toll plaza on the on-ramp, crescent-moon median lights,
  and black-and-yellow jersey barriers.
- **Shahrah-e-Faisal:** glass and precast towers, planted median with
  bougainvillea, steel footbridges with hoardings, and a bilingual
  direction gantry.
- Teen Talwar got its red plinth, arched bases and grass island. The
  Mazar railings are now black iron.

### Matched to reference photos — `13eedd5`
- The player's Alto rebuilt as a rounded, tapered hatchback with a big
  rear window and visible tyres.
- Sun-bleached pale asphalt, heavier dust haze and a softer sun.
- Leafy neem and ficus trees along Lyari and Shahrah-e-Faisal, fewer palms,
  and greener median planting.
- Hooked black median light poles on Lyari and faded stripes on the
  expressway barriers.
- Taller ochre Saddar buildings with balconies on most floors.

## Phase 3 — Real vehicle models (Nov 12–14)

Vehicles moved from procedural meshes to Blender models exported as `.glb`.
The procedural meshes stay as a fallback if a model is missing.

### Alto built in Blender — `fcd0f00`
- `tools/blender/alto.py` builds the 8th-gen Alto in headless Blender
  (`bpy`) and exports `public/models/alto.glb`.
- `VehicleFactory` now loads Blender models in `preload()` and maps named
  nodes to lights and wheels.

### Alto details from brochure photos — `f1f001f`
- Oval headlamps, slotted grille with badge, flared arches, silver steel
  wheels, black mirrors and handles, roof spoiler, and tail lamps in the
  rear bumper corners. Softer body edges.

### Sazgar auto-rickshaw — `0f603bc`, `879371c`
- `tools/blender/kit.py`: shared Blender helpers.
- `tools/blender/rickshaw.py`: the Sazgar CNG rickshaw, with its vinyl
  roof, orange cabin, striped side panels, beige backrest, green curtains
  and chrome frame.
- Traffic rickshaws use four liveries (orange, green, yellow, rust) and
  have a driver.
- `.gitignore` now ignores Python bytecode caches.

### Alto rebuilt as a smooth body; open-back rickshaw — `ab99422`
- **Alto rewritten from scratch:** 121 rounded cross-sections shaped by
  spline curves taken from the real car's dimensions. Windows and lamps
  are projected onto the curved body, and the grille, plate and handles
  sit flush with it.
- **Rickshaw:** back-to-back benches, with the rear one facing the open
  back above a footwell, like the real Sazgar.
- `VehicleFactory` can now merge model parts that have different vertex
  attributes.

### Truck-art minibus — `f23a3c0`
- `tools/blender/minibus.py`: the coaster-style route minibus from street
  photos. It has a cab-over body, split windscreen, chrome bull-bar, tin
  crests on the roof, a roof rack with luggage, barred windows, open
  doorways with grab poles, a rear ladder and mud flaps.
- Art panels are textured in game with truck art that varies per bus. A new
  windscreen texture shows framed peacocks and the Urdu route name.
- Passengers hang off the doors and ride on the roof.
- **Gameplay change:** the minibus collision box now matches the real size
  of about 7.4 m × 2.2 m.

## Phase 4 — Open city (Nov 14)

### Free roam on a Saddar street grid — `d20d07b`
A second game mode. Instead of the single straight route, you drive freely
around a grid of Saddar streets. The route run is still available from the
start screen or with `?mode=route`.
- `src/sim/city/cityMap.ts`: data-driven road network with junctions,
  two-way roads with lanes, a clockwise roundabout, city blocks with
  pavements, buildings with drivable back alleys, Empress Market, and
  collision shapes.
- `src/sim/city/CityTraffic.ts`: traffic that keeps to lanes, turns at
  junctions, takes turns at busy junctions, changes lanes around slow
  vehicles and gets out of deadlocks. It spawns in a ring around the
  player.
- `src/sim/city/CityWorld.ts`: the Alto can face any direction, buildings
  are solid, kerbs jolt the car, traffic can be shoved, and street-name
  banners hang over the roads.
- `src/render/CityScenery.ts`: asphalt, painted kerbs, lane markings and
  zebra crossings, the roundabout with its flag, shop signs, awnings, roof
  tanks, poles and wires, and median trees.

### Taxi fares — `e8765c8`
Free roam now has a goal.
- `src/sim/city/Fares.ts`: passengers wait at the kerb near the player.
  Stop next to one to pick them up, then drive them to one of 14 named
  Saddar places before their timer runs out. You are paid with a tip for
  speed and get extra shift time.
- Shortest-route guidance over the road network drives a HUD arrow and the
  minimap.
- **No game over:** a shift clock replaces it. When the shift ends you can
  keep driving off duty until you start a new one.
- Wrecking the Alto gets it towed back, with a repair bill and lost time.
- New visuals: waving passengers with markers coloured by ride length, a
  green beam over the destination, a guide arrow, a fare panel, money, a
  heading-up minimap with the route, and a shift-over card.

## Phase 5 — Game feel (Nov 14)

### Camera, tyre effects and body roll — `2e5aa63`
- **Chase camera:** a springy follow that leans into slides, a field of
  view that widens with speed, a camera that pulls back and drops at speed,
  a light rumble at speed and while drifting on top of impact shake, and a
  slight roll into turns.
- **Tyre effects (`TyreFx`):** dark skid marks that fade after 30 s, and
  tyre smoke from each wheel when sliding, cornering at the grip limit,
  braking hard or launching from a standstill.
- **Car body:** roll and pitch now use springs. The pitch direction was
  backwards and is fixed: the nose dips under braking and squats under
  throttle.
- Shaders are pre-compiled at startup, so nothing stutters the first time
  it is drawn.
