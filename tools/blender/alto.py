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


PAINT = mat("paint", srgb("#c9cdd1"), 0.3)  # silky silver, as in the brochure shots
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
        (-wr, y, yroof - 0.05), (-wr * 0.74, y, yroof), (wr * 0.74, y, yroof),
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
bv.width = 0.09
bv.segments = 4
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


def cyl(name, loc, r, depth, material, verts=16, rot=(0, math.pi / 2, 0), scale=(1, 1, 1), bevel=0.0):
    return obj(name, lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth), loc, scale, rot, material, bevel)


def join(objs, name):
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    bpy.ops.object.select_all(action="DESELECT")
    return objs[0]


# ---- Wheels: tyre + silver steel rim with holes + hub cap (origin at hub) ------------
for name, x, y in (("wheel_FL", -0.66, 1.12), ("wheel_FR", 0.66, 1.12), ("wheel_RL", -0.66, -1.14), ("wheel_RR", 0.66, -1.14)):
    sgn = 1 if x > 0 else -1
    parts = [cyl("tyre", (0, 0, 0), R, W, TYRE, 20, bevel=0.05)]
    parts.append(cyl("rim", (sgn * (W / 2 + 0.002), 0, 0), R * 0.66, 0.02, RIM, 18))
    parts.append(cyl("dish", (sgn * (W / 2 + 0.01), 0, 0), R * 0.42, 0.02, RIM, 14, bevel=0.008))
    parts.append(cyl("cap", (sgn * (W / 2 + 0.02), 0, 0), R * 0.13, 0.02, CHROME, 8))
    for k in range(6):
        a = k * math.pi / 3
        parts.append(cyl("hole", (sgn * (W / 2 + 0.004), math.cos(a) * R * 0.53, math.sin(a) * R * 0.53), 0.022, 0.025, BLACK, 6))
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    w = parts[0]
    w.name = name
    w.location = (x, y, R)
    bpy.ops.object.select_all(action="DESELECT")


def arch_lip(x, y):
    """Body-coloured flare around the top of a wheel arch."""
    bpy.ops.mesh.primitive_torus_add(major_radius=0.37, minor_radius=0.032, major_segments=24, minor_segments=6,
                                     location=(x, y, R), rotation=(0, math.pi / 2, 0))
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm2 = bmesh.new()
    bm2.from_mesh(o.data)
    bmesh.ops.delete(bm2, geom=[v for v in bm2.verts if v.co.z < -0.02], context="VERTS")
    bm2.to_mesh(o.data)
    bm2.free()
    o.data.materials.append(PAINT)
    for p in o.data.polygons:
        p.use_smooth = True
    o.name = "arch"
    return o


for sx in (-1, 1):
    for y in AXLES:
        arch_lip(sx * 0.745, y)

# ---- Front: oval corner headlamps, slotted grille + badge, black lower grille -------------
for sx in (-1, 1):
    # Flush with the corner, following the wrap of the nose.
    cyl(f"head_{sx}", (sx * 0.48, 1.69, 0.715), 0.1, 0.05, HEAD, 20, rot=(math.pi / 2, 0, sx * -0.28), scale=(1.4, 1, 0.9), bevel=0.012)
    cyl("head_rim", (sx * 0.48, 1.682, 0.715), 0.113, 0.05, BLACK, 20, rot=(math.pi / 2, 0, sx * -0.28), scale=(1.4, 1, 0.9))
    # Orange side marker on the front wing (doubles as hazard flasher).
    cube(f"hazard_s{sx}", (sx * 0.752, 1.32, 0.72), (0.01, 0.07, 0.04), AMBER)
    cube(f"hazard_f{sx}", (sx * 0.62, 1.66, 0.6), (0.1, 0.04, 0.05), AMBER, 0.008)
    # Black door mirrors on short stalks.
    cube(f"mirror_{sx}", (sx * 0.84, 0.62, 0.99), (0.13, 0.1, 0.12), BLACK, 0.03)
    # Black door handles + door seam + black B-pillar on the glass.
    for y in (0.15, -0.72):
        cube("handle", (sx * 0.765, y, 0.84), (0.02, 0.14, 0.035), BLACK, 0.006)
    cube("seam", (sx * 0.757, -0.28, 0.62), (0.006, 0.012, 0.56), BLACK)
    cube("bpillar", (sx * 0.695, -0.3, 1.18), (0.02, 0.11, 0.5), BLACK, rot=(0, -sx * 0.27, 0))
    # Rear lamps: horizontal units set into the bumper corners.
    cube(f"brake_{sx}", (sx * 0.5, -1.752, 0.58), (0.3, 0.03, 0.1), BRAKE, 0.01)
    cube("lamp_clear", (sx * 0.43, -1.758, 0.58), (0.08, 0.02, 0.08), HEAD)
# Upper grille: dash, badge, four vertical slots.
cube("grille_dash", (-0.2, 1.705, 0.74), (0.14, 0.02, 0.03), BLACK)
cyl("badge_f", (0, 1.71, 0.74), 0.045, 0.02, CHROME, 12, rot=(math.pi / 2, 0, 0))
for k in range(4):
    cube("slot", (0.13 + k * 0.045, 1.705, 0.74), (0.022, 0.02, 0.08), BLACK)
# Front bumper: body-coloured with a wide black lower grille around the plate.
cube("bumper_f", (0, 1.69, 0.5), (1.4, 0.07, 0.28), PAINT, 0.03)
cube("grille_low", (0, 1.728, 0.49), (0.86, 0.02, 0.17), BLACK, 0.01)
for z in (0.45, 0.53):
    cube("slat", (0, 1.738, z), (0.84, 0.01, 0.012), CHROME)
cube("plate_f", (0, 1.744, 0.49), (0.36, 0.02, 0.11), BLACK)
cube("plate_f_text", (0, 1.752, 0.49), (0.24, 0.005, 0.04), CHROME)

# ---- Rear: roof spoiler, glass garnish, tailgate handle + badge, bumper -------------------
cube("spoiler", (0, -1.36, 1.43), (1.06, 0.16, 0.07), PAINT, 0.03, rot=(-0.35, 0, 0))
cube("glass_garnish", (0, -1.625, 0.965), (1.04, 0.02, 0.045), BLACK)
cube("handle_r", (0, -1.712, 0.78), (0.22, 0.03, 0.05), CHROME, 0.012)
cyl("badge_r", (0, -1.712, 0.88), 0.04, 0.02, CHROME, 12, rot=(math.pi / 2, 0, 0))
cube("bumper_r", (0, -1.7, 0.53), (1.44, 0.1, 0.32), PAINT, 0.045)
cube("plate_recess", (0, -1.752, 0.5), (0.46, 0.02, 0.18), BLACK, 0.01)
cube("plate_r", (0, -1.762, 0.5), (0.36, 0.02, 0.11), BLACK)
cube("plate_r_text", (0, -1.77, 0.5), (0.24, 0.005, 0.04), CHROME)
cube("lip_r", (0, -1.72, 0.38), (1.2, 0.06, 0.03), BLACK)
cube("wiper", (0, -1.5, 1.08), (0.32, 0.03, 0.02), BLACK)

# ---- Export ---------------------------------------------------------------------------
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True, export_yup=True)
print("wrote", os.path.abspath(OUT))
