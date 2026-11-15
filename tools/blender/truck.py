"""Pakistani Bedford J6 Rocket cargo truck with Taj crown and UV'd truck-art panels.
Exports public/models/truck.glb.
Run headless:  python tools/blender/truck.py   (needs `pip install bpy`)
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import art_plane, bar, cube, cyl  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "truck")
kit.reset()

PAINT = kit.mat("paint", "#1565c0", 0.40)
ART_SIDE = kit.mat("art_side", "#d0a040", 0.55)
ART_TOP = kit.mat("art_top", "#c04040", 0.55)
ART_REAR = kit.mat("art_rear", "#40a0a0", 0.55)
ART_SCREEN = kit.mat("art_screen", "#a03030", 0.45)
WOOD = kit.mat("wood", "#8d5a2b", 0.82)
WOOD_DARK = kit.mat("woodDark", "#553418", 0.85)
TARP = kit.mat("tarp", "#d4c39c", 0.88)
GLASS = kit.mat("glass", "#28363f", 0.08)
TRIM = kit.mat("trim", "#18191b", 0.72)
CHROME = kit.mat("chrome", "#d8dcdf", 0.22, 0.85)
PLATE = kit.mat("plate", "#f2efe4", 0.45)
TYRE = kit.mat("tyre", "#1f1f21", 0.9)
RIM = kit.mat("rim", "#b9bec3", 0.35, 0.65)
HEAD = kit.mat("head", "#eef0e6", 0.15)
BRAKE = kit.mat("brake", "#8a1a1a", 0.3)
AMBER = kit.mat("hazard", "#d0861a", 0.3)

R = 0.50
for name, x, y in (("wheel_FL", -1.04, 3.05), ("wheel_FR", 1.04, 3.05),
                   ("wheel_ML", -1.04, -1.20), ("wheel_MR", 1.04, -1.20),
                   ("wheel_RL", -1.04, -2.55), ("wheel_RR", 1.04, -2.55)):
    kit.wheel(name, x, y, R, 0.36, TYRE, RIM, CHROME, holes=6)

cube("chassis", (0, 0.1, 0.72), (1.45, 7.6, 0.24), TRIM)
cube("cab_lower", (0, 2.55, 1.22), (2.26, 1.55, 0.85), PAINT, 0.08)
cube("cab_upper", (0, 2.52, 2.08), (2.22, 1.48, 0.88), PAINT, 0.08)
cube("bonnet", (0, 3.72, 1.22), (1.52, 1.15, 0.76), PAINT, 0.10, rot=(-0.08, 0, 0))
for sx in (-1, 1):
    cube(f"fender_{sx}", (sx * 0.94, 3.65, 1.04), (0.44, 1.20, 0.42), PAINT, 0.06)
    cube(f"cab_glass_{sx}", (sx * 1.12, 2.55, 2.06), (0.04, 1.02, 0.56), GLASS)
    bar(f"mirror_arm_{sx}", (sx * 1.11, 3.12, 2.05), (sx * 1.34, 3.30, 2.12), 0.02, CHROME)
    cube(f"mirror_{sx}", (sx * 1.35, 3.30, 2.02), (0.06, 0.16, 0.32), TRIM)
    cyl(f"stack_{sx}", (sx * 1.16, 1.72, 1.92), 0.055, 2.45, CHROME, rot=(0, 0, 0))

cube("windscreen_low", (0, 3.28, 1.84), (1.88, 0.05, 0.40), GLASS, rot=(0.06, 0, 0))
art_plane("art_screen", (0, 3.30, 2.18), 1.88, 0.34, "+y", ART_SCREEN, lift=0.01)
cube("sun_visor", (0, 3.36, 2.48), (2.28, 0.26, 0.14), CHROME, rot=(-0.22, 0, 0))
cube("grille_bg", (0, 4.30, 1.24), (1.30, 0.06, 0.58), TRIM)
cube("bumper_f", (0, 4.34, 0.62), (2.42, 0.18, 0.24), CHROME, 0.03)
cube("taj_crown", (0, 3.14, 2.86), (2.36, 0.32, 0.85), PAINT, 0.12)
art_plane("art_top", (0, 3.31, 2.94), 1.96, 0.76, "+y", ART_TOP, lift=0.01)

cube("bed_floor", (0, -1.12, 1.12), (2.48, 5.56, 0.18), WOOD_DARK)
cube("bed_core", (0, -1.12, 2.02), (2.42, 5.44, 1.62), WOOD, 0.04)
cube("cargo_tarp", (0, -1.12, 3.05), (2.30, 5.24, 0.60), TARP, 0.20)
art_plane("art_side_L", (-1.21, -1.12, 2.02), 5.32, 1.54, "-x", ART_SIDE, lift=0.015)
art_plane("art_side_R", (1.21, -1.12, 2.02), 5.32, 1.54, "+x", ART_SIDE, lift=0.015)
art_plane("art_rear", (0, -3.84, 2.02), 2.34, 1.54, "-y", ART_REAR, lift=0.015)

cube("bumper_r", (0, -3.92, 0.80), (2.42, 0.16, 0.18), TRIM)
for sx in (-1, 1):
    cyl(f"head_{sx}", (sx * 0.92, 4.30, 1.04), 0.13, 0.04, HEAD, rot=(math.pi / 2, 0, 0))
    cube(f"hazard_f{sx}", (sx * 1.06, 4.24, 1.30), (0.15, 0.06, 0.10), AMBER)
    cube(f"brake_{sx}", (sx * 0.88, -3.90, 0.98), (0.24, 0.06, 0.18), BRAKE)
    cube(f"hazard_r{sx}", (sx * 1.08, -3.90, 0.98), (0.16, 0.06, 0.14), AMBER)

kit.export(OUT)
