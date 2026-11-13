"""Pass R2 proof: the UE5 clip pack against the old one, every clip, every key and between keys.

  python3 blender/ue5_rig/pack_equivalence.py            (plain Python with numpy; about a minute)

Poses the OLD body with the OLD pack (rifle-motion-v1, the game's way: the notes' root track moves
the model) and the NEW body with the NEW pack (rifle-motion-ue5-v1, root travel on the root bone),
both sampled at 60 fps (every key and the half-way point between keys; quaternions slerped as
three.js does), and compares:
  A  joint world positions of every bone that took over an old joint (the eyes moved on purpose:
     left out), world orientations of hands, feet, head and pelvis through the constant frames R[b];
     the Gun track and the extra nodes (raw values); skinned vertices off the twist bones (< 1 %
     twist weight) and on them; the new body with its twist bones at rest (should be the old one)
  C  twist continuity: per clip, the largest key-to-key change of each twist bone's angle
  D  the wrist: skin radius kept at the right wrist (R1's forearm_pinch), old vs new
  +  the pack's twist keys against R1's map_pose rule (ue5.map_pose, twist on)
Writes blender/review/ue5/equivalence.txt.
"""
import json
import math
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent))
from ue5_rig import proof, ue5  # noqa: E402
from rifle_motion import gltfio  # noqa: E402,F401

OLD_BODY = ROOT / 'public/characters/civilian-m-01-player.glb'
NEW_BODY = ROOT / 'public/characters/civilian-m-01-player-ue5.glb'
OLD_PACK = ROOT / 'public/characters/rifle-motion-v1'
import os  # noqa: E402
NEW_PACK = pathlib.Path(os.environ.get('NEW_PACK', ROOT / 'public/characters/rifle-motion-ue5-v1'))
OUT = pathlib.Path(os.environ.get('EQ_OUT', ROOT / 'blender/review/ue5/equivalence.txt'))
EXTRAS = ('Gun', 'GunIn', 'PalmL', 'PalmR', 'ElbowL', 'ElbowR')
ORIENT = ('hand_l', 'hand_r', 'foot_l', 'foot_r', 'head', 'pelvis')
WRIST_CLIPS = ('rifle-idle', 'rifle-hold-low', 'rifle-walk-f', 'rifle-aim-level', 'rifle-aim-up', 'reload-rifle-tac',
               'reload-rifle-empty', 'swap-rifle-shotgun', 'swap-shotgun-rifle')


def slerp(a, b, u):
    if np.dot(a, b) < 0:
        b = -b
    d = min(1.0, float(np.dot(a, b)))
    if d > 0.9995:
        q = a + u * (b - a)
        return q / np.linalg.norm(q)
    th = math.acos(d)
    return (math.sin((1 - u) * th) * a + math.sin(u * th) * b) / math.sin(th)


def tracks(path):
    g, b = gltfio.read(path)
    names = [n.get('name') for n in g['nodes']]
    out = {}
    for anim in g['animations']:
        ch = {}
        for c in anim['channels']:
            s = anim['samplers'][c['sampler']]
            ch[names[c['target']['node']], c['target']['path']] = (ue5.accessor(g, b, s['input'])[:, 0].astype(float),
                                                                     ue5.accessor(g, b, s['output']).astype(float))
        out[anim['name']] = ch
    return out


def sample(ch, t):
    """{(node, path): value} at time t (s): slerp / lerp between the two keys."""
    out = {}
    for key, (times, vals) in ch.items():
        k = int(np.clip(np.searchsorted(times, t, 'right') - 1, 0, max(0, len(times) - 2)))
        u = 0.0 if len(times) == 1 else float(np.clip((t - times[k]) / (times[k + 1] - times[k]), 0, 1))
        a, c = vals[k], vals[min(k + 1, len(vals) - 1)]
        out[key] = slerp(a, c, u) if key[1] == 'rotation' else a + u * (c - a)
    return out


def yaw_m(yaw):
    return ue5.axis_angle((0, 1, 0), yaw)


def main():
    body = ue5.Body(OLD_BODY)
    skel = ue5.build(body)
    nb = ue5.NewBody(NEW_BODY, skel)
    old, new = tracks(OLD_PACK.with_suffix('.glb')), tracks(NEW_PACK.with_suffix('.glb'))
    old_notes = json.loads(OLD_PACK.with_suffix('.json').read_text())
    new_notes = json.loads(NEW_PACK.with_suffix('.json').read_text())
    copy = {n: b['rule'][1] for n, b in skel.bones.items() if b['rule'][0] == 'copy' and n not in ('eye_l', 'eye_r')}
    twist = [n for n in skel.order if skel.bones[n]['rule'][0] == 'twist']
    tw_index = np.array([skel.bones[n]['rule'][0] == 'twist' for n in skel.order])
    tw_w = np.where(tw_index[nb.J], nb.W, 0).sum(1)
    tmask = tw_w >= 0.01
    none = tw_w == 0
    p0 = body.prims[0]
    lines, worst = [], dict(pos=(0, ''), rot=(0, ''), extra=(0, ''), rest=(0, ''), none=(0, ''), tw=(0, ''), zero=(0, ''), step=(0, ''), rule=(0, ''))
    lines.append('clip: joints mm | orient deg | extras (max abs diff) | skin off-twist max mm | skin with no twist weight max mm | twist-weighted mean / max mm | '
                 'twist bones at rest max mm | twist step deg (bone) | twist vs R1 rule deg')
    notes_diff = []
    for name in new:
        on, nn = old_notes['clips'][name], new_notes['clips'][name]
        for k in set(on) | set(nn):
            if on.get(k) != nn.get(k) and k != 'review':
                notes_diff.append(f'{name}.{k}')
        root = on.get('root')
        o_ch, n_ch = old[name], new[name]
        dur = max(v[0][-1] for v in o_ch.values())
        nd = max(v[0][-1] for v in n_ch.values())
        if abs(dur - nd) > 1e-6 or {len(v[0]) for v in o_ch.values()} != {len(v[0]) for v in n_ch.values()}:
            lines.append(f'{name}: TIMING DIFFERS {dur} {nd}')
        n_keys = len(next(iter(o_ch.values()))[0])
        times = [k / 60 for k in range(int(round(dur * 60)) + 1)]
        r = dict(pos=0.0, rot=0.0, extra=0.0, rest=0.0, none=0.0, twm=[], twx=0.0, zero=0.0, rule=0.0)
        for t in times:
            so, sn = sample(o_ch, t), sample(n_ch, t)
            local = {j: ue5.q_to_m(v) for (j, p), v in so.items() if p == 'rotation' and j in body.joints}
            hips = so[('Hips', 'translation')]
            Wo, Po = ue5.old_world(body, local, hips)
            if root:  # the game moves the model by the root track (linear between frames)
                f = t * 30
                k = min(int(f), len(root) - 2)
                u = f - k
                x, z, yaw = (np.array(root[k]) * (1 - u) + np.array(root[k + 1]) * u)
                M, Tr = yaw_m(yaw), np.array([x, 0, z])
            else:
                M, Tr = np.eye(3), np.zeros(3)
            Wo = {j: M @ w for j, w in Wo.items()}
            Po = {j: M @ p + Tr for j, p in Po.items()}
            L = {b: ue5.q_to_m(sn[b, 'rotation']) for b in skel.order}
            T = {b: sn[b, 'translation'] for b in skel.order if (b, 'translation') in sn}
            Wn, Pn = ue5.fk(skel, L, T)
            for b, j in copy.items():
                r['pos'] = max(r['pos'], np.linalg.norm(Pn[b] - Po[j]) * 1000)
            for b in ORIENT:
                d = Wn[b] @ (Wo[copy[b]] @ skel.bones[b]['R']).T
                r['rot'] = max(r['rot'], math.degrees(math.acos(np.clip((np.trace(d) - 1) / 2, -1, 1))))
            for e in EXTRAS:
                for p in ('translation', 'rotation'):
                    if (e, p) in so or (e, p) in sn:
                        a, c = so[e, p], sn[e, p]
                        if p == 'rotation' and np.dot(a, c) < 0:
                            c = -c
                        r['extra'] = max(r['extra'], float(np.abs(a - c).max()))
            # skin (old skinning in the model's frame: old_skin_mats on the moved joints)
            old_v = ue5.skin(p0['pos'], p0['joints'], p0['weights'], ue5.old_skin_mats(body, Wo, Po))
            new_v = ue5.skin(nb.pos, nb.J, nb.W, ue5.new_skin_mats(skel, Wn, Pn, nb.ibm))
            d = np.linalg.norm(new_v - old_v, axis=1) * 1000
            r['rest'] = max(r['rest'], float(d[~tmask].max()))
            r['none'] = max(r['none'], float(d[none].max()))
            r['twm'].append(float(d[tmask].mean()))
            r['twx'] = max(r['twx'], float(d[tmask].max()))
            Lz = dict(L)
            for b in twist:
                Lz[b] = skel.local_rest(b)[0]
            Wz, Pz = ue5.fk(skel, Lz, T)
            z = np.linalg.norm(ue5.skin(nb.pos, nb.J, nb.W, ue5.new_skin_mats(skel, Wz, Pz, nb.ibm)) - old_v, axis=1) * 1000
            r['zero'] = max(r['zero'], float(z.max()))
            # the twist keys against R1's rule (keys only: the rule is per pose)
            if abs(t * 30 - round(t * 30)) < 1e-6:
                Lm, _ = ue5.map_pose(body, skel, {j: ue5.q_to_m(v) for (j, p), v in so.items() if p == 'rotation' and j in body.joints},
                                     hips, twist=True)
                for b in twist:
                    dd = L[b] @ Lm[b].T
                    r['rule'] = max(r['rule'], math.degrees(math.acos(np.clip((np.trace(dd) - 1) / 2, -1, 1))))
        # twist continuity (keys; a loop's last key is its first frame again, so the seam is in it)
        steps = {}
        for b in twist:
            vals = n_ch[b, 'rotation'][1]
            ang = [ue5.twist_angle(ue5.q_to_m(v)) for v in vals]
            ang = np.unwrap(ang)
            steps[b] = float(np.degrees(np.abs(np.diff(ang)).max())) if len(ang) > 1 else 0.0
        sb = max(steps, key=steps.get)
        line = (f"{name}: {r['pos']:.4f} | {r['rot']:.4f} | {r['extra']:.2e} | {r['rest']:.3f} | "
                f"{r['none']:.4f} | {np.mean(r['twm']):.2f} / {r['twx']:.1f} | {r['zero']:.4f} | {steps[sb]:.2f} ({sb}) | {r['rule']:.4f}")
        lines.append(line)
        print(line, flush=True)
        for key, val in (('pos', r['pos']), ('rot', r['rot']), ('extra', r['extra']), ('rest', r['rest']), ('none', r['none']), ('tw', r['twx']),
                         ('zero', r['zero']), ('step', steps[sb]), ('rule', r['rule'])):
            if val > worst[key][0]:
                worst[key] = (val, name)
    # D: the right wrist
    wrist = []
    for name in [c for c in WRIST_CLIPS if c in new]:
        o_ch, n_ch = old[name], new[name]
        dur = max(v[0][-1] for v in o_ch.values())
        mo, mn = [], []
        for t in [k / 30 for k in range(int(round(dur * 30)) + 1)]:
            so, sn = sample(o_ch, t), sample(n_ch, t)
            local = {j: ue5.q_to_m(v) for (j, p), v in so.items() if p == 'rotation' and j in body.joints}
            Wo, Po = ue5.old_world(body, local, so[('Hips', 'translation')])
            old_v = ue5.skin(p0['pos'], p0['joints'], p0['weights'], ue5.old_skin_mats(body, Wo, Po))
            L = {b: ue5.q_to_m(sn[b, 'rotation']) for b in skel.order}
            T = {b: sn[b, 'translation'] for b in skel.order if (b, 'translation') in sn}
            Wn, Pn = ue5.fk(skel, L, T)
            new_v = ue5.skin(nb.pos, nb.J, nb.W, ue5.new_skin_mats(skel, Wn, Pn, nb.ibm))
            mo.append(proof.forearm_pinch(body, old_v, None, Po, 'Right'))
            mn.append(proof.forearm_pinch(body, new_v, None, Po, 'Right'))
        wrist.append(f'{name}: old min {min(m[0] for m in mo):.2f} mean {np.mean([m[2] for m in mo]):.3f}  ->  '
                     f'new min {min(m[0] for m in mn):.2f} mean {np.mean([m[2] for m in mn]):.3f}')
        print(wrist[-1], flush=True)
    head = ['Pass R2 pack equivalence (blender/ue5_rig/pack_equivalence.py): old body + rifle-motion-v1 (root track moving the model)',
            'against civilian-m-01-player-ue5 + rifle-motion-ue5-v1 (root on the root bone), every clip at 60 fps (every key and',
            'half-way between keys, slerp). Units: mm, deg; extras = largest raw component difference.',
            '',
            'WORST over the pack:']
    head += [f'  {k}: {v[0]:.5g} ({v[1]})' for k, v in worst.items()]
    head += ['  (pos = joint positions, rot = hands/feet/head/pelvis orientations, extra = Gun/GunIn/Palm/Elbow tracks, rest = skin',
             '   under 1 % twist weight, none = skin with no twist weight at all, tw = twist-weighted skin, zero = new body with twist bones at rest vs old,',
             '   step = largest key-to-key twist change, rule = pack twist keys vs R1 map_pose)',
             f'  clip notes differing from the old (other than review): {notes_diff or "none"}', '']
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text('\n'.join(head + lines + ['', 'D: right wrist skin radius kept (1 = kept; R1 forearm_pinch), per clip over its keys'] + wrist) + '\n')
    print('\n'.join(head))


if __name__ == '__main__':
    main()
