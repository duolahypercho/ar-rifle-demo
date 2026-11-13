"""Prepare any UE5-named skinned GLB (Tripo or similar) as a game-ready player body (pass T1a).

Run (headless, own process; never a shared Blender):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
      --python blender/bodies/prepare_body.py -- \
      --src blender/bodies/tripo/source/tripo_main_character.glb --out blender/bodies/tripo --name tripo-player-ue5
  (system python3 also works; then the painted-eye search, which decodes the texture, is skipped)

Arguments
  --src PATH         the delivered GLB (one skinned mesh, UE5 bone names, any bind pose / bone axes)
  --out DIR          output folder
  --name NAME        output body name (NAME.glb); frames / metrics / audit are <prefix>_*.json
  --prefix P         prefix of the JSON files (default: first word of NAME, e.g. 'tripo')
  --height M         standing height to scale to (default 1.75); soles go on y = 0, pelvis on x = z = 0
  --reference PATH   the canonical reference body (default public/characters/civilian-m-01-player-ue5.glb)
  --no-fix           write the weights as delivered (no relabel / strays / shoulder repair)
  --no-shoulder-repair  skip the shoulder repair (upper-arm weight on torso skin inboard of the joint -> clavicle)
  --no-joint-repair  skip the elbow / knee repair (pass F1: the upper / lower chain split set along the limb)
  --clips            also write <prefix>_source_clips.glb (skeleton + the source's animations, no mesh)

Writes NAME.glb, <prefix>_frames.json, <prefix>_metrics.json, <prefix>_weights_audit.json.
"""
import argparse
import copy
import json
import math
import pathlib
import struct
import sys
import tempfile

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ue5body as U  # noqa: E402
from rifle_motion import gltfio  # noqa: E402
from ue5_rig import ue5  # noqa: E402

ROOT = HERE.parent.parent
LIMBS = {   # chain: (bones in the delivered order shoulder/hip end -> far end, from-joint, to-joint)
    'upperarm': (['upperarm', 'upperarm_twist_01', 'upperarm_twist_02'], 'upperarm', 'lowerarm'),
    'lowerarm': (['lowerarm', 'lowerarm_twist_02', 'lowerarm_twist_01'], 'lowerarm', 'hand'),
    'thigh': (['thigh', 'thigh_twist_01', 'thigh_twist_02'], 'thigh', 'calf'),
    'calf': (['calf', 'calf_twist_02', 'calf_twist_01'], 'calf', 'foot'),
}
# twist targets (effective fraction of the measured twist a vertex should carry, along the limb t)
# from R1's anchors: upper arm 0.5 at the shoulder -> 1 at the elbow; thigh 0.7 -> 1; forearm 0 at 15 %
# -> 1 at the wrist; shin 0 at 15 % -> 0.5 at the ankle
RAMP = {
    'upperarm': lambda t: np.interp(t, [0.1, 1.0], [0.5, 1.0]),
    'thigh': lambda t: np.interp(t, [0.1, 1.0], [0.7, 1.0]),
    'lowerarm': lambda t: np.interp(t, [0.15, 1.0], [0.0, 1.0]),
    'calf': lambda t: np.interp(t, [0.15, 1.0], [0.0, 0.5]),
}


def log(*a):
    print('[prepare_body]', *a, flush=True)

# ----------------------------------------------------------------------------- the body, scaled


class Prepared:
    """The delivered body scaled / recentred, with the IK bones added (names parents first)."""

    def __init__(self, src, height=1.75):
        b = U.Body(src)
        self.src = b
        lo, hi = b.pos[:, 1].min(), b.pos[:, 1].max()
        self.source_height = float(hi - lo)
        self.s = height / self.source_height
        self.c = np.array([b.P['pelvis'][0], lo, b.P['pelvis'][2]])
        self.names = list(b.order)
        self.parent = dict(b.parent)
        self.W = {n: b.W[n].copy() for n in self.names}
        self.P = {n: self.s * (b.P[n] - self.c) for n in self.names}
        # root: identity at the origin (it carries no weight; R1 convention)
        if b.bone_weight(['root']).max() > 0:
            raise ValueError('root carries weight')
        self.root_was = dict(rotation=ue5.m_to_q(b.W['root']).tolist(), position=(self.s * (b.P['root'] - self.c)).tolist())
        self.W['root'], self.P['root'] = np.eye(3), np.zeros(3)
        self.pos = self.s * (b.pos - self.c)
        self.nrm = b.nrm
        self.tris = b.tris
        # joints re-indexed to the new order
        remap = np.array([self.names.index(n) for n in b.names])
        self.J = remap[b.J]
        self.Wt = b.Wt.copy()
        for n in U.IK:
            if n in self.names:
                continue
            t = U.IK_TARGET[n]
            self.names.append(n)
            self.parent[n] = U.IK_PARENT[n]
            self.W[n] = self.W[t].copy() if t else np.eye(3)
            self.P[n] = self.P[t].copy() if t else np.zeros(3)
        self.index = {n: k for k, n in enumerate(self.names)}

    def children(self, n):
        return [c for c in self.names if self.parent[c] == n]

    def bone_weight(self, names, J=None, Wt=None):
        J = self.J if J is None else J
        Wt = self.Wt if Wt is None else Wt
        ks = [self.index[n] for n in names if n in self.index]
        return np.where(np.isin(J, ks), Wt, 0).sum(1)

    def as_body(self):
        """A ue5body.Body-like view (for derive / anatomical)."""
        v = type('B', (), {})()
        v.P, v.W, v.parent = self.P, self.W, self.parent
        v.order = [n for n in self.names if not n.startswith('ik_')]
        v.children = self.children
        return v

# ----------------------------------------------------------------------------- weights


def limb_t(p, s, chain):
    bones, a, b = LIMBS[chain]
    A, B = p.P[f'{a}_{s}'], p.P[f'{b}_{s}']
    d = B - A
    return ((p.pos - A) @ d) / (d @ d)


def audit(p, J, Wt):
    """Per bone: vertices, total weight; influences per vertex; root weight; limb profiles; strays."""
    out = dict(bones={}, influencesPerVertex=np.bincount((Wt > 0).sum(1), minlength=5).tolist())
    flat_j, flat_w = J.ravel(), Wt.ravel()
    for k, n in enumerate(p.names):
        m = (flat_j == k) & (flat_w > 0)
        out['bones'][n] = dict(vertices=int(m.sum()), totalWeight=round(float(flat_w[m].sum()), 2),
                               dominantVertices=int(((J[:, 0] == k) & (Wt[:, 0] > 0)).sum()))
    out['weightSum'] = [float(Wt.sum(1).min()), float(Wt.sum(1).max())]
    prof = {}
    for s, _ in U.SIDES:
        for chain, (bones, a, b) in LIMBS.items():
            t = limb_t(p, s, chain)
            names = [f'{x}_{s}' for x in bones]
            prof[f'{chain}_{s}'] = {n: round(float(np.average(t, weights=p.bone_weight([n], J, Wt) + 1e-12)), 3) for n in names}
    out['limbWeightCentroids_t'] = prof
    return out


def strays(p, J, Wt, beyond=1.3):
    """Influences of a limb chain's bones on vertices clearly past the far joint (t > beyond along
    that limb): e.g. the elbow end of the upper arm on mid-forearm skin, the thigh on the shin."""
    found = []
    mask = np.zeros(J.shape, bool)
    for s, _ in U.SIDES:
        for chain, (bones, a, b) in LIMBS.items():
            t = limb_t(p, s, chain)
            ks = [p.index[f'{x}_{s}'] for x in bones]
            m = np.isin(J, ks) & (Wt > 0) & (t[:, None] > beyond)
            if m.any():
                found.append(dict(chain=f'{chain}_{s}', influences=int(m.sum()), maxWeight=round(float(Wt[m].max()), 3),
                                  maxT=round(float(t[m.any(1)].max()), 2)))
            mask |= m
    return mask, found


def relabel(p, J):
    """The delivered upper-arm / thigh weights run upperarm (shoulder end) -> twist_01 (middle) ->
    twist_02 (elbow end): the reverse of the UE5 / R1 layout (twist_01 at the shoulder counter-turns,
    the bone itself takes the elbow end), so a twisting upper arm wrings the shoulder. Relabel the
    three weight groups (shapes unchanged): upperarm -> twist_01, twist_01 -> twist_02, twist_02 ->
    upperarm. Same for the thigh. Pure twist about the limb axis does not care where the twist bones'
    heads sit (they all lie on the axis)."""
    J = J.copy()
    moves = []
    for s, _ in U.SIDES:
        for limb in ('upperarm', 'thigh'):
            a, b1, b2 = (p.index[f'{limb}_{s}'], p.index[f'{limb}_twist_01_{s}'], p.index[f'{limb}_twist_02_{s}'])
            m_a, m_1, m_2 = J == a, J == b1, J == b2
            J[m_a], J[m_1], J[m_2] = b1, b2, a
            moves.append(f'{limb}_{s}: {limb} -> twist_01, twist_01 -> twist_02, twist_02 -> {limb}')
    return J, moves


def needs_relabel(p, J, Wt):
    out = {}
    for s, _ in U.SIDES:
        for limb in ('upperarm', 'thigh'):
            t = limb_t(p, s, limb)
            c = {n: float(np.average(t, weights=p.bone_weight([f'{n}_{s}'], J, Wt) + 1e-12)) for n in (limb, f'{limb}_twist_01', f'{limb}_twist_02')}
            out[f'{limb}_{s}'] = c[limb] < c[f'{limb}_twist_01'] < c[f'{limb}_twist_02']
    return all(out.values()), out


def fit_shares(p, J, Wt):
    """Twist shares that make the effective twist along each limb follow RAMP (least squares over the
    limb's vertices). 'self' chains (upper arm, thigh): bone = 1, twist bone = 1 + share; 'child'
    chains (forearm, shin): bone = 0, twist bone = share, hand / foot = 1."""
    shares = {}
    for chain, (bones, a, b) in LIMBS.items():
        rows, rhs = [], []
        for s, _ in U.SIDES:
            t = limb_t(p, s, chain)
            tw = [f'{x}_{s}' for x in bones[1:]]
            w_tw = np.stack([p.bone_weight([n], J, Wt) for n in tw], 1)
            w_bone = p.bone_weight([f'{bones[0]}_{s}'], J, Wt)
            if chain in ('upperarm', 'thigh'):
                base = w_bone + w_tw.sum(1)                   # all of it turns with the bone ...
                sel = (base > 0.3) & (t > -0.1) & (t < 1.05)
                rows.append(w_tw[sel])
                rhs.append(RAMP[chain](t[sel]) * base[sel] - base[sel])    # ... the twist bones take share more
            else:
                child = 'hand' if chain == 'lowerarm' else 'foot'
                w_child = p.bone_weight([f'{child}_{s}'], J, Wt)
                tot = w_bone + w_tw.sum(1) + w_child
                sel = (tot > 0.3) & (t > 0.0) & (t < 1.0)
                rows.append(w_tw[sel])
                rhs.append(RAMP[chain](t[sel]) * tot[sel] - w_child[sel])
        A, y = np.concatenate(rows), np.concatenate(rhs)
        x, *_ = np.linalg.lstsq(A, y, rcond=None)
        for k, n in enumerate(bones[1:]):
            shares[n] = round(float(x[k]), 3)
    return shares


def renormalise(J, Wt, drop=None):
    Wt = Wt.copy()
    if drop is not None:
        Wt[drop] = 0
    # sort by weight, max 4
    o = np.argsort(-Wt, 1)
    J = np.take_along_axis(J, o, 1)
    Wt = np.take_along_axis(Wt, o, 1)
    Wt /= Wt.sum(1, keepdims=True)
    J[Wt == 0] = 0
    return J, Wt


def smooth_region(p, J, Wt, bones, region, iters=3, amount=0.5):
    """Laplacian smoothing of the weights of `bones` over the vertices in `region` (welded by
    position); the other bones' weights are kept, the vertex total too."""
    from ue5_rig.proof import Mesh
    stub = type('B', (), {})()
    stub.prims = [dict(pos=p.pos, tris=p.tris)]
    mesh = Mesh(stub)
    nW = mesh.first.shape[0]
    ks = [p.index[n] for n in bones]
    dense = np.zeros((len(p.pos), len(p.names)))
    np.add.at(dense, (np.repeat(np.arange(len(p.pos)), 4), J.ravel()), Wt.ravel())
    dw = dense[mesh.first]
    reg = region[mesh.first]
    e = mesh.edges
    for _ in range(iters):
        acc = np.zeros((nW, len(ks)))
        cnt = np.zeros(nW)
        np.add.at(acc, e[:, 0], dw[e[:, 1]][:, ks])
        np.add.at(acc, e[:, 1], dw[e[:, 0]][:, ks])
        np.add.at(cnt, e[:, 0], 1)
        np.add.at(cnt, e[:, 1], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        cur = dw[:, ks]
        tot = cur.sum(1, keepdims=True)
        new = (1 - amount) * cur + amount * avg
        new *= tot / np.maximum(new.sum(1, keepdims=True), 1e-12)
        dw[np.ix_(reg, ks)] = new[reg]
    dense = dw[mesh.weld]
    o = np.argsort(-dense, 1)[:, :4]
    Jn = o
    Wn = np.take_along_axis(dense, o, 1)
    Wn /= Wn.sum(1, keepdims=True)
    Jn = np.where(Wn > 0, Jn, 0)
    return Jn.astype(np.int64), Wn

def shoulder_repair(p, J, Wt, inner=-0.10, outer=-0.01, to='clavicle'):
    """Cap the upper-arm influence on torso skin inboard of the shoulder joint (back, front and the
    side of the chest). Points inboard of the joint swing UP when the arm comes down (and down when it
    goes up), so a few percent of arm weight on scapula / chest skin shoves it over its unweighted
    neighbours: the back crease. Allowed fraction of the arm weight = smoothstep(inner, outer, lateral),
    lateral = outward distance from the shoulder joint (bind); the remainder goes to the clavicle.
    The arm itself (lateral > outer) and the armpit right under the joint keep their weights."""
    dense = np.zeros((len(p.pos), len(p.names)))
    np.add.at(dense, (np.repeat(np.arange(len(p.pos)), 4), J.ravel()), Wt.ravel())
    moved = {}
    for s, sign in U.SIDES:
        sh = p.P[f'upperarm_{s}']
        lateral = sign * (p.pos[:, 0] - sh[0])
        u = np.clip((lateral - inner) / (outer - inner), 0, 1)
        keep = u * u * (3 - 2 * u)
        arm = [p.index[f'{n}_{s}'] for n in ('upperarm', 'upperarm_twist_01', 'upperarm_twist_02')]
        before = dense[:, arm].sum(1)
        dense[:, arm] *= keep[:, None]
        rem = before - dense[:, arm].sum(1)
        dense[:, p.index[f'{to}_{s}']] += rem
        moved[s] = dict(vertices=int((rem > 1e-4).sum()), weightMoved=round(float(rem.sum()), 2), maxMoved=round(float(rem.max()), 3))
    o = np.argsort(-dense, 1)[:, :4]
    Wn = np.take_along_axis(dense, o, 1)
    Wn /= Wn.sum(1, keepdims=True)
    Jn = np.where(Wn > 0, o, 0)
    return Jn.astype(np.int64), Wn, moved

# pass F1: hinge joints. chain name -> (upper chain bones, lower chain bones, upper joint, hinge joint,
# end joint, (reach up, reach down) m, radius m, blend half-width m, the bone that takes new upper /
# lower weight)
JOINTS = {
    'elbow': (['upperarm', 'upperarm_twist_01', 'upperarm_twist_02'], ['lowerarm', 'lowerarm_twist_02', 'lowerarm_twist_01'],
              'upperarm', 'lowerarm', 'hand', (0.08, 0.11), 0.08, 0.05, 'upperarm', 'lowerarm'),
    'knee': (['thigh', 'thigh_twist_01', 'thigh_twist_02'], ['calf', 'calf_twist_02', 'calf_twist_01'],
             'thigh', 'calf', 'foot', (0.09, 0.11), 0.10, 0.04, 'thigh', 'calf'),
}
# the knee is repaired at the back only (the front, over the kneecap, keeps its delivered split: an
# all-round ramp there pushed a blade of skin out of the front of the bent knee); the elbow all round
BACK_ONLY = {'knee': (0.0, 0.025)}    # from the joint's plane: none in front of +0.0 m, full 2.5 cm behind
# NOT applied by default (which=('elbow',)): the knee has no ragged split like the elbow's; the ramp at
# the back left its soft stepped LBS seam as it was and added spikes at the zone's edge (F1 review).


def joint_repair(p, J, Wt, which=('elbow',), width=None):
    """Hinge-joint repair (pass F1; the inner-elbow 'flat triangle'). As delivered the split between
    the upper and the lower limb chain round the elbow / knee is ragged: next to each other on the
    inner forearm sit vertices with 0.9 and 0.1 upper-arm weight, up to 7 cm past the joint. Bent past
    about 60 degrees, linear blending leaves the first behind with the upper arm while the second go
    with the forearm, so single long triangles stand out of the surface (flipped against the skin's
    normals: the flat, bright, sharp-edged patch). Here the upper share of the two chains' weight is
    set from the position along the limb only: 1 - smoothstep over +-width round the hinge joint (bind
    pose), faded in from the edges of the zone so it meets the delivered weights there. Each chain's
    weight keeps its own split between the bone and its twist bones; other bones' weights (the sleeve,
    the shorts' hem) are untouched. Weights only: bones, bind, shares unchanged."""
    dense = np.zeros((len(p.pos), len(p.names)))
    np.add.at(dense, (np.repeat(np.arange(len(p.pos)), 4), J.ravel()), Wt.ravel())
    moved = {}
    for name in which:
        up_b, lo_b, a, b, c, (reach_up, reach_lo), radius, w, up_main, lo_main = JOINTS[name]
        if width:
            w = width
        for s, _ in U.SIDES:
            A, Bj = p.P[f'{a}_{s}'], p.P[f'{b}_{s}']
            u = (Bj - A) / np.linalg.norm(Bj - A)
            x = (p.pos - Bj) @ u
            rad = np.linalg.norm((p.pos - Bj) - np.outer(x, u), axis=1)
            iu = [p.index[f'{n}_{s}'] for n in up_b]
            il = [p.index[f'{n}_{s}'] for n in lo_b]
            Uw, Lw = dense[:, iu].sum(1), dense[:, il].sum(1)
            tot = Uw + Lw
            zone = (x > -reach_up) & (x < reach_lo) & (rad < radius) & (tot > 0.5)
            k = np.clip((x + w) / (2 * w), 0, 1)
            target = 1 - k * k * (3 - 2 * k)
            # fade: full inside, none at the zone's ends (2.5 cm ramps)
            fade = np.clip(np.minimum(x + reach_up, reach_lo - x) / 0.025, 0, 1)
            if name in BACK_ONLY:
                z0, ramp = BACK_ONLY[name]
                fwd = np.cross(u, p.P['thigh_l'] - p.P['thigh_r'])     # body forward (+Z for a T-pose facing +Z)
                fwd /= np.linalg.norm(fwd)
                fade = fade * np.clip(((Bj - p.pos) @ fwd - z0) / ramp, 0, 1)
            cur = np.where(tot > 0, Uw / np.maximum(tot, 1e-12), 0)
            new = cur + fade * (target - cur)
            newU, newL = new * tot, (1 - new) * tot
            m = zone
            for idx, old, newv, main in ((iu, Uw, newU, up_main), (il, Lw, newL, lo_main)):
                share = np.where(old[:, None] > 1e-9, dense[:, idx] / np.maximum(old[:, None], 1e-12), 0)
                share[old <= 1e-9, idx.index(p.index[f'{main}_{s}'])] = 1
                dense[np.ix_(m, idx)] = share[m] * newv[m, None]
            ch = np.abs(new - cur) * tot
            moved[f'{name}_{s}'] = dict(vertices=int((m & (ch > 1e-4)).sum()), weightMoved=round(float(ch[m].sum()), 2),
                                        maxMoved=round(float(ch[m].max()), 3))
    o = np.argsort(-dense, 1)[:, :4]
    Wn = np.take_along_axis(dense, o, 1)
    Wn /= Wn.sum(1, keepdims=True)
    Jn = np.where(Wn > 0, o, 0)
    return Jn.astype(np.int64), Wn, moved

# ----------------------------------------------------------------------------- GLB


class Packer:
    def __init__(self):
        self.blob = bytearray()
        self.views, self.accessors = [], []

    def view(self, data, target=None):
        while len(self.blob) % 4:
            self.blob.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.blob), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.blob += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, typ, target=None, minmax=False, normalized=False):
        dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: '<u1'}[ctype]
        a = np.ascontiguousarray(np.asarray(arr).astype(dt))
        acc = {'bufferView': self.view(a.tobytes(), target), 'componentType': ctype, 'count': int(len(a)), 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(v) for v in a.reshape(len(a), -1).min(0)]
            acc['max'] = [float(v) for v in a.reshape(len(a), -1).max(0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def write_body(p, J, Wt, out_path, extras):
    src = p.src.gltf
    pk = Packer()
    nodes, index = [], {}
    for n in p.names:
        index[n] = len(nodes)
        par = p.parent[n]
        L = p.W[n] if par is None else p.W[par].T @ p.W[n]
        T = p.P[n] if par is None else p.W[par].T @ (p.P[n] - p.P[par])
        node = {'name': n}
        if np.abs(T).max() > 0:
            node['translation'] = [float(v) for v in T]
        q = ue5.m_to_q(L)
        if np.abs(q[:3]).max() > 1e-9:
            node['rotation'] = [float(v) for v in q]
        nodes.append(node)
    for n in p.names:
        kids = [index[c] for c in p.children(n)]
        if kids:
            nodes[index[n]]['children'] = kids
    prim_src = p.src.prim
    attrs = {}
    attrs['POSITION'] = pk.accessor(p.pos, 5126, 'VEC3', 34962, minmax=True)
    if p.nrm is not None:
        attrs['NORMAL'] = pk.accessor(p.nrm, 5126, 'VEC3', 34962)
    for key in prim_src['attributes']:
        if key.startswith('TEXCOORD') or key.startswith('COLOR'):
            acc = src['accessors'][prim_src['attributes'][key]]
            data = ue5.accessor(src, p.src.binary, prim_src['attributes'][key])
            attrs[key] = pk.accessor(data, 5126, acc['type'], 34962)
    if len(p.names) > 255:
        raise ValueError('too many joints for unsigned byte indices')
    attrs['JOINTS_0'] = pk.accessor(J, 5121, 'VEC4', 34962)
    attrs['WEIGHTS_0'] = pk.accessor(Wt, 5126, 'VEC4', 34962)
    nv = len(p.pos)
    idx = pk.accessor(p.tris.ravel(), 5123 if nv < 65536 else 5125, 'SCALAR', 34963)
    ibm = np.stack([np.linalg.inv(U.mat4(p.W[n], p.P[n])) for n in p.names]).transpose(0, 2, 1)
    ibm_acc = pk.accessor(ibm.reshape(len(p.names), 16), 5126, 'MAT4')
    images = []
    for im in src.get('images', []):
        v = src['bufferViews'][im['bufferView']]
        data = p.src.binary[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        e = {k: v_ for k, v_ in im.items() if k != 'bufferView'}
        e['bufferView'] = pk.view(bytes(data))
        images.append(e)
    mesh_node = len(nodes)
    nodes.append({'name': 'body', 'mesh': 0, 'skin': 0})
    prim = {'attributes': attrs, 'indices': idx}
    if 'material' in prim_src:
        prim['material'] = prim_src['material']
    g = {
        'asset': {'version': '2.0', 'generator': 'Tripo + blender/bodies/prepare_body.py (pass T1a)',
                  'extras': dict(copy.deepcopy(src['asset'].get('extras', {})), **extras)},
        'scene': 0,
        'scenes': [{'name': 'Scene', 'nodes': [index['root'], mesh_node]}],
        'nodes': nodes,
        'meshes': [{'name': 'body', 'primitives': [prim]}],
        'skins': [{'name': 'Armature', 'joints': [index[n] for n in p.names], 'skeleton': index['root'],
                   'inverseBindMatrices': ibm_acc}],
        'accessors': pk.accessors, 'bufferViews': pk.views,
        'buffers': [{'byteLength': (len(pk.blob) + 3) // 4 * 4}],
    }
    for key in ('materials', 'textures', 'samplers'):
        if key in src:
            g[key] = copy.deepcopy(src[key])
    if images:
        g['images'] = images
    gltfio.write(out_path, g, bytes(pk.blob))
    return g


def write_clips(p, out_path):
    """The source's skeleton (as delivered, source units) and all its animations; no mesh."""
    src, b = p.src.gltf, p.src.binary
    g = copy.deepcopy(src)
    for key in ('meshes', 'materials', 'textures', 'images', 'samplers'):
        g.pop(key, None)
    for n in g['nodes']:
        n.pop('mesh', None)
        n.pop('skin', None)
    keep = {g['skins'][0]['inverseBindMatrices']}
    for a in g['animations']:
        for s in a['samplers']:
            keep |= {s['input'], s['output']}
    remap, blob = gltfio.repack(g, b, keep)
    g['skins'][0]['inverseBindMatrices'] = remap[g['skins'][0]['inverseBindMatrices']]
    for a in g['animations']:
        for s in a['samplers']:
            s['input'], s['output'] = remap[s['input']], remap[s['output']]
    # the mesh node stays as an empty (harmless); note the units
    g['asset']['extras'] = dict(g['asset'].get('extras', {}), note='Tripo source clips, source units (body 0.945 tall); bones as delivered')
    gltfio.write(out_path, g, blob)
    return [(a['name'], len(a['channels'])) for a in g['animations']]

# ----------------------------------------------------------------------------- metrics


def r(v, k=4):
    return [round(float(x), k) for x in np.asarray(v).ravel()]


def eyes_from_texture(p, Vc, tmpdir):
    """The painted eyes: dark iris pixels on the front of the head, sampled through the UVs onto
    the mesh surface (canonical pose). Needs bpy (texture decoding). Returns dict or None."""
    try:
        import bpy
    except ImportError:
        return None
    src = p.src.gltf
    mat = src['materials'][p.src.prim['material']]
    tex = src['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
    im = src['images'][tex['source']]
    v = src['bufferViews'][im['bufferView']]
    data = p.src.binary[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
    path = pathlib.Path(tmpdir) / ('basecolor' + ('.jpg' if 'jpeg' in im['mimeType'] else '.png'))
    path.write_bytes(bytes(data))
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    uv = ue5.accessor(src, p.src.binary, p.src.prim['attributes']['TEXCOORD_0'])
    head_w = p.bone_weight(['head'])
    hy = p.P['head'][1]
    # dense samples on head-skinned, front-facing triangles
    tri = p.tris
    keep = (head_w[tri].min(1) > 0.9)
    V = Vc[tri[keep]]
    n = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    front = n[:, 2] > 0.3
    T = tri[keep][front]
    V = V[front]
    UV = uv[T]
    bary = np.array([(a, b_, 1 - a - b_) for a in np.linspace(0, 1, 7) for b_ in np.linspace(0, 1, 7) if a + b_ <= 1])
    pts = np.einsum('sk,tkd->tsd', bary, V).reshape(-1, 3)
    uvs = np.einsum('sk,tkd->tsd', bary, UV).reshape(-1, 2)
    xs = np.clip((uvs[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)
    ys = np.clip((1 - uvs[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)   # glTF uv origin top-left; bpy pixels bottom-up
    col = px[ys, xs]   # bpy rows run bottom-up: row = (1 - v) * (h - 1)
    lum = col @ np.array([0.2126, 0.7152, 0.0722])
    sat = col.max(1) - col.min(1)
    # the face, 0..16 cm above the head joint, within 6 cm of the midline, facing forward. The eye
    # whites are the only bright, unsaturated texels there (skin is saturated, hair and brows dark);
    # the iris is the dark patch inside them
    face = (pts[:, 1] > hy) & (pts[:, 1] < hy + 0.16) & (np.abs(pts[:, 0] - p.P['head'][0]) < 0.06)
    nrm_s = np.repeat(n[front], len(bary), 0)
    face &= nrm_s[:, 2] > 0.5
    white = face & (sat < 0.10) & (lum > 0.40)
    out = {}
    for side, sgn in (('l', 1), ('r', -1)):
        m = white & ((pts[:, 0] - p.P['head'][0]) * sgn > 0.008)
        if m.sum() < 5:
            return None
        c = np.median(pts[m], 0)
        near = face & (np.linalg.norm(pts - c, axis=1) < 0.018)
        iris = near & (lum < 0.18)
        eye = (near & white) | iris
        out[side] = dict(centre=pts[eye].mean(0), iris=pts[iris].mean(0) if iris.sum() else None, count=int(eye.sum()),
                         whites=int((near & white).sum()), irisSamples=int(iris.sum()))
    return out


def metrics(p, rig, J, Wt, eyes):
    Wc, Pc = rig.canonical()
    Vc = U.skin(p.pos, J, Wt, rig.mats(Wc, Pc))
    P = Pc
    L = lambda a, b: float(np.linalg.norm(P[a] - P[b]))  # noqa: E731
    m = {'units': 'metres; canonical pose (arms down, palms forward, legs straight, facing +Z, left +X, Y up); '
                  'positions world unless "in the hand / foot frame" (that frame = the old joint frame = world axes at the joint in the canonical pose)'}
    m['scale'] = dict(sourceHeight=round(p.source_height, 5), factor=round(p.s, 6), height=round(float(p.pos[:, 1].max() - p.pos[:, 1].min()), 4),
                      recentredBy=r(-p.s * p.c), canonicalSoleY=round(float(Vc[:, 1].min()), 4))
    seg = {}
    for s, _ in U.SIDES:
        seg[f'clavicle_{s}'] = L(f'clavicle_{s}', f'upperarm_{s}')
        seg[f'upperarm_{s}'] = L(f'upperarm_{s}', f'lowerarm_{s}')
        seg[f'forearm_{s}'] = L(f'lowerarm_{s}', f'hand_{s}')
        seg[f'thigh_{s}'] = L(f'thigh_{s}', f'calf_{s}')
        seg[f'calf_{s}'] = L(f'calf_{s}', f'foot_{s}')
        seg[f'foot_ankle_to_ball_{s}'] = L(f'foot_{s}', f'ball_{s}')
    chain = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'neck_01', 'neck_02', 'head']
    for a, b in zip(chain, chain[1:]):
        seg[f'{a}_to_{b}'] = L(a, b)
    seg['spine_01_to_neck_01'] = L('spine_01', 'neck_01')
    seg['neck_01_to_head'] = L('neck_01', 'head')
    m['segments'] = {k: round(v, 4) for k, v in seg.items()}
    m['widths'] = dict(shoulderJoints=round(L('upperarm_l', 'upperarm_r'), 4), hipJoints=round(L('thigh_l', 'thigh_r'), 4),
                       clavicleRoots=round(L('clavicle_l', 'clavicle_r'), 4))
    m['heights'] = {n: round(float(P[n][1]), 4) for n in ['pelvis', 'spine_01', 'spine_03', 'spine_05', 'neck_01', 'head', 'upperarm_l', 'thigh_l', 'calf_l', 'foot_l']}
    m['heights']['topOfHead'] = round(float(Vc[:, 1].max()), 4)
    m['joints'] = {n: r(P[n]) for n in rig.order if not n.startswith('ik_')}
    # head
    hw = p.bone_weight(['head'], J, Wt) > 0.9
    hv = Vc[hw]
    m['head'] = dict(height_chinOrNeckToTop=round(float(hv[:, 1].max() - hv[:, 1].min()), 4), width=round(float(np.ptp(hv[:, 0])), 4),
                     depth=round(float(np.ptp(hv[:, 2])), 4), front=round(float(hv[:, 2].max()), 4), back=round(float(hv[:, 2].min()), 4),
                     note='mesh skinned >0.9 to head (hair included; the lower bound is where the neck blend starts)')
    if eyes:
        el, er = eyes['l']['centre'], eyes['r']['centre']
        mid = (el + er) / 2
        m['eyes'] = dict(centre=r(mid), left=r(el), right=r(er), separation=round(float(np.linalg.norm(el - er)), 4),
                         centreFromHeadJoint=r(mid - P['head']), samples=[eyes['l']['count'], eyes['r']['count']],
                         irisLeft=r(eyes['l']['iris']) if eyes['l']['iris'] is not None else None, irisRight=r(eyes['r']['iris']) if eyes['r']['iris'] is not None else None,
                         method='base-colour texels sampled through the UVs onto the front of the head (canonical pose): eye whites = bright unsaturated texels, iris = dark texels within 1.8 cm; centre = mean of both; a point ON the skin surface (painted eyes, no eyeballs)')
    # hands
    hands = {}
    for s, sign in U.SIDES:
        wrist = P[f'hand_{s}']
        R = Wc  # world rotations in the canonical pose
        knuckle = P[f'middle_01_{s}']
        axis = knuckle - wrist
        Lk = np.linalg.norm(axis)
        yh = axis / Lk
        palm_n = U.frame(yh, (0, 0, 1))[:, 2]
        # canonical palm normal: the derived target frame z (the reference body's palm)
        palm_n = rig_palm[s] if (rig_palm := getattr(rig, 'palm', None)) else palm_n
        names = [f'hand_{s}'] + [f'{f}_metacarpal_{s}' for f in U.FINGERS]
        hwgt = p.bone_weight(names, J, Wt)
        t = ((Vc - wrist) @ axis) / (Lk * Lk)
        radial = Vc - wrist - np.outer(t * Lk, yh)
        palmside = radial @ palm_n
        sel = (hwgt > 0.5) & (t > 0.2) & (t < 0.95)
        band = sel & (np.abs(t - 0.8) < 0.08)
        surf = palmside[band].max()
        palm_old_style = wrist + 0.8 * axis + palm_n * surf
        sel2 = sel & (palmside > 0.5 * palmside[sel].max())
        centroid = Vc[sel2].mean(0)
        tips, fingers = {}, {}
        for f in list(U.FINGERS) + ['thumb']:
            j = [P[f'{f}_0{k}_{s}'] for k in (1, 2, 3)]
            d = j[2] - j[1]
            d /= np.linalg.norm(d)
            w3 = p.bone_weight([f'{f}_03_{s}'], J, Wt) > 0.5
            tip_i = np.argmax((Vc[w3] - j[2]) @ d)
            tip = Vc[w3][tip_i]
            fingers[f] = dict(segments=[round(float(np.linalg.norm(j[1] - j[0])), 4), round(float(np.linalg.norm(j[2] - j[1])), 4),
                                        round(float((tip - j[2]) @ d), 4)],
                              knuckle_inHand=r(j[0] - wrist), tip_inHand=r(tip - wrist))
            tips[f] = tip
        across = np.cross(yh, palm_n)
        kn = (hwgt + p.bone_weight([f'{f}_01_{s}' for f in U.FINGERS], J, Wt) > 0.5) & (np.abs(t - 1.0) < 0.1)
        width = float(np.ptp((Vc[kn] - wrist) @ across))
        hands[s] = dict(
            palmNormal=r(palm_n), handAxis_wristToMiddleKnuckle=r(yh), wristToMiddleKnuckle=round(float(Lk), 4),
            palmCentre_inHand_oldStyle=r(palm_old_style - wrist),
            palmCentre_inHand_surfaceCentroid=r(centroid - wrist),
            length_wristToMiddleTip=round(float((tips['middle'] - wrist) @ yh), 4),
            width_acrossKnuckles=round(width, 4),
            gripSpan_thumbTipToIndexTip=round(float(np.linalg.norm(tips['thumb'] - tips['index'])), 4),
            gripSpan_palmCentreToMiddleTip=round(float(np.linalg.norm(tips['middle'] - palm_old_style)), 4),
            fingers=fingers)
    m['hands'] = hands
    m['hands']['oldPALM_LOCAL'] = [0, -0.075, 0.028]
    # feet
    feet = {}
    for s, _ in U.SIDES:
        ankle = P[f'foot_{s}']
        # the foot by geometry (the heel is mostly skinned to calf_twist_01): skin below 60 % of the
        # ankle height, within 7 cm of the ankle sideways
        fw = (Vc[:, 1] < ankle[1] * 0.6 + Vc[:, 1].min() * 0.4) & (np.abs(Vc[:, 0] - ankle[0]) < 0.07)
        fv = Vc[fw]
        sole = fv[:, 1].min()
        heel = fv[np.argmin(fv[:, 2])]
        toe = fv[np.argmax(fv[:, 2])]
        ball = P[f'ball_{s}']
        feet[s] = dict(ankleHeightAboveSole=round(float(ankle[1] - sole), 4), soleY=round(float(sole), 4),
                       heel_inFoot=r(heel - ankle), ball_inFoot=r(ball - ankle), ballSole_inFoot=r([ball[0] - ankle[0], sole - ankle[1], ball[2] - ankle[2]]),
                       toeTip_inFoot=r(toe - ankle), length_heelToToe=round(float(toe[2] - heel[2]), 4),
                       width=round(float(np.ptp(fv[:, 0])), 4))
    m['feet'] = feet
    # torso: front surface height field and girth profile (trunk + thigh skin; arms excluded)
    arm = p.bone_weight([n for n in p.names if any(k in n for k in ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'))], J, Wt)
    body = arm < 0.2
    tri = p.tris[body[p.tris].all(1)]
    bary = np.array([(a, b_, 1 - a - b_) for a in np.linspace(0, 1, 5) for b_ in np.linspace(0, 1, 5) if a + b_ <= 1])
    S = np.einsum('sk,tkd->tsd', bary, Vc[tri]).reshape(-1, 3)
    xs = np.round(np.arange(-0.22, 0.2201, 0.02), 3)
    ys = np.round(np.arange(0.60, 1.5201, 0.02), 3)
    front = np.full((len(ys), len(xs)), np.nan)
    ix = np.round((S[:, 0] + 0.22) / 0.02).astype(int)
    iy = np.round((S[:, 1] - 0.60) / 0.02).astype(int)
    ok = (ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
    for a, b_, z in zip(ix[ok], iy[ok], S[ok, 2]):
        if not (front[b_, a] >= z):
            front[b_, a] = z
    m['frontSurface'] = dict(note='max z of the body skin (arms excluded) per 2 cm cell, canonical pose; null = no skin',
                             x=xs.tolist(), y=ys.tolist(), z=[[None if np.isnan(v) else round(float(v), 4) for v in row] for row in front])
    prof = []
    for y in np.arange(0.70, 1.50, 0.02):
        sl = S[np.abs(S[:, 1] - y) < 0.006]
        if len(sl) < 20:
            continue
        # torso only (between the thighs' outer edges above the crotch): the slice's middle piece
        xy = sl[:, [0, 2]]
        per = _hull_perimeter(xy)
        prof.append(dict(y=round(float(y), 3), front=round(float(sl[:, 2].max()), 4), back=round(float(sl[:, 2].min()), 4),
                         depth=round(float(np.ptp(sl[:, 2])), 4), width=round(float(np.ptp(sl[:, 0])), 4), hullGirth=round(per, 4)))
    m['torsoProfile'] = dict(note='slices of body skin (arms excluded); hullGirth = convex hull perimeter (over-estimates a waist between two thighs: below the crotch it wraps both legs)',
                             rows=prof)
    ch = [row for row in prof if abs(row['y'] - P['spine_05'][1]) < 0.011]
    m['chestDepthAtSpine05'] = ch[0]['depth'] if ch else None
    return m, Vc


def _hull_perimeter(pts):
    pts = np.unique(np.round(pts, 5), axis=0)
    if len(pts) < 3:
        return 0.0
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for q in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(tuple(q))
    for q in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(tuple(q))
    h = np.array(lower[:-1] + upper[:-1])
    return float(np.linalg.norm(h - np.roll(h, -1, 0), axis=1).sum())

# ----------------------------------------------------------------------------- main


def build(src, reference, height=1.75, fix=True, shoulder=True, joints=True, joint_width=None):
    p = Prepared(src, height)
    ref = U.Body(reference)
    Gref = U.reference_anatomy(ref)
    raw_J, raw_W = p.J.copy(), p.Wt.copy()
    fixes = []
    J, Wt = raw_J, raw_W
    if fix:
        rel, which = needs_relabel(p, J, Wt)
        if rel:
            J, moves = relabel(p, J)
            fixes.append(dict(fix='relabel upper-arm and thigh twist weights', why='delivered order is bone (shoulder/hip end) -> twist_01 -> twist_02 (elbow/knee end), reverse of UE5/R1', moves=moves))
        mask, found = strays(p, J, Wt)
        if mask.any():
            J, Wt = renormalise(J, Wt, mask)
            fixes.append(dict(fix='removed limb weights past the far joint (t > 1.3 along the limb) and renormalised', found=found))
    if shoulder:
        J, Wt, moved = shoulder_repair(p, J, Wt)
        fixes.append(dict(fix='shoulder repair: upper-arm weight on torso skin inboard of the shoulder joint handed to the clavicle (smoothstep 10 cm .. 1 cm inboard)', moved=moved))
    shares = fit_shares(p, J, Wt)     # (fitted before the joint repair: the shares, frames and clips stay as T1a's)
    if joints:
        J, Wt, moved = joint_repair(p, J, Wt, width=joint_width)
        fixes.append(dict(fix='joint repair (pass F1): elbow / knee upper-vs-lower chain split set by position along the limb (smoothstep +-5 cm round the joint), ragged weights on the inner elbow removed', moved=moved))
    U.TWIST_SHARE.update(shares)       # derive() uses the shares for the forearm / shin pre-turn
    d = U.derive(p.as_body(), Gref)
    R = dict(d['R'])
    for n in U.IK:
        R[n] = R[U.IK_TARGET[n]] if U.IK_TARGET[n] else np.eye(3)
    rig = U.Rig(p.names, p.parent, p.W, p.P, R, shares)
    rig.palm = {s: Gref[f'hand_{s}'][:, 2] for s, _ in U.SIDES}
    return dict(p=p, ref=ref, Gref=Gref, d=d, R=R, rig=rig, J=J, Wt=Wt, raw_J=raw_J, raw_W=raw_W, fixes=fixes, shares=shares)


def frames_json(B, mapping_doc):
    p, d, R, rig = B['p'], B['d'], B['R'], B['rig']
    Wc, Pc = rig.canonical()
    out = dict(
        skeleton='earthonline-ue5-v1 (bone names); this body\'s own bind pose and bone axes',
        body=B['name'], source=str(B['src_rel']),
        frames=('Bones run along local +Y (as delivered). Bone axes are the delivered ones, NOT R1\'s. '
                'The canonical relation is boneWorld = canonicalWorld[old joint] * R[b], with R[b] = A[b] * bindWorld[b]. '
                'Equivalently boneWorld = R1boneWorld * O[b] with O[b] = R1restWorld[b]^-1 * R[b] '
                '(so a pose made for R1\'s skeleton converts as local[b] = O[parent]^-1 * R1local[b] * O[b]).'),
        conventions=dict(space='glTF: Y up, facing +Z, left +X, metres', quaternions='x, y, z, w',
                         canonicalPose='old skeleton rest: arms straight down, palms forward, fingers as the old body, legs straight, feet forward'),
        derivation={n: d['notes'][n] for n in d['notes']},
        twistPreTurnDeg={k: round(math.degrees(v), 2) for k, v in d['pre'].items()},
        twistBones={}, bones={}, old={},
    )
    C1 = {n: ue5.q_to_m(e['restWorldRotation']) for n, e in mapping_doc['bones'].items()}
    for n in p.names:
        par = p.parent[n]
        L0 = p.W[n] if par is None else p.W[par].T @ p.W[n]
        T0 = p.P[n] if par is None else p.W[par].T @ (p.P[n] - p.P[par])
        A = d['A'].get(n, np.eye(3)) if not n.startswith('ik_') else (R[n] @ p.W[n].T)
        e = dict(parent=par, head=r(p.P[n], 5), canonicalHead=r(Pc[n], 5),
                 restLocalRotation=r(ue5.m_to_q(L0), 7), restLocalTranslation=r(T0, 6),
                 bindWorldRotation=r(ue5.m_to_q(p.W[n]), 7), A=r(ue5.m_to_q(A), 7), A_deg=round(U.deg(A), 2),
                 R=r(ue5.m_to_q(R[n]), 7), canonicalLocalRotation=r(ue5.m_to_q(rig.Lc[n]), 7))
        if n in C1:
            e['O_fromR1'] = r(ue5.m_to_q(C1[n].T @ R[n]), 7)
        old = U.BONE_TO_OLD.get(n)
        if old:
            e['rule'], e['from'] = 'copy', old
            out['old'][old] = {'rotation': n}
        elif 'twist' in n:
            key = n[:-2]
            kind, measure = U.TWIST_SOURCE[key.rsplit('_', 1)[0]]
            e.update(rule='twist', share=rig.shares[key], measure=measure, source=f'{kind}_{n[-1]}',
                     how='local = canonicalLocal * twistY(share * a); a = twist about Y of ' +
                         ('source.local * source.canonicalLocal^-1' if measure == 'child' else 'source.canonicalLocal^-1 * source.local'))
        elif n.startswith('ik_'):
            e.update(rule='ik', target=U.IK_TARGET[n])
        else:
            e['rule'] = 'follow'
        out['bones'][n] = e
    for key, share in rig.shares.items():
        kind, measure = U.TWIST_SOURCE[key.rsplit('_', 1)[0]]
        out['twistBones'][key + '_{s}'] = dict(parent=key.rsplit('_twist', 1)[0] + '_{s}', share=share, measure=measure,
                                               source=kind + '_{s}', r1Share=mapping_doc['twistBones'][key + '_{s}']['share'])
    out['translation'] = {'Hips': 'pelvis: canonicalHead + (clipHips - oldRestHips) * (this pelvis height / 0.92) is the simple rule; the pipeline re-solves legs'}
    out['referencePoses'] = dict(
        bind_tpose=dict(note='the bind (T-pose) as local rotations', local={n: r(ue5.m_to_q(p.W[n] if p.parent[n] is None else p.W[p.parent[n]].T @ p.W[n]), 7) for n in p.names}),
        canonical=dict(note='the canonical reference pose (arms down, palms forward): local = R[parent]^T R[b]; translations = bind locals',
                       local={n: r(ue5.m_to_q(rig.Lc[n]), 7) for n in p.names}))
    out['canonicalAnatomy'] = dict(note='target anatomical frames (columns X, Y, Z as quaternion) measured on the reference body; A[b] = C[b] * G[b]^T',
                                   reference=str(B['ref_rel']), frames={n: r(ue5.m_to_q(m), 7) for n, m in B['Gref'].items()})
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--name', required=True)
    ap.add_argument('--prefix')
    ap.add_argument('--height', type=float, default=1.75)
    ap.add_argument('--reference', default=str(ROOT / 'public/characters/civilian-m-01-player-ue5.glb'))
    ap.add_argument('--no-fix', action='store_true')
    ap.add_argument('--clips', action='store_true')
    ap.add_argument('--no-shoulder-repair', action='store_true')
    ap.add_argument('--no-joint-repair', action='store_true')
    ap.add_argument('--tmp', default=tempfile.gettempdir())
    a = ap.parse_args(argv)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    prefix = a.prefix or a.name.split('-')[0]
    B = build(a.src, a.reference, a.height, fix=not a.no_fix, shoulder=not a.no_shoulder_repair and not a.no_fix,
              joints=not a.no_joint_repair and not a.no_fix)
    B['name'], B['src_rel'], B['ref_rel'] = a.name, a.src, a.reference
    p, rig = B['p'], B['rig']
    log(f'scale {p.s:.5f} from {p.source_height:.5f}; fixes: {[f["fix"] for f in B["fixes"]]}; shares {B["shares"]}')
    mapping_doc = json.loads(U.MAPPING.read_text())
    # metrics (eyes need bpy)
    Wc, Pc = rig.canonical()
    Vc = U.skin(p.pos, B['J'], B['Wt'], rig.mats(Wc, Pc))
    eyes = eyes_from_texture(p, Vc, a.tmp)
    M, _ = metrics(p, rig, B['J'], B['Wt'], eyes)
    (out / f'{prefix}_metrics.json').write_text(json.dumps(M, indent=1))
    F = frames_json(B, mapping_doc)
    (out / f'{prefix}_frames.json').write_text(json.dumps(F, indent=1))
    au = dict(before=audit(p, B['raw_J'], B['raw_W']), after=audit(p, B['J'], B['Wt']), fixes=B['fixes'], shares=B['shares'],
              strayCheckBefore=strays(p, B['raw_J'], B['raw_W'])[1])
    (out / f'{prefix}_weights_audit.json').write_text(json.dumps(au, indent=1))
    extras = dict(contract='earthonline-ue5-v1', bindPose='as delivered (T-pose); see ' + f'{prefix}_frames.json for R[b]',
                  bones=len(p.names), scaledBy=round(p.s, 6), body=a.name)
    if eyes:
        extras['eyes'] = M['eyes']
    write_body(p, B['J'], B['Wt'], out / f'{a.name}.glb', extras)
    # read back: node chain = bind, rest skinning = mesh
    nb = U.Body(out / f'{a.name}.glb')
    Wb, Pb = rig.bind()
    err_rest = max(np.abs(nb.W[n] - Wb[n]).max() for n in p.names)
    err_pos = max(np.abs(nb.P[n] - Pb[n]).max() for n in p.names)
    mats = np.stack([U.mat4(nb.node_world[n][:3, :3], nb.node_world[n][:3, 3]) @ nb.ibm[k] for k, n in enumerate(nb.names)])
    skin_err = np.abs(U.skin(nb.pos, nb.J, nb.Wt, mats) - p.pos).max()
    log(f'readback: rest rot {err_rest:.2e}, pos {err_pos:.2e}, node chain vs bind {nb.rest_vs_bind:.2e}, rest skinning {skin_err * 1000:.4f} mm, '
        f'weights sum {nb.Wt.sum(1).min():.6f}..{nb.Wt.sum(1).max():.6f}, size {(out / (a.name + ".glb")).stat().st_size / 1e6:.2f} MB')
    if a.clips:
        clips = write_clips(p, out / f'{prefix}_source_clips.glb')
        log('clips', clips)
    return B, M, eyes


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
