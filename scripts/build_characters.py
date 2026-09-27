"""Build Afterlight's rigged characters. Run with Blender 4.5+ in background mode.

Uses CC0 MakeHuman mesh, shape and weight data; see assets/characters/SOURCES.md.
Outputs rigged player/crowd GLBs with authored CC0 motion, and an editable blend.
"""
import bpy
import json
import math
from pathlib import Path
from collections import defaultdict
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'characters' / 'source'
OUTPUT = ROOT / 'public' / 'models'
OUTPUT.mkdir(parents=True, exist_ok=True)
TEXTURES = ROOT / 'assets' / 'characters' / 'textures'
TEXTURES.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

vertices, uvs, groups = [], [], defaultdict(list)
group = 'body'
for line in (SOURCE / 'base.obj').read_text().splitlines():
    a = line.split()
    if not a:
        continue
    if a[0] == 'v':
        vertices.append(Vector(tuple(map(float, a[1:4]))))
    elif a[0] == 'vt':
        uvs.append(tuple(map(float, a[1:3])))
    elif a[0] == 'g':
        group = a[1]
    elif a[0] == 'f':
        groups[group].append([(int(v.split('/')[0]) - 1, int(v.split('/')[1]) - 1) for v in a[1:]])
for filename in ['male.target', 'male-face.target']:
    for line in (SOURCE / filename).read_text().splitlines():
        a = line.split()
        if a and not line.startswith('#'):
            vertices[int(a[0])] += Vector(tuple(map(float, a[1:4])))

body_ids = {v for face in groups['body'] for v, _ in face}
floor = min(vertices[i].y for i in body_ids)
ceiling = max(vertices[i].y for i in body_ids)
scale = 1.91 / (ceiling - floor)
# Blender uses Z up, +Y forward. The GLB export becomes Y up, -Z forward in Three.
vertices = [Vector((-v.x * scale, v.z * scale, (v.y - floor) * scale)) for v in vertices]
rig_data = json.loads((SOURCE / 'default.mhskel').read_text())

def joint(name, end):
    ids = rig_data['joints'][rig_data['bones'][name][end]]
    return sum((vertices[i] for i in ids), Vector()) / len(ids)

bones = {}
def bone(name, head, tail, parent):
    bones[name] = (head.copy(), tail.copy(), parent)

hip = (joint('upperleg01.L', 'head') + joint('upperleg01.R', 'head')) * .5
bone('Hips', hip, joint('spine05', 'tail'), None)
bone('Spine', joint('spine05', 'head'), joint('spine03', 'tail'), 'Hips')
bone('Chest', joint('spine03', 'tail'), joint('neck01', 'head'), 'Spine')
bone('Neck', joint('neck01', 'head'), joint('head', 'head'), 'Chest')
bone('Head', joint('head', 'head'), joint('head', 'tail'), 'Neck')
for side in ['L', 'R']:
    bone('Clavicle' + side, joint('clavicle.' + side, 'head'), joint('upperarm01.' + side, 'head'), 'Chest')
    bone('UpperArm' + side, joint('upperarm01.' + side, 'head'), joint('upperarm02.' + side, 'tail'), 'Clavicle' + side)
    bone('Forearm' + side, joint('lowerarm01.' + side, 'head'), joint('lowerarm02.' + side, 'tail'), 'UpperArm' + side)
    bone('Hand' + side, joint('wrist.' + side, 'head'), joint('wrist.' + side, 'tail'), 'Forearm' + side)
    bone('Thigh' + side, joint('upperleg01.' + side, 'head'), joint('upperleg02.' + side, 'tail'), 'Hips')
    bone('Shin' + side, joint('lowerleg01.' + side, 'head'), joint('lowerleg02.' + side, 'tail'), 'Thigh' + side)
    bone('Foot' + side, joint('foot.' + side, 'head'), joint('toe1-1.' + side, 'tail'), 'Shin' + side)
    for finger in range(1, 6):
        for segment in range(1, 4):
            src = f'finger{finger}-{segment}.{side}'
            name = f'Finger{finger}{segment}{side}'
            parent = 'Hand' + side if segment == 1 else f'Finger{finger}{segment-1}{side}'
            bone(name, joint(src, 'head'), joint(src, 'tail'), parent)

def map_bone(name):
    side = name[-1] if name.endswith(('.L', '.R')) else ''
    if name.startswith('finger'):
        return 'Finger' + name[6:7] + name[8:9] + side
    for prefix, target in [('upperarm', 'UpperArm'), ('lowerarm', 'Forearm'), ('wrist', 'Hand'), ('metacarpal', 'Hand'), ('upperleg', 'Thigh'), ('lowerleg', 'Shin'), ('foot', 'Foot'), ('toe', 'Foot'), ('clavicle', 'Clavicle'), ('shoulder', 'Clavicle')]:
        if name.startswith(prefix):
            return target + side
    if name.startswith('neck'):
        return 'Neck'
    if name in ['spine01', 'spine02'] or name.startswith('breast'):
        return 'Chest'
    if name in ['spine03', 'spine04', 'spine05']:
        return 'Spine'
    if name == 'root' or name.startswith('pelvis'):
        return 'Hips'
    return 'Head'

weights = defaultdict(lambda: defaultdict(float))
for old, entries in json.loads((SOURCE / 'default_weights.mhw').read_text())['weights'].items():
    for index, weight in entries:
        weights[index][map_bone(old)] += weight
for index, data in weights.items():
    strongest = sorted(data.items(), key=lambda pair: -pair[1])[:4]
    total = sum(v for _, v in strongest)
    weights[index] = {k: v / total for k, v in strongest if v > .001}

armature = bpy.data.armatures.new('VexSkeleton')
rig = bpy.data.objects.new('VexRig', armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, (head, tail, parent) in bones.items():
    b = armature.edit_bones.new(name)
    b.head, b.tail = head, tail
    if (tail - head).length < .005:
        b.tail.z += .015
    b.align_roll(Vector((0, 1, 0)))
    if parent:
        b.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.select_set(False)

def material(name, color, roughness=.65, metallic=0, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return m

skin = material('Skin', (1, 1, 1), .67)
skin_image = bpy.data.images.load(str(SOURCE / 'skin.png'))
skin_image.scale(1024, 1024)
skin_image.filepath_raw = str(TEXTURES / 'vex-skin.jpg')
skin_image.file_format = 'JPEG'
skin_image.save()
skin_tex = skin.node_tree.nodes.new('ShaderNodeTexImage')
skin_tex.image = skin_image
skin.node_tree.links.new(skin_tex.outputs['Color'], skin.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
skin.node_tree.nodes['Principled BSDF'].inputs['Subsurface Weight'].default_value = .035
jacket = material('Jacket', (1, 1, 1), .84)
pants = material('Trousers', (1, 1, 1), .92)
rubber = material('BootsAndGloves', (.014, .019, .025), .7)
hardware = material('Hardware', (.16, .205, .23), .37, .72)
hair = material('Hair', (.014, .010, .009), .74)
stripe = material('ReflectiveTrim', (.42, .59, .55), .43, .25)
light = material('CyberLight', (.12, .73, .64), .4, .3, 1.7)
iris = material('Iris', (.07, .19, .16), .26)
eye_white = material('EyeWhite', (.73, .7, .64), .27)
hair_image = bpy.data.images.load(str(SOURCE / 'short04_diffuse.png'))
hair_image.scale(1024, 1024)
hair_image.filepath_raw = str(TEXTURES / 'hair.png')
hair_image.file_format = 'PNG'
hair_image.save()
hair_map = hair.node_tree.nodes.new('ShaderNodeTexImage')
hair_map.image = hair_image
hair.node_tree.links.new(hair_map.outputs['Color'], hair.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
hair.node_tree.links.new(hair_map.outputs['Alpha'], hair.node_tree.nodes['Principled BSDF'].inputs['Alpha'])
hair.surface_render_method = 'DITHERED'
hair.use_backface_culling = False

# The garment has authored folds, seams, buttons and pockets, with shared UV maps.
outfit_image = bpy.data.images.load(str(SOURCE / 'male_casualsuit05_diffuse.png'))
outfit_image.scale(1024, 1024)
outfit_image.filepath_raw = str(TEXTURES / 'outfit-color.jpg')
outfit_image.file_format = 'JPEG'
outfit_image.save()
outfit_normal = bpy.data.images.load(str(SOURCE / 'male_casualsuit05_normal.png'))
outfit_normal.colorspace_settings.name = 'Non-Color'
outfit_normal.scale(1024, 1024)
outfit_normal.filepath_raw = str(TEXTURES / 'outfit-normal.png')
outfit_normal.file_format = 'PNG'
outfit_normal.save()
for mat in [jacket, pants]:
    color_map = mat.node_tree.nodes.new('ShaderNodeTexImage')
    color_map.image = outfit_image
    normal_map = mat.node_tree.nodes.new('ShaderNodeTexImage')
    normal_map.image = outfit_normal
    normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = .65
    mat.node_tree.links.new(color_map.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    mat.node_tree.links.new(normal_map.outputs['Color'], normal.inputs['Color'])
    mat.node_tree.links.new(normal.outputs['Normal'], mat.node_tree.nodes['Principled BSDF'].inputs['Normal'])

objects = []
def bind(obj, bone_name=None, source_indices=None):
    obj.parent = rig
    for name in bones:
        obj.vertex_groups.new(name=name)
    if bone_name:
        obj.vertex_groups[bone_name].add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    else:
        for i, old in enumerate(source_indices):
            for name, value in weights.get(old, {'Hips': 1}).items():
                obj.vertex_groups[name].add([i], value, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    objects.append(obj)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj

def surface(name, source_faces, mat, inflate=0, rigid=None):
    ids = sorted({v for face in source_faces for v, _ in face})
    lookup = {v: i for i, v in enumerate(ids)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([vertices[i] for i in ids], [], [[lookup[v] for v, _ in f] for f in source_faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    layer = mesh.uv_layers.new(name='UVMap')
    for polygon, face in zip(mesh.polygons, source_faces):
        for loop, (_, uv) in zip(polygon.loop_indices, face):
            layer.data[loop].uv = uvs[uv]
    if inflate:
        for v in mesh.vertices:
            n = v.normal.copy()
            wrinkle = 1 + .14 * math.sin(v.co.z * 76 + v.co.x * 15)
            v.co += n * inflate * wrinkle
    return bind(obj, rigid, ids)

def bone_share(face, prefixes):
    return sum(sum(value for name, value in weights[v].items() if name.startswith(prefixes)) for v, _ in face) / len(face)

skin_faces, glove_faces = [], []
for face in groups['body']:
    if bone_share(face, ('Head', 'Neck')) > .20:
        skin_faces.append(face)
    elif bone_share(face, ('Hand', 'Finger')) > .45:
        glove_faces.append(face)

surface('FaceAndNeck', skin_faces, skin)
surface('ArticulatedGloves', glove_faces, rubber, .0012)

# Fit the CC0 garment's barycentric attachment map to the morphed body. This
# preserves the authored garment silhouette and transfers all joint influences.
axis_scales = {}
attachments = []
reading_vertices = False
for line in (SOURCE / 'male_casualsuit05.mhclo').read_text().splitlines():
    a = line.split()
    if not a or a[0].startswith('#'):
        continue
    if a[0] in ['x_scale', 'y_scale', 'z_scale']:
        axis = {'x_scale': 0, 'y_scale': 2, 'z_scale': 1}[a[0]]
        axis_scales[a[0]] = abs(vertices[int(a[1])][axis] - vertices[int(a[2])][axis]) / float(a[3])
    elif a[0] == 'verts':
        reading_vertices = True
    elif a[0] == 'delete_verts':
        reading_vertices = False
    elif reading_vertices:
        attachments.append((list(map(int, a[:3])), list(map(float, a[3:6])), list(map(float, a[6:9]))))
vertex_offset = len(vertices)
for indices, factors, offset in attachments:
    pos = sum((vertices[i] * f for i, f in zip(indices, factors)), Vector())
    pos += Vector((-offset[0] * axis_scales['x_scale'], offset[2] * axis_scales['z_scale'], offset[1] * axis_scales['y_scale']))
    if pos.z < .35:
        # Tuck the trouser cuffs into the original tall boots.
        ankle = bones['FootR' if pos.x > 0 else 'FootL'][0]
        blend = min(1, max(0, (.35 - pos.z) / .09))
        pos.x += (ankle.x + max(-.049, min(.049, pos.x - ankle.x)) - pos.x) * blend
        pos.y += (ankle.y + max(-.052, min(.052, pos.y - ankle.y)) - pos.y) * blend
    influences = defaultdict(float)
    for i, factor in zip(indices, factors):
        for name, value in weights[i].items():
            influences[name] += max(0, factor) * value
    strongest = sorted(influences.items(), key=lambda pair: -pair[1])[:4]
    total = sum(value for _, value in strongest)
    weights[len(vertices)] = {name: value / total for name, value in strongest if value > 0}
    vertices.append(pos)
uv_offset = len(uvs)
jacket_faces, pants_faces = [], []
for line in (SOURCE / 'male_casualsuit05.obj').read_text().splitlines():
    a = line.split()
    if not a:
        continue
    if a[0] == 'vt':
        uvs.append(tuple(map(float, a[1:3])))
    elif a[0] == 'f':
        face = [(vertex_offset + int(v.split('/')[0]) - 1, uv_offset + int(v.split('/')[1]) - 1) for v in a[1:]]
        center_z = sum(vertices[i].z for i, _ in face) / len(face)
        (pants_faces if center_z < 1.045 else jacket_faces).append(face)
surface('TailoredUtilityJacket', jacket_faces, jacket)
surface('DenimTrousers', pants_faces, pants)
outfit_ids = set(range(vertex_offset, len(vertices)))

def ellipsoid(name, pos, dims, mat, bone_name, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Bake location into the mesh: rigid weights are expressed in the rig's coordinates.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(mat)
    return bind(obj, bone_name)

def bevel_box(name, pos, dims, mat, bone_name, bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(mat)
    mod = obj.modifiers.new('TailoredEdges', 'BEVEL')
    mod.width = bevel
    mod.segments = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return bind(obj, bone_name)

def tube(name, points, radius, mat, bone_name):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.data.materials.append(mat)
    obj.select_set(False)
    return bind(obj, bone_name)

def loft(name, rings, mat, bone_name, segments=24):
    points, faces = [], []
    for x, y, z, rx, ry in rings:
        for i in range(segments):
            theta = i * math.tau / segments
            points.append((x + math.cos(theta) * rx, y + math.sin(theta) * ry, z))
    for ring in range(len(rings) - 1):
        for i in range(segments):
            a = ring * segments + i
            b = ring * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces += [tuple(reversed(range(segments))), tuple(range((len(rings) - 1) * segments, len(rings) * segments))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    return bind(obj, bone_name)

# Detailed eyes sit inside the anatomical eyelids, rather than on a flat face.
for side in ['L', 'R']:
    center = joint('eye.' + side, 'head')
    ellipsoid('Eye' + side, center, (.012, .012, .012), eye_white, 'Head')
    ellipsoid('Iris' + side, center + Vector((0, .0114, 0)), (.0057, .0015, .0057), iris, 'Head', 14, 8)
    ellipsoid('Pupil' + side, center + Vector((0, .0128, 0)), (.0026, .0007, .0026), rubber, 'Head', 12, 6)

# Fit alpha-textured hair cards to the same head morphology.
hair_start = len(vertices)
hair_uv_start = len(uvs)
hair_scales = {}
hair_reading = False
for line in (SOURCE / 'short04.mhclo').read_text().splitlines():
    a = line.split()
    if not a or a[0].startswith('#'):
        continue
    if a[0] in ['x_scale', 'y_scale', 'z_scale']:
        axis = {'x_scale': 0, 'y_scale': 2, 'z_scale': 1}[a[0]]
        hair_scales[a[0]] = abs(vertices[int(a[1])][axis] - vertices[int(a[2])][axis]) / float(a[3])
    elif a[0] == 'verts':
        hair_reading = True
    elif a[0] == 'delete_verts':
        hair_reading = False
    elif hair_reading and a[0].isdigit() and len(a) == 9:
        ids, factors, offsets = list(map(int, a[:3])), list(map(float, a[3:6])), list(map(float, a[6:9]))
        pos = sum((vertices[i] * f for i, f in zip(ids, factors)), Vector())
        pos += Vector((-offsets[0] * hair_scales['x_scale'], offsets[2] * hair_scales['z_scale'], offsets[1] * hair_scales['y_scale']))
        vertices.append(pos)
hair_faces = []
for line in (SOURCE / 'short04.obj').read_text().splitlines():
    a = line.split()
    if a and a[0] == 'vt':
        uvs.append(tuple(map(float, a[1:3])))
    elif a and a[0] == 'f':
        hair_faces.append([(hair_start + int(v.split('/')[0]) - 1, hair_uv_start + int(v.split('/')[1]) - 1) for v in a[1:]])
surface('SweptHair', hair_faces, hair, rigid='Head')

neck = bones['Neck'][0]

# Find the skin surface before adding fitted panels and seam piping.
def surface_y(x, z, front=True):
    near = [vertices[i].y for i in outfit_ids if abs(vertices[i].x - x) < .045 and abs(vertices[i].z - z) < .035]
    return (max(near) if front else min(near)) if near else (.105 if front else -.1)

chest_z = (bones['Chest'][0].z + bones['Neck'][0].z) * .5
waist_z = hip.z + .035
back_y = surface_y(0, chest_z, False) - .025
bevel_box('BackPanel', (0, back_y, chest_z), (.29, .024, .31), rubber, 'Chest', .018)
for x in [-.112, 0, .112]:
    bevel_box('BackPanelChannel', (x, back_y - .016, chest_z), (.009, .008, .23), hardware, 'Chest', .003)
bevel_box('SpineInterface', (0, back_y - .022, chest_z + .086), (.10, .016, .036), hardware, 'Chest', .007)
bevel_box('SpineStatusLight', (0, back_y - .032, chest_z + .089), (.071, .004, .006), light, 'Chest', .002)
for side in [-1, 1]:
    pts = [(side * .18, surface_y(side * .18, chest_z + .12, False) - .023, chest_z + .12), (side * .13, back_y - .005, chest_z + .16), (0, back_y - .005, chest_z + .16)]
    tube('JacketYokeSeam', pts, .002, stripe, 'Chest')

for side in ['L', 'R']:
    ankle = bones['Foot' + side][0]
    x, y = ankle.x, ankle.y
    z0 = max(.008, ankle.z - .091)
    loft('CombatBoot' + side, [(x, y + .045, z0, .064, .132), (x, y + .045, z0 + .055, .067, .133), (x, y + .035, z0 + .10, .064, .111), (x, y, z0 + .17, .062, .067), (x, y, z0 + .25, .064, .064)], rubber, 'Foot' + side)
    loft('BootSole' + side, [(x, y + .045, z0 - .01, .07, .139), (x, y + .045, z0 + .024, .07, .139)], rubber, 'Foot' + side)
    for k in range(4):
        z = z0 + .12 + k * .027
        tube('BootLaces', [(x - .035, y + .069, z), (x + .035, y + .069, z + .018)], .0025, hardware, 'Foot' + side)

temple = joint('eye.R', 'head') + Vector((.05, -.023, 0))
bevel_box('TempleImplant', temple, (.012, .035, .022), hardware, 'Head', .005)
bevel_box('TempleIndicator', temple + Vector((.008, .006, 0)), (.004, .019, .003), light, 'Head', .001)

print('CHARACTER_MESHES_CREATED', len(objects), flush=True)

# Authored CC0 clips replace the earlier procedural poses and sine-wave gait.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from retarget_animations import authored_motion
clips, motion_scale = authored_motion(ROOT, rig, objects)

def reset_pose():
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

def select_only(selected):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in selected:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]

# Export separate materials, but consolidate the many accessories into one skinned object.
select_only(objects)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
hero = bpy.context.object
hero.name = 'VexCharacter'
objects = [hero]
select_only([rig, hero])
export_options = dict(export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_materials='EXPORT', export_cameras=False, export_lights=False, export_texcoords=True, export_normals=True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'vex.glb'), export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False, export_skins=True, export_def_bones=True, **export_options)
print('EXPORTED_PLAYER', flush=True)

# Full-resolution skinned crowd: each pedestrian plays the original smooth
# authored clips. The previous eight-pose morph/decimation path is retired.
reset_pose()
crowd = hero.copy()
crowd.data = hero.data.copy()
crowd.name = 'Citizen'
bpy.context.collection.objects.link(crowd)
hero.hide_render = True
select_only([rig, crowd])
bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'citizen.glb'), export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False, export_skins=True, export_def_bones=True, **export_options)
hero.hide_render = False
print('EXPORTED_CROWD', flush=True)

# Hair cards use a cutout in the browser to avoid transparent sorting artifacts.
import struct
for filename in ['vex.glb', 'citizen.glb']:
    path = OUTPUT / filename
    data = path.read_bytes()
    json_length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + json_length])
    for mat in doc['materials']:
        if mat['name'] == 'Hair':
            mat['alphaMode'] = 'MASK'
            mat['alphaCutoff'] = .38
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    remainder = data[20 + json_length:]
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, 20 + len(encoded) + len(remainder)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + remainder)

metadata = {'height': round(max(v.co.z for v in hero.data.vertices) - min(v.co.z for v in hero.data.vertices), 4), 'bones': len(bones), 'clips': [a.name for a in clips], 'hero_triangles': sum(len(p.vertices) - 2 for p in hero.data.polygons), 'crowd_triangles': sum(len(p.vertices) - 2 for p in crowd.data.polygons), 'animation_source': 'Quaternius Universal Animation Library Standard v3', 'motion_scale': motion_scale, 'motion_speeds': {'Walk': .975 * motion_scale, 'WalkFormal': .975 * motion_scale, 'Jog': (5 / (.9333333333333333)) * motion_scale, 'Run': 8.25 * motion_scale}}
(OUTPUT / 'characters.json').write_text(json.dumps(metadata, indent=2))
print('CHARACTER_STATS', json.dumps(metadata), flush=True)

# A saved source file is useful for subsequent sculpting, material work and animation.
crowd.hide_render = True
crowd.hide_set(True)
select_only([rig, hero])
rig.animation_data.action = clips[0]
bpy.context.scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets' / 'characters' / 'afterlight-characters.blend'))

# Render a neutral three-quarter view for visual review.
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.world.color = (.15, .15, .15)
scene.view_settings.view_transform = 'AgX'
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.04))
ground = bpy.context.object
ground.data.materials.append(material('StudioFloor', (.045, .052, .065), .85))
for name, location, energy, color, size in [('Key', (3, 4, 5), 550, (1, .9, .8), 4), ('Fill', (-3, 2, 2.6), 330, (.64, .8, 1), 3), ('Rim', (0, -3, 3.5), 650, (.46, .9, 1), 2.2)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add(location=(2.9, 5.5, 2.4))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 1.04)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.35
scene.camera = camera
(ROOT / 'test-results').mkdir(exist_ok=True)
scene.render.filepath = str(ROOT / 'test-results' / 'character-blender-front.png')
bpy.ops.render.render(write_still=True)
camera.location = (2.7, -5.5, 2.5)
camera.rotation_euler = (Vector((0, 0, 1.04)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = str(ROOT / 'test-results' / 'character-blender-back.png')
bpy.ops.render.render(write_still=True)
print('CHARACTERS_COMPLETE', flush=True)
