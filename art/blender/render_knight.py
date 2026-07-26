import bpy
import math
import os
from mathutils import Vector


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTPUT_ROOT = os.path.join(ROOT, "public", "assets", "pieces", "blender")
BLEND_PATH = os.path.join(ROOT, "art", "blender", "ozama_knight_master.blend")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(name, color, metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def aged_metal_material(name, light_color, dark_color, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.90
    bsdf.inputs["Roughness"].default_value = roughness

    noise = nodes.new("ShaderNodeTexNoise")
    noise.name = "Forged metal grain"
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.72
    noise.inputs["Distortion"].default_value = 0.12

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "Aged color variation"
    ramp.color_ramp.elements[0].position = 0.24
    ramp.color_ramp.elements[0].color = (*dark_color, 1.0)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (*light_color, 1.0)

    bump = nodes.new("ShaderNodeBump")
    bump.name = "Hammered surface"
    bump.inputs["Strength"].default_value = 0.11
    bump.inputs["Distance"].default_value = 0.038

    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def finish_object(obj, role="body", bevel=0.06):
    obj["ozama_role"] = role
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        if bevel:
            modifier = obj.modifiers.new("Soft forged edges", "BEVEL")
            modifier.width = bevel
            modifier.segments = 3
    return obj


def uv_part(name, location, scale, rotation=(0, 0, 0), role="body", segments=64, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_object(obj, role, 0.035)


def cylinder(name, radius, depth, z, role="body", vertices=96, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_object(obj, role, 0.055)


def cone_part(name, location, radius, depth, rotation=(0, 0, 0), role="body"):
    bpy.ops.mesh.primitive_cone_add(
        vertices=48,
        radius1=radius,
        radius2=0.035,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_object(obj, role, 0.035)


def torus(name, major_radius, minor_radius, z, role="trim", scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=96,
        minor_segments=24,
        location=(0, 0, z),
        major_radius=major_radius,
        minor_radius=minor_radius,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_object(obj, role, 0.025)


def fuse_sculpture(parts):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    sculpture = bpy.context.object
    sculpture.name = "Horse sculpture body"
    sculpture["ozama_role"] = "body"
    sculpture.data.remesh_voxel_size = 0.055
    sculpture.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    for polygon in sculpture.data.polygons:
        polygon.use_smooth = True
    bevel = sculpture.modifiers.new("Carved edge softness", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    return sculpture


def add_knight():
    # Architectural base: broad enough to read clearly on a 56 px chess square.
    cylinder("Base lower", 1.34, 0.20, 0.10, "trim")
    cylinder("Base plinth", 1.22, 0.25, 0.30, "body")
    torus("Base lower ring", 1.03, 0.11, 0.43, "trim", (1.0, 0.72, 1.0))
    cylinder("Base rise", 0.96, 0.42, 0.62, "body", scale=(1.0, 0.76, 1.0))
    torus("Base crown ring", 0.92, 0.10, 0.83, "trim", (1.0, 0.76, 1.0))
    cylinder("Neck collar", 0.82, 0.20, 0.96, "trim", scale=(1.0, 0.75, 1.0))

    # Layered neck creates the heavy S curve of a carved colonial chess piece.
    anatomy = [
        uv_part("Neck root", (0.22, 0.0, 1.55), (0.69, 0.53, 0.94), (0, math.radians(-8), 0)),
        uv_part("Neck middle", (0.43, 0.0, 2.30), (0.54, 0.46, 1.09), (0, math.radians(-15), 0)),
        uv_part("Neck crest", (0.30, 0.0, 3.12), (0.49, 0.43, 0.91), (0, math.radians(18), 0)),
    ]

    # Head and muzzle face left, matching the OZAMA medallion.
    anatomy.extend([
        uv_part("Horse head", (-0.06, -0.01, 3.77), (0.65, 0.48, 0.64), (0, math.radians(-17), 0)),
        uv_part("Horse forehead", (-0.34, -0.01, 3.78), (0.46, 0.42, 0.52), (0, math.radians(-27), 0)),
        uv_part("Horse cheek", (-0.47, -0.02, 3.48), (0.51, 0.48, 0.47), (0, math.radians(-13), 0)),
        uv_part("Horse jaw", (-0.65, 0.0, 3.23), (0.50, 0.39, 0.25), (0, math.radians(-10), 0)),
        uv_part("Nose bridge", (-0.77, -0.01, 3.48), (0.61, 0.38, 0.30), (0, math.radians(-36), 0)),
        uv_part("Horse muzzle", (-1.10, -0.02, 3.18), (0.49, 0.38, 0.34), (0, math.radians(-8), 0)),
        uv_part("Upper lip", (-1.37, -0.01, 3.09), (0.27, 0.31, 0.15), (0, math.radians(-5), 0)),
    ])

    # Ears remain exaggerated so the silhouette survives downscaling.
    anatomy.extend([
        cone_part("Front ear", (-0.31, 0.0, 4.43), 0.19, 0.72, (0, math.radians(-19), math.radians(-5))),
        cone_part("Back ear", (0.08, 0.08, 4.42), 0.18, 0.67, (0, math.radians(7), math.radians(7))),
    ])
    fuse_sculpture(anatomy)

    # Mane plates form a forged-metal rhythm instead of hair-thin geometry.
    mane_points = [
        (0.36, 0.12, 4.13, -18),
        (0.57, 0.12, 3.89, -22),
        (0.70, 0.12, 3.61, -25),
        (0.77, 0.12, 3.30, -28),
        (0.78, 0.12, 2.98, -30),
        (0.72, 0.12, 2.66, -32),
    ]
    for index, (x, y, z, angle) in enumerate(mane_points):
        plate = cone_part(
            f"Mane plate {index + 1}",
            (x, y, z),
            0.25,
            0.62,
            (math.radians(90), math.radians(angle), 0),
            "mane",
        )
        plate.scale.y = 0.42
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Eye, brow and nostril give the bust character without fine texture.
    uv_part("Eye socket", (-0.43, -0.435, 3.87), (0.13, 0.06, 0.11), role="dark", segments=40, rings=20)
    uv_part("Eye glint", (-0.46, -0.485, 3.90), (0.04, 0.022, 0.04), role="highlight", segments=32, rings=16)
    uv_part("Nostril", (-1.26, -0.345, 3.23), (0.105, 0.045, 0.065), role="dark", segments=32, rings=16)
    uv_part("Mouth carving", (-1.19, -0.345, 3.03), (0.28, 0.035, 0.035), (0, 0, math.radians(-5)), "dark")
    uv_part("Brow", (-0.35, -0.38, 4.00), (0.28, 0.06, 0.075), (math.radians(-8), 0, math.radians(-15)), "trim")


def assign_materials(style, mats):
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "ozama_role" not in obj:
            continue
        role = obj["ozama_role"]
        if role == "dark":
            selected = mats["obsidian"]
        elif role == "highlight":
            selected = mats["ivory"] if style == "gold" else mats["gold"]
        elif style == "gold":
            selected = mats["deep_gold"] if role == "mane" else mats["gold"]
        else:
            selected = mats["gold"] if role in {"trim", "mane"} else mats["black_iron"]
        obj.data.materials.clear()
        obj.data.materials.append(selected)


def point_camera(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area(name, location, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_camera(obj, (0, 0, 2.4))


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 3
    scene.eevee.gtao_factor = 1.35
    scene.eevee.use_soft_shadows = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.15
    scene.view_settings.gamma = 1.0

    camera_data = bpy.data.cameras.new("OZAMA orthographic camera")
    camera = bpy.data.objects.new("OZAMA orthographic camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.0, -12.5, 3.05)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 5.65
    camera.data.lens = 52
    point_camera(camera, (-0.02, 0.0, 2.35))
    scene.camera = camera

    add_area("Warm key", (-4.5, -5.5, 8.0), 950, 5.0, (1.0, 0.72, 0.34))
    add_area("Soft fill", (4.2, -4.0, 5.2), 520, 4.2, (0.72, 0.82, 1.0))
    add_area("Bronze rim", (2.8, 3.6, 7.0), 1050, 3.6, (1.0, 0.45, 0.12))

    world = scene.world or bpy.data.worlds.new("OZAMA World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.003, 0.002, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.16


def render_style(style, mats):
    assign_materials(style, mats)
    output_dir = os.path.join(OUTPUT_ROOT, style)
    os.makedirs(output_dir, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(output_dir, "knight.png")
    bpy.ops.render.render(write_still=True)


clear_scene()

mats = {
    "gold": aged_metal_material(
        "OZAMA aged gold",
        (0.92, 0.52, 0.075),
        (0.19, 0.045, 0.006),
        0.27,
    ),
    "deep_gold": aged_metal_material(
        "OZAMA deep bronze",
        (0.44, 0.14, 0.018),
        (0.055, 0.010, 0.002),
        0.34,
    ),
    "black_iron": aged_metal_material(
        "OZAMA forged iron",
        (0.055, 0.042, 0.032),
        (0.0015, 0.001, 0.0007),
        0.31,
    ),
    "obsidian": material("OZAMA obsidian detail", (0.002, 0.0015, 0.001, 1)[:3], 0.35, 0.16),
    "ivory": material("OZAMA warm glint", (1.0, 0.72, 0.18), 0.65, 0.18),
}

add_knight()
setup_scene()
render_style("gold", mats)
render_style("black", mats)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

print("OZAMA_RENDER_COMPLETE")
print(os.path.join(OUTPUT_ROOT, "gold", "knight.png"))
print(os.path.join(OUTPUT_ROOT, "black", "knight.png"))
