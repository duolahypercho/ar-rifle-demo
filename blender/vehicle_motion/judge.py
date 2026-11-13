"""Judging a vehicle clip against the vehicle: the posed, skinned body tested against the vehicle's
meshes (triangle pairs per body part and vehicle part, every frame), how far the head stays under the
roof and the door frame, how far each hand and foot is from its contact point, how hard anything
snaps, and contact sheets / close-ups with the vehicle shown.

All in the vehicle's frame V (vehicles.py): the body's vertices are carried out of the character's root
frame by the clip's root per frame; the vehicle's fixed meshes are read once, the moving ones (doors,
wheel, controls) from their node frames per frame.
"""
import math
import pathlib

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

from rifle_motion import review
from rifle_motion.carry import PALM_LOCAL
from rifle_motion.skel import C4, b2g, g2b

from . import vehicles

CI = C4.inverted()
# vehicle meshes tested against the body (the rest are out of reach); per kind
TESTED = {
    'car': ('body_shell', 'interior', 'seat_driver', 'windshield', 'door_L', 'door_glass_L', 'steering_wheel', 'mirror_L', 'hood', 'engine_cover'),
    'heli': ('fuselage', 'interior', 'pilot_seat', 'windshield', 'instrument_panel', 'cockpit_door_R', 'cockpit_door_R_glass', 'cockpit_door_R_handle',
             'cyclic', 'collective', 'pedal_L', 'pedal_R', 'skid_R', 'skid_supports', 'passenger_seat_03'),
}
# what a body part may touch without it counting (a seat takes the body's weight; a hand holds what it
# holds and a foot stands on what it stands on: those are reported apart, as contact)
SEATS = {'car': ('seat_driver',), 'heli': ('pilot_seat',)}
SEAT_PARTS = ('pelvis', 'spine_01', 'spine_03', 'spine_05', 'thigh_l', 'thigh_r', 'clavicle_l', 'clavicle_r')
CUSHION_PARTS = ('pelvis', 'thigh_l', 'thigh_r')
BACK_PARTS = ('spine_01', 'spine_03', 'spine_05', 'clavicle_l', 'clavicle_r')
# body parts kept clear of a control (the knees and shins of the rim, the thighs of the cyclic): cm
CLEAR_OF = {'car': ('steering_wheel', ('thigh_l', 'thigh_r', 'calf_l', 'calf_r')),
            'heli': ('cyclic', ('thigh_l', 'thigh_r', 'calf_l', 'calf_r'))}
# the roof, the door frame and what is overhead: the head's clearance is measured against these
OVERHEAD = {'car': ('body_shell', 'interior', 'windshield', 'door_L', 'door_glass_L'),
            'heli': ('fuselage', 'interior', 'windshield', 'cockpit_door_R', 'cockpit_door_R_glass')}
HEAD_PARTS = ('head', 'neck_01')


def _hand_part(p):
    return p.startswith('hand_') or review.is_finger(p)


class VehicleTest:
    def __init__(self, veh, objs, body, root_empty):
        self.veh, self.body = veh, body
        bpy.context.view_layer.update()
        mt = review.MeshTest(body, [], None)
        self.part = mt.part
        # each tested mesh in its node's own frame (G): the node frame comes from vehicles.Vehicle
        self.meshes = {}
        empty_inv = root_empty.matrix_world.inverted()
        for name in TESTED[veh.kind]:
            o = objs.get(name)
            if o is None:
                continue
            m = o.data
            node_g = veh.world(name)  # rest controls (props are read before any clip moves them)
            # (B vertex -> G: (x, z, -y); the object matrix in B; node frame in G)
            mw = empty_inv @ o.matrix_world
            gv = []
            for v in m.vertices:
                wb = mw @ v.co
                gv.append(node_g.inverted() @ b2g(wb))
            polys = [tuple(p.vertices) for p in m.polygons]
            self.meshes[name] = (gv, polys)

    def _tree(self, names, ctl):
        verts, polys, owner = [], [], []
        for name in names:
            if name not in self.meshes:
                continue
            gv, pp = self.meshes[name]
            m = self.veh.world(name, ctl)
            k = len(verts)
            verts += [m @ v for v in gv]
            polys += [tuple(k + i for i in p) for p in pp]
            owner += [name] * len(pp)
        self._last = (verts, polys)
        return BVHTree.FromPolygons(verts, polys), owner

    def body_verts(self, root):
        """The posed body's vertices in V, and its polygons."""
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        x, z, yaw = root
        to_v = Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y')
        verts = [to_v @ b2g(mw @ v.co) for v in mesh.vertices]
        polys = [tuple(p.vertices) for p in mesh.polygons]
        ev.to_mesh_clear()
        return verts, polys

    def frame(self, root, ctl, contacts_on):
        """One frame (the scene already at it): {pairs: {body/vehicle: n}, contact pairs, head clearance
        (cm) and against what}. contacts_on: {part: node} on at this frame (a hand / foot on that node
        does not count against it)."""
        verts, polys = self.body_verts(root)
        names = [n for n in TESTED[self.veh.kind] if n in self.meshes]
        tree, owner = self._tree(names, ctl)
        btree = BVHTree.FromPolygons(verts, polys)
        bowner = [self.part[p[0]] for p in polys]
        tverts, tpolys = self._last
        pairs, contact, seat = {}, {}, {}
        hits = {}  # key -> (body polys, vehicle polys) for the depth (pass A2)
        in_contact = set()
        for bi, vi in btree.overlap(tree):
            hb = hits.setdefault(f'{bowner[bi]}/{owner[vi]}', (set(), set()))
            hb[0].add(bi)
            hb[1].add(vi)
            part, what = bowner[bi], owner[vi]
            key = f'{part}/{what}'
            limb = 'hand_l' if part.endswith('_l') and _hand_part(part) else 'hand_r' if _hand_part(part) else None
            foot = part if part in ('foot_l', 'foot_r', 'ball_l', 'ball_r') else None
            if (limb and contacts_on.get(limb) == what) or (foot and contacts_on.get('foot_' + foot[-1]) == what):
                contact[key] = contact.get(key, 0) + 1
                in_contact.add(key)
            elif what in SEATS[self.veh.kind] and part in SEAT_PARTS:
                seat[key] = seat.get(key, 0) + 1
            else:
                pairs[key] = pairs.get(key, 0) + 1
        depth_all = self.depths(hits, verts, polys, btree, tverts, tpolys, owner, ctl)
        depth = {k: v for k, v in depth_all.items() if k not in in_contact}
        contact_depth = {k: v for k, v in depth_all.items() if k in in_contact}
        # the head: nearest overhead surface from a sample of head / neck vertices (pass A2: signed, - = inside;
        # and per overhead part)
        otree, oowner = self._tree([n for n in OVERHEAD[self.veh.kind] if n in self.meshes], ctl)
        head_v = [i for i in range(0, len(verts), 3) if self.part[i] in HEAD_PARTS]
        best, by = math.inf, None
        head_by = {}
        for i in head_v:
            hit = otree.find_nearest(verts[i])
            if hit[0] is None:
                continue
            d = hit[3]  # (signed below from the overlap test: a part the head / neck overlaps is inside by its depth)
            w = oowner[hit[2]]
            head_by[w] = min(head_by.get(w, math.inf), d * 100)
            if d < best:
                best, by = d, w
        # (inside: a ray up from the vertex meets the surface's back face first -> negative)
        # how deep the body sinks into the seat (cushion parts, back parts), how close the back comes to it
        for k, dd in depth.items():
            part, w = k.split('/')
            if part in HEAD_PARTS and w in head_by:
                head_by[w] = -dd
                if -dd / 100 < best:
                    best, by = -dd / 100, w
        stree, _ = self._tree(SEATS[self.veh.kind], ctl)
        # (by the face sunk into: the cushion's top (normal up), the backrest's face (normal forward, -Z), or a
        # side bolster / harness strap (any other way))
        sink = {'cushion': 0.0, 'back': 0.0, 'bolster': 0.0}
        back_gap = math.inf
        for i in range(0, len(verts), 2):
            part = self.part[i]
            grp = 'cushion' if part in CUSHION_PARTS else 'back' if part in BACK_PARTS else None
            if grp is None:
                continue
            loc, nrm, _, dist = stree.find_nearest(verts[i], 0.08)
            if loc is None:
                continue
            inside = (verts[i] - loc).dot(nrm) < 0
            if inside:
                face = 'cushion' if nrm.y > 0.6 else 'back' if nrm.z < -0.6 else 'bolster'
                sink[face] = max(sink[face], dist)
            if grp == 'back':
                back_gap = min(back_gap, 0.0 if inside else dist)
        node, parts = CLEAR_OF[self.veh.kind]
        ctree, _ = self._tree((node,), ctl)
        clear = math.inf
        for i in range(0, len(verts), 2):
            if self.part[i] in parts:
                hit = ctree.find_nearest(verts[i], 0.2)
                if hit[0] is not None:
                    inside = (verts[i] - hit[0]).dot(hit[1]) < 0
                    clear = min(clear, -hit[3] if inside else hit[3])
        return dict(pairs=pairs, contact=contact, seat=seat, headCm=best * 100, headBy=by, headByCm=head_by, depthCm=depth, contactDepthCm=contact_depth,
                    headTop=max(verts[i].y for i in head_v) if head_v else None,
                    sinkCm={k: v * 100 for k, v in sink.items()}, backGapCm=back_gap * 100, clearCm=clear * 100)


_DIRS = (Vector((0.0, 1.0, 0.0)), Vector((1.0, 0.0, 0.0)), Vector((0.0, 0.0, 1.0)))


def _inside(tree, p, loc, nrm, dist):
    """(pass A3 round 2) Is p inside the surface `tree`, given its nearest point loc / face normal nrm / distance? Behind
    the nearest face counts as inside when the nearest point is inside that face (p's distance from the face's plane is
    its distance); when the nearest point is on an edge or a corner (the plane distance well under it) the face's normal
    says nothing about p (a point just outside a fingertip or a cushion's edge came out 5 cm 'inside'), so the surface
    is crossed along three axes: inside if an odd count of crossings on at least two."""
    if (p - loc).dot(nrm) >= 0:
        return False
    if abs((p - loc).dot(nrm)) >= 0.9 * dist:
        return True
    odd = 0
    for d in _DIRS:
        n, o = 0, p + d * 1e-4
        for _ in range(64):
            h = tree.ray_cast(o, d, 3.0)
            if h[0] is None:
                break
            n += 1
            o = h[0] + d * 1e-4
        odd += n % 2
    return odd >= 2


def _depths(self, hits, verts, polys, btree, tverts, tpolys, owner, ctl):
    """Per overlapping pair key (body part / vehicle part): how deep they are in each other, cm (pass A2): the
    deepest of (a) a vertex of the body's overlapping triangles behind the vehicle part's nearest surface (its
    face normal pointing away) and (b) a vertex of the vehicle's overlapping triangles behind the body's nearest
    surface; triangles that cross with no vertex inside count 0.1 (brushing)."""
    out = {}
    trees = {}
    for key, (bset, vset) in hits.items():
        what = key.split('/')[1]
        if what not in trees:
            trees[what] = self._tree((what,), ctl)[0]
        t = trees[what]
        d = 0.0
        for v in {k for bi in bset for k in polys[bi]}:
            loc, nrm, _, dist = t.find_nearest(verts[v], 0.10)
            if loc is not None and _inside(t, verts[v], loc, nrm, dist):
                d = max(d, dist)
        for v in {k for vi in vset for k in tpolys[vi]}:
            loc, nrm, _, dist = btree.find_nearest(tverts[v], 0.10)
            if loc is not None and _inside(btree, tverts[v], loc, nrm, dist):
                d = max(d, dist)
        out[key] = round(max(d * 100, 0.1), 2)
    return out


VehicleTest.depths = _depths


def snap(V, keys=('hand_l', 'hand_r', 'foot_l', 'foot_r', 'head')):
    """Worst one-frame change of velocity (m/s) of each part, in V (the vehicle at rest)."""
    out = {}
    for k in keys:
        track = [v[k] for v in V]
        vel = [(b - a) * 30 for a, b in zip(track, track[1:])]
        out[k] = max(((b - a).length for a, b in zip(vel, vel[1:])), default=0.0)
    return out


def world_parts(baked, roots):
    """Per frame, the hands' palms, the feet's balls / heels and the head in V."""
    from rifle_motion import body as body_table
    heel = Vector(body_table.T['review']['heel'])
    ball_y = body_table.T['review']['ballY']
    out = []
    for f, (x, z, yaw) in zip(baked, roots):
        m = Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y')
        q = Quaternion((0, 1, 0), yaw)
        d = {}
        for side, s in (('Left', 'l'), ('Right', 'r')):
            d['hand_' + s] = m @ (f['pos']['hand_' + s] + f['rot']['hand_' + s] @ PALM_LOCAL)
            d['handq_' + s] = q @ f['rot']['hand_' + s]
            d['foot_' + s] = m @ f['pos']['foot_' + s]
            d['ball_' + s] = m @ f['pos']['ball_' + s]
            d['sole_' + s] = m @ (f['pos']['ball_' + s] - f['rot']['ball_' + s] @ Vector((0, ball_y, 0)))  # the sole under the ball
            d['heel_' + s] = m @ (f['pos']['foot_' + s] + f['rot']['foot_' + s] @ heel)
        d['head'] = m @ f['pos']['head']
        d['pelvis'] = m @ f['pos']['pelvis']
        out.append(d)
    return out


# ---------------------------------------------------------------- pictures

def set_cam(cam, target, came_from, scale, dist=6.0, cut=None):
    """An orthographic camera on `target` from `came_from`; `cut`: everything nearer than `cut` m in
    front of the target is clipped away (a section through the vehicle)."""
    eye = target + came_from.normalized() * dist
    cam.data.clip_start = 0.1 if cut is None else dist - cut
    cam.location = eye
    cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale
    cam.data.clip_end = 40


def sheet(scene, path, frames, rows, size=(240, 300)):
    """rows: [(label, setup callable(frame) -> None)]: one render per frame per row, tiled."""
    cam = scene.camera
    old = (scene.render.resolution_x, scene.render.resolution_y)
    scene.render.resolution_x, scene.render.resolution_y = size
    path = pathlib.Path(path)
    tiles = []
    for label, setup in rows:
        row = []
        for f in frames:
            scene.frame_set(f)
            setup(f)
            tmp = path.parent / f'.tile-{label}-{f}.png'
            scene.render.filepath = str(tmp)
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(str(tmp))
            w, h = img.size
            row.append(np.array(img.pixels[:]).reshape(h, w, 4))
            bpy.data.images.remove(img)
            tmp.unlink()
        tiles.append(np.concatenate(row, axis=1))
    out = np.concatenate(list(reversed(tiles)), axis=0)
    img = bpy.data.images.new(path.stem, out.shape[1], out.shape[0], alpha=True)
    img.pixels.foreach_set(out.astype(np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    scene.render.resolution_x, scene.render.resolution_y = old
    return path
