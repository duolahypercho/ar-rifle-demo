"""speeds60.py <pack.glb> clip [clip...] [--json out.json]: (pass A3 round 2) peak speed and velocity change of the hands,
feet, head and pelvis sampled at 60 Hz as the game plays a clip (joint rotations slerped and translations lerped
between the 30 fps keys, FK down the pack's own skeleton; the root bone carries the notes `root` track, so the
positions are in the vehicle root's frame), the same measure as tools/a3_speeds.js.
Limits (the coordinator's gate, entry and exit clips): speed hands / feet 4.5, head 2.0, pelvis 1.8 m/s; change of
velocity between two consecutive 60 Hz samples hands / feet 4.5 m/s. Prints one line per clip:
  <clip>: speed60 hand_l a@t / ... ; dv60 hand_l a@t / ... ; over <part> t0-t1 peak ...  then SPEED PASS / FAIL lines."""
import json
import math
import sys

import numpy as np

sys.path.insert(0, __import__('os').path.expanduser('~/Desktop/Code/test/ar_rifle_demo/blender/rifle_motion'))
import gltfio  # noqa: E402

SPEED = {'hand_l': 4.5, 'hand_r': 4.5, 'foot_l': 4.5, 'foot_r': 4.5, 'head': 2.0, 'pelvis': 1.8}
DV = {'hand_l': 4.5, 'hand_r': 4.5, 'foot_l': 4.5, 'foot_r': 4.5}
# (pass A4) per clip: the fast entry / exit clips' brisk steps (feet up to 6 m/s, the brief's allowance, said so in the
# log; car-exit's hands too) and the athletic gate for the new clips (hands / feet 8, head / pelvis 5, velocity change
# per 60 Hz sample 6 except within 2 frames (30 fps) after events.ground)
BRISK = dict(SPEED, foot_l=6.0, foot_r=6.0)
ATHLETIC = {'hand_l': 8.0, 'hand_r': 8.0, 'foot_l': 8.0, 'foot_r': 8.0, 'head': 5.0, 'pelvis': 5.0}
ATHLETIC_DV = {k: 6.0 for k in DV}
LIMITS = {'car-enter': (BRISK, DV), 'car-exit': (dict(BRISK, hand_l=6.0, hand_r=6.0), DV), 'heli-enter': (BRISK, DV), 'heli-exit': (BRISK, DV)}
for _c in ('car-bail', 'bail-roll', 'heli-jump', 'fall', 'land-roll', 'land-hard', 'para-pickup', 'para-deploy', 'para-hang', 'para-steer-l',
           'para-steer-r', 'para-flare', 'para-land'):
    LIMITS[_c] = (ATHLETIC, ATHLETIC_DV)


def limits(clip):
    return LIMITS.get(clip, (SPEED, DV))


def _qmul(a, b):
    w1, x1, y1, z1 = a[..., 3], a[..., 0], a[..., 1], a[..., 2]
    w2, x2, y2, z2 = b[..., 3], b[..., 0], b[..., 1], b[..., 2]
    return np.stack([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], -1)


def _qrot(q, v):
    u, w = q[..., :3], q[..., 3:4]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def _slerp(times, vals, ts):
    i = np.clip(np.searchsorted(times, ts, side='right') - 1, 0, len(times) - 1)
    j = np.minimum(i + 1, len(times) - 1)
    dt = np.where(j > i, times[j] - times[i], 1.0)
    x = np.where(j > i, (ts - times[i]) / dt, 0.0)[:, None]
    a, b = vals[i], vals[j].copy()
    d = np.sum(a * b, -1)
    b[d < 0] *= -1
    d = np.clip(np.abs(d), -1, 1)[:, None]
    th = np.arccos(d)
    s = np.sin(th)
    small = s < 1e-6
    wa = np.where(small, 1 - x, np.sin((1 - x) * th) / np.where(small, 1, s))
    wb = np.where(small, x, np.sin(x * th) / np.where(small, 1, s))
    q = wa * a + wb * b
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def _lerp(times, vals, ts):
    return np.stack([np.interp(ts, times, vals[:, k]) for k in range(vals.shape[1])], -1)


def positions(path, clip, hz=60.0, g_b=None):
    """{part: (n, 3)} in the vehicle frame and the sample times."""
    g, b = g_b or gltfio.read(path)
    nodes = g['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    anim = next(a for a in g['animations'] if a['name'] == clip)
    tr, t1 = {}, 0.0
    for ch in anim['channels']:
        s = anim['samplers'][ch['sampler']]
        t = np.array(gltfio.rows(g, b, s['input'])).reshape(-1)
        v = np.array(gltfio.rows(g, b, s['output']))
        tr[ch['target']['node'], ch['target']['path']] = (t, v)
        t1 = max(t1, float(t[-1]))
    ts = np.linspace(0.0, t1, int(round(t1 * hz)) + 1)
    order = []

    def visit(i):
        order.append(i)
        for c in nodes[i].get('children', []):
            visit(c)
    for i in range(len(nodes)):
        if i not in parent:
            visit(i)
    R, P = {}, {}
    for i in order:
        q = _slerp(*tr[i, 'rotation'], ts) if (i, 'rotation') in tr else np.tile(nodes[i].get('rotation', [0, 0, 0, 1]), (len(ts), 1))
        p = _lerp(*tr[i, 'translation'], ts) if (i, 'translation') in tr else np.tile(nodes[i].get('translation', [0, 0, 0]), (len(ts), 1))
        if i in parent:
            R[i] = _qmul(R[parent[i]], q)
            P[i] = P[parent[i]] + _qrot(R[parent[i]], p)
        else:
            R[i], P[i] = q, p
    name = {n.get('name'): i for i, n in enumerate(nodes)}
    return {k: P[name[k]] for k in SPEED if k in name}, ts


def measure(path, clip, g_b=None, exempt=()):
    """exempt: [(t0, t1)] clip times where the velocity change is not gated (an impact: events.ground and 2 frames after)."""
    pos, ts = positions(path, clip, g_b=g_b)
    LS, LD = limits(clip)
    out = {}
    if len(ts) < 3:  # (pass A4: a one-pose clip: nothing moves)
        return {k: dict(speed=(0.0, 0.0), dv60=(0.0, 0.0), over=[], dvOver=[]) for k in pos}
    for k, p in pos.items():
        v = np.diff(p, axis=0) * 60.0
        s = np.linalg.norm(v, axis=1)
        d = np.linalg.norm(np.diff(v, axis=0), axis=1)
        spans, cur = [], None
        for i, x in enumerate(s):
            if x > LS[k]:
                cur = [ts[i], ts[i + 1], x] if cur is None else [cur[0], ts[i + 1], max(cur[2], x)]
            elif cur:
                spans.append(cur)
                cur = None
        if cur:
            spans.append(cur)
        dsp = [(ts[i + 1], x) for i, x in enumerate(d) if k in LD and x > LD[k] and not any(a - 1e-6 <= ts[i + 1] <= b + 1e-6 for a, b in exempt)]
        i, j = int(np.argmax(s)), int(np.argmax(d))
        out[k] = dict(speed=(float(s[i]), float(ts[i + 1])), dv60=(float(d[j]), float(ts[j + 1])), over=spans, dvOver=dsp)
    return out


def lines(path, clips, gb=None, exempt=None):
    """Two lines per clip: '<clip>: speed60 ...; dv60 ...' and '<clip> SPEED PASS' or '<clip> SPEED FAIL: ...'.
    exempt: {clip: [(t0, t1)]} (pass A4: the impact frames of a ground clip)."""
    gb = gb or gltfio.read(path)
    out, res = [], {}
    for clip in clips:
        m = measure(path, clip, g_b=gb, exempt=(exempt or {}).get(clip, ()))
        res[clip] = m
        sp = ' / '.join(f'{k} {v["speed"][0]:.2f}@{v["speed"][1]:.2f}' for k, v in m.items())
        dv = ' / '.join(f'{k} {v["dv60"][0]:.2f}@{v["dv60"][1]:.2f}' for k, v in m.items() if k in DV)
        LS, LD = limits(clip)
        out.append(f'{clip}: speed60 {sp}; dv60 {dv}; limits ' + ' / '.join(f'{k} {LS[k]:g}' for k in LS) + f'; dv {max(LD.values()):g}')
        fails = []
        for k, v in m.items():
            for a, b_, pk in v['over']:
                fails.append(f'speed {k} {a:.2f}-{b_:.2f} peak {pk:.2f}')
            for t, x in v['dvOver']:
                fails.append(f'dv60 {k} {t:.3f} {x:.2f}')
        out.append(f'{clip} SPEED PASS' if not fails else f'{clip} SPEED FAIL: ' + '; '.join(fails[:30]) + (' ...' if len(fails) > 30 else ''))
    return out, res


def report(path, clips):
    out, res = lines(path, clips)
    print('\n'.join(out))
    return res


if __name__ == '__main__':
    a = sys.argv[1:]
    out = None
    if '--json' in a:
        k = a.index('--json')
        out = a[k + 1]
        del a[k:k + 2]
    r = report(a[0], a[1:])
    if out:
        json.dump(r, open(out, 'w'), indent=1, default=float)
