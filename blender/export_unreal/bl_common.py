"""Blender-side helpers for the Unreal export (pass R4). Runs inside a private headless Blender.

Conventions: glTF is metres, Y up, facing +Z. Blender here is CENTIMETRES (scene unit scale
0.01), Z up, the character facing -Y (the glTF importer's own axis change, C below). A Blender
bone's frame is the glTF joint's frame turned by C: matrix_local = C @ glTFWorld (translation
x100), so the bone runs along the joint's own +Y and a pose bone's basis is
restLocal^-1 @ clipLocal in glTF numbers.
"""
import numpy as np
import bpy
from mathutils import Matrix

import config

C3 = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # glTF -> Blender axes
C4 = np.eye(4)
C4[:3, :3] = C3
CM = 100.0


def to_bl(m):
    """glTF 4x4 (metres) -> Blender 4x4 (cm)."""
    out = C4 @ m
    out[:3, 3] *= CM
    return out


# Bones whose glTF rest frame is the identity and that Unreal treats as component-space frames:
# their FBX frame is Blender's / Unreal's world frame (K = C^-1), so `root` rests with identity
# rotation in Unreal (its root-motion extraction rotates the travel by the inverse of root's
# first-frame rotation: a root turned 90 degrees about X would send travel up). Every other bone
# keeps the glTF joint frame exactly.
WORLD_FRAME_BONES = ('root', 'ik_foot_root', 'ik_hand_root')
K4 = np.eye(4)
K4[:3, :3] = C3.T


def bl_worlds(skel, local):
    """Blender armature-space 4x4 (cm) per bone from glTF locals: C @ W @ K."""
    out = {}
    for n, w in skel.world(local).items():
        out[n] = to_bl(w @ K4) if n in WORLD_FRAME_BONES else to_bl(w)
    return out


def bl_locals(skel, worlds):
    out = {}
    for n in skel.bones:
        p = skel.parent[n]
        out[n] = worlds[n] if p is None else np.linalg.inv(worlds[p]) @ worlds[n]
    return out


def local_cm(m):
    out = np.array(m, float)
    out[:3, 3] *= CM
    return out


def M(a):
    return Matrix([list(map(float, r)) for r in a])


def reset_scene(name='Scene'):
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images,
                 bpy.data.actions, bpy.data.cameras, bpy.data.lights, bpy.data.collections):
        for x in list(coll):
            if getattr(x, 'name', '') in ('Render Result', 'Viewer Node'):
                continue
            coll.remove(x)
    sc = bpy.context.scene
    sc.name = name
    sc.unit_settings.system = 'METRIC'
    # 1.0 while importing (the glTF importer scales by it); export_fbx sets 0.01 (data are in cm)
    sc.unit_settings.scale_length = 1.0
    sc.render.fps = 30
    sc.render.fps_base = 1.0
    return sc


def build_armature(skel, name='Armature'):
    """Armature object `Armature` (Unreal drops a root null of that name) from the skeleton's rest."""
    sc = bpy.context.scene
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    sc.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    for o in sc.objects:
        o.select_set(o == arm)
    rw = bl_worlds(skel, skel.rest_local)
    kids = {}
    for n in skel.bones:
        p = skel.parent[n]
        if p:
            kids.setdefault(p, []).append(n)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for n in skel.bones:
        m = rw[n]
        y = m[:3, 1]
        length = 0.0
        for c in kids.get(n, []):
            d = rw[c][:3, 3] - m[:3, 3]
            along = float(d @ y)
            if along > length and np.linalg.norm(d - along * y) < 0.25 * along:
                length = along
        if length < 1.0:
            length = 5.0 if n not in config.EXTRA_BONES else 10.0
        eb = data.edit_bones.new(n)
        eb.head = (0, 0, 0)
        eb.tail = (0, length, 0)
        eb.matrix = M(m)
        eb.use_deform = n in skel.deform
        eb.use_connect = False
        ebs[n] = eb
    for n in skel.bones:
        p = skel.parent[n]
        if p:
            ebs[n].parent = ebs[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    # how well the bone rests reproduce the glTF joints (Blender stores head / tail / roll in float32)
    err_p = err_r = 0.0
    for b in data.bones:
        a = np.array(b.matrix_local)
        t = rw[b.name]
        err_p = max(err_p, float(np.abs(a[:3, 3] - t[:3, 3]).max()))
        err_r = max(err_r, float(np.abs(a[:3, :3] - t[:3, :3]).max()))
    return arm, rw, (err_p, err_r)


def channelbag(arm, action):
    from bpy_extras import anim_utils
    slot = action.slots.new(id_type='OBJECT', name=arm.name)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    arm.animation_data.action_slot = slot
    return anim_utils.action_ensure_channelbag_for_slot(action, slot)


def key_action(arm, skel, locals_per_frame, name):
    """Action with one key per frame on every bone: basis = restLocal^-1 @ local (cm)."""
    act = bpy.data.actions.new(name)
    cb = channelbag(arm, act)
    nf = len(locals_per_frame)
    frames = np.arange(nf, dtype=float)
    rest = bl_locals(skel, bl_worlds(skel, skel.rest_local))
    anim = [bl_locals(skel, bl_worlds(skel, L)) for L in locals_per_frame]
    for n in skel.bones:
        rinv = np.linalg.inv(rest[n])
        loc = np.empty((nf, 3))
        quat = np.empty((nf, 4))   # w, x, y, z (Blender order)
        prev = None
        for f, L in enumerate(anim):
            b = rinv @ L[n]
            loc[f] = b[:3, 3]
            q = Matrix(b[:3, :3].tolist()).to_quaternion()
            q = np.array([q.w, q.x, q.y, q.z])
            if prev is not None and q @ prev < 0:
                q = -q
            quat[f] = q
            prev = q
        grp = n
        for path, arr in (('location', loc), ('rotation_quaternion', quat)):
            for i in range(arr.shape[1]):
                fc = cb.fcurves.new(f'pose.bones["{n}"].{path}', index=i, group_name=grp)
                fc.keyframe_points.add(nf)
                fc.keyframe_points.foreach_set('co', np.c_[frames, arr[:, i]].ravel().tolist())
                fc.keyframe_points.foreach_set('interpolation', [1] * nf)   # LINEAR
                fc.update()
    sc = bpy.context.scene
    sc.frame_start = 0
    sc.frame_end = nf - 1
    return act


FBX_COMMON = dict(
    use_selection=True,
    apply_unit_scale=True,              # scene unit scale 0.01 -> 1 Blender unit = 1 FBX cm
    apply_scale_options='FBX_SCALE_NONE',
    global_scale=1.0,
    axis_forward='Y',                   # Blender's own axes (FBX: Z up, front -Y, right-handed = 3ds Max's):
                                        # no conversion matrix on any node
    axis_up='Z',
    bake_space_transform=False,
    primary_bone_axis='Y',              # FBX joint frames = the bone frames = the glTF joint frames
    secondary_bone_axis='X',
    armature_nodetype='NULL',           # the armature object is a Null called "Armature"
    use_armature_deform_only=False,     # keep root and the IK bones (they do not deform)
    add_leaf_bones=False,
    use_custom_props=False,
    use_metadata=True,
)


def export_fbx(path, objects, anim=False, **extra):
    for o in bpy.context.scene.objects:
        o.select_set(o in objects)
    bpy.context.view_layer.objects.active = objects[0]
    sc = bpy.context.scene
    sc.unit_settings.scale_length = 0.01
    sc.unit_settings.length_unit = 'CENTIMETERS'
    kw = dict(FBX_COMMON)
    kw.update(object_types={o.type for o in objects})
    if anim:
        kw.update(bake_anim=True, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False,
                  bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True,
                  bake_anim_step=1.0, bake_anim_simplify_factor=0.0)
    else:
        kw.update(bake_anim=False)
    kw.update(extra)
    bpy.ops.export_scene.fbx(filepath=path, **kw)
