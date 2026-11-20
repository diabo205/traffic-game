"""Toyota Hilux Revo Double Cab 4x4 (2020-2024 Rocco / Revo V facelift)
procedural 3D vehicle builder for Blender 5.3+ CLI & Python.

Exports:
  - public/models/suv.glb (game-ready GLB conforming to VehicleFactory.ts)
  - Optional .blend project file (--blend)
  - Optional Cycles studio verification PNG renders (--render)

Game contract (match src/render/VehicleFactory.ts & src/sim/PlayerCar.ts):
  - Blender +Y = vehicle front -> glTF/Three.js -Z; +X = right; +Z = up; metres.
  - Tyres rest flush on Z = 0; wheelbase 3.04 m (front +1.52, rear -1.52);
    half-track 0.82 m; wheel radius 0.42 m.
  - Top-level objects only:
      * wheel_FL, wheel_FR, wheel_RL, wheel_RR (origin strictly at hub center)
      * head_1_L, head_1_R (main Bi-LED headlamps, single material, sorted first)
      * head_2_fog_L, head_2_fog_R (fog lamps, single material)
      * brake_L, brake_R, brake_hmsl (single material)
      * hazard_fL, hazard_fR, hazard_mL, hazard_mR, hazard_rL, hazard_rR (single material)
  - Primary body material named "paint" (dynamically recolored per variant).

Usage:
  blender --background --factory-startup --python tools/blender/suv.py -- \\
      --out public/models/suv.glb --blend tools/blender/hilux_revo.blend
"""

import argparse
import math
import os
import sys

import bpy  # must precede bmesh / mathutils
import bmesh
from mathutils import Vector


# ---------------------------------------------------------------------------
# CLI & Scene Setup
# ---------------------------------------------------------------------------

def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = argv[1:] if len(argv) > 1 and argv[1].endswith(".glb") else []

    default_out = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "models", "suv.glb")
    )
    if len(argv) == 1 and argv[0].endswith(".glb") and not argv[0].startswith("-"):
        return argparse.Namespace(out=os.path.abspath(argv[0]), blend=None, render=None)

    parser = argparse.ArgumentParser(description="Build Toyota Hilux Revo 3D model")
    parser.add_argument("--out", default=default_out, help="Output .glb path")
    parser.add_argument("--blend", default=None, help="Optional .blend save path")
    parser.add_argument("--render", default=None, help="Optional directory for studio PNG renders")
    args, _ = parser.parse_known_args(argv)
    args.out = os.path.abspath(args.out)
    if args.blend:
        args.blend = os.path.abspath(args.blend)
    if args.render:
        args.render = os.path.abspath(args.render)
    return args


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------
# Color & Material Helpers (Blender 5.3 safe)
# ---------------------------------------------------------------------------

def srgb_to_linear(hex_str):
    h = hex_str.lstrip("#")
    vals = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in vals)


def make_mat(name, hex_color, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.1, spec=0.5):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(hex_color), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = spec
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = coat_rough
    return m


# ---------------------------------------------------------------------------
# Math & Geometry Primitives
# ---------------------------------------------------------------------------

def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def interp(points, y):
    """Fritsch-Carlson monotone cubic spline through (y, value) control points."""
    pts = sorted(points)
    xs = [p[0] for p in pts]
    vs = [p[1] for p in pts]
    if y <= xs[0]:
        return vs[0]
    if y >= xs[-1]:
        return vs[-1]
    n = len(pts)
    d = [(vs[i + 1] - vs[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) * 0.5 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0.0:
            m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            h = a * a + b * b
            if h > 9.0:
                t = 3.0 / math.sqrt(h)
                m[i], m[i + 1] = t * a * d[i], t * b * d[i]
    i = max(k for k in range(n - 1) if xs[k] <= y)
    hgt = xs[i + 1] - xs[i]
    t = (y - xs[i]) / hgt
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * hgt * m[i] + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * hgt * m[i + 1]


def resample_xz(pts, n):
    """Resample 2D polyline by arc length to exactly n points."""
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg)
    if total < 1e-8:
        return [pts[0]] * n
    out = []
    for i in range(n):
        s = total * i / (n - 1)
        j = 0
        while j < len(seg) - 1 and s > seg[j]:
            s -= seg[j]
            j += 1
        t = 0.0 if seg[j] == 0.0 else min(1.0, s / seg[j])
        out.append((lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)))
    return out


def link_obj(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def shade_angle(obj, deg=42.0):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg))
    obj.select_set(False)


def add_bevel(obj, width, segments=2):
    if width <= 0:
        return
    bv = obj.modifiers.new("bv", "BEVEL")
    bv.width = width
    bv.segments = segments
    bv.limit_method = "ANGLE"
    bv.angle_limit = math.radians(30.0)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="bv")


def make_box(name, loc, size, material, bevel=0.0, rot=(0.0, 0.0, 0.0), segments=1, smooth=True):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.location = loc
    o.rotation_euler = rot
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(material)
    add_bevel(o, bevel, segments)
    for p in o.data.polygons:
        p.use_smooth = smooth or bevel > 0
    if bevel > 0:
        shade_angle(o, 42.0)
    o.select_set(False)
    return o


def make_cyl(name, loc, radius, depth, material, verts=18, rot=(0.0, math.pi / 2, 0.0), scale=(1.0, 1.0, 1.0), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(material)
    add_bevel(o, bevel, 1)
    shade_angle(o, 45.0)
    o.select_set(False)
    return o


def make_bar(name, a, b, radius, material, verts=10, cap_ends=True):
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < 1e-6:
        raise ValueError(f"Zero-length bar {name}")
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts,
        radius=radius,
        depth=length,
        end_fill_type="NGON" if cap_ends else "NOTHING",
        location=((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5),
    )
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(Vector((dx, dy, dz)))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    shade_angle(o, 45.0)
    o.select_set(False)
    return o


def make_mesh_from_bmesh(name, bm, material, smooth=True, angle=42.0):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link_obj(o)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    if smooth:
        shade_angle(o, angle)
    return o


def join_objects(objs, name, origin=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    res = bpy.context.active_object
    res.name = name
    res.data.name = name
    if origin is not None:
        ox, oy, oz = origin
        for v in res.data.vertices:
            v.co.x -= ox
            v.co.y -= oy
            v.co.z -= oz
        res.location = (ox, oy, oz)
    bpy.ops.object.select_all(action="DESELECT")
    return res


def apply_bool_diff(target, cutter, solver="EXACT"):
    bpy.context.view_layer.objects.active = target
    mod = target.modifiers.new("bool_diff", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = solver
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier="bool_diff")
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.context.view_layer.update()


def build_loft(name, stations, section_fn, material, y_warp_fn=None, angle=35.0):
    """Build closed manifold bmesh loft from stations and half-section generator."""
    bm = bmesh.new()
    rings = []
    for y in stations:
        half = section_fn(y)
        full = [(x, z) for x, z in half] + [(-x, z) for x, z in reversed(half[1:-1])]
        ring = []
        for x, z in full:
            yy = y + y_warp_fn(x, y, z) if y_warp_fn else y
            ring.append(bm.verts.new((x, yy, z)))
        rings.append(ring)

    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((a[k], a[k2], b[k2], b[k]))

    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    obj = make_mesh_from_bmesh(name, bm, material, smooth=True, angle=angle)
    bpy.context.view_layer.update()
    return obj


# ---------------------------------------------------------------------------
# Hilux Revo Key Dimensions
# ---------------------------------------------------------------------------

HW = 0.92            # main body half-width
FRONT_AXLE = 1.52
REAR_AXLE = -1.52
R_WHEEL = 0.42
TYRE_W = 0.27
TRACK = 0.82         # wheel hub X offset


# ---------------------------------------------------------------------------
# Wheel Arch Profile & Cutters
# ---------------------------------------------------------------------------

def arch_profile_yz(y_center, n_side=5, n_corner=4, n_top=6):
    """Authentic Hilux Revo rounded-trapezoidal wheel arch profile in (Y, Z)."""
    z_bot = 0.28
    z_shld = 0.75
    z_top = 0.925
    dy_bot = 0.50
    dy_shld = 0.37
    dy_top = 0.24

    pts = []
    for i in range(n_side):
        t = i / n_side
        pts.append((y_center - lerp(dy_bot, dy_shld, t), lerp(z_bot, z_shld, t)))
    p0 = Vector((y_center - dy_shld, z_shld))
    p1 = Vector((y_center - 0.31, z_top - 0.015))
    p2 = Vector((y_center - dy_top, z_top - 0.006))
    for i in range(n_corner):
        t = i / n_corner
        q = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
        pts.append((q.x, q.y))
    for i in range(n_top + 1):
        t = i / n_top
        yy = lerp(y_center - dy_top, y_center + dy_top, t)
        crown = 0.012 * math.sin(t * math.pi)
        pts.append((yy, z_top - 0.006 + crown))
    q0 = Vector((y_center + dy_top, z_top - 0.006))
    q1 = Vector((y_center + 0.31, z_top - 0.015))
    q2 = Vector((y_center + dy_shld, z_shld))
    for i in range(1, n_corner + 1):
        t = i / n_corner
        q = (1 - t) ** 2 * q0 + 2 * (1 - t) * t * q1 + t * t * q2
        pts.append((q.x, q.y))
    for i in range(1, n_side + 1):
        t = i / n_side
        pts.append((y_center + lerp(dy_shld, dy_bot, t), lerp(z_shld, z_bot, t)))
    return pts


def make_arch_cutter(name, y_center):
    prof = arch_profile_yz(y_center)
    loop_yz = prof + [(y_center + 0.54, 0.12), (y_center - 0.54, 0.12)]
    bm = bmesh.new()
    v_left = [bm.verts.new((-1.35, y, z)) for y, z in loop_yz]
    v_right = [bm.verts.new((1.35, y, z)) for y, z in loop_yz]
    m = len(loop_yz)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((v_left[i], v_left[j], v_right[j], v_right[i]))
    bm.faces.new(list(reversed(v_left)))
    bm.faces.new(v_right)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link_obj(bpy.data.objects.new(name, me))


# ---------------------------------------------------------------------------
# Body Profiles: Continuous Cab + Front Clip (Y: +2.44 .. -0.78), Bed (Y: -0.84 .. -2.44)
# ---------------------------------------------------------------------------

def hw_cab(y):
    w = HW
    w += 0.014 * math.exp(-((y - FRONT_AXLE) / 0.36) ** 2)
    if y > 1.98:
        t = (y - 1.98) / 0.46
        w -= 0.19 * (t ** 1.65)
    if y < -0.66:
        t = (-0.66 - y) / 0.12
        w -= 0.025 * (t ** 1.5)
    return w


def cab_y_warp(x, y, z):
    """Forward bow on nose; also rakes nose chin subtly under grille."""
    if y <= 2.00:
        return 0.0
    t = smoothstep(2.00, 2.44, y)
    nx = min(1.0, abs(x) / max(0.35, hw_cab(y)))
    bow = 0.032 * t * math.cos(nx * math.pi * 0.5)
    # Rake upper bumper/grille slightly forward at Z=0.70..1.05, tuck lower chin back
    chin_tuck = -0.045 * t * smoothstep(0.70, 0.50, z)
    return bow + chin_tuck


def cab_section(y, n=48):
    """Continuous half cross-section with zero topological jumps at cowl/A-pillar."""
    TOP = [
        (2.44, 1.045), (2.34, 1.115), (2.06, 1.175), (1.50, 1.222),
        (1.08, 1.246), (1.02, 1.244), (0.94, 1.275), (0.82, 1.392),
        (0.66, 1.552), (0.50, 1.705), (0.38, 1.805), (0.08, 1.836),
        (-0.42, 1.834), (-0.70, 1.812), (-0.78, 1.785),
    ]
    BOT = [
        (2.44, 0.52), (2.22, 0.47), (1.96, 0.45), (1.00, 0.45), (-0.78, 0.45),
    ]
    BELT = [
        (2.44, 0.96), (2.15, 1.08), (1.60, 1.175), (1.08, 1.225),
        (0.85, 1.245), (0.10, 1.245), (-0.36, 1.258), (-0.78, 1.318),
    ]
    zb = interp(BOT, y)
    zt = interp(TOP, y)
    hw = hw_cab(y)
    belt = min(interp(BELT, y), zt - 0.025)

    # Pure height-driven tumblehome gives dead-straight A-pillar silhouette
    up = smoothstep(0.02, 0.56, zt - belt)
    hood_blend = smoothstep(0.96, 1.16, y) * smoothstep(2.44, 2.20, y)

    tum = lerp(0.055, 0.175, up)
    rr = lerp(0.040, 0.080, up)
    rb = 0.060
    top_x = hw - tum

    pts = [
        (0.0, zb),
        (max(0.10, hw - 0.14), zb),
        (hw - 0.032, zb + 0.014),
        (hw - 0.024, zb + rb * 0.85),
        (hw - 0.015, lerp(zb + rb, belt, 0.28)),
        (hw + 0.014, lerp(zb + rb, belt, 0.72)),
        (hw, belt),
        (top_x, max(belt + 0.015, zt - rr)),
    ]
    for k in range(1, 5):
        a = k * (math.pi * 0.5) / 4.0
        pts.append((top_x - rr + rr * math.cos(a), zt - rr + rr * math.sin(a)))

    # Smooth hood power dome & subtle roof crown share identical point topology
    dome_h = 0.022 * hood_blend
    pts.append((0.46, zt + 0.005 * up))
    pts.append((0.38, zt + dome_h + 0.012 * up))
    pts.append((0.0, zt + dome_h + 0.022 * up))
    return resample_xz(pts, n)


def hw_bed(y):
    w = HW
    w += 0.015 * math.exp(-((y - REAR_AXLE) / 0.36) ** 2)
    if y < -2.24:
        t = (-2.24 - y) / 0.20
        w -= 0.045 * (t ** 1.6)
    return w


def bed_y_warp(x, y, z):
    if y >= -2.28:
        return 0.0
    t = smoothstep(-2.28, -2.44, y)
    nx = min(1.0, abs(x) / max(0.35, hw_bed(y)))
    return -0.016 * t * math.cos(nx * math.pi * 0.5)


def bed_section(y, n=36):
    TOP = [(-0.84, 1.245), (-1.52, 1.250), (-2.44, 1.258)]
    BOT = [(-0.84, 0.45), (-1.96, 0.45), (-2.25, 0.475), (-2.44, 0.51)]
    zb = interp(BOT, y)
    zt = interp(TOP, y)
    hw = hw_bed(y)
    rb = 0.065
    pts = [
        (0.0, zb),
        (max(0.10, hw - 0.14), zb),
        (hw - 0.045, zb + rb * 0.65),
        (hw - 0.016, lerp(zb + rb, zt, 0.25)),
        (hw + 0.014, lerp(zb + rb, zt, 0.74)),
        (hw, zt - 0.03),
        (hw - 0.035, zt),
        (0.0, zt),
    ]
    return resample_xz(pts, n)


# ---------------------------------------------------------------------------
# Surface Projection Helpers
# ---------------------------------------------------------------------------

def rounded_poly(poly, r=0.035, seg=4, step=0.055):
    out = []
    n = len(poly)
    for i in range(n):
        a = Vector(poly[i - 1])
        p = Vector(poly[i])
        b = Vector(poly[(i + 1) % n])
        rr = min(r, (a - p).length * 0.44, (b - p).length * 0.44)
        p1 = p + (a - p).normalized() * rr
        p2 = p + (b - p).normalized() * rr
        for k in range(seg + 1):
            t = k / seg
            q = (1 - t) ** 2 * p1 + 2 * (1 - t) * t * p + t * t * p2
            out.append((q.x, q.y))
        nxt = Vector(poly[(i + 1) % n])
        nb = Vector(poly[(i + 2) % n])
        r2 = min(r, (p - nxt).length * 0.44, (nb - nxt).length * 0.44)
        start = p2
        end = nxt + (p - nxt).normalized() * r2
        steps = max(1, int((end - start).length / step))
        for k in range(1, steps):
            q = start.lerp(end, k / steps)
            out.append((q.x, q.y))
    return out


def ray_project_panel(target_obj, name, outline_2d, axis, material, lift, scale=1.0, rings=3, corner_r=0.035, center_ref=None):
    """Fan-grid inside a rounded 2D outline projected cleanly onto target_obj."""
    bpy.context.view_layer.update()
    poly = rounded_poly(outline_2d, r=corner_r)
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)

    ray_dirs = {
        "+y": Vector((0.0, 1.0, 0.0)),
        "-y": Vector((0.0, -1.0, 0.0)),
        "-x": Vector((-1.0, 0.0, 0.0)),
        "+x": Vector((1.0, 0.0, 0.0)),
    }
    ray_dir = ray_dirs[axis]

    def project(a, b):
        if axis == "+y":
            origin = Vector((a, -3.5, b))
        elif axis == "-y":
            origin = Vector((a, 3.5, b))
        elif axis == "-x":
            origin = Vector((2.5, a, b))
        else:
            origin = Vector((-2.5, a, b))
        ok, loc, nrm, _ = target_obj.ray_cast(origin, ray_dir)
        if not ok:
            _, loc, nrm, _ = target_obj.closest_point_on_mesh(origin * 0.35 + Vector((0, 0, b * 0.65)))
        return loc + nrm.normalized() * lift

    bm = bmesh.new()
    grid = []
    for r in range(rings, 0, -1):
        f = scale * r / rings
        grid.append([bm.verts.new(project(cx + (p[0] - cx) * f, cz + (p[1] - cz) * f)) for p in poly])
    centre = bm.verts.new(project(cx, cz))
    m = len(poly)
    for r in range(rings - 1):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]))
    for i in range(m):
        bm.faces.new((grid[-1][i], grid[-1][(i + 1) % m], centre))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ref = Vector(center_ref) if center_ref else Vector((0.0, 0.4, 1.15))
    for f in bm.faces:
        if f.normal.dot(-ray_dir) < 0 and f.normal.dot(f.calc_center_median() - ref) < 0:
            f.normal_flip()

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link_obj(o)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return o


def ray_project_strip(target_obj, name, pts_2d, width_z, axis, material, lift):
    """Project a clean thin ribbon strip onto target_obj along axis."""
    bpy.context.view_layer.update()
    ray_dirs = {"-x": Vector((-1.0, 0.0, 0.0)), "+x": Vector((1.0, 0.0, 0.0))}
    ray_dir = ray_dirs[axis]
    bm = bmesh.new()
    top_v, bot_v = [], []
    hw = width_z * 0.5
    for y_pt, z_pt in pts_2d:
        for z_off, arr in ((-hw, bot_v), (hw, top_v)):
            orig = Vector((2.2 if axis == "-x" else -2.2, y_pt, z_pt + z_off))
            ok, loc, nrm, _ = target_obj.ray_cast(orig, ray_dir)
            if not ok:
                _, loc, nrm, _ = target_obj.closest_point_on_mesh(Vector((0.9 * (1 if axis == "-x" else -1), y_pt, z_pt + z_off)))
            arr.append(bm.verts.new(loc + nrm.normalized() * lift))
    for i in range(len(pts_2d) - 1):
        bm.faces.new((bot_v[i], bot_v[i + 1], top_v[i + 1], top_v[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.dot(-ray_dir) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link_obj(o)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return o


def ray_project_vseam(target_obj, name, y_val, z_pts, width_y, axis, material, lift):
    """Project a crisp thin vertical shut-line seam onto target_obj along axis."""
    bpy.context.view_layer.update()
    ray_dirs = {"-x": Vector((-1.0, 0.0, 0.0)), "+x": Vector((1.0, 0.0, 0.0))}
    ray_dir = ray_dirs[axis]
    bm = bmesh.new()
    left_v, right_v = [], []
    hy = width_y * 0.5
    for z_pt in z_pts:
        for y_off, arr in ((-hy, left_v), (hy, right_v)):
            orig = Vector((2.2 if axis == "-x" else -2.2, y_val + y_off, z_pt))
            ok, loc, nrm, _ = target_obj.ray_cast(orig, ray_dir)
            if not ok:
                _, loc, nrm, _ = target_obj.closest_point_on_mesh(Vector((0.9 * (1 if axis == "-x" else -1), y_val + y_off, z_pt)))
            arr.append(bm.verts.new(loc + nrm.normalized() * lift))
    for i in range(len(z_pts) - 1):
        bm.faces.new((left_v[i], right_v[i], right_v[i + 1], left_v[i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.dot(-ray_dir) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link_obj(o)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return o


def make_trapezoidal_flare(name, sx, y_center, body_obj, material):
    """Sweep chunky matte-black Rocco overfender hugging the trapezoidal wheel arch."""
    bpy.context.view_layer.update()
    prof = arch_profile_yz(y_center, n_side=5, n_corner=4, n_top=6)
    prof = [(y, max(0.45, z)) for y, z in prof]
    center = Vector((0.0, y_center, 0.44))

    sec = [
        (-0.025, 0.000),
        (-0.025, 0.068),
        (0.028, 0.072),
        (0.054, 0.056),
        (0.058, 0.026),
        (0.044, 0.002),
        (0.008, -0.008),
    ]

    bm = bmesh.new()
    rings = []
    for i, (py, pz) in enumerate(prof):
        p_prev = Vector((0.0, prof[max(0, i - 1)][0], prof[max(0, i - 1)][1]))
        p_next = Vector((0.0, prof[min(len(prof) - 1, i + 1)][0], prof[min(len(prof) - 1, i + 1)][1]))
        tang = (p_next - p_prev).normalized()
        rad = Vector((0.0, -tang.z, tang.y)).normalized()
        if rad.dot(Vector((0.0, py, pz)) - center) < 0:
            rad = -rad

        probe_yz = Vector((0.0, py, pz)) + rad * 0.032
        ok, loc, _, _ = body_obj.ray_cast(Vector((sx * 1.8, probe_yz.y, max(0.48, probe_yz.z))), Vector((-sx, 0.0, 0.0)))
        surf_x = abs(loc.x) if ok else HW

        ring = []
        for dx, dr in sec:
            x = sx * (surf_x + dx)
            p = Vector((x, py, pz)) + rad * dr
            ring.append(bm.verts.new(p))
        rings.append(ring)

    m = len(sec)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(m):
            k2 = (k + 1) % m
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return make_mesh_from_bmesh(name, bm, material, smooth=True, angle=42.0)


# ---------------------------------------------------------------------------
# Wheel Builder (18" Rocco Bi-Tone 6-Split-Spoke Alloy + A/T Tyre)
# ---------------------------------------------------------------------------

def build_hilux_wheel(name, x, y, tyre_mat, rim_mat, gun_mat, chrome_mat, steel_mat):
    sgn = 1.0 if x >= 0 else -1.0
    parts = []

    r_outer = R_WHEEL - 0.004
    r_shld = R_WHEEL - 0.018
    r_rim = 0.250
    hw = TYRE_W * 0.5
    lathe_prof = [
        (-hw * 0.78, r_rim),
        (-hw * 0.96, r_rim + 0.04),
        (-hw * 1.02, r_rim + 0.10),
        (-hw * 0.95, r_shld),
        (-hw * 0.80, r_outer),
        (0.0, r_outer + 0.004),
        (hw * 0.80, r_outer),
        (hw * 0.95, r_shld),
        (hw * 1.02, r_rim + 0.10),
        (hw * 0.96, r_rim + 0.04),
        (hw * 0.78, r_rim),
    ]
    bm = bmesh.new()
    segs = 24
    rings = []
    for lx, rad in lathe_prof:
        ring = []
        for s in range(segs):
            a = s * 2.0 * math.pi / segs
            ring.append(bm.verts.new((lx, math.cos(a) * rad, math.sin(a) * rad)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(segs):
            s2 = (s + 1) % segs
            bm.faces.new((rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]))
    for s in range(segs):
        s2 = (s + 1) % segs
        bm.faces.new((rings[-1][s], rings[-1][s2], rings[0][s2], rings[0][s]))
    o_t = make_mesh_from_bmesh(f"{name}_tyre", bm, tyre_mat, smooth=True, angle=48.0)
    parts.append(o_t)

    n_lugs = 16
    for k in range(n_lugs):
        a = k * 2.0 * math.pi / n_lugs
        for side_s in (-1.0, 1.0):
            ang = a + (0.09 if side_s > 0 else 0.0)
            r_lug = R_WHEEL - 0.011
            ly = math.cos(ang) * r_lug
            lz = math.sin(ang) * r_lug
            lug = make_box(
                f"{name}_lug",
                (side_s * hw * 0.76, ly, lz),
                (0.055, 0.046, 0.022),
                tyre_mat,
                rot=(ang - math.pi * 0.5, 0.0, 0.0),
                smooth=False,
            )
            parts.append(lug)

    parts.append(make_cyl(f"{name}_barrel", (0.0, 0.0, 0.0), r_rim + 0.005, TYRE_W * 0.80, gun_mat, verts=24))
    parts.append(make_cyl(f"{name}_rotor", (-sgn * 0.015, 0.0, 0.0), 0.175, 0.026, steel_mat, verts=20))
    parts.append(make_box(f"{name}_caliper", (-sgn * 0.015, 0.125, 0.045), (0.055, 0.075, 0.12), gun_mat, bevel=0.008))

    bpy.ops.mesh.primitive_torus_add(
        major_radius=r_rim - 0.008,
        minor_radius=0.018,
        major_segments=24,
        minor_segments=7,
        location=(sgn * (hw * 0.80), 0.0, 0.0),
        rotation=(0.0, math.pi * 0.5, 0.0),
    )
    lip = bpy.context.active_object
    lip.name = f"{name}_lip"
    lip.data.name = f"{name}_lip"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    lip.data.materials.append(rim_mat)
    for p in lip.data.polygons:
        p.use_smooth = True
    lip.select_set(False)
    parts.append(lip)

    hub_x = sgn * (hw * 0.76)
    parts.append(make_cyl(f"{name}_hub", (hub_x, 0.0, 0.0), 0.068, 0.036, gun_mat, verts=14))
    parts.append(make_cyl(f"{name}_cap", (hub_x + sgn * 0.014, 0.0, 0.0), 0.038, 0.016, chrome_mat, verts=14))

    for k in range(6):
        a = k * 2.0 * math.pi / 6.0
        la = a + math.pi / 6.0
        parts.append(
            make_cyl(
                f"{name}_nut_{k}",
                (hub_x + sgn * 0.012, math.cos(la) * 0.050, math.sin(la) * 0.050),
                0.009,
                0.018,
                chrome_mat,
                verts=6,
            )
        )
        for ds in (-0.16, 0.16):
            sa = a + ds
            parts.append(
                make_box(
                    f"{name}_spk_{k}_{ds}",
                    (hub_x + sgn * 0.008, math.cos(sa) * 0.148, math.sin(sa) * 0.148),
                    (0.020, 0.185, 0.026),
                    rim_mat,
                    bevel=0.003,
                    rot=(sa, 0.0, 0.0),
                )
            )
        parts.append(
            make_box(
                f"{name}_web_{k}",
                (hub_x - sgn * 0.004, math.cos(a) * 0.142, math.sin(a) * 0.142),
                (0.024, 0.175, 0.050),
                gun_mat,
                rot=(a, 0.0, 0.0),
                smooth=False,
            )
        )

    wheel_obj = join_objects(parts, name)
    wheel_obj.location = (x, y, R_WHEEL)
    return wheel_obj


# ---------------------------------------------------------------------------
# Helpers for Signature Revo Sculpted Parts
# ---------------------------------------------------------------------------

def build_toyota_emblem(prefix, cy, cz, yaw, scale_xy, trim_mat, chrome_mat):
    """Build 3-oval Toyota emblem (outer oval + vertical inner oval + upper horizontal arch)."""
    parts_chrome = []
    # Outer black oval backing
    make_cyl(
        f"{prefix}_bg",
        (0.0, cy, cz),
        0.062 * scale_xy,
        0.018,
        trim_mat,
        verts=22,
        rot=(math.pi * 0.5, 0.0, yaw),
        scale=(1.42, 1.0, 1.0),
    )

    def add_oval_torus(tname, rx, rz, minor_r, cx_off=0.0, cz_off=0.0):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=1.0,
            minor_radius=minor_r,
            major_segments=20,
            minor_segments=6,
        )
        t = bpy.context.active_object
        t.name = tname
        t.scale = (rx, rz, 1.0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        t.rotation_euler = (math.pi * 0.5, 0.0, yaw)
        fwd = -0.010 if yaw > 1.0 else 0.010
        t.location = (cx_off, cy + fwd, cz + cz_off)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        t.data.materials.append(chrome_mat)
        for p in t.data.polygons:
            p.use_smooth = True
        t.select_set(False)
        parts_chrome.append(t)

    s = scale_xy
    add_oval_torus(f"{prefix}_outer", 0.084 * s, 0.058 * s, 0.008 * s)
    add_oval_torus(f"{prefix}_inner_v", 0.025 * s, 0.054 * s, 0.006 * s)
    add_oval_torus(f"{prefix}_inner_h", 0.064 * s, 0.020 * s, 0.006 * s, cz_off=0.024 * s)
    join_objects(parts_chrome, f"{prefix}_chrome")


def build_sculpted_headlamp(sx, cab_obj, head_mat, trim_mat, chrome_mat, amber_mat):
    """Build swept-back angular Revo Bi-LED headlamp ray-snapped radially around cab_body corner.
    Guarantees head_1_* hugs the exact fender curve with zero burial and single material.
    """
    bpy.context.view_layer.update()
    tag = "R" if sx > 0 else "L"
    pivot = Vector((sx * 0.40, 1.98, 0.0))

    def make_radial_panel(name, th0, th1, z0_b, z0_t, z1_b, z1_t, lift_in, lift_out, mat, cols=7):
        bm = bmesh.new()
        vf_b, vf_t, vb_b, vb_t = [], [], [], []
        for c in range(cols + 1):
            t = c / cols
            th = lerp(th0, th1, t)
            zb = lerp(z0_b, z1_b, t)
            zt = lerp(z0_t, z1_t, t)
            rad = Vector((sx * math.sin(th), math.cos(th), 0.0)).normalized()
            for z_val, arr_out, arr_in in ((zb, vf_b, vb_b), (zt, vf_t, vb_t)):
                orig = Vector((pivot.x, pivot.y, z_val)) + rad * 1.45
                ok, loc, nrm, _ = cab_obj.ray_cast(orig, -rad)
                if not ok:
                    _, loc, nrm, _ = cab_obj.closest_point_on_mesh(Vector((pivot.x, pivot.y, z_val)) + rad * 0.55)
                n = Vector((nrm.x, nrm.y, max(0.0, nrm.z * 0.35))).normalized()
                arr_out.append(bm.verts.new(loc + n * lift_out))
                arr_in.append(bm.verts.new(loc + n * lift_in))
        for c in range(cols):
            bm.faces.new((vf_b[c], vf_b[c + 1], vf_t[c + 1], vf_t[c]))
            bm.faces.new((vb_t[c], vb_t[c + 1], vb_b[c + 1], vb_b[c]))
            bm.faces.new((vf_t[c], vf_t[c + 1], vb_t[c + 1], vb_t[c]))
            bm.faces.new((vb_b[c], vb_b[c + 1], vf_b[c + 1], vf_b[c]))
        bm.faces.new((vb_b[0], vf_b[0], vf_t[0], vb_t[0]))
        bm.faces.new((vf_b[-1], vb_b[-1], vb_t[-1], vf_t[-1]))
        return make_mesh_from_bmesh(name, bm, mat, smooth=True, angle=38.0)

    # Dark housing surround hugging cab nose-to-fender corner (ignored by VehicleFactory)
    make_radial_panel(f"head_surround_{tag}", 0.24, 1.18, 0.895, 1.035, 0.960, 1.072, -0.008, 0.015, trim_mat, cols=8)
    # Main Bi-LED headlamp + DRL lens (head_1_*, single material HEAD)
    make_radial_panel(f"head_1_{tag}", 0.26, 0.96, 0.912, 1.022, 0.960, 1.055, 0.004, 0.022, head_mat, cols=7)
    # Inner chrome projector accent (ignored by VehicleFactory)
    make_radial_panel(f"head_reflector_{tag}", 0.35, 0.72, 0.944, 0.994, 0.956, 1.006, 0.010, 0.026, chrome_mat, cols=4)
    # Outer amber turn indicator wrapping onto fender (single material AMBER)
    make_radial_panel(f"hazard_f{tag}", 0.98, 1.16, 0.962, 1.054, 0.968, 1.064, 0.004, 0.022, amber_mat, cols=3)


# ---------------------------------------------------------------------------
# Main Vehicle Assembly
# ---------------------------------------------------------------------------

def build_hilux_revo():
    PAINT = make_mat("paint", "#eaedf0", rough=0.22, metal=0.18, coat=0.85, coat_rough=0.06)
    GLASS = make_mat("glass", "#0f151b", rough=0.05, metal=0.15, coat=0.45, coat_rough=0.04)
    TRIM = make_mat("trim", "#141618", rough=0.62, metal=0.06)
    GUNMETAL = make_mat("gunmetal", "#3b414a", rough=0.36, metal=0.68)
    CHROME = make_mat("chrome", "#dce1e6", rough=0.18, metal=0.90)
    STEEL = make_mat("steel", "#9ba3ac", rough=0.36, metal=0.82)
    TYRE = make_mat("tyre", "#1a1b1d", rough=0.88, metal=0.0)
    RIM = make_mat("rim", "#c8cdd4", rough=0.24, metal=0.82)
    PLATE = make_mat("plate", "#f2efe4", rough=0.45, metal=0.0)
    HEAD = make_mat("head", "#f4f7ee", rough=0.12, metal=0.0)
    BRAKE = make_mat("brake", "#9e1616", rough=0.22, metal=0.0)
    AMBER = make_mat("hazard", "#dc8516", rough=0.25, metal=0.0)
    LENS = make_mat("lens_clear", "#e5e9ed", rough=0.14, metal=0.0)

    # ------------------------------------------------------------------
    # 1. Lofted Front Clip + Double Cab ("cab_body", Y: +2.44 .. -0.78)
    # ------------------------------------------------------------------
    cab_stations = []
    for i in range(22):
        cab_stations.append(lerp(2.44, 1.06, i / 21.0))
    for i in range(1, 20):
        cab_stations.append(lerp(1.06, 0.36, i / 19.0))
    for i in range(1, 18):
        cab_stations.append(lerp(0.36, -0.78, i / 17.0))

    cab = build_loft("cab_body", cab_stations, cab_section, PAINT, y_warp_fn=cab_y_warp, angle=30.0)
    apply_bool_diff(cab, make_arch_cutter("arch_cut_F", FRONT_AXLE), solver="EXACT")
    shade_angle(cab, 30.0)

    # ------------------------------------------------------------------
    # 2. Separated Hollow Rear Pickup Bed ("bed_body", Y: -0.84 .. -2.44)
    # ------------------------------------------------------------------
    bed_stations = [lerp(-0.84, -2.44, i / 34.0) for i in range(35)]
    bed = build_loft("bed_body", bed_stations, bed_section, PAINT, y_warp_fn=bed_y_warp, angle=35.0)

    cavity = make_box("bed_cav_cut", (0.0, -1.64, 1.155), (1.48, 1.38, 0.76), TRIM, bevel=0.03, segments=1)
    apply_bool_diff(bed, cavity, solver="EXACT")
    apply_bool_diff(bed, make_arch_cutter("arch_cut_R", REAR_AXLE), solver="EXACT")
    shade_angle(bed, 35.0)

    # Matte-black bedliner floor, corrugated ribs, wheel well humps, inner walls, and top rail caps
    make_box("bedliner_floor", (0.0, -1.64, 0.785), (1.45, 1.36, 0.03), TRIM, smooth=False)
    for k in range(-4, 5):
        make_box(f"bed_rib_{k}", (k * 0.145, -1.64, 0.803), (0.048, 1.32, 0.015), TRIM, smooth=False)
    make_box("bedliner_front", (0.0, -0.96, 1.015), (1.46, 0.025, 0.45), TRIM, smooth=False)
    make_box("bedliner_tail_in", (0.0, -2.32, 1.015), (1.46, 0.025, 0.45), TRIM, smooth=False)
    make_box("bed_cap_tail", (0.0, -2.385, 1.262), (1.58, 0.115, 0.024), TRIM, bevel=0.008)
    for sx in (-1.0, 1.0):
        make_box(f"bedliner_side_{sx}", (sx * 0.735, -1.64, 1.015), (0.025, 1.36, 0.45), TRIM, smooth=False)
        make_box(f"bed_rail_cap_{sx}", (sx * 0.825, -1.64, 1.258), (0.14, 1.54, 0.022), TRIM, bevel=0.008)
        make_box(f"bed_wheelhouse_{sx}", (sx * 0.63, -1.52, 0.875), (0.21, 0.76, 0.18), TRIM, bevel=0.04)

    # ------------------------------------------------------------------
    # 3. 2020-2024 Hilux Revo Rocco Front Fascia (Grille, Bumper, Skid, Headlamps, Fogs)
    # ------------------------------------------------------------------
    def grille_y(x):
        # Sits cleanly proud of cab_body nose (cab front center is ~2.472)
        nx = min(1.0, abs(x) / 0.75)
        return 2.502 * math.cos(nx * 0.12) - 0.10 * (nx ** 2.0)

    # Lower bumper valance + sleek corner bumper cheeks + central black air dam
    make_box("bumper_chin", (0.0, 2.475, 0.545), (1.48, 0.11, 0.155), TRIM, bevel=0.03)
    for sx in (-1.0, 1.0):
        make_box(
            f"bumper_cheek_{sx}",
            (sx * 0.675, 2.385, 0.56),
            (0.42, 0.19, 0.175),
            PAINT,
            bevel=0.042,
            rot=(0.0, 0.0, sx * -0.26),
        )

    # Bold Rocco Hexagonal / Trapezoidal Grille Frame (GUNMETAL, sitting clearly proud of nose!)
    hex_outer = [
        (-0.515, 1.065), (0.515, 1.065), (0.555, 0.945), (0.445, 0.685),
        (-0.445, 0.685), (-0.555, 0.945),
    ]
    hex_inner = [
        (-0.435, 1.015), (0.435, 1.015), (0.470, 0.938), (0.375, 0.735),
        (-0.375, 0.735), (-0.470, 0.938),
    ]
    bm_g = bmesh.new()
    v_f_out, v_b_out, v_f_in, v_b_in = [], [], [], []
    for ox, oz in hex_outer:
        yf = grille_y(ox) + 0.022
        v_f_out.append(bm_g.verts.new((ox, yf, oz)))
        v_b_out.append(bm_g.verts.new((ox, yf - 0.070, oz)))
    for ix, iz in hex_inner:
        yf = grille_y(ix) + 0.016
        v_f_in.append(bm_g.verts.new((ix, yf, iz)))
        v_b_in.append(bm_g.verts.new((ix, yf - 0.070, iz)))
    m_hex = len(hex_outer)
    for i in range(m_hex):
        j = (i + 1) % m_hex
        bm_g.faces.new((v_f_out[i], v_f_out[j], v_f_in[j], v_f_in[i]))
        bm_g.faces.new((v_b_out[j], v_b_out[i], v_b_in[i], v_b_in[j]))
        bm_g.faces.new((v_f_out[j], v_f_out[i], v_b_out[i], v_b_out[j]))
        bm_g.faces.new((v_f_in[i], v_f_in[j], v_b_in[j], v_b_in[i]))
    grille_frame = make_mesh_from_bmesh("grille_frame", bm_g, GUNMETAL, smooth=True, angle=42.0)
    add_bevel(grille_frame, 0.009, 1)

    # Dark recessed grille honeycomb backing inside hex frame
    bm_gb = bmesh.new()
    vf = [bm_gb.verts.new((ix, grille_y(ix) - 0.002, iz)) for ix, iz in hex_inner]
    vb = [bm_gb.verts.new((ix, grille_y(ix) - 0.048, iz)) for ix, iz in hex_inner]
    for i in range(m_hex):
        j = (i + 1) % m_hex
        bm_gb.faces.new((vf[i], vf[j], vb[j], vb[i]))
    bm_gb.faces.new(vf)
    bm_gb.faces.new(list(reversed(vb)))
    make_mesh_from_bmesh("grille_mesh", bm_gb, TRIM, smooth=False)

    # Bold horizontal Rocco grille bars & 3-oval Toyota emblem
    for idx, (gz, gw) in enumerate(((0.985, 0.88), (0.910, 0.92), (0.835, 0.84), (0.768, 0.76))):
        make_box(f"grille_slat_{idx}", (0.0, 2.498, gz), (gw, 0.032, 0.022), GUNMETAL if idx == 1 else TRIM, bevel=0.005)
    build_toyota_emblem("badge_f", 2.512, 0.910, 0.0, 1.0, TRIM, CHROME)

    # Lower trapezoidal air intake, front plate, and flush angled brushed steel skid plate
    make_box("lower_intake", (0.0, 2.502, 0.565), (0.86, 0.055, 0.135), TRIM, bevel=0.008)
    make_box("lower_slat_1", (0.0, 2.524, 0.54), (0.80, 0.020, 0.014), TRIM)
    make_box("lower_slat_2", (0.0, 2.524, 0.59), (0.80, 0.020, 0.014), TRIM)
    make_box("plate_f", (0.0, 2.536, 0.595), (0.40, 0.022, 0.105), PLATE, bevel=0.004)
    # Positive X rotation lifts front edge (+Y) UP to meet bumper chin visibly
    make_box("skid_chin", (0.0, 2.515, 0.482), (0.84, 0.065, 0.055), STEEL, bevel=0.012)
    make_box("skid_plate", (0.0, 2.29, 0.435), (0.80, 0.48, 0.036), STEEL, bevel=0.010, rot=(0.30, 0.0, 0.0))
    for kx in (-0.21, 0.0, 0.21):
        make_box(f"skid_rib_{kx}", (kx, 2.29, 0.421), (0.045, 0.44, 0.018), STEEL, rot=(0.30, 0.0, 0.0))

    # Swept-Back Angular Revo Bi-LED Headlamps (MUST create head_1_* BEFORE head_2_fog_*)
    for sx in (-1.0, 1.0):
        build_sculpted_headlamp(sx, cab, HEAD, TRIM, CHROME, AMBER)

    # Vertical Angular Revo Fog Lamp Housings & LED Fog Lamps (head_2_fog_*)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        fx, fy, fz = sx * 0.675, 2.405, 0.745
        yaw = sx * -0.44
        make_box(f"head_bezel_fog_{tag}", (fx, fy, fz), (0.145, 0.085, 0.215), TRIM, bevel=0.016, rot=(0.0, 0.0, yaw))
        # Chrome reflector ring + single-material LED fog lens clearly visible ahead of bumper cheek
        nx = sx * math.sin(0.44)
        ny = math.cos(0.44)
        make_cyl(
            f"head_reflector_fog_{tag}",
            (fx + nx * 0.038, fy + ny * 0.038, fz),
            0.046,
            0.026,
            CHROME,
            verts=16,
            rot=(math.pi * 0.5, 0.0, yaw),
        )
        make_cyl(
            f"head_2_fog_{tag}",
            (fx + nx * 0.046, fy + ny * 0.046, fz),
            0.036,
            0.020,
            HEAD,
            verts=16,
            rot=(math.pi * 0.5, 0.0, yaw),
        )

    # ------------------------------------------------------------------
    # 4. Greenhouse: Windscreen, Side Windows (w/ Kick-up), Rear Cab Glass, Mirrors, Handles
    # ------------------------------------------------------------------
    WINDSCREEN = [(-0.67, 1.31), (0.67, 1.31), (0.59, 1.73), (-0.59, 1.73)]
    ray_project_panel(cab, "windscreen_frame", WINDSCREEN, "-y", TRIM, 0.004, scale=1.055, corner_r=0.045)
    ray_project_panel(cab, "windscreen", WINDSCREEN, "-y", GLASS, 0.008, scale=1.0, corner_r=0.040)

    make_box("cowl_vent", (0.0, 1.025, 1.248), (1.42, 0.11, 0.022), TRIM, bevel=0.006)
    for wx in (-0.28, 0.22):
        make_box(f"wiper_{wx}", (wx, 0.96, 1.285), (0.48, 0.024, 0.016), TRIM, rot=(-0.2, 0.0, -0.14))

    REAR_WIN = [(-0.62, 1.36), (0.62, 1.36), (0.58, 1.715), (-0.58, 1.715)]
    ray_project_panel(cab, "rear_win_frame", REAR_WIN, "+y", TRIM, 0.004, scale=1.05, corner_r=0.035)
    ray_project_panel(cab, "rear_win", REAR_WIN, "+y", GLASS, 0.008, scale=1.0, corner_r=0.030)
    make_box("hmsl_bezel", (0.0, -0.785, 1.775), (0.28, 0.024, 0.046), TRIM, bevel=0.006)
    make_box("brake_hmsl", (0.0, -0.796, 1.775), (0.22, 0.016, 0.026), BRAKE, bevel=0.004)

    # Side windows (elongated 4-door Double Cab up to Y=-0.70, signature rear beltline kick-up)
    SIDE_WIN = [
        (0.83, 1.300),
        (0.42, 1.695),
        (-0.67, 1.702),
        (-0.69, 1.355),
        (-0.36, 1.285),
        (0.46, 1.275),
    ]
    for sx in (-1.0, 1.0):
        axis = "-x" if sx > 0 else "+x"
        tag = "R" if sx > 0 else "L"
        ray_project_panel(cab, f"side_win_frame_{tag}", SIDE_WIN, axis, TRIM, 0.008, scale=1.032, rings=5, corner_r=0.030)
        ray_project_panel(cab, f"side_win_{tag}", SIDE_WIN, axis, GLASS, 0.012, scale=1.0, rings=5, corner_r=0.026)

        # Blacked-out B-pillar & rear quarter divider strictly INSIDE window height (above beltline!)
        ray_project_panel(
            cab,
            f"b_pillar_{tag}",
            [(0.06, 1.292), (0.05, 1.705), (-0.05, 1.705), (-0.04, 1.292)],
            axis,
            TRIM,
            0.016,
            rings=3,
            corner_r=0.008,
        )
        ray_project_panel(
            cab,
            f"c_div_{tag}",
            [(-0.525, 1.320), (-0.525, 1.706), (-0.548, 1.706), (-0.548, 1.326)],
            axis,
            TRIM,
            0.015,
            rings=3,
            corner_r=0.004,
        )
        # Clean satin chrome beltline trim tracing lower window sill + rear kick-up
        ray_project_strip(
            cab,
            f"belt_trim_{tag}",
            [(0.84, 1.272), (0.46, 1.262), (0.01, 1.264), (-0.36, 1.275), (-0.54, 1.308), (-0.70, 1.348)],
            0.022,
            axis,
            CHROME,
            0.017,
        )

        # Wing mirrors
        make_bar(f"mirror_stalk_{tag}", (sx * 0.85, 0.78, 1.285), (sx * 1.00, 0.76, 1.34), 0.022, TRIM, verts=10)
        make_box(f"mirror_low_{tag}", (sx * 1.035, 0.75, 1.34), (0.165, 0.10, 0.085), TRIM, bevel=0.022, rot=(0.0, 0.0, sx * -0.14))
        make_box(f"mirror_cap_{tag}", (sx * 1.038, 0.755, 1.395), (0.160, 0.095, 0.075), PAINT, bevel=0.024, rot=(0.0, 0.0, sx * -0.14))
        make_box(f"mirror_glass_{tag}", (sx * 1.035, 0.703, 1.37), (0.135, 0.012, 0.105), GLASS, rot=(0.0, 0.0, sx * -0.14), smooth=False)
        make_box(f"hazard_m{tag}", (sx * 1.065, 0.798, 1.372), (0.095, 0.022, 0.018), AMBER, bevel=0.004, rot=(0.0, 0.0, sx * -0.22))

        # Chrome door handles & recessed black pockets + crisp vertical door shut lines
        for hy, hname in ((0.16, "f"), (-0.56, "r")):
            make_box(f"handle_cup_{hname}_{tag}", (sx * 0.918, hy, 1.125), (0.016, 0.160, 0.050), TRIM, bevel=0.006)
            make_box(f"handle_{hname}_{tag}", (sx * 0.932, hy, 1.125), (0.022, 0.142, 0.030), CHROME, bevel=0.008)
        for sy_seam, sname in ((0.92, "front"), (0.01, "mid"), (-0.72, "rear")):
            ray_project_vseam(
                cab,
                f"seam_{sname}_{tag}",
                sy_seam,
                [0.54, 0.72, 0.92, 1.10, 1.24],
                0.005,
                axis,
                TRIM,
                0.002,
            )

    # Fuel filler door on left rear bed side
    make_box("fuel_door", (-0.920, -1.16, 1.03), (0.008, 0.155, 0.135), TRIM, bevel=0.004)
    make_box("fuel_door_cap", (-0.923, -1.16, 1.03), (0.008, 0.142, 0.122), PAINT, bevel=0.005)

    # Flush integrated low-profile roof rails & shark-fin antenna
    for sx in (-1.0, 1.0):
        make_bar(f"roof_rail_{sx}", (sx * 0.59, 0.28, 1.842), (sx * 0.59, -0.64, 1.842), 0.018, TRIM, verts=10)
        make_bar(f"roof_rail_f_{sx}", (sx * 0.59, 0.38, 1.805), (sx * 0.59, 0.28, 1.842), 0.017, TRIM, verts=8)
        make_bar(f"roof_rail_r_{sx}", (sx * 0.59, -0.64, 1.842), (sx * 0.59, -0.72, 1.802), 0.017, TRIM, verts=8)
    make_box("shark_fin", (0.0, -0.56, 1.855), (0.052, 0.15, 0.068), TRIM, bevel=0.016, rot=(-0.24, 0.0, 0.0))

    # ------------------------------------------------------------------
    # 5. Rocco Overfenders, Wheel-Well Liners, Side Steps, Mudflaps & Open-Arch Rocco Sports Bar
    # ------------------------------------------------------------------
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_trapezoidal_flare(f"flare_F{tag}", sx, FRONT_AXLE, cab, TRIM)
        make_trapezoidal_flare(f"flare_R{tag}", sx, REAR_AXLE, bed, TRIM)

        # Dark upper wheel-well arch liners behind wheels (strictly above Z=0.38)
        for wy, wname in ((FRONT_AXLE, "F"), (REAR_AXLE, "R")):
            bm_ln = bmesh.new()
            r_ln = 0.485
            x_in, x_out = sx * 0.56, sx * 0.88
            n_ln = 14
            v_in, v_out = [], []
            for k in range(n_ln + 1):
                ang = lerp(-0.10, math.pi + 0.10, k / n_ln)
                py = wy + math.cos(ang) * r_ln
                pz = max(0.38, R_WHEEL + math.sin(ang) * r_ln)
                v_in.append(bm_ln.verts.new((x_in, py, pz)))
                v_out.append(bm_ln.verts.new((x_out, py, pz)))
            for k in range(n_ln):
                bm_ln.faces.new((v_in[k], v_in[k + 1], v_out[k + 1], v_out[k]))
            c_in = bm_ln.verts.new((x_in, wy, 0.40))
            for k in range(n_ln):
                bm_ln.faces.new((v_in[k + 1], v_in[k], c_in))
            make_mesh_from_bmesh(f"liner_{wname}{tag}", bm_ln, TRIM, smooth=True, angle=48.0)

        # Molded mudflaps behind all 4 tyres
        make_box(f"mudflap_F{tag}", (sx * 0.82, FRONT_AXLE - 0.52, 0.34), (0.26, 0.028, 0.24), TRIM, bevel=0.008)
        make_box(f"mudflap_R{tag}", (sx * 0.82, REAR_AXLE - 0.53, 0.35), (0.26, 0.028, 0.26), TRIM, bevel=0.008)

        # Side running boards / steps + clean rocker sill trim above step
        make_box(f"rocker_sill_{tag}", (sx * 0.885, 0.08, 0.468), (0.070, 1.78, 0.046), TRIM, bevel=0.010)
        make_box(f"side_step_{tag}", (sx * 0.915, 0.06, 0.385), (0.165, 1.72, 0.048), TRIM, bevel=0.012)
        make_box(f"side_step_trim_{tag}", (sx * 0.975, 0.06, 0.385), (0.045, 1.64, 0.036), GUNMETAL, bevel=0.008)
        for sy in (0.68, 0.06, -0.54):
            make_bar(f"step_brkt_{tag}_{sy}", (sx * 0.45, sy, 0.38), (sx * 0.86, sy, 0.385), 0.018, TRIM, verts=8)

        # Authentic Open-Arch Rocco Sports Bar (front pillar + swept rear diagonal aero brace!)
        # Front vertical/tumbled hoop post
        make_bar(f"sports_post_{tag}", (sx * 0.835, -0.92, 1.255), (sx * 0.725, -1.02, 1.815), 0.042, TRIM, verts=12)
        # Swept rear diagonal aero brace + brushed gunmetal accent bar
        make_bar(f"sports_brace_{tag}", (sx * 0.725, -1.02, 1.815), (sx * 0.835, -1.66, 1.255), 0.046, TRIM, verts=12)
        make_bar(f"sports_accent_{tag}", (sx * 0.750, -1.06, 1.795), (sx * 0.855, -1.60, 1.285), 0.022, GUNMETAL, verts=8)
        # Bed-rail base mounting plinth
        make_box(f"sports_base_{tag}", (sx * 0.835, -1.29, 1.275), (0.115, 0.86, 0.048), TRIM, bevel=0.014)

    # Sports bar upper aero arch hoop + rear window cab-guard crossbars
    make_bar("sports_bar_top", (-0.725, -1.02, 1.815), (0.725, -1.02, 1.815), 0.042, TRIM, verts=14)
    make_bar("sports_bar_guard_hi", (-0.74, -0.93, 1.63), (0.74, -0.93, 1.63), 0.020, TRIM, verts=10)
    make_bar("sports_bar_guard_lo", (-0.78, -0.93, 1.44), (0.78, -0.93, 1.44), 0.020, TRIM, verts=10)

    # ------------------------------------------------------------------
    # 6. Rear End: Revo Facelift Vertical C-Signature LED Tail Lamps, Tailgate, Stepped Bumper
    # ------------------------------------------------------------------
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        tx = sx * 0.845
        ty = -2.412
        yaw = sx * 0.22
        make_box(f"tail_housing_{tag}", (tx, ty, 1.032), (0.145, 0.095, 0.365), TRIM, bevel=0.018, rot=(0.0, 0.0, yaw))
        # Signature Revo C/bracket LED tail lamp (3 joined single-material BRAKE parts)
        c_parts = [
            make_box(f"b_v_{tag}", (tx + sx * 0.035, ty - 0.018, 1.102), (0.036, 0.060, 0.190), BRAKE, bevel=0.006, rot=(0.0, 0.0, yaw)),
            make_box(f"b_t_{tag}", (tx + sx * 0.004, ty - 0.024, 1.178), (0.105, 0.055, 0.036), BRAKE, bevel=0.006, rot=(0.0, 0.0, yaw)),
            make_box(f"b_b_{tag}", (tx + sx * 0.004, ty - 0.024, 1.026), (0.105, 0.055, 0.036), BRAKE, bevel=0.006, rot=(0.0, 0.0, yaw)),
        ]
        join_objects(c_parts, f"brake_{tag}")
        make_box(f"tail_rev_{tag}", (tx - sx * 0.010, ty - 0.024, 1.102), (0.056, 0.048, 0.088), LENS, bevel=0.005, rot=(0.0, 0.0, yaw))
        make_box(f"hazard_r{tag}", (tx + sx * 0.006, ty - 0.020, 0.915), (0.104, 0.055, 0.068), AMBER, bevel=0.006, rot=(0.0, 0.0, yaw))

    # Tailgate handle, 3-oval Toyota emblem, lower character trim & corner badges
    make_box("tailgate_handle_cup", (0.0, -2.452, 1.155), (0.21, 0.024, 0.075), TRIM, bevel=0.008)
    make_box("tailgate_handle", (0.0, -2.464, 1.158), (0.16, 0.024, 0.032), CHROME, bevel=0.006)
    build_toyota_emblem("badge_r", -2.456, 0.99, math.pi, 0.72, TRIM, CHROME)
    make_box("tailgate_badge_L", (-0.64, -2.446, 0.80), (0.18, 0.012, 0.026), CHROME)
    make_box("tailgate_badge_R", (0.64, -2.446, 0.80), (0.15, 0.012, 0.026), CHROME)

    # Two-Tone Stepped Rear Bumper
    for sx in (-1.0, 1.0):
        make_box(f"bumper_r_wing_{sx}", (sx * 0.62, -2.43, 0.59), (0.58, 0.16, 0.155), GUNMETAL, bevel=0.024, rot=(0.0, 0.0, sx * 0.10))
        make_box(f"bumper_r_pad_{sx}", (sx * 0.62, -2.445, 0.665), (0.52, 0.11, 0.024), TRIM, bevel=0.006, rot=(0.0, 0.0, sx * 0.10))
    make_box("bumper_r_center", (0.0, -2.455, 0.545), (0.72, 0.15, 0.115), TRIM, bevel=0.018)
    make_box("plate_r", (0.0, -2.478, 0.625), (0.40, 0.022, 0.105), PLATE, bevel=0.004)

    # Ladder Frame Chassis, Rear Solid Axle, Spare Tyre & Chrome Exhaust Tip
    for sx in (-1.0, 1.0):
        make_box(f"frame_rail_{sx}", (sx * 0.36, -0.10, 0.37), (0.08, 4.35, 0.11), TRIM, smooth=False)
    for cy in (1.75, 0.45, -0.60, -1.95):
        make_box(f"frame_cross_{cy}", (0.0, cy, 0.37), (0.72, 0.07, 0.08), TRIM, smooth=False)
    make_bar("rear_axle_tube", (-0.72, REAR_AXLE, 0.42), (0.72, REAR_AXLE, 0.42), 0.044, TRIM, verts=12)
    make_cyl("rear_diff", (0.0, REAR_AXLE, 0.42), 0.11, 0.16, TRIM, verts=14, rot=(0.0, 0.0, 0.0))
    make_cyl("spare_tyre", (0.0, -1.86, 0.37), 0.365, 0.21, TYRE, verts=18, rot=(0.0, 0.0, 0.0), bevel=0.03)
    make_bar("exhaust_pipe", (-0.34, -1.25, 0.36), (-0.68, -2.26, 0.39), 0.028, STEEL, verts=10)
    make_cyl("exhaust_tip", (-0.68, -2.38, 0.39), 0.044, 0.17, CHROME, verts=14, rot=(math.pi * 0.5, 0.0, 0.0), bevel=0.005)

    # ------------------------------------------------------------------
    # 7. Wheels (wheel_FL, wheel_FR, wheel_RL, wheel_RR)
    # ------------------------------------------------------------------
    for wname, wx, wy in (
        ("wheel_FL", -TRACK, FRONT_AXLE),
        ("wheel_FR", TRACK, FRONT_AXLE),
        ("wheel_RL", -TRACK, REAR_AXLE),
        ("wheel_RR", TRACK, REAR_AXLE),
    ):
        build_hilux_wheel(wname, wx, wy, TYRE, RIM, GUNMETAL, CHROME, STEEL)

    bpy.context.view_layer.update()


# ---------------------------------------------------------------------------
# Contract Verification & Export
# ---------------------------------------------------------------------------

def verify_contract():
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert all(o.parent is None for o in objs), "All meshes must be top-level scene children"

    names = {o.name: o for o in objs}
    for wn, expected in (
        ("wheel_FL", (-TRACK, FRONT_AXLE, R_WHEEL)),
        ("wheel_FR", (TRACK, FRONT_AXLE, R_WHEEL)),
        ("wheel_RL", (-TRACK, REAR_AXLE, R_WHEEL)),
        ("wheel_RR", (TRACK, REAR_AXLE, R_WHEEL)),
    ):
        assert wn in names, f"Missing wheel {wn}"
        loc = names[wn].location
        assert (loc - Vector(expected)).length < 1e-4, f"{wn} origin {loc} != {expected}"

    single_mat_lights = [
        "head_1_L", "head_1_R", "head_2_fog_L", "head_2_fog_R",
        "brake_L", "brake_R", "brake_hmsl",
        "hazard_fL", "hazard_fR", "hazard_mL", "hazard_mR", "hazard_rL", "hazard_rR",
    ]
    for ln in single_mat_lights:
        assert ln in names, f"Missing light object {ln}"
        assert len(names[ln].data.materials) == 1, f"Light {ln} must have exactly 1 material"

    head_active = [
        o.name for o in bpy.context.scene.objects
        if o.name.lower().startswith("head")
        and not o.name.lower().startswith(("head_bezel", "head_surround", "head_reflector"))
    ]
    assert head_active and head_active[0].startswith("head_1_"), f"Unexpected head order: {head_active}"
    assert "paint" in bpy.data.materials, "Missing 'paint' material"

    deps = bpy.context.evaluated_depsgraph_get()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    tri_count = 0
    for o in objs:
        eo = o.evaluated_get(deps)
        me = eo.to_mesh()
        me.calc_loop_triangles()
        tri_count += len(me.loop_triangles)
        for v in me.vertices:
            w = eo.matrix_world @ v.co
            mins.x = min(mins.x, w.x)
            mins.y = min(mins.y, w.y)
            mins.z = min(mins.z, w.z)
            maxs.x = max(maxs.x, w.x)
            maxs.y = max(maxs.y, w.y)
            maxs.z = max(maxs.z, w.z)
        eo.to_mesh_clear()

    print(
        f"VERIFIED: {len(objs)} meshes, {tri_count} tris | "
        f"X:[{mins.x:.3f}, {maxs.x:.3f}] Y:[{mins.y:.3f}, {maxs.y:.3f}] Z:[{mins.z:.3f}, {maxs.z:.3f}]"
    )
    assert abs(mins.z) < 0.01, f"Tyres must rest on Z=0, got Z_min={mins.z:.4f}"


def export_outputs(args):
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )
    size_kb = os.path.getsize(args.out) / 1024.0
    print(f"WROTE_GLB: {args.out} ({size_kb:.1f} kB)")

    if args.blend:
        os.makedirs(os.path.dirname(args.blend), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
        print(f"WROTE_BLEND: {args.blend}")


# ---------------------------------------------------------------------------
# Studio Verification Renders (Executed ONLY after .glb/.blend export)
# ---------------------------------------------------------------------------

def render_previews(render_dir):
    os.makedirs(render_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"

    world = bpy.data.worlds.new("StudioWorld")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.045, 0.052, 0.068, 1.0)
    bg.inputs["Strength"].default_value = 0.85

    bpy.ops.mesh.primitive_plane_add(size=24.0, location=(0.0, 0.0, 0.0))
    floor = bpy.context.active_object
    floor.data.materials.append(make_mat("studio_floor", "#2c313a", rough=0.62, metal=0.05))

    for mat_name, col, strength in (
        ("head", (1.0, 0.98, 0.90, 1.0), 3.0),
        ("brake", (1.0, 0.10, 0.08, 1.0), 2.5),
        ("hazard", (1.0, 0.55, 0.05, 1.0), 1.8),
    ):
        m = bpy.data.materials.get(mat_name)
        if m and m.node_tree:
            bsdf = m.node_tree.nodes.get("Principled BSDF")
            if bsdf and "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = col
                bsdf.inputs["Emission Strength"].default_value = strength

    def add_area(name, loc, target, energy, size, color=(1.0, 1.0, 1.0)):
        ldata = bpy.data.lights.new(name, type="AREA")
        ldata.energy = energy
        ldata.size = size
        ldata.color = color
        lobj = link_obj(bpy.data.objects.new(name, ldata))
        lobj.location = loc
        direction = Vector(target) - Vector(loc)
        lobj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    add_area("Key", (5.5, 5.0, 4.6), (0.0, 0.0, 0.85), 950.0, 4.0, (1.0, 0.96, 0.90))
    add_area("Fill", (-5.5, 3.8, 2.8), (0.0, 0.0, 0.85), 420.0, 5.0, (0.82, 0.90, 1.0))
    add_area("Rim", (-3.5, -5.5, 3.8), (0.0, 0.0, 0.95), 720.0, 3.8, (0.92, 0.96, 1.0))
    add_area("TopSoft", (0.0, 0.2, 6.2), (0.0, 0.0, 0.90), 480.0, 6.0, (1.0, 1.0, 1.0))

    cam_data = bpy.data.cameras.new("StudioCam")
    cam_obj = link_obj(bpy.data.objects.new("StudioCam", cam_data))
    scene.camera = cam_obj

    views = [
        ("front_34.png", (4.35, 5.20, 1.85), (0.0, 0.15, 0.88), 42.0),
        ("rear_34.png", (-4.35, -5.15, 1.92), (0.0, -0.20, 0.90), 42.0),
        ("side.png", (8.10, 0.0, 1.05), (0.0, 0.0, 0.95), 48.0),
        ("front.png", (0.0, 6.10, 1.08), (0.0, 0.50, 0.92), 52.0),
    ]
    for fname, loc, target, lens in views:
        cam_data.lens = lens
        cam_obj.location = loc
        cam_obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(render_dir, fname)
        bpy.ops.render.render(write_still=True)
        print(f"RENDERED: {scene.render.filepath}")


def main():
    args = parse_args()
    reset_scene()
    build_hilux_revo()
    verify_contract()
    export_outputs(args)
    if args.render:
        render_previews(args.render)


if __name__ == "__main__":
    main()
