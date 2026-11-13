"""Keys a clip (gait.py / handling.py frames) onto the rig's controls as one action, frame 0 to N,
where frame N repeats frame 0 so a looping clip interpolates across its seam (a clip that does
not loop simply holds its last frame there).

Every control is keyed in every clip, so nothing is left over from the clip keyed before: the
hand targets (on the gun's grips unless the frame says where the hands are), the elbow poles
(the gun's own unless the frame says), the slung gun (on the back unless the frame says), and
the gun's loose parts, which are object animations (the magazine in its well, the charging
handle and the pump forward, the shell hidden, unless the frame says)."""
import bpy
from mathutils import Matrix, Quaternion, Vector

from .skel import QC, g2b, rot_b


def _pose_matrix(position_g, rotation_g):
    """An armature-space (or world, B) matrix for a G-space position and world rotation, for bones
    whose rest frame is the skeleton's (rest rotation QC) and for the gun mounts, whose local
    coordinates are the gun's own G coordinates."""
    return Matrix.Translation(g2b(position_g)) @ (QC @ rotation_g).to_matrix().to_4x4()


def _write(action, owner, values, frames):
    """values: {(data_path, index): [v per frame]} -> linear keys on frames 0..n-1."""
    for (path, index), series in values.items():
        fc = action.fcurve_ensure_for_datablock(owner, path, index=index)
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(series))
        co = []
        for f, v in enumerate(series):
            co += [f, v]
        fc.keyframe_points.foreach_set('co', co)
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()


class _Series:
    """Per-channel key lists, each quaternion run kept on one side of the sphere."""

    def __init__(self):
        self.values, self.last = {}, {}

    def put(self, path, vec, quat=False):
        if quat:
            if path in self.last and self.last[path].dot(vec) < 0:
                vec = -vec
            self.last[path] = vec
        for k, x in enumerate(vec):
            self.values.setdefault((path, k), []).append(x)


def part_world(placed_g, part_rel):
    """World (B) matrix of a gun part for a gun placed at {'butt', 'quat'} (G): part_rel is the part
    relative to its gun's mount."""
    return _pose_matrix(placed_g['butt'], placed_g['quat']) @ part_rel


def key_clip(scn, skel, name, frames):
    rig = scn['rig']
    rig.animation_data_create()
    action = bpy.data.actions.get(name) or bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    bones = rig.data.bones
    seq = frames + frames[:1]
    rows = _Series()

    def put(bone, prop, vec):
        rows.put(f'pose.bones["{bone}"].{prop}', vec, prop == 'rotation_quaternion')

    gun_rest = bones['gun'].matrix_local
    gun2_rest = bones['gun2'].matrix_local
    chest_rest = bones['FK-spine_05'].matrix_local
    carry, carry2 = scn['carry'], scn['carry2']
    for f in seq:
        for joint, q in f['local'].items():
            put('FK-' + joint, 'rotation_quaternion', q)
        put('FK-pelvis', 'location', f['hips'] - skel.rest['pelvis'])
        for side, s in (('Left', 'L'), ('Right', 'R')):
            ground, yaw, pitch = f['feet'][side]
            rest = bones['foot_ctrl.' + s].matrix_local
            posed = Matrix.Translation(g2b(ground)) @ (rot_b(Quaternion((0, 1, 0), yaw)) @ rest.to_quaternion()).to_matrix().to_4x4()
            basis = rest.inverted() @ posed
            put('foot_ctrl.' + s, 'location', basis.to_translation())
            put('foot_ctrl.' + s, 'rotation_quaternion', basis.to_quaternion())
            for pivot, angle in (('heel_pivot.', max(pitch, 0.0)), ('ball_pivot.', min(pitch, 0.0))):
                rr = bones[pivot + s].matrix_local.to_quaternion()
                put(pivot + s, 'rotation_quaternion', rr.inverted() @ rot_b(Quaternion((1, 0, 0), -angle)) @ rr)
            # the hand: where the frame puts it, or on the gun's grip
            wrist, quat = (f.get('hands') or f['gun']['wrist'])[side]
            rest = bones['hand_tgt.' + s].matrix_local
            basis = rest.inverted() @ _pose_matrix(wrist, quat)
            put('hand_tgt.' + s, 'location', basis.to_translation())
            put('hand_tgt.' + s, 'rotation_quaternion', basis.to_quaternion())
            # the elbow's pole: a direction from the shoulder in the chest's frame
            pole = (f.get('poles') or {}).get(side, carry.pole[side])
            at = scn['arm_rest'][side] + pole.normalized() * 0.5
            put('elbow_pole.' + s, 'location', (scn['pole_rest'][s].inverted() @ Matrix.Translation(g2b(at))).to_translation())
        pos, rot = skel.fk(f['local'], f['hips'])
        chest = _pose_matrix(pos['spine_05'], rot['spine_05'])
        f.setdefault('gun2', carry2.stowed(pos['spine_05'], rot['spine_05']))
        for bone, rest, placed in (('gun', gun_rest, f['gun']), ('gun2', gun2_rest, f['gun2'])):
            basis = (chest @ chest_rest.inverted() @ rest).inverted() @ _pose_matrix(placed['butt'], placed['quat'])
            put(bone, 'location', basis.to_translation())
            put(bone, 'rotation_quaternion', basis.to_quaternion())
    _write(action, rig, rows.values, len(seq))
    _key_parts(scn, name, seq)
    return action


def _key_parts(scn, name, seq):
    """The gun's loose parts as object animations (see the module's note). A frame's 'props':
      mag     ('well', slide m) or ('free', position, rotation): the magazine's origin and turn (G,
              model space) when it is out of the gun; or ('gone',) once it has been dropped
      handle  m the charging handle is pulled back
      pump    m the pump is drawn back
      shell   (position, rotation) of the shell (G, model space; its axis along its own Z), or None
    """
    info = scn['gun']
    for part in ('magazine', 'charging_handle', 'pump'):
        if part not in info['parts']:
            continue
        obj = info['parts'][part]
        rel, parent_rel = info['rel'][part]
        rest_g = info[part] - info['butt']  # its origin, gun frame from the butt
        obj.animation_data_create()
        act = bpy.data.actions.get(name + '-' + part) or bpy.data.actions.new(name + '-' + part)
        act.use_fake_user = True
        obj.animation_data.action = act
        obj.rotation_mode = 'QUATERNION'
        rows = _Series()
        for f in seq:
            props = f.get('props') or {}
            gun = f['gun']
            move = Matrix.Identity(4)  # in the gun's own (G) coordinates, about its butt
            hide = 0.0
            if part == 'magazine':
                state = props.get('mag', ('well', 0.0))
                if state[0] == 'well':
                    move = Matrix.Translation((0, -state[1], 0))
                elif state[0] == 'free':
                    # the magazine as a whole, from its seat to (position, rotation) in model space
                    turn = gun['quat'].inverted() @ state[2]
                    at = gun['quat'].inverted() @ (state[1] - gun['butt'])
                    move = Matrix.Translation(at) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-rest_g)
                else:
                    hide = 1.0
            elif part == 'charging_handle':
                move = Matrix.Translation((0, 0, props.get('handle', 0.0)))
            else:
                move = Matrix.Translation((0, 0, props.get('pump', 0.0)))
            world = part_world(gun, move @ rel)
            parent = part_world(gun, parent_rel)
            basis = (parent @ obj.matrix_parent_inverse).inverted() @ world
            rows.put('location', basis.to_translation())
            rows.put('rotation_quaternion', basis.to_quaternion(), True)
            rows.put('scale', Vector((1, 1, 1)) * (1 - hide) + Vector((1e-4, 1e-4, 1e-4)) * hide)
        _write(act, obj, rows.values, len(seq))
    shell = scn['shell']
    shell.animation_data_create()
    act = bpy.data.actions.get(name + '-shell') or bpy.data.actions.new(name + '-shell')
    act.use_fake_user = True
    shell.animation_data.action = act
    shell.rotation_mode = 'QUATERNION'
    rows = _Series()
    for f in seq:
        at = (f.get('props') or {}).get('shell')
        if at is None:
            m, size = Matrix.Identity(4), 1e-4
        else:
            m, size = _pose_matrix(at[0], at[1]), 1.0
        rows.put('location', m.to_translation())
        rows.put('rotation_quaternion', m.to_quaternion(), True)
        rows.put('scale', Vector((size, size, size)))
    _write(act, shell, rows.values, len(seq))
    shell.hide_render = shell.hide_viewport = False
