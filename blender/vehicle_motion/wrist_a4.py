"""(pass A4) The athletic clips' wrist estimate corrected by what the build measured: per frame and hand, the measured
flexion / deviation (judge_a4's wristPerFrame, the baked arm) minus the clip's own estimate (AClip.clamp_wrists, from its
targets and two-bone arms), stored in wrist_a4.json (key '<clip>' / 'ue5:<clip>'); the next build clamps against the
estimate plus that bias. Composes: the stored bias is added to (measured - estimate-with-bias's base)."""
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FILE = pathlib.Path(os.environ.get('A4_WRIST') or HERE / 'wrist_a4.json')


def update(review, clip, key=None):
    a = json.loads((pathlib.Path(review) / f'{clip}-a4.json').read_text())
    est, meas = a.get('wristEst'), a['wristPerFrame']
    if not est:
        print('no estimate in', clip)
        return
    out = {}
    for side in ('Left', 'Right'):
        out[side] = {str(i): [round(m[side][0] - e[0], 2), round(m[side][1] - e[1], 2)] for i, (m, e) in enumerate(zip(meas, est[side]))}
    allb = json.loads(FILE.read_text()) if FILE.exists() else {}
    allb[key or clip] = out
    FILE.write_text(json.dumps(allb))
    worst = max((abs(v[1]) for s in out.values() for v in s.values()), default=0)
    print(clip, 'largest deviation bias', worst)


if __name__ == '__main__':
    a = sys.argv[1:]
    key = None
    if '--key' in a:
        k = a.index('--key')
        key = a[k + 1]
        del a[k:k + 2]
    update(a[0], a[1], key)
