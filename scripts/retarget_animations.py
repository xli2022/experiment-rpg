"""Retarget Quaternius CC0 authored motion; never synthesize a walk cycle.

Called by build_characters.py with the assembled, weighted MakeHuman character.
The source and target face opposite directions, and their bone roll conventions
differ. Calibration aligns the limbs, then motion is transferred in world space.
"""
import bpy
import math
from mathutils import Vector, Matrix, Quaternion

CLIPS = {
    'Idle': 'Idle_Loop', 'Walk': 'Walk_Loop', 'WalkFormal': 'Walk_Formal_Loop',
    'Jog': 'Jog_Fwd_Loop', 'Run': 'Sprint_Loop',
    'JumpStart': 'Jump_Start', 'JumpLoop': 'Jump_Loop', 'JumpLand': 'Jump_Land',
    'ArmedIdle': 'Pistol_Idle_Loop', 'Aim': 'Pistol_Aim_Neutral',
    'AimUp': 'Pistol_Aim_Up', 'AimDown': 'Pistol_Aim_Down',
    'Reload': 'Pistol_Reload', 'Fire': 'Pistol_Shoot',
    'Hit': 'Hit_Chest', 'Driving': 'Driving_Loop',
}

def authored_motion(root, rig, objects):
    previous = set(bpy.data.objects)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(root / 'assets/animations/quaternius/UAL1_Standard.glb'))
    imported = set(bpy.data.objects) - previous
    source = next(obj for obj in imported if obj.type == 'ARMATURE')
    source_actions = {action.name: action for action in bpy.data.actions}
    source.animation_data_clear()
    source.animation_data_create()
    for pb in source.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    facing = Quaternion((0, 0, 1), math.pi)
    mapping = {'Hips': 'pelvis', 'Spine': 'spine_01', 'Chest': 'spine_03', 'Neck': 'neck_01', 'Head': 'Head'}
    for side in ['L', 'R']:
        s = side.lower()
        for target, origin in [('Clavicle','clavicle'),('UpperArm','upperarm'),('Forearm','lowerarm'),('Hand','hand'),('Thigh','thigh'),('Shin','calf'),('Foot','foot')]:
            mapping[target + side] = origin + '_' + s
        for finger, name in enumerate(['thumb', 'index', 'middle', 'ring', 'pinky'], 1):
            for segment in range(1, 4):
                mapping[f'Finger{finger}{segment}{side}'] = f'{name}_{segment:02}_{s}'

    def source_rotation(name):
        return facing @ source.pose.bones[name].matrix.to_quaternion()

    source_rest = {name: facing @ source.data.bones[name].matrix_local.to_quaternion() for name in mapping.values()}
    source_hip = facing @ source.data.bones['pelvis'].head_local

    # Match T-pose limb directions before calculating the motion deltas. Preserve
    # each target's bone lengths and weights; this does not replace the human mesh.
    def aim(name, direction):
        pb = rig.pose.bones[name]
        q = (pb.tail - pb.head).normalized().rotation_difference(direction.normalized())
        pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ pb.matrix.to_3x3().to_4x4()
        bpy.context.view_layer.update()

    for side in ['L', 'R']:
        for prefix in ['Thigh', 'Shin', 'Clavicle', 'UpperArm', 'Forearm', 'Hand']:
            name = prefix + side
            sb = source.data.bones[mapping[name]]
            aim(name, facing @ (sb.tail_local - sb.head_local))
        # Orient the palm from two anatomical axes, avoiding a wrist roll flip.
        def palm_frame(get_point, hand, middle, index, pinky):
            forward = (get_point(middle) - get_point(hand)).normalized()
            across = get_point(index) - get_point(pinky)
            across = (across - forward * across.dot(forward)).normalized()
            normal = across.cross(forward).normalized()
            return Matrix((across, forward, normal)).transposed().to_quaternion()
        dst_frame = palm_frame(lambda n: rig.pose.bones[n].head, 'Hand'+side, 'Finger31'+side, 'Finger21'+side, 'Finger51'+side)
        src_frame = palm_frame(lambda n: facing @ source.data.bones[n].head_local, 'hand_'+side.lower(), 'middle_01_'+side.lower(), 'index_01_'+side.lower(), 'pinky_01_'+side.lower())
        hand = rig.pose.bones['Hand'+side]
        hand.matrix = Matrix.Translation(hand.head) @ (src_frame @ dst_frame.inverted()).to_matrix().to_4x4() @ hand.matrix.to_3x3().to_4x4()
        bpy.context.view_layer.update()
        for finger in range(1, 6):
            for segment in range(1, 4):
                name = f'Finger{finger}{segment}{side}'
                sb = source.data.bones[mapping[name]]
                aim(name, facing @ (sb.tail_local - sb.head_local))

    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier='Armature')
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in objects:
        mod = obj.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig

    rest = {b.name: b.matrix_local.to_quaternion() for b in rig.data.bones}
    local_rest = {b.name: (rest[b.parent.name].inverted() @ rest[b.name]) if b.parent else rest[b.name] for b in rig.data.bones}
    scale = rig.data.bones['Hips'].head_local.z / source_hip.z
    sole_points = {}
    for side in ['L', 'R']:
        name = 'Foot' + side
        inverse = rig.data.bones[name].matrix_local.inverted()
        sole_points[name] = [inverse @ v.co for obj in objects if obj.name.startswith('BootSole' + side) for v in obj.data.vertices]
    rig.animation_data_create()
    clips = []
    for name, source_name in CLIPS.items():
        action = source_actions[source_name]
        source.animation_data.action = action
        source.animation_data.action_slot = action.slots[0]
        duration = (action.frame_range[1] - action.frame_range[0]) / 30
        # Read all source frames before writing a destination action. Blender's
        # dependency graph can otherwise re-evaluate an incomplete output curve.
        frames = []
        count = max(2, round(duration * 30) + 1)
        for i in range(count):
            frame = action.frame_range[0] + i / (count - 1) * (action.frame_range[1] - action.frame_range[0])
            bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
            desired = {dst: source_rotation(src) @ source_rest[src].inverted() @ rest[dst] for dst, src in mapping.items()}
            pose = {}
            for pb in rig.pose.bones:
                parent = desired[pb.parent.name] if pb.parent else Quaternion()
                pose[pb.name] = local_rest[pb.name].inverted() @ parent.inverted() @ desired[pb.name]
            position = facing @ source.pose.bones['pelvis'].head
            displacement = (position - source_hip) * scale
            frames.append((pose, rest['Hips'].inverted() @ displacement))
        output = bpy.data.actions.new('Afterlight_' + name)
        output.use_fake_user = True
        rig.animation_data.action = output
        previous_quat = {}
        for i, (pose, location) in enumerate(frames):
            frame = 1 + i / (count - 1) * duration * 30
            for pb in rig.pose.bones:
                pb.rotation_mode = 'QUATERNION'
                q = pose[pb.name]
                if pb.name in previous_quat and q.dot(previous_quat[pb.name]) < 0:
                    q.negate()
                pb.rotation_quaternion = q
                pb.location = location if pb.name == 'Hips' else (0, 0, 0)
                pb.scale = (1, 1, 1)
                previous_quat[pb.name] = q.copy()
            # Different leg/boot proportions must not put the soles below the
            # pavement during planted steps or the anticipation of a jump.
            bpy.context.view_layer.update()
            minimum = min((rig.pose.bones[name].matrix @ point).z for name, points in sole_points.items() for point in points)
            correction = max(0, -.023 - minimum)
            rig.pose.bones['Hips'].location += rest['Hips'].inverted() @ Vector((0, 0, correction))
            for pb in rig.pose.bones:
                pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
                if pb.name == 'Hips':
                    pb.keyframe_insert('location', frame=frame, group=pb.name)
        clips.append(output)
        print('RETARGETED', name, source_name, 'seconds', round(duration, 3), 'frames', count, flush=True)
    rig.animation_data.action = None
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in source_actions.values():
        bpy.data.actions.remove(action)
    for clip, name in zip(clips, CLIPS):
        clip.name = name
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return clips, scale
