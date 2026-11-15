"""Pakistani wooden handcart / donkey-cart bed (rehri / thela) chassis.
Exports public/models/cart.glb. Donkey/pusher and cargo are added in VehicleFactory.ts.
Run headless:  python tools/blender/cart.py   (needs `pip install bpy`)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import bar, cube, cyl  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "cart")
kit.reset()

PAINT = kit.mat("paint", "#e8731c", 0.45)
WOOD = kit.mat("wood", "#8d5a2b", 0.82)
WOOD_DARK = kit.mat("woodDark", "#553418", 0.85)
STEEL = kit.mat("steel", "#60666d", 0.45, 0.55)
TRIM = kit.mat("trim", "#18191b", 0.72)
TYRE = kit.mat("tyre", "#1f1f21", 0.9)
BRAKE = kit.mat("brake", "#8a1a1a", 0.3)
AMBER = kit.mat("hazard", "#d0861a", 0.3)

R = 0.48
kit.wheel("wheel_L", -0.70, -0.52, R, 0.10, TYRE, WOOD_DARK, TRIM, holes=10)
kit.wheel("wheel_R", 0.70, -0.52, R, 0.10, TYRE, WOOD_DARK, TRIM, holes=10)
bar("axle", (-0.75, -0.52, R), (0.75, -0.52, R), 0.035, STEEL)

cube("bed_main", (0, -0.52, 0.70), (1.32, 2.02, 0.09), WOOD, 0.01)
for sx in (-0.50, 0, 0.50):
    cube(f"stringer_{sx}", (sx, -0.52, 0.62), (0.08, 2.1, 0.09), WOOD_DARK)
for sx in (-1, 1):
    cube(f"rail_top_{sx}", (sx * 0.635, -0.52, 0.96), (0.05, 2.04, 0.07), WOOD_DARK, 0.01)
    cube(f"rail_band_{sx}", (sx * 0.635, -0.52, 0.84), (0.055, 2.04, 0.08), PAINT)
    for y in (-1.46, -0.99, -0.52, -0.05, 0.42):
        cube(f"post_{sx}_{y}", (sx * 0.635, y, 0.86), (0.055, 0.06, 0.28), WOOD_DARK)
cube("front_board", (0, 0.46, 0.86), (1.32, 0.06, 0.24), WOOD_DARK)
cube("rear_board", (0, -1.50, 0.86), (1.32, 0.06, 0.24), PAINT)

bar("lantern_hook", (0.58, 0.46, 0.68), (0.58, 0.46, 0.52), 0.015, STEEL)
cyl("hazard_lantern", (0.58, 0.46, 0.44), 0.065, 0.14, AMBER, rot=(0, 0, 0))
for sx in (-1, 1):
    cube(f"brake_{sx}", (sx * 0.54, -1.54, 0.72), (0.09, 0.04, 0.07), BRAKE)

kit.export(OUT)
