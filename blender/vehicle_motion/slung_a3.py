import sys, json; sys.path.insert(0, sys.argv[1]); import dv, numpy as np
pack = sys.argv[2]
j = json.load(open(pack.replace('.glb', '.json'))); cl = j['clips']; cl = cl if isinstance(cl, dict) else {c['name']: c for c in cl}
PARTS = ('hand_r', 'hand_l', 'PalmR', 'PalmL', 'foot_r', 'foot_l', 'head', 'pelvis', 'lowerarm_r', 'lowerarm_l', 'ElbowR', 'ElbowL', 'GunIn')
for clip in ('swap-rifle-shotgun', 'swap-shotgun-rifle'):
    res, ts = dv.run(pack, clip)
    d = {nm: P for _, nm, _, P in res}
    sl = cl[clip]['events']['slung']
    out = []
    for nm in PARTS:
        if nm not in d: continue
        v = np.diff(d[nm], axis=0) * 60
        dvv = np.linalg.norm(np.diff(v, axis=0), axis=1)
        k = int(np.argmax(dvv))
        # the game's stow: forwards to slung and stopped there (the speed at slung is the change); the draw backwards from it
        i = int(round(sl * 60)); sp = np.linalg.norm(v[min(i, len(v) - 1)]); sp0 = np.linalg.norm(v[min(i - 1, len(v) - 1)])
        out.append(f'{nm} max {dvv[k]:.2f}@{ts[k+1]:.3f} stop@slung {max(sp, sp0):.2f}')
    print(clip, 'slung', sl, '|', '; '.join(out))
