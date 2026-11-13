"""Pass T1b check of a clip pack on a body, as the game would play it (plain Python + numpy):

  python3 blender/bodies/pack_check.py BODY.glb PACK.glb OUT.txt [clip ...]

For every clip key: plain glTF forward kinematics of the pack's keys on the body's own nodes (rest
translations from the body, keyed translations and rotations from the pack), linear blend skinning
with the body's inverse bind matrices, then
  wrist   the right wrist's skin radius kept (R1's forearm_pinch measure, against the BIND pose's
          forearm: skin 70..108 % down the forearm, 1..6 cm off its axis, wholly on the forearm /
          its twist bones / the hand and metacarpals): min / 5th percentile / mean over the clip
  twist   per twist bone, the largest key-to-key turn (degrees) of its local rotation
  load    the pack's joint names all exist on the body; the skinned body's lowest point (soles)
Writes OUT.txt.
"""
import json
import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from rifle_motion import gltfio  # noqa: E402


def q2m(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def acc(g, b, i):
    return np.array(gltfio.rows(g, b, i), dtype=np.float64)


def main(body_path, pack_path, out_path, only=()):
    g, b = gltfio.read(body_path)
    nodes = g['nodes']
    skin = g['skins'][0]
    joints = [nodes[j]['name'] for j in skin['joints']]
    by = {n['name']: i for i, n in enumerate(nodes)}
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[nodes[c]['name']] = n['name']
    order, pending = [], list(joints)
    while pending:
        for j in list(pending):
            if parent.get(j) not in joints or parent.get(j) in order:
                order.append(j)
                pending.remove(j)
    rest_q = {j: nodes[by[j]].get('rotation', [0, 0, 0, 1]) for j in joints}
    rest_t = {j: np.array(nodes[by[j]].get('translation', [0, 0, 0]), float) for j in joints}
    ibm = acc(g, b, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    prim = g['meshes'][0]['primitives'][0]
    pos = acc(g, b, prim['attributes']['POSITION'])
    J = acc(g, b, prim['attributes']['JOINTS_0']).astype(int)
    W = acc(g, b, prim['attributes']['WEIGHTS_0'])

    def fk(L, T):
        Wd, Pd = {}, {}
        for j in order:
            l = q2m(L.get(j, rest_q[j]))
            t = T.get(j, rest_t[j])
            p = parent.get(j) if parent.get(j) in joints else None
            Wd[j], Pd[j] = (l, t.copy()) if p is None else (Wd[p] @ l, Pd[p] + Wd[p] @ t)
        return Wd, Pd

    def skinned(Wd, Pd):
        M = np.zeros((len(joints), 4, 4))
        for k, j in enumerate(joints):
            m = np.eye(4)
            m[:3, :3], m[:3, 3] = Wd[j], Pd[j]
            M[k] = m @ ibm[k]
        v = np.column_stack([pos, np.ones(len(pos))])
        Mv = np.einsum('nk,nkij->nij', W, M[J])
        return np.einsum('nij,nj->ni', Mv, v)[:, :3]

    # the right wrist's skin in the bind
    Wb, Pb = fk({}, {})
    a, c = Pb['lowerarm_r'], Pb['hand_r']
    d = c - a
    t = ((pos - a) @ d) / (d @ d)
    radial0 = np.linalg.norm((pos - a) - np.outer(t, d), axis=1)
    arm = [k for k, j in enumerate(joints) if j.endswith('_r') and (j.startswith('lowerarm') or j.startswith('hand') or '_metacarpal_' in j)]
    arm_w = np.where(np.isin(J, arm), W, 0).sum(1)
    sel = (t > 0.7) & (t < 1.08) & (radial0 < 0.06) & (radial0 > 0.01) & (arm_w > 0.9)

    pg, pb = gltfio.read(pack_path)
    names = [n.get('name') for n in pg['nodes']]
    missing = sorted({n for n in names if n not in joints} - {'Gun', 'GunIn', 'PalmL', 'PalmR', 'ElbowL', 'ElbowR'})
    lines = [f'{pathlib.Path(pack_path).name} on {pathlib.Path(body_path).name}: {len(pg["animations"])} clips; pack joints missing on the body: {missing or "none"}; '
             f'wrist skin vertices measured: {int(sel.sum())}',
             'clip: right wrist radius kept min / p5 / mean | lowest skin y min..max (m) | largest key-to-key twist step per bone (deg)']
    twist_names = [j for j in joints if '_twist_' in j]
    for anim in pg['animations']:
        if only and anim['name'] not in only:
            continue
        ch = {}
        for c_ in anim['channels']:
            ch[names[c_['target']['node']], c_['target']['path']] = acc(pg, pb, anim['samplers'][c_['sampler']]['output'])
        n = len(next(iter(ch.values())))
        ratios, lows = [], []
        for i in range(n):
            L = {j: v[i] for (j, p), v in ch.items() if p == 'rotation' and j in rest_q}
            T = {j: v[i] for (j, p), v in ch.items() if p == 'translation' and j in rest_q}
            # (in place: the root's travel taken out, as the game holds the root bone at rest)
            L['root'], T['root'] = [0, 0, 0, 1], np.zeros(3)
            Wd, Pd = fk(L, T)
            v = skinned(Wd, Pd)
            A, B = Pd['lowerarm_r'], Pd['hand_r']
            e = B - A
            q = v[sel] - A
            tt = (q @ e) / (e @ e)
            ratios.append(np.linalg.norm(q - np.outer(tt, e), axis=1) / radial0[sel])
            lows.append(v[:, 1].min())
        r = np.concatenate(ratios)
        steps = {}
        for tb in twist_names:
            vals = ch.get((tb, 'rotation'))
            if vals is None or len(vals) < 2:
                continue
            dots = np.abs(np.sum(vals[1:] * vals[:-1], axis=1)).clip(0, 1)
            steps[tb] = float(np.degrees(2 * np.arccos(dots)).max())
        worst = max(steps, key=steps.get) if steps else None
        lines.append(f'{anim["name"]}: {r.min():.2f} / {np.percentile(r, 5):.2f} / {r.mean():.3f} | {min(lows):.4f}..{max(lows):.4f} | '
                     f'worst {steps.get(worst, 0):.1f} ({worst}); ' + ', '.join(f'{k} {v:.1f}' for k, v in steps.items() if v >= 5))
        print(lines[-1], flush=True)
    pathlib.Path(out_path).write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    with np.errstate(all='ignore'):  # (Accelerate's matmul raises spurious warnings)
        main(sys.argv[1], sys.argv[2], sys.argv[3], tuple(sys.argv[4:]))
