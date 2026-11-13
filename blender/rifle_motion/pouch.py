"""The belt kit: a magazine pouch on the left front hip and shell loops behind it, modelled here from
boxes and cylinders. Everything is in the pelvis bone's glTF frame (the old Hips joint's: same place, identity rest) (+x left, +y up, +z forward,
metres), so the same numbers place it on the skeleton in Blender (build) and in the game, which reads
SHAPES from the clip notes (rifle-motion-ue5-v1.json `pouch`) and builds the same meshes on the pelvis bone
(character.js buildPouch).

The reloads draw from it (handling.py Clip.pouch): DRAW is where the middle of the palm takes hold,
per gun: the top of the fresh magazine standing out of the pouch, or the front shell in the loops.
"""
import math

import bpy
from mathutils import Matrix, Vector

from . import body
from .skel import QC, g2b

# (kind, centre, size or (radius, length), colour, name); boxes axis-aligned in the pelvis frame,
# cylinders standing upright
OLIVE, STRAP, SHELL, BRASS = (0.2, 0.21, 0.15), (0.12, 0.12, 0.1), (0.62, 0.14, 0.1), (0.72, 0.56, 0.26)
_COLOURS = {'OLIVE': OLIVE, 'STRAP': STRAP, 'SHELL': SHELL, 'BRASS': BRASS}
# (per body: bodies/<body>.json `pouch`)
# (an optional sixth entry: yaw, degrees about the pelvis's y, + turns the shape's +x towards -z; kind
# 'band': a belt round the body, at = (0, y, centre z), size = (inner half-width, inner half-depth,
# height, thickness): an elliptic ring)
SHAPES = [(k, tuple(c), tuple(sz), _COLOURS[col] if isinstance(col, str) else tuple(col), n) + tuple(rest)
          for k, c, sz, col, n, *rest in body.T['pouch']['shapes']]
# palm targets (pelvis frame): outside the magazine's top, and outside the front shell's head
DRAW = {g: Vector(v) for g, v in body.T['pouch']['draw'].items()}
# how far the drawing hand is turned about the pelvis's y with the kit (degrees; its yaw)
DRAW_YAW = dict(body.T['pouch'].get('drawYaw', {}))


def build(skeleton, skel=None):
    """The kit as meshes parented to the skeleton's pelvis bone, in place for its current pose."""
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones['pelvis']
    m = skeleton.matrix_world @ pb.matrix
    rot = (QC.inverted() @ m.to_quaternion()).normalized()  # the joint's glTF world turn
    if skel is not None and skel.posed_bind:
        # (the pelvis CANONICAL frame, the old Hips joint's, in which SHAPES are given: the bone's
        # turn from its bind, as bake.read_pose reads it, times bindWorld, less R)
        qc = QC
        turn = qc.inverted() @ m.to_quaternion() @ skeleton.data.bones['pelvis'].matrix_local.to_quaternion().inverted() @ qc
        rot = (turn @ skel.rest_world['pelvis'] @ skel.R['pelvis'].inverted()).normalized()
    pos = m.translation
    made = []
    for kind, centre, size, colour, name, *rest in SHAPES:
        yaw = rest[0] if rest else 0.0
        if kind == 'band':
            obj = _band(name, *size)
        elif kind == 'box':
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            obj = bpy.context.active_object
            obj.scale = g2b(Vector(size))
            obj.scale = Vector([abs(x) for x in obj.scale])
            bevel = obj.modifiers.new('round', 'BEVEL')
            bevel.width, bevel.segments = 0.004, 2
        else:
            radius, length = size
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=length)
            obj = bpy.context.active_object
        obj.name = 'kit_' + name
        mat = bpy.data.materials.new('kit_' + name)
        mat.diffuse_color = (*colour, 1)
        obj.data.materials.append(mat)
        # placed at the joint's current frame, then carried by the bone
        world_rot = QC @ rot @ QC.inverted()
        turn = Matrix.Rotation(math.radians(yaw), 4, 'Z')  # (about G y = B z)
        place = Matrix.Translation(pos + world_rot @ g2b(Vector(centre))) @ world_rot.to_matrix().to_4x4() @ turn @ Matrix.Diagonal((*obj.scale, 1.0))
        obj.parent = skeleton
        obj.parent_type = 'BONE'
        obj.parent_bone = 'pelvis'
        bpy.context.view_layer.update()
        obj.matrix_world = place
        made.append(obj)
    return made


def _band(name, a, b, height, thickness, n=64):
    """An elliptic ring (B: round z), inner semi-axes a (x) and b (G z = B -y), flat ends."""
    verts, faces = [], []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, z = a * math.sin(t), b * math.cos(t)
        nx, nz = math.sin(t) / a, math.cos(t) / b
        k = math.hypot(nx, nz)
        nx, nz = nx / k, nz / k
        for r in (0.0, thickness):
            for y in (-height / 2, height / 2):
                verts.append((x + nx * r, -(z + nz * r), y))
    for i in range(n):
        j = (i + 1) % n
        a0, b0 = 4 * i, 4 * j
        # (inner lo, inner hi, outer lo, outer hi)
        faces += [(a0, b0, b0 + 1, a0 + 1), (a0 + 2, a0 + 3, b0 + 3, b0 + 2), (a0 + 1, b0 + 1, b0 + 3, a0 + 3), (a0, a0 + 2, b0 + 2, b0)]
    mesh = bpy.data.meshes.new('kit_' + name)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new('kit_' + name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def notes():
    """The shapes for the game (clip notes); `yaw` (degrees about the pelvis's y) where a shape has one."""
    out = []
    for k, c, s, col, n, *rest in SHAPES:
        d = dict(kind=k, at=list(c), size=list(s), colour=list(col), name=n)
        if rest:
            d['yaw'] = rest[0]
        out.append(d)
    return out
