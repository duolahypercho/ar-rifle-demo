"""Pass R4: read every exported FBX with the plain reader (fbxread.py, no Blender) and check what
Unreal's importer will start from. python3 blender/export_unreal/check_fbx.py -> unreal/review/fbx_check.json

Per file: FBX version, UnitScaleFactor (1 = cm), axis system, frame rate, the Model tree (one
LimbNode root called `root`, no `Armature` bone), bone names / parents against the GLB skeleton
(+ Gun, GunIn); bodies: height in file units (Z up), blend shape channels, embedded textures;
animations: frame count from the take span, root travel from the root's own FBX curves against
the clip notes' `root` track.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

import config
import fbxread as F
import skeleton as S


def tree(f):
    ms = f.models()
    limbs = {name: pa for _i, name, typ, pa in ms if typ == 'LimbNode'}
    roots = [n for n, pa in limbs.items() if pa not in limbs]
    others = [(name, typ, pa) for _i, name, typ, pa in ms if typ != 'LimbNode']
    return limbs, roots, others


def header(f):
    s = f.settings
    g = lambda k: s.get(k, [None])[0]
    return dict(version=f.version, unitScaleFactor=g('UnitScaleFactor'), upAxis=g('UpAxis'), upSign=g('UpAxisSign'),
                frontAxis=g('FrontAxis'), frontSign=g('FrontAxisSign'), coordAxis=g('CoordAxis'),
                coordSign=g('CoordAxisSign'), timeMode=g('TimeMode'), fps=g('CustomFrameRate'))


def curves_of(f, model_name, prop='Lcl Translation'):
    """{axis: (times s, values)} of a model's animated property, straight from the FBX curves."""
    mid = next(i for i, n, _t, _p in f.models() if n == model_name)
    nodes = [ch for kind, ch, pa, pr in f.conn if kind == 'OP' and pa == mid and pr == prop]
    out = {}
    for cn in nodes:
        for kind, ch, pa, pr in f.conn:
            if kind == 'OP' and pa == cn and ch in f.objects and f.objects[ch].name == 'AnimationCurve':
                c = f.objects[ch]
                t = c.first('KeyTime').props[0].astype(float) / F.KTIME
                v = c.first('KeyValueFloat').props[0].astype(float)
                out[pr.split('|')[-1]] = (t, v)
    return out


def check_skeleton(limbs, sk):
    names_ok = sorted(limbs) == sorted(sk.bones)
    par = {n: (None if limbs[n] == 'Armature' else limbs[n]) for n in limbs}
    parents_ok = names_ok and all(par[n] == sk.parent[n] for n in sk.bones)
    return names_ok, parents_ok


def main():
    out = {'bodies': {}, 'animations': {}, 'retarget': {}, 'weapons': {}}
    skels = {}
    for name, key in config.BODIES.items():
        p = os.path.join(config.OUT, 'bodies', f'{name}.fbx')
        f = F.read(p)
        sk = S.Skeleton(key, None if name == config.PACKS[key]['body'] else name)
        limbs, roots, others = tree(f)
        names_ok, parents_ok = check_skeleton(limbs, sk)
        glob = F.model_globals(f)
        zs = []
        for gid, gname, v in f.geometries():
            # the geometry's model (connection Geometry -> Model)
            mid = next(pa for kind, ch, pa, _ in f.conn if kind == 'OO' and ch == gid)
            m = glob[mid]
            w = v @ m[:3, :3].T + m[:3, 3]
            zs.append((w[:, 2].min(), w[:, 2].max(), len(v)))
        out['bodies'][name] = dict(header(f), bytes=os.path.getsize(p), limbNodes=len(limbs), rootBones=roots,
                                   armatureBone='Armature' in limbs, nonBoneModels=others, bonesMatchGlb=names_ok,
                                   parentsMatchGlb=parents_ok, extraBones=sorted(set(limbs) - set(sk.body.joints)),
                                   heightUnits=float(max(z[1] for z in zs) - min(z[0] for z in zs)),
                                   soleZ=float(min(z[0] for z in zs)), vertices=sum(z[2] for z in zs),
                                   blendShapes=len(f.blendshape_channels()),
                                   embedded=[(n, r, b) for n, r, b in f.embedded()])
    for key in config.PACKS:
        sk = skels[key] = S.Skeleton(key)
        notes = sk.notes['clips']
        res = {}
        for clip in sk.pack.names:
            p = os.path.join(config.OUT, 'animations', key, f'{clip}.fbx')
            if not os.path.exists(p):
                res[clip] = {'missing': True}
                continue
            f = F.read(p)
            limbs, roots, others = tree(f)
            names_ok, parents_ok = check_skeleton(limbs, sk)
            stacks = f.anim_stacks()
            stop = stacks[0][1].get('LocalStop', [0])[0] / F.KTIME if stacks else None
            ch = sk.pack.channels(clip)
            keys = len(next(iter(ch.values()))[0])
            h = header(f)
            r = dict(fps=h['fps'], unit=h['unitScaleFactor'], up=h['upAxis'], takes=[s[0] for s in stacks],
                     frames=int(round(stop * h['fps'])) + 1 if stop is not None else None, glbKeys=keys,
                     rootBones=roots, armatureBone='Armature' in limbs, nonBoneModels=[o[0] for o in others],
                     bonesMatch=names_ok, parentsMatch=parents_ok, bytes=os.path.getsize(p))
            if 'root' in notes[clip]:
                cv = curves_of(f, 'root')
                # FBX (Blender axes, cm): glTF (x, 0, z) m -> (100 x, -100 z, 0)
                want = np.array([[x * 100, -z * 100] for x, z, _y in notes[clip]['root']])
                hx = np.interp(np.arange(len(want)) / 30.0, *cv['X']) if 'X' in cv else np.zeros(len(want))
                hy = np.interp(np.arange(len(want)) / 30.0, *cv['Y']) if 'Y' in cv else np.zeros(len(want))
                r['rootTravelCm'] = float(np.hypot(*want[-1]))
                r['rootTravelErrCm'] = float(np.abs(np.c_[hx, hy] - want).max())
            res[clip] = r
        out['animations'][key] = res
    for key in config.PACKS:
        p = os.path.join(config.OUT, 'retarget', f'{key}_apose.fbx')
        if os.path.exists(p):
            f = F.read(p)
            limbs, roots, others = tree(f)
            names_ok, parents_ok = check_skeleton(limbs, skels[key])
            out['retarget'][key] = dict(header(f), rootBones=roots, bonesMatch=names_ok, parentsMatch=parents_ok,
                                        takes=[s[0] for s in f.anim_stacks()])
    for g in config.GUNS:
        p = os.path.join(config.OUT, 'weapons', f'{g}.fbx')
        if os.path.exists(p):
            f = F.read(p)
            vs = np.vstack([v for _i, _n, v in f.geometries()])
            out['weapons'][g] = dict(header(f), models=[(n, t, pa) for _i, n, t, pa in f.models()],
                                     boundsCm=[vs.min(0).round(2).tolist(), vs.max(0).round(2).tolist()],
                                     embedded=len(f.embedded()), bytes=os.path.getsize(p))
    os.makedirs(os.path.join(config.OUT, 'review'), exist_ok=True)
    with open(os.path.join(config.OUT, 'review', 'fbx_check.json'), 'w') as fh:
        json.dump(out, fh, indent=1, default=float)
    return out


if __name__ == '__main__':
    o = main()
    for n, b in o['bodies'].items():
        print(n, {k: b[k] for k in ('unitScaleFactor', 'upAxis', 'rootBones', 'armatureBone', 'bonesMatchGlb',
                                     'parentsMatchGlb', 'heightUnits', 'blendShapes', 'limbNodes')})
    for key, res in o['animations'].items():
        bad = [c for c, r in res.items() if r.get('missing') or r['frames'] != r['glbKeys'] or not r['bonesMatch']
               or not r['parentsMatch'] or r['rootBones'] != ['root'] or r['fps'] != 30 or r['unit'] != 1]
        print(key, len(res), 'clips; bad', bad)
