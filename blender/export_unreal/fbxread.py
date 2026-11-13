"""Minimal binary FBX reader (plain python3 + numpy), independent of Blender's FBX importer.

Reads what Unreal's importer starts from: GlobalSettings (units, axes, frame rate), the Model
nodes and their parents, Lcl transforms, mesh vertices, deformers and blend shapes, take spans.
"""
import struct
import zlib

import numpy as np

_ARR = {b'f': ('<f', 4), b'd': ('<d', 8), b'l': ('<q', 8), b'i': ('<i', 4), b'b': ('<B', 1)}


class Node:
    __slots__ = ('name', 'props', 'kids')

    def __init__(self, name, props, kids):
        self.name, self.props, self.kids = name, props, kids

    def find(self, name):
        return [k for k in self.kids if k.name == name]

    def first(self, name):
        for k in self.kids:
            if k.name == name:
                return k
        return None


def _props(b, o, n):
    out = []
    for _ in range(n):
        t = b[o:o + 1]
        o += 1
        if t == b'Y':
            out.append(struct.unpack_from('<h', b, o)[0]); o += 2
        elif t == b'C':
            out.append(bool(b[o])); o += 1
        elif t == b'I':
            out.append(struct.unpack_from('<i', b, o)[0]); o += 4
        elif t == b'F':
            out.append(struct.unpack_from('<f', b, o)[0]); o += 4
        elif t == b'D':
            out.append(struct.unpack_from('<d', b, o)[0]); o += 8
        elif t == b'L':
            out.append(struct.unpack_from('<q', b, o)[0]); o += 8
        elif t in (b'S', b'R'):
            ln = struct.unpack_from('<I', b, o)[0]; o += 4
            raw = b[o:o + ln]; o += ln
            out.append(raw.decode('utf-8', 'replace') if t == b'S' else raw)
        elif t in _ARR:
            ln, enc, cl = struct.unpack_from('<III', b, o); o += 12
            raw = b[o:o + cl]; o += cl
            if enc == 1:
                raw = zlib.decompress(raw)
            fmt, _sz = _ARR[t]
            out.append(np.frombuffer(raw, np.dtype(fmt), count=ln))
        else:
            raise ValueError(f'prop type {t!r} at {o}')
    return out, o


def _node(b, o, v64):
    if v64:
        end, np_, _pl = struct.unpack_from('<QQQ', b, o); o += 24
    else:
        end, np_, _pl = struct.unpack_from('<III', b, o); o += 12
    nl = b[o]; o += 1
    if end == 0:
        return None, o
    name = b[o:o + nl].decode(); o += nl
    props, o = _props(b, o, np_)
    kids = []
    sentinel = 25 if v64 else 13
    while o < end:
        if end - o == sentinel and not any(b[o:end]):
            o = end
            break
        k, o = _node(b, o, v64)
        if k is None:
            break
        kids.append(k)
    return Node(name, props, kids), end


def read(path):
    b = open(path, 'rb').read()
    assert b[:20] == b'Kaydara FBX Binary  ', 'not a binary FBX'
    ver = struct.unpack_from('<I', b, 23)[0]
    v64 = ver >= 7500
    o = 27
    top = []
    while o < len(b):
        n, o = _node(b, o, v64)
        if n is None:
            break
        top.append(n)
    return FBX(ver, top)


def p70(node):
    out = {}
    pn = node.first('Properties70') if node else None
    if pn:
        for p in pn.find('P'):
            out[p.props[0]] = p.props[4:] if len(p.props) > 4 else []
    return out


class FBX:
    def __init__(self, ver, top):
        self.version = ver
        self.top = {n.name: n for n in top}
        self.settings = p70(self.top['GlobalSettings'])
        objs = self.top['Objects']
        self.objects = {}
        for n in objs.kids:
            self.objects[n.props[0]] = n
        self.conn = []   # (kind, child, parent, prop)
        for c in self.top['Connections'].find('C'):
            self.conn.append((c.props[0], c.props[1], c.props[2], c.props[3] if len(c.props) > 3 else None))
        self.parent = {}
        for kind, ch, pa, _ in self.conn:
            if kind == 'OO' and ch in self.objects and self.objects[ch].name == 'Model' and \
                    (pa == 0 or (pa in self.objects and self.objects[pa].name == 'Model')):
                self.parent[ch] = pa

    @staticmethod
    def oname(n):
        return n.props[1].split('\x00')[0]

    def models(self):
        """[(id, name, type, parent name or None)] for every Model."""
        out = []
        for i, n in self.objects.items():
            if n.name != 'Model':
                continue
            pa = self.parent.get(i, 0)
            pn = self.oname(self.objects[pa]) if pa in self.objects else None
            out.append((i, self.oname(n), n.props[2], pn))
        return out

    def lcl(self, i):
        p = p70(self.objects[i])
        t = p.get('Lcl Translation', [0, 0, 0])
        r = p.get('Lcl Rotation', [0, 0, 0])
        s = p.get('Lcl Scaling', [1, 1, 1])
        pre = p.get('PreRotation', [0, 0, 0])
        return np.array(t, float), np.array(r, float), np.array(s, float), np.array(pre, float), p

    def geometries(self):
        out = []
        for i, n in self.objects.items():
            if n.name == 'Geometry' and n.props[2] == 'Mesh':
                v = n.first('Vertices').props[0].reshape(-1, 3)
                out.append((i, self.oname(n), v))
        return out

    def blendshape_channels(self):
        return [self.oname(n) for n in self.objects.values()
                if n.name == 'Deformer' and n.props[2] == 'BlendShapeChannel']

    def takes(self):
        out = []
        tk = self.top.get('Takes')
        if tk:
            for t in tk.find('Take'):
                ls = t.first('LocalTime')
                out.append((t.props[0], ls.props if ls else None))
        return out

    def anim_stacks(self):
        return [(self.oname(n), p70(n)) for n in self.objects.values() if n.name == 'AnimationStack']

    def embedded(self):
        out = []
        for n in self.objects.values():
            if n.name == 'Video':
                c = n.first('Content')
                rel = n.first('RelativeFilename')
                out.append((self.oname(n), rel.props[0] if rel else None, len(c.props[0]) if c and c.props and isinstance(c.props[0], bytes) else 0))
        return out


KTIME = 46186158000


def euler_xyz_deg_to_m(r):
    """FBX rotation order XYZ (eEulerXYZ): R = Rz * Ry * Rx."""
    x, y, z = np.radians(r)
    cx, sx, cy, sy, cz, sz = np.cos(x), np.sin(x), np.cos(y), np.sin(y), np.cos(z), np.sin(z)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def anim_globals(fbx, nframes, fps=30.0):
    """Pass U1: global 4x4 per Model per frame, from the take's own curves (Lcl Translation / Rotation / Scaling,
    linear between keys; static Lcl where a channel has no curve), PreRotation honoured, file units. What Unreal's
    importer samples, without Blender's importer in between. -> {name: (nframes, 4, 4)}"""
    ts = np.arange(nframes) / fps
    ms = fbx.models()
    loc = {}
    for i, name, typ, _ in ms:
        t, r, s, pre, _p = fbx.lcl(i)
        ch = {'Lcl Translation': np.tile(t, (nframes, 1)), 'Lcl Rotation': np.tile(r, (nframes, 1)),
              'Lcl Scaling': np.tile(s, (nframes, 1))}
        for kind, cn, pa, pr in fbx.conn:
            if kind == 'OP' and pa == i and pr in ch:
                for k2, c2, p2, axis in fbx.conn:
                    if k2 == 'OP' and p2 == cn and c2 in fbx.objects and fbx.objects[c2].name == 'AnimationCurve':
                        c = fbx.objects[c2]
                        kt = c.first('KeyTime').props[0].astype(float) / KTIME
                        kv = c.first('KeyValueFloat').props[0].astype(float)
                        j = 'XYZ'.index(axis.split('|')[-1])
                        ch[pr][:, j] = np.interp(ts, kt, kv)
        P = euler_xyz_deg_to_m(pre)
        m = np.zeros((nframes, 4, 4))
        for f in range(nframes):
            m[f, :3, :3] = P @ euler_xyz_deg_to_m(ch['Lcl Rotation'][f]) @ np.diag(ch['Lcl Scaling'][f])
            m[f, :3, 3] = ch['Lcl Translation'][f]
            m[f, 3, 3] = 1
        loc[i] = (name, m)
    glob = {}

    def g(i):
        if i not in glob:
            pa = fbx.parent.get(i, 0)
            glob[i] = (g(pa) if pa in loc else np.eye(4)) @ loc[i][1]
        return glob[i]
    return {loc[i][0]: g(i) for i in loc}


def model_globals(fbx):
    """Global rest 4x4 of every Model from the Lcl TRS chain (PreRotation honoured), file units."""
    loc = {}
    for i, name, typ, _ in fbx.models():
        t, r, s, pre, _p = fbx.lcl(i)
        m = np.eye(4)
        m[:3, :3] = euler_xyz_deg_to_m(pre) @ euler_xyz_deg_to_m(r) @ np.diag(s)
        m[:3, 3] = t
        loc[i] = m
    glob = {}

    def g(i):
        if i in glob:
            return glob[i]
        pa = fbx.parent.get(i, 0)
        glob[i] = (g(pa) if pa in loc else np.eye(4)) @ loc[i]
        return glob[i]
    for i in loc:
        g(i)
    return glob
