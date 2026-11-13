"""The two vehicles as the clips see them: node transforms read from the source GLBs (read-only), the
moving nodes as functions of the controls, and the vehicle imported into the Blender scene as a prop
(a copy) that follows the clip.

Everything here is in the VEHICLE's glTF frame ("V": +Y up, forward -Z, right +X, metres), which is
the clip space of the contract (VEHICLE_NOTES.md). A node's world matrix is the product of its
ancestors' TRS; the moving nodes:

  car   door_L        rest @ Rx(-55 deg * door)           (canted hinge: the rest turn holds the cant;
                                                            checked against the GLB's doors_open keys)
        steering_wheel rest @ Ry(wheel)                    (glTF local +Y is the column, towards the
                                                            driver: + = turned left, the spec's
                                                            "local Z" being Blender's)
  heli  cockpit_door_R rest @ Ry(+68 deg * door)           (cockpit_doors_open keys)
        cyclic        rest @ Rx(-fwd) @ Rz(-right)         (pivot at the floor; + fwd tips the grip
                                                            forward (-Z), + right tips it to +X)
        collective    rest @ Rx(+up)                       (pivot at the back; + raises the grip)
        pedal_L/R     rest + (0, 0, -push)                 (+ push moves the pedal forward)

Control conventions are written into the pack's notes (`controls`).
"""
import math
import pathlib

import bpy
from mathutils import Matrix, Quaternion, Vector

from rifle_motion import gltfio
from rifle_motion.skel import C4, gl_quat

SOURCES = {
    'car': dict(glb=pathlib.Path(__import__('os').path.expanduser('~/Desktop/Code/test/supercar/supercar.glb')), root='vehicle_root'),
    'heli': dict(glb=pathlib.Path(__import__('os').path.expanduser('~/Desktop/Code/test/utility_helicopter/utility_helicopter_lod1.glb')), root='helicopter_root'),
}
DOOR = {'car': ('door_L', 55.0), 'heli': ('cockpit_door_R', 68.0)}
# control ranges (degrees / metres) of the one-pose clips and what the seated loops hold
CYCLIC_DEG = {'fwd': 9.0, 'back': 6.0, 'side': 6.0}
COLLECTIVE_DEG = {'down': 4.0, 'up': 20.0, 'fly': 13.0}
PEDAL_M = 0.045
WHEEL_DEG = 90.0
CI = C4.inverted()


def trs(node):
    t = Vector(node.get('translation', (0, 0, 0)))
    q = gl_quat(node.get('rotation', (0, 0, 0, 1))).normalized()
    s = node.get('scale', (1, 1, 1))
    return Matrix.Translation(t) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1.0))


# Vehicle fit per body family (the coordinator's decision, pass A1 follow-up): fixed offsets a driver or
# pilot makes with the vehicle's own adjusters, in each node's PARENT frame (V for these: their parent is
# the vehicle root). Written into the pack's notes (`vehicleFit`); the game applies the same offsets.
# A node listed with a helper ('with') moves its helper by the same offset.
FIT = {}  # set by build_vehicle_motion.py from the body's entry in fit.py


def column_offset(local, metres):
    """An offset along a steering wheel's column (its glTF local +Y), towards the driver, parent frame."""
    return local.to_3x3() @ Vector((0, 1, 0)) * metres


class Vehicle:
    """Node frames of one vehicle (V) and its controls."""

    def __init__(self, kind):
        self.kind = kind
        gltf, _ = gltfio.read(SOURCES[kind]['glb'])
        nodes = gltf['nodes']
        self.names = [n.get('name') for n in nodes]
        self.parent = {}
        for i, n in enumerate(nodes):
            for c in n.get('children', []):
                self.parent[self.names[c]] = self.names[i]
        self.local = {self.names[i]: trs(n) for i, n in enumerate(nodes)}
        self.source_local = dict(self.local)
        self.fit = {}
        for node, spec in FIT.get(kind, {}).items():
            off = Vector(spec['translate'])
            self.fit[node] = off
            self.local[node] = Matrix.Translation(off) @ self.local[node]
            if 'scale' in spec:  # (pass A3, the contract's `scale`: in the node's own frame, about its origin)
                sx, sy, sz = spec['scale']
                self.local[node] = self.local[node] @ Matrix.Diagonal((sx, sy, sz, 1.0))
        self.door_node, self.door_deg = DOOR[kind]

    def moved(self, name, ctl):
        """A node's local matrix with the controls `ctl` applied."""
        m = self.local[name]
        if name == self.door_node:
            angle = math.radians(self.door_deg * ctl.get('door', 0.0))
            turn = Matrix.Rotation(-angle, 4, 'X') if self.kind == 'car' else Matrix.Rotation(angle, 4, 'Y')
            return m @ turn
        if name == 'steering_wheel':
            return m @ Matrix.Rotation(math.radians(ctl.get('wheel', 0.0)), 4, 'Y')
        if name == 'cyclic':
            return m @ Matrix.Rotation(math.radians(-ctl.get('fwd', 0.0)), 4, 'X') @ Matrix.Rotation(math.radians(-ctl.get('right', 0.0)), 4, 'Z')
        if name == 'collective':
            return m @ Matrix.Rotation(math.radians(ctl.get('coll', 0.0)), 4, 'X')
        if name in ('pedal_L', 'pedal_R'):
            push = ctl.get('pedal', 0.0) * (1 if name == 'pedal_L' else -1)
            return Matrix.Translation((0, 0, -push)) @ m
        return m

    def world(self, name, ctl=None):
        """A node's frame in V with the controls applied."""
        ctl = ctl or {}
        m = self.moved(name, ctl)
        p = self.parent.get(name)
        while p is not None:
            m = self.moved(p, ctl) @ m
            p = self.parent.get(p)
        return m

    def point(self, name, at, ctl=None):
        return self.world(name, ctl) @ Vector(at)

    def to_local(self, name, p, ctl=None):
        return self.world(name, ctl).inverted() @ Vector(p)


# ---------------------------------------------------------------- the prop in the Blender scene

MOVING = {'car': ('door_L', 'door_R', 'steering_wheel'),
          'heli': ('cockpit_door_R', 'cockpit_door_L', 'cyclic', 'collective', 'pedal_L', 'pedal_R')}


def import_prop(kind):
    """Imports a copy of the vehicle under an empty `vehicle-<kind>` (the clip's root inverse is keyed
    on it). Returns (empty, {node name: object})."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCES[kind]['glb']))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:  # (the importer's stray icosphere / cube bone shapes)
        if o.name.startswith(('Icosphere', 'Cube')) and o.type == 'MESH' and o.parent is None and not o.users_collection[0].name.startswith('Scene'):
            pass
    by = {}
    for o in new:
        by[o.name.split('.')[0] if o.name.split('.')[0] in by else o.name] = o
    root = next(o for o in new if o.name.split('.')[0] == SOURCES[kind]['root'])
    empty = bpy.data.objects.new('vehicle-' + kind, None)
    bpy.context.scene.collection.objects.link(empty)
    root.parent = empty
    root.matrix_parent_inverse = Matrix.Identity(4)
    objs = {o.name.split('.')[0]: o for o in new}
    for o in new:
        if o.type == 'MESH' and 'blur' in o.name:
            o.hide_render = o.hide_viewport = True
    return empty, objs


def apply_fit(veh, objs):
    """Moves the prop's adjusted nodes by the vehicle fit (before anything reads the meshes)."""
    for name in veh.fit:
        o = objs.get(name)
        if o is not None:
            o.matrix_basis = C4 @ veh.local[name] @ CI
    bpy.context.view_layer.update()


def key_prop(veh, empty, objs, roots, ctls):
    """Keys the prop for a clip: the empty carries the inverse of the character's root (per frame
    [x, z, yaw] in V), so the vehicle stands where it is in the character's (root) frame; the moving
    nodes are keyed from the controls per frame."""
    for o in [empty] + [objs[n] for n in MOVING[veh.kind] if n in objs]:
        o.animation_data_clear()
        o.rotation_mode = 'QUATERNION'
    for f, ((x, z, yaw), ctl) in enumerate(zip(roots, ctls)):
        inv = (Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y')).inverted()
        mb = C4 @ inv @ CI
        empty.matrix_basis = mb
        empty.keyframe_insert('location', frame=f)
        empty.keyframe_insert('rotation_quaternion', frame=f)
        for name in MOVING[veh.kind]:
            o = objs.get(name)
            if o is None:
                continue
            o.matrix_basis = C4 @ veh.moved(name, ctl) @ CI
            o.keyframe_insert('location', frame=f)
            o.keyframe_insert('rotation_quaternion', frame=f)
    for o in [empty] + [objs[n] for n in MOVING[veh.kind] if n in objs]:
        if o.animation_data and o.animation_data.action:
            for fc in _fcurves(o.animation_data.action):
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'


def _fcurves(action):
    try:
        return list(action.fcurves)
    except AttributeError:  # (Blender 5 layered actions)
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out += list(bag.fcurves)
        return out
