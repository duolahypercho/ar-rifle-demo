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
import gltfio as G
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
            with np.errstate(all='ignore'):   # (spurious BLAS warnings with this machine's numpy; values checked)
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
    check_vehicles(out, skels)
    out['paths'] = check_paths()
    os.makedirs(os.path.join(config.OUT, 'review'), exist_ok=True)
    with open(os.path.join(config.OUT, 'review', 'fbx_check.json'), 'w') as fh:
        json.dump(out, fh, indent=1, default=float)
    return out


# ------------------------------------------------------------------ pass U1

def take_frames(f, fps):
    stacks = f.anim_stacks()
    stop = stacks[0][1].get('LocalStop', [0])[0] / F.KTIME if stacks else None
    return (int(round(stop * fps)) + 1 if stop is not None else None), [s[0] for s in stacks]


def curve_fk_err(f, nframes, skel, locals_):
    """Every bone, every frame: the FBX's own curves (fbxread.anim_globals) against the truth (glTF locals ->
    Blender axes, cm; world-aligned bones as bl_common.bl_worlds makes them). -> (worst mm, bone, worst deg, bone)"""
    import vehicle as V
    C4 = np.eye(4)
    C4[:3, :3] = V.C3
    wf = getattr(skel, 'world_frame', ('root', 'ik_foot_root', 'ik_hand_root'))
    have = F.anim_globals(f, nframes)
    worst = [0.0, None, 0.0, None]
    for fr in range(nframes):
        for n, w in skel.world(locals_[fr]).items():
            m = C4 @ w @ (C4.T if n in wf else np.eye(4))
            m[:3, 3] *= 100
            h = have[n][fr]
            dp = float(np.linalg.norm(h[:3, 3] - m[:3, 3])) * 10
            r = h[:3, :3] / np.linalg.norm(h[:3, :3], axis=0)
            c = np.clip((np.trace(r.T @ m[:3, :3]) - 1) / 2, -1, 1)
            da = float(np.degrees(np.arccos(c)))
            if dp > worst[0]:
                worst[0], worst[1] = dp, n
            if da > worst[2]:
                worst[2], worst[3] = da, n
    return worst


def check_vehicles(out, skels):
    """Vehicle clip FBX (frames, bones, root track from the FBX's own curves vs the notes' root, every bone every
    frame from the curves), vehicle FBX (bones = GLB nodes, one root bone, parts, bounds, textures) and
    vehicle-side animation FBX (bones, frames, every bone every frame from the curves)."""
    import vehicle as V
    out['vehicleAnimations'] = {}
    for pk, pcfg in config.VEHICLE_PACKS.items():
        sk = S.Skeleton(pcfg['skeleton'], pack=pk)
        res = {}
        for clip in sk.pack.names:
            p = os.path.join(config.OUT, 'animations', pk, f'{clip}.fbx')
            if not os.path.exists(p):
                res[clip] = {'missing': True}
                continue
            f = F.read(p)
            limbs, roots, others = tree(f)
            names_ok, parents_ok = check_skeleton(limbs, sk)
            h = header(f)
            frames, takes = take_frames(f, h['fps'])
            nc = sk.notes['clips'][clip]
            keys = V.pack_keys(sk.pack, clip)
            r = dict(fps=h['fps'], unit=h['unitScaleFactor'], up=h['upAxis'], front=h['frontAxis'], frontSign=h['frontSign'],
                     takes=takes, frames=frames, glbKeys=keys, wantFrames=max(2, keys), rootBones=roots,
                     armatureBone='Armature' in limbs, nonBoneModels=[o[0] for o in others], bonesMatch=names_ok,
                     parentsMatch=parents_ok, bytes=os.path.getsize(p))
            cv = curves_of(f, 'root')
            root = nc['root']
            n = frames or 0
            want = np.array([[x * 100, -z * 100] for x, z, _y in
                             [root[i % len(root)] if nc.get('loop') else root[min(i, len(root) - 1)] for i in range(n)]])
            hx = np.interp(np.arange(n) / 30.0, *cv['X']) if 'X' in cv else np.zeros(n)
            hy = np.interp(np.arange(n) / 30.0, *cv['Y']) if 'Y' in cv else np.zeros(n)
            r['rootStartCm'] = [float(hx[0]), float(hy[0])]
            r['rootTravelCm'] = float(np.hypot(*(want[-1] - want[0])))
            r['rootErrCm'] = float(np.abs(np.c_[hx, hy] - want).max())
            wp, wpb, wd, wdb = curve_fk_err(f, n, sk, sk.clip_locals(clip, min_frames=2))
            r.update(curvesWorstMm=wp, curvesWorstMmBone=wpb, curvesWorstDeg=wd, curvesWorstDegBone=wdb)
            res[clip] = r
        out['vehicleAnimations'][pk] = res
    out['vehicles'] = {}
    for name in config.VEHICLES:
        p = os.path.join(config.OUT, 'vehicles', f'{name}.fbx')
        if not os.path.exists(p):
            continue
        veh = V.Vehicle(name)
        f = F.read(p)
        limbs, roots, others = tree(f)
        par = {n: (None if limbs[n] == 'Armature' else limbs[n]) for n in limbs}
        glob = F.model_globals(f)
        vs = []
        for gid, gname, v in f.geometries():
            mid = next(pa for kind, ch, pa, _ in f.conn if kind == 'OO' and ch == gid)
            m = glob[mid]
            with np.errstate(all='ignore'):   # (spurious BLAS warnings on this machine's numpy; values checked)
                vs.append(v @ m[:3, :3].T + m[:3, 3])
        vs = np.vstack(vs)
        # pivots: every bone's rest from the file's Lcl chain against the GLB node (world-aligned frames, cm)
        C4 = np.eye(4)
        C4[:3, :3] = V.C3
        lglob = {nm: glob[i] for i, nm, typ, _p in f.models() if typ == 'LimbNode'}
        piv_mm, piv_deg = 0.0, 0.0
        for n, w in veh.rest_world().items():
            m = C4 @ w @ C4.T
            m[:3, 3] *= 100
            h = lglob[n]
            piv_mm = max(piv_mm, float(np.linalg.norm(h[:3, 3] - m[:3, 3])) * 10)
            piv_deg = max(piv_deg, float(G.angle_deg(h[:3, :3] / np.linalg.norm(h[:3, :3], axis=0), m[:3, :3])))
        out['vehicles'][name] = dict(header(f), bytes=os.path.getsize(p), limbNodes=len(limbs), rootBones=roots,
                                     pivotsVsGlbMm=piv_mm, pivotsVsGlbDeg=piv_deg,
                                     armatureBone='Armature' in limbs, bonesMatchGlb=sorted(limbs) == sorted(veh.bones),
                                     parentsMatchGlb=all(par.get(n, '?') == veh.parent[n] for n in veh.bones),
                                     meshModels=len([o for o in others if o[1] == 'Mesh']), partsInGlb=len(veh.mesh),
                                     nonBoneModels=sorted(set(o[1] for o in others)),
                                     boundsCm=[vs.min(0).round(2).tolist(), vs.max(0).round(2).tolist()],
                                     vertices=len(vs), embedded=[(n_, r_, b_) for n_, r_, b_ in f.embedded()])
    out['vehicleSideAnimations'] = {}
    d = os.path.join(config.OUT, 'vehicles', 'animations')
    vehs = {v: V.Vehicle(v) for v in config.VEHICLES}
    for group in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        res = {}
        notes = json.load(open(config.VEHICLE_PACKS[group]['notes'])) if group in config.VEHICLE_PACKS else None
        pack = G.ClipPack(config.VEHICLE_PACKS[group]['pack']) if notes else None
        for fn in sorted(os.listdir(os.path.join(d, group))):
            if not fn.endswith('.fbx'):
                continue
            vname = next(v for v in config.VEHICLES if fn.startswith(v + '_'))
            veh = vehs[vname]
            clip = fn[len(vname) + 1:-4]
            f = F.read(os.path.join(d, group, fn))
            limbs, roots, others = tree(f)
            h = header(f)
            frames, takes = take_frames(f, h['fps'])
            if notes is None:
                L = veh.own_clip_locals(clip)
            elif clip == 'fit':
                L = [veh.pose({}, V.fit_of(notes, veh.kind))] * 2
            else:
                nf = max(2, V.pack_keys(pack, clip))
                L = [veh.pose(c, V.fit_of(notes, veh.kind)) for c in V.clip_controls(veh.kind, clip, notes['clips'][clip], nf)]
            wp, wpb, wd, wdb = curve_fk_err(f, min(frames, len(L)), veh, L)
            res[fn[:-4]] = dict(fps=h['fps'], unit=h['unitScaleFactor'], up=h['upAxis'], takes=takes, frames=frames,
                                wantFrames=len(L), rootBones=roots, bonesMatch=sorted(limbs) == sorted(veh.bones),
                                nonBoneModels=[o[0] for o in others], bytes=os.path.getsize(os.path.join(d, group, fn)),
                                curvesWorstMm=wp, curvesWorstMmBone=wpb, curvesWorstDeg=wd, curvesWorstDegBone=wdb)
        out['vehicleSideAnimations'][group] = res


def check_paths():
    """Every FBX under unreal/: the strings that name files (Texture FileName / RelativeFilename, Video Filename /
    RelativeFilename / Path, the SceneInfo's urls); absolute ones listed. Also a byte search for this machine's home
    folder (read at run time, not stored; the result holds only counts)."""
    home = os.path.expanduser('~').encode()
    files, absolute, home_hits, names = 0, [], 0, set()
    for dp, _dn, fns in os.walk(config.OUT):
        for fn in fns:
            if not fn.lower().endswith('.fbx'):
                continue
            p = os.path.join(dp, fn)
            files += 1
            raw = open(p, 'rb').read()
            if home and home in raw:
                home_hits += 1
            f = F.read(p)
            for n in f.objects.values():
                if n.name not in ('Texture', 'Video'):
                    continue
                vals = [k.props[0] for k in n.kids if k.name in ('FileName', 'Filename', 'RelativeFilename') and k.props]
                vals += [v[0] for k, v in F.p70(n).items() if k == 'Path' and v]
                for s in vals:
                    if isinstance(s, str) and s:
                        names.add(s.split('/')[0] if '/' in s else '')
                        if s.startswith('/') or (len(s) > 2 and s[1] == ':'):
                            absolute.append((os.path.relpath(p, config.OUT), s[:3] + '...'))
    return dict(fbxFiles=files, absoluteMediaPaths=len(absolute), absoluteExamples=absolute[:5],
                filesWithHomeFolder=home_hits, mediaFolders=sorted(x for x in names if x))


if __name__ == '__main__':
    o = main()
    for n, b in o['bodies'].items():
        print(n, {k: b[k] for k in ('unitScaleFactor', 'upAxis', 'rootBones', 'armatureBone', 'bonesMatchGlb',
                                     'parentsMatchGlb', 'heightUnits', 'blendShapes', 'limbNodes')})
    for key, res in o['animations'].items():
        bad = [c for c, r in res.items() if r.get('missing') or r['frames'] != r['glbKeys'] or not r['bonesMatch']
               or not r['parentsMatch'] or r['rootBones'] != ['root'] or r['fps'] != 30 or r['unit'] != 1]
        print(key, len(res), 'clips; bad', bad)
