"""Deformation proof for a prepared UE5-named body (pass T1a): the game's clip poses and range-of-motion
poses mapped through R[b], measured (edge strain against the bind mesh, wrist / shoulder / elbow
radius kept) and rendered as clay contact sheets.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
      --python blender/bodies/deform_proof.py -- --src blender/bodies/tripo/source/tripo_main_character.glb \
      --out blender/bodies/tripo/review [--variants fixed,raw] [--no-render]

Variants: 'fixed' = the weights prepare_body writes; 'raw' = as delivered (same frames); 'smooth' =
fixed + shoulder weight smoothing (rejected candidate); 'norepair' = without the shoulder repair
(the clavicle-fixed T-bind baseline).
"""
import argparse
import json
import math
import pathlib
import sys
import warnings

import numpy as np

warnings.filterwarnings('ignore', category=RuntimeWarning)
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import prepare_body as PB  # noqa: E402
import ue5body as U  # noqa: E402
from ue5_rig import ue5  # noqa: E402
from ue5_rig.proof import Mesh  # noqa: E402

ROOT = HERE.parent.parent
CLIPS = ROOT / 'public/characters/rifle-motion-v1.glb'
OLD_BODY = ROOT / 'public/characters/civilian-m-01-player.glb'
D = math.radians
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
CURL = (-1, 0, 0)     # old frames: fingers along -Y, palm +Z; a curl turns -Y towards +Z


def Rot(axis, deg):
    return ue5.axis_angle(axis, D(deg))


CLIP_POSES = [
    ('idle carry', 'rifle-idle', 2.0),
    ('aim level', 'rifle-aim-level', 0.0),
    ('aim up', 'rifle-aim-up', 0.0),
    ('reload mid', 'reload-rifle-tac', 1.15),
    ('swap mid', 'swap-rifle-shotgun', 0.65),
    ('crouch idle', 'rifle-crouch-idle', 1.0),
    ('sprint mid', 'rifle-sprint', 0.43),
    ('walk f', 'rifle-walk-f', 0.5),
]


def thumb_curl(side, degs, C1):
    out = {}
    for k, a in zip((1, 2, 3), degs):
        c = C1[f'thumb_0{k}_{side[0].lower()}']
        out[f'{side}HandThumb{k}'] = c @ Rot(X, a) @ c.T
    return out


def rom_poses(C1):
    fwd = Rot(CURL, 90)
    fist = {}
    for S in ('Left',):
        for F in ('Index', 'Middle', 'Ring', 'Pinky'):
            fist.update({f'{S}Hand{F}1': Rot(CURL, 80), f'{S}Hand{F}2': Rot(CURL, 95), f'{S}Hand{F}3': Rot(CURL, 60)})
        fist.update(thumb_curl(S, (15, 35, 40), C1))
    trig = {'RightHandIndex1': Rot(CURL, 55), 'RightHandIndex2': Rot(CURL, 75), 'RightHandIndex3': Rot(CURL, 45)}
    sp = Rot(X, 15) @ Rot(Y, 40 / 3)
    return [
        ('canonical (arms down)', {}),
        ('arms forward 90', {'LeftArm': fwd, 'RightArm': fwd}),
        ('arms side 90', {'LeftArm': Rot(Z, 90), 'RightArm': Rot(Z, -90)}),
        ('elbow 140', {'LeftArm': Rot(CURL, 30), 'LeftForeArm': Rot(CURL, 140), 'RightArm': Rot(CURL, 30), 'RightForeArm': Rot(CURL, 140)}),
        ('forearm twist +90', {'LeftForeArm': fwd, 'LeftHand': Rot((0, -1, 0), 90), 'RightForeArm': fwd, 'RightHand': Rot((0, -1, 0), -90)}),
        ('forearm twist -90', {'LeftForeArm': fwd, 'LeftHand': Rot((0, -1, 0), -90), 'RightForeArm': fwd, 'RightHand': Rot((0, -1, 0), 90)}),
        ('upper arm twist +-70', {'LeftArm': Rot((0, -1, 0), 70), 'LeftForeArm': fwd, 'RightArm': Rot((0, -1, 0), 70), 'RightForeArm': fwd}),
        ('knee deep', {'LeftUpLeg': Rot(CURL, 100), 'LeftLeg': Rot(X, 140), 'RightUpLeg': Rot(CURL, 30), 'RightLeg': Rot(X, 60)}),
        ('spine bend 45 + twist 40', {'Spine': sp, 'Spine1': sp, 'Spine2': sp}),
        ('fist (left)', fist),
        ('trigger curl alone (right)', trig),
    ]


class Old:
    def __init__(self):
        self.b = ue5.Body(OLD_BODY)

    def world(self, local):
        return U.old_world_from_local(self.b.parent, self.b.order, local)


def regions(p, J, Wt):
    bw = lambda names: p.bone_weight(names, J, Wt)  # noqa: E731
    out = {}
    for s, _ in U.SIDES:
        arm_up = [f'upperarm_{s}', f'upperarm_twist_01_{s}', f'upperarm_twist_02_{s}']
        out[f'shoulder_{s}'] = (bw([f'clavicle_{s}'] + arm_up) > 0.2) & (bw(arm_up) < 0.95) | ((bw([f'clavicle_{s}']) > 0.2))
        out[f'elbow_{s}'] = (bw(arm_up) > 0.1) & (bw([f'lowerarm_{s}', f'lowerarm_twist_02_{s}']) > 0.1)
        fore = [f'lowerarm_{s}', f'lowerarm_twist_02_{s}', f'lowerarm_twist_01_{s}']
        out[f'wrist_{s}'] = (bw(fore) > 0.05) & (bw([f'hand_{s}'] + [f'{f}_metacarpal_{s}' for f in U.FINGERS] + [f'thumb_01_{s}']) > 0.05)
        out[f'hand_{s}'] = bw([f'hand_{s}'] + [f'{f}_0{k}_{s}' for f in list(U.FINGERS) + ['thumb'] for k in (1, 2, 3)] + [f'{f}_metacarpal_{s}' for f in U.FINGERS]) > 0.5
        th = [f'thigh_{s}', f'thigh_twist_01_{s}', f'thigh_twist_02_{s}']
        out[f'hip_{s}'] = (bw(th) > 0.1) & (bw(['pelvis', 'spine_01']) > 0.1)
        out[f'knee_{s}'] = (bw(th) > 0.1) & (bw([f'calf_{s}', f'calf_twist_02_{s}']) > 0.1)
        out[f'foot_{s}'] = bw([f'foot_{s}', f'ball_{s}']) > 0.3
    return out


def radius_kept(p, posed, Pb, Pd, a, b, sel, lo, hi):
    """Skin between t = lo..hi along joint a->b: distance from the a->b axis, posed / bind
    (1 = kept). Returns (min, p5, mean)."""
    A, B = Pb[a], Pb[b]
    d = B - A
    t = ((p.pos - A) @ d) / (d @ d)
    rad0 = np.linalg.norm((p.pos - A) - np.outer(t, d), axis=1)
    m = sel & (t > lo) & (t < hi) & (rad0 > 0.01)
    A2, B2 = Pd[a], Pd[b]
    e = B2 - A2
    q = posed[m] - A2
    tt = (q @ e) / (e @ e)
    rad = np.linalg.norm(q - np.outer(tt, e), axis=1)
    ratio = rad / rad0[m]
    return float(ratio.min()), float(np.percentile(ratio, 5)), float(ratio.mean())


def shoulder_kept(p, posed, Pb, Pd, s, sel):
    """Skin within 9 cm of the shoulder joint: distance to the joint, posed / bind (collapse < 1)."""
    c0, c1 = Pb[f'upperarm_{s}'], Pd[f'upperarm_{s}']
    d0 = np.linalg.norm(p.pos - c0, axis=1)
    m = sel & (d0 < 0.09) & (d0 > 0.02)
    ratio = np.linalg.norm(posed[m] - c1, axis=1) / d0[m]
    return float(ratio.min()), float(np.percentile(ratio, 5)), float(ratio.mean())


def measure(p, mesh, reg, posed, Pb, Pd):
    row = {}
    for k, m in reg.items():
        s = mesh.strain(posed, m)
        if len(s):
            row[k] = dict(mean=round(float(s.mean()), 3), p99=round(float(np.percentile(s, 99)), 3), max=round(float(s.max()), 3))
    for s, _ in U.SIDES:
        fore = p.bone_weight([f'lowerarm_{s}', f'lowerarm_twist_02_{s}', f'lowerarm_twist_01_{s}', f'hand_{s}'])
        row[f'wristRadius_{s}'] = [round(v, 3) for v in radius_kept(p, posed, Pb, Pd, f'lowerarm_{s}', f'hand_{s}', fore > 0.9, 0.7, 1.08)]
        row[f'shoulderRadius_{s}'] = [round(v, 3) for v in shoulder_kept(p, posed, Pb, Pd, s, reg[f'shoulder_{s}'])]
        up = p.bone_weight([f'upperarm_{s}', f'upperarm_twist_01_{s}', f'upperarm_twist_02_{s}'])
        row[f'upperArmRadius_{s}'] = [round(v, 3) for v in radius_kept(p, posed, Pb, Pd, f'upperarm_{s}', f'lowerarm_{s}', up > 0.9, 0.2, 0.8)]
    return row

# ----------------------------------------------------------------------------- Blender


def stage(mesh, size):
    import bpy
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'OBJECT'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    world = bpy.data.worlds.new('w')
    world.color = (0.16, 0.17, 0.19)
    sc.world = world
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    me = bpy.data.meshes.new('clay')
    me.from_pydata([(v[0], -v[2], v[1]) for v in mesh.wrest], [], [tuple(int(i) for i in t) for t in mesh.wtris])
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new('clay', me)
    sc.collection.objects.link(obj)
    obj.color = (0.78, 0.72, 0.66, 1)
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
    td.size = 0.0026
    txt.color = (1.0, 0.85, 0.3, 1)
    return dict(sc=sc, obj=obj, cam=cam, txt=txt, mesh=mesh)


def shot(st, posed, label, target, view, dist, path):
    import bpy
    from mathutils import Vector
    w = posed[st['mesh'].first]
    co = np.column_stack([w[:, 0], -w[:, 2], w[:, 1]]).astype(np.float32).ravel()
    st['obj'].data.vertices.foreach_set('co', co)
    st['obj'].data.update()
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


def tile(grid, out_path, gap=6):
    import bpy
    imgs, h, w = {}, None, None
    for row in grid:
        for p in row:
            if p is None or str(p) in imgs:
                continue
            im = bpy.data.images.load(str(p), check_existing=False)
            a = np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4)
            imgs[str(p)] = a
            h, w = a.shape[:2]
            bpy.data.images.remove(im)
    rows, cols = len(grid), max(len(r) for r in grid)
    H, Wd = rows * h + (rows + 1) * gap, cols * w + (cols + 1) * gap
    sheet = np.zeros((H, Wd, 4), np.float32)
    sheet[..., 3] = 1
    sheet[..., :3] = 0.05
    for r_, row in enumerate(grid):
        for c, p in enumerate(row):
            if p is None:
                continue
            y0 = H - (r_ + 1) * (h + gap)
            x0 = gap + c * (w + gap)
            sheet[y0:y0 + h, x0:x0 + w] = imgs[str(p)]
    img = bpy.data.images.new(pathlib.Path(out_path).stem, Wd, H, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = str(out_path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)

# ----------------------------------------------------------------------------- main


def poses(B, old, C1):
    rig = B['rig']
    out = []
    for label, clip, t in CLIP_POSES:
        local, hips, _ = ue5.clip_frame(CLIPS, clip, t)
        Wo = old.world(local)
        off = None if hips is None else (hips - old.b.P['Hips']) * (rig.P['pelvis'][1] / old.b.P['Hips'][1])
        L, T, Wd, Pd = rig.map_old(Wo, off)
        out.append((label, 'clip', Wd, Pd))
    for label, local in rom_poses(C1):
        Wo = old.world(local)
        L, T, Wd, Pd = rig.map_old(Wo)
        out.append((label, 'rom', Wd, Pd))
    return out


SHOULDER_POSES = ['canonical (arms down)', 'idle carry', 'walk f', 'sprint mid', 'crouch idle', 'reload mid', 'swap mid',
                  'aim level', 'aim up', 'arms forward 90']


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--ref-src', help='the modelled mesh the crease is measured against (default: --src)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--tag', default='')
    ap.add_argument('--reference', default=str(ROOT / 'public/characters/civilian-m-01-player-ue5.glb'))
    ap.add_argument('--variants', default='fixed,raw')
    ap.add_argument('--render', default='fixed')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--full', action='store_true', help='also the full-body, area and ROM sheets')
    ap.add_argument('--size', type=int, default=360)
    a = ap.parse_args(argv)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    panels = out / 'panels'
    panels.mkdir(exist_ok=True)
    tag = a.tag or a.render
    C1, _ = U.canonical_frames()
    old = Old()
    builds = {}
    for v in a.variants.split(','):
        if v in ('fixed', 'raw', 'smooth'):
            builds.setdefault('base', None)
        if v == 'norepair':
            builds['norepair'] = PB.build(a.src, a.reference, shoulder=False)
    B = PB.build(a.src, a.reference)
    builds['base'] = B
    p = B['p']
    ref = PB.Prepared(a.ref_src or a.src)
    stub = type('S', (), {})()
    stub.prims = [dict(pos=p.pos, tris=p.tris)]
    mesh = Mesh(stub)
    import crease as CR
    dih = {k: CR.Dihedral(mesh, ref.pos, m) for k, m in (('back_l', CR.upper_back(ref.pos, ref.P, 'l')), ('back_r', CR.upper_back(ref.pos, ref.P, 'r')),
                                                             ('front', CR.upper_front(ref.pos, ref.P)))}
    variants = {}
    for v in a.variants.split(','):
        if v == 'fixed':
            variants[v] = (B, B['J'], B['Wt'])
        elif v == 'raw':
            variants[v] = (B, B['raw_J'], B['raw_W'])
        elif v == 'smooth':
            variants[v] = (B, *shoulder_smooth(p, B['J'], B['Wt']))
        elif v == 'norepair':
            R_ = builds['norepair']
            variants[v] = (R_, R_['J'], R_['Wt'])
    reg = regions(p, B['J'], B['Wt'])
    Pb = dict(p.P)
    report = {}
    pose_sets = {}
    for vname, (Bv, J, Wt) in variants.items():
        P_list = poses(Bv, old, C1)
        pose_sets[vname] = P_list
        rows = {}
        bind_posed = p.pos
        for label, kind, Wd, Pd in [('bind', 'bind', *Bv['rig'].bind())] + P_list:
            posed = U.skin(p.pos, J, Wt, Bv['rig'].mats(Wd, Pd))
            row = measure(p, mesh, reg, posed, Pb, Pd)
            for k, D_ in dih.items():
                row['crease_' + k] = D_.measure(posed)[0]
            rows[label] = row
        report[vname] = rows
    Bf, Jf, Wf = variants[a.render]
    lab = dict((l_, (Wd, Pd)) for l_, _, Wd, Pd in pose_sets[a.render])
    Wd, Pd = lab['trigger curl alone (right)']
    Wc, Pc = Bf['rig'].canonical()
    pc = U.skin(p.pos, Jf, Wf, Bf['rig'].mats(Wc, Pc))
    pt = U.skin(p.pos, Jf, Wf, Bf['rig'].mats(Wd, Pd))
    dmm = np.linalg.norm(pt - pc, axis=1) * 1000
    fing = {}
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        m = p.bone_weight([f'{f}_0{k}_r' for k in (1, 2, 3)], Jf, Wf) > 0.5
        fing[f] = dict(vertices=int(m.sum()), maxMoveMm=round(float(dmm[m].max()), 1), meanMoveMm=round(float(dmm[m].mean()), 1))
    report['triggerAlone'] = fing
    (out / f'deform_report_{tag}.json').write_text(json.dumps(report, indent=1))
    print('[deform] report written', flush=True)
    if a.no_render:
        return
    st = stage(mesh, a.size)
    posed_all = {}
    for label, kind, Wd, Pd in [('bind', 'bind', *Bf['rig'].bind())] + pose_sets[a.render]:
        posed_all[label] = (U.skin(p.pos, Jf, Wf, Bf['rig'].mats(Wd, Pd)), Wd, Pd)
    slug = lambda s: ''.join(c if c.isalnum() else '_' for c in s)  # noqa: E731
    sheets = [
        ('shoulders_back', lambda Pd: Pd['spine_05'] + np.array([0, 0.06, 0]), (0, 0.2, -1), 0.85),
        ('shoulders_back_close_r', lambda Pd: (Pd['upperarm_r'] + Pd['spine_05']) / 2 + np.array([0, -0.03, 0]), (-0.35, 0.15, -1), 0.5),
        ('shoulders_front', lambda Pd: Pd['spine_05'] + np.array([0, 0.06, 0]), (0, 0.15, 1), 0.85),
        ('armpits', lambda Pd: Pd['upperarm_r'] + np.array([0, -0.08, 0]), (-1, -0.35, 0.25), 0.5),
    ]
    for name, fn, vd, dist in sheets:
        paths = []
        for label in ['bind'] + SHOULDER_POSES:
            posed, Wd, Pd = posed_all[label]
            paths.append(shot(st, posed, f'{tag} | {name} | {label}', fn(Pd), vd, dist, panels / f'{tag}_{name}_{slug(label)}.png'))
        tile([paths[i:i + 4] for i in range(0, len(paths), 4)], out / f'{tag}_{name}.png')
    if a.full:
        full_views = [('front', (0, 0.05, 1)), ('side', (1, 0.05, 0)), ('back', (0, 0.05, -1)), ('3/4', (0.75, 0.25, 0.75))]
        grid = []
        for label in ['bind', 'canonical (arms down)'] + [c[0] for c in CLIP_POSES]:
            posed, Wd, Pd = posed_all[label]
            tgt = np.array([Pd['pelvis'][0], 0.88, Pd['pelvis'][2]])
            grid.append([shot(st, posed, f'{tag} | {label} | {vn}', tgt, vd, 3.3, panels / f'{tag}_full_{slug(label)}_{slug(vn)}.png') for vn, vd in full_views])
        tile(grid[:5], out / f'{tag}_full_1.png')
        tile(grid[5:], out / f'{tag}_full_2.png')
        areas = [
            ('elbows', lambda Pd: Pd['lowerarm_r'], (-1, 0.2, 0.4), 0.4, ['elbow 140']),
            ('wrists', lambda Pd: Pd['hand_r'], (-0.6, 0.2, 1), 0.33, ['forearm twist +90', 'forearm twist -90']),
            ('hands_left', lambda Pd: (Pd['hand_l'] + Pd['middle_02_l']) / 2, (0.4, 0.2, 1), 0.33, ['fist (left)']),
            ('hands_right', lambda Pd: (Pd['hand_r'] + Pd['middle_02_r']) / 2, (-0.4, 0.2, 1), 0.33, ['trigger curl alone (right)']),
            ('hips', lambda Pd: Pd['pelvis'], (0.7, 0.1, 1), 0.8, ['knee deep', 'spine bend 45 + twist 40']),
            ('knees', lambda Pd: Pd['calf_l'], (1, 0.2, 0.5), 0.55, ['knee deep']),
            ('feet', lambda Pd: Pd['foot_l'] + np.array([0, -0.03, 0.06]), (0.8, 0.5, 0.8), 0.45, ['knee deep']),
        ]
        sel = ['canonical (arms down)'] + [c[0] for c in CLIP_POSES]
        for name, fn, vd, dist, extra in areas:
            paths = [shot(st, posed_all[l_][0], f'{tag} | {name} | {l_}', fn(posed_all[l_][2]), vd, dist, panels / f'{tag}_{name}_{slug(l_)}.png')
                     for l_ in ['bind'] + sel + extra]
            tile([paths[i:i + 4] for i in range(0, len(paths), 4)], out / f'{tag}_{name}.png')
        rom = [l_ for l_, k, _, _ in pose_sets[a.render] if k == 'rom']
        paths = [shot(st, posed_all[l_][0], l_, np.array([posed_all[l_][2]['pelvis'][0], 1.0, posed_all[l_][2]['pelvis'][2]]), (0.6, 0.15, 1), 2.8,
                      panels / f'{tag}_rom_{slug(l_)}.png') for l_ in rom]
        tile([paths[i:i + 4] for i in range(0, len(paths), 4)], out / f'{tag}_rom.png')
    print('[deform] renders done', flush=True)


def shoulder_smooth(p, J, Wt, iters=4, amount=0.5):
    """Candidate fix: smooth clavicle / upper arm (shoulder end) / spine_05 / spine_04 weights over the
    shoulder region (vertex totals kept)."""
    out_J, out_W = J, Wt
    for s, _ in U.SIDES:
        bones = [f'clavicle_{s}', f'upperarm_twist_01_{s}', f'upperarm_{s}', f'upperarm_twist_02_{s}', 'spine_05', 'spine_04']
        region = p.bone_weight([f'clavicle_{s}', f'upperarm_twist_01_{s}'], out_J, out_W) > 0.02
        out_J, out_W = PB.smooth_region(p, out_J, out_W, bones, region, iters, amount)
    return out_J, out_W


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
