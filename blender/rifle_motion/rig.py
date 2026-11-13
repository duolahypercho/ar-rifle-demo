"""The scene: the character (skeleton and skinned body), a gun (the rifle, or the shotgun to check
the same holds on it), and a control rig.

The rig is a second armature built from the skeleton's joint positions. Its bones carry the
CANONICAL frames (skel.py: the bone's rest frame turned back to the world axes, rest matrix QC in
B), so the authoring math keys canonical local rotations, which are the old skeleton's:

  FK-<bone>         root, pelvis, spine, neck, head, clavicles, jaw, eyes, metacarpals and fingers
                    (UE5 names), canonical frames, so their rotations are the canonical local
                    rotations. FK-pelvis is the pelvis control, FK-spine_05 the chest control.
                    spine_02 / spine_04 / neck_02 and the metacarpals are never keyed (the exact
                    mapping: the old Spine / Spine1 / Neck bend sits on spine_01 / 03 / neck_01).
  thigh/shin.L/R    leg chain along the limb, IK onto ankle_tgt with a knee pole
  foot_ctrl.L/R     the foot on the ground (move, turn), with a heel roll: heel_pivot lifts the
                    toes about the back of the heel, ball_pivot lifts the heel about the ball.
                    toe_tgt keeps the toes flat while the heel is up.
  upper_arm/forearm two-bone IK onto hand_tgt, keyed every frame wherever the hand has to be (on
                    a grip of a gun, on the magazine, reaching back for the slung gun); elbow_pole
                    on the chest, keyed too, so an elbow can rise to reach over the shoulder.
  gun               the gun in the hands (butt at the bone's head), a child of the chest
                    control: what the clips' Gun track records.
  gun2              the other gun, slung across the back (carry.STOW), or coming off it in a
                    swap: the swap clips' GunIn track.

The gun's loose parts are animated as objects: the rifle's magazine and charging handle, the
shotgun's pump, and a shell (a plain cylinder, as the game's) carried to the loading port.

Every skeleton bone the rig drives copies the world transform of an SK-<bone>: a child of its
canonical rig counterpart (FK-, ORG-, foot., toe., hand.) that carries the skeleton bone's own rest
frame, so the real bone = canonical turn * R[b]. The twist bones have no constraint: they follow
their parents, and bake.key_twist keys their share of the twist on the skeleton for review; the
IK bones stay at rest in Blender (written by bake.export).
"""
import pathlib

import bpy
from mathutils import Matrix, Quaternion, Vector

from . import carry as carry_mod
from . import body, pouch
from .skel import C4, QC, SIDE, b2g, bone as side_bone, g2b, is_finger, rot_b

PROJECT = pathlib.Path(__file__).resolve().parents[2]
SIDES = (('Left', 'L'), ('Right', 'R'))
# limb joints driven through IK chains rather than copied one-for-one
LIMB = ('thigh', 'calf', 'foot', 'ball', 'upperarm', 'lowerarm', 'hand')
_R = body.T['rig']  # (per body)
TOE_TIP = _R['toeTip']  # m, ball of the foot to the tip of the toes
# The pivots of the heel roll, from the ankle's ground point (B): the back of the heel and the
# ball joint, the points the game's review watches for sliding, so that rolling keeps them still.
HEEL_PIVOT = Vector(_R['heelPivot'])
BALL_DROP = _R.get('ballPivotDrop', 0.0)  # m the ball pivot sits under the ball joint (per body)
PREBEND = _R['prebend']  # m the rig's knees (forward) and elbows (back) are bent at rest
SOLE_Y = body.T['legs'].get('soleY', 0.0)  # the ground under the canonical pose's soles (G y)


def clear_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.collections):
        for item in list(coll):
            coll.remove(item)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in bpy.data.objects if o not in before]


def source_of(joint):
    """The canonical rig bone a skeleton bone follows (through its SK- child)."""
    for side, s in SIDES:
        if joint.endswith('_' + SIDE[side]):
            part = joint[:-2]
            if part in ('thigh', 'calf', 'upperarm', 'lowerarm'):
                return 'ORG-' + joint
            if part == 'foot':
                return 'foot.' + s
            if part == 'ball':
                return 'toe.' + s
            if part == 'hand':
                return 'hand.' + s
    return 'FK-' + joint


class _Canon:
    """A skeleton bone as the rig sees it: its head in the CANONICAL pose and the frame its SK- bone
    carries there (B). For a body bound in the canonical I-pose that is the Blender bone itself; for
    one bound in another pose (Tripo's T-pose) the head is the canonical joint and the frame is the
    bind frame turned by A[b] = R[b] * bindWorld[b]^-1, so that copying it puts the bone at R[b]."""

    def __init__(self, bone, skel):
        name = bone.name
        self.length = bone.length
        self.head_local = g2b(skel.head[name])
        turn = rot_b((skel.R[name] @ skel.rest_world[name].inverted()).normalized())
        self.matrix_local = Matrix.Translation(self.head_local) @ (turn.to_matrix() @ bone.matrix_local.to_3x3()).to_4x4()


def _bone(eb, name, head, tail, parent=None, roll_to=None, connect=False):
    b = eb.new(name)
    b.head, b.tail = head, tail
    if roll_to is not None:
        b.align_roll(roll_to)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b


def _copy(eb, name, source, parent=None, matrix=None):
    """A bone with the CANONICAL frame at the skeleton bone `source`'s head (or `matrix`), same
    length: rest matrix (B) = translation to the head times QC."""
    b = eb.new(name)
    b.head, b.tail = (0, 0, 0), (0, source.length, 0)
    b.matrix = matrix if matrix is not None else Matrix.Translation(source.head_local) @ C4
    if parent:
        b.parent = eb[parent]
    return b


def _real(eb, name, source, parent):
    """A bone with the skeleton bone `source`'s own rest frame (its real UE5 frame)."""
    b = eb.new(name)
    b.head, b.tail = (0, 0, 0), (0, source.length, 0)
    b.matrix = source.matrix_local.copy()
    b.parent = eb[parent]
    return b


def _import_gun(gun):
    """Imports a gun and measures it (G, the gun's own frame as imported)."""
    spec = carry_mod.GUNS[gun]
    objs = import_glb(PROJECT / spec['file'])
    bpy.context.view_layer.update()
    weapon_root = next(o for o in objs if o.name.startswith('weapon_root'))
    parts = {o.name.split('.')[0]: o for o in objs}
    pad = parts[spec['butt']]
    corners = [b2g(pad.matrix_world @ Vector(c)) for c in pad.bound_box]
    lo, hi = min(c.y for c in corners), max(c.y for c in corners)
    butt = Vector((0, lo + (hi - lo) * 0.62, max(c.z for c in corners)))  # as weapon.js measures it
    info = {
        'name': gun,
        'butt': butt,
        'meshes': [o for o in objs if o.type == 'MESH'],
        'pad': spec['butt'],
        'parts': parts,
        'root': weapon_root,
        'w0': weapon_root.matrix_world.copy(),
    }
    if 'receiver' in parts:
        # the shotgun's loading port, as shotgun.js finds it: under the receiver, 45 % back
        rc = [b2g(parts['receiver'].matrix_world @ Vector(c)) for c in parts['receiver'].bound_box]
        z0, z1 = min(c.z for c in rc), max(c.z for c in rc)
        info['port'] = Vector((0, min(c.y for c in rc), z0 + (z1 - z0) * 0.45))
    for node in ('grip_main', 'grip_support', 'muzzle_point', 'eject_point'):
        info[node.replace('_point', '')] = b2g(parts[node].matrix_world.translation)
    # (the loose parts' rest places, in the gun's frame, for the reloads)
    for node in spec.get('loose', ()):
        info[node] = b2g(parts[node].matrix_world.translation)
    return info


def _mount(scene, rig, bone, info):
    """Hangs a gun's meshes on a rig bone: an empty copies the bone, and the gun's root hangs
    under it shifted so that the butt is at the bone's head."""
    mount = bpy.data.objects.new(bone + '_mount', None)
    scene.collection.objects.link(mount)
    c = mount.constraints.new('COPY_TRANSFORMS')
    c.target, c.subtarget = rig, bone
    root = info['root']
    root.parent = mount
    root.matrix_parent_inverse = Matrix.Identity(4)
    root.matrix_basis = C4.inverted() @ Matrix.Translation(-g2b(info['butt'])) @ info['w0']
    return mount


def build(body_path, gun, skeleton_g):
    """Builds everything for `gun` ('rifle' or 'shotgun', carry.GUNS) in the hands, with the other
    gun slung on the back. Returns the objects and the carries (carry.Carry), whose place() gives
    a gun's butt, rotation and both wrist targets."""
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = 30

    objs = import_glb(body_path)
    skeleton = next(o for o in objs if o.type == 'ARMATURE')
    body = next(o for o in objs if o.type == 'MESH' and o.parent == skeleton)
    skeleton.name, body.name = 'skeleton', 'body'
    for pb in skeleton.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    other = next(g for g in carry_mod.GUNS if g != gun)
    info = _import_gun(gun)
    info2 = _import_gun(other)

    rig_data = bpy.data.armatures.new('rig')
    rig = bpy.data.objects.new('rig', rig_data)
    scene.collection.objects.link(rig)
    rig.show_in_front = True
    rig_data.display_type = 'STICK'
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig_data.edit_bones
    sb = skeleton.data.bones
    if skeleton_g.posed_bind:  # (the rig is built on the canonical pose, not the bind)
        sb = {b.name: _Canon(b, skeleton_g) for b in skeleton.data.bones}
    joint = {name: sb[name].head_local.copy() for name in skeleton_g.joints}  # B
    up, forward, back = Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((0, 1, 0))

    _bone(eb, 'root', Vector((0, 0, 0)), Vector((0, 0.35, 0)), roll_to=up)
    limb = {side_bone(side, part) for side, _ in SIDES for part in LIMB}
    for name in skeleton_g.authored:
        if name in limb or is_finger(name):
            continue  # (fingers are added once the hands exist)
        parent = skeleton_g.parent[name]
        _copy(eb, 'FK-' + name, sb[name], 'root' if parent is None else 'FK-' + parent)

    chest_pos = b2g(joint['spine_05'])
    carry = carry_mod.Carry(gun, info)
    carry2 = carry_mod.Carry(other, info2)
    for c, gi in ((carry, info), (carry2, info2)):
        # (the loose parts and the loading port, gun frame, for the reloads)
        c.parts = {k: gi[k] for k in (*carry_mod.GUNS[gi['name']].get('loose', ()), 'port') if k in gi}
        c.parts_grip_main, c.parts_grip_support = gi['grip_main'], gi['grip_support']
    hold = carry.place(chest_pos, Quaternion())
    slung = carry2.stowed(chest_pos, Quaternion())
    for side, s in SIDES:
        J = lambda part: side_bone(side, part)  # noqa: E731
        hip, knee, ankle, ball = (joint[J(p)] for p in ('thigh', 'calf', 'foot', 'ball'))
        # (Blender's IK cannot bend a chain that is dead straight at rest, as the skeleton's
        # legs and arms are, so the rig's knees and elbows are bent by a few millimetres; the
        # ORG bones aim the skeleton's limbs at the rig's joints, so nothing is lost.)
        bent = knee + forward * PREBEND
        _bone(eb, 'thigh.' + s, hip, bent, 'FK-pelvis', roll_to=forward)
        _bone(eb, 'shin.' + s, bent, ankle, 'thigh.' + s, roll_to=forward, connect=True)
        _copy(eb, 'ORG-' + J('thigh'), sb[J('thigh')], 'thigh.' + s)
        _copy(eb, 'ORG-' + J('calf'), sb[J('calf')], 'shin.' + s)
        _copy(eb, 'foot.' + s, sb[J('foot')], 'shin.' + s)
        _copy(eb, 'toe.' + s, sb[J('ball')], 'foot.' + s)
        ground = Vector((ankle.x, ankle.y, SOLE_Y))
        _bone(eb, 'foot_ctrl.' + s, ground, ground + Vector((0, -0.16, 0)), 'root', roll_to=up)
        heel = ground + HEEL_PIVOT
        _bone(eb, 'heel_pivot.' + s, heel, heel + Vector((0, -0.05, 0)), 'foot_ctrl.' + s, roll_to=up)
        # (a bare foot rolls about the sole under the ball, not the joint above it: BALL_DROP)
        ball_p = ball - Vector((0, 0, BALL_DROP))
        _bone(eb, 'ball_pivot.' + s, ball_p, ball_p + Vector((0, -0.05, 0)), 'heel_pivot.' + s, roll_to=up)
        _copy(eb, 'ankle_tgt.' + s, sb[J('foot')], 'ball_pivot.' + s)
        _copy(eb, 'toe_tgt.' + s, sb[J('ball')], 'heel_pivot.' + s)
        # (far ahead, so that a foot kicked up behind at a run still bends its knee forward
        # rather than out to the side)
        out = 0.12 if s == 'L' else -0.12
        pole = Vector((knee.x + out, knee.y - 1.2, knee.z))
        _bone(eb, 'knee_pole.' + s, pole, pole + Vector((0, -0.08, 0)), 'foot_ctrl.' + s, roll_to=up)

        shoulder, elbow, wrist = (joint[J(p)] for p in ('upperarm', 'lowerarm', 'hand'))
        bent = elbow + back * PREBEND
        _bone(eb, 'upper_arm.' + s, shoulder, bent, 'FK-' + J('clavicle'), roll_to=back)
        _bone(eb, 'forearm.' + s, bent, wrist, 'upper_arm.' + s, roll_to=back, connect=True)
        _copy(eb, 'ORG-' + J('upperarm'), sb[J('upperarm')], 'upper_arm.' + s)
        _copy(eb, 'ORG-' + J('lowerarm'), sb[J('lowerarm')], 'forearm.' + s)
        _copy(eb, 'hand.' + s, sb[J('hand')], 'forearm.' + s)
        pole = shoulder + g2b(carry.pole[side].normalized() * 0.5)  # elbows down, out and back as the game has them
        _bone(eb, 'elbow_pole.' + s, pole, pole + Vector((0, 0, 0.06)), 'FK-spine_05', roll_to=back)

    # the guns, at the rest carry and slung; a gun bone's frame is the gun's own axes (turned into
    # B). The hand targets are keyed in the armature's frame every frame (keys.py).
    gun_matrix = Matrix.Translation(g2b(hold['butt'])) @ (QC @ hold['quat']).to_matrix().to_4x4()
    _copy(eb, 'gun', sb['spine_05'], 'FK-spine_05', gun_matrix)
    _copy(eb, 'gun2', sb['spine_05'], 'FK-spine_05', Matrix.Translation(g2b(slung['butt'])) @ (QC @ slung['quat']).to_matrix().to_4x4())
    for side, s in SIDES:
        wrist, quat = hold['wrist'][side]
        _copy(eb, 'hand_tgt.' + s, sb[side_bone(side, 'hand')], 'root', Matrix.Translation(g2b(wrist)) @ (QC @ quat).to_matrix().to_4x4())
    for name in skeleton_g.authored:
        if is_finger(name):
            parent = skeleton_g.parent[name]
            _copy(eb, 'FK-' + name, sb[name], 'hand.' + parent[-1].upper() if parent.startswith('hand_') else 'FK-' + parent)
    # each driven skeleton bone's real rest frame, riding on its canonical rig bone
    for name in skeleton_g.authored:
        _real(eb, 'SK-' + name, sb[name], source_of(name))
    bpy.ops.object.mode_set(mode='OBJECT')

    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    controls = rig_data.collections.new('Controls')
    mechanism = rig_data.collections.new('Mechanism')
    for bone in rig_data.bones:
        n = bone.name
        is_control = n == 'root' or n.split('.')[0] in ('foot_ctrl', 'heel_pivot', 'ball_pivot', 'knee_pole', 'elbow_pole', 'gun', 'gun2', 'hand_tgt') \
            or n in ('FK-pelvis', 'FK-spine_01', 'FK-spine_03', 'FK-spine_05', 'FK-neck_01', 'FK-head', 'FK-clavicle_l', 'FK-clavicle_r')
        (controls if is_control else mechanism).assign(bone)
    mechanism.is_visible = False

    for side, s in SIDES:
        ik = rig.pose.bones['shin.' + s].constraints.new('IK')
        ik.target, ik.subtarget = rig, 'ankle_tgt.' + s
        ik.pole_target, ik.pole_subtarget = rig, 'knee_pole.' + s
        ik.chain_count, ik.iterations = 2, 500
        for bone, source in (('foot.' + s, 'ankle_tgt.' + s), ('toe.' + s, 'toe_tgt.' + s), ('hand.' + s, 'hand_tgt.' + s)):
            c = rig.pose.bones[bone].constraints.new('COPY_ROTATION')
            c.target, c.subtarget = rig, source
        ik = rig.pose.bones['forearm.' + s].constraints.new('IK')
        ik.target, ik.subtarget = rig, 'hand_tgt.' + s
        ik.pole_target, ik.pole_subtarget = rig, 'elbow_pole.' + s
        ik.chain_count, ik.iterations = 2, 500
        for upper, lower, a, b in (('thigh.', 'shin.', 'thigh', 'calf'), ('upper_arm.', 'forearm.', 'upperarm', 'lowerarm')):
            aim = rig.pose.bones['ORG-' + side_bone(side, a)].constraints.new('DAMPED_TRACK')
            aim.target, aim.subtarget, aim.track_axis = rig, lower + s, 'TRACK_NEGATIVE_Y'
            org = rig.pose.bones['ORG-' + side_bone(side, b)]
            c = org.constraints.new('COPY_LOCATION')
            c.target, c.subtarget = rig, lower + s
            aim = org.constraints.new('DAMPED_TRACK')
            aim.target, aim.subtarget, aim.track_axis, aim.head_tail = rig, lower + s, 'TRACK_NEGATIVE_Y', 1.0
    for name in skeleton_g.authored:
        c = skeleton.pose.bones[name].constraints.new('COPY_TRANSFORMS')
        c.target, c.subtarget = rig, 'SK-' + name

    # the guns' meshes ride on their bones
    mount = _mount(scene, rig, 'gun', info)
    mount2 = _mount(scene, rig, 'gun2', info2)
    bpy.context.view_layer.update()
    for gi, m in ((info, mount), (info2, mount2)):
        # each loose part at rest on its mount, and its parent: keys.py moves the part from there
        gi['rel'] = {}
        for part in carry_mod.GUNS[gi['name']].get('loose', ()):
            obj = gi['parts'][part]
            gi['rel'][part] = (m.matrix_world.inverted() @ obj.matrix_world, m.matrix_world.inverted() @ obj.parent.matrix_world)
    # the shell carried to the shotgun's loading port (the game's: 20.4 mm across, 60 mm long)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.0102, depth=0.06)
    shell = bpy.context.active_object
    shell.name = 'shell'
    shell.data.materials.append(bpy.data.materials.new('shell'))
    shell.data.materials[0].diffuse_color = (0.64, 0.15, 0.11, 1)
    shell.hide_render = shell.hide_viewport = True
    bpy.context.view_layer.objects.active = rig

    # the belt kit the reloads draw from (pouch.py), riding on the pelvis bone
    pouch.build(skeleton, skeleton_g)
    bpy.context.view_layer.objects.active = rig

    _calibrate_poles(rig)
    rig_bones = rig.data.bones
    pole_rest = {s: rig_bones['elbow_pole.' + s].matrix_local.copy() for _, s in SIDES}
    arm_rest = {side: b2g(joint[side_bone(side, 'upperarm')]) for side, _ in SIDES}
    return dict(skeleton=skeleton, body=body, rig=rig, mount=mount, mount2=mount2, gun=info, gun2=info2, carry=carry,
                carry2=carry2, shell=shell, pole_rest=pole_rest, arm_rest=arm_rest, chest_rest=chest_pos)


def _calibrate_poles(rig):
    """Picks each IK chain's pole angle: the one that bends the joint towards its pole."""
    chains = [(s, 'shin.', 'foot_ctrl.', 'knee_pole.') for _, s in SIDES] + [(s, 'forearm.', None, 'elbow_pole.') for _, s in SIDES]
    for s, bone, ctrl, pole in chains:
        pb = rig.pose.bones[bone + s]
        ik = next(c for c in pb.constraints if c.type == 'IK')
        if ctrl:
            rig.pose.bones[ctrl + s].location = (0, 0, 0.25)  # raise the foot so the knee bends
        best = None
        for step in range(-36, 36):
            ik.pole_angle = step * 0.0872665  # 5 degrees
            bpy.context.view_layer.update()
            mid = pb.head  # knee or elbow
            d = (mid - rig.pose.bones[pole + s].head).length
            if best is None or d < best[0]:
                best = (d, ik.pole_angle)
        ik.pole_angle = best[1]
        if ctrl:
            rig.pose.bones[ctrl + s].location = (0, 0, 0)
    bpy.context.view_layer.update()
