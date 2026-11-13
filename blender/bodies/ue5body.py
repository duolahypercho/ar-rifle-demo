"""Any UE5-named skinned body (Tripo, R1's re-rigged bodies, future deliveries): read it as it is,
derive how its bones relate to the clip pipeline's canonical frames, and pose it.

Pass T1a (2026-11-11). Plain numpy on the glTF data (runs in Blender's Python or system python3).
Spaces: glTF ("G": Y up, metres). The canonical reference pose is the old skeleton's rest: arms
straight down, palms forward, fingers as the old body's, legs straight, feet forward, facing +Z,
left at +X (blender/ue5_rig/UE5_SKELETON.md). R1's bodies are bound in it, so for them
boneWorld = canonicalWorld * R[b] with R[b] = their rest world rotation. For any other body

    R[b] = A[b] * Wbind[b]

Wbind[b] = the bone's bind world rotation (its own axes, whatever they are), A[b] = the world
rotation that takes the bone from its bind orientation to where it is in the canonical pose.
A[b] is derived from geometry: an anatomical frame G[b] (Y along the bone to its child joint, Z the
side its child swings into on flexion, built from the joints and the body, never from the bone's
own axes) is measured on the bind pose, and A[b] = C[b] * G[b]^T, where C[b] is that frame in the
canonical pose (R1's per-bone rest frames from ue5_mapping.json, which are exactly such frames).
Exceptions, on purpose:
  trunk (pelvis .. head)  A = the body's facing correction only: the modelled posture (spine curve,
                          head carriage) is kept, not straightened onto R1's dead-straight column
  feet and balls          frame from the sole: heading (ankle to ball, on the ground) and up; the
                          foot's own pitch is kept so the sole stays flat
  metacarpals             A = A[hand]: the palm stays rigid
  twist bones             A = A[parent], and the forearm / shin twist bones take their share of the
                          hand's / foot's twist about the limb between bind and canonical (the
                          pronated T-pose forearm is untwisted along its length, not at the wrist)
"""
import json
import math
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from rifle_motion import gltfio  # noqa: E402
from ue5_rig import ue5  # noqa: E402

SIDES = (('l', 1.0), ('r', -1.0))
FINGERS = ('index', 'middle', 'ring', 'pinky')
TRUNK = ('root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'neck_01', 'neck_02', 'head',
         'jaw', 'eye_l', 'eye_r')
# old joint (rifle-motion clips, earthonline-humanoid-v1) -> bone, as R1 (Spine/Spine1/Spine2 on
# spine_01/03/05; spine_02/04, neck_02 and the metacarpals follow their parent)
OLD = {'Root': 'root', 'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine1': 'spine_03', 'Spine2': 'spine_05',
       'Neck': 'neck_01', 'Head': 'head', 'Jaw': 'jaw', 'LeftEye': 'eye_l', 'RightEye': 'eye_r'}
for _S, _s in (('Left', 'l'), ('Right', 'r')):
    OLD.update({f'{_S}Shoulder': f'clavicle_{_s}', f'{_S}Arm': f'upperarm_{_s}', f'{_S}ForeArm': f'lowerarm_{_s}',
                f'{_S}Hand': f'hand_{_s}', f'{_S}UpLeg': f'thigh_{_s}', f'{_S}Leg': f'calf_{_s}',
                f'{_S}Foot': f'foot_{_s}', f'{_S}ToeBase': f'ball_{_s}'})
    for _k in (1, 2, 3):
        OLD[f'{_S}HandThumb{_k}'] = f'thumb_0{_k}_{_s}'
        for _F in ('Index', 'Middle', 'Ring', 'Pinky'):
            OLD[f'{_S}Hand{_F}{_k}'] = f'{_F.lower()}_0{_k}_{_s}'
BONE_TO_OLD = {v: k for k, v in OLD.items()}
IK = ['ik_foot_root', 'ik_foot_l', 'ik_foot_r', 'ik_hand_root', 'ik_hand_gun', 'ik_hand_l', 'ik_hand_r']
IK_PARENT = {'ik_foot_root': 'root', 'ik_foot_l': 'ik_foot_root', 'ik_foot_r': 'ik_foot_root', 'ik_hand_root': 'root',
             'ik_hand_gun': 'ik_hand_root', 'ik_hand_l': 'ik_hand_gun', 'ik_hand_r': 'ik_hand_gun'}
IK_TARGET = {'ik_foot_root': None, 'ik_foot_l': 'foot_l', 'ik_foot_r': 'foot_r', 'ik_hand_root': None,
             'ik_hand_gun': 'hand_r', 'ik_hand_l': 'hand_l', 'ik_hand_r': 'hand_r'}
MAPPING = HERE.parent / 'ue5_rig' / 'ue5_mapping.json'


def deg(R):
    """Rotation angle of a 3x3 rotation, degrees."""
    return math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2))))


def orthonormal(M):
    u, _, vt = np.linalg.svd(M)
    R = u @ vt
    if np.linalg.det(R) < 0:
        u[:, -1] *= -1
        R = u @ vt
    return R


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    m = np.eye(4)
    m[:3, :3] = ue5.q_to_m(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1]), float)
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m


def mat4(R, t):
    m = np.eye(4)
    m[:3, :3] = R
    m[:3, 3] = t
    return m


class Body:
    """A skinned GLB with UE5 bone names, read as delivered: bind world frames (from the inverse
    bind matrices, which define the skinning), joint positions, one mesh primitive."""

    def __init__(self, path):
        self.path = pathlib.Path(path)
        g, b = gltfio.read(self.path)
        self.gltf, self.binary = g, b
        nodes = g['nodes']
        if len(g.get('skins', [])) != 1:
            raise ValueError('one skin expected')
        skin = g['skins'][0]
        self.joint_nodes = list(skin['joints'])
        self.names = [nodes[j]['name'] for j in self.joint_nodes]
        parent_of = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
        self.parent = {}
        for j in self.joint_nodes:
            p = parent_of.get(j)
            self.parent[nodes[j]['name']] = nodes[p]['name'] if p in self.joint_nodes else None

        def world(i):
            return node_matrix(nodes[i]) if i not in parent_of else world(parent_of[i]) @ node_matrix(nodes[i])
        self.node_world = {nodes[j]['name']: world(j) for j in self.joint_nodes}
        ibm = ue5.accessor(g, b, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.ibm = ibm
        self.W, self.P, self.scale = {}, {}, {}
        for k, name in enumerate(self.names):
            bind = np.linalg.inv(ibm[k])
            self.W[name] = orthonormal(bind[:3, :3])
            self.P[name] = bind[:3, 3].copy()
            self.scale[name] = np.linalg.norm(bind[:3, :3], axis=0)
        # how far the node chain is from the bind (a body whose rest is not its bind would be a trap)
        self.rest_vs_bind = max(np.abs(self.node_world[n] @ ibm[k] - np.eye(4)).max() for k, n in enumerate(self.names))
        mesh_nodes = [i for i, n in enumerate(nodes) if 'mesh' in n]
        if len(mesh_nodes) != 1 or len(g['meshes'][nodes[mesh_nodes[0]]['mesh']]['primitives']) != 1:
            raise ValueError('one mesh with one primitive expected')
        self.mesh_node = mesh_nodes[0]
        prim = g['meshes'][nodes[self.mesh_node]['mesh']]['primitives'][0]
        self.prim = prim
        a = prim['attributes']
        if 'JOINTS_1' in a:
            raise ValueError('more than 4 influences per vertex in the source')
        self.pos = ue5.accessor(g, b, a['POSITION'])
        self.nrm = ue5.accessor(g, b, a['NORMAL']) if 'NORMAL' in a else None
        self.J = ue5.accessor(g, b, a['JOINTS_0'])
        self.Wt = ue5.accessor(g, b, a['WEIGHTS_0'])
        self.tris = ue5.accessor(g, b, prim['indices']).reshape(-1, 3)
        self.index = {n: k for k, n in enumerate(self.names)}
        self.order = []
        pending = list(self.names)
        while pending:
            for n in list(pending):
                if self.parent[n] is None or self.parent[n] in self.order:
                    self.order.append(n)
                    pending.remove(n)

    def has(self, n):
        return n in self.index

    def children(self, n):
        return [c for c in self.order if self.parent[c] == n]

    def bone_weight(self, names):
        ks = [self.index[n] for n in names if n in self.index]
        return np.where(np.isin(self.J, ks), self.Wt, 0).sum(1)

# ----------------------------------------------------------------------------- canonical frames


def canonical_frames(path=MAPPING):
    """C[b]: R1's rest world rotations (the anatomical frames in the canonical pose)."""
    d = json.loads(pathlib.Path(path).read_text())
    return {n: ue5.q_to_m(e['restWorldRotation']) for n, e in d['bones'].items()}, d


def body_axes(body):
    """(left, up, forward) of the body in bind, from the hips and the feet (not from bone axes)."""
    P = body.P
    left = P['thigh_l'] - P['thigh_r']
    up = np.array([0.0, 1.0, 0.0])
    left = left - (left @ up) * up
    left /= np.linalg.norm(left)
    fwd = np.cross(left, up)
    # the toes must agree (a model facing -Z would give feet pointing against fwd)
    toes = sum(P[f'ball_{s}'] - P[f'foot_{s}'] for s, _ in SIDES)
    if toes @ fwd < 0:
        raise ValueError('the toes point backwards against left x up: the body is mirrored or reversed')
    return left, up, fwd


def frame(y, z_hint):
    return ue5.frame(y, z_hint)


def _flex_side(a, b, c, hint, min_deg=5.0):
    """Side the segment b->c swings into relative to a->b (the flexed side), if the joint at b is bent
    by more than min_deg and agrees with `hint`; else `hint`."""
    u, v = b - a, c - b
    u, v = u / np.linalg.norm(u), v / np.linalg.norm(v)
    ang = math.degrees(math.acos(max(-1, min(1, u @ v))))
    side = v - (v @ u) * u
    if ang > min_deg and np.linalg.norm(side) > 1e-9:
        side /= np.linalg.norm(side)
        if side @ hint > 0.5:
            return side, ang, 'plane'
    return np.asarray(hint, float), ang, 'hint'


def anatomical(body, C=None):
    """G[b] (bind, world) for every limb bone, and how each was built. C: the canonical target
    frames (only the hand's is used, to carry the thumb hint into the bind); None for the
    reference body, which is bound in the canonical pose."""
    P = body.P
    left, up, fwd = body_axes(body)
    G, how = {}, {}
    for s, sign in SIDES:
        n = lambda b: f'{b}_{s}'  # noqa: E731
        G[n('clavicle')] = frame(P[n('upperarm')] - P[n('clavicle')], up)
        how[n('clavicle')] = 'y clavicle->upperarm, z body up'
        # elbow hinge: from the arm's own plane if bent, else body forward
        z_arm, ang, src = _flex_side(P[n('upperarm')], P[n('lowerarm')], P[n('hand')], fwd)
        G[n('upperarm')] = frame(P[n('lowerarm')] - P[n('upperarm')], z_arm)
        G[n('lowerarm')] = frame(P[n('hand')] - P[n('lowerarm')], z_arm)
        how[n('upperarm')] = how[n('lowerarm')] = f'y along the bone, z elbow flex side ({src}, elbow bent {ang:.1f} deg)'
        # palm: normal from the knuckle row (index -> pinky) and the wrist -> middle knuckle line
        y_hand = P[n('middle_01')] - P[n('hand')]
        row = P[n('index_01')] - P[n('pinky_01')]
        palm = sign * np.cross(y_hand / np.linalg.norm(y_hand), row / np.linalg.norm(row))
        palm /= np.linalg.norm(palm)
        G[n('hand')] = frame(y_hand, palm)
        how[n('hand')] = 'y wrist->middle knuckle, z palm normal (knuckle row x hand line)'
        for f in FINGERS:
            j = [P[n(f'{f}_0{k}')] for k in (1, 2, 3)]
            seg = [j[1] - j[0], j[2] - j[1], j[2] - j[1]]
            # the finger's curl side: from the plane of its own joints if it is bent, else the palm normal
            z, ang, src = _flex_side(j[0], j[1], j[2], palm)
            for k in range(3):
                b = n(f'{f}_0{k + 1}')
                G[b] = frame(seg[k], z)
                how[b] = f'y along the finger, z curl side ({src}, bent {ang:.0f} deg at 02; else palm normal)'
        # thumb: R1's hint ((-0.7 s, 0, 0.7) in the canonical pose) carried into the bind by the hand's turn
        Ah = np.eye(3) if C is None else C[n('hand')] @ G[n('hand')].T
        tz = Ah.T @ np.array([-0.7 * sign, 0, 0.7])
        t = [P[n(f'thumb_0{k}')] for k in (1, 2, 3)]
        tseg = [t[1] - t[0], t[2] - t[1], t[2] - t[1]]
        for k in range(3):
            G[n(f'thumb_0{k + 1}')] = frame(tseg[k], tz)
            how[n(f'thumb_0{k + 1}')] = 'y along the thumb, z across the palm (R1 hint in the hand frame)'
        z_leg, ang, src = _flex_side(P[n('thigh')], P[n('calf')], P[n('foot')], -fwd)
        G[n('thigh')] = frame(P[n('calf')] - P[n('thigh')], z_leg)
        G[n('calf')] = frame(P[n('foot')] - P[n('calf')], z_leg)
        how[n('thigh')] = how[n('calf')] = f'y along the bone, z knee flex side (back; {src}, knee bent {ang:.1f} deg)'
        # foot: from the sole. heading = ankle -> ball on the ground; up
        h = P[n('ball')] - P[n('foot')]
        h = h - (h @ up) * up
        G[n('foot')] = frame(h, up)
        G[n('ball')] = G[n('foot')]
        how[n('foot')] = how[n('ball')] = 'sole frame: y ankle->ball heading on the ground, z up (pitch kept)'
    return G, how


def reference_anatomy(ref_body):
    """The canonical target frames: the anatomical frames G measured on the reference body (R1's
    player, bound in the canonical pose) with the same construction. Using these rather than R1's
    published bone frames makes 'palm to palm' exact (R1's frames take Z from world forward, its
    knuckle-row palm normal is 4 degrees off that; see validate)."""
    G, _ = anatomical(ref_body, None)
    return G


def derive(body, C):
    """A[b], R[b] (canonical-pose world rotation in the bone's own axes) for every bone of `body`,
    plus the twist pre-turns and per-bone notes. C: canonical target frames per limb bone
    (reference_anatomy(R1 player), or R1's published frames)."""
    left, up, fwd = body_axes(body)
    facing = np.column_stack([left, up, fwd]).T          # takes the body's (left, up, fwd) to (X, Y, Z)
    G, how = anatomical(body, C)
    A, notes = {}, {}
    for name in body.order:
        if name.startswith('clavicle_'):
            A[name] = facing
            notes[name] = 'clavicle: facing correction only (modelled posture kept; Tripo\'s points 12 deg back)'
        elif name in G:
            if name.startswith(('foot_', 'ball_')):
                # target: the sole frame with heading +Z, up +Y
                A[name] = frame((0, 0, 1), (0, 1, 0)) @ G[name].T
            else:
                A[name] = C[name] @ G[name].T
            notes[name] = how[name]
        elif name in TRUNK:
            A[name] = facing
            notes[name] = 'trunk: facing correction only (modelled posture kept)'
    for name in body.order:
        if name in A:
            continue
        p = body.parent[name]
        if 'metacarpal' in name:
            A[name] = A[p]
            notes[name] = 'metacarpal: A = A[hand] (palm rigid)'
        elif 'twist' in name:
            A[name] = A[p]
            notes[name] = 'twist: A = A[parent] (+ pre-turn below for forearm / shin)'
        elif name.startswith('ik_'):
            continue
        else:
            raise ValueError(f'no frame rule for {name}')
    pre = {}
    for s, _ in SIDES:
        for limb, child in ((f'lowerarm_{s}', f'hand_{s}'), (f'calf_{s}', f'foot_{s}')):
            axis = body.P[child] - body.P[limb]
            axis /= np.linalg.norm(axis)
            D = A[limb].T @ A[child]               # the child's extra turn relative to the limb (world, bind)
            a0 = ue5.twist_angle(D, axis)
            pre[limb] = a0
            for tw in body.children(limb):
                if 'twist' in tw:
                    share = TWIST_SHARE[tw[:-2]]
                    A[tw] = A[limb] @ ue5.axis_angle(axis, share * a0)
                    notes[tw] = f'twist: A[parent] then {math.degrees(share * a0):+.1f} deg about the limb ({share:.2f} of the {child} pre-turn {math.degrees(a0):+.1f})'
    R = {n: A[n] @ body.W[n] for n in A}
    return dict(A=A, R=R, G=G, notes=notes, pre=pre, facing=facing)


# R1's shares (UE5_SKELETON.md); prepare_body may refit them to a body's weights
TWIST_SHARE = {'upperarm_twist_01': -0.50, 'upperarm_twist_02': -0.25, 'lowerarm_twist_02': 0.47,
               'lowerarm_twist_01': 0.88, 'thigh_twist_01': -0.30, 'thigh_twist_02': -0.15,
               'calf_twist_02': 0.24, 'calf_twist_01': 0.44}
TWIST_SOURCE = {'upperarm_twist': ('upperarm', 'self'), 'lowerarm_twist': ('hand', 'child'),
                'thigh_twist': ('thigh', 'self'), 'calf_twist': ('foot', 'child')}

# ----------------------------------------------------------------------------- posing


class Rig:
    """A body's skeleton with canonical frames: names (parents first), parent, bind world W, heads
    P, canonical world R. Poses map an old-skeleton pose (clip, canonical frames) onto it."""

    def __init__(self, names, parent, W, P, R, shares=None):
        self.order = list(names)
        self.parent = dict(parent)
        self.W, self.P, self.R = W, P, R
        self.shares = dict(TWIST_SHARE, **(shares or {}))
        self.idx = {n: k for k, n in enumerate(self.order)}
        self.ibm = np.stack([np.linalg.inv(mat4(W[n], P[n])) for n in self.order])
        # canonical locals: rotation R_parent^T R, translation = bind local offset
        self.Lc, self.Tb = {}, {}
        for n in self.order:
            p = self.parent[n]
            self.Lc[n] = R[n] if p is None else R[p].T @ R[n]
            self.Tb[n] = P[n] if p is None else W[p].T @ (P[n] - P[p])

    def fk(self, L, T=None):
        T = T or {}
        Wd, Pd = {}, {}
        for n in self.order:
            p = self.parent[n]
            l = L.get(n, self.Lc[n])
            t = T.get(n, self.Tb[n])
            if p is None:
                Wd[n], Pd[n] = l, np.array(t, float)
            else:
                Wd[n] = Wd[p] @ l
                Pd[n] = Pd[p] + Wd[p] @ t
        return Wd, Pd

    def canonical(self):
        return self.fk({})

    def bind(self):
        return dict(self.W), dict(self.P)

    def mats(self, Wd, Pd):
        return np.stack([mat4(Wd[n], Pd[n]) @ self.ibm[k] for k, n in enumerate(self.order)])

    def map_old(self, old_world, hips_offset=None, twist=True, extra=None):
        """old_world: old joint -> world rotation (canonical frames, old rests identity). Copy
        bones: W = Wold * R; follow bones: canonical local; twist bones: canonical local turned
        about Y (Tripo and R1 bones both run along +Y) by share * twist of the source."""
        Wd, L = {}, {}
        for n in self.order:
            p = self.parent[n]
            old = BONE_TO_OLD.get(n)
            if old is not None and old in old_world:
                Wd[n] = old_world[old] @ self.R[n]
            elif p is None:
                Wd[n] = self.R[n]
            else:
                Wd[n] = Wd[p] @ self.Lc[n]
            L[n] = Wd[n] if p is None else Wd[p].T @ Wd[n]
        if extra:
            for n, d in extra.items():
                L[n] = self.Lc[n] @ d
        if twist:
            for n in self.order:
                if 'twist' not in n:
                    continue
                key = n[:-2]
                src_kind, measure = TWIST_SOURCE[key.rsplit('_', 1)[0]]
                s = n[-1]
                src = f'{src_kind}_{s}'
                if measure == 'child':
                    D = L[src] @ self.Lc[src].T                       # child's turn in the parent's frame
                    ang = ue5.twist_angle(D, self._long_axis_in(self.parent[n]))
                else:
                    D = self.Lc[src].T @ L[src]                       # bone's own turn in its frame
                    ang = ue5.twist_angle(D, (0, 1, 0))
                L[n] = self.Lc[n] @ ue5.axis_angle((0, 1, 0), self.shares[key] * ang)
        T = {}
        if hips_offset is not None:
            T['pelvis'] = self.Tb['pelvis'] + (self.W['root'].T @ hips_offset if self.parent['pelvis'] else hips_offset)
        Wd, Pd = self.fk(L, T)
        # IK bones follow their targets
        for n in IK:
            if n in self.idx and IK_TARGET[n]:
                p = self.parent[n]
                L[n] = Wd[p].T @ Wd[IK_TARGET[n]]
                T[n] = Wd[p].T @ (Pd[IK_TARGET[n]] - Pd[p])
        Wd, Pd = self.fk(L, T)
        return L, T, Wd, Pd

    def _long_axis_in(self, parent):
        """The limb's long axis (parent bone's +Y) expressed in the parent's local frame: +Y."""
        return (0, 1, 0)


def old_world_from_local(old_parent, old_order, local):
    W = {}
    for n in old_order:
        l = local.get(n, np.eye(3))
        p = old_parent[n]
        W[n] = l if p is None else W[p] @ l
    return W


def skin(pos, J, Wt, mats):
    return ue5.skin(pos, J, Wt, mats)
