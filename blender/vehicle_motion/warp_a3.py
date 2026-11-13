"""warp_a3.py <pack.glb> <clip> [--margin 0.9] [--dilate 0.12] [--sigma 0.05]: (pass A3 round 2) a speed-limited time
warp for a clip, from the game's 60 Hz measure (speeds60): wherever a hand, foot, the head or the pelvis goes faster
than its limit (times `margin`), or a hand or foot changes velocity faster than its limit between 60 Hz samples,
the clip's time runs slower there by the factor that brings it under, widened by `dilate` s each side and smoothed,
so the move eases into and out of the slower stretch. Same poses, so every pair check stays valid.
Composes with the clip's current warp (blender/vehicle_motion/warps_a3.json, key '<clip>' for Tripo, 'ue5:<clip>' for
the EarthOnline body: --key) and writes the new one there.
"""
import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from vehicle_motion import speeds60  # noqa: E402

import os  # noqa: E402
WARPS = pathlib.Path(os.environ.get('A3_WARPS') or pathlib.Path(__file__).with_name('warps_a3.json'))


def load():
    return json.loads(WARPS.read_text()) if WARPS.exists() else {}


def compose(old, u, v):
    """old: [(clip time, authored time)] or None; u -> v the new clip times: the new [(v, authored)]."""
    if not old:
        return [(float(a), float(b)) for a, b in zip(v, u)]
    ou, ot = zip(*old)
    return [(float(a), float(np.interp(b, ou, ot))) for a, b in zip(v, u)]


def factor(path, clip, margin=0.9, dilate=0.12, sigma=0.05, window=None):
    pos, ts = speeds60.positions(path, clip)
    f = np.ones(len(ts))
    for k, p in pos.items():
        vel = np.diff(p, axis=0) * 60.0
        s = np.linalg.norm(vel, axis=1)
        need = s / (speeds60.SPEED[k] * margin)
        f[1:] = np.maximum(f[1:], need)
        f[:-1] = np.maximum(f[:-1], need)
        if k in speeds60.DV:
            d = np.linalg.norm(np.diff(vel, axis=0), axis=1)
            need = np.sqrt(d / (speeds60.DV[k] * margin))
            for o in (0, 1, 2):
                f[o:len(d) + o] = np.maximum(f[o:len(d) + o], need)
    w = int(round(dilate * 60))
    fd = np.array([f[max(0, i - w):i + w + 1].max() for i in range(len(f))])
    g = int(round(3 * sigma * 60))
    ker = np.exp(-0.5 * (np.arange(-g, g + 1) / (sigma * 60)) ** 2)
    ker /= ker.sum()
    fs = np.convolve(np.pad(fd, g, mode='edge'), ker, mode='valid')
    fs = np.maximum(fs, f)
    if window:  # (only inside [t0, t1] of the current clip time: the rest keeps its instants)
        fs = np.where((ts >= window[0]) & (ts <= window[1]), fs, 1.0)
    return ts, fs


def build(path, clip, key=None, **kw):
    ts, fs = factor(path, clip, **kw)
    v = np.concatenate([[0.0], np.cumsum((fs[1:] + fs[:-1]) / 2 * np.diff(ts))])
    # (keys every 1/30 s of the current clip time)
    idx = list(range(0, len(ts), 2))
    if idx[-1] != len(ts) - 1:
        idx.append(len(ts) - 1)
    warps = load()
    new = compose(warps.get(key or clip), ts[idx], v[idx])
    return new, float(ts[-1]), float(v[-1]), float(fs.max())


if __name__ == '__main__':
    a = sys.argv[1:]
    kw = {}
    for name in ('margin', 'dilate', 'sigma'):
        if '--' + name in a:
            k = a.index('--' + name)
            kw[name] = float(a[k + 1])
            del a[k:k + 2]
    key = None
    if '--key' in a:
        k = a.index('--key')
        key = a[k + 1]
        del a[k:k + 2]
    if '--window' in a:
        k = a.index('--window')
        kw['window'] = (float(a[k + 1]), float(a[k + 2]))
        del a[k:k + 3]
    dry = '--dry' in a
    a = [x for x in a if x != '--dry']
    path, clip = a[0], a[1]
    key = key or clip
    new, t0, t1, fmax = build(path, clip, key=key, **kw)
    print(f'{clip}: {t0:.2f} s -> {t1:.2f} s, slowest stretch x{fmax:.2f}')
    if not dry:
        w = load()
        w[key] = [[round(x, 5), round(y, 5)] for x, y in new]
        WARPS.write_text(json.dumps(w, indent=0))
