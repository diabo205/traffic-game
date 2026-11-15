"""Honda CD-70 motorcycle (the ubiquitous 70cc bike on Karachi roads).
Exports public/models/bike.glb. Riders are added in VehicleFactory.ts.
Run headless:  python tools/blender/bike.py   (needs `pip install bpy`)
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import bar, cube, cyl  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "bike")
kit.reset()

PAINT = kit.mat("paint", "#c0161c", 0.3)
SEAT = kit.mat("seat", "#241c1a", 0.65)
TRIM = kit.mat("trim", "#18191b", 0.72)
CHROME = kit.mat("chrome", "#d8dcdf", 0.22, 0.85)
STEEL = kit.mat("steel", "#60666d", 0.45, 0.55)
PLATE = kit.mat("plate", "#f2efe4", 0.45)
TYRE = kit.mat("tyre", "#1f1f21", 0.9)
RIM = kit.mat("rim", "#b9bec3", 0.35, 0.65)
HEAD = kit.mat("head", "#eef0e6", 0.15)
BRAKE = kit.mat("brake", "#8a1a1a", 0.3)
AMBER = kit.mat("hazard", "#d0861a", 0.3)

R = 0.30
kit.wheel("wheel_F", 0, 0.68, R, 0.09, TYRE, RIM, TRIM, holes=6)
kit.wheel("wheel_R", 0, -0.68, R, 0.11, TYRE, RIM, TRIM, holes=6)

bar("frame_top", (0, 0.45, 0.72), (0, -0.38, 0.66), 0.025, TRIM)
bar("frame_down", (0, 0.46, 0.68), (0, 0.14, 0.36), 0.024, TRIM)
for sx in (-1, 1):
    bar(f"fork_{sx}", (sx * 0.085, 0.68, 0.30), (sx * 0.085, 0.45, 0.88), 0.022, CHROME)
    bar(f"bar_half_{sx}", (sx * 0.08, 0.46, 0.90), (sx * 0.32, 0.34, 0.97), 0.014, CHROME)
    bar(f"grip_{sx}", (sx * 0.24, 0.37, 0.95), (sx * 0.34, 0.33, 0.975), 0.02, TRIM)
    bar(f"mirror_arm_{sx}", (sx * 0.22, 0.38, 0.95), (sx * 0.28, 0.40, 1.12), 0.008, TRIM)
    cube(f"mirror_{sx}", (sx * 0.29, 0.40, 1.14), (0.09, 0.025, 0.06), TRIM)
    bar(f"rear_stay_{sx}", (sx * 0.07, -0.32, 0.66), (sx * 0.08, -0.68, 0.30), 0.02, CHROME)
    bar(f"swing_{sx}", (sx * 0.08, -0.10, 0.33), (sx * 0.08, -0.68, 0.30), 0.022, TRIM)

kit.arch_lip(0, 0.68, R, R + 0.05, CHROME, 0.025, keep_above=-0.02)
kit.arch_lip(0, -0.62, R + 0.08, R + 0.06, CHROME, 0.025, keep_above=0.05)

cube("tank", (0, 0.18, 0.77), (0.28, 0.46, 0.20), PAINT, 0.06)
cube("tank_stripe", (0, 0.18, 0.78), (0.30, 0.34, 0.035), PLATE)
cube("side_cov", (0, -0.14, 0.57), (0.26, 0.22, 0.16), PAINT, 0.03)
cube("seat", (0, -0.34, 0.75), (0.24, 0.58, 0.10), SEAT, 0.035)
cube("grab_rail", (0, -0.68, 0.77), (0.26, 0.12, 0.025), CHROME)
cube("engine_crank", (0, 0.05, 0.38), (0.28, 0.28, 0.18), CHROME, 0.03)
cube("engine_cyl", (0, 0.18, 0.51), (0.18, 0.18, 0.18), STEEL, 0.02, rot=(-0.3, 0, 0))
bar("exhaust_pipe", (0.12, 0.22, 0.44), (0.15, -0.12, 0.24), 0.02, CHROME)
cyl("muffler", (0.16, -0.42, 0.27), 0.04, 0.56, CHROME, rot=(math.pi / 2 - 0.08, 0, 0))

cyl("lamp_cowl", (0, 0.58, 0.86), 0.088, 0.12, TRIM, rot=(math.pi / 2, 0, 0))
cyl("head_lamp", (0, 0.64, 0.86), 0.078, 0.03, HEAD, rot=(math.pi / 2, 0, 0))
cube("brake_lamp", (0, -0.80, 0.76), (0.12, 0.05, 0.09), BRAKE)
cube("plate_r", (0, -0.83, 0.64), (0.16, 0.02, 0.10), PLATE, rot=(0.2, 0, 0))
for sx in (-1, 1):
    cube(f"hazard_f{sx}", (sx * 0.14, 0.56, 0.85), (0.055, 0.05, 0.045), AMBER)
    cube(f"hazard_r{sx}", (sx * 0.12, -0.78, 0.75), (0.05, 0.04, 0.04), AMBER)

kit.export(OUT)
