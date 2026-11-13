"""The skeleton in glTF space, and the conversions to Blender's.

glTF space ("G"): Y up, the character faces +Z, its left is +X, metres.

The body is the UE5 Mannequin-style skeleton `earthonline-ue5-v1` (blender/ue5_rig/UE5_SKELETON.md):
90 bones with UE5 names, each running along its local +Y, so a bone's rest rotation is no longer
the identity. The clips are AUTHORED in canonical frames: every bone's frame is its rest frame
turned back to the world axes, i.e. canonical world C[b] = W[b] * R[b]^-1, where W is the bone's
real world rotation and R[b] its rest world rotation. In canonical frames every rest rotation is
the identity, a bone's local rotation is C[parent]^-1 * C[b], and for every bone that took over an
old (earthonline-humanoid-v1) joint it is exactly the old joint's local rotation. All the authoring
math (gait.py, handling.py, ...) works in these frames; only the lowest layer converts:

  this module      the rest frames R[b] read from the body GLB; canonical FK
  rig.py           the rig's bones carry canonical frames; each skeleton bone copies an SK- child
                   that carries its real rest frame
  bake.read_pose   reads the skeleton and turns world rotations back into canonical ones
  bake.export      writes real glTF locals: local[b] = R[p]^-1 * Lc[b] * R[b], plus the twist and
                   IK bones (twist_and_ik)

Blender space ("B") is G turned a quarter turn about X: (x, y, z) -> (x, -z, y). A bone built with
the canonical frame (rest matrix QC in B) has its pose rotation_quaternion equal to the canonical
local rotation, and its location is the translation less the rest translation, in G axes.
"""
import json
import math
import pathlib

from mathutils import Matrix, Quaternion, Vector

from . import body, gltfio

C3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # G -> B
C4 = C3.to_4x4()
QC = C3.to_quaternion()
IDENTITY = Quaternion()
DATA = json.loads((pathlib.Path(__file__).resolve().parent / 'ue5_data.json').read_text())

SIDE = {'Left': 'l', 'Right': 'r'}
FINGER_PARTS = ('thumb', 'index', 'middle', 'ring', 'pinky')
# Twist bones (R1, blender/ue5_rig/ue5.py TWIST): name -> (parent, share, measure, source).
# 'child': share of the child's (hand / foot) twist about the parent's long axis, measured as
# local[child] * restLocal[child]^-1; 'self': share of the parent's own twist about its long axis,
# restLocal^-1 * local (negative: counter-rotating, the shoulder / hip end keeps less).
TWIST = {}
for _s in 'lr':
    TWIST.update({
        f'upperarm_twist_01_{_s}': (f'upperarm_{_s}', -0.50, 'self', f'upperarm_{_s}'),
        f'upperarm_twist_02_{_s}': (f'upperarm_{_s}', -0.25, 'self', f'upperarm_{_s}'),
        f'lowerarm_twist_02_{_s}': (f'lowerarm_{_s}', 0.47, 'child', f'hand_{_s}'),
        f'lowerarm_twist_01_{_s}': (f'lowerarm_{_s}', 0.88, 'child', f'hand_{_s}'),
        f'thigh_twist_01_{_s}': (f'thigh_{_s}', -0.30, 'self', f'thigh_{_s}'),
        f'thigh_twist_02_{_s}': (f'thigh_{_s}', -0.15, 'self', f'thigh_{_s}'),
        f'calf_twist_02_{_s}': (f'calf_{_s}', 0.24, 'child', f'foot_{_s}'),
        f'calf_twist_01_{_s}': (f'calf_{_s}', 0.44, 'child', f'foot_{_s}'),
    })
# IK bones and the bone whose world transform each takes (None: stays at rest)
IK = {'ik_foot_root': None, 'ik_foot_l': 'foot_l', 'ik_foot_r': 'foot_r',
      'ik_hand_root': None, 'ik_hand_gun': 'hand_r', 'ik_hand_l': 'hand_l', 'ik_hand_r': 'hand_r'}


def bone(side, part):
    """A sided bone's name: bone('Left', 'upperarm') -> 'upperarm_l'."""
    return f'{part}_{SIDE[side]}'


def is_finger(name):
    return name.split('_')[0] in FINGER_PARTS or '_metacarpal_' in name


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


def b2g(v):
    return Vector((v[0], v[2], -v[1]))


def rot_b(q):
    """A G-space rotation as a B-space rotation (similarity)."""
    return QC @ q @ QC.inverted()


def ypr(yaw=0.0, pitch=0.0, roll=0.0):
    """three.js Euler order 'YXZ' (radians): yaw about Y (+ turns left), then pitch about X
    (+ tips +Z down), then roll about Z."""
    return Quaternion((0, 1, 0), yaw) @ Quaternion((1, 0, 0), pitch) @ Quaternion((0, 0, 1), roll)


def gl_quat(xyzw):
    return Quaternion((xyzw[3], xyzw[0], xyzw[1], xyzw[2]))


def twist_angle(q, axis=Vector((0, 1, 0))):
    """Swing-twist: the angle (rad, -pi..pi) of q's twist about `axis` (ue5.twist_angle)."""
    if q.w < 0:
        q = -q
    p = Vector((q.x, q.y, q.z)).dot(axis)
    return 2 * math.atan2(p, q.w) if abs(p) + abs(q.w) > 1e-12 else 0.0


class Skeleton:
    """Bone names, parents, rest frames and canonical rest offsets, read from the body GLB."""

    def __init__(self, path, frames=None):
        """path: the body GLB (joint positions, hierarchy, rest transforms). frames: a JSON in the
        blender/ue5_rig/ue5_mapping.json schema giving each bone's canonical-to-bone frame R[b]
        (bones[b]['canonicalToBone'] if present, else bones[b]['restWorldRotation'], x y z w); None:
        <body>.frames.json beside the GLB if there is one, else R[b] = the rest world rotation (true
        for the EarthOnline -ue5 bodies, whose rest is the canonical I-pose)."""
        gltf, _ = gltfio.read(path)
        nodes = gltf['nodes']
        self.joints = [nodes[j]['name'] for j in gltf['skins'][0]['joints']]
        parent_of = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
        by_name = {n.get('name'): i for i, n in enumerate(nodes)}
        self.parent, self.rest_q, self.rest_t = {}, {}, {}
        for name in self.joints:
            i = by_name[name]
            p = parent_of.get(i)
            self.parent[name] = nodes[p]['name'] if p is not None and nodes[p]['name'] in self.joints else None
            self.rest_q[name] = gl_quat(nodes[i].get('rotation', [0, 0, 0, 1])).normalized()
            self.rest_t[name] = Vector(nodes[i].get('translation', [0, 0, 0]))
        self.order = []
        pending = list(self.joints)
        while pending:
            for name in list(pending):
                if self.parent[name] is None or self.parent[name] in self.order:
                    self.order.append(name)
                    pending.remove(name)
        # rest world rotations and heads (G), then the canonical-to-bone frames R[b]
        self.rest_world, self.head = {}, {}
        for name in self.order:
            p = self.parent[name]
            if p is None:
                self.rest_world[name], self.head[name] = self.rest_q[name].copy(), self.rest_t[name].copy()
            else:
                self.rest_world[name] = (self.rest_world[p] @ self.rest_q[name]).normalized()
                self.head[name] = self.head[p] + self.rest_world[p] @ self.rest_t[name]
        path = pathlib.Path(path)
        if frames is None and path.with_suffix('.frames.json').exists():
            frames = path.with_suffix('.frames.json')
        self.frames_file = str(frames) if frames else None
        doc = json.loads(pathlib.Path(frames).read_text()) if frames else {}
        spec = doc.get('bones', {})
        self.R = {}
        for name in self.order:
            b = spec.get(name, {})
            # (R1's mapping schema: canonicalToBone / restWorldRotation; a prepared body's frames
            # file, blender/bodies/prepare_body.py: R = A * bindWorld)
            q = b.get('canonicalToBone', b.get('R', b.get('restWorldRotation')))
            self.R[name] = gl_quat(q).normalized() if q else self.rest_world[name].copy()
        # The CANONICAL pose's joints. A body bound in the canonical I-pose (R = its rest world
        # rotations) has them at its rest heads. One bound in another pose (Tripo's T-pose) has each
        # bone's rest offset turned by its parent's R: head_c[b] = head_c[p] + R[p] * restT[b].
        self.bind_head = self.head
        self.posed_bind = any(self.R[n].rotation_difference(self.rest_world[n]).angle > 1e-4 for n in self.order)
        if self.posed_bind:
            head = {}
            for name in self.order:
                p = self.parent[name]
                head[name] = self.rest_t[name].copy() if p is None else head[p] + self.R[p] @ self.rest_t[name]
            self.head = head
        # each bone's local rotation in the canonical pose (real glTF terms): R[p]^-1 * R[b]; the
        # rest local rotation for an I-pose body. "Straight" / "no twist" is this, not the rest.
        self.canon_local = {n: (self.R[n] if self.parent[n] is None else self.R[self.parent[n]].inverted() @ self.R[n]).normalized()
                            if self.posed_bind else self.rest_q[n].copy() for n in self.order}
        # canonical rest offsets (rest rotations identity): head less the parent's head
        self.rest = {n: (self.head[n] - self.head[self.parent[n]]) if self.parent[n] else self.head[n].copy() for n in self.order}
        if 'pelvis' not in self.joints:
            raise ValueError(f'{path}: not a UE5-named body')
        # the twist and IK bones this body has (bones it lacks, e.g. jaw / eyes, are simply not keyed),
        # with the body's own shares where its frames file gives them (twistBones, '{s}' = l / r)
        twist = dict(TWIST)
        for pattern, t in doc.get('twistBones', {}).items():
            for s in 'lr':
                twist[pattern.format(s=s)] = (t['parent'].format(s=s), t['share'], t['measure'], t['source'].format(s=s))
        self.twist = {n: v for n, v in twist.items() if n in self.joints}
        self.ik = {n: v for n, v in IK.items() if n in self.joints}
        # the bones the rig drives (everything but the twist and IK bones)
        self.authored = [n for n in self.order if n not in TWIST and n not in IK]

    def fk(self, local, hips=None):
        """Canonical world positions and rotations (G) from canonical local rotations (missing =
        identity); `hips` is the pelvis translation (in root's frame; root rests at the origin)."""
        pos, rot = {}, {}
        for name in self.order:
            q = local.get(name, IDENTITY)
            parent = self.parent[name]
            offset = hips if (name == 'pelvis' and hips is not None) else self.rest[name]
            if parent is None:
                pos[name] = offset.copy()
                rot[name] = q.copy()
            else:
                pos[name] = pos[parent] + rot[parent] @ offset
                rot[name] = rot[parent] @ q
        return pos, rot

    @staticmethod
    def sight_eye(pos, rot, side):
        """Where the old skeleton's eye joint was (the point the aims weld to the sight): fixed in
        the head's frame (ue5_data.json sightEye). The new eye bones sit at the eyeball centres."""
        return pos['head'] + rot['head'] @ Vector((body.T.get('sightEye') or DATA['sightEye'])[side])

    def to_gltf(self, canon_rot):
        """Real glTF local rotations of the bones in canon_rot (canonical WORLD rotations):
        W[b] = C[b] * R[b], local[b] = W[parent]^-1 * W[b]."""
        world = {n: canon_rot[n] @ self.R[n] for n in canon_rot}
        return {n: (world[n] if self.parent[n] is None else world[self.parent[n]].inverted() @ world[n]).normalized()
                for n in canon_rot}, world


def grip():
    """The rifle grip's finger pose (canonical local rotations by UE5 name; ue5_data.json)."""
    return {n: gl_quat(q) for n, q in (body.T.get('grip') or DATA['grip']).items()}
