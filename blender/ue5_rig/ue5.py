"""The UE5 Mannequin-style skeleton for the EarthOnline bodies (pass R1), and the re-rig.

Everything here is plain numpy on the glTF data, so it is exactly what three.js (and any glTF
reader) does; build_ue5_rig.py runs it inside Blender and adds the Blender armature, the renders
and the .blend. Spaces: glTF ("G": Y up, the body faces +Z, its left is +X, metres) unless said.

  Body           reads a body GLB: joints (rest rotations identity), mesh, skin weights
  build()        the new skeleton from a body: names, parents, heads, tails, rest frames, rules
  weights()      the old skin weights split onto the new bones (no re-painting)
  write_glb()    the body GLB with the new skeleton, skin and weights; everything else untouched
  map_pose()     an old pose (local rotations + Hips translation) as the new skeleton's
  fk(), skin()   forward kinematics and linear blend skinning, as three.js does them

Bone frames: a bone runs along its local +Y (head to tail), Z points to the side its child swings
into when the joint flexes, X = Y x Z, so flexion is a POSITIVE rotation about local X for the
spine, neck, elbows, knees, fingers, wrists (palm-ward), ankles (toes up) and the jaw (opening).
Left and right frames are mirror images in Blender's convention (X has the same world direction
on both sides, Y and Z are reflected), so a mirrored motion has equal X rotations and opposite Y
and Z rotations. The rest world rotation of a joint is R = [X Y Z] (columns, G); its glTF node
rotation is R_parent^T R, its translation R_parent^T (head - head_parent).
"""
import copy
import json
import math
import pathlib
import struct
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from rifle_motion import gltfio  # noqa: E402

SKELETON = 'earthonline-ue5-v1'
SIDES = (('Left', 'l', 1.0), ('Right', 'r', -1.0))
FINGERS = (('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky'))

# Twist bones: where they sit along their parent (0 = parent's head, 1 = its tail), and how much of
# which twist they carry. 'child' = the twist of the named child (hand / foot) about the parent's
# long axis, measured in the parent's frame; 'self' = the parent's own twist about its long axis
# (its pose delta), carried with the given (negative: counter-rotating) share.
TWIST = {
    # name: (parent, at, share, measure, source)
    'upperarm_twist_01_{s}': ('upperarm_{s}', 0.10, -0.50, 'self', 'upperarm_{s}'),
    'upperarm_twist_02_{s}': ('upperarm_{s}', 0.50, -0.25, 'self', 'upperarm_{s}'),
    'lowerarm_twist_02_{s}': ('lowerarm_{s}', 0.55, 0.47, 'child', 'hand_{s}'),
    'lowerarm_twist_01_{s}': ('lowerarm_{s}', 0.90, 0.88, 'child', 'hand_{s}'),
    'thigh_twist_01_{s}': ('thigh_{s}', 0.10, -0.30, 'self', 'thigh_{s}'),
    'thigh_twist_02_{s}': ('thigh_{s}', 0.50, -0.15, 'self', 'thigh_{s}'),
    'calf_twist_02_{s}': ('calf_{s}', 0.55, 0.24, 'child', 'foot_{s}'),
    'calf_twist_01_{s}': ('calf_{s}', 0.90, 0.44, 'child', 'foot_{s}'),
}
# along each limb segment, which bone takes the old joint's weight at which point (t from the old
# joint to its child): piecewise linear between these anchors, clamped beyond the ends. Each twist
# bone's anchor is where it sits; the forearm's twist ramps evenly from nothing at 15 % (the elbow
# keeps its old skin) to the hand's full twist at the wrist: share = (t - 0.15) / 0.85.
LIMB_ANCHORS = {
    '{S}Arm': [(0.10, 'upperarm_twist_01_{s}'), (0.50, 'upperarm_twist_02_{s}'), (1.00, 'upperarm_{s}')],
    '{S}ForeArm': [(0.15, 'lowerarm_{s}'), (0.55, 'lowerarm_twist_02_{s}'), (0.90, 'lowerarm_twist_01_{s}')],
    '{S}UpLeg': [(0.10, 'thigh_twist_01_{s}'), (0.50, 'thigh_twist_02_{s}'), (1.00, 'thigh_{s}')],
    '{S}Leg': [(0.15, 'calf_{s}'), (0.55, 'calf_twist_02_{s}'), (0.90, 'calf_twist_01_{s}')],
}
LIMB_CHILD = {'{S}Arm': '{S}ForeArm', '{S}ForeArm': '{S}Hand', '{S}UpLeg': '{S}Leg', '{S}Leg': '{S}Foot'}
METACARPAL_AT = 0.25    # metacarpal heads: this far from the wrist towards each knuckle
METACARPAL_SHARE = 0.40  # at most this much of a palm vertex's hand weight goes to the metacarpals
TOE_TIP = 0.07           # m, ball to toe tip (rifle_motion.rig)
MAX_INFLUENCES = 4

# ----------------------------------------------------------------------------- rotations


def q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def q_to_m(q):
    x, y, z, w = np.asarray(q, float) / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def m_to_q(m):
    m = np.asarray(m, float)
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    q /= np.linalg.norm(q)
    return q if q[3] >= 0 else -q


def axis_angle(axis, angle):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    x, y, z = axis
    c, s, C = math.cos(angle), math.sin(angle), 1 - math.cos(angle)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def twist_angle(m, axis=(0, 1, 0)):
    """The twist (radians) of rotation `m` about `axis` (swing-twist, twist applied first)."""
    q = m_to_q(m)
    axis = np.asarray(axis, float)
    p = np.dot(q[:3], axis)
    return 2 * math.atan2(p, q[3]) if abs(p) + abs(q[3]) > 1e-12 else 0.0


def frame(y, z_hint):
    """Rest rotation (columns X, Y, Z) of a bone along `y` with Z towards `z_hint`."""
    y = np.asarray(y, float) / np.linalg.norm(y)
    z = np.asarray(z_hint, float)
    z = z - np.dot(z, y) * y
    z /= np.linalg.norm(z)
    return np.column_stack([np.cross(y, z), y, z])

# ----------------------------------------------------------------------------- glTF access

DTYPE = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}


def accessor(gltf, binary, index):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    dt = np.dtype(DTYPE[acc['componentType']])
    width = gltfio.WIDTH[acc['type']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride', dt.itemsize * width)
    count = acc['count']
    if stride == dt.itemsize * width:
        out = np.frombuffer(binary, dt, count * width, start).reshape(count, width)
    else:
        raw = np.frombuffer(binary, np.uint8, (count - 1) * stride + dt.itemsize * width, start)
        out = np.stack([raw[k * stride: k * stride + dt.itemsize * width].view(dt) for k in range(count)])
    out = out.astype(np.float64 if dt == np.float32 else np.int64)
    if acc.get('normalized') and dt != np.float32:
        out = out / np.iinfo(dt).max
    return out


class Body:
    """A body GLB on the old skeleton (earthonline-humanoid-v1: rest rotations all identity)."""

    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.gltf, self.binary = gltfio.read(self.path)
        g = self.gltf
        nodes = g['nodes']
        skin = g['skins'][0]
        if len(g['skins']) != 1:
            raise ValueError('one skin expected')
        self.joint_nodes = list(skin['joints'])
        self.joints = [nodes[j]['name'] for j in self.joint_nodes]
        parent_of = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
        self.parent = {}
        self.rest_t = {}
        for j in self.joint_nodes:
            n = nodes[j]
            if any(abs(v) > 1e-6 for v in n.get('rotation', [0, 0, 0, 1])[:3]) or 'scale' in n:
                raise ValueError(f'{n["name"]}: rest rotations must be the identity')
            p = parent_of.get(j)
            self.parent[n['name']] = nodes[p]['name'] if p in self.joint_nodes else None
            self.rest_t[n['name']] = np.array(n.get('translation', [0, 0, 0]), float)
        self.order = []
        pending = list(self.joints)
        while pending:
            for name in list(pending):
                if self.parent[name] is None or self.parent[name] in self.order:
                    self.order.append(name)
                    pending.remove(name)
        self.P = {}
        for name in self.order:
            p = self.parent[name]
            self.P[name] = self.rest_t[name] + (self.P[p] if p else 0)
        # every primitive of every skinned mesh (here: one mesh, one primitive with body, clothes,
        # hair, brows, eyes and lashes in it)
        self.prims = []
        for ni, n in enumerate(nodes):
            if 'mesh' not in n:
                continue
            if n.get('skin') != 0:
                raise ValueError(f'mesh node {n.get("name")} is not skinned to the skin')
            for pi, prim in enumerate(g['meshes'][n['mesh']]['primitives']):
                a = prim['attributes']
                if 'JOINTS_1' in a:
                    raise ValueError('more than 4 influences per vertex in the source')
                self.prims.append(dict(
                    node=ni, mesh=n['mesh'], prim=pi,
                    pos=accessor(g, self.binary, a['POSITION']),
                    nrm=accessor(g, self.binary, a['NORMAL']),
                    joints=accessor(g, self.binary, a['JOINTS_0']),
                    weights=accessor(g, self.binary, a['WEIGHTS_0']),
                    tris=accessor(g, self.binary, prim['indices']).reshape(-1, 3),
                    targets=[accessor(g, self.binary, t['POSITION']) for t in prim.get('targets', [])],
                    accessors=dict(joints=a['JOINTS_0'], weights=a['WEIGHTS_0'])))
        self.ibm = accessor(g, self.binary, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)

    def solely(self, joint, prim=0, at=0.999):
        """Vertices skinned (at least `at`) to one joint."""
        p = self.prims[prim]
        k = self.joints.index(joint)
        w = np.where(p['joints'] == k, p['weights'], 0).sum(1)
        return np.nonzero(w >= at)[0]


def sphere_fit(pts):
    A = np.column_stack([2 * pts, np.ones(len(pts))])
    b = (pts ** 2).sum(1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = sol[:3]
    r = math.sqrt(sol[3] + c @ c)
    resid = np.abs(np.linalg.norm(pts - c, axis=1) - r)
    return c, r, resid.max()

# ----------------------------------------------------------------------------- the skeleton


class Skeleton:
    """bones: name -> dict(parent, head, tail, R (rest world rotation), rule)."""

    def __init__(self):
        self.bones = {}
        self.order = []

    def add(self, name, parent, head, tail, z_hint, rule, **kw):
        head, tail = np.asarray(head, float), np.asarray(tail, float)
        R = kw.pop('R', None)
        if R is None:
            R = frame(tail - head, z_hint)
        self.bones[name] = dict(name=name, parent=parent, head=head, tail=tail, R=R, rule=rule, **kw)
        self.order.append(name)
        return self.bones[name]

    def local_rest(self, name):
        b = self.bones[name]
        if b['parent'] is None:
            return b['R'], b['head']
        p = self.bones[b['parent']]
        return p['R'].T @ b['R'], p['R'].T @ (b['head'] - p['head'])

    def children(self, name):
        return [n for n in self.order if self.bones[n]['parent'] == name]


def build(body):
    """The UE5-style skeleton on `body`'s joints (see UE5_SKELETON.md for the rules)."""
    P = body.P
    s = Skeleton()
    UP, FWD, BACK, DOWN = (0, 1, 0), (0, 0, 1), (0, 0, -1), (0, -1, 0)
    I = np.eye(3)
    s.add('root', None, (0, 0, 0), (0, 0.15, 0), FWD, ('copy', 'Root'), R=I)
    s.add('pelvis', 'root', P['Hips'], P['Spine'], FWD, ('copy', 'Hips'))
    spine = [P['Spine'], (P['Spine'] + P['Spine1']) / 2, P['Spine1'], (P['Spine1'] + P['Spine2']) / 2, P['Spine2'], P['Neck']]
    rules = [('copy', 'Spine'), ('follow',), ('copy', 'Spine1'), ('follow',), ('copy', 'Spine2')]
    for k in range(5):
        s.add(f'spine_0{k + 1}', 'pelvis' if k == 0 else f'spine_0{k}', spine[k], spine[k + 1], FWD, rules[k])
    neck2 = (P['Neck'] + P['Head']) / 2
    s.add('neck_01', 'spine_05', P['Neck'], neck2, FWD, ('copy', 'Neck'))
    s.add('neck_02', 'neck_01', neck2, P['Head'], FWD, ('follow',))
    s.add('head', 'neck_02', P['Head'], P['Head'] + (0, 0.2, 0), FWD, ('copy', 'Head'))
    # jaw: from the old joint towards the middle of what it carries (the chin)
    jaw_v = body.prims[0]['pos'][body.solely('Jaw', at=0.5)]
    chin = jaw_v.mean(0) if len(jaw_v) else P['Jaw'] + (0, -0.05, 0.08)
    s.add('jaw', 'head', P['Jaw'], chin, DOWN, ('copy', 'Jaw'))
    s.eye_fit = {}
    for side, x, sign in SIDES:
        idx = body.solely(side + 'Eye')
        pts = body.prims[0]['pos'][idx]
        c, r, resid = sphere_fit(pts)
        s.eye_fit[x] = dict(centre=c, radius=r, resid=resid, count=len(idx), centroid=pts.mean(0),
                            joint=P[side + 'Eye'].copy())
        s.add(f'eye_{x}', 'head', c, c + (0, 0, 0.03), UP, ('copy', side + 'Eye'))
    for side, x, sign in SIDES:
        S = side
        s.add(f'clavicle_{x}', 'spine_05', P[S + 'Shoulder'], P[S + 'Arm'], UP, ('copy', S + 'Shoulder'))
        s.add(f'upperarm_{x}', f'clavicle_{x}', P[S + 'Arm'], P[S + 'ForeArm'], FWD, ('copy', S + 'Arm'))
        s.add(f'lowerarm_{x}', f'upperarm_{x}', P[S + 'ForeArm'], P[S + 'Hand'], FWD, ('copy', S + 'ForeArm'))
        knuckle_mid = P[S + 'HandMiddle1']
        s.add(f'hand_{x}', f'lowerarm_{x}', P[S + 'Hand'], knuckle_mid, FWD, ('copy', S + 'Hand'))
        # thumb: three bones (thumb_01 is the thumb's metacarpal); it curls across the palm
        thumb_z = (-0.7 * sign, 0, 0.7)
        t = [P[S + f'HandThumb{k}'] for k in (1, 2, 3)]
        tip = t[2] + (t[2] - t[1]) * 0.9
        for k in range(3):
            s.add(f'thumb_0{k + 1}_{x}', f'hand_{x}' if k == 0 else f'thumb_0{k}_{x}', t[k], (t + [tip])[k + 1], thumb_z,
                  ('copy', S + f'HandThumb{k + 1}'))
        for old, new in FINGERS:
            f = [P[S + f'Hand{old}{k}'] for k in (1, 2, 3)]
            tip = f[2] + (f[2] - f[1]) * 0.8
            meta = P[S + 'Hand'] + METACARPAL_AT * (f[0] - P[S + 'Hand'])
            s.add(f'{new}_metacarpal_{x}', f'hand_{x}', meta, f[0], FWD, ('follow',))
            for k in range(3):
                s.add(f'{new}_0{k + 1}_{x}', f'{new}_metacarpal_{x}' if k == 0 else f'{new}_0{k}_{x}', f[k], (f + [tip])[k + 1],
                      FWD, ('copy', S + f'Hand{old}{k + 1}'))
    for side, x, sign in SIDES:
        S = side
        s.add(f'thigh_{x}', 'pelvis', P[S + 'UpLeg'], P[S + 'Leg'], BACK, ('copy', S + 'UpLeg'))
        s.add(f'calf_{x}', f'thigh_{x}', P[S + 'Leg'], P[S + 'Foot'], BACK, ('copy', S + 'Leg'))
        s.add(f'foot_{x}', f'calf_{x}', P[S + 'Foot'], P[S + 'ToeBase'], UP, ('copy', S + 'Foot'))
        s.add(f'ball_{x}', f'foot_{x}', P[S + 'ToeBase'], P[S + 'ToeBase'] + (0, 0, TOE_TIP), UP, ('copy', S + 'ToeBase'))
    # twist bones: along their parent, with its frame (local rest rotation identity)
    for side, x, sign in SIDES:
        for pattern, (parent, at, share, measure, source) in TWIST.items():
            name, parent, source = pattern.format(s=x), parent.format(s=x), source.format(s=x)
            pb = s.bones[parent]
            axis = pb['tail'] - pb['head']
            head = pb['head'] + at * axis
            s.add(name, parent, head, head + 0.2 * axis, None, ('twist', source, share, measure), R=pb['R'].copy())
    # IK helpers (no weights), as on the Mannequin: at their targets' rest places
    s.add('ik_foot_root', 'root', (0, 0, 0), (0, 0.15, 0), FWD, ('ik', None), R=I)
    for x in 'lr':
        f = s.bones[f'foot_{x}']
        s.add(f'ik_foot_{x}', 'ik_foot_root', f['head'], f['tail'], None, ('ik', f'foot_{x}'), R=f['R'].copy())
    s.add('ik_hand_root', 'root', (0, 0, 0), (0, 0.15, 0), FWD, ('ik', None), R=I)
    h = s.bones['hand_r']
    s.add('ik_hand_gun', 'ik_hand_root', h['head'], h['tail'], None, ('ik', 'hand_r'), R=h['R'].copy())
    for x in 'lr':
        h = s.bones[f'hand_{x}']
        s.add(f'ik_hand_{x}', 'ik_hand_gun', h['head'], h['tail'], None, ('ik', f'hand_{x}'), R=h['R'].copy())
    # hierarchy order (parents first), as the skin's joint list
    order, pending = [], list(s.order)
    while pending:
        for n in list(pending):
            p = s.bones[n]['parent']
            if p is None or p in order:
                order.append(n)
                pending.remove(n)
    s.order = order
    return s

# ----------------------------------------------------------------------------- weights


def _anchors_split(t, anchors):
    """Piecewise-linear split of one weight between bones anchored at increasing t."""
    if t <= anchors[0][0]:
        return [(anchors[0][1], 1.0)]
    if t >= anchors[-1][0]:
        return [(anchors[-1][1], 1.0)]
    for (t0, b0), (t1, b1) in zip(anchors, anchors[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0)
            return [(b0, 1 - u), (b1, u)]


def _smoothstep(e0, e1, x):
    u = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return u * u * (3 - 2 * u)


def split_rules(body, skel):
    """old joint -> function(vertex position) -> [(new bone, fraction)]."""
    P = body.P
    rules = {}
    direct = {'Root': 'root', 'Hips': 'pelvis', 'Spine2': 'spine_05', 'Head': 'head', 'Jaw': 'jaw'}
    for old, new in direct.items():
        rules[old] = (lambda new: lambda v: [(new, 1.0)])(new)

    def along_y(anchors):
        return lambda v: _anchors_split(v[1], anchors)
    # spine and neck: by height, linear between the heads of the two new bones an old joint covers
    # (tried against anchoring at the segments' middles with the bend spread evenly: heads keep the
    # neck's throat fold at the old level with a 70/30 neck split and lower the worst spine edge)
    head = {n: skel.bones[n]['head'][1] for n in skel.order}
    rules['Spine'] = along_y([(head['spine_01'], 'spine_01'), (head['spine_02'], 'spine_02')])
    rules['Spine1'] = along_y([(head['spine_03'], 'spine_03'), (head['spine_04'], 'spine_04')])
    rules['Neck'] = along_y([(head['neck_01'], 'neck_01'), (head['neck_02'], 'neck_02')])
    for side, x, sign in SIDES:
        rules[side + 'Eye'] = (lambda b: lambda v: [(b, 1.0)])(f'eye_{x}')
        rules[side + 'Shoulder'] = (lambda b: lambda v: [(b, 1.0)])(f'clavicle_{x}')
        rules[side + 'Foot'] = (lambda b: lambda v: [(b, 1.0)])(f'foot_{x}')
        rules[side + 'ToeBase'] = (lambda b: lambda v: [(b, 1.0)])(f'ball_{x}')
        for k in (1, 2, 3):
            rules[side + f'HandThumb{k}'] = (lambda b: lambda v: [(b, 1.0)])(f'thumb_0{k}_{x}')
            for old, new in FINGERS:
                rules[side + f'Hand{old}{k}'] = (lambda b: lambda v: [(b, 1.0)])(f'{new}_0{k}_{x}')
        for pattern, anchors in LIMB_ANCHORS.items():
            old = pattern.format(S=side)
            a, b = P[old], P[LIMB_CHILD[pattern].format(S=side)]
            d = b - a
            L2 = d @ d
            anchors = [(t, n.format(s=x)) for t, n in anchors]
            rules[old] = (lambda a, d, L2, anchors: lambda v: _anchors_split(((v - a) @ d) / L2, anchors))(a, d, L2, anchors)
        # hand: palm vertices give part of their weight to the metacarpals near the knuckles
        wrist = P[side + 'Hand']
        knuckles = [(new, P[side + f'Hand{old}1']) for old, new in FINGERS]
        mid_k = P[side + 'HandMiddle1']
        axis = mid_k - wrist
        L2 = axis @ axis
        xs = [(k[1][0], k[0]) for k in knuckles]
        xs.sort()

        def hand_rule(v, wrist=wrist, axis=axis, L2=L2, xs=xs, x=x):
            t = ((v - wrist) @ axis) / L2
            f = METACARPAL_SHARE * _smoothstep(0.40, 0.95, t)
            # fade out on the thumb side beyond the index knuckle and past the pinky's
            lo, hi = xs[0][0], xs[-1][0]
            out = max(lo - v[0], v[0] - hi, 0.0)
            f *= 1 - _smoothstep(0.004, 0.015, out)
            if f <= 0:
                return [(f'hand_{x}', 1.0)]
            anchors = [(px, f'{n}_metacarpal_{x}') for px, n in xs]
            return [(f'hand_{x}', 1 - f)] + [(b, f * u) for b, u in _anchors_split(v[0], anchors)]
        rules[side + 'Hand'] = hand_rule
    missing = set(body.joints) - set(rules)
    if missing:
        raise ValueError(f'no weight rule for {sorted(missing)}')
    return rules


def weights(body, skel, prim=0):
    """New (joints, weights) arrays (N x 4) for a primitive, and stats. Each old influence is split
    onto new bones; the vertex's total is kept. Past 4 influences the smallest is folded back into
    the biggest bone split from the same old joint (identical motion whenever the in-between and
    twist bones follow their parent, so the old deformation is kept), else dropped, and the vertex
    renormalised."""
    rules = split_rules(body, skel)
    p = body.prims[prim]
    pos, J, W = p['pos'], p['joints'], p['weights']
    index = {n: k for k, n in enumerate(skel.order)}
    N = len(pos)
    newJ = np.zeros((N, 4), np.int64)
    newW = np.zeros((N, 4))
    stats = dict(folded=0, dropped=0, dropped_weight_max=0.0, over4=0)
    for i in range(N):
        infl = {}   # bone -> [weight, source]
        for k in range(4):
            w = W[i, k]
            if w <= 0:
                continue
            old = body.joints[J[i, k]]
            for bone, frac in rules[old](pos[i]):
                if frac * w <= 0:
                    continue
                e = infl.setdefault(bone, [0.0, old])
                e[0] += frac * w
        if len(infl) > MAX_INFLUENCES:
            stats['over4'] += 1
        while len(infl) > MAX_INFLUENCES:
            # the smallest piece that has a sibling from the same old joint is folded into it (the
            # source had at most 4 influences, so this always gets there without dropping anything)
            foldable = [b for b in infl if sum(1 for c in infl if infl[c][1] == infl[b][1]) > 1]
            if foldable:
                small = min(foldable, key=lambda b: infl[b][0])
                w, src = infl.pop(small)
                siblings = [b for b in infl if infl[b][1] == src]
                infl[max(siblings, key=lambda b: infl[b][0])][0] += w
                stats['folded'] += 1
            else:
                small = min(infl, key=lambda b: infl[b][0])
                w, src = infl.pop(small)
                stats['dropped'] += 1
                stats['dropped_weight_max'] = max(stats['dropped_weight_max'], w)
        items = sorted(infl.items(), key=lambda kv: -kv[1][0])
        total = sum(v[0] for _, v in items)
        for k, (bone, (w, _)) in enumerate(items):
            newJ[i, k] = index[bone]
            newW[i, k] = w / total
    return newJ, newW, stats

# ----------------------------------------------------------------------------- writing the GLB


def _mat4(R, t):
    m = np.eye(4)
    m[:3, :3] = R
    m[:3, 3] = t
    return m


def write_glb(body, skel, new_weights, out_path, extras=None):
    """The body GLB with the new skeleton, skin and weights. Mesh, morph targets, materials and
    images are the source's bytes; the old joint nodes are replaced by the new bones (same scene
    layout: the skeleton's root and the mesh node at the top)."""
    g = copy.deepcopy(body.gltf)
    binary = bytearray(body.binary)
    nodes = g['nodes']
    old_joint_nodes = set(body.joint_nodes)
    keep = [i for i in range(len(nodes)) if i not in old_joint_nodes]
    for i in keep:
        if any(c in old_joint_nodes for c in nodes[i].get('children', [])):
            raise ValueError(f'node {nodes[i].get("name")} hangs under the old skeleton')
    new_nodes, index = [], {}
    for name in skel.order:
        index[name] = len(new_nodes)
        L, T = skel.local_rest(name)
        n = {'name': name}
        if np.abs(T).max() > 0:
            n['translation'] = [float(v) for v in T]
        q = m_to_q(L)
        if np.abs(q[:3]).max() > 1e-9:
            n['rotation'] = [float(v) for v in q]
        new_nodes.append(n)
    for name in skel.order:
        kids = [index[c] for c in skel.children(name)]
        if kids:
            new_nodes[index[name]]['children'] = kids
    remap = {}
    for i in keep:
        remap[i] = len(new_nodes)
        new_nodes.append(nodes[i])
    old_root = body.joint_nodes[body.joints.index(body.order[0])]
    for n in new_nodes[len(skel.order):]:
        if 'children' in n:
            n['children'] = [remap[c] for c in n['children']]
    for scene in g['scenes']:
        scene['nodes'] = [index['root'] if i == old_root else remap[i] for i in scene['nodes'] if i == old_root or i in remap]
    g['nodes'] = new_nodes
    skin = g['skins'][0]
    skin['joints'] = [index[n] for n in skel.order]
    skin['skeleton'] = index['root']
    # inverse bind matrices: appended at the end of the binary (the old ones are left unreferenced)
    ibm = np.stack([np.linalg.inv(_mat4(skel.bones[n]['R'], skel.bones[n]['head'])) for n in skel.order])
    while len(binary) % 16:
        binary.append(0)
    data = ibm.transpose(0, 2, 1).astype('<f4').tobytes()   # column-major
    acc = g['accessors'][skin['inverseBindMatrices']]
    users = [a for a in g['accessors'] if a.get('bufferView') == acc['bufferView']]
    if len(users) != 1:
        raise ValueError('the inverse bind matrices share their buffer view')
    # the same buffer view, moved to the new bytes (the old 56 matrices stay behind as padding)
    g['bufferViews'][acc['bufferView']].update(byteOffset=len(binary), byteLength=len(data))
    g['bufferViews'][acc['bufferView']].pop('byteStride', None)
    binary += data
    acc.update(count=len(skel.order))
    acc.pop('byteOffset', None)
    acc.pop('min', None)
    acc.pop('max', None)
    # joints and weights: same layout as the source (ubyte x4, float x4), rewritten in place
    if len(skel.order) > 255:
        raise ValueError('more bones than an unsigned byte holds')
    for p, (J, W) in zip(body.prims, new_weights):
        for key, arr, dt in (('joints', J, '<u1'), ('weights', W, '<f4')):
            a = g['accessors'][p['accessors'][key]]
            view = g['bufferViews'][a['bufferView']]
            want = np.dtype(dt).itemsize * 4
            stride = view.get('byteStride', want)
            if a['componentType'] != {'<u1': 5121, '<f4': 5126}[dt] or stride != want:
                raise ValueError(f'unexpected {key} layout')
            start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
            raw = np.ascontiguousarray(arr.astype(dt)).tobytes()
            binary[start:start + len(raw)] = raw
    g['buffers'][0]['byteLength'] = len(binary)
    asset = g.setdefault('asset', {})
    asset['generator'] = asset.get('generator', '') + ' + ue5_rig (blender/ue5_rig, pass R1)'
    ex = asset.setdefault('extras', {})
    ex['contract'] = SKELETON
    ex['previousContract'] = 'earthonline-humanoid-v1'
    ex['bones'] = len(skel.order)
    ex.update(extras or {})
    gltfio.write(out_path, g, bytes(binary))
    return index

# ----------------------------------------------------------------------------- posing


def old_world(body, local, hips=None):
    """Old skeleton FK (G): local rotation matrices (missing = identity) -> world R, P."""
    W, P = {}, {}
    for name in body.order:
        L = local.get(name, np.eye(3))
        p = body.parent[name]
        t = hips if (name == 'Hips' and hips is not None) else body.rest_t[name]
        if p is None:
            W[name], P[name] = L, t.copy()
        else:
            W[name] = W[p] @ L
            P[name] = P[p] + W[p] @ t
    return W, P


def old_skin_mats(body, W, P):
    out = []
    for name in body.joints:
        out.append(_mat4(W[name], P[name]) @ _mat4(np.eye(3), -body.P[name]))
    return np.stack(out)


def map_pose(body, skel, local, hips=None, twist=True):
    """An old pose as the new skeleton's: (local rotations, local translations of the bones that
    move: pelvis and the IK bones). Copied bones take the old joint's world turn on their own rest
    frame; 'follow' bones keep their rest relative to their parent; twist bones turn about their
    long axis by their share of the measured twist (twist=False: none, the old deformation)."""
    Wo, Po = old_world(body, local, hips)
    W, L, T = {}, {}, {}
    for name in skel.order:
        b = skel.bones[name]
        rule = b['rule']
        L0, T0 = skel.local_rest(name)
        if rule[0] == 'copy':
            W[name] = Wo[rule[1]] @ b['R']
        else:
            W[name] = W[b['parent']] @ L0
        L[name] = W[name] if b['parent'] is None else W[b['parent']].T @ W[name]
    if twist:
        for name in skel.order:
            rule = skel.bones[name]['rule']
            if rule[0] != 'twist':
                continue
            _, source, share, measure = rule
            if measure == 'child':
                L0c, _ = skel.local_rest(source)
                D = L[source] @ L0c.T          # the child's turn, in the parent's frame
            else:
                L0s, _ = skel.local_rest(source)
                D = L0s.T @ L[source]          # the bone's own turn, in its frame
            ang = twist_angle(D)
            L[name] = L[name] @ axis_angle((0, 1, 0), share * ang)
    # the pelvis carries the Hips translation (root: rest identity at the origin, as the old Root)
    if hips is not None:
        R_root = skel.bones['root']['R']
        T['pelvis'] = R_root.T @ (np.asarray(hips) + body.P['Root'] - skel.bones['root']['head'])
    # IK bones: their targets' world transforms, in their parents' frames
    Wn, Pn = fk(skel, L, T)
    for name in skel.order:
        rule = skel.bones[name]['rule']
        if rule[0] == 'ik' and rule[1]:
            p = skel.bones[name]['parent']
            L[name] = Wn[p].T @ Wn[rule[1]]
            T[name] = Wn[p].T @ (Pn[rule[1]] - Pn[p])
            Wn, Pn = fk(skel, L, T)
    return L, T


def fk(skel, L, T=None):
    T = T or {}
    W, P = {}, {}
    for name in skel.order:
        b = skel.bones[name]
        L0, T0 = skel.local_rest(name)
        l = L.get(name, L0)
        t = T.get(name, T0)
        p = b['parent']
        if p is None:
            W[name], P[name] = l, t.copy()
        else:
            W[name] = W[p] @ l
            P[name] = P[p] + W[p] @ t
    return W, P


def new_skin_mats(skel, W, P, ibm=None):
    out = []
    for k, name in enumerate(skel.order):
        inv = ibm[k] if ibm is not None else np.linalg.inv(_mat4(skel.bones[name]['R'], skel.bones[name]['head']))
        out.append(_mat4(W[name], P[name]) @ inv)
    return np.stack(out)


def skin(pos, J, W, mats):
    """Linear blend skinning: sum_k w_k M[j_k] v."""
    v = np.column_stack([pos, np.ones(len(pos))])
    M = np.einsum('nk,nkij->nij', W, mats[J])
    return np.einsum('nij,nj->ni', M, v)[:, :3]


class NewBody:
    """A re-rigged body GLB read back as the game would: nodes, inverse bind matrices, weights."""

    def __init__(self, path, skel):
        g, b = gltfio.read(path)
        self.gltf = g
        skin_ = g['skins'][0]
        names = [g['nodes'][j]['name'] for j in skin_['joints']]
        if names != skel.order:
            raise ValueError('joint order differs from the skeleton')
        self.ibm = accessor(g, b, skin_['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        prim = g['meshes'][0]['primitives'][0]
        self.pos = accessor(g, b, prim['attributes']['POSITION'])
        self.J = accessor(g, b, prim['attributes']['JOINTS_0'])
        self.W = accessor(g, b, prim['attributes']['WEIGHTS_0'])
        # the nodes' own rest transforms (what the file says), against the skeleton's
        nodes = {n['name']: n for n in g['nodes']}
        worst = 0.0
        Wr, Pr = {}, {}
        for name in skel.order:
            n = nodes[name]
            L = q_to_m(n.get('rotation', [0, 0, 0, 1]))
            t = np.array(n.get('translation', [0, 0, 0]))
            p = skel.bones[name]['parent']
            Wr[name] = L if p is None else Wr[p] @ L
            Pr[name] = t if p is None else Pr[p] + Wr[p] @ t
            worst = max(worst, np.abs(Wr[name] - skel.bones[name]['R']).max(), np.abs(Pr[name] - skel.bones[name]['head']).max())
            k = skel.order.index(name)
            worst = max(worst, np.abs(self.ibm[k] @ _mat4(Wr[name], Pr[name]) - np.eye(4)).max())
        self.rest_error = worst


def clip_frame(path, clip, t):
    """Local rotation matrices and the Hips translation of `clip` at time t (s), linearly
    interpolated (quaternion nlerp between the two keys), from a clip GLB on the old skeleton."""
    g, b = gltfio.read(path)
    names = [n.get('name') for n in g['nodes']]
    anim = next(a for a in g['animations'] if a['name'] == clip)
    local, hips = {}, None
    for ch in anim['channels']:
        node, path_ = names[ch['target']['node']], ch['target']['path']
        s = anim['samplers'][ch['sampler']]
        times = accessor(g, b, s['input'])[:, 0]
        vals = accessor(g, b, s['output'])
        t_ = min(max(t, times[0]), times[-1])
        k = int(np.searchsorted(times, t_, 'right') - 1)
        k = min(max(k, 0), len(times) - 2) if len(times) > 1 else 0
        u = 0.0 if len(times) == 1 else (t_ - times[k]) / (times[k + 1] - times[k])
        a = vals[k]
        c = vals[min(k + 1, len(vals) - 1)]
        if path_ == 'rotation':
            if np.dot(a, c) < 0:
                c = -c
            q = (1 - u) * a + u * c
            local[node] = q_to_m(q / np.linalg.norm(q))
        elif path_ == 'translation' and node == 'Hips':
            hips = (1 - u) * a + u * c
    duration = max(accessor(g, b, s['input'])[-1, 0] for s in anim['samplers'])
    return local, hips, duration


def components(pos, tris, digits=5):
    """Connected pieces of a mesh (vertices welded by position first): label per vertex."""
    key = np.round(pos, digits)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    parent = list(range(weld.max() + 1))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b, c in weld[tris]:
        ra, rb, rc = find(a), find(b), find(c)
        r = min(ra, rb, rc)
        parent[ra] = parent[rb] = parent[rc] = r
    roots = np.array([find(w) for w in weld])
    _, label = np.unique(roots, return_inverse=True)
    return label.ravel()


def mapping_table(skel):
    """The old-to-new mapping for the clip pipeline and the game (JSON-able)."""
    out = {'skeleton': SKELETON, 'from': 'earthonline-humanoid-v1', 'bones': {}, 'old': {}}
    for name in skel.order:
        b = skel.bones[name]
        L0, T0 = skel.local_rest(name)
        rule = b['rule']
        entry = dict(parent=b['parent'], head=[round(float(v), 5) for v in b['head']],
                     tail=[round(float(v), 5) for v in b['tail']],
                     restWorldRotation=[round(float(v), 7) for v in m_to_q(b['R'])],
                     restLocalRotation=[round(float(v), 7) for v in m_to_q(L0)],
                     restLocalTranslation=[round(float(v), 6) for v in T0])
        if rule[0] == 'copy':
            entry['rule'] = 'copy'
            entry['from'] = rule[1]
            entry['how'] = 'world = oldWorld[from] * restWorld (old rests are identity)'
            out['old'].setdefault(rule[1], {})['rotation'] = name
        elif rule[0] == 'follow':
            entry['rule'] = 'follow'
            entry['how'] = 'local = restLocal (moves with its parent) in the exact mapping; free to bend in new clips'
        elif rule[0] == 'twist':
            entry['rule'] = 'twist'
            entry['share'] = rule[2]
            entry['measure'] = rule[3]
            entry['source'] = rule[1]
            entry['how'] = ("local = restLocal * twistY(share * a), a = twist about Y of " +
                            ("source.local * source.restLocal^-1 (the child's turn in the parent's frame)" if rule[3] == 'child'
                             else "source.restLocal^-1 * source.local (the bone's own pose turn)"))
        elif rule[0] == 'ik':
            entry['rule'] = 'ik'
            entry['target'] = rule[1]
            entry['how'] = 'world transform = target world transform (translation keyed too)' if rule[1] else 'stays at rest'
        out['bones'][name] = entry
    for old, rules in LIMB_ANCHORS.items():
        for side, x, _ in SIDES:
            out['old'].setdefault(old.format(S=side), {})['weightsSplitAlongLimb'] = [[t, n.format(s=x)] for t, n in rules]
    out['old']['Spine']['weightsSplitByHeight'] = ['spine_01', 'spine_02']
    out['old']['Spine1']['weightsSplitByHeight'] = ['spine_03', 'spine_04']
    out['old']['Neck']['weightsSplitByHeight'] = ['neck_01', 'neck_02']
    for side, x, _ in SIDES:
        out['old'][side + 'Hand']['weightsSplit'] = f'up to {METACARPAL_SHARE} of palm vertices onto the metacarpals near the knuckles'
        out['old'][side + 'Eye']['note'] = 'the new eye bone sits at the eyeball centre (sphere fit), not at the old joint'
    out['translation'] = {'Hips': 'pelvis (local to root; root rests at the origin with an identity rotation, so the value is unchanged)'}
    return out
