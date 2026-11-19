# Karachi Traffic 3D — Version 2 Plan

## Locked V2 Architectural & Product Decisions
1. **Map Scope:** Polish one dense district (**Saddar**) first, get the core loop working cleanly, and structure chunk/map boundaries so Shahrah-e-Faisal, Lyari Expressway, and Clifton can plug in cleanly later.
2. **Renderer Backend:** **WebGL2** (`THREE.WebGLRenderer` + `BatchedMesh` + `InstancedMesh` + tier-gated `pmndrs/postprocessing`) for universal desktop/mobile/SwiftShader reliability.
3. **Gameplay Priority:** **Taxi loop + Garage upgrades first**, tying Saddar taxi earnings directly into performance upgrades and visual/audio customization.
4. **Repository & Continuity:** Built on the `v2` branch carrying over V1's pure deterministic `src/sim/`, `tools/test/`, and `tools/playtest/` verification harness with zero regressions.

---

## Milestones

| Milestone | Scope | Exit Gate |
| --- | --- | --- |
| **M0: Branch, Plan & Cross-Platform Tooling** | `v2` branch from `main`, Windows/Linux/macOS browser E2E (`findChromium`) and Node `metrics.mjs`, baseline captures. | `npm test`, `npm run build`, `npm run playtest:metrics`, `npm run playtest:balance`, `npm run test:e2e` all pass. |
| **M1: Pure Sim Core — Upgrades, Taxi Loop & IDM Traffic** | `src/sim/upgrades.ts` (4 upgrade tracks, race↔drift tuning, cosmetics, derived showcase stats), `PlayerCar` build/boostMeter/wall-shimmy polish, `Fares` fragile `'chai'` fares & snappier stops, `CityTraffic` IDM + Block-the-Box + multi-pass separation. | Stock specs bit-identical to V1; V1 Tiers 1–3 + new V2 sim unit tests pass; 5-min multi-seed traffic overlap rate `< 0.02/s`; sim purity clean. |
| **M2: Ground-Up WebGL2 Dense Saddar Renderer** | `BatchedMesh` city geometry, `InstancedMesh` props/traffic, Meshopt `.glb` asset compression, occlusion-aware chase/reverse camera, tier-gated `pmndrs/postprocessing`. | `< 60` draw calls in dense Saddar, 60 FPS target, 0 camera clipping regressions, 0 console/page errors. |
| **M3: AudioWorklet Engine & Spatial Traffic DSP** | Off-thread `AudioWorklet` engine synthesis (with single-file fallback), Doppler passing traffic, unlockable melodic horns, Karachi FM integration. | Glitch-free audio across desktop/mobile and single-file build (`npm run pack`). |
| **M4: NFS Heat Garage Upgrade UI & Streamlined Taxi HUD** | Interactive upgrade & customization bay inside the 3D garage (`engine`, `nitrous`, `handling` bias slider, `armor`, paints, truck-art liveries, underglow, horns) + crisp mobile-first taxi HUD. | Full Tier 1–4 E2E across `1280×720`, `412×915`, `844×390` with `localStorage` persistence & zero overlap. |
| **M5: 6-Persona Playtest Polish** | Full playtest pass with all 6 gamer personas (`casual`, `speedrunner`, `chaos`, `mobile-ux`, `taxi-loop`, `world-sim`). | Target ≥ 8.5/10 across all personas with zero open P0/P1 issues. |
