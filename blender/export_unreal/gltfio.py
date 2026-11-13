"""Plain numpy reader for the project's GLB files (pass R4: FBX for Unreal).

Works under plain python3 and inside Blender. Nothing here depends on bpy, so it is the
independent "truth" the FBX round trip is compared against: joint rests from the body GLB,
clip channels sampled from the clip GLB, forward kinematics and linear-blend skinning done
here in glTF space (metres, Y up, facing +Z).
"""
import json
import struct

import numpy as np

_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class GLB:
    def __init__(self, path):
        data = open(path, 'rb').read()
        assert data[:4] == b'glTF', path
        n = struct.unpack('<I', data[12:16])[0]
        self.json = json.loads(data[20:20 + n])
        off = 20 + n
        self.bin = b''
        if off < len(data):
            m = struct.unpack('<I', data[off:off + 4])[0]
            self.bin = data[off + 8:off + 8 + m]
        self.path = path
        self.nodes = self.json['nodes']
        self.parent = {}
        for i, nd in enumerate(self.nodes):
            for c in nd.get('children', []):
                self.parent[c] = i
        self.by_name = {nd.get('name'): i for i, nd in enumerate(self.nodes)}

    def accessor(self, i):
        a = self.json['accessors'][i]
        bv = self.json['bufferViews'][a['bufferView']]
        dt = np.dtype(_CT[a['componentType']])
        nc = _NC[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0)
        cnt = a['count']
        if stride and stride != dt.itemsize * nc:
            raw = np.frombuffer(self.bin, np.uint8, count=stride * (cnt - 1) + dt.itemsize * nc, offset=start)
            out = np.empty((cnt, nc), dt)
            for k in range(cnt):
                out[k] = np.frombuffer(raw[k * stride:k * stride + dt.itemsize * nc].tobytes(), dt)
        else:
            out = np.frombuffer(self.bin, dt, count=cnt * nc, offset=start).reshape(cnt, nc).copy()
        if a.get('normalized'):
            out = out.astype(np.float64) / np.iinfo(dt).max
        return out

    def rest_trs(self, i):
        nd = self.nodes[i]
        t = np.array(nd.get('translation', [0, 0, 0]), float)
        r = np.array(nd.get('rotation', [0, 0, 0, 1]), float)
        s = np.array(nd.get('scale', [1, 1, 1]), float)
        return t, r, s

    def node_path(self, i):
        out = []
        while i is not None:
            out.append(i)
            i = self.parent.get(i)
        return out[::-1]


# ---------------------------------------------------------------- maths (quaternions x, y, z, w)

def q_mul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz], -1)


def q_inv(q):
    q = np.array(q, float)
    q[..., :3] *= -1
    return q


def q_to_m(q):
    q = np.asarray(q, float)
    q = q / np.linalg.norm(q, axis=-1, keepdims=True)
    x, y, z, w = np.moveaxis(q, -1, 0)
    m = np.empty(q.shape[:-1] + (3, 3))
    m[..., 0, 0] = 1 - 2 * (y * y + z * z)
    m[..., 0, 1] = 2 * (x * y - z * w)
    m[..., 0, 2] = 2 * (x * z + y * w)
    m[..., 1, 0] = 2 * (x * y + z * w)
    m[..., 1, 1] = 1 - 2 * (x * x + z * z)
    m[..., 1, 2] = 2 * (y * z - x * w)
    m[..., 2, 0] = 2 * (x * z - y * w)
    m[..., 2, 1] = 2 * (y * z + x * w)
    m[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def m_to_q(m):
    """3x3 rotation(s) to x, y, z, w (w >= 0)."""
    m = np.asarray(m, float)
    shp = m.shape[:-2]
    m = m.reshape(-1, 3, 3)
    out = np.empty((len(m), 4))
    for k, r in enumerate(m):
        tr = r[0, 0] + r[1, 1] + r[2, 2]
        if tr > 0:
            s = np.sqrt(tr + 1.0) * 2
            q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
            q = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
        elif r[1, 1] > r[2, 2]:
            s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
            q = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
            q = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
        q = np.array(q)
        q /= np.linalg.norm(q)
        out[k] = q if q[3] >= 0 else -q
    return out.reshape(shp + (4,))


def trs_to_m(t, r, s=None):
    t = np.asarray(t, float)
    m = np.zeros(t.shape[:-1] + (4, 4))
    rot = q_to_m(r)
    if s is not None:
        rot = rot * np.asarray(s, float)[..., None, :]
    m[..., :3, :3] = rot
    m[..., :3, 3] = t
    m[..., 3, 3] = 1
    return m


def slerp(a, b, t):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    t = np.asarray(t, float)[..., None]
    lin = d > 0.9995
    th = np.arccos(np.clip(d, -1, 1))
    sn = np.where(lin, 1, np.sin(th))
    wa = np.where(lin, 1 - t, np.sin((1 - t) * th) / sn)
    wb = np.where(lin, t, np.sin(t * th) / sn)
    q = wa * a + wb * b
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def angle_deg(ma, mb):
    """Angle between rotation matrices (..., 3, 3)."""
    r = np.einsum('...ji,...jk->...ik', ma, mb)
    c = (np.trace(r, axis1=-2, axis2=-1) - 1) / 2
    k = r - np.swapaxes(r, -1, -2)
    s = np.sqrt(np.sum(k * k, axis=(-2, -1))) / (2 * np.sqrt(2))
    return np.degrees(np.arctan2(s, c))


# ---------------------------------------------------------------- bodies and clips

class Body:
    """A skinned body GLB: joints (skin order), parents, rest TRS, bind (inverse IBM)."""

    def __init__(self, path):
        g = self.g = GLB(path)
        skin = g.json['skins'][0]
        self.joint_nodes = skin['joints']
        self.joints = [g.nodes[j]['name'] for j in self.joint_nodes]
        jset = set(self.joint_nodes)
        self.parent = {}
        for j in self.joint_nodes:
            p = g.parent.get(j)
            self.parent[g.nodes[j]['name']] = g.nodes[p]['name'] if p in jset else None
        self.rest = {g.nodes[j]['name']: g.rest_trs(j) for j in self.joint_nodes}
        ibm = g.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1).astype(float)
        self.bind = {n: np.linalg.inv(m) for n, m in zip(self.joints, ibm)}
        # joints above the skeleton root that are not joints (none expected)
        self.order = self._order()
        self.mesh_node = next(i for i, nd in enumerate(g.nodes) if 'mesh' in nd)

    def _order(self):
        out, seen = [], set()

        def visit(n):
            if n in seen:
                return
            p = self.parent[n]
            if p is not None:
                visit(p)
            seen.add(n)
            out.append(n)
        for n in self.joints:
            visit(n)
        return out

    def rest_world(self):
        w = {}
        for n in self.order:
            t, r, s = self.rest[n]
            m = trs_to_m(t, r, s)
            p = self.parent[n]
            w[n] = m if p is None else w[p] @ m
        return w

    def mesh(self):
        """POSITION, NORMAL, JOINTS_0, WEIGHTS_0 of the (single) primitive + morph target positions."""
        g = self.g
        prim = g.json['meshes'][g.nodes[self.mesh_node]['mesh']]['primitives'][0]
        at = prim['attributes']
        pos = g.accessor(at['POSITION']).astype(float)
        jts = g.accessor(at['JOINTS_0']).astype(int)
        wts = g.accessor(at['WEIGHTS_0']).astype(float)
        idx = g.accessor(prim['indices']).ravel() if 'indices' in prim else None
        return pos, jts, wts, idx

    def skin(self, world):
        """Linear blend skinning of the bind mesh with joint world matrices `world` (name -> 4x4)."""
        pos, jts, wts, _ = self.mesh()
        mats = np.stack([world[n] @ np.linalg.inv(self.bind[n]) for n in self.joints])
        hom = np.c_[pos, np.ones(len(pos))]
        out = np.zeros((len(pos), 3))
        for k in range(jts.shape[1]):
            m = mats[jts[:, k]]
            out += wts[:, k:k + 1] * np.einsum('vij,vj->vi', m, hom)[:, :3]
        return out


class ClipPack:
    def __init__(self, path):
        self.g = GLB(path)
        self.anims = {a['name']: a for a in self.g.json['animations']}
        self.names = [a['name'] for a in self.g.json['animations']]

    def node_name(self, i):
        return self.g.nodes[i]['name']

    def parent_name(self, name):
        p = self.g.parent.get(self.g.by_name[name])
        return None if p is None else self.g.nodes[p]['name']

    def channels(self, clip):
        """{(node name, path): (times, values)}"""
        a = self.anims[clip]
        out = {}
        for ch in a['channels']:
            s = a['samplers'][ch['sampler']]
            assert s.get('interpolation', 'LINEAR') == 'LINEAR', s
            t = self.g.accessor(s['input']).ravel().astype(float)
            v = self.g.accessor(s['output']).astype(float)
            out[(self.node_name(ch['target']['node']), ch['target']['path'])] = (t, v)
        return out

    def sample(self, clip, fps=30.0, frames=None):
        """Per frame local TRS for every keyed node: {name: {'translation': (F,3), 'rotation': (F,4)}}.
        Frames 0..last (inclusive) of the clip's time range at `fps`."""
        ch = self.channels(clip)
        tmax = max(t[-1] for t, _ in ch.values())
        nf = int(round(tmax * fps)) + 1 if frames is None else frames
        ts = np.arange(nf) / fps
        out = {}
        for (name, path), (t, v) in ch.items():
            out.setdefault(name, {})[path] = _interp(t, v, ts, path == 'rotation')
        return out, nf


def _interp(t, v, ts, rot):
    ts = np.clip(ts, t[0], t[-1])
    i = np.searchsorted(t, ts, side='right') - 1
    i = np.clip(i, 0, len(t) - 2) if len(t) > 1 else np.zeros_like(i)
    if len(t) == 1:
        return np.repeat(v[:1], len(ts), 0)
    u = (ts - t[i]) / np.maximum(t[i + 1] - t[i], 1e-12)
    u = np.clip(u, 0, 1)
    if rot:
        return slerp(v[i], v[i + 1], u)
    return v[i] * (1 - u[:, None]) + v[i + 1] * u[:, None]


def pose_world(body, extra_parent, rest_extra, samp, f):
    """World 4x4 per joint (and per extra node) at frame f. `extra_parent`: {extra: parent joint};
    `rest_extra`: {extra: (t, r, s)} rest TRS of extra nodes. `samp`: ClipPack.sample()[0]."""
    w = {}

    def local(n, rest):
        t, r, s = rest
        ch = samp.get(n, {})
        if 'translation' in ch:
            t = ch['translation'][f]
        if 'rotation' in ch:
            r = ch['rotation'][f]
        if 'scale' in ch:
            s = ch['scale'][f]
        return trs_to_m(t, r, s)
    for n in body.order:
        m = local(n, body.rest[n])
        p = body.parent[n]
        w[n] = m if p is None else w[p] @ m
    for n, p in extra_parent.items():
        w[n] = w[p] @ local(n, rest_extra[n])
    return w
