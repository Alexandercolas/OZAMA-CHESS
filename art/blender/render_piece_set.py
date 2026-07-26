import bpy
import math
import os


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTPUT_ROOT = os.path.join(ROOT, "public", "assets", "pieces", "blender")
BLEND_PATH = os.path.join(ROOT, "art", "blender", "ozama_piece_set_master.blend")
PIECES = ("pawn", "rook", "bishop", "queen", "king")


def clear_meshes():
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)


def finish(obj, role="body", bevel=0.035):
    obj["ozama_role"] = role
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if bevel:
        modifier = obj.modifiers.new("Forged edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    return obj


def lathe(name, profile, role="body"):
    steps = 96
    vertices = []
    faces = []
    for step in range(steps):
        angle = (step / steps) * math.tau
        cosine, sine = math.cos(angle), math.sin(angle)
        for radius, z in profile:
            vertices.append((radius * cosine, radius * sine, z))
    width = len(profile)
    for step in range(steps):
        next_step = (step + 1) % steps
        for index in range(width - 1):
            a = step * width + index
            b = next_step * width + index
            faces.append((a, b, b + 1, a + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, role, 0.025)


def cube(name, location, scale, role="body", rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, role, 0.045)


def sphere(name, location, scale, role="body"):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, role, 0.025)


def cone(name, location, radius1, radius2, depth, role="body", rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=64,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish(obj, role, 0.025)


def base_profile(top=0.72):
    return [
        (0.00, 0.00), (1.18, 0.00), (1.23, 0.09), (1.18, 0.18),
        (1.03, 0.23), (1.00, 0.36), (0.88, 0.43), (0.84, 0.55),
        (top, 0.64),
    ]


def add_pawn():
    lathe("Pawn", base_profile(0.62) + [
        (0.57, 0.82), (0.43, 1.02), (0.36, 1.42),
        (0.46, 1.58), (0.57, 1.69), (0.58, 1.82),
        (0.45, 1.94), (0.00, 2.00),
    ])
    sphere("Pawn crown", (0, 0, 2.25), (0.48, 0.48, 0.48), "trim")


def add_rook():
    lathe("Rook body", base_profile(0.70) + [
        (0.62, 0.90), (0.57, 1.58), (0.70, 1.83),
        (0.82, 1.92), (0.86, 2.12),
    ])
    cube("Rook crown", (0, 0, 2.18), (0.92, 0.92, 0.22), "trim")
    for x, y in ((0.66, 0.52), (-0.66, 0.52), (0.66, -0.52), (-0.66, -0.52)):
        cube("Rook merlon", (x, y, 2.48), (0.27, 0.27, 0.36), "trim")


def add_bishop():
    lathe("Bishop", base_profile(0.65) + [
        (0.58, 0.88), (0.48, 1.42), (0.55, 1.68),
        (0.68, 1.82), (0.62, 1.98), (0.45, 2.10),
        (0.30, 2.40), (0.12, 2.72), (0.00, 2.82),
    ])
    cube(
        "Bishop carved cut",
        (-0.10, -0.39, 2.48),
        (0.055, 0.18, 0.45),
        "dark",
        (0, math.radians(-27), 0),
    )


def add_queen():
    lathe("Queen body", base_profile(0.68) + [
        (0.60, 0.88), (0.48, 1.46), (0.58, 1.77),
        (0.78, 1.91), (0.82, 2.08), (0.68, 2.19),
    ])
    for index in range(8):
        angle = (index / 8) * math.tau
        x, y = 0.62 * math.cos(angle), 0.62 * math.sin(angle)
        cone(
            f"Queen crown point {index + 1}",
            (x, y, 2.45),
            0.18,
            0.04,
            0.64,
            "trim",
            (math.radians(12) * math.sin(angle), math.radians(-12) * math.cos(angle), 0),
        )
        sphere(f"Queen jewel {index + 1}", (x * 1.09, y * 1.09, 2.77), (0.13, 0.13, 0.13), "trim")
    sphere("Queen crown", (0, 0, 2.46), (0.38, 0.38, 0.27), "trim")


def add_cross(z):
    cube("King cross vertical", (0, 0, z), (0.13, 0.13, 0.48), "trim")
    cube("King cross horizontal", (0, -0.01, z + 0.05), (0.42, 0.14, 0.13), "trim")


def add_king():
    lathe("King body", base_profile(0.70) + [
        (0.62, 0.88), (0.50, 1.50), (0.60, 1.82),
        (0.77, 1.98), (0.78, 2.15), (0.58, 2.29),
        (0.48, 2.48),
    ])
    sphere("King crown", (0, 0, 2.50), (0.46, 0.46, 0.24), "trim")
    add_cross(2.95)


BUILDERS = {
    "pawn": add_pawn,
    "rook": add_rook,
    "bishop": add_bishop,
    "queen": add_queen,
    "king": add_king,
}


def aged_material(name, light, dark, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.92
    bsdf.inputs["Roughness"].default_value = roughness
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 20
    noise.inputs["Detail"].default_value = 5
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].color = (*light, 1)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.025
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def setup():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_factor = 1.4
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.look = "Medium High Contrast"

    bpy.ops.object.camera_add(location=(0, -11.5, 3.0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.2
    camera.rotation_euler = (math.radians(82), 0, 0)
    scene.camera = camera

    for name, location, energy, color, size in (
        ("Warm key", (-4, -5, 7), 900, (1.0, 0.70, 0.32), 5),
        ("Cool fill", (4, -4, 5), 450, (0.65, 0.78, 1.0), 4),
        ("Bronze rim", (3, 3, 6), 950, (1.0, 0.42, 0.10), 3),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        lamp = bpy.context.object
        lamp.name = name
        lamp.data.energy = energy
        lamp.data.color = color
        lamp.data.size = size
        direction = mathutils.Vector((0, 0, 1.5)) - lamp.location
        lamp.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12


def assign(style, materials):
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        role = obj.get("ozama_role", "body")
        if role == "dark":
            selected = materials["obsidian"]
        elif style == "gold":
            selected = materials["deep_gold"] if role == "trim" else materials["gold"]
        else:
            selected = materials["gold"] if role == "trim" else materials["black"]
        obj.data.materials.clear()
        obj.data.materials.append(selected)


def render_piece(piece, style, materials):
    assign(style, materials)
    output_dir = os.path.join(OUTPUT_ROOT, style)
    os.makedirs(output_dir, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(output_dir, f"{piece}.png")
    bpy.ops.render.render(write_still=True)


import mathutils

setup()
materials = {
    "gold": aged_material("OZAMA coral gold", (0.95, 0.56, 0.09), (0.18, 0.035, 0.003), 0.28),
    "deep_gold": aged_material("OZAMA aged bronze", (0.55, 0.20, 0.025), (0.04, 0.006, 0.001), 0.34),
    "black": aged_material("OZAMA forged iron", (0.055, 0.04, 0.028), (0.001, 0.001, 0.001), 0.32),
    "obsidian": aged_material("OZAMA carved recess", (0.008, 0.006, 0.004), (0.0, 0.0, 0.0), 0.38),
}

for piece in PIECES:
    clear_meshes()
    BUILDERS[piece]()
    render_piece(piece, "gold", materials)
    render_piece(piece, "black", materials)

# Preserve an editable comparison scene instead of saving only the last piece.
clear_meshes()
for index, piece in enumerate(PIECES):
    existing = set(bpy.context.scene.objects)
    BUILDERS[piece]()
    offset = (index - 2) * 2.75
    for obj in set(bpy.context.scene.objects) - existing:
        if obj.type == "MESH":
            obj.location.x += offset

camera = bpy.context.scene.camera
camera.data.ortho_scale = 13.5
bpy.context.scene.render.resolution_x = 1600
bpy.context.scene.render.resolution_y = 500
assign("gold", materials)
bpy.context.scene.render.filepath = os.path.join(OUTPUT_ROOT, "gold", "set-preview.png")
bpy.ops.render.render(write_still=True)
assign("black", materials)
bpy.context.scene.render.filepath = os.path.join(OUTPUT_ROOT, "black", "set-preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
print("OZAMA_SET_RENDER_COMPLETE")
