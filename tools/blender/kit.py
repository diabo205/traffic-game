"""Shared helpers for the headless Blender model scripts in this folder.

Conventions (match src/render/VehicleFactory.ts):
  Blender +Y = vehicle front -> glTF/three -Z. Z up. Metres. Origin on the
  ground under the vehicle's centre. Object names carry meaning in the game:
  head_*, brake_*, hazard_* are swappable lights; wheel_* are wheels; the
  material named "paint" is recoloured per traffic variant.
"""

import math
import os

import bpy  # must come first: it makes bmesh importable
import bmesh  # noqa: E402


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def mat(name, hex_color, rough=0.55, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hex_color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def obj(name, mesh_op, loc, scale=(1, 1, 1), rot=(0, 0, 0), material=None, bevel=0.0, segments=2):
    mesh_op()
    o = bpy.context.active_object
    o.name = name
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if material:
        o.data.materials.append(material)
    if bevel:
        bv = o.modifiers.new("bv", "BEVEL")
        bv.width = bevel
        bv.segments = segments
        bpy.ops.object.modifier_apply(modifier="bv")
    for p in o.data.polygons:
        p.use_smooth = bevel > 0
    o.select_set(False)
    return o


def cube(name, loc, size, material, bevel=0.0, rot=(0, 0, 0), segments=2):
    return obj(name, lambda: bpy.ops.mesh.primitive_cube_add(size=1), loc, size, rot, material, bevel, segments)


def cyl(name, loc, r, depth, material, verts=16, rot=(0, math.pi / 2, 0), scale=(1, 1, 1), bevel=0.0):
    return obj(name, lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth), loc, scale, rot, material, bevel)


def bar(name, a, b, r, material, verts=8):
    """Round tube from point a to point b."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=length, location=((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2))
    o = bpy.context.active_object
    o.name = name
    # Point local +Z along the segment.
    o.rotation_mode = "QUATERNION"
    from mathutils import Vector
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector((dx, dy, dz)))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    o.select_set(False)
    return o


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    bpy.ops.object.select_all(action="DESELECT")
    return objs[0]


def wheel(name, x, y, r, w, tyre_mat, rim_mat, hub_mat, holes=0):
    """Tyre + steel rim (+ optional holes); returned object's origin is the hub."""
    sgn = 1 if x >= 0 else -1
    parts = [cyl("tyre", (0, 0, 0), r, w, tyre_mat, 20, bevel=min(0.05, w * 0.3))]
    parts.append(cyl("rim", (sgn * (w / 2 + 0.002), 0, 0), r * 0.62, 0.02, rim_mat, 16))
    parts.append(cyl("cap", (sgn * (w / 2 + 0.014), 0, 0), r * 0.18, 0.02, hub_mat, 8))
    for k in range(holes):
        a = k * 2 * math.pi / holes
        parts.append(cyl("hole", (sgn * (w / 2 + 0.004), math.cos(a) * r * 0.42, math.sin(a) * r * 0.42), 0.018, 0.025, hub_mat, 6))
    o = join(parts, name)
    o.location = (x, y, r)
    return o


def arch_lip(x, y, z, radius, material, tube=0.03, keep_above=-0.02):
    """Half-torus flare over a wheel (axis along X)."""
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=24, minor_segments=6,
                                     location=(x, y, z), rotation=(0, math.pi / 2, 0))
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < keep_above], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    o.name = "arch"
    o.select_set(False)
    return o


def export(out):
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True)
    print("wrote", out)


def default_out(script_file, name):
    return os.path.join(os.path.dirname(script_file), "..", "..", "public", "models", f"{name}.glb")


def art_plane(name, centre, width, height, facing, material, lift=0.004):
    """Flat panel with a full 0..1 UV (u to the viewer's right, v up as seen
    from outside), for texture-mapped art. facing: '+x', '-x', '+y', '-y'."""
    from mathutils import Vector
    n = {"+x": Vector((1, 0, 0)), "-x": Vector((-1, 0, 0)), "+y": Vector((0, 1, 0)), "-y": Vector((0, -1, 0))}[facing]
    up = Vector((0, 0, 1))
    right = (-n).cross(up)
    c = Vector(centre) + n * lift
    hw, hh = width / 2, height / 2
    corners = [c - right * hw - up * hh, c + right * hw - up * hh, c + right * hw + up * hh, c - right * hw + up * hh]
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in corners]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new("UVMap")
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(material)
    return o
