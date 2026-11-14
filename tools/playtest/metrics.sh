#!/usr/bin/env bash
# One-line feel metrics for every built-in probe (for before/after comparisons).
#   tools/playtest/metrics.sh [seed]
cd "$(dirname "$0")/../.." || exit 1
seed="${1:-1337}"
for s in $(node tools/playtest/sim.mjs list | awk '{print $1}'); do
  node tools/playtest/sim.mjs "$s" --seed "$seed" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d),m=o.metrics,f=o.final;
    console.log([o.scenario.padEnd(16),"t50="+m.t50,"top="+m.topKmh,"stop="+m.stopDistM+"m","wall="+m.longestWallContactS+"s","wallLoss="+m.speedLostOnWallPct+"%","stuck="+m.longestStuckS+"s","hp="+f.hp,"crashes="+f.crashes,"nan="+m.nanOrInf].join(" "))})'
done
