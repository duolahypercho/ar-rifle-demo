"""(pass A4) The ground clips' fit to the ground: per authored frame, how far the pelvis (and the body with it) goes up or
down so the body's lowest point other than the hands and feet (judge_a4: lowTrunkCm) lies `depth` cm into the ground
inside the clip's support windows (sitting, rolling: the trunk on the ground), smoothed; nothing changes outside them.
Composes with the stored fit (the measure is of the clip as built with it).

  python3 blender/vehicle_motion/ground_a4.py <review dir> <clip> t0:t1 [t0:t1 ...] [--depth 1.0] [--key k] [--sigma 2]
"""
import json
import math
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FILE = pathlib.Path(os.environ.get('A4_GROUND') or HERE / 'ground_a4.json')


def smooth(v, sigma):
    r = int(math.ceil(3 * sigma))
    if r == 0:
        return list(v)
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    n = len(v)
    return [sum(w[k + r] * v[min(n - 1, max(0, i + k))] for k in range(-r, r + 1)) / sum(w) for i in range(n)]


def fit(review, clip, windows, depth=1.0, key=None, sigma=2.0, ramp=3):
    a = json.loads((pathlib.Path(review) / f'{clip}-a4.json').read_text())
    low = a['lowTrunkCm']
    n = len(low)
    old = json.loads(FILE.read_text()).get(key or clip) if FILE.exists() else None
    old = old or [0.0] * n
    want = [0.0] * n
    inside = [any(t0 * 30 - 1e-6 <= i <= t1 * 30 + 1e-6 for t0, t1 in windows) for i in range(n)]
    for i in range(n):
        if inside[i]:
            want[i] = (-depth - low[i]) / 100.0
    # (eased in and out over `ramp` frames at the windows' edges)
    w = [1.0 if inside[i] else 0.0 for i in range(n)]
    w = smooth(w, ramp / 2.0)
    for i in range(n):
        if not inside[i]:
            j = min((k for k in range(n) if inside[k]), key=lambda k: abs(k - i), default=None)
            want[i] = want[j] if j is not None else 0.0
    d = smooth([want[i] * w[i] for i in range(n)], sigma)
    new = [round(o + x, 5) for o, x in zip(old + [old[-1]] * (n - len(old)), d)]
    all_ = json.loads(FILE.read_text()) if FILE.exists() else {}
    all_[key or clip] = new
    FILE.write_text(json.dumps(all_, indent=0))
    return max(abs(x) for x in d)


if __name__ == '__main__':
    args = sys.argv[1:]
    kw = {}
    for k in ('--depth', '--sigma'):
        if k in args:
            i = args.index(k)
            kw[k[2:]] = float(args[i + 1])
            del args[i:i + 2]
    if '--key' in args:
        i = args.index('--key')
        kw['key'] = args[i + 1]
        del args[i:i + 2]
    review, clip = args[0], args[1]
    windows = [tuple(map(float, x.split(':'))) for x in args[2:]]
    print(clip, 'largest change', round(fit(review, clip, windows, **kw) * 100, 2), 'cm')
