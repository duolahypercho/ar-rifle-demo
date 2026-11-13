"""Pass R4 proof: re-import the exported FBX into a fresh headless Blender and compare with the GLB
evaluated in plain numpy (gltfio.py / skeleton.py). Run by make.py:

  Blender -b --factory-startup --python proof_unreal.py -- anims <tripo|earthonline> clip ...
  Blender -b --factory-startup --python proof_unreal.py -- body <body-name>      (rest, skin, sheet)

Writes JSON into unreal/review/proof/ and contact sheets into unreal/review/.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import bpy
from mathutils import Matrix

import config
import gltfio as G
import skeleton as S
import bl_common as B

argv = sys.argv[sys.argv.index('--') + 1:]
mode, arg, rest = argv[0], argv[1], argv[2:]
PROOF = os.path.join(config.OUT, 'review', 'proof')
os.makedirs(PROOF, exist_ok=True)


def fresh():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for x in list(coll):
            if x.name not in ('Render Result', 'Viewer Node'):
                coll.remove(x)
    sc = bpy.context.scene
    sc.unit_settings.scale_length = 1.0
    return sc


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, anim_offset=0.0, automatic_bone_orientation=False,
                             primary_bone_axis='Y', secondary_bone_axis='X', ignore_leaf_bones=False,
                             global_scale=1.0, use_custom_props=False)
    return [o for o in bpy.data.objects if o not in before]


def truth_m(skel, local):
    """Blender world (metres) per bone from glTF locals: what a perfect FBX gives after import."""
    out = {}
    for n, m in B.bl_worlds(skel, local).items():
        m = m.copy()
        m[:3, 3] /= B.CM
        out[n] = m
    return out


def pose_worlds(arm):
    mw = np.array(arm.matrix_world)
    return {pb.name: mw @ np.array(pb.matrix) for pb in arm.pose.bones}


def unit(m):
    r = m[:3, :3]
    return r / np.linalg.norm(r, axis=0, keepdims=True)


def compare(have, want, names):
    dp = max(float(np.linalg.norm(have[n][:3, 3] - want[n][:3, 3])) for n in names) * 1000
    da = max(float(G.angle_deg(unit(have[n]), unit(want[n]))) for n in names)
    return dp, da


# ------------------------------------------------------------------ animations

def do_anims(key, clips):
    sk = S.Skeleton(key)
    out = {}
    for clip in clips:
        fresh()
        path = os.path.join(config.OUT, 'animations', key, f'{clip}.fbx')
        objs = import_fbx(path)
        arms = [o for o in objs if o.type == 'ARMATURE']
        other = [o.name for o in objs if o.type != 'ARMATURE']
        arm = arms[0]
        act = arm.animation_data.action
        fr = [round(x) for x in act.frame_range]
        L = sk.clip_locals(clip)
        nf = len(L)
        sc = bpy.context.scene
        worst = {'pos_mm': 0.0, 'deg': 0.0}
        per_bone = {}
        root_err = {'mm': 0.0, 'deg': 0.0}
        notes = sk.notes['clips'][clip]
        travel = []
        for f in range(nf):
            sc.frame_set(f)
            have = pose_worlds(arm)
            want = truth_m(sk, L[f])
            for n in sk.bones:
                dp = float(np.linalg.norm(have[n][:3, 3] - want[n][:3, 3])) * 1000
                da = float(G.angle_deg(unit(have[n]), unit(want[n])))
                pb = per_bone.setdefault(n, [0.0, 0.0])
                pb[0] = max(pb[0], dp)
                pb[1] = max(pb[1], da)
            r = have['root']
            travel.append(r[:3, 3].tolist())
            if 'root' in notes:
                x, z, yaw = notes['root'][f]
                wantp = np.array([x, -z, 0.0])   # glTF (x, 0, z) in Blender axes, metres
                root_err['mm'] = max(root_err['mm'], float(np.linalg.norm(r[:3, 3] - wantp)) * 1000)
                c, s_ = np.cos(yaw), np.sin(yaw)
                wantr = np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])   # yaw about glTF +Y = Blender +Z
                root_err['deg'] = max(root_err['deg'], float(G.angle_deg(unit(r), wantr)))
        worst['pos_mm'] = max(v[0] for v in per_bone.values())
        worst['deg'] = max(v[1] for v in per_bone.values())
        wb = max(per_bone, key=lambda n: per_bone[n][0])
        wa = max(per_bone, key=lambda n: per_bone[n][1])
        out[clip] = dict(frames=nf, fbxFrameRange=fr, sceneFps=sc.render.fps / sc.render.fps_base,
                         importedArmatures=len(arms), otherObjects=other, bones=len(arm.data.bones),
                         worstPosMm=worst['pos_mm'], worstPosBone=wb, worstDeg=worst['deg'], worstDegBone=wa,
                         gunPosMm=per_bone['Gun'][0], gunDeg=per_bone['Gun'][1],
                         rootNotes='root' in notes, rootErrMm=root_err['mm'] if 'root' in notes else None,
                         rootErrDeg=root_err['deg'] if 'root' in notes else None,
                         rootTravelM=float(np.linalg.norm(np.array(travel[-1]) - np.array(travel[0]))),
                         rootMaxFromStartM=float(max(np.linalg.norm(np.array(t) - np.array(travel[0])) for t in travel)))
        print('[R4 proof]', key, clip, json.dumps(out[clip]), flush=True)
    with open(os.path.join(PROOF, f'anims-{key}.json'), 'w') as f:
        json.dump(out, f, indent=1)


# ------------------------------------------------------------------ bodies

def ue_like_pose(body_arm, body_sk, anim_arm, own_translation):
    """Pose the body armature the way Unreal plays an animation on a shared skeleton: local rotation
    from the animation; local translation from the animation for root, pelvis, the IK bones and the
    gun bones, from the body's own rest for every other bone (translation retargeting "Skeleton").
    `own_translation` False takes every translation from the animation (Unreal's default "Animation")."""
    aw = pose_worlds(anim_arm)
    amw = np.array(anim_arm.matrix_world)
    aw = {n: np.linalg.inv(amw) @ m for n, m in aw.items()}   # armature space
    keep = {'root', 'pelvis', 'ik_foot_root', 'ik_foot_l', 'ik_foot_r', 'ik_hand_root', 'ik_hand_gun',
            'ik_hand_l', 'ik_hand_r', 'Gun', 'GunIn'}
    bones = body_arm.data.bones
    for pb in body_arm.pose.bones:
        n = pb.name
        p = bones[n].parent
        al = aw[n] if p is None else np.linalg.inv(aw[p.name]) @ aw[n]
        rl = np.array(bones[n].matrix_local) if p is None else \
            np.linalg.inv(np.array(p.matrix_local)) @ np.array(bones[n].matrix_local)
        loc = al.copy()
        if own_translation and n not in keep:
            loc[:3, 3] = rl[:3, 3]
        pb.matrix_basis = B.M(np.linalg.inv(rl) @ loc)
    bpy.context.view_layer.update()


def eval_mesh_world(mesh):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    v = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', v)
    ev.to_mesh_clear()
    mw = np.array(mesh.matrix_world)
    return v.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]


def do_body(name):
    key = config.BODIES[name]
    ref = name == config.PACKS[key]['body']
    sk = S.Skeleton(key, None if ref else name)
    sc = fresh()
    objs = import_fbx(os.path.join(config.OUT, 'bodies', f'{name}.fbx'))
    R = {'objects': sorted((o.name, o.type) for o in objs)}
    arm = next(o for o in objs if o.type == 'ARMATURE')
    mesh = next(o for o in objs if o.type == 'MESH')
    R['armatureObjectScale'] = list(arm.matrix_world.to_scale())
    bones = arm.data.bones
    R['bones'] = len(bones)
    R['boneNamesEqual'] = sorted(b.name for b in bones) == sorted(sk.bones)
    R['parentsEqual'] = all((bones[n].parent.name if bones[n].parent else None) == sk.parent[n] for n in sk.bones)
    R['extraBones'] = sorted(set(b.name for b in bones) - set(sk.body.joints))
    mw = np.array(arm.matrix_world)
    have = {b.name: mw @ np.array(b.matrix_local) for b in bones}
    want = truth_m(sk, sk.rest_local)
    R['restPosMm'], R['restDeg'] = compare(have, want, sk.bones)
    # rest mesh against the GLB
    pos = sk.body.mesh()[0]
    v = eval_mesh_world(mesh)
    gl = (B.C3 @ pos.T).T
    R['vertices'] = [len(v), len(gl)]
    R['restVertexMm'] = float(np.linalg.norm(v - gl, axis=1).max()) * 1000 if len(v) == len(gl) else None
    R['heightM'] = float(v[:, 2].max() - v[:, 2].min())
    R['shapeKeys'] = [k.name for k in mesh.data.shape_keys.key_blocks[1:]] if mesh.data.shape_keys else []
    R['materials'] = [m.name for m in mesh.data.materials]
    R['images'] = sorted((i.name, list(i.size)) for i in bpy.data.images if i.name not in ('Render Result', 'Viewer Node'))
    # morph targets: one key at 1 against the GLB's target
    if R['shapeKeys']:
        g = sk.body.g
        prim = g.json['meshes'][0]['primitives'][0]
        names = g.json['meshes'][0].get('extras', {}).get('targetNames', [])
        worst = 0.0
        for i, nm in enumerate(names):
            d = g.accessor(prim['targets'][i]['POSITION']).astype(float)
            kb = mesh.data.shape_keys.key_blocks[nm]
            kv = np.empty(len(kb.data) * 3)
            kb.data.foreach_get('co', kv)
            mwm = np.array(mesh.matrix_world)
            kv = kv.reshape(-1, 3) @ mwm[:3, :3].T + mwm[:3, 3]
            worst = max(worst, float(np.linalg.norm(kv - (B.C3 @ (pos + d).T).T, axis=1).max()) * 1000)
        R['morphTargetMm'] = worst
    # skin in clip poses: the animation FBX played on the body FBX
    R['skin'] = {}
    sheet_frames = {}
    for clip in ('rifle-aim-level', 'swap-rifle-shotgun', 'rifle-walk-f'):
        aobjs = import_fbx(os.path.join(config.OUT, 'animations', key, f'{clip}.fbx'))
        aarm = next(o for o in aobjs if o.type == 'ARMATURE')
        L = sk.clip_locals(clip)
        nf = len(L)
        frames = sorted({0, nf // 2, nf - 1}) if clip != 'rifle-walk-f' else []
        res = []
        for f in frames:
            sc.frame_set(f)
            ue_like_pose(arm, sk, aarm, own_translation=True)
            v = eval_mesh_world(mesh)
            wg = sk.world(L[f])
            gl = (B.C3 @ sk.body.skin(wg).T).T
            res.append(dict(frame=f, worstVertexMm=float(np.linalg.norm(v - gl, axis=1).max()) * 1000,
                            meanVertexMm=float(np.linalg.norm(v - gl, axis=1).mean()) * 1000))
        if res:
            R['skin'][clip] = res
        sheet_frames[clip] = aarm
    aobjs = import_fbx(os.path.join(config.OUT, 'retarget', f'{key}_apose.fbx'))
    sheet_frames['apose'] = next(o for o in aobjs if o.type == 'ARMATURE')
    with open(os.path.join(PROOF, f'body-{name}.json'), 'w') as fh:
        json.dump(R, fh, indent=1)
    print('[R4 proof] body', name, json.dumps(R)[:1500], flush=True)
    render_sheet(name, key, arm, mesh, sk, sheet_frames)


# ------------------------------------------------------------------ contact sheet

def render_sheet(name, key, arm, mesh, sk, anim_arms):
    sc = bpy.context.scene
    for a in anim_arms.values():
        a.hide_render = True
    # the rifle on the Gun bone (zero offset), the shotgun on GunIn: proves the gun frame
    guns = []
    for gname, bone in (('ar_rifle', 'Gun'), ('pump_shotgun', 'GunIn')):
        p = os.path.join(config.OUT, 'weapons', f'{gname}.fbx')
        if not os.path.exists(p):
            continue
        for o in import_fbx(p):
            if o.type == 'MESH':
                c = o.constraints.new('COPY_TRANSFORMS')
                c.target = arm
                c.subtarget = bone
                c.head_tail = 0.0
                guns.append((o, bone))
            else:
                o.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_backface_culling = False
    sc.render.resolution_x, sc.render.resolution_y = 360, 540
    sc.render.film_transparent = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.32, 0.34, 0.37)
    sc.render.image_settings.file_format = 'PNG'
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def place(az_deg, el_deg, dist, target):
        az, el = np.radians(az_deg), np.radians(el_deg)
        # az 0 = in front of the character (Blender -Y side), positive = towards the character's left (+X)
        d = np.array([np.sin(az) * np.cos(el), -np.cos(az) * np.cos(el), np.sin(el)])
        pos = np.array(target) + d * dist
        cam.location = pos.tolist()
        fwd = np.array(target) - pos
        cam.rotation_euler = Matrix(np.eye(3).tolist()).to_euler()
        from mathutils import Vector
        cam.rotation_euler = Vector(fwd.tolist()).to_track_quat('-Z', 'Y').to_euler()
    tiles = []
    tmp = os.path.join(config.SCRATCH, 'tiles', name)
    os.makedirs(tmp, exist_ok=True)

    def shot(label, clip, f, az, el, dist, target_bone=None, ty=0.95):
        aarm = anim_arms[clip]
        sc.frame_set(f)
        ue_like_pose(arm, sk, aarm, own_translation=True)
        tgt = [0, 0, ty]
        if target_bone:
            m = np.array(arm.matrix_world) @ np.array(arm.pose.bones[target_bone].matrix)
            tgt = m[:3, 3].tolist()
        else:
            m = np.array(arm.matrix_world) @ np.array(arm.pose.bones['root'].matrix)
            tgt = [m[0, 3], m[1, 3], ty]
        place(az, el, dist, tgt)
        p = os.path.join(tmp, f'{len(tiles):02d}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        tiles.append((p, label))
    walk_n = len(sk.clip_locals('rifle-walk-f'))
    for k in range(6):
        f = round(k * (walk_n - 1) / 6)
        shot(f'walk f{f}', 'rifle-walk-f', f, 35, 8, 4.2)
    shot('A-pose (retarget) front', 'apose', 0, 0, 5, 4.2)
    for f, az in ((0, 0), (0, 40), (0, 90), (0, 180)):
        shot(f'aim az{az}', 'rifle-aim-level', f, az, 8, 4.2)
    shot('aim hands', 'rifle-aim-level', 0, 50, 15, 1.3, target_bone='hand_r')
    swap_n = len(sk.clip_locals('swap-rifle-shotgun'))
    shot(f'swap f{swap_n // 2}', 'swap-rifle-shotgun', swap_n // 2, 140, 10, 4.2)
    shot('A-pose side', 'apose', 0, 90, 5, 4.2)
    # tile 7 x 2
    W, H = sc.render.resolution_x, sc.render.resolution_y
    sheet = np.zeros((H * 2, W * 7, 4), np.float32)
    for i, (p, _l) in enumerate(tiles):
        im = bpy.data.images.load(p)
        px = np.array(im.pixels[:], np.float32).reshape(H, W, 4)
        r, c = divmod(i, 7)
        sheet[(1 - r) * H:(2 - r) * H, c * W:(c + 1) * W] = px
        bpy.data.images.remove(im)
    out = bpy.data.images.new(f'sheet_{name}', W * 7, H * 2, alpha=True)
    out.pixels = sheet.ravel().tolist()
    os.makedirs(os.path.join(config.OUT, 'review'), exist_ok=True)
    out.filepath_raw = os.path.join(config.OUT, 'review', f'sheet_{name}.png')
    out.file_format = 'PNG'
    out.save()
    with open(os.path.join(config.OUT, 'review', f'sheet_{name}.txt'), 'w') as fh:
        fh.write('Re-imported FBX (body + animation FBX + weapons FBX on Gun / GunIn), Workbench, texture colour.\n'
                 'Top row: ' + ', '.join(l for _p, l in tiles[:7]) + ' (walk camera 35 deg to the character\'s left of the front)\n'
                 'Bottom row: ' + ', '.join(l for _p, l in tiles[7:]) + '\n')


# ------------------------------------------------------------------ pass U1: vehicles

def do_vanims(pack, clips):
    """The vehicle clip FBX re-imported vs the GLB pack (numpy FK): every bone, every frame; frame count, fps;
    the root bone against the notes' root track (place in the vehicle root's frame)."""
    key = config.VEHICLE_PACKS[pack]['skeleton']
    sk = S.Skeleton(key, pack=pack)
    out = {}
    for clip in clips or sk.pack.names:
        fresh()
        objs = import_fbx(os.path.join(config.OUT, 'animations', pack, f'{clip}.fbx'))
        arms = [o for o in objs if o.type == 'ARMATURE']
        arm = arms[0]
        act = arm.animation_data.action
        fr = [round(x) for x in act.frame_range]
        L = sk.clip_locals(clip, min_frames=2)
        nf = len(L)
        sc = bpy.context.scene
        nc = sk.notes['clips'][clip]
        root = nc['root']
        per_bone = {}
        root_err = {'mm': 0.0, 'deg': 0.0}
        for f in range(nf):
            sc.frame_set(f)
            have = pose_worlds(arm)
            want = truth_m(sk, L[f])
            for n in sk.bones:
                dp = float(np.linalg.norm(have[n][:3, 3] - want[n][:3, 3])) * 1000
                da = float(G.angle_deg(unit(have[n]), unit(want[n])))
                pb = per_bone.setdefault(n, [0.0, 0.0])
                pb[0] = max(pb[0], dp)
                pb[1] = max(pb[1], da)
            x, z, yaw = root[f % len(root)] if nc.get('loop') else root[min(f, len(root) - 1)]
            r = have['root']
            root_err['mm'] = max(root_err['mm'], float(np.linalg.norm(r[:3, 3] - np.array([x, -z, 0.0]))) * 1000)
            c, s_ = np.cos(yaw), np.sin(yaw)
            root_err['deg'] = max(root_err['deg'], float(G.angle_deg(unit(r), np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]]))))
        wb = max(per_bone, key=lambda n: per_bone[n][0])
        wa = max(per_bone, key=lambda n: per_bone[n][1])
        out[clip] = dict(frames=nf, glbKeys=nc['frames'] if not nc.get('loop') else nc['frames'] + 1,
                         fbxFrameRange=fr, sceneFps=sc.render.fps / sc.render.fps_base,
                         importedArmatures=len(arms), otherObjects=[o.name for o in objs if o.type != 'ARMATURE'],
                         bones=len(arm.data.bones), worstPosMm=per_bone[wb][0], worstPosBone=wb,
                         worstDeg=per_bone[wa][1], worstDegBone=wa, rootErrMm=root_err['mm'], rootErrDeg=root_err['deg'],
                         rootStart=[round(v, 5) for v in root[0]], rootEnd=[round(v, 5) for v in root[(nf - 1) % len(root)]])
        print('[U1 proof]', pack, clip, json.dumps(out[clip]), flush=True)
    with open(os.path.join(PROOF, f'vanims-{pack}.json'), 'w') as f:
        json.dump(out, f, indent=1)


def vehicle_truth(veh, local):
    """Blender world (metres) per vehicle bone from glTF locals (world-aligned frames)."""
    out = {}
    for n, m in B.bl_worlds(veh, local).items():
        m = m.copy()
        m[:3, 3] /= B.CM
        out[n] = m
    return out


def do_vehicle(name):
    """The vehicle FBX re-imported: one armature + the parts, bones = GLB nodes (names, parents, rests =
    pivots), every part bound to its own bone only, vertices against the GLB (numpy), textures."""
    import vehicle as V
    veh = V.Vehicle(name)
    fresh()
    objs = import_fbx(os.path.join(config.OUT, 'vehicles', f'{name}.fbx'))
    arms = [o for o in objs if o.type == 'ARMATURE']
    meshes = [o for o in objs if o.type == 'MESH']
    R = {'armatures': len(arms), 'meshes': len(meshes), 'otherObjects': [o.name for o in objs if o.type not in ('ARMATURE', 'MESH')]}
    arm = arms[0]
    bones = arm.data.bones
    R['bones'] = len(bones)
    R['boneNamesEqual'] = sorted(b.name for b in bones) == sorted(veh.bones)
    R['parentsEqual'] = all((bones[n].parent.name if bones[n].parent else None) == veh.parent[n] for n in veh.bones)
    mw = np.array(arm.matrix_world)
    have = {b.name: mw @ np.array(b.matrix_local) for b in bones}
    want = vehicle_truth(veh, veh.rest_local)
    R['restPivotMm'], R['restDeg'] = compare(have, want, veh.bones)
    R['restRootIdentity'] = bool(np.allclose(have[veh.root], np.eye(4), atol=1e-6))
    worst, worst_part, bad_groups, nverts = 0.0, None, [], 0
    for o in meshes:
        part = next((n for n in veh.mesh if o.name in (f'{name}_{n}', n) or o.name.startswith(f'{name}_{n}.')), None)
        groups = [g.name for g in o.vertex_groups]
        if part is None or groups != [part]:
            bad_groups.append((o.name, groups))
            continue
        gi = o.vertex_groups[part].index
        ws = [sum(g.weight for g in v.groups if g.group == gi) for v in o.data.vertices]
        if min(ws) < 0.999999:
            bad_groups.append((o.name, 'weight < 1'))
        v = eval_mesh_world(o)
        gl = (B.C3 @ veh.part_vertices(part).T).T
        nverts += len(v)
        if v.shape != gl.shape:
            bad_groups.append((o.name, 'vertex count', len(v), len(gl)))
            continue
        d = float(np.linalg.norm(v - gl, axis=1).max()) * 1000
        if d > worst:
            worst, worst_part = d, part
    R['partsFound'] = len(meshes) - len(bad_groups)
    R['partsInGlb'] = len(veh.mesh)
    R['badParts'] = bad_groups
    R['restVertexMm'] = worst
    R['restVertexWorstPart'] = worst_part
    R['vertices'] = nverts
    R['images'] = sorted(i.name for i in bpy.data.images if i.name not in ('Render Result', 'Viewer Node'))
    allv = np.vstack([eval_mesh_world(o) for o in meshes])
    R['boundsM'] = [allv.min(0).round(4).tolist(), allv.max(0).round(4).tolist()]
    with open(os.path.join(PROOF, f'vehicle-{name}.json'), 'w') as fh:
        json.dump(R, fh, indent=1)
    print('[U1 proof] vehicle', name, json.dumps(R)[:1500], flush=True)


def do_vehanims(name, group, clips):
    """Vehicle-side animation FBX re-imported vs the truth (numpy): every bone, every frame. For a pack group
    the truth is the vehicle with the pack's vehicleFit, the notes' door per frame and the clip's controls;
    for `own` the GLB's own clip sampled at 30 fps."""
    import vehicle as V
    veh = V.Vehicle(name)
    out = {}
    if group == 'own':
        names = clips or veh.own_clips()
        truth = {c: (lambda c=c: veh.own_clip_locals(c)) for c in names}
    else:
        cfg = config.VEHICLE_PACKS[group]
        notes = json.load(open(cfg['notes']))
        fit = V.fit_of(notes, veh.kind)
        pack = G.ClipPack(cfg['pack'])
        names = clips or ([c for c, v in notes['clips'].items() if v['vehicle'] == veh.kind] + ['fit'])
        truth = {}
        for c in names:
            if c == 'fit':
                truth[c] = lambda: [veh.pose({}, fit)] * 2
            else:
                nf = max(2, V.pack_keys(pack, c))
                truth[c] = (lambda c=c, nf=nf: [veh.pose(x, fit) for x in V.clip_controls(veh.kind, c, notes['clips'][c], nf)])
    for clip in names:
        fresh()
        objs = import_fbx(os.path.join(config.OUT, 'vehicles', 'animations', group, f'{name}_{clip}.fbx'))
        arm = next(o for o in objs if o.type == 'ARMATURE')
        fr = [round(x) for x in arm.animation_data.action.frame_range]
        L = truth[clip]()
        sc = bpy.context.scene
        per_bone = {}
        for f in range(len(L)):
            sc.frame_set(f)
            have = pose_worlds(arm)
            want = vehicle_truth(veh, L[f])
            for n in veh.bones:
                pb = per_bone.setdefault(n, [0.0, 0.0])
                pb[0] = max(pb[0], float(np.linalg.norm(have[n][:3, 3] - want[n][:3, 3])) * 1000)
                pb[1] = max(pb[1], float(G.angle_deg(unit(have[n]), unit(want[n]))))
        wb = max(per_bone, key=lambda n: per_bone[n][0])
        wa = max(per_bone, key=lambda n: per_bone[n][1])
        out[clip] = dict(frames=len(L), fbxFrameRange=fr, sceneFps=sc.render.fps / sc.render.fps_base,
                         worstPosMm=per_bone[wb][0], worstPosBone=wb, worstDeg=per_bone[wa][1], worstDegBone=wa)
        print('[U1 proof]', name, group, clip, json.dumps(out[clip]), flush=True)
    with open(os.path.join(PROOF, f'vehanims-{name}-{group}.json'), 'w') as f:
        json.dump(out, f, indent=1)


def do_align(pack):
    """End to end: for every clip of a vehicle pack, the character clip FBX and the vehicle-side FBX imported
    into one scene with no offset (as the README places them in Unreal), and each contact's character bone
    taken in its vehicle bone's frame, every frame of its span, against the same relation from the GLB pack and
    the vehicle formula (numpy). Also a contact sheet: body FBX + vehicle FBX posed by the two animations."""
    import vehicle as V
    key = config.VEHICLE_PACKS[pack]['skeleton']
    sk = S.Skeleton(key, pack=pack)
    notes = sk.notes
    vehs = {config.VEHICLES[n]['kind']: V.Vehicle(n) for n in config.VEHICLES}
    out = {}
    for clip, nc in notes['clips'].items():
        veh = vehs[nc['vehicle']]
        fresh()
        carm = next(o for o in import_fbx(os.path.join(config.OUT, 'animations', pack, f'{clip}.fbx')) if o.type == 'ARMATURE')
        varm = next(o for o in import_fbx(os.path.join(config.OUT, 'vehicles', 'animations', pack, f'{veh.name}_{clip}.fbx'))
                    if o.type == 'ARMATURE')
        L = sk.clip_locals(clip, min_frames=2)
        fit = V.fit_of(notes, veh.kind)
        ctls = V.clip_controls(veh.kind, clip, nc, len(L))
        worst_p, worst_a, worst_c = 0.0, 0.0, None
        frames_checked = 0
        sc = bpy.context.scene
        for f in range(len(L)):
            on = [c for c in nc['contacts'] if c['from'] <= f <= c['to']]
            if not on:
                continue
            sc.frame_set(f)
            # armature space (cm): both imported armature objects carry the same 0.01 scale and no offset
            hc = {pb.name: np.array(pb.matrix) for pb in carm.pose.bones}
            hv = {pb.name: np.array(pb.matrix) for pb in varm.pose.bones}
            wc = B.bl_worlds(sk, L[f])
            wv = B.bl_worlds(veh, veh.pose(ctls[f], fit))
            frames_checked += 1
            for c in on:
                bone, node = c['part'], c['node'] or veh.root
                rel_have = np.linalg.inv(hv[node]) @ hc[bone]
                rel_want = np.linalg.inv(wv[node]) @ wc[bone]
                dp = float(np.linalg.norm(rel_have[:3, 3] - rel_want[:3, 3])) * 10
                da = float(G.angle_deg(unit(rel_have), unit(rel_want)))
                if dp > worst_p:
                    worst_p, worst_c = dp, f"{c['part']} on {node} f{f}"
                worst_a = max(worst_a, da)
        out[clip] = dict(contacts=len(nc['contacts']), framesChecked=frames_checked, worstRelPosMm=worst_p,
                         worstRelDeg=worst_a, worstAt=worst_c)
        print('[U1 proof] align', pack, clip, json.dumps(out[clip]), flush=True)
    with open(os.path.join(PROOF, f'align-{pack}.json'), 'w') as f:
        json.dump(out, f, indent=1)
    vehicle_sheet(pack, sk, vehs)


def copy_pose(dst, src):
    """dst armature's pose bones take src's armature-space matrices (same bone names)."""
    sw = {pb.name: np.array(pb.matrix) for pb in src.pose.bones}
    bones = dst.data.bones
    for pb in dst.pose.bones:
        p = bones[pb.name].parent
        al = sw[pb.name] if p is None else np.linalg.inv(sw[p.name]) @ sw[pb.name]
        rl = np.array(bones[pb.name].matrix_local) if p is None else \
            np.linalg.inv(np.array(p.matrix_local)) @ np.array(bones[pb.name].matrix_local)
        pb.matrix_basis = B.M(np.linalg.inv(rl) @ al)
    bpy.context.view_layer.update()


def vehicle_sheet(pack, sk, vehs):
    """Contact sheet: the body FBX posed by the vehicle clip FBX (Unreal's rule, ue_like_pose) and the vehicle
    FBX posed by the vehicle-side FBX, both at the origin (no offset), Workbench with textures."""
    key = sk.key
    body = config.PACKS[key]['body']
    shots = [('car-enter', 'doorOpenEnd', 'side'), ('car-enter', 'seated', 'side'), ('car-drive', 0, 'cockpit'),
             ('car-steer-l', 0, 'cockpit'), ('car-exit', 'unseated', 'side'), ('car-exit', 'doorCloseStart', 'side'),
             ('heli-enter', 'doorOpenEnd', 'heli'), ('heli-enter', 'seated', 'heli'), ('heli-fly', 0, 'heli_in'),
             ('heli-cyclic-f', 0, 'heli_in'), ('heli-pedal-l', 0, 'heli_feet'), ('heli-exit', 'unseated', 'heli'),
             ('heli-exit', 'doorCloseStart', 'heli'), ('heli-collective-up', 0, 'heli_in')]
    sc = fresh()
    bobjs = import_fbx(os.path.join(config.OUT, 'bodies', f'{body}.fbx'))
    barm = next(o for o in bobjs if o.type == 'ARMATURE')
    vparts = {}
    for vname in config.VEHICLES:
        objs = import_fbx(os.path.join(config.OUT, 'vehicles', f'{vname}.fbx'))
        vparts[config.VEHICLES[vname]['kind']] = (next(o for o in objs if o.type == 'ARMATURE'), [o for o in objs if o.type == 'MESH'])
    for kind, (va, ms) in vparts.items():
        for o in ms:
            if 'blur' in o.name:
                o.hide_render = True
    # Workbench's texture colour shows a material's active image node: a paint with only a normal map would show
    # the normal map. Show the base colour image where there is one, the base colour (the FBX's DiffuseColor) else.
    for m in bpy.data.materials:
        nt = m.node_tree
        bsdf = next((nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED'), None) if nt else None
        if bsdf is None:
            continue
        link = next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
        if link is not None and link.from_node.type == 'TEX_IMAGE':
            nt.nodes.active = link.from_node
        else:   # (review scene only: drop the normal / ORM image nodes so Workbench shows the colour)
            for nd in [nd for nd in nt.nodes if nd.type == 'TEX_IMAGE']:
                nt.nodes.remove(nd)
            c = bsdf.inputs['Base Color'].default_value
            m.diffuse_color = (c[0], c[1], c[2], 1.0)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_backface_culling = False
    sc.render.resolution_x, sc.render.resolution_y = 480, 400
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.32, 0.34, 0.37)
    sc.render.image_settings.file_format = 'PNG'
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    from mathutils import Vector
    views = {  # (camera position, target) in Blender metres, vehicle frame (forward +Y, right +X)
        'side': ((-3.6, 0.6, 1.5), (-0.6, 0.0, 0.8)),
        'cockpit': ((0.42, -0.25, 0.98), (-0.37, 0.3, 0.62)),          # from the passenger's head
        'heli': ((4.2, 2.6, 2.0), (0.8, 1.4, 1.0)),
        'heli_in': ((-0.3, 1.8, 1.5), (0.42, 1.35, 1.0)),              # from over the left cockpit seat
        'heli_feet': ((-0.25, 1.35, 1.3), (0.42, 1.9, 0.78)),
    }
    tmp = os.path.join(config.SCRATCH, 'tiles', f'vehicles-{pack}')
    os.makedirs(tmp, exist_ok=True)
    tiles = []
    for clip, at, view in shots:
        nc = sk.notes['clips'][clip]
        kind = nc['vehicle']
        vname = config.VEHICLE_OF_KIND[kind]
        f = at if isinstance(at, int) else int(round(nc['events'][at] * 30))
        aobjs = import_fbx(os.path.join(config.OUT, 'animations', pack, f'{clip}.fbx'))
        vobjs = import_fbx(os.path.join(config.OUT, 'vehicles', 'animations', pack, f'{vname}_{clip}.fbx'))
        aarm = next(o for o in aobjs if o.type == 'ARMATURE')
        vaarm = next(o for o in vobjs if o.type == 'ARMATURE')
        for o in aobjs + vobjs:
            o.hide_render = True
        for k, (va, ms) in vparts.items():
            for o in ms:
                o.hide_render = (k != kind) or 'blur' in o.name
        sc.frame_set(f)
        ue_like_pose(barm, sk, aarm, own_translation=True)
        copy_pose(vparts[kind][0], vaarm)
        pos, tgt = views[view]
        cam.location = pos
        cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        cam_data.lens = {'heli': 28, 'side': 24}.get(view, 16)
        cam_data.clip_start = 0.02
        p = os.path.join(tmp, f'{len(tiles):02d}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        tiles.append((p, f'{clip} f{f}'))
        for o in aobjs + vobjs:
            data = o.data
            bpy.data.objects.remove(o)
    W, H = sc.render.resolution_x, sc.render.resolution_y
    cols = 7
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.zeros((H * rows, W * cols, 4), np.float32)
    for i, (p, _l) in enumerate(tiles):
        im = bpy.data.images.load(p)
        px = np.array(im.pixels[:], np.float32).reshape(H, W, 4)
        r, c = divmod(i, cols)
        sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = px
        bpy.data.images.remove(im)
    img = bpy.data.images.new(f'sheet_vehicles_{pack}', W * cols, H * rows, alpha=True)
    img.pixels = sheet.ravel().tolist()
    img.filepath_raw = os.path.join(config.OUT, 'review', f'sheet_vehicles_{pack}.png')
    img.file_format = 'PNG'
    img.save()
    with open(os.path.join(config.OUT, 'review', f'sheet_vehicles_{pack}.txt'), 'w') as fh:
        fh.write(f'Re-imported FBX: body {body}.fbx posed by animations/{pack}/<clip>.fbx (Unreal\'s rule), vehicles/<vehicle>.fbx '
                 f'posed by vehicles/animations/{pack}/<vehicle>_<clip>.fbx, both at the origin with no offset. Workbench, texture colour.\n'
                 'Tiles, left to right, top to bottom: ' + ', '.join(l for _p, l in tiles) + '\n')


if mode == 'anims':
    do_anims(arg, rest)
elif mode == 'body':
    do_body(arg)
elif mode == 'vanims':
    do_vanims(arg, rest)
elif mode == 'vehicle':
    do_vehicle(arg)
elif mode == 'vehanims':
    do_vehanims(arg, rest[0], rest[1:])
elif mode == 'align':
    do_align(arg)
