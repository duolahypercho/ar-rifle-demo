"""Pass R4: FBX for Unreal Engine 5. Run by make.py in a private headless Blender:

  Blender -b --factory-startup --python build_unreal.py -- body <body-name>
  Blender -b --factory-startup --python build_unreal.py -- anims <tripo|earthonline> [clip ...]
  Blender -b --factory-startup --python build_unreal.py -- apose <tripo|earthonline>
  Blender -b --factory-startup --python build_unreal.py -- gun <ar_rifle|pump_shotgun>
  (pass U1)
  Blender -b --factory-startup --python build_unreal.py -- vanims <tripo-vehicle|earthonline-vehicle> [clip ...]
  Blender -b --factory-startup --python build_unreal.py -- vehicle <supercar|utility_helicopter>
  Blender -b --factory-startup --python build_unreal.py -- vehanims <vehicle> <own|tripo-vehicle|earthonline-vehicle> [clip ...]

Reads only public/characters/*.glb, the frames / mapping JSON, the gun GLBs and public/vehicles/*.glb;
writes only under unreal/. See unreal/README.md.
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

t0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
mode, arg, rest = argv[0], argv[1], argv[2:]
LOG = {}


def say(*a):
    print('[R4]', *a, flush=True)


# ------------------------------------------------------------------ body

def import_body_mesh(path, body):
    """The skinned mesh from Blender's glTF importer, detached from the importer's armature,
    baked to Blender cm. The importer's Icosphere bone shape and armature are removed."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH' and o.vertex_groups]
    assert len(meshes) == 1, [(o.name, o.type) for o in new]
    mesh = meshes[0]
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    for md in list(mesh.modifiers):
        mesh.modifiers.remove(md)
    mesh.data.transform(Matrix.Scale(B.CM, 4) @ mw, shape_keys=True)
    mesh.matrix_world = Matrix.Identity(4)
    for o in new:
        if o is not mesh:
            data = o.data
            bpy.data.objects.remove(o)
            if data is not None and data.users == 0:
                (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.armatures).remove(data)
    for coll in list(bpy.data.collections):
        if not coll.objects:
            bpy.data.collections.remove(coll)
    if mesh.name not in bpy.context.scene.collection.objects:
        for c in list(mesh.users_collection):
            c.objects.unlink(mesh)
        bpy.context.scene.collection.objects.link(mesh)
    # vertex positions against the GLB (the importer keeps the glTF vertex order here)
    pos = body.mesh()[0]
    want = (B.C3 @ pos.T).T * B.CM
    have = np.empty(len(mesh.data.vertices) * 3)
    mesh.data.vertices.foreach_get('co', have)
    have = have.reshape(-1, 3)
    assert have.shape == want.shape, (have.shape, want.shape)
    LOG['meshVsGlbCm'] = float(np.abs(have - want).max())
    return mesh


def textures_beside(glb, folder):
    """The GLB's images written as files (original bytes) -> {glTF image name: path}."""
    os.makedirs(folder, exist_ok=True)
    out = {}
    for im in glb.json.get('images', []):
        bv = glb.json['bufferViews'][im['bufferView']]
        data = glb.bin[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        ext = {'image/png': '.png', 'image/jpeg': '.jpg'}[im['mimeType']]
        p = os.path.join(folder, im['name'] + ext)
        with open(p, 'wb') as f:
            f.write(data)
        out[im['name']] = p
    return out


def simplify_material(mat, files, opaque):
    """Relink the importer's node tree so the FBX exporter finds the textures: base colour image
    straight into Base Color (the importer multiplies it by COLOR_0, which is white on every body),
    its alpha straight into Alpha for masked materials, normal map kept; images re-loaded from the
    files written beside the FBX (so the exporter can embed them)."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED' and any(l.to_node == n for l in nt.links))
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and n.image is not None:
            name = n.image.name.rsplit('.', 1)[0] if n.image.name not in files else n.image.name
            for k, p in files.items():
                if n.image.name.startswith(k):
                    img = bpy.data.images.load(p, check_existing=True)
                    img.colorspace_settings.name = n.image.colorspace_settings.name
                    n.image = img
                    break

    def upstream_image(sock):
        seen = [sock]
        while seen:
            s = seen.pop()
            for l in nt.links:
                if l.to_socket == s:
                    if l.from_node.type == 'TEX_IMAGE':
                        return l.from_node
                    seen.extend(l.from_node.inputs)
        return None
    base = upstream_image(bsdf.inputs['Base Color'])
    if base is not None:
        for l in list(nt.links):
            if l.to_socket in (bsdf.inputs['Base Color'], bsdf.inputs['Alpha']):
                nt.links.remove(l)
        nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
        if not opaque:
            nt.links.new(base.outputs['Alpha'], bsdf.inputs['Alpha'])
    return {'baseColor': base.image.name if base else None}


def do_body(name):
    key = config.BODIES[name]
    sk = S.Skeleton(key, None if name == config.PACKS[key]['body'] else name)
    B.reset_scene(name)
    path = config.body_glb(name)
    outdir = os.path.join(config.OUT, 'bodies')
    os.makedirs(outdir, exist_ok=True)
    mesh = import_body_mesh(path, sk.body)
    mesh.name = f'SK_{name}'
    mesh.data.name = f'SK_{name}'
    files = textures_beside(sk.body.g, os.path.join(outdir, 'textures', name))
    mats = sk.body.g.json['materials']
    for ms, gm in zip(mesh.data.materials, mats):
        LOG.setdefault('materials', []).append(dict(name=ms.name, alphaMode=gm.get('alphaMode', 'OPAQUE'),
                                                    alphaCutoff=gm.get('alphaCutoff'), doubleSided=gm.get('doubleSided', False),
                                                    **simplify_material(ms, files, gm.get('alphaMode', 'OPAQUE') == 'OPAQUE')))
    LOG['textures'] = {k: os.path.relpath(p, outdir) for k, p in files.items()}
    arm, rw, err = B.build_armature(sk)
    LOG['boneRestErrCm'] = err
    # bind: the mesh is already where the bind puts it (inverse bind = node chain to 1e-7 m)
    mesh.parent = arm
    md = mesh.modifiers.new('Armature', 'ARMATURE')
    md.object = arm
    missing = [g.name for g in mesh.vertex_groups if g.name not in arm.data.bones]
    assert not missing, missing
    LOG['shapeKeys'] = [k.name for k in mesh.data.shape_keys.key_blocks[1:]] if mesh.data.shape_keys else []
    LOG['bones'] = len(arm.data.bones)
    LOG['vertices'] = len(mesh.data.vertices)
    fbx = os.path.join(outdir, f'{name}.fbx')
    B.export_fbx(fbx, [arm, mesh], anim=False, mesh_smooth_type='FACE', use_mesh_modifiers=False,
                 use_tspace=False, path_mode='COPY', embed_textures=True, colors_type='SRGB')
    LOG['fbx'] = os.path.relpath(fbx, config.PROJECT)
    LOG['bytes'] = os.path.getsize(fbx)


# ------------------------------------------------------------------ animations

def do_anims(key, only, pack=None):
    """Clips of a pack on skeleton `key`: the rifle pack (pack None) or, pass U1, a vehicle pack
    (config.VEHICLE_PACKS key; its clips' root bone carries the place in the vehicle root's frame, converted
    like every other bone: glTF (x, 0, z) m -> FBX (100 x, -100 z, 0) cm, yaw about Z)."""
    sk = S.Skeleton(key, pack=pack)
    B.reset_scene('anims')
    arm, rw, err = B.build_armature(sk)
    outdir = os.path.join(config.OUT, 'animations', pack or key)
    os.makedirs(outdir, exist_ok=True)
    clips = only or sk.pack.names
    LOG['boneRestErrCm'] = err
    LOG['clips'] = {}
    for clip in clips:
        t = time.time()
        L = sk.clip_locals(clip, min_frames=2 if pack else 1)
        act = B.key_action(arm, sk, L, clip)
        bpy.context.scene.name = clip    # the FBX take is named after the scene
        fbx = os.path.join(outdir, f'{clip}.fbx')
        B.export_fbx(fbx, [arm], anim=True)
        arm.animation_data.action = None
        bpy.data.actions.remove(act)
        LOG['clips'][clip] = dict(frames=len(L), bytes=os.path.getsize(fbx), s=round(time.time() - t, 2))
        say(clip, len(L), 'frames', round(time.time() - t, 2), 's')
    # the clip notes beside the FBX (events, hold codes, root track, contacts)
    with open(os.path.join(outdir, 'notes.json'), 'w') as f:
        json.dump(sk.notes, f)


def do_apose(key):
    sk = S.Skeleton(key)
    B.reset_scene(f'{key}_apose')
    arm, rw, err = B.build_armature(sk)
    outdir = os.path.join(config.OUT, 'retarget')
    os.makedirs(outdir, exist_ok=True)
    A = sk.apose_locals()
    act = B.key_action(arm, sk, [A, A], f'{key}_apose')
    fbx = os.path.join(outdir, f'{key}_apose.fbx')
    B.export_fbx(fbx, [arm], anim=True)
    # also as numbers: local rotations (glTF terms) of the bones the pose turns away from the rest
    rest = sk.rest_local
    turned = {n: G.m_to_q(A[n][:3, :3]).round(7).tolist() for n in sk.bones
              if G.angle_deg(A[n][:3, :3], rest[n][:3, :3]) > 1e-4}
    with open(os.path.join(outdir, f'{key}_apose.json'), 'w') as f:
        json.dump({'skeleton': key, 'note': 'local rotations (glTF axes, x y z w) of the bones that differ from the '
                   'bind; every other bone at its bind rotation. Frames 0 and 1 of the FBX hold this pose.',
                   'local': turned}, f, indent=1)
    LOG['turnedBones'] = len(turned)


# ------------------------------------------------------------------ guns

def do_gun(name):
    cfg = config.GUNS[name]
    B.reset_scene(name)
    glb = G.GLB(cfg['glb'])
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=cfg['glb'])
    objs = [o for o in bpy.data.objects if o not in before]
    by = {o.name: o for o in objs}
    # the butt as the game measures it (weapon.js / shotgun.js): AABB of the butt part, glTF axes:
    # x = 0, y = 62 % of the way up, z = its back face
    cinv = B.C3.T

    def gl_verts(o):
        mw = np.array(o.matrix_world)
        v = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', v)
        v = v.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
        return v @ cinv.T

    def under(o):
        out = [o]
        for c in o.children:
            out += under(c)
        return out
    part = by[cfg['butt']]
    vs = np.vstack([gl_verts(o) for o in under(part) if o.type == 'MESH'])
    lo, hi = vs.min(0), vs.max(0)
    butt = np.array([0.0, lo[1] + 0.62 * (hi[1] - lo[1]), hi[2]])
    LOG['buttGltfM'] = butt.round(6).tolist()
    # gun frame = glTF axes, origin at the butt, cm. Vertices are written in those numbers (NOT turned
    # by the importer's Y-up -> Z-up change), so the mesh sits in the Gun bone's frame.
    T = np.eye(4)
    T[:3, :3] = cinv * B.CM
    T[:3, 3] = -butt * B.CM
    files = textures_beside(glb, os.path.join(config.OUT, 'weapons', 'textures', name))
    for m in bpy.data.materials:
        if m.node_tree and any(n.type == 'BSDF_PRINCIPLED' for n in m.node_tree.nodes) and m.users:
            simplify_material(m, files, True)
    keep = []
    nrm_err = 0.0
    for o in objs:
        mw = np.array(o.matrix_world)
        full = T @ mw
        if o.type == 'MESH':
            me = o.data
            if me.users > 1:
                me = o.data = me.copy()
            n0 = np.empty(len(me.loops) * 3)
            me.corner_normals.foreach_get('vector', n0) if hasattr(me, 'corner_normals') else None
            me.transform(B.M(full))
            n1 = np.empty(len(me.loops) * 3)
            me.corner_normals.foreach_get('vector', n1)
            want = n0.reshape(-1, 3) @ (cinv @ mw[:3, :3]).T
            want /= np.linalg.norm(want, axis=1, keepdims=True) + 1e-12
            nrm_err = max(nrm_err, float(np.abs(n1.reshape(-1, 3) - want).max()))
            keep.append(o)
        o.parent = None
        o.matrix_world = Matrix.Identity(4) if o.type == 'MESH' else B.M(full)
    LOG['normalErr'] = nrm_err
    root_mesh = by.get('receiver') if by.get('receiver') is not None and by['receiver'].type == 'MESH' else keep[0]
    sockets = []
    for o in objs:
        if o.type == 'EMPTY':
            if o.name in ('weapon_root',) or o.children:
                continue
            # point nodes (muzzle_point, eject_point, grip_main, grip_support, ...) -> Unreal sockets
            o.name = f'SOCKET_{o.name}'
            mwf = o.matrix_world.copy()
            o.parent = root_mesh
            o.matrix_world = mwf
            sockets.append(o)
    for o in objs:
        if o.type == 'EMPTY' and o not in sockets:
            bpy.data.objects.remove(o)
    for o in keep:
        o.name = f'{name}_{o.name}'
    LOG['parts'] = [o.name for o in keep]
    LOG['sockets'] = [o.name for o in sockets]
    allv = np.vstack([np.array([v.co for v in o.data.vertices]) for o in keep])
    LOG['boundsCm'] = [allv.min(0).round(2).tolist(), allv.max(0).round(2).tolist()]
    outdir = os.path.join(config.OUT, 'weapons')
    os.makedirs(outdir, exist_ok=True)
    fbx = os.path.join(outdir, f'{name}.fbx')
    B.export_fbx(fbx, keep + sockets, anim=False, mesh_smooth_type='FACE', use_mesh_modifiers=False,
                 path_mode='COPY', embed_textures=True)
    LOG['bytes'] = os.path.getsize(fbx)


# ------------------------------------------------------------------ pass U1: vehicles

def do_vehicle(name):
    """The vehicle as a skeletal mesh: one bone per GLB node (world-aligned frames, vehicle.py), every part
    with a mesh a separate mesh object rigidly bound (weight 1) to its own node's bone, vertices in the
    vehicle root's space (Blender axes, cm). Pivots = the bones' rests = the GLB's node transforms."""
    import vehicle as V
    veh = V.Vehicle(name)
    B.reset_scene(name)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=veh.glb)
    objs = [o for o in bpy.data.objects if o not in before]
    by = {o.name: o for o in objs}
    parts = {}
    for n in veh.mesh:
        o = by.get(n)
        assert o is not None and o.type == 'MESH', (n, o and o.type)
        parts[n] = o
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.hide_render = False
    # Each part's world from the GLB's rest (numpy), not from the importer's object: the importer leaves the
    # objects posed by the GLB's own clips at the scene frame (a door 1/30 s open). Importer mesh data are
    # node-local in Blender axes (C @ p), its object frames C @ G @ C^-1, so world = C @ G @ p.
    rw_gl = veh.rest_world()
    mws = {n: B.M(B.C4 @ rw_gl[n] @ B.C4.T) for n in parts}
    nrm_err = 0.0
    vtx_err = 0.0
    LOG['parts'] = {}
    for n, o in parts.items():
        if o.data.users > 1:
            o.data = o.data.copy()
        me = o.data
        n0 = np.empty(len(me.loops) * 3)
        me.corner_normals.foreach_get('vector', n0)
        o.parent = None
        for md in list(o.modifiers):
            o.modifiers.remove(md)
        me.transform(Matrix.Scale(B.CM, 4) @ mws[n])
        o.matrix_world = Matrix.Identity(4)
        n1 = np.empty(len(me.loops) * 3)
        me.corner_normals.foreach_get('vector', n1)
        R = np.array(mws[n])[:3, :3]
        want = n0.reshape(-1, 3) @ R.T
        want /= np.linalg.norm(want, axis=1, keepdims=True) + 1e-12
        ne = np.abs(n1.reshape(-1, 3) - want).max(1)
        nrm_err = max(nrm_err, float(ne.max()))
        # vertices against the GLB (numpy): same count and order expected from the importer
        have = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', have)
        have = have.reshape(-1, 3)
        gl = (B.C3 @ veh.part_vertices(n).T).T * B.CM
        if have.shape == gl.shape:
            d = float(np.abs(have - gl).max())
        else:
            d = None
        if d is not None:
            vtx_err = max(vtx_err, d)
        LOG['parts'][n] = dict(vertices=len(me.vertices), glbVertices=len(gl), vsGlbCm=d, normalErr=float(ne.max()),
                               cornersOff=int((ne > 1e-3).sum()), corners=len(ne), materials=[m.name for m in me.materials if m])
        me.name = f'{name}_{n}'
        o.name = f'{name}_{n}'
    LOG['normalErr'] = nrm_err
    LOG['vertexVsGlbCm'] = vtx_err
    for o in objs:
        if o.name not in [p.name for p in parts.values()]:
            data = o.data
            bpy.data.objects.remove(o)
            if data is not None and getattr(data, 'users', 1) == 0 and isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
    for coll in list(bpy.data.collections):
        if not coll.objects:
            bpy.data.collections.remove(coll)
    for o in parts.values():
        if o.name not in bpy.context.scene.collection.objects:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            bpy.context.scene.collection.objects.link(o)
    # textures as files beside, materials relinked so the exporter embeds base colour and normal
    outdir = os.path.join(config.OUT, 'vehicles')
    files = textures_beside(veh.g, os.path.join(outdir, 'textures', name))
    gmats = {m.get('name'): m for m in veh.g.json['materials']}
    LOG['materials'] = []
    for m in bpy.data.materials:
        if m.users and m.node_tree and any(nd.type == 'BSDF_PRINCIPLED' for nd in m.node_tree.nodes):
            gm = gmats.get(m.name, {})
            nt = m.node_tree
            linked = any(nd.type == 'BSDF_PRINCIPLED' and any(l.to_node == nd for l in nt.links) for nd in nt.nodes)
            # (a material of factors only, e.g. glass, has nothing to relink: its colour goes out as DiffuseColor)
            info = simplify_material(m, files, gm.get('alphaMode', 'OPAQUE') == 'OPAQUE') if linked else {'baseColor': None}
            LOG['materials'].append(dict(name=m.name, alphaMode=gm.get('alphaMode', 'OPAQUE'), **info))
    LOG['textures'] = {k: os.path.relpath(p, outdir) for k, p in files.items()}
    arm, rw, err = B.build_armature(veh)
    LOG['boneRestErrCm'] = err
    LOG['bones'] = len(arm.data.bones)
    for n, o in parts.items():
        o.parent = arm
        md = o.modifiers.new('Armature', 'ARMATURE')
        md.object = arm
        vg = o.vertex_groups.new(name=n)
        vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    LOG['hiddenInGlb'] = veh.hidden
    fbx = os.path.join(outdir, f'{name}.fbx')
    B.export_fbx(fbx, [arm] + list(parts.values()), anim=False, mesh_smooth_type='FACE', use_mesh_modifiers=False,
                 use_tspace=False, path_mode='COPY', embed_textures=True)
    LOG['fbx'] = config.rel(fbx)
    LOG['bytes'] = os.path.getsize(fbx)
    LOG['vertices'] = sum(len(o.data.vertices) for o in parts.values())


def do_vehicle_anims(name, group, only):
    """Animations on the vehicle skeleton (Armature null + the vehicle's bones, no mesh), 30 fps, every frame:
    group `own` = the vehicle GLB's own clips (doors_open, main_rotor_spin, ...); group = a vehicle pack key =
    the vehicle side of each of that pack's clips for this vehicle (the door per frame from the notes, the
    controls the clip was authored with, the pack's vehicleFit on its nodes), plus `fit` (the fit alone, door
    shut, controls at rest, 2 frames). Files vehicles/animations/<group>/<vehicle>_<clip>.fbx."""
    import vehicle as V
    veh = V.Vehicle(name)
    B.reset_scene('vehicle_anims')
    arm, rw, err = B.build_armature(veh)
    outdir = os.path.join(config.OUT, 'vehicles', 'animations', group)
    os.makedirs(outdir, exist_ok=True)
    LOG['boneRestErrCm'] = err
    LOG['clips'] = {}
    jobs = []
    if group == 'own':
        for clip in only or veh.own_clips():
            jobs.append((clip, lambda clip=clip: veh.own_clip_locals(clip)))
    else:
        cfg = config.VEHICLE_PACKS[group]
        notes = json.load(open(cfg['notes']))
        fit = V.fit_of(notes, veh.kind)
        pack = G.ClipPack(cfg['pack'])
        names = [c for c, v in notes['clips'].items() if v['vehicle'] == veh.kind] + ['fit']
        for clip in only or names:
            if clip == 'fit':
                jobs.append((clip, lambda: [veh.pose({}, fit)] * 2))
                continue
            nf = max(2, V.pack_keys(pack, clip))
            ctls = V.clip_controls(veh.kind, clip, notes['clips'][clip], nf)
            jobs.append((clip, lambda ctls=ctls: [veh.pose(c, fit) for c in ctls]))
    for clip, make in jobs:
        t = time.time()
        L = make()
        take = f'{name}_{clip}'
        act = B.key_action(arm, veh, L, take)
        bpy.context.scene.name = take
        fbx = os.path.join(outdir, f'{take}.fbx')
        B.export_fbx(fbx, [arm], anim=True)
        arm.animation_data.action = None
        bpy.data.actions.remove(act)
        LOG['clips'][clip] = dict(frames=len(L), bytes=os.path.getsize(fbx), s=round(time.time() - t, 2))
        say(take, len(L), 'frames', round(time.time() - t, 2), 's')


if mode == 'body':
    do_body(arg)
elif mode == 'anims':
    do_anims(arg, rest)
elif mode == 'vanims':        # pass U1: a vehicle clip pack (config.VEHICLE_PACKS key)
    do_anims(config.VEHICLE_PACKS[arg]['skeleton'], rest, pack=arg)
elif mode == 'vehicle':
    do_vehicle(arg)
elif mode == 'vehanims':      # vehanims <vehicle> <own | vehicle pack key> [clip ...]
    do_vehicle_anims(arg, rest[0], rest[1:])
elif mode == 'apose':
    do_apose(arg)
elif mode == 'gun':
    do_gun(arg)
else:
    raise SystemExit(f'unknown mode {mode}')
LOG['seconds'] = round(time.time() - t0, 1)
os.makedirs(os.path.join(config.OUT, 'review', 'build'), exist_ok=True)
tag = f'{mode}-{arg}' + (f'-{rest[0]}-{len(rest)}' if rest else '')
with open(os.path.join(config.OUT, 'review', 'build', f'{tag}.json'), 'w') as f:
    json.dump(LOG, f, indent=1)
say('done', mode, arg, LOG.get('seconds'), 's')
