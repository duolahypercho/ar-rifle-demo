"""Proof for the re-rig (pass R1): equivalence numbers, range-of-motion poses and metrics, the eye
check, the A-pose bind test, and Blender renders / contact sheets (Workbench, clay)."""
import math
import pathlib

import numpy as np

from . import ue5

D = math.radians
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
CLIPS = 'public/characters/rifle-motion-v1.glb'
# poses from the clip pack: (label, clip, time s)
POSES = [
    ('idle carry', 'rifle-idle', 2.0),
    ('aim level', 'rifle-aim-level', 0.0),
    ('aim up', 'rifle-aim-up', 0.0),
    ('reload mid', 'reload-rifle-tac', 1.15),
    ('crouch', 'rifle-crouch-idle', 1.0),
    ('sprint mid-stride', 'rifle-sprint', 0.43),
    ('swap', 'swap-rifle-shotgun', 0.65),
    ('walk', 'rifle-walk-f', 0.5),
]


def R(axis, deg):
    return ue5.axis_angle(axis, D(deg))


class Mesh:
    """A primitive's rest data, welded by position for edges and rendering."""

    def __init__(self, body, prim=0):
        p = body.prims[prim]
        self.pos, self.tris = p['pos'], p['tris']
        key = np.round(self.pos, 6)
        _, first, weld = np.unique(key, axis=0, return_index=True, return_inverse=True)
        self.weld, self.first = weld.ravel(), first
        t = self.weld[self.tris]
        keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
        self.wtris = t[keep]
        e = np.concatenate([self.wtris[:, [0, 1]], self.wtris[:, [1, 2]], self.wtris[:, [2, 0]]])
        e.sort(1)
        self.edges = np.unique(e, axis=0)
        self.wrest = self.pos[first]
        self.l0 = np.linalg.norm(self.wrest[self.edges[:, 0]] - self.wrest[self.edges[:, 1]], axis=1)
        self.piece = ue5.components(self.pos, self.tris)

    def strain(self, posed, mask=None):
        """|edge length / rest length - 1| over edges with both ends in `mask` (welded verts)."""
        w = posed[self.first]
        l = np.linalg.norm(w[self.edges[:, 0]] - w[self.edges[:, 1]], axis=1)
        s = np.abs(l / np.maximum(self.l0, 1e-9) - 1)
        if mask is not None:
            m = mask[self.first]
            s = s[m[self.edges[:, 0]] & m[self.edges[:, 1]]]
        return s


def old_posed(body, local, hips=None):
    Wo, Po = ue5.old_world(body, local, hips)
    p = body.prims[0]
    return ue5.skin(p['pos'], p['joints'], p['weights'], ue5.old_skin_mats(body, Wo, Po)), Wo, Po


def new_posed(skel, nb, L, T=None):
    Wn, Pn = ue5.fk(skel, L, T or {})
    return ue5.skin(nb.pos, nb.J, nb.W, ue5.new_skin_mats(skel, Wn, Pn, nb.ibm)), Wn, Pn


def twist_mask(skel, nb, at=0.01):
    """Vertices with any weight on a twist bone."""
    tw = np.array([skel.bones[n]['rule'][0] == 'twist' for n in skel.order])
    return (np.where(tw[nb.J], nb.W, 0).sum(1) > at)


def dominant(skel, nb, i):
    return skel.order[nb.J[i, np.argmax(nb.W[i])]]


def equivalence(body, skel, nb, mesh, root):
    """Per clip pose: deviation of the new body (mapped pose) from the old, twist bones off and on."""
    rows = []
    tmask = twist_mask(skel, nb)
    for label, clip, t in POSES:
        local, hips, _ = ue5.clip_frame(root / CLIPS, clip, t)
        old, _, _ = old_posed(body, local, hips)
        row = dict(label=label, clip=clip, t=t)
        for twist in (False, True):
            L, T = ue5.map_pose(body, skel, local, hips, twist=twist)
            new, _, _ = new_posed(skel, nb, L, T)
            d = np.linalg.norm(new - old, axis=1) * 1000
            key = 'on' if twist else 'off'
            row[key] = dict(max=d.max(), p99=np.percentile(d, 99))
            if twist:
                rest = d[~tmask]
                tw = d[tmask]
                i = int(np.argmax(np.where(tmask, d, -1)))
                j = int(np.argmax(np.where(~tmask, d, -1)))
                row['on'].update(rest_max=rest.max(), rest_p99=np.percentile(rest, 99), tw_max=tw.max(),
                                 tw_p99=np.percentile(tw, 99), tw_mean=tw.mean(), tw_where=dominant(skel, nb, i),
                                 rest_where=dominant(skel, nb, j), rest_at=body.prims[0]['pos'][j])
                # per piece (connected parts of the one mesh: body, clothes, hair, eyes, ...)
                pieces = {}
                for k in np.unique(mesh.piece):
                    m = mesh.piece == k
                    pieces[int(k)] = (int(m.sum()), float(d[m].max()), float(np.percentile(d[m], 99)))
                row['pieces'] = pieces
        rows.append(row)
    return rows


def piece_names(body, skel, nb, mesh):
    """A rough name for each connected piece: its size, height and the old joint most of it rides."""
    p = body.prims[0]
    out = {}
    for k in np.unique(mesh.piece):
        m = np.nonzero(mesh.piece == k)[0]
        dom = np.bincount(p['joints'][m, 0], weights=p['weights'][m, 0], minlength=len(body.joints))
        lo, hi = p['pos'][m].min(0), p['pos'][m].max(0)
        out[int(k)] = dict(n=len(m), joint=body.joints[int(np.argmax(dom))], y=(round(float(lo[1]), 3), round(float(hi[1]), 3)),
                           x=(round(float(lo[0]), 3), round(float(hi[0]), 3)))
    return out


# ----------------------------------------------------------------------------- range of motion
# old local rotations (the old frames are the world's at rest), left side

def rom_poses():
    fwd = R((-1, 0, 0), 90)            # a limb hanging down swung forward 90
    return [
        # name, old pose, new-only overrides (None: the mapped pose), camera (target joint(s), view dir, distance)
        ('forearm twist +90', {'LeftForeArm': fwd, 'LeftHand': R((0, -1, 0), 90)}, None, (['LeftForeArm', 'LeftHand'], (1, 0.7, 0.35), 0.62)),
        ('forearm twist -90', {'LeftForeArm': fwd, 'LeftHand': R((0, -1, 0), -90)}, None, (['LeftForeArm', 'LeftHand'], (1, 0.7, 0.35), 0.62)),
        ('upper arm forward 90', {'LeftArm': fwd}, None, (['LeftArm'], (1, 0.3, -0.35), 0.8)),
        ('upper arm side 90', {'LeftArm': R(Z, 90)}, None, (['LeftArm'], (0.1, 0.05, 1), 0.8)),
        ('upper arm twist +70', {'LeftArm': R((0, -1, 0), 70), 'LeftForeArm': fwd}, None, (['LeftArm', 'LeftForeArm'], (0.6, 0.3, 1), 0.85)),
        ('upper arm twist -70', {'LeftArm': R((0, -1, 0), -70), 'LeftForeArm': fwd}, None, (['LeftArm', 'LeftForeArm'], (0.6, 0.3, 1), 0.85)),
        ('elbow full 145', {'LeftForeArm': R((-1, 0, 0), 145)}, None, (['LeftForeArm'], (1, 0.1, 0.15), 0.6)),
        ('wrist flex 70', {'LeftHand': R((-1, 0, 0), 70)}, None, (['LeftHand'], (1, 0.1, 0.2), 0.45)),
        ('wrist extend 60', {'LeftHand': R((-1, 0, 0), -60)}, None, (['LeftHand'], (1, 0.1, 0.2), 0.45)),
    ]


def trunk_poses():
    sp = R(X, 15) @ R(Y, 40 / 3)
    sp5 = R(X, 9) @ R(Y, 8)
    return [
        ('spine bend 45 + twist 40', {'Spine': sp, 'Spine1': sp, 'Spine2': sp},
         {f'spine_0{k}': sp5 for k in range(1, 6)}, (['Spine1'], (0.7, 0.35, 1), 1.25)),
        ('knee deep (crouch)', {'LeftUpLeg': R((-1, 0, 0), 100), 'LeftLeg': R(X, 140)}, None, (['LeftUpLeg', 'LeftLeg'], (1, 0.25, 0.1), 1.15)),
        ('neck turn 70', {'Neck': R(Y, 45), 'Head': R(Y, 25)},
         {'neck_01': R(Y, 31.5), 'neck_02': R(Y, 13.5), 'head': R(Y, 25)}, (['Neck', 'Head'], (0.3, 0.1, 1), 0.6)),
    ]


def apply_overrides(skel, L, overrides):
    """Overrides are pose deltas in each bone's own rest frame (spine and neck frames are the
    world's at rest, so these are the same axes as the old joints')."""
    L = dict(L)
    for name, d in (overrides or {}).items():
        L0, _ = skel.local_rest(name)
        L[name] = L0 @ d
    return L


def forearm_pinch(body, posed, Wo_or_none, Po, side='Left'):
    """Candy-wrapper measure: for skin within 6 cm of the wrist along the forearm, the distance from
    the posed forearm axis against the rest distance (1 = kept; under 1 = collapsed)."""
    p = body.prims[0]
    a, b = body.P[side + 'ForeArm'], body.P[side + 'Hand']
    d = b - a
    t = ((p['pos'] - a) @ d) / (d @ d)
    radial0 = np.linalg.norm((p['pos'] - a) - np.outer(t, d), axis=1)
    ks = [body.joints.index(side + 'ForeArm'), body.joints.index(side + 'Hand')]
    arm_w = np.where(np.isin(p['joints'], ks), p['weights'], 0).sum(1)
    sel = (t > 0.7) & (t < 1.08) & (radial0 < 0.06) & (radial0 > 0.01) & (arm_w > 0.9)
    A, B = Po[side + 'ForeArm'], Po[side + 'Hand']
    e = B - A
    q = posed[sel] - A
    tt = (q @ e) / (e @ e)
    radial = np.linalg.norm(q - np.outer(tt, e), axis=1)
    ratio = radial / radial0[sel]
    return float(ratio.min()), float(np.percentile(ratio, 5)), float(ratio.mean())


# ----------------------------------------------------------------------------- A-pose

def apose_old():
    """The UE5 Mannequin-like A-pose, on the old rig: arms 45 degrees below horizontal, elbows bent
    15, palms turned down and in (upper arm 40 in, forearm 50 in), legs 4 degrees apart."""
    out = {}
    for side, sign in (('Left', 1), ('Right', -1)):
        out[side + 'Arm'] = R(Z, 45 * sign) @ R((0, -1, 0), 40 * sign)
        out[side + 'ForeArm'] = R((-1, 0, 0), 15)
        out[side + 'Hand'] = R((0, -1, 0), 50 * sign)
        out[side + 'UpLeg'] = R(Z, 4 * sign)
    return out


class Rebound:
    """The same skeleton and weights bound in another pose (A-pose): rest frames, heads and the
    bind mesh are the I-bound rig's posed there."""

    def __init__(self, skel, nb, L, T=None):
        posed, W, P = new_posed(skel, nb, L, T)
        self.pos = posed
        self.R = W
        self.P = P
        self.ibm = np.stack([np.linalg.inv(ue5._mat4(W[n], P[n])) for n in skel.order])

    def posed(self, skel, nb, Wt, Pt):
        mats = np.stack([ue5._mat4(Wt[n], Pt[n]) @ self.ibm[k] for k, n in enumerate(skel.order)])
        return ue5.skin(self.pos, nb.J, nb.W, mats)


# ----------------------------------------------------------------------------- Blender

def blender():
    import bpy
    from mathutils import Matrix, Vector
    return bpy, Matrix, Vector


def g2b(v):
    return (v[0], -v[2], v[1])


class Stage:
    """A review scene: clay meshes updated per pose, one camera, a label; renders PNG panels and
    tiles them into sheets."""

    def __init__(self, name, mesh, size=520):
        bpy, Matrix, Vector = blender()
        self.bpy = bpy
        scene = bpy.data.scenes.get(name) or bpy.data.scenes.new(name)
        self.scene = scene
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.render.resolution_x = scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.film_transparent = False
        sh = scene.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'OBJECT'
        sh.show_cavity = True
        sh.cavity_type = 'BOTH'
        sh.show_shadows = False
        world = bpy.data.worlds.get('ue5_review_world') or bpy.data.worlds.new('ue5_review_world')
        world.color = (0.16, 0.17, 0.19)
        scene.world = world
        self.mesh = mesh
        me = bpy.data.meshes.get(name + '_clay')
        if me is None:
            me = bpy.data.meshes.new(name + '_clay')
            verts = [g2b(v) for v in mesh.wrest]
            me.from_pydata(verts, [], [tuple(int(i) for i in t) for t in mesh.wtris])
            me.update()
            for poly in me.polygons:
                poly.use_smooth = True
        obj = bpy.data.objects.get(name + '_clay') or bpy.data.objects.new(name + '_clay', me)
        if obj.name not in scene.collection.objects:
            scene.collection.objects.link(obj)
        obj.color = (0.78, 0.72, 0.66, 1)
        self.obj = obj
        cam_data = bpy.data.cameras.get(name + '_cam') or bpy.data.cameras.new(name + '_cam')
        cam_data.lens = 50
        cam_data.clip_start = 0.01
        cam = bpy.data.objects.get(name + '_cam') or bpy.data.objects.new(name + '_cam', cam_data)
        if cam.name not in scene.collection.objects:
            scene.collection.objects.link(cam)
        scene.camera = cam
        self.cam = cam
        txt_data = bpy.data.curves.get(name + '_label') or bpy.data.curves.new(name + '_label', 'FONT')
        txt = bpy.data.objects.get(name + '_label') or bpy.data.objects.new(name + '_label', txt_data)
        if txt.name not in scene.collection.objects:
            scene.collection.objects.link(txt)
        txt.parent = cam
        txt.location = (-0.0345, 0.0315, -0.1)   # close to the lens so the mesh never hides it
        txt_data.size = 0.0029
        txt.color = (1.0, 0.85, 0.3, 1)
        self.txt = txt

    def show(self, posed_g, label, target_g, view_dir_g, dist):
        bpy, Matrix, Vector = blender()
        w = posed_g[self.mesh.first]
        co = np.column_stack([w[:, 0], -w[:, 2], w[:, 1]]).astype(np.float32).ravel()
        self.obj.data.vertices.foreach_set('co', co)
        self.obj.data.update()
        tgt = Vector(g2b(target_g))
        d = Vector(g2b(np.asarray(view_dir_g, float) / np.linalg.norm(view_dir_g)))
        self.cam.location = tgt + d * dist
        self.cam.rotation_mode = 'QUATERNION'
        self.cam.rotation_quaternion = (tgt - self.cam.location).to_track_quat('-Z', 'Y')
        self.txt.data.body = label

    def render(self, path):
        bpy = self.bpy
        win = bpy.context.window
        prev = win.scene
        win.scene = self.scene
        try:
            self.scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True, scene=self.scene.name)
        finally:
            win.scene = prev
        return path


def tile(paths_grid, out_path, gap=6):
    """Rows of PNG paths (None = blank) into one sheet."""
    bpy, _, _ = blender()
    imgs = {}
    h = w = None
    for row in paths_grid:
        for p in row:
            if p is None or str(p) in imgs:
                continue
            im = bpy.data.images.load(str(p), check_existing=False)
            a = np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4)
            imgs[str(p)] = a
            h, w = a.shape[:2]
            bpy.data.images.remove(im)
    rows, cols = len(paths_grid), max(len(r) for r in paths_grid)
    H, Wd = rows * h + (rows + 1) * gap, cols * w + (cols + 1) * gap
    sheet = np.zeros((H, Wd, 4), np.float32)
    sheet[..., 3] = 1
    sheet[..., :3] = 0.05
    for r, row in enumerate(paths_grid):
        for c, p in enumerate(row):
            if p is None:
                continue
            y0 = H - (r + 1) * (h + gap)      # Blender images are bottom-up
            x0 = gap + c * (w + gap)
            sheet[y0:y0 + h, x0:x0 + w] = imgs[str(p)]
    img = bpy.data.images.new(pathlib.Path(out_path).stem, Wd, H, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = str(out_path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return out_path
