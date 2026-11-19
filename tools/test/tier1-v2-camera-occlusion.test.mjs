import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSimModules } from './helpers.mjs';

let mods;
let occMod;

before(async () => {
  mods = await loadSimModules();
  occMod = await mods.server.ssrLoadModule('/src/render/CameraOcclusion.ts');
});

after(async () => {
  await mods?.close();
});

describe('Tier 1 (V2 M2) — Analytical Camera Occlusion & Reverse Framing', () => {
  it('rayObbEnterT computes exact entry fractions for aligned, padded, and rotated OBBs', () => {
    const { rayObbEnterT } = occMod;

    // Axis-aligned box centered at (0, 10) with hw=2, hl=3 => z span [7, 13]
    const box = { x: 0, z: 10, hw: 2, hl: 3, heading: 0 };
    const tHit = rayObbEnterT(0, 0, 0, 14, box, 0);
    assert.ok(Math.abs(tHit - 0.5) < 1e-6, `Expected t=0.5, got ${tHit}`);

    // Asymmetric padding (padX=0.5 along right, padZ=1.0 along forward -> z span [6, 14])
    const tPadZ = rayObbEnterT(0, 0, 0, 12, box, 0.5, 1.0);
    assert.ok(Math.abs(tPadZ - 0.5) < 1e-6, `Expected padded t=0.5, got ${tPadZ}`);

    // Parallel ray outside expanded width misses (returns 1)
    const tMiss = rayObbEnterT(3.0, 0, 0, 20, box, 0.5, 0.5);
    assert.equal(tMiss, 1);

    // Ray starting inside the OBB returns 0
    const tInside = rayObbEnterT(0, 10, 0, 10, box, 0);
    assert.equal(tInside, 0);

    // 45-degree rotated OBB hit and miss
    const rot = { x: 10, z: 10, hw: 1, hl: 4, heading: Math.PI / 4 };
    const tRotHit = rayObbEnterT(0, 0, 20, 20, rot, 0.25);
    assert.ok(tRotHit > 0.2 && tRotHit < 0.5, `Rotated hit expected ~0.35, got ${tRotHit}`);
    const tRotMiss = rayObbEnterT(0, 20, 0, -20, rot, 0);
    assert.equal(tRotMiss, 1);
  });

  it('prevents solid OBB clipping across Saddar streets, corners, and reverse camera angles', () => {
    const { cityMap } = mods.cityMapMod;
    const { pointObbDistance } = mods.mathMod;
    const { CameraOcclusion } = occMod;

    const map = cityMap();
    const groundY = (x, z) => map.groundY(x, z);
    const occ = new CameraOcclusion();

    let checked = 0;
    let clippedCount = 0;
    const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4, -Math.PI / 4];

    for (let i = 0; i < map.links.length; i += 6) {
      const link = map.links[i];
      const u = map.nodes[link.from];
      const v = map.nodes[link.to];
      const rx = (u.x + v.x) * 0.5;
      const rz = (u.z + v.z) * 0.5;
      const gy = map.groundY(rx, rz);

      // Skip links that lie directly on a bridge or elevated ramp deck edge case
      let insideAtTarget = false;
      map.forEachSolidNear(rx, rz, 0.5, (s) => {
        if (pointObbDistance(rx, rz, s) < 0.25) insideAtTarget = true;
      });
      if (insideAtTarget) continue;

      for (const ang of angles) {
        occ.reset();
        const desiredCamX = rx - Math.sin(ang) * 6.0;
        const desiredCamZ = rz - Math.cos(ang) * 6.0;
        const targetZThree = -rz;
        const camZThree = -desiredCamZ;

        const res = occ.resolve(map, groundY, rx, gy, targetZThree, desiredCamX, gy + 2.35, camZThree, 2.1, 1 / 60);
        checked++;
        if (res.t < 0.999) clippedCount++;

        const resSimX = res.x;
        const resSimZ = -res.z;
        const floor = map.groundY(resSimX, resSimZ) + 0.85 - 1e-6;
        assert.ok(res.y >= floor, `Camera height ${res.y} dropped below floor clamp ${floor}`);

        // Verify resolved camera sits outside solid walls when it isn't jammed past a narrow 2m alley
        map.forEachSolidNear(resSimX, resSimZ, 0.4, (s) => {
          const bTop = typeof s.h === 'number' ? s.h + 0.65 : 18;
          if (res.y <= bTop) {
            const d = pointObbDistance(resSimX, resSimZ, s);
            const horiz = Math.hypot(resSimX - rx, resSimZ - rz);
            if (horiz > 2.25) {
              assert.ok(d > 0.1, `Camera penetrated solid OBB at (${resSimX.toFixed(1)}, ${resSimZ.toFixed(1)}), dist=${d}`);
            }
          }
        });
      }
    }

    assert.ok(checked >= 150, `Expected at least 150 camera samples, checked ${checked}`);
    assert.ok(clippedCount > 0, 'Expected narrow Saddar street angles to trigger building occlusion pull-in');
  });

  it('pulls in earlier for Saddar ground-floor awnings at y=2.4m than above awnings', () => {
    const { CameraOcclusion } = occMod;
    const b = { x: 12, z: 0, hw: 2, hl: 6, heading: 0, storeys: 3, style: 'masonry', h: 11, seed: 1 };
    const fakeMap = {
      bridges: [],
      forEachSolidNear(_cx, _cz, _r, fn) {
        fn(b);
      },
    };
    const flatGround = () => 0;

    const occLow = new CameraOcclusion();
    const resAwning = occLow.resolve(fakeMap, flatGround, 0, 0, 0, 11, 2.4, 0, 2.1, 1 / 60);

    const occHigh = new CameraOcclusion();
    const resAbove = occHigh.resolve(fakeMap, flatGround, 0, 0, 0, 11, 6.2, 0, 2.1, 1 / 60);

    // At x = 11 against OBB left wall x = 10: awning pad (1.05 -> x=8.95) pulls in more than wall pad (0.38 -> x=9.62)
    assert.ok(resAwning.t < resAbove.t, `Awning t=${resAwning.t.toFixed(3)} should pull in earlier than high wall t=${resAbove.t.toFixed(3)}`);
  });

  it('handles all Saddar pedestrian bridge piers, overhead decks, and under-deck ceiling cap', () => {
    const { cityMap } = mods.cityMapMod;
    const { CameraOcclusion } = occMod;

    const map = cityMap();
    const groundY = (x, z) => map.groundY(x, z);
    assert.ok(map.bridges.length >= 6, `Expected >= 6 Saddar bridges, found ${map.bridges.length}`);

    let pierPulls = 0;
    let deckPulls = 0;
    let underDeckCaps = 0;

    for (const br of map.bridges) {
      const occ = new CameraOcclusion();
      const s = Math.sin(br.heading);
      const c = Math.cos(br.heading);
      const halfSpan = br.span * 0.5;

      // 1. Ray aimed directly across a pavement support pier
      const pierX = br.x + c * halfSpan;
      const pierZ = br.z - s * halfSpan;
      const startX = pierX - s * 7;
      const startZ = pierZ - c * 7;
      const endX = pierX + s * 3;
      const endZ = pierZ + c * 3;
      occ.reset();
      const resPier = occ.resolve(map, groundY, startX, 0, -startZ, endX, 2.4, -endZ, 2.1, 1 / 60);
      if (resPier.t < 0.99) pierPulls++;

      // 2. Ray slanting through overhead deck height (y ~ 6.2m)
      occ.reset();
      const resDeck = occ.resolve(map, groundY, br.x - s * 8, 5.2, -(br.z - c * 8), br.x + s * 4, 7.2, -(br.z + c * 4), 2.1, 1 / 60);
      if (resDeck.t < 0.99) deckPulls++;

      // 3. Pulled-in camera sitting directly under the bridge deck stays capped below deck underside (<= 4.7m)
      occ.reset();
      const underCamX = br.x + c * (halfSpan - 0.6) - s * 1.0;
      const underCamZ = br.z - s * (halfSpan - 0.6) - c * 1.0;
      const pierPullCamX = br.x + c * (halfSpan + 1.8) - s * 1.5;
      const pierPullCamZ = br.z - s * (halfSpan + 1.8) - c * 1.5;
      const tgtX = br.x + s * 3.5 + c * 1.5;
      const tgtZ = br.z + c * 3.5 - s * 1.5;
      const resUnder = occ.resolve(map, groundY, tgtX, 2.8, -tgtZ, pierPullCamX, 4.65, -pierPullCamZ, 2.1, 1 / 60);
      const resDeckBox = occ.resolve(map, groundY, tgtX, 2.8, -tgtZ, underCamX, 4.65, -underCamZ, 2.1, 0);
      if (resUnder.t < 0.995 && resUnder.y <= 4.7001 && resDeckBox.y <= 4.7001) underDeckCaps++;
    }

    assert.equal(pierPulls, map.bridges.length, 'All bridge piers should occlude camera rays');
    assert.equal(deckPulls, map.bridges.length, 'All bridge overhead decks should occlude elevated rays');
    assert.ok(underDeckCaps >= map.bridges.length, `Under-deck ceiling cap failed (${underDeckCaps}/${map.bridges.length})`);
  });

  it('applies asymmetric hysteresis: instant pull-in and smooth exponential release', () => {
    const { CameraOcclusion } = occMod;
    const occ = new CameraOcclusion();
    const b = { x: 8, z: 0, hw: 2, hl: 4, heading: 0, h: 12 };
    let block = true;
    const dynMap = {
      bridges: [],
      forEachSolidNear(_cx, _cz, _r, fn) {
        if (block) fn(b);
      },
    };
    const flatGround = () => 0;

    // Frame 1: obstacle appears -> snaps inward on the very first 16ms frame
    // Note: resolve() returns a shared scratch result object, so capture .t as a scalar!
    const tIn = occ.resolve(dynMap, flatGround, 0, 0, 0, 10, 2.2, 0, 2.1, 1 / 60).t;
    assert.ok(tIn < 0.65, `Expected immediate snap inward, got t=${tIn}`);

    // Obstacle clears -> releases smoothly across multiple frames rather than jumping to 1.0 immediately
    block = false;
    const tOut1 = occ.resolve(dynMap, flatGround, 0, 0, 0, 10, 2.2, 0, 2.1, 1 / 60).t;
    const tOut2 = occ.resolve(dynMap, flatGround, 0, 0, 0, 10, 2.2, 0, 2.1, 1 / 60).t;
    assert.ok(tOut1 > tIn && tOut1 < 0.75, `Release frame 1 should ease gradually, got t=${tOut1} (tIn=${tIn})`);
    assert.ok(tOut2 > tOut1 && tOut2 < 0.85, `Release frame 2 should grow monotonically, got t=${tOut2}`);

    // Over 1 second of clear frames, converges near 1.0
    let tFinal = tOut2;
    for (let i = 0; i < 60; i++) {
      tFinal = occ.resolve(dynMap, flatGround, 0, 0, 0, 10, 2.2, 0, 2.1, 1 / 60).t;
    }
    assert.ok(tFinal > 0.99, `Expected convergence near 1.0 after 1s, got t=${tFinal}`);
  });
});
