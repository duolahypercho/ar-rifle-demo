"""The exported skeletons and their poses in glTF terms (plain numpy, no bpy).

A skeleton = the body GLB's joints (skin order, parents, node rest TRS) + the extra leaf bones
`Gun` and `GunIn` under `spine_05`. The clip packs author Gun / GunIn in spine_05's CANONICAL
frame (the frame of the old Spine2 joint: canonical world = bone world * R[spine_05]^-1). On the
EarthOnline bodies R[spine_05] is the identity; on Tripo it is the bind's 85-degree turn about Y.
As bones of the real spine_05 the extra bones therefore get local = R[spine_05]^-1 * trackLocal
(rotation only in front), which puts them at exactly the world place the game gives the gun.
"""
import json

import numpy as np

import config
import gltfio as G


def _R(body, frames_path):
    """canonical -> bone world rotation per joint (quaternion), from the frames file or the rest."""
    if frames_path:
        f = json.load(open(frames_path))
        return {b: np.array(v['R'], float) for b, v in f['bones'].items()}
    w = body.rest_world()
    return {b: G.m_to_q(w[b][:3, :3]) for b in body.joints}


class Skeleton:
    def __init__(self, key, body_name=None):
        self.key = key
        cfg = config.PACKS[key]
        self.body_name = body_name or cfg['body']
        self.body = G.Body(config.body_glb(self.body_name))
        self.pack = G.ClipPack(cfg['pack'])
        self.notes = json.load(open(cfg['notes']))
        self.R = _R(G.Body(config.body_glb(cfg['body'])) if body_name else self.body, cfg['frames'])
        b = self.body
        self.bones = list(b.order) + list(config.EXTRA_BONES)
        self.parent = dict(b.parent)
        for e in config.EXTRA_BONES:
            self.parent[e] = config.EXTRA_PARENT
        rinv = np.eye(4)
        rinv[:3, :3] = G.q_to_m(self.R[config.EXTRA_PARENT]).T
        self.extra_fix = rinv   # bone local = extra_fix @ track local
        self.rest_local = {n: G.trs_to_m(*b.rest[n]) for n in b.order}
        for e, (clip, f) in config.EXTRA_BONES.items():
            s, _ = self.pack.sample(clip)
            self.rest_local[e] = rinv @ G.trs_to_m(s[e]['translation'][f], s[e]['rotation'][f])
        self.deform = self._deform()

    def _deform(self):
        _, j, w, _ = self.body.mesh()
        used = set()
        for k in range(j.shape[1]):
            used |= set(j[w[:, k] > 0, k].tolist())
        return {self.body.joints[i] for i in used}

    def world(self, local):
        w = {}
        for n in self.bones:
            p = self.parent[n]
            w[n] = local[n] if p is None else w[p] @ local[n]
        return w

    def rest_world(self):
        return self.world(self.rest_local)

    def clip_locals(self, clip):
        """[frame] -> {bone: 4x4 local, glTF metres}, every key of the clip (frames 0..n-1)."""
        s, nf = self.pack.sample(clip)
        out = []
        for f in range(nf):
            loc = {}
            for n in self.bones:
                ch = s.get(n, {})
                if n in config.EXTRA_BONES:
                    if 'rotation' in ch or 'translation' in ch:
                        rest = self.rest_local[n]
                        t = ch['translation'][f] if 'translation' in ch else None
                        r = ch['rotation'][f] if 'rotation' in ch else None
                        m = G.trs_to_m(t if t is not None else [0, 0, 0], r if r is not None else [0, 0, 0, 1])
                        loc[n] = self.extra_fix @ m
                    else:
                        loc[n] = self.rest_local[n]
                    continue
                t, r, sc = self.body.rest[n]
                if 'translation' in ch:
                    t = ch['translation'][f]
                if 'rotation' in ch:
                    r = ch['rotation'][f]
                if 'scale' in ch:
                    sc = ch['scale'][f]
                loc[n] = G.trs_to_m(t, r, sc)
            out.append(loc)
        return out

    def apose_locals(self):
        """The UE5-like A-pose (blender/ue5_rig/ue5_mapping.json retargetPoses.ue5_apose) on this skeleton.
        EarthOnline: those local rotations as they are. Tripo: the same CANONICAL turns carried onto
        Tripo's bone frames (local = R[p]^-1 * Lc * R[b]); bones the pose leaves alone are at Tripo's
        canonical (arms-down) pose, not at its T-pose bind."""
        ap = json.load(open(config.APOSE))['retargetPoses']['ue5_apose']['local']
        eo = G.Body(config.body_glb(config.PACKS['earthonline']['body']))
        we = eo.rest_world()
        RE = {b: we[b][:3, :3] for b in eo.joints}
        RT = {b: G.q_to_m(q) for b, q in self.R.items()}
        out = {}
        for n in self.bones:
            if n in config.EXTRA_BONES:
                out[n] = self.rest_local[n]
                continue
            t = self.body.rest[n][0]
            p = self.parent[n]
            Rp_e = RE[p] if p else np.eye(3)
            Rp_t = RT[p] if p else np.eye(3)
            if n in ap:
                lc = Rp_e @ G.q_to_m(ap[n]) @ RE[n].T
            else:
                lc = np.eye(3)
            if self.key == 'earthonline':
                rot = G.q_to_m(ap[n]) if n in ap else G.q_to_m(self.body.rest[n][1])
            else:
                rot = Rp_t.T @ lc @ RT[n]
            m = np.eye(4)
            m[:3, :3] = rot
            m[:3, 3] = t
            out[n] = m
        return out
