"""Pass U1: the two vehicles as skeletons, their moving parts and the axis rules to Unreal (plain numpy, no bpy).

A vehicle skeleton = every node of the vehicle GLB under its root (`vehicle_root` / `helicopter_root`), with the
node's rest TRS as the bone's local; a node with a mesh is a part rigidly bound to its own bone, a node without
one (seat points, entry points, cameras, pivots) is a bone with no weight, usable as a socket.

Every vehicle bone takes the WORLD-ALIGNED frame (bl_common.WORLD_FRAME: Blender frame = C @ G @ C^-1): a glTF node
with no rotation rests with identity rotation in Unreal (the vehicle root among them), and one rule converts any
point or direction given in a vehicle node's glTF frame, or in the vehicle root's (the clips' space), to that
bone's space in Unreal: (x, y, z) m -> (100 x, 100 z, 100 y) cm (ue_point).

The moving parts follow blender/vehicle_motion/vehicles.py (the clip pass's definition, also the packs' notes
`controls`), in each node's own glTF frame:
  car   door_L         rest @ Rx(-55 deg * door)        steering_wheel rest @ Ry(wheel deg)
  heli  cockpit_door_R rest @ Ry(+68 deg * door)        cyclic rest @ Rx(-fwd) @ Rz(-right)
        collective     rest @ Rx(+coll)                 pedal_L / pedal_R  (0, 0, -push) @ rest, push = +-pedal
and the pack's `vehicleFit`: translate (node's parent frame) added to the rest translation, before the controls.
"""
import math

import numpy as np

import config
import gltfio as G

FPS = 30.0

# glTF -> Blender axes (bl_common.C3) and Blender (right-handed, FBX file axes) -> Unreal (Y mirrored)
C3 = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
S3 = np.diag([1.0, -1.0, 1.0])
U3 = S3 @ C3     # glTF vector -> Unreal vector, for world-aligned frames: (x, y, z) -> (x, z, y)


def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    i, j = {'X': (1, 2), 'Y': (2, 0), 'Z': (0, 1)}[axis]
    m[i, i] = c
    m[i, j] = -s
    m[j, i] = s
    m[j, j] = c
    return m


def tr(v):
    m = np.eye(4)
    m[:3, 3] = v
    return m


def ue_point(p, cm=True):
    """A point or direction in a vehicle node's glTF frame (metres) -> the same bone's space in Unreal (cm)."""
    return (U3 @ np.asarray(p, float) * (100.0 if cm else 1.0)).tolist()


def ue_transform(m, child_world_aligned=False):
    """A 4x4 glTF transform of a child frame in a vehicle bone's frame (world-aligned) -> (location cm, FQuat
    x y z w) of the child's Unreal bone in that vehicle bone's Unreal space. The child is a character bone
    (glTF joint frame: hand_l, foot_r, ...; Blender relative = C X) or, with child_world_aligned, a vehicle bone or
    the character's `root` (Blender relative = C X C^-1). Unreal mirrors Y: M -> S M S."""
    r = C3 @ m[:3, :3] @ (C3.T if child_world_aligned else np.eye(3))
    q = G.m_to_q(S3 @ r @ S3)
    return (U3 @ m[:3, 3] * 100.0).tolist(), q.tolist()


def ue_root(x, z, yaw):
    """notes `root` [x, z, yaw] (vehicle frame) -> the character root's place in Unreal: location cm, yaw deg."""
    return [100.0 * x, 100.0 * z, 0.0], -math.degrees(yaw)


class Vehicle:
    def __init__(self, name):
        cfg = config.VEHICLES[name]
        self.name, self.kind, self.root = name, cfg['kind'], cfg['root']
        self.glb = cfg['glb']
        g = self.g = G.GLB(self.glb)
        self.bones, self.parent, self.node = [], {}, {}

        def visit(i, p):
            n = g.nodes[i]['name']
            self.bones.append(n)
            self.parent[n] = p
            self.node[n] = i
            for c in g.nodes[i].get('children', []):
                visit(c, n)
        visit(g.by_name[self.root], None)
        assert len(set(self.bones)) == len(self.bones), 'duplicate node names'
        self.rest_local = {n: G.trs_to_m(*g.rest_trs(self.node[n])) for n in self.bones}
        self.mesh = {n: g.nodes[self.node[n]]['mesh'] for n in self.bones if 'mesh' in g.nodes[self.node[n]]}
        self.deform = set(self.mesh)
        self.world_frame = set(self.bones)
        self.door_node, self.door_deg = config.DOOR[self.kind]
        self.hidden = [g.nodes[i]['name'] for i in range(len(g.nodes))
                       if g.nodes[i].get('extensions', {}).get('KHR_node_visibility', {}).get('visible') is False]

    # ---------------------------------------------------------------- poses
    def world(self, local):
        w = {}
        for n in self.bones:
            p = self.parent[n]
            w[n] = local[n] if p is None else w[p] @ local[n]
        return w

    def rest_world(self):
        return self.world(self.rest_local)

    def fitted(self, fit):
        """Rest locals with a pack's vehicleFit[kind] applied (translate in the parent frame; scale in the node's)."""
        out = dict(self.rest_local)
        for node, spec in (fit or {}).items():
            m = tr(spec['translate']) @ out[node]
            if 'scale' in spec:
                m = m @ np.diag(list(spec['scale']) + [1.0])
            out[node] = m
        return out

    def moved(self, base, name, ctl):
        m = base[name]
        if name == self.door_node:
            a = self.door_deg * ctl.get('door', 0.0)
            return m @ (rot('X', -a) if self.kind == 'car' else rot('Y', a))
        if name == 'steering_wheel':
            return m @ rot('Y', ctl.get('wheel', 0.0))
        if name == 'cyclic':
            return m @ rot('X', -ctl.get('fwd', 0.0)) @ rot('Z', -ctl.get('right', 0.0))
        if name == 'collective':
            return m @ rot('X', ctl.get('coll', 0.0))
        if name in ('pedal_L', 'pedal_R'):
            push = ctl.get('pedal', 0.0) * (1 if name == 'pedal_L' else -1)
            return tr((0.0, 0.0, -push)) @ m
        return m

    def pose(self, ctl, fit=None):
        base = self.fitted(fit)
        return {n: self.moved(base, n, ctl) for n in self.bones}

    # ---------------------------------------------------------------- the GLB's own clips
    def own_clips(self):
        return [a['name'] for a in self.g.json.get('animations', [])]

    def own_clip_locals(self, clip):
        pack = G.ClipPack(self.glb)
        s, nf = pack.sample(clip)
        out = []
        for f in range(nf):
            loc = {}
            for n in self.bones:
                t, r, sc = self.g.rest_trs(self.node[n])
                ch = s.get(n, {})
                if 'translation' in ch:
                    t = ch['translation'][f]
                if 'rotation' in ch:
                    r = ch['rotation'][f]
                if 'scale' in ch:
                    sc = ch['scale'][f]
                loc[n] = G.trs_to_m(t, r, sc)
            out.append(loc)
        return out

    # ---------------------------------------------------------------- mesh data (for the checks)
    def part_vertices(self, name):
        """World positions (vehicle glTF frame, metres) of a part's vertices, primitives in order."""
        w = self.rest_world()[name]
        vs = []
        for prim in self.g.json['meshes'][self.mesh[name]]['primitives']:
            p = self.g.accessor(prim['attributes']['POSITION']).astype(float)
            with np.errstate(all='ignore'):   # (spurious BLAS warnings with this machine's numpy; values are right)
                vs.append(p @ w[:3, :3].T + w[:3, 3])
        return np.vstack(vs)


# ---------------------------------------------------------------- per clip: controls, frames

def pack_keys(pack, clip):
    """Keys (frames at 30 fps) of a clip in a G.ClipPack. The FBX gets max(2, keys) frames: a one-key
    (one-pose) clip is written as 2 identical frames, as the rifle packs' one-pose clips are."""
    ch = pack.channels(clip)
    return int(round(max(t[-1] for t, _ in ch.values()) * FPS)) + 1


def clip_controls(kind, clip, notes_clip, nframes):
    """[frame] -> {control: value} for a pack clip: the door per frame from the notes (loops wrap: the closing frame
    = frame 0), the other controls from config.CLIP_CONTROLS (constants or a function of t = frame / 30)."""
    spec = config.CLIP_CONTROLS[clip]
    door = notes_clip['door']
    out = []
    for f in range(nframes):
        t = f / FPS
        c = {'door': float(door[min(f, len(door) - 1)] if not notes_clip.get('loop') else door[f % len(door)])}
        for k, v in spec.items():
            c[k] = float(v(t) if callable(v) else v)
        out.append(c)
    return out


def fit_of(notes, kind):
    return notes.get('vehicleFit', {}).get(kind, {})
