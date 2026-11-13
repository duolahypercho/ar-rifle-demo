"""(pass A4) The fast entry and exit clips: a speed-limited time warp that runs the authored move as fast as the limits
allow, not uniformly faster. Brisk, at the user's target pace, with the same poses: holds and slow stretches shrink most, the moves that are
already quick stay near their speed.

  python3 blender/vehicle_motion/warp_a4.py design <pack.glb> <clip> [--key k] [--margin 0.9] [--rmax 5] [--sigma 0.08]
          [--dilate 0.08] [--over part:t0:t1:limit ...] [--hold t0:t1:seconds ...] [--dry]
  python3 blender/vehicle_motion/warp_a4.py fix <pack.glb> <clip> [--key k] [--margin 0.95] [--dilate 0.06] [--sigma 0.04]

design: <pack.glb> holds the clip built at its AUTHORED timing (no warp: build with A4_WARPS pointing at a file without
  the clip's key). Per 60 Hz interval of authored time, the slowness needed (clip seconds per authored second) is the
  largest of: each part's speed over its limit (hands / feet 4.5 m/s, head 2.0, pelvis 1.8; --over raises a part's limit
  inside a window; the base is speeds60.limits(clip): brisk steps 6 m/s for the feet), the square root of each hand's / foot's velocity change between 60 Hz
  samples over 4.5 m/s, the head's and the pelvis's turn rate over 500 / 420 deg/s, the door's swing over 220 deg/s opening, 320 closing;
  never less than 1 / rmax. It is widened by `dilate` s each side, smoothed (gaussian, `sigma` s) and never below the
  raw need. --hold t0:t1:s gives an authored stretch at least s clip seconds (a beat kept). The warp [(clip time,
  authored time)] goes into warps_a4.json under `key` (default the clip; 'ue5:<clip>' for the EarthOnline body).
fix: <pack.glb> holds the clip built WITH its warp; wherever the 60 Hz measure is still over a limit (times `margin`)
  the clip's time runs slower there (warp_a3's factor), composed into the stored warp.
"""
import json
import os
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from vehicle_motion import speeds60  # noqa: E402
from rifle_motion import gltfio  # noqa: E402

WARPS = pathlib.Path(os.environ.get('A4_WARPS') or HERE / 'warps_a4.json')
LIMIT = dict(speeds60.SPEED)
DV = 4.5
ANG = {'head': 500.0, 'pelvis': 420.0}  # deg/s: a brisk turn on the spot
ANG_CLIP = {c: {'head': 900.0, 'pelvis': 800.0} for c in ('car-bail', 'bail-roll', 'heli-jump', 'land-roll', 'land-hard')}  # (a roll turns fast)
TWIST = 40.0 * 30.0 * 0.97  # deg/s: the gate's 40 deg per 30 fps frame
DOOR_DEG = {'car': 55.0, 'heli': 68.0}
DOOR_FLUNG = (700.0, 700.0)  # (a door shoved open in a bail)
DOOR_RATE = (220.0, 320.0)  # deg/s opening (pushed, the strut) / closing (dropped or swung shut)


def load():
    return json.loads(WARPS.read_text()) if WARPS.exists() else {}


def _end_on(keys, t_end):
    """The warp's last key on the authored end t_end (a composed warp can stop a little short of it: the clip would then
    run the rest at rate 1)."""
    keys = [(float(a), float(b)) for a, b in keys]
    if keys[-1][1] < t_end - 1e-6:
        (u0, t0), (u1, t1) = keys[-2], keys[-1]
        rate = (t1 - t0) / max(1e-9, u1 - u0)
        keys.append((u1 + (t_end - t1) / max(rate, 1e-3), t_end))
    return keys


def save(key, keys, t_end=None):
    if t_end is not None:
        keys = _end_on(keys, t_end)
    w = load()
    w[key] = [[round(float(a), 5), round(float(b), 5)] for a, b in keys]
    WARPS.write_text(json.dumps(w, indent=0))


def tracks(path, clip, hz=60.0, g_b=None):
    """{part: (n, 3) positions}, {head / pelvis: (n, 4) world quats xyzw}, sample times (the clip's own time)."""
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
    R, P, L = {}, {}, {}
    for i in order:
        q = speeds60._slerp(*tr[i, 'rotation'], ts) if (i, 'rotation') in tr else np.tile(nodes[i].get('rotation', [0, 0, 0, 1]), (len(ts), 1))
        L[i] = q
        p = speeds60._lerp(*tr[i, 'translation'], ts) if (i, 'translation') in tr else np.tile(nodes[i].get('translation', [0, 0, 0]), (len(ts), 1))
        if i in parent:
            R[i] = speeds60._qmul(R[parent[i]], q)
            P[i] = P[parent[i]] + speeds60._qrot(R[parent[i]], p)
        else:
            R[i], P[i] = q, p
    name = {n.get('name'): i for i, n in enumerate(nodes)}
    rot = {k: R[name[k]] for k in ANG if k in name}
    for k in ('hand_l', 'hand_r'):  # (the hand's turn in its forearm's frame: its twist about the bone, local +Y)
        rot['twist_' + k] = L[name[k]]
    return {k: P[name[k]] for k in LIMIT if k in name}, rot, ts


def twist_rate(q, hz):
    """deg/s of the twist about +Y of local rotations q (n, 4) xyzw."""
    w = np.where(q[:, 3:4] < 0, -q, q)
    a = 2 * np.arctan2(w[:, 1], w[:, 3])
    d = np.diff(a)
    d = (d + np.pi) % (2 * np.pi) - np.pi
    return np.degrees(np.abs(d)) * hz


def _ang_rate(q, hz):
    d = np.abs(np.sum(q[1:] * q[:-1], -1)).clip(0, 1)
    return np.degrees(2 * np.arccos(d)) * hz


def door_track(json_path, clip, ts):
    """The clip's door (0..1) at the sample times, from the pack's notes (30 fps)."""
    j = json.loads(pathlib.Path(json_path).read_text())
    c = j['clips'][clip]
    d = np.array(c.get('door') or [0.0])
    tt = np.arange(len(d)) / 30.0
    return np.interp(ts, tt, d), DOOR_DEG.get(c.get('vehicle'), 60.0)


def need(path, clip, margin=0.9, over=(), hz=60.0, dv_margin=None, twist_margin=None):
    """Per 60 Hz interval: the slowness needed (>= 0) and which limit asks for it."""
    pos, rot, ts = tracks(path, clip, hz)
    try:  # (the athletic gate: no velocity-change line at an impact, events.ground and 2 frames after)
        ev = json.loads(pathlib.Path(path).with_suffix('.json').read_text())['clips'][clip]['events']
        exempt = [(ev['ground'], ev['ground'] + 2.0 / 30.0)] if 'ground' in ev else []
    except (KeyError, FileNotFoundError):
        exempt = []
    LS, LD = speeds60.limits(clip)  # (the clip's own gate lines: brisk steps 6 m/s for the feet)
    n = len(ts) - 1
    s = np.zeros(n)
    who = np.array([''] * n, dtype=object)

    def take(x, label):
        m = x > s
        s[m] = x[m]
        who[m] = label
    for k, p in pos.items():
        v = np.diff(p, axis=0) * hz
        sp = np.linalg.norm(v, axis=1)
        lim = np.full(n, LS[k])
        for part, a, b_, L in over:
            if part == k:
                lim[(ts[:-1] >= a) & (ts[:-1] <= b_)] = L
        take(sp / (lim * margin), k)
        if k in speeds60.DV:
            d = np.linalg.norm(np.diff(v, axis=0), axis=1)
            for a, b_ in exempt:
                d[(ts[1:-1] >= a - 1e-6) & (ts[1:-1] <= b_ + 1e-6)] = 0.0
            x = np.sqrt(d / (LD[k] * (dv_margin or margin)))
            x2 = np.zeros(n)
            x2[:-1] = np.maximum(x2[:-1], x)
            x2[1:] = np.maximum(x2[1:], x)
            take(x2, k + ' dv')
    ang = dict(ANG, **ANG_CLIP.get(clip, {}))
    for k, q in rot.items():
        if k.startswith('twist_'):  # (the gate: the hand's twist against the forearm at most 40 deg a 30 fps frame)
            take(twist_rate(q, hz) / (TWIST * (twist_margin or margin)), k)
        else:
            take(_ang_rate(q, hz) / (ang[k] * margin), k + ' turn')
    try:
        door, deg = door_track(pathlib.Path(path).with_suffix('.json'), clip, ts)
        dd = np.diff(door) * deg * hz
        rate = DOOR_FLUNG if clip in ('car-bail', 'heli-jump') else DOOR_RATE
        take(np.where(dd > 0, dd / rate[0], -dd / rate[1]), 'door')
    except (KeyError, FileNotFoundError):
        pass
    return ts, s, who


def design(path, clip, key=None, margin=0.9, rmax=5.0, sigma=0.08, dilate=0.08, over=(), holds=(), hz=60.0, dry=False, dv_margin=None, twist_margin=None):
    ts, s_raw, who = need(path, clip, margin, over, hz, dv_margin, twist_margin)
    s = np.maximum(s_raw, 1.0 / rmax)
    w = int(round(dilate * hz))
    sd = np.array([s[max(0, i - w):i + w + 1].max() for i in range(len(s))])
    g = int(round(3 * sigma * hz))
    if g > 0:
        ker = np.exp(-0.5 * (np.arange(-g, g + 1) / (sigma * hz)) ** 2)
        ker /= ker.sum()
        sd = np.convolve(np.pad(sd, g, mode='edge'), ker, mode='valid')
    s2 = np.maximum(sd, s)
    dt = np.diff(ts)
    for a, b_, sec in holds:  # (a beat kept: the stretch takes at least `sec` clip seconds)
        m = (ts[:-1] >= a) & (ts[:-1] < b_)
        have = float(np.sum(s2[m] * dt[m]))
        if have < sec and have > 0:
            s2[m] *= sec / have
    u = np.concatenate([[0.0], np.cumsum(s2 * dt)])
    keys = list(zip(u, ts))
    if not dry:
        save(key or clip, keys)
    return keys, s2, who


def report(ts, s2, who, step=0.5):
    out = []
    for a in np.arange(0, ts[-1], step):
        m = (ts[:-1] >= a) & (ts[:-1] < a + step)
        if not m.any():
            continue
        dt = np.diff(ts)[m]
        top = who[m][np.argmax(s2[m])]
        out.append(f'{a:4.1f}-{a + step:4.1f}: {np.sum(s2[m] * dt):.2f} s ({top})')
    return out


def fix(path, clip, key=None, margin=0.95, dilate=0.06, sigma=0.04, windows=None):
    """Slower where the warped clip (in <pack.glb>) is still over a line of the gate: each part's speed, the velocity
    change between 60 Hz samples of the hands (wrist and palm: middle_01), feet and head (2.0 m/s: the gate's snap30),
    the hand's twist against the forearm per 30 fps frame (40 deg); widened, smoothed, composed into the stored warp."""
    sys.path.insert(0, str(HERE))
    from vehicle_motion import warp_a3
    old = load().get(key or clip)
    LS, LD = speeds60.limits(clip)
    g_b = gltfio.read(path)
    pos, rot, ts = tracks(path, clip, 60.0, g_b)
    extra = _points(path, clip, ('middle_01_l', 'middle_01_r'), ts, g_b)
    f = np.ones(len(ts))

    def bump(need, lag=(0, 1)):
        for o in lag:
            f[o:len(need) + o] = np.maximum(f[o:len(need) + o], need)
    for k, p in list(pos.items()) + list(extra.items()):
        vel = np.diff(p, axis=0) * 60.0
        if k in LS:
            bump(np.linalg.norm(vel, axis=1) / (LS[k] * margin))
        lim = LD.get(k, LD['hand_l'] if k.startswith('middle') else 2.0 if k == 'head' else None)
        if lim:
            d = np.linalg.norm(np.diff(vel, axis=0), axis=1)
            bump(np.sqrt(d / (lim * margin)), (0, 1, 2))
    for k in ('twist_hand_l', 'twist_hand_r'):
        bump(twist_rate(rot[k], 60.0) / (40.0 * 30.0 * margin))
    # (the gate's snap30: the change of the 30 fps chord velocity, hands' palms and feet 4.5, head 2.0)
    p30, _, t30 = tracks(path, clip, 30.0, g_b)
    p30.update(_points(path, clip, ('middle_01_l', 'middle_01_r'), t30, g_b))
    for k, p in p30.items():
        lim = 2.0 if k == 'head' else 4.5 if (k.startswith('hand') or k.startswith('foot') or k.startswith('middle')) else None
        if not lim:
            continue
        d = np.linalg.norm(np.diff(np.diff(p, axis=0) * 30.0, axis=0), axis=1)
        need = np.zeros(len(t30))
        need[1:-1] = np.sqrt(d / (lim * margin))
        f = np.maximum(f, np.interp(ts, t30, np.maximum(need, np.maximum(np.roll(need, 1), np.roll(need, -1)))))
    if windows:
        m = np.zeros(len(ts), bool)
        for a, b_ in windows:
            m |= (ts >= a) & (ts <= b_)
        f = np.where(m, f, 1.0)
    w = int(round(dilate * 60))
    fd = np.array([f[max(0, i - w):i + w + 1].max() for i in range(len(f))])
    g = int(round(3 * sigma * 60))
    ker = np.exp(-0.5 * (np.arange(-g, g + 1) / (sigma * 60)) ** 2)
    ker /= ker.sum()
    fs = np.maximum(np.convolve(np.pad(fd, g, mode='edge'), ker, mode='valid'), f)
    v = np.concatenate([[0.0], np.cumsum((fs[1:] + fs[:-1]) / 2 * np.diff(ts))])
    new = warp_a3.compose(old, ts, v)
    save(key or clip, new, t_end=old[-1][1] if old else None)
    return float(ts[-1]), float(v[-1]), float(fs.max())


def _points(path, clip, names, ts, g_b):
    """Positions of more joints (by name) at the sample times, as tracks() computes them."""
    g, b = g_b
    nodes = g['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    anim = next(a for a in g['animations'] if a['name'] == clip)
    tr = {}
    for ch in anim['channels']:
        s_ = anim['samplers'][ch['sampler']]
        tr[ch['target']['node'], ch['target']['path']] = (np.array(gltfio.rows(g, b, s_['input'])).reshape(-1), np.array(gltfio.rows(g, b, s_['output'])))
    idx = {n.get('name'): i for i, n in enumerate(nodes)}
    out = {}
    for nm in names:
        chain = [idx[nm]]
        while chain[-1] in parent:
            chain.append(parent[chain[-1]])
        R = np.tile([0.0, 0.0, 0.0, 1.0], (len(ts), 1))
        P = np.zeros((len(ts), 3))
        for i in reversed(chain):
            q = speeds60._slerp(*tr[i, 'rotation'], ts) if (i, 'rotation') in tr else np.tile(nodes[i].get('rotation', [0, 0, 0, 1]), (len(ts), 1))
            p = speeds60._lerp(*tr[i, 'translation'], ts) if (i, 'translation') in tr else np.tile(nodes[i].get('translation', [0, 0, 0]), (len(ts), 1))
            P = P + speeds60._qrot(R, p)
            R = speeds60._qmul(R, q)
        out[nm] = P
    return out


def nudge(clip, frames, key=None):
    """Shifts the instants the clip's frames sample, near given frames, keeping its length: frames {f: delta in frames};
    the clip's frame u samples W(u + d(u)), d a raised-cosine bump of width +-3 frames peaking at delta/30 s on frame f.
    (A frame that lands on a thin slice of an authored move where something brushes 2.0+ cm in moves off it.)"""
    keys = load()[key or clip]
    us = np.array([k[0] for k in keys])
    ts = np.array([k[1] for k in keys])
    T = us[-1]
    grid = np.arange(0.0, T + 1e-9, 1.0 / 240.0)
    d = np.zeros(len(grid))
    for f, delta in frames.items():
        x = (grid - f / 30.0) / (3.0 / 30.0)
        d += np.where(np.abs(x) < 1, 0.5 * (1 + np.cos(np.pi * x)), 0.0) * delta / 30.0
    u2 = np.clip(grid + d, 0.0, T)
    if np.any(np.diff(u2) <= 0):
        raise ValueError('nudge too large: the warp would run backwards')
    t2 = np.interp(u2, us, ts)
    new = list(zip(grid, t2))
    if new[-1][0] < T - 1e-6:
        new.append((T, ts[-1]))
    save(key or clip, new, t_end=ts[-1])


def _opts(a):
    kw, over, holds = {}, [], []
    i = 0
    rest = []
    while i < len(a):
        x = a[i]
        if x in ('--margin', '--rmax', '--sigma', '--dilate', '--dv_margin'):
            kw[x[2:]] = float(a[i + 1])
            i += 2
        elif x == '--key':
            kw['key'] = a[i + 1]
            i += 2
        elif x == '--over':
            p, t0, t1, L = a[i + 1].split(':')
            over.append((p, float(t0), float(t1), float(L)))
            i += 2
        elif x == '--hold':
            t0, t1, sec = map(float, a[i + 1].split(':'))
            holds.append((t0, t1, sec))
            i += 2
        elif x == '--dry':
            kw['dry'] = True
            i += 1
        else:
            rest.append(x)
            i += 1
    return rest, kw, over, holds


if __name__ == '__main__':
    mode = sys.argv[1]
    rest, kw, over, holds = _opts(sys.argv[2:])
    path, clip = rest[0], rest[1]
    if mode == 'design':
        keys, s2, who = design(path, clip, over=over, holds=holds, **kw)
        ts = np.array([k[1] for k in keys])
        print(f'{clip}: authored {ts[-1]:.2f} s -> {keys[-1][0]:.2f} s')
        print('\n'.join(report(ts, s2, who)))
    elif mode == 'nudge':  # nudge <clip> f:delta ... [--key k]
        nudge(rest[0], {int(x.split(':')[0]): float(x.split(':')[1]) for x in rest[1:]}, kw.get('key'))
    elif mode == 'fix':
        kw.pop('rmax', None)
        kw.pop('dry', None)
        t0, t1, fmax = fix(path, clip, **kw)
        print(f'{clip}: {t0:.2f} s -> {t1:.2f} s, slowest stretch x{fmax:.2f}')
