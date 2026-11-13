"""Elbow / knee / wrist review of a prepared body under plain linear blend skinning (pass F1).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
      --python blender/bodies/joint_review.py -- --out blender/bodies/tripo/review/elbow \
      [--variants before,after] [--no-render] [--size 420]

Variants: 'before' = the weights in --before (default: the shipped body GLB), 'after' = prepare_body's
build with the joint repair (the weights it would write now). Poses:
  rom    elbow flexion 60 / 90 / 120 / 140 (both arms, upper arm 30 forward), knee 90 / 115 (thigh
         60 forward), wrist +-42 (forearm 90), through ue5body.Rig.map_old (twist bones driven)
  clip   the frames of reload-rifle-tac, reload-rifle-empty, swap-rifle-shotgun, swap-shotgun-rifle
         (rifle-motion-tripo-v1) with the most flexed elbow, per arm, played on the body's own nodes
Measures per joint region (crease.py): dihedral change against the bind mesh (max / p99.9 / edges
over 45 / 90 degrees), flipped triangles (geometric normal against the skinned vertex normals, as
three.js shades them) and collapsed triangles (area under 25 % of the bind's).
Renders (Workbench, base-colour texture, the GLB's normals skinned as three.js does): the inner
joint straight on and three-quarter; before / after side by side.
"""
import argparse
import json
import math
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import crease as CR  # noqa: E402
import prepare_body as PB  # noqa: E402
import ue5body as U  # noqa: E402
from rifle_motion import gltfio  # noqa: E402
from ue5_rig import ue5  # noqa: E402
from ue5_rig.proof import Mesh  # noqa: E402

ROOT = HERE.parent.parent
SRC = ROOT / 'blender/bodies/tripo/source/tripo_main_character.glb'
BODY = ROOT / 'blender/bodies/tripo/tripo-player-ue5.glb'
PACK = ROOT / 'public/characters/rifle-motion-tripo-v1.glb'
OLD_BODY = ROOT / 'public/characters/civilian-m-01-player.glb'
CLIPS = ['reload-rifle-tac', 'reload-rifle-empty', 'swap-rifle-shotgun', 'swap-shotgun-rifle']
D = math.radians
X = (1, 0, 0)
CURL = (-1, 0, 0)


def Rot(axis, deg):
    return ue5.axis_angle(axis, D(deg))


def rom_poses():
    out = []
    for a in (60, 90, 120, 140):
        out.append((f'elbow {a}', {'LeftArm': Rot(CURL, 30), 'LeftForeArm': Rot(CURL, a), 'RightArm': Rot(CURL, 30), 'RightForeArm': Rot(CURL, a)}))
    for a in (90, 115):
        out.append((f'knee {a}', {'LeftUpLeg': Rot(CURL, 60), 'LeftLeg': Rot(X, a), 'RightUpLeg': Rot(CURL, 60), 'RightLeg': Rot(X, a)}))
    for a in (42, -42):
        out.append((f'wrist {a:+d}', {'LeftForeArm': Rot(CURL, 90), 'LeftHand': Rot(CURL, a), 'RightForeArm': Rot(CURL, 90), 'RightHand': Rot(CURL, a)}))
    return out


def pack_tracks(path, clips):
    g, b = gltfio.read(path)
    names = [n.get('name') for n in g['nodes']]
    out = {}
    for anim in g['animations']:
        if anim['name'] not in clips:
            continue
        ch = {}
        for c in anim['channels']:
            s = anim['samplers'][c['sampler']]
            ch[names[c['target']['node']], c['target']['path']] = np.array(gltfio.rows(g, b, s['output']), float)
        out[anim['name']] = ch
    return out


def clip_pose(rig, ch, i):
    L, T = {}, {}
    for (j, p), v in ch.items():
        if j not in rig.idx:
            continue
        if p == 'rotation':
            L[j] = ue5.q_to_m(v[i])
        elif p == 'translation':
            T[j] = v[i]
    L['root'], T['root'] = np.eye(3), np.zeros(3)
    for n in rig.order:          # unkeyed rotations stay at the bind (rest) local, as glTF plays them
        if n not in L:
            p = rig.parent[n]
            L[n] = rig.W[n] if p is None else rig.W[p].T @ rig.W[n]
    return rig.fk(L, T)


def flex(Pd, a, b, c):
    u, v = Pd[a] - Pd[b], Pd[c] - Pd[b]
    return 180 - math.degrees(math.acos(np.clip(u @ v / np.linalg.norm(u) / np.linalg.norm(v), -1, 1)))


def skin_pn(pos, nrm, J, Wt, mats):
    M = np.einsum('nk,nkij->nij', Wt, mats[J])
    p = np.einsum('nij,nj->ni', M[:, :3, :3], pos) + M[:, :3, 3]
    n = np.einsum('nij,nj->ni', M[:, :3, :3], nrm)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    return p, n


def joint_region(pos, P, a, b, along=0.07, radius=0.075):
    """Skin near joint b of the chain a -> b (bind): within `along` of b along a->b, `radius` off it."""
    u = P[b] - P[a]
    u = u / np.linalg.norm(u)
    x = (pos - P[b]) @ u
    rad = np.linalg.norm((pos - P[b]) - np.outer(x, u), axis=1)
    return (np.abs(x) < along) & (rad < radius)


REGIONS = {}
for _s in 'lr':
    REGIONS[f'elbow_{_s}'] = (f'upperarm_{_s}', f'lowerarm_{_s}', 0.07, 0.075)
    REGIONS[f'knee_{_s}'] = (f'thigh_{_s}', f'calf_{_s}', 0.08, 0.09)
    REGIONS[f'wrist_{_s}'] = (f'lowerarm_{_s}', f'hand_{_s}', 0.045, 0.06)


class Measure:
    def __init__(self, mesh, pos, P):
        self.mesh = mesh
        self.reg = {k: joint_region(pos, P, *v) for k, v in REGIONS.items()}
        self.dih = {k: CR.Dihedral(mesh, pos, m) for k, m in self.reg.items()}
        self.tri_reg = {k: m[mesh.first][mesh.wtris].all(1) for k, m in self.reg.items()}
        self.area0 = self.areas(pos)

    def areas(self, pos):
        w = pos[self.mesh.first]
        t = self.mesh.wtris
        return np.linalg.norm(np.cross(w[t[:, 1]] - w[t[:, 0]], w[t[:, 2]] - w[t[:, 0]]), axis=1) / 2

    def __call__(self, posed, nrm, keys):
        w, wn = posed[self.mesh.first], nrm[self.mesh.first]
        t = self.mesh.wtris
        gn = np.cross(w[t[:, 1]] - w[t[:, 0]], w[t[:, 2]] - w[t[:, 0]])
        vn = wn[t].sum(1)
        flipped = (gn * vn).sum(1) < 0
        collapsed = self.areas(posed) < 0.25 * self.area0
        e = lambda P, i, j: np.linalg.norm(P[t[:, i]] - P[t[:, j]], axis=1)  # noqa: E731
        w0 = self.mesh.wrest
        stretch = np.max([e(w, i, j) / np.maximum(e(w0, i, j), 1e-9) for i, j in ((0, 1), (1, 2), (2, 0))], axis=0)
        spikes = stretch > 2.0
        out = {}
        for k in keys:
            m, _ = self.dih[k].measure(posed)
            m['flipped'] = int((flipped & self.tri_reg[k]).sum())
            m['collapsed'] = int((collapsed & self.tri_reg[k]).sum())
            m['spikes'] = int((spikes & self.tri_reg[k]).sum())
            m['maxStretch'] = round(float(stretch[self.tri_reg[k]].max()), 2)
            out[k] = m
        return out


def worst_vertex_rest(p, J0, W0, J1, W1, rig):
    """Largest displacement between two weight sets at rest (bind) and in the canonical pose."""
    out = {}
    for name, (Wd, Pd) in (('bind', rig.bind()), ('canonical', rig.canonical())):
        m = rig.mats(Wd, Pd)
        a = U.skin(p.pos, J0, W0, m)
        b = U.skin(p.pos, J1, W1, m)
        out[name + 'Mm'] = float(np.linalg.norm(a - b, axis=1).max() * 1000)
    return out

# ----------------------------------------------------------------------------- Blender


def stage(p, tex_path, size):
    import bpy
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_cavity = False
    sh.show_specular_highlight = True
    world = bpy.data.worlds.new('w')
    world.color = (0.16, 0.17, 0.19)
    sc.world = world
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    me = bpy.data.meshes.new('body')
    me.from_pydata([(v[0], -v[2], v[1]) for v in p.pos], [], [tuple(int(i) for i in t) for t in p.tris])
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    uv = PB.ue5.accessor(p.src.gltf, p.src.binary, p.src.prim['attributes']['TEXCOORD_0'])
    lay = me.uv_layers.new(name='uv')
    loops = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', loops)
    lay.data.foreach_set('uv', np.column_stack([uv[loops, 0], 1 - uv[loops, 1]]).astype(np.float32).ravel())
    mat = bpy.data.materials.new('m')
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(tex_path))
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes.active = tex
    me.materials.append(mat)
    obj = bpy.data.objects.new('body', me)
    sc.collection.objects.link(obj)
    cd = bpy.data.cameras.new('cam')
    cd.lens = 50
    cd.clip_start = 0.01
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    td = bpy.data.curves.new('label', 'FONT')
    txt = bpy.data.objects.new('label', td)
    sc.collection.objects.link(txt)
    txt.parent = cam
    txt.location = (-0.0345, 0.0315, -0.1)
    td.size = 0.0024
    txt.color = (1.0, 0.85, 0.3, 1)
    lm = bpy.data.materials.new('lab')
    lm.diffuse_color = (1.0, 0.85, 0.3, 1)
    td.materials.append(lm)
    return dict(sc=sc, obj=obj, cam=cam, txt=txt, loops=loops)


def shot(st, posed, nrm, label, target, view, dist, path):
    import bpy
    from mathutils import Vector
    me = st['obj'].data
    me.vertices.foreach_set('co', np.column_stack([posed[:, 0], -posed[:, 2], posed[:, 1]]).astype(np.float32).ravel())
    me.update()
    nb = np.column_stack([nrm[:, 0], -nrm[:, 2], nrm[:, 1]])
    me.normals_split_custom_set_from_vertices([tuple(v) for v in nb])
    g2b = lambda v: Vector((v[0], -v[2], v[1]))  # noqa: E731
    tgt = g2b(target)
    dv = np.asarray(view, float)
    dv /= np.linalg.norm(dv)
    st['cam'].location = tgt + g2b(dv) * dist
    st['cam'].rotation_mode = 'QUATERNION'
    st['cam'].rotation_quaternion = (tgt - st['cam'].location).to_track_quat('-Z', 'Y')
    st['txt'].data.body = label
    st['sc'].render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return path


def inner_view(Pd, a, b, c, side_deg=0.0):
    """Looking at the inside of the bend at joint b (chain a-b-c) from outside the body: the bisector
    of the two segments (into the bend) turned side_deg towards the hinge axis's outer end (away from
    the body's midline), so the trunk never blocks the view."""
    u = Pd[a] - Pd[b]
    v = Pd[c] - Pd[b]
    u, v = u / np.linalg.norm(u), v / np.linalg.norm(v)
    bis = u + v
    bis = bis / np.linalg.norm(bis) if np.linalg.norm(bis) > 1e-3 else np.cross(u, (0, 1, 0))
    h = np.cross(u, v)
    h = h / np.linalg.norm(h) if np.linalg.norm(h) > 1e-4 else np.cross(bis, u)
    mid = (Pd['pelvis'] + Pd['spine_05']) / 2
    out_ = Pd[b] - mid
    out_[1] = 0
    if h @ out_ < 0:
        h = -h
    k = math.radians(side_deg)
    return math.cos(k) * bis + math.sin(k) * h


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--before', default=str(BODY))
    ap.add_argument('--variants', default='before,after')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--size', type=int, default=420)
    ap.add_argument('--width', type=float)
    ap.add_argument('--tex', help='base colour image file (default: extracted from the source GLB)')
    a = ap.parse_args(argv)
    out = pathlib.Path(a.out)
    (out / 'panels').mkdir(parents=True, exist_ok=True)
    B = PB.build(SRC, ROOT / 'public/characters/civilian-m-01-player-ue5.glb', joint_width=a.width)
    p, rig = B['p'], B['rig']
    nb = U.Body(a.before)
    W = {}
    if 'before' in a.variants:
        W['before'] = (nb.J.astype(np.int64), nb.Wt)
    if 'after' in a.variants:
        W['after'] = (B['J'], B['Wt'])
    mesh = Mesh(type('S', (), {'prims': [dict(pos=p.pos, tris=p.tris)]})())
    M = Measure(mesh, p.pos, p.P)
    old = ue5.Body(OLD_BODY)
    poses = []
    for label, local in rom_poses():
        Wo = U.old_world_from_local(old.parent, old.order, local)
        _, _, Wd, Pd = rig.map_old(Wo)
        poses.append((label, 'rom', Wd, Pd))
    tracks = pack_tracks(PACK, CLIPS)
    flexlog = {}
    for clip in CLIPS:
        ch = tracks[clip]
        n = len(next(iter(ch.values())))
        fl = {s: [] for s in 'lr'}
        for i in range(n):
            Wd, Pd = clip_pose(rig, ch, i)
            for s in 'lr':
                fl[s].append(flex(Pd, f'upperarm_{s}', f'lowerarm_{s}', f'hand_{s}'))
        flexlog[clip] = {s: [round(v, 1) for v in fl[s]] for s in 'lr'}
        for s in 'lr':
            i = int(np.argmax(fl[s]))
            Wd, Pd = clip_pose(rig, ch, i)
            poses.append((f'{clip} f{i} elbow_{s} {fl[s][i]:.0f}', 'clip_' + s, Wd, Pd))
    rep = dict(note='crease per joint region; dihedral change vs bind (deg), flipped / collapsed triangles', poses={}, elbowFlexByFrame=flexlog)
    if 'before' in W and 'after' in W:
        rep['restDisplacement'] = worst_vertex_rest(p, *W['before'], *W['after'], rig)
        print('[joint_review] rest displacement', rep['restDisplacement'], flush=True)
    posed = {}
    for label, kind, Wd, Pd in poses:
        if kind.startswith('clip'):
            keys = [f'elbow_{kind[-1]}', f'wrist_{kind[-1]}']
        elif label.startswith('knee'):
            keys = ['knee_l', 'knee_r']
        elif label.startswith('wrist'):
            keys = ['wrist_l', 'wrist_r', 'elbow_l', 'elbow_r']
        else:
            keys = ['elbow_l', 'elbow_r']
        rep['poses'][label] = {}
        for v, (J, Wt) in W.items():
            ps, ns = skin_pn(p.pos, p.nrm, J, Wt, rig.mats(Wd, Pd))
            posed[label, v] = (ps, ns, Pd)
            rep['poses'][label][v] = M(ps, ns, keys)
        print('[joint_review]', label, json.dumps(rep['poses'][label]), flush=True)
    (out / 'joint_report.json').write_text(json.dumps(rep, indent=1))
    if a.no_render:
        return
    tex = a.tex
    if not tex:
        g, b = p.src.gltf, p.src.binary
        mat = g['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
        im = g['images'][g['textures'][mat]['source']]
        vw = g['bufferViews'][im['bufferView']]
        tex = out / 'panels' / '_basecolor.jpg'
        tex.write_bytes(bytes(b[vw.get('byteOffset', 0): vw.get('byteOffset', 0) + vw['byteLength']]))
    st = stage(p, tex, a.size)
    slug = lambda s: ''.join(c if c.isalnum() else '_' for c in s.replace('+', 'p').replace('-', 'm'))  # noqa: E731
    shots = []     # (name, label, [(variant, view) panel paths])
    for label, kind, Wd, Pd in poses:
        if kind.startswith('clip'):
            joints = [('elbow', kind[-1])]
        elif label.startswith('elbow'):
            joints = [('elbow', 'l'), ('elbow', 'r')]
        elif label.startswith('knee'):
            joints = [('knee', 'l'), ('knee', 'r')]
        else:
            joints = [('wrist', 'l'), ('wrist', 'r')]
        for jn, s in joints:
            chain = {'elbow': ('upperarm', 'lowerarm', 'hand'), 'knee': ('thigh', 'calf', 'foot'), 'wrist': ('lowerarm', 'hand', 'middle_01')}[jn]
            a_, b_, c_ = (f'{x}_{s}' for x in chain)
            dist = {'elbow': 0.34, 'knee': 0.5, 'wrist': 0.3}[jn]
            row = []
            for side in (50, 75):
                for v in W:
                    ps, ns, Pd_ = posed[label, v]
                    view = inner_view(Pd_, a_, b_, c_, side)
                    tgt = Pd_[b_]
                    path = out / 'panels' / f'{slug(label)}_{jn}_{s}_{v}_{side:+d}.png'
                    row.append(shot(st, ps, ns, f'{v} | {label} | {jn}_{s} | view {side:+d}', tgt, view, dist, path))
            shots.append((f'{jn}_{s}', label, row))
    from deform_proof import tile
    for jn in ('elbow_l', 'elbow_r', 'knee_l', 'knee_r', 'wrist_l', 'wrist_r'):
        grid = [row for j, _, row in shots if j == jn]
        if grid:
            tile(grid, out / f'sheet_{jn}.png')
    print('[joint_review] renders done', flush=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    with np.errstate(all='ignore'):
        main(argv)
