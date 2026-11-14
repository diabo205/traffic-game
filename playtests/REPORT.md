# Playtest round 1: feel pass (build 3029b4a → this branch)

Personas: `.claude/agents/gamer-{casual,speedrunner,chaos}.md` · protocol: `playtests/PROTOCOL.md`
Metrics snapshots: `baseline-metrics.txt` → `after-feel-pass-{1,2,3}.txt` (`tools/playtest/metrics.sh`)

## Fun ratings
| Persona | Before | After pass 1 (re-test) |
|---|---|---|
| gamer-casual | 6 | 7 |
| gamer-speedrunner | 6 | 7 |
| gamer-chaos | 5 | 6 |

## Top recurring complaints → fixes
1. **Sticky walls** (all 3): grazes cost 50–98 % of speed; buildings and ramp sides pinned the car at 0 km/h for up to 8 s; the route barrier could be ridden for free.
   → Glancing hits slide along the wall, and a pinned car can pivot off with gas + steer. Ramp sides, buildings and stopped traffic all count as walls. Grinding is not a repeat crash. A "STUCK? Hold S" hint appears. The barrier ride is hard-capped at 60 % of zone speed, and the dirt shoulder adds drag.
   City graze loss went from 74 % to 23–29 %, and the longest pin from 4.5 s to 0 s.
2. **Acceleration and dash** (speedrunner, casual, chaos): the top end dragged, and tap-spamming the dash beat holding the gas.
   → A cubic drive curve, lower aero drag and more eager part throttle. The dash now has its own 4 s cooldown and only works below 55 % of top speed.
   0–50 km/h went from 3.82 s to 3.45 s, and the spam strategy is dead.
3. **Hazards and traffic decide runs** (casual, speedrunner): a manhole halved your speed, and hazards kept firing after game over.
   → Manholes now keep 78 % of speed and do less damage, and nothing fires after game over. Traffic damage is softer at low closing speeds with the same ceiling, and rebounds are smaller.

## Still open (next candidates)
- Route Run is still hard: the lane autopilot wrecks on every seed. It never dodges, so this mostly measures the harness. Needs a smarter route-driving probe before more tuning.
- UI: Route Run has no goal or arrow at the start, the mobile menu is text-heavy, and there's no boost/cooldown or launch-ready indicator.
- Camera: reversing at full lock loses the car, and the camera clips into shop awnings on the pavement.
- Cosmetic: heading shimmies while sliding along a wall at full steer into it. Gas + brake + full lock against a wall is an endless on-the-spot spin (it's harmless, and could become a "donut" stunt).
