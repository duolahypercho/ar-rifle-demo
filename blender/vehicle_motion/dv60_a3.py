"""dv.py <pack.glb> clip [clip...] [--parts a,b] [--range t0 t1] [--root]: velocity change per 60 Hz frame of every joint,
sampling the clip as the game does (keys linear / slerp between, FK). Prints the worst per joint and the top frames.
With --root, applies the clip's notes root track [x, z, yaw] (vehicle packs)."""
import sys, json, math, pathlib
import numpy as np
sys.path.insert(0, __import__('os').path.expanduser('~/Desktop/Code/test/ar_rifle_demo/blender/rifle_motion'))
import gltfio

def qmul(a, b):
    w1, x1, y1, z1 = a[..., 3], a[..., 0], a[..., 1], a[..., 2]
    w2, x2, y2, z2 = b[..., 3], b[..., 0], b[..., 1], b[..., 2]
    return np.stack([w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2, w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2], -1)
def qrot(q, v):
    u = q[..., :3]; w = q[..., 3:4]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)
def slerp_rows(times, vals, ts):
    out = np.empty((len(ts), 4))
    for k, t in enumerate(ts):
        i = np.searchsorted(times, t, side='right') - 1
        i = min(max(i, 0), len(times) - 1)
        if i >= len(times) - 1: out[k] = vals[-1]; continue
        a, b = vals[i], vals[i + 1]; x = (t - times[i]) / (times[i + 1] - times[i])
        if np.dot(a, b) < 0: b = -b
        d = np.clip(np.dot(a, b), -1, 1); th = math.acos(d)
        if th < 1e-6: q = a + (b - a) * x
        else: q = (math.sin((1 - x) * th) * a + math.sin(x * th) * b) / math.sin(th)
        out[k] = q / np.linalg.norm(q)
    return out
def lerp_rows(times, vals, ts):
    return np.stack([np.interp(ts, times, vals[:, j]) for j in range(vals.shape[1])], -1)

def run(path, clip, hz=60.0, use_root=False, rng=None):
    g, b = gltfio.read(path)
    nodes = g['nodes']; parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    anim = next(a for a in g['animations'] if a['name'] == clip)
    tr = {}
    T1 = 0
    for ch in anim['channels']:
        s = anim['samplers'][ch['sampler']]
        t = np.array(gltfio.rows(g, b, s['input'])).reshape(-1); v = np.array(gltfio.rows(g, b, s['output']))
        tr[ch['target']['node'], ch['target']['path']] = (t, v); T1 = max(T1, t[-1])
    ts = np.arange(0, T1 + 1e-9, 1.0 / hz)
    if rng: ts = ts[(ts >= rng[0] - 0.05) & (ts <= rng[1] + 0.05)]
    n = len(nodes); R = {}; P = {}
    order = []
    def visit(i):
        order.append(i)
        for c in nodes[i].get('children', []): visit(c)
    for i in range(n):
        if i not in parent: visit(i)
    for i in order:
        q = slerp_rows(*tr[i, 'rotation'], ts) if (i, 'rotation') in tr else np.tile(nodes[i].get('rotation', [0, 0, 0, 1]), (len(ts), 1))
        p = lerp_rows(*tr[i, 'translation'], ts) if (i, 'translation') in tr else np.tile(nodes[i].get('translation', [0, 0, 0]), (len(ts), 1))
        if i in parent and parent[i] in R:
            R[i] = qmul(R[parent[i]], q); P[i] = P[parent[i]] + qrot(R[parent[i]], p)
        else:
            R[i], P[i] = q, p
    if use_root:
        notes = json.loads(pathlib.Path(path).with_suffix('.json').read_text())
        cl = notes['clips'][clip] if isinstance(notes['clips'], dict) else next(c for c in notes['clips'] if c['name'] == clip)
        root = np.array(cl['root']); kt = np.arange(len(root)) / 30.0
        x = np.interp(ts, kt, root[:, 0]); z = np.interp(ts, kt, root[:, 1]); yaw = np.interp(ts, kt, np.unwrap(root[:, 2]))
        for i in P:
            c, s = np.cos(yaw), np.sin(yaw)
            px, py, pz = P[i][:, 0], P[i][:, 1], P[i][:, 2]
            P[i] = np.stack([c * px + s * pz + x, py, -s * px + c * pz + z], -1)
    res = []
    for i in P:
        v = np.diff(P[i], axis=0) * hz
        dv = np.linalg.norm(np.diff(v, axis=0), axis=1)
        k = int(np.argmax(dv)); res.append((dv[k], nodes[i].get('name'), ts[k + 1], P[i]))
    res.sort(key=lambda r: -r[0])
    return res, ts

if __name__ == '__main__':
    a = sys.argv[1:]; path = a.pop(0)
    root = '--root' in a; a = [x for x in a if x != '--root']
    rng = None
    if '--range' in a:
        k = a.index('--range'); rng = (float(a[k + 1]), float(a[k + 2])); del a[k:k + 3]
    for clip in a:
        res, ts = run(path, clip, use_root=root, rng=rng)
        print(clip, ' '.join(f'{nm} {d:.2f}@{t:.3f}' for d, nm, t, _ in res[:8]))
