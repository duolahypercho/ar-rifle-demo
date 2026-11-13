"""Judging a clip in Blender before it is exported: numbers from the baked skeleton, a mesh test
of the gun against the posed body, and contact sheets to look at.

Numbers (all from the bake, glTF space, the clip played at its own ground speed):
  slide      how fast the part of a foot that is down (back of the heel or the ball, within 8 mm
             of the ground, as the game's review judges it) moves over the ground: mean / max m/s
  kneeMin    the straightest either knee gets (degrees of bend)
  gapCm      the closest the ankles / the knees come to each other (joint centres)
  gripCm     the furthest each palm (left / right) is from its place on the gun; in a handling clip,
             from wherever the clip says that hand holds a gun (frames it holds nothing are left out)
  seam       the loop's join: the largest joint step across it against the largest step anywhere
             else (a ratio; 1 or under is seamless), and the same for the change of velocity
  clearCm    the least the ball and the heel of a swinging foot clear the ground
  hipsY      the Hips height, lowest..highest (m), and hipsVsIdle, its mean against the idle's (cm)
  feetCm     the widest the ankles get apart: straight-line / across (joint centres)
  elbowDeg   each elbow's bend (left / right, least..most; 0 is a straight arm)
  elbowOutCm how far each elbow is out from its shoulder, across the chest (+ out, - tucked in)
  wristDeg   each wrist's bend at its worst over the clip: flexion (+ towards the palm) and
             deviation (+ towards the thumb, - towards the little finger), left / right
  gunClearCm (MeshTest) how far the gun stays off the posed, skinned body in every frame tested:
             the body is blown up by that much and the gun still does not touch it (the butt
             pad's face, which beds into the shoulder, and the hands, which hold the gun, left
             out; at more than nothing also each forearm where its hand holds the gun); with the
             slung gun tested too, the least of both, and slungClearCm the slung gun's alone
"""
import math
import pathlib

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

from . import body
from .carry import PALM_LOCAL
from .skel import b2g, bone, is_finger

HEEL = Vector(body.T['review']['heel'])  # back of the heel from the ankle, foot frame (character.js HEEL)
# how high the back of the heel and the ball joint are over the ground with the foot flat
HEEL_Y, BALL_Y = body.T['review']['heelY'], body.T['review']['ballY']
DOWN = 0.008
FPS = 30
# a body part (the canonical bone a vertex mostly follows) the gun may touch: the hand and fingers
HAND_PART = lambda part: part.startswith('hand_') or is_finger(part)  # noqa: E731
# twist and in-between bones count as the bone whose old joint they took weight from
PART_OF = {'spine_02': 'spine_01', 'spine_04': 'spine_03', 'neck_02': 'neck_01'}


def arms(f):
    """Per arm: elbow bend, elbow out from the shoulder (chest frame), wrist flexion and deviation."""
    out = {}
    chest = f['rot']['spine_05'].inverted()
    for side, sign in (('Left', 1), ('Right', -1)):
        sh, el, wr = f['pos'][bone(side, 'upperarm')], f['pos'][bone(side, 'lowerarm')], f['pos'][bone(side, 'hand')]
        bend = math.degrees((el - sh).angle(wr - el))
        d = f['rot'][bone(side, 'hand')].inverted() @ (wr - el).normalized()  # forearm, in the hand's frame
        flex = math.degrees(math.atan2(-d.z, -d.y))
        # (bent towards the thumb, the forearm leans the other way in the hand's frame; the left
        # thumb is on the hand's +X, the right one on its -X)
        dev = -math.degrees(math.atan2(d.x, -d.y)) * sign
        elbow_out = (chest @ (el - sh)).x * sign
        out[side] = (bend, elbow_out, flex, dev)
    return out


def metrics(frames, meta, carry, idle_hips=None, grips=None, carry2=None):
    """grips: per frame, {side: ('gun' | 'gun2', palm point in that gun's own frame) or None}, for
    a handling clip whose hands come and go from the guns."""
    n = len(frames)
    speed = meta['speed']
    ground_v = Vector((meta['dir'][0], 0, meta['dir'][1])) * speed
    slide, slide_max, down = 0.0, 0.0, 0
    clear = [math.inf, math.inf]
    knee_min, ankle_gap, knee_gap, grip = math.inf, math.inf, math.inf, {'Left': 0.0, 'Right': 0.0}
    feet_far, feet_across = 0.0, 0.0
    arm = {side: [math.inf, -math.inf, math.inf, -math.inf, 0.0, 0.0] for side in ('Left', 'Right')}

    root = meta.get('root')  # a clip that moves over the ground: per frame [x, z, yaw] of its root

    def parts(i, side):
        """Back of the heel and the ball, in the world for a clip with a root."""
        f = frames[i]
        ankle = f['pos'][bone(side, 'foot')]
        out = (ankle + f['rot'][bone(side, 'foot')] @ HEEL, f['pos'][bone(side, 'ball')])
        if root:
            x, z, yaw = root[i]
            out = tuple(Quaternion((0, 1, 0), yaw) @ p + Vector((x, 0, z)) for p in out)
        return out

    loop = meta['loop']
    for i, f in enumerate(frames):
        i0, i1 = ((i - 1) % n, (i + 1) % n) if loop else (max(0, i - 1), min(n - 1, i + 1))
        for side in ('Left', 'Right'):
            heel, ball = parts(i, side)
            heel_down = heel.y <= HEEL_Y + DOWN
            ball_down = ball.y <= BALL_Y + DOWN
            if heel_down or ball_down:
                k = 0 if (heel_down and (not ball_down or heel.y - HEEL_Y <= ball.y - BALL_Y)) else 1
                v = (parts(i1, side)[k] - parts(i0, side)[k]) * (FPS / max(1, i1 - i0 if not loop else 2)) + ground_v
                v.y = 0
                slide += v.length
                slide_max = max(slide_max, v.length)
                down += 1
            else:
                clear[0] = min(clear[0], ball.y - BALL_Y)
                clear[1] = min(clear[1], heel.y - HEEL_Y)
            hip, knee, ankle = f['pos'][bone(side, 'thigh')], f['pos'][bone(side, 'calf')], f['pos'][bone(side, 'foot')]
            knee_min = min(knee_min, math.degrees((knee - hip).angle(ankle - knee)))
            if grips is None:
                want = carry.point({'butt': f['gun'][0], 'quat': f['gun'][1]}, carry.palm[side])
            elif grips[i].get(side):
                which, local = grips[i][side][:2]
                c = carry if which == 'gun' else carry2
                want = c.point({'butt': f[which][0], 'quat': f[which][1]}, local)
            else:
                want = None
            if want is not None:
                palm = f['pos'][bone(side, 'hand')] + f['rot'][bone(side, 'hand')] @ PALM_LOCAL
                grip[side] = max(grip[side], (palm - want).length)
        apart = f['pos']['foot_l'] - f['pos']['foot_r']
        ankle_gap = min(ankle_gap, apart.length)
        feet_far = max(feet_far, apart.length)
        feet_across = max(feet_across, abs(apart.x))
        for side, (bend, out, flex, dev) in arms(f).items():
            a = arm[side]
            a[0], a[1] = min(a[0], bend), max(a[1], bend)
            a[2], a[3] = min(a[2], out), max(a[3], out)
            a[4] = flex if abs(flex) > abs(a[4]) else a[4]
            a[5] = dev if abs(dev) > abs(a[5]) else a[5]
        knee_gap = min(knee_gap, (f['pos']['calf_l'] - f['pos']['calf_r']).length)

    # the loop's join, for every joint: step and change of velocity at the seam against elsewhere
    seam = '-'
    if n > 3 and loop:
        names = [j for j in frames[0]['pos'] if j not in SEAM_SKIP]
        pts = np.array([[list(f['pos'][j]) for j in names] for f in frames])  # n x joints x 3
        step = np.linalg.norm(np.roll(pts, -1, axis=0) - pts, axis=2)  # step i: frame i -> i+1 (wraps)
        accel = np.linalg.norm(np.roll(pts, -1, axis=0) - 2 * pts + np.roll(pts, 1, axis=0), axis=2)
        seam_step = step[n - 1].max() / max(1e-9, step[:n - 1].max())
        seam_acc = max(accel[0].max(), accel[n - 1].max()) / max(1e-9, accel[1:n - 1].max())
        seam = f'{seam_step:.2f} / {seam_acc:.2f}'
    return dict(
        slide=f'{slide / max(1, down):.3f} / {slide_max:.3f}',
        kneeMin=round(knee_min, 1),
        gapCm=f'{ankle_gap * 100:.1f} / {knee_gap * 100:.1f}',
        gripCm=f'{grip["Left"] * 100:.2f} / {grip["Right"] * 100:.2f}',
        seam=seam,
        clearCm=f'{clear[0] * 100:.1f} / {clear[1] * 100:.1f}' if clear[0] < math.inf else '-',
        headY=f'{min(f["pos"]["head"].y for f in frames):.3f}..{max(f["pos"]["head"].y for f in frames):.3f}',
        hipsY=f'{min(f["hips"].y for f in frames):.3f}..{max(f["hips"].y for f in frames):.3f}',
        hipsVsIdle='-' if idle_hips is None else f'{(sum(f["hips"].y for f in frames) / n - idle_hips) * 100:+.1f}',
        feetCm=f'{feet_far * 100:.0f} / {feet_across * 100:.0f}',
        elbowDeg=' / '.join(f'{arm[s][0]:.0f}..{arm[s][1]:.0f}' for s in ('Left', 'Right')),
        elbowOutCm=' / '.join(f'{arm[s][2] * 100:.0f}..{arm[s][3] * 100:.0f}' for s in ('Left', 'Right')),
        wristDeg=' / '.join(f'flex {arm[s][4]:+.0f} dev {arm[s][5]:+.0f}' for s in ('Left', 'Right')),
    )


def jumps(frames):
    """The worst one-frame change of velocity (m/s, as the game's snap) of each hand and the
    muzzle: left / right / muzzle."""
    out = []
    for track in ([f['pos']['hand_l'] for f in frames], [f['pos']['hand_r'] for f in frames],
                  [f['gun'][0] + f['gun'][1] @ Vector((0, 0, -0.8)) for f in frames]):
        v = [(b - a) * FPS for a, b in zip(track, track[1:])]
        out.append(max(((b - a).length for a, b in zip(v, v[1:])), default=0.0))
    return ' / '.join(f'{x:.1f}' for x in out)


# the seam measure runs over the bones that took over an old joint (as before), the eyes left out:
# the eye bones moved to the ball centres
SEAM_SKIP = ('spine_02', 'spine_04', 'neck_02', 'eye_l', 'eye_r')


def part_of(group):
    """The body part a vertex group counts towards: twist bones to their limb bone, metacarpals to
    the hand, the in-between spine and neck bones to the one below (the old joint they split)."""
    if '_twist_' in group:
        return group.split('_twist_')[0] + group[-2:]
    if '_metacarpal_' in group:
        return 'hand' + group[-2:]
    return PART_OF.get(group, group)


class MeshTest:
    """BVH overlap between the guns' meshes and the posed body (and between the two guns), and how
    far they stay clear."""

    STEPS = (0.5, 1.0, 1.5, 2.0, 3.0)  # cm the body is blown up by, in turn
    HELD = {'lowerarm_r': ('pistol_grip', 'stock'), 'lowerarm_l': ('handguard', 'pump')}  # a forearm by what its hand holds

    def __init__(self, body, gun_meshes, pad, slung_meshes=()):
        self.body, self.gun, self.pad, self.slung = body, gun_meshes, pad, list(slung_meshes)
        groups = {g.index: g.name for g in body.vertex_groups}
        self.part = []
        for v in body.data.vertices:  # which bone each vertex mostly follows, its weight summed
            total = {}                 # over the bones that took over one old joint
            for e in v.groups:
                part = part_of(groups.get(e.group, ''))
                total[part] = total.get(part, 0.0) + e.weight
            self.part.append(max(total, key=total.get) if total else '')

    def _overlaps(self, gun, inflate, bedded=True, meshes=None, held=True):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        turn = mw.to_3x3()
        verts = [mw @ v.co + (turn @ v.normal).normalized() * inflate for v in mesh.vertices]
        keep = [p for p in mesh.polygons if not HAND_PART(self.part[p.vertices[0]])]
        tree = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in keep])
        owner = [self.part[p.vertices[0]] for p in keep]
        ev.to_mesh_clear()
        butt, quat = gun
        back = quat.inverted()
        where = {}
        for obj in (self.gun if meshes is None else meshes):
            name = obj.name.split('.')[0]
            oe = obj.evaluated_get(dg)
            m = oe.to_mesh()
            rv = [oe.matrix_world @ v.co for v in m.vertices]
            polys = [tuple(p.vertices) for p in m.polygons]
            rt = BVHTree.FromPolygons(rv, polys)
            for body_i, gun_i in tree.overlap(rt):
                centre = sum((rv[k] for k in polys[gun_i]), Vector()) / len(polys[gun_i])
                if bedded and name == self.pad and (back @ (b2g(centre) - butt)).z > -0.02:
                    continue  # the butt pad's face, bedded into the shoulder
                part = owner[body_i]
                if held and inflate > 0 and name in self.HELD.get(part, ()):
                    continue
                key = f'{part}/{name}'
                where[key] = where.get(key, 0) + 1
            oe.to_mesh_clear()
        return where

    def clearance(self, gun, bedded=True, held=True):
        """(overlaps at the skin {body part/gun part: triangle pairs}, cm of clearance) of the gun in
        the hands; `bedded`: its butt pad is in the shoulder; `held`: a forearm may touch what
        its hand holds."""
        bare = self._overlaps(gun, 0.0, bedded, held=held)
        if bare:
            return bare, 0.0
        clear = 0.0
        self.limit = None
        for cm in self.STEPS:
            hit = self._overlaps(gun, cm / 100, bedded, held=held)
            if hit:
                # (what the clearance stops at: the parts that meet first)
                self.limit = '+'.join(k for k, _ in sorted(hit.items(), key=lambda kv: -kv[1])[:2])
                break
            clear = cm
        return bare, clear

    def slung_clearance(self, gun2, held=False):
        """The same for the other gun (on the back, or on its way on or off it): its butt pad is not
        bedded anywhere; `held`: a hand has it (in a swap)."""
        bare = self._overlaps(gun2, 0.0, False, self.slung, held=held)
        if bare:
            return {'slung/' + k: v for k, v in bare.items()}, 0.0
        clear = 0.0
        self.limit2 = None
        for cm in self.STEPS:
            hit = self._overlaps(gun2, cm / 100, False, self.slung, held=held)
            if hit:
                self.limit2 = '+'.join(k for k, _ in sorted(hit.items(), key=lambda kv: -kv[1])[:2])
                break
            clear = cm
        return {}, clear

    def guns_touch(self):
        """Triangle pairs where the two guns pass through each other."""
        dg = bpy.context.evaluated_depsgraph_get()

        def tree(objs):
            verts, polys = [], []
            for obj in objs:
                oe = obj.evaluated_get(dg)
                m = oe.to_mesh()
                k = len(verts)
                verts += [oe.matrix_world @ v.co for v in m.vertices]
                polys += [tuple(k + i for i in p.vertices) for p in m.polygons]
                oe.to_mesh_clear()
            return BVHTree.FromPolygons(verts, polys)
        return len(tree(self.gun).overlap(tree(self.slung)))


VIEWS = {  # camera position (B), what it looks at, orthographic scale
    'front': (Vector((0, -4, 0.95)), Vector((0, 0, 0.95)), 2.0),
    'side': (Vector((4, 0, 0.95)), Vector((0, 0, 0.95)), 2.0),
    'back': (Vector((0, 4, 0.95)), Vector((0, 0, 0.95)), 2.0),
    'top': (Vector((0, 0.0001, 4)), Vector((0, 0, 0)), 2.0),
    # close on the hands and the gun, from the front and the shooter's left, a little above
    'hands': (Vector((2.6, -3.0, 2.2)), Vector((0.02, -0.12, 1.2)), 0.85),
}
GAIT_VIEWS = ('front', 'side', 'top')


class Sheets:
    """Orthographic Workbench renders, tiled: one row per view, one column per frame."""

    def __init__(self, scene, directory, hide):
        self.scene, self.dir = scene, pathlib.Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        for o in hide:
            o.hide_render = True
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'TEXTURE'
        scene.display.shading.show_object_outline = True
        scene.render.resolution_x, scene.render.resolution_y = 220, 280
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = False
        scene.render.image_settings.file_format = 'PNG'
        cam = bpy.data.objects.get('review-camera') or bpy.data.objects.new('review-camera', bpy.data.cameras.new('review-camera'))
        if cam.name not in scene.collection.objects:
            scene.collection.objects.link(cam)
        cam.data.type = 'ORTHO'
        scene.camera = cam
        self.cam = cam
        if 'review-ground' not in bpy.data.objects:  # a floor with a 25 cm grid, to judge feet against
            mesh = bpy.data.meshes.new('review-ground')
            verts, faces = [], []
            for i in range(-14, 14):  # (3.5 m each way: a clip that travels keeps the floor under it)
                for j in range(-14, 14):
                    k = len(verts)
                    x0, y0 = i * 0.25, j * 0.25
                    verts += [(x0, y0, 0), (x0 + 0.25, y0, 0), (x0 + 0.25, y0 + 0.25, 0), (x0, y0 + 0.25, 0)]
                    faces.append((k, k + 1, k + 2, k + 3))
            mesh.from_pydata(verts, [], faces)
            for shade in (0.55, 0.47):  # a checker, so a foot can be seen to stay put on it
                mat = bpy.data.materials.new('review-ground')
                mat.diffuse_color = (shade, shade + 0.02, shade + 0.05, 1)
                mesh.materials.append(mat)
            for k, poly in enumerate(mesh.polygons):
                poly.material_index = (k // 28 + k % 28) % 2
            ground = bpy.data.objects.new('review-ground', mesh)
            scene.collection.objects.link(ground)

    def follow(self, root):
        """Moves the floor under a clip that travels (its root per frame, [x, z, yaw] in glTF
        terms), so that the sheets show the feet against the ground they stand on; None puts it
        back."""
        ground = bpy.data.objects['review-ground']
        ground.animation_data_clear()
        ground.location, ground.rotation_euler = (0, 0, 0), (0, 0, 0)
        for f, (x, z, yaw) in enumerate(root or ()):
            ground.rotation_euler = (0, 0, -yaw)
            ground.location = Matrix.Rotation(-yaw, 3, 'Z') @ -Vector((x, -z, 0))
            ground.keyframe_insert('location', frame=f)
            ground.keyframe_insert('rotation_euler', frame=f)

    def render(self, name, frames, views=GAIT_VIEWS):
        tiles = {}
        for view in views:
            eye, target, scale = VIEWS[view]
            self.cam.location = eye
            self.cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
            self.cam.data.ortho_scale = scale
            for f in frames:
                self.scene.frame_set(f)
                path = self.dir / f'.tile-{view}-{f}.png'
                self.scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(str(path))
                w, h = img.size
                tiles[view, f] = np.array(img.pixels[:]).reshape(h, w, 4)
                bpy.data.images.remove(img)
                path.unlink()
        h, w = tiles[next(iter(tiles))].shape[:2]
        rows = [np.concatenate([tiles[view, f] for f in frames], axis=1) for view in reversed(list(views))]
        sheet = np.concatenate(rows, axis=0)  # pixels run bottom-up, so the first view is on top
        out = bpy.data.images.new(name, sheet.shape[1], sheet.shape[0], alpha=True)
        out.pixels.foreach_set(sheet.astype(np.float32).ravel())
        out.filepath_raw = str(self.dir / f'{name}.png')
        out.file_format = 'PNG'
        out.save()
        bpy.data.images.remove(out)
        return self.dir / f'{name}.png'
