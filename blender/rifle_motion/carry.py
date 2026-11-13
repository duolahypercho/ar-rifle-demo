"""The carry: where the gun is held, authored here and exported with every clip as the gun's own
track (the `Gun` node under the chest joint), so the game puts the gun exactly where the clip
has it and only solves the hands onto it.

Three holds, all with the butt at the shoulder and the trunk shaped round the gun (bladed a
little to the right so the support shoulder comes forward, the support collarbone drawn forward,
the firing one a touch):

  low   low ready: muzzle down about 33 degrees and across the body, both elbows bent and down,
        the gun close to the chest.
  high  high ready, just after firing or a reload: nearly level, still across a little.
  sprint  the low ready pulled in tight for running flat out: the butt further across and the
        gun closer to the chest, the muzzle lower and further across, with a squarer trunk (the
        sprint pumps it with the stride; gait.py). A high port across the chest was tried first:
        with the hands held on the gun as the other holds hold them, no place for it kept both
        wrists inside 35 degrees and the gun off the body.

Each is the butt's place in the chest joint's frame (G: +X left, +Y up, +Z forward) and the
gun's turn in that frame (yaw + = muzzle to the shooter's left, pitch + = muzzle down, roll + =
top of the gun to the shooter's right), as weapon.js reads them. They were found by search on
this rig: the support palm must reach grip_support with the elbow still bent, the firing wrist
must stay in its natural range, and the gun must clear the posed, skinned body by at least a
centimetre (review.MeshTest; the sprint's, pumped by the stride, by half of one).

The palms go where the game puts them (weapon.js / shotgun.js): the middle of the palm on
`grip_main` and on `grip_support`, slid back along the handguard or the shotgun's pump by
`carry_slide`. Carried, the firing hand sits round the grip turned about its palm (weapon.js
HAND.grip, shotgun.js HAND.gripCarry), which keeps the wrist in its natural range with the
elbow down at the ribs. Both guns ride the same holds; the shotgun's hands differ (GUNS).
"""
import math

from mathutils import Matrix, Quaternion, Vector

from . import body
from .skel import ypr

DEG = math.pi / 180
PALM_LOCAL = Vector(body.T['palm'])  # middle of the palm from the wrist, hand frame (the body's table)
HALF_TURN = Quaternion((0, 1, 0), math.pi)

# (per body: rifle_motion/bodies/<body>.json `holds`)
HOLDS = {k: dict(at=Vector(v['at']), yaw=v['yaw'], pitch=v['pitch'], roll=v['roll']) for k, v in body.T['holds'].items()}
# The trunk round each hold (degrees): forward lean of Spine, Spine1, Spine2 (in each joint's
# frame, before the gait's own lean), the turn shared up the spine (- = chest to the right, the
# support shoulder forward), and each collarbone's turn about the vertical (- = drawn forward on
# the left, + on the right).
TRUNK = {
    'low': dict(lean=(1.5, 1.5, 1.0), turn=-20.0, collar={'clavicle_l': -22.0, 'clavicle_r': 4.0}),
    'high': dict(lean=(1.0, 1.0, 0.5), turn=-18.0, collar={'clavicle_l': -22.0, 'clavicle_r': 5.0}),
    'sprint': dict(lean=(1.0, 1.0, 0.5), turn=-6.0, collar={'clavicle_l': -12.0, 'clavicle_r': 2.0}),
}


def hand_quat(p, f):
    """Hand rotation whose palm faces p and whose fingers run along f (weapon.js handQuat)."""
    p = Vector(p).normalized()
    f = Vector(f)
    f = (f - p * f.dot(p)).normalized()
    x = p.cross(f)
    return Matrix((x, -f, p)).transposed().to_quaternion()


# Per gun: the part whose back face is the butt, each palm's node and offset (gun frame), the
# carried hand turns (weapon.js HAND.grip / support, shotgun.js HAND.gripCarry / pump) and
# where the elbows point, in the chest's frame (weapon.js / shotgun.js CARRY_POLE). The shotgun's
# firing hand holds the wrist of a straight, deep stock: carried, the palm sits further round it
# and the elbow goes out, or the forearm would pass through the stock's toe.
_G = body.T['guns']  # (per body: palms, hand turns, poles, slide, shift)
GUNS = {
    'rifle': dict(
        file='public/ar_rifle.glb', butt='stock',
        palm={k: (n, Vector(o)) for k, (n, o) in _G['rifle']['palm'].items()},
        hand={k: hand_quat(*v) for k, v in _G['rifle']['hand'].items()},
        pole={k: Vector(v) for k, v in _G['rifle']['pole'].items()},
        # weapon.js CARRY_SLIDE: carried, the support hand holds the handguard 6 cm behind
        # grip_support (its back end is 13 cm behind it, the magazine well's front 10), so that
        # arm can bend at the elbow instead of reaching nearly straight
        carry_slide=_G['rifle']['carrySlide'], shift=Vector(_G['rifle']['shift']), loose=('magazine', 'charging_handle')),
    'shotgun': dict(
        file='public/pump_shotgun.glb', butt='butt_pad',
        palm={k: (n, Vector(o)) for k, (n, o) in _G['shotgun']['palm'].items()},
        hand={k: hand_quat(*v) for k, v in _G['shotgun']['hand'].items()},
        pole={k: Vector(v) for k, v in _G['shotgun']['pole'].items()},
        # shotgun.js CARRY_SLIDE: carried, the hand holds the back of the pump; CARRY_SHIFT: its
        # deeper stock is held a little lower, further in and further off the chest, clear of the
        # upper arm
        carry_slide=_G['shotgun']['carrySlide'], shift=Vector(_G['shotgun']['shift']), loose=('pump',)),
}


def basis_quat(muzzle, top):
    """The gun's turn whose barrel points along `muzzle` (the gun's -Z) with its top (+Y) towards
    `top`, both in the chest's frame."""
    z = -Vector(muzzle).normalized()
    y = Vector(top)
    y = (y - z * y.dot(z)).normalized()
    return Matrix((y.cross(z), y, z)).transposed().to_quaternion()


# Slung across the back, in the chest joint's frame: the butt behind the right shoulder blade,
# the muzzle down towards the left hip, the gun on its side with its right face to the back. It is
# where the firing hand can put it over the right shoulder (the forearm runs down the back from a
# raised elbow and the barrel lies along it) and where the support hand finds its fore-end behind
# the left hip. Checked against the posed body (review.MeshTest.slung_clearance, in the idle,
# the hold, the walk and the jog): the game's old place stood each gun 3 cm or more off the back;
# here it is 1.5 to 2 cm clear (at 2 cm closer it touches the jacket).
STOW = {g: dict(at=Vector(v['at']), muzzle=Vector(v['muzzle']), top=Vector(v['top'])) for g, v in body.T['stow'].items()}


class Carry:
    """The holds for one gun. `info` is what rig.py measured on it (butt, node positions)."""

    def __init__(self, gun, info):
        spec = GUNS[gun]
        self.gun = gun
        self.butt = info['butt']
        self.hand = spec['hand']
        self.pole = spec['pole']
        self.shift = spec['shift']
        self.palm = {}
        for side, (node, offset) in spec['palm'].items():
            self.palm[side] = info[node] + offset
        self.palm['Left'] = self.palm['Left'] + Vector((0, 0, spec['carry_slide']))

    @staticmethod
    def local(hold, offset=None):
        """The gun in the chest joint's frame: (butt position, rotation) of a hold, or of a blend
        {'low': w, 'high': 1 - w}; `offset` = (yaw, pitch, roll in degrees, butt shift) on top."""
        weights = {hold: 1.0} if isinstance(hold, str) else hold
        at = sum((HOLDS[k]['at'] * w for k, w in weights.items()), Vector())
        angle = {a: sum(HOLDS[k][a] * w for k, w in weights.items()) for a in ('yaw', 'pitch', 'roll')}
        if offset is not None:
            for a, d in zip(('yaw', 'pitch', 'roll'), offset[:3]):
                angle[a] += d
            at = at + offset[3]
        return at, ypr(angle['yaw'] * DEG, angle['pitch'] * DEG, angle['roll'] * DEG) @ HALF_TURN

    def place(self, chest_pos, chest_quat, hold='low', lag=None, offset=None):
        """The gun and both wrist targets for a chest joint at chest_pos / chest_quat (G, model
        space). `lag` = (position offset, rotation) applied to the gun in model space."""
        at, quat = self.local(hold, offset)
        butt = chest_pos + chest_quat @ (at + self.shift)
        quat = chest_quat @ quat
        if lag is not None:
            butt = butt + lag[0]
            quat = lag[1] @ quat
        out = {'butt': butt, 'quat': quat, 'wrist': {}, 'palm': {}}
        for side in ('Right', 'Left'):
            palm = butt + quat @ (self.palm[side] - self.butt)
            hq = quat @ self.hand[side]
            out['palm'][side] = palm
            out['wrist'][side] = (palm - hq @ PALM_LOCAL, hq)
        return out

    def point(self, placed, local):
        """A point given in the gun's own frame, in model space."""
        return placed['butt'] + placed['quat'] @ (Vector(local) - self.butt)

    def stow_local(self):
        """The slung gun in the chest joint's frame: (butt, turn)."""
        s = STOW[self.gun]
        return s['at'].copy(), basis_quat(s['muzzle'], s['top'])

    def stowed(self, chest_pos, chest_quat):
        at, quat = self.stow_local()
        return {'butt': chest_pos + chest_quat @ at, 'quat': chest_quat @ quat}
