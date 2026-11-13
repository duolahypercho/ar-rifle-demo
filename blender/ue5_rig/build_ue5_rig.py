"""Re-rigs the bodies onto the UE5 Mannequin-style skeleton (pass R1) and proves it.

  python3 blender/tools/bl.py run blender/ue5_rig/build_ue5_rig.py

Works in its own scenes (`ue5_rig`, `ue5_review`) of this project's Blender (port 9877) and never
touches the clip pipeline's scene; saves only its own data blocks to blender/ue5_rig/ue5_rig.blend.

Writes, next to the old bodies (which are left as they are):
  public/characters/<body>-ue5.glb       new skeleton, skin and weights; mesh bytes unchanged
  blender/ue5_rig/ue5_mapping.json       old joint -> new bone(s), rules, rest frames, A-pose
  blender/review/rig/report.txt          the numbers below; *.png contact sheets

STAGES picks what runs (default all): 'write' (every body), 'equiv', 'rom', 'eyes', 'apose',
'blend' (Blender armature, deform cross-check, .blend). Set BODIES to limit the bodies.
"""
import importlib
import json
import math
import pathlib
import sys
import time

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
ROOT = BLENDER_DIR.parent
sys.path.insert(0, str(BLENDER_DIR))
from ue5_rig import proof, ue5  # noqa: E402

importlib.reload(ue5)
importlib.reload(proof)

ALL_BODIES = ['civilian-m-01-player', 'civilian-police-m-hero', 'civilian-f-02-hero', 'civilian-m-03-hero']
BODIES = globals().get('BODIES', ALL_BODIES)
STAGES = globals().get('STAGES', ['write', 'equiv', 'rom', 'eyes', 'apose', 'blend'])
CHAR = ROOT / 'public/characters'
OUT = BLENDER_DIR / 'review/rig'
OUT.mkdir(parents=True, exist_ok=True)
PANELS = OUT / 'panels'
PANELS.mkdir(exist_ok=True)
log_lines = []


def log(*a):
    s = ' '.join(str(x) for x in a)
    log_lines.append(s)
    print(s)


def body_paths(name):
    return CHAR / f'{name}.glb', CHAR / f'{name}-ue5.glb'


t0 = time.time()
PLAYER = ALL_BODIES[0]
results = {}

# ------------------------------------------------------------------------------------ write
skels = {}
for name in BODIES:
    src, dst = body_paths(name)
    body = ue5.Body(src)
    skel = ue5.build(body)
    J, W, st = ue5.weights(body, skel)
    skels[name] = (body, skel)
    if 'write' in STAGES:
        eyes = {x: dict(centre=[round(float(v), 5) for v in e['centre']], radius=round(e['radius'], 4)) for x, e in skel.eye_fit.items()}
        ue5.write_glb(body, skel, [(J, W)], dst, extras=dict(restPose='I', eyes=eyes, mapping='blender/ue5_rig/ue5_mapping.json'))
    nb = ue5.NewBody(dst, skel)
    # the exact mapping (twist bones off) must give the old deformation everywhere
    worst = 0.0
    for label, clip, t in proof.POSES[:4]:
        local, hips, _ = ue5.clip_frame(ROOT / proof.CLIPS, clip, t)
        old, _, _ = proof.old_posed(body, local, hips)
        L, T = ue5.map_pose(body, skel, local, hips, twist=False)
        new, _, _ = proof.new_posed(skel, nb, L, T)
        worst = max(worst, float(np.linalg.norm(new - old, axis=1).max()))
    e = skel.eye_fit
    log(f'{name}: {len(skel.order)} bones, {len(body.prims[0]["pos"])} vertices; rest error {nb.rest_error:.2e}; '
        f'mesh bytes same: {np.array_equal(nb.pos, body.prims[0]["pos"])}; weights folded {st["folded"]} dropped {st["dropped"]}; '
        f'exact-mapping deviation over 4 poses {worst * 1000:.4f} mm; eye centres L {np.round(e["l"]["centre"], 4)} '
        f'R {np.round(e["r"]["centre"], 4)} r {e["l"]["radius"]:.4f}/{e["r"]["radius"]:.4f} (old joints {np.round(e["l"]["joint"], 3)})')
    results.setdefault('bodies', {})[name] = dict(bones=len(skel.order), rest_error=nb.rest_error, folded=st['folded'],
                                                  dropped=st['dropped'], exact_mm=worst * 1000, file=str(dst.relative_to(ROOT)),
                                                  bytes=dst.stat().st_size)

body, skel = skels.get(PLAYER) or (lambda b: (b, ue5.build(b)))(ue5.Body(body_paths(PLAYER)[0]))
nb = ue5.NewBody(body_paths(PLAYER)[1], skel)
mesh = proof.Mesh(body)

# mapping file
table = ue5.mapping_table(skel)
table['twistBones'] = {k: dict(parent=v[0], at=v[1], share=v[2], measure=v[3], source=v[4]) for k, v in ue5.TWIST.items()}
L_a, T_a = ue5.map_pose(body, skel, proof.apose_old(), None, twist=True)
table['retargetPoses'] = {'ue5_apose': {
    'note': 'UE5 Mannequin-like A-pose as local rotations on this skeleton (bind stays I-pose): arms 45 deg below '
            'horizontal, elbows 15, palms down and in (upper arm 40 in, hand 50 in, twist bones their shares), legs 4 apart',
    'local': {n: [round(float(v), 7) for v in ue5.m_to_q(L_a[n])] for n in skel.order
              if np.abs(L_a[n] - skel.local_rest(n)[0]).max() > 1e-7}}}
table['frames'] = ('Bones run along local +Y; Z points to the side the child swings into on flexion; X = Y x Z. '
                   'Flexion is +X for spine, neck, head, elbows, knees, fingers, thumb, wrist (palm-ward), ankle (toes up), '
                   'ball (toes up), jaw (open); eyes: +X looks up. Mirrored sides: X same world direction, Y and Z reflected.')
(HERE / 'ue5_mapping.json').write_text(json.dumps(table, indent=1) + '\n')

# ------------------------------------------------------------------------------------ equivalence
if 'equiv' in STAGES:
    names = proof.piece_names(body, skel, nb, mesh)
    big = sorted(names, key=lambda k: -names[k]['n'])
    log('\nPieces of the one skinned mesh (connected parts, welded): ', len(names))
    for k in big[:14]:
        log(f'  piece {k}: {names[k]["n"]} verts, rides {names[k]["joint"]}, y {names[k]["y"]}, x {names[k]["x"]}')
    rows = proof.equivalence(body, skel, nb, mesh, ROOT)
    log('\nEquivalence (mm; old body posed by the clip vs new body posed by the mapping):')
    log('  pose                 | exact map max / p99 | twist on: other verts max / p99 (where) | twist-weighted verts max / p99 / mean (where)')
    for r in rows:
        on = r['on']
        log(f'  {r["label"]:20s} | {r["off"]["max"]:.4f} / {r["off"]["p99"]:.4f} | {on["rest_max"]:.3f} / {on["rest_p99"]:.4f} ({on["rest_where"]}) '
            f'| {on["tw_max"]:.1f} / {on["tw_p99"]:.1f} / {on["tw_mean"]:.1f} ({on["tw_where"]})')
    log('  per piece, twist on, max mm (pieces over 100 verts): ')
    for r in rows:
        log('   ' + r['label'] + ': ' + ', '.join(f'{k}:{r["pieces"][k][1]:.1f}' for k in big if names[k]['n'] >= 100))
    results['equivalence'] = rows

# ------------------------------------------------------------------------------------ range of motion
if 'rom' in STAGES:
    stage = proof.Stage('ue5_review', mesh, size=440)
    tm = proof.twist_mask(skel, nb)
    log('\nRange of motion (left side; old vs new with the twist bones; metrics):')

    def rom_rows(poses, prefix, three):
        grid = []
        for label, old_local, overrides, (targets, view, dist) in poses:
            old, Wo, Po = proof.old_posed(body, old_local)
            L, T = ue5.map_pose(body, skel, old_local, None, twist=True)
            new, Wn, Pn = proof.new_posed(skel, nb, L, T)
            target = np.mean([Po[t] for t in targets], axis=0)
            slug = label.replace(' ', '_').replace('+', 'p').replace('(', '').replace(')', '')
            row = []
            stage.show(old, f'OLD  {label}', target, view, dist)
            row.append(stage.render(PANELS / f'{prefix}_{slug}_old.png'))
            stage.show(new, f'NEW  {label}', target, view, dist)
            row.append(stage.render(PANELS / f'{prefix}_{slug}_new.png'))
            d = np.linalg.norm(new - old, axis=1) * 1000
            msg = f'  {label:26s} old->new max {d.max():.1f} mm (twist-weighted {d[tm].max():.1f}, other {d[~tm].max():.2f})'
            if overrides:
                Ld = proof.apply_overrides(skel, ue5.map_pose(body, skel, {}, None)[0], overrides)
                dist_ = proof.new_posed(skel, nb, Ld)[0]
                stage.show(dist_, f'NEW spread  {label}', target, view, dist)
                row.append(stage.render(PANELS / f'{prefix}_{slug}_spread.png'))
                s_old = mesh.strain(old)
                s_new = mesh.strain(dist_)
                msg += f'; strain p99 old {np.percentile(s_old, 99):.3f} spread {np.percentile(s_new, 99):.3f}, max {s_old.max():.3f} / {s_new.max():.3f}'
            elif three:
                row.append(None)
            if 'forearm' in label:
                po = proof.forearm_pinch(body, old, None, Po)
                pn = proof.forearm_pinch(body, new, None, Po)
                msg += f'; wrist radius kept min/p5/mean old {po[0]:.2f}/{po[1]:.2f}/{po[2]:.2f} new {pn[0]:.2f}/{pn[1]:.2f}/{pn[2]:.2f}'
            if 'twist' in label or 'forearm' in label or 'arm' in label:
                region = np.zeros(len(mesh.pos), bool)
                p = body.prims[0]
                ks = [body.joints.index(j) for j in ('LeftArm', 'LeftForeArm', 'LeftHand', 'LeftShoulder')]
                region = np.isin(p['joints'], ks).any(1)
                so, sn = mesh.strain(old, region), mesh.strain(new, region)
                msg += f'; arm edge strain p95/p99/max old {np.percentile(so, 95):.3f}/{np.percentile(so, 99):.3f}/{so.max():.2f} new {np.percentile(sn, 95):.3f}/{np.percentile(sn, 99):.3f}/{sn.max():.2f}'
            log(msg)
            grid.append(row)
        return grid
    g1 = rom_rows(proof.rom_poses(), 'arm', False)
    proof.tile(g1[:5], OUT / 'rom_arm_twist.png')
    proof.tile(g1[5:], OUT / 'rom_arm_bend.png')
    g2 = rom_rows(proof.trunk_poses(), 'trunk', True)
    proof.tile(g2, OUT / 'rom_trunk_legs.png')
    # the same, the right side, forearm twist only (mirror check)
    for sign in (1, -1):
        old_local = {'RightForeArm': proof.R((-1, 0, 0), 90), 'RightHand': proof.R((0, -1, 0), 90 * sign)}
        old, Wo, Po = proof.old_posed(body, old_local)
        L, T = ue5.map_pose(body, skel, old_local, None, twist=True)
        new, _, _ = proof.new_posed(skel, nb, L, T)
        po = proof.forearm_pinch(body, old, None, Po, 'Right')
        pn = proof.forearm_pinch(body, new, None, Po, 'Right')
        log(f'  right forearm twist {90 * sign:+d}: wrist radius kept min/p5/mean old {po[0]:.2f}/{po[1]:.2f}/{po[2]:.2f} new {pn[0]:.2f}/{pn[1]:.2f}/{pn[2]:.2f}')
    # forearm pinch in the clip poses (the real candy wrapper)
    for label, clip, t in proof.POSES:
        local, hips, _ = ue5.clip_frame(ROOT / proof.CLIPS, clip, t)
        old, Wo, Po = proof.old_posed(body, local, hips)
        L, T = ue5.map_pose(body, skel, local, hips, twist=True)
        new, _, _ = proof.new_posed(skel, nb, L, T)
        out = []
        for side in ('Left', 'Right'):
            po = proof.forearm_pinch(body, old, None, Po, side)
            pn = proof.forearm_pinch(body, new, None, Po, side)
            out.append(f'{side} {po[0]:.2f}/{po[2]:.2f} -> {pn[0]:.2f}/{pn[2]:.2f}')
        log(f'  wrist radius kept (min/mean) {label:18s}: ' + '; '.join(out))
    # edge strain against the modelled mesh, old against new (twist bones driven), in clip poses
    log('  edge strain (mean / p99) in clip poses, old -> new:')
    p = body.prims[0]

    def region(joints, ymin=-9.0):
        ks = [body.joints.index(j) for j in joints]
        return (np.where(np.isin(p['joints'], ks), p['weights'], 0).sum(1) > 0.05) & (p['pos'][:, 1] > ymin)
    regions = [(f'{n}_{x}', region(js, y)) for n, js_l, js_r, y in
               (('shoulder', ['LeftArm', 'LeftShoulder'], ['RightArm', 'RightShoulder'], 1.15),
                ('forearm', ['LeftForeArm', 'LeftHand'], ['RightForeArm', 'RightHand'], -9.0),
                ('hip', ['LeftUpLeg'], ['RightUpLeg'], 0.6))
               for x, js in (('l', js_l), ('r', js_r))]
    for label, clip, t in proof.POSES + [('pivot l180 mid', 'rifle-pivot-l180', 0.6), ('pivot r180 mid', 'rifle-pivot-r180', 0.6)]:
        local, hips, _ = ue5.clip_frame(ROOT / proof.CLIPS, clip, t)
        old, _, _ = proof.old_posed(body, local, hips)
        L, T = ue5.map_pose(body, skel, local, hips, twist=True)
        new, _, _ = proof.new_posed(skel, nb, L, T)
        cells = []
        for name, reg in regions:
            so, sn = mesh.strain(old, reg), mesh.strain(new, reg)
            cells.append(f'{name} {so.mean():.3f}/{np.percentile(so, 99):.2f}->{sn.mean():.3f}/{np.percentile(sn, 99):.2f}')
        log(f'   {label:17s} ' + ' | '.join(cells))
    # the right (firing) forearm in clip poses, old against new: where the twist bones matter in the game
    grid = []
    for label, clip, t in (proof.POSES[0], proof.POSES[1], proof.POSES[3], proof.POSES[6]):
        local, hips, _ = ue5.clip_frame(ROOT / proof.CLIPS, clip, t)
        old, Wo, Po = proof.old_posed(body, local, hips)
        L, T = ue5.map_pose(body, skel, local, hips, twist=True)
        new, _, _ = proof.new_posed(skel, nb, L, T)
        Lh0, _ = skel.local_rest('hand_r')
        tw = math.degrees(ue5.twist_angle(L['hand_r'] @ Lh0.T))
        target = (Po['RightForeArm'] + 2 * Po['RightHand']) / 3
        side = Wo['Hips'] @ np.array([-1.0, 0.45, 0.35])
        row = []
        for tag, posed in (('OLD', old), ('NEW', new)):
            stage.show(posed, f'{tag}  right forearm, {label} (hand twist {tw:.0f})', target, side, 0.5)
            row.append(stage.render(PANELS / f'clipfore_{label.replace(" ", "_")}_{tag}.png'))
        grid.append(row)
    proof.tile(grid, OUT / 'rom_clip_forearms.png')

# ------------------------------------------------------------------------------------ eyes
if 'eyes' in STAGES:
    log('\nEyes (ball centre = sphere fit of the vertices skinned wholly to the eye; displacement in mm):')
    p = body.prims[0]
    face = None
    for x, side in (('l', 'Left'), ('r', 'Right')):
        idx = body.solely(side + 'Eye')
        c0, _, _ = ue5.sphere_fit(p['pos'][idx])
        m0 = p['pos'][idx].mean(0)
        worst_new = worst_old = worst_cent = 0.0
        for axis_new, axis_old in (((0, 0, 1), (0, 1, 0)), ((1, 0, 0), (-1, 0, 0))):   # yaw: eye Z = up; pitch: eye X
            for deg in (25, -25):
                L0, _ = skel.local_rest(f'eye_{x}')
                L = ue5.map_pose(body, skel, {}, None)[0]
                L[f'eye_{x}'] = L0 @ proof.R(axis_new, deg)
                new = proof.new_posed(skel, nb, L)[0]
                c, _, _ = ue5.sphere_fit(new[idx])
                worst_new = max(worst_new, np.linalg.norm(c - c0) * 1000)
                worst_cent = max(worst_cent, np.linalg.norm(new[idx].mean(0) - m0) * 1000)
                old = proof.old_posed(body, {side + 'Eye': proof.R(axis_old, deg)})[0]
                c, _, _ = ue5.sphere_fit(old[idx])
                worst_old = max(worst_old, np.linalg.norm(c - c0) * 1000)
        log(f'  eye_{x}: +-25 deg yaw and pitch: ball centre moves new {worst_new:.3f} mm (vertex centroid {worst_cent:.2f}; '
            f'the cornea sits in front of the ball centre), old joint {worst_old:.1f} mm')
    stage = proof.Stage('ue5_review', mesh, size=440)
    head = body.P['Head'] + np.array([0, 0.11, 0.06])
    panels = []
    for deg in (25, -25):
        old_local = {'LeftEye': proof.R(proof.Y, deg), 'RightEye': proof.R(proof.Y, deg)}
        old = proof.old_posed(body, old_local)[0]
        L = ue5.map_pose(body, skel, {}, None)[0]
        for x in 'lr':
            L[f'eye_{x}'] = skel.local_rest(f'eye_{x}')[0] @ proof.R(proof.Z, deg)
        new = proof.new_posed(skel, nb, L)[0]
        row = []
        stage.show(old, f'OLD eyes {deg:+d} yaw', head, (0.15, 0.05, 1), 0.3)
        row.append(stage.render(PANELS / f'eyes_{deg}_old.png'))
        stage.show(new, f'NEW eyes {deg:+d} yaw', head, (0.15, 0.05, 1), 0.3)
        row.append(stage.render(PANELS / f'eyes_{deg}_new.png'))
        panels.append(row)
    proof.tile(panels, OUT / 'eyes.png')

# ------------------------------------------------------------------------------------ A-pose
if 'apose' in STAGES:
    log('\nA-pose bind test (same skeleton and weights, bound in the A-pose; edge strain against the modelled mesh):')
    p = body.prims[0]
    a_old = proof.apose_old()
    L_a, T_a = ue5.map_pose(body, skel, a_old, None, twist=True)
    reb = proof.Rebound(skel, nb, L_a, T_a)
    # morph targets on arm vertices (an A-pose bind would have to re-express them)
    arm_idx = np.isin(p['joints'], [body.joints.index(j) for j in body.joints if 'Arm' in j or 'Hand' in j or 'Shoulder' in j]).any(1)
    log(f'  morph target deltas on arm/shoulder vertices: max {max(np.abs(t[arm_idx]).max() for t in p["targets"]) * 1000:.3f} mm')
    region = {}
    for side, x in (('Left', 'l'), ('Right', 'r')):
        names_ = [f'clavicle_{x}', f'upperarm_{x}', f'upperarm_twist_01_{x}', f'upperarm_twist_02_{x}', 'spine_05', 'spine_04']
        ks = [skel.order.index(n) for n in names_]
        m = (np.where(np.isin(nb.J, ks), nb.W, 0).sum(1) > 0.05) & (p['pos'][:, 1] > 1.12) & (p['pos'][:, 0] * (1 if x == 'l' else -1) > 0.03)
        region[x] = m
    tests = [('I rest (arms down)', None), ('A-pose', (L_a, T_a))]
    for label, clip, t in (proof.POSES[1], proof.POSES[0], proof.POSES[6]):
        local, hips, _ = ue5.clip_frame(ROOT / proof.CLIPS, clip, t)
        tests.append((label, ue5.map_pose(body, skel, local, hips, twist=True)))
    tests.append(('arms side 90 (T)', ue5.map_pose(body, skel, {'LeftArm': proof.R(proof.Z, 90), 'RightArm': proof.R(proof.Z, -90)}, None, twist=True)))
    tests.append(('arms forward 90', ue5.map_pose(body, skel, {'LeftArm': proof.R((-1, 0, 0), 90), 'RightArm': proof.R((-1, 0, 0), 90)}, None, twist=True)))
    stage = proof.Stage('ue5_review', mesh, size=400)
    sheets = []
    apose_stats = []
    for label, pose in tests:
        if pose is None:
            Wt = {n: skel.bones[n]['R'] for n in skel.order}
            Pt = {n: skel.bones[n]['head'] for n in skel.order}
        else:
            Wt, Pt = ue5.fk(skel, pose[0], pose[1])
        mats = ue5.new_skin_mats(skel, Wt, Pt, nb.ibm)
        vi = ue5.skin(nb.pos, nb.J, nb.W, mats)
        va = reb.posed(skel, nb, Wt, Pt)
        msg = f'  {label:20s}'
        for x in 'lr':
            si, sa = mesh.strain(vi, region[x]), mesh.strain(va, region[x])
            apose_stats.append((label, x, float(np.mean(si)), float(np.mean(sa)), float(np.percentile(si, 99)), float(np.percentile(sa, 99))))
            msg += f' | {x}: mean {np.mean(si):.4f} vs A {np.mean(sa):.4f}, p99 {np.percentile(si, 99):.3f} vs A {np.percentile(sa, 99):.3f}, max {si.max():.2f} vs A {sa.max():.2f}'
        d = np.linalg.norm(va - vi, axis=1) * 1000
        msg += f' | A-bind vs I-bind max {d.max():.1f} mm'
        log(msg)
        if label in ('I rest (arms down)', 'aim level', 'idle carry', 'arms forward 90', 'arms side 90 (T)'):
            Pl = Pt['upperarm_l']
            views = [('front', Pl + np.array([-0.04, -0.04, 0.0]), (0.35, 0.15, 1), 0.5),
                     ('back', Pl + np.array([-0.06, -0.06, 0.0]), (0.3, 0.2, -1), 0.5),
                     ('armpit', Pl + np.array([0.0, -0.08, 0.0]), (1, -0.35, 0.25), 0.45)]
            slug = label.split(' (')[0].replace(' ', '_')
            for vname, tgt, vd, dist in views:
                row = []
                stage.show(vi, f'I-bind  {label}  {vname}', tgt, vd, dist)
                row.append(stage.render(PANELS / f'apose_{slug}_{vname}_I.png'))
                stage.show(va, f'A-bind  {label}  {vname}', tgt, vd, dist)
                row.append(stage.render(PANELS / f'apose_{slug}_{vname}_A.png'))
                sheets.append(row)
    proof.tile(sheets[:6], OUT / 'apose_rest_aim.png')
    proof.tile(sheets[6:], OUT / 'apose_idle_forward_side.png')
    results['apose'] = apose_stats

# ------------------------------------------------------------------------------------ Blender rig
if 'blend' in STAGES:
    import bpy
    from mathutils import Matrix, Vector
    C3 = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
    scene = bpy.data.scenes.get('ue5_rig') or bpy.data.scenes.new('ue5_rig')
    win = bpy.context.window
    prev = win.scene
    win.scene = scene
    try:
        for o in list(scene.collection.objects):
            if o.users_scene == (scene,):      # only what lives in this scene alone
                bpy.data.objects.remove(o)
            else:
                scene.collection.objects.unlink(o)
        # (a wrong pick here would rename the clip pipeline's objects: the importer's bone-shape
        # Icosphere is a new mesh too, so the body is the new mesh that is no bone's shape, in this scene)
        before = {o.name for o in bpy.data.objects}
        bpy.ops.import_scene.gltf(filepath=str(body_paths(PLAYER)[1]))
        new_objs = [o for o in bpy.data.objects if o.name not in before]
        arms = [o for o in new_objs if o.type == 'ARMATURE']
        if len(arms) != 1:
            raise RuntimeError(f'expected one imported armature, got {[o.name for o in new_objs]}')
        imp_arm = arms[0]
        # the importer also makes a bone-display shape (an 'Icosphere' object, linked into whatever
        # scene it picks: the clip pipeline's): it goes, with the importer's armature, below
        shapes = sorted({pb.custom_shape.name for pb in imp_arm.pose.bones if pb.custom_shape})
        if any(n in before for n in shapes):
            raise RuntimeError(f'the importer reused an existing object as a bone shape: {shapes}')
        meshes = [o for o in new_objs if o.type == 'MESH' and o.name not in shapes]
        if len(meshes) != 1 or any(scene not in o.users_scene for o in meshes + arms):
            raise RuntimeError(f'expected one imported mesh and armature in {scene.name}, got {[o.name for o in new_objs]}')
        body_obj = meshes[0]
        # the importer's bones against the spec's frames (does a glTF reader see our frames?)
        imp_err = 0.0
        for n in skel.order:
            bm = np.array(imp_arm.data.bones[n].matrix_local.to_3x3())
            imp_err = max(imp_err, np.abs(bm - C3 @ skel.bones[n]['R']).max())
        # our own armature, built from the spec (head, tail, frame), for R4 and the cross-check
        arm_data = bpy.data.armatures.new('ue5_skeleton')
        arm = bpy.data.objects.new('ue5_skeleton', arm_data)
        scene.collection.objects.link(arm)
        for o in scene.objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = arm
        arm.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        for n in skel.order:
            b = skel.bones[n]
            eb = arm_data.edit_bones.new(n)
            eb.head = Vector(proof.g2b(b['head']))
            eb.tail = Vector(proof.g2b(b['tail']))
            m = Matrix((C3 @ b['R']).tolist()).to_4x4()
            m.translation = Vector(proof.g2b(b['head']))
            length = float(np.linalg.norm(b['tail'] - b['head']))
            eb.matrix = m
            eb.length = length
            eb.use_deform = b['rule'][0] != 'ik' and n != 'root'
        for n in skel.order:
            if skel.bones[n]['parent']:
                arm_data.edit_bones[n].parent = arm_data.edit_bones[skel.bones[n]['parent']]
        bpy.ops.object.mode_set(mode='OBJECT')
        frame_err = 0.0
        for n in skel.order:
            bm = np.array(arm_data.bones[n].matrix_local)
            frame_err = max(frame_err, np.abs(bm[:3, :3] - C3 @ skel.bones[n]['R']).max(),
                            np.abs(bm[:3, 3] - np.array(proof.g2b(skel.bones[n]['head']))).max())
        mw = body_obj.matrix_world.copy()
        body_obj.parent = arm
        body_obj.matrix_world = mw
        for mod in body_obj.modifiers:
            if mod.type == 'ARMATURE':
                mod.object = arm
        if not any(m.type == 'ARMATURE' for m in body_obj.modifiers):
            mod = body_obj.modifiers.new('Armature', 'ARMATURE')
            mod.object = arm
        bpy.data.objects.remove(imp_arm)
        for n in shapes:
            o = bpy.data.objects[n]
            me_ = o.data
            bpy.data.objects.remove(o)
            if me_.users == 0:
                bpy.data.meshes.remove(me_)
        body_obj.name = 'ue5_body_' + PLAYER
        # cross-check: Blender's deform against ue5.skin, in the aim pose with twist bones on
        local, hips, _ = ue5.clip_frame(ROOT / proof.CLIPS, 'rifle-aim-level', 0.0)
        L, T = ue5.map_pose(body, skel, local, hips, twist=True)
        for n in skel.order:
            pb = arm.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            L0, T0 = skel.local_rest(n)
            q = ue5.m_to_q(L0.T @ L[n])
            pb.rotation_quaternion = (q[3], q[0], q[1], q[2])
            pb.location = tuple(L0.T @ (T.get(n, T0) - T0))
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body_obj.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        ev.to_mesh_clear()
        rest = np.empty(len(body_obj.data.vertices) * 3)
        body_obj.data.vertices.foreach_get('co', rest)
        rest = rest.reshape(-1, 3)
        rest_g = np.column_stack([rest[:, 0], rest[:, 2], -rest[:, 1]])
        co_g = np.column_stack([co[:, 0], co[:, 2], -co[:, 1]]) + 0
        mwn = np.array(body_obj.matrix_world)
        ref = proof.new_posed(skel, nb, L, T)[0]
        # the importer keeps the glTF vertex order (checked: same count, same rest positions)
        if len(rest_g) != len(nb.pos) or np.abs(rest_g - nb.pos).max() > 1e-5:
            raise RuntimeError('imported vertices are not the glTF vertices in order')
        ok = np.ones(len(rest_g), bool)
        dev = np.linalg.norm(co_g - ref, axis=1) * 1000
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        log(f'\nBlender: importer bone frames vs spec {imp_err:.2e}; built armature frames vs spec {frame_err:.2e}; '
            f'Blender deform vs ue5.skin (aim level, twist on): {ok.sum()} / {len(ok)} vertices matched, max {dev.max():.4f} mm, '
            f'shape keys {len(body_obj.data.shape_keys.key_blocks) - 1 if body_obj.data.shape_keys else 0}, '
            f'vertex groups {len(body_obj.vertex_groups)}, mesh world matrix identity {np.allclose(mwn, np.eye(4))}')
        blend = HERE / 'ue5_rig.blend'
        bpy.data.libraries.write(str(blend), {scene}, fake_user=True, compress=True)
        log(f'  saved {blend.relative_to(ROOT)} ({blend.stat().st_size // 1024} KB): scene ue5_rig (armature ue5_skeleton, body)')
    finally:
        win.scene = prev

# ------------------------------------------------------------------------------------ tidy
# Leave this Blender as it was found: the clip pipeline's scene untouched, no scene or data of ours
# (ue5_rig.blend has the rig; set STAGES to include 'keep' to keep the scenes for a look).
if 'keep' not in STAGES and any(st in STAGES for st in ('rom', 'eyes', 'apose', 'blend')):
    import re
    import bpy
    for sn in ('ue5_review', 'ue5_rig'):
        sc = bpy.data.scenes.get(sn)
        if sc is None:
            continue
        if bpy.context.window.scene == sc:
            raise RuntimeError('our scene is the window scene')
        for o in list(sc.collection.objects):
            if tuple(x.name for x in o.users_scene) == (sn,):
                bpy.data.objects.remove(o)
        bpy.data.scenes.remove(sc)
    ours = re.compile(r'^(basecolor-2048|normal-2048|orm-2048|EO Original Civilian PBR Atlas|base|ue5_|earthonline-humanoid-v1|Icosphere)\.?')
    for _ in range(2):
        for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.cameras,
                     bpy.data.curves, bpy.data.worlds):
            for d in list(coll):
                if d.users == 0 and not d.use_fake_user and ours.match(d.name):
                    coll.remove(d)

log(f'\n{time.time() - t0:.0f} s')
(OUT / ('report.txt' if set(STAGES) >= {'write', 'equiv', 'rom', 'eyes', 'apose', 'blend'} else 'report-partial.txt')).write_text('\n'.join(log_lines) + '\n')
