"""Karachi route minibus (Mazda/Hino 'coaster' type) in full truck art,
built from street photos. Exports public/models/minibus.glb.

Run headless:  python tools/blender/minibus.py   (needs `pip install bpy`)

Art panels are flat planes with 0..1 UVs whose materials are named art_*;
the game fills them with procedural truck-art textures per variant. Body
colour ("paint") is also recoloured per variant. People hanging off the
doors and sitting on the roof are added in the game.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import bpy  # noqa: E402
from kit import art_plane, bar, cube, cyl  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "minibus")
kit.reset()

PAINT = kit.mat("paint", "#1f4fa8", 0.45)            # base body colour (per variant)
ART_SIDE = kit.mat("art_side", "#d0a040", 0.6)       # textured in game
ART_TOP = kit.mat("art_top", "#c04040", 0.6)
ART_REAR = kit.mat("art_rear", "#40a0a0", 0.6)
ART_SCREEN = kit.mat("art_screen", "#a03030", 0.4)
CREAM = kit.mat("cream", "#e9e2cf", 0.5)
GLASS = kit.mat("glass", "#26333b", 0.1)
BLACK = kit.mat("trim", "#161718", 0.7)
CHROME = kit.mat("chrome", "#d4d8dc", 0.25, 0.8)
RUST = kit.mat("rust", "#8a5a3a", 0.8)
TYRE = kit.mat("tyre", "#1f1f21", 0.9)
RIM = kit.mat("rim", "#2a3a4a", 0.5)
HEAD = kit.mat("head", "#eef0e6", 0.15)
BRAKE = kit.mat("brake", "#8a1a1a", 0.3)
AMBER = kit.mat("hazard", "#d0861a", 0.3)
CREST = [kit.mat(f"crest{i}", c, 0.4) for i, c in enumerate(("#e63946", "#0a9396", "#ffbe0b", "#3a86ff", "#ff7f11"))]

L2, HW = 3.55, 1.08        # half length / half width of the body shell
BOT, TOP = 0.62, 2.72      # body bottom / roof
BELT, WIN_TOP = 1.5, 2.34  # window band
FRONT_AXLE, REAR_AXLE = 2.35, -1.75
R, W = 0.42, 0.24
TRACK = 0.86

# ---- Body shell: a rounded box, flat cab-over front ---------------------------------------
cube("shell", (0, 0, (BOT + TOP) / 2), (2 * HW, 2 * L2, TOP - BOT), PAINT, 0.12, segments=3)
# Slight forward lean on the upper front (cab roof overhang).
cube("visor", (0, L2 - 0.05, TOP - 0.06), (2 * HW + 0.04, 0.22, 0.14), PAINT, 0.05)
# Cut the wheel arches.
shell = bpy.data.objects["shell"]
for y in (FRONT_AXLE, REAR_AXLE):
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=R + 0.1, depth=3, location=(0, y, R), rotation=(0, math.pi / 2, 0))
    cutter = bpy.context.active_object
    bpy.context.view_layer.objects.active = shell
    mod = shell.modifiers.new("arch", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier="arch")
    bpy.data.objects.remove(cutter)
for sx in (-1, 1):
    for y in (FRONT_AXLE, REAR_AXLE):
        kit.arch_lip(sx * (HW - 0.01), y, R, R + 0.12, CHROME, 0.035)

# ---- Sides: art below the windows, framed windows, door openings -------------------------------
DOORS = [(1.62, 0.78), (-2.62, 0.72)]   # (centre y, width) on the kerb side (left, -x)


def in_door(y0, y1):
    return any(y1 > c - w / 2 and y0 < c + w / 2 for c, w in DOORS)


for sx, facing in ((1, "+x"), (-1, "-x")):
    x = sx * HW
    # Upper art strip (full length) and lower art between the wheel arches.
    art_plane("art_upper", (x, 0, 1.24), 2 * L2 - 0.3, 0.46, facing, ART_SIDE)
    for y0, y1 in ((REAR_AXLE + 0.62, FRONT_AXLE - 0.62), (FRONT_AXLE + 0.6, L2 - 0.14), (-L2 + 0.14, REAR_AXLE - 0.6)):
        segs = [(y0, y1)]
        if sx < 0:  # leave the door openings bare
            segs = []
            cuts = sorted((c - w / 2, c + w / 2) for c, w in DOORS if c - w / 2 < y1 and c + w / 2 > y0)
            a = y0
            for c0, c1 in cuts:
                if c0 > a:
                    segs.append((a, c0))
                a = max(a, c1)
            if a < y1:
                segs.append((a, y1))
        for a, b in segs:
            if b - a > 0.15:
                art_plane("art_lower", (x, (a + b) / 2, 0.86), b - a, 0.38, facing, ART_SIDE, lift=0.006)
    # Cream belt line under the windows and chrome strip over the art.
    cube("belt", (x, 0, BELT - 0.02), (0.04, 2 * L2 - 0.2, 0.06), CREAM)
    cube("chrome_strip", (x, 0, 1.03), (0.03, 2 * L2 - 0.3, 0.03), CHROME)
    # Windows: dark glass in painted frames, with bars; skip door openings.
    y = L2 - 0.95
    while y > -L2 + 0.35:
        w = 0.78
        if not (sx < 0 and in_door(y - w / 2, y + w / 2)):
            cube("win", (x + sx * 0.012, y, (BELT + WIN_TOP) / 2), (0.02, w - 0.1, WIN_TOP - BELT - 0.08), GLASS)
            for k in range(1, 4):
                cube("winbar", (x + sx * 0.03, y - w / 2 + k * w / 4, (BELT + WIN_TOP) / 2), (0.015, 0.015, WIN_TOP - BELT - 0.1), CHROME)
        cube("pillar", (x + sx * 0.02, y - w / 2, (BELT + WIN_TOP) / 2), (0.03, 0.08, WIN_TOP - BELT), CREAM)
        y -= w
    # Art band above the windows.
    art_plane("art_top", (x, 0, (WIN_TOP + TOP) / 2 - 0.04), 2 * L2 - 0.3, TOP - WIN_TOP - 0.12, facing, ART_TOP)
for c, w in DOORS:
    # Dark open doorway with grab poles and steps (kerb side).
    cube("doorway", (-HW - 0.002, c, 1.38), (0.04, w, 1.6), BLACK)
    bar("grab", (-HW - 0.06, c - w / 2 + 0.05, 0.75), (-HW - 0.06, c - w / 2 + 0.05, 2.2), 0.02, CHROME)
    bar("grab", (-HW - 0.06, c + w / 2 - 0.05, 0.75), (-HW - 0.06, c + w / 2 - 0.05, 2.2), 0.02, CHROME)
    cube("step", (-HW - 0.12, c, 0.5), (0.26, w, 0.04), CHROME)

# ---- Front: split windscreen with painted top half, grille, chrome guard -------------------------
F = L2 + 0.002
art_plane("art_screen", (0, F, 2.06), 2 * HW - 0.22, 0.62, "+y", ART_SCREEN, lift=0.01)
cube("screen_low", (0, F, 1.6), (2 * HW - 0.22, 0.02, 0.3), GLASS)
cube("screen_post", (0, F + 0.02, 1.9), (0.06, 0.03, 0.96), CREAM)
for sx in (-1, 1):
    cube("screen_side", (sx * (HW - 0.08), F + 0.02, 1.9), (0.06, 0.03, 0.96), CREAM)
    bar("rod", (sx * (HW - 0.06), F + 0.03, 1.4), (sx * (HW - 0.12), F + 0.05, 2.45), 0.02, kit.mat(f"rod{sx}", "#ffd60a", 0.4))
art_plane("art_nose", (0, F, 1.2), 2 * HW - 0.2, 0.34, "+y", ART_SIDE, lift=0.006)
cube("grille", (0, F + 0.01, 0.9), (0.9, 0.03, 0.22), BLACK)
cube("grille_frame", (0, F + 0.025, 0.9), (0.94, 0.02, 0.03), CHROME)
for sx in (-1, 1):
    for k, x in enumerate((0.62, 0.84)):
        cube(f"head_{sx}{k}", (sx * x, F + 0.02, 0.92), (0.17, 0.03, 0.13), HEAD, 0.01)
    cube(f"hazard_f{sx}", (sx * 0.9, F + 0.02, 0.74), (0.16, 0.03, 0.08), AMBER)
cube("bumper", (0, F + 0.06, 0.62), (2 * HW + 0.06, 0.12, 0.16), PAINT, 0.03)
cube("bumper_red", (0, F + 0.125, 0.7), (1.0, 0.01, 0.07), kit.mat("red", "#d62828", 0.4))
cube("plate_f", (0, F + 0.13, 0.6), (0.4, 0.02, 0.12), kit.mat("plate", "#f2d33a", 0.5))
# Chrome bull-bar guard.
for z in (0.72, 0.98):
    bar("guard_h", (-0.95, F + 0.24, z), (0.95, F + 0.24, z), 0.025, CHROME)
for x in (-0.95, -0.35, 0.35, 0.95):
    bar("guard_v", (x, F + 0.24, 0.6), (x, F + 0.24, 1.08), 0.025, CHROME)
    bar("guard_mount", (x, F + 0.24, 0.64), (x, F + 0.07, 0.64), 0.02, CHROME)
# Mirrors on long stalks.
for sx in (-1, 1):
    bar("mirror_arm", (sx * HW, L2 - 0.2, 2.0), (sx * (HW + 0.3), L2 + 0.1, 2.1), 0.018, BLACK)
    cube("mirror", (sx * (HW + 0.32), L2 + 0.1, 1.95), (0.05, 0.16, 0.32), BLACK, 0.02)

# ---- Roof: tin crests and plumes on the front edge, rack and luggage ---------------------------------
for i, x in enumerate((-0.86, -0.43, 0.0, 0.43, 0.86)):
    big = 1.35 if x == 0 else 1.0
    m = CREST[i % len(CREST)]
    cyl("crest", (x, L2 - 0.02, TOP + 0.22 * big), 0.2 * big, 0.03, m, 16, rot=(math.pi / 2, 0, 0), scale=(1.0, 1.0, 1.25))
    cyl("crest_in", (x, L2 + 0.0, TOP + 0.22 * big), 0.11 * big, 0.03, CREST[(i + 2) % len(CREST)], 12, rot=(math.pi / 2, 0, 0), scale=(1.0, 1.0, 1.25))
    obj = kit.obj("crest_tip", lambda: bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.08 * big, depth=0.16 * big),
                  (x, L2 - 0.02, TOP + 0.47 * big), (1, 0.25, 1), (0, 0, 0), m)
    bar("whip", (x * 0.8, L2 - 0.25, TOP), (x * 0.9, L2 - 0.1, TOP + 0.75), 0.008, CHROME)
# Roof rack rails over the middle of the roof.
RACK_Z = TOP + 0.22
for sx in (-1, 1):
    bar("rail", (sx * (HW - 0.1), L2 - 0.6, RACK_Z), (sx * (HW - 0.1), -L2 + 0.4, RACK_Z), 0.025, RUST)
for y in [L2 - 0.6 - k * 0.55 for k in range(12)]:
    bar("rung", (-(HW - 0.1), y, RACK_Z), (HW - 0.1, y, RACK_Z), 0.018, RUST)
    for sx in (-1, 1):
        bar("leg", (sx * (HW - 0.1), y, TOP), (sx * (HW - 0.1), y, RACK_Z), 0.015, RUST)
cube("luggage", (0.35, -1.6, RACK_Z + 0.2), (0.8, 1.0, 0.4), kit.mat("sack", "#c8b48a", 0.9), 0.06)
cube("luggage2", (-0.4, -2.5, RACK_Z + 0.16), (0.7, 0.7, 0.32), kit.mat("tarp", "#2d6a4f", 0.9), 0.05)

# ---- Rear: painted panel, small window, ladder, lamps -------------------------------------------------
B = -L2 - 0.002
art_plane("art_rear", (0, B, 1.25), 2 * HW - 0.2, 0.9, "-y", ART_REAR)
cube("rear_win", (0, B - 0.01, 2.05), (1.5, 0.02, 0.5), GLASS)
art_plane("art_rear_top", (0, B, 2.5), 2 * HW - 0.2, 0.22, "-y", ART_TOP)
for sx in (-1, 1):
    cube(f"brake_{sx}", (sx * 0.85, B - 0.02, 0.86), (0.18, 0.03, 0.12), BRAKE)
    cube(f"hazard_r{sx}", (sx * 0.85, B - 0.02, 1.0), (0.18, 0.03, 0.08), AMBER)
cube("bumper_r", (0, B - 0.06, 0.62), (2 * HW, 0.1, 0.14), BLACK, 0.02)
cube("plate_r", (0, B - 0.12, 0.66), (0.4, 0.02, 0.12), kit.mat("plate_r", "#f2d33a", 0.5))
# Ladder up to the roof rack on the right of the rear.
for x in (0.45, 0.8):
    bar("ladder", (x, B - 0.08, 0.7), (x, B - 0.08, RACK_Z + 0.1), 0.02, CHROME)
for k in range(7):
    z = 0.85 + k * 0.28
    bar("ladder_rung", (0.45, B - 0.08, z), (0.8, B - 0.08, z), 0.015, CHROME)
# Mud flaps behind the rear wheels.
for sx in (-1, 1):
    cube("flap", (sx * TRACK, REAR_AXLE - 0.62, 0.38), (0.3, 0.02, 0.44), BLACK)

# ---- Wheels -----------------------------------------------------------------------------------------
for name, x, y in (("wheel_FL", -TRACK, FRONT_AXLE), ("wheel_FR", TRACK, FRONT_AXLE),
                   ("wheel_RL", -TRACK, REAR_AXLE), ("wheel_RR", TRACK, REAR_AXLE)):
    kit.wheel(name, x, y, R, W, TYRE, RIM, CHROME, holes=6)

kit.export(OUT)
