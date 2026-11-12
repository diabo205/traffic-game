"""Build the player's Suzuki Alto (8th gen, as sold in Pakistan) in Blender
and export it to public/models/alto.glb.

Run headless:  python tools/blender/alto.py   (needs `pip install bpy`)

Conventions (match src/render/VehicleFactory.ts):
  Blender +Y = car front  -> glTF/three -Z.  Units: metres. Origin on the ground
  under the car's centre. Objects named head*, brake*, hazard* are swappable
  lights; wheel_* objects are spinning pivots (origin at the hub).
"""

import math
import os
import sys

import bpy  # must come first: it makes bmesh importable
import bmesh  # noqa: E402

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else os.path.join(
    os.path.dirname(__file__), "..", "..", "public", "models", "alto.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.55, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


PAINT = mat("paint", srgb("#dcdfe1"), 0.35)
GLASS = mat("glass", srgb("#3c4852"), 0.12)
BLACK = mat("trim", srgb("#1b1c1e"), 0.7)
TYRE = mat("tyre", srgb("#202022"), 0.9)
RIM = mat("rim", srgb("#b9bec3"), 0.35, 0.6)
CHROME = mat("chrome", srgb("#d8dcdf"), 0.25, 0.8)
HEAD = mat("head", srgb("#eef0e6"), 0.15)
BRAKE = mat("brake", srgb("#7a1414"), 0.3)
AMBER = mat("hazard", srgb("#c47a12"), 0.3)
PLATE = mat("plate", srgb("#fbf8ec"), 0.6)

# ---------------------------------------------------------------------------
# Body shell: lofted cage of cross-sections (kept exact, edges bevelled).
# Station: (y forward, bottom, belt, roof, half-width low, half-width at roof)
STATIONS = [
    (1.70, 0.42, 0.66, 0.80, 0.60, 0.56),   # nose
    (1.60, 0.33, 0.76, 0.88, 0.70, 0.66),   # headlamp line
    (1.10, 0.30, 0.84, 0.94, 0.745, 0.70),  # bonnet
    (0.80, 0.30, 0.88, 0.99, 0.75, 0.70),   # windscreen base
    (0.30, 0.30, 0.91, 1.43, 0.755, 0.61),  # windscreen top
    (-0.40, 0.30, 0.93, 1.47, 0.755, 0.62),
    (-1.30, 0.30, 0.95, 1.45, 0.755, 0.61), # roof end
    (-1.60, 0.31, 0.88, 0.99, 0.745, 0.62), # rear glass bottom
    (-1.69, 0.37, 0.76, 0.90, 0.70, 0.62),  # tailgate
]
RING = 10


def ring(st):
    y, yb, ybelt, yroof, wl, wr = st
    return [
        (-wl * 0.55, y, yb), (-wl, y, yb + 0.07), (-wl, y, ybelt),
        (-wr, y, yroof - 0.05), (-wr * 0.82, y, yroof), (wr * 0.82, y, yroof),
        (wr, y, yroof - 0.05), (wl, y, ybelt), (wl, y, yb + 0.07), (wl * 0.55, y, yb),
    ]


bm = bmesh.new()
rings = [[bm.verts.new(p) for p in ring(s)] for s in STATIONS]
faces = []
for i in range(len(rings) - 1):
    a, b = rings[i], rings[i + 1]
    for k in range(RING):
        k2 = (k + 1) % RING
        faces.append((i, k, bm.faces.new((a[k], a[k2], b[k2], b[k]))))
bm.faces.new(list(reversed(rings[0])))
bm.faces.new(rings[-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

# Material slots: 0 paint, 1 glass.
for i, k, f in faces:
    side_glass = k in (2, 6) and 3 <= i <= 6
    # Only the middle roof segment: the corners stay painted (A/D pillars).
    windscreen = k == 4 and i == 3
    rear_glass = k == 4 and i == 6
    if side_glass or windscreen or rear_glass:
        f.material_index = 1

me = bpy.data.meshes.new("body")
bm.to_mesh(me)
bm.free()
body = bpy.data.objects.new("body", me)
bpy.context.collection.objects.link(body)
me.materials.append(PAINT)
me.materials.append(GLASS)
bpy.context.view_layer.objects.active = body
body.select_set(True)

bv = body.modifiers.new("bv", "BEVEL")
bv.width = 0.055
bv.segments = 3
bv.limit_method = "ANGLE"
bv.angle_limit = math.radians(25)
bpy.ops.object.modifier_apply(modifier="bv")

# Cut real wheel arches.
R, W = 0.29, 0.19
AXLES = (1.12, -1.14)
for y in AXLES:
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.355, depth=2.0, location=(0, y, R), rotation=(0, math.pi / 2, 0))
    cutter = bpy.context.active_object
    boolean = body.modifiers.new("arch", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.object = cutter
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier="arch")
    bpy.data.objects.remove(cutter)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
body.select_set(False)

def obj(name, mesh_op, loc, scale=(1, 1, 1), rot=(0, 0, 0), material=None, bevel=0.0):
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
        bv.segments = 2
        bpy.ops.object.modifier_apply(modifier="bv")
    for p in o.data.polygons:
        p.use_smooth = bevel > 0
    return o


def cube(name, loc, size, material, bevel=0.0, rot=(0, 0, 0)):
    return obj(name, lambda: bpy.ops.mesh.primitive_cube_add(size=1), loc, size, rot, material, bevel)


# ---- Wheels: tyre + rim + hubcap, origin at hub (spin about X) ----------------------
for name, x, y in (("wheel_FL", -0.66, 1.12), ("wheel_FR", 0.66, 1.12), ("wheel_RL", -0.66, -1.14), ("wheel_RR", 0.66, -1.14)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=R, depth=W, rotation=(0, math.pi / 2, 0))
    tyre = bpy.context.active_object
    tyre.data.materials.append(TYRE)
    bv = tyre.modifiers.new("bv", "BEVEL")
    bv.width = 0.05
    bv.segments = 3
    bpy.ops.object.modifier_apply(modifier="bv")
    for p in tyre.data.polygons:
        p.use_smooth = True
    sgn = 1 if x > 0 else -1
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=R * 0.62, depth=0.02, location=(sgn * (W / 2 + 0.005), 0, 0), rotation=(0, math.pi / 2, 0))
    rim = bpy.context.active_object
    rim.data.materials.append(RIM)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=R * 0.16, depth=0.03, location=(sgn * (W / 2 + 0.015), 0, 0), rotation=(0, math.pi / 2, 0))
    hub = bpy.context.active_object
    hub.data.materials.append(BLACK)
    for o in (tyre, rim, hub):
        o.select_set(True)
    bpy.context.view_layer.objects.active = tyre
    bpy.ops.object.join()
    tyre.name = name
    tyre.location = (x, y, R)

# ---- Front: swept headlamps, slim grille, bumper intake, indicators -----------------
for sx in (-1, 1):
    cube(f"head_{sx}", (sx * 0.47, 1.66, 0.72), (0.34, 0.12, 0.13), HEAD, 0.02, (0, 0, sx * -0.35))
    cube(f"hazard_f{sx}", (sx * 0.64, 1.58, 0.64), (0.08, 0.1, 0.06), AMBER, 0.01)
    # Door mirrors.
    cube(f"mirror_{sx}", (sx * 0.83, 0.62, 0.98), (0.12, 0.09, 0.11), PAINT, 0.025)
    cube(f"mirror_glass_{sx}", (sx * 0.835, 0.57, 0.98), (0.1, 0.01, 0.08), BLACK)
    # Door handles + seam.
    for y in (0.15, -0.72):
        cube("handle", (sx * 0.765, y, 0.84), (0.02, 0.14, 0.035), CHROME, 0.005)
    cube("seam", (sx * 0.757, -0.28, 0.62), (0.006, 0.012, 0.56), BLACK)
    # Rear lamps: small horizontal units at bumper level.
    cube(f"brake_{sx}", (sx * 0.5, -1.69, 0.6), (0.26, 0.06, 0.09), BRAKE, 0.015)
cube("grille", (0, 1.71, 0.71), (0.5, 0.05, 0.07), BLACK, 0.01)
cube("intake", (0, 1.68, 0.47), (0.86, 0.06, 0.1), BLACK, 0.02)
cube("plate_f", (0, 1.712, 0.53), (0.38, 0.02, 0.11), PLATE)
cube("plate_r", (0, -1.705, 0.6), (0.38, 0.02, 0.12), PLATE)
cube("plate_r_rim", (0, -1.697, 0.6), (0.41, 0.02, 0.15), BLACK)
cube("plate_f_rim", (0, 1.703, 0.53), (0.41, 0.02, 0.14), BLACK)
cube("bumper_r", (0, -1.64, 0.355), (0.9, 0.06, 0.035), BLACK, 0.01)
cube("garnish", (0, -1.67, 0.84), (0.46, 0.02, 0.03), CHROME)
cube("wiper", (0, -1.5, 1.08), (0.32, 0.03, 0.02), BLACK)

# ---- Export ---------------------------------------------------------------------------
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True, export_yup=True)
print("wrote", os.path.abspath(OUT))
