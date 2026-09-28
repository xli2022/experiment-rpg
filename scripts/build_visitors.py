"""Export Quaternius CC0 NPC visitors using Blender 4.5 or newer.

Run from any directory:
  blender --background --factory-startup --python scripts/build_visitors.py

The downloaded source files remain unmodified. Native poses, including IK,
are baked into Idle and Walk clips. Runtime controls height and heading.
"""

import json
import math
import statistics
import struct
from pathlib import Path

import bpy
from mathutils import Matrix


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "characters" / "quaternius"
OUTPUT = ROOT / "public" / "models" / "visitors"
SPECS = (
    ("robot-scout", "Robot.blend", "Robot_Idle", "Robot_Walking", 1.62),
    ("robot-worker", "George.gltf", "Idle", "Walk", 1.90),
    ("alien-scout", "Alien.blend", "Alien_Idle", "Alien_Walk", 1.86),
    ("alien-resident", "Alien_Helmet.blend", "Alien_Idle", "Alien_Walk", 1.78),
)


def select(objects):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def pose(rig, action, frame):
    rig.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def bounds(meshes):
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in meshes:
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    return [[min(point[i] for point in points) for i in range(3)],
            [max(point[i] for point in points) for i in range(3)]]


def materials(robot):
    for material in bpy.data.materials:
        # Imported glTF materials are already authored correctly. Retain their
        # colors, maps and emissive accents while adding restrained metalness.
        if material.use_nodes and material.name != "Glass":
            node = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            if robot:
                node.inputs["Metallic"].default_value = .25
                node.inputs["Roughness"].default_value = .58
            continue
        color = tuple(material.diffuse_color)
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Metallic"].default_value = .35 if robot else 0
        shader.inputs["Roughness"].default_value = .48 if robot else .72
        if material.name == "Glass":
            # Alpha blending is intentionally used instead of transmission:
            # the helmet remains clear on WebGL without an environment map.
            shader.inputs["Base Color"].default_value = (.34, .75, .82, .20)
            shader.inputs["Alpha"].default_value = .20
            shader.inputs["Roughness"].default_value = .17
            material.surface_render_method = "BLENDED"
            material.use_backface_culling = True
        elif material.name in {"Eyes", "Black"}:
            shader.inputs["Roughness"].default_value = .24


def geometry_error(actual, expected):
    return max(abs(a - b) for row_a, row_b in zip(actual, expected)
               for a, b in zip(row_a, row_b))


def consolidate(rig, meshes):
    """Turn rigid bone attachments into skin weights, then share material draws."""
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for obj in meshes:
        if obj.parent_type == "BONE":
            bone_name = obj.parent_bone
            world = obj.matrix_world.copy()
            obj.parent_type = "OBJECT"
            obj.parent_bone = ""
            obj.matrix_world = world
            group = obj.vertex_groups.new(name=bone_name)
            group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
            modifier = obj.modifiers.new(name="Armature", type="ARMATURE")
            modifier.object = rig
    select(meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.name = "Visitor"
    return [mesh]


def inspect_glb(path):
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + json_length])
    assert {clip["name"] for clip in doc.get("animations", [])} == {"Idle", "Walk"}
    assert all("uri" not in buffer for buffer in doc.get("buffers", []))
    assert all("uri" not in image for image in doc.get("images", []))
    return doc


def build(spec):
    slug, source_name, idle_name, walk_name, target_height = spec
    path = SOURCE / source_name
    if path.suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
    scene = bpy.context.scene
    rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
    rig.animation_data_create()
    # Imported animation stashes must not blend with the explicitly chosen clip.
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    for obj in list(scene.objects):
        if obj.type not in {"ARMATURE", "MESH"} or (obj.type == "MESH" and not obj.parent):
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    materials(slug.startswith("robot"))
    original_actions = list(bpy.data.actions)
    baked = []
    expected = {}
    root_displacement = {}
    foot_samples = {"Foot.L": [], "Foot.R": []}
    fps = scene.render.fps / scene.render.fps_base
    for output_name, source_action_name in (("Idle", idle_name), ("Walk", walk_name)):
        source_action = bpy.data.actions[source_action_name]
        source_action.name = f"__source_{source_action_name}"
        start, end = map(round, source_action.frame_range)
        frames = (start, (start + end) // 2, end)
        expected[output_name] = {}
        root_samples = []
        root_bone = rig.pose.bones.get("Bone") or rig.pose.bones.get("Root") or next(b for b in rig.pose.bones if not b.parent)
        for frame in range(start, end + 1):
            pose(rig, source_action, frame)
            if frame in frames:
                expected[output_name][frame] = bounds(meshes)
            root_samples.append(list(rig.matrix_world @ root_bone.head))
            if output_name == "Walk":
                for name in foot_samples:
                    if name in rig.pose.bones:
                        foot_samples[name].append(list(rig.matrix_world @ rig.pose.bones[name].head))
        root_displacement[output_name] = math.dist(root_samples[0], root_samples[-1])
        if root_displacement[output_name] > .001:
            raise RuntimeError(f"{slug}/{output_name} has root translation drift")
        pose(rig, source_action, start)
        select([rig])
        bpy.ops.nla.bake(frame_start=start, frame_end=end, step=1,
                        only_selected=False, visual_keying=True,
                        clear_constraints=False, clear_parents=False,
                        use_current_action=False, bake_types={"POSE"})
        action = rig.animation_data.action
        action.name = output_name
        action.use_fake_user = True
        baked.append(action)
    for bone in rig.pose.bones:
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)
    for action in original_actions:
        bpy.data.actions.remove(action)
    # Verify both animation baking and optional draw-call consolidation against
    # evaluated source geometry, not merely the bind-pose bounding box.
    max_error = 0
    for stage in ("baked", "consolidated"):
        if stage == "consolidated":
            meshes = consolidate(rig, meshes)
        for action in baked:
            for frame, source_bounds in expected[action.name].items():
                pose(rig, action, frame)
                error = geometry_error(bounds(meshes), source_bounds)
                max_error = max(max_error, error)
                if error > .002:
                    raise RuntimeError(f"{slug}/{action.name}/{stage}/{frame}: pose error {error}")
    pose(rig, baked[0], 0)
    idle_bounds = bounds(meshes)
    source_height = idle_bounds[1][2] - idle_bounds[0][2]
    # Estimate the stance speed from backward-moving low foot samples.
    stance_speeds = []
    for samples in foot_samples.values():
        if not samples:
            continue
        floor = min(p[2] for p in samples)
        for previous, current in zip(samples, samples[1:]):
            if max(previous[2], current[2]) < floor + source_height * .035:
                speed = (current[1] - previous[1]) * fps
                if speed > .01:
                    stance_speeds.append(speed)
    source_speed = statistics.median(stance_speeds) if stance_speeds else None
    select([rig] + meshes)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / f"{slug}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(destination), export_format="GLB", use_selection=True,
        export_apply=False, export_yup=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_texcoords=True,
        export_normals=True, export_animations=True, export_animation_mode="ACTIONS",
        export_frame_range=False, export_skins=True, export_def_bones=False,
        export_optimize_animation_size=True,
    )
    doc = inspect_glb(destination)
    metadata = {
        "source": source_name,
        "license": "CC0-1.0",
        "author": "Quaternius",
        "sourceHeight": round(source_height, 6),
        "minimumY": round(idle_bounds[0][2], 6),
        "idleBounds": {
            "min": [round(idle_bounds[0][0], 6), round(idle_bounds[0][2], 6), round(-idle_bounds[1][1], 6)],
            "max": [round(idle_bounds[1][0], 6), round(idle_bounds[1][2], 6), round(-idle_bounds[0][1], 6)],
        },
        "headingAdjustment": math.pi,
        "forward": "+Z",
        "triangles": sum(len(p.vertices) - 2 for mesh in meshes for p in mesh.data.polygons),
        "primitives": sum(len(mesh["primitives"]) for mesh in doc["meshes"]),
        "bones": len(rig.data.bones),
        "animations": {action.name: round((action.frame_range[1] - action.frame_range[0]) / fps, 6) for action in baked},
        "sourceAnimations": {"Idle": idle_name, "Walk": walk_name},
        "rootTranslationDrift": {name: round(value, 8) for name, value in root_displacement.items()},
        "maxBakedPoseBoundsError": round(max_error, 8),
        "recommendedHeight": target_height,
        "estimatedWalkSpeed": round(source_speed * target_height / source_height, 4) if source_speed else 1.0,
        "bytes": destination.stat().st_size,
    }
    # Reimport the shipped asset to catch exporter skinning/sampling changes.
    # Four-weight glTF skinning can differ slightly from Blender's unlimited
    # source influences, so use a small source-height-relative tolerance.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = round(fps)
    bpy.ops.import_scene.gltf(filepath=str(destination))
    imported_rig = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    for track in list(imported_rig.animation_data.nla_tracks):
        imported_rig.animation_data.nla_tracks.remove(track)
    # The Blender importer creates an unparented Icosphere as a bone display
    # widget; it is not part of the GLB's rendered character.
    imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent]
    export_error = 0
    for name, samples in expected.items():
        for frame, source_bounds in samples.items():
            pose(imported_rig, bpy.data.actions[name], frame)
            export_error = max(export_error, geometry_error(bounds(imported_meshes), source_bounds))
    if export_error > source_height * .005:
        raise RuntimeError(f"{slug}: exported animation pose error {export_error}")
    metadata["maxExportedPoseBoundsError"] = round(export_error, 8)
    (OUTPUT / f"{slug}.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print("VISITOR_EXPORTED", slug, json.dumps(metadata), flush=True)


for visitor in SPECS:
    build(visitor)
