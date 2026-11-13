"""Bake and export.

bake():   plays a rig action and reads what the skeleton actually did (IK, constraints and
          all) at every frame, as CANONICAL local rotations (skel.py) and the pelvis translation,
          and where the guns are relative to the chest bone (spine_05): plain keys.
key_twist(): keys the twist bones' share of the twist (skel.TWIST) on the Blender skeleton, so the
          review (mesh tests, sheets) sees the body as the game will.
export(): writes the clip GLB directly (no Blender exporter): the body's 90 bones with their rest
          transforms, and more nodes under spine_05, each a translation (and rotation) in that
          bone's frame (spine_05 rests with an identity world rotation, so its frame is the old
          Spine2 joint's):
            Gun            the gun in the hands: its butt and turn (every clip)
            GunIn          the gun coming off the back in a swap
            PalmL, PalmR   the middle of each palm and the hand's CANONICAL turn (the old Hand joint's
                           world turn; the real hand_l / hand_r world rotation is that times R[hand])
            ElbowL, ElbowR where each elbow is (translation only: the game's elbow poles)
          Every clip keys the rotation of all 90 bones (real glTF locals, rest included), the
          translation of root, pelvis and the five IK bones, Gun, and the extra nodes its notes name
          (meta['nodes']). Twist bones carry their share of the measured twist (unwrapped frame to
          frame); IK bones the world transforms of their targets; root the clip's root track
          (meta['root']: travel) or the identity. Checks every written sample against the bake and
          writes the clip notes beside it as JSON.
          A gun's track is its butt less the gun's carry shift (carry.GUNS), which the game adds
          back (shotgun.js CARRY_SHIFT), so both guns share the rifle's holds.
"""
import json
import math
import struct

import bpy
from mathutils import Quaternion, Vector

from . import gltfio
from .carry import PALM_LOCAL
from .skel import QC, TWIST, b2g, bone, gl_quat, twist_angle

QCI = QC.inverted()
Y = Vector((0, 1, 0))

GUN = 'Gun'
CHEST = 'spine_05'
# extra nodes: name -> has a rotation
EXTRA = {'GunIn': True, 'PalmL': True, 'PalmR': True, 'ElbowL': False, 'ElbowR': False}
MOVED = ('root', 'pelvis', 'ik_foot_l', 'ik_foot_r', 'ik_hand_gun', 'ik_hand_l', 'ik_hand_r')


def read_pose(skeleton, skel, mount, mount2=None):
    """The skeleton's current pose (G): canonical local rotations, pelvis translation, world
    positions and canonical world rotations of every bone the rig drives, the gun mount (butt
    position, rotation) in the model's frame and in the chest bone's (gunLocal), and the same for
    the other gun (gun2, gun2Local)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = skeleton.evaluated_get(dg)
    bones = skeleton.data.bones
    world_rot, world_pos = {}, {}
    for name in skel.authored:
        m = ev.pose.bones[name].matrix
        # the bone's turn from its rest (as Blender has the rest), times its rest world rotation =
        # its real world rotation (G); less R[b] = canonical
        turn = QCI @ m.to_quaternion() @ bones[name].matrix_local.to_quaternion().inverted() @ QC
        world_rot[name] = (turn @ skel.rest_world[name] @ skel.R[name].inverted()).normalized()
        world_pos[name] = b2g(m.translation)
    local = {}
    for name in skel.authored:
        parent = skel.parent[name]
        q = world_rot[name] if parent is None else world_rot[parent].inverted() @ world_rot[name]
        local[name] = q.normalized()
    mw = mount.evaluated_get(dg).matrix_world
    gun = (b2g(mw.translation), (QCI @ mw.to_quaternion()).normalized())
    chest = world_rot[CHEST].inverted()
    gun_local = (chest @ (gun[0] - world_pos[CHEST]), (chest @ gun[1]).normalized())
    out = dict(local=local, hips=world_pos['pelvis'].copy(), pos=world_pos, rot=world_rot, gun=gun, gunLocal=gun_local)
    if mount2 is not None:
        mw = mount2.evaluated_get(dg).matrix_world
        out['gun2'] = (b2g(mw.translation), (QCI @ mw.to_quaternion()).normalized())
        out['gun2Local'] = (chest @ (out['gun2'][0] - world_pos[CHEST]), (chest @ out['gun2'][1]).normalized())
    return out


def node_value(frame, node, shift):
    """(translation, rotation or None) of an exported node in a baked frame, chest frame."""
    if node in (GUN, 'GunIn'):
        pos, q = frame['gunLocal' if node == GUN else 'gun2Local']
        return pos - shift.get(node, Vector()), q
    chest_q = frame['rot'][CHEST].inverted()
    chest_p = frame['pos'][CHEST]
    side = 'Left' if node.endswith('L') else 'Right'
    if node.startswith('Palm'):
        rot = frame['rot'][bone(side, 'hand')]
        palm = frame['pos'][bone(side, 'hand')] + rot @ PALM_LOCAL
        return chest_q @ (palm - chest_p), (chest_q @ rot).normalized()
    return chest_q @ (frame['pos'][bone(side, 'lowerarm')] - chest_p), None


def bake(scene, scn, action, frames):
    """Plays `action` on the rig and returns the skeleton's pose at frames 0..frames-1 (the twist
    bones at rest while it is read)."""
    clear_twist(scn['skeleton'], scn['skel'])
    scn['rig'].animation_data.action = action
    out = []
    for f in range(frames):
        scene.frame_set(f)
        out.append(read_pose(scn['skeleton'], scn['skel'], scn['mount'], scn['mount2']))
    return out


# ---------------------------------------------------------------- the real (glTF) pose of a frame

UNWIND = 6  # frames over which a twist bone gives back a whole turn the source made (see below)


def twist_series(skel, Ls):
    """Per twist bone, its angle (rad) in every frame of a clip, from the frames' glTF locals.

    The source's twist (swing-twist about +Y, R1's rule) is unwrapped frame to frame, so a bone
    carries its share continuously through +-180 degrees (the swaps turn the right hand past it).
    Where the source ends a whole turn away from where the wrapped measure has it (the old swaps
    turn the right hand a full turn about the forearm: no continuous share can follow that and
    also end where the next clip begins), each twist bone gives back its share of that turn the
    short way, over UNWIND frames centred on the frame where the source turns fastest."""
    n = len(Ls)
    series = {}
    by_source = {}
    for name, (parent, share, measure, source) in skel.twist.items():
        key = (measure, source)
        if key not in by_source:
            wrapped = []
            for L in Ls:
                q = L[source] @ skel.canon_local[source].inverted() if measure == 'child' else skel.canon_local[source].inverted() @ L[source]
                wrapped.append(twist_angle(q.normalized()))
            un = [wrapped[0]]
            for a in wrapped[1:]:
                un.append(a + 2 * math.pi * round((un[-1] - a) / (2 * math.pi)))
            turns = round((un[-1] - wrapped[-1]) / (2 * math.pi))
            fast = max(range(n - 1), key=lambda i: abs(un[i + 1] - un[i])) if n > 1 else 0
            by_source[key] = (un, turns, fast)
        un, turns, fast = by_source[key]
        angles = [share * a for a in un]
        if turns:
            off = share * 2 * math.pi * turns
            off -= 2 * math.pi * round(off / (2 * math.pi))  # the short way
            lo = fast - UNWIND // 2 + 1
            for i in range(n):
                w = min(1.0, max(0.0, (i - lo + 1) / (UNWIND + 1)))
                w = w * w * (3 - 2 * w)
                angles[i] -= w * off
        series[name] = angles
    return series, {k: v[1] for k, v in by_source.items()}


def gltf_frames(skel, frames, root=None):
    """The real glTF pose of each baked frame: [(local rotations {bone: Quaternion} for all
    bones, translations {bone: Vector} for MOVED, twist angles {twist bone: rad})].
    root: the clip's root track [[x, z, yaw]] (None: in place)."""
    base = [skel.to_gltf(frame['rot']) for frame in frames]
    series, _ = twist_series(skel, [b[0] for b in base])
    out = []
    for i, frame in enumerate(frames):
        L, world = base[i]
        pos = dict(frame['pos'])
        # twist bones: their rest (the parent's frame) turned about +Y by their share
        angles = {}
        for name, (parent, share, measure, source) in skel.twist.items():
            angles[name] = series[name][i]
            L[name] = (skel.canon_local[name] @ Quaternion(Y, angles[name])).normalized()
            world[name] = world[parent] @ L[name]
        T = {'pelvis': frame['hips'].copy(), 'root': Vector()}
        # IK bones: their targets' world transforms, in their parents' frames (root at rest here:
        # the bake is in the root's frame)
        for name in skel.order:
            if name not in skel.ik:
                continue
            p = skel.parent[name]
            target = skel.ik[name]
            if target is None:
                world[name] = world[p] @ skel.rest_q[name]
                pos[name] = pos[p] + world[p] @ skel.rest_t[name]
                L[name], t = skel.rest_q[name].copy(), skel.rest_t[name].copy()
            else:
                world[name], pos[name] = world[target], pos[target]
                L[name] = (world[p].inverted() @ world[target]).normalized()
                t = world[p].inverted() @ (pos[target] - pos[p])
            T[name] = t
        if root:
            x, z, yaw = root[i]
            L['root'] = Quaternion(Y, yaw)
            T['root'] = Vector((x, 0.0, z))
        out.append((L, T, angles))
    return out


def clear_twist(skeleton, skel=None):
    """The twist bones back to the canonical pose's (no twist): the rest for an I-pose body."""
    skeleton.animation_data_create()
    skeleton.animation_data.action = None
    for name in (skel.twist if skel is not None else TWIST):
        if name not in skeleton.pose.bones:
            continue
        skeleton.pose.bones[name].rotation_mode = 'QUATERNION'
        q = (skel.rest_q[name].inverted() @ skel.canon_local[name]) if skel is not None and skel.posed_bind else Quaternion()
        skeleton.pose.bones[name].rotation_quaternion = q


def key_twist(scn, name, real):
    """Keys the twist bones on the Blender skeleton from gltf_frames() output (frame k = real[k]).
    A twist bone's Blender pose rotation is restLocal^-1 * local: its turn about +Y for an I-pose
    body, restLocal^-1 * canonicalLocal * turn for one bound in another pose."""
    skeleton = scn['skeleton']
    skeleton.animation_data_create()
    action = bpy.data.actions.get('twist-' + name) or bpy.data.actions.new('twist-' + name)
    action.use_fake_user = True
    skeleton.animation_data.action = action
    for bone_name in scn['skel'].twist:
        path = f'pose.bones["{bone_name}"].rotation_quaternion'
        curves = [action.fcurve_ensure_for_datablock(skeleton, path, index=k) for k in range(4)]
        prev = None
        rows = []
        skel = scn['skel']
        pre = skel.rest_q[bone_name].inverted() @ skel.canon_local[bone_name] if skel.posed_bind else None
        for L, _, angles in real:
            q = Quaternion(Y, angles[bone_name]) if pre is None else (pre @ Quaternion(Y, angles[bone_name])).normalized()
            if prev is not None and prev.dot(q) < 0:
                q = -q
            prev = q
            rows.append(q)
        for k, c in enumerate(curves):
            c.keyframe_points.clear()
            c.keyframe_points.add(len(rows))
            co = []
            for f, q in enumerate(rows):
                co += [f, q[k]]
            c.keyframe_points.foreach_set('co', co)
            for kp in c.keyframe_points:
                kp.interpolation = 'LINEAR'
            c.update()
    return action


# ---------------------------------------------------------------- the GLB

def _xyzw(q):
    return (q.x, q.y, q.z, q.w)


def export(body_path, skel, clips, glb_path, json_path, notes, version='rifle-motion-ue5-v1'):
    """clips: [(name, baked frames, meta)]. Writes the GLB and the JSON."""
    body, _ = gltfio.read(body_path)
    by_name = {n['name']: n for n in body['nodes']}
    nodes, index = [], {}
    for name in skel.order:
        n = by_name[name]
        index[name] = len(nodes)
        nodes.append({'name': name, 'rotation': list(n.get('rotation', [0, 0, 0, 1])), 'translation': list(n.get('translation', [0, 0, 0]))})
    for name in (GUN, *EXTRA):
        index[name] = len(nodes)
        nodes.append({'name': name})
    for name in skel.order:
        kids = [index[c] for c in skel.order if skel.parent[c] == name]
        if name == CHEST:
            kids += [index[e] for e in (GUN, *EXTRA)]
        if kids:
            nodes[index[name]]['children'] = kids
    roots = [index[n] for n in skel.order if skel.parent[n] is None]

    blob = bytearray()
    accessors, views = [], []

    def add(values, kind):
        while len(blob) % 4:
            blob.append(0)
        width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[kind]
        data = b''.join(struct.pack('<' + 'f' * width, *v) for v in values)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)})
        blob.extend(data)
        acc = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(values), 'type': kind}
        if kind == 'SCALAR':
            acc['min'], acc['max'] = [min(v[0] for v in values)], [max(v[0] for v in values)]
        accessors.append(acc)
        return len(accessors) - 1

    animations, written, twist_report = [], {}, {}
    for name, frames, meta in clips:
        seq = frames + frames[:1] if meta['loop'] else frames
        root = meta.get('root')
        real = gltf_frames(skel, seq, root + root[:1] if (root and meta['loop']) else root)
        times = add([(f / 30.0,) for f in range(len(seq))], 'SCALAR')
        channels, samplers, want = [], [], {}

        def channel(node, path, values):
            if path == 'rotation':
                fixed, prev = [], None
                for q in values:
                    if prev is not None and prev.dot(q) < 0:
                        q = -q
                    prev = q
                    fixed.append(q)
                values = fixed
                rows = [_xyzw(q) for q in values]
            else:
                rows = [tuple(v) for v in values]
            samplers.append({'input': times, 'output': add(rows, 'VEC4' if path == 'rotation' else 'VEC3'), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': index[node], 'path': path}})
            want[node, path] = values

        for b in skel.order:
            channel(b, 'rotation', [r[0][b] for r in real])
        for b in MOVED:
            if b in skel.joints:
                channel(b, 'translation', [r[1][b] for r in real])
        shift = meta.get('shift', {})
        for node in (GUN, *meta.get('nodes', ())):
            vals = [node_value(f, node, shift) for f in seq]
            channel(node, 'translation', [v[0] for v in vals])
            if node == GUN or EXTRA[node]:
                channel(node, 'rotation', [v[1] for v in vals])
        animations.append({'name': name, 'channels': channels, 'samplers': samplers})
        written[name] = want
        # the twist bones' largest frame-to-frame change (deg) and range
        twist_report[name] = {t: (max((abs(b[2][t] - a[2][t]) for a, b in zip(real, real[1:])), default=0.0) * 180 / math.pi,
                                  min(r[2][t] for r in real) * 180 / math.pi, max(r[2][t] for r in real) * 180 / math.pi) for t in skel.twist}

    gltf = {
        'asset': {'version': '2.0', 'generator': f'{version} via blender/build_rifle_motion.py (Blender {bpy.app.version_string})',
                  'extras': {'skeleton': 'earthonline-ue5-v1', 'fps': 30, 'joints': len(skel.order), 'gun': GUN, 'chest': CHEST,
                             'nodes': list(EXTRA), 'frames': 'canonical authoring, real glTF locals written (rest rotations included)'}},
        'scene': 0, 'scenes': [{'name': 'Scene', 'nodes': roots}], 'nodes': nodes,
        'animations': animations, 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': (len(blob) + 3) // 4 * 4}],
    }
    gltfio.write(glb_path, gltf, bytes(blob))

    # every written sample against what was meant (read back from the file)
    back, binary = gltfio.read(glb_path)
    names = [n['name'] for n in back['nodes']]
    worst_rot = worst_pos = 0.0
    for anim in back['animations']:
        for ch in anim['channels']:
            node, path = names[ch['target']['node']], ch['target']['path']
            values = gltfio.rows(back, binary, anim['samplers'][ch['sampler']]['output'])
            for value, w in zip(values, written[anim['name']][node, path]):
                if path == 'rotation':
                    worst_rot = max(worst_rot, 1 - abs(gl_quat(value).normalized().dot(w)))
                else:
                    worst_pos = max(worst_pos, (Vector(value) - w).length)
    if worst_rot > 1e-6 or worst_pos > 1e-5:
        raise ValueError(f'written keys disagree with the bake (rotation {worst_rot}, position {worst_pos})')
    json_path.write_text(json.dumps(notes, indent=1) + '\n')
    return dict(rotation=worst_rot, position=worst_pos, bytes=glb_path.stat().st_size, twist=twist_report)
