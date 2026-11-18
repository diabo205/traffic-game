# Handoff: moving to a local session for Blender MCP modelling

Written 2026-11-18 from the cloud session on branch `claude/charming-sagan-d6b4ra` (head `c6f9af4`, pushed).
Read `CLAUDE.md` (binding architecture rules) and `HANDOFF.md` (broader project handoff; its branch names are stale, this branch is the latest game) first.

## Why local
The cloud container has no display and no way to reach a Blender GUI, so the Blender MCP server can't be used there. Models so far were built by **headless `bpy` scripts** (`tools/blender/*.py`). Locally, with Blender open and the Blender MCP add-on connected, we can model interactively, look at the result, and iterate.

## Get set up locally
```bash
git clone <repo> && cd traffic-game
git fetch origin claude/charming-sagan-d6b4ra && git checkout claude/charming-sagan-d6b4ra
npm install
npm run dev        # http://localhost:5173, ?mode=city or ?mode=route
```
Then start a local Claude Code session in that folder with the Blender MCP server configured, and open Blender with the MCP add-on connected.

## Current vehicle models (`public/models/*.glb`, loaded by `src/render/VehicleFactory.ts`)
| File | Vehicle | Source script |
|---|---|---|
| `alto.glb` | Player's Suzuki Alto (HA36) | `tools/blender/alto.py` (lofted body, ~80 cross-sections) |
| `rickshaw.glb`, `minibus.glb` | Sazgar rickshaw, truck-art W-11 minibus | `rickshaw.py`, `minibus.py` |
| `car.glb`, `truck.glb`, `bike.glb`, `cart.glb` | sedan/taxi, Bedford, CD-70, rehri | `car.py`, `truck.py`, `bike.py`, `cart.py` |

Shared helpers are in `tools/blender/kit.py` (`mat`, `cube`, `cyl`, `bar`, `join`, `wheel`, `arch_lip`, `art_plane`, `export`). Headless rebuild: `python -m venv bl && bl/bin/pip install bpy && bl/bin/python tools/blender/alto.py` (import `bpy` before `bmesh`).

The Alto is real-world sized: L 3.395, W 1.475, H 1.475 m, wheelbase 2.46 m.

## Contract a new or edited model must satisfy
`VehicleFactory.fromModel()` reads the glb by naming convention. Break these and lights, wheel spin or paint recolouring silently stop working.

- **Axes**: Blender **+Y is the vehicle front** (exports to glTF −Z, which is three's forward), **Z up**, metres, origin on the ground under the vehicle's centre. Wheels sit on y = 0 after export.
- **Top-level node names** (the factory only inspects direct children of the scene):
  - `wheel_*` — spins. Needs its pivot at the wheel centre. The Alto's `wheelRadius` is set in code at `0.28` (`fromModel('alto', 0.28)`); if you change the tyre radius, update that number.
  - `head_*` — headlight lens, swapped to the on/off emissive materials. A beam cone and ground light pool are attached from the first `head_*` position.
  - `brake_*` — taillights (brake light on/off).
  - `hazard_*` — indicators.
- **Material names**: `paint` is recoloured per variant at runtime (keep body paint on exactly this material name). Truck/minibus use `art_*` materials for canvas truck-art textures.
- Materials are converted to flat-shaded-friendly Lambert at load, so PBR detail (roughness, metal, normal maps) is ignored. Keep colour in base colour.
- **Style and budget**: stylised low-poly, readable at ~10–25 m behind the car, must hold 60 FPS on phones. The current Alto glb is 814 KB, the heaviest model, so check triangle count before adding detail. NPCs spawn in volume, so every NPC model should stay light.
- **Export**: glTF binary (.glb), `+Y up` off (Blender exporter default converts), apply modifiers, one file per vehicle, written to `public/models/<name>.glb`. Don't change filenames: `VehicleFactory.preload()` loads by name and falls back to a procedural mesh if a file is missing.

## Hard rule: mesh never affects gameplay
Collision sizes live in `src/sim/` (`ALTO` in `src/sim/PlayerCar.ts`: `halfWidth 0.74`, `halfLength 1.7`, `wheelBase 2.36`; NPC sizes in `NPC_SPECS` in `src/sim/TrafficManager.ts`). Keep new models roughly inside those footprints so visuals match collisions. Do not edit sim files to fit a model.

## How to check a model in the game
- `npm run dev`, open `?mode=city`. The Alto is the player car.
- Faster iteration: `landmark.html` / `src/dev/landmarkViewer.ts` is a viewer for landmarks; check whether it can be pointed at a vehicle, or just reload the main game after re-exporting the glb (Vite serves `public/` live).
- Check: nose faces forward, wheels spin and touch the ground, brake lights light on braking (S), headlights on at night / dipper (F or Shift), body recolours where expected.
- Before committing: `npm run build`, and the sim-purity grep from `HANDOFF.md` §1 (should print nothing).

## Suggested first tasks in the local session
1. Open `alto.glb` in Blender (or run `alto.py`) and judge it by eye in the live MCP viewport. Likely wants: cleaner silhouette at game distance, lower poly count, checks on wheel arches and light placement.
2. Remodel/improve other vehicles in priority order of screen time: sedan/taxi (`car`), bike, Bedford truck, cart.
3. Keep each model's script in `tools/blender/` in sync with what you build interactively (or save the `.blend` into `tools/blender/` and note it), so the model can be regenerated.

## Other open work (not for this session)
See `HANDOFF.md` §6: real Saddar streets from OpenStreetMap (blocked in the cloud sandbox because `overpass-api.de` was unreachable, fine from a local machine), playtest-branch merge, phone performance pass.

## Git
Develop on `claude/charming-sagan-d6b4ra` (or a branch off it). Commit trailers used here are optional locally. Don't open a PR unless asked.
