"""Sazgar Royal Deluxe 200cc 4-Stroke Auto-Rickshaw
procedural 3D vehicle builder for Blender 5.3+ CLI & Python.

Exports:
  - public/models/rickshaw.glb (game-ready GLB conforming to VehicleFactory.ts)
  - Optional .blend project file (--blend)
  - Optional Cycles studio verification PNG renders (--render)

Game contract (match src/render/VehicleFactory.ts, src/render/TyreFx.ts,
src/render/Renderer.ts, src/render/GarageScene.ts, and src/sim/PlayerCar.ts):
  - Blender +Y = vehicle front -> glTF/Three.js -Z; +X = right; +Z = up; metres.
  - Tyres rest flush on Z = 0; wheel radius 0.24 m, tyre width 0.135 m.
  - Top-level objects only (obj.parent is None):
      * wheel_F  at ( 0.00,  1.17, 0.24)
      * wheel_RL at (-0.60, -0.82, 0.24)
      * wheel_RR at (+0.60, -0.82, 0.24)
      * head_1_main (single material, created FIRST ahead of fog lamps)
      * head_2_fog_L, head_2_fog_R (single material)
      * brake_L, brake_R (single material)
      * hazard_fL, hazard_fR, hazard_rL, hazard_rR (single material)
  - Dynamic livery materials: "paint", "canopy", "curtain", "trim_stripe".
  - Driver clearance around (0, +0.32, +0.91..+1.83); left-rear exhaust tip at (-0.28, -1.38, 0.25).

Usage:
  blender --background --factory-startup --python-exit-code 1 --python tools/blender/rickshaw.py -- \\
      --out public/models/rickshaw.glb --blend tools/blender/sazgar_royal_deluxe_200cc.blend
"""

import argparse
import math
import os
import sys

import bpy  # must precede bmesh / mathutils
import bmesh
from mathutils import Vector


# ---------------------------------------------------------------------------
# Key Dimensions (metres, Blender Z-up, +Y forward)
# ---------------------------------------------------------------------------

HW = 0.615            # main rear body half-width
FRONT_AXLE = 1.17
REAR_AXLE = -0.82
TRACK_REAR = 0.60
R_WHEEL = 0.24
TYRE_W = 0.135
ROOF_CROWN_Z = 1.905


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
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "models", "rickshaw.glb")
    )
    if len(argv) == 1 and argv[0].endswith(".glb") and not argv[0].startswith("-"):
        return argparse.Namespace(out=os.path.abspath(argv[0]), blend=None, render=None)

    parser = argparse.ArgumentParser(description="Build Sazgar Royal Deluxe 200cc 3D model")
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


def shade_angle(obj, deg=36.0):
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


def make_box(name, loc, size, material, bevel=0.0, rot=(0.0, 0.0, 0.0), segments=1, smooth=True, angle=40.0):
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
    if bevel > 0 or smooth:
        shade_angle(o, angle)
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


def make_tube_path(name, pts, radius, material, radial_segs=10, closed=False, cap_ends=True):
    """Sweep a circular cross-section smoothly along a 3D polyline using parallel transport."""
    vecs = [Vector(p) for p in pts]
    n_pts = len(vecs)
    if n_pts < 2:
        raise ValueError(f"Tube {name} needs >= 2 points")

    tangents = []
    for i in range(n_pts):
        if closed:
            t = vecs[(i + 1) % n_pts] - vecs[(i - 1) % n_pts]
        elif i == 0:
            t = vecs[1] - vecs[0]
        elif i == n_pts - 1:
            t = vecs[-1] - vecs[-2]
        else:
            t = vecs[i + 1] - vecs[i - 1]
        tangents.append(t.normalized())

    up = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(up)) > 0.92:
        up = Vector((1.0, 0.0, 0.0))
    u_vec = tangents[0].cross(up).normalized()
    v_vec = tangents[0].cross(u_vec).normalized()

    bm = bmesh.new()
    rings = []
    for i in range(n_pts):
        t = tangents[i]
        if i > 0:
            rot = tangents[i - 1].rotation_difference(t)
            u_vec = (rot @ u_vec).normalized()
            v_vec = t.cross(u_vec).normalized()
        ring = []
        for s in range(radial_segs):
            ang = s * 2.0 * math.pi / radial_segs
            offset = (u_vec * math.cos(ang) + v_vec * math.sin(ang)) * radius
            ring.append(bm.verts.new(vecs[i] + offset))
        rings.append(ring)

    ring_pairs = range(n_pts) if closed else range(n_pts - 1)
    for i in ring_pairs:
        a = rings[i]
        b = rings[(i + 1) % n_pts]
        for s in range(radial_segs):
            s2 = (s + 1) % radial_segs
            bm.faces.new((a[s], a[s2], b[s2], b[s]))

    if not closed and cap_ends:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])

    return make_mesh_from_bmesh(name, bm, material, smooth=True, angle=50.0)


def make_mesh_from_bmesh(name, bm, material, smooth=True, angle=36.0):
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


def build_loft(name, stations, section_fn, material, y_warp_fn=None, angle=33.0):
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
# Parametric Wheel Arch, Front Cowl, Rear Body & Canopy Profiles
# ---------------------------------------------------------------------------

def arch_profile_yz(y_center, r_arch=0.312, z_center=R_WHEEL, z_bot=0.25, n_arc=18):
    """Clean semicircular rear wheel arch profile in (Y, Z) centered on rear hub."""
    dy_bot = math.sqrt(max(0.01, r_arch * r_arch - max(0.0, z_center - z_bot) ** 2))
    ang0 = math.atan2(z_bot - z_center, -dy_bot)
    ang1 = math.atan2(z_bot - z_center, dy_bot)
    # Sweep clockwise from rear-bottom through top (pi/2) to front-bottom
    pts = []
    for i in range(n_arc + 1):
        t = i / n_arc
        ang = lerp(math.pi - abs(ang0 - math.pi), ang1, t)
        pts.append((y_center + math.cos(ang) * r_arch, z_center + math.sin(ang) * r_arch))
    return pts


def make_rear_arch_cutter(name, sx, y_center):
    """Cutter spanning outer wheel well |X| in [0.485, 0.85] so inner engine bay stays solid."""
    prof = arch_profile_yz(y_center, r_arch=0.312, z_center=R_WHEEL, z_bot=0.24, n_arc=18)
    loop_yz = prof + [(y_center + 0.34, 0.14), (y_center - 0.34, 0.14)]
    x_in = sx * 0.485
    x_out = sx * 0.850
    x_lo, x_hi = min(x_in, x_out), max(x_in, x_out)

    bm = bmesh.new()
    v_lo = [bm.verts.new((x_lo, y, z)) for y, z in loop_yz]
    v_hi = [bm.verts.new((x_hi, y, z)) for y, z in loop_yz]
    m = len(loop_yz)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((v_lo[i], v_lo[j], v_hi[j], v_hi[i]))
    bm.faces.new(list(reversed(v_lo)))
    bm.faces.new(v_hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link_obj(bpy.data.objects.new(name, me))


def make_cabin_cutter(name):
    """Carve hollow passenger interior out of rear_body leaving rear engine bay & side walls."""
    # Y from -0.90 (rear backrest bulkhead) through -0.02 (well clear of front face Y=-0.14)
    # Z from 0.355 (above floor) up to 1.06 (clears top rail Z=0.97)
    bm = bmesh.new()
    # Slight tapered cabin width to match subtle rear taper
    pts_y = (-0.90, -0.70, -0.42, -0.02)
    rings = []
    for y in pts_y:
        t = smoothstep(-0.90, -0.60, y)
        xh = lerp(0.515, 0.530, t)
        # Slope bottom slightly up behind rear axle? No, Z=0.355 gives clean 1.5 cm floor pan
        sec = [(-xh, 0.355), (xh, 0.355), (xh, 1.06), (-xh, 1.06)]
        rings.append([bm.verts.new((x, y, z)) for x, z in sec])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link_obj(bpy.data.objects.new(name, me))


# ---------------------------------------------------------------------------
# Sculpted Body Sections
# ---------------------------------------------------------------------------

def ray_project_strip(target_obj, name, pts_yz, width_z, axis, material, lift=0.006):
    """Project a crisp thin horizontal trim/stripe band onto target_obj along +X or -X."""
    bpy.context.view_layer.update()
    ray_dirs = {"-x": Vector((-1.0, 0.0, 0.0)), "+x": Vector((1.0, 0.0, 0.0))}
    ray_dir = ray_dirs[axis]
    probe_x = 1.5 if axis == "-x" else -1.5
    fallback_x = 0.58 * (1.0 if axis == "-x" else -1.0)
    bm = bmesh.new()
    top_v, bot_v = [], []
    hw = width_z * 0.5
    for y_pt, z_pt in pts_yz:
        for z_off, arr in ((-hw, bot_v), (hw, top_v)):
            orig = Vector((probe_x, y_pt, z_pt + z_off))
            ok, loc, nrm, _ = target_obj.ray_cast(orig, ray_dir)
            if not ok:
                _, loc, nrm, _ = target_obj.closest_point_on_mesh(Vector((fallback_x, y_pt, z_pt + z_off)))
            arr.append(bm.verts.new(loc + nrm.normalized() * lift))
    for i in range(len(pts_yz) - 1):
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


def front_cowl_hw(y):
    pts = [
        (0.86, 0.578),
        (0.95, 0.562),
        (1.06, 0.512),
        (1.15, 0.425),
        (1.21, 0.312),
        (1.245, 0.195),
    ]
    return interp(pts, y)


def front_cowl_y_warp(x, y, z):
    if y <= 0.90:
        return 0.0
    t = smoothstep(0.90, 1.245, y)
    nx = min(1.0, abs(x) / max(0.18, front_cowl_hw(y)))
    bow = 0.042 * t * math.cos(nx * math.pi * 0.5)
    waist_lean = 0.014 * t * math.exp(-((z - 0.88) / 0.15) ** 2)
    chin_tuck = -0.018 * t * smoothstep(0.70, 0.57, z)
    return bow + waist_lean + chin_tuck


def front_cowl_section(y, n=48):
    """Continuous half cross-section for Sazgar cab nose shield (clears front mudguard smoothly)."""
    TOP = [
        (0.86, 1.072), (0.94, 1.068), (1.04, 1.052), (1.14, 1.022), (1.21, 0.985), (1.245, 0.942),
    ]
    BOT_SIDE = [
        (0.86, 0.355), (0.94, 0.380), (1.05, 0.445), (1.16, 0.530), (1.245, 0.592),
    ]
    BOT_CTR = [
        (0.86, 0.455), (0.95, 0.540), (1.06, 0.585), (1.16, 0.595), (1.245, 0.602),
    ]
    zt = interp(TOP, y)
    zb_side = interp(BOT_SIDE, y)
    zb_ctr = interp(BOT_CTR, y)
    hw = front_cowl_hw(y)
    waist_z = lerp(0.91, 0.87, smoothstep(0.86, 1.245, y))
    crease_out = 0.012 * smoothstep(1.24, 0.96, y)
    x_arch = min(hw * 0.68, 0.24)

    pts = [
        (0.0, zb_ctr),
        (x_arch * 0.52, lerp(zb_ctr, zb_side, 0.22)),
        (x_arch, lerp(zb_ctr, zb_side, 0.72)),
        (max(x_arch + 0.03, hw - 0.055), zb_side),
        (hw - 0.015, zb_side + 0.035),
        (hw, lerp(zb_side, waist_z, 0.48)),
        (hw + crease_out, waist_z),
        (hw - 0.028, lerp(waist_z, zt, 0.65)),
        (hw - 0.075, zt - 0.012),
        (max(0.0, hw - 0.14), zt),
        (0.0, zt + 0.010),
    ]
    return resample_xz(pts, n)


def rear_body_hw(y):
    w = HW
    # Subtle fender haunch swell around rear axle Y=-0.82
    w += 0.014 * math.exp(-((y - REAR_AXLE) / 0.28) ** 2)
    # Taper tail cleanly at very back
    if y < -1.10:
        t = (-1.10 - y) / 0.25
        w -= 0.062 * (t ** 1.6)
    return w


def rear_body_y_warp(x, y, z):
    # Subtle rearward bow on tail & slanted passenger doorway edge at front
    if y < -1.16:
        t = smoothstep(-1.16, -1.35, y)
        nx = min(1.0, abs(x) / max(0.30, rear_body_hw(y)))
        return -0.026 * t * math.cos(nx * math.pi * 0.5)
    if y > -0.26:
        # Slant upper passenger doorway edge rearward (-0.06 m at top rail)
        t = smoothstep(-0.26, -0.14, y)
        return -0.065 * t * smoothstep(0.42, 0.96, z)
    return 0.0


def rear_body_section(y, n=36):
    TOP = [(-1.35, 0.955), (-1.20, 0.972), (-0.82, 0.975), (-0.14, 0.968)]
    BOT = [(-1.35, 0.375), (-1.22, 0.345), (-0.82, 0.340), (-0.14, 0.340)]
    zt = interp(TOP, y)
    zb = interp(BOT, y)
    hw = rear_body_hw(y)
    # Shoulder crease & soft tumblehome near top rail
    mid_z = lerp(zb, zt, 0.62)
    pts = [
        (0.0, zb),
        (hw - 0.085, zb),
        (hw - 0.020, zb + 0.032),
        (hw, lerp(zb, mid_z, 0.45)),
        (hw + 0.006, mid_z),
        (hw - 0.010, lerp(mid_z, zt, 0.62)),
        (hw - 0.035, zt - 0.014),
        (hw - 0.075, zt),
        (0.0, zt + 0.004),
    ]
    return resample_xz(pts, n)


def build_cowl_cheeks(paint_mat):
    """Build sculpted left & right leg-shield side skirts sweeping from cowl back to floorboard."""
    objs = []
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        bm = bmesh.new()
        stations_y = [0.89, 0.80, 0.70, 0.60, 0.52, 0.46]
        rings = []
        for y in stations_y:
            t = smoothstep(0.89, 0.46, y)
            x_out = lerp(0.578, 0.570, t)
            x_in = lerp(0.525, 0.522, t)
            zt = lerp(1.068, 0.72, t ** 1.35)
            zb = 0.345
            # Curved outer skin + clean thickness inner wall
            sec = [
                (sx * x_in, zb),
                (sx * (x_out - 0.015), zb),
                (sx * x_out, lerp(zb, zt, 0.45)),
                (sx * (x_out + 0.008), lerp(zb, zt, 0.76)),
                (sx * (x_out - 0.018), zt),
                (sx * x_in, zt - 0.008),
            ]
            if sx < 0:
                sec = list(reversed(sec))
            rings.append([bm.verts.new((x, y, z)) for x, z in sec])

        m = len(rings[0])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(m):
                k2 = (k + 1) % m
                bm.faces.new((a[k], a[k2], b[k2], b[k]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        objs.append(make_mesh_from_bmesh(f"cowl_cheek_{tag}", bm, paint_mat, smooth=True, angle=34.0))
    return objs


def make_rear_flare(name, sx, y_center, body_obj, material):
    """Sweep clean arched fender lip hugging the circular rear wheel cutout."""
    bpy.context.view_layer.update()
    prof = arch_profile_yz(y_center, r_arch=0.312, z_center=R_WHEEL, z_bot=0.29, n_arc=18)
    center = Vector((0.0, y_center, R_WHEEL))

    sec = [
        (-0.022, 0.000),
        (-0.022, 0.044),
        (0.016, 0.046),
        (0.036, 0.034),
        (0.038, 0.014),
        (0.024, 0.000),
        (0.002, -0.006),
    ]

    bm = bmesh.new()
    rings = []
    for py, pz in prof:
        rad = Vector((0.0, py - center.y, pz - center.z)).normalized()
        probe = Vector((0.0, py, pz)) + rad * 0.024
        ok, loc, _, _ = body_obj.ray_cast(
            Vector((sx * 1.4, probe.y, max(0.36, probe.z))),
            Vector((-sx, 0.0, 0.0)),
        )
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
# Curved Windscreen, Canopy Roof, Rear Curtain & Piping
# ---------------------------------------------------------------------------

def windscreen_pt(u, v):
    """Parametric curved windscreen surface: u in [-1, 1] (X), v in [0, 1] (bottom -> top)."""
    hw_bot = 0.455
    hw_top = 0.440
    hw = lerp(hw_bot, hw_top, v)
    x = u * hw
    z = lerp(1.068, 1.682, v)
    # Bow center smoothly forward relative to edges, raking back gently with height
    y_base = lerp(1.032, 0.900, v)
    bow = 0.052 * (1.0 - u * u) * lerp(1.0, 0.72, v)
    y = y_base + bow
    return Vector((x, y, z))


def build_windscreen_and_pillars(paint_mat, glass_mat, trim_mat, chrome_mat):
    # 1. Curved laminated windscreen glass
    nu, nv = 12, 5
    bm = bmesh.new()
    v_out, v_in = [], []
    for iv in range(nv + 1):
        v = iv / nv
        row_o, row_i = [], []
        for iu in range(nu + 1):
            u = lerp(-1.0, 1.0, iu / nu)
            p = windscreen_pt(u, v)
            # Approximate outward surface normal (+Y forward, +Z up)
            pu = windscreen_pt(min(1.0, u + 0.02), v) - windscreen_pt(max(-1.0, u - 0.02), v)
            pv = windscreen_pt(u, min(1.0, v + 0.02)) - windscreen_pt(u, max(0.0, v - 0.02))
            nrm = pu.cross(pv).normalized()
            if nrm.y < 0:
                nrm = -nrm
            row_o.append(bm.verts.new(p + nrm * 0.006))
            row_i.append(bm.verts.new(p - nrm * 0.006))
        v_out.append(row_o)
        v_in.append(row_i)

    for iv in range(nv):
        for iu in range(nu):
            bm.faces.new((v_out[iv][iu], v_out[iv][iu + 1], v_out[iv + 1][iu + 1], v_out[iv + 1][iu]))
            bm.faces.new((v_in[iv][iu + 1], v_in[iv][iu], v_in[iv + 1][iu], v_in[iv + 1][iu + 1]))
    for iu in range(nu):
        bm.faces.new((v_in[0][iu], v_in[0][iu + 1], v_out[0][iu + 1], v_out[0][iu]))
        bm.faces.new((v_out[-1][iu], v_out[-1][iu + 1], v_in[-1][iu + 1], v_in[-1][iu]))
    for iv in range(nv):
        bm.faces.new((v_out[iv][0], v_out[iv + 1][0], v_in[iv + 1][0], v_in[iv][0]))
        bm.faces.new((v_in[iv][-1], v_in[iv + 1][-1], v_out[iv + 1][-1], v_out[iv][-1]))
    make_mesh_from_bmesh("windscreen", bm, glass_mat, smooth=True, angle=45.0)

    # 2. Black rubber windscreen perimeter gasket
    g_pts_b = [windscreen_pt(lerp(-1.0, 1.0, i / 12), 0.0) for i in range(13)]
    g_pts_r = [windscreen_pt(1.0, lerp(0.0, 1.0, i / 6)) for i in range(1, 7)]
    g_pts_t = [windscreen_pt(lerp(1.0, -1.0, i / 12), 1.0) for i in range(1, 13)]
    g_pts_l = [windscreen_pt(-1.0, lerp(1.0, 0.0, i / 6)) for i in range(1, 6)]
    make_tube_path("screen_gasket", g_pts_b + g_pts_r + g_pts_t + g_pts_l, 0.015, trim_mat, radial_segs=8, closed=True)

    # 3. Painted A-pillars wrapping cleanly from cowl shoulder to roof brow
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        p_pts = []
        for iv in range(7):
            v = iv / 6.0
            edge = windscreen_pt(sx * 1.02, v)
            p_pts.append((edge.x + sx * 0.032, edge.y - 0.008, edge.z))
        # Extend bottom cleanly into cowl and top cleanly into header
        p_pts[0] = (p_pts[0][0] + sx * 0.012, p_pts[0][1] - 0.015, 1.020)
        p_pts[-1] = (p_pts[-1][0] - sx * 0.004, p_pts[-1][1] - 0.008, 1.725)
        make_tube_path(f"a_pillar_{tag}", p_pts, 0.034, paint_mat, radial_segs=10)

    # 4. Painted windscreen header + signature Sazgar curved sun visor brow
    bm_h = bmesh.new()
    rings_h = []
    for iu in range(13):
        u = lerp(-1.08, 1.08, iu / 12.0)
        top_e = windscreen_pt(max(-1.0, min(1.0, u)), 1.0)
        x = u * 0.48
        y0 = top_e.y - 0.025
        z0 = top_e.z - 0.015
        sec = [
            (x, y0 - 0.035, z0 + 0.008),
            (x, y0 + 0.045, z0 - 0.004),
            (x, y0 + 0.045, z0 + 0.072),
            (x, y0 - 0.040, z0 + 0.076),
        ]
        rings_h.append([bm_h.verts.new(p) for p in sec])
    for i in range(len(rings_h) - 1):
        a, b = rings_h[i], rings_h[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            bm_h.faces.new((a[k], a[k2], b[k2], b[k]))
    bm_h.faces.new(list(reversed(rings_h[0])))
    bm_h.faces.new(rings_h[-1])
    make_mesh_from_bmesh("screen_header", bm_h, paint_mat, smooth=True, angle=38.0)

    # Sun-visor brow jutting over upper windscreen edge
    bm_v = bmesh.new()
    rings_v = []
    for iu in range(13):
        u = lerp(-1.06, 1.06, iu / 12.0)
        top_e = windscreen_pt(max(-1.0, min(1.0, u)), 1.0)
        x = u * 0.485
        yb = top_e.y + 0.015
        zb = top_e.z + 0.052
        sec = [
            (x, yb, zb - 0.012),
            (x, yb + 0.135, zb - 0.034),
            (x, yb + 0.138, zb - 0.018),
            (x, yb + 0.005, zb + 0.010),
        ]
        rings_v.append([bm_v.verts.new(p) for p in sec])
    for i in range(len(rings_v) - 1):
        a, b = rings_v[i], rings_v[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            bm_v.faces.new((a[k], a[k2], b[k2], b[k]))
    bm_v.faces.new(list(reversed(rings_v[0])))
    bm_v.faces.new(rings_v[-1])
    make_mesh_from_bmesh("sun_visor", bm_v, paint_mat, smooth=True, angle=36.0)

    # 5. Articulated windshield wiper hugging curved windscreen
    pivot = windscreen_pt(0.0, 0.035)
    make_cyl("wiper_pivot", (pivot.x, pivot.y + 0.016, pivot.z), 0.016, 0.022, trim_mat, verts=10, rot=(math.pi * 0.5, 0.0, 0.0))
    arm_pts = []
    for i in range(5):
        t = i / 4.0
        p = windscreen_pt(lerp(0.0, 0.36, t), lerp(0.04, 0.38, t))
        arm_pts.append((p.x, p.y + 0.022, p.z))
    make_tube_path("wiper_arm", arm_pts, 0.006, trim_mat, radial_segs=6)
    blade_pts = []
    for i in range(5):
        t = i / 4.0
        p = windscreen_pt(lerp(0.18, 0.58, t), lerp(0.55, 0.24, t))
        blade_pts.append((p.x, p.y + 0.014, p.z))
    make_tube_path("wiper_blade", blade_pts, 0.007, trim_mat, radial_segs=6)

    # 6. Wing mirrors on curved stalks (|X| <= 0.675, well inside +/-0.70 limit)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        stalk_pts = [
            (sx * 0.495, 0.96, 1.18),
            (sx * 0.605, 0.94, 1.24),
            (sx * 0.625, 0.93, 1.32),
        ]
        make_tube_path(f"mirror_stalk_{tag}", stalk_pts, 0.010, trim_mat, radial_segs=8)
        make_box(
            f"mirror_housing_{tag}",
            (sx * 0.630, 0.92, 1.38),
            (0.036, 0.095, 0.138),
            trim_mat,
            bevel=0.012,
            rot=(0.0, 0.0, sx * -0.18),
        )
        make_box(
            f"mirror_glass_{tag}",
            (sx * 0.626, 0.875, 1.38),
            (0.008, 0.072, 0.114),
            chrome_mat,
            bevel=0.002,
            rot=(0.0, 0.0, sx * -0.18),
        )


def canopy_surface_z(x, y, nx):
    """Outer roof surface Z: keeps inner ceiling >= 1.855 over driver at Y=+0.32 while crown <= 1.905."""
    # Longitudinal crown profile (drops neatly forward of Y=0.56 to meet header Z=1.745)
    c_pts = [
        (-1.35, 1.860),
        (-1.20, 1.895),
        (-0.85, ROOF_CROWN_Z),
        (0.00, ROOF_CROWN_Z),
        (0.45, ROOF_CROWN_Z),
        (0.62, 1.882),
        (0.78, 1.825),
        (0.92, 1.752),
    ]
    z_crown = interp(c_pts, y)
    # Transverse arch drop down to eave shoulder (1.765 at sides)
    eave_z = lerp(1.762, 1.715, smoothstep(0.60, 0.92, y))
    # Subtle rib ridges over internal frame bows
    rib = 0.0
    for ry in (-1.22, -0.72, -0.18, 0.36):
        rib += 0.007 * math.exp(-((y - ry) / 0.045) ** 2)
    arch = z_crown - (z_crown - eave_z) * (nx ** 2.15)
    return arch + rib * (1.0 - 0.5 * nx * nx)


def canopy_eave_xy(y):
    t_f = smoothstep(0.55, 0.92, y)
    t_r = smoothstep(-1.12, -1.35, y)
    hw = 0.648 - 0.135 * t_f - 0.042 * t_r
    z_base = lerp(1.695, 1.710, t_f)
    return hw, z_base


def build_canopy_and_curtains(canopy_mat, curtain_mat, stripe_mat, glass_mat, trim_mat, chrome_mat):
    # 1. Arched manifold canopy roof with drooping vinyl eave valances
    stations_y = [
        -1.35, -1.28, -1.22, -1.16, -1.00, -0.78, -0.72, -0.66,
        -0.42, -0.24, -0.18, -0.12, 0.14, 0.30, 0.36, 0.42, 0.58, 0.74, 0.86, 0.92,
    ]

    def canopy_sec(y):
        t_front = smoothstep(0.55, 0.92, y)
        t_rear = smoothstep(-1.12, -1.35, y)
        hw = 0.642 - 0.135 * t_front - 0.042 * t_rear
        eave_drop = lerp(1.695, 1.710, t_front)
        pts = []
        n_top = 12
        for i in range(n_top + 1):
            nx = i / n_top
            x = nx * hw
            pts.append((x, canopy_surface_z(x, y, nx)))
        pts.append((hw + 0.008, eave_drop + 0.025))
        pts.append((hw + 0.006, eave_drop))
        pts.append((hw - 0.016, eave_drop))
        pts.append((hw - 0.020, eave_drop + 0.036))
        for i in range(n_top, -1, -1):
            nx = i / n_top
            x = max(0.0, nx * (hw - 0.024))
            z_in = canopy_surface_z(x, y, nx) - 0.042
            if i == n_top:
                z_in = max(z_in, eave_drop + 0.042)
            pts.append((x, z_in))
        return pts

    def canopy_ywarp(x, y, z):
        if y > 0.72:
            t = smoothstep(0.72, 0.92, y)
            nx = min(1.0, abs(x) / 0.50)
            return 0.045 * t * math.cos(nx * math.pi * 0.5)
        if y < -1.16:
            t = smoothstep(-1.16, -1.35, y)
            nx = min(1.0, abs(x) / 0.58)
            return -0.025 * t * math.cos(nx * math.pi * 0.5)
        return 0.0

    build_loft("canopy_roof", stations_y, canopy_sec, canopy_mat, y_warp_fn=canopy_ywarp, angle=42.0)

    # 2. Smooth perimeter striped piping hugging canopy eave edge (dense corner sampling)
    for z_off in (0.012, 0.032):
        pipe_pts = []
        # Left side back -> front
        for y in (-1.30, -1.16, -0.92, -0.64, -0.32, 0.0, 0.32, 0.58, 0.76, 0.88):
            hw, zb = canopy_eave_xy(y)
            pipe_pts.append((-hw, y, zb + z_off))
        # Front rounded corner + bow wrap
        for i in range(9):
            u = lerp(-1.0, 1.0, i / 8.0)
            hw_f, zb_f = canopy_eave_xy(0.92)
            x = u * hw_f
            y = 0.92 + 0.046 * math.cos(u * math.pi * 0.5)
            pipe_pts.append((x, y, zb_f + z_off))
        # Right side front -> back
        for y in (0.88, 0.76, 0.58, 0.32, 0.0, -0.32, -0.64, -0.92, -1.16, -1.30):
            hw, zb = canopy_eave_xy(y)
            pipe_pts.append((hw, y, zb + z_off))
        # Rear rounded corner + bow wrap
        for i in range(9):
            u = lerp(1.0, -1.0, i / 8.0)
            hw_r, zb_r = canopy_eave_xy(-1.35)
            x = u * hw_r
            y = -1.35 - 0.026 * math.cos(u * math.pi * 0.5)
            pipe_pts.append((x, y, zb_r + z_off))
        make_tube_path(f"canopy_piping_{int(z_off * 1000)}", pipe_pts, 0.006, stripe_mat, radial_segs=6, closed=True)

    # 3. Seamless arched rear canopy panel meeting canopy_roof crown with open cutout window
    bm_cr = bmesh.new()
    y_ro = -1.348
    y_ri = -1.320
    win_x, win_zb, win_zt = 0.315, 1.155, 1.535
    out_pts = []
    in_pts = []
    for i in range(4):
        t = i / 4.0
        out_pts.append((lerp(-0.575, 0.575, t), 0.955))
        in_pts.append((lerp(-win_x, win_x, t), win_zb))
    for i in range(4):
        t = i / 4.0
        out_pts.append((lerp(0.575, 0.598, t), lerp(0.955, 1.735, t)))
        in_pts.append((win_x, lerp(win_zb, win_zt, t)))
    for i in range(4):
        t = i / 4.0
        u = lerp(1.0, -1.0, t)
        x = u * 0.598
        out_pts.append((x, canopy_surface_z(x, -1.35, abs(u)) - 0.004))
        in_pts.append((lerp(win_x, -win_x, t), win_zt))
    for i in range(4):
        t = i / 4.0
        out_pts.append((lerp(-0.598, -0.575, t), lerp(1.735, 0.955, t)))
        in_pts.append((-win_x, lerp(win_zt, win_zb, t)))

    m_cr = len(out_pts)
    vo_out = [bm_cr.verts.new((x, y_ro - 0.025 * math.cos(min(1.0, abs(x) / 0.60) * math.pi * 0.5), z)) for x, z in out_pts]
    vi_out = [bm_cr.verts.new((x, y_ro - 0.025 * math.cos(min(1.0, abs(x) / 0.60) * math.pi * 0.5), z)) for x, z in in_pts]
    vo_in = [bm_cr.verts.new((x, y_ri - 0.025 * math.cos(min(1.0, abs(x) / 0.60) * math.pi * 0.5), z)) for x, z in out_pts]
    vi_in = [bm_cr.verts.new((x, y_ri - 0.025 * math.cos(min(1.0, abs(x) / 0.60) * math.pi * 0.5), z)) for x, z in in_pts]

    for i in range(m_cr):
        j = (i + 1) % m_cr
        bm_cr.faces.new((vi_out[i], vi_out[j], vo_out[j], vo_out[i]))
        bm_cr.faces.new((vo_in[i], vo_in[j], vi_in[j], vi_in[i]))
        bm_cr.faces.new((vo_out[i], vo_out[j], vo_in[j], vo_in[i]))
        bm_cr.faces.new((vi_in[i], vi_in[j], vi_out[j], vi_out[i]))
    make_mesh_from_bmesh("canopy_rear", bm_cr, canopy_mat, smooth=True, angle=36.0)

    # Rear window gasket frame + glass pane cleanly recessed inside cutout
    win_loop = [
        (-win_x, y_ro - 0.017, win_zb),
        (0.0, y_ro - 0.025, win_zb),
        (win_x, y_ro - 0.017, win_zb),
        (win_x, y_ro - 0.017, win_zt),
        (0.0, y_ro - 0.025, win_zt),
        (-win_x, y_ro - 0.017, win_zt),
    ]
    make_tube_path("rear_win_frame", win_loop, 0.014, trim_mat, radial_segs=6, closed=True)
    make_box("rear_win_glass", (0.0, y_ro - 0.008, (win_zb + win_zt) * 0.5), (win_x * 1.98, 0.010, win_zt - win_zb), glass_mat, bevel=0.001)

    # 4. Rear-quarter weather curtains + rolled-up doorway rain curtains (curtain material)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        bm_c = bmesh.new()
        y_vals = [-1.345, -1.12, -0.89, -0.66]
        z_vals = [0.955, 1.21, 1.47, 1.715]
        grid_o, grid_i = [], []
        for y in y_vals:
            row_o, row_i = [], []
            t_r = smoothstep(-1.12, -1.35, y)
            x_base = 0.606 - 0.036 * t_r
            for z in z_vals:
                t_z = smoothstep(0.955, 1.715, z)
                tuck = -0.010 * math.sin(t_z * math.pi)
                x_cur = x_base + tuck + 0.016 * t_z
                row_o.append(bm_c.verts.new((sx * x_cur, y, z)))
                row_i.append(bm_c.verts.new((sx * (x_cur - 0.016), y, z)))
            grid_o.append(row_o)
            grid_i.append(row_i)
        ny, nz = len(y_vals) - 1, len(z_vals) - 1
        for iy in range(ny):
            for iz in range(nz):
                if sx > 0:
                    bm_c.faces.new((grid_o[iy][iz], grid_o[iy + 1][iz], grid_o[iy + 1][iz + 1], grid_o[iy][iz + 1]))
                    bm_c.faces.new((grid_i[iy][iz + 1], grid_i[iy + 1][iz + 1], grid_i[iy + 1][iz], grid_i[iy][iz]))
                else:
                    bm_c.faces.new((grid_o[iy][iz + 1], grid_o[iy + 1][iz + 1], grid_o[iy + 1][iz], grid_o[iy][iz]))
                    bm_c.faces.new((grid_i[iy][iz], grid_i[iy + 1][iz], grid_i[iy + 1][iz + 1], grid_i[iy][iz + 1]))
        for iy in range(ny):
            bm_c.faces.new((grid_i[iy][0], grid_i[iy + 1][0], grid_o[iy + 1][0], grid_o[iy][0]))
            bm_c.faces.new((grid_o[iy][-1], grid_o[iy + 1][-1], grid_i[iy + 1][-1], grid_i[iy][-1]))
        for iz in range(nz):
            bm_c.faces.new((grid_o[0][iz], grid_o[0][iz + 1], grid_i[0][iz + 1], grid_i[0][iz]))
            bm_c.faces.new((grid_i[-1][iz], grid_i[-1][iz + 1], grid_o[-1][iz + 1], grid_o[-1][iz]))
        make_mesh_from_bmesh(f"curtain_quarter_{tag}", bm_c, curtain_mat, smooth=True, angle=45.0)

        # Flush decorative corner patch + sleek side peek window
        make_box(f"curtain_patch_{tag}", (sx * 0.608, -1.16, 1.055), (0.005, 0.09, 0.09), stripe_mat, bevel=0.001)
        make_box(f"curtain_win_frame_{tag}", (sx * 0.607, -0.98, 1.38), (0.010, 0.33, 0.25), trim_mat, bevel=0.003)
        make_box(f"curtain_win_{tag}", (sx * 0.610, -0.98, 1.38), (0.008, 0.295, 0.215), glass_mat, bevel=0.001)

        # Neatly rolled-up weather curtain tucked under the doorway eave + tie straps
        roll_pts = [
            (sx * 0.608, -0.66, 1.682),
            (sx * 0.608, -0.34, 1.682),
            (sx * 0.602, 0.02, 1.682),
            (sx * 0.588, 0.32, 1.678),
        ]
        make_tube_path(f"curtain_roll_{tag}", roll_pts, 0.036, curtain_mat, radial_segs=10)
        for sy in (-0.52, -0.15, 0.20):
            x_s = 0.608 if sy < 0.05 else 0.594
            make_cyl(
                f"curtain_strap_{tag}_{sy}",
                (sx * x_s, sy, 1.680),
                0.040,
                0.020,
                trim_mat,
                verts=12,
                rot=(math.pi * 0.5, 0.0, 0.0),
            )

    # 5. Chrome structural frame stanchions, internal roof bows, and compact roof carrier rail
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        # Rear corner post cleanly inside quarter curtain
        make_tube_path(
            f"post_rear_{tag}",
            [(sx * 0.542, -1.26, 0.90), (sx * 0.550, -1.26, 1.48), (sx * 0.550, -1.25, 1.72)],
            0.014,
            chrome_mat,
            radial_segs=10,
        )
        # Mid doorway stanchion anchored firmly into rear_body top rail behind slanted edge
        make_tube_path(
            f"post_mid_{tag}",
            [(sx * 0.578, -0.23, 0.92), (sx * 0.586, -0.23, 1.48), (sx * 0.578, -0.23, 1.72)],
            0.014,
            chrome_mat,
            radial_segs=10,
        )
        # Forward cab stanchion anchored solidly into cowl_cheek shoulder (Y=0.50, Z=0.68)
        make_tube_path(
            f"post_cab_{tag}",
            [(sx * 0.555, 0.49, 0.68), (sx * 0.565, 0.42, 1.28), (sx * 0.560, 0.36, 1.71)],
            0.014,
            chrome_mat,
            radial_segs=10,
        )
        # Interior passenger grab rail tucked inside quarter curtain (X=±0.548, never pokes out)
        make_bar(f"rail_side_{tag}", (sx * 0.548, -1.25, 1.18), (sx * 0.574, -0.23, 1.18), 0.011, chrome_mat, verts=8)

    # Internal transverse chrome roof bows inside canopy
    for ry in (-1.22, -0.72, -0.18, 0.36):
        bow_pts = []
        for i in range(9):
            u = lerp(-1.0, 1.0, i / 8.0)
            x = u * 0.56
            z = canopy_surface_z(x, ry, abs(u)) - 0.054
            bow_pts.append((x, ry, z))
        make_tube_path(f"roof_bow_{ry}", bow_pts, 0.011, chrome_mat, radial_segs=8)

    # Compact rear chrome roof luggage carrier rails (Z <= 1.912)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        rack_pts = [
            (sx * 0.36, -1.16, 1.875),
            (sx * 0.36, -1.14, 1.908),
            (sx * 0.36, -0.56, 1.908),
            (sx * 0.36, -0.54, 1.875),
        ]
        make_tube_path(f"roof_rack_{tag}", rack_pts, 0.010, chrome_mat, radial_segs=8)
    for ry in (-1.12, -0.85, -0.58):
        make_bar(f"roof_rack_cross_{ry}", (-0.36, ry, 1.908), (0.36, ry, 1.908), 0.008, chrome_mat, verts=8)


# ---------------------------------------------------------------------------
# Wheel Builder (10" Commercial Rickshaw Wheel, exact R_WHEEL = 0.24)
# ---------------------------------------------------------------------------

def build_rickshaw_wheel(name, x, y, tyre_mat, rim_mat, gun_mat, chrome_mat, steel_mat, accent_mat=None):
    sgn = 1.0 if x >= 0 else -1.0
    parts = []

    r_outer = R_WHEEL - 0.0025
    r_shld = R_WHEEL - 0.012
    r_rim = 0.138
    hw = TYRE_W * 0.5
    lathe_prof = [
        (-hw * 0.78, r_rim),
        (-hw * 0.96, r_rim + 0.025),
        (-hw * 1.02, r_rim + 0.056),
        (-hw * 0.94, r_shld),
        (-hw * 0.74, r_outer),
        (0.0, r_outer + 0.0025),
        (hw * 0.74, r_outer),
        (hw * 0.94, r_shld),
        (hw * 1.02, r_rim + 0.056),
        (hw * 0.96, r_rim + 0.025),
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
    parts.append(make_mesh_from_bmesh(f"{name}_tyre", bm, tyre_mat, smooth=True, angle=48.0))

    # Subtle tread shoulder blocks strictly clamped inside R_WHEEL = 0.24
    n_lugs = 14
    for k in range(n_lugs):
        a = k * 2.0 * math.pi / n_lugs
        for side_s in (-1.0, 1.0):
            ang = a + (0.09 if side_s > 0 else 0.0)
            r_lug = R_WHEEL - 0.0065
            parts.append(
                make_box(
                    f"{name}_lug",
                    (side_s * hw * 0.68, math.cos(ang) * r_lug, math.sin(ang) * r_lug),
                    (0.032, 0.028, 0.012),
                    tyre_mat,
                    rot=(ang - math.pi * 0.5, 0.0, 0.0),
                    smooth=False,
                )
            )

    # Dished 10" steel rim, inner barrel, brake drum backing, vent slots, 4 chrome lug nuts & hubcap
    parts.append(make_cyl(f"{name}_barrel", (0.0, 0.0, 0.0), r_rim + 0.003, TYRE_W * 0.80, gun_mat, verts=20))
    parts.append(make_cyl(f"{name}_drum", (-sgn * 0.015, 0.0, 0.0), 0.100, 0.042, steel_mat, verts=16))

    # Outer stamped steel wheel face disc + curled bead lip
    face_x = sgn * (hw * 0.56)
    parts.append(make_cyl(f"{name}_disc", (face_x, 0.0, 0.0), r_rim - 0.004, 0.018, rim_mat, verts=20))
    bpy.ops.mesh.primitive_torus_add(
        major_radius=r_rim - 0.004,
        minor_radius=0.011,
        major_segments=20,
        minor_segments=6,
        location=(sgn * (hw * 0.72), 0.0, 0.0),
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

    # 4 dark cooling vent pockets + 4 chrome lug nuts
    for k in range(4):
        a = k * math.pi * 0.5
        va = a + math.pi * 0.25
        parts.append(
            make_cyl(
                f"{name}_vent_{k}",
                (face_x + sgn * 0.008, math.cos(va) * 0.095, math.sin(va) * 0.095),
                0.022,
                0.008,
                gun_mat,
                verts=10,
            )
        )
        parts.append(
            make_cyl(
                f"{name}_nut_{k}",
                (face_x + sgn * 0.012, math.cos(a) * 0.052, math.sin(a) * 0.052),
                0.008,
                0.014,
                chrome_mat,
                verts=6,
            )
        )

    # Domed center hubcap (both sides visible on front single wheel!)
    cap_sides = (-1.0, 1.0) if abs(x) < 0.05 else (sgn,)
    for cs in cap_sides:
        cx = cs * (hw * 0.66)
        parts.append(make_cyl(f"{name}_cap_{cs}", (cx, 0.0, 0.0), 0.036, 0.022, chrome_mat, verts=12, bevel=0.003))
        if accent_mat is not None:
            parts.append(make_cyl(f"{name}_accent_{cs}", (cx + cs * 0.008, 0.0, 0.0), 0.020, 0.010, accent_mat, verts=12))

    wheel_obj = join_objects(parts, name)
    wheel_obj.location = (x, y, R_WHEEL)
    return wheel_obj


# ---------------------------------------------------------------------------
# Main Vehicle Builder: Sazgar Royal Deluxe 200cc
# ---------------------------------------------------------------------------

def build_sazgar_royal_deluxe():
    # Materials matching VehicleFactory.ts dynamic overrides + Cycles PBR
    PAINT = make_mat("paint", "#1e7a3c", rough=0.24, metal=0.18, coat=0.80, coat_rough=0.06)
    CANOPY = make_mat("canopy", "#1a1d22", rough=0.44, metal=0.04, coat=0.18, coat_rough=0.22)
    CURTAIN = make_mat("curtain", "#1b4d2a", rough=0.72, metal=0.0)
    STRIPE = make_mat("trim_stripe", "#e8c244", rough=0.42, metal=0.08)

    GLASS = make_mat("glass", "#243540", rough=0.06, metal=0.12, coat=0.40, coat_rough=0.04)
    TRIM = make_mat("trim", "#1a1c1f", rough=0.62, metal=0.06)
    CHROME = make_mat("chrome", "#d6dce2", rough=0.18, metal=0.90)
    GUNMETAL = make_mat("gunmetal", "#3e454f", rough=0.36, metal=0.68)
    STEEL = make_mat("steel", "#8a929b", rough=0.36, metal=0.82)
    TYRE = make_mat("tyre", "#1c1d1f", rough=0.88, metal=0.0)
    RIM = make_mat("rim", "#c6cbd2", rough=0.24, metal=0.82)
    SEAT = make_mat("seat", "#2a1d19", rough=0.52, metal=0.0)
    SEAT_BACK = make_mat("seat_back", "#d8c8a8", rough=0.42, metal=0.0)
    HEAD = make_mat("head", "#f4f7ec", rough=0.14, metal=0.05)
    BRAKE = make_mat("brake", "#9c1616", rough=0.26, metal=0.05)
    AMBER = make_mat("hazard", "#dc8416", rough=0.26, metal=0.05)
    CLEAR = make_mat("clear_lamp", "#e6eaee", rough=0.18, metal=0.08)
    PLATE = make_mat("plate", "#f2efe4", rough=0.42, metal=0.0)
    BADGE_RED = make_mat("badge_red", "#b81d24", rough=0.28, metal=0.12)

    # ------------------------------------------------------------------
    # 1. Sculpted Front Cab Cowl, Leg Shields, Grille & Main Headlamp
    #    IMPORTANT: Create head_1_main BEFORE head_2_fog_*!
    # ------------------------------------------------------------------
    cowl_stations = [0.86, 0.90, 0.96, 1.02, 1.08, 1.14, 1.19, 1.215, 1.232, 1.245]
    front_cowl = build_loft(
        "front_cowl",
        cowl_stations,
        front_cowl_section,
        PAINT,
        y_warp_fn=front_cowl_y_warp,
        angle=32.0,
    )
    cheeks = build_cowl_cheeks(PAINT)
    bpy.context.view_layer.update()

    # Probe exact front nose surface for flush fascia placement
    ok, loc_head, _, _ = front_cowl.ray_cast(Vector((0.0, 2.0, 0.87)), Vector((0.0, -1.0, 0.0)))
    nose_y_hi = loc_head.y if ok else 1.28

    # Sculpted Headlamp Nacelle Pod + single-material head_1_main (FIRST head_* object!)
    make_box("head_surround_main", (0.0, nose_y_hi - 0.012, 0.875), (0.295, 0.105, 0.165), PAINT, bevel=0.035, segments=2, rot=(-0.06, 0.0, 0.0))
    make_box("head_bezel_main", (0.0, nose_y_hi + 0.032, 0.875), (0.242, 0.035, 0.125), CHROME, bevel=0.018, segments=2, rot=(-0.06, 0.0, 0.0))
    make_box("head_reflector_main", (0.0, nose_y_hi + 0.044, 0.875), (0.214, 0.018, 0.098), STEEL, bevel=0.008, rot=(-0.06, 0.0, 0.0))
    # Single-material glowing headlamp lens (MUST come before head_2_fog_*)
    make_box("head_1_main", (0.0, nose_y_hi + 0.052, 0.875), (0.198, 0.016, 0.086), HEAD, bevel=0.008, rot=(-0.06, 0.0, 0.0))

    # Chrome Grille Garnish + Sazgar Red Crest Emblem (proud along surface normal!)
    ok_g, loc_gr, _, _ = front_cowl.ray_cast(Vector((0.0, 2.0, 0.72)), Vector((0.0, -1.0, 0.0)))
    gy = loc_gr.y if ok_g else 1.27
    make_box("grille_bg", (0.0, gy + 0.006, 0.725), (0.28, 0.026, 0.095), TRIM, bevel=0.008)
    for k, gz in enumerate((0.692, 0.725, 0.758)):
        make_box(f"grille_slat_{k}", (0.0, gy + 0.016, gz), (0.25 - k * 0.008, 0.012, 0.012), CHROME, bevel=0.003)

    ok_b, loc_bd, nrm_bd, _ = front_cowl.ray_cast(Vector((0.0, 2.0, 0.982)), Vector((0.0, -1.0, 0.0)))
    if not ok_b:
        loc_bd = Vector((0.0, 1.225, 0.982))
        nrm_bd = Vector((0.0, 0.88, 0.46)).normalized()
    b_pos = loc_bd + nrm_bd.normalized() * 0.010
    b_tilt = -math.atan2(nrm_bd.z, nrm_bd.y) * 0.65
    make_cyl("sazgar_badge_bg", (b_pos.x, b_pos.y, b_pos.z), 0.027, 0.012, BADGE_RED, verts=14, rot=(math.pi * 0.5 + b_tilt, 0.0, 0.0), scale=(1.35, 1.0, 1.0))
    b_bar = loc_bd + nrm_bd.normalized() * 0.016
    make_box("sazgar_badge_chrome", (b_bar.x, b_bar.y, b_bar.z), (0.052, 0.007, 0.009), CHROME, bevel=0.002, rot=(b_tilt, 0.0, 0.0))

    # Sweeping chrome trim along front cowl & leg shields (ray-cast onto exact outer skin)
    for sx, cheek in zip((-1.0, 1.0), cheeks):
        tag = "R" if sx > 0 else "L"
        axis = "-x" if sx > 0 else "+x"
        # Horizontal cowl nose molding from Y=0.88 to Y=1.18 at Z=0.905
        cowl_pts = []
        for yp in (0.87, 0.94, 1.02, 1.10, 1.18):
            ok_s, ls, nrm_s, _ = front_cowl.ray_cast(Vector((sx * 1.2, yp, 0.905)), Vector((-sx, 0.0, 0.0)))
            if ok_s:
                cowl_pts.append(ls + nrm_s.normalized() * 0.007)
        if len(cowl_pts) >= 2:
            make_tube_path(f"cowl_chrome_trim_{tag}", cowl_pts, 0.0075, CHROME, radial_segs=8)
        # Matching leg-shield edge trim sweeping smoothly down cowl_cheek outer shoulder
        cheek_pts = []
        for yp in (0.50, 0.62, 0.74, 0.86):
            z_probe = lerp(0.68, 0.905, smoothstep(0.50, 0.86, yp))
            ok_c, lc, nrm_c, _ = cheek.ray_cast(Vector((sx * 1.2, yp, z_probe)), Vector((-sx, 0.0, 0.0)))
            if ok_c:
                cheek_pts.append(lc + nrm_c.normalized() * 0.007)
        if len(cheek_pts) >= 2:
            make_tube_path(f"cheek_chrome_trim_{tag}", cheek_pts, 0.0075, CHROME, radial_segs=8)

    # Corner amber front indicators (hazard_fL, hazard_fR - single material)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        ok_i, li, ni, _ = front_cowl.ray_cast(Vector((sx * 0.85, 1.38, 0.94)), Vector((-sx * 0.55, -0.84, 0.0)))
        if not ok_i:
            li = Vector((sx * 0.39, 1.14, 0.94))
        yaw = sx * 0.42
        make_box(f"hazard_housing_{tag}", (li.x, li.y, 0.94), (0.092, 0.044, 0.052), TRIM, bevel=0.008, rot=(0.0, 0.0, yaw))
        make_box(f"hazard_f{tag}", (li.x + sx * 0.008, li.y + 0.015, 0.94), (0.074, 0.022, 0.036), AMBER, bevel=0.006, rot=(0.0, 0.0, yaw))

    # ------------------------------------------------------------------
    # 2. Curved Windscreen, Painted A-Pillars, Visor, Wiper & Mirrors
    # ------------------------------------------------------------------
    build_windscreen_and_pillars(PAINT, GLASS, TRIM, CHROME)

    # ------------------------------------------------------------------
    # 3. Front Chrome Crash Bumper, Twin Deluxe Fog Lamps, Mudguard & Fork
    # ------------------------------------------------------------------
    # Upper & lower chrome tubular crash rails wrapping nose & wheel
    upper_bumper = [
        (-0.54, 0.96, 0.55),
        (-0.51, 1.18, 0.55),
        (-0.42, 1.34, 0.555),
        (-0.22, 1.41, 0.56),
        (0.0, 1.425, 0.562),
        (0.22, 1.41, 0.56),
        (0.42, 1.34, 0.555),
        (0.51, 1.18, 0.55),
        (0.54, 0.96, 0.55),
    ]
    lower_bumper = [(x, y - 0.01, z - 0.145) for x, y, z in upper_bumper]
    make_tube_path("bumper_f_hi", upper_bumper, 0.014, CHROME, radial_segs=10)
    make_tube_path("bumper_f_lo", lower_bumper, 0.013, CHROME, radial_segs=10)

    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_bar(f"bumper_strut_out_{tag}", (sx * 0.44, 1.33, 0.41), (sx * 0.44, 1.33, 0.555), 0.011, CHROME, verts=8)
        make_bar(f"bumper_strut_in_{tag}", (sx * 0.22, 1.40, 0.415), (sx * 0.22, 1.405, 0.56), 0.011, CHROME, verts=8)
        make_box(f"bumper_pad_{tag}", (sx * 0.22, 1.415, 0.488), (0.042, 0.032, 0.145), TRIM, bevel=0.006)
        # Rear mount struts tying bumper cleanly into cowl lower skirt
        make_bar(f"bumper_mount_{tag}", (sx * 0.52, 0.96, 0.41), (sx * 0.46, 0.88, 0.41), 0.012, TRIM, verts=8)

    # Front license plate mounted neatly between bumper struts
    make_box("plate_f", (0.0, 1.425, 0.49), (0.22, 0.014, 0.072), PLATE, bevel=0.003)

    # Twin Deluxe Chrome Fog Lamps on upper bumper bar (head_2_fog_L, head_2_fog_R)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        fx, fy, fz = sx * 0.28, 1.385, 0.612
        make_bar(f"head_bezel_fog_stem_{tag}", (fx, fy - 0.005, 0.56), (fx, fy, fz - 0.03), 0.010, CHROME, verts=8)
        make_cyl(f"head_bezel_fog_{tag}", (fx, fy - 0.006, fz), 0.048, 0.044, CHROME, verts=14, rot=(math.pi * 0.5, 0.0, 0.0), bevel=0.005)
        make_cyl(f"head_reflector_fog_{tag}", (fx, fy + 0.010, fz), 0.041, 0.014, STEEL, verts=14, rot=(math.pi * 0.5, 0.0, 0.0))
        make_cyl(f"head_2_fog_{tag}", (fx, fy + 0.016, fz), 0.037, 0.012, HEAD, verts=14, rot=(math.pi * 0.5, 0.0, 0.0))

    # Sculpted Front Mudguard (arched over (0, 1.17, 0.24), stays inside bumper loop Y <= 1.385)
    bm_mg = bmesh.new()
    n_arc = 16
    r_in, r_out = 0.270, 0.292
    hw_mg = 0.095
    rings_mg = []
    for i in range(n_arc + 1):
        ang = lerp(math.radians(164.0), math.radians(44.0), i / n_arc)
        ca, sa = math.cos(ang), math.sin(ang)
        # Cross-section: inner arch -> rolled side lip -> outer crown -> mirror
        sec_r_x = [
            (-hw_mg + 0.010, r_in + 0.008),
            (-hw_mg, r_in - 0.018),
            (-hw_mg - 0.006, r_out - 0.022),
            (-hw_mg + 0.022, r_out - 0.004),
            (0.0, r_out + 0.004),
            (hw_mg - 0.022, r_out - 0.004),
            (hw_mg + 0.006, r_out - 0.022),
            (hw_mg, r_in - 0.018),
            (hw_mg - 0.010, r_in + 0.008),
            (0.0, r_in + 0.012),
        ]
        rings_mg.append([bm_mg.verts.new((sx_pt, FRONT_AXLE + ca * rad, R_WHEEL + sa * rad)) for sx_pt, rad in sec_r_x])
    m_mg = len(rings_mg[0])
    for i in range(n_arc):
        a, b = rings_mg[i], rings_mg[i + 1]
        for k in range(m_mg):
            k2 = (k + 1) % m_mg
            bm_mg.faces.new((a[k], a[k2], b[k2], b[k]))
    bm_mg.faces.new(list(reversed(rings_mg[0])))
    bm_mg.faces.new(rings_mg[-1])
    make_mesh_from_bmesh("front_mudguard", bm_mg, PAINT, smooth=True, angle=38.0)

    # Chrome fender crest fin + rubber rear splash flap (Z >= 0.12)
    crest_pts = [(0.0, FRONT_AXLE + math.cos(math.radians(a)) * 0.298, R_WHEEL + math.sin(math.radians(a)) * 0.298) for a in (135, 110, 88, 66, 48)]
    make_tube_path("front_mudguard_crest", crest_pts, 0.007, CHROME, radial_segs=8)
    make_box("mudflap_F", (0.0, 0.895, 0.20), (0.16, 0.012, 0.16), TRIM, bevel=0.003, rot=(0.14, 0.0, 0.0))

    # Hydraulic Front Fork & Coil Springs
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_bar(f"fork_leg_{tag}", (sx * 0.098, FRONT_AXLE, R_WHEEL), (sx * 0.098, 1.04, 0.74), 0.018, CHROME, verts=10)
        make_bar(f"fork_slider_{tag}", (sx * 0.098, FRONT_AXLE, R_WHEEL), (sx * 0.098, 1.12, 0.45), 0.023, GUNMETAL, verts=10)
        # Coiled spring rings along fork
        for k in range(5):
            sz = lerp(0.34, 0.48, k / 4.0)
            sy = lerp(1.15, 1.105, k / 4.0)
            make_cyl(f"fork_spring_{tag}_{k}", (sx * 0.098, sy, sz), 0.027, 0.014, STEEL, verts=10, rot=(0.24, 0.0, 0.0))
    make_box("fork_crown", (0.0, 1.05, 0.72), (0.24, 0.07, 0.04), STEEL, bevel=0.006)

    # ------------------------------------------------------------------
    # 4. Driver Cockpit (Clears rider at (0, +0.32, +0.91..+1.83))
    # ------------------------------------------------------------------
    # Molded dashboard pod + twin chrome-bezeled analog gauges
    make_box("dashboard", (0.0, 0.88, 1.03), (0.56, 0.14, 0.11), TRIM, bevel=0.018, rot=(-0.22, 0.0, 0.0))
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_cyl(f"gauge_ring_{tag}", (sx * 0.09, 0.835, 1.06), 0.036, 0.018, CHROME, verts=12, rot=(1.15, 0.0, 0.0))
        make_cyl(f"gauge_face_{tag}", (sx * 0.09, 0.830, 1.06), 0.030, 0.016, PLATE, verts=12, rot=(1.15, 0.0, 0.0))

    # Steering stem & swept chrome handlebars (grips at X=±0.26, Y=0.78, Z=1.26)
    make_bar("steering_stem", (0.0, 0.98, 0.74), (0.0, 0.84, 1.24), 0.022, TRIM, verts=10)
    make_box("handle_clamp", (0.0, 0.83, 1.25), (0.14, 0.06, 0.05), GUNMETAL, bevel=0.008)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        hbar = [
            (sx * 0.05, 0.83, 1.25),
            (sx * 0.16, 0.81, 1.27),
            (sx * 0.24, 0.79, 1.265),
            (sx * 0.31, 0.76, 1.255),
        ]
        make_tube_path(f"handlebar_{tag}", hbar, 0.012, CHROME, radial_segs=8)
        make_bar(f"grip_{tag}", (sx * 0.22, 0.795, 1.268), (sx * 0.32, 0.755, 1.252), 0.017, TRIM, verts=8)
        make_bar(f"lever_{tag}", (sx * 0.22, 0.825, 1.26), (sx * 0.31, 0.805, 1.245), 0.005, STEEL, verts=6)

    # Driver floorboard + rubber mat + pedal
    make_box("floor_pan", (0.0, -0.04, 0.335), (1.06, 1.80, 0.042), TRIM, bevel=0.008)
    make_box("floor_mat_driver", (0.0, 0.56, 0.360), (0.82, 0.54, 0.012), GUNMETAL, bevel=0.003)
    make_box("brake_pedal", (0.20, 0.70, 0.385), (0.075, 0.09, 0.018), STEEL, bevel=0.004, rot=(0.35, 0.0, 0.0))

    # Driver partition bulkhead & grounded padded driver seat (seat top Z=0.88, backrest Y<=0.13)
    make_box("driver_bulkhead", (0.0, -0.02, 0.59), (0.98, 0.20, 0.48), PAINT, bevel=0.018)
    for k in range(-2, 3):
        make_box(f"bulkhead_vent_{k}", (k * 0.14, 0.082, 0.59), (0.025, 0.010, 0.24), TRIM, bevel=0.002)
    # Grounded steel under-seat pedestal & tubular struts anchoring seat solidly to floor & bulkhead
    make_box("driver_seat_pedestal", (0.0, 0.23, 0.59), (0.40, 0.30, 0.46), TRIM, bevel=0.014)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_bar(f"driver_seat_leg_{tag}", (sx * 0.18, 0.42, 0.355), (sx * 0.18, 0.40, 0.82), 0.014, STEEL, verts=8)
        make_bar(f"driver_seat_stay_{tag}", (sx * 0.16, 0.08, 0.84), (sx * 0.16, 0.08, 1.06), 0.014, STEEL, verts=8)
    make_box("driver_seat_cushion", (0.0, 0.32, 0.845), (0.46, 0.36, 0.072), SEAT, bevel=0.024, segments=2)
    make_box("driver_seat_back", (0.0, 0.085, 1.045), (0.42, 0.085, 0.34), SEAT, bevel=0.024, segments=2, rot=(0.12, 0.0, 0.0))
    # Chrome passenger grab bar behind driver seat
    make_tube_path(
        "pass_front_grab_bar",
        [(-0.34, -0.10, 0.84), (-0.32, -0.08, 0.90), (0.32, -0.08, 0.90), (0.34, -0.10, 0.84)],
        0.012,
        CHROME,
        radial_segs=8,
    )

    # ------------------------------------------------------------------
    # 5. Sculpted Rear Body Tub, Wheel Arches, Flares, Sills & Royal Trim
    # ------------------------------------------------------------------
    rear_stations = [-1.35, -1.28, -1.16, -1.00, -0.82, -0.60, -0.36, -0.22, -0.14]
    rear_body = build_loft(
        "rear_body",
        rear_stations,
        rear_body_section,
        PAINT,
        y_warp_fn=rear_body_y_warp,
        angle=32.0,
    )
    # Carve open passenger cabin + circular rear wheel wells via EXACT boolean
    apply_bool_diff(rear_body, make_cabin_cutter("cabin_cutter"), solver="EXACT")
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        apply_bool_diff(rear_body, make_rear_arch_cutter(f"arch_cutter_{tag}", sx, REAR_AXLE), solver="EXACT")
    bmesh_fix = bmesh.new()
    bmesh_fix.from_mesh(rear_body.data)
    bmesh.ops.remove_doubles(bmesh_fix, verts=bmesh_fix.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bmesh_fix, faces=bmesh_fix.faces)
    bmesh_fix.to_mesh(rear_body.data)
    bmesh_fix.free()
    shade_angle(rear_body, 32.0)
    bpy.context.view_layer.update()

    # Swept Rear Fender Flares, Upper Arch Liners (Z >= 0.24), Mudflaps & Entry Sills
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_rear_flare(f"flare_R{tag}", sx, REAR_AXLE, rear_body, TRIM)

        # Upper-only wheel-well arch liner (strictly above Z = 0.24, never below Z = 0!)
        bm_ln = bmesh.new()
        r_ln = 0.305
        x_in, x_out = sx * 0.485, sx * 0.610
        n_ln = 14
        v_in, v_out = [], []
        for k in range(n_ln + 1):
            ang = lerp(-0.08, math.pi + 0.08, k / n_ln)
            py = REAR_AXLE + math.cos(ang) * r_ln
            pz = max(0.24, R_WHEEL + math.sin(ang) * r_ln)
            v_in.append(bm_ln.verts.new((x_in, py, pz)))
            v_out.append(bm_ln.verts.new((x_out, py, pz)))
        for k in range(n_ln):
            bm_ln.faces.new((v_in[k], v_in[k + 1], v_out[k + 1], v_out[k]))
        c_in = bm_ln.verts.new((x_in, REAR_AXLE, 0.26))
        for k in range(n_ln):
            bm_ln.faces.new((v_in[k + 1], v_in[k], c_in))
        make_mesh_from_bmesh(f"liner_R{tag}", bm_ln, TRIM, smooth=True, angle=48.0)

        # Rear rubber mudflap behind rear tyres (Z >= 0.11)
        make_box(f"mudflap_R{tag}", (sx * 0.59, -1.16, 0.20), (0.16, 0.014, 0.16), TRIM, bevel=0.003)

        # Rocker threshold flush between front cowl cheek (Y=0.46) and rear quarter panel (Y=-0.14)
        make_box(f"rocker_sill_{tag}", (sx * 0.550, 0.16, 0.346), (0.058, 0.66, 0.048), PAINT, bevel=0.010)
        make_box(f"sill_chrome_{tag}", (sx * 0.550, 0.16, 0.372), (0.042, 0.52, 0.010), CHROME, bevel=0.003)

        # Low curved chrome passenger doorway safety guard rail anchored cleanly to post_mid & post_cab
        make_tube_path(
            f"safety_rail_{tag}",
            [(sx * 0.578, -0.23, 0.95), (sx * 0.572, -0.04, 0.68), (sx * 0.570, 0.24, 0.66), (sx * 0.555, 0.49, 0.70)],
            0.012,
            CHROME,
            radial_segs=8,
        )

        # Surface-projected Royal Deluxe side accent trim_stripe + chrome beltline (never buried!)
        axis = "-x" if sx > 0 else "+x"
        stripe_hi = [(lerp(-1.12, -0.28, k / 6.0), 0.775) for k in range(7)]
        stripe_lo = [(lerp(-0.98, -0.34, k / 5.0), 0.705) for k in range(6)]
        belt_pts = [(lerp(-1.28, -0.24, k / 8.0), 0.875) for k in range(9)]
        ray_project_strip(rear_body, f"side_stripe_{tag}_0", stripe_hi, 0.036, axis, STRIPE, lift=0.006)
        ray_project_strip(rear_body, f"side_stripe_{tag}_1", stripe_lo, 0.030, axis, STRIPE, lift=0.006)
        ray_project_strip(rear_body, f"side_chrome_belt_{tag}", belt_pts, 0.020, axis, CHROME, lift=0.007)

    # ------------------------------------------------------------------
    # 6. Plush Royal Deluxe 3-Passenger Rear Cabin Interior
    # ------------------------------------------------------------------
    make_box("pass_floor_mat", (0.0, -0.28, 0.360), (0.98, 0.34, 0.012), GUNMETAL, bevel=0.003)
    make_box("pass_seat_base", (0.0, -0.66, 0.54), (1.02, 0.46, 0.36), PAINT, bevel=0.016)
    make_box("pass_cushion", (0.0, -0.62, 0.785), (1.01, 0.44, 0.12), SEAT, bevel=0.034, segments=2)
    make_box("pass_backrest", (0.0, -0.885, 1.12), (1.00, 0.11, 0.56), SEAT_BACK, bevel=0.032, segments=2, rot=(-0.16, 0.0, 0.0))
    # Vertical stitched pleats + dark top bolster on rear passenger bench
    for px in (-0.34, -0.17, 0.0, 0.17, 0.34):
        make_box(f"pass_pleat_{px}", (px, -0.835, 1.12), (0.018, 0.024, 0.44), SEAT, bevel=0.005, rot=(-0.16, 0.0, 0.0))
    make_box("pass_headrest_bolster", (0.0, -0.925, 1.40), (0.98, 0.115, 0.095), SEAT, bevel=0.032, segments=2)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_box(f"pass_armrest_{tag}", (sx * 0.52, -0.64, 0.995), (0.075, 0.40, 0.068), SEAT, bevel=0.020)

    # ------------------------------------------------------------------
    # 7. Arched Vinyl Canopy Roof, Rear Window, Curtains & Chrome Frame
    # ------------------------------------------------------------------
    build_canopy_and_curtains(CANOPY, CURTAIN, STRIPE, GLASS, TRIM, CHROME)

    # ------------------------------------------------------------------
    # 8. Rear Engine Hatch, Combination Tail Lamps, Bumper & 200cc Drivetrain
    # ------------------------------------------------------------------
    # Probe rear tail center for flush engine hatch & lamps
    ok_r, loc_rt, _, _ = rear_body.ray_cast(Vector((0.0, -2.0, 0.68)), Vector((0.0, 1.0, 0.0)))
    ry_back = loc_rt.y if ok_r else -1.36

    make_box("rear_hatch_seal", (0.0, ry_back - 0.012, 0.67), (0.58, 0.036, 0.38), TRIM, bevel=0.004)
    make_box("rear_hatch_door", (0.0, ry_back - 0.020, 0.67), (0.54, 0.032, 0.34), PAINT, bevel=0.008)
    make_box("rear_hatch_lock", (0.0, ry_back - 0.036, 0.77), (0.045, 0.016, 0.032), CHROME, bevel=0.004)
    for k, lz in enumerate((0.56, 0.60, 0.64)):
        make_box(f"rear_louver_{k}", (0.0, ry_back - 0.034, lz), (0.36, 0.010, 0.012), TRIM, bevel=0.002)

    make_box("rear_chrome_bar", (0.0, ry_back - 0.004, 0.930), (0.92, 0.028, 0.024), CHROME, bevel=0.006)
    make_cyl("rear_badge_bg", (0.0, ry_back - 0.026, 0.888), 0.026, 0.012, BADGE_RED, verts=14, rot=(math.pi * 0.5, 0.0, 0.0), scale=(1.35, 1.0, 1.0))
    make_box("rear_badge_chrome", (0.0, ry_back - 0.031, 0.888), (0.052, 0.006, 0.009), CHROME, bevel=0.002)
    make_box("plate_r", (0.0, ry_back - 0.030, 0.44), (0.24, 0.016, 0.075), PLATE, bevel=0.003)

    # Twin Multi-Chamber Combination Rear Tail Lamps (single-material brake_* and hazard_r*)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        tx = sx * 0.425
        ok_t, loc_tl, _, _ = rear_body.ray_cast(Vector((tx, -2.0, 0.59)), Vector((0.0, 1.0, 0.0)))
        ty = loc_tl.y if ok_t else ry_back + 0.02
        yaw = sx * -0.14
        make_box(f"tail_housing_{tag}", (tx, ty - 0.008, 0.59), (0.195, 0.032, 0.095), TRIM, bevel=0.008, rot=(0.0, 0.0, yaw))
        make_box(f"brake_{tag}", (tx - sx * 0.048, ty - 0.018, 0.59), (0.076, 0.018, 0.068), BRAKE, bevel=0.005, rot=(0.0, 0.0, yaw))
        make_box(f"tail_rev_{tag}", (tx + sx * 0.006, ty - 0.018, 0.59), (0.034, 0.018, 0.068), CLEAR, bevel=0.004, rot=(0.0, 0.0, yaw))
        make_box(f"hazard_r{tag}", (tx + sx * 0.056, ty - 0.018, 0.59), (0.058, 0.018, 0.068), AMBER, bevel=0.005, rot=(0.0, 0.0, yaw))

    # Heavy-duty Rear Chrome/Steel Crash Bumper & Footstep Guard
    rear_bumper_pts = [
        (-0.54, -1.24, 0.34),
        (-0.52, -1.44, 0.34),
        (-0.34, -1.48, 0.34),
        (0.34, -1.48, 0.34),
        (0.52, -1.44, 0.34),
        (0.54, -1.24, 0.34),
    ]
    make_tube_path("rear_bumper_main", rear_bumper_pts, 0.015, CHROME, radial_segs=10)
    rear_bumper_hi = [
        (-0.53, -1.32, 0.45),
        (-0.50, -1.45, 0.45),
        (-0.28, -1.47, 0.45),
    ]
    make_tube_path("rear_bumper_corner_L", rear_bumper_hi, 0.012, CHROME, radial_segs=8)
    make_tube_path("rear_bumper_corner_R", [(-x, y, z) for x, y, z in rear_bumper_hi], 0.012, CHROME, radial_segs=8)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_bar(f"rear_bumper_tie_{tag}", (sx * 0.36, -1.47, 0.34), (sx * 0.36, -1.46, 0.45), 0.011, CHROME, verts=8)
        make_bar(f"rear_bumper_mount_{tag}", (sx * 0.36, -1.47, 0.34), (sx * 0.36, -1.32, 0.35), 0.013, TRIM, verts=8)
    make_box("rear_step_pad", (0.0, -1.475, 0.345), (0.64, 0.075, 0.022), TRIM, bevel=0.005)

    # Underbody Pipe Frame, Leaf Springs, Rear Diff, 200cc Engine & Exhaust at (-0.28, -1.38, 0.25)
    for sx in (-1.0, 1.0):
        tag = "R" if sx > 0 else "L"
        make_box(f"chassis_rail_{tag}", (sx * 0.28, -0.18, 0.29), (0.045, 2.15, 0.055), TRIM, smooth=False)
        # Multi-leaf suspension spring pack
        leaf_pts = [
            (sx * 0.42, -1.10, 0.29),
            (sx * 0.42, -0.82, 0.22),
            (sx * 0.42, -0.54, 0.29),
        ]
        make_tube_path(f"leaf_spring_{tag}", leaf_pts, 0.016, STEEL, radial_segs=6)
    for cy in (0.60, -0.10, -0.82, -1.20):
        make_box(f"chassis_cross_{cy}", (0.0, cy, 0.29), (0.62, 0.045, 0.045), TRIM, smooth=False)

    make_bar("rear_axle_tube", (-0.52, REAR_AXLE, R_WHEEL), (0.52, REAR_AXLE, R_WHEEL), 0.024, TRIM, verts=10)
    make_cyl("rear_diff", (0.0, REAR_AXLE, 0.245), 0.078, 0.13, GUNMETAL, verts=12, rot=(0.0, 0.0, 0.0))
    make_box("engine_sump", (0.02, -0.88, 0.25), (0.28, 0.34, 0.14), GUNMETAL, bevel=0.014)

    # 200cc Exhaust System exiting cleanly at (-0.28, -1.38, 0.25) matching FLAME_POS.rickshaw
    exhaust_pts = [
        (-0.08, -0.78, 0.22),
        (-0.22, -0.90, 0.22),
        (-0.28, -1.00, 0.245),
    ]
    make_tube_path("exhaust_header", exhaust_pts, 0.016, STEEL, radial_segs=8)
    make_cyl("exhaust_muffler", (-0.28, -1.16, 0.25), 0.038, 0.30, CHROME, verts=12, rot=(math.pi * 0.5, 0.0, 0.0), bevel=0.008)
    make_cyl("exhaust_tip", (-0.28, -1.34, 0.25), 0.018, 0.08, STEEL, verts=10, rot=(math.pi * 0.5, 0.0, 0.0))

    # ------------------------------------------------------------------
    # 9. Sculpted 10-inch Commercial Wheels (wheel_F, wheel_RL, wheel_RR)
    # ------------------------------------------------------------------
    build_rickshaw_wheel("wheel_F", 0.0, FRONT_AXLE, TYRE, RIM, GUNMETAL, CHROME, STEEL, accent_mat=PAINT)
    build_rickshaw_wheel("wheel_RL", -TRACK_REAR, REAR_AXLE, TYRE, RIM, GUNMETAL, CHROME, STEEL)
    build_rickshaw_wheel("wheel_RR", TRACK_REAR, REAR_AXLE, TYRE, RIM, GUNMETAL, CHROME, STEEL)

    bpy.context.view_layer.update()


# ---------------------------------------------------------------------------
# Contract Verification & Export
# ---------------------------------------------------------------------------

def verify_contract():
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert all(o.parent is None for o in objs), "All meshes must be top-level scene children"
    for o in objs:
        assert o.name == o.data.name, f"Mesh data name mismatch: {o.name} != {o.data.name}"

    names = {o.name: o for o in objs}
    for wn, expected in (
        ("wheel_F", (0.0, FRONT_AXLE, R_WHEEL)),
        ("wheel_RL", (-TRACK_REAR, REAR_AXLE, R_WHEEL)),
        ("wheel_RR", (TRACK_REAR, REAR_AXLE, R_WHEEL)),
    ):
        assert wn in names, f"Missing wheel {wn}"
        loc = names[wn].location
        assert (loc - Vector(expected)).length < 1e-4, f"{wn} origin {loc} != {expected}"

    single_mat_lights = [
        "head_1_main", "head_2_fog_L", "head_2_fog_R",
        "brake_L", "brake_R",
        "hazard_fL", "hazard_fR", "hazard_rL", "hazard_rR",
    ]
    for ln in single_mat_lights:
        assert ln in names, f"Missing light object {ln}"
        assert len(names[ln].data.materials) == 1, f"Light {ln} must have exactly 1 material"

    head_active = [
        o.name for o in bpy.context.scene.objects
        if o.name.lower().startswith("head")
        and not o.name.lower().startswith(("head_bezel", "head_surround", "head_reflector"))
    ]
    assert head_active and head_active[0] == "head_1_main", f"Unexpected head order: {head_active}"

    for required_mat in ("paint", "canopy", "curtain", "trim_stripe", "head", "brake", "hazard", "tyre", "rim"):
        assert required_mat in bpy.data.materials, f"Missing required material '{required_mat}'"

    # Verify canopy interior ceiling clears in-game driver head (rider head top Z=1.83 at Y=0.32)
    canopy = names["canopy_roof"]
    ok_c, loc_c, _, _ = canopy.ray_cast(Vector((0.0, 0.32, 1.50)), Vector((0.0, 0.0, 1.0)))
    assert ok_c and loc_c.z >= 1.84, f"Canopy ceiling over driver too low: {loc_c.z if ok_c else 'miss'}"

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
        f"X:[{mins.x:.3f}, {maxs.x:.3f}] Y:[{mins.y:.3f}, {maxs.y:.3f}] Z:[{mins.z:.3f}, {maxs.z:.3f}] | "
        f"driver_headroom_Z={loc_c.z:.3f}"
    )
    assert abs(mins.z) < 0.008, f"Tyres must rest flush on Z=0, got Z_min={mins.z:.4f}"
    assert maxs.z <= 1.925, f"Roof height {maxs.z:.3f} exceeds GarageScene limit 1.92"
    assert max(abs(mins.x), abs(maxs.x)) <= 0.71, f"Width {mins.x:.3f}..{maxs.x:.3f} exceeds GarageScene hw"


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

    bpy.ops.mesh.primitive_plane_add(size=18.0, location=(0.0, 0.0, 0.0))
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

    add_area("Key", (4.5, 4.2, 4.0), (0.0, 0.0, 0.90), 650.0, 3.5, (1.0, 0.96, 0.90))
    add_area("Fill", (-4.5, 3.2, 2.6), (0.0, 0.0, 0.90), 320.0, 4.2, (0.82, 0.90, 1.0))
    add_area("Rim", (-3.0, -4.5, 3.4), (0.0, -0.1, 0.95), 520.0, 3.2, (0.92, 0.96, 1.0))
    add_area("TopSoft", (0.0, 0.1, 5.2), (0.0, 0.0, 0.95), 340.0, 5.0, (1.0, 1.0, 1.0))

    cam_data = bpy.data.cameras.new("StudioCam")
    cam_obj = link_obj(bpy.data.objects.new("StudioCam", cam_data))
    scene.camera = cam_obj

    views = [
        ("front_34.png", (2.95, 3.45, 1.48), (0.0, 0.05, 0.92), 42.0),
        ("rear_34.png", (-2.95, -3.45, 1.52), (0.0, -0.10, 0.94), 42.0),
        ("side.png", (5.10, -0.05, 0.98), (0.0, -0.05, 0.95), 48.0),
        ("front.png", (0.0, 4.75, 0.98), (0.0, 0.15, 0.94), 42.0),
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
    build_sazgar_royal_deluxe()
    verify_contract()
    export_outputs(args)
    if args.render:
        render_previews(args.render)


if __name__ == "__main__":
    main()
