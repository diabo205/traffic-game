"""Suzuki Alto (8th gen / HA36, as sold in Pakistan), rebuilt from brochure
photos as a smooth lofted body. Exports public/models/alto.glb.

Run headless:  python tools/blender/alto.py   (needs `pip install bpy`)

Method: ~80 cross-sections along the car, each a rounded section (bottom
radius, near-vertical lower body, tumblehome glasshouse, rounded roof
corner) driven by smooth side-profile, plan-view and waistline curves taken
from the real car's dimensions: L 3.395, W 1.475, H 1.475, wheelbase 2.46.
Glass and pillars are picked out of the body surface by position and
normal; lamps, grilles and handles are snapped flush onto the surface.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from kit import cube  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else kit.default_out(__file__, "alto")
kit.reset()

PAINT = kit.mat("paint", "#c9cdd1", 0.3)      # silky silver
GLASS = kit.mat("glass", "#2b3339", 0.08)
BLACK = kit.mat("trim", "#18191b", 0.7)
TYRE = kit.mat("tyre", "#1f1f21", 0.9)
RIM = kit.mat("rim", "#b9bec3", 0.35, 0.6)
CHROME = kit.mat("chrome", "#d8dcdf", 0.25, 0.8)
HEAD = kit.mat("head", "#eef0e6", 0.15)
BRAKE = kit.mat("brake", "#8a1a1a", 0.3)
AMBER = kit.mat("hazard", "#d0861a", 0.3)
LENS = kit.mat("lens_clear", "#e8e8e2", 0.2)

L2 = 1.70           # half length
HW = 0.737          # half width
FRONT_AXLE, REAR_AXLE = 1.19, -1.27
R, W = 0.28, 0.18   # 145/80 R13 steel wheels
TRACK = 0.645


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def interp(points, y):
    """Monotone cubic (Fritsch-Carlson) through (y, value) control points:
    smooth, with no overshoot and no flat spots at the control points."""
    pts = sorted(points)
    xs = [p[0] for p in pts]
    vs = [p[1] for p in pts]
    if y <= xs[0]:
        return vs[0]
    if y >= xs[-1]:
        return vs[-1]
    n = len(pts)
    d = [(vs[i + 1] - vs[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            h = a * a + b * b
            if h > 9:
                t = 3 / math.sqrt(h)
                m[i], m[i + 1] = t * a * d[i], t * b * d[i]
    i = max(k for k in range(n - 1) if xs[k] <= y)
    hgt = xs[i + 1] - xs[i]
    t = (y - xs[i]) / hgt
    h00, h10 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t
    h01, h11 = -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * vs[i] + h10 * hgt * m[i] + h01 * vs[i + 1] + h11 * hgt * m[i + 1]


# Side profile: top of the body (bonnet, windscreen, roof, rear glass, tailgate).
TOP = [(1.70, 0.68), (1.66, 0.80), (1.55, 0.86), (1.2, 0.905), (0.86, 0.95),
       (0.55, 1.18), (0.22, 1.405), (-0.2, 1.465), (-0.9, 1.465), (-1.24, 1.445),
       (-1.42, 1.32), (-1.56, 1.03), (-1.66, 0.86), (-1.70, 0.62)]
# Bottom edge: sill at 0.31, bumpers lift at the ends.
BOTTOM = [(1.70, 0.42), (1.5, 0.34), (1.2, 0.31), (-1.3, 0.31), (-1.55, 0.35), (-1.70, 0.42)]
# Waistline (window bottom): rises gently toward the rear.
BELT = [(1.0, 0.885), (0.0, 0.905), (-1.0, 0.93), (-1.5, 0.95)]


def half_width(y):
    """Plan view: straight sides with rounded corners (rounder at the front)."""
    w = HW
    if y > 1.40:
        r = 0.32
        d = min(r, y - 1.40)
        w -= r - math.sqrt(max(0.0, r * r - d * d))
    if y < -1.48:
        r = 0.24
        d = min(r, -1.48 - y)
        w -= r - math.sqrt(max(0.0, r * r - d * d))
    return w


def section(y, n=46):
    """Half cross-section from bottom centre to top centre, resampled to n points."""
    zb, zt = interp(BOTTOM, y), interp(TOP, y)
    hw = half_width(y)
    belt = min(interp(BELT, y), zt - 0.03)
    up = max(0.0, min(1.0, (zt - belt) / 0.45))
    tum = 0.135 * up                      # tumblehome at the roof
    rr = 0.05 + 0.07 * up                 # roof / bonnet edge radius
    rb = 0.07                             # bottom radius
    pts = [(0.0, zb), (hw - rb, zb)]
    for k in range(1, 5):                 # bottom corner
        a = -math.pi / 2 + k * (math.pi / 2) / 4
        pts.append((hw - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)))
    pts.append((hw + 0.006, lerp(zb + rb, belt, 0.55)))   # shoulder bulge
    pts.append((hw - 0.004, belt))
    top_x = hw - tum
    pts.append((top_x, max(belt + 0.01, zt - rr)))
    for k in range(1, 5):                 # roof / bonnet corner
        a = k * (math.pi / 2) / 4
        pts.append((top_x - rr + rr * math.cos(a), zt - rr + rr * math.sin(a)))
    pts.append((0.0, zt + 0.012 * up))    # crown
    # Resample by arc length so every station has the same vertex count.
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg)
    out = []
    for i in range(n):
        s = total * i / (n - 1)
        j = 0
        while j < len(seg) - 1 and s > seg[j]:
            s -= seg[j]
            j += 1
        t = 0 if seg[j] == 0 else min(1.0, s / seg[j])
        out.append((lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)))
    return out, belt, zt, hw - tum


# ---- Loft -----------------------------------------------------------------------------
STATIONS = [L2 - i * (2 * L2) / 120 for i in range(121)]
bm = bmesh.new()
rings = []
meta = []
for y in STATIONS:
    half, belt, zt, top_x = section(y)
    # Full ring: right side bottom->top, then left side top->bottom (no duplicates).
    ring = [(x, y, z) for x, z in half] + [(-x, y, z) for x, z in reversed(half[1:-1])]
    rings.append([bm.verts.new(p) for p in ring])
    meta.append((belt, zt, top_x))
n = len(rings[0])
faces = []
for i in range(len(rings) - 1):
    a, b = rings[i], rings[i + 1]
    for k in range(n):
        k2 = (k + 1) % n
        faces.append((i, bm.faces.new((a[k], a[k2], b[k2], b[k]))))
bm.faces.new(list(reversed(rings[0])))
bm.faces.new(rings[-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.normal_update()

me = bpy.data.meshes.new("body")
bm.to_mesh(me)
bm.free()
body = bpy.data.objects.new("body", me)
bpy.context.collection.objects.link(body)
me.materials.append(PAINT)
for p in me.polygons:
    p.use_smooth = True

# Wheel arches.
for y in (FRONT_AXLE, REAR_AXLE):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.345, depth=2.0, location=(0, y, R), rotation=(0, math.pi / 2, 0))
    cutter = bpy.context.active_object
    bpy.context.view_layer.objects.active = body
    mod = body.modifiers.new("arch", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier="arch")
    bpy.data.objects.remove(cutter)
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
body.select_set(False)


# ---- Surface snapping ---------------------------------------------------------------------
def hit(x, y, z, d):
    """Cast from (x,y,z) along d onto the body; returns (point, normal)."""
    ok, loc, nrm, _ = body.ray_cast(Vector((x, y, z)), Vector(d).normalized())
    if not ok:
        raise RuntimeError(f"no surface at {(x, y, z)} dir {d}")
    return loc, nrm


def on_surface(name, x, z, side, shape, size, material, lift=0.004, bevel=0.0, y=None):
    """Place a part flush on the body. side: 'front', 'rear', 'left' or 'right'.
    shape 'box' or 'disc'; size = (width, height, thickness) in the surface frame."""
    if side == "front":
        loc, nrm = hit(x, 3, z, (0, -1, 0))
    elif side == "rear":
        loc, nrm = hit(x, -3, z, (0, 1, 0))
    else:
        sx = 1 if side == "right" else -1
        loc, nrm = hit(sx * 2, y, z, (-sx, 0, 0))
    if shape == "disc":
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.5, depth=1)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    # Local frame: X across the surface (horizontal), Y up, Z = surface normal.
    zx = nrm.normalized()
    xx = Vector((0, 0, 1)).cross(zx).normalized() if abs(zx.z) < 0.95 else Vector((1, 0, 0))
    yy = zx.cross(xx).normalized()
    rot = Matrix((xx, yy, zx)).transposed().to_4x4()
    o.matrix_world = Matrix.Translation(loc + zx * (lift + size[2] / 2)) @ rot @ Matrix.Diagonal((size[0], size[1], size[2], 1))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.materials.append(material)
    if bevel:
        bv = o.modifiers.new("bv", "BEVEL")
        bv.width = bevel
        bv.segments = 2
        bpy.ops.object.modifier_apply(modifier="bv")
    for p in o.data.polygons:
        p.use_smooth = shape == "disc" or bevel > 0
    o.select_set(False)
    return o


# ---- Glass: smooth outlines projected onto the curved body ---------------------------------
def rounded(poly, r=0.045, seg=5, step=0.04):
    """Closed polygon with small-radius corners and straight edges subdivided
    every `step` so the projected outline hugs the curved body."""
    out = []
    n = len(poly)
    for i in range(n):
        a, p, b = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        rr = min(r, (a - p).length * 0.45, (b - p).length * 0.45)
        p1 = p + (a - p).normalized() * rr
        p2 = p + (b - p).normalized() * rr
        for k in range(seg + 1):              # quadratic Bezier round the corner
            t = k / seg
            q = (1 - t) ** 2 * p1 + 2 * (1 - t) * t * p + t * t * p2
            out.append((q.x, q.y))
        nxt = Vector(poly[(i + 1) % n])
        nb = Vector(poly[(i + 2) % n])
        r2 = min(r, (p - nxt).length * 0.45, (nb - nxt).length * 0.45)
        start, end = p2, nxt + (p - nxt).normalized() * r2
        steps = max(1, int((end - start).length / step))
        for k in range(1, steps):
            q = start.lerp(end, k / steps)
            out.append((q.x, q.y))
    return out


def panel(name, outline, axis, material, lift, scale=1.0, rings=5):
    """Fan-grid inside a 2D outline, each vertex ray-cast onto the body.
    axis: '+y' (seen from the rear, outline in x,z), '-y' (front, x,z),
    '-x'/'+x' (seen from the right/left, outline in y,z)."""
    poly = rounded(outline)
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)

    def project(a, b):
        if axis == "+y":
            loc, nrm = hit(a, -3, b, (0, 1, 0))
        elif axis == "-y":
            loc, nrm = hit(a, 3, b, (0, -1, 0))
        elif axis == "-x":
            loc, nrm = hit(2, a, b, (-1, 0, 0))
        else:
            loc, nrm = hit(-2, a, b, (1, 0, 0))
        return loc + nrm.normalized() * lift

    bm2 = bmesh.new()
    grid = []
    for r in range(rings, 0, -1):
        f = scale * r / rings
        grid.append([bm2.verts.new(project(cx + (p[0] - cx) * f, cz + (p[1] - cz) * f)) for p in poly])
    centre = bm2.verts.new(project(cx, cz))
    m = len(poly)
    for r in range(rings - 1):
        for i in range(m):
            j = (i + 1) % m
            bm2.faces.new((grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]))
    for i in range(m):
        bm2.faces.new((grid[-1][i], grid[-1][(i + 1) % m], centre))
    bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
    # Faces must point away from the body.
    for f in bm2.faces:
        c = f.calc_center_median()
        if f.normal.dot(c - Vector((0, 0, 0.9))) < 0:
            f.normal_flip()
    me2 = bpy.data.meshes.new(name)
    bm2.to_mesh(me2)
    bm2.free()
    o = bpy.data.objects.new(name, me2)
    bpy.context.collection.objects.link(o)
    me2.materials.append(material)
    for p in me2.polygons:
        p.use_smooth = True
    return o


# Windscreen and rear glass (outline in x,z), each with a black ceramic border.
WINDSCREEN = [(-0.6, 0.995), (0.6, 0.995), (0.535, 1.355), (-0.535, 1.355)]
REAR_GLASS = [(-0.57, 1.045), (0.57, 1.045), (0.53, 1.395), (-0.53, 1.395)]
panel("windscreen_frame", WINDSCREEN, "-y", BLACK, 0.003, scale=1.05)
panel("windscreen", WINDSCREEN, "-y", GLASS, 0.006)
panel("rear_glass_frame", REAR_GLASS, "+y", BLACK, 0.003, scale=1.06)
panel("rear_glass", REAR_GLASS, "+y", GLASS, 0.006)
# Side glass (outline in y,z): front quarter + doors + rear quarter, B-pillar on top.
SIDE = [(0.8, 0.925), (0.33, 1.32), (-1.18, 1.335), (-1.31, 1.29), (-1.36, 0.995), (-0.4, 0.955), (0.4, 0.93)]
for axis in ("-x", "+x"):
    panel("side_frame", SIDE, axis, BLACK, 0.003, scale=1.035)
    panel("side_glass", SIDE, axis, GLASS, 0.006)
    panel("b_pillar", [(-0.255, 0.95), (-0.255, 1.33), (-0.345, 1.33), (-0.345, 0.95)], axis, BLACK, 0.009)
    panel("a_post", [(0.62, 0.935), (0.56, 1.0), (0.58, 1.0), (0.66, 0.935)], axis, BLACK, 0.009)


# ---- Front -------------------------------------------------------------------------------------
for sx in (-1, 1):
    # Oval headlamps set into the corners, dark surround, amber inner indicator.
    # Teardrop headlamp drawn onto the curved nose (projected like the glass).
    lamp = [(sx * x, z) for x, z in ((0.39, 0.715), (0.6, 0.73), (0.64, 0.79), (0.6, 0.825), (0.42, 0.815), (0.37, 0.765))]
    if sx < 0:
        lamp.reverse()
    panel("head_surround", lamp, "-y", BLACK, 0.004, scale=1.12)
    panel(f"head_{sx}", lamp, "-y", HEAD, 0.008)
    panel("head_reflector", [(sx * 0.5 + dx, 0.77 + dz) for dx, dz in ((-0.045, -0.035), (0.045, -0.035), (0.045, 0.035), (-0.045, 0.035))], "-y", CHROME, 0.011)
    on_surface(f"hazard_f{sx}", sx * 0.345, 0.75, "front", "box", (0.05, 0.05, 0.012), AMBER, lift=0.012)
    # Orange side marker on the front wing.
    on_surface(f"hazard_s{sx}", 0, 0.73, "right" if sx > 0 else "left", "disc", (0.06, 0.035, 0.01), AMBER, y=1.42)
# Upper grille (seen from the front): short dash left, badge, four slots right.
on_surface("grille_dash", 0.18, 0.75, "front", "box", (0.13, 0.025, 0.01), BLACK)
on_surface("badge_f", 0.0, 0.75, "front", "disc", (0.085, 0.085, 0.012), CHROME)
for k in range(4):
    on_surface("slot", -(0.12 + k * 0.045), 0.75, "front", "box", (0.022, 0.085, 0.01), BLACK)
# Lower bumper: wide black grille with two chrome bars around the plate.
on_surface("grille_low", 0, 0.5, "front", "box", (0.9, 0.17, 0.012), BLACK, bevel=0.01)
for z in (0.465, 0.535):
    on_surface("bar", 0, z, "front", "box", (0.86, 0.012, 0.012), CHROME, lift=0.016)
on_surface("plate_f", 0, 0.5, "front", "box", (0.34, 0.11, 0.012), BLACK, lift=0.03)
on_surface("plate_f_txt", 0, 0.5, "front", "box", (0.22, 0.035, 0.006), CHROME, lift=0.044)

# ---- Rear -----------------------------------------------------------------------------------------
for sx in (-1, 1):
    # Tail lamps in the bumper corners: red block, clear reversing lens, amber edge.
    on_surface(f"brake_{sx}", sx * 0.52, 0.585, "rear", "box", (0.24, 0.085, 0.02), BRAKE, bevel=0.006)
    on_surface("lens", sx * 0.37, 0.585, "rear", "box", (0.07, 0.085, 0.02), LENS)
    on_surface(f"hazard_r{sx}", sx * 0.62, 0.585, "rear", "box", (0.05, 0.085, 0.02), AMBER)
on_surface("plate_recess", 0, 0.56, "rear", "box", (0.44, 0.17, 0.012), BLACK)
on_surface("plate_r", 0, 0.56, "rear", "box", (0.34, 0.11, 0.012), BLACK, lift=0.016)
on_surface("plate_r_txt", 0, 0.56, "rear", "box", (0.22, 0.035, 0.006), CHROME, lift=0.03)
on_surface("handle_r", 0, 0.8, "rear", "box", (0.2, 0.045, 0.02), CHROME, bevel=0.01)
on_surface("badge_r", 0, 0.9, "rear", "disc", (0.075, 0.075, 0.012), CHROME)
on_surface("garnish", 0, 1.0, "rear", "box", (0.96, 0.035, 0.01), BLACK)
on_surface("lip_r", 0, 0.42, "rear", "box", (1.0, 0.03, 0.02), BLACK)
# Roof spoiler over the rear glass.
cube("spoiler", (0, -1.3, 1.445), (1.08, 0.2, 0.05), PAINT, 0.022, rot=(0.22, 0, 0))

# ---- Sides -----------------------------------------------------------------------------------------
for sx, side in ((-1, "left"), (1, "right")):
    for y in (0.08, -0.82):
        on_surface("handle", 0, 0.87, side, "box", (0.13, 0.035, 0.018), BLACK, y=y, bevel=0.008)
    on_surface("seam", 0, 0.62, side, "box", (0.006, 0.5, 0.004), BLACK, y=-0.3)
    on_surface("seam", 0, 0.62, side, "box", (0.006, 0.5, 0.004), BLACK, y=0.76)
    # Black door mirrors on the window corner.
    cube("mirror", (sx * 0.83, 0.66, 0.99), (0.11, 0.09, 0.12), BLACK, 0.03)
    cube("mirror_arm", (sx * 0.74, 0.7, 0.95), (0.1, 0.04, 0.03), BLACK)
    # Wheel arch flare lips.
    for y in (FRONT_AXLE, REAR_AXLE):
        kit.arch_lip(sx * (HW - 0.015), y, R, 0.36, PAINT, 0.028)

# ---- Wheels ------------------------------------------------------------------------------------------
for name, x, y in (("wheel_FL", -TRACK, FRONT_AXLE), ("wheel_FR", TRACK, FRONT_AXLE),
                   ("wheel_RL", -TRACK, REAR_AXLE), ("wheel_RR", TRACK, REAR_AXLE)):
    kit.wheel(name, x, y, R, W, TYRE, RIM, CHROME, holes=6)

kit.export(OUT)
