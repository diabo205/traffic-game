"""Sazgar CNG auto-rickshaw (the orange three-wheeler all over Karachi),
built from brochure photos. Exports public/models/rickshaw.glb.

Run headless:  python tools/blender/rickshaw.py   (needs `pip install bpy`)
The driver is added in the game (VehicleFactory), not here.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import bar, cube, cyl  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "rickshaw")
kit.reset()

PAINT = kit.mat("paint", "#e8731c", 0.3)          # Sazgar orange (recoloured per variant)
CANOPY = kit.mat("canopy", "#3a2620", 0.45)       # glossy dark-brown vinyl roof
TRIM = kit.mat("trim_stripe", "#d9cbb4", 0.6)     # striped piping on the roof edge
CURTAIN = kit.mat("curtain", "#2c3b2a", 0.8)      # dark green side curtains
SEAT_BACK = kit.mat("seat_back", "#d8c9a6", 0.35) # beige quilted vinyl
SEAT = kit.mat("seat", "#3b2420", 0.4)            # dark brown cushion
BLACK = kit.mat("trim", "#1b1b1c", 0.7)
CHROME = kit.mat("chrome", "#d4d8dc", 0.25, 0.8)
GLASS = kit.mat("glass", "#3f4b54", 0.1)
TYRE = kit.mat("tyre", "#202022", 0.9)
RIM = kit.mat("rim", "#b7bcc1", 0.35, 0.5)
HEAD = kit.mat("head", "#eef0e6", 0.15)
BRAKE = kit.mat("brake", "#7a1414", 0.3)
AMBER = kit.mat("hazard", "#c47a12", 0.3)
CLEAR = kit.mat("clear_lamp", "#e6e6e0", 0.2)

R, W = 0.24, 0.13
HW = 0.61            # half width of the body
REAR_Y = -1.32       # rear deck edge
ROOF_Z = 1.8

# ---- Chassis + rear passenger tub --------------------------------------------------------
cube("floor", (0, -0.1, 0.31), (1.16, 2.3, 0.06), BLACK)
# Rear deck / luggage tub behind the bench (flat top at z 0.62).
cube("tub", (0, -1.0, 0.47), (2 * HW, 0.66, 0.32), PAINT, 0.035)
# Side panels of the passenger compartment with three black stripes.
for sx in (-1, 1):
    cube("side", (sx * (HW - 0.02), -0.62, 0.62), (0.04, 0.78, 0.64), PAINT, 0.015)
    cube("side_rail", (sx * (HW - 0.01), -0.62, 0.96), (0.06, 0.8, 0.04), PAINT, 0.015)
    for k, z in enumerate((0.84, 0.74, 0.64)):
        cube("stripe", (sx * HW, -0.6 + k * 0.03, z), (0.012, 0.5 - k * 0.06, 0.035), BLACK)
    # Rear fender flare over each rear wheel.
    kit.arch_lip(sx * (HW - 0.01), -0.82, R, 0.3, PAINT, 0.045)
# Bench: dark cushion, beige split backrest, orange seat box with vent slots.
cube("cushion", (0, -0.5, 0.84), (2 * HW - 0.08, 0.46, 0.13), SEAT, 0.04)
for sx in (-1, 1):
    cube("backrest", (sx * 0.29, -0.76, 1.17), (0.5, 0.1, 0.54), SEAT_BACK, 0.04)
cube("backrest_mid", (0, -0.76, 1.17), (0.1, 0.09, 0.54), SEAT, 0.02)
cube("seat_box", (0, -0.25, 0.56), (2 * HW - 0.12, 0.04, 0.48), PAINT, 0.012)
for k in range(-2, 3):
    cube("vent", (k * 0.16, -0.225, 0.55), (0.03, 0.01, 0.22), BLACK)
# Footwell step at the passenger entry.
cube("step", (0, -0.05, 0.36), (1.1, 0.36, 0.04), BLACK)

# ---- Driver cabin: rounded orange front body, chrome waist strip ----------------------------
cube("cabin", (0, 0.6, 0.68), (2 * HW - 0.04, 0.72, 0.74), PAINT, 0.09, segments=3)
cube("nose", (0, 0.98, 0.7), (0.96, 0.26, 0.66), PAINT, 0.1, segments=3)
cube("waist", (0, 0.62, 1.055), (2 * HW, 0.78, 0.035), CHROME, 0.012)
for sx in (-1, 1):
    cube("cabin_line", (sx * (HW - 0.01), 0.6, 0.86), (0.01, 0.6, 0.02), CHROME)
# Headlamp pod jutting from the nose, with its lamp.
cube("lamp_pod", (0, 1.13, 0.86), (0.34, 0.2, 0.22), PAINT, 0.06, segments=3)
cube("head_lamp", (0, 1.235, 0.875), (0.24, 0.02, 0.11), HEAD, 0.01)
cube("pod_chin", (0, 1.17, 0.73), (0.3, 0.16, 0.05), PAINT, 0.02)
# Indicators on the cabin corners.
for sx in (-1, 1):
    cube(f"hazard_{sx}", (sx * 0.5, 1.06, 0.98), (0.1, 0.04, 0.05), AMBER, 0.01)
    cube(f"hazard_r{sx}", (sx * 0.5, REAR_Y - 0.035, 0.5), (0.07, 0.02, 0.07), AMBER)
# Windscreen with black frame, raked back a little.
cube("windscreen", (0, 0.97, 1.33), (0.9, 0.02, 0.5), GLASS, rot=(-0.12, 0, 0))
# Orange A-pillars and header: the windscreen sits in the bodywork.
cube("screen_top", (0, 0.93, 1.64), (1.02, 0.08, 0.1), PAINT, 0.03, rot=(-0.12, 0, 0))
for sx in (-1, 1):
    cube("screen_post", (sx * 0.5, 0.97, 1.35), (0.08, 0.08, 0.64), PAINT, 0.025, rot=(-0.12, 0, 0))
    cube("screen_seal", (sx * 0.455, 0.98, 1.35), (0.015, 0.02, 0.56), BLACK, rot=(-0.12, 0, 0))
    bar("pillar_up", (sx * 0.5, 0.9, 1.68), (sx * 0.56, 0.95, ROOF_Z - 0.06), 0.03, PAINT)
cube("wiper", (0.1, 0.995, 1.22), (0.02, 0.02, 0.3), BLACK, rot=(-0.12, 0, 0.3))
# Front mudguard over the single front wheel, and the fork.
cube("mudguard", (0, 1.2, 0.56), (0.4, 0.42, 0.06), PAINT, 0.025, rot=(0.18, 0, 0))
for sx in (-1, 1):
    cube("guard_cheek", (sx * 0.19, 1.2, 0.49), (0.03, 0.36, 0.14), PAINT, 0.01, rot=(0.18, 0, 0))
    bar("fork", (sx * 0.1, 1.18, R), (sx * 0.1, 1.05, 0.62), 0.025, CHROME)
# Mirrors on stalks.
for sx in (-1, 1):
    bar("mirror_stalk", (sx * 0.5, 0.95, 1.05), (sx * 0.66, 0.92, 1.28), 0.012, BLACK)
    cube("mirror", (sx * 0.68, 0.92, 1.33), (0.04, 0.12, 0.16), BLACK, 0.02)
# Driver's seat and handlebar inside the cabin.
cube("driver_seat", (0, 0.3, 0.86), (0.5, 0.35, 0.1), SEAT, 0.03)
bar("handlebar", (-0.28, 0.72, 1.12), (0.28, 0.72, 1.12), 0.015, BLACK)

# ---- Roof: glossy vinyl canopy with striped piping, rounded at the edges ---------------------
# Loaf-shaped: thick, heavily rounded, with the edges drooping as valances.
cube("roof", (0, -0.2, ROOF_Z + 0.02), (2 * HW + 0.1, 2.44, 0.2), CANOPY, 0.09, segments=4)
cube("roof_front", (0, 1.0, ROOF_Z - 0.08), (2 * HW + 0.06, 0.07, 0.16), CANOPY, 0.03)
cube("roof_rear", (0, -1.4, ROOF_Z - 0.1), (2 * HW + 0.1, 0.08, 0.2), CANOPY, 0.035)
for z in (ROOF_Z - 0.09, ROOF_Z - 0.12):
    cube("piping_r", (0, -1.455, z), (2 * HW + 0.1, 0.01, 0.012), TRIM)
    for sx in (-1, 1):
        cube("piping_s", (sx * (HW + 0.045), -0.2, z + 0.03), (0.01, 2.4, 0.012), TRIM)

# ---- Curtains: dark green panels over the rear sides + the long flap at the entry -------------
for sx in (-1, 1):
    cube("curtain_side", (sx * (HW + 0.01), -0.86, 1.33), (0.02, 0.86, 0.72), CURTAIN)
    cube("curtain_flap", (sx * (HW + 0.03), -0.32, 1.1), (0.02, 0.24, 1.15), CURTAIN)
    # Decorative white corner patches on the curtain.
    for y in (-1.2, -0.52):
        cube("patch", (sx * (HW + 0.022), y, 1.05), (0.005, 0.1, 0.1), TRIM)

# ---- Chrome tube frame: rear corner posts, grab rails, roof hoops -----------------------------
for sx in (-1, 1):
    x = sx * (HW + 0.02)
    bar("post_rear", (x, REAR_Y + 0.02, 0.63), (x, REAR_Y + 0.02, ROOF_Z - 0.04), 0.017, CHROME)
    bar("post_mid", (x, -0.18, 0.62), (x, -0.18, ROOF_Z - 0.04), 0.017, CHROME)
    bar("post_cab", (sx * 0.58, 0.28, 1.07), (sx * 0.6, 0.28, ROOF_Z - 0.04), 0.017, CHROME)
    bar("rail_side", (x, REAR_Y + 0.02, 1.25), (x, -0.18, 1.25), 0.012, CHROME)
    bar("rail_low", (x, REAR_Y + 0.02, 0.98), (x, -1.0, 0.98), 0.012, CHROME)
bar("rail_back", (-HW, REAR_Y + 0.02, 1.25), (HW, REAR_Y + 0.02, 1.25), 0.012, CHROME)

# ---- Rear: combination lamps and the black footstep frame -----------------------------------------
for sx in (-1, 1):
    cube(f"brake_{sx}", (sx * 0.42, REAR_Y - 0.035, 0.5), (0.08, 0.02, 0.07), BRAKE)
    cube("reverse", (sx * 0.34, REAR_Y - 0.035, 0.5), (0.07, 0.02, 0.07), CLEAR)
    cube("lamp_body", (sx * 0.42, REAR_Y - 0.02, 0.5), (0.27, 0.02, 0.09), BLACK)
    bar("step_bracket", (sx * 0.32, REAR_Y - 0.05, 0.36), (sx * 0.32, REAR_Y - 0.22, 0.24), 0.02, BLACK)
cube("footstep", (0, REAR_Y - 0.25, 0.23), (0.92, 0.2, 0.035), BLACK)
cube("footstep_slat", (0, REAR_Y - 0.25, 0.25), (0.86, 0.04, 0.02), BLACK)

# ---- Wheels ------------------------------------------------------------------------------------
kit.wheel("wheel_F", 0, 1.17, R, W, TYRE, RIM, AMBER, holes=4)
kit.wheel("wheel_RL", -0.6, -0.82, R, W, TYRE, RIM, BLACK, holes=4)
kit.wheel("wheel_RR", 0.6, -0.82, R, W, TYRE, RIM, BLACK, holes=4)

kit.export(OUT)
