"""Karachi compact/midsize sedan (Toyota Corolla / Suzuki Mehran style).
Exports public/models/car.glb. Paint is recoloured per traffic variant.
Run headless:  python tools/blender/car.py   (needs `pip install bpy`)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import cube  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "car")
kit.reset()

PAINT = kit.mat("paint", "#f2f2f2", 0.30)
GLASS = kit.mat("glass", "#28363f", 0.08)
TRIM = kit.mat("trim", "#18191b", 0.72)
CHROME = kit.mat("chrome", "#d8dcdf", 0.22, 0.85)
PLATE = kit.mat("plate", "#f2efe4", 0.45)
TYRE = kit.mat("tyre", "#1f1f21", 0.9)
RIM = kit.mat("rim", "#b9bec3", 0.35, 0.65)
HEAD = kit.mat("head", "#eef0e6", 0.15)
BRAKE = kit.mat("brake", "#8a1a1a", 0.3)
AMBER = kit.mat("hazard", "#d0861a", 0.3)

R = 0.32
for name, x, y in (("wheel_FL", -0.78, 1.36), ("wheel_FR", 0.78, 1.36),
                   ("wheel_RL", -0.78, -1.36), ("wheel_RR", 0.78, -1.36)):
    kit.wheel(name, x, y, R, 0.21, TYRE, RIM, TRIM, holes=5)

cube("lower_body", (0, 0, 0.58), (1.72, 4.32, 0.56), PAINT, 0.08, segments=3)
cube("cabin", (0, -0.22, 1.12), (1.46, 2.28, 0.52), PAINT, 0.07, segments=3)
cube("windscreen", (0, 0.78, 1.11), (1.32, 0.78, 0.03), GLASS, rot=(0.62, 0, 0))
cube("rear_glass", (0, -1.13, 1.13), (1.28, 0.74, 0.03), GLASS, rot=(-0.56, 0, 0))
for sx in (-1, 1):
    cube(f"side_win_{sx}", (sx * 0.73, -0.24, 1.11), (0.03, 1.56, 0.41), GLASS, rot=(0, sx * 0.26, 0))
    cube(f"bpillar_{sx}", (sx * 0.735, -0.18, 1.11), (0.04, 0.11, 0.43), TRIM, rot=(0, sx * 0.26, 0))
    cube(f"mirror_{sx}", (sx * 0.90, 0.62, 0.90), (0.16, 0.09, 0.10), PAINT, 0.02)
    cube(f"handle_f_{sx}", (sx * 0.865, 0.15, 0.77), (0.03, 0.15, 0.035), CHROME)
    cube(f"handle_r_{sx}", (sx * 0.865, -0.72, 0.78), (0.03, 0.15, 0.035), CHROME)

cube("grille", (0, 2.18, 0.64), (0.82, 0.06, 0.14), TRIM)
cube("grille_bar", (0, 2.185, 0.66), (0.76, 0.07, 0.03), CHROME)
cube("bumper_f", (0, 2.20, 0.36), (1.66, 0.08, 0.12), TRIM, 0.02)
cube("bumper_r", (0, -2.20, 0.38), (1.68, 0.08, 0.14), TRIM, 0.02)
cube("boot_trim", (0, -2.21, 0.76), (0.76, 0.04, 0.04), CHROME)
cube("plate_f", (0, 2.22, 0.50), (0.40, 0.03, 0.11), PLATE)
cube("plate_r", (0, -2.21, 0.66), (0.40, 0.03, 0.11), PLATE)
for sx in (-1, 1):
    cube(f"head_{sx}", (sx * 0.60, 2.18, 0.64), (0.34, 0.06, 0.13), HEAD, 0.01)
    cube(f"hazard_f{sx}", (sx * 0.77, 2.12, 0.64), (0.10, 0.06, 0.08), AMBER)
    cube(f"brake_{sx}", (sx * 0.62, -2.18, 0.76), (0.38, 0.06, 0.14), BRAKE)
    cube(f"hazard_r{sx}", (sx * 0.75, -2.14, 0.66), (0.14, 0.06, 0.07), AMBER)

kit.export(OUT)
