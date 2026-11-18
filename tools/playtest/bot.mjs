/**
 * Smart headless playtest bots for Route Run and Free Roam (Saddar).
 * Used by tools/playtest/balance.mjs and tools/playtest/sim.mjs.
 *
 * Returns an InputFrame: { throttle, brake, steer, horn, dipper }.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const NPC_HALF_W = {
  bike: 0.42,
  rickshaw: 0.72,
  cart: 0.78,
  car: 0.92,
  minibus: 1.08,
  truck: 1.25,
};

const NPC_HALF_L = {
  bike: 1.0,
  rickshaw: 1.5,
  cart: 1.5,
  car: 2.2,
  minibus: 3.4,
  truck: 4.1,
};

const HAZARD_PENALTY = {
  barrier: 1200,
  manhole: 260,
  pothole: 90,
  water: 18,
  checkpoint: 0,
};

/**
 * Stateful Route Run bot: scans hazards & traffic ahead, picks the cleanest
 * lane/gap, modulates speed for tight traffic, and honks when boxed in.
 */
export function createRouteBot(road) {
  let targetX = null;
  let stuckTicks = 0;
  let reverseTicks = 0;

  return function step(world) {
    const p = world.player;
    const r = road.sampleRoad(p.z);
    const rAhead = road.sampleRoad(p.z + 28);

    if (reverseTicks > 0) {
      reverseTicks--;
      const mid = (r.left + r.right) * 0.5;
      const steer = p.x < mid ? 0.8 : -0.8;
      return { throttle: 0, brake: 1, steer, horn: false, dipper: false };
    }

    if (Math.abs(p.speed) < 1.2 && world.tick > 40) {
      stuckTicks++;
      if (stuckTicks > 36) {
        stuckTicks = 0;
        reverseTicks = 48;
        return { throttle: 0, brake: 1, steer: 0, horn: true, dipper: false };
      }
    } else {
      stuckTicks = Math.max(0, stuckTicks - 2);
    }

    const speed = Math.max(4, p.speed);
    const lookahead = clamp(28 + speed * 1.6, 30, 80);

    // Candidate lateral positions: lane centers + lane dividers + shoulder
    const candidates = [];
    const lanes = Math.min(r.lanes, rAhead.lanes);
    const left = Math.max(r.left, rAhead.left);
    const right = Math.min(r.right, rAhead.right);
    const lw = (right - left) / lanes;

    for (let i = 0; i < lanes; i++) {
      candidates.push({ x: left + lw * (i + 0.5), shoulder: false });
      if (i < lanes - 1) {
        candidates.push({ x: left + lw * (i + 1.0), shoulder: false });
      }
    }
    if (r.shoulder > 1.2 && rAhead.shoulder > 1.2) {
      candidates.push({ x: left - Math.min(r.shoulder, rAhead.shoulder) * 0.5, shoulder: true });
    }
    if (world.hazards.roadblocks) {
      for (const rb of world.hazards.roadblocks) {
        if (rb.z >= p.z - 4 && rb.z <= p.z + lookahead + 20) {
          candidates.push({ x: rb.openX, shoulder: rb.openX < left });
        }
      }
    }

    // Collect nearby hazards
    const hazards = [];
    world.hazards.forEachInRange(p.z - 2, p.z + lookahead, (h) => {
      if (h.kind !== 'checkpoint' || h.solid) hazards.push(h);
    });

    // Collect nearby NPCs
    const npcs = [];
    for (const n of world.traffic.npcs) {
      const dz = n.z - p.z;
      if (dz > -4 && dz < lookahead + 18) npcs.push(n);
    }

    const myHw = p.spec?.halfWidth ?? 0.85;
    let best = candidates[0];
    let bestCost = Infinity;
    let bestClearTtc = Infinity;

    for (const c of candidates) {
      let cost = 0;
      let minTtc = Infinity;

      // Stay off the shoulder unless dodging
      if (c.shoulder) cost += 28;
      // Keep away from edges
      const marginL = c.x - (left - (c.shoulder ? r.shoulder : 0));
      const marginR = right - c.x;
      if (marginL < myHw + 0.25) cost += 140;
      if (marginR < myHw + 0.25) cost += 140;

      // Slight stability bias toward current target / current x
      if (targetX !== null) cost += Math.abs(c.x - targetX) * 1.1;
      cost += Math.abs(c.x - p.x) * 0.8;

      // Hazard cost
      for (const h of hazards) {
        const dz = h.z - p.z;
        const dx = Math.abs(c.x - h.x);
        const clearLat = myHw + h.hw + (h.solid ? 0.65 : 0.35);
        if (dx < clearLat) {
          const pen = h.solid ? HAZARD_PENALTY.barrier : (HAZARD_PENALTY[h.kind] ?? 60);
          const urgency = 1 / Math.max(4, dz + 2);
          const overlap = (clearLat - dx) / clearLat;
          cost += pen * overlap * (1 + urgency * 20);
          if (h.solid && dz > 0) minTtc = Math.min(minTtc, dz / speed);
        }
      }

      // Traffic cost (predict NPC z at time-to-reach)
      for (const n of npcs) {
        const dz = n.z - p.z;
        const npcSpeed = n.dir === -1 ? 11 : 13;
        const relSpeed = n.dir === -1 ? speed + npcSpeed : Math.max(3, speed - npcSpeed);
        const ttc = dz > 0 ? dz / relSpeed : 0;
        const predZ = n.z + n.dir * npcSpeed * Math.min(ttc, 2.2);
        const predDz = predZ - p.z;
        if (predDz < -3 || predDz > lookahead) continue;

        const nhw = NPC_HALF_W[n.kind] ?? 0.9;
        const nhl = NPC_HALF_L[n.kind] ?? 2.0;
        const clearLat = myHw + nhw + 0.55;
        const dx = Math.abs(c.x - n.x);
        if (dx < clearLat) {
          const overlap = (clearLat - dx) / clearLat;
          const prox = predDz <= nhl + 2.5 ? 3.0 : 1 / Math.max(0.25, ttc);
          cost += 190 * overlap * prox;
          if (dx < myHw + nhw + 0.15 && dz > 0) {
            minTtc = Math.min(minTtc, dz / relSpeed);
          }
        }
      }

      if (cost < bestCost) {
        bestCost = cost;
        best = c;
        bestClearTtc = minTtc;
      }
    }

    targetX = best.x;
    const dx = targetX - p.x;
    const aimZ = clamp(12 + speed * 0.42, 12, 28);
    const wantHeading = clamp(Math.atan2(dx, aimZ), -0.5, 0.5);
    const steer = clamp(wrap(wantHeading - p.heading) * 2.9 - p.yawRate * 0.18, -1, 1);

    // Check immediate danger directly in front of current x
    let frontBlocked = false;
    let frontTtc = Infinity;
    for (const n of npcs) {
      const dz = n.z - p.z;
      if (dz > 1 && dz < 24) {
        const nhw = NPC_HALF_W[n.kind] ?? 0.9;
        if (Math.abs(n.x - p.x) < myHw + nhw + 0.3) {
          frontBlocked = true;
          const rel = n.dir === -1 ? speed + 11 : Math.max(2, speed - 12);
          frontTtc = Math.min(frontTtc, dz / rel);
        }
      }
    }
    for (const h of hazards) {
      if (h.solid && h.z > p.z && h.z - p.z < 26 && Math.abs(h.x - p.x) < myHw + h.hw + 0.35) {
        frontBlocked = true;
        frontTtc = Math.min(frontTtc, (h.z - p.z) / speed);
      }
    }

    let throttle = 1;
    let brake = 0;
    const horn = frontBlocked && frontTtc < 1.6;

    if (frontBlocked && frontTtc < 0.95 && Math.abs(dx) > 0.8) {
      throttle = 0;
      brake = 0.8;
    } else if (bestClearTtc < 1.0) {
      throttle = 0.25;
      brake = 0.5;
    } else if (Math.abs(steer) > 0.65 && speed > 22) {
      throttle = 0.7;
    }

    return { throttle, brake, steer, horn, dipper: false };
  };
}

/**
 * Stateful Free Roam (Saddar) taxi bot: follows Fares.navPath, picks up
 * waiting passengers, drops them at named destinations, dodges solids/NPCs,
 * and automatically reverses out if pinned.
 */
export function createCityBot() {
  let stuckTicks = 0;
  let reverseTicks = 0;
  let reverseSteer = 1;

  return function step(world) {
    const p = world.player;
    const fares = world.fares;

    // Handle active unstick reverse maneuver
    if (reverseTicks > 0) {
      reverseTicks--;
      return { throttle: 0, brake: 1, steer: reverseSteer, horn: false, dipper: false };
    }

    // Detect if pinned/stuck while trying to drive
    if (Math.abs(p.speed) < 0.85 && world.tick > 45) {
      stuckTicks++;
      if (stuckTicks > 38) {
        stuckTicks = 0;
        reverseTicks = 66;
        const link = world.map.linkAt(p.x, p.z, p.heading);
        if (link) {
          const rx = p.x - link.sx, rz = p.z - link.sz;
          const cur = -rx * link.dz + rz * link.dx;
          const off = world.map.laneOffset?.(link, Math.floor(link.lanes / 2)) ?? 0;
          reverseSteer = cur > off ? -0.8 : 0.8;
        } else {
          reverseSteer = (world.tick & 64) ? 0.8 : -0.8;
        }
        return { throttle: 0, brake: 1, steer: reverseSteer, horn: true, dipper: false };
      }
    } else {
      stuckTicks = Math.max(0, stuckTicks - 2);
    }

    // Determine exact target point (pickup or drop-off)
    let targetX = fares.navX;
    let targetZ = fares.navZ;
    let stopDist = 0;

    if (fares.fare) {
      const dest = fares.places[fares.fare.dest];
      if (dest) {
        const d = Math.hypot(dest.x - p.x, dest.z - p.z);
        if (d < 8.5) {
          stuckTicks = 0;
          return { throttle: 0, brake: p.speed > 0.5 ? 1 : 0, steer: 0, horn: false, dipper: false };
        }
        if (d < 20) {
          targetX = dest.x;
          targetZ = dest.z;
          stopDist = d;
        }
      }
    } else if (fares.waiting.length > 0) {
      let bestP = null;
      let bestD = Infinity;
      for (const w of fares.waiting) {
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bestD) {
          bestD = d;
          bestP = w;
        }
      }
      if (bestP && bestD < 4.8) {
        stuckTicks = 0;
        return { throttle: 0, brake: p.speed > 0.5 ? 1 : 0, steer: 0, horn: false, dipper: false };
      }
      if (bestP && bestD < 18) {
        targetX = bestP.x;
        targetZ = bestP.z;
        stopDist = bestD;
      }
    }

    // Follow navPath lookahead if further away (tighter lookahead at low speed for clean corners)
    const path = fares.navPath;
    if (stopDist === 0 && path && path.length >= 4) {
      const lookDist = clamp(7 + Math.max(0, p.speed) * 0.45, 7, 18);
      let acc = 0;
      let lx = path[path.length - 2];
      let lz = path[path.length - 1];
      for (let i = 0; i < path.length - 2; i += 2) {
        const ax = path[i], az = path[i + 1];
        const bx = path[i + 2], bz = path[i + 3];
        const segLen = Math.hypot(bx - ax, bz - az);
        if (acc + segLen >= lookDist) {
          const f = (lookDist - acc) / Math.max(0.01, segLen);
          lx = ax + (bx - ax) * f;
          lz = az + (bz - az) * f;
          break;
        }
        acc += segLen;
      }
      targetX = lx;
      targetZ = lz;
    }

    const dx = targetX - p.x;
    const dz = targetZ - p.z;
    let wantHeading = Math.atan2(dx, dz);

    // Gentle lane-keeping pull when on a street link (keeps car off pavements)
    const curLink = world.map.linkAt(p.x, p.z, p.heading);
    if (curLink && stopDist === 0 && Math.abs(wrap(wantHeading - curLink.heading)) < 0.4) {
      const off = world.map.laneOffset?.(curLink, Math.max(0, curLink.lanes - 1)) ?? 0;
      const rx0 = p.x - curLink.sx, rz0 = p.z - curLink.sz;
      const curLat = -rx0 * curLink.dz + rz0 * curLink.dx;
      wantHeading = wrap(wantHeading - clamp((off - curLat) * 0.05, -0.22, 0.22));
    }

    // Local obstacle avoidance: check NPCs and buildings ahead
    let avoidSteer = 0;
    let solidDanger = false;
    let npcAhead = false;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const rx = Math.cos(p.heading);
    const rz = -Math.sin(p.heading);

    for (const n of world.traffic.npcs) {
      const ndx = n.x - p.x;
      const ndz = n.z - p.z;
      const along = ndx * fx + ndz * fz;
      const lat = ndx * rx + ndz * rz;
      if (along > 0.5 && along < 15 && Math.abs(lat) < 2.4) {
        npcAhead = true;
        avoidSteer += (lat >= 0 ? -1 : 1) * (1 - along / 15) * 0.85;
      }
    }

    world.map.forEachSolidNear(p.x + fx * 6, p.z + fz * 6, 8, (sb) => {
      const sdx = sb.x - p.x;
      const sdz = sb.z - p.z;
      const along = sdx * fx + sdz * fz;
      const lat = sdx * rx + sdz * rz;
      if (along > 0.2 && along < 11 && Math.abs(lat) < sb.hw + 2.0) {
        solidDanger = true;
        avoidSteer += (lat >= 0 ? -1 : 1) * (1 - along / 11) * 1.1;
      }
    });

    const err = wrap(wantHeading - p.heading);
    const steer = clamp(err * 2.5 - p.yawRate * 0.16 + avoidSteer, -1, 1);

    // Speed control for sharp corners, buildings, traffic, and approaching pickup/drop-off
    let throttle = p.speed < 16.5 ? 1 : 0.25;
    let brake = 0;
    const absErr = Math.abs(err);
    if (stopDist > 0 && stopDist < 14 && p.speed > 8) {
      throttle = 0;
      brake = 0.65;
    } else if (solidDanger && p.speed > 7) {
      throttle = 0;
      brake = 0.6;
    } else if (npcAhead && p.speed > 12) {
      throttle = 0.1;
      brake = 0.35;
    } else if (absErr > 0.85 && p.speed > 8) {
      throttle = 0;
      brake = 0.6;
    } else if (absErr > 0.35 && p.speed > 11.5) {
      throttle = 0.15;
    }

    return { throttle, brake, steer, horn: npcAhead, dipper: false };
  };
}
