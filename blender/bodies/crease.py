"""Crease measure for the upper back / shoulders (pass T1a follow-up): dihedral angles between
adjacent faces against the modelled (source) mesh, and the vertices of the worst fold."""
import numpy as np


class Dihedral:
    def __init__(self, mesh, ref_pos, region):
        """mesh: ue5_rig.proof.Mesh (welded); ref_pos: modelled vertex positions (unwelded order);
        region: bool per (unwelded) vertex."""
        self.mesh = mesh
        t = mesh.wtris
        e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
        f = np.tile(np.arange(len(t)), 3)
        e.sort(1)
        key = e[:, 0].astype(np.int64) * 10_000_000 + e[:, 1]
        o = np.argsort(key)
        key, f, e = key[o], f[o], e[o]
        pair = np.nonzero(key[1:] == key[:-1])[0]
        self.f1, self.f2, self.e = f[pair], f[pair + 1], e[pair]
        reg = region[mesh.first]
        keep = reg[self.e[:, 0]] & reg[self.e[:, 1]]
        self.f1, self.f2, self.e = self.f1[keep], self.f2[keep], self.e[keep]
        self.ref = self.angles(ref_pos)

    def angles(self, pos):
        w = pos[self.mesh.first]
        t = self.mesh.wtris
        n = np.cross(w[t[:, 1]] - w[t[:, 0]], w[t[:, 2]] - w[t[:, 0]])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-15
        c = np.clip((n[self.f1] * n[self.f2]).sum(1), -1, 1)
        return np.degrees(np.arccos(c))

    def measure(self, pos):
        d = self.angles(pos) - self.ref
        return dict(max=round(float(d.max()), 1), p999=round(float(np.percentile(d, 99.9)), 1),
                    over45=int((d > 45).sum()), over90=int((d > 90).sum())), d


def upper_back(pos, P, side=None):
    """Upper back / shoulder-blade skin in the modelled pose: behind the shoulder joints' plane,
    between the armpit line and the top of the shoulders, inboard of 1.3 x the shoulder joint."""
    sh = (P['upperarm_l'] + P['upperarm_r']) / 2
    xw = abs(P['upperarm_l'][0]) * 1.3
    m = (pos[:, 2] < sh[2] - 0.0) & (pos[:, 1] > sh[1] - 0.25) & (pos[:, 1] < sh[1] + 0.08) & (np.abs(pos[:, 0]) < xw)
    if side == 'l':
        m &= pos[:, 0] > 0
    elif side == 'r':
        m &= pos[:, 0] < 0
    return m


def upper_front(pos, P):
    sh = (P['upperarm_l'] + P['upperarm_r']) / 2
    xw = abs(P['upperarm_l'][0]) * 1.3
    return (pos[:, 2] >= sh[2]) & (pos[:, 1] > sh[1] - 0.25) & (pos[:, 1] < sh[1] + 0.08) & (np.abs(pos[:, 0]) < xw)
